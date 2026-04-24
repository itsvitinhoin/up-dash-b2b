import { Router, type IRouter } from "express";
import { and, desc, eq, gte, lte, sql, ilike, or, type SQL } from "drizzle-orm";
import {
  db,
  ordersTable,
  customersTable,
  productsTable,
  sellersTable,
  eventsTable,
  orderItemsTable,
  clientsTable,
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
} from "@workspace/api-zod";
import { authenticate, resolveClientId } from "../middlewares/auth";
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
  const { category, sellerId } = parsed.data;

  // For category filtering we need to constrain to orders that contain a line
  // item in that category. We pre-resolve the matching order ids once so each
  // aggregation can re-use the same scope without rejoining order_items.
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
          gte(ordersTable.createdAt, from),
          lte(ordersTable.createdAt, to),
          eq(productsTable.category, category),
        ),
      );
    categoryOrderIds = rows.map((r) => r.id);
  }

  const orderConds: SQL[] = [
    eq(ordersTable.clientId, clientId),
    gte(ordersTable.createdAt, from),
    lte(ordersTable.createdAt, to),
  ];
  if (sellerId) orderConds.push(eq(ordersTable.sellerId, sellerId));
  if (categoryOrderIds !== null) {
    if (categoryOrderIds.length === 0) {
      // Nothing in scope — short circuit with empty payload.
      res.json(
        GetDashboardResponse.parse({
          kpis: {
            revenue: 0,
            orders: 0,
            avgTicket: 0,
            conversionRate: 0,
            approvalRate: 0,
            leads: 0,
            approvedLeads: 0,
            customers: 0,
            repeatCustomers: 0,
          },
          revenueOverTime: [],
          ordersOverTime: [],
          leadsOverTime: [],
          revenueByCategory: [],
        }),
      );
      return;
    }
    orderConds.push(
      sql`${ordersTable.id} IN (${sql.join(
        categoryOrderIds.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );
  }
  const baseOrderWhere = and(...orderConds);

  const [orderAgg] = await db
    .select({
      revenue: sql<number>`COALESCE(SUM(${ordersTable.amount}), 0)::float`,
      orders: sql<number>`COUNT(*)::int`,
    })
    .from(ordersTable)
    .where(
      and(
        baseOrderWhere,
        sql`${ordersTable.status} IN ('APPROVED', 'SHIPPED', 'DELIVERED')`,
      ),
    );

  const [eventAgg] = await db
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
        gte(eventsTable.createdAt, from),
        lte(eventsTable.createdAt, to),
      ),
    );

  const [customerAgg] = await db
    .select({
      total: sql<number>`COUNT(*)::int`,
      repeat: sql<number>`COUNT(*) FILTER (WHERE ${customersTable.totalOrders} > 1)::int`,
    })
    .from(customersTable)
    .where(eq(customersTable.clientId, clientId));

  const revenue = Number(orderAgg.revenue) || 0;
  const orders = Number(orderAgg.orders) || 0;
  const visits = Number(eventAgg.visits) || 0;
  const registrations = Number(eventAgg.registrations) || 0;
  const approvals = Number(eventAgg.approvals) || 0;

  const clamp = (n: number): number => Math.min(100, Math.max(0, n));
  const kpis = {
    revenue,
    orders,
    avgTicket: orders > 0 ? revenue / orders : 0,
    conversionRate: visits > 0 ? clamp((orders / visits) * 100) : 0,
    approvalRate: registrations > 0 ? clamp((approvals / registrations) * 100) : 0,
    leads: registrations,
    approvedLeads: approvals,
    customers: Number(customerAgg.total) || 0,
    repeatCustomers: Number(customerAgg.repeat) || 0,
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

  const dailyLeads = await db
    .select({
      date: sql<string>`to_char(date_trunc('day', ${eventsTable.createdAt}), 'YYYY-MM-DD')`,
      value: sql<number>`COUNT(*)::float`,
    })
    .from(eventsTable)
    .where(
      and(
        eq(eventsTable.clientId, clientId),
        eq(eventsTable.eventType, "REGISTRATION"),
        gte(eventsTable.createdAt, from),
        lte(eventsTable.createdAt, to),
      ),
    )
    .groupBy(sql`date_trunc('day', ${eventsTable.createdAt})`)
    .orderBy(sql`date_trunc('day', ${eventsTable.createdAt})`);

  const revenueByCategory = await db
    .select({
      category: sql<string>`COALESCE(${productsTable.category}, 'Uncategorized')`,
      revenue: sql<number>`COALESCE(SUM(${orderItemsTable.priceAtSale} * ${orderItemsTable.quantity}), 0)::float`,
      orders: sql<number>`COUNT(DISTINCT ${ordersTable.id})::int`,
    })
    .from(orderItemsTable)
    .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
    .innerJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
    .where(baseOrderWhere)
    .groupBy(productsTable.category);

  res.json(
    GetDashboardResponse.parse({
      kpis,
      revenueOverTime: dailyRevenue,
      ordersOverTime: dailyOrders,
      leadsOverTime: dailyLeads,
      revenueByCategory,
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
      data,
      total: count,
      page,
      pages: Math.max(1, Math.ceil(count / limit)),
      segmentCounts,
    }),
  );
});

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
  const { sort = "revenue", limit = 50 } = parsed.data;

  const orderBy =
    sort === "units"
      ? desc(productsTable.totalSold)
      : sort === "created"
        ? desc(productsTable.createdAt)
        : desc(productsTable.totalRevenue);

  const rows = await db
    .select({
      id: productsTable.id,
      sku: productsTable.sku,
      name: productsTable.name,
      category: productsTable.category,
      price: productsTable.price,
      stock: productsTable.stock,
      totalSold: productsTable.totalSold,
      totalRevenue: productsTable.totalRevenue,
      status: productsTable.status,
    })
    .from(productsTable)
    .where(eq(productsTable.clientId, clientId))
    .orderBy(orderBy)
    .limit(limit);

  res.json(GetProductsResponse.parse(rows));
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

async function generateInsight(
  clientId: string,
  from: Date,
  to: Date,
  forceRefresh: boolean,
): Promise<{ headline: string; body: string; bullets: string[]; generatedAt: string; cached: boolean; source: "ai" | "heuristic" }> {
  const cacheKey = `${clientId}|${from.toISOString().slice(0, 10)}|${to.toISOString().slice(0, 10)}`;
  if (!forceRefresh) {
    const cached = insightCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.payload, cached: true };
    }
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

  const insight = await generateInsight(clientId, from, to, false);
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

  const insight = await generateInsight(clientId, from, to, true);
  res.json(GetInsightResponse.parse(insight));
});

export default router;
