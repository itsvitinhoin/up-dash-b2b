import { and, asc, eq, gte, lt, lte, sql } from "drizzle-orm";
import {
  clientsTable,
  db,
  googleAdsConnectionsTable as connections,
  googleAdsDailyTable as daily,
  type GoogleAdsCampaignMetrics,
} from "@workspace/db";
import {
  GoogleAdsError,
  googleAdsConfigured,
  readGoogleAdsAccount,
  readGoogleAdsCampaigns,
  type GoogleAdsAccountIds,
  type GoogleAdsDates,
} from "./google-ads-api";

type Connection = typeof connections.$inferSelect;
type DailyRow = typeof daily.$inferInsert;
const dayMs = 86_400_000;

function accountToday(timeZone: string, now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function closedDays(timeZone: string, now: Date): GoogleAdsDates {
  const today = Date.parse(accountToday(timeZone, now));
  return {
    dateFrom: new Date(today - 30 * dayMs).toISOString().slice(0, 10),
    dateTo: new Date(today - dayMs).toISOString().slice(0, 10),
  };
}

function rangeDays({ dateFrom, dateTo }: GoogleAdsDates) {
  return (Date.parse(dateTo) - Date.parse(dateFrom)) / dayMs + 1;
}

function assertRange(dates: GoogleAdsDates) {
  const count = rangeDays(dates);
  if (!Number.isInteger(count) || count < 1 || count > 366) {
    throw new GoogleAdsError("Selecione um período de 1 a 366 dias.", 400);
  }
}

async function existingConnection(clientId: string) {
  const [connection] = await db.select().from(connections).where(eq(connections.clientId, clientId));
  return connection;
}

async function collectDays(connection: Connection, dates: GoogleAdsDates, startedAt: Date): Promise<DailyRow[]> {
  assertRange(dates);
  const count = rangeDays(dates);
  const from = Date.parse(dates.dateFrom);
  const rows = new Map<string, DailyRow>();
  for (let offset = 0; offset < count; offset += 1) {
    const day = new Date(from + offset * dayMs).toISOString().slice(0, 10);
    rows.set(day, { customerId: connection.customerId, day, campaigns: [], fetchedAt: startedAt });
  }
  const campaigns = await readGoogleAdsCampaigns(connection, dates);
  for (const { day, ...campaign } of campaigns) {
    const row = rows.get(day);
    if (!row) throw new GoogleAdsError("O Google Ads retornou uma data fora do período solicitado.", 502);
    row.campaigns.push(campaign);
  }
  return Array.from(rows.values());
}

function saveDays(database: Pick<typeof db, "insert">, rows: DailyRow[]) {
  return database.insert(daily).values(rows).onConflictDoUpdate({
    target: [daily.customerId, daily.day],
    set: { campaigns: sql`excluded.campaigns`, fetchedAt: sql`excluded.fetched_at` },
    setWhere: lt(daily.fetchedAt, sql`excluded.fetched_at`),
  });
}

export async function connectGoogleAds(clientId: string, ids: GoogleAdsAccountIds) {
  const [client] = await db.select({ id: clientsTable.id }).from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!client) throw new GoogleAdsError("Cliente não encontrado.", 404);
  const existing = await existingConnection(clientId);
  const sameIds = (connection: Connection) => connection.customerId === ids.customerId && connection.managerId === ids.managerId;
  const conflict = () => new GoogleAdsError("Já existe um vínculo do Google Ads para esta marca ou esta conta anunciante.", 409);
  if (existing && !sameIds(existing)) throw conflict();

  const startedAt = new Date();
  const connection = { ...ids, ...await readGoogleAdsAccount(ids), clientId };
  const dates = closedDays(connection.timeZone, startedAt);
  const rows = await collectDays(connection, dates, startedAt);
  await db.transaction(async (tx) => {
    const [created] = await tx.insert(connections).values(connection).onConflictDoNothing().returning();
    if (!created) {
      const [saved] = await tx.select().from(connections).where(eq(connections.clientId, clientId));
      if (!saved || !sameIds(saved)) throw conflict();
    }
    await saveDays(tx, rows);
  });
  return dates;
}

