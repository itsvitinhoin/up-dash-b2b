import { Router, type IRouter } from "express";
import { and, desc, eq, gte, lte, sql, ilike, or, inArray, type SQL } from "drizzle-orm";
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
} from "@workspace/api-zod";
import { authenticate, requireAdmin, resolveClientId } from "../middlewares/auth";
import { getOpenAIClient, isAIConfigured } from "../lib/openai";

const router: IRouter = Router();

router.use("/analytics", authenticate);

// Orval generates `zod.date()` for date-time format params, but query strings
// arrive as strings. Coerce the relevant query fields before validation.
function coerceDateQuery(query: Record<string, unknown>): Record<string, unknown> {
  const out = { ...query };
  for (const key of ["dateFrom", "dateTo", "date"]) {
    const v = out[key];
    if (typeof v === "string" && v.length > 0) {
      const parsed = new Date(v);
      if (!Number.isNaN(parsed.getTime())) out[key] = parsed;
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
    const clientStats = clients.map((c) => {
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
  const { from, to } = dateRange(parsed.data.dateFrom, parsed.data.dateTo);
  const { category, sellerId, channel, segment, compare } = parsed.data;

  // Pre-resolve filter scopes once. Channel/segment scope (customers) is
  // window-agnostic and can be reused across the current and prior windows.
  // The category scope, however, is window-dependent (we restrict to orders
  // *placed in the window* whose items match the category), so it must be
  // recomputed per window.
  let scopedCustomerIds: string[] | null = null;
  if (channel || segment) {
    const custConds: SQL[] = [eq(customersTable.clientId, clientId)];
    if (channel) custConds.push(eq(customersTable.utmSource, channel));
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
  };

  // The prior window only needs the data the client renders for comparison
  // (kpis + revenue/orders series). `full` skips the lead series, category
  // breakdown, and the (window-agnostic) customer aggregate to avoid extra
  // database work.
  const computeWindow = async (
    winFrom: Date,
    winTo: Date,
    full: boolean,
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

    const [[orderAgg], [requestedRow], [eventAgg]] = await Promise.all([
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
    const visits = Number(eventAgg.visits) || 0;
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
      .where(baseOrderWhere)
      .groupBy(sql`date_trunc('day', ${ordersTable.createdAt})`)
      .orderBy(sql`date_trunc('day', ${ordersTable.createdAt})`);

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
          .where(baseOrderWhere)
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
    };
  };

  const current = await computeWindow(from, to, true);

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
  const { from, to } = dateRange(parsed.data.dateFrom, parsed.data.dateTo);

  const eventCounts = await db
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
      ),
    )
    .groupBy(eventsTable.eventType);

  const counts: Record<string, number> = {};
  for (const row of eventCounts) {
    counts[row.eventType] = Number(row.count);
  }

  const funnelOrder: Array<{ step: string; label: string }> = [
    { step: "VISIT", label: "Site Visits" },
    { step: "REGISTRATION", label: "Registrations" },
    { step: "APPROVED_REGISTRATION", label: "Approved Leads" },
    { step: "ADD_TO_CART", label: "Added to Cart" },
    { step: "PURCHASE", label: "Purchases" },
  ];

  // Enforce monotonic funnel: each step cannot exceed the previous step's count.
  let prev = Number.MAX_SAFE_INTEGER;
  const steps = funnelOrder.map((s, i) => {
    const raw = counts[s.step] ?? 0;
    const count = Math.min(raw, prev);
    let conversionRate = 100;
    if (i > 0) {
      conversionRate = prev > 0 ? (count / prev) * 100 : 0;
    }
    const dropOffRate = i === 0 ? 0 : 100 - conversionRate;
    prev = count;
    return {
      step: s.step,
      label: s.label,
      count,
      conversionRate,
      dropOffRate,
    };
  });

  const first = steps[0]?.count ?? 0;
  const last = steps[steps.length - 1]?.count ?? 0;
  const overallConversion = first > 0 ? (last / first) * 100 : 0;

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
    `Overall funnel conversion is ${overallConversion.toFixed(2)}% from first visit to purchase.`,
  );

  res.json(GetFunnelResponse.parse({ steps, overallConversion, insights }));
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
  const { rfmSegment, state, search, page = 1, limit = 20 } = parsed.data;

  const conditions: SQL[] = [eq(customersTable.clientId, clientId)];
  if (rfmSegment) conditions.push(eq(customersTable.rfmSegment, rfmSegment));
  if (state) conditions.push(eq(customersTable.state, state));
  if (search) {
    const searchCond = or(
      ilike(customersTable.email, `%${search}%`),
      ilike(customersTable.name, `%${search}%`),
    );
    if (searchCond) conditions.push(searchCond);
  }
  const where = and(...conditions);

  const offset = (page - 1) * limit;

  const data = await db
    .select()
    .from(customersTable)
    .where(where)
    .orderBy(desc(customersTable.totalSpent))
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
    .where(eq(customersTable.clientId, clientId))
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
    const [totalRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(customersTable)
      .where(
        and(
          eq(customersTable.clientId, clientId as string),
          gte(customersTable.createdAt, winFrom),
          lte(customersTable.createdAt, winTo),
        ),
      );

    const [approvedRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(customersTable)
      .where(
        and(
          eq(customersTable.clientId, clientId as string),
          eq(customersTable.registrationStatus, "APPROVED"),
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

    const total = totalRow?.count ?? 0;
    const approved = approvedRow?.count ?? 0;

    return {
      totalRegistrations: total,
      approvedRegistrations: approved,
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
  const { from, to } = dateRange(dateFrom as Date | undefined, dateTo as Date | undefined);

  const winLenMs = to.getTime() - from.getTime();
  const prevFrom = new Date(from.getTime() - winLenMs);
  const prevTo = new Date(from.getTime());

  const [kpis, prevKpisRaw, registrationsOverTime, registrationsByState, registrationsBySource] =
    await Promise.all([
      computeSummaryKpis(clientId, from, to),
      compare ? computeSummaryKpis(clientId, prevFrom, prevTo) : null,
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
  const { sort = "revenue", limit = 50, search, sku, category } = parsed.data;

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

  const rows = await db
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
    .orderBy(orderBy)
    .limit(limit);

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

  const enriched = rows.map((r) => ({
    ...r,
    percentSold: (r.totalSold + r.stock) > 0 ? r.totalSold / (r.totalSold + r.stock) : 0,
    level: computeProductLevel(
      r.totalSold,
      r.stock,
      r.restockThreshold,
      recentSoldMap.get(r.id) ?? 0,
      catalogAvgSellThrough,
    ),
    createdAt: r.createdAt.toISOString(),
  }));

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
  const { limit = 20 } = parsed.data;

  const rows = await db
    .select({
      id: sellersTable.id,
      name: sellersTable.name,
      email: sellersTable.email,
      totalOrders: sellersTable.totalOrders,
      totalRevenue: sellersTable.totalRevenue,
    })
    .from(sellersTable)
    .where(eq(sellersTable.clientId, clientId))
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

  const orderWhere = and(
    eq(ordersTable.clientId, clientId),
    gte(ordersTable.createdAt, from),
    lte(ordersTable.createdAt, to),
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
      totalRevenue: sql<number>`COALESCE(SUM(${ordersTable.amount}), 0)::float`,
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

  const productIds = products.map((p) => p.id);

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
  const fetchColorBreakdown = (winFrom: Date, winTo: Date) =>
    db
      .select({
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
      .groupBy(sql`COALESCE(${orderItemsTable.color}, 'Unknown')`)
      .orderBy(sql`SUM(${orderItemsTable.quantity}) DESC`);

  const fetchSizeBreakdown = (winFrom: Date, winTo: Date) =>
    db
      .select({
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
      .groupBy(sql`COALESCE(${orderItemsTable.size}, 'Unknown')`)
      .orderBy(sql`SUM(${orderItemsTable.quantity}) DESC`);

  const [currVelocity, prevVelocity, colorBreakdown, sizeBreakdown] = await Promise.all([
    fetchVelocity(from, to),
    fetchVelocity(prevFrom, prevTo),
    fetchColorBreakdown(from, to),
    fetchSizeBreakdown(from, to),
  ]);

  const currVelMap = new Map<string, number>();
  for (const r of currVelocity) currVelMap.set(r.productId, Number(r.unitsSold) || 0);

  const prevVelMap = new Map<string, number>();
  for (const r of prevVelocity) prevVelMap.set(r.productId, Number(r.unitsSold) || 0);

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
  };

  const allSkus: SkuRow[] = products.map((p) => {
    const unitsSold = currVelMap.get(p.id) ?? 0;
    const { dailyVelocity, coverageDays, risk } = classify(p.stock, p.restockThreshold, unitsSold, periodDays);
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
    };
  });

  // Prev-period classification (using same stock levels, prev velocity)
  const allSkusPrev: SkuRow[] = products.map((p) => {
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
    colorBreakdown: colorBreakdown.map((r) => ({ color: r.color, unitsSold: Number(r.unitsSold) || 0 })),
    sizeBreakdown: sizeBreakdown.map((r) => ({ size: r.size, unitsSold: Number(r.unitsSold) || 0 })),
    skus: pageSkus,
    total,
    page,
    limit,
  }));
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

async function computeMarketingKpis(
  clientId: string,
  creatives: Creative[],
  from: Date,
  to: Date,
) {
  // Prorated spend: only count each creative's spend for the overlap with the query window.
  const totalSpend = creatives.reduce((s, c) => s + c.spend * computeSpendOverlapFraction(c, from, to), 0);

  // Attributed revenue: orders from paid-UTM customers in window
  const [revRow] = await db
    .select({ revenue: sql<number>`COALESCE(SUM(${ordersTable.amount}), 0)::float` })
    .from(ordersTable)
    .innerJoin(customersTable, eq(ordersTable.customerId, customersTable.id))
    .where(
      and(
        eq(ordersTable.clientId, clientId),
        gte(ordersTable.createdAt, from),
        lte(ordersTable.createdAt, to),
        sql`${ordersTable.status} IN ('APPROVED', 'SHIPPED', 'DELIVERED')`,
        sql`lower(${customersTable.utmSource}) = ANY(${sql.raw(PAID_SOURCES_ARRAY)})`,
      ),
    );
  const attributedRevenue = revRow?.revenue ?? 0;

  // Leads: REGISTRATION events from paid-UTM customers in window.
  // approvedLeads: those same registrations where the customer is now APPROVED.
  // This guarantees approvedLeads ≤ totalLeads for a sensible approval rate.
  const [evtRow] = await db
    .select({
      totalLeads: sql<number>`COUNT(*)::int`,
      approvedLeads: sql<number>`COUNT(*) FILTER (WHERE ${customersTable.registrationStatus} = 'APPROVED')::int`,
    })
    .from(eventsTable)
    .innerJoin(customersTable, eq(eventsTable.customerId, customersTable.id))
    .where(
      and(
        eq(eventsTable.clientId, clientId),
        gte(eventsTable.createdAt, from),
        lte(eventsTable.createdAt, to),
        sql`${eventsTable.eventType} = 'REGISTRATION'`,
        sql`lower(${customersTable.utmSource}) = ANY(${sql.raw(PAID_SOURCES_ARRAY)})`,
      ),
    );

  const totalLeads = evtRow?.totalLeads ?? 0;
  const approvedLeads = evtRow?.approvedLeads ?? 0;
  const approvalRate = totalLeads > 0 ? (approvedLeads / totalLeads) * 100 : 0;

  return {
    totalSpend,
    attributedRevenue,
    roas: totalSpend > 0 ? attributedRevenue / totalSpend : 0,
    totalLeads,
    approvedLeads,
    approvalRate,
    cpl: totalLeads > 0 ? totalSpend / totalLeads : 0,
    cpa: approvedLeads > 0 ? totalSpend / approvedLeads : 0,
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
  const creativesPage = (parsed.data as Record<string, unknown>).creativesPage as number | undefined ?? 1;
  const creativesPageSize = (parsed.data as Record<string, unknown>).creativesPageSize as number | undefined ?? 20;

  // Prev period of same length
  const periodMs = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - periodMs);

  // All creatives for the client; sorted by prorated spend descending
  const allCreatives = await db
    .select()
    .from(creativesTable)
    .where(eq(creativesTable.clientId, clientId))
    .orderBy(desc(creativesTable.spend));

  // Only creatives active (overlapping) in the current window
  const creatives = allCreatives.filter((c) => computeSpendOverlapFraction(c, from, to) > 0);
  const creativesTotal = creatives.length;

  // Apply server-side pagination to the creatives slice passed to buildCreativeMetrics
  const offset = (creativesPage - 1) * creativesPageSize;
  const pagedCreatives = creatives.slice(offset, offset + creativesPageSize);

  const [kpis, prevKpis] = await Promise.all([
    computeMarketingKpis(clientId, creatives, from, to),
    computeMarketingKpis(clientId, allCreatives.filter((c) => computeSpendOverlapFraction(c, prevFrom, prevTo) > 0), prevFrom, prevTo),
  ]);

  // Daily series: paid-channel registrations by day
  const leadsRows = await db
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
        sql`lower(${customersTable.utmSource}) = ANY(${sql.raw(PAID_SOURCES_ARRAY)})`,
      ),
    )
    .groupBy(sql`DATE(${eventsTable.createdAt} AT TIME ZONE 'UTC')`)
    .orderBy(sql`DATE(${eventsTable.createdAt} AT TIME ZONE 'UTC')`);

  // Daily series: attributed revenue
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
        sql`${ordersTable.status} IN ('APPROVED', 'SHIPPED', 'DELIVERED')`,
        sql`lower(${customersTable.utmSource}) = ANY(${sql.raw(PAID_SOURCES_ARRAY)})`,
      ),
    )
    .groupBy(sql`DATE(${ordersTable.createdAt} AT TIME ZONE 'UTC')`)
    .orderBy(sql`DATE(${ordersTable.createdAt} AT TIME ZONE 'UTC')`);

  const totalProratedSpend = kpis.totalSpend;
  const attrRevForCreatives = kpis.attributedRevenue;

  const [spendOverTime, stateBreakdown] = await Promise.all([
    Promise.resolve(buildSpendOverTime(creatives, from, to)),
    buildStateBreakdown(clientId, from, to, totalProratedSpend),
  ]);

  const payload = GetMarketingResponse.parse({
    kpis,
    prevKpis,
    leadsOverTime: leadsRows,
    revenueOverTime: revenueRows,
    spendOverTime,
    creatives: buildCreativeMetrics(pagedCreatives, attrRevForCreatives, totalProratedSpend, from, to),
    platformBreakdown: buildPlatformBreakdown(creatives, attrRevForCreatives, totalProratedSpend, from, to),
    stateBreakdown,
    ageBreakdown: buildAgeBreakdown(),
    creativesTotal,
  });
  res.json(payload);
});
