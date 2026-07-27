import { and, desc, eq, isNotNull, sql, type SQL } from "drizzle-orm";
import { db, clientsTable, customersTable, syncJobsTable } from "@workspace/db";
import { fetchMetaMarketingData, upsertMetaCreatives } from "./meta-ads";
import { syncNuvemshopClient } from "./nuvemshop-sync";
import { getMetricUser, getUpzeroAnalyticsMetrics, type UpzeroAnalyticsMetric } from "./upzero/analytics-metrics";
import { documentLast4, hashDocument } from "./upzero/customers";
import { syncUpZeroClient, type SyncResult } from "./upzero-sync";
import { refreshDailyClientMetrics } from "./daily-client-metrics";

export type ExtractionJobType =
  | "upzero_transactional"
  | "upzero_analytics"
  | "meta_ads"
  | "nuvemshop_transactional"
  | "daily_metrics";

export type ExtractionTrigger = "manual" | "cron";

type ExtractionClient = {
  id: string;
  name: string;
  upZeroApiKey: string | null;
  metaAdsApiKey: string | null;
  metaAdAccountId: string | null;
  dashboardType: string | null;
  nuvemshopStoreId: string | null;
  nuvemshopAccessToken: string | null;
};

type ExtractionRunSummary = {
  jobType: ExtractionJobType | "hourly_bundle";
  trigger: ExtractionTrigger;
  clients: number;
  totalClients?: number;
  offset?: number;
  limit?: number;
  lookbackDays?: number;
  skipCatalog?: boolean;
  allowPartial?: boolean;
  clientResults?: Array<{
    clientId: string;
    clientName: string;
    storeId?: string | null;
    status: "done" | "failed";
    error?: string;
    result?: unknown;
  }>;
  done: number;
  failed: number;
  skipped: number;
  startedAt: string;
  finishedAt: string;
};