export async function refreshGoogleAds(clientId: string, dates?: GoogleAdsDates) {
  const connection = await existingConnection(clientId);
  if (!connection) throw new GoogleAdsError("Conecte uma conta anunciante antes de sincronizar.", 409);
  const startedAt = new Date();
  const today = accountToday(connection.timeZone, startedAt);
  const range = dates ?? { ...closedDays(connection.timeZone, startedAt), dateTo: today };
  assertRange(range);
  if (range.dateFrom > today) throw new GoogleAdsError("Selecione uma data inicial que já tenha começado no Google Ads.", 400);
  const actual = { ...range, dateTo: range.dateTo > today ? today : range.dateTo };
  await saveDays(db, await collectDays(connection, actual, startedAt));
  return actual;
}

export async function googleAdsClientIds() {
  const rows = await db.select({ id: connections.clientId }).from(connections)
    .innerJoin(clientsTable, eq(clientsTable.id, connections.clientId))
    .where(eq(clientsTable.isActive, true)).orderBy(asc(connections.clientId));
  return rows.map((row) => row.id);
}

function emptyMetrics() {
  return { costMicros: 0, clicks: 0, impressions: 0, conversions: 0, conversionValue: 0 };
}

function addMetrics(total: ReturnType<typeof emptyMetrics>, row: ReturnType<typeof emptyMetrics>) {
  total.costMicros += row.costMicros;
  total.clicks += row.clicks;
  total.impressions += row.impressions;
  total.conversions += row.conversions;
  total.conversionValue += row.conversionValue;
}

function withRatios<T extends ReturnType<typeof emptyMetrics>>(total: T) {
  const { costMicros, ...rest } = total;
  const spend = costMicros / 1_000_000;
  return {
    ...rest,
    spend,
    costPerConversion: total.conversions > 0 ? spend / total.conversions : null,
    roas: spend > 0 ? total.conversionValue / spend : null,
  };
}

export async function getGoogleAdsReport(
  clientId: string,
  dates: GoogleAdsDates,
  includeConfig: boolean,
  campaignId?: string,
) {
  assertRange(dates);
  const options = includeConfig ? { configured: googleAdsConfigured() } : {};
  const connection = await existingConnection(clientId);
  if (!connection) return { ...options, connection: null, report: null };

  const daysRequested = rangeDays(dates);
  const firstDay = Date.parse(dates.dateFrom);
  const previousFrom = new Date(firstDay - daysRequested * dayMs).toISOString().slice(0, 10);
  const previousTo = new Date(firstDay - dayMs).toISOString().slice(0, 10);
  const rows = await db.select().from(daily)
    .where(and(eq(daily.customerId, connection.customerId), gte(daily.day, previousFrom), lte(daily.day, dates.dateTo)))
    .orderBy(asc(daily.day));
  const total = emptyMetrics();
  const previousTotal = emptyMetrics();
  const campaigns = new Map<string, GoogleAdsCampaignMetrics>();
  const series = [];
  let previousDaysCovered = 0;
  let lastSyncedAt = 0;

  for (const row of rows) {
    const metrics = emptyMetrics();
    const isPrevious = row.day < dates.dateFrom;
    for (const campaign of row.campaigns) {
      if (campaignId && campaign.campaignId !== campaignId) continue;
      addMetrics(metrics, campaign);
      if (isPrevious) continue;

      const accumulated = campaigns.get(campaign.campaignId);
      if (accumulated) {
        addMetrics(accumulated, campaign);
        accumulated.name = campaign.name;
        accumulated.channel = campaign.channel;
      } else {
        campaigns.set(campaign.campaignId, { ...campaign });
      }
    }
    if (isPrevious) {
      previousDaysCovered += 1;
      addMetrics(previousTotal, metrics);
    } else {
      lastSyncedAt = Math.max(lastSyncedAt, row.fetchedAt.getTime());
      addMetrics(total, metrics);
      series.push({ day: row.day, ...withRatios(metrics) });
    }
  }

  const { accountName, currency, timeZone } = connection;
  return {
    ...options,
    connection: { accountName, currency, timeZone },
    report: {
      ...dates,
      daysCovered: series.length,
      daysRequested,
      lastSyncedAt: lastSyncedAt ? new Date(lastSyncedAt).toISOString() : null,
      total: withRatios(total),
      previous: {
        dateFrom: previousFrom,
        dateTo: previousTo,
        daysCovered: previousDaysCovered,
        total: previousDaysCovered === daysRequested ? withRatios(previousTotal) : null,
      },
      campaigns: Array.from(campaigns.values()).sort((a, b) => b.costMicros - a.costMicros).map(withRatios),
      series,
    },
  };
}
