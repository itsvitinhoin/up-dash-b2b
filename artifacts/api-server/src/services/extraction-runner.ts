import { and, desc, eq, isNotNull, sql, type SQL } from "drizzle-orm";
import { db, clientsTable, customersTable, syncJobsTable } from "@workspace/db";
import { fetchMetaMarketingData, upsertMetaCreatives } from "./meta-ads";
import { getMetricUser, getUpzeroAnalyticsMetrics, type UpzeroAnalyticsMetric } from "./upzero/analytics-metrics";
import { syncUpZeroClient, type SyncResult } from "./upzero-sync";

export type ExtractionJobType =
  | "upzero_transactional"
  | "upzero_analytics"
  | "meta_ads";

export type ExtractionTrigger = "manual" | "cron";

type ExtractionClient = {
  id: string;
  name: string;
  upZeroApiKey: string | null;
  metaAdsApiKey: string | null;
  metaAdAccountId: string | null;
};

type ExtractionRunSummary = {
  jobType: ExtractionJobType | "hourly_bundle";
  trigger: ExtractionTrigger;
  clients: number;
  done: number;
  failed: number;
  skipped: number;
  startedAt: string;
  finishedAt: string;
};

const UPZERO_ANALYTICS_LOOKBACK_HOURS = 24;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function resolveMetaAccessToken(fallback?: string | null): string | null {
  return (
    process.env.META_ADS_API_KEY ??
    process.env.META_ACCESS_TOKEN ??
    process.env.META_API_KEY ??
    process.env.META_TOKEN ??
    fallback ??
    null
  );
}

async function createJob(
  clientId: string,
  jobType: ExtractionJobType,
  trigger: ExtractionTrigger,
) {
  const [job] = await db
    .insert(syncJobsTable)
    .values({
      clientId,
      jobType,
      trigger,
      scope: "client",
      status: "running",
      startedAt: new Date(),
    })
    .returning({ id: syncJobsTable.id });
  return job.id;
}

async function completeJob(jobId: string, result: Record<string, unknown>) {
  await db
    .update(syncJobsTable)
    .set({
      status: "done",
      result,
      error: null,
      finishedAt: new Date(),
    })
    .where(eq(syncJobsTable.id, jobId));
}

async function failJob(jobId: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  await db
    .update(syncJobsTable)
    .set({
      status: "failed",
      error: message,
      finishedAt: new Date(),
    })
    .where(eq(syncJobsTable.id, jobId));
}

async function clientsWith(where: SQL | undefined): Promise<ExtractionClient[]> {
  return db
    .select({
      id: clientsTable.id,
      name: clientsTable.name,
      upZeroApiKey: clientsTable.upZeroApiKey,
      metaAdsApiKey: clientsTable.metaAdsApiKey,
      metaAdAccountId: clientsTable.metaAdAccountId,
    })
    .from(clientsTable)
    .where(where)
    .orderBy(clientsTable.name);
}

function summarizeUpzeroAnalytics(rows: Awaited<ReturnType<typeof getUpzeroAnalyticsMetrics>>["data"]) {
  const eventCounts = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.event_name] = (acc[row.event_name] ?? 0) + (row.total_events ?? 0);
    return acc;
  }, {});

  return {
    totalRows: rows.length,
    totalEvents: rows.reduce((sum, row) => sum + (row.total_events ?? 0), 0),
    rowsWithUser: rows.filter((row) => getMetricUser(row)).length,
    rowsWithOrder: rows.filter((row) => row.order_id).length,
    rowsWithProduct: rows.filter((row) => row.product).length,
    rowsWithValue: rows.filter((row) => (row.total_value ?? 0) > 0).length,
    eventCounts,
  };
}

function buildAnalyticsCustomerName(user: NonNullable<ReturnType<typeof getMetricUser>>): string {
  return user.name?.trim() || user.companyName?.trim() || `UP Zero #${user.id}`;
}

function getAnalyticsDocumentType(
  user: NonNullable<ReturnType<typeof getMetricUser>>,
): "CPF" | "CNPJ" | null {
  if (user.cnpj) return "CNPJ";
  if (user.cpf) return "CPF";
  if (user.type?.toUpperCase() === "WHOLESALE") return "CNPJ";
  if (user.type?.toUpperCase() === "RETAIL") return "CPF";
  return null;
}