const UPZERO_ANALYTICS_LOOKBACK_HOURS = 24;
const UPZERO_TRANSACTIONAL_CLIENT_TIMEOUT_MS = Number.parseInt(process.env.UPZERO_TRANSACTIONAL_CLIENT_TIMEOUT_MS ?? "45000", 10);
const DAILY_METRICS_REFRESH_LOOKBACK_DAYS = Number.parseInt(process.env.DAILY_METRICS_REFRESH_LOOKBACK_DAYS ?? "7", 10);
const NUVEMSHOP_LOOKBACK_DAYS = Number.parseInt(process.env.NUVEMSHOP_CRON_LOOKBACK_DAYS ?? "3", 10);
const NUVEMSHOP_MAX_PAGES = Number.parseInt(process.env.NUVEMSHOP_CRON_MAX_PAGES ?? "0", 10);
const NUVEMSHOP_CATALOG_MAX_PAGES = Number.parseInt(process.env.NUVEMSHOP_CATALOG_MAX_PAGES ?? "0", 10);
const UPZERO_BASE_URL = process.env.UPZERO_BASE_URL ?? "https://api.upzero.com.br";

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function refreshRecentDailyMetrics(clientId: string, to = new Date()) {
  const lookbackDays = Number.isFinite(DAILY_METRICS_REFRESH_LOOKBACK_DAYS) && DAILY_METRICS_REFRESH_LOOKBACK_DAYS > 0
    ? DAILY_METRICS_REFRESH_LOOKBACK_DAYS
    : 7;
  const from = new Date(to.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  return refreshDailyClientMetrics({ clientId, from, to });
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

function optionalPositiveInteger(value: number): number | undefined {
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function assertNoSyncErrors(source: string, result: { errors?: string[] }) {
  const errors = result.errors ?? [];
  if (errors.length === 0) return;
  const preview = errors.slice(0, 5).join(" | ");
  throw new Error(`${source} returned ${errors.length} internal sync error(s): ${preview}`);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
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
      dashboardType: clientsTable.dashboardType,
      nuvemshopStoreId: clientsTable.nuvemshopStoreId,
      nuvemshopAccessToken: clientsTable.nuvemshopAccessToken,
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

type UpzeroCustomerDetail = {
  id: string | number;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  customer_type?: string | null;
  approved?: boolean | string | number | null;
  is_approved?: boolean | string | number | null;
  rejected?: boolean | string | number | null;
  is_rejected?: boolean | string | number | null;
  status?: string | null;
  registration_status?: string | null;
  approval_status?: string | null;
  lead_status?: string | null;
  created_at?: string | null;
  registered_at?: string | null;
  registration_date?: string | null;
  lead_created_at?: string | null;
  approved_at?: string | null;
  approval_date?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  retail_profile?: { cpf?: string | null } | null;
  wholesale_profile?: { cnpj?: string | null } | null;
};

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const parsed = cleanString(value);
    if (parsed) return parsed;
  }
  return null;
}

function boolLike(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  const s = cleanString(value)?.toLowerCase();
  if (!s) return null;
  if (["true", "1", "yes", "sim", "approved", "aprovado"].includes(s)) return true;
  if (["false", "0", "no", "nao", "não", "rejected", "recusado"].includes(s)) return false;
  return null;
}

function firstDate(...values: unknown[]): Date | null {
  for (const value of values) {
    const s = cleanString(value);
    if (!s) continue;
    const parsed = new Date(s);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function mapRegistrationStatus(
  customer: UpzeroCustomerDetail | null,
): "PENDING" | "APPROVED" | "REJECTED" | null {
  if (!customer) return null;
  if (boolLike(customer.rejected) === true || boolLike(customer.is_rejected) === true) return "REJECTED";
  if (boolLike(customer.approved) === true || boolLike(customer.is_approved) === true) return "APPROVED";
  const raw = firstString(
    customer.registration_status,
    customer.approval_status,
    customer.lead_status,
    customer.status,
  )?.toLowerCase();
  if (!raw) return null;
  if (["approved", "aprovado", "accepted", "active", "qualified"].some((v) => raw.includes(v))) return "APPROVED";
  if (["rejected", "recusado", "declined", "denied", "canceled", "cancelado"].some((v) => raw.includes(v))) return "REJECTED";
  return "PENDING";
}

function getDetailDocumentType(
  user: NonNullable<ReturnType<typeof getMetricUser>>,
  detail: UpzeroCustomerDetail | null,
): "CPF" | "CNPJ" | null {
  if (detail?.wholesale_profile?.cnpj || user.cnpj) return "CNPJ";
  if (detail?.retail_profile?.cpf || user.cpf) return "CPF";
  const type = (detail?.customer_type ?? user.type)?.toUpperCase();
  if (type === "WHOLESALE") return "CNPJ";
  if (type === "RETAIL") return "CPF";
  return null;
}

function getDetailDocumentValue(
  user: NonNullable<ReturnType<typeof getMetricUser>>,
  detail: UpzeroCustomerDetail | null,
): string | null {
  return detail?.wholesale_profile?.cnpj ?? user.cnpj ?? detail?.retail_profile?.cpf ?? user.cpf ?? null;
}

async function fetchUpzeroCustomerDetail(
  apiKey: string,
  id: number,
): Promise<UpzeroCustomerDetail | null> {
  const response = await fetch(`${UPZERO_BASE_URL}/external/v1/customers/${id}`, {
    headers: {
      "X-API-Key": apiKey.trim().replace(/^Bearer\s+/i, ""),
      Accept: "application/json",
    },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`UP Zero customer ${id} failed: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as UpzeroCustomerDetail;
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
  apiKey: string,
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

    let detail: UpzeroCustomerDetail | null = null;
    try {
      detail = await fetchUpzeroCustomerDetail(apiKey, user.id);
    } catch (err) {
      console.warn(`[upzero-analytics] customer detail ${user.id} failed: ${String(err)}`);
    }

    const externalId = String(detail?.id ?? user.id);
    const createdAt =
      firstDate(
        detail?.lead_created_at,
        detail?.registered_at,
        detail?.registration_date,
        detail?.created_at,
      ) ?? new Date(row.period_start);
    if (Number.isNaN(createdAt.getTime())) continue;

    const email = detail?.email ?? `upzero-analytics-${externalId}@noemail.internal`;
    const name = firstString(detail?.name, user.name, user.companyName) ?? buildAnalyticsCustomerName(user);
    const documentType = getDetailDocumentType(user, detail) ?? getAnalyticsDocumentType(user);
    const documentValue = getDetailDocumentValue(user, detail);
    const documentHash = hashDocument(documentValue);
    const documentLast4Value = documentLast4(documentValue);
    const registrationStatus = mapRegistrationStatus(detail) ?? "PENDING";
    const approvalDate =
      firstDate(detail?.approved_at, detail?.approval_date) ??
      (registrationStatus === "APPROVED" ? createdAt : null);
    const utmSource = firstString(detail?.utm_source, row.utm_source);
    const utmMedium = firstString(detail?.utm_medium, row.utm_medium);
    const utmCampaign = firstString(detail?.utm_campaign, row.utm_campaign);

    await db
      .insert(customersTable)
      .values({
        clientId,
        externalId,
        email,
        name,
        phone: detail?.phone ?? null,
        documentType,
        documentHash,
        documentLast4: documentLast4Value,
        utmSource,
        utmMedium,
        utmCampaign,
        registrationStatus,
        approvalDate,
        createdAt,
      })
      .onConflictDoUpdate({
        target: [customersTable.clientId, customersTable.externalId],
        set: {
          name,
          email: detail?.email ? email : sql`${customersTable.email}`,
          phone: detail?.phone ? detail.phone : sql`${customersTable.phone}`,
          documentType,
          documentHash: documentHash ? documentHash : sql`${customersTable.documentHash}`,
          documentLast4: documentLast4Value ? documentLast4Value : sql`${customersTable.documentLast4}`,
          utmSource: sql`COALESCE(${customersTable.utmSource}, EXCLUDED.utm_source)`,
          utmMedium: sql`COALESCE(${customersTable.utmMedium}, EXCLUDED.utm_medium)`,
          utmCampaign: sql`COALESCE(${customersTable.utmCampaign}, EXCLUDED.utm_campaign)`,
          registrationStatus: detail ? registrationStatus : sql`${customersTable.registrationStatus}`,
          approvalDate: detail ? approvalDate : sql`${customersTable.approvalDate}`,
          createdAt: sql`LEAST(${customersTable.createdAt}, EXCLUDED.created_at)`,
        },
      });
    upserted += 1;
  }

  return upserted;
}

export async function runUpzeroTransactionalExtraction(
  trigger: ExtractionTrigger,
  options: {
    clientId?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<ExtractionRunSummary> {
  const startedAt = new Date();
  const allClients = await clientsWith(isNotNull(clientsTable.upZeroApiKey));
  const filteredClients = options.clientId
    ? allClients.filter((client) => client.id === options.clientId)
    : allClients;
  const offset = Math.max(options.offset ?? 0, 0);
  const limit = optionalPositiveInteger(options.limit ?? 0);
  const clients = limit ? filteredClients.slice(offset, offset + limit) : filteredClients.slice(offset);
  const runClient = async (client: ExtractionClient): Promise<"done" | "failed" | "skipped"> => {
    if (!client.upZeroApiKey) return "skipped";
    const jobId = await createJob(client.id, "upzero_transactional", trigger);
    try {
      const result: SyncResult = await withTimeout(
        syncUpZeroClient(client.id, client.upZeroApiKey),
        UPZERO_TRANSACTIONAL_CLIENT_TIMEOUT_MS,
        `UP Zero transactional sync timed out after ${UPZERO_TRANSACTIONAL_CLIENT_TIMEOUT_MS}ms.`,
      );
      const dailyMetrics = await refreshRecentDailyMetrics(client.id);
      await completeJob(jobId, {
        clientName: client.name,
        dailyMetrics,
        ...result,
      });
      return "done";
    } catch (err) {
      console.error("[upzero-transactional-extraction] client failed", {
        clientId: client.id,
        clientName: client.name,
        error: err instanceof Error ? err.message : String(err),
      });
      await failJob(jobId, err);
      return "failed";
    }
  };

  const clientStatuses = limit || options.clientId
    ? await Promise.all(clients.map(runClient))
    : await Promise.all(clients.map(runClient));
  const done = clientStatuses.filter((status) => status === "done").length;
  const failed = clientStatuses.filter((status) => status === "failed").length;
  const skipped = clientStatuses.filter((status) => status === "skipped").length;

  return {
    jobType: "upzero_transactional",
    trigger,
    clients: clients.length,
    totalClients: filteredClients.length,
    offset,
    limit,
    done,
    failed,
    skipped,
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
        client.upZeroApiKey,
        metrics.data,
      );
      const dailyMetrics = await refreshDailyClientMetrics({ clientId: client.id, from, to });
      await completeJob(jobId, {
        clientName: client.name,
        from: from.toISOString(),
        to: to.toISOString(),
        apiTotal: metrics.total,
        customersMaterialized,
        dailyMetrics,
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

export async function runNuvemshopTransactionalExtraction(
  trigger: ExtractionTrigger,
  options: {
    clientId?: string;
    limit?: number;
    offset?: number;
    lookbackDays?: number;
    skipCatalog?: boolean;
    allowPartial?: boolean;
  } = {},
): Promise<ExtractionRunSummary> {
  const startedAt = new Date();
  const requestedLookbackDays = options.lookbackDays ?? NUVEMSHOP_LOOKBACK_DAYS;
  const lookbackDays = Number.isFinite(requestedLookbackDays) && requestedLookbackDays > 0
    ? Math.min(30, Math.max(1, requestedLookbackDays))
    : 3;
  const maxPages = Number.isFinite(NUVEMSHOP_MAX_PAGES) && NUVEMSHOP_MAX_PAGES > 0
    ? NUVEMSHOP_MAX_PAGES
    : undefined;
  const catalogMaxPages = Number.isFinite(NUVEMSHOP_CATALOG_MAX_PAGES) && NUVEMSHOP_CATALOG_MAX_PAGES > 0
    ? NUVEMSHOP_CATALOG_MAX_PAGES
    : undefined;
  const since = new Date(startedAt.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  const allClients = (await clientsWith(and(
    eq(clientsTable.dashboardType, "B2C"),
    isNotNull(clientsTable.nuvemshopStoreId),
    isNotNull(clientsTable.nuvemshopAccessToken),
  ))).filter((client) => client.nuvemshopStoreId && client.nuvemshopAccessToken);
  const totalClients = allClients.length;
  let clients = options.clientId
    ? allClients.filter((client) => client.id === options.clientId)
    : allClients;
  const offset = Math.max(0, options.offset ?? 0);
  const limit = options.limit && options.limit > 0 ? options.limit : undefined;
  if (!options.clientId && limit) {
    clients = clients.slice(offset, offset + limit);
  }
  let done = 0;
  let failed = 0;
  const clientResults: NonNullable<ExtractionRunSummary["clientResults"]> = [];

  for (const client of clients) {
    if (!client.nuvemshopStoreId || !client.nuvemshopAccessToken) continue;
    const jobId = await createJob(client.id, "nuvemshop_transactional", trigger);
    try {
      const result = await syncNuvemshopClient({
        clientId: client.id,
        storeId: client.nuvemshopStoreId,
        accessToken: client.nuvemshopAccessToken,
        since,
        maxPages: optionalPositiveInteger(NUVEMSHOP_MAX_PAGES),
        catalogMaxPages: optionalPositiveInteger(NUVEMSHOP_CATALOG_MAX_PAGES),
        skipCatalog: options.skipCatalog,
      });
      const dailyMetrics = await refreshDailyClientMetrics({ clientId: client.id, from: since, to: new Date() });
      if (!options.allowPartial) assertNoSyncErrors(`Nuvemshop ${client.name}`, result);
      await completeJob(jobId, {
        clientName: client.name,
        storeId: client.nuvemshopStoreId,
        since: since.toISOString(),
        maxPages: maxPages ?? "all",
        catalogMaxPages: catalogMaxPages ?? "all",
        skipCatalog: Boolean(options.skipCatalog),
        allowPartial: Boolean(options.allowPartial),
        dailyMetrics,
        ...result,
      });
      clientResults.push({
        clientId: client.id,
        clientName: client.name,
        storeId: client.nuvemshopStoreId,
        status: "done",
        result,
      });
      done += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[nuvemshop-extraction] client failed", {
        clientId: client.id,
        clientName: client.name,
        storeId: client.nuvemshopStoreId,
        error: message,
      });
      clientResults.push({
        clientId: client.id,
        clientName: client.name,
        storeId: client.nuvemshopStoreId,
        status: "failed",
        error: message,
      });
      await failJob(jobId, err);
      failed += 1;
    }
  }

  return {
    jobType: "nuvemshop_transactional",
    trigger,
    clients: clients.length,
    totalClients,
    offset: limit ? offset : undefined,
    limit,
    lookbackDays,
    skipCatalog: Boolean(options.skipCatalog),
    allowPartial: Boolean(options.allowPartial),
    clientResults,
    done,
    failed,
    skipped: 0,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
  };
}

export async function runDailyMetricsBackfill(
  trigger: ExtractionTrigger,
  options: {
    clientId?: string;
    dateFrom: string;
    dateTo: string;
  },
): Promise<ExtractionRunSummary> {
  const startedAt = new Date();
  const from = new Date(`${options.dateFrom}T03:00:00.000Z`);
  const toDateCursor = new Date(`${options.dateTo}T00:00:00.000Z`);
  toDateCursor.setUTCDate(toDateCursor.getUTCDate() + 1);
  const to = new Date(`${isoDate(toDateCursor)}T02:59:59.999Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    throw new Error("Invalid daily metrics backfill date range.");
  }

  const allClients = await clientsWith(options.clientId ? eq(clientsTable.id, options.clientId) : undefined);
  let done = 0;
  let failed = 0;

  for (const client of allClients) {
    const jobId = await createJob(client.id, "daily_metrics", trigger);
    try {
      const dailyMetrics = await refreshDailyClientMetrics({ clientId: client.id, from, to });
      await completeJob(jobId, {
        clientName: client.name,
        dateFrom: options.dateFrom,
        dateTo: options.dateTo,
        dailyMetrics,
      });
      done += 1;
    } catch (err) {
      await failJob(jobId, err);
      failed += 1;
    }
  }

  return {
    jobType: "daily_metrics",
    trigger,
    clients: allClients.length,
    done,
    failed,
    skipped: 0,
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
