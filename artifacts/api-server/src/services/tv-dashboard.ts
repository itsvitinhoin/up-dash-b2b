import { and, desc, eq, gte, isNull, inArray, lte, sql } from "drizzle-orm";
import {
  clientsTable,
  creativesTable,
  db,
  ordersTable,
  syncJobsTable,
} from "@workspace/db";
import type { TvBrand, TvSnapshot, TvSyncStatus } from "@workspace/api-zod";
import { fetchStoredAdsDaily, totalSpend } from "./vesti-ads-stored";
import { bigquery } from "../lib/bigquery";
import { vestiSalesView } from "./vesti-sales-view";
import { paidRevenueColumn, paidOrderStatus } from "./metric-rules";
import {
  rankTv,
  summarizeTv,
  tvCycle,
  tvMer,
  tvWindow,
  buildTvRevenueTrend,
} from "./tv-dashboard-metrics";

const activeClients = () =>
  db.select().from(clientsTable).where(and(eq(clientsTable.isActive, true), isNull(clientsTable.archivedAt)));

function transactionalJob(
  client: Awaited<ReturnType<typeof activeClients>>[number],
): string | null {
  if (client.commercePlatform === "UPZERO" && client.upZeroApiKey)
    return "upzero_transactional";
  if (
    client.commercePlatform === "NUVEMSHOP" &&
    client.nuvemshopStoreId &&
    client.nuvemshopAccessToken
  )
    return "nuvemshop_transactional";
  if (
    client.commercePlatform === "BRAAVO" &&
    client.braavoDomain &&
    client.braavoApiToken &&
    client.braavoApiKey
  )
    return "braavo_transactional";
  return null;
}

export async function getTvSyncStatus(now = new Date()): Promise<TvSyncStatus> {
  const cycle = tvCycle(now);
  const clients = await activeClients();
  const jobs = clients.length
    ? await db
        .select({
          clientId: syncJobsTable.clientId,
          jobType: syncJobsTable.jobType,
          status: syncJobsTable.status,
          finishedAt: syncJobsTable.finishedAt,
        })
        .from(syncJobsTable)
        .where(
          and(
            inArray(
              syncJobsTable.clientId,
              clients.map((c) => c.id),
            ),
            gte(syncJobsTable.createdAt, new Date(cycle)),
          ),
        )
        .orderBy(desc(syncJobsTable.createdAt))
    : [];
  let running = 0,
    failed = 0,
    waiting = 0;
  let latest = new Date(cycle).getTime();
  for (const client of clients) {
    const type = transactionalJob(client);
    if (!type) continue;
    const job = jobs.find(
      (j) => j.clientId === client.id && j.jobType === type,
    );
    if (!job) waiting++;
    else if (job.status === "failed") failed++;
    else if (job.status !== "done") running++;
    else if (job.finishedAt)
      latest = Math.max(latest, job.finishedAt.getTime());
  }
  return {
    cycle,
    ready: !running && !failed && !waiting && now.getTime() - latest >= 120_000,
    running,
    failed,
    waiting,
    lastCompletedAt:
      latest > new Date(cycle).getTime()
        ? new Date(latest).toISOString()
        : null,
  };
}

let cached: TvSnapshot | undefined;
let pending: { cycle: string; promise: Promise<TvSnapshot> } | undefined;

