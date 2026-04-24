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
} from "@workspace/api-zod";
import { authenticate, resolveClientId } from "../middlewares/auth";

const router: IRouter = Router();

router.use("/analytics", authenticate);

// Orval generates `zod.date()` for date-time format params, but query strings
// arrive as strings. Coerce the relevant query fields before validation.
function coerceDateQuery(query: Record<string, unknown>): Record<string, unknown> {
  const out = { ...query };
  for (const key of ["dateFrom", "dateTo"]) {
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

  const baseOrderWhere = and(
    eq(ordersTable.clientId, clientId),
    gte(ordersTable.createdAt, from),
    lte(ordersTable.createdAt, to),
  );

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

export default router;