async function upsertCustomersFromAnalyticsRegistrations(
  clientId: string,
  rows: UpzeroAnalyticsMetric[],
): Promise<number> {
  const registrationsByUser = new Map<number, UpzeroAnalyticsMetric>();

  for (const row of rows) {
    if (row.event_name !== "register_submitted") continue;
    const user = getMetricUser(row);
    if (!user) continue;

    const current = registrationsByUser.get(user.id);
    if (
      !current ||
      new Date(row.period_start).getTime() < new Date(current.period_start).getTime()
    ) {
      registrationsByUser.set(user.id, row);
    }
  }

  let upserted = 0;

  for (const row of registrationsByUser.values()) {
    const user = getMetricUser(row);
    if (!user) continue;

    const externalId = String(user.id);
    const createdAt = new Date(row.period_start);
    if (Number.isNaN(createdAt.getTime())) continue;

    const email = `upzero-analytics-${externalId}@noemail.internal`;
    const name = buildAnalyticsCustomerName(user);
    const documentType = getAnalyticsDocumentType(user);

    await db
      .insert(customersTable)
      .values({
        clientId,
        externalId,
        email,
        name,
        documentType,
        utmSource: row.utm_source,
        utmMedium: row.utm_medium,
        utmCampaign: row.utm_campaign,
        registrationStatus: "PENDING",
        createdAt,
      })
      .onConflictDoUpdate({
        target: [customersTable.clientId, customersTable.externalId],
        set: {
          name,
          documentType,
          utmSource: sql`COALESCE(${customersTable.utmSource}, EXCLUDED.utm_source)`,
          utmMedium: sql`COALESCE(${customersTable.utmMedium}, EXCLUDED.utm_medium)`,
          utmCampaign: sql`COALESCE(${customersTable.utmCampaign}, EXCLUDED.utm_campaign)`,
          createdAt: sql`LEAST(${customersTable.createdAt}, EXCLUDED.created_at)`,
        },
      });
    upserted += 1;
  }

  return upserted;
}

export async function runUpzeroTransactionalExtraction(
  trigger: ExtractionTrigger,
): Promise<ExtractionRunSummary> {
  const startedAt = new Date();
  const clients = await clientsWith(isNotNull(clientsTable.upZeroApiKey));
  let done = 0;
  let failed = 0;

  for (const client of clients) {
    if (!client.upZeroApiKey) continue;
    const jobId = await createJob(client.id, "upzero_transactional", trigger);
    try {
      const result: SyncResult = await syncUpZeroClient(client.id, client.upZeroApiKey);
      await completeJob(jobId, {
        clientName: client.name,
        ...result,
      });
      done += 1;
    } catch (err) {
      await failJob(jobId, err);
      failed += 1;
    }
  }

  return {
    jobType: "upzero_transactional",
    trigger,
    clients: clients.length,
    done,
    failed,
    skipped: 0,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
  };
}

export async function runUpzeroAnalyticsExtraction(
  trigger: ExtractionTrigger,
): Promise<ExtractionRunSummary> {
  const startedAt = new Date();
  const clients = await clientsWith(isNotNull(clientsTable.upZeroApiKey));
  const to = new Date();
  const from = new Date(to.getTime() - UPZERO_ANALYTICS_LOOKBACK_HOURS * 60 * 60 * 1000);
  let done = 0;
  let failed = 0;

  for (const client of clients) {
    if (!client.upZeroApiKey) continue;
    const jobId = await createJob(client.id, "upzero_analytics", trigger);
    try {
      const metrics = await getUpzeroAnalyticsMetrics({
        from: from.toISOString(),
        to: to.toISOString(),
        apiKey: client.upZeroApiKey,
      });
      const customersMaterialized = await upsertCustomersFromAnalyticsRegistrations(
        client.id,
        metrics.data,
      );
      await completeJob(jobId, {
        clientName: client.name,
        from: from.toISOString(),
        to: to.toISOString(),
        apiTotal: metrics.total,
        customersMaterialized,
        ...summarizeUpzeroAnalytics(metrics.data),
      });
      done += 1;
    } catch (err) {
      await failJob(jobId, err);
      failed += 1;
    }
  }

  return {
    jobType: "upzero_analytics",
    trigger,
    clients: clients.length,
    done,
    failed,
    skipped: 0,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
  };
}

