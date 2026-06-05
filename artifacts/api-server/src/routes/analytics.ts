import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gte, lte, sql, ilike, or, inArray, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  db,
  ordersTable,
  customersTable,
  productsTable,
  sellersTable,
  eventsTable,
  orderItemsTable,
  clientsTable,
  creativesTable,
  siteVisitsTable,
  campaignAttributionStampsTable,
} from "@workspace/db";
import {
  GetDashboardQueryParams,
  GetDashboardResponse,
  GetFunnelQueryParams,
  GetFunnelResponse,
  GetCustomersQueryParams,
  GetCustomersResponse,
  GetProductsQueryParams,
  GetProductsResponse,
  GetSellersQueryParams,
  GetSellersResponse,
  GetGeographyQueryParams,
  GetGeographyResponse,
  GetOrdersByDateQueryParams,
  GetOrdersByDateResponse,
  GetInsightQueryParams,
  GetInsightResponse,
  GetAlertsQueryParams,
  GetAlertsResponse,
  GetAdminOverviewQueryParams,
  GetAdminOverviewResponse,
  GetMarketingQueryParams,
  GetMarketingResponse,
  GetCustomerSummaryQueryParams,
  GetCustomerSummaryResponse,
  GetCustomerDetailQueryParams,
  GetCustomerDetailParams,
  GetCustomerDetailResponse,
  GetProductDetailQueryParams,
  GetProductCustomersQueryParams,
  GetProductsSummaryQueryParams,
  GetSellerDetailQueryParams,
  GetSellerCustomersQueryParams,
  GetSellerOrdersQueryParams,
  GetSellerDetailResponse,
  GetSellerCustomersResponse,
  GetSellerOrdersResponse,
  GetStockQueryParams,
  GetStockResponse,
  GetJourneyQueryParams,
  GetJourneyResponse,
  GetRfmQueryParams,
  GetRfmResponse,
  GetUtmQueryParams,
  GetUtmResponse,
} from "@workspace/api-zod";
import { authenticate, requireAdmin, resolveClientId } from "../middlewares/auth";
import { getOpenAIClient, isAIConfigured } from "../lib/openai";
import { fetchMetaMarketingData, upsertMetaCreatives, type MetaAdMetric, type MetaMarketingData } from "../services/meta-ads";
import { fetchGa4DailyMetrics, fetchGa4FunnelMetrics, type Ga4DailyMetrics, type Ga4FunnelMetrics, type Ga4Source } from "../services/ga4";
import {
  buildCustomerTimelineResponse,
  getMetricUser,
  getUpzeroAnalyticsMetrics,
  type UpzeroAnalyticsMetric,
} from "../services/upzero/analytics-metrics";
import { getUpzeroAnalyticsFactsAsMetrics } from "../services/upzero/analytics-facts";
import { ensureUpzeroCustomersByIds } from "../services/upzero/customers";

const router: IRouter = Router();

router.use("/analytics", authenticate);

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function addDaysToDateOnly(value: string, days: number): string {
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function saoPauloDateOnlyStart(value: string): Date {
  return new Date(`${value}T03:00:00.000Z`);
}

function saoPauloDateOnlyEnd(value: string): Date {
  return new Date(`${addDaysToDateOnly(value, 1)}T02:59:59.999Z`);
}

function saoPauloDateOnly(value: Date): string {
  return new Date(value.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function queryDateOnly(
  query: Record<string, unknown>,
  key: "dateFrom" | "dateTo",
  fallback: Date,
): string {
  const raw = typeof query[key] === "string" ? query[key] : null;
  return raw && DATE_ONLY_RE.test(raw) ? raw : saoPauloDateOnly(fallback);
}

function utcDateOnlyStart(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function utcDateOnlyEnd(value: string): Date {
  return new Date(`${value}T23:59:59.999Z`);
}

function customerDateQueryRange(
  query: Record<string, unknown>,
  dateFrom: Date | undefined,
  dateTo: Date | undefined,
): { from: Date | undefined; to: Date | undefined } {
  const rawFrom = typeof query.dateFrom === "string" ? query.dateFrom : null;
  const rawTo = typeof query.dateTo === "string" ? query.dateTo : null;

  return {
    from: rawFrom && DATE_ONLY_RE.test(rawFrom) ? utcDateOnlyStart(rawFrom) : dateFrom,
    to: rawTo && DATE_ONLY_RE.test(rawTo) ? utcDateOnlyEnd(rawTo) : dateTo,
  };
}

function getGlobalMetaAccessToken(fallback?: string | null): string | null {
  return (
    process.env.META_ADS_API_KEY ??
    process.env.META_ACCESS_TOKEN ??
    process.env.META_API_KEY ??
    process.env.META_TOKEN ??
    fallback ??
    null
  );
}

// Orval generates `zod.date()` for date-time format params, but query strings
// arrive as strings. Coerce the relevant query fields before validation.
function coerceDateQuery(query: Record<string, unknown>): Record<string, unknown> {
  const out = { ...query };
  for (const key of ["dateFrom", "dateTo", "date"]) {
    const v = out[key];
    if (typeof v === "string" && v.length > 0) {
      if (DATE_ONLY_RE.test(v)) {
        out[key] = key === "dateTo" ? saoPauloDateOnlyEnd(v) : saoPauloDateOnlyStart(v);
        continue;
      }
      const parsed = new Date(v);
      if (!Number.isNaN(parsed.getTime())) {
        out[key] = parsed;
      }
    }
  }
  return out;
}

function dateRange(
  from: Date | undefined,
  to: Date | undefined,
): { from: Date; to: Date } {
  const now = new Date();
  const defaultTo = to ?? now;
  const defaultFrom =
    from ?? new Date(defaultTo.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from: defaultFrom, to: defaultTo };
}

function upzeroIsoRange(
  query: Record<string, unknown>,
  from: Date,
  to: Date,
): { from: string; to: string } {
  const rawFrom = typeof query.dateFrom === "string" ? query.dateFrom : null;
  const rawTo = typeof query.dateTo === "string" ? query.dateTo : null;
  return {
    from: rawFrom && DATE_ONLY_RE.test(rawFrom) ? `${rawFrom}T03:00:00Z` : from.toISOString(),
    to: rawTo && DATE_ONLY_RE.test(rawTo)
      ? `${addDaysToDateOnly(rawTo, 1)}T02:59:59Z`
      : to.toISOString(),
  };
}

function upzeroAttributionHistoryRange(
  query: Record<string, unknown>,
  from: Date,
  to: Date,
): { from: string; to: string } {
  const periodRange = upzeroIsoRange(query, from, to);
  const configuredFrom = process.env.UPZERO_ATTRIBUTION_HISTORY_FROM;
  const parsedConfiguredFrom = configuredFrom ? new Date(configuredFrom) : null;
  const historyFrom =
    parsedConfiguredFrom && Number.isFinite(parsedConfiguredFrom.getTime())
      ? parsedConfiguredFrom.toISOString()
      : "2026-05-01T03:00:00.000Z";

  return {
    from: historyFrom,
    to: periodRange.to,
  };
}

const UPZERO_ANALYTICS_CHUNK_MS = 12 * 60 * 60 * 1000;
const UPZERO_ANALYTICS_MIN_SPLIT_MS = 60 * 60 * 1000;
const UPZERO_ANALYTICS_PAGE_CAP = 500;
const UPZERO_ANALYTICS_CONCURRENCY = 4;
const PRODUCT_VIEW_EVENT_NAMES = new Set(["product_view", "product_item_impression"]);

function metricDedupeKey(row: UpzeroAnalyticsMetric): string {
  return [
    row.id,
    row.period_start,
    row.period_type,
    row.event_name,
    row.user?.id ?? row.user_id ?? "",
    row.product?.id ?? "",
    row.category?.id ?? "",
    row.order_id ?? "",
    row.utm_source ?? "",
    row.utm_medium ?? "",
    row.utm_campaign ?? "",
  ].join("|");
}

async function getUpzeroAnalyticsMetricsChunked(params: {
  from: string;
  to: string;
  apiKey?: string | null;
}): Promise<UpzeroAnalyticsMetric[]> {
  const fromMs = new Date(params.from).getTime();
  const toMs = new Date(params.to).getTime();
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) {
    return [];
  }

  async function fetchWindow(startMs: number, endMs: number): Promise<UpzeroAnalyticsMetric[]> {
    const response = await getUpzeroAnalyticsMetrics({
      from: new Date(startMs).toISOString(),
      to: new Date(endMs).toISOString(),
      apiKey: params.apiKey,
    });

    const duration = endMs - startMs;
    if (response.data.length >= UPZERO_ANALYTICS_PAGE_CAP && duration > UPZERO_ANALYTICS_MIN_SPLIT_MS) {
      const midMs = startMs + Math.floor(duration / 2);
      const [left, right] = await Promise.all([
        fetchWindow(startMs, midMs),
        fetchWindow(midMs, endMs),
      ]);
      return [...left, ...right];
    }

    return response.data;
  }

  const windows: Array<[number, number]> = [];
  for (let cursor = fromMs; cursor < toMs;) {
    const endMs = Math.min(cursor + UPZERO_ANALYTICS_CHUNK_MS, toMs);
    windows.push([cursor, endMs]);
    if (endMs >= toMs) break;
    cursor = endMs;
  }

  const chunks: UpzeroAnalyticsMetric[][] = [];
  for (let i = 0; i < windows.length; i += UPZERO_ANALYTICS_CONCURRENCY) {
    const batch = windows.slice(i, i + UPZERO_ANALYTICS_CONCURRENCY);
    chunks.push(...await Promise.all(batch.map(([startMs, endMs]) => fetchWindow(startMs, endMs))));
  }
  const deduped = new Map<string, UpzeroAnalyticsMetric>();
  for (const row of chunks.flat()) {
    deduped.set(metricDedupeKey(row), row);
  }
  return [...deduped.values()];
}

async function getUpzeroAnalyticsFactsChunked(params: {
  from: string;
  to: string;
  apiKey?: string | null;
}): Promise<UpzeroAnalyticsMetric[]> {
  const fromMs = new Date(params.from).getTime();
  const toMs = new Date(params.to).getTime();
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) {
    return [];
  }

  const windows: Array<[number, number]> = [];
  for (let cursor = fromMs; cursor < toMs;) {
    const endMs = Math.min(cursor + UPZERO_ANALYTICS_CHUNK_MS, toMs);
    windows.push([cursor, endMs]);
    if (endMs >= toMs) break;
    cursor = endMs;
  }

  const chunks: UpzeroAnalyticsMetric[][] = [];
  for (let i = 0; i < windows.length; i += UPZERO_ANALYTICS_CONCURRENCY) {
    const batch = windows.slice(i, i + UPZERO_ANALYTICS_CONCURRENCY);
    chunks.push(...await Promise.all(batch.map(([startMs, endMs]) =>
      getUpzeroAnalyticsFactsAsMetrics({
        from: new Date(startMs).toISOString(),
        to: new Date(endMs).toISOString(),
        apiKey: params.apiKey,
      }),
    )));
  }

  const deduped = new Map<string, UpzeroAnalyticsMetric>();
  for (const row of chunks.flat()) {
    deduped.set(row.event_id ?? metricDedupeKey(row), row);
  }
  return bridgeAnonymousRowsToIdentifiedUsers([...deduped.values()]);
}

async function getUpzeroTrackingRowsChunked(params: {
  from: string;
  to: string;
  apiKey?: string | null;
  context?: string;
}): Promise<{ rows: UpzeroAnalyticsMetric[]; source: "facts" | "metrics" }> {
  try {
    const rows = await getUpzeroAnalyticsFactsChunked(params);
    return { rows, source: "facts" };
  } catch (err) {
    console.warn(
      `[upzero:${params.context ?? "analytics"}] analytics facts unavailable; falling back to metrics:`,
      err instanceof Error ? err.message : err,
    );
    return {
      rows: await getUpzeroAnalyticsMetricsChunked(params),
      source: "metrics",
    };
  }
}

async function getUpzeroTrackingRows(params: {
  from: string;
  to: string;
  apiKey?: string | null;
  context?: string;
}): Promise<{ rows: UpzeroAnalyticsMetric[]; source: "facts" | "metrics" }> {
  try {
    const rows = bridgeAnonymousRowsToIdentifiedUsers(await getUpzeroAnalyticsFactsAsMetrics(params));
    return { rows, source: "facts" };
  } catch (err) {
    console.warn(
      `[upzero:${params.context ?? "analytics"}] analytics facts unavailable; falling back to metrics:`,
      err instanceof Error ? err.message : err,
    );
    const metrics = await getUpzeroAnalyticsMetrics(params);
    return { rows: metrics.data, source: "metrics" };
  }
}

function bridgeKeysForRow(row: UpzeroAnalyticsMetric): string[] {
  return [
    row.session_id ? `session:${row.session_id}` : null,
    row.visitor_id ? `visitor:${row.visitor_id}` : null,
    row.anonymous_id ? `anonymous:${row.anonymous_id}` : null,
  ].filter((value): value is string => Boolean(value));
}

function bridgeAnonymousRowsToIdentifiedUsers(rows: UpzeroAnalyticsMetric[]): UpzeroAnalyticsMetric[] {
  const keyToUsers = new Map<string, Set<number>>();

  for (const row of rows) {
    const user = getMetricUser(row);
    if (!user) continue;
    for (const key of bridgeKeysForRow(row)) {
      const users = keyToUsers.get(key) ?? new Set<number>();
      users.add(user.id);
      keyToUsers.set(key, users);
    }
  }

  if (keyToUsers.size === 0) return rows;

  let promoted = 0;
  const bridged = rows.map((row) => {
    if (getMetricUser(row)) return row;
    const candidateUsers = new Set<number>();
    for (const key of bridgeKeysForRow(row)) {
      const users = keyToUsers.get(key);
      if (!users) continue;
      for (const userId of users) candidateUsers.add(userId);
    }
    if (candidateUsers.size !== 1) return row;
    promoted += 1;
    const [userId] = [...candidateUsers];
    return {
      ...row,
      user_id: userId,
    };
  });

  if (promoted > 0) {
    console.log({
      upzeroIdentityBridgePromotedRows: promoted,
      upzeroIdentityBridgeKeys: keyToUsers.size,
    });
  }

  return bridged;
}

async function enrichRowsWithProductImages(
  rows: UpzeroAnalyticsMetric[],
  clientId: string,
): Promise<UpzeroAnalyticsMetric[]> {
  const externalIds = Array.from(new Set(rows.map((row) => row.product?.id).filter((id): id is number => typeof id === "number").map(String)));
  const skus = Array.from(new Set(rows.map((row) => row.product?.sku).filter((sku): sku is string => Boolean(sku))));
  if (externalIds.length === 0 && skus.length === 0) return rows;

  const filters: SQL[] = [];
  if (externalIds.length > 0) filters.push(inArray(productsTable.externalId, externalIds));
  if (skus.length > 0) filters.push(inArray(productsTable.sku, skus));

  const products = await db
    .select({
      externalId: productsTable.externalId,
      sku: productsTable.sku,
      name: productsTable.name,
      imageUrl: productsTable.imageUrl,
    })
    .from(productsTable)
    .where(and(eq(productsTable.clientId, clientId), or(...filters)));

  const byExternalId = new Map(products.map((product) => [product.externalId, product] as const));
  const bySku = new Map(products.map((product) => [product.sku, product] as const));

  return rows.map((row) => {
    const matchedProduct =
      (row.product?.id !== undefined ? byExternalId.get(String(row.product.id)) : null) ??
      (row.product?.sku ? bySku.get(row.product.sku) : null) ??
      null;
    const productImageUrl =
      matchedProduct?.imageUrl ??
      row.product_image_url ??
      null;
    const matchedExternalId = Number.parseInt(matchedProduct?.externalId ?? "", 10);
    const product = row.product ?? (matchedProduct && Number.isFinite(matchedExternalId)
      ? {
          id: matchedExternalId,
          name: matchedProduct.name,
          sku: matchedProduct.sku,
        }
      : null);
    return matchedProduct || productImageUrl ? { ...row, product, product_image_url: productImageUrl } : row;
  });
}

function requireClient(
  req: import("express").Request,
  res: import("express").Response,
): string | null {
  const clientId = resolveClientId(req);
  if (!clientId) {
    res.status(400).json({
      error: true,
      code: "CLIENT_REQUIRED",
      message: "clientId query parameter is required for admin users",
      status: 400,
    });
    return null;
  }
  return clientId;
}

type DashboardKpis = {
  revenue: number;
  orders: number;
  avgTicket: number;
  conversionRate: number;
  approvalRate: number;
  leads: number;
  approvedLeads: number;
  customers: number;
  repeatCustomers: number;
  requestedRevenue: number;
  newBuyers: number;
  returningBuyers: number;
  retentionPct: number;
};

type DashboardTraffic = {
  sessions: number;
  orders: number;
  source: Ga4Source;
};

type DashboardDailyPerformance = {
  date: string;
  revenue: number;
  orders: number;
  sessions: number;
  conversionRate: number;
};

type DashboardSignal = {
  type: "high_traffic_low_sales" | "high_performing_regions";
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
  meta?: Record<string, unknown>;
};

const ZERO_KPIS: DashboardKpis = {
  revenue: 0,
  orders: 0,
  avgTicket: 0,
  conversionRate: 0,
  approvalRate: 0,
  leads: 0,
  approvedLeads: 0,
  customers: 0,
  repeatCustomers: 0,
  requestedRevenue: 0,
  newBuyers: 0,
  returningBuyers: 0,
  retentionPct: 0,
};

function dateOnlyRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const [fromYear, fromMonth, fromDay] = from.split("-").map((part) => Number.parseInt(part, 10));
  const [toYear, toMonth, toDay] = to.split("-").map((part) => Number.parseInt(part, 10));
  const cursor = new Date(Date.UTC(fromYear, fromMonth - 1, fromDay));
  const end = new Date(Date.UTC(toYear, toMonth - 1, toDay));
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function buildDailyPerformance(params: {
  dateFrom: string;
  dateTo: string;
  dailyRevenue: { date: string; value: number }[];
  dailyOrders: { date: string; value: number }[];
  ga4Daily: Ga4DailyMetrics[] | null;
}): DashboardDailyPerformance[] {
  const revenueByDate = new Map(params.dailyRevenue.map((row) => [row.date, Number(row.value) || 0]));
  const ordersByDate = new Map(params.dailyOrders.map((row) => [row.date, Number(row.value) || 0]));
  const sessionsByDate = new Map((params.ga4Daily ?? []).map((row) => [row.date, Number(row.sessions) || 0]));
  return dateOnlyRange(params.dateFrom, params.dateTo).map((date) => {
    const revenue = revenueByDate.get(date) ?? 0;
    const orders = ordersByDate.get(date) ?? 0;
    const sessions = sessionsByDate.get(date) ?? 0;
    return {
      date,
      revenue,
      orders,
      sessions,
      conversionRate: sessions > 0 ? (orders / sessions) * 100 : 0,
    };
  });
}

// ───────── Admin: platform-wide overview across every client ─────────
//
// Aggregates revenue, orders, customers, and active-client count across the
// entire tenant base for the requested window, plus daily time-series and
// per-client growth ranking. Restricted to ADMIN — CLIENT users get 403 from
// `requireAdmin` before any DB work happens.
router.get(
  "/analytics/admin/overview",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = GetAdminOverviewQueryParams.safeParse(
      coerceDateQuery(req.query as Record<string, unknown>),
    );
    if (!parsed.success) {
      res.status(400).json({
        error: true,
        code: "VALIDATION_ERROR",
        message: parsed.error.message,
        status: 400,
      });
      return;
    }
    const { from, to } = dateRange(parsed.data.dateFrom, parsed.data.dateTo);
    const lengthMs = to.getTime() - from.getTime();
    const prevTo = new Date(from.getTime() - 1);
    const prevFrom = new Date(prevTo.getTime() - lengthMs);

    // Every client on the platform (active or inactive). Intentionally
    // unbounded so KPIs and rankings reflect the whole tenant base — this
    // endpoint is the single source of truth for "platform totals". If the
    // tenant base ever grows past a few thousand brands we'll need to split
    // the per-client `clientStats` payload from the headline KPIs and stream
    // it separately, but at that scale this whole endpoint warrants a
    // rethink anyway.
    const clients = await db
      .select({
        id: clientsTable.id,
        name: clientsTable.name,
        currency: clientsTable.currency,
        locale: clientsTable.locale,
      })
      .from(clientsTable)
      .orderBy(clientsTable.name);

    const totalClients = clients.length;
    const requestedClientIds =
      parsed.data.clientIds !== undefined
        ? new Set(
            parsed.data.clientIds
              .split(",")
              .map((id) => id.trim())
              .filter(Boolean),
          )
        : null;
    const selectedClients = requestedClientIds
      ? clients.filter((client) => requestedClientIds.has(client.id))
      : clients;
    const selectedClientIds = selectedClients.map((client) => client.id);

    if (selectedClientIds.length === 0) {
      const emptyKpis = {
        revenue: 0,
        orders: 0,
        customers: 0,
        avgOrderValue: 0,
        activeClients: 0,
        totalClients,
        adSpend: 0,
        roas: 0,
        totalLeads: 0,
        approvedLeads: 0,
      };
      res.json(
        GetAdminOverviewResponse.parse({
          kpis: emptyKpis,
          prevKpis: emptyKpis,
          revenueOverTime: [],
          ordersOverTime: [],
          leadsOverTime: [],
          prevRevenueOverTime: [],
          prevOrdersOverTime: [],
          prevLeadsOverTime: [],
          clientStats: [],
          topPerformers: [],
          topGrowth: [],
          bottomGrowth: [],
        }),
      );
      return;
    }

    // Window-scoped order aggregates grouped by client. Only counts revenue-
    // bearing orders to match the per-brand dashboard semantics.
    const fetchOrderAggByClient = (winFrom: Date, winTo: Date) =>
      db
        .select({
          clientId: ordersTable.clientId,
          revenue: sql<number>`COALESCE(SUM(${ordersTable.amount}), 0)::float`,
          orders: sql<number>`COUNT(*)::int`,
        })
        .from(ordersTable)
        .where(
          and(
            gte(ordersTable.createdAt, winFrom),
            lte(ordersTable.createdAt, winTo),
            inArray(ordersTable.clientId, selectedClientIds),
            sql`${ordersTable.status} IN ('APPROVED', 'SHIPPED', 'DELIVERED')`,
          ),
        )
        .groupBy(ordersTable.clientId);

    const [currByClient, prevByClient] = await Promise.all([
      fetchOrderAggByClient(from, to),
      fetchOrderAggByClient(prevFrom, prevTo),
    ]);

    const currMap = new Map<string, { revenue: number; orders: number }>();
    for (const r of currByClient) {
      currMap.set(r.clientId, {
        revenue: Number(r.revenue) || 0,
        orders: Number(r.orders) || 0,
      });
    }
    const prevMap = new Map<string, { revenue: number; orders: number }>();
    for (const r of prevByClient) {
      prevMap.set(r.clientId, {
        revenue: Number(r.revenue) || 0,
        orders: Number(r.orders) || 0,
      });
    }

    // Daily series — summed across every tenant. We do NOT group by client
    // here; the goal is platform-wide totals per day.
    const dailySeries = (winFrom: Date, winTo: Date) =>
      db
        .select({
          date: sql<string>`to_char(date_trunc('day', ${ordersTable.createdAt}), 'YYYY-MM-DD')`,
          revenue: sql<number>`COALESCE(SUM(${ordersTable.amount}), 0)::float`,
          orders: sql<number>`COUNT(*)::int`,
        })
        .from(ordersTable)
        .where(
          and(
            gte(ordersTable.createdAt, winFrom),
            lte(ordersTable.createdAt, winTo),
            inArray(ordersTable.clientId, selectedClientIds),
            sql`${ordersTable.status} IN ('APPROVED', 'SHIPPED', 'DELIVERED')`,
          ),
        )
        .groupBy(sql`date_trunc('day', ${ordersTable.createdAt})`)
        .orderBy(sql`date_trunc('day', ${ordersTable.createdAt})`);

    const [currDaily, prevDaily] = await Promise.all([
      dailySeries(from, to),
      dailySeries(prevFrom, prevTo),
    ]);

    // Distinct customers across every client in the window. We treat any
    // customer with at least one revenue-bearing order in the window as
    // "active" platform-wide, mirroring the per-brand dashboard.
    const customerCount = async (winFrom: Date, winTo: Date) => {
      const [row] = await db
        .select({
          count: sql<number>`COUNT(DISTINCT ${ordersTable.customerId})::int`,
        })
        .from(ordersTable)
        .where(
          and(
            gte(ordersTable.createdAt, winFrom),
            lte(ordersTable.createdAt, winTo),
            inArray(ordersTable.clientId, selectedClientIds),
            sql`${ordersTable.status} IN ('APPROVED', 'SHIPPED', 'DELIVERED')`,
          ),
        );
      return Number(row?.count) || 0;
    };
    const [currCustomers, prevCustomers] = await Promise.all([
      customerCount(from, to),
      customerCount(prevFrom, prevTo),
    ]);

    // Platform-wide marketing KPIs: prorated ad spend + leads from creatives.
    const prorateCreatives = async (winFrom: Date, winTo: Date) => {
      const rows = await db
        .select({
          spend: creativesTable.spend,
          leads: creativesTable.leads,
          approvedLeads: creativesTable.approvedLeads,
          activeFrom: creativesTable.activeFrom,
          activeTo: creativesTable.activeTo,
        })
        .from(creativesTable)
        .where(
          and(
            inArray(creativesTable.clientId, selectedClientIds),
            or(
              sql`${creativesTable.activeFrom} IS NULL`,
              sql`${creativesTable.activeFrom} <= ${winTo.toISOString().slice(0, 10)}`,
            ),
            or(
              sql`${creativesTable.activeTo} IS NULL`,
              sql`${creativesTable.activeTo} >= ${winFrom.toISOString().slice(0, 10)}`,
            ),
          ),
        );
      let adSpend = 0;
      let totalLeads = 0;
      let approvedLeads = 0;
      for (const c of rows) {
        let frac = 1;
        if (c.activeFrom && c.activeTo) {
          const cFrom = new Date(c.activeFrom as string);
          const cTo = new Date(c.activeTo as string);
          const campaignMs = Math.max(1, cTo.getTime() - cFrom.getTime());
          const overlapMs = Math.max(
            0,
            Math.min(winTo.getTime(), cTo.getTime()) - Math.max(winFrom.getTime(), cFrom.getTime()),
          );
          frac = overlapMs / campaignMs;
        }
        adSpend += c.spend * frac;
        totalLeads += Math.round(c.leads * frac);
        approvedLeads += Math.round(c.approvedLeads * frac);
      }
      return { adSpend, totalLeads, approvedLeads };
    };

    const platformLeadsSeries = (winFrom: Date, winTo: Date) =>
      db
        .select({
          date: sql<string>`to_char(date_trunc('day', ${eventsTable.createdAt}), 'YYYY-MM-DD')`,
          value: sql<number>`COUNT(*)::float`,
        })
        .from(eventsTable)
        .where(
          and(
            eq(eventsTable.eventType, "REGISTRATION"),
            gte(eventsTable.createdAt, winFrom),
            lte(eventsTable.createdAt, winTo),
            inArray(eventsTable.clientId, selectedClientIds),
          ),
        )
        .groupBy(sql`date_trunc('day', ${eventsTable.createdAt})`)
        .orderBy(sql`date_trunc('day', ${eventsTable.createdAt})`);

    const [currMarketing, prevMarketing, currLeadsDaily, prevLeadsDaily] = await Promise.all([
      prorateCreatives(from, to),
      prorateCreatives(prevFrom, prevTo),
      platformLeadsSeries(from, to),
      platformLeadsSeries(prevFrom, prevTo),
    ]);

    const sumRevenue = (m: Map<string, { revenue: number }>) =>
      [...m.values()].reduce((s, v) => s + v.revenue, 0);
    const sumOrders = (m: Map<string, { orders: number }>) =>
      [...m.values()].reduce((s, v) => s + v.orders, 0);

    // Clients are "active" if they had either revenue-bearing orders OR any
    // marketing activity (ad spend > 0) in the window.
    const clientsWithAdSpend = async (winFrom: Date, winTo: Date): Promise<Set<string>> => {
      const rows = await db
        .selectDistinct({ clientId: creativesTable.clientId })
        .from(creativesTable)
        .where(
          and(
            sql`${creativesTable.spend} > 0`,
            inArray(creativesTable.clientId, selectedClientIds),
            or(
              sql`${creativesTable.activeFrom} IS NULL`,
              sql`${creativesTable.activeFrom} <= ${winTo.toISOString().slice(0, 10)}`,
            ),
            or(
              sql`${creativesTable.activeTo} IS NULL`,
              sql`${creativesTable.activeTo} >= ${winFrom.toISOString().slice(0, 10)}`,
            ),
          ),
        );
      return new Set(rows.map((r) => r.clientId));
    };

    const [currAdClients, prevAdClients] = await Promise.all([
      clientsWithAdSpend(from, to),
      clientsWithAdSpend(prevFrom, prevTo),
    ]);

    const currRevenue = sumRevenue(currMap);
    const currOrders = sumOrders(currMap);
    const prevRevenue = sumRevenue(prevMap);
    const prevOrders = sumOrders(prevMap);
    const currActive = new Set([
      ...[...currMap.entries()].filter(([, v]) => v.orders > 0).map(([k]) => k),
      ...currAdClients,
    ]).size;
    const prevActive = new Set([
      ...[...prevMap.entries()].filter(([, v]) => v.orders > 0).map(([k]) => k),
      ...prevAdClients,
    ]).size;

    const kpis = {
      revenue: currRevenue,
      orders: currOrders,
      customers: currCustomers,
      avgOrderValue: currOrders > 0 ? currRevenue / currOrders : 0,
      activeClients: currActive,
      totalClients,
      adSpend: currMarketing.adSpend,
      roas: currMarketing.adSpend > 0 ? currRevenue / currMarketing.adSpend : 0,
      totalLeads: currMarketing.totalLeads,
      approvedLeads: currMarketing.approvedLeads,
    };
    const prevKpis = {
      revenue: prevRevenue,
      orders: prevOrders,
      customers: prevCustomers,
      avgOrderValue: prevOrders > 0 ? prevRevenue / prevOrders : 0,
      activeClients: prevActive,
      totalClients,
      adSpend: prevMarketing.adSpend,
      roas: prevMarketing.adSpend > 0 ? prevRevenue / prevMarketing.adSpend : 0,
      totalLeads: prevMarketing.totalLeads,
      approvedLeads: prevMarketing.approvedLeads,
    };

    // Per-client stats — every registered client appears in `clientStats`,
    // even brands with no activity, so the UI can show "0 / —".
    const clientStats = selectedClients.map((c) => {
      const cur = currMap.get(c.id) ?? { revenue: 0, orders: 0 };
      const prv = prevMap.get(c.id) ?? { revenue: 0, orders: 0 };
      let growthPct: number | null;
      if (prv.revenue > 0) {
        growthPct = ((cur.revenue - prv.revenue) / prv.revenue) * 100;
      } else if (cur.revenue > 0) {
        growthPct = 100;
      } else {
        growthPct = null;
      }
      return {
        id: c.id,
        name: c.name,
        currency: c.currency,
        locale: c.locale,
        revenue: cur.revenue,
        orders: cur.orders,
        prevRevenue: prv.revenue,
        growthPct,
      };
    });

    const topPerformers = [...clientStats]
      .filter((s) => s.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    // Growth rankings only consider clients with a real prior baseline so
    // brand new clients with no prior period don't dominate the leaderboard
    // at +100%/-0%.
    const rankable = clientStats.filter(
      (s) => s.growthPct !== null && s.prevRevenue > 0,
    );
    const topGrowth = [...rankable]
      .sort((a, b) => (b.growthPct ?? 0) - (a.growthPct ?? 0))
      .slice(0, 5);
    const bottomGrowth = [...rankable]
      .sort((a, b) => (a.growthPct ?? 0) - (b.growthPct ?? 0))
      .slice(0, 5);

    res.json(
      GetAdminOverviewResponse.parse({
        kpis,
        prevKpis,
        revenueOverTime: currDaily.map((r) => ({ date: r.date, value: Number(r.revenue) || 0 })),
        ordersOverTime: currDaily.map((r) => ({ date: r.date, value: Number(r.orders) || 0 })),
        leadsOverTime: currLeadsDaily,
        prevRevenueOverTime: prevDaily.map((r) => ({ date: r.date, value: Number(r.revenue) || 0 })),
        prevOrdersOverTime: prevDaily.map((r) => ({ date: r.date, value: Number(r.orders) || 0 })),
        prevLeadsOverTime: prevLeadsDaily,
        clientStats,
        topPerformers,
        topGrowth,
        bottomGrowth,
      }),
    );
  },
);

router.get("/analytics/dashboard", async (req, res): Promise<void> => {
  const parsed = GetDashboardQueryParams.safeParse(coerceDateQuery(req.query as Record<string, unknown>));
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }
  const clientId = requireClient(req, res);
  if (!clientId) return;
  const rawQuery = req.query as Record<string, unknown>;
  const { from, to } = dateRange(parsed.data.dateFrom, parsed.data.dateTo);
  const dateFromOnly = queryDateOnly(rawQuery, "dateFrom", from);
  const dateToOnly = queryDateOnly(rawQuery, "dateTo", to);
  const { category, sellerId, channel, segment, compare, utmSource: utmSourceFilter, utmMedium: utmMediumFilter, utmCampaign: utmCampaignFilter } = parsed.data;
  const [clientConfig] = await db
    .select({
      dashboardType: clientsTable.dashboardType,
      ga4PropertyId: clientsTable.ga4PropertyId,
    })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));
  const isB2CClient = clientConfig?.dashboardType === "B2C";

  // Pre-resolve filter scopes once. Channel/segment scope (customers) is
  // window-agnostic and can be reused across the current and prior windows.
  // The category scope, however, is window-dependent (we restrict to orders
  // *placed in the window* whose items match the category), so it must be
  // recomputed per window.
  let scopedCustomerIds: string[] | null = null;
  if (channel || segment || utmSourceFilter || utmMediumFilter || utmCampaignFilter) {
    const custConds: SQL[] = [eq(customersTable.clientId, clientId)];
    if (channel) custConds.push(eq(customersTable.utmSource, channel));
    if (utmSourceFilter) custConds.push(eq(customersTable.utmSource, utmSourceFilter));
    if (utmMediumFilter) custConds.push(eq(customersTable.utmMedium, utmMediumFilter));
    if (utmCampaignFilter) custConds.push(eq(customersTable.utmCampaign, utmCampaignFilter));
    if (segment) custConds.push(eq(customersTable.rfmSegment, segment));
    const rows = await db
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(and(...custConds));
    scopedCustomerIds = rows.map((r) => r.id);
  }

  type WindowAggregates = {
    kpis: DashboardKpis;
    dailyRevenue: { date: string; value: number }[];
    dailyOrders: { date: string; value: number }[];
    dailyLeads: { date: string; value: number }[];
    dailyNewBuyers: { date: string; value: number }[];
    dailyReturningBuyers: { date: string; value: number }[];
    revenueByCategory: { category: string; revenue: number; orders: number }[];
    traffic: DashboardTraffic;
    dailyPerformance: DashboardDailyPerformance[];
  };

  // The prior window only needs the data the client renders for comparison
  // (kpis + revenue/orders series). `full` skips the lead series, category
  // breakdown, and the (window-agnostic) customer aggregate to avoid extra
  // database work.
  const computeWindow = async (
    winFrom: Date,
    winTo: Date,
    full: boolean,
    winDateFromOnly = saoPauloDateOnly(winFrom),
    winDateToOnly = saoPauloDateOnly(winTo),
  ): Promise<WindowAggregates> => {
    let categoryOrderIds: string[] | null = null;
    if (category) {
      const rows = await db
        .selectDistinct({ id: ordersTable.id })
        .from(ordersTable)
        .innerJoin(orderItemsTable, eq(orderItemsTable.orderId, ordersTable.id))
        .innerJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
        .where(
          and(
            eq(ordersTable.clientId, clientId),
            gte(ordersTable.createdAt, winFrom),
            lte(ordersTable.createdAt, winTo),
            eq(productsTable.category, category),
          ),
        );
      categoryOrderIds = rows.map((r) => r.id);
    }

    const orderConds: SQL[] = [
      eq(ordersTable.clientId, clientId),
      gte(ordersTable.createdAt, winFrom),
      lte(ordersTable.createdAt, winTo),
    ];
    if (sellerId) orderConds.push(eq(ordersTable.sellerId, sellerId));
    const emptyWindow: WindowAggregates = {
      kpis: { ...ZERO_KPIS },
      dailyRevenue: [],
      dailyOrders: [],
      dailyLeads: [],
      dailyNewBuyers: [],
      dailyReturningBuyers: [],
      revenueByCategory: [],
      traffic: { sessions: 0, orders: 0, source: "none" },
      dailyPerformance: [],
    };
    if (categoryOrderIds !== null) {
      if (categoryOrderIds.length === 0) return emptyWindow;
      orderConds.push(
        sql`${ordersTable.id} IN (${sql.join(
          categoryOrderIds.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      );
    }
    if (scopedCustomerIds !== null) {
      if (scopedCustomerIds.length === 0) return emptyWindow;
      orderConds.push(
        sql`${ordersTable.customerId} IN (${sql.join(
          scopedCustomerIds.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      );
    }
    const baseOrderWhere = and(...orderConds);

    const [ga4Funnel, ga4Daily, [orderAgg], [requestedRow], [eventAgg]] = await Promise.all([
      isB2CClient
        ? fetchGa4FunnelMetrics({
            propertyId: clientConfig?.ga4PropertyId,
            dateFrom: winDateFromOnly,
            dateTo: winDateToOnly,
          }).catch((err) => {
            console.warn("[dashboard] GA4 funnel unavailable:", err instanceof Error ? err.message : err);
            return null;
          })
        : Promise.resolve(null),
      isB2CClient && full
        ? fetchGa4DailyMetrics({
            propertyId: clientConfig?.ga4PropertyId,
            dateFrom: winDateFromOnly,
            dateTo: winDateToOnly,
          }).catch((err) => {
            console.warn("[dashboard] GA4 daily unavailable:", err instanceof Error ? err.message : err);
            return null;
          })
        : Promise.resolve(null),
      db
        .select({
          revenue: sql<number>`COALESCE(SUM(${ordersTable.amount}), 0)::float`,
          orders: sql<number>`COUNT(*)::int`,
        })
        .from(ordersTable)
        .where(and(baseOrderWhere, sql`${ordersTable.status} IN ('APPROVED', 'SHIPPED', 'DELIVERED')`)),
      db
        .select({ total: sql<number>`COALESCE(SUM(${ordersTable.amount}), 0)::float` })
        .from(ordersTable)
        .where(baseOrderWhere),
      db
        .select({
          visits: sql<number>`COUNT(*) FILTER (WHERE ${eventsTable.eventType} = 'VISIT')::int`,
          registrations: sql<number>`COUNT(*) FILTER (WHERE ${eventsTable.eventType} = 'REGISTRATION')::int`,
          approvals: sql<number>`COUNT(*) FILTER (WHERE ${eventsTable.eventType} = 'APPROVED_REGISTRATION')::int`,
          purchases: sql<number>`COUNT(*) FILTER (WHERE ${eventsTable.eventType} = 'PURCHASE')::int`,
        })
        .from(eventsTable)
        .where(
          and(
            eq(eventsTable.clientId, clientId),
            gte(eventsTable.createdAt, winFrom),
            lte(eventsTable.createdAt, winTo),
          ),
        ),
    ]);

    let customerAgg: { total: number; repeat: number } = { total: 0, repeat: 0 };
    let newBuyers = 0;
    let returningBuyers = 0;
    let dailyNewBuyers: { date: string; value: number }[] = [];
    let dailyReturningBuyers: { date: string; value: number }[] = [];

    // Always compute aggregate new/returning buyer counts so that prev-period
    // retentionPct, newBuyers, and returningBuyers are available for the
    // period-over-period delta chips in the UI. Daily time-series are only
    // needed for the current window (sparklines), so skip them in compare mode.
    {
      const buyerAggPromises = [
        db
          .select({ count: sql<number>`COUNT(DISTINCT ${ordersTable.customerId})::int` })
          .from(ordersTable)
          .innerJoin(customersTable, eq(ordersTable.customerId, customersTable.id))
          .where(
            and(
              baseOrderWhere,
              sql`${ordersTable.status} IN ('APPROVED', 'SHIPPED', 'DELIVERED')`,
              gte(customersTable.firstPurchaseAt, winFrom),
              lte(customersTable.firstPurchaseAt, winTo),
            ),
          ),
        db
          .select({ count: sql<number>`COUNT(DISTINCT ${ordersTable.customerId})::int` })
          .from(ordersTable)
          .innerJoin(customersTable, eq(ordersTable.customerId, customersTable.id))
          .where(
            and(
              baseOrderWhere,
              sql`${ordersTable.status} IN ('APPROVED', 'SHIPPED', 'DELIVERED')`,
              sql`${customersTable.firstPurchaseAt} < ${winFrom}`,
            ),
          ),
      ] as const;

      if (full) {
        // Current window: also fetch customer totals + daily buyer series.
        const [custRow] = await db
          .select({
            total: sql<number>`COUNT(*)::int`,
            repeat: sql<number>`COUNT(*) FILTER (WHERE ${customersTable.totalOrders} > 1)::int`,
          })
          .from(customersTable)
          .where(eq(customersTable.clientId, clientId));
        customerAgg = custRow;

        const [[newRow], [retRow], newDaily, retDaily] = await Promise.all([
          ...buyerAggPromises,
          db
            .select({
              date: sql<string>`to_char(date_trunc('day', ${ordersTable.createdAt}), 'YYYY-MM-DD')`,
              value: sql<number>`COUNT(DISTINCT ${ordersTable.customerId})::int`,
            })
            .from(ordersTable)
            .innerJoin(customersTable, eq(ordersTable.customerId, customersTable.id))
            .where(
              and(
                baseOrderWhere,
                sql`${ordersTable.status} IN ('APPROVED', 'SHIPPED', 'DELIVERED')`,
                gte(customersTable.firstPurchaseAt, winFrom),
                lte(customersTable.firstPurchaseAt, winTo),
              ),
            )
            .groupBy(sql`date_trunc('day', ${ordersTable.createdAt})`)
            .orderBy(sql`date_trunc('day', ${ordersTable.createdAt})`),
          db
            .select({
              date: sql<string>`to_char(date_trunc('day', ${ordersTable.createdAt}), 'YYYY-MM-DD')`,
              value: sql<number>`COUNT(DISTINCT ${ordersTable.customerId})::int`,
            })
            .from(ordersTable)
            .innerJoin(customersTable, eq(ordersTable.customerId, customersTable.id))
            .where(
              and(
                baseOrderWhere,
                sql`${ordersTable.status} IN ('APPROVED', 'SHIPPED', 'DELIVERED')`,
                sql`${customersTable.firstPurchaseAt} < ${winFrom}`,
              ),
            )
            .groupBy(sql`date_trunc('day', ${ordersTable.createdAt})`)
            .orderBy(sql`date_trunc('day', ${ordersTable.createdAt})`),
        ] as const);
        newBuyers = Number(newRow?.count) || 0;
        returningBuyers = Number(retRow?.count) || 0;
        dailyNewBuyers = newDaily;
        dailyReturningBuyers = retDaily;
      } else {
        // Prev window: only aggregate counts are needed (no daily series, no
        // overall customer totals) — keeps the compare path lean.
        const [[newRow], [retRow]] = await Promise.all(buyerAggPromises);
        newBuyers = Number(newRow?.count) || 0;
        returningBuyers = Number(retRow?.count) || 0;
      }
    }

    const revenue = Number(orderAgg.revenue) || 0;
    const orders = Number(orderAgg.orders) || 0;
    const localVisits = Number(eventAgg.visits) || 0;
    const ga4Sessions = ga4Funnel?.sessions ?? 0;
    const visits = isB2CClient && ga4Sessions > 0 ? ga4Sessions : localVisits;
    const trafficSource: Ga4Source = isB2CClient && ga4Sessions > 0 ? "ga4" : localVisits > 0 ? "events" : "none";
    const registrations = Number(eventAgg.registrations) || 0;
    const approvals = Number(eventAgg.approvals) || 0;

    const clamp = (n: number): number => Math.min(100, Math.max(0, n));
    const totalBuyers = newBuyers + returningBuyers;
    const kpis: DashboardKpis = {
      revenue,
      orders,
      avgTicket: orders > 0 ? revenue / orders : 0,
      conversionRate: visits > 0 ? clamp((orders / visits) * 100) : 0,
      approvalRate: registrations > 0 ? clamp((approvals / registrations) * 100) : 0,
      leads: registrations,
      approvedLeads: approvals,
      customers: Number(customerAgg.total) || 0,
      repeatCustomers: Number(customerAgg.repeat) || 0,
      requestedRevenue: Number(requestedRow?.total) || 0,
      newBuyers,
      returningBuyers,
      retentionPct: totalBuyers > 0 ? (returningBuyers / totalBuyers) * 100 : 0,
    };

    const dailyRevenue = await db
      .select({
        date: sql<string>`to_char(date_trunc('day', ${ordersTable.createdAt}), 'YYYY-MM-DD')`,
        value: sql<number>`COALESCE(SUM(${ordersTable.amount}), 0)::float`,
      })
      .from(ordersTable)
      .where(
        and(
          baseOrderWhere,
          sql`${ordersTable.status} IN ('APPROVED', 'SHIPPED', 'DELIVERED')`,
        ),
      )
      .groupBy(sql`date_trunc('day', ${ordersTable.createdAt})`)
      .orderBy(sql`date_trunc('day', ${ordersTable.createdAt})`);

    const dailyOrders = await db
      .select({
        date: sql<string>`to_char(date_trunc('day', ${ordersTable.createdAt}), 'YYYY-MM-DD')`,
        value: sql<number>`COUNT(*)::float`,
      })
      .from(ordersTable)
      .where(and(baseOrderWhere, sql`${ordersTable.status} IN ('APPROVED', 'SHIPPED', 'DELIVERED')`))
      .groupBy(sql`date_trunc('day', ${ordersTable.createdAt})`)
      .orderBy(sql`date_trunc('day', ${ordersTable.createdAt})`);

    const dailyPerformance = full
      ? buildDailyPerformance({
          dateFrom: winDateFromOnly,
          dateTo: winDateToOnly,
          dailyRevenue,
          dailyOrders,
          ga4Daily: isB2CClient ? ga4Daily : null,
        })
      : [];

    const dailyLeads = full
      ? await db
          .select({
            date: sql<string>`to_char(date_trunc('day', ${eventsTable.createdAt}), 'YYYY-MM-DD')`,
            value: sql<number>`COUNT(*)::float`,
          })
          .from(eventsTable)
          .where(
            and(
              eq(eventsTable.clientId, clientId),
              eq(eventsTable.eventType, "REGISTRATION"),
              gte(eventsTable.createdAt, winFrom),
              lte(eventsTable.createdAt, winTo),
            ),
          )
          .groupBy(sql`date_trunc('day', ${eventsTable.createdAt})`)
          .orderBy(sql`date_trunc('day', ${eventsTable.createdAt})`)
      : [];

    const revenueByCategory = full
      ? await db
          .select({
            category: sql<string>`COALESCE(${productsTable.category}, 'Uncategorized')`,
            revenue: sql<number>`COALESCE(SUM(${orderItemsTable.priceAtSale} * ${orderItemsTable.quantity}), 0)::float`,
            orders: sql<number>`COUNT(DISTINCT ${ordersTable.id})::int`,
          })
          .from(orderItemsTable)
          .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
          .innerJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
          .where(and(baseOrderWhere, sql`${ordersTable.status} IN ('APPROVED', 'SHIPPED', 'DELIVERED')`))
          .groupBy(productsTable.category)
      : [];

    return {
      kpis,
      dailyRevenue,
      dailyOrders,
      dailyLeads,
      dailyNewBuyers,
      dailyReturningBuyers,
      revenueByCategory,
      traffic: { sessions: visits, orders, source: trafficSource },
      dailyPerformance,
    };
  };

  const current = await computeWindow(from, to, true, dateFromOnly, dateToOnly);

  // Equivalent prior window: same length, ending the day before `from`.
  // We use millisecond arithmetic so the window length matches exactly even
  // across DST/timezone shifts.
  let prev: WindowAggregates | null = null;
  if (compare) {
    const lengthMs = to.getTime() - from.getTime();
    const prevTo = new Date(from.getTime() - 1);
    const prevFrom = new Date(prevTo.getTime() - lengthMs);
    prev = await computeWindow(prevFrom, prevTo, false);
  }

  // Business signals — computed from the current window only.
  const computeSignals = async (): Promise<DashboardSignal[]> => {
    const signals: DashboardSignal[] = [];

    // Signal 1: High traffic, low conversion.
    // Uses the daily distribution of visit-to-purchase rates: if the bottom
    // 20th-percentile day's rate is critically low (< 2%) we fire the signal.
    // This is more robust than an aggregate threshold — a single burst day can
    // mask a week of poor-converting days when using averages.
    const dailyConvRows = await db
      .select({
        visits: sql<number>`COUNT(*) FILTER (WHERE ${eventsTable.eventType} = 'VISIT')::int`,
        purchases: sql<number>`COUNT(*) FILTER (WHERE ${eventsTable.eventType} = 'PURCHASE')::int`,
      })
      .from(eventsTable)
      .where(
        and(
          eq(eventsTable.clientId, clientId),
          gte(eventsTable.createdAt, from),
          lte(eventsTable.createdAt, to),
          sql`${eventsTable.eventType} IN ('VISIT', 'PURCHASE')`,
        ),
      )
      .groupBy(sql`date_trunc('day', ${eventsTable.createdAt})`);

    const totalVisits = dailyConvRows.reduce((s, r) => s + Number(r.visits), 0);
    // Only consider days with enough traffic to be statistically meaningful.
    const ratesByDay = dailyConvRows
      .filter((r) => Number(r.visits) >= 5)
      .map((r) => Number(r.purchases) / Number(r.visits));

    if (totalVisits >= 50 && ratesByDay.length >= 3) {
      const sorted = [...ratesByDay].sort((a, b) => a - b);
      const p20idx = Math.max(0, Math.floor(sorted.length * 0.2) - 1);
      const p20rate = sorted[p20idx]!;
      const medianRate = sorted[Math.floor(sorted.length / 2)]!;
      if (p20rate < 0.02) {
        signals.push({
          type: "high_traffic_low_sales",
          severity: p20rate < 0.005 ? "critical" : "warning",
          title: "High traffic, low conversion",
          body: `The bottom 20% of trading days convert at just ${(p20rate * 100).toFixed(1)}% visits→purchases (period median: ${(medianRate * 100).toFixed(1)}%). Review checkout flow, pricing, or catalog relevance.`,
          meta: {
            p20ConversionPct: +(p20rate * 100).toFixed(2),
            medianConversionPct: +(medianRate * 100).toFixed(2),
            totalVisits,
          },
        });
      }
    }

    // Signal 2: High-performing regions (week-over-week state revenue growth).
    const wkEnd = to;
    const wkStart = new Date(wkEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
    const pwkEnd = new Date(wkStart.getTime() - 1);
    const pwkStart = new Date(pwkEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

    const stateRevenue = (winFrom: Date, winTo: Date) =>
      db
        .select({
          state: customersTable.state,
          revenue: sql<number>`COALESCE(SUM(${ordersTable.amount}), 0)::float`,
        })
        .from(ordersTable)
        .innerJoin(customersTable, eq(ordersTable.customerId, customersTable.id))
        .where(
          and(
            eq(ordersTable.clientId, clientId),
            gte(ordersTable.createdAt, winFrom),
            lte(ordersTable.createdAt, winTo),
            sql`${ordersTable.status} IN ('APPROVED', 'SHIPPED', 'DELIVERED')`,
          ),
        )
        .groupBy(customersTable.state);

    const [currStates, prevStates] = await Promise.all([
      stateRevenue(wkStart, wkEnd),
      stateRevenue(pwkStart, pwkEnd),
    ]);

    const prevStateMap = new Map<string, number>();
    for (const r of prevStates) if (r.state) prevStateMap.set(r.state, Number(r.revenue));

    const risingStates = currStates
      .filter((r) => r.state && r.revenue > 0)
      .map((r) => {
        const prior = prevStateMap.get(r.state!) ?? 0;
        const growthPct = prior > 0 ? ((Number(r.revenue) - prior) / prior) * 100 : null;
        return { state: r.state!, revenue: Number(r.revenue), growthPct };
      })
      .filter((r) => r.growthPct !== null && r.growthPct > 10)
      .sort((a, b) => (b.growthPct ?? 0) - (a.growthPct ?? 0))
      .slice(0, 3);

    if (risingStates.length > 0) {
      signals.push({
        type: "high_performing_regions",
        severity: "info",
        title: "High-performing regions this week",
        body: `${risingStates.map((s) => `${s.state} (+${s.growthPct!.toFixed(0)}%)`).join(", ")} ${risingStates.length === 1 ? "is surging" : "are surging"} week-over-week. Consider shifting inventory or ad budget to these regions.`,
        meta: { regions: risingStates.map((s) => ({ state: s.state, growthPct: +(s.growthPct!.toFixed(1)) })) },
      });
    }

    return signals;
  };

  const signals = await computeSignals();

  res.json(
    GetDashboardResponse.parse({
      kpis: current.kpis,
      revenueOverTime: current.dailyRevenue,
      ordersOverTime: current.dailyOrders,
      leadsOverTime: current.dailyLeads,
      revenueByCategory: current.revenueByCategory,
      newBuyersOverTime: current.dailyNewBuyers,
      returningBuyersOverTime: current.dailyReturningBuyers,
      traffic: current.traffic,
      dailyPerformance: current.dailyPerformance,
      signals,
      ...(prev
        ? {
            prevKpis: prev.kpis,
            prevRevenueOverTime: prev.dailyRevenue,
            prevOrdersOverTime: prev.dailyOrders,
          }
        : {}),
    }),
  );
});

function normalizeCampaignText(value: string | null | undefined): string {
  return value?.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() ?? "";
}

function isPaidCampaignSignal(row: UpzeroAnalyticsMetric): boolean {
  const source = normalizeCampaignText(row.utm_source);
  const medium = normalizeCampaignText(row.utm_medium);
  const campaign = normalizeCampaignText(row.utm_campaign);
  const channel = normalizeCampaignText(row.channel);
  const rawSource = normalizeCampaignText(row.source);

  const isLinktreeOnly =
    source === "instagram" &&
    medium === "linktree" &&
    campaign === "linktree";

  if (isLinktreeOnly) return false;

  const hasClickIdentifier = Boolean(row.fbc || row.fbclid || row.gclid);
  const hasNamedCampaign = campaign.length > 0 && campaign !== "linktree";
  const hasMetaSource = ["fb", "facebook", "ig", "instagram", "meta"].includes(source);
  const hasGoogleSource = ["google", "google_ads", "googleads", "gads", "gc"].includes(source);
  const hasPaidMedium =
    medium.includes("paid") ||
    medium.includes("cpc") ||
    medium.includes("ppc") ||
    medium.includes("pmax");
  const hasMetaPlacement =
    medium.includes("facebook_mobile_feed") ||
    medium.includes("facebook_desktop_feed") ||
    medium.includes("facebook_stories") ||
    medium.includes("instagram_feed") ||
    medium.includes("instagram_stories") ||
    medium.includes("instagram_reels");
  const hasUpCampaign =
    campaign.includes("up.") ||
    campaign.includes("upzero") ||
    campaign.includes("up zero") ||
    campaign.includes("rmkt") ||
    campaign.includes("remarketing") ||
    campaign.includes("frio") ||
    campaign.includes("cadastro");
  const hasNumericMetaCampaign = hasMetaSource && /^[0-9]{8,}$/.test(campaign);
  const hasPaidChannel = channel.includes("paid") || channel.includes("ads") || rawSource.includes("ads");

  return (
    hasClickIdentifier ||
    hasNamedCampaign ||
    hasPaidMedium ||
    hasMetaPlacement ||
    hasUpCampaign ||
    hasNumericMetaCampaign ||
    hasPaidChannel ||
    (hasMetaSource && campaign.length > 0 && campaign !== "linktree") ||
    (hasGoogleSource && campaign.length > 0)
  );
}

function normalizeCampaignSource(row: UpzeroAnalyticsMetric): string {
  const source = normalizeCampaignText(row.utm_source);
  const medium = normalizeCampaignText(row.utm_medium);
  const campaign = normalizeCampaignText(row.utm_campaign);

  if (row.fbc || row.fbclid) return "Meta";
  if (row.gclid) return "Google";
  if (["fb", "facebook"].includes(source) || medium.includes("facebook")) return "Facebook";
  if (["ig", "instagram"].includes(source) || medium.includes("instagram")) return "Instagram";
  if (
    ["google", "google_ads", "googleads", "gads", "gc"].includes(source) ||
    medium.includes("google") ||
    medium.includes("pmax") ||
    medium.includes("cpc")
  ) {
    return "Google";
  }
  if (campaign.includes("up.") || campaign.includes("upzero") || campaign.includes("up zero")) return "UP";
  return "Não identificado";
}

function normalizeCampaignMedium(row: UpzeroAnalyticsMetric): string {
  const medium = normalizeCampaignText(row.utm_medium);
  if (row.fbc || row.fbclid) return "Clique pago Meta";
  if (row.gclid) return "Clique pago Google";
  if (medium.includes("instagram_feed")) return "Instagram Feed";
  if (medium.includes("instagram_stories")) return "Instagram Stories";
  if (medium.includes("instagram_reels")) return "Instagram Reels";
  if (medium.includes("facebook_mobile_feed")) return "Facebook Mobile Feed";
  if (medium.includes("facebook_desktop_feed")) return "Facebook Desktop Feed";
  if (medium.includes("facebook_stories")) return "Facebook Stories";
  if (medium.includes("pmax")) return "Google PMax";
  if (medium.includes("cpc")) return "CPC";
  if (medium.includes("paid")) return "Pago";
  if (medium.includes("social")) return "Social";
  if (medium.includes("linktree")) return "Linktree";
  return row.utm_medium ?? "Não identificado";
}

function campaignLabelForRow(row: UpzeroAnalyticsMetric): string | null {
  if (row.utm_campaign) return row.utm_campaign;
  if (row.fbc || row.fbclid) return "Clique Meta identificado";
  if (row.gclid) return "Clique Google identificado";
  return null;
}

type CampaignTouch = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  occurredAt: string | null;
};

type CampaignSummary = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  eventsCount: number;
};

type AttributedCampaignCustomer = {
  customerId: string | null;
  userId: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  type: string | null;
  cpf: string | null;
  cnpj: string | null;
  companyName: string | null;
  documentType: "CPF" | "CNPJ" | null;
  registrationStatus: string | null;
  registeredAt: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  firstTouch: CampaignTouch;
  lastTouch: CampaignTouch;
  returnTouch: CampaignTouch | null;
  campaigns: CampaignSummary[];
  hasPurchase: boolean;
  isRepurchase: boolean;
  isRemarketing: boolean;
  purchaseCount: number;
  orderIds: number[];
  totalPurchaseValue: number;
  addToCartCount: number;
  checkoutCount: number;
  registerSubmittedCount: number;
  productViewCount: number;
  lastEventName: string | null;
  lastEventAt: string | null;
};

function touchFromMetric(row: UpzeroAnalyticsMetric): CampaignTouch {
  return {
    source: normalizeCampaignSource(row),
    medium: normalizeCampaignMedium(row),
    campaign: campaignLabelForRow(row),
    occurredAt: row.period_start,
  };
}

function buildUniqueCampaigns(rows: UpzeroAnalyticsMetric[]): CampaignSummary[] {
  const map = new Map<string, CampaignSummary>();

  for (const row of rows) {
    const source = normalizeCampaignSource(row);
    const medium = normalizeCampaignMedium(row);
    const campaign = campaignLabelForRow(row) ?? "Não identificado";
    const key = [source, medium, campaign].join("||");
    const current =
      map.get(key) ??
      {
        source,
        medium,
        campaign,
        firstSeenAt: row.period_start,
        lastSeenAt: row.period_start,
        eventsCount: 0,
      };

    current.eventsCount += row.total_events ?? 0;
    if (new Date(row.period_start).getTime() < new Date(current.firstSeenAt).getTime()) {
      current.firstSeenAt = row.period_start;
    }
    if (new Date(row.period_start).getTime() > new Date(current.lastSeenAt).getTime()) {
      current.lastSeenAt = row.period_start;
    }
    map.set(key, current);
  }

  return Array.from(map.values());
}

function maskDocument(value: string | null | undefined, type: "CPF" | "CNPJ"): string | null {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (!digits) return null;
  if (type === "CPF") {
    return digits.length >= 11 ? `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**` : "***";
  }
  return digits.length >= 14 ? `**.${digits.slice(2, 5)}.${digits.slice(5, 8)}/****-**` : "***";
}

function maskDocumentLast4(last4: string | null | undefined, type: "CPF" | "CNPJ" | null): string | null {
  const digits = last4?.replace(/\D/g, "") ?? "";
  if (!digits || !type) return null;
  return type === "CPF"
    ? `***.***.***-${digits.padStart(2, "*").slice(-2)}`
    : `**.***.***/****-${digits.padStart(2, "*").slice(-2)}`;
}

type CampaignLocalCustomer = {
  id: string;
  externalId: string | null;
  name: string | null;
  email: string;
  phone: string | null;
  documentType: "CPF" | "CNPJ" | null;
  documentHash?: string | null;
  documentLast4?: string | null;
  registrationStatus: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: Date;
  totalOrders: number;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
};

type CampaignLocalOrderSummary = {
  purchaseCount: number;
  orderIds: number[];
  totalPurchaseValue: number;
  lastOrderAt: string | null;
};

type CampaignAttributionStampRow = {
  id: string;
  clientId: string;
  customerId: string;
  userId: number | null;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  label: string | null;
  evidenceType: string;
  evidenceEventName: string | null;
  evidenceEventId: string | null;
  evidenceAt: Date | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  totalPurchaseValueAtStamp: number;
  purchaseCountAtStamp: number;
  rawEvidence: unknown;
  createdAt: Date;
  updatedAt: Date;
};

function localCustomerToCampaignMetric(customer: CampaignLocalCustomer, index: number): UpzeroAnalyticsMetric | null {
  const userId = Number.parseInt(customer.externalId ?? "", 10);
  if (!Number.isFinite(userId) || userId <= 0) return null;

  return {
    id: -1_000_000 - index,
    period_start: customer.createdAt.toISOString(),
    period_type: "registration",
    event_name: "register_submitted",
    product: null,
    product_image_url: null,
    product_variant: null,
    category: null,
    user: {
      id: userId,
      type: null,
      name: customer.name,
      cpf: null,
      cnpj: null,
      company_name: null,
    },
    user_id: userId,
    order_id: null,
    utm_source: customer.utmSource,
    utm_medium: customer.utmMedium,
    utm_campaign: customer.utmCampaign,
    source: "registration",
    channel: null,
    device_type: null,
    total_events: 1,
    unique_users: 1,
    unique_sessions: 0,
    total_quantity: 0,
    total_value: 0,
    updated_at: customer.createdAt.toISOString(),
    event_id: `local_customer_${customer.id}`,
    anonymous_id: null,
    session_id: null,
    visitor_id: null,
    fbclid: null,
    fbc: null,
    fbp: null,
    gclid: null,
    landing_url: null,
    landing_host: null,
    landing_path: null,
    referrer: null,
    referrer_host: null,
    utm_content: customer.utmContent,
    utm_term: customer.utmTerm,
  };
}

function attributionStampToCampaignMetric(
  stamp: CampaignAttributionStampRow,
  customer: CampaignLocalCustomer,
  index: number,
): UpzeroAnalyticsMetric | null {
  const userId = stamp.userId ?? Number.parseInt(customer.externalId ?? "", 10);
  if (!Number.isFinite(userId) || userId <= 0) return null;
  const occurredAt = stamp.evidenceAt ?? stamp.createdAt ?? customer.createdAt;

  return {
    id: -2_000_000 - index,
    period_start: occurredAt.toISOString(),
    period_type: "attribution_stamp",
    event_name: stamp.evidenceEventName ?? "campaign_attribution_stamped",
    product: null,
    product_image_url: null,
    product_variant: null,
    category: null,
    user: {
      id: userId,
      type: null,
      name: customer.name,
      cpf: null,
      cnpj: null,
      company_name: null,
    },
    user_id: userId,
    order_id: null,
    utm_source: stamp.source,
    utm_medium: stamp.medium,
    utm_campaign: stamp.campaign,
    source: "attribution_stamp",
    channel: "paid",
    device_type: null,
    total_events: 1,
    unique_users: 1,
    unique_sessions: 0,
    total_quantity: 0,
    total_value: 0,
    updated_at: stamp.updatedAt.toISOString(),
    event_id: `campaign_attribution_stamp_${stamp.id}`,
    anonymous_id: null,
    session_id: null,
    visitor_id: null,
    fbclid: null,
    fbc: stamp.source?.toLowerCase() === "meta" || stamp.medium?.toLowerCase().includes("meta") ? "stamped" : null,
    fbp: null,
    gclid: stamp.source?.toLowerCase() === "google" ? "stamped" : null,
    landing_url: null,
    landing_host: null,
    landing_path: null,
    referrer: null,
    referrer_host: null,
    utm_content: null,
    utm_term: null,
  };
}

function firstCampaignEvidenceRow(rows: UpzeroAnalyticsMetric[]): UpzeroAnalyticsMetric | null {
  return rows
    .filter(isPaidCampaignSignal)
    .sort((a, b) => new Date(a.period_start).getTime() - new Date(b.period_start).getTime())[0] ?? null;
}

async function stampCampaignAttributions(params: {
  clientId: string;
  customers: CampaignLocalCustomer[];
  rows: UpzeroAnalyticsMetric[];
  localOrders: Map<string, CampaignLocalOrderSummary>;
}): Promise<void> {
  const localCustomerByUser = new Map<number, CampaignLocalCustomer>();
  for (const customer of params.customers) {
    const userId = Number.parseInt(customer.externalId ?? "", 10);
    if (Number.isFinite(userId)) localCustomerByUser.set(userId, customer);
  }

  const rowsByUser = new Map<number, UpzeroAnalyticsMetric[]>();
  for (const row of params.rows) {
    const user = getMetricUser(row);
    if (!user || !isPaidCampaignSignal(row)) continue;
    const current = rowsByUser.get(user.id) ?? [];
    current.push(row);
    rowsByUser.set(user.id, current);
  }

  const values: Array<typeof campaignAttributionStampsTable.$inferInsert> = [];
  for (const [userId, userRows] of rowsByUser.entries()) {
    const customer = localCustomerByUser.get(userId);
    if (!customer) continue;
    const evidence = firstCampaignEvidenceRow(userRows);
    if (!evidence) continue;
    const touch = touchFromMetric(evidence);
    const localOrder = params.localOrders.get(customer.id);
    values.push({
      id: nanoid(),
      clientId: params.clientId,
      customerId: customer.id,
      userId,
      source: touch.source,
      medium: touch.medium,
      campaign: touch.campaign,
      label: [touch.source, touch.medium, touch.campaign].filter(Boolean).join(" / "),
      evidenceType: "tracking",
      evidenceEventName: evidence.event_name,
      evidenceEventId: evidence.event_id ?? String(evidence.id),
      evidenceAt: new Date(evidence.period_start),
      firstSeenAt: new Date(userRows[0]?.period_start ?? evidence.period_start),
      lastSeenAt: new Date(userRows[userRows.length - 1]?.period_start ?? evidence.period_start),
      totalPurchaseValueAtStamp: localOrder?.totalPurchaseValue ?? 0,
      purchaseCountAtStamp: localOrder?.purchaseCount ?? 0,
      rawEvidence: {
        eventName: evidence.event_name,
        eventId: evidence.event_id,
        metricId: evidence.id,
        userId,
        utmSource: evidence.utm_source,
        utmMedium: evidence.utm_medium,
        utmCampaign: evidence.utm_campaign,
        fbc: Boolean(evidence.fbc),
        fbclid: Boolean(evidence.fbclid),
        gclid: Boolean(evidence.gclid),
        occurredAt: evidence.period_start,
      },
    });
  }

  if (values.length === 0) return;
  await db
    .insert(campaignAttributionStampsTable)
    .values(values)
    .onConflictDoUpdate({
      target: [campaignAttributionStampsTable.clientId, campaignAttributionStampsTable.customerId],
      set: {
        userId: sql`COALESCE(${campaignAttributionStampsTable.userId}, EXCLUDED.user_id)`,
        lastSeenAt: sql`GREATEST(COALESCE(${campaignAttributionStampsTable.lastSeenAt}, EXCLUDED.last_seen_at), EXCLUDED.last_seen_at)`,
        totalPurchaseValueAtStamp: sql`GREATEST(${campaignAttributionStampsTable.totalPurchaseValueAtStamp}, EXCLUDED.total_purchase_value_at_stamp)`,
        purchaseCountAtStamp: sql`GREATEST(${campaignAttributionStampsTable.purchaseCountAtStamp}, EXCLUDED.purchase_count_at_stamp)`,
        updatedAt: new Date(),
      },
    });
}

function buildAttributedCampaignCustomers(
  rows: UpzeroAnalyticsMetric[],
  localCustomers: Map<number, CampaignLocalCustomer>,
  priorOrders: Map<string, number>,
  localOrders: Map<string, CampaignLocalOrderSummary>,
): AttributedCampaignCustomer[] {
  const grouped = new Map<number, UpzeroAnalyticsMetric[]>();

  for (const row of rows) {
    const user = getMetricUser(row);
    if (!user) continue;
    const current = grouped.get(user.id) ?? [];
    current.push(row);
    grouped.set(user.id, current);
  }

  const customers: AttributedCampaignCustomer[] = [];

  for (const [userId, userRows] of grouped.entries()) {
    const sortedRows = [...userRows].sort(
      (a, b) => new Date(a.period_start).getTime() - new Date(b.period_start).getTime(),
    );
    const campaignRows = sortedRows.filter(isPaidCampaignSignal);
    if (campaignRows.length === 0) continue;

    const user = sortedRows.map(getMetricUser).find((candidate) => candidate?.id === userId) ?? null;
    const purchaseRows = sortedRows.filter((row) =>
      ["purchase", "order_paid", "payment_approved"].includes(row.event_name),
    );
    const checkoutRows = sortedRows.filter((row) =>
      ["initiate_checkout", "checkout_start"].includes(row.event_name),
    );
    const addToCartRows = sortedRows.filter((row) => row.event_name === "add_to_cart");
    const registerRows = sortedRows.filter((row) => row.event_name === "register_submitted");
    const productViewRows = sortedRows.filter((row) => PRODUCT_VIEW_EVENT_NAMES.has(row.event_name));
    const orderIds = Array.from(
      new Set(
        purchaseRows
          .map((row) => row.order_id)
          .filter((orderId): orderId is number => typeof orderId === "number"),
      ),
    );
    const purchaseCount =
      orderIds.length > 0
        ? orderIds.length
        : purchaseRows.reduce((sum, row) => sum + (row.total_events ?? 0), 0);
    const purchaseValueByOrder = new Map<number, number>();
    let purchaseValueWithoutOrder = 0;
    for (const row of purchaseRows) {
      if (row.order_id !== null) {
        purchaseValueByOrder.set(row.order_id, Math.max(purchaseValueByOrder.get(row.order_id) ?? 0, row.total_value ?? 0));
      } else {
        purchaseValueWithoutOrder += row.total_value ?? 0;
      }
    }
    const totalPurchaseValue =
      [...purchaseValueByOrder.values()].reduce((sum, value) => sum + value, 0) + purchaseValueWithoutOrder;
    const firstTouchRow = campaignRows[0];
    const lastTouchRow = campaignRows[campaignRows.length - 1];
    const firstCampaign = firstTouchRow.utm_campaign ?? "";
    const returnTouchRow =
      campaignRows.find((row) => row !== firstTouchRow && (row.utm_campaign ?? "") && row.utm_campaign !== firstCampaign) ?? null;
    const firstSeenAt = sortedRows[0]?.period_start ?? null;
    const lastEvent = sortedRows[sortedRows.length - 1];
    const localCustomer = localCustomers.get(userId);
    const localOrderSummary = localCustomer ? localOrders.get(localCustomer.id) : undefined;
    const combinedOrderIds = Array.from(new Set([...orderIds, ...(localOrderSummary?.orderIds ?? [])]));
    const effectivePurchaseCount = Math.max(
      purchaseCount,
      localOrderSummary?.purchaseCount ?? 0,
      combinedOrderIds.length,
    );
    const effectivePurchaseValue =
      localOrderSummary && localOrderSummary.purchaseCount > 0
        ? localOrderSummary.totalPurchaseValue
        : totalPurchaseValue;
    const effectiveLastEventAt =
      localOrderSummary?.lastOrderAt && (!lastEvent?.period_start || new Date(localOrderSummary.lastOrderAt).getTime() > new Date(lastEvent.period_start).getTime())
        ? localOrderSummary.lastOrderAt
        : (lastEvent?.period_start ?? null);
    const documentType =
      localCustomer?.documentType ??
      (user?.cnpj ? "CNPJ" : user?.cpf ? "CPF" : user?.type === "WHOLESALE" ? "CNPJ" : user?.type === "RETAIL" ? "CPF" : null);
    const priorOrderCount = localCustomer ? Number(priorOrders.get(localCustomer.id) ?? 0) : 0;
    const totalHistoricalOrders = Number(localCustomer?.totalOrders ?? 0);
    const knownHistoricalOrders = Math.max(
      totalHistoricalOrders,
      priorOrderCount + effectivePurchaseCount,
      localCustomer ? 0 : effectivePurchaseCount,
    );
    const isRemarketing = knownHistoricalOrders > 1 || (priorOrderCount > 0 && effectivePurchaseCount > 0);

    customers.push({
      customerId: localCustomer?.id ?? null,
      userId,
      name: localCustomer?.name ?? user?.name ?? null,
      email: localCustomer?.email ?? null,
      phone: localCustomer?.phone ?? null,
      type: user?.type ?? null,
      cpf: maskDocument(user?.cpf, "CPF") ?? (documentType === "CPF" ? maskDocumentLast4(localCustomer?.documentLast4, "CPF") : null),
      cnpj: maskDocument(user?.cnpj, "CNPJ") ?? (documentType === "CNPJ" ? maskDocumentLast4(localCustomer?.documentLast4, "CNPJ") : null),
      companyName: user?.companyName ?? null,
      documentType,
      registrationStatus: localCustomer?.registrationStatus ?? null,
      registeredAt: localCustomer?.createdAt.toISOString() ?? null,
      firstSeenAt,
      lastSeenAt: effectiveLastEventAt,
      firstTouch: touchFromMetric(firstTouchRow),
      lastTouch: touchFromMetric(lastTouchRow),
      returnTouch: returnTouchRow ? touchFromMetric(returnTouchRow) : null,
      campaigns: buildUniqueCampaigns(campaignRows),
      hasPurchase: effectivePurchaseCount > 0,
      isRepurchase: effectivePurchaseCount >= 2 || priorOrderCount > 0 || totalHistoricalOrders > effectivePurchaseCount,
      isRemarketing,
      purchaseCount: effectivePurchaseCount,
      orderIds: combinedOrderIds,
      totalPurchaseValue: effectivePurchaseValue,
      addToCartCount: addToCartRows.reduce((sum, row) => sum + (row.total_events ?? 0), 0),
      checkoutCount: checkoutRows.reduce((sum, row) => sum + (row.total_events ?? 0), 0),
      registerSubmittedCount: registerRows.reduce((sum, row) => sum + (row.total_events ?? 0), 0),
      productViewCount: productViewRows.reduce((sum, row) => sum + (row.total_events ?? 0), 0),
      lastEventName: lastEvent?.event_name ?? null,
      lastEventAt: effectiveLastEventAt,
    });
  }

  return customers.sort((a, b) => {
    const dateA = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
    const dateB = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;
    return dateB - dateA;
  });
}

const CampaignCustomersQueryParams = GetDashboardQueryParams.pick({
  clientId: true,
  dateFrom: true,
  dateTo: true,
}).extend({
  limit: z.coerce.number().int().min(1).max(1000).default(250),
  source: z.coerce.string().optional(),
  campaign: z.coerce.string().optional(),
  purchase: z.enum(["all", "yes", "no"]).default("all"),
  repurchase: z.enum(["all", "yes", "no"]).default("all"),
  remarketing: z.enum(["all", "yes", "no"]).default("all"),
  customerType: z.coerce.string().optional(),
  document: z.enum(["all", "CPF", "CNPJ", "none"]).default("all"),
  search: z.coerce.string().optional(),
});

router.get("/analytics/campaign-customers", async (req, res): Promise<void> => {
  const parsed = CampaignCustomersQueryParams.safeParse(
    coerceDateQuery(req.query as Record<string, unknown>),
  );
  if (!parsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }

  const clientId = requireClient(req, res);
  if (!clientId) return;

  const { from, to } = dateRange(parsed.data.dateFrom, parsed.data.dateTo);
  const upzeroRange = upzeroIsoRange(req.query as Record<string, unknown>, from, to);
  const attributionHistoryRange = upzeroAttributionHistoryRange(req.query as Record<string, unknown>, from, to);
  const [client] = await db
    .select({ upZeroApiKey: clientsTable.upZeroApiKey })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));

  try {
    const tracking = await getUpzeroTrackingRowsChunked({
      ...attributionHistoryRange,
      apiKey: client?.upZeroApiKey,
      context: "campaign-customers-history",
    });
    const trackingRows = tracking.rows;
    const trackingUserIds = [...new Set(trackingRows.map((row) => getMetricUser(row)?.id).filter((id): id is number => typeof id === "number"))];
    const numericTrackingExternalIds = trackingUserIds.map(String);
    const periodOrderCustomerRows = await db
      .select({ customerId: ordersTable.customerId })
      .from(ordersTable)
      .where(and(eq(ordersTable.clientId, clientId), gte(ordersTable.createdAt, from), lte(ordersTable.createdAt, to)));
    const periodOrderCustomerIds = [...new Set(periodOrderCustomerRows.map((row) => row.customerId))];
    const customerScopeParts: SQL[] = [lte(customersTable.createdAt, to)];
    if (numericTrackingExternalIds.length > 0) {
      customerScopeParts.push(inArray(customersTable.externalId, numericTrackingExternalIds));
    }
    if (periodOrderCustomerIds.length > 0) {
      customerScopeParts.push(inArray(customersTable.id, periodOrderCustomerIds));
    }
    const customerScope = trackingUserIds.length > 0
      ? or(...customerScopeParts)
      : or(...customerScopeParts);

    const selectCampaignCustomers = () =>
      db
        .select({
          id: customersTable.id,
          externalId: customersTable.externalId,
          name: customersTable.name,
          email: customersTable.email,
          phone: customersTable.phone,
          documentType: customersTable.documentType,
          documentHash: customersTable.documentHash,
          documentLast4: customersTable.documentLast4,
          registrationStatus: customersTable.registrationStatus,
          createdAt: customersTable.createdAt,
          totalOrders: customersTable.totalOrders,
          utmSource: customersTable.utmSource,
          utmMedium: customersTable.utmMedium,
          utmCampaign: customersTable.utmCampaign,
          utmContent: customersTable.utmContent,
          utmTerm: customersTable.utmTerm,
        })
        .from(customersTable)
        .where(and(eq(customersTable.clientId, clientId), customerScope));

    let customers = await selectCampaignCustomers();
    const localExternalIds = new Set(customers.map((customer) => customer.externalId).filter(Boolean));
    const missingTrackingUserIds = trackingUserIds.filter((id) => !localExternalIds.has(String(id)));
    if (missingTrackingUserIds.length > 0) {
      const hydrated = await ensureUpzeroCustomersByIds({
        clientId,
        apiKey: client?.upZeroApiKey,
        userIds: missingTrackingUserIds,
      });
      if (hydrated.length > 0) {
        customers = await selectCampaignCustomers();
      }
    }

    const existingCampaignUsers = new Set(
      trackingRows
        .filter(isPaidCampaignSignal)
        .map((row) => getMetricUser(row)?.id)
        .filter((id): id is number => typeof id === "number"),
    );
    const localCampaignRows = customers
      .map((customer, index) => localCustomerToCampaignMetric(customer, index))
      .filter((row): row is UpzeroAnalyticsMetric => {
        if (!row) return false;
        const user = getMetricUser(row);
        return Boolean(user && !existingCampaignUsers.has(user.id) && isPaidCampaignSignal(row));
      });
    let rows = [...trackingRows, ...localCampaignRows];
    const userIds = [...new Set(rows.map((row) => getMetricUser(row)?.id).filter((id): id is number => typeof id === "number"))];
    const paidUserIds = new Set(
      rows
        .filter(isPaidCampaignSignal)
        .map((row) => getMetricUser(row)?.id)
        .filter((id): id is number => typeof id === "number"),
    );

    console.log({
      totalRows: rows.length,
      rowsWithUserObject: rows.filter((row) => row.user?.id).length,
      rowsWithUserId: rows.filter((row) => row.user_id).length,
      rowsWithAnyUser: rows.filter((row) => getMetricUser(row)).length,
      rowsWithPaidCampaignSignal: rows.filter(isPaidCampaignSignal).length,
      localCampaignRows: localCampaignRows.length,
      uniqueUsersWithAnyUser: userIds.length,
      uniqueUsersWithPaidCampaignSignal: paidUserIds.size,
      analyticsSource: tracking.source,
      periodFrom: upzeroRange.from,
      periodTo: upzeroRange.to,
      attributionHistoryFrom: attributionHistoryRange.from,
      attributionHistoryTo: attributionHistoryRange.to,
    });

    console.log(
      rows
        .filter((row) => getMetricUser(row) && isPaidCampaignSignal(row))
        .slice(0, 10)
        .map((row) => ({
          user: getMetricUser(row),
          eventName: row.event_name,
          utmSource: row.utm_source,
          utmMedium: row.utm_medium,
          utmCampaign: row.utm_campaign,
          fbc: row.fbc,
          fbclid: row.fbclid,
          gclid: row.gclid,
          periodStart: row.period_start,
        })),
    );

    const customerIds = customers.map((customer) => customer.id);
    const priorRows = customerIds.length > 0
      ? await db
          .select({
            customerId: ordersTable.customerId,
            priorOrders: sql<number>`COUNT(*)::int`,
          })
          .from(ordersTable)
          .where(
            and(
              eq(ordersTable.clientId, clientId),
              inArray(ordersTable.customerId, customerIds),
              lte(ordersTable.createdAt, from),
            ),
          )
          .groupBy(ordersTable.customerId)
      : [];
    const localOrderRows = customerIds.length > 0
      ? await db
          .select({
            customerId: ordersTable.customerId,
            externalId: ordersTable.externalId,
            amount: ordersTable.amount,
            createdAt: ordersTable.createdAt,
          })
          .from(ordersTable)
          .where(
            and(
              eq(ordersTable.clientId, clientId),
              inArray(ordersTable.customerId, customerIds),
              gte(ordersTable.createdAt, from),
              lte(ordersTable.createdAt, to),
            ),
          )
      : [];

    const localCustomerMap = new Map(
      customers
        .map((customer) => {
          const userId = Number.parseInt(customer.externalId ?? "", 10);
          return Number.isFinite(userId) ? [userId, customer] as const : null;
        })
        .filter((entry): entry is readonly [number, typeof customers[number]] => entry !== null),
    );
    const priorMap = new Map(priorRows.map((row) => [row.customerId, row.priorOrders]));
    const localOrderMap = new Map<string, CampaignLocalOrderSummary>();
    for (const order of localOrderRows) {
      const current = localOrderMap.get(order.customerId) ?? {
        purchaseCount: 0,
        orderIds: [],
        totalPurchaseValue: 0,
        lastOrderAt: null,
      };
      current.purchaseCount += 1;
      current.totalPurchaseValue += order.amount ?? 0;
      const numericExternalId = Number.parseInt(order.externalId ?? "", 10);
      if (Number.isFinite(numericExternalId)) current.orderIds.push(numericExternalId);
      const orderAt = order.createdAt.toISOString();
      if (!current.lastOrderAt || new Date(orderAt).getTime() > new Date(current.lastOrderAt).getTime()) {
        current.lastOrderAt = orderAt;
      }
      localOrderMap.set(order.customerId, current);
    }

    await stampCampaignAttributions({
      clientId,
      customers,
      rows,
      localOrders: localOrderMap,
    });

    const stampRows = customerIds.length > 0
      ? await db
          .select()
          .from(campaignAttributionStampsTable)
          .where(and(eq(campaignAttributionStampsTable.clientId, clientId), inArray(campaignAttributionStampsTable.customerId, customerIds)))
      : [];
    const localCustomerById = new Map(customers.map((customer) => [customer.id, customer]));
    const stampCampaignRows = stampRows
      .map((stamp, index) => {
        const customer = localCustomerById.get(stamp.customerId);
        return customer ? attributionStampToCampaignMetric(stamp, customer, index) : null;
      })
      .filter((row): row is UpzeroAnalyticsMetric => row !== null);
    rows = [...rows, ...stampCampaignRows];

    const allRows = buildAttributedCampaignCustomers(rows, localCustomerMap, priorMap, localOrderMap);
    const periodFromMs = new Date(upzeroRange.from).getTime();
    const periodToMs = new Date(upzeroRange.to).getTime();
    const isInSelectedPeriod = (value: string | null | undefined) => {
      if (!value) return false;
      const time = new Date(value).getTime();
      return Number.isFinite(time) && time >= periodFromMs && time <= periodToMs;
    };
    const periodAttributedUserIds = new Set(
      rows
        .filter((row) => isInSelectedPeriod(row.period_start) && isPaidCampaignSignal(row))
        .map((row) => getMetricUser(row)?.id)
        .filter((id): id is number => typeof id === "number"),
    );
    const periodLocalOrderUserIds = new Set(
      customers
        .filter((customer) => localOrderMap.has(customer.id))
        .map((customer) => Number.parseInt(customer.externalId ?? "", 10))
        .filter((id): id is number => Number.isFinite(id)),
    );
    const filteredRows = allRows.filter((row) => {
      const belongsToSelectedPeriod =
        periodAttributedUserIds.has(row.userId) ||
        periodLocalOrderUserIds.has(row.userId) ||
        isInSelectedPeriod(row.registeredAt) ||
        isInSelectedPeriod(row.lastEventAt);
      if (!belongsToSelectedPeriod) return false;
      if (parsed.data.source && row.lastTouch.source !== parsed.data.source) return false;
      if (parsed.data.campaign && !row.campaigns.some((campaign) => campaign.campaign === parsed.data.campaign)) return false;
      if (parsed.data.purchase === "yes" && !row.hasPurchase) return false;
      if (parsed.data.purchase === "no" && row.hasPurchase) return false;
      if (parsed.data.repurchase === "yes" && !row.isRepurchase) return false;
      if (parsed.data.repurchase === "no" && row.isRepurchase) return false;
      if (parsed.data.remarketing === "yes" && !row.isRemarketing) return false;
      if (parsed.data.remarketing === "no" && row.isRemarketing) return false;
      if (parsed.data.customerType && row.type !== parsed.data.customerType) return false;
      if (parsed.data.document === "CPF" && row.documentType !== "CPF") return false;
      if (parsed.data.document === "CNPJ" && row.documentType !== "CNPJ") return false;
      if (parsed.data.document === "none" && row.documentType !== null) return false;
      if (parsed.data.search) {
        const search = normalizeCampaignText(parsed.data.search);
        const haystack = [
          row.userId.toString(),
          row.name,
          row.email,
          row.companyName,
          row.cpf,
          row.cnpj,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });

    const visibleRows = filteredRows.slice(0, parsed.data.limit);
    const sources = Array.from(new Set(allRows.map((row) => row.lastTouch.source).filter((value): value is string => !!value))).sort();
    const campaigns = Array.from(
      new Set(allRows.flatMap((row) => row.campaigns.map((campaign) => campaign.campaign)).filter((value): value is string => !!value)),
    ).sort();
    const customerTypes = Array.from(new Set(allRows.map((row) => row.type).filter((value): value is string => !!value))).sort();

    res.json({
      rows: visibleRows,
      data: visibleRows,
      total: filteredRows.length,
      filters: {
        sources,
        campaigns,
        customerTypes,
      },
      summary: {
        impactedCustomers: filteredRows.length,
        attributedRevenue: filteredRows.reduce((sum, row) => sum + row.totalPurchaseValue, 0),
        orders: filteredRows.reduce((sum, row) => sum + row.purchaseCount, 0),
        itemQuantity: 0,
        registrations: filteredRows.reduce((sum, row) => sum + row.registerSubmittedCount, 0),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({
      error: true,
      code: "UPZERO_CAMPAIGN_CUSTOMERS_FAILED",
      message,
      status: 502,
    });
  }
});

router.get("/analytics/funnel", async (req, res): Promise<void> => {
  const parsed = GetFunnelQueryParams.safeParse(coerceDateQuery(req.query as Record<string, unknown>));
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }
  const clientId = requireClient(req, res);
  if (!clientId) return;
  const rawQuery = req.query as Record<string, unknown>;
  const { from, to } = dateRange(parsed.data.dateFrom, parsed.data.dateTo);
  const dateFromOnly = queryDateOnly(rawQuery, "dateFrom", from);
  const dateToOnly = queryDateOnly(rawQuery, "dateTo", to);
  const { utmSource, utmMedium, utmCampaign } = parsed.data;

  const [funnelClient] = await db
    .select({
      dashboardType: clientsTable.dashboardType,
      ga4PropertyId: clientsTable.ga4PropertyId,
    })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));

  if (funnelClient?.dashboardType === "B2C" && !utmSource && !utmMedium && !utmCampaign) {
    const ga4 = await fetchGa4FunnelMetrics({
      propertyId: funnelClient.ga4PropertyId,
      dateFrom: dateFromOnly,
      dateTo: dateToOnly,
    }).catch((err) => {
      console.warn("[funnel] GA4 unavailable:", err instanceof Error ? err.message : err);
      return null;
    });

    if (ga4?.source === "ga4") {
      const paidOrdersRow = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(ordersTable)
        .where(
          and(
            eq(ordersTable.clientId, clientId),
            gte(ordersTable.createdAt, from),
            lte(ordersTable.createdAt, to),
            sql`${ordersTable.status} IN ('APPROVED','SHIPPED','DELIVERED')`,
          ),
        );
      const paidOrders = Number(paidOrdersRow[0]?.count ?? 0);
      const counts = {
        SESSIONS: ga4.sessions,
        PAGE_VIEW: ga4.pageViews,
        PRODUCT_VIEW: ga4.productViews,
        ADD_TO_CART: ga4.addToCarts,
        CHECKOUT_STARTED: ga4.checkouts,
        PURCHASE: Math.max(ga4.purchases, paidOrders),
      };
      const funnelOrder = [
        { step: "SESSIONS", label: "Sessões" },
        { step: "PAGE_VIEW", label: "Visualizações" },
        { step: "PRODUCT_VIEW", label: "Produtos vistos" },
        { step: "ADD_TO_CART", label: "Adições ao carrinho" },
        { step: "CHECKOUT_STARTED", label: "Checkouts iniciados" },
        { step: "PURCHASE", label: "Pedidos" },
      ];
      const steps = funnelOrder.map((step, index) => {
        const count = counts[step.step as keyof typeof counts] ?? 0;
        const previous = index === 0 ? count : counts[funnelOrder[index - 1].step as keyof typeof counts] ?? 0;
        const conversionRate = index === 0 ? 100 : previous > 0 ? (count / previous) * 100 : 0;
        return {
          ...step,
          count,
          conversionRate,
          dropOffRate: index === 0 ? 0 : Math.max(0, 100 - conversionRate),
        };
      });
      const overallConversion = ga4.sessions > 0 ? (paidOrders / ga4.sessions) * 100 : 0;
      let worst = { idx: -1, drop: -1 };
      for (let i = 1; i < steps.length; i++) {
        if (steps[i].dropOffRate > worst.drop) worst = { idx: i, drop: steps[i].dropOffRate };
      }
      res.json(GetFunnelResponse.parse({
        steps,
        overallConversion,
        insights: [
          `Funil alimentado pelo GA4 com ${ga4.sessions} sessões no período.`,
          `Conversão geral de ${overallConversion.toFixed(2)}% calculada por pedidos pagos / sessões.`,
          ...(worst.idx > 0
            ? [`Maior queda (${worst.drop.toFixed(1)}%) entre ${steps[worst.idx - 1].label} e ${steps[worst.idx].label}.`]
            : []),
        ],
        avgEventsBeforePurchase: 0,
        topPaths: [],
        suggestedActions: buildFunnelSuggestedActions(worst, steps),
        hasSiteVisitData: ga4.sessions > 0,
      }));
      return;
    }
  }

  try {
    const [client] = await db
      .select({ upZeroApiKey: clientsTable.upZeroApiKey })
      .from(clientsTable)
      .where(eq(clientsTable.id, clientId));
    const upzeroRange = upzeroIsoRange(req.query as Record<string, unknown>, from, to);
    const tracking = await getUpzeroTrackingRows({
      ...upzeroRange,
      apiKey: client?.upZeroApiKey,
      context: "funnel",
    });
    const scopedMetrics = tracking.rows.filter((row) => {
      if (utmSource && row.utm_source?.toLowerCase() !== utmSource.toLowerCase()) return false;
      if (utmMedium && row.utm_medium?.toLowerCase() !== utmMedium.toLowerCase()) return false;
      if (utmCampaign && row.utm_campaign?.toLowerCase() !== utmCampaign.toLowerCase()) return false;
      return true;
    });
    const counts: Record<string, number> = {
      VISIT: 0,
      CATEGORY_VIEW: 0,
      PRODUCT_VIEW: 0,
      FORM_START: 0,
      REGISTER_START: 0,
      REGISTRATION: 0,
      APPROVED_REGISTRATION: 0,
      LOGIN: 0,
      ADD_TO_CART: 0,
      CHECKOUT_STARTED: 0,
      ORDER_CREATED: 0,
      PURCHASE: 0,
      PAYMENT_APPROVED: 0,
    };
    for (const row of scopedMetrics) {
      const value = row.total_events || 0;
      switch (row.event_name) {
        case "page_view":
          counts.VISIT += value;
          break;
        case "category_view":
          counts.CATEGORY_VIEW += value;
          break;
        case "product_view":
        case "product_item_impression":
          counts.PRODUCT_VIEW += value;
          break;
        case "form_start":
          counts.FORM_START += value;
          break;
        case "register_start":
          counts.REGISTER_START += value;
          break;
        case "register_submitted":
          counts.REGISTRATION += value;
          break;
        case "login":
          counts.LOGIN += value;
          break;
        case "add_to_cart":
          counts.ADD_TO_CART += value;
          break;
        case "initiate_checkout":
        case "checkout_start":
          counts.CHECKOUT_STARTED += value;
          break;
        case "order_created":
          counts.ORDER_CREATED += value;
          break;
        case "purchase":
          counts.PURCHASE += value;
          break;
        case "order_paid":
        case "payment_approved":
          counts.PAYMENT_APPROVED += value;
          break;
        default:
          break;
      }
    }

    const approvedConditions: SQL[] = [
      eq(customersTable.clientId, clientId),
      eq(customersTable.registrationStatus, "APPROVED"),
      gte(customersTable.createdAt, from),
      lte(customersTable.createdAt, to),
    ];
    if (utmSource) approvedConditions.push(sql`lower(${customersTable.utmSource}) = lower(${utmSource})`);
    if (utmMedium) approvedConditions.push(sql`lower(${customersTable.utmMedium}) = lower(${utmMedium})`);
    if (utmCampaign) approvedConditions.push(sql`lower(${customersTable.utmCampaign}) = lower(${utmCampaign})`);
    const [approvedRegistrations] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(customersTable)
      .where(and(...approvedConditions));
    counts.APPROVED_REGISTRATION = Number(approvedRegistrations?.count ?? 0);

    const funnelOrder: Array<{ step: string; label: string }> = [
      { step: "VISIT", label: "Visualizações de página" },
      { step: "CATEGORY_VIEW", label: "Categorias vistas" },
      { step: "PRODUCT_VIEW", label: "Produtos vistos" },
      { step: "FORM_START", label: "Formulários iniciados" },
      { step: "REGISTER_START", label: "Cadastros iniciados" },
      { step: "REGISTRATION", label: "Cadastros enviados" },
      { step: "APPROVED_REGISTRATION", label: "Cadastros aprovados" },
      { step: "LOGIN", label: "Logins" },
      { step: "ADD_TO_CART", label: "Adições ao carrinho" },
      { step: "CHECKOUT_STARTED", label: "Checkouts iniciados" },
      { step: "ORDER_CREATED", label: "Pedidos criados" },
      { step: "PURCHASE", label: "Compras" },
      { step: "PAYMENT_APPROVED", label: "Pagamentos aprovados" },
    ];
    const approvedBaseline = counts.APPROVED_REGISTRATION ?? 0;
    const postApprovalSteps = new Set(["LOGIN", "ADD_TO_CART", "CHECKOUT_STARTED", "ORDER_CREATED", "PURCHASE", "PAYMENT_APPROVED"]);
    const steps = funnelOrder.map((step, index) => {
      const count = counts[step.step] ?? 0;
      const previous = index === 0 ? count : counts[funnelOrder[index - 1].step] ?? 0;
      const conversionRate =
        index === 0
          ? 100
          : step.step === "APPROVED_REGISTRATION"
            ? previous > 0
              ? (count / previous) * 100
              : count > 0
                ? 100
                : 0
            : postApprovalSteps.has(step.step) && approvedBaseline > 0
              ? (count / approvedBaseline) * 100
              : previous > 0
                ? (count / previous) * 100
                : 0;
      return {
        ...step,
        count,
        conversionRate,
        dropOffRate: index === 0 ? 0 : 100 - conversionRate,
      };
    });
    const conversionCount = counts.PAYMENT_APPROVED || counts.PURCHASE || counts.ORDER_CREATED || 0;
    const overallConversion = approvedBaseline > 0 ? (conversionCount / approvedBaseline) * 100 : 0;
    let worst = { idx: -1, drop: -1 };
    for (let i = 1; i < steps.length; i++) {
      if (steps[i].dropOffRate > worst.drop) worst = { idx: i, drop: steps[i].dropOffRate };
    }
    const insights = [
      tracking.source === "facts"
        ? `Funil alimentado pela UP Zero com ${scopedMetrics.length} eventos granulares no período.`
        : `Funil alimentado pela UP Zero com ${scopedMetrics.length} linhas agregadas por hora no período.`,
      `Conversão geral de ${overallConversion.toFixed(2)}% calculada sobre ${approvedBaseline} cadastros aprovados.`,
    ];
    if (worst.idx > 0) {
      insights.unshift(
        `Maior queda (${worst.drop.toFixed(1)}%) entre ${steps[worst.idx - 1].label} e ${steps[worst.idx].label}.`,
      );
    }
    const avgEventsBeforePurchase = (() => {
      const byUser = new Map<number, UpzeroAnalyticsMetric[]>();
      for (const row of scopedMetrics) {
        const user = getMetricUser(row);
        if (!user) continue;
        const rows = byUser.get(user.id) ?? [];
        rows.push(row);
        byUser.set(user.id, rows);
      }
      const perBuyer: number[] = [];
      for (const rows of byUser.values()) {
        const sorted = rows.sort((a, b) => new Date(a.period_start).getTime() - new Date(b.period_start).getTime());
        const purchaseAt = sorted.find((row) =>
          ["purchase", "order_created", "order_paid", "payment_approved"].includes(row.event_name)
        )?.period_start;
        if (!purchaseAt) continue;
        const purchaseTime = new Date(purchaseAt).getTime();
        perBuyer.push(sorted.filter((row) => new Date(row.period_start).getTime() < purchaseTime).reduce((sum, row) => sum + row.total_events, 0));
      }
      return perBuyer.length > 0 ? perBuyer.reduce((sum, value) => sum + value, 0) / perBuyer.length : 0;
    })();

    res.json(GetFunnelResponse.parse({
      steps,
      overallConversion,
      insights,
      avgEventsBeforePurchase,
      topPaths: [],
      suggestedActions: buildFunnelSuggestedActions(worst, steps),
      hasSiteVisitData: counts.VISIT > 0,
    }));
    return;
  } catch (err) {
    console.warn("[funnel] UP Zero analytics metrics unavailable; falling back to local events:", err);
  }

  // If UTM filters are active, build a scoped customer list and restrict events to those customers.
  let scopedCustomerCond: SQL | undefined;
  if (utmSource || utmMedium || utmCampaign) {
    const custParts: SQL[] = [eq(customersTable.clientId, clientId)];
    if (utmSource) custParts.push(sql`lower(${customersTable.utmSource}) = lower(${utmSource})`);
    if (utmMedium) custParts.push(sql`lower(${customersTable.utmMedium}) = lower(${utmMedium})`);
    if (utmCampaign) custParts.push(sql`lower(${customersTable.utmCampaign}) = lower(${utmCampaign})`);
    const scopedIds = await db
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(and(...custParts));
    if (scopedIds.length === 0) {
      const emptySteps = [
        { step: "VISIT", label: "Site Visits" },
        { step: "REGISTRATION", label: "Registrations" },
        { step: "APPROVED_REGISTRATION", label: "Approved Leads" },
        { step: "ADD_TO_CART", label: "Added to Cart" },
        { step: "PURCHASE", label: "Purchases" },
      ].map((s, i) => ({ ...s, count: 0, conversionRate: i === 0 ? 100 : 0, dropOffRate: i === 0 ? 0 : 100 }));
      // Check hasSiteVisitData even on the early-return path so the notice logic is correct
      const hasSiteVisitDataRowsEarly = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(siteVisitsTable)
        .where(eq(siteVisitsTable.clientId, clientId));
      const hasSiteVisitDataEarly = Number(hasSiteVisitDataRowsEarly[0]?.count ?? 0) > 0;
      res.json(GetFunnelResponse.parse({
        steps: emptySteps,
        overallConversion: 0,
        insights: [],
        avgEventsBeforePurchase: 0,
        topPaths: [],
        suggestedActions: [],
        hasSiteVisitData: hasSiteVisitDataEarly,
      }));
      return;
    }
    scopedCustomerCond = inArray(eventsTable.customerId, scopedIds.map((r) => r.id));
  }

  const [eventCounts, visitTotals] = await Promise.all([
    db
      .select({
        eventType: eventsTable.eventType,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(eventsTable)
      .where(
        and(
          eq(eventsTable.clientId, clientId),
          gte(eventsTable.createdAt, from),
          lte(eventsTable.createdAt, to),
          scopedCustomerCond,
        ),
      )
      .groupBy(eventsTable.eventType),
    // Only pull site_visit totals when there are no UTM filters
    // (visit data is not UTM-scoped — it represents total site traffic)
    !utmSource && !utmMedium && !utmCampaign
      ? db
          .select({ total: sql<number>`COALESCE(SUM(${siteVisitsTable.visitCount}), 0)::int` })
          .from(siteVisitsTable)
          .where(
            and(
              eq(siteVisitsTable.clientId, clientId),
              gte(siteVisitsTable.visitDate, from.toISOString().slice(0, 10)),
              lte(siteVisitsTable.visitDate, to.toISOString().slice(0, 10)),
            ),
          )
      : Promise.resolve([{ total: 0 }]),
  ]);

  const counts: Record<string, number> = {};
  for (const row of eventCounts) {
    counts[row.eventType] = Number(row.count);
  }
  const approvedCustomerConditions: SQL[] = [
    eq(customersTable.clientId, clientId),
    eq(customersTable.registrationStatus, "APPROVED"),
    gte(customersTable.createdAt, from),
    lte(customersTable.createdAt, to),
  ];
  if (utmSource) approvedCustomerConditions.push(sql`lower(${customersTable.utmSource}) = lower(${utmSource})`);
  if (utmMedium) approvedCustomerConditions.push(sql`lower(${customersTable.utmMedium}) = lower(${utmMedium})`);
  if (utmCampaign) approvedCustomerConditions.push(sql`lower(${customersTable.utmCampaign}) = lower(${utmCampaign})`);
  const [approvedCustomerRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(customersTable)
    .where(and(...approvedCustomerConditions));
  counts.APPROVED_REGISTRATION = Number(approvedCustomerRow?.count ?? counts.APPROVED_REGISTRATION ?? 0);

  // Overlay site-visit data from the dedicated table (takes priority over any
  // VISIT events that might exist, since the table represents real web traffic)
  const siteVisitTotal = Number(visitTotals[0]?.total ?? 0);
  if (siteVisitTotal > 0) {
    counts["VISIT"] = siteVisitTotal;
  }

  const funnelOrder: Array<{ step: string; label: string }> = [
    { step: "VISIT", label: "Site Visits" },
    { step: "REGISTRATION", label: "Registrations" },
    { step: "APPROVED_REGISTRATION", label: "Approved Leads" },
    { step: "ADD_TO_CART", label: "Added to Cart" },
    { step: "PURCHASE", label: "Purchases" },
  ];

  // Enforce monotonic funnel: each step cannot exceed the previous step's count.
  // Special case: steps with no data (count = 0) — such as VISIT when the data
  // source doesn't track site visits — must not zero out all downstream steps.
  // We track `prev` as the last *non-zero* step count so that an absent step is
  // skipped in the monotonic chain (it has no data to constrain the next step).
  // Conversion rates are expressed relative to the last non-zero ancestor.
  let prev = Number.MAX_SAFE_INTEGER; // sentinel = "no data seen yet"
  const approvedBaseline = counts.APPROVED_REGISTRATION ?? 0;
  const postApprovalSteps = new Set(["ADD_TO_CART", "PURCHASE"]);
  const steps = funnelOrder.map((s, i) => {
    const raw = counts[s.step] ?? 0;
    // When prev is still MAX_SAFE_INTEGER we haven't seen any data yet,
    // so treat the current step as unconstrained (use raw directly).
    const effectivePrev = prev === Number.MAX_SAFE_INTEGER ? raw : prev;
    const count = Math.min(raw, effectivePrev);
    let conversionRate = 100;
    if (i > 0) {
      if (postApprovalSteps.has(s.step) && approvedBaseline > 0) {
        conversionRate = (count / approvedBaseline) * 100;
      } else if (prev > 0 && prev < Number.MAX_SAFE_INTEGER) {
        // Normal case: previous non-zero step exists — compute real conversion.
        conversionRate = (count / prev) * 100;
      } else if (count > 0) {
        // First step with actual data: it is its own baseline (100%).
        conversionRate = 100;
      } else {
        conversionRate = 0;
      }
    }
    const dropOffRate = i === 0 ? 0 : 100 - conversionRate;
    // Only advance prev when this step has actual data; zero steps are skipped.
    if (count > 0) prev = count;
    return {
      step: s.step,
      label: s.label,
      count,
      conversionRate,
      dropOffRate,
    };
  });

  // Overall conversion: purchases over approved registrations.
  const purchaseCount = counts.PURCHASE ?? 0;
  const overallConversion = approvedBaseline > 0 ? (purchaseCount / approvedBaseline) * 100 : 0;

  let worst = { idx: -1, drop: -1 };
  for (let i = 1; i < steps.length; i++) {
    if (steps[i].dropOffRate > worst.drop) {
      worst = { idx: i, drop: steps[i].dropOffRate };
    }
  }
  const insights: string[] = [];
  if (worst.idx > 0) {
    insights.push(
      `Highest drop-off (${worst.drop.toFixed(1)}%) occurs between ${steps[worst.idx - 1].label} and ${steps[worst.idx].label}.`,
    );
  }
  insights.push(
    `Overall funnel conversion is ${overallConversion.toFixed(2)}% from approved leads to purchase.`,
  );

  // Average events per customer that occurred BEFORE their first purchase in the window
  // (purchase-bounded: join to first-purchase timestamp, count only preceding events)
  const purchaseEventsRaw = await db.execute<{ avg_events: string }>(sql`
    SELECT COALESCE(AVG(cnt), 0)::float AS avg_events
    FROM (
      SELECT e.customer_id, COUNT(*) AS cnt
      FROM events e
      JOIN (
        SELECT customer_id, MIN(created_at) AS first_purchase_at
        FROM orders
        WHERE client_id = ${clientId}
          AND created_at >= ${from}
          AND created_at <= ${to}
          AND status IN ('APPROVED','SHIPPED','DELIVERED')
        GROUP BY customer_id
      ) fp ON fp.customer_id = e.customer_id
      WHERE e.client_id = ${clientId}
        AND e.created_at >= ${from}
        AND e.created_at < fp.first_purchase_at
      GROUP BY e.customer_id
    ) sub
  `);
  const [purchaseEventsAgg] = (purchaseEventsRaw.rows ?? purchaseEventsRaw) as unknown as { avg_events: string }[];
  const avgEventsBeforePurchase = Number(purchaseEventsAgg?.avg_events) || 0;

  // Top-3 event paths (sequences for buyers)
  const topPaths = await buildTopPaths(clientId, from, to, 3);

  // Suggested actions based on biggest drop-off step
  const suggestedActions = buildFunnelSuggestedActions(worst, steps);

  // Check if ANY site visit data exists for this client (not range-scoped) so the
  // "About this data" notice in the UI hides once a data source is connected.
  const hasSiteVisitDataRows = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(siteVisitsTable)
    .where(eq(siteVisitsTable.clientId, clientId));
  const hasSiteVisitData = Number(hasSiteVisitDataRows[0]?.count ?? 0) > 0;

  res.json(GetFunnelResponse.parse({ steps, overallConversion, insights, avgEventsBeforePurchase, topPaths, suggestedActions, hasSiteVisitData }));
});

// ─── Site Visits: GET ────────────────────────────────────────────────────────

const GetSiteVisitsQueryParams = GetFunnelQueryParams.pick({ clientId: true, dateFrom: true, dateTo: true });

router.get("/analytics/site-visits", async (req, res): Promise<void> => {
  const parsed = GetSiteVisitsQueryParams.safeParse(coerceDateQuery(req.query as Record<string, unknown>));
  if (!parsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }
  const clientId = requireClient(req, res);
  if (!clientId) return;
  const { from, to } = dateRange(parsed.data.dateFrom, parsed.data.dateTo);

  const [rows, purchaseRows] = await Promise.all([
    db
      .select()
      .from(siteVisitsTable)
      .where(
        and(
          eq(siteVisitsTable.clientId, clientId),
          gte(siteVisitsTable.visitDate, from.toISOString().slice(0, 10)),
          lte(siteVisitsTable.visitDate, to.toISOString().slice(0, 10)),
        ),
      )
      .orderBy(siteVisitsTable.visitDate),
    db
      .select({
        date: sql<string>`to_char(date_trunc('day', ${eventsTable.createdAt}), 'YYYY-MM-DD')`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(eventsTable)
      .where(
        and(
          eq(eventsTable.clientId, clientId),
          eq(eventsTable.eventType, "PURCHASE"),
          gte(eventsTable.createdAt, from),
          lte(eventsTable.createdAt, to),
        ),
      )
      .groupBy(sql`date_trunc('day', ${eventsTable.createdAt})`)
      .orderBy(sql`date_trunc('day', ${eventsTable.createdAt})`),
  ]);

  const totalVisits = rows.reduce((sum, r) => sum + r.visitCount, 0);
  const dailyPurchases = purchaseRows.map((r) => ({ date: r.date, count: Number(r.count) || 0 }));
  res.json({ rows, totalVisits, dailyPurchases });
});

// ─── Site Visits: POST (upsert) ───────────────────────────────────────────────

const UpsertSiteVisitsBody = z.object({
  clientId: z.string().optional(),
  rows: z.array(
    z.object({
      visitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "visitDate must be YYYY-MM-DD"),
      visitCount: z.number().int().min(0),
    }),
  ).min(1).max(366),
});

router.post("/analytics/site-visits", requireAdmin, async (req, res): Promise<void> => {
  const parsed = UpsertSiteVisitsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }

  // Admins can specify a clientId; fall back to the authenticated client's id
  const targetClientId = parsed.data.clientId ?? resolveClientId(req);
  if (!targetClientId) {
    res.status(400).json({ error: true, code: "CLIENT_REQUIRED", message: "clientId is required", status: 400 });
    return;
  }

  const values = parsed.data.rows.map((r) => ({
    clientId: targetClientId,
    visitDate: r.visitDate,
    visitCount: r.visitCount,
  }));

  const upserted = await db
    .insert(siteVisitsTable)
    .values(values.map((v) => ({ ...v, id: nanoid() })))
    .onConflictDoUpdate({
      target: [siteVisitsTable.clientId, siteVisitsTable.visitDate],
      set: { visitCount: sql`EXCLUDED.visit_count` },
    })
    .returning();

  const totalVisits = upserted.reduce((sum, r) => sum + r.visitCount, 0);
  res.json({ rows: upserted, totalVisits });
});

router.get("/analytics/customers", async (req, res): Promise<void> => {
  const parsed = GetCustomersQueryParams.safeParse(coerceDateQuery(req.query as Record<string, unknown>));
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }
  const clientId = requireClient(req, res);
  if (!clientId) return;
  const {
    dateFrom,
    dateTo,
    rfmSegment,
    state,
    utmSource: custUtmSource,
    utmMedium: custUtmMedium,
    search,
    documentType,
    registrationStatus,
    purchaseStatus,
    sortBy = "totalSpent",
    sortDir = "desc",
    page = 1,
    limit = 20,
  } = parsed.data;
  const customerRange = customerDateQueryRange(req.query as Record<string, unknown>, dateFrom, dateTo);

  const conditions: SQL[] = [eq(customersTable.clientId, clientId)];
  if (customerRange.from) conditions.push(gte(customersTable.createdAt, customerRange.from));
  if (customerRange.to) conditions.push(lte(customersTable.createdAt, customerRange.to));
  if (rfmSegment) conditions.push(eq(customersTable.rfmSegment, rfmSegment));
  if (state) conditions.push(eq(customersTable.state, state));
  if (custUtmSource) conditions.push(eq(customersTable.utmSource, custUtmSource));
  if (custUtmMedium) conditions.push(eq(customersTable.utmMedium, custUtmMedium));
  if (documentType) conditions.push(eq(customersTable.documentType, documentType));
  if (registrationStatus) conditions.push(eq(customersTable.registrationStatus, registrationStatus));
  if (purchaseStatus === "buyers") conditions.push(sql`${customersTable.totalOrders} > 0`);
  if (purchaseStatus === "non_buyers") conditions.push(eq(customersTable.totalOrders, 0));
  if (search) {
    const searchCond = or(
      ilike(customersTable.email, `%${search}%`),
      ilike(customersTable.name, `%${search}%`),
    );
    if (searchCond) conditions.push(searchCond);
  }
  const where = and(...conditions);

  const offset = (page - 1) * limit;
  const sortColumns = {
    totalSpent: customersTable.totalSpent,
    totalOrders: customersTable.totalOrders,
    createdAt: customersTable.createdAt,
    firstPurchaseAt: customersTable.firstPurchaseAt,
    lastPurchaseAt: customersTable.lastPurchaseAt,
    name: customersTable.name,
  } as const;
  const sortColumn = sortColumns[sortBy as keyof typeof sortColumns] ?? customersTable.totalSpent;

  const data = await db
    .select()
    .from(customersTable)
    .where(where)
    .orderBy(sortDir === "asc" ? asc(sortColumn) : desc(sortColumn))
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(customersTable)
    .where(where);

  const segmentCounts = await db
    .select({
      segment: sql<string>`COALESCE(${customersTable.rfmSegment}, 'Unsegmented')`,
      count: sql<number>`count(*)::int`,
    })
    .from(customersTable)
    .where(where)
    .groupBy(customersTable.rfmSegment);

  res.json(
    GetCustomersResponse.parse({
      data: data.map((c) => ({ ...c, opportunityLevel: deriveOpportunityLevel(c) })),
      total: count,
      page,
      pages: Math.max(1, Math.ceil(count / limit)),
      segmentCounts,
    }),
  );
});

// ─── Customer Summary KPI computation (module-level for reuse in insights) ──
async function computeSummaryKpis(clientId: string, winFrom: Date, winTo: Date) {
    const [statusRow] = await db
      .select({
        total: sql<number>`count(*)::int`,
        approved: sql<number>`count(*) filter (where ${customersTable.registrationStatus} = 'APPROVED')::int`,
        pending: sql<number>`count(*) filter (where ${customersTable.registrationStatus} = 'PENDING')::int`,
        rejected: sql<number>`count(*) filter (where ${customersTable.registrationStatus} = 'REJECTED')::int`,
      })
      .from(customersTable)
      .where(
        and(
          eq(customersTable.clientId, clientId as string),
          gte(customersTable.createdAt, winFrom),
          lte(customersTable.createdAt, winTo),
        ),
      );

    const [buyersRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(customersTable)
      .where(
        and(
          eq(customersTable.clientId, clientId as string),
          gte(customersTable.createdAt, winFrom),
          lte(customersTable.createdAt, winTo),
          eq(customersTable.registrationStatus, "APPROVED"),
          sql`${customersTable.firstPurchaseAt} is not null`,
        ),
      );

    const [noBuyersRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(customersTable)
      .where(
        and(
          eq(customersTable.clientId, clientId as string),
          gte(customersTable.createdAt, winFrom),
          lte(customersTable.createdAt, winTo),
          eq(customersTable.registrationStatus, "APPROVED"),
          eq(customersTable.totalOrders, 0),
        ),
      );

    const [timeToFirstRow] = await db
      .select({
        avg: sql<number | null>`avg(extract(epoch from (${customersTable.firstPurchaseAt} - ${customersTable.createdAt})) / 86400)`,
      })
      .from(customersTable)
      .where(
        and(
          eq(customersTable.clientId, clientId as string),
          gte(customersTable.createdAt, winFrom),
          lte(customersTable.createdAt, winTo),
          sql`${customersTable.firstPurchaseAt} is not null`,
          sql`${customersTable.firstPurchaseAt} >= ${customersTable.createdAt}`,
        ),
      );

    const [timeBetweenRow] = await db
      .select({
        avg: sql<number | null>`avg(
          case when ${customersTable.totalOrders} > 1
          then extract(epoch from (${customersTable.lastPurchaseAt} - ${customersTable.firstPurchaseAt})) / 86400 / (${customersTable.totalOrders} - 1)
          else null end
        )`,
      })
      .from(customersTable)
      .where(
        and(
          eq(customersTable.clientId, clientId as string),
          gte(customersTable.createdAt, winFrom),
          lte(customersTable.createdAt, winTo),
          sql`${customersTable.totalOrders} > 1`,
        ),
      );

    const total = statusRow?.total ?? 0;
    const approved = statusRow?.approved ?? 0;

    return {
      totalRegistrations: total,
      approvedRegistrations: approved,
      pendingRegistrations: statusRow?.pending ?? 0,
      rejectedRegistrations: statusRow?.rejected ?? 0,
      approvalRatePct: total > 0 ? Math.round((approved / total) * 1000) / 10 : 0,
      customersWithoutPurchase: noBuyersRow?.count ?? 0,
      totalBuyers: buyersRow?.count ?? 0,
      avgTimeToFirstPurchaseDays:
        timeToFirstRow?.avg != null ? Math.round(timeToFirstRow.avg * 10) / 10 : null,
      avgTimeBetweenPurchasesDays:
        timeBetweenRow?.avg != null ? Math.round(timeBetweenRow.avg * 10) / 10 : null,
    };
}

// ─── Customer Summary (CRM KPI strip) ───────────────────────────────────────
router.get("/analytics/customers/summary", async (req, res): Promise<void> => {
  const parsed = GetCustomerSummaryQueryParams.safeParse(
    coerceDateQuery(req.query as Record<string, unknown>),
  );
  if (!parsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }
  const clientId = requireClient(req, res);
  if (!clientId) return;

  const { dateFrom, dateTo, compare } = parsed.data;
  const customerRange = customerDateQueryRange(req.query as Record<string, unknown>, dateFrom, dateTo);
  const hasExplicitRange = Boolean(customerRange.from && customerRange.to);
  const { from, to } = hasExplicitRange
    ? dateRange(customerRange.from, customerRange.to)
    : { from: new Date(0), to: new Date() };

  const winLenMs = to.getTime() - from.getTime();
  const prevFrom = new Date(from.getTime() - winLenMs);
  const prevTo = new Date(from.getTime());

  const [kpis, prevKpisRaw, registrationsOverTime, registrationsByState, registrationsBySource] =
    await Promise.all([
      computeSummaryKpis(clientId, from, to),
      compare && hasExplicitRange ? computeSummaryKpis(clientId, prevFrom, prevTo) : null,
      db
        .select({
          date: sql<string>`to_char(date_trunc('day', ${customersTable.createdAt}), 'YYYY-MM-DD')`,
          registrations: sql<number>`count(*)::int`,
          approved: sql<number>`sum(case when ${customersTable.registrationStatus} = 'APPROVED' then 1 else 0 end)::int`,
        })
        .from(customersTable)
        .where(
          and(
            eq(customersTable.clientId, clientId),
            gte(customersTable.createdAt, from),
            lte(customersTable.createdAt, to),
          ),
        )
        .groupBy(sql`date_trunc('day', ${customersTable.createdAt})`)
        .orderBy(sql`date_trunc('day', ${customersTable.createdAt})`),
      db
        .select({
          state: sql<string>`coalesce(${customersTable.state}, 'Unknown')`,
          count: sql<number>`count(*)::int`,
        })
        .from(customersTable)
        .where(
          and(
            eq(customersTable.clientId, clientId),
            gte(customersTable.createdAt, from),
            lte(customersTable.createdAt, to),
          ),
        )
        .groupBy(customersTable.state)
        .orderBy(sql`count(*) desc`)
        .limit(10),
      db
        .select({
          source: sql<string>`coalesce(${customersTable.utmSource}, 'Direct')`,
          count: sql<number>`count(*)::int`,
        })
        .from(customersTable)
        .where(
          and(
            eq(customersTable.clientId, clientId),
            gte(customersTable.createdAt, from),
            lte(customersTable.createdAt, to),
          ),
        )
        .groupBy(customersTable.utmSource)
        .orderBy(sql`count(*) desc`)
        .limit(10),
    ]);

  const payload: Record<string, unknown> = {
    kpis,
    registrationsOverTime,
    registrationsByState,
    registrationsBySource,
  };
  if (prevKpisRaw) payload.prevKpis = prevKpisRaw;

  res.json(GetCustomerSummaryResponse.parse(payload));
});

// ─── Customer Detail ─────────────────────────────────────────────────────────
function deriveOpportunityLevel(c: { rfmSegment: string | null; totalOrders: number }): string {
  if (c.rfmSegment === "Champions") return "CHAMPION";
  if (c.rfmSegment === "Loyal") return "HIGH";
  if (c.rfmSegment === "Potential") return "MEDIUM";
  if (c.rfmSegment === "At Risk" || c.rfmSegment === "Lost") return "LOW";
  if (c.totalOrders > 5) return "HIGH";
  if (c.totalOrders > 0) return "MEDIUM";
  return "LOW";
}

const CustomerTimelineQueryParams = z.object({
  clientId: z.coerce.string().optional(),
  from: z.string().datetime(),
  to: z.string().datetime(),
  lookbackDays: z.coerce.number().int().min(1).max(365).default(30),
});

type LocalCustomerTimelineEvent = {
  id: string;
  userId: number;
  occurredAt: string;
  periodType: string;
  eventName: string;
  eventLabel: string;
  productId: number | null;
  productName: string | null;
  productSku: string | null;
  productImageUrl: string | null;
  categoryId: number | null;
  categoryName: string | null;
  orderId: number | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  normalizedSource: string;
  normalizedMedium: string;
  deviceType: string | null;
  totalEvents: number;
  totalQuantity: number;
  totalValue: number;
  attributionType: "first_touch" | "last_touch" | "return_touch" | "direct" | null;
  rawMetricId: number;
  updatedAt: string;
  eventId: string | null;
  anonymousId: string | null;
  sessionId: string | null;
  visitorId: string | null;
  fbclid: string | null;
  fbc: string | null;
  fbp: string | null;
  gclid: string | null;
  landingUrl: string | null;
  landingHost: string | null;
  landingPath: string | null;
  referrer: string | null;
  referrerHost: string | null;
  utmContent: string | null;
  utmTerm: string | null;
};

function localTimelineEventBase(params: {
  id: string;
  userId: number;
  occurredAt: Date;
  eventName: string;
  eventLabel: string;
  totalEvents?: number;
  totalQuantity?: number;
  totalValue?: number;
  orderId?: number | null;
  product?: {
    id: string | null;
    externalId: string | null;
    name: string | null;
    sku: string | null;
    category: string | null;
    imageUrl: string | null;
  } | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
}): LocalCustomerTimelineEvent {
  const productExternalId = Number.parseInt(params.product?.externalId ?? params.product?.id ?? "", 10);
  return {
    id: params.id,
    userId: params.userId,
    occurredAt: params.occurredAt.toISOString(),
    periodType: "local",
    eventName: params.eventName,
    eventLabel: params.eventLabel,
    productId: Number.isFinite(productExternalId) ? productExternalId : null,
    productName: params.product?.name ?? null,
    productSku: params.product?.sku ?? null,
    productImageUrl: params.product?.imageUrl ?? null,
    categoryId: null,
    categoryName: params.product?.category ?? null,
    orderId: params.orderId ?? null,
    utmSource: params.utmSource ?? null,
    utmMedium: params.utmMedium ?? null,
    utmCampaign: params.utmCampaign ?? null,
    normalizedSource: params.utmSource ?? "Direto / Não identificado",
    normalizedMedium: params.utmMedium ?? "Não identificado",
    deviceType: null,
    totalEvents: params.totalEvents ?? 1,
    totalQuantity: params.totalQuantity ?? 0,
    totalValue: params.totalValue ?? 0,
    attributionType: params.utmCampaign ? "first_touch" : null,
    rawMetricId: 0,
    updatedAt: params.occurredAt.toISOString(),
    eventId: params.id,
    anonymousId: null,
    sessionId: null,
    visitorId: null,
    fbclid: null,
    fbc: null,
    fbp: null,
    gclid: null,
    landingUrl: null,
    landingHost: null,
    landingPath: null,
    referrer: null,
    referrerHost: null,
    utmContent: params.utmContent ?? null,
    utmTerm: params.utmTerm ?? null,
  };
}

function summarizeLocalTimeline(timeline: LocalCustomerTimelineEvent[]) {
  const purchaseEvents = timeline.filter((event) => ["purchase", "order_paid", "payment_approved"].includes(event.eventName));
  return {
    totalEvents: timeline.reduce((sum, event) => sum + event.totalEvents, 0),
    productViews: timeline.filter((event) => event.eventName === "product_view").reduce((sum, event) => sum + event.totalEvents, 0),
    categoryViews: timeline.filter((event) => event.eventName === "category_view").reduce((sum, event) => sum + event.totalEvents, 0),
    formStarts: timeline.filter((event) => event.eventName === "form_start").reduce((sum, event) => sum + event.totalEvents, 0),
    registerStarts: timeline.filter((event) => event.eventName === "register_start").reduce((sum, event) => sum + event.totalEvents, 0),
    registerSubmitted: timeline.filter((event) => event.eventName === "register_submitted").reduce((sum, event) => sum + event.totalEvents, 0),
    logins: timeline.filter((event) => event.eventName === "login").reduce((sum, event) => sum + event.totalEvents, 0),
    addToCartEvents: timeline.filter((event) => event.eventName === "add_to_cart").reduce((sum, event) => sum + event.totalEvents, 0),
    checkoutStarts: timeline.filter((event) => ["initiate_checkout", "checkout_start"].includes(event.eventName)).reduce((sum, event) => sum + event.totalEvents, 0),
    purchases: purchaseEvents.reduce((sum, event) => sum + event.totalEvents, 0),
    totalCartValue: timeline.filter((event) => event.eventName === "add_to_cart").reduce((sum, event) => sum + event.totalValue, 0),
    totalPurchaseValue: purchaseEvents.reduce((sum, event) => sum + event.totalValue, 0),
    firstSeenAt: timeline[0]?.occurredAt ?? null,
    lastSeenAt: timeline[timeline.length - 1]?.occurredAt ?? null,
  };
}

function minDateValue(values: Array<Date | null | undefined>): Date | null {
  const times = values
    .map((value) => value?.getTime())
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (times.length === 0) return null;
  return new Date(Math.min(...times));
}

function localTimelinePriority(eventName: string): number {
  if (eventName === "register_submitted") return 10;
  if (eventName === "registration_approved") return 20;
  if (eventName === "page_view") return 30;
  if (eventName === "product_view") return 40;
  if (eventName === "add_to_cart") return 50;
  if (["initiate_checkout", "checkout_start"].includes(eventName)) return 60;
  if (eventName === "order_created") return 70;
  if (["purchase", "order_paid", "payment_approved"].includes(eventName)) return 80;
  return 999;
}

async function buildLocalCustomerTimelineResponse(params: {
  clientId: string;
  customerId: string;
  userId: number;
}) {
  const [customer] = await db
    .select()
    .from(customersTable)
    .where(and(eq(customersTable.id, params.customerId), eq(customersTable.clientId, params.clientId)));
  if (!customer) return null;

  const [events, orders] = await Promise.all([
    db
      .select({
        id: eventsTable.id,
        eventType: eventsTable.eventType,
        orderId: eventsTable.orderId,
        createdAt: eventsTable.createdAt,
        productId: productsTable.id,
        productExternalId: productsTable.externalId,
        productName: productsTable.name,
        productSku: productsTable.sku,
        productCategory: productsTable.category,
        productImageUrl: productsTable.imageUrl,
      })
      .from(eventsTable)
      .leftJoin(productsTable, eq(eventsTable.productId, productsTable.id))
      .where(and(eq(eventsTable.customerId, params.customerId), eq(eventsTable.clientId, params.clientId)))
      .orderBy(asc(eventsTable.createdAt))
      .limit(300),
    db
      .select({
        id: ordersTable.id,
        externalId: ordersTable.externalId,
        amount: ordersTable.amount,
        requestedQuantity: ordersTable.requestedQuantity,
        status: ordersTable.status,
        createdAt: ordersTable.createdAt,
      })
      .from(ordersTable)
      .where(and(eq(ordersTable.customerId, params.customerId), eq(ordersTable.clientId, params.clientId)))
      .orderBy(asc(ordersTable.createdAt))
      .limit(100),
  ]);

  const firstOrderAt = orders[0]?.createdAt ?? null;
  const registrationEventAt = minDateValue(events.filter((event) => event.eventType === "REGISTRATION").map((event) => event.createdAt));
  const approvedEventAt = minDateValue(events.filter((event) => event.eventType === "APPROVED_REGISTRATION").map((event) => event.createdAt));
  const customerCreatedLooksImported = Boolean(firstOrderAt && customer.createdAt.getTime() > firstOrderAt.getTime());
  let registrationAt = customerCreatedLooksImported
    ? firstOrderAt
    : registrationEventAt ?? customer.createdAt;
  let approvalAt = customer.approvalDate ?? approvedEventAt;
  if (approvalAt && firstOrderAt && approvalAt.getTime() > firstOrderAt.getTime()) {
    approvalAt = firstOrderAt;
  }
  if (approvalAt && approvalAt.getTime() < registrationAt.getTime()) {
    registrationAt = approvalAt;
  }

  const timeline: LocalCustomerTimelineEvent[] = [
    localTimelineEventBase({
      id: `local_customer_registered_${customer.id}`,
      userId: params.userId,
      occurredAt: registrationAt,
      eventName: "register_submitted",
      eventLabel: "Cadastro enviado",
      utmSource: customer.utmSource,
      utmMedium: customer.utmMedium,
      utmCampaign: customer.utmCampaign,
      utmContent: customer.utmContent,
      utmTerm: customer.utmTerm,
    }),
  ];

  if (approvalAt) {
    timeline.push(localTimelineEventBase({
      id: `local_customer_approved_${customer.id}`,
      userId: params.userId,
      occurredAt: approvalAt,
      eventName: "registration_approved",
      eventLabel: "Cadastro aprovado",
      utmSource: customer.utmSource,
      utmMedium: customer.utmMedium,
      utmCampaign: customer.utmCampaign,
      utmContent: customer.utmContent,
      utmTerm: customer.utmTerm,
    }));
  }

  const eventNameMap: Record<string, { name: string; label: string }> = {
    VISIT: { name: "page_view", label: "Visitou o site" },
    REGISTRATION: { name: "register_submitted", label: "Cadastro enviado" },
    APPROVED_REGISTRATION: { name: "registration_approved", label: "Cadastro aprovado" },
    PRODUCT_VIEW: { name: "product_view", label: "Visualizou produto" },
    ADD_TO_CART: { name: "add_to_cart", label: "Adicionou ao carrinho" },
    CHECKOUT_STARTED: { name: "checkout_start", label: "Iniciou checkout" },
    PURCHASE: { name: "purchase", label: "Realizou compra" },
  };

  for (const event of events) {
    if (event.eventType === "REGISTRATION") continue;
    if (event.eventType === "APPROVED_REGISTRATION" && approvalAt) continue;
    const mapped = eventNameMap[event.eventType] ?? { name: event.eventType.toLowerCase(), label: event.eventType };
    timeline.push(localTimelineEventBase({
      id: `local_event_${event.id}`,
      userId: params.userId,
      occurredAt: event.createdAt,
      eventName: mapped.name,
      eventLabel: mapped.label,
      orderId: event.orderId ? Number.parseInt(event.orderId, 10) || null : null,
      product: event.productId ? {
        id: event.productId,
        externalId: event.productExternalId,
        name: event.productName,
        sku: event.productSku,
        category: event.productCategory,
        imageUrl: event.productImageUrl,
      } : null,
      utmSource: customer.utmSource,
      utmMedium: customer.utmMedium,
      utmCampaign: customer.utmCampaign,
      utmContent: customer.utmContent,
      utmTerm: customer.utmTerm,
    }));
  }

  const purchaseOrderIdsFromEvents = new Set(
    events
      .filter((event) => event.eventType === "PURCHASE" && event.orderId)
      .map((event) => event.orderId),
  );

  for (const order of orders) {
    if (purchaseOrderIdsFromEvents.has(order.id)) continue;
    const numericOrderId = Number.parseInt(order.externalId ?? order.id, 10);
    timeline.push(localTimelineEventBase({
      id: `local_order_${order.id}`,
      userId: params.userId,
      occurredAt: order.createdAt,
      eventName: order.status === "APPROVED" || order.status === "SHIPPED" || order.status === "DELIVERED" ? "purchase" : "order_created",
      eventLabel: order.status === "APPROVED" || order.status === "SHIPPED" || order.status === "DELIVERED" ? "Realizou compra" : "Pedido criado",
      orderId: Number.isFinite(numericOrderId) ? numericOrderId : null,
      totalQuantity: order.requestedQuantity,
      totalValue: order.amount,
      utmSource: customer.utmSource,
      utmMedium: customer.utmMedium,
      utmCampaign: customer.utmCampaign,
      utmContent: customer.utmContent,
      utmTerm: customer.utmTerm,
    }));
  }

  timeline.sort((a, b) => {
    const timeDiff = new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    return localTimelinePriority(a.eventName) - localTimelinePriority(b.eventName);
  });

  const firstTouch = timeline.find((event) => event.utmCampaign || event.utmSource || event.utmMedium);
  const touch = firstTouch
    ? {
        source: firstTouch.utmSource,
        medium: firstTouch.utmMedium,
        campaign: firstTouch.utmCampaign,
        occurredAt: firstTouch.occurredAt,
      }
    : { source: null, medium: null, campaign: null, occurredAt: null };

  return {
    userId: params.userId,
    attribution: {
      firstTouch: touch,
      lastTouch: touch,
      lastReturn: { source: null, medium: null, campaign: null, occurredAt: null },
    },
    summary: summarizeLocalTimeline(timeline),
    timeline,
  };
}

const CampaignCustomerTimelineQueryParams = GetDashboardQueryParams.pick({
  clientId: true,
  dateFrom: true,
  dateTo: true,
}).extend({
  userId: z.coerce.number().int().positive(),
  lookbackDays: z.coerce.number().int().min(1).max(365).default(30),
});

router.get("/analytics/customer-timeline-by-user", async (req, res): Promise<void> => {
  const queryParsed = CampaignCustomerTimelineQueryParams.safeParse(
    coerceDateQuery(req.query as Record<string, unknown>),
  );
  if (!queryParsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: queryParsed.error.message, status: 400 });
    return;
  }

  const clientId = resolveClientId(req) ?? queryParsed.data.clientId;
  if (!clientId) {
    res.status(400).json({ error: true, code: "CLIENT_REQUIRED", message: "clientId is required for admin users", status: 400 });
    return;
  }

  const { from, to } = dateRange(queryParsed.data.dateFrom, queryParsed.data.dateTo);
  const upzeroRange = upzeroIsoRange(req.query as Record<string, unknown>, from, to);
  const [client] = await db
    .select({ upZeroApiKey: clientsTable.upZeroApiKey })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));

  try {
    const tracking = await getUpzeroTrackingRows({
      ...upzeroRange,
      apiKey: client?.upZeroApiKey,
      context: "customer-timeline-by-user",
    });

    res.json(
      buildCustomerTimelineResponse(
        queryParsed.data.userId,
        await enrichRowsWithProductImages(tracking.rows, clientId),
        queryParsed.data.lookbackDays,
      ),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({
      error: true,
      code: "UPZERO_ANALYTICS_FAILED",
      message,
      status: 502,
    });
  }
});

router.get("/analytics/customers/:customerId/timeline", async (req, res): Promise<void> => {
  const pathParsed = GetCustomerDetailParams.safeParse(req.params);
  if (!pathParsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: pathParsed.error.message, status: 400 });
    return;
  }
  const queryParsed = CustomerTimelineQueryParams.safeParse(req.query);
  if (!queryParsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: queryParsed.error.message, status: 400 });
    return;
  }

  const clientId = resolveClientId(req) ?? queryParsed.data.clientId;
  if (!clientId) {
    res.status(400).json({ error: true, code: "CLIENT_REQUIRED", message: "clientId is required for admin users", status: 400 });
    return;
  }

  const { customerId } = pathParsed.data;
  const [customer, client] = await Promise.all([
    db
      .select({
        id: customersTable.id,
        externalId: customersTable.externalId,
      })
      .from(customersTable)
      .where(and(eq(customersTable.id, customerId), eq(customersTable.clientId, clientId))),
    db
      .select({
        upZeroApiKey: clientsTable.upZeroApiKey,
      })
      .from(clientsTable)
      .where(eq(clientsTable.id, clientId)),
  ]);

  if (!customer[0]) {
    res.status(404).json({ error: true, code: "NOT_FOUND", message: "Customer not found", status: 404 });
    return;
  }

  const userId = Number.parseInt(customer[0].externalId ?? "", 10);
  if (!Number.isFinite(userId) || userId <= 0) {
    const localTimeline = await buildLocalCustomerTimelineResponse({
      clientId,
      customerId,
      userId: 0,
    });
    if (!localTimeline) {
      res.status(404).json({ error: true, code: "NOT_FOUND", message: "Customer not found", status: 404 });
      return;
    }
    res.json(localTimeline);
    return;
  }

  try {
    const tracking = await getUpzeroTrackingRows({
      from: queryParsed.data.from,
      to: queryParsed.data.to,
      apiKey: client[0]?.upZeroApiKey,
      context: "customer-timeline",
    });

    const upzeroTimeline = buildCustomerTimelineResponse(
      userId,
      await enrichRowsWithProductImages(tracking.rows, clientId),
      queryParsed.data.lookbackDays,
    );
    if (upzeroTimeline.timeline.length > 0) {
      res.json(upzeroTimeline);
      return;
    }
    const localTimeline = await buildLocalCustomerTimelineResponse({
      clientId,
      customerId,
      userId,
    });
    res.json(localTimeline ?? upzeroTimeline);
  } catch (err) {
    const localTimeline = await buildLocalCustomerTimelineResponse({
      clientId,
      customerId,
      userId,
    });
    if (localTimeline) {
      res.json(localTimeline);
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: true, code: "UPZERO_ANALYTICS_FAILED", message, status: 502 });
  }
});

router.get("/analytics/customers/:customerId", async (req, res): Promise<void> => {
  const pathParsed = GetCustomerDetailParams.safeParse(req.params);
  if (!pathParsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: pathParsed.error.message, status: 400 });
    return;
  }
  const queryParsed = GetCustomerDetailQueryParams.safeParse(req.query);
  if (!queryParsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: queryParsed.error.message, status: 400 });
    return;
  }

  const clientId = resolveClientId(req) ?? queryParsed.data.clientId;
  if (!clientId) {
    res.status(400).json({ error: true, code: "CLIENT_REQUIRED", message: "clientId is required for admin users", status: 400 });
    return;
  }

  const { customerId } = pathParsed.data;

  const [customer] = await db
    .select()
    .from(customersTable)
    .where(and(eq(customersTable.id, customerId), eq(customersTable.clientId, clientId)));

  if (!customer) {
    res.status(404).json({ error: true, code: "NOT_FOUND", message: "Customer not found", status: 404 });
    return;
  }

  const [orders, events, productsPurchasedRaw, journey] = await Promise.all([
    db
      .select({
        id: ordersTable.id,
        amount: ordersTable.amount,
        status: ordersTable.status,
        state: ordersTable.state,
        city: ordersTable.city,
        createdAt: ordersTable.createdAt,
        sellerName: sellersTable.name,
        itemCount: sql<number>`(select count(*) from order_items where order_id = ${ordersTable.id})::int`,
      })
      .from(ordersTable)
      .leftJoin(sellersTable, eq(ordersTable.sellerId, sellersTable.id))
      .where(and(eq(ordersTable.customerId, customerId), eq(ordersTable.clientId, clientId)))
      .orderBy(desc(ordersTable.createdAt))
      .limit(50),
    db
      .select({
        id: eventsTable.id,
        eventType: eventsTable.eventType,
        metadata: eventsTable.metadata,
        createdAt: eventsTable.createdAt,
        productName: productsTable.name,
      })
      .from(eventsTable)
      .leftJoin(productsTable, eq(eventsTable.productId, productsTable.id))
      .where(and(eq(eventsTable.customerId, customerId), eq(eventsTable.clientId, clientId)))
      .orderBy(desc(eventsTable.createdAt))
      .limit(100),
    db
      .select({
        productId: productsTable.id,
        name: productsTable.name,
        sku: productsTable.sku,
        category: productsTable.category,
        imageUrl: productsTable.imageUrl,
        unitPrice: productsTable.price,
        quantity: sql<number>`sum(${orderItemsTable.quantity})::int`,
        totalSpent: sql<number>`sum(${orderItemsTable.quantity} * ${orderItemsTable.priceAtSale})`,
        firstOrderDate: sql<string>`min(${ordersTable.createdAt})`,
      })
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .innerJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
      .where(and(eq(ordersTable.customerId, customerId), eq(ordersTable.clientId, clientId)))
      .groupBy(productsTable.id, productsTable.name, productsTable.sku, productsTable.category, productsTable.imageUrl, productsTable.price)
      .orderBy(sql`sum(${orderItemsTable.quantity} * ${orderItemsTable.priceAtSale}) desc`)
      .limit(20),
    db
      .select({
        eventType: eventsTable.eventType,
        count: sql<number>`count(*)::int`,
      })
      .from(eventsTable)
      .where(and(eq(eventsTable.customerId, customerId), eq(eventsTable.clientId, clientId)))
      .groupBy(eventsTable.eventType),
  ]);

  const journeyMap = Object.fromEntries(journey.map((j) => [j.eventType, j.count]));
  const journeyPayload = {
    visits: journeyMap["VISIT"] ?? 0,
    registered: customer.registrationStatus !== "PENDING",
    approved: customer.registrationStatus === "APPROVED",
    productViews: journeyMap["PRODUCT_VIEW"] ?? 0,
    addedToCart: journeyMap["ADD_TO_CART"] ?? 0,
    purchased: journeyMap["PURCHASE"] ?? 0,
  };

  res.json(
    GetCustomerDetailResponse.parse({
      customer: {
        ...customer,
        firstPurchaseAt: customer.firstPurchaseAt?.toISOString() ?? null,
        lastPurchaseAt: customer.lastPurchaseAt?.toISOString() ?? null,
        approvalDate: customer.approvalDate?.toISOString() ?? null,
        createdAt: customer.createdAt.toISOString(),
      },
      orders: orders.map((o) => ({
        ...o,
        createdAt: o.createdAt.toISOString(),
      })),
      events: events.map((e) => ({
        ...e,
        createdAt: e.createdAt.toISOString(),
        metadata: (e.metadata as Record<string, unknown>) ?? {},
      })),
      productsPurchased: productsPurchasedRaw,
      journey: journeyPayload,
      opportunityLevel: deriveOpportunityLevel(customer),
      assignedSeller: orders[0]?.sellerName ?? null,
    }),
  );
});

function computeProductLevel(
  totalSold: number,
  stock: number,
  restockThreshold: number,
  recent30dSold: number,
  catalogAvgSellThrough: number,
): "High Conversion" | "Standard" | "Low" | "At Risk" {
  // Never sold at all — dead stock risk
  if (totalSold === 0) return "At Risk";

  const total = totalSold + stock;
  const sellThrough = total > 0 ? totalSold / total : 0;

  // At Risk: stagnant recent velocity AND sell-through well below catalog avg
  if (recent30dSold === 0 && sellThrough < catalogAvgSellThrough * 0.4) return "At Risk";

  // At Risk: excess inventory AND very poor lifetime sell-through
  if (sellThrough < 0.15 && stock > restockThreshold * 3) return "At Risk";

  // High Conversion: 65%+ lifetime sell-through OR significantly above catalog avg
  if (sellThrough >= 0.65 || (sellThrough >= 0.5 && sellThrough > catalogAvgSellThrough * 1.3)) return "High Conversion";

  // Standard: at/near catalog avg (within 70%)
  if (sellThrough >= 0.35 || (sellThrough >= 0.25 && sellThrough >= catalogAvgSellThrough * 0.7)) return "Standard";

  // Below 35% and below 70% of catalog avg — underperforming
  return "Low";
}

router.get("/analytics/products", async (req, res): Promise<void> => {
  const parsed = GetProductsQueryParams.safeParse(coerceDateQuery(req.query as Record<string, unknown>));
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }
  const clientId = requireClient(req, res);
  if (!clientId) return;
  const { sort = "revenue", limit = 50, search, sku, category, state, size, color, dateFrom, dateTo } = parsed.data;
  const hasPeriodFilter = Boolean(dateFrom || dateTo);
  const { from, to } = dateRange(dateFrom, dateTo);

  const orderBy =
    sort === "units"
      ? desc(productsTable.totalSold)
      : sort === "created"
        ? desc(productsTable.createdAt)
        : desc(productsTable.totalRevenue);

  const conditions: SQL[] = [eq(productsTable.clientId, clientId)];
  if (search && search.trim().length > 0) {
    const term = `%${search.trim()}%`;
    const cond = or(
      ilike(productsTable.sku, term),
      ilike(productsTable.name, term),
    );
    if (cond) conditions.push(cond);
  }
  if (sku && sku.trim().length > 0) {
    conditions.push(ilike(productsTable.sku, `%${sku.trim()}%`));
  }
  if (category && category.trim().length > 0) {
    conditions.push(eq(productsTable.category, category.trim()));
  }
  if (state && state.trim().length > 0) {
    // Restrict to products that have been shipped to this state.
    const stateConds: SQL[] = [eq(ordersTable.clientId, clientId), eq(ordersTable.state, state.trim())];
    if (dateFrom) stateConds.push(gte(ordersTable.createdAt, dateFrom));
    if (dateTo) stateConds.push(lte(ordersTable.createdAt, dateTo));
    const stateProductIds = await db
      .selectDistinct({ productId: orderItemsTable.productId })
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .where(and(...stateConds));
    const ids = stateProductIds.map((r) => r.productId).filter(Boolean) as string[];
    conditions.push(ids.length > 0 ? inArray(productsTable.id, ids) : sql`FALSE`);
  }
  if (size && size.trim().length > 0) {
    // Restrict to products ordered in this size variant.
    const sizeConds: SQL[] = [eq(ordersTable.clientId, clientId), ilike(orderItemsTable.size, size.trim())];
    if (dateFrom) sizeConds.push(gte(ordersTable.createdAt, dateFrom));
    if (dateTo) sizeConds.push(lte(ordersTable.createdAt, dateTo));
    const sizeProdIds = await db
      .selectDistinct({ productId: orderItemsTable.productId })
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .where(and(...sizeConds));
    const ids = sizeProdIds.map((r) => r.productId).filter(Boolean) as string[];
    conditions.push(ids.length > 0 ? inArray(productsTable.id, ids) : sql`FALSE`);
  }
  if (color && color.trim().length > 0) {
    // Restrict to products ordered in this color variant.
    const colorConds: SQL[] = [eq(ordersTable.clientId, clientId), ilike(orderItemsTable.color, color.trim())];
    if (dateFrom) colorConds.push(gte(ordersTable.createdAt, dateFrom));
    if (dateTo) colorConds.push(lte(ordersTable.createdAt, dateTo));
    const colorProdIds = await db
      .selectDistinct({ productId: orderItemsTable.productId })
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .where(and(...colorConds));
    const ids = colorProdIds.map((r) => r.productId).filter(Boolean) as string[];
    conditions.push(ids.length > 0 ? inArray(productsTable.id, ids) : sql`FALSE`);
  }

  const periodSalesRows = hasPeriodFilter
    ? await db
        .select({
          productId: orderItemsTable.productId,
          totalSold: sql<number>`COALESCE(SUM(${orderItemsTable.quantity}), 0)::int`,
          totalRevenue: sql<number>`COALESCE(SUM(${orderItemsTable.quantity} * ${orderItemsTable.priceAtSale}), 0)::float`,
        })
        .from(orderItemsTable)
        .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
        .where(
          and(
            eq(ordersTable.clientId, clientId),
            dateFrom ? gte(ordersTable.createdAt, dateFrom) : undefined,
            dateTo ? lte(ordersTable.createdAt, dateTo) : undefined,
          ),
        )
        .groupBy(orderItemsTable.productId)
    : [];
  const periodSalesMap = new Map(
    periodSalesRows
      .filter((row) => row.productId)
      .map((row) => [
        row.productId as string,
        {
          totalSold: Number(row.totalSold ?? 0),
          totalRevenue: Number(row.totalRevenue ?? 0),
        },
      ]),
  );

  const periodViewCandidates = new Map<string, number>();
  if (hasPeriodFilter) {
    try {
      const [client] = await db
        .select({ upZeroApiKey: clientsTable.upZeroApiKey })
        .from(clientsTable)
        .where(eq(clientsTable.id, clientId));
      const tracking = await getUpzeroTrackingRows({
        ...upzeroIsoRange(req.query as Record<string, unknown>, from, to),
        apiKey: client?.upZeroApiKey,
        context: "products",
      });

      const viewsByExternalId = new Map<string, number>();
      const viewsBySku = new Map<string, number>();
      for (const row of tracking.rows) {
        if (!PRODUCT_VIEW_EVENT_NAMES.has(row.event_name) || !row.product) continue;
        const views = Number(row.total_events ?? 0);
        if (views <= 0) continue;
        viewsByExternalId.set(
          String(row.product.id),
          (viewsByExternalId.get(String(row.product.id)) ?? 0) + views,
        );
        if (row.product.sku) {
          viewsBySku.set(row.product.sku, (viewsBySku.get(row.product.sku) ?? 0) + views);
        }
      }

      const externalIds = Array.from(viewsByExternalId.keys());
      const skus = Array.from(viewsBySku.keys());
      const productViewFilters: SQL[] = [];
      if (externalIds.length > 0) productViewFilters.push(inArray(productsTable.externalId, externalIds));
      if (skus.length > 0) productViewFilters.push(inArray(productsTable.sku, skus));

      const matchingProducts = productViewFilters.length > 0
        ? await db
            .select({
              id: productsTable.id,
              externalId: productsTable.externalId,
              sku: productsTable.sku,
            })
            .from(productsTable)
            .where(and(eq(productsTable.clientId, clientId), or(...productViewFilters)))
        : [];

      for (const product of matchingProducts) {
        const byExternal = product.externalId ? viewsByExternalId.get(product.externalId) ?? 0 : 0;
        const bySku = viewsBySku.get(product.sku) ?? 0;
        const views = byExternal || bySku;
        if (views > 0) periodViewCandidates.set(product.id, views);
      }
    } catch (err) {
      console.warn("[products] UP Zero product views unavailable:", err instanceof Error ? err.message : err);
    }
  }

  if (hasPeriodFilter) {
    const ids = Array.from(new Set([...periodSalesMap.keys(), ...periodViewCandidates.keys()]));
    conditions.push(ids.length > 0 ? inArray(productsTable.id, ids) : sql`FALSE`);
  }

  const rawRows = await db
    .select({
      id: productsTable.id,
      sku: productsTable.sku,
      name: productsTable.name,
      category: productsTable.category,
      price: productsTable.price,
      cost: productsTable.cost,
      stock: productsTable.stock,
      restockThreshold: productsTable.restockThreshold,
      totalSold: productsTable.totalSold,
      totalRevenue: productsTable.totalRevenue,
      status: productsTable.status,
      imageUrl: productsTable.imageUrl,
      createdAt: productsTable.createdAt,
    })
    .from(productsTable)
    .where(and(...conditions))
    .orderBy(orderBy);

  // Catalog avg sell-through — computed from ALL products in client catalog
  // (must NOT use filtered `rows` to avoid skew from search/category/limit)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const catalogSellThroughRows = await db
    .select({ totalSold: productsTable.totalSold, stock: productsTable.stock })
    .from(productsTable)
    .where(eq(productsTable.clientId, clientId));
  const catalogAvgSellThrough =
    catalogSellThroughRows.length > 0
      ? catalogSellThroughRows.reduce((sum, r) => {
          const t = r.totalSold + r.stock;
          return sum + (t > 0 ? r.totalSold / t : 0);
        }, 0) / catalogSellThroughRows.length
      : 0;

  const sortedRows = hasPeriodFilter
    ? [...rawRows].sort((a, b) => {
        if (sort === "created") return b.createdAt.getTime() - a.createdAt.getTime();
        const aSales = periodSalesMap.get(a.id) ?? { totalSold: 0, totalRevenue: 0 };
        const bSales = periodSalesMap.get(b.id) ?? { totalSold: 0, totalRevenue: 0 };
        if (sort === "units") return bSales.totalSold - aSales.totalSold;
        return bSales.totalRevenue - aSales.totalRevenue;
      })
    : rawRows;
  const rows = sortedRows.slice(0, limit);

  // 30-day recent velocity per product (batch query for visible page rows only)
  const productIds = rows.map((r) => r.id);
  const recentSalesRows =
    productIds.length > 0
      ? await db
          .select({
            productId: orderItemsTable.productId,
            recentSold: sql<number>`COALESCE(SUM(${orderItemsTable.quantity}), 0)::int`,
          })
          .from(orderItemsTable)
          .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
          .where(
            and(
              eq(ordersTable.clientId, clientId),
              gte(ordersTable.createdAt, thirtyDaysAgo),
              inArray(orderItemsTable.productId, productIds),
            ),
          )
          .groupBy(orderItemsTable.productId)
      : [];
  const recentSoldMap = new Map(recentSalesRows.map((r) => [r.productId, r.recentSold]));

  const enriched = rows.map((r) => {
    const periodSales = periodSalesMap.get(r.id);
    const totalSold = hasPeriodFilter ? periodSales?.totalSold ?? 0 : r.totalSold;
    const totalRevenue = hasPeriodFilter ? periodSales?.totalRevenue ?? 0 : r.totalRevenue;
    const productViews = hasPeriodFilter ? periodViewCandidates.get(r.id) ?? 0 : 0;
    return {
      ...r,
      totalSold,
      totalRevenue,
      productViews,
      productConversionPct: productViews > 0 ? (totalSold / productViews) * 100 : 0,
      percentSold: (totalSold + r.stock) > 0 ? totalSold / (totalSold + r.stock) : 0,
      level: computeProductLevel(
        totalSold,
        r.stock,
        r.restockThreshold,
        hasPeriodFilter ? totalSold : recentSoldMap.get(r.id) ?? 0,
        catalogAvgSellThrough,
      ),
      createdAt: r.createdAt.toISOString(),
    };
  });

  res.json(GetProductsResponse.parse(enriched));
});

router.get("/analytics/products/summary", async (req, res): Promise<void> => {
  const parsed = GetProductsSummaryQueryParams.safeParse(coerceDateQuery(req.query as Record<string, unknown>));
  if (!parsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }
  const clientId = requireClient(req, res);
  if (!clientId) return;

  const dateTo = parsed.data.dateTo ?? new Date();
  const dateFrom = parsed.data.dateFrom ?? new Date(dateTo.getTime() - 30 * 24 * 60 * 60 * 1000);

  const periodMs = dateTo.getTime() - dateFrom.getTime();
  const periodDays = Math.max(1, Math.round(periodMs / (24 * 60 * 60 * 1000)));
  const prevTo = new Date(dateFrom.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - periodMs);

  const [currentRows, prevRows] = await Promise.all([
    db
      .select({
        productId: orderItemsTable.productId,
        revenue: sql<number>`SUM(${orderItemsTable.quantity} * ${orderItemsTable.priceAtSale})`,
      })
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .where(
        and(
          eq(ordersTable.clientId, clientId),
          gte(ordersTable.createdAt, dateFrom),
          lte(ordersTable.createdAt, dateTo),
        ),
      )
      .groupBy(orderItemsTable.productId),
    db
      .select({
        productId: orderItemsTable.productId,
        revenue: sql<number>`SUM(${orderItemsTable.quantity} * ${orderItemsTable.priceAtSale})`,
      })
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .where(
        and(
          eq(ordersTable.clientId, clientId),
          gte(ordersTable.createdAt, prevFrom),
          lte(ordersTable.createdAt, prevTo),
        ),
      )
      .groupBy(orderItemsTable.productId),
  ]);

  const activeSkus = currentRows.length;
  const totalRevenue = currentRows.reduce((s, r) => s + Number(r.revenue), 0);
  const salesPower = activeSkus > 0 ? totalRevenue / activeSkus / periodDays : 0;

  const prevActiveSkus = prevRows.length;
  const prevTotalRevenue = prevRows.reduce((s, r) => s + Number(r.revenue), 0);
  const prevSalesPower = prevActiveSkus > 0 ? prevTotalRevenue / prevActiveSkus / periodDays : 0;

  const salesPowerChangePct = prevSalesPower > 0
    ? ((salesPower - prevSalesPower) / prevSalesPower) * 100
    : null;

  res.json({ salesPower, prevSalesPower, salesPowerChangePct, activeSkus, periodDays });
});

router.get("/analytics/products/:productId/customers", async (req, res): Promise<void> => {
  const qParsed = GetProductCustomersQueryParams.safeParse(coerceDateQuery(req.query as Record<string, unknown>));
  if (!qParsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: qParsed.error.message, status: 400 });
    return;
  }
  const clientId = requireClient(req, res);
  if (!clientId) return;
  const { productId } = req.params;
  const page = Math.max(1, qParsed.data.page ?? 1);
  const limit = Math.min(50, Math.max(1, qParsed.data.limit ?? 20));
  const offset = (page - 1) * limit;

  const product = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(and(eq(productsTable.id, productId), eq(productsTable.clientId, clientId)))
    .limit(1);

  if (!product.length) {
    res.status(404).json({ error: true, code: "NOT_FOUND", message: "Product not found", status: 404 });
    return;
  }

  const [buyers, countRows] = await Promise.all([
    db
      .select({
        customerId: customersTable.id,
        name: sql<string>`COALESCE(${customersTable.name}, ${customersTable.email})`,
        email: customersTable.email,
        rfmSegment: customersTable.rfmSegment,
        totalUnitsBought: sql<number>`SUM(${orderItemsTable.quantity})::int`,
        totalSpent: sql<number>`SUM(${orderItemsTable.quantity} * ${orderItemsTable.priceAtSale})`,
        lastPurchaseAt: sql<string>`MAX(${ordersTable.createdAt})`,
      })
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .innerJoin(customersTable, eq(ordersTable.customerId, customersTable.id))
      .where(
        and(
          eq(orderItemsTable.productId, productId),
          eq(ordersTable.clientId, clientId),
        ),
      )
      .groupBy(customersTable.id, customersTable.name, customersTable.email, customersTable.rfmSegment)
      .orderBy(desc(sql`SUM(${orderItemsTable.quantity} * ${orderItemsTable.priceAtSale})`))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`COUNT(DISTINCT ${ordersTable.customerId})::int` })
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .where(
        and(
          eq(orderItemsTable.productId, productId),
          eq(ordersTable.clientId, clientId),
        ),
      ),
  ]);

  res.json({
    data: buyers.map((b) => ({
      ...b,
      lastPurchaseAt: b.lastPurchaseAt,
    })),
    total: countRows[0]?.count ?? 0,
    page,
    limit,
  });
});

router.get("/analytics/products/:productId", async (req, res): Promise<void> => {
  const qParsed = GetProductDetailQueryParams.safeParse(coerceDateQuery(req.query as Record<string, unknown>));
  if (!qParsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: qParsed.error.message, status: 400 });
    return;
  }
  const clientId = requireClient(req, res);
  if (!clientId) return;
  const { productId } = req.params;

  const dateFrom = qParsed.data.dateFrom ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const dateTo = qParsed.data.dateTo ?? new Date();

  const [productRows] = await Promise.all([
    db
      .select()
      .from(productsTable)
      .where(and(eq(productsTable.id, productId), eq(productsTable.clientId, clientId)))
      .limit(1),
  ]);

  const product = productRows?.[0];
  if (!product) {
    res.status(404).json({ error: true, code: "NOT_FOUND", message: "Product not found", status: 404 });
    return;
  }

  const prevWindowMs = dateTo.getTime() - dateFrom.getTime();
  const prevFrom = new Date(dateFrom.getTime() - prevWindowMs);
  const prevTo = new Date(dateFrom.getTime() - 1);

  // KPI strip = lifetime (all-time) stats; chart and breakdowns = period-scoped
  const [kpiRows, buyerCountRows, revTimeSeries, prevTimeSeries, colorRows, sizeRows, stateRows] = await Promise.all([
    db
      .select({
        totalRevenue: sql<number>`COALESCE(SUM(${orderItemsTable.quantity} * ${orderItemsTable.priceAtSale}), 0)`,
        totalUnitsSold: sql<number>`COALESCE(SUM(${orderItemsTable.quantity}), 0)::int`,
        avgTicket: sql<number>`COALESCE(AVG(${ordersTable.amount}), 0)`,
      })
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .where(
        and(
          eq(orderItemsTable.productId, productId),
          eq(ordersTable.clientId, clientId),
          // Lifetime: no date restriction
        ),
      ),
    db
      .select({ count: sql<number>`COUNT(DISTINCT ${ordersTable.customerId})::int` })
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .where(
        and(
          eq(orderItemsTable.productId, productId),
          eq(ordersTable.clientId, clientId),
          // Lifetime: no date restriction
        ),
      ),
    db
      .select({
        date: sql<string>`TO_CHAR(DATE_TRUNC('day', ${ordersTable.createdAt}), 'YYYY-MM-DD')`,
        revenue: sql<number>`COALESCE(SUM(${orderItemsTable.quantity} * ${orderItemsTable.priceAtSale}), 0)`,
        units: sql<number>`COALESCE(SUM(${orderItemsTable.quantity}), 0)::int`,
      })
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .where(
        and(
          eq(orderItemsTable.productId, productId),
          eq(ordersTable.clientId, clientId),
          gte(ordersTable.createdAt, dateFrom),
          lte(ordersTable.createdAt, dateTo),
        ),
      )
      .groupBy(sql`DATE_TRUNC('day', ${ordersTable.createdAt})`)
      .orderBy(sql`DATE_TRUNC('day', ${ordersTable.createdAt})`),
    db
      .select({
        date: sql<string>`TO_CHAR(DATE_TRUNC('day', ${ordersTable.createdAt}), 'YYYY-MM-DD')`,
        revenue: sql<number>`COALESCE(SUM(${orderItemsTable.quantity} * ${orderItemsTable.priceAtSale}), 0)`,
        units: sql<number>`COALESCE(SUM(${orderItemsTable.quantity}), 0)::int`,
      })
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .where(
        and(
          eq(orderItemsTable.productId, productId),
          eq(ordersTable.clientId, clientId),
          gte(ordersTable.createdAt, prevFrom),
          lte(ordersTable.createdAt, prevTo),
        ),
      )
      .groupBy(sql`DATE_TRUNC('day', ${ordersTable.createdAt})`)
      .orderBy(sql`DATE_TRUNC('day', ${ordersTable.createdAt})`),
    db
      .select({
        label: sql<string>`COALESCE(${orderItemsTable.color}, 'Unknown')`,
        units: sql<number>`SUM(${orderItemsTable.quantity})::int`,
        revenue: sql<number>`SUM(${orderItemsTable.quantity} * ${orderItemsTable.priceAtSale})`,
      })
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .where(
        and(
          eq(orderItemsTable.productId, productId),
          eq(ordersTable.clientId, clientId),
          gte(ordersTable.createdAt, dateFrom),
          lte(ordersTable.createdAt, dateTo),
        ),
      )
      .groupBy(sql`COALESCE(${orderItemsTable.color}, 'Unknown')`)
      .orderBy(desc(sql`SUM(${orderItemsTable.quantity})`))
      .limit(10),
    db
      .select({
        label: sql<string>`COALESCE(${orderItemsTable.size}, 'Unknown')`,
        units: sql<number>`SUM(${orderItemsTable.quantity})::int`,
        revenue: sql<number>`SUM(${orderItemsTable.quantity} * ${orderItemsTable.priceAtSale})`,
      })
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .where(
        and(
          eq(orderItemsTable.productId, productId),
          eq(ordersTable.clientId, clientId),
          gte(ordersTable.createdAt, dateFrom),
          lte(ordersTable.createdAt, dateTo),
        ),
      )
      .groupBy(sql`COALESCE(${orderItemsTable.size}, 'Unknown')`)
      .orderBy(desc(sql`SUM(${orderItemsTable.quantity})`))
      .limit(10),
    db
      .select({
        label: sql<string>`COALESCE(${ordersTable.state}, 'Unknown')`,
        units: sql<number>`SUM(${orderItemsTable.quantity})::int`,
        revenue: sql<number>`SUM(${orderItemsTable.quantity} * ${orderItemsTable.priceAtSale})`,
      })
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .where(
        and(
          eq(orderItemsTable.productId, productId),
          eq(ordersTable.clientId, clientId),
          gte(ordersTable.createdAt, dateFrom),
          lte(ordersTable.createdAt, dateTo),
        ),
      )
      .groupBy(sql`COALESCE(${ordersTable.state}, 'Unknown')`)
      .orderBy(desc(sql`SUM(${orderItemsTable.quantity})`))
      .limit(10),
  ]);

  const kpi = kpiRows[0] ?? { totalRevenue: 0, totalUnitsSold: 0, avgTicket: 0 };
  const uniqueBuyers = buyerCountRows[0]?.count ?? 0;
  const percentSold = (product.totalSold + product.stock) > 0
    ? product.totalSold / (product.totalSold + product.stock)
    : 0;

  // Compute recent velocity + catalog avg for consistent level classification
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [recentVelocityRows, catalogRows] = await Promise.all([
    db
      .select({ recentSold: sql<number>`COALESCE(SUM(${orderItemsTable.quantity}), 0)::int` })
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .where(
        and(
          eq(orderItemsTable.productId, productId),
          eq(ordersTable.clientId, clientId),
          gte(ordersTable.createdAt, thirtyDaysAgo),
        ),
      ),
    db
      .select({ totalSold: productsTable.totalSold, stock: productsTable.stock })
      .from(productsTable)
      .where(eq(productsTable.clientId, clientId)),
  ]);
  const recent30dSold = Number(recentVelocityRows[0]?.recentSold ?? 0);
  const catalogAvgSellThrough =
    catalogRows.length > 0
      ? catalogRows.reduce((s, r) => {
          const t = r.totalSold + r.stock;
          return s + (t > 0 ? r.totalSold / t : 0);
        }, 0) / catalogRows.length
      : 0;

  res.json({
    product: {
      id: product.id,
      sku: product.sku,
      name: product.name,
      description: product.description,
      category: product.category,
      price: product.price,
      cost: product.cost,
      stock: product.stock,
      restockThreshold: product.restockThreshold,
      imageUrl: product.imageUrl,
      totalSold: product.totalSold,
      totalRevenue: product.totalRevenue,
      status: product.status,
      percentSold,
      level: computeProductLevel(product.totalSold, product.stock, product.restockThreshold, recent30dSold, catalogAvgSellThrough),
      createdAt: product.createdAt.toISOString(),
    },
    kpis: {
      totalRevenue: Number(kpi.totalRevenue),
      totalUnitsSold: Number(kpi.totalUnitsSold),
      avgTicket: Number(kpi.avgTicket),
      uniqueBuyers: Number(uniqueBuyers),
      percentSold,
    },
    revenueOverTime: revTimeSeries,
    prevRevenueOverTime: prevTimeSeries,
    byColor: colorRows,
    bySize: sizeRows,
    byState: stateRows,
  });
});

router.get("/analytics/alerts", async (req, res): Promise<void> => {
  const parsed = GetAlertsQueryParams.safeParse(coerceDateQuery(req.query as Record<string, unknown>));
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }
  const clientId = requireClient(req, res);
  if (!clientId) return;
  const { horizonDays = 14, lookbackDays = 30, limit = 25 } = parsed.data;

  const lookbackFrom = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  // Average daily units sold per product over the lookback window.
  // We only consider non-rejected orders (those that consume inventory in
  // practice — APPROVED, SHIPPED, DELIVERED) so cancellations don't inflate
  // velocity.
  const velocityRows = await db
    .select({
      productId: orderItemsTable.productId,
      unitsSold: sql<number>`COALESCE(SUM(${orderItemsTable.quantity}), 0)::int`,
    })
    .from(orderItemsTable)
    .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
    .where(
      and(
        eq(ordersTable.clientId, clientId),
        gte(ordersTable.createdAt, lookbackFrom),
        sql`${ordersTable.status} IN ('APPROVED', 'SHIPPED', 'DELIVERED')`,
      ),
    )
    .groupBy(orderItemsTable.productId);

  const velocityById = new Map<string, number>();
  for (const row of velocityRows) {
    velocityById.set(row.productId, Number(row.unitsSold) || 0);
  }

  const products = await db
    .select({
      id: productsTable.id,
      sku: productsTable.sku,
      name: productsTable.name,
      category: productsTable.category,
      imageUrl: productsTable.imageUrl,
      stock: productsTable.stock,
      restockThreshold: productsTable.restockThreshold,
    })
    .from(productsTable)
    .where(
      and(
        eq(productsTable.clientId, clientId),
        sql`${productsTable.status} <> 'DISCONTINUED'`,
      ),
    );

  type Alert = {
    productId: string;
    sku: string;
    name: string;
    category: string | null;
    imageUrl: string | null;
    stock: number;
    restockThreshold: number;
    averageDailySales: number;
    daysOfCover: number | null;
    type: "LOW_STOCK" | "PREDICTED_STOCKOUT" | "OUT_OF_STOCK";
    severity: "critical" | "warning";
    message: string;
  };

  const alerts: Alert[] = [];
  for (const p of products) {
    const unitsSold = velocityById.get(p.id) ?? 0;
    const avgDaily = unitsSold / lookbackDays;
    const daysOfCover = avgDaily > 0 ? p.stock / avgDaily : null;

    if (p.stock <= 0) {
      alerts.push({
        productId: p.id,
        sku: p.sku,
        name: p.name,
        category: p.category,
        imageUrl: p.imageUrl,
        stock: p.stock,
        restockThreshold: p.restockThreshold,
        averageDailySales: avgDaily,
        daysOfCover,
        type: "OUT_OF_STOCK",
        severity: "critical",
        message: "Out of stock — restock immediately.",
      });
      continue;
    }

    if (daysOfCover !== null && daysOfCover <= horizonDays) {
      const days = Math.max(1, Math.round(daysOfCover));
      alerts.push({
        productId: p.id,
        sku: p.sku,
        name: p.name,
        category: p.category,
        imageUrl: p.imageUrl,
        stock: p.stock,
        restockThreshold: p.restockThreshold,
        averageDailySales: avgDaily,
        daysOfCover,
        type: "PREDICTED_STOCKOUT",
        severity: daysOfCover <= Math.max(3, horizonDays / 4) ? "critical" : "warning",
        message: `Projected to sell out in ~${days} day${days === 1 ? "" : "s"} at recent demand.`,
      });
      continue;
    }

    if (p.stock <= p.restockThreshold) {
      alerts.push({
        productId: p.id,
        sku: p.sku,
        name: p.name,
        category: p.category,
        imageUrl: p.imageUrl,
        stock: p.stock,
        restockThreshold: p.restockThreshold,
        averageDailySales: avgDaily,
        daysOfCover,
        type: "LOW_STOCK",
        severity: p.stock <= Math.max(1, Math.floor(p.restockThreshold / 2)) ? "critical" : "warning",
        message: `Stock (${p.stock}) is at or below restock threshold (${p.restockThreshold}).`,
      });
    }
  }

  // Rank: out-of-stock first, then by smallest days-of-cover, then by smallest
  // absolute stock so the most pressing items surface first.
  const typeRank: Record<Alert["type"], number> = {
    OUT_OF_STOCK: 0,
    PREDICTED_STOCKOUT: 1,
    LOW_STOCK: 2,
  };
  alerts.sort((a, b) => {
    if (typeRank[a.type] !== typeRank[b.type]) return typeRank[a.type] - typeRank[b.type];
    const ac = a.daysOfCover ?? Number.POSITIVE_INFINITY;
    const bc = b.daysOfCover ?? Number.POSITIVE_INFINITY;
    if (ac !== bc) return ac - bc;
    return a.stock - b.stock;
  });

  const counts = {
    total: alerts.length,
    critical: alerts.filter((a) => a.severity === "critical").length,
    warning: alerts.filter((a) => a.severity === "warning").length,
    outOfStock: alerts.filter((a) => a.type === "OUT_OF_STOCK").length,
    lowStock: alerts.filter((a) => a.type === "LOW_STOCK").length,
    predictedStockout: alerts.filter((a) => a.type === "PREDICTED_STOCKOUT").length,
  };

  res.json(
    GetAlertsResponse.parse({
      alerts: alerts.slice(0, limit),
      counts,
      horizonDays,
      lookbackDays,
    }),
  );
});

router.get("/analytics/sellers/:sellerId/customers", async (req, res): Promise<void> => {
  const qParsed = GetSellerCustomersQueryParams.safeParse(coerceDateQuery(req.query as Record<string, unknown>));
  if (!qParsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: qParsed.error.message, status: 400 });
    return;
  }
  const clientId = requireClient(req, res);
  if (!clientId) return;
  const { sellerId } = req.params;
  const page = Math.max(1, qParsed.data.page ?? 1);
  const limit = Math.min(50, Math.max(1, qParsed.data.limit ?? 20));
  const offset = (page - 1) * limit;
  const { from: dateFrom, to: dateTo } = dateRange(qParsed.data.dateFrom, qParsed.data.dateTo);

  const seller = await db
    .select({ id: sellersTable.id })
    .from(sellersTable)
    .where(and(eq(sellersTable.id, sellerId), eq(sellersTable.clientId, clientId)))
    .limit(1);
  if (!seller.length) {
    res.status(404).json({ error: true, code: "NOT_FOUND", message: "Seller not found", status: 404 });
    return;
  }

  const [buyers, countRows] = await Promise.all([
    db
      .select({
        customerId: customersTable.id,
        name: sql<string>`COALESCE(${customersTable.name}, ${customersTable.email})`,
        email: customersTable.email,
        rfmSegment: customersTable.rfmSegment,
        totalOrders: sql<number>`COUNT(DISTINCT ${ordersTable.id})::int`,
        totalSpent: sql<number>`SUM(CASE WHEN ${ordersTable.status} IN ('APPROVED','SHIPPED','DELIVERED') THEN ${ordersTable.amount} ELSE 0 END)`,
        lastPurchaseAt: sql<string>`MAX(${ordersTable.createdAt})`,
      })
      .from(ordersTable)
      .innerJoin(customersTable, eq(ordersTable.customerId, customersTable.id))
      .where(
        and(
          eq(ordersTable.clientId, clientId),
          eq(ordersTable.sellerId, sellerId),
          gte(ordersTable.createdAt, dateFrom),
          lte(ordersTable.createdAt, dateTo),
        ),
      )
      .groupBy(customersTable.id, customersTable.name, customersTable.email, customersTable.rfmSegment)
      .orderBy(sql`SUM(CASE WHEN ${ordersTable.status} IN ('APPROVED','SHIPPED','DELIVERED') THEN ${ordersTable.amount} ELSE 0 END) DESC`)
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`COUNT(DISTINCT ${ordersTable.customerId})::int` })
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.clientId, clientId),
          eq(ordersTable.sellerId, sellerId),
          gte(ordersTable.createdAt, dateFrom),
          lte(ordersTable.createdAt, dateTo),
        ),
      ),
  ]);

  res.json(
    GetSellerCustomersResponse.parse({
      data: buyers.map((b) => ({
        customerId: b.customerId,
        name: b.name,
        email: b.email ?? null,
        rfmSegment: b.rfmSegment ?? null,
        totalOrders: Number(b.totalOrders) || 0,
        totalSpent: Number(b.totalSpent) || 0,
        lastPurchaseAt: b.lastPurchaseAt ?? null,
      })),
      total: Number(countRows[0]?.count) || 0,
      page,
      limit,
    }),
  );
});

router.get("/analytics/sellers/:sellerId/orders", async (req, res): Promise<void> => {
  const qParsed = GetSellerOrdersQueryParams.safeParse(coerceDateQuery(req.query as Record<string, unknown>));
  if (!qParsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: qParsed.error.message, status: 400 });
    return;
  }
  const clientId = requireClient(req, res);
  if (!clientId) return;
  const { sellerId } = req.params;
  const page = Math.max(1, qParsed.data.page ?? 1);
  const limit = Math.min(100, Math.max(1, qParsed.data.limit ?? 25));
  const offset = (page - 1) * limit;
  const { from: dateFrom, to: dateTo } = dateRange(qParsed.data.dateFrom, qParsed.data.dateTo);

  const seller = await db
    .select({ id: sellersTable.id })
    .from(sellersTable)
    .where(and(eq(sellersTable.id, sellerId), eq(sellersTable.clientId, clientId)))
    .limit(1);
  if (!seller.length) {
    res.status(404).json({ error: true, code: "NOT_FOUND", message: "Seller not found", status: 404 });
    return;
  }

  const [orders, countRows] = await Promise.all([
    db
      .select({
        id: ordersTable.id,
        customerId: ordersTable.customerId,
        customerName: sql<string>`COALESCE(${customersTable.name}, ${customersTable.email})`,
        amount: ordersTable.amount,
        status: ordersTable.status,
        state: ordersTable.state,
        city: ordersTable.city,
        createdAt: sql<string>`${ordersTable.createdAt}::text`,
      })
      .from(ordersTable)
      .innerJoin(customersTable, eq(ordersTable.customerId, customersTable.id))
      .where(
        and(
          eq(ordersTable.clientId, clientId),
          eq(ordersTable.sellerId, sellerId),
          gte(ordersTable.createdAt, dateFrom),
          lte(ordersTable.createdAt, dateTo),
        ),
      )
      .orderBy(desc(ordersTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.clientId, clientId),
          eq(ordersTable.sellerId, sellerId),
          gte(ordersTable.createdAt, dateFrom),
          lte(ordersTable.createdAt, dateTo),
        ),
      ),
  ]);

  res.json(
    GetSellerOrdersResponse.parse({
      data: orders.map((o) => ({
        id: o.id,
        customerId: o.customerId,
        customerName: o.customerName,
        amount: Number(o.amount) || 0,
        status: o.status,
        state: o.state ?? null,
        city: o.city ?? null,
        createdAt: o.createdAt,
      })),
      total: Number(countRows[0]?.count) || 0,
      page,
      limit,
    }),
  );
});

router.get("/analytics/sellers/:sellerId", async (req, res): Promise<void> => {
  const qParsed = GetSellerDetailQueryParams.safeParse(coerceDateQuery(req.query as Record<string, unknown>));
  if (!qParsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: qParsed.error.message, status: 400 });
    return;
  }
  const clientId = requireClient(req, res);
  if (!clientId) return;
  const { sellerId } = req.params;
  const { from: dateFrom, to: dateTo } = dateRange(qParsed.data.dateFrom, qParsed.data.dateTo);
  const periodMs = dateTo.getTime() - dateFrom.getTime();
  const prevTo = new Date(dateFrom.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - periodMs);

  const sellerRows = await db
    .select()
    .from(sellersTable)
    .where(and(eq(sellersTable.id, sellerId), eq(sellersTable.clientId, clientId)))
    .limit(1);
  const seller = sellerRows[0];
  if (!seller) {
    res.status(404).json({ error: true, code: "NOT_FOUND", message: "Seller not found", status: 404 });
    return;
  }

  const sellerCond = (from: Date, to: Date) =>
    and(
      eq(ordersTable.clientId, clientId),
      eq(ordersTable.sellerId, sellerId),
      gte(ordersTable.createdAt, from),
      lte(ordersTable.createdAt, to),
    );

  const kpiQuery = (from: Date, to: Date) =>
    db
      .select({
        revenue: sql<number>`COALESCE(SUM(CASE WHEN ${ordersTable.status} IN ('APPROVED','SHIPPED','DELIVERED') THEN ${ordersTable.amount} ELSE 0 END), 0)::float`,
        orders: sql<number>`COUNT(*)::int`,
        approvedOrders: sql<number>`COUNT(CASE WHEN ${ordersTable.status} IN ('APPROVED','SHIPPED','DELIVERED') THEN 1 END)::int`,
        deliveredOrders: sql<number>`COUNT(CASE WHEN ${ordersTable.status} = 'DELIVERED' THEN 1 END)::int`,
        uniqueCustomers: sql<number>`COUNT(DISTINCT ${ordersTable.customerId})::int`,
      })
      .from(ordersTable)
      .where(sellerCond(from, to));

  const revenueSeriesQuery = (from: Date, to: Date) =>
    db
      .select({
        date: sql<string>`to_char(date_trunc('day', ${ordersTable.createdAt}), 'YYYY-MM-DD')`,
        revenue: sql<number>`COALESCE(SUM(CASE WHEN ${ordersTable.status} IN ('APPROVED','SHIPPED','DELIVERED') THEN ${ordersTable.amount} ELSE 0 END), 0)::float`,
      })
      .from(ordersTable)
      .where(sellerCond(from, to))
      .groupBy(sql`date_trunc('day', ${ordersTable.createdAt})`)
      .orderBy(sql`date_trunc('day', ${ordersTable.createdAt})`);

  const categoryQuery = (from: Date, to: Date) =>
    db
      .select({
        category: productsTable.category,
        revenue: sql<number>`COALESCE(SUM(CASE WHEN ${ordersTable.status} IN ('APPROVED','SHIPPED','DELIVERED') THEN ${orderItemsTable.quantity} * ${orderItemsTable.priceAtSale} ELSE 0 END), 0)::float`,
      })
      .from(ordersTable)
      .innerJoin(orderItemsTable, eq(orderItemsTable.orderId, ordersTable.id))
      .innerJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
      .where(sellerCond(from, to))
      .groupBy(productsTable.category)
      .orderBy(sql`2 DESC`)
      .limit(10);

  const stateQuery = (from: Date, to: Date) =>
    db
      .select({
        state: ordersTable.state,
        revenue: sql<number>`COALESCE(SUM(CASE WHEN ${ordersTable.status} IN ('APPROVED','SHIPPED','DELIVERED') THEN ${ordersTable.amount} ELSE 0 END), 0)::float`,
      })
      .from(ordersTable)
      .where(sellerCond(from, to))
      .groupBy(ordersTable.state)
      .orderBy(sql`2 DESC`)
      .limit(10);

  const [
    [kpiRow],
    [prevKpiRow],
    revenueSeries,
    prevRevenueSeries,
    categoryRows,
    stateRows,
  ] = await Promise.all([
    kpiQuery(dateFrom, dateTo),
    kpiQuery(prevFrom, prevTo),
    revenueSeriesQuery(dateFrom, dateTo),
    revenueSeriesQuery(prevFrom, prevTo),
    categoryQuery(dateFrom, dateTo),
    stateQuery(dateFrom, dateTo),
  ]);

  const buildKpis = (row: typeof kpiRow) => {
    const orders = Number(row?.orders) || 0;
    const approved = Number(row?.approvedOrders) || 0;
    const delivered = Number(row?.deliveredOrders) || 0;
    return {
      revenue: Number(row?.revenue) || 0,
      orders,
      avgTicket: approved > 0 ? (Number(row?.revenue) || 0) / approved : 0,
      uniqueCustomers: Number(row?.uniqueCustomers) || 0,
      approvalRate: orders > 0 ? (approved / orders) * 100 : 0,
      conversionRate: orders > 0 ? (delivered / orders) * 100 : 0,
    };
  };

  res.json(
    GetSellerDetailResponse.parse({
      seller: {
        id: seller.id,
        name: seller.name,
        email: seller.email ?? null,
        phone: seller.phone ?? null,
        createdAt: seller.createdAt.toISOString(),
      },
      kpis: buildKpis(kpiRow),
      prevKpis: buildKpis(prevKpiRow),
      revenueOverTime: revenueSeries.map((r) => ({ date: r.date, revenue: Number(r.revenue) || 0 })),
      prevRevenueOverTime: prevRevenueSeries.map((r) => ({ date: r.date, revenue: Number(r.revenue) || 0 })),
      categoryBreakdown: categoryRows
        .filter((r) => r.category)
        .map((r) => ({ category: r.category as string, revenue: Number(r.revenue) || 0 })),
      stateBreakdown: stateRows
        .filter((r) => r.state)
        .map((r) => ({ state: r.state as string, revenue: Number(r.revenue) || 0 })),
    }),
  );
});

router.get("/analytics/sellers", async (req, res): Promise<void> => {
  const parsed = GetSellersQueryParams.safeParse(coerceDateQuery(req.query as Record<string, unknown>));
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }
  const clientId = requireClient(req, res);
  if (!clientId) return;
  const { limit = 20, state } = parsed.data;

  const sellerConditions: SQL[] = [eq(sellersTable.clientId, clientId)];
  if (state && state.trim().length > 0) {
    // Restrict to sellers who have orders shipped to this state.
    const stateSellerIds = await db
      .selectDistinct({ sellerId: ordersTable.sellerId })
      .from(ordersTable)
      .where(and(eq(ordersTable.clientId, clientId), eq(ordersTable.state, state.trim())));
    const ids = stateSellerIds.map((r) => r.sellerId).filter(Boolean) as string[];
    sellerConditions.push(ids.length > 0 ? inArray(sellersTable.id, ids) : sql`FALSE`);
  }

  const rows = await db
    .select({
      id: sellersTable.id,
      name: sellersTable.name,
      email: sellersTable.email,
      totalOrders: sellersTable.totalOrders,
      totalRevenue: sellersTable.totalRevenue,
    })
    .from(sellersTable)
    .where(and(...sellerConditions))
    .orderBy(desc(sellersTable.totalRevenue))
    .limit(limit);

  const enriched = rows.map((r) => ({
    ...r,
    avgTicket: r.totalOrders > 0 ? r.totalRevenue / r.totalOrders : 0,
  }));

  res.json(GetSellersResponse.parse(enriched));
});

router.get("/analytics/geography", async (req, res): Promise<void> => {
  const parsed = GetGeographyQueryParams.safeParse(coerceDateQuery(req.query as Record<string, unknown>));
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }
  const clientId = requireClient(req, res);
  if (!clientId) return;
  const { from, to } = dateRange(parsed.data.dateFrom, parsed.data.dateTo);
  const { utmSource, utmMedium } = parsed.data;

  // If UTM filters active, restrict orders to those placed by customers with matching UTM attributes.
  let geoUtmCond: SQL | undefined;
  if (utmSource || utmMedium) {
    const custParts: SQL[] = [eq(customersTable.clientId, clientId)];
    if (utmSource) custParts.push(sql`lower(${customersTable.utmSource}) = lower(${utmSource})`);
    if (utmMedium) custParts.push(sql`lower(${customersTable.utmMedium}) = lower(${utmMedium})`);
    const scopedCustomers = await db
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(and(...custParts));
    const ids = scopedCustomers.map((r) => r.id);
    geoUtmCond = ids.length > 0 ? inArray(ordersTable.customerId, ids) : sql`FALSE`;
  }

  const orderWhere = and(
    eq(ordersTable.clientId, clientId),
    gte(ordersTable.createdAt, from),
    lte(ordersTable.createdAt, to),
    sql`${ordersTable.status} IN ('APPROVED', 'SHIPPED', 'DELIVERED')`,
    geoUtmCond,
  );

  const states = await db
    .select({
      state: sql<string>`COALESCE(${ordersTable.state}, 'Unknown')`,
      orders: sql<number>`COUNT(*)::int`,
      revenue: sql<number>`COALESCE(SUM(${ordersTable.amount}), 0)::float`,
      customers: sql<number>`COUNT(DISTINCT ${ordersTable.customerId})::int`,
    })
    .from(ordersTable)
    .where(orderWhere)
    .groupBy(ordersTable.state)
    .orderBy(sql`SUM(${ordersTable.amount}) DESC`);

  const cities = await db
    .select({
      state: sql<string>`COALESCE(${ordersTable.state}, 'Unknown')`,
      city: sql<string>`COALESCE(${ordersTable.city}, 'Unknown')`,
      orders: sql<number>`COUNT(*)::int`,
      revenue: sql<number>`COALESCE(SUM(${ordersTable.amount}), 0)::float`,
    })
    .from(ordersTable)
    .where(orderWhere)
    .groupBy(ordersTable.state, ordersTable.city)
    .orderBy(sql`SUM(${ordersTable.amount}) DESC`)
    .limit(50);

  res.json(GetGeographyResponse.parse({ states, cities }));
});

// ───────── Drill-down: orders for a specific day ─────────

const GetB2cOrdersQueryParams = z.object({
  clientId: z.coerce.string().optional(),
  dateFrom: z.date().optional(),
  dateTo: z.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const GetOrdersPageQueryParams = z.object({
  clientId: z.coerce.string().optional(),
  dateFrom: z.date().optional(),
  dateTo: z.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.coerce.string().trim().optional(),
});

router.get("/analytics/b2c/orders", async (req, res): Promise<void> => {
  const parsed = GetB2cOrdersQueryParams.safeParse(coerceDateQuery(req.query as Record<string, unknown>));
  if (!parsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }
  const clientId = requireClient(req, res);
  if (!clientId) return;
  const { from, to } = dateRange(parsed.data.dateFrom, parsed.data.dateTo);
  const page = parsed.data.page;
  const limit = parsed.data.limit;
  const offset = (page - 1) * limit;
  const where = and(
    eq(ordersTable.clientId, clientId),
    gte(ordersTable.createdAt, from),
    lte(ordersTable.createdAt, to),
  );

  const [rows, [countRow]] = await Promise.all([
    db
      .select({
        id: ordersTable.id,
        externalId: ordersTable.externalId,
        status: ordersTable.status,
        amount: ordersTable.amount,
        fulfilledAmount: ordersTable.fulfilledAmount,
        grossAmount: ordersTable.grossAmount,
        discountAmount: ordersTable.discountAmount,
        shippingAmount: ordersTable.shippingAmount,
        refundedAmount: ordersTable.refundedAmount,
        cancelledAmount: ordersTable.cancelledAmount,
        requestedQuantity: ordersTable.requestedQuantity,
        fulfilledQuantity: ordersTable.fulfilledQuantity,
        createdAt: ordersTable.createdAt,
        customerId: ordersTable.customerId,
        customerName: customersTable.name,
        customerEmail: customersTable.email,
        customerPhone: customersTable.phone,
        state: ordersTable.state,
        city: ordersTable.city,
      })
      .from(ordersTable)
      .leftJoin(customersTable, eq(ordersTable.customerId, customersTable.id))
      .where(where)
      .orderBy(desc(ordersTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(ordersTable)
      .where(where),
  ]);

  res.json({
    rows,
    page,
    limit,
    total: Number(countRow?.count ?? 0),
  });
});

router.get("/analytics/b2c/orders/:orderId", async (req, res): Promise<void> => {
  const clientId = requireClient(req, res);
  if (!clientId) return;
  const orderId = z.string().safeParse(req.params.orderId);
  if (!orderId.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: orderId.error.message, status: 400 });
    return;
  }

  const [order] = await db
    .select({
      id: ordersTable.id,
      externalId: ordersTable.externalId,
      status: ordersTable.status,
      amount: ordersTable.amount,
      fulfilledAmount: ordersTable.fulfilledAmount,
      grossAmount: ordersTable.grossAmount,
      discountAmount: ordersTable.discountAmount,
      shippingAmount: ordersTable.shippingAmount,
      refundedAmount: ordersTable.refundedAmount,
      cancelledAmount: ordersTable.cancelledAmount,
      requestedQuantity: ordersTable.requestedQuantity,
      fulfilledQuantity: ordersTable.fulfilledQuantity,
      approvalDate: ordersTable.approvalDate,
      createdAt: ordersTable.createdAt,
      state: ordersTable.state,
      city: ordersTable.city,
      customerId: customersTable.id,
      customerExternalId: customersTable.externalId,
      customerName: customersTable.name,
      customerEmail: customersTable.email,
      customerPhone: customersTable.phone,
      customerState: customersTable.state,
      customerCity: customersTable.city,
      firstPurchaseAt: customersTable.firstPurchaseAt,
      lastPurchaseAt: customersTable.lastPurchaseAt,
      totalOrders: customersTable.totalOrders,
      totalSpent: customersTable.totalSpent,
    })
    .from(ordersTable)
    .leftJoin(customersTable, eq(ordersTable.customerId, customersTable.id))
    .where(and(eq(ordersTable.id, orderId.data), eq(ordersTable.clientId, clientId)));

  if (!order) {
    res.status(404).json({ error: true, code: "NOT_FOUND", message: "Order not found", status: 404 });
    return;
  }

  const items = await db
    .select({
      id: orderItemsTable.id,
      quantity: orderItemsTable.quantity,
      fulfilledQuantity: orderItemsTable.fulfilledQuantity,
      priceAtSale: orderItemsTable.priceAtSale,
      grossPriceAtSale: orderItemsTable.grossPriceAtSale,
      discountAmount: orderItemsTable.discountAmount,
      size: orderItemsTable.size,
      color: orderItemsTable.color,
      productId: productsTable.id,
      sku: productsTable.sku,
      name: productsTable.name,
      category: productsTable.category,
      imageUrl: productsTable.imageUrl,
    })
    .from(orderItemsTable)
    .innerJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
    .where(eq(orderItemsTable.orderId, order.id))
    .orderBy(asc(productsTable.name));

  res.json({
    order,
    customer: {
      id: order.customerId,
      externalId: order.customerExternalId,
      name: order.customerName,
      email: order.customerEmail,
      phone: order.customerPhone,
      state: order.customerState,
      city: order.customerCity,
      firstPurchaseAt: order.firstPurchaseAt,
      lastPurchaseAt: order.lastPurchaseAt,
      totalOrders: order.totalOrders,
      totalSpent: order.totalSpent,
    },
    items,
  });
});

type OrderOrigin = {
  source: string;
  medium: string;
  campaign: string;
  label: string;
  attribution: "tracking" | "customer_utm" | "direct";
};

function storedOrderUtmDimension(customer: {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
}): UtmDimension {
  return {
    source: customer.utmSource?.toLowerCase() || "direct",
    medium: customer.utmMedium?.toLowerCase() || "none",
    campaign: customer.utmCampaign || "sem campanha",
  };
}

function orderOriginFromDimension(dimension: UtmDimension | null, attribution: OrderOrigin["attribution"]): OrderOrigin {
  const source = dimension?.source || "direct";
  const medium = dimension?.medium || "none";
  const campaign = dimension?.campaign || "sem campanha";
  const isDirect = source === "direct" && medium === "none" && campaign === "sem campanha";
  return {
    source: isDirect ? "Direto / Não identificado" : source,
    medium: isDirect ? "Não identificado" : medium,
    campaign: isDirect ? "Sem campanha" : campaign,
    label: isDirect ? "Direto / Não identificado" : [source, medium, campaign].filter(Boolean).join(" / "),
    attribution: isDirect ? "direct" : attribution,
  };
}

router.get("/analytics/orders-page", async (req, res): Promise<void> => {
  const parsed = GetOrdersPageQueryParams.safeParse(coerceDateQuery(req.query as Record<string, unknown>));
  if (!parsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }
  const clientId = requireClient(req, res);
  if (!clientId) return;

  const { from, to } = dateRange(parsed.data.dateFrom, parsed.data.dateTo);
  const page = parsed.data.page;
  const limit = parsed.data.limit;
  const offset = (page - 1) * limit;
  const search = parsed.data.search?.trim();
  const baseWhere = and(eq(ordersTable.clientId, clientId), gte(ordersTable.createdAt, from), lte(ordersTable.createdAt, to));
  const listWhere = search
    ? and(
        baseWhere,
        or(
          ilike(ordersTable.externalId, `%${search}%`),
          ilike(customersTable.name, `%${search}%`),
          ilike(customersTable.email, `%${search}%`),
          ilike(customersTable.phone, `%${search}%`),
          ilike(customersTable.documentLast4, `%${search}%`),
        ),
      )
    : baseWhere;

  const [clientConfig] = await db
    .select({ upZeroApiKey: clientsTable.upZeroApiKey })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));

  const [metricOrders, orderRows, [countRow], [approvedLeadsRow]] = await Promise.all([
    db
      .select({
        id: ordersTable.id,
        customerId: ordersTable.customerId,
        amount: ordersTable.amount,
        fulfilledAmount: ordersTable.fulfilledAmount,
        requestedQuantity: ordersTable.requestedQuantity,
        fulfilledQuantity: ordersTable.fulfilledQuantity,
        status: ordersTable.status,
        createdAt: ordersTable.createdAt,
      })
      .from(ordersTable)
      .where(baseWhere),
    db
      .select({
        id: ordersTable.id,
        externalId: ordersTable.externalId,
        status: ordersTable.status,
        amount: ordersTable.amount,
        fulfilledAmount: ordersTable.fulfilledAmount,
        grossAmount: ordersTable.grossAmount,
        discountAmount: ordersTable.discountAmount,
        shippingAmount: ordersTable.shippingAmount,
        requestedQuantity: ordersTable.requestedQuantity,
        fulfilledQuantity: ordersTable.fulfilledQuantity,
        approvalDate: ordersTable.approvalDate,
        createdAt: ordersTable.createdAt,
        customerId: ordersTable.customerId,
        customerExternalId: customersTable.externalId,
        customerName: customersTable.name,
        customerEmail: customersTable.email,
        customerPhone: customersTable.phone,
        documentType: customersTable.documentType,
        documentLast4: customersTable.documentLast4,
        customerUtmSource: customersTable.utmSource,
        customerUtmMedium: customersTable.utmMedium,
        customerUtmCampaign: customersTable.utmCampaign,
        state: ordersTable.state,
        city: ordersTable.city,
      })
      .from(ordersTable)
      .leftJoin(customersTable, eq(ordersTable.customerId, customersTable.id))
      .where(listWhere)
      .orderBy(desc(ordersTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(ordersTable)
      .leftJoin(customersTable, eq(ordersTable.customerId, customersTable.id))
      .where(listWhere),
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(customersTable)
      .where(and(eq(customersTable.clientId, clientId), gte(customersTable.createdAt, from), lte(customersTable.createdAt, to), eq(customersTable.registrationStatus, "APPROVED"))),
  ]);

  const customerIds = Array.from(new Set(metricOrders.map((order) => order.customerId).filter(Boolean)));
  const customerOrderHistory = customerIds.length > 0
    ? await db
        .select({
          customerId: ordersTable.customerId,
          firstOrderAt: sql<Date>`MIN(${ordersTable.createdAt})`,
          totalOrders: sql<number>`COUNT(*)::int`,
        })
        .from(ordersTable)
        .where(and(eq(ordersTable.clientId, clientId), inArray(ordersTable.customerId, customerIds)))
        .groupBy(ordersTable.customerId)
    : [];
  const firstOrderByCustomer = new Map(customerOrderHistory.map((row) => [row.customerId, row.firstOrderAt]));
  const uniqueCustomers = new Set(metricOrders.map((order) => order.customerId));
  const newCustomers = new Set<string>();
  const returningCustomers = new Set<string>();
  for (const order of metricOrders) {
    const firstOrderAt = firstOrderByCustomer.get(order.customerId);
    const isFirstInPeriod = firstOrderAt ? new Date(firstOrderAt).getTime() >= from.getTime() && new Date(firstOrderAt).getTime() <= to.getTime() : false;
    if (isFirstInPeriod) newCustomers.add(order.customerId);
    else returningCustomers.add(order.customerId);
  }

  const upzeroRange = upzeroAttributionHistoryRange(req.query as Record<string, unknown>, from, to);
  const touchesByUser = new Map<number, Array<{ occurredAt: string; dimension: UtmDimension }>>();
  const trackingRowsByUser = new Map<number, UpzeroAnalyticsMetric[]>();
  if (clientConfig?.upZeroApiKey) {
    try {
      const tracking = await getUpzeroTrackingRowsChunked({
        ...upzeroRange,
        apiKey: clientConfig.upZeroApiKey,
        context: "orders-page",
      });
      for (const row of tracking.rows) {
        const user = getMetricUser(row);
        if (!user) continue;
        if (!isPaidCampaignSignal(row) && !row.utm_source && !row.utm_medium && !row.utm_campaign && !row.fbc && !row.fbclid && !row.gclid) continue;
        const list = touchesByUser.get(user.id) ?? [];
        list.push({ occurredAt: row.period_start, dimension: derivedUtmDimension(row) });
        touchesByUser.set(user.id, list);
        const rawList = trackingRowsByUser.get(user.id) ?? [];
        rawList.push(row);
        trackingRowsByUser.set(user.id, rawList);
      }
      for (const list of touchesByUser.values()) {
        list.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
      }
      for (const list of trackingRowsByUser.values()) {
        list.sort((a, b) => new Date(a.period_start).getTime() - new Date(b.period_start).getTime());
      }
    } catch (err) {
      console.warn("[orders-page] UP Zero attribution fetch failed:", err instanceof Error ? err.message : err);
    }
  }

  const customerForStampByUser = new Map<number, CampaignLocalCustomer>();
  const localOrdersForStamp = new Map<string, CampaignLocalOrderSummary>();
  const evidenceRowsToStamp: UpzeroAnalyticsMetric[] = [];
  const rows = orderRows.map((order) => {
    const userId = Number.parseInt(order.customerExternalId ?? "", 10);
    const touch = Number.isFinite(userId) ? latestTouchBefore(touchesByUser.get(userId) ?? [], order.createdAt) : null;
    const evidence = Number.isFinite(userId)
      ? latestCampaignEvidenceBefore(trackingRowsByUser.get(userId) ?? [], order.createdAt)
      : null;
    if (evidence && order.customerId) {
      customerForStampByUser.set(userId, {
        id: order.customerId,
        externalId: order.customerExternalId,
        name: order.customerName,
        email: order.customerEmail ?? "",
        phone: order.customerPhone,
        documentType: order.documentType,
        documentLast4: order.documentLast4,
        registrationStatus: "APPROVED",
        createdAt: order.createdAt,
        totalOrders: 0,
        utmSource: order.customerUtmSource,
        utmMedium: order.customerUtmMedium,
        utmCampaign: order.customerUtmCampaign,
        utmContent: null,
        utmTerm: null,
      });
      const current = localOrdersForStamp.get(order.customerId) ?? {
        purchaseCount: 0,
        orderIds: [],
        totalPurchaseValue: 0,
        lastOrderAt: null,
      };
      current.purchaseCount += 1;
      current.totalPurchaseValue += order.amount ?? 0;
      const numericExternalId = Number.parseInt(order.externalId ?? "", 10);
      if (Number.isFinite(numericExternalId)) current.orderIds.push(numericExternalId);
      const orderAt = order.createdAt.toISOString();
      if (!current.lastOrderAt || new Date(orderAt).getTime() > new Date(current.lastOrderAt).getTime()) {
        current.lastOrderAt = orderAt;
      }
      localOrdersForStamp.set(order.customerId, current);
      evidenceRowsToStamp.push(evidence);
    }
    const stored = storedOrderUtmDimension({
      utmSource: order.customerUtmSource,
      utmMedium: order.customerUtmMedium,
      utmCampaign: order.customerUtmCampaign,
    });
    const hasStoredUtm = stored.source !== "direct" || stored.medium !== "none" || stored.campaign !== "sem campanha";
    const origin = touch
      ? orderOriginFromDimension(touch, "tracking")
      : orderOriginFromDimension(hasStoredUtm ? stored : null, hasStoredUtm ? "customer_utm" : "direct");
    return {
      ...order,
      document: maskDocumentLast4(order.documentLast4, order.documentType),
      origin,
    };
  });

  await stampCampaignAttributions({
    clientId,
    customers: [...customerForStampByUser.values()],
    rows: evidenceRowsToStamp,
    localOrders: localOrdersForStamp,
  });

  const requestedRevenue = metricOrders.reduce((sum, order) => sum + Number(order.amount ?? 0), 0);
  const fulfilledRevenue = metricOrders.reduce((sum, order) => sum + Number(order.fulfilledAmount ?? 0), 0);
  const requestedQuantity = metricOrders.reduce((sum, order) => sum + Number(order.requestedQuantity ?? 0), 0);
  const fulfilledQuantity = metricOrders.reduce((sum, order) => sum + Number(order.fulfilledQuantity ?? 0), 0);
  const fulfilledPct = requestedRevenue > 0 ? (fulfilledRevenue / requestedRevenue) * 100 : 0;
  const approvedLeads = Number(approvedLeadsRow?.count ?? 0);
  const ordersCount = metricOrders.length;
  const customerCount = uniqueCustomers.size;

  res.json({
    period: { from: from.toISOString(), to: to.toISOString() },
    kpis: {
      requestedRevenue,
      fulfilledRevenue,
      requestedQuantity,
      fulfilledQuantity,
      fulfilledPct,
      orders: ordersCount,
      newCustomers: newCustomers.size,
      returningCustomers: returningCustomers.size,
      retentionPct: customerCount > 0 ? (returningCustomers.size / customerCount) * 100 : 0,
      conversionPct: approvedLeads > 0 ? (ordersCount / approvedLeads) * 100 : 0,
      approvedLeads,
    },
    rows,
    page,
    limit,
    total: Number(countRow?.count ?? 0),
  });
});

router.get("/analytics/orders-page/:orderId", async (req, res): Promise<void> => {
  const clientId = requireClient(req, res);
  if (!clientId) return;
  const orderId = z.string().safeParse(req.params.orderId);
  if (!orderId.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: orderId.error.message, status: 400 });
    return;
  }

  const [order] = await db
    .select({
      id: ordersTable.id,
      externalId: ordersTable.externalId,
      status: ordersTable.status,
      amount: ordersTable.amount,
      fulfilledAmount: ordersTable.fulfilledAmount,
      grossAmount: ordersTable.grossAmount,
      discountAmount: ordersTable.discountAmount,
      shippingAmount: ordersTable.shippingAmount,
      refundedAmount: ordersTable.refundedAmount,
      cancelledAmount: ordersTable.cancelledAmount,
      requestedQuantity: ordersTable.requestedQuantity,
      fulfilledQuantity: ordersTable.fulfilledQuantity,
      approvalDate: ordersTable.approvalDate,
      createdAt: ordersTable.createdAt,
      state: ordersTable.state,
      city: ordersTable.city,
      customerId: customersTable.id,
      customerExternalId: customersTable.externalId,
      customerName: customersTable.name,
      customerEmail: customersTable.email,
      customerPhone: customersTable.phone,
      customerState: customersTable.state,
      customerCity: customersTable.city,
      documentType: customersTable.documentType,
      documentLast4: customersTable.documentLast4,
      firstPurchaseAt: customersTable.firstPurchaseAt,
      lastPurchaseAt: customersTable.lastPurchaseAt,
      totalOrders: customersTable.totalOrders,
      totalSpent: customersTable.totalSpent,
    })
    .from(ordersTable)
    .leftJoin(customersTable, eq(ordersTable.customerId, customersTable.id))
    .where(and(eq(ordersTable.id, orderId.data), eq(ordersTable.clientId, clientId)));

  if (!order) {
    res.status(404).json({ error: true, code: "NOT_FOUND", message: "Order not found", status: 404 });
    return;
  }

  const items = await db
    .select({
      id: orderItemsTable.id,
      quantity: orderItemsTable.quantity,
      fulfilledQuantity: orderItemsTable.fulfilledQuantity,
      priceAtSale: orderItemsTable.priceAtSale,
      grossPriceAtSale: orderItemsTable.grossPriceAtSale,
      discountAmount: orderItemsTable.discountAmount,
      size: orderItemsTable.size,
      color: orderItemsTable.color,
      productId: productsTable.id,
      sku: productsTable.sku,
      name: productsTable.name,
      category: productsTable.category,
      imageUrl: productsTable.imageUrl,
    })
    .from(orderItemsTable)
    .innerJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
    .where(eq(orderItemsTable.orderId, order.id))
    .orderBy(asc(productsTable.name));

  res.json({
    order: {
      ...order,
      document: maskDocumentLast4(order.documentLast4, order.documentType),
    },
    customer: {
      id: order.customerId,
      externalId: order.customerExternalId,
      name: order.customerName,
      email: order.customerEmail,
      phone: order.customerPhone,
      state: order.customerState,
      city: order.customerCity,
      documentType: order.documentType,
      document: maskDocumentLast4(order.documentLast4, order.documentType),
      firstPurchaseAt: order.firstPurchaseAt,
      lastPurchaseAt: order.lastPurchaseAt,
      totalOrders: order.totalOrders,
      totalSpent: order.totalSpent,
    },
    items,
  });
});

router.get("/analytics/orders", async (req, res): Promise<void> => {
  const parsed = GetOrdersByDateQueryParams.safeParse(coerceDateQuery(req.query as Record<string, unknown>));
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }
  const clientId = requireClient(req, res);
  if (!clientId) return;
  const day = parsed.data.date;
  const limit = parsed.data.limit ?? 25;

  const start = new Date(day);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCHours(23, 59, 59, 999);

  const where = and(
    eq(ordersTable.clientId, clientId),
    gte(ordersTable.createdAt, start),
    lte(ordersTable.createdAt, end),
  );

  const rows = await db
    .select({
      id: ordersTable.id,
      amount: ordersTable.amount,
      status: ordersTable.status,
      customerId: ordersTable.customerId,
      customerName: customersTable.name,
      customerEmail: customersTable.email,
      sellerName: sellersTable.name,
      state: ordersTable.state,
      city: ordersTable.city,
      createdAt: ordersTable.createdAt,
    })
    .from(ordersTable)
    .leftJoin(customersTable, eq(ordersTable.customerId, customersTable.id))
    .leftJoin(sellersTable, eq(ordersTable.sellerId, sellersTable.id))
    .where(where)
    .orderBy(desc(ordersTable.amount))
    .limit(limit);

  const [agg] = await db
    .select({
      totalOrders: sql<number>`COUNT(*)::int`,
      totalRevenue: sql<number>`COALESCE(SUM(CASE WHEN ${ordersTable.status} IN ('APPROVED','SHIPPED','DELIVERED') THEN ${ordersTable.amount} ELSE 0 END), 0)::float`,
    })
    .from(ordersTable)
    .where(where);

  res.json(
    GetOrdersByDateResponse.parse({
      date: start.toISOString().slice(0, 10),
      totalOrders: Number(agg.totalOrders) || 0,
      totalRevenue: Number(agg.totalRevenue) || 0,
      orders: rows,
    }),
  );
});

// ───────── AI insight: cached + heuristic fallback ─────────

interface InsightCacheEntry {
  expiresAt: number;
  payload: { headline: string; body: string; bullets: string[]; generatedAt: string; source: "ai" | "heuristic" };
}
const insightCache = new Map<string, InsightCacheEntry>();
const INSIGHT_TTL_MS = 30 * 60 * 1000; // 30 minutes

function buildHeuristic(
  kpis: { revenue: number; orders: number; conversionRate: number; avgTicket: number; approvalRate: number },
  topCategory: { category: string; revenue: number } | null,
  topSeller: { name: string; revenue: number } | null,
  trend: number,
): { headline: string; body: string; bullets: string[] } {
  const trendPct = (trend * 100).toFixed(1);
  const headline =
    trend > 0.05
      ? `Revenue trending up ${trendPct}% versus the prior window.`
      : trend < -0.05
        ? `Revenue dipping ${Math.abs(parseFloat(trendPct)).toFixed(1)}% versus the prior window.`
        : `Revenue holding steady at ${kpis.revenue.toFixed(0)}.`;

  const body = `Across the period the catalog generated ${kpis.orders} orders at an average ticket of ${kpis.avgTicket.toFixed(2)}, with a ${kpis.conversionRate.toFixed(1)}% visit-to-purchase conversion rate.`;

  const bullets: string[] = [];
  if (topCategory) bullets.push(`Top category: ${topCategory.category} (${topCategory.revenue.toFixed(0)}).`);
  if (topSeller) bullets.push(`Top seller: ${topSeller.name} (${topSeller.revenue.toFixed(0)}).`);
  if (kpis.approvalRate > 0) bullets.push(`Lead approval rate ${kpis.approvalRate.toFixed(1)}%.`);
  return { headline, body, bullets };
}

async function buildInsightContext(
  clientId: string,
  from: Date,
  to: Date,
): Promise<{
  kpis: { revenue: number; orders: number; conversionRate: number; avgTicket: number; approvalRate: number };
  topCategory: { category: string; revenue: number } | null;
  topSeller: { name: string; revenue: number } | null;
  trend: number;
  brand: string;
}> {
  const baseWhere = and(
    eq(ordersTable.clientId, clientId),
    gte(ordersTable.createdAt, from),
    lte(ordersTable.createdAt, to),
    sql`${ordersTable.status} IN ('APPROVED', 'SHIPPED', 'DELIVERED')`,
  );

  const [orderAgg] = await db
    .select({
      revenue: sql<number>`COALESCE(SUM(${ordersTable.amount}), 0)::float`,
      orders: sql<number>`COUNT(*)::int`,
    })
    .from(ordersTable)
    .where(baseWhere);

  const [eventAgg] = await db
    .select({
      visits: sql<number>`COUNT(*) FILTER (WHERE ${eventsTable.eventType} = 'VISIT')::int`,
      registrations: sql<number>`COUNT(*) FILTER (WHERE ${eventsTable.eventType} = 'REGISTRATION')::int`,
      approvals: sql<number>`COUNT(*) FILTER (WHERE ${eventsTable.eventType} = 'APPROVED_REGISTRATION')::int`,
    })
    .from(eventsTable)
    .where(
      and(
        eq(eventsTable.clientId, clientId),
        gte(eventsTable.createdAt, from),
        lte(eventsTable.createdAt, to),
      ),
    );

  const revenue = Number(orderAgg.revenue) || 0;
  const orders = Number(orderAgg.orders) || 0;
  const visits = Number(eventAgg.visits) || 0;
  const registrations = Number(eventAgg.registrations) || 0;
  const approvals = Number(eventAgg.approvals) || 0;
  const kpis = {
    revenue,
    orders,
    avgTicket: orders > 0 ? revenue / orders : 0,
    conversionRate: visits > 0 ? Math.min(100, (orders / visits) * 100) : 0,
    approvalRate: registrations > 0 ? Math.min(100, (approvals / registrations) * 100) : 0,
  };

  // Compare to prior window of equal length.
  const span = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - span);
  const [prevAgg] = await db
    .select({ revenue: sql<number>`COALESCE(SUM(${ordersTable.amount}), 0)::float` })
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.clientId, clientId),
        gte(ordersTable.createdAt, prevFrom),
        lte(ordersTable.createdAt, prevTo),
        sql`${ordersTable.status} IN ('APPROVED', 'SHIPPED', 'DELIVERED')`,
      ),
    );
  const prevRevenue = Number(prevAgg.revenue) || 0;
  const trend = prevRevenue > 0 ? (revenue - prevRevenue) / prevRevenue : 0;

  const [topCat] = await db
    .select({
      category: sql<string>`COALESCE(${productsTable.category}, 'Uncategorized')`,
      revenue: sql<number>`COALESCE(SUM(${orderItemsTable.priceAtSale} * ${orderItemsTable.quantity}), 0)::float`,
    })
    .from(orderItemsTable)
    .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
    .innerJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
    .where(
      and(
        eq(ordersTable.clientId, clientId),
        gte(ordersTable.createdAt, from),
        lte(ordersTable.createdAt, to),
        sql`${ordersTable.status} IN ('APPROVED', 'SHIPPED', 'DELIVERED')`,
      ),
    )
    .groupBy(productsTable.category)
    .orderBy(sql`SUM(${orderItemsTable.priceAtSale} * ${orderItemsTable.quantity}) DESC`)
    .limit(1);

  const [topSeller] = await db
    .select({
      name: sellersTable.name,
      revenue: sql<number>`COALESCE(SUM(${ordersTable.amount}), 0)::float`,
    })
    .from(ordersTable)
    .innerJoin(sellersTable, eq(ordersTable.sellerId, sellersTable.id))
    .where(
      and(
        eq(ordersTable.clientId, clientId),
        gte(ordersTable.createdAt, from),
        lte(ordersTable.createdAt, to),
        sql`${ordersTable.status} IN ('APPROVED', 'SHIPPED', 'DELIVERED')`,
      ),
    )
    .groupBy(sellersTable.id, sellersTable.name)
    .orderBy(sql`SUM(${ordersTable.amount}) DESC`)
    .limit(1);

  const [brand] = await db
    .select({ name: clientsTable.name })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));

  return {
    kpis,
    topCategory: topCat ? { category: topCat.category, revenue: Number(topCat.revenue) || 0 } : null,
    topSeller: topSeller ? { name: topSeller.name, revenue: Number(topSeller.revenue) || 0 } : null,
    trend,
    brand: brand?.name ?? "the brand",
  };
}

// ── Marketing-specific insight context ───────────────────────────────────────
async function buildMarketingInsightContext(clientId: string, from: Date, to: Date) {
  const creatives = await db
    .select()
    .from(creativesTable)
    .where(eq(creativesTable.clientId, clientId));

  const activeCreatives = creatives.filter((c) => computeSpendOverlapFraction(c, from, to) > 0);
  const kpis = await computeMarketingKpis(clientId, activeCreatives, from, to);

  // Previous period for trend
  const span = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - span);
  const prevActive = creatives.filter((c) => computeSpendOverlapFraction(c, prevFrom, prevTo) > 0);
  const prevKpis = await computeMarketingKpis(clientId, prevActive, prevFrom, prevTo);

  const roasTrend = prevKpis.roas > 0 ? (kpis.roas - prevKpis.roas) / prevKpis.roas : 0;

  // Top platform by spend
  const platformTotals: Record<string, number> = {};
  for (const c of activeCreatives) {
    const fraction = computeSpendOverlapFraction(c, from, to);
    platformTotals[c.platform] = (platformTotals[c.platform] ?? 0) + c.spend * fraction;
  }
  const topPlatform = Object.entries(platformTotals).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "n/a";

  const [brand] = await db.select({ name: clientsTable.name }).from(clientsTable).where(eq(clientsTable.id, clientId));

  return { kpis, prevKpis, roasTrend, topPlatform, brand: brand?.name ?? "the brand" };
}

function buildMarketingHeuristic(ctx: Awaited<ReturnType<typeof buildMarketingInsightContext>>) {
  const { kpis, roasTrend, topPlatform } = ctx;
  const roasPct = (roasTrend * 100).toFixed(1);
  const trending = roasTrend >= 0 ? "up" : "down";
  return {
    headline: `ROAS is ${trending} ${Math.abs(Number(roasPct))}% vs last period at ${kpis.roas.toFixed(2)}×`,
    body: `You spent R$${kpis.totalSpend.toFixed(0)} on paid channels and generated R$${kpis.attributedRevenue.toFixed(0)} in attributed revenue. ${topPlatform} is your top-performing platform.`,
    bullets: [
      `${kpis.approvedLeads} approved leads at R$${kpis.cpa.toFixed(0)} CPA`,
      `Cost per lead is R$${kpis.cpl.toFixed(0)} — ${kpis.approvalRate.toFixed(0)}% approval rate`,
      roasTrend >= 0 ? "Paid channel ROAS is improving — consider scaling top creatives" : "ROAS is declining — review underperforming creatives and adjust bids",
    ],
  };
}

async function generateInsight(
  clientId: string,
  from: Date,
  to: Date,
  forceRefresh: boolean,
  screen: string = "dashboard",
): Promise<{ headline: string; body: string; bullets: string[]; generatedAt: string; cached: boolean; source: "ai" | "heuristic" }> {
  const cacheKey = `${clientId}|${from.toISOString().slice(0, 10)}|${to.toISOString().slice(0, 10)}|${screen}`;
  if (!forceRefresh) {
    const cached = insightCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.payload, cached: true };
    }
  }

  // Use marketing-specific context when requested
  if (screen === "marketing") {
    const mktCtx = await buildMarketingInsightContext(clientId, from, to);
    const heuristic = buildMarketingHeuristic(mktCtx);
    let payload: { headline: string; body: string; bullets: string[]; source: "ai" | "heuristic" } = {
      ...heuristic,
      source: "heuristic",
    };
    const ai = getOpenAIClient();
    if (ai && isAIConfigured()) {
      try {
        const { kpis, roasTrend, topPlatform, brand } = mktCtx;
        const mktPrompt = `You are a senior paid-media analyst writing one weekly marketing insight card for the brand "${brand}". Speak directly to the brand owner. Use the following metrics for ${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}:

Ad Spend: R$${kpis.totalSpend.toFixed(2)}
Attributed Revenue: R$${kpis.attributedRevenue.toFixed(2)}
ROAS: ${kpis.roas.toFixed(2)}x
ROAS trend vs prior window: ${(roasTrend * 100).toFixed(2)}%
Total Leads: ${kpis.totalLeads}
Approved Leads: ${kpis.approvedLeads}
Approval Rate: ${kpis.approvalRate.toFixed(1)}%
CPL (cost per lead): R$${kpis.cpl.toFixed(2)}
CPA (cost per approved lead): R$${kpis.cpa.toFixed(2)}
Top platform by spend: ${topPlatform}

Focus on paid-channel performance and next best actions. Return strict JSON:
{
  "headline": "<one short sentence, <80 chars>",
  "body": "<2-3 plain sentences explaining the most important marketing takeaway>",
  "bullets": ["<actionable bullet>", "<actionable bullet>", "<actionable bullet>"]
}
No markdown, no preamble.`;
        const completion = await ai.chat.completions.create({
          model: "gpt-5-nano",
          max_completion_tokens: 600,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "You write concise, actionable B2B paid-media marketing insights. Always respond with the requested JSON shape only." },
            { role: "user", content: mktPrompt },
          ],
        });
        const text = completion.choices[0]?.message?.content;
        if (text) {
          const parsed = JSON.parse(text) as { headline?: string; body?: string; bullets?: string[] };
          if (typeof parsed.headline === "string" && typeof parsed.body === "string" && Array.isArray(parsed.bullets)) {
            payload = {
              headline: parsed.headline.slice(0, 120),
              body: parsed.body.slice(0, 600),
              bullets: parsed.bullets.slice(0, 4).map((b) => String(b).slice(0, 160)),
              source: "ai",
            };
          }
        }
      } catch (err) {
        console.warn("[insight:marketing] AI generation failed, using heuristic:", (err as Error).message);
      }
    }
    const generatedAt = new Date().toISOString();
    insightCache.set(cacheKey, { expiresAt: Date.now() + INSIGHT_TTL_MS, payload: { ...payload, generatedAt } });
    return { ...payload, generatedAt, cached: false };
  }

  // Products-specific insight
  if (screen === "products") {
    // Gather top-level product KPIs: top 5 by revenue, level distribution, sell-through
    const [topProducts, levelCounts] = await Promise.all([
      db
        .select({
          name: productsTable.name,
          totalRevenue: productsTable.totalRevenue,
          totalSold: productsTable.totalSold,
          stock: productsTable.stock,
          restockThreshold: productsTable.restockThreshold,
        })
        .from(productsTable)
        .where(eq(productsTable.clientId, clientId))
        .orderBy(desc(productsTable.totalRevenue))
        .limit(5),
      db
        .select({
          totalSold: productsTable.totalSold,
          stock: productsTable.stock,
          restockThreshold: productsTable.restockThreshold,
        })
        .from(productsTable)
        .where(eq(productsTable.clientId, clientId)),
    ]);

    const catalogAvg =
      levelCounts.length > 0
        ? levelCounts.reduce((s, r) => {
            const t = r.totalSold + r.stock;
            return s + (t > 0 ? r.totalSold / t : 0);
          }, 0) / levelCounts.length
        : 0;
    const levels = levelCounts.map((r) => computeProductLevel(r.totalSold, r.stock, r.restockThreshold, 0, catalogAvg));
    const atRiskCount = levels.filter((l) => l === "At Risk").length;
    const highConvCount = levels.filter((l) => l === "High Conversion").length;
    const totalProducts = levels.length;

    const heuristic = {
      headline: topProducts[0]
        ? `Top product "${topProducts[0].name}" has generated ${topProducts[0].totalRevenue.toFixed(0)} in lifetime revenue`
        : "No product sales recorded yet",
      body: `${highConvCount} of ${totalProducts} products are High Conversion (65%+ sell-through). ${atRiskCount > 0 ? `${atRiskCount} product${atRiskCount > 1 ? "s" : ""} are At Risk — never sold or very low turnover.` : "No products are At Risk."}`,
      bullets: [
        `High Conversion SKUs: ${highConvCount} of ${totalProducts} — consider re-ordering your bestsellers`,
        atRiskCount > 0 ? `${atRiskCount} At Risk SKU${atRiskCount > 1 ? "s" : ""} — these have never sold or have very poor turnover; consider markdown or discontinuation` : "All SKUs have recorded at least one sale — good catalog health",
        topProducts[0] ? `"${topProducts[0].name}" leads with ${topProducts[0].totalSold} units sold — study what drives its performance` : "Add sales data to unlock product performance insights",
      ],
    };

    let payload: { headline: string; body: string; bullets: string[]; source: "ai" | "heuristic" } = { ...heuristic, source: "heuristic" };
    const ai = getOpenAIClient();
    if (ai && isAIConfigured()) {
      try {
        const brand = (await db.select({ name: clientsTable.name }).from(clientsTable).where(eq(clientsTable.id, clientId)))[0]?.name ?? "the brand";
        const prompt = `You are a senior fashion-retail product analyst writing a weekly product catalog insight for "${brand}". Period: ${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}.
Total SKUs: ${totalProducts} | High Conversion: ${highConvCount} | At Risk: ${atRiskCount}
Top 5 products by revenue: ${topProducts.map((p) => `${p.name} (R$${p.totalRevenue.toFixed(0)}, sold ${p.totalSold})`).join("; ")}
Return strict JSON: {"headline":"<one short sentence <80 chars>","body":"<2-3 sentences>","bullets":["<actionable>","<actionable>","<actionable>"]}`;
        const completion = await ai.chat.completions.create({
          model: "gpt-5-nano",
          max_completion_tokens: 500,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "You write concise, actionable B2B product analytics insights. Always respond with the requested JSON shape only." },
            { role: "user", content: prompt },
          ],
        });
        const text = completion.choices[0]?.message?.content;
        if (text) {
          const parsed = JSON.parse(text) as { headline?: string; body?: string; bullets?: string[] };
          if (typeof parsed.headline === "string" && typeof parsed.body === "string" && Array.isArray(parsed.bullets)) {
            payload = { headline: parsed.headline.slice(0, 120), body: parsed.body.slice(0, 600), bullets: parsed.bullets.slice(0, 4).map((b) => String(b).slice(0, 160)), source: "ai" };
          }
        }
      } catch (err) {
        console.warn("[insight:products] AI generation failed, using heuristic:", (err as Error).message);
      }
    }
    const generatedAt = new Date().toISOString();
    insightCache.set(cacheKey, { expiresAt: Date.now() + INSIGHT_TTL_MS, payload: { ...payload, generatedAt } });
    return { ...payload, generatedAt, cached: false };
  }

  // Customers-specific insight
  if (screen === "customers") {
    const cKpis = await computeSummaryKpis(clientId, from, to);
    const hasAttribution = cKpis.approvalRatePct < 40;
    const heuristic = {
      headline: cKpis.totalRegistrations > 0
        ? `${cKpis.approvedRegistrations} of ${cKpis.totalRegistrations} registrations approved (${cKpis.approvalRatePct.toFixed(1)}%)`
        : "No registrations in this period",
      body: cKpis.totalBuyers > 0
        ? `${cKpis.totalBuyers} customers made purchases, while ${cKpis.customersWithoutPurchase} registered but never bought.${cKpis.avgTimeToFirstPurchaseDays != null ? ` Average time to first purchase: ${cKpis.avgTimeToFirstPurchaseDays}d.` : ""}`
        : "No purchases recorded in this period.",
      bullets: [
        `Approval rate: ${cKpis.approvalRatePct.toFixed(1)}% — ${hasAttribution ? "below 40%, consider improving your approval process" : "healthy conversion from registration to approval"}`,
        cKpis.avgTimeToFirstPurchaseDays != null
          ? `Avg ${cKpis.avgTimeToFirstPurchaseDays}d to first purchase — optimize post-approval activation flows to reduce this`
          : "Track time to first purchase by enabling first-purchase attribution",
        cKpis.customersWithoutPurchase > cKpis.totalBuyers
          ? `${cKpis.customersWithoutPurchase} registered customers never purchased — consider targeted re-engagement campaigns`
          : "Majority of registered customers have made at least one purchase — strong activation rate",
      ],
    };
    let payload: { headline: string; body: string; bullets: string[]; source: "ai" | "heuristic" } = { ...heuristic, source: "heuristic" };
    const ai = getOpenAIClient();
    if (ai && isAIConfigured()) {
      try {
        const brand = (await db.select({ name: clientsTable.name }).from(clientsTable).where(eq(clientsTable.id, clientId)))[0]?.name ?? "the brand";
        const prompt = `You are a senior CRM analyst writing one weekly customer insight card for the brand "${brand}". Speak directly to the brand owner. Period: ${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}.
Registrations: ${cKpis.totalRegistrations} | Approved: ${cKpis.approvedRegistrations} | Approval Rate: ${cKpis.approvalRatePct.toFixed(1)}%
Buyers: ${cKpis.totalBuyers} | Without purchase: ${cKpis.customersWithoutPurchase}
Avg days to 1st purchase: ${cKpis.avgTimeToFirstPurchaseDays ?? "N/A"} | Avg days between purchases: ${cKpis.avgTimeBetweenPurchasesDays ?? "N/A"}
Return strict JSON: {"headline":"<one short sentence <80 chars>","body":"<2-3 sentences>","bullets":["<actionable>","<actionable>","<actionable>"]}`;
        const completion = await ai.chat.completions.create({
          model: "gpt-5-nano",
          max_completion_tokens: 500,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "You write concise, actionable B2B CRM insights for fashion retail brands. Always respond with the requested JSON shape only." },
            { role: "user", content: prompt },
          ],
        });
        const text = completion.choices[0]?.message?.content;
        if (text) {
          const parsed = JSON.parse(text) as { headline?: string; body?: string; bullets?: string[] };
          if (typeof parsed.headline === "string" && typeof parsed.body === "string" && Array.isArray(parsed.bullets)) {
            payload = { headline: parsed.headline.slice(0, 120), body: parsed.body.slice(0, 600), bullets: parsed.bullets.slice(0, 4).map((b) => String(b).slice(0, 160)), source: "ai" };
          }
        }
      } catch (err) {
        console.warn("[insight:customers] AI generation failed, using heuristic:", (err as Error).message);
      }
    }
    const generatedAt = new Date().toISOString();
    insightCache.set(cacheKey, { expiresAt: Date.now() + INSIGHT_TTL_MS, payload: { ...payload, generatedAt } });
    return { ...payload, generatedAt, cached: false };
  }

  // Sellers-specific insight
  if (screen === "sellers") {
    const topSellers = await db
      .select({
        name: sellersTable.name,
        totalRevenue: sellersTable.totalRevenue,
        totalOrders: sellersTable.totalOrders,
      })
      .from(sellersTable)
      .where(eq(sellersTable.clientId, clientId))
      .orderBy(desc(sellersTable.totalRevenue))
      .limit(5);

    const totalRevenue = topSellers.reduce((s, r) => s + r.totalRevenue, 0);
    const topRevShare = totalRevenue > 0 && topSellers[0] ? (topSellers[0].totalRevenue / totalRevenue) * 100 : 0;
    const heuristic = {
      headline: topSellers[0]
        ? `${topSellers[0].name} leads with ${topSellers[0].totalOrders} orders and ${topSellers[0].totalRevenue.toFixed(0)} in lifetime revenue`
        : "No seller activity recorded yet",
      body: topSellers.length > 0
        ? `Top seller ${topSellers[0]?.name} accounts for ${topRevShare.toFixed(1)}% of total seller revenue. ${topSellers.length > 1 ? `The next ${topSellers.length - 1} sellers share the remaining ${(100 - topRevShare).toFixed(1)}%.` : ""}`
        : "Add seller attribution to unlock performance insights.",
      bullets: [
        topSellers[0] ? `${topSellers[0].name} — ${topSellers[0].totalOrders} orders · ${topRevShare.toFixed(1)}% revenue share` : "No seller data available",
        topSellers[1] ? `${topSellers[1].name} — ${topSellers[1].totalOrders} orders · ${totalRevenue > 0 ? ((topSellers[1].totalRevenue / totalRevenue) * 100).toFixed(1) : 0}% revenue share` : "Only one seller on record",
        topSellers.length > 2
          ? `${topSellers.length} sellers active — compare their avg ticket to identify coaching opportunities`
          : "Add more sellers to enable benchmarking",
      ],
    };
    let payload: { headline: string; body: string; bullets: string[]; source: "ai" | "heuristic" } = { ...heuristic, source: "heuristic" };
    const ai = getOpenAIClient();
    if (ai && isAIConfigured()) {
      try {
        const brand = (await db.select({ name: clientsTable.name }).from(clientsTable).where(eq(clientsTable.id, clientId)))[0]?.name ?? "the brand";
        const prompt = `You are a senior B2B fashion-retail sales analyst writing a weekly seller team insight for "${brand}". Period: ${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}.
Top sellers: ${topSellers.map((s) => `${s.name} (R$${s.totalRevenue.toFixed(0)}, ${s.totalOrders} orders)`).join("; ")}
Total sellers active: ${topSellers.length}
Return strict JSON: {"headline":"<one short sentence <80 chars>","body":"<2-3 sentences>","bullets":["<actionable>","<actionable>","<actionable>"]}`;
        const completion = await ai.chat.completions.create({
          model: "gpt-5-nano",
          max_completion_tokens: 500,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "You write concise, actionable B2B sales-team insights for fashion brands. Always respond with the requested JSON shape only." },
            { role: "user", content: prompt },
          ],
        });
        const text = completion.choices[0]?.message?.content;
        if (text) {
          const parsed = JSON.parse(text) as { headline?: string; body?: string; bullets?: string[] };
          if (typeof parsed.headline === "string" && typeof parsed.body === "string" && Array.isArray(parsed.bullets)) {
            payload = { headline: parsed.headline.slice(0, 120), body: parsed.body.slice(0, 600), bullets: parsed.bullets.slice(0, 4).map((b) => String(b).slice(0, 160)), source: "ai" };
          }
        }
      } catch (err) {
        console.warn("[insight:sellers] AI generation failed, using heuristic:", (err as Error).message);
      }
    }
    const generatedAt = new Date().toISOString();
    insightCache.set(cacheKey, { expiresAt: Date.now() + INSIGHT_TTL_MS, payload: { ...payload, generatedAt } });
    return { ...payload, generatedAt, cached: false };
  }

  // Stock-specific insight
  if (screen === "stock") {
    const periodDays = Math.max(1, (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
    const prods = await db
      .select({
        id: productsTable.id,
        name: productsTable.name,
        category: productsTable.category,
        stock: productsTable.stock,
        restockThreshold: productsTable.restockThreshold,
      })
      .from(productsTable)
      .where(and(eq(productsTable.clientId, clientId), sql`${productsTable.status} != 'DISCONTINUED'`));

    let stockoutCount = 0;
    let overstockCount = 0;
    let totalUnits = 0;
    let totalSold = 0;
    const stockoutNames: string[] = [];

    if (prods.length > 0) {
      const velRows = await db
        .select({
          productId: orderItemsTable.productId,
          unitsSold: sql<number>`COALESCE(SUM(${orderItemsTable.quantity}), 0)::int`,
        })
        .from(orderItemsTable)
        .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
        .where(
          and(
            inArray(orderItemsTable.productId, prods.map((p) => p.id)),
            eq(ordersTable.clientId, clientId),
            gte(ordersTable.createdAt, from),
            lte(ordersTable.createdAt, to),
            sql`${ordersTable.status} IN ('APPROVED', 'SHIPPED', 'DELIVERED')`,
          ),
        )
        .groupBy(orderItemsTable.productId);

      const velMap = new Map<string, number>();
      for (const v of velRows) velMap.set(v.productId, Number(v.unitsSold) || 0);

      for (const p of prods) {
        const units = velMap.get(p.id) ?? 0;
        totalSold += units;
        totalUnits += p.stock;
        const vel = units / periodDays;
        const cov = vel > 0 ? p.stock / vel : null;
        if (vel > 0 && cov !== null && cov < 7) {
          stockoutCount++;
          if (stockoutNames.length < 3) stockoutNames.push(p.name);
        } else if ((vel === 0 && p.stock > p.restockThreshold * 2) || (cov !== null && cov > 90)) {
          overstockCount++;
        }
      }
    }

    const sellThrough = totalSold + totalUnits > 0 ? ((totalSold / (totalSold + totalUnits)) * 100).toFixed(1) : "0";
    const heuristic = {
      headline: stockoutCount > 0
        ? `${stockoutCount} SKU${stockoutCount > 1 ? "s are" : " is"} at critical stockout risk this week`
        : overstockCount > 0
          ? `${overstockCount} SKU${overstockCount > 1 ? "s have" : " has"} excess inventory — review pricing or promotions`
          : `Inventory is healthy with a ${sellThrough}% sell-through rate`,
      body: `In the selected period, ${totalSold} units were sold across ${prods.length} active SKUs. Sell-through rate stands at ${sellThrough}%. ${stockoutCount > 0 ? `${stockoutCount} product${stockoutCount > 1 ? "s need" : " needs"} urgent replenishment.` : overstockCount > 0 ? `${overstockCount} product${overstockCount > 1 ? "s are" : " is"} overstocked.` : "No critical risk items detected."}`,
      bullets: [
        stockoutNames.length > 0 ? `Stockout risk: ${stockoutNames.join(", ")}` : `No stockout-risk products in this period`,
        overstockCount > 0 ? `${overstockCount} SKU${overstockCount > 1 ? "s" : ""} with >90 days coverage — consider markdowns` : "No overstock issues detected",
        `Current sell-through rate: ${sellThrough}% — aim for 60–80% for fashion`,
      ],
    };
    let payload: { headline: string; body: string; bullets: string[]; source: "ai" | "heuristic" } = { ...heuristic, source: "heuristic" };
    const ai = getOpenAIClient();
    if (ai && isAIConfigured()) {
      try {
        const brand = (await db.select({ name: clientsTable.name }).from(clientsTable).where(eq(clientsTable.id, clientId)))[0]?.name ?? "the brand";
        const prompt = `You are a senior B2B fashion-retail inventory analyst writing a weekly stock intelligence insight for "${brand}". Period: ${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}.
Total active SKUs: ${prods.length}
Total stock units: ${totalUnits}
Total units sold: ${totalSold}
Sell-through rate: ${sellThrough}%
Stockout-risk SKUs: ${stockoutCount}${stockoutNames.length > 0 ? ` (${stockoutNames.slice(0, 3).join(", ")})` : ""}
Overstock-risk SKUs: ${overstockCount}
Return strict JSON: {"headline":"<one short sentence <80 chars>","body":"<2-3 sentences>","bullets":["<actionable>","<actionable>","<actionable>"]}`;
        const completion = await ai.chat.completions.create({
          model: "gpt-5-nano",
          max_completion_tokens: 500,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "You write concise, actionable B2B inventory insights for fashion brands. Always respond with the requested JSON shape only." },
            { role: "user", content: prompt },
          ],
        });
        const text = completion.choices[0]?.message?.content;
        if (text) {
          const parsed = JSON.parse(text) as { headline?: string; body?: string; bullets?: string[] };
          if (typeof parsed.headline === "string" && typeof parsed.body === "string" && Array.isArray(parsed.bullets)) {
            payload = { headline: parsed.headline.slice(0, 120), body: parsed.body.slice(0, 600), bullets: parsed.bullets.slice(0, 4).map((b) => String(b).slice(0, 160)), source: "ai" };
          }
        }
      } catch (err) {
        console.warn("[insight:stock] AI generation failed, using heuristic:", (err as Error).message);
      }
    }
    const generatedAt2 = new Date().toISOString();
    insightCache.set(cacheKey, { expiresAt: Date.now() + INSIGHT_TTL_MS, payload: { ...payload, generatedAt: generatedAt2 } });
    return { ...payload, generatedAt: generatedAt2, cached: false };
  }

  // Journey-specific insight
  if (screen === "journey") {
    const jCtx = await buildJourneyInsightContext(clientId, from, to);
    const heuristic = {
      headline: jCtx.avgEventsBeforePurchase > 0
        ? `Buyers average ${jCtx.avgEventsBeforePurchase.toFixed(1)} events before purchasing`
        : "No purchase journey data available for this period",
      body: `Customers who converted touched an average of ${jCtx.avgEventsBeforePurchase.toFixed(1)} events before completing a purchase.${jCtx.avgTimeToFirstPurchaseDays > 0 ? ` Time from registration to first purchase averages ${jCtx.avgTimeToFirstPurchaseDays.toFixed(1)} days.` : ""}`,
      bullets: [
        `Avg events before purchase: ${jCtx.avgEventsBeforePurchase.toFixed(1)} — consider shortening the path to reduce drop-off`,
        jCtx.avgTimeToFirstPurchaseDays > 0
          ? `Avg time to first purchase: ${jCtx.avgTimeToFirstPurchaseDays.toFixed(1)} days — post-registration nurture can reduce this`
          : "Enable first-purchase attribution to track activation time",
        "Compare buyers vs non-buyers to identify the key events that differentiate converters",
      ],
    };
    let payload: { headline: string; body: string; bullets: string[]; source: "ai" | "heuristic" } = { ...heuristic, source: "heuristic" };
    const ai = getOpenAIClient();
    if (ai && isAIConfigured()) {
      try {
        const prompt = `You are a senior UX/CRO analyst writing a weekly journey analytics insight for "${jCtx.brand}". Period: ${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}.
Avg events before purchase: ${jCtx.avgEventsBeforePurchase.toFixed(2)}
Avg time to first purchase (days): ${jCtx.avgTimeToFirstPurchaseDays.toFixed(1)}
Return strict JSON: {"headline":"<one short sentence <80 chars>","body":"<2-3 sentences>","bullets":["<actionable>","<actionable>","<actionable>"]}`;
        const completion = await ai.chat.completions.create({
          model: "gpt-5-nano",
          max_completion_tokens: 500,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "You write concise, actionable B2B journey analytics insights for fashion brands. Always respond with the requested JSON shape only." },
            { role: "user", content: prompt },
          ],
        });
        const text = completion.choices[0]?.message?.content;
        if (text) {
          const parsed = JSON.parse(text) as { headline?: string; body?: string; bullets?: string[] };
          if (typeof parsed.headline === "string" && typeof parsed.body === "string" && Array.isArray(parsed.bullets)) {
            payload = { headline: parsed.headline.slice(0, 120), body: parsed.body.slice(0, 600), bullets: parsed.bullets.slice(0, 4).map((b) => String(b).slice(0, 160)), source: "ai" };
          }
        }
      } catch (err) {
        console.warn("[insight:journey] AI generation failed, using heuristic:", (err as Error).message);
      }
    }
    const gAt = new Date().toISOString();
    insightCache.set(cacheKey, { expiresAt: Date.now() + INSIGHT_TTL_MS, payload: { ...payload, generatedAt: gAt } });
    return { ...payload, generatedAt: gAt, cached: false };
  }

  // RFM-specific insight
  if (screen === "rfm") {
    const rfmCtx = await buildRfmInsightContext(clientId, from, to);
    const { segMap, total } = rfmCtx;
    const champions = segMap["Champions"] ?? { count: 0, revenue: 0 };
    const atRisk = segMap["At Risk"] ?? { count: 0, revenue: 0 };
    const lost = segMap["Lost"] ?? { count: 0, revenue: 0 };
    const heuristic = {
      headline: champions.count > 0
        ? `Champions represent ${((champions.count / Math.max(1, total)) * 100).toFixed(1)}% of your customer base`
        : "No RFM segments computed yet for this brand",
      body: `Your customer base is segmented into ${total} customers. Champions (${champions.count}) drive the highest lifetime value. ${atRisk.count > 0 ? `${atRisk.count} customers are At Risk — re-engagement can recover their revenue.` : ""}${lost.count > 0 ? ` ${lost.count} customers are Lost — consider win-back campaigns.` : ""}`,
      bullets: [
        `Champions: ${champions.count} customers, R$${champions.revenue.toFixed(0)} total revenue`,
        atRisk.count > 0 ? `At Risk: ${atRisk.count} customers — launch re-engagement campaigns` : "No At Risk customers right now — keep up retention efforts",
        lost.count > 0 ? `Lost: ${lost.count} customers — consider win-back offers` : "No Lost customers detected",
      ],
    };
    let payload: { headline: string; body: string; bullets: string[]; source: "ai" | "heuristic" } = { ...heuristic, source: "heuristic" };
    const ai = getOpenAIClient();
    if (ai && isAIConfigured()) {
      try {
        const segSummary = Object.entries(segMap).map(([s, v]) => `${s}: ${v.count} customers, R$${v.revenue.toFixed(0)}`).join(" | ");
        const prompt = `You are a senior CRM analyst writing a weekly RFM segmentation insight for "${rfmCtx.brand}". Total customers: ${total}. Segments: ${segSummary}. Return strict JSON: {"headline":"<one short sentence <80 chars>","body":"<2-3 sentences>","bullets":["<actionable>","<actionable>","<actionable>"]}`;
        const completion = await ai.chat.completions.create({
          model: "gpt-5-nano",
          max_completion_tokens: 500,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "You write concise, actionable B2B CRM/RFM insights for fashion brands. Always respond with the requested JSON shape only." },
            { role: "user", content: prompt },
          ],
        });
        const text = completion.choices[0]?.message?.content;
        if (text) {
          const parsed = JSON.parse(text) as { headline?: string; body?: string; bullets?: string[] };
          if (typeof parsed.headline === "string" && typeof parsed.body === "string" && Array.isArray(parsed.bullets)) {
            payload = { headline: parsed.headline.slice(0, 120), body: parsed.body.slice(0, 600), bullets: parsed.bullets.slice(0, 4).map((b) => String(b).slice(0, 160)), source: "ai" };
          }
        }
      } catch (err) {
        console.warn("[insight:rfm] AI generation failed, using heuristic:", (err as Error).message);
      }
    }
    const gAt = new Date().toISOString();
    insightCache.set(cacheKey, { expiresAt: Date.now() + INSIGHT_TTL_MS, payload: { ...payload, generatedAt: gAt } });
    return { ...payload, generatedAt: gAt, cached: false };
  }

  // UTM-specific insight
  if (screen === "utm") {
    const utmData = await buildUtmAnalytics(clientId, from, to, "source");
    const topRow = utmData.rows[0];
    const heuristic = {
      headline: topRow
        ? `${topRow.key} drives ${topRow.revenue > 0 ? `R$${topRow.revenue.toFixed(0)} in revenue` : `${topRow.registrations} registrations`} this period`
        : "No UTM attribution data available for this period",
      body: `UTM attribution for this period shows ${utmData.kpis.totalRegistrations} registrations across ${utmData.rows.length} acquisition sources. ${topRow ? `Top source "${topRow.key}" converts ${topRow.conversionPct.toFixed(1)}% of registrations into buyers.` : ""} Overall approval rate: ${utmData.kpis.approvalPct.toFixed(1)}%.`,
      bullets: [
        topRow
          ? `Top source: ${topRow.key} — ${topRow.buyers} buyers, R$${topRow.revenue.toFixed(0)} revenue${topRow.roas != null ? `, ROAS ${topRow.roas.toFixed(2)}x` : ""}`
          : "No source data available for this period",
        `Conversion rate: ${utmData.kpis.conversionPct.toFixed(1)}% of registrations become buyers — compare channels to find your highest-quality traffic`,
        `Approval rate: ${utmData.kpis.approvalPct.toFixed(1)}% overall — low approval on a high-spend source signals lead quality issues`,
      ],
    };
    let utmPayload: { headline: string; body: string; bullets: string[]; source: "ai" | "heuristic" } = { ...heuristic, source: "heuristic" };
    const aiUtm = getOpenAIClient();
    if (aiUtm && isAIConfigured() && topRow) {
      try {
        const sourceSummary = utmData.rows.slice(0, 6)
          .map((r) => `${r.key}: ${r.registrations} regs, ${r.buyers} buyers, R$${r.revenue.toFixed(0)}${r.roas != null ? `, ROAS ${r.roas.toFixed(2)}x` : ""}`)
          .join(" | ");
        const prompt = `You are a senior performance-marketing analyst writing a weekly UTM attribution insight for a fashion B2B platform. Period: ${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}. Total registrations: ${utmData.kpis.totalRegistrations}, buyers: ${utmData.kpis.totalBuyers}, revenue: R$${utmData.kpis.totalRevenue.toFixed(0)}. By source: ${sourceSummary}. Return strict JSON: {"headline":"<one short sentence <80 chars>","body":"<2-3 sentences>","bullets":["<actionable>","<actionable>","<actionable>"]}`;
        const completion = await aiUtm.chat.completions.create({
          model: "gpt-5-nano",
          max_completion_tokens: 500,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "You write concise, actionable B2B UTM attribution insights for fashion brands. Always respond with the requested JSON shape only." },
            { role: "user", content: prompt },
          ],
        });
        const text = completion.choices[0]?.message?.content;
        if (text) {
          const parsed = JSON.parse(text) as { headline?: string; body?: string; bullets?: string[] };
          if (typeof parsed.headline === "string" && typeof parsed.body === "string" && Array.isArray(parsed.bullets)) {
            utmPayload = { headline: parsed.headline.slice(0, 120), body: parsed.body.slice(0, 600), bullets: parsed.bullets.slice(0, 4).map((b) => String(b).slice(0, 160)), source: "ai" };
          }
        }
      } catch (err) {
        console.warn("[insight:utm] AI generation failed, using heuristic:", (err as Error).message);
      }
    }
    const utmAt = new Date().toISOString();
    insightCache.set(cacheKey, { expiresAt: Date.now() + INSIGHT_TTL_MS, payload: { ...utmPayload, generatedAt: utmAt } });
    return { ...utmPayload, generatedAt: utmAt, cached: false };
  }

  const ctx = await buildInsightContext(clientId, from, to);
  const heuristic = buildHeuristic(ctx.kpis, ctx.topCategory, ctx.topSeller, ctx.trend);

  let payload: { headline: string; body: string; bullets: string[]; source: "ai" | "heuristic" } = {
    ...heuristic,
    source: "heuristic",
  };

  const ai = getOpenAIClient();
  if (ai && isAIConfigured()) {
    try {
      const userPrompt = `You are a senior fashion-retail analyst writing one weekly insight card for the brand "${ctx.brand}". Speak directly to the brand owner. Use the following metrics for the period ${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}:

Revenue: ${ctx.kpis.revenue.toFixed(2)}
Orders: ${ctx.kpis.orders}
Avg ticket: ${ctx.kpis.avgTicket.toFixed(2)}
Visit-to-purchase: ${ctx.kpis.conversionRate.toFixed(2)}%
Lead approval: ${ctx.kpis.approvalRate.toFixed(2)}%
Revenue trend vs prior window: ${(ctx.trend * 100).toFixed(2)}%
Top category: ${ctx.topCategory?.category ?? "n/a"} (${ctx.topCategory?.revenue.toFixed(2) ?? 0})
Top seller: ${ctx.topSeller?.name ?? "n/a"} (${ctx.topSeller?.revenue.toFixed(2) ?? 0})

Return strict JSON:
{
  "headline": "<one short sentence, <80 chars>",
  "body": "<2-3 plain sentences explaining the most important takeaway>",
  "bullets": ["<actionable bullet>", "<actionable bullet>", "<actionable bullet>"]
}
No markdown, no preamble.`;

      const completion = await ai.chat.completions.create({
        model: "gpt-5-nano",
        max_completion_tokens: 600,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You write concise, actionable B2B analytics insights. Always respond with the requested JSON shape only." },
          { role: "user", content: userPrompt },
        ],
      });
      const text = completion.choices[0]?.message?.content;
      if (text) {
        const parsed = JSON.parse(text) as { headline?: string; body?: string; bullets?: string[] };
        if (
          typeof parsed.headline === "string" &&
          typeof parsed.body === "string" &&
          Array.isArray(parsed.bullets)
        ) {
          payload = {
            headline: parsed.headline.slice(0, 120),
            body: parsed.body.slice(0, 600),
            bullets: parsed.bullets.slice(0, 4).map((b) => String(b).slice(0, 160)),
            source: "ai",
          };
        }
      }
    } catch (err) {
      // Swallow AI errors; heuristic stays.
      console.warn("[insight] AI generation failed, using heuristic:", (err as Error).message);
    }
  }

  const generatedAt = new Date().toISOString();
  insightCache.set(cacheKey, {
    expiresAt: Date.now() + INSIGHT_TTL_MS,
    payload: { ...payload, generatedAt },
  });
  return { ...payload, generatedAt, cached: false };
}

// ───────── Stock Intelligence ─────────────────────────────────────────────
//
// Risk classification heuristics:
//   - dailyVelocity = unitsSold / periodDays
//   - coverageDays  = stock / dailyVelocity  (null when velocity = 0)
//   - Stockout      = velocity > 0 && coverageDays < 7
//   - Overstock     = (velocity == 0 && stock > restockThreshold*2) || coverageDays > 90
//   - Healthy       = everything else
//
router.get("/analytics/stock", async (req, res): Promise<void> => {
  const parsed = GetStockQueryParams.safeParse(
    coerceDateQuery(req.query as Record<string, unknown>),
  );
  if (!parsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }
  const clientId = requireClient(req, res);
  if (!clientId) return;

  const { from, to } = dateRange(parsed.data.dateFrom, parsed.data.dateTo);
  const periodMs = to.getTime() - from.getTime();
  const periodDays = Math.max(1, periodMs / (1000 * 60 * 60 * 24));
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - periodMs);
  const prevPeriodDays = periodDays;

  const {
    page,
    limit,
    sort = "coverageDays",
    sortDir = "asc",
    search,
    category,
    risk: riskFilter,
  } = parsed.data as {
    page: number;
    limit: number;
    sort?: string;
    sortDir?: string;
    search?: string;
    category?: string;
    risk?: string;
  };
  const utmSrc = (parsed.data as Record<string, unknown>).utmSource as string | undefined;
  const utmMed = (parsed.data as Record<string, unknown>).utmMedium as string | undefined;
  const stateFilt = (parsed.data as Record<string, unknown>).state as string | undefined;
  const cityFilt = (parsed.data as Record<string, unknown>).city as string | undefined;

  // ── 1. Fetch all products for this client ──────────────────────────────
  const products = await db
    .select({
      id: productsTable.id,
      sku: productsTable.sku,
      name: productsTable.name,
      category: productsTable.category,
      stock: productsTable.stock,
      restockThreshold: productsTable.restockThreshold,
      updatedAt: productsTable.updatedAt,
    })
    .from(productsTable)
    .where(
      and(
        eq(productsTable.clientId, clientId),
        sql`${productsTable.status} != 'DISCONTINUED'`,
      ),
    );

  if (products.length === 0) {
    const emptyKpis = { totalUnits: 0, avgCoverageDays: 0, stockoutRiskCount: 0, overstockRiskCount: 0, sellThroughRate: 0 };
    res.json(GetStockResponse.parse({
      kpis: emptyKpis,
      prevKpis: emptyKpis,
      stockoutRisk: [],
      overstockRisk: [],
      highTurnover: [],
      categoryBreakdown: [],
      colorBreakdown: [],
      sizeBreakdown: [],
      skus: [],
      total: 0,
      page,
      limit,
    }));
    return;
  }

  let productIds = products.map((p) => p.id);

  // ── Customer filter: restrict to products purchased by matching customers ──
  const anyCustomerFilter = utmSrc || utmMed || stateFilt || cityFilt;
  if (anyCustomerFilter && productIds.length > 0) {
    const utmConditions: SQL[] = [
      inArray(orderItemsTable.productId, productIds),
      eq(ordersTable.clientId, clientId),
      sql`${ordersTable.status} IN ('APPROVED','SHIPPED','DELIVERED')`,
    ];
    if (utmSrc) utmConditions.push(sql`lower(${customersTable.utmSource}) = lower(${utmSrc})`);
    if (utmMed) utmConditions.push(sql`lower(${customersTable.utmMedium}) = lower(${utmMed})`);
    if (stateFilt) utmConditions.push(sql`lower(${customersTable.state}) = lower(${stateFilt})`);
    if (cityFilt) utmConditions.push(sql`lower(${customersTable.city}) = lower(${cityFilt})`);
    const utmPurchasedRows = await db
      .selectDistinct({ productId: orderItemsTable.productId })
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .innerJoin(customersTable, eq(ordersTable.customerId, customersTable.id))
      .where(and(...utmConditions));
    const utmPids = new Set(utmPurchasedRows.map((r) => r.productId).filter(Boolean) as string[]);
    productIds = productIds.filter((id) => utmPids.has(id));
  }

  // Sync products metadata list to match filtered productIds (for SKU table display)
  const productIdSet = new Set(productIds);
  const filteredProducts = productIds.length < products.length
    ? products.filter((p) => productIdSet.has(p.id))
    : products;

  // ── 2. Velocity from order_items joined to orders for date filtering ────
  const fetchVelocity = async (winFrom: Date, winTo: Date) =>
    db
      .select({
        productId: orderItemsTable.productId,
        unitsSold: sql<number>`COALESCE(SUM(${orderItemsTable.quantity}), 0)::int`,
      })
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .where(
        and(
          inArray(orderItemsTable.productId, productIds),
          eq(ordersTable.clientId, clientId),
          gte(ordersTable.createdAt, winFrom),
          lte(ordersTable.createdAt, winTo),
          sql`${ordersTable.status} IN ('APPROVED', 'SHIPPED', 'DELIVERED')`,
        ),
      )
      .groupBy(orderItemsTable.productId);

  // ── 3. Color/size breakdown (current period only) ──────────────────────
  const fetchColorPerProduct = (winFrom: Date, winTo: Date) =>
    db
      .select({
        productId: orderItemsTable.productId,
        color: sql<string>`COALESCE(${orderItemsTable.color}, 'Unknown')`,
        unitsSold: sql<number>`COALESCE(SUM(${orderItemsTable.quantity}), 0)::int`,
      })
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .where(
        and(
          inArray(orderItemsTable.productId, productIds),
          eq(ordersTable.clientId, clientId),
          gte(ordersTable.createdAt, winFrom),
          lte(ordersTable.createdAt, winTo),
          sql`${ordersTable.status} IN ('APPROVED', 'SHIPPED', 'DELIVERED')`,
          sql`${orderItemsTable.color} IS NOT NULL`,
        ),
      )
      .groupBy(orderItemsTable.productId, sql`COALESCE(${orderItemsTable.color}, 'Unknown')`);

  const fetchSizePerProduct = (winFrom: Date, winTo: Date) =>
    db
      .select({
        productId: orderItemsTable.productId,
        size: sql<string>`COALESCE(${orderItemsTable.size}, 'Unknown')`,
        unitsSold: sql<number>`COALESCE(SUM(${orderItemsTable.quantity}), 0)::int`,
      })
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .where(
        and(
          inArray(orderItemsTable.productId, productIds),
          eq(ordersTable.clientId, clientId),
          gte(ordersTable.createdAt, winFrom),
          lte(ordersTable.createdAt, winTo),
          sql`${ordersTable.status} IN ('APPROVED', 'SHIPPED', 'DELIVERED')`,
          sql`${orderItemsTable.size} IS NOT NULL`,
        ),
      )
      .groupBy(orderItemsTable.productId, sql`COALESCE(${orderItemsTable.size}, 'Unknown')`);

  const [currVelocity, prevVelocity, colorPerProduct, sizePerProduct] = await Promise.all([
    fetchVelocity(from, to),
    fetchVelocity(prevFrom, prevTo),
    fetchColorPerProduct(from, to),
    fetchSizePerProduct(from, to),
  ]);

  const currVelMap = new Map<string, number>();
  for (const r of currVelocity) currVelMap.set(r.productId, Number(r.unitsSold) || 0);

  const prevVelMap = new Map<string, number>();
  for (const r of prevVelocity) prevVelMap.set(r.productId, Number(r.unitsSold) || 0);

  // ── 3b. Proportional stock allocation by color/size ────────────────────
  const productStockLookup = new Map<string, number>(products.map((p) => [p.id, p.stock]));

  const colorStockMap = new Map<string, { unitsSold: number; stockUnits: number }>();
  const colorProductMap = new Map<string, Map<string, number>>();
  for (const r of colorPerProduct) {
    let m = colorProductMap.get(r.productId);
    if (!m) { m = new Map(); colorProductMap.set(r.productId, m); }
    const color = String(r.color ?? "Unknown");
    m.set(color, (m.get(color) ?? 0) + (Number(r.unitsSold) || 0));
  }
  for (const [productId, dimMap] of colorProductMap.entries()) {
    const stock = productStockLookup.get(productId) ?? 0;
    const totalSold = [...dimMap.values()].reduce((s, v) => s + v, 0);
    for (const [color, sold] of dimMap.entries()) {
      const allocated = totalSold > 0 ? Math.round((sold / totalSold) * stock) : 0;
      const existing = colorStockMap.get(color) ?? { unitsSold: 0, stockUnits: 0 };
      existing.unitsSold += sold;
      existing.stockUnits += allocated;
      colorStockMap.set(color, existing);
    }
  }

  const sizeStockMap = new Map<string, { unitsSold: number; stockUnits: number }>();
  const sizeProductMap = new Map<string, Map<string, number>>();
  for (const r of sizePerProduct) {
    let m = sizeProductMap.get(r.productId);
    if (!m) { m = new Map(); sizeProductMap.set(r.productId, m); }
    const size = String(r.size ?? "Unknown");
    m.set(size, (m.get(size) ?? 0) + (Number(r.unitsSold) || 0));
  }
  for (const [productId, dimMap] of sizeProductMap.entries()) {
    const stock = productStockLookup.get(productId) ?? 0;
    const totalSold = [...dimMap.values()].reduce((s, v) => s + v, 0);
    for (const [size, sold] of dimMap.entries()) {
      const allocated = totalSold > 0 ? Math.round((sold / totalSold) * stock) : 0;
      const existing = sizeStockMap.get(size) ?? { unitsSold: 0, stockUnits: 0 };
      existing.unitsSold += sold;
      existing.stockUnits += allocated;
      sizeStockMap.set(size, existing);
    }
  }

  const colorBreakdownFinal = [...colorStockMap.entries()]
    .map(([color, v]) => ({ color, unitsSold: v.unitsSold, stockUnits: v.stockUnits }))
    .sort((a, b) => b.stockUnits - a.stockUnits);

  const sizeBreakdownFinal = [...sizeStockMap.entries()]
    .map(([size, v]) => ({ size, unitsSold: v.unitsSold, stockUnits: v.stockUnits }))
    .sort((a, b) => b.stockUnits - a.stockUnits);

  // ── 4. Classify each product ───────────────────────────────────────────
  function classify(stock: number, restockThreshold: number, velocity: number, pDays: number) {
    const dailyVelocity = velocity / pDays;
    const coverageDays = dailyVelocity > 0 ? stock / dailyVelocity : null;
    let risk: "Stockout" | "Overstock" | "Healthy";
    if (dailyVelocity > 0 && coverageDays !== null && coverageDays < 7) {
      risk = "Stockout";
    } else if (
      (dailyVelocity === 0 && stock > restockThreshold * 2) ||
      (coverageDays !== null && coverageDays > 90)
    ) {
      risk = "Overstock";
    } else {
      risk = "Healthy";
    }
    return { dailyVelocity, coverageDays, risk };
  }

  // ── 3c. Build per-product size/color lookup maps ───────────────────────
  const productBySizeMap = new Map<string, Array<{ size: string; unitsSold: number }>>();
  const productByColorMap = new Map<string, Array<{ color: string; unitsSold: number }>>();

  for (const r of sizePerProduct) {
    const pid = r.productId;
    const size = String(r.size ?? "Unknown");
    const sold = Number(r.unitsSold) || 0;
    let arr = productBySizeMap.get(pid);
    if (!arr) { arr = []; productBySizeMap.set(pid, arr); }
    const existing = arr.find((x) => x.size === size);
    if (existing) existing.unitsSold += sold;
    else arr.push({ size, unitsSold: sold });
  }

  for (const r of colorPerProduct) {
    const pid = r.productId;
    const color = String(r.color ?? "Unknown");
    const sold = Number(r.unitsSold) || 0;
    let arr = productByColorMap.get(pid);
    if (!arr) { arr = []; productByColorMap.set(pid, arr); }
    const existing = arr.find((x) => x.color === color);
    if (existing) existing.unitsSold += sold;
    else arr.push({ color, unitsSold: sold });
  }

  type SkuRow = {
    productId: string;
    sku: string;
    name: string;
    category: string | null;
    stock: number;
    restockThreshold: number;
    dailyVelocity: number;
    coverageDays: number | null;
    risk: "Stockout" | "Overstock" | "Healthy";
    unitsSold: number;
    lastRestockDate: string | null;
    bySize: Array<{ size: string; unitsSold: number }>;
    byColor: Array<{ color: string; unitsSold: number }>;
  };

  const allSkus: SkuRow[] = filteredProducts.map((p) => {
    const unitsSold = currVelMap.get(p.id) ?? 0;
    const { dailyVelocity, coverageDays, risk } = classify(p.stock, p.restockThreshold, unitsSold, periodDays);
    const bySize = (productBySizeMap.get(p.id) ?? []).sort((a, b) => b.unitsSold - a.unitsSold);
    const byColor = (productByColorMap.get(p.id) ?? []).sort((a, b) => b.unitsSold - a.unitsSold);
    return {
      productId: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category,
      stock: p.stock,
      restockThreshold: p.restockThreshold,
      dailyVelocity,
      coverageDays,
      risk,
      unitsSold,
      lastRestockDate: p.updatedAt ? p.updatedAt.toISOString() : null,
      bySize,
      byColor,
    };
  });

  // Prev-period classification (using same stock levels, prev velocity)
  const allSkusPrev: SkuRow[] = filteredProducts.map((p) => {
    const unitsSold = prevVelMap.get(p.id) ?? 0;
    const { dailyVelocity, coverageDays, risk } = classify(p.stock, p.restockThreshold, unitsSold, prevPeriodDays);
    return {
      productId: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category,
      stock: p.stock,
      restockThreshold: p.restockThreshold,
      dailyVelocity,
      coverageDays,
      risk,
      unitsSold,
      lastRestockDate: null,
      bySize: [],
      byColor: [],
    };
  });

  // ── 5. Build KPIs ──────────────────────────────────────────────────────
  function buildKpis(skus: SkuRow[]) {
    const totalUnits = skus.reduce((s, r) => s + r.stock, 0);
    const withVelocity = skus.filter((r) => r.coverageDays !== null);
    const avgCoverageDays = withVelocity.length > 0
      ? withVelocity.reduce((s, r) => s + (r.coverageDays ?? 0), 0) / withVelocity.length
      : 0;
    const stockoutRiskCount = skus.filter((r) => r.risk === "Stockout").length;
    const overstockRiskCount = skus.filter((r) => r.risk === "Overstock").length;
    const totalSold = skus.reduce((s, r) => s + r.unitsSold, 0);
    const sellThroughRate = totalSold + totalUnits > 0
      ? (totalSold / (totalSold + totalUnits)) * 100
      : 0;
    return { totalUnits, avgCoverageDays, stockoutRiskCount, overstockRiskCount, sellThroughRate };
  }

  const kpis = buildKpis(allSkus);
  const prevKpis = buildKpis(allSkusPrev);

  // ── 6. Ranked tiles ────────────────────────────────────────────────────
  const stockoutRisk = [...allSkus]
    .filter((r) => r.risk === "Stockout")
    .sort((a, b) => (a.coverageDays ?? 999) - (b.coverageDays ?? 999))
    .slice(0, 10);

  const overstockRisk = [...allSkus]
    .filter((r) => r.risk === "Overstock")
    .sort((a, b) => (b.coverageDays ?? 0) - (a.coverageDays ?? 0))
    .slice(0, 10);

  const highTurnover = [...allSkus]
    .filter((r) => r.dailyVelocity > 0)
    .sort((a, b) => b.dailyVelocity - a.dailyVelocity)
    .slice(0, 10);

  // ── 7. Category breakdown ──────────────────────────────────────────────
  const categoryMap = new Map<string, { stockUnits: number; unitsSold: number }>();
  for (const s of allSkus) {
    const cat = s.category ?? "Uncategorized";
    const existing = categoryMap.get(cat) ?? { stockUnits: 0, unitsSold: 0 };
    existing.stockUnits += s.stock;
    existing.unitsSold += s.unitsSold;
    categoryMap.set(cat, existing);
  }
  const categoryBreakdown = [...categoryMap.entries()]
    .map(([category, v]) => ({
      category,
      stockUnits: v.stockUnits,
      unitsSold: v.unitsSold,
      dailyVelocity: v.unitsSold / periodDays,
    }))
    .sort((a, b) => b.stockUnits - a.stockUnits);

  // ── 8. Apply table filters, sort, paginate ─────────────────────────────
  let filtered = [...allSkus];
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter((r) => r.sku.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
  }
  if (category) {
    filtered = filtered.filter((r) => r.category === category);
  }
  if (riskFilter) {
    filtered = filtered.filter((r) => r.risk === riskFilter);
  }

  const dir = sortDir === "desc" ? -1 : 1;
  filtered.sort((a, b) => {
    switch (sort) {
      case "sku": return dir * a.sku.localeCompare(b.sku);
      case "name": return dir * a.name.localeCompare(b.name);
      case "category": return dir * (a.category ?? "").localeCompare(b.category ?? "");
      case "stock": return dir * (a.stock - b.stock);
      case "dailyVelocity": return dir * (a.dailyVelocity - b.dailyVelocity);
      case "coverageDays": return dir * ((a.coverageDays ?? (dir > 0 ? 99999 : -1)) - (b.coverageDays ?? (dir > 0 ? 99999 : -1)));
      case "risk": return dir * a.risk.localeCompare(b.risk);
      case "unitsSold": return dir * (a.unitsSold - b.unitsSold);
      case "lastRestockDate": {
        const aDate = a.lastRestockDate ? new Date(a.lastRestockDate).getTime() : 0;
        const bDate = b.lastRestockDate ? new Date(b.lastRestockDate).getTime() : 0;
        return dir * (aDate - bDate);
      }
      default: return 0;
    }
  });

  const total = filtered.length;
  const pageSkus = filtered.slice((page - 1) * limit, page * limit);

  res.json(GetStockResponse.parse({
    kpis,
    prevKpis,
    stockoutRisk,
    overstockRisk,
    highTurnover,
    categoryBreakdown,
    colorBreakdown: colorBreakdownFinal,
    sizeBreakdown: sizeBreakdownFinal,
    skus: pageSkus,
    total,
    page,
    limit,
  }));
});

router.get("/analytics/journey", async (req, res): Promise<void> => {
  const parsed = GetJourneyQueryParams.safeParse(coerceDateQuery(req.query as Record<string, unknown>));
  if (!parsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }
  const clientId = requireClient(req, res);
  if (!clientId) return;
  const utmSrc = (parsed.data as Record<string, unknown>).utmSource as string | undefined;
  const utmMed = (parsed.data as Record<string, unknown>).utmMedium as string | undefined;
  const stateFilt = (parsed.data as Record<string, unknown>).state as string | undefined;
  const cityFilt = (parsed.data as Record<string, unknown>).city as string | undefined;
  const productFilt = (parsed.data as Record<string, unknown>).product as string | undefined;
  const { from, to } = dateRange(parsed.data.dateFrom, parsed.data.dateTo);

  // Combined customer subquery used in raw SQL contexts
  // utmRawCond: unqualified column for single-table context (FROM orders / FROM events, no JOIN)
  // utmRawCondEvt: qualified e.customer_id for events-joined contexts
  const anyCustomerFilter = utmSrc || utmMed || stateFilt || cityFilt || productFilt;
  const _customerSubConds = sql`client_id = ${clientId}${
    utmSrc ? sql` AND lower(utm_source) = lower(${utmSrc})` : sql``
  }${utmMed ? sql` AND lower(utm_medium) = lower(${utmMed})` : sql``
  }${stateFilt ? sql` AND lower(state) = lower(${stateFilt})` : sql``
  }${cityFilt ? sql` AND lower(city) = lower(${cityFilt})` : sql``
  }${productFilt ? sql` AND id IN (SELECT DISTINCT o.customer_id FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN products p ON p.id = oi.product_id WHERE o.client_id = ${clientId} AND (lower(p.name) LIKE lower(${"%" + productFilt + "%"}) OR lower(p.sku) LIKE lower(${"%" + productFilt + "%"})))` : sql``}`;
  const utmRawCond = anyCustomerFilter
    ? sql` AND customer_id IN (SELECT id FROM customers WHERE ${_customerSubConds})`
    : sql``;
  const utmRawCondEvt = anyCustomerFilter
    ? sql` AND e.customer_id IN (SELECT id FROM customers WHERE ${_customerSubConds})`
    : sql``;
  // ORM conditions for queries that join to customersTable
  const utmCustomerOrm: SQL[] = [];
  if (utmSrc) utmCustomerOrm.push(sql`lower(${customersTable.utmSource}) = lower(${utmSrc})`);
  if (utmMed) utmCustomerOrm.push(sql`lower(${customersTable.utmMedium}) = lower(${utmMed})`);
  if (stateFilt) utmCustomerOrm.push(sql`lower(${customersTable.state}) = lower(${stateFilt})`);
  if (cityFilt) utmCustomerOrm.push(sql`lower(${customersTable.city}) = lower(${cityFilt})`);
  if (productFilt) utmCustomerOrm.push(sql`${customersTable.id} IN (SELECT DISTINCT o.customer_id FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN products p ON p.id = oi.product_id WHERE o.client_id = ${clientId} AND (lower(p.name) LIKE lower(${"%" + productFilt + "%"}) OR lower(p.sku) LIKE lower(${"%" + productFilt + "%"})))`);

  // 1. KPIs
  const buyerCustomerIds = db
    .select({ id: ordersTable.customerId })
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.clientId, clientId),
        gte(ordersTable.createdAt, from),
        lte(ordersTable.createdAt, to),
        sql`${ordersTable.status} IN ('APPROVED', 'SHIPPED', 'DELIVERED')`,
      ),
    );

  // Count only events that occurred BEFORE each buyer's first purchase in the window
  const avgEvtRaw = await db.execute<{ avg_e: string }>(sql`
    SELECT COALESCE(AVG(cnt), 0)::float AS avg_e
    FROM (
      SELECT e.customer_id, COUNT(*) AS cnt
      FROM events e
      JOIN (
        SELECT customer_id, MIN(created_at) AS first_purchase_at
        FROM orders
        WHERE client_id = ${clientId}
          AND created_at >= ${from}
          AND created_at <= ${to}
          AND status IN ('APPROVED', 'SHIPPED', 'DELIVERED')
        GROUP BY customer_id
      ) fp ON fp.customer_id = e.customer_id
      WHERE e.client_id = ${clientId}
        AND e.created_at >= ${from}
        AND e.created_at < fp.first_purchase_at
        ${utmRawCondEvt}
      GROUP BY e.customer_id
    ) sub
  `);
  const [avgEvtsRow] = (avgEvtRaw.rows ?? avgEvtRaw) as unknown as { avg_e: string }[];
  const avgEventsBeforePurchase = Number(avgEvtsRow?.avg_e) || 0;

  // Avg time to first purchase (days) for customers who first purchased in window
  const [ttfpRow] = await db
    .select({ avg: sql<number>`COALESCE(AVG(EXTRACT(EPOCH FROM (first_purchase_at - created_at)) / 86400), 0)::float` })
    .from(customersTable)
    .where(
      and(
        eq(customersTable.clientId, clientId),
        sql`${customersTable.firstPurchaseAt} IS NOT NULL`,
        gte(customersTable.firstPurchaseAt, from),
        lte(customersTable.firstPurchaseAt, to),
        ...utmCustomerOrm,
      ),
    );
  const avgTimeToFirstPurchaseDays = Number(ttfpRow?.avg) || null;

  // Avg time between purchases
  const [tbpRow] = await db
    .select({ avg: sql<number>`COALESCE(AVG(EXTRACT(EPOCH FROM (last_purchase_at - first_purchase_at)) / 86400), 0)::float` })
    .from(customersTable)
    .where(
      and(
        eq(customersTable.clientId, clientId),
        sql`${customersTable.totalOrders} > 1`,
        sql`${customersTable.firstPurchaseAt} IS NOT NULL`,
        sql`${customersTable.lastPurchaseAt} IS NOT NULL`,
        ...utmCustomerOrm,
      ),
    );
  const avgTimeBetweenPurchasesDays = Number(tbpRow?.avg) || null;

  // % buyers that converted on first session (have a VISIT event the same day as their first purchase)
  const fsRaw = await db.execute<{ total: string; same_day: string }>(sql`
    SELECT
      COUNT(DISTINCT o.customer_id)::int AS total,
      COUNT(DISTINCT CASE WHEN e.customer_id IS NOT NULL THEN o.customer_id END)::int AS same_day
    FROM (
      SELECT customer_id, DATE(MIN(created_at)) AS first_order_date
      FROM orders
      WHERE client_id = ${clientId}
        AND created_at >= ${from}
        AND created_at <= ${to}
        AND status IN ('APPROVED','SHIPPED','DELIVERED')
        ${utmRawCond}
      GROUP BY customer_id
    ) o
    LEFT JOIN (
      SELECT customer_id, DATE(MIN(created_at)) AS visit_date
      FROM events
      WHERE client_id = ${clientId}
        AND event_type = 'VISIT'
      GROUP BY customer_id
    ) e ON e.customer_id = o.customer_id AND e.visit_date = o.first_order_date
  `);
  const [fsRow] = (fsRaw.rows ?? fsRaw) as unknown as { total: string; same_day: string }[];

  const totalBuyers = Number(fsRow?.total) || 0;
  const sameDayBuyers = Number(fsRow?.same_day) || 0;
  const pctBuyersFromFirstSession = totalBuyers > 0 ? (sameDayBuyers / totalBuyers) * 100 : 0;

  // 2. Top paths to purchase (top 5)
  const topPaths = await buildTopPaths(clientId, from, to, 5, utmRawCondEvt);

  // 3. Event flow graph nodes + edges
  const eventFlowData = await buildEventFlowGraph(clientId, from, to, utmRawCondEvt);

  // 4. Buyers vs non-buyers comparison
  const [buyersComparison, nonBuyersComparison] = await Promise.all([
    buildAudienceEventProfile(clientId, from, to, true, utmRawCond),
    buildAudienceEventProfile(clientId, from, to, false, utmRawCond),
  ]);

  const payload = GetJourneyResponse.parse({
    kpis: {
      avgEventsBeforePurchase,
      avgTimeToFirstPurchaseDays,
      avgTimeBetweenPurchasesDays,
      pctBuyersFromFirstSession,
    },
    topPaths,
    eventNodes: eventFlowData.nodes,
    eventEdges: eventFlowData.edges,
    buyers: buyersComparison,
    nonBuyers: nonBuyersComparison,
  });
  res.json(payload);
});

router.get("/analytics/rfm", async (req, res): Promise<void> => {
  const parsed = GetRfmQueryParams.safeParse(coerceDateQuery(req.query as Record<string, unknown>));
  if (!parsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }
  const clientId = requireClient(req, res);
  if (!clientId) return;
  const { page, limit, segment, sortBy, sortDir } = parsed.data;
  const orderStatus = (parsed.data as Record<string, unknown>).orderStatus as "all" | "approved" | "pending" | "rejected";
  const utmSrc = (parsed.data as Record<string, unknown>).utmSource as string | undefined;
  const utmMed = (parsed.data as Record<string, unknown>).utmMedium as string | undefined;
  const stateFilt = (parsed.data as Record<string, unknown>).state as string | undefined;
  const cityFilt = (parsed.data as Record<string, unknown>).city as string | undefined;
  const productFilt = (parsed.data as Record<string, unknown>).product as string | undefined;
  const { from, to } = dateRange(parsed.data.dateFrom, parsed.data.dateTo);
  const offset = (page - 1) * limit;

  const orderStatusConds: SQL[] = [];
  if (orderStatus === "approved") {
    orderStatusConds.push(sql`${ordersTable.status} IN ('APPROVED','SHIPPED','DELIVERED')`);
  } else if (orderStatus === "pending") {
    orderStatusConds.push(eq(ordersTable.status, "PENDING"));
  } else if (orderStatus === "rejected") {
    orderStatusConds.push(eq(ordersTable.status, "REJECTED"));
  }

  // Customer-level ORM conditions for all active filters
  const utmCustomerConds: SQL[] = [];
  if (utmSrc) utmCustomerConds.push(sql`lower(${customersTable.utmSource}) = lower(${utmSrc})`);
  if (utmMed) utmCustomerConds.push(sql`lower(${customersTable.utmMedium}) = lower(${utmMed})`);
  if (stateFilt) utmCustomerConds.push(sql`lower(${customersTable.state}) = lower(${stateFilt})`);
  if (cityFilt) utmCustomerConds.push(sql`lower(${customersTable.city}) = lower(${cityFilt})`);
  if (productFilt) {
    const productStatusSql =
      orderStatus === "approved"
        ? sql`AND o.status IN ('APPROVED','SHIPPED','DELIVERED')`
        : orderStatus === "pending"
          ? sql`AND o.status = 'PENDING'`
          : orderStatus === "rejected"
            ? sql`AND o.status = 'REJECTED'`
            : sql``;
    utmCustomerConds.push(sql`${customersTable.id} IN (
      SELECT DISTINCT o.customer_id
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      JOIN products p ON p.id = oi.product_id
      WHERE o.client_id = ${clientId}
        AND o.created_at >= ${from}
        AND o.created_at <= ${to}
        ${productStatusSql}
        AND (lower(p.name) LIKE lower(${"%" + productFilt + "%"}) OR lower(p.sku) LIKE lower(${"%" + productFilt + "%"}))
    )`);
  }

  // Customers who requested at least one order in the selected date window.
  // Status filtering is optional; by default RFM uses every requested order.
  const scopedOrderConds: SQL[] = [
    eq(ordersTable.clientId, clientId),
    gte(ordersTable.createdAt, from),
    lte(ordersTable.createdAt, to),
    ...orderStatusConds,
  ];
  const activeBuyerStats = db
    .select({
      customerId: ordersTable.customerId,
      frequency: sql<number>`COUNT(*)::int`.as("rfm_frequency"),
      monetary: sql<number>`COALESCE(SUM(${ordersTable.amount}), 0)::float`.as("rfm_monetary"),
      firstPurchaseAt: sql<Date>`MIN(${ordersTable.createdAt})`.as("rfm_first_purchase_at"),
      lastPurchaseAt: sql<Date>`MAX(${ordersTable.createdAt})`.as("rfm_last_purchase_at"),
    })
    .from(ordersTable)
    .where(and(...scopedOrderConds))
    .groupBy(ordersTable.customerId)
    .as("active_buyer_stats");

  const deriveRfmSegment = (recencyDays: number, frequency: number, monetary: number): string => {
    if (recencyDays <= 30 && frequency >= 3 && monetary >= 3000) return "Champions";
    if (recencyDays <= 90 && frequency >= 2) return "Loyal";
    if (recencyDays <= 60) return "Potential";
    if (recencyDays <= 180) return "At Risk";
    return "Lost";
  };

  const baseCustomerRows = await db
    .select({
      id: customersTable.id,
      name: customersTable.name,
      email: customersTable.email,
      phone: customersTable.phone,
      state: customersTable.state,
      city: customersTable.city,
      documentType: customersTable.documentType,
      frequency: activeBuyerStats.frequency,
      monetary: activeBuyerStats.monetary,
      firstPurchaseAt: activeBuyerStats.firstPurchaseAt,
      lastPurchaseAt: activeBuyerStats.lastPurchaseAt,
    })
    .from(customersTable)
    .innerJoin(activeBuyerStats, eq(customersTable.id, activeBuyerStats.customerId))
    .where(
      and(
        eq(customersTable.clientId, clientId),
        ...utmCustomerConds,
      ),
    );

  const enrichedCustomerRows = baseCustomerRows.map((row) => {
    const lastPurchaseAt = row.lastPurchaseAt instanceof Date ? row.lastPurchaseAt : new Date(row.lastPurchaseAt);
    const recencyDays = Number.isFinite(lastPurchaseAt.getTime())
      ? Math.max(0, Math.round((to.getTime() - lastPurchaseAt.getTime()) / 86_400_000))
      : 0;
    const frequency = Number(row.frequency) || 0;
    const monetary = Number(row.monetary) || 0;
    return {
      ...row,
      recencyDays,
      frequency,
      monetary,
      segment: deriveRfmSegment(recencyDays, frequency, monetary),
    };
  });
  const toIsoString = (value: Date | string | null | undefined): string | null => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  };

  // 1. Per-segment aggregates — scoped to customers active in the date window
  const segmentAggMap = new Map<string, { segment: string; customerCount: number; revenue: number }>();
  for (const row of enrichedCustomerRows) {
    const current = segmentAggMap.get(row.segment) ?? { segment: row.segment, customerCount: 0, revenue: 0 };
    current.customerCount += 1;
    current.revenue += row.monetary;
    segmentAggMap.set(row.segment, current);
  }
  const segmentAggs = Array.from(segmentAggMap.values());

  const totalRevenue = segmentAggs.reduce((s, r) => s + Number(r.revenue), 0);
  const totalCustomers = segmentAggs.reduce((s, r) => s + Number(r.customerCount), 0);

  const SEGMENT_ORDER = ["Champions", "Loyal", "Potential", "At Risk", "Lost"];
  const segments = SEGMENT_ORDER.map((seg) => {
    const row = segmentAggs.find((r) => r.segment === seg);
    const count = Number(row?.customerCount) || 0;
    const rev = Number(row?.revenue) || 0;
    return {
      segment: seg,
      customerCount: count,
      revenue: rev,
      avgTicket: count > 0 ? rev / count : 0,
      pct: totalCustomers > 0 ? (count / totalCustomers) * 100 : 0,
    };
  });

  // 2. Segment composition over time — grouped by order month within the date window
  const segmentByCustomerId = new Map(enrichedCustomerRows.map((row) => [row.id, row.segment]));
  const compositionSourceRows = enrichedCustomerRows.length > 0
    ? await db
        .select({
          month: sql<string>`TO_CHAR(DATE_TRUNC('month', ${ordersTable.createdAt}), 'YYYY-MM')`,
          customerId: ordersTable.customerId,
        })
        .from(ordersTable)
        .where(
          and(
            eq(ordersTable.clientId, clientId),
            gte(ordersTable.createdAt, from),
            lte(ordersTable.createdAt, to),
            ...orderStatusConds,
            inArray(ordersTable.customerId, enrichedCustomerRows.map((row) => row.id)),
          ),
        )
        .groupBy(sql`DATE_TRUNC('month', ${ordersTable.createdAt})`, ordersTable.customerId)
        .orderBy(sql`DATE_TRUNC('month', ${ordersTable.createdAt})`)
    : [];

  // Pivot to monthly composition
  const monthMap = new Map<string, { Champions: number; Loyal: number; Potential: number; AtRisk: number; Lost: number }>();
  for (const row of compositionSourceRows) {
    if (!row.month) continue;
    const existing = monthMap.get(row.month) ?? { Champions: 0, Loyal: 0, Potential: 0, AtRisk: 0, Lost: 0 };
    const seg = segmentByCustomerId.get(row.customerId);
    if (seg === "Champions") existing.Champions += 1;
    else if (seg === "Loyal") existing.Loyal += 1;
    else if (seg === "Potential") existing.Potential += 1;
    else if (seg === "At Risk") existing.AtRisk += 1;
    else if (seg === "Lost") existing.Lost += 1;
    monthMap.set(row.month, existing);
  }
  const composition = Array.from(monthMap.entries()).map(([month, v]) => ({ month, ...v }));

  // 3. Paginated customer table — scoped to buyers active in the period
  const sortedRows = enrichedCustomerRows
    .filter((row) => !segment || row.segment === segment)
    .sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      if (sortBy === "name") return dir * ((a.name ?? "").localeCompare(b.name ?? "", "pt-BR"));
      if (sortBy === "segment") return dir * a.segment.localeCompare(b.segment, "pt-BR");
      return dir * ((Number(a[sortBy]) || 0) - (Number(b[sortBy]) || 0));
    });
  const total = sortedRows.length;
  const customerRows = sortedRows.slice(offset, offset + limit);
  const displayedCustomerIds = customerRows.map((row) => row.id);
  const latestOrdersRows = displayedCustomerIds.length > 0
    ? await db
        .select({
          id: ordersTable.id,
          externalId: ordersTable.externalId,
          customerId: ordersTable.customerId,
          status: ordersTable.status,
          amount: ordersTable.amount,
          fulfilledAmount: ordersTable.fulfilledAmount,
          requestedQuantity: ordersTable.requestedQuantity,
          fulfilledQuantity: ordersTable.fulfilledQuantity,
          createdAt: ordersTable.createdAt,
        })
        .from(ordersTable)
        .where(and(eq(ordersTable.clientId, clientId), inArray(ordersTable.customerId, displayedCustomerIds)))
        .orderBy(desc(ordersTable.createdAt))
    : [];
  const latestOrdersByCustomer = new Map<string, typeof latestOrdersRows>();
  for (const order of latestOrdersRows) {
    const current = latestOrdersByCustomer.get(order.customerId) ?? [];
    if (current.length < 3) {
      current.push(order);
      latestOrdersByCustomer.set(order.customerId, current);
    }
  }

  const payload = GetRfmResponse.parse({
    segments,
    composition,
    customers: customerRows.map((r) => ({
      id: r.id,
      name: r.name ?? null,
      email: r.email,
      phone: r.phone ?? null,
      state: r.state ?? null,
      city: r.city ?? null,
      documentType: r.documentType ?? null,
      segment: r.segment ?? null,
      recencyDays: r.recencyDays != null ? Number(r.recencyDays) : null,
      frequency: Number(r.frequency) || 0,
      monetary: Number(r.monetary) || 0,
      firstPurchaseAt: toIsoString(r.firstPurchaseAt),
      lastPurchaseAt: toIsoString(r.lastPurchaseAt),
      latestOrders: (latestOrdersByCustomer.get(r.id) ?? []).map((order) => ({
        id: order.id,
        externalId: order.externalId,
        status: order.status,
        amount: Number(order.amount) || 0,
        fulfilledAmount: Number(order.fulfilledAmount) || 0,
        requestedQuantity: Number(order.requestedQuantity) || 0,
        fulfilledQuantity: Number(order.fulfilledQuantity) || 0,
        createdAt: order.createdAt.toISOString(),
      })),
    })),
    total,
    page,
    limit,
  });
  res.json(payload);
});

// ── UTM Attribution Helpers ──────────────────────────────────────────────────

type UtmGroupBy = "source" | "campaign" | "sourceMediumCampaign";

type UtmDimension = {
  source: string;
  medium: string;
  campaign: string;
};

type UtmAccum = {
  key: string;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  registrations: number;
  approvals: number;
  buyers: Set<string>;
  revenue: number;
  sessions: number;
  subRows: Map<string, UtmAccum>;
};

function cleanUtmPart(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function derivedUtmDimension(row: UpzeroAnalyticsMetric): UtmDimension {
  const rawSource = cleanUtmPart(row.utm_source);
  const rawMedium = cleanUtmPart(row.utm_medium);
  const rawCampaign = cleanUtmPart(row.utm_campaign);
  const sourceText = normalizeCampaignText(rawSource);
  const mediumText = normalizeCampaignText(rawMedium);
  const apiSourceText = normalizeCampaignText(row.source);
  const referrerHost = normalizeCampaignText(row.referrer_host);
  const landingHost = normalizeCampaignText(row.landing_host);

  let source = rawSource?.toLowerCase() ?? "";
  let medium = rawMedium?.toLowerCase() ?? "";
  let campaign = rawCampaign ?? "";

  if (!source) {
    if (row.fbc || row.fbclid) source = "meta";
    else if (row.gclid) source = "google";
    else if (referrerHost.includes("instagram")) source = "instagram";
    else if (referrerHost.includes("facebook")) source = "facebook";
    else if (referrerHost.includes("google")) source = "google";
    else if (row.source && !["site", "web", "website"].includes(apiSourceText)) source = row.source.toLowerCase();
    else source = "direct";
  }

  if (!medium) {
    if (row.fbc || row.fbclid || row.gclid) medium = "paid";
    else if (row.channel) medium = row.channel.toLowerCase();
    else if (landingHost || referrerHost) medium = "referral";
    else medium = "none";
  }

  if (!campaign) {
    if (row.fbc || row.fbclid) campaign = "Clique Meta identificado";
    else if (row.gclid) campaign = "Clique Google identificado";
    else campaign = "sem campanha";
  }

  const linktreeOnly = sourceText === "instagram" && mediumText === "linktree" && normalizeCampaignText(rawCampaign) === "linktree";
  if (linktreeOnly) {
    source = "instagram";
    medium = "linktree";
    campaign = "linktree";
  }

  return { source, medium, campaign };
}

function dimensionFromLocalCustomer(customer: CampaignLocalCustomer): UtmDimension {
  return derivedUtmDimension(localCustomerToCampaignMetric(customer, 0) ?? {
    id: 0,
    period_start: customer.createdAt.toISOString(),
    period_type: "registration",
    event_name: "register_submitted",
    product: null,
    product_variant: null,
    category: null,
    user: null,
    user_id: null,
    order_id: null,
    utm_source: customer.utmSource,
    utm_medium: customer.utmMedium,
    utm_campaign: customer.utmCampaign,
    source: null,
    channel: null,
    device_type: null,
    total_events: 1,
    unique_users: 0,
    unique_sessions: 0,
    total_quantity: 0,
    total_value: 0,
    updated_at: customer.createdAt.toISOString(),
    utm_content: customer.utmContent,
    utm_term: customer.utmTerm,
  });
}

function passesUtmFilter(dimension: UtmDimension, source?: string, medium?: string, campaign?: string): boolean {
  if (source && normalizeCampaignText(dimension.source) !== normalizeCampaignText(source)) return false;
  if (medium && normalizeCampaignText(dimension.medium) !== normalizeCampaignText(medium)) return false;
  if (campaign && normalizeCampaignText(dimension.campaign) !== normalizeCampaignText(campaign)) return false;
  return true;
}

function utmKeyForGroup(dimension: UtmDimension, groupBy: UtmGroupBy): string {
  if (groupBy === "campaign") return dimension.campaign || "sem campanha";
  if (groupBy === "sourceMediumCampaign") {
    return `${dimension.source || "direct"} / ${dimension.medium || "none"} / ${dimension.campaign || "sem campanha"}`;
  }
  return dimension.source || "direct";
}

function getOrCreateUtmAccum(map: Map<string, UtmAccum>, key: string, dimension: UtmDimension, groupBy: UtmGroupBy): UtmAccum {
  const existing = map.get(key);
  if (existing) return existing;
  const row: UtmAccum = {
    key,
    source: groupBy === "campaign" ? null : dimension.source,
    medium: groupBy === "sourceMediumCampaign" ? dimension.medium : null,
    campaign: groupBy === "source" ? null : dimension.campaign,
    registrations: 0,
    approvals: 0,
    buyers: new Set<string>(),
    revenue: 0,
    sessions: 0,
    subRows: new Map(),
  };
  map.set(key, row);
  return row;
}

function addUtmMetric(
  map: Map<string, UtmAccum>,
  dimension: UtmDimension,
  groupBy: UtmGroupBy,
  mutate: (row: UtmAccum) => void,
) {
  const key = utmKeyForGroup(dimension, groupBy);
  const row = getOrCreateUtmAccum(map, key, dimension, groupBy);
  mutate(row);

  if (groupBy !== "sourceMediumCampaign") {
    const detailKey = `${dimension.source} / ${dimension.medium} / ${dimension.campaign}`;
    const detail = getOrCreateUtmAccum(row.subRows, detailKey, dimension, "sourceMediumCampaign");
    mutate(detail);
  }
}

function toUtmRows(map: Map<string, UtmAccum>, groupBy: UtmGroupBy, spendBySource = new Map<string, number>()) {
  return [...map.values()]
    .map((row) => {
      const registrations = row.registrations;
      const buyers = row.buyers.size;
      const spend = groupBy === "source" ? spendBySource.get(row.key.toLowerCase()) ?? 0 : 0;
      const subRows = [...row.subRows.values()].map((sub) => {
        const subRegistrations = sub.registrations;
        const subBuyers = sub.buyers.size;
        return {
          key: sub.key,
          source: sub.source,
          medium: sub.medium,
          campaign: sub.campaign,
          registrations: subRegistrations,
          approvals: sub.approvals,
          approvalPct: subRegistrations > 0 ? (sub.approvals / subRegistrations) * 100 : 0,
          buyers: subBuyers,
          revenue: sub.revenue,
          conversionPct: subRegistrations > 0 ? (subBuyers / subRegistrations) * 100 : 0,
          roas: null as number | null,
        };
      });
      return {
        key: row.key,
        source: row.source,
        medium: row.medium,
        campaign: row.campaign,
        registrations,
        approvals: row.approvals,
        approvalPct: registrations > 0 ? (row.approvals / registrations) * 100 : 0,
        buyers,
        revenue: row.revenue,
        conversionPct: registrations > 0 ? (buyers / registrations) * 100 : 0,
        roas: spend > 0 ? row.revenue / spend : null as number | null,
        subRows,
      };
    })
    .sort((a, b) => b.revenue - a.revenue || b.registrations - a.registrations);
}

async function loadSpendBySource(clientId: string, from: Date, to: Date): Promise<Map<string, number>> {
  const spendBySource = new Map<string, number>();
  const creatives = await db
    .select()
    .from(creativesTable)
    .where(eq(creativesTable.clientId, clientId));
  for (const creative of creatives) {
    if (!creative.platform) continue;
    const fraction = computeSpendOverlapFraction(creative, from, to);
    if (fraction <= 0) continue;
    const key = creative.platform.toLowerCase();
    spendBySource.set(key, (spendBySource.get(key) ?? 0) + creative.spend * fraction);
  }
  return spendBySource;
}

function latestTouchBefore(
  touches: Array<{ occurredAt: string; dimension: UtmDimension }>,
  date: Date,
): UtmDimension | null {
  const limit = date.getTime();
  let selected: UtmDimension | null = null;
  let selectedAt = -Infinity;
  for (const touch of touches) {
    const occurredAt = new Date(touch.occurredAt).getTime();
    if (!Number.isFinite(occurredAt) || occurredAt > limit || occurredAt < selectedAt) continue;
    selected = touch.dimension;
    selectedAt = occurredAt;
  }
  return selected;
}

function latestCampaignEvidenceBefore(
  rows: UpzeroAnalyticsMetric[],
  date: Date,
): UpzeroAnalyticsMetric | null {
  const limit = date.getTime();
  let selected: UpzeroAnalyticsMetric | null = null;
  let selectedAt = -Infinity;
  for (const row of rows) {
    if (!isPaidCampaignSignal(row)) continue;
    const occurredAt = new Date(row.period_start).getTime();
    if (!Number.isFinite(occurredAt) || occurredAt > limit || occurredAt < selectedAt) continue;
    selected = row;
    selectedAt = occurredAt;
  }
  return selected;
}

async function buildUtmAnalytics(
  clientId: string,
  from: Date,
  to: Date,
  groupBy: UtmGroupBy,
  filterSource?: string,
  filterMedium?: string,
  filterCampaign?: string,
  upzeroRange?: { from: string; to: string },
) {
  try {
    const [client] = await db
      .select({ upZeroApiKey: clientsTable.upZeroApiKey })
      .from(clientsTable)
      .where(eq(clientsTable.id, clientId));
    const tracking = await getUpzeroTrackingRowsChunked({
      from: upzeroRange?.from ?? from.toISOString(),
      to: upzeroRange?.to ?? to.toISOString(),
      apiKey: client?.upZeroApiKey,
      context: "utm",
    });
    const trackingRows = tracking.rows;
    const hasRealAttribution = trackingRows.some((row) => {
      const dimension = derivedUtmDimension(row);
      return dimension.source !== "direct" || dimension.medium !== "none" || dimension.campaign !== "sem campanha";
    });

    if (trackingRows.length > 0 && hasRealAttribution) {
      const localCustomers = await db
        .select({
          id: customersTable.id,
          externalId: customersTable.externalId,
          name: customersTable.name,
          email: customersTable.email,
          phone: customersTable.phone,
          documentType: customersTable.documentType,
          registrationStatus: customersTable.registrationStatus,
          createdAt: customersTable.createdAt,
          totalOrders: customersTable.totalOrders,
          utmSource: customersTable.utmSource,
          utmMedium: customersTable.utmMedium,
          utmCampaign: customersTable.utmCampaign,
          utmContent: customersTable.utmContent,
          utmTerm: customersTable.utmTerm,
        })
        .from(customersTable)
        .where(and(eq(customersTable.clientId, clientId), lte(customersTable.createdAt, to)));

      const localByExternalUserId = new Map<number, CampaignLocalCustomer>();
      const localById = new Map<string, CampaignLocalCustomer>();
      for (const customer of localCustomers) {
        localById.set(customer.id, customer);
        const userId = Number.parseInt(customer.externalId ?? "", 10);
        if (Number.isFinite(userId)) localByExternalUserId.set(userId, customer);
      }

      const touchesByUser = new Map<number, Array<{ occurredAt: string; dimension: UtmDimension }>>();
      const rowsBySource = new Map<string, UtmAccum>();
      let totalSessions = 0;
      const seenRegisterEventUsers = new Set<number>();

      for (const row of trackingRows) {
        const dimension = derivedUtmDimension(row);
        if (!passesUtmFilter(dimension, filterSource, filterMedium, filterCampaign)) continue;
        const user = getMetricUser(row);
        if (user && (isPaidCampaignSignal(row) || row.utm_source || row.utm_medium || row.utm_campaign || row.fbc || row.fbclid || row.gclid)) {
          const list = touchesByUser.get(user.id) ?? [];
          list.push({ occurredAt: row.period_start, dimension });
          touchesByUser.set(user.id, list);
        }

        if (row.event_name === "page_view") {
          const sessions = Math.max(row.unique_sessions ?? 0, row.total_events ?? 0);
          totalSessions += sessions;
          addUtmMetric(rowsBySource, dimension, groupBy, (entry) => {
            entry.sessions += sessions;
          });
        }

        if (row.event_name === "register_submitted") {
          const value = row.total_events || 1;
          if (user) seenRegisterEventUsers.add(user.id);
          addUtmMetric(rowsBySource, dimension, groupBy, (entry) => {
            entry.registrations += value;
          });
        }
      }

      for (const list of touchesByUser.values()) {
        list.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
      }

      for (const customer of localCustomers) {
        if (customer.createdAt < from || customer.createdAt > to) continue;
        const userId = Number.parseInt(customer.externalId ?? "", 10);
        const touch = Number.isFinite(userId)
          ? latestTouchBefore(touchesByUser.get(userId) ?? [], customer.createdAt)
          : null;
        const dimension = touch ?? dimensionFromLocalCustomer(customer);
        if (!passesUtmFilter(dimension, filterSource, filterMedium, filterCampaign)) continue;
        if (!seenRegisterEventUsers.has(userId)) {
          addUtmMetric(rowsBySource, dimension, groupBy, (entry) => {
            entry.registrations += 1;
          });
        }
        if (customer.registrationStatus === "APPROVED") {
          addUtmMetric(rowsBySource, dimension, groupBy, (entry) => {
            entry.approvals += 1;
          });
        }
      }

      const orderRows = await db
        .select({
          id: ordersTable.id,
          customerId: ordersTable.customerId,
          amount: ordersTable.amount,
          createdAt: ordersTable.createdAt,
          customerExternalId: customersTable.externalId,
        })
        .from(ordersTable)
        .innerJoin(customersTable, eq(ordersTable.customerId, customersTable.id))
        .where(and(
          eq(ordersTable.clientId, clientId),
          gte(ordersTable.createdAt, from),
          lte(ordersTable.createdAt, to),
          sql`${ordersTable.status} != 'REJECTED'`,
        ));

      for (const order of orderRows) {
        const userId = Number.parseInt(order.customerExternalId ?? "", 10);
        const customer = localById.get(order.customerId);
        const touch = Number.isFinite(userId)
          ? latestTouchBefore(touchesByUser.get(userId) ?? [], order.createdAt)
          : null;
        const dimension = touch ?? (customer ? dimensionFromLocalCustomer(customer) : { source: "direct", medium: "none", campaign: "sem campanha" });
        if (!passesUtmFilter(dimension, filterSource, filterMedium, filterCampaign)) continue;
        addUtmMetric(rowsBySource, dimension, groupBy, (entry) => {
          entry.buyers.add(order.customerId);
          entry.revenue += Number(order.amount ?? 0);
        });
      }

      const spendBySource = await loadSpendBySource(clientId, from, to);
      const rows = toUtmRows(rowsBySource, groupBy, spendBySource);
      const totalReg = rows.reduce((sum, row) => sum + row.registrations, 0);
      const totalApp = rows.reduce((sum, row) => sum + row.approvals, 0);
      const totalBuyers = rows.reduce((sum, row) => sum + row.buyers, 0);
      const totalRevenue = rows.reduce((sum, row) => sum + row.revenue, 0);
      const topRow = rows[0];
      return {
        kpis: {
          totalSessions,
          totalRegistrations: totalReg,
          totalApprovals: totalApp,
          approvalPct: totalReg > 0 ? (totalApp / totalReg) * 100 : 0,
          totalBuyers,
          totalRevenue,
          conversionPct: totalReg > 0 ? (totalBuyers / totalReg) * 100 : 0,
          totalRoas: [...spendBySource.values()].reduce((sum, value) => sum + value, 0) > 0
            ? totalRevenue / [...spendBySource.values()].reduce((sum, value) => sum + value, 0)
            : null,
          topSource: topRow?.key ?? null,
          topSourceRevenue: topRow?.revenue ?? 0,
        },
        rows,
      };
    }
  } catch (error) {
    console.warn("[utm] UP Zero tracking unavailable; using local UTM fallback:", error);
  }

  const sourceExpr = sql`COALESCE(NULLIF(lower(c.utm_source), ''), '(direct)')`;
  const mediumExpr = sql`COALESCE(NULLIF(lower(c.utm_medium), ''), '(none)')`;
  const campaignExpr = sql`COALESCE(NULLIF(lower(c.utm_campaign), ''), '(campaign unset)')`;
  const keyExpr =
    groupBy === "campaign"
      ? campaignExpr
      : groupBy === "sourceMediumCampaign"
        ? sql`${sourceExpr} || ' / ' || ${mediumExpr} || ' / ' || ${campaignExpr}`
        : sourceExpr;

  const srcCond = filterSource
    ? sql` AND lower(c.utm_source) = lower(${filterSource})`
    : sql``;
  const medCond = filterMedium
    ? sql` AND lower(c.utm_medium) = lower(${filterMedium})`
    : sql``;
  const campCond = filterCampaign
    ? sql` AND lower(c.utm_campaign) = lower(${filterCampaign})`
    : sql``;

  // Registrations: customers who joined in the period, grouped at source/medium/campaign grain.
  // The selected groupBy only controls how those rows are rolled up for the UI.
  type RegRow = {
    key: string;
    source: string | null;
    medium: string | null;
    campaign: string | null;
    registrations: string;
    approvals: string;
  };
  const regRaw = await db.execute<RegRow>(sql`
    SELECT
      ${keyExpr}    AS key,
      ${sourceExpr} AS source,
      ${mediumExpr} AS medium,
      ${campaignExpr} AS campaign,
      COUNT(*)::int AS registrations,
      COUNT(*) FILTER (WHERE c.registration_status = 'APPROVED')::int AS approvals
    FROM customers c
    WHERE c.client_id = ${clientId}
      AND c.created_at >= ${from}
      AND c.created_at <= ${to}
      ${srcCond}${medCond}${campCond}
    GROUP BY 1, 2, 3, 4
    ORDER BY registrations DESC
  `);

  // Buyers/revenue: restrict to the SAME customer cohort (registered in the period)
  // AND orders placed within the period — fully period-aware.
  type SalesRow = {
    key: string;
    source: string | null;
    medium: string | null;
    campaign: string | null;
    buyers: string;
    revenue: string;
  };
  const salesRaw = await db.execute<SalesRow>(sql`
    SELECT
      ${keyExpr} AS key,
      ${sourceExpr} AS source,
      ${mediumExpr} AS medium,
      ${campaignExpr} AS campaign,
      COUNT(DISTINCT c.id)::int AS buyers,
      COALESCE(SUM(o.amount), 0)::float AS revenue
    FROM customers c
    JOIN orders o
      ON  o.customer_id = c.id
      AND o.client_id   = ${clientId}
      AND o.created_at >= ${from}
      AND o.created_at <= ${to}
      AND o.status IN ('APPROVED','SHIPPED','DELIVERED')
    WHERE c.client_id = ${clientId}
      AND c.created_at >= ${from}
      AND c.created_at <= ${to}
      ${srcCond}${medCond}${campCond}
    GROUP BY 1, 2, 3, 4
  `);

  // Total VISIT sessions: count events of type VISIT for customers matching the UTM scope
  type SessionsResult = { sessions: string };
  const sessionsRaw = await db.execute<SessionsResult>(sql`
    SELECT COUNT(*)::int AS sessions
    FROM events e
    JOIN customers c ON e.customer_id = c.id AND c.client_id = ${clientId}
    WHERE e.client_id = ${clientId}
      AND e.event_type = 'VISIT'
      AND e.created_at >= ${from}
      AND e.created_at <= ${to}
      ${srcCond}${medCond}${campCond}
  `);
  const totalSessions = Number(
    ((sessionsRaw.rows ?? sessionsRaw) as unknown as SessionsResult[])[0]?.sessions ?? 0,
  );

  const regRows   = (regRaw.rows   ?? regRaw)   as unknown as RegRow[];
  const salesRows = (salesRaw.rows ?? salesRaw) as unknown as SalesRow[];

  const detailKey = (row: Pick<RegRow, "key" | "source" | "medium" | "campaign">) =>
    `${row.key}||${row.source ?? ""}||${row.medium ?? ""}||${row.campaign ?? ""}`;

  const salesMap = new Map<string, { buyers: number; revenue: number }>();
  const detailSalesMap = new Map<string, { buyers: number; revenue: number }>();
  for (const row of salesRows) {
    const sales = { buyers: Number(row.buyers), revenue: Number(row.revenue) };
    const current = salesMap.get(row.key) ?? { buyers: 0, revenue: 0 };
    salesMap.set(row.key, {
      buyers: current.buyers + sales.buyers,
      revenue: current.revenue + sales.revenue,
    });
    detailSalesMap.set(detailKey(row), sales);
  }

  // Spend is still source-level today, so row-level ROAS is only shown on source grouping.
  // The KPI uses total spend across sources for every UTM view.
  const spendBySource = new Map<string, number>();
  const creatives = await db
    .select()
    .from(creativesTable)
    .where(eq(creativesTable.clientId, clientId));
  for (const c of creatives) {
    if (!c.platform) continue;
    const fraction = computeSpendOverlapFraction(c, from, to);
    if (fraction <= 0) continue;
    const k = c.platform.toLowerCase();
    spendBySource.set(k, (spendBySource.get(k) ?? 0) + c.spend * fraction);
  }

  // Group registration rows by the selected primary dimension.
  const entriesByKey = new Map<string, RegRow[]>();
  for (const r of regRows) {
    const list = entriesByKey.get(r.key) ?? [];
    list.push(r);
    entriesByKey.set(r.key, list);
  }

  const primaryKeys = [...new Set(regRows.map((r) => r.key))];

  const rows = primaryKeys.map((key) => {
    const entries = entriesByKey.get(key) ?? [];
    const totalReg = entries.reduce((s, e) => s + Number(e.registrations), 0);
    const totalApp = entries.reduce((s, e) => s + Number(e.approvals), 0);
    const sales    = salesMap.get(key) ?? { buyers: 0, revenue: 0 };
    const rowSource = groupBy === "sourceMediumCampaign" ? entries[0]?.source ?? null : groupBy === "source" ? key : null;
    const rowMedium = groupBy === "sourceMediumCampaign" ? entries[0]?.medium ?? null : null;
    const rowCampaign = groupBy === "sourceMediumCampaign" ? entries[0]?.campaign ?? null : groupBy === "campaign" ? key : null;
    const spend    = groupBy === "source" ? spendBySource.get(key.toLowerCase()) ?? 0 : 0;
    const roas     = spend > 0 ? sales.revenue / spend : null;

    // Sub-rows: expose the complete source/medium/campaign grain under summarized views.
    const subRows =
      groupBy !== "sourceMediumCampaign"
        ? entries.map((e) => {
            const subSales = detailSalesMap.get(detailKey(e)) ?? { buyers: 0, revenue: 0 };
            const subReg = Number(e.registrations);
            return {
              key:          groupBy === "source" ? e.medium ?? "(none)" : e.source ?? "(direct)",
              source:       e.source,
              medium:       e.medium,
              campaign:     e.campaign,
              registrations: subReg,
              approvals:    Number(e.approvals),
              approvalPct:  subReg > 0 ? (Number(e.approvals) / subReg) * 100 : 0,
              buyers:       subSales.buyers,
              revenue:      subSales.revenue,
              conversionPct: subReg > 0 ? (subSales.buyers / subReg) * 100 : 0,
              roas:         null as number | null,
            };
          })
        : [];

    return {
      key,
      source: rowSource,
      medium: rowMedium,
      campaign: rowCampaign,
      registrations: totalReg,
      approvals: totalApp,
      approvalPct: totalReg > 0 ? (totalApp / totalReg) * 100 : 0,
      buyers: sales.buyers,
      revenue: sales.revenue,
      conversionPct: totalReg > 0 ? (sales.buyers / totalReg) * 100 : 0,
      roas,
      subRows,
    };
  });

  rows.sort((a, b) => b.revenue - a.revenue || b.registrations - a.registrations);

  const totalReg     = rows.reduce((s, r) => s + r.registrations, 0);
  const totalApp     = rows.reduce((s, r) => s + r.approvals, 0);
  const totalBuyers  = rows.reduce((s, r) => s + r.buyers, 0);
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const topRow       = rows[0];

  // Aggregate ROAS: total revenue / total ad spend across all sources with spend data
  const totalSpend = [...spendBySource.values()].reduce((s, v) => s + v, 0);
  const totalRoas  = totalSpend > 0 ? totalRevenue / totalSpend : null;

  const kpis = {
    totalSessions,
    totalRegistrations: totalReg,
    totalApprovals: totalApp,
    approvalPct: totalReg > 0 ? (totalApp / totalReg) * 100 : 0,
    totalBuyers,
    totalRevenue,
    conversionPct: totalReg > 0 ? (totalBuyers / totalReg) * 100 : 0,
    totalRoas,
    topSource: topRow?.key ?? null,
    topSourceRevenue: topRow?.revenue ?? 0,
  };

  return { kpis, rows };
}

router.get("/analytics/utm", async (req, res): Promise<void> => {
  const parsed = GetUtmQueryParams.safeParse(
    coerceDateQuery(req.query as Record<string, unknown>),
  );
  if (!parsed.success) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: parsed.error.message,
      status: 400,
    });
    return;
  }
  const clientId = requireClient(req, res);
  if (!clientId) return;

  const { from, to } = dateRange(parsed.data.dateFrom, parsed.data.dateTo);
  const groupBy    = parsed.data.groupBy;
  const filterSrc  = parsed.data.utmSource  || undefined;
  const filterMed  = parsed.data.utmMedium  || undefined;
  const filterCamp = parsed.data.utmCampaign || undefined;

  const payload = await buildUtmAnalytics(
    clientId,
    from,
    to,
    groupBy,
    filterSrc,
    filterMed,
    filterCamp,
    upzeroIsoRange(req.query as Record<string, unknown>, from, to),
  );
  res.json(GetUtmResponse.parse(payload));
});

router.get("/analytics/insight", async (req, res): Promise<void> => {
  const parsed = GetInsightQueryParams.safeParse(coerceDateQuery(req.query as Record<string, unknown>));
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }
  const clientId = requireClient(req, res);
  if (!clientId) return;
  const { from, to } = dateRange(parsed.data.dateFrom, parsed.data.dateTo);
  const screen = (parsed.data as Record<string, unknown>).screen as string | undefined ?? "dashboard";

  const insight = await generateInsight(clientId, from, to, false, screen);
  res.json(GetInsightResponse.parse(insight));
});

router.post("/analytics/insight", async (req, res): Promise<void> => {
  const parsed = GetInsightQueryParams.safeParse(coerceDateQuery(req.query as Record<string, unknown>));
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }
  const clientId = requireClient(req, res);
  if (!clientId) return;
  const { from, to } = dateRange(parsed.data.dateFrom, parsed.data.dateTo);
  const screen = (parsed.data as Record<string, unknown>).screen as string | undefined ?? "dashboard";

  const insight = await generateInsight(clientId, from, to, true, screen);
  res.json(GetInsightResponse.parse(insight));
});

export default router;

// ── Journey Analytics Helpers ────────────────────────────────────────────────

const EVENT_LABEL: Record<string, string> = {
  VISIT: "Visit",
  REGISTRATION: "Registration",
  APPROVED_REGISTRATION: "Approved",
  PRODUCT_VIEW: "Product View",
  ADD_TO_CART: "Add to Cart",
  CHECKOUT_STARTED: "Checkout",
  PURCHASE: "Purchase",
};

// Ordered event funnel layers for the flow graph
const EVENT_LAYER: Record<string, number> = {
  VISIT: 0,
  REGISTRATION: 1,
  APPROVED_REGISTRATION: 2,
  PRODUCT_VIEW: 3,
  ADD_TO_CART: 4,
  CHECKOUT_STARTED: 5,
  PURCHASE: 6,
};

/**
 * Build the top-N most common event paths that end in a PURCHASE.
 * Simplified: uses the ordered sequence of distinct event types per customer.
 */
async function buildTopPaths(
  clientId: string,
  from: Date,
  to: Date,
  topN: number,
  utmCond: SQL = sql``,
): Promise<Array<{ steps: string[]; visitCount: number; conversionRate: number }>> {
  // Fetch purchase-bounded events: for each buyer, only events BEFORE their first purchase in the window.
  // We include the purchase event itself as the terminal step.
  const evtRaw = await db.execute<{ customer_id: string; event_type: string }>(sql`
    SELECT e.customer_id, e.event_type
    FROM events e
    JOIN (
      SELECT customer_id, MIN(created_at) AS first_purchase_at
      FROM orders
      WHERE client_id = ${clientId}
        AND created_at >= ${from}
        AND created_at <= ${to}
        AND status IN ('APPROVED','SHIPPED','DELIVERED')
      GROUP BY customer_id
    ) fp ON fp.customer_id = e.customer_id
    WHERE e.client_id = ${clientId}
      AND e.created_at >= ${from}
      AND e.created_at <= fp.first_purchase_at
      ${utmCond}
    ORDER BY e.customer_id, e.created_at
  `);

  const evtRows = (evtRaw.rows ?? evtRaw) as unknown as { customer_id: string; event_type: string }[];

  // Total distinct visitors (all customers with any event in window) — denominator for conversion rate
  const visitorRaw = await db.execute<{ cnt: string }>(sql`
    SELECT COUNT(DISTINCT customer_id)::int AS cnt
    FROM events
    WHERE client_id = ${clientId}
      AND created_at >= ${from}
      AND created_at <= ${to}
  `);
  const [visRow] = (visitorRaw.rows ?? visitorRaw) as unknown as { cnt: string }[];
  const totalVisitors = Number(visRow?.cnt) || 1;

  // Build per-customer purchase-path, deduplicating consecutive identical events
  const customerPaths = new Map<string, string[]>();
  for (const row of evtRows) {
    if (!row.customer_id || !row.event_type) continue;
    const path = customerPaths.get(row.customer_id) ?? [];
    if (path[path.length - 1] !== row.event_type) {
      path.push(row.event_type);
    }
    customerPaths.set(row.customer_id, path);
  }

  // Count path frequencies
  const pathCounts = new Map<string, number>();
  for (const path of customerPaths.values()) {
    const key = path.join("|");
    pathCounts.set(key, (pathCounts.get(key) ?? 0) + 1);
  }

  // conversionRate = share of total visitors who took exactly this path to purchase
  return Array.from(pathCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([key, count]) => ({
      steps: key.split("|").map((s) => EVENT_LABEL[s] ?? s),
      visitCount: count,
      conversionRate: (count / totalVisitors) * 100,
    }));
}

/**
 * Build event flow graph nodes and edges from buyer conversion journeys.
 * Scoped to purchase-bounded sequences: only events up to (and including) the
 * buyer's first purchase in the selected date window.
 */
async function buildEventFlowGraph(
  clientId: string,
  from: Date,
  to: Date,
  utmCond: SQL = sql``,
): Promise<{
  nodes: Array<{ id: string; label: string; count: number; layer: number }>;
  edges: Array<{ source: string; target: string; count: number }>;
}> {
  const evtRaw = await db.execute<{ customer_id: string; event_type: string }>(sql`
    SELECT e.customer_id, e.event_type
    FROM events e
    JOIN (
      SELECT customer_id, MIN(created_at) AS first_purchase_at
      FROM orders
      WHERE client_id = ${clientId}
        AND created_at >= ${from}
        AND created_at <= ${to}
        AND status IN ('APPROVED','SHIPPED','DELIVERED')
      GROUP BY customer_id
    ) fp ON fp.customer_id = e.customer_id
    WHERE e.client_id = ${clientId}
      AND e.created_at >= ${from}
      AND e.created_at <= fp.first_purchase_at
      ${utmCond}
    ORDER BY e.customer_id, e.created_at
  `);

  const evtRows = (evtRaw.rows ?? evtRaw) as unknown as { customer_id: string; event_type: string }[];

  const nodeCounts = new Map<string, number>();
  const edgeCounts = new Map<string, number>();

  // Accumulate purchase-bounded sequences per customer
  const customerSeqs = new Map<string, string[]>();
  for (const row of evtRows) {
    if (!row.customer_id || !row.event_type) continue;
    const seq = customerSeqs.get(row.customer_id) ?? [];
    seq.push(row.event_type);
    customerSeqs.set(row.customer_id, seq);
  }

  for (const seq of customerSeqs.values()) {
    for (let i = 0; i < seq.length; i++) {
      const et = seq[i];
      nodeCounts.set(et, (nodeCounts.get(et) ?? 0) + 1);
      if (i < seq.length - 1) {
        const edgeKey = `${seq[i]}→${seq[i + 1]}`;
        edgeCounts.set(edgeKey, (edgeCounts.get(edgeKey) ?? 0) + 1);
      }
    }
  }

  const nodes = Array.from(nodeCounts.entries()).map(([et, count]) => ({
    id: et,
    label: EVENT_LABEL[et] ?? et,
    count,
    layer: EVENT_LAYER[et] ?? 99,
  }));

  const edges = Array.from(edgeCounts.entries()).map(([key, count]) => {
    const [source, target] = key.split("→");
    return { source, target, count };
  });

  return { nodes, edges };
}

/**
 * Build avg session depth and event-type breakdown for buyers or non-buyers.
 */
async function buildAudienceEventProfile(
  clientId: string,
  from: Date,
  to: Date,
  isBuyer: boolean,
  utmCond: SQL = sql``,
): Promise<{ avgSessionDepth: number; eventCounts: Array<{ eventType: string; count: number }>; topUtmSources: Array<{ source: string; count: number }> }> {
  const buyerIds = db
    .select({ id: ordersTable.customerId })
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.clientId, clientId),
        gte(ordersTable.createdAt, from),
        lte(ordersTable.createdAt, to),
        sql`${ordersTable.status} IN ('APPROVED', 'SHIPPED', 'DELIVERED')`,
      ),
    );

  const inOrNotIn = isBuyer
    ? inArray(eventsTable.customerId, buyerIds)
    : sql`${eventsTable.customerId} NOT IN (${buyerIds})`;

  const customerFilter = isBuyer
    ? sql`customer_id IN (SELECT customer_id FROM orders WHERE client_id = ${clientId} AND created_at >= ${from} AND created_at <= ${to} AND status IN ('APPROVED','SHIPPED','DELIVERED'))`
    : sql`customer_id NOT IN (SELECT customer_id FROM orders WHERE client_id = ${clientId} AND created_at >= ${from} AND created_at <= ${to} AND status IN ('APPROVED','SHIPPED','DELIVERED'))`;

  const depthRaw = await db.execute<{ avg_d: string }>(sql`
    SELECT COALESCE(AVG(cnt), 0)::float AS avg_d
    FROM (
      SELECT customer_id, COUNT(*) AS cnt
      FROM events
      WHERE client_id = ${clientId}
        AND created_at >= ${from}
        AND created_at <= ${to}
        AND ${customerFilter}
        ${utmCond}
      GROUP BY customer_id
    ) sub
  `);
  const [depthRow] = (depthRaw.rows ?? depthRaw) as unknown as { avg_d: string }[];

  const eventRows = await db
    .select({
      eventType: eventsTable.eventType,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(eventsTable)
    .where(
      and(
        eq(eventsTable.clientId, clientId),
        gte(eventsTable.createdAt, from),
        lte(eventsTable.createdAt, to),
        inOrNotIn,
      ),
    )
    .groupBy(eventsTable.eventType)
    .orderBy(sql`COUNT(*) DESC`);

  // Top UTM sources for this audience (buyers or non-buyers) based on customer acquisition data
  const utmFilter = isBuyer
    ? inArray(customersTable.id, db.select({ id: ordersTable.customerId }).from(ordersTable).where(and(eq(ordersTable.clientId, clientId), gte(ordersTable.createdAt, from), lte(ordersTable.createdAt, to), sql`${ordersTable.status} IN ('APPROVED','SHIPPED','DELIVERED')`)))
    : sql`${customersTable.id} NOT IN (SELECT customer_id FROM orders WHERE client_id = ${clientId} AND created_at >= ${from} AND created_at <= ${to} AND status IN ('APPROVED','SHIPPED','DELIVERED'))`;

  const utmRows = await db
    .select({
      source: sql<string>`COALESCE(${customersTable.utmSource}, 'direct')`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(customersTable)
    .where(
      and(
        eq(customersTable.clientId, clientId),
        utmFilter,
      ),
    )
    .groupBy(customersTable.utmSource)
    .orderBy(sql`COUNT(*) DESC`)
    .limit(5);

  return {
    avgSessionDepth: Number(depthRow?.avg_d) || 0,
    eventCounts: eventRows.map((r) => ({ eventType: r.eventType, count: Number(r.count) })),
    topUtmSources: utmRows.map((r) => ({ source: r.source || "direct", count: Number(r.count) })),
  };
}

/**
 * Build suggested-actions list keyed off the worst drop-off step in the funnel.
 */
function buildFunnelSuggestedActions(
  worst: { idx: number; drop: number },
  steps: Array<{ step: string; label: string; dropOffRate: number }>,
): string[] {
  const STEP_ACTIONS: Record<string, string[]> = {
    REGISTRATION: [
      "Simplify the registration form — fewer required fields can lift signups significantly.",
      "Add social login options to reduce friction at registration.",
      "A/B test the registration CTA copy and placement.",
    ],
    APPROVED_REGISTRATION: [
      "Review approval criteria — if the approval rate is below 50%, consider loosening them.",
      "Send an immediate approval-notification email/SMS to keep momentum.",
      "Set up an automated follow-up sequence for pending applications.",
    ],
    ADD_TO_CART: [
      "Add urgency signals (limited stock badges, countdown timers) to product pages.",
      "Improve product page visuals and descriptions to drive cart adds.",
      "Introduce a 'Recently Viewed' or 'Recommended' section to surface relevant products.",
    ],
    CHECKOUT_STARTED: [
      "Reduce the number of checkout steps — a single-page checkout converts better.",
      "Enable guest checkout to remove the login barrier.",
      "Show trust signals (SSL badge, return policy) prominently at checkout.",
    ],
    PURCHASE: [
      "Investigate payment failures — high drop-off here often signals payment method gaps.",
      "Offer Buy-Now-Pay-Later (BNPL) options if not already available.",
      "Add an order-review step with a clear CTA to reduce last-second abandonment.",
    ],
  };

  const worstStep = worst.idx > 0 ? steps[worst.idx]?.step : null;
  const specific = worstStep ? (STEP_ACTIONS[worstStep] ?? []) : [];
  const generic = [
    "Invest in re-engagement campaigns targeting customers who dropped off mid-funnel.",
    "Review mobile UX — mobile sessions often have higher drop-off rates.",
  ];
  return [...specific.slice(0, 2), ...generic].slice(0, 3);
}

// ── Journey / RFM AI Insight Helpers ────────────────────────────────────────

async function buildJourneyInsightContext(clientId: string, from: Date, to: Date) {
  const [kpiRow] = await db
    .select({
      avgTTFP: sql<number>`COALESCE(AVG(EXTRACT(EPOCH FROM (first_purchase_at - created_at)) / 86400), 0)::float`,
    })
    .from(customersTable)
    .where(
      and(
        eq(customersTable.clientId, clientId),
        sql`${customersTable.firstPurchaseAt} IS NOT NULL`,
        gte(customersTable.firstPurchaseAt, from),
        lte(customersTable.firstPurchaseAt, to),
      ),
    );

  const buyerEvtRaw = await db.execute<{ avg_be: string }>(sql`
    SELECT COALESCE(AVG(cnt), 0)::float AS avg_be
    FROM (
      SELECT customer_id, COUNT(*) AS cnt
      FROM events
      WHERE client_id = ${clientId}
        AND created_at >= ${from}
        AND created_at <= ${to}
        AND customer_id IN (
          SELECT customer_id FROM orders
          WHERE client_id = ${clientId}
            AND created_at >= ${from}
            AND created_at <= ${to}
            AND status IN ('APPROVED','SHIPPED','DELIVERED')
        )
      GROUP BY customer_id
    ) sub
  `);
  const [buyerEvtRow] = (buyerEvtRaw.rows ?? buyerEvtRaw) as unknown as { avg_be: string }[];

  const [brand] = await db.select({ name: clientsTable.name }).from(clientsTable).where(eq(clientsTable.id, clientId));

  return {
    avgEventsBeforePurchase: Number(buyerEvtRow?.avg_be) || 0,
    avgTimeToFirstPurchaseDays: Number(kpiRow?.avgTTFP) || 0,
    brand: brand?.name ?? "the brand",
  };
}

async function buildRfmInsightContext(clientId: string, from: Date, to: Date) {
  // Scope to customers who had at least one purchase in the selected period
  const periodBuyerIds = db
    .select({ id: ordersTable.customerId })
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.clientId, clientId),
        gte(ordersTable.createdAt, from),
        lte(ordersTable.createdAt, to),
        sql`${ordersTable.status} IN ('APPROVED','SHIPPED','DELIVERED')`,
      ),
    );

  const segRows = await db
    .select({
      segment: sql<string>`COALESCE(${customersTable.rfmSegment}, 'Unsegmented')`,
      count: sql<number>`COUNT(*)::int`,
      revenue: sql<number>`COALESCE(SUM(${customersTable.totalSpent}), 0)::float`,
    })
    .from(customersTable)
    .where(
      and(
        eq(customersTable.clientId, clientId),
        inArray(customersTable.id, periodBuyerIds),
      ),
    )
    .groupBy(customersTable.rfmSegment);

  const total = segRows.reduce((s, r) => s + Number(r.count), 0);
  const [brand] = await db.select({ name: clientsTable.name }).from(clientsTable).where(eq(clientsTable.id, clientId));

  const segMap: Record<string, { count: number; revenue: number }> = {};
  for (const r of segRows) {
    segMap[r.segment] = { count: Number(r.count), revenue: Number(r.revenue) };
  }

  return { segMap, total, brand: brand?.name ?? "the brand" };
}

// ── Marketing Performance ────────────────────────────────────────────────────
// Paid channels we attribute revenue and leads to.
const PAID_UTM_SOURCES = ["instagram", "facebook", "meta", "google", "google_ads", "tiktok"];
const PAID_SOURCES_ARRAY = `ARRAY[${PAID_UTM_SOURCES.map((s) => `'${s}'`).join(",")}]`;

type Creative = typeof creativesTable.$inferSelect;

/**
 * Returns the fraction of a creative's total spend that falls within [from, to].
 * Creatives without date bounds are treated as fully active in any window.
 */
function computeSpendOverlapFraction(creative: Creative, from: Date, to: Date): number {
  if (!creative.activeFrom || !creative.activeTo) return 1;
  const cFrom = new Date(creative.activeFrom as string);
  const cTo = new Date(creative.activeTo as string);
  const campaignMs = Math.max(1, cTo.getTime() - cFrom.getTime());
  const overlapMs = Math.max(0, Math.min(to.getTime(), cTo.getTime()) - Math.max(from.getTime(), cFrom.getTime()));
  return overlapMs / campaignMs;
}

function buildPlatformBreakdown(
  creatives: Creative[],
  attributedRevenue: number,
  totalProratedSpend: number,
  from: Date,
  to: Date,
) {
  const platforms = new Map<
    string,
    { spend: number; leads: number; approvedLeads: number; clicks: number; impressions: number }
  >();
  for (const c of creatives) {
    const proratedSpend = c.spend * computeSpendOverlapFraction(c, from, to);
    const existing = platforms.get(c.platform) ?? { spend: 0, leads: 0, approvedLeads: 0, clicks: 0, impressions: 0 };
    platforms.set(c.platform, {
      spend: existing.spend + proratedSpend,
      leads: existing.leads + c.leads,
      approvedLeads: existing.approvedLeads + c.approvedLeads,
      clicks: existing.clicks + c.clicks,
      impressions: existing.impressions + c.impressions,
    });
  }
  return Array.from(platforms.entries()).map(([platform, p]) => {
    const share = totalProratedSpend > 0 ? p.spend / totalProratedSpend : 0;
    const platRevenue = attributedRevenue * share;
    return {
      platform,
      spend: p.spend,
      leads: p.leads,
      approvedLeads: p.approvedLeads,
      clicks: p.clicks,
      impressions: p.impressions,
      attributedRevenue: platRevenue,
      roas: p.spend > 0 ? platRevenue / p.spend : 0,
    };
  });
}

function buildCreativeMetrics(
  creatives: Creative[],
  attributedRevenue: number,
  totalProratedSpend: number,
  from: Date,
  to: Date,
) {
  // Split attributed revenue proportionally by prorated spend share within each platform.
  const platformProratedSpend = new Map<string, number>();
  for (const c of creatives) {
    const ps = c.spend * computeSpendOverlapFraction(c, from, to);
    platformProratedSpend.set(c.platform, (platformProratedSpend.get(c.platform) ?? 0) + ps);
  }
  const platformRevenue = new Map<string, number>();
  if (totalProratedSpend > 0) {
    for (const [platform, pspend] of platformProratedSpend.entries()) {
      platformRevenue.set(platform, attributedRevenue * (pspend / totalProratedSpend));
    }
  }

  return creatives.map((c) => {
    const fraction = computeSpendOverlapFraction(c, from, to);
    const proratedSpend = c.spend * fraction;
    const platRev = platformRevenue.get(c.platform) ?? 0;
    const platSp = platformProratedSpend.get(c.platform) ?? 0;
    const creativeRev = platSp > 0 ? platRev * (proratedSpend / platSp) : 0;
    // Prorate engagement metrics by the same overlap fraction as spend so all
    // per-creative KPIs (CTR, CPL, CPA) are consistent with the selected window.
    const proratedClicks = Math.round(c.clicks * fraction);
    const proratedImpressions = Math.round(c.impressions * fraction);
    const proratedLeads = Math.round(c.leads * fraction);
    const proratedApprovedLeads = Math.round(c.approvedLeads * fraction);
    return {
      id: c.id,
      name: c.name,
      platform: c.platform,
      status: c.status,
      imageUrl: c.imageUrl ?? null,
      clicks: proratedClicks,
      impressions: proratedImpressions,
      ctr: proratedImpressions > 0 ? (proratedClicks / proratedImpressions) * 100 : 0,
      leads: proratedLeads,
      approvedLeads: proratedApprovedLeads,
      spend: proratedSpend,
      attributedRevenue: creativeRev,
      roas: proratedSpend > 0 ? creativeRev / proratedSpend : 0,
      cpl: proratedLeads > 0 ? proratedSpend / proratedLeads : 0,
      cpa: proratedApprovedLeads > 0 ? proratedSpend / proratedApprovedLeads : 0,
    };
  });
}

function metaSourceMatchesFilter(utmSource?: string): boolean {
  if (!utmSource) return true;
  return ["meta", "facebook", "instagram"].includes(utmSource.toLowerCase());
}

function buildMetaCampaignMetrics(campaigns: MetaAdMetric[]) {
  return campaigns.map((campaign) => ({
    id: `meta-campaign:${campaign.id}`,
    name: campaign.name,
    platform: "META",
    status: campaign.status ?? "UNKNOWN",
    imageUrl: null,
    clicks: campaign.clicks,
    impressions: campaign.impressions,
    ctr: campaign.impressions > 0 ? (campaign.clicks / campaign.impressions) * 100 : 0,
    leads: campaign.leads,
    approvedLeads: campaign.purchases,
    spend: campaign.spend,
    attributedRevenue: campaign.revenue,
    roas: campaign.roas ?? (campaign.spend > 0 ? campaign.revenue / campaign.spend : 0),
    cpl: campaign.cpl ?? (campaign.leads > 0 ? campaign.spend / campaign.leads : 0),
    cpa: campaign.cpa ?? (campaign.purchases > 0 ? campaign.spend / campaign.purchases : 0),
  }));
}

function buildMetaPlatformBreakdown(campaigns: MetaAdMetric[]) {
  const spend = campaigns.reduce((sum, campaign) => sum + campaign.spend, 0);
  const leads = campaigns.reduce((sum, campaign) => sum + campaign.leads, 0);
  const purchases = campaigns.reduce((sum, campaign) => sum + campaign.purchases, 0);
  const clicks = campaigns.reduce((sum, campaign) => sum + campaign.clicks, 0);
  const impressions = campaigns.reduce((sum, campaign) => sum + campaign.impressions, 0);
  const revenue = campaigns.reduce((sum, campaign) => sum + campaign.revenue, 0);
  return [
    {
      platform: "META",
      spend,
      leads,
      approvedLeads: purchases,
      clicks,
      impressions,
      attributedRevenue: revenue,
      roas: spend > 0 ? revenue / spend : 0,
    },
  ];
}

async function computeMarketingKpis(
  clientId: string,
  creatives: Creative[],
  from: Date,
  to: Date,
  meta?: MetaMarketingData | null,
) {
  const creativeSpend = creatives.reduce((s, c) => s + c.spend * computeSpendOverlapFraction(c, from, to), 0);
  const totalSpend = meta ? meta.summary.spend : creativeSpend;

  // Requested revenue: all order amounts requested in the period, regardless
  // of final approval/shipping status. This mirrors the dashboard's
  // requestedRevenue KPI and keeps marketing ROA aligned with demand generated.
  const [orderRow] = await db
    .select({
      revenue: sql<number>`COALESCE(SUM(${ordersTable.amount}), 0)::float`,
      orders: sql<number>`COUNT(*)::int`,
    })
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.clientId, clientId),
        gte(ordersTable.createdAt, from),
        lte(ordersTable.createdAt, to),
      ),
    );
  const attributedRevenue = Number(orderRow?.revenue) || 0;
  const requestedOrders = Number(orderRow?.orders) || 0;

  const [registrationRow] = await db
    .select({
      totalLeads: sql<number>`COUNT(*)::int`,
      approvedLeads: sql<number>`COUNT(*) FILTER (WHERE ${customersTable.registrationStatus} = 'APPROVED')::int`
    })
    .from(customersTable)
    .where(
      and(
        eq(customersTable.clientId, clientId),
        gte(customersTable.createdAt, from),
        lte(customersTable.createdAt, to),
      ),
    );

  const totalLeads = Number(registrationRow?.totalLeads) || 0;
  const approvedLeads = Number(registrationRow?.approvedLeads) || 0;
  const approvalRate = totalLeads > 0 ? (approvedLeads / totalLeads) * 100 : 0;
  const metaLeads = meta?.summary.leads ?? creatives.reduce((s, c) => s + c.leads * computeSpendOverlapFraction(c, from, to), 0);

  return {
    totalSpend,
    attributedRevenue,
    roas: totalSpend > 0 ? attributedRevenue / totalSpend : 0,
    totalLeads,
    approvedLeads,
    approvalRate,
    cpl: meta?.summary.cpl ?? (metaLeads > 0 ? totalSpend / metaLeads : 0),
    cpa: requestedOrders > 0 ? totalSpend / requestedOrders : 0,
  };
}

/** Build a daily spend series by distributing each creative's prorated spend across its active days within [from, to]. */
function buildSpendOverTime(creatives: Creative[], from: Date, to: Date): { date: string; value: number }[] {
  const days: { date: string; value: number }[] = [];
  const msPerDay = 86_400_000;
  const totalDays = Math.round((to.getTime() - from.getTime()) / msPerDay) + 1;

  for (let d = 0; d < totalDays; d++) {
    const day = new Date(from.getTime() + d * msPerDay);
    const dayStr = day.toISOString().split("T")[0];
    let dailySpend = 0;

    for (const c of creatives) {
      if (!c.activeFrom || !c.activeTo) {
        dailySpend += c.spend / totalDays;
      } else {
        const cFrom = new Date(c.activeFrom as string);
        const cTo = new Date(c.activeTo as string);
        if (day >= cFrom && day <= cTo) {
          const campaignDays = Math.max(1, Math.round((cTo.getTime() - cFrom.getTime()) / msPerDay) + 1);
          dailySpend += c.spend / campaignDays;
        }
      }
    }
    days.push({ date: dayStr, value: Math.round(dailySpend) });
  }
  return days;
}

/** Top 5 states by paid-channel leads in [from, to]. */
async function buildStateBreakdown(clientId: string, from: Date, to: Date, totalProratedSpend: number) {
  // Fetch all states (up to 27 BR states) — sort by ROAS in JS so we can
  // compute proportional spend per state accurately.
  const rows = await db
    .select({
      state: customersTable.state,
      leads: sql<number>`COUNT(DISTINCT ${eventsTable.customerId})::int`,
      revenue: sql<number>`COALESCE(SUM(${ordersTable.amount}), 0)::float`,
    })
    .from(eventsTable)
    .innerJoin(customersTable, eq(eventsTable.customerId, customersTable.id))
    .leftJoin(
      ordersTable,
      and(
        eq(ordersTable.customerId, customersTable.id),
        eq(ordersTable.clientId, clientId),
        gte(ordersTable.createdAt, from),
        lte(ordersTable.createdAt, to),
        sql`${ordersTable.status} IN ('APPROVED', 'SHIPPED', 'DELIVERED')`,
      ),
    )
    .where(
      and(
        eq(eventsTable.clientId, clientId),
        gte(eventsTable.createdAt, from),
        lte(eventsTable.createdAt, to),
        sql`${eventsTable.eventType} = 'REGISTRATION'`,
        sql`lower(${customersTable.utmSource}) = ANY(${sql.raw(PAID_SOURCES_ARRAY)})`,
        sql`${customersTable.state} IS NOT NULL`,
      ),
    )
    .groupBy(customersTable.state);

  const totalLeads = rows.reduce((s, r) => s + r.leads, 0);

  const withRoas = rows.map((r) => {
    const leadFraction = totalLeads > 0 ? r.leads / totalLeads : 0;
    const stateSpend = totalProratedSpend * leadFraction;
    const revenue = Number(r.revenue);
    return {
      state: r.state ?? "",
      leads: r.leads,
      attributedRevenue: revenue,
      roas: stateSpend > 0 ? revenue / stateSpend : 0,
    };
  });

  // Top 5 by ROAS descending
  return withRoas.sort((a, b) => b.roas - a.roas).slice(0, 5);
}

/** Age-group breakdown. Returns empty when no birth-date data is available in
 *  the customers table (no dateOfBirth column in current schema). The UI card
 *  hides itself gracefully when this array is empty. */
function buildAgeBreakdown(): { ageGroup: string; leads: number; attributedRevenue: number; roas: number }[] {
  // No dateOfBirth / age column in the customers schema — return empty so the
  // UI shows its graceful "no demographic data" hide path.
  return [];
}

type DailyReportMetricSet = {
  approvedRevenue: number;
  sales: number;
  avgTicket: number;
  costPerPurchase: number;
  mediaSpend: number;
  roas: number;
};

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

function dailyHeuristic(params: {
  kpis: DailyReportMetricSet;
  prevKpis: DailyReportMetricSet;
  campaigns: Array<{ name: string; spend: number; roas: number; purchases: number }>;
  products: Array<{ name: string; units: number; revenue: number }>;
  categories: Array<{ name: string; units: number; revenue: number }>;
  colors: Array<{ name: string; units: number; revenue: number }>;
  sizes: Array<{ name: string; units: number; revenue: number }>;
}): { generalAnalysis: string; reportSummary: string[]; source: "ai" | "heuristic" } {
  const revenueChange = pctChange(params.kpis.approvedRevenue, params.prevKpis.approvedRevenue);
  const salesChange = pctChange(params.kpis.sales, params.prevKpis.sales);
  const roasChange = pctChange(params.kpis.roas, params.prevKpis.roas);
  const topCampaign = params.campaigns[0];
  const topProduct = params.products[0];
  const topCategory = params.categories[0];
  const revenueTrend =
    revenueChange == null
      ? "sem base anterior comparável"
      : revenueChange >= 0
        ? `cresceu ${revenueChange.toFixed(1)}%`
        : `caiu ${Math.abs(revenueChange).toFixed(1)}%`;
  const roasTrend =
    roasChange == null
      ? "sem base anterior"
      : roasChange >= 0
        ? `melhorou ${roasChange.toFixed(1)}%`
        : `piorou ${Math.abs(roasChange).toFixed(1)}%`;

  return {
    generalAnalysis: `No período, o faturamento aprovado ${revenueTrend}, com ${params.kpis.sales} vendas e ROAS de ${params.kpis.roas.toFixed(2)}x. O investimento em mídia foi de R$${params.kpis.mediaSpend.toFixed(2)} e o custo por compra ficou em R$${params.kpis.costPerPurchase.toFixed(2)}.`,
    reportSummary: [
      salesChange == null
        ? `Foram ${params.kpis.sales} vendas no período, ainda sem uma base anterior sólida para comparação.`
        : `A quantidade de vendas ${salesChange >= 0 ? "subiu" : "caiu"} ${Math.abs(salesChange).toFixed(1)}% versus o período anterior.`,
      topCampaign
        ? `Campanha de maior investimento: ${topCampaign.name}, com R$${topCampaign.spend.toFixed(2)} investidos, ${topCampaign.purchases} compras e ROAS ${topCampaign.roas.toFixed(2)}x.`
        : "Não houve campanhas de mídia com dados disponíveis para o período.",
      topProduct
        ? `Produto mais vendido: ${topProduct.name}, com ${topProduct.units} unidades e R$${topProduct.revenue.toFixed(2)} em receita aprovada.`
        : "Não houve produtos vendidos no período.",
      topCategory
        ? `Categoria líder: ${topCategory.name}, com ${topCategory.units} unidades vendidas e R$${topCategory.revenue.toFixed(2)} em receita.`
        : "Não houve categoria com venda registrada no período.",
      params.colors[0]
        ? `Cor destaque: ${params.colors[0].name}, com ${params.colors[0].units} unidades vendidas.`
        : params.sizes[0]
          ? `Tamanho destaque: ${params.sizes[0].name}, com ${params.sizes[0].units} unidades vendidas.`
          : `ROAS ${roasTrend}; acompanhe campanhas com gasto alto e baixa compra para realocar verba.`,
    ],
    source: "heuristic",
  };
}

function sanitizeDailyInsightText(text: string): string {
  return text
    .replace(/campanha(s)? (nao|não) (tem|têm) eficiencia/gi, "campanha$1 precisa de ajuste de verba, criativo e segmentação")
    .replace(/campanha(s)? ineficiente(s)?/gi, "campanha$1 que precisa de otimização")
    .replace(/sem eficiencia/gi, "com necessidade de otimização")
    .replace(/sem eficiência/gi, "com necessidade de otimização")
    .trim();
}

async function generateDailyReportText(params: {
  brand: string;
  dateFrom: string;
  dateTo: string;
  kpis: DailyReportMetricSet;
  prevKpis: DailyReportMetricSet;
  campaigns: Array<{ name: string; spend: number; purchases: number; revenue: number; roas: number; cpa: number }>;
  products: Array<{ name: string; category: string | null; units: number; revenue: number }>;
  categories: Array<{ name: string; units: number; revenue: number }>;
  colors: Array<{ name: string; units: number; revenue: number }>;
  sizes: Array<{ name: string; units: number; revenue: number }>;
}): Promise<{ generalAnalysis: string; reportSummary: string[]; source: "ai" | "heuristic" }> {
  const heuristic = dailyHeuristic(params);
  const ai = getOpenAIClient();
  if (!ai || !isAIConfigured()) return heuristic;

  const parseReportJson = (text: string): { generalAnalysis?: string; reportSummary?: unknown } | null => {
    try {
      return JSON.parse(text) as { generalAnalysis?: string; reportSummary?: unknown };
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      try {
        return JSON.parse(jsonMatch[0]) as { generalAnalysis?: string; reportSummary?: unknown };
      } catch {
        return null;
      }
    }
  };

  try {
    const completion = await ai.chat.completions.create({
      model: process.env.AI_INTEGRATIONS_OPENAI_MODEL ?? "gpt-5-nano",
      max_completion_tokens: 1200,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "Você é um analista sênior de e-commerce B2C e mídia paga. Responda somente JSON válido, em português do Brasil, com análise objetiva para enviar ao cliente. Nunca diga que uma campanha não tem eficiência ou é ineficiente; quando houver queda ou baixo retorno, descreva a ação necessária, como ajustar verba, criativo, público, oferta ou página.",
        },
        {
          role: "user",
          content: `Crie um relatório diário para "${params.brand}" no período ${params.dateFrom} até ${params.dateTo}.

Métricas atuais:
- Faturamento aprovado: R$${params.kpis.approvedRevenue.toFixed(2)}
- Vendas: ${params.kpis.sales}
- Ticket médio: R$${params.kpis.avgTicket.toFixed(2)}
- Custo por compra: R$${params.kpis.costPerPurchase.toFixed(2)}
- Investimento em mídia: R$${params.kpis.mediaSpend.toFixed(2)}
- ROAS: ${params.kpis.roas.toFixed(2)}x

Período anterior:
- Faturamento aprovado: R$${params.prevKpis.approvedRevenue.toFixed(2)}
- Vendas: ${params.prevKpis.sales}
- Ticket médio: R$${params.prevKpis.avgTicket.toFixed(2)}
- Custo por compra: R$${params.prevKpis.costPerPurchase.toFixed(2)}
- Investimento em mídia: R$${params.prevKpis.mediaSpend.toFixed(2)}
- ROAS: ${params.prevKpis.roas.toFixed(2)}x

Campanhas principais: ${params.campaigns.slice(0, 8).map((c) => `${c.name}: gasto R$${c.spend.toFixed(2)}, compras ${c.purchases}, receita R$${c.revenue.toFixed(2)}, ROAS ${c.roas.toFixed(2)}x, CPA R$${c.cpa.toFixed(2)}`).join(" | ") || "sem dados"}
Produtos mais vendidos: ${params.products.slice(0, 8).map((p) => `${p.name}${p.category ? ` (${p.category})` : ""}: ${p.units} un., R$${p.revenue.toFixed(2)}`).join(" | ") || "sem dados"}
Categorias: ${params.categories.slice(0, 8).map((c) => `${c.name}: ${c.units} un., R$${c.revenue.toFixed(2)}`).join(" | ") || "sem dados"}
Cores: ${params.colors.slice(0, 8).map((c) => `${c.name}: ${c.units} un., R$${c.revenue.toFixed(2)}`).join(" | ") || "sem dados"}
Tamanhos: ${params.sizes.slice(0, 8).map((s) => `${s.name}: ${s.units} un., R$${s.revenue.toFixed(2)}`).join(" | ") || "sem dados"}

Retorne exatamente:
{
  "generalAnalysis": "<1 parágrafo curto com a leitura geral>",
  "reportSummary": ["<insight 1>", "<insight 2>", "<insight 3>", "<insight 4>", "... opcional até 6"]
}

Os insights precisam falar de campanhas, melhora/piora, produtos, categorias e, quando houver, cores/tamanhos. Quando uma campanha piorar ou tiver baixo retorno, fale o que deve ser feito; não use termos como "sem eficiência", "não tem eficiência" ou "ineficiente". Não use markdown.`,
        },
      ],
    });
    const text = completion.choices[0]?.message?.content;
    if (!text) return heuristic;
    const parsed = parseReportJson(text);
    if (!parsed) return heuristic;
    const bullets = Array.isArray(parsed.reportSummary)
      ? parsed.reportSummary.map((item) => String(item).trim()).filter(Boolean)
      : [];

    const generalAnalysis = typeof parsed.generalAnalysis === "string" ? parsed.generalAnalysis.trim() : "";
    const mergedBullets = [...bullets, ...heuristic.reportSummary].reduce<string[]>((acc, item) => {
      const clean = item.trim();
      if (!clean) return acc;
      if (!acc.some((existing) => existing.toLocaleLowerCase("pt-BR") === clean.toLocaleLowerCase("pt-BR"))) {
        acc.push(clean);
      }
      return acc;
    }, []);

    if (generalAnalysis || bullets.length > 0) {
      return {
        generalAnalysis: sanitizeDailyInsightText(generalAnalysis || heuristic.generalAnalysis).slice(0, 1200),
        reportSummary: mergedBullets.slice(0, 6).map((item) => sanitizeDailyInsightText(item).slice(0, 300)),
        source: "ai",
      };
    }
  } catch (err) {
    console.warn("[daily-report] AI generation failed, using heuristic:", err instanceof Error ? err.message : err);
  }
  return heuristic;
}

router.get("/analytics/daily-report", async (req, res): Promise<void> => {
  const parsed = z.object({
    clientId: z.string().optional(),
    dateFrom: z.date().optional(),
    dateTo: z.date().optional(),
  }).safeParse(coerceDateQuery(req.query as Record<string, unknown>));
  if (!parsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }

  const clientId = requireClient(req, res);
  if (!clientId) return;
  const rawQuery = req.query as Record<string, unknown>;
  const { from, to } = dateRange(parsed.data.dateFrom, parsed.data.dateTo);
  const dateFromOnly = queryDateOnly(rawQuery, "dateFrom", from);
  const dateToOnly = queryDateOnly(rawQuery, "dateTo", to);
  const span = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - span);
  const prevDateFromOnly = saoPauloDateOnly(prevFrom);
  const prevDateToOnly = saoPauloDateOnly(prevTo);

  const [clientConfig] = await db
    .select({
      name: clientsTable.name,
      dashboardType: clientsTable.dashboardType,
      metaAdsApiKey: clientsTable.metaAdsApiKey,
      metaAdAccountId: clientsTable.metaAdAccountId,
    })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));

  if (!clientConfig) {
    res.status(404).json({ error: true, code: "NOT_FOUND", message: "Client not found", status: 404 });
    return;
  }
  if (clientConfig.dashboardType !== "B2C") {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: "Daily report is only available for B2C clients", status: 400 });
    return;
  }

  const paidStatus = sql`${ordersTable.status} IN ('APPROVED', 'SHIPPED', 'DELIVERED')`;
  const metricForWindow = async (winFrom: Date, winTo: Date, mediaSpend: number): Promise<DailyReportMetricSet> => {
    const [row] = await db
      .select({
        approvedRevenue: sql<number>`COALESCE(SUM(${ordersTable.fulfilledAmount}), 0)::float`,
        sales: sql<number>`COUNT(*)::int`,
      })
      .from(ordersTable)
      .where(and(eq(ordersTable.clientId, clientId), gte(ordersTable.createdAt, winFrom), lte(ordersTable.createdAt, winTo), paidStatus));
    const approvedRevenue = Number(row?.approvedRevenue) || 0;
    const sales = Number(row?.sales) || 0;
    return {
      approvedRevenue,
      sales,
      avgTicket: sales > 0 ? approvedRevenue / sales : 0,
      costPerPurchase: sales > 0 ? mediaSpend / sales : 0,
      mediaSpend,
      roas: mediaSpend > 0 ? approvedRevenue / mediaSpend : 0,
    };
  };

  const metaAccessToken = getGlobalMetaAccessToken(clientConfig.metaAdsApiKey);
  const [metaCurrent, metaPrev] = await Promise.all([
    metaAccessToken && clientConfig.metaAdAccountId
      ? fetchMetaMarketingData({
          accessToken: metaAccessToken,
          adAccountId: clientConfig.metaAdAccountId,
          since: dateFromOnly,
          until: dateToOnly,
        }).catch((err) => {
          console.warn("[daily-report] Meta current fetch failed:", err);
          return null;
        })
      : Promise.resolve(null),
    metaAccessToken && clientConfig.metaAdAccountId
      ? fetchMetaMarketingData({
          accessToken: metaAccessToken,
          adAccountId: clientConfig.metaAdAccountId,
          since: prevDateFromOnly,
          until: prevDateToOnly,
        }).catch((err) => {
          console.warn("[daily-report] Meta previous fetch failed:", err);
          return null;
        })
      : Promise.resolve(null),
  ]);
  if (metaCurrent) await upsertMetaCreatives(clientId, metaCurrent.ads);

  const [kpis, prevKpis, productRows, categoryRows, colorRows, sizeRows] = await Promise.all([
    metricForWindow(from, to, metaCurrent?.summary.spend ?? 0),
    metricForWindow(prevFrom, prevTo, metaPrev?.summary.spend ?? 0),
    db
      .select({
        name: productsTable.name,
        category: productsTable.category,
        units: sql<number>`COALESCE(SUM(${orderItemsTable.fulfilledQuantity}), 0)::int`,
        revenue: sql<number>`COALESCE(SUM(${orderItemsTable.fulfilledQuantity} * ${orderItemsTable.priceAtSale}), 0)::float`,
      })
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .innerJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
      .where(and(eq(ordersTable.clientId, clientId), gte(ordersTable.createdAt, from), lte(ordersTable.createdAt, to), paidStatus))
      .groupBy(productsTable.id, productsTable.name, productsTable.category)
      .orderBy(sql`SUM(${orderItemsTable.fulfilledQuantity}) DESC`)
      .limit(10),
    db
      .select({
        name: sql<string>`COALESCE(${productsTable.category}, 'Sem categoria')`,
        units: sql<number>`COALESCE(SUM(${orderItemsTable.fulfilledQuantity}), 0)::int`,
        revenue: sql<number>`COALESCE(SUM(${orderItemsTable.fulfilledQuantity} * ${orderItemsTable.priceAtSale}), 0)::float`,
      })
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .innerJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
      .where(and(eq(ordersTable.clientId, clientId), gte(ordersTable.createdAt, from), lte(ordersTable.createdAt, to), paidStatus))
      .groupBy(productsTable.category)
      .orderBy(sql`SUM(${orderItemsTable.fulfilledQuantity} * ${orderItemsTable.priceAtSale}) DESC`)
      .limit(8),
    db
      .select({
        name: orderItemsTable.color,
        units: sql<number>`COALESCE(SUM(${orderItemsTable.fulfilledQuantity}), 0)::int`,
        revenue: sql<number>`COALESCE(SUM(${orderItemsTable.fulfilledQuantity} * ${orderItemsTable.priceAtSale}), 0)::float`,
      })
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .where(and(eq(ordersTable.clientId, clientId), gte(ordersTable.createdAt, from), lte(ordersTable.createdAt, to), paidStatus, sql`${orderItemsTable.color} IS NOT NULL`, sql`${orderItemsTable.color} <> ''`))
      .groupBy(orderItemsTable.color)
      .orderBy(sql`SUM(${orderItemsTable.fulfilledQuantity}) DESC`)
      .limit(8),
    db
      .select({
        name: orderItemsTable.size,
        units: sql<number>`COALESCE(SUM(${orderItemsTable.fulfilledQuantity}), 0)::int`,
        revenue: sql<number>`COALESCE(SUM(${orderItemsTable.fulfilledQuantity} * ${orderItemsTable.priceAtSale}), 0)::float`,
      })
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .where(and(eq(ordersTable.clientId, clientId), gte(ordersTable.createdAt, from), lte(ordersTable.createdAt, to), paidStatus, sql`${orderItemsTable.size} IS NOT NULL`, sql`${orderItemsTable.size} <> ''`))
      .groupBy(orderItemsTable.size)
      .orderBy(sql`SUM(${orderItemsTable.fulfilledQuantity}) DESC`)
      .limit(8),
  ]);

  const campaigns = (metaCurrent?.campaigns ?? [])
    .map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      spend: campaign.spend,
      purchases: campaign.purchases,
      revenue: campaign.revenue,
      roas: campaign.roas ?? (campaign.spend > 0 ? campaign.revenue / campaign.spend : 0),
      cpa: campaign.cpa ?? (campaign.purchases > 0 ? campaign.spend / campaign.purchases : 0),
      clicks: campaign.clicks,
      impressions: campaign.impressions,
    }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 10);
  const products = productRows.map((row) => ({
    name: row.name,
    category: row.category,
    units: Number(row.units) || 0,
    revenue: Number(row.revenue) || 0,
  }));
  const categories = categoryRows.map((row) => ({ name: row.name, units: Number(row.units) || 0, revenue: Number(row.revenue) || 0 }));
  const colors = colorRows.map((row) => ({ name: row.name ?? "Sem cor", units: Number(row.units) || 0, revenue: Number(row.revenue) || 0 }));
  const sizes = sizeRows.map((row) => ({ name: row.name ?? "Sem tamanho", units: Number(row.units) || 0, revenue: Number(row.revenue) || 0 }));

  const analysis = await generateDailyReportText({
    brand: clientConfig.name,
    dateFrom: dateFromOnly,
    dateTo: dateToOnly,
    kpis,
    prevKpis,
    campaigns,
    products,
    categories,
    colors,
    sizes,
  });

  res.json({
    client: { id: clientId, name: clientConfig.name },
    period: { from: dateFromOnly, to: dateToOnly },
    previousPeriod: { from: prevDateFromOnly, to: prevDateToOnly },
    kpis,
    prevKpis,
    changes: {
      approvedRevenue: pctChange(kpis.approvedRevenue, prevKpis.approvedRevenue),
      sales: pctChange(kpis.sales, prevKpis.sales),
      avgTicket: pctChange(kpis.avgTicket, prevKpis.avgTicket),
      costPerPurchase: pctChange(kpis.costPerPurchase, prevKpis.costPerPurchase),
      mediaSpend: pctChange(kpis.mediaSpend, prevKpis.mediaSpend),
      roas: pctChange(kpis.roas, prevKpis.roas),
    },
    campaigns,
    products,
    categories,
    colors,
    sizes,
    analysis,
    generatedAt: new Date().toISOString(),
  });
});

router.get("/analytics/marketing", async (req, res): Promise<void> => {
  const parsed = GetMarketingQueryParams.safeParse(
    coerceDateQuery(req.query as Record<string, unknown>),
  );
  if (!parsed.success) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: parsed.error.message,
      status: 400,
    });
    return;
  }
  const clientId = requireClient(req, res);
  if (!clientId) return;

  const { from, to } = dateRange(parsed.data.dateFrom, parsed.data.dateTo);
  const since = from.toISOString().slice(0, 10);
  const until = to.toISOString().slice(0, 10);
  const creativesPage = (parsed.data as Record<string, unknown>).creativesPage as number | undefined ?? 1;
  const creativesPageSize = (parsed.data as Record<string, unknown>).creativesPageSize as number | undefined ?? 20;
  const utmSrc = (parsed.data as Record<string, unknown>).utmSource as string | undefined;
  const utmMed = (parsed.data as Record<string, unknown>).utmMedium as string | undefined;
  const creativeFilt = (parsed.data as Record<string, unknown>).creative as string | undefined;

  // Prev period of same length
  const periodMs = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - periodMs);
  const prevSince = prevFrom.toISOString().slice(0, 10);
  const prevUntil = prevTo.toISOString().slice(0, 10);

  const [clientConfig] = await db
    .select({
      metaAdsApiKey: clientsTable.metaAdsApiKey,
      metaAdAccountId: clientsTable.metaAdAccountId,
    })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));

  let metaCurrent: MetaMarketingData | null = null;
  let metaPrev: MetaMarketingData | null = null;
  const metaAccessToken = getGlobalMetaAccessToken(clientConfig?.metaAdsApiKey);
  if (metaAccessToken && clientConfig?.metaAdAccountId) {
    try {
      [metaCurrent, metaPrev] = await Promise.all([
        fetchMetaMarketingData({
          accessToken: metaAccessToken,
          adAccountId: clientConfig.metaAdAccountId,
          since,
          until,
        }),
        fetchMetaMarketingData({
          accessToken: metaAccessToken,
          adAccountId: clientConfig.metaAdAccountId,
          since: prevSince,
          until: prevUntil,
        }),
      ]);
      await upsertMetaCreatives(clientId, metaCurrent.ads);
    } catch (err) {
      console.warn("[marketing] Meta insights fetch failed:", err);
      metaCurrent = null;
      metaPrev = null;
    }
  }

  // All creatives for the client; sorted by prorated spend descending
  const rawCreatives = await db
    .select()
    .from(creativesTable)
    .where(eq(creativesTable.clientId, clientId))
    .orderBy(desc(creativesTable.spend));

  // Apply client-side filters: utmSource → platform match, creative → name contains
  const allCreatives = rawCreatives.filter((c) => {
    if (utmSrc && (c.platform ?? "").toLowerCase() !== utmSrc.toLowerCase()) return false;
    if (creativeFilt && !c.name.toLowerCase().includes(creativeFilt.toLowerCase())) return false;
    return true;
  });

  // Only creatives active (overlapping) in the current window
  const creatives = allCreatives.filter((c) => computeSpendOverlapFraction(c, from, to) > 0);
  const metaCampaigns = metaCurrent && metaSourceMatchesFilter(utmSrc)
    ? metaCurrent.campaigns
      .filter((campaign) => !creativeFilt || campaign.name.toLowerCase().includes(creativeFilt.toLowerCase()))
      .sort((a, b) => b.spend - a.spend)
    : null;
  const creativesTotal = metaCampaigns ? metaCampaigns.length : creatives.length;

  // Apply server-side pagination to the creatives slice passed to buildCreativeMetrics
  const offset = (creativesPage - 1) * creativesPageSize;
  const pagedCreatives = creatives.slice(offset, offset + creativesPageSize);
  const pagedMetaCampaigns = metaCampaigns?.slice(offset, offset + creativesPageSize) ?? null;

  const [kpis, prevKpis] = await Promise.all([
    computeMarketingKpis(clientId, creatives, from, to, metaCurrent),
    computeMarketingKpis(clientId, allCreatives.filter((c) => computeSpendOverlapFraction(c, prevFrom, prevTo) > 0), prevFrom, prevTo, metaPrev),
  ]);

  const leadsRows = metaCurrent
    ? metaCurrent.daily.map((point) => ({ date: point.date, value: point.leads }))
    : await db
      .select({
        date: sql<string>`DATE(${eventsTable.createdAt} AT TIME ZONE 'UTC')::text`,
        value: sql<number>`COUNT(*)::int`,
      })
      .from(eventsTable)
      .innerJoin(customersTable, eq(eventsTable.customerId, customersTable.id))
      .where(
        and(
          eq(eventsTable.clientId, clientId),
          gte(eventsTable.createdAt, from),
          lte(eventsTable.createdAt, to),
          sql`${eventsTable.eventType} = 'REGISTRATION'`,
          utmSrc
            ? sql`lower(${customersTable.utmSource}) = lower(${utmSrc})`
            : sql`lower(${customersTable.utmSource}) = ANY(${sql.raw(PAID_SOURCES_ARRAY)})`,
          ...(utmMed ? [sql`lower(${customersTable.utmMedium}) = lower(${utmMed})`] : []),
        ),
      )
      .groupBy(sql`DATE(${eventsTable.createdAt} AT TIME ZONE 'UTC')`)
      .orderBy(sql`DATE(${eventsTable.createdAt} AT TIME ZONE 'UTC')`);

  // Daily series: requested revenue
  const revenueRows = await db
    .select({
      date: sql<string>`DATE(${ordersTable.createdAt} AT TIME ZONE 'UTC')::text`,
      value: sql<number>`COALESCE(SUM(${ordersTable.amount}), 0)::float`,
    })
    .from(ordersTable)
    .innerJoin(customersTable, eq(ordersTable.customerId, customersTable.id))
    .where(
      and(
        eq(ordersTable.clientId, clientId),
        gte(ordersTable.createdAt, from),
        lte(ordersTable.createdAt, to),
      ),
    )
    .groupBy(sql`DATE(${ordersTable.createdAt} AT TIME ZONE 'UTC')`)
    .orderBy(sql`DATE(${ordersTable.createdAt} AT TIME ZONE 'UTC')`);

  const totalProratedSpend = kpis.totalSpend;
  const attrRevForCreatives = kpis.attributedRevenue;

  const [spendOverTime, stateBreakdown] = await Promise.all([
    Promise.resolve(
      metaCurrent
        ? metaCurrent.daily.map((point) => ({ date: point.date, value: point.spend }))
        : buildSpendOverTime(creatives, from, to),
    ),
    buildStateBreakdown(clientId, from, to, totalProratedSpend),
  ]);

  const payload = GetMarketingResponse.parse({
    kpis,
    prevKpis,
    leadsOverTime: leadsRows,
    revenueOverTime: revenueRows,
    spendOverTime,
    topCreatives: metaCurrent?.topCreatives ?? { ctr: [], cpl: [], leads: [] },
    creatives: pagedMetaCampaigns
      ? buildMetaCampaignMetrics(pagedMetaCampaigns)
      : buildCreativeMetrics(pagedCreatives, attrRevForCreatives, totalProratedSpend, from, to),
    platformBreakdown: metaCampaigns
      ? buildMetaPlatformBreakdown(metaCampaigns)
      : buildPlatformBreakdown(creatives, attrRevForCreatives, totalProratedSpend, from, to),
    stateBreakdown,
    ageBreakdown: buildAgeBreakdown(),
    creativesTotal,
  });
  res.json(payload);
});