async function buildSnapshot(cycle: string, now: Date): Promise<TvSnapshot> {
  const clients = await activeClients();
  const range = tvWindow(now);
  const ids = clients.map((c) => c.id);
  const [orders, creatives] = ids.length
    ? await Promise.all([
        db
          .select({
            clientId: ordersTable.clientId,
            date: sql<string>`to_char(${ordersTable.createdAt} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')`,
            requested: sql<number>`COALESCE(SUM(${ordersTable.amount}), 0)::float`,
            paid: sql<number>`COALESCE(SUM(${paidRevenueColumn(true)}) FILTER (WHERE ${paidOrderStatus()}), 0)::float`,
          })
          .from(ordersTable)
          .where(
            and(
              inArray(ordersTable.clientId, ids),
              gte(ordersTable.createdAt, range.from),
              lte(ordersTable.createdAt, range.to),
            ),
          )
          .groupBy(
            ordersTable.clientId,
            sql`to_char(${ordersTable.createdAt} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')`,
          ),
        db
          .select()
          .from(creativesTable)
          .where(inArray(creativesTable.clientId, ids)),
      ])
    : [[], []];
  const postgresCount = orders.length;
  const vestiClients = clients.filter(c => c.commercePlatform === "VESTI");
  for (let offset = 0; offset < vestiClients.length; offset += 6) {
    const batches = await Promise.all(vestiClients.slice(offset, offset + 6).map(async client => {
      if (!client.bigqueryDataset) throw new Error("Marca Vesti sem dataset configurado.");
      const [daily] = await bigquery.query({query: `SELECT FORMAT_DATE('%Y-%m-%d', data_ref) AS date,
        COALESCE(SUM(valor_solicitado), 0) AS requested,
        COALESCE(SUM(IF(pago, valor_reservado, 0)), 0) AS paid
        FROM ${vestiSalesView(client.bigqueryDataset)}
        WHERE data_ref BETWEEN @dateFrom AND @dateTo GROUP BY date ORDER BY date`,
        params:{dateFrom:range.dateFrom,dateTo:range.dateTo}});
      return daily.map(row => ({clientId:client.id,date:String(row.date),requested:Number(row.requested)||0,paid:Number(row.paid)||0}));
    }));
    for (const batch of batches) orders.push(...batch);
  }
  const vestiIds = new Set(vestiClients.map(c => c.id));
  const effectiveOrders = orders.filter((order, index) => !vestiIds.has(order.clientId) || index >= postgresCount);
  const orderMap = new Map<string, { requested: number; paid: number }>();
  for (const order of effectiveOrders) {
    const total = orderMap.get(order.clientId) ?? { requested: 0, paid: 0 };
    total.requested += Number(order.requested) || 0;
    total.paid += Number(order.paid) || 0;
    orderMap.set(order.clientId, total);
  }
  const rows: TvBrand[] = [];
  // Bound external account requests; no network work happens in the status poll.
  for (let offset = 0; offset < clients.length; offset += 4) {
    rows.push(
      ...(await Promise.all(
        clients.slice(offset, offset + 4).map(async (client) => {
          const order = orderMap.get(client.id);
          const revenue =
            Number(
              client.dashboardType === "B2C" ? order?.paid : order?.requested,
            ) || 0;
          const local = creatives.filter((c) => c.clientId === client.id);
          let investment: number | null = 0;
          let warning: string | null = null;
          if (client.metaAdAccountId) {
            try {
              const dailyAds = await fetchStoredAdsDaily(client.metaAdAccountId, range.dateFrom, range.dateTo);
              if (!dailyAds.length) throw new Error("No stored investment for this period");
              investment = totalSpend(dailyAds);
            } catch {
              investment = null;
              warning = "Investimento de 90 dias indisponível na coleta. Consulte o histórico de anúncios.";
            }
          } else if (local.some(c => c.platform === "META" && c.spend > 0)) {
            investment = null;
            warning = "Conta Meta não configurada para consultar o investimento completo.";
          }
          // Other registered channels are included only when their exact period is known.
          for (const creative of local.filter(
            (c) => c.platform !== "META" && c.spend > 0,
          )) {
            if (
              (creative.activeTo && creative.activeTo < range.dateFrom) ||
              (creative.activeFrom && creative.activeFrom > range.dateTo)
            )
              continue;
            if (
              !creative.activeFrom ||
              !creative.activeTo ||
              creative.activeFrom < range.dateFrom ||
              creative.activeTo > range.dateTo
            ) {
              investment = null;
              warning =
                "Há mídia sem investimento exato disponível para os 90 dias.";
            } else if (investment !== null) investment += creative.spend;
          }
          return {
            id: client.id,
            name: client.name,
            area: client.dashboardType,
            currency: client.currency,
            revenue,
            investment,
            mer: tvMer(revenue, investment),
            warning,
          };
        }),
      )),
    );
  }
  const brands = rankTv(rows);
  return {
    cycle,
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    updatedAt: new Date().toISOString(),
    brands,
    revenueTrend: buildTvRevenueTrend(
      effectiveOrders,
      clients,
      range.dateFrom,
      range.dateTo,
    ),
    total: summarizeTv(brands),
    b2b: summarizeTv(brands.filter((b) => b.area === "B2B")),
    b2c: summarizeTv(brands.filter((b) => b.area === "B2C")),
  };
}

export async function getTvSnapshot(
  now = new Date(),
): Promise<TvSnapshot | null> {
  const status = await getTvSyncStatus(now);
  if (!status.ready && cached) return cached;
  const snapshotCycle = status.ready ? status.cycle : tvCycle(new Date(now.getTime() - 12 * 60 * 60 * 1000));
  if (
    cached?.cycle === status.cycle &&
    (!cached.brands.some((b) => b.warning) ||
      now.getTime() - new Date(cached.updatedAt).getTime() < 30_000)
  )
    return cached;
  if (pending?.cycle === status.cycle) return pending.promise;
  const promise = buildSnapshot(snapshotCycle, now)
    .then((snapshot) => {
      cached = snapshot;
      return snapshot;
    })
    .finally(() => {
      pending = undefined;
    });
  pending = { cycle: status.cycle, promise };
  return promise;
}