export async function runMetaAdsExtraction(
  trigger: ExtractionTrigger,
): Promise<ExtractionRunSummary> {
  const startedAt = new Date();
  const clients = await clientsWith(isNotNull(clientsTable.metaAdAccountId));
  const untilDate = new Date();
  const sinceDate = new Date(untilDate.getTime() - 2 * 24 * 60 * 60 * 1000);
  const since = isoDate(sinceDate);
  const until = isoDate(untilDate);
  let done = 0;
  let failed = 0;
  let skipped = 0;

  for (const client of clients) {
    if (!client.metaAdAccountId) continue;
    const jobId = await createJob(client.id, "meta_ads", trigger);
    const accessToken = resolveMetaAccessToken(client.metaAdsApiKey);
    if (!accessToken) {
      await failJob(jobId, new Error("META_ADS_API_KEY não configurado."));
      failed += 1;
      continue;
    }

    try {
      const data = await fetchMetaMarketingData({
        accessToken,
        adAccountId: client.metaAdAccountId,
        since,
        until,
      });
      await upsertMetaCreatives(client.id, data.ads);
      await completeJob(jobId, {
        clientName: client.name,
        adAccountId: client.metaAdAccountId,
        since,
        until,
        dailyRows: data.daily.length,
        ads: data.ads.length,
        campaigns: data.campaigns.length,
        spend: data.summary.spend,
        impressions: data.summary.impressions,
        clicks: data.summary.clicks,
        leads: data.summary.leads,
        purchases: data.summary.purchases,
      });
      done += 1;
    } catch (err) {
      await failJob(jobId, err);
      failed += 1;
    }
  }

  return {
    jobType: "meta_ads",
    trigger,
    clients: clients.length,
    done,
    failed,
    skipped,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
  };
}

export async function runHourlyExtractionBundle(
  trigger: ExtractionTrigger,
): Promise<{
  jobType: "hourly_bundle";
  trigger: ExtractionTrigger;
  analytics: ExtractionRunSummary;
  meta: ExtractionRunSummary;
  startedAt: string;
  finishedAt: string;
}> {
  const startedAt = new Date();
  const [analytics, meta] = await Promise.all([
    runUpzeroAnalyticsExtraction(trigger),
    runMetaAdsExtraction(trigger),
  ]);

  return {
    jobType: "hourly_bundle",
    trigger,
    analytics,
    meta,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
  };
}

export async function listExtractionJobs(params: {
  limit: number;
  status?: "pending" | "running" | "done" | "failed";
  jobType?: ExtractionJobType;
  trigger?: ExtractionTrigger;
  clientId?: string;
}) {
  const conditions: SQL[] = [];
  if (params.status) conditions.push(eq(syncJobsTable.status, params.status));
  if (params.jobType) conditions.push(eq(syncJobsTable.jobType, params.jobType));
  if (params.trigger) conditions.push(eq(syncJobsTable.trigger, params.trigger));
  if (params.clientId) conditions.push(eq(syncJobsTable.clientId, params.clientId));

  return db
    .select({
      id: syncJobsTable.id,
      clientId: syncJobsTable.clientId,
      clientName: clientsTable.name,
      jobType: syncJobsTable.jobType,
      trigger: syncJobsTable.trigger,
      scope: syncJobsTable.scope,
      status: syncJobsTable.status,
      result: syncJobsTable.result,
      error: syncJobsTable.error,
      startedAt: syncJobsTable.startedAt,
      finishedAt: syncJobsTable.finishedAt,
      createdAt: syncJobsTable.createdAt,
      updatedAt: syncJobsTable.updatedAt,
    })
    .from(syncJobsTable)
    .innerJoin(clientsTable, eq(syncJobsTable.clientId, clientsTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(syncJobsTable.createdAt))
    .limit(params.limit);
}
