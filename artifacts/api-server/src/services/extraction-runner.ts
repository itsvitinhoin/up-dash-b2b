import { and, desc, eq, isNotNull, type SQL } from "drizzle-orm";
import { db, clientsTable, syncJobsTable } from "@workspace/db";
import { fetchMetaMarketingData, upsertMetaCreatives } from "./meta-ads";
import { getMetricUser, getUpzeroAnalyticsMetrics } from "./upzero/analytics-metrics";
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
  const from = new Date(to.getTime() - 2 * 60 * 60 * 1000);
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
      await completeJob(jobId, {
        clientName: client.name,
        from: from.toISOString(),
        to: to.toISOString(),
        apiTotal: metrics.total,
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
