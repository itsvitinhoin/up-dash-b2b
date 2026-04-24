import { Router, type IRouter } from "express";
import { and, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { db, clientsTable, ordersTable, eventsTable, creativesTable } from "@workspace/db";
import {
  CreateClientBody,
  GetClientParams,
  GetClientResponse,
  ListClientsQueryParams,
  ListClientsResponse,
} from "@workspace/api-zod";
import { authenticate, requireAdmin } from "../middlewares/auth";

const router: IRouter = Router();

router.use("/clients", authenticate);

// Coerce ISO date-time strings on the query before zod sees them — orval
// generates `z.coerce.date()` for date-time params, but Express delivers
// strings, and we want graceful fallback if either bound is missing.
function coerceClientsQuery(query: Record<string, unknown>): Record<string, unknown> {
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

router.get("/clients", requireAdmin, async (req, res): Promise<void> => {
  const parsed = ListClientsQueryParams.safeParse(
    coerceClientsQuery(req.query as Record<string, unknown>),
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
  const { search, page = 1, limit = 20, dateFrom, dateTo } = parsed.data;
  const where = search
    ? ilike(clientsTable.name, `%${search}%`)
    : undefined;

  const offset = (page - 1) * limit;

  const rows = await db
    .select()
    .from(clientsTable)
    .where(where)
    .orderBy(clientsTable.createdAt)
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(clientsTable)
    .where(where);

  // Window-scoped enrichment. We only run the extra aggregations when both
  // bounds are provided — otherwise the legacy YTD shape is enough.
  let enriched = rows as Array<(typeof rows)[number] & {
    avgOrderValue?: number;
    conversionRate?: number;
    periodGrowthPct?: number | null;
    periodRoas?: number | null;
    periodLeads?: number | null;
    periodApprovalRate?: number | null;
  }>;
  if (dateFrom && dateTo && rows.length > 0) {
    const ids = rows.map((r) => r.id);
    const lengthMs = dateTo.getTime() - dateFrom.getTime();
    const prevTo = new Date(dateFrom.getTime() - 1);
    const prevFrom = new Date(prevTo.getTime() - lengthMs);

    // Revenue/orders per client in the window. Same status filter the
    // dashboard uses so AOV matches "real" revenue.
    const orderAgg = (winFrom: Date, winTo: Date) =>
      db
        .select({
          clientId: ordersTable.clientId,
          revenue: sql<number>`COALESCE(SUM(${ordersTable.amount}), 0)::float`,
          orders: sql<number>`COUNT(*)::int`,
        })
        .from(ordersTable)
        .where(
          and(
            inArray(ordersTable.clientId, ids),
            gte(ordersTable.createdAt, winFrom),
            lte(ordersTable.createdAt, winTo),
            sql`${ordersTable.status} IN ('APPROVED', 'SHIPPED', 'DELIVERED')`,
          ),
        )
        .groupBy(ordersTable.clientId);

    // Visits + purchases per client for visit-to-purchase conversion. We
    // intentionally use VISIT events from `events_table` rather than orders
    // counted vs visits, mirroring the per-brand dashboard's definition.
    const visitAgg = db
      .select({
        clientId: eventsTable.clientId,
        visits: sql<number>`COUNT(*) FILTER (WHERE ${eventsTable.eventType} = 'VISIT')::int`,
      })
      .from(eventsTable)
      .where(
        and(
          inArray(eventsTable.clientId, ids),
          gte(eventsTable.createdAt, dateFrom),
          lte(eventsTable.createdAt, dateTo),
        ),
      )
      .groupBy(eventsTable.clientId);

    // Prorated creative spend/leads per client for the window.
    const creativesQuery = db
      .select({
        clientId: creativesTable.clientId,
        spend: creativesTable.spend,
        leads: creativesTable.leads,
        approvedLeads: creativesTable.approvedLeads,
        activeFrom: creativesTable.activeFrom,
        activeTo: creativesTable.activeTo,
      })
      .from(creativesTable)
      .where(
        and(
          inArray(creativesTable.clientId, ids),
          or(
            sql`${creativesTable.activeFrom} IS NULL`,
            sql`${creativesTable.activeFrom} <= ${dateTo.toISOString().slice(0, 10)}`,
          ),
          or(
            sql`${creativesTable.activeTo} IS NULL`,
            sql`${creativesTable.activeTo} >= ${dateFrom.toISOString().slice(0, 10)}`,
          ),
        ),
      );

    const [currRows, prevRows, visitRows, creativeRows] = await Promise.all([
      orderAgg(dateFrom, dateTo),
      orderAgg(prevFrom, prevTo),
      visitAgg,
      creativesQuery,
    ]);

    const curr = new Map<string, { revenue: number; orders: number }>();
    for (const r of currRows) {
      curr.set(r.clientId, {
        revenue: Number(r.revenue) || 0,
        orders: Number(r.orders) || 0,
      });
    }
    const prev = new Map<string, { revenue: number; orders: number }>();
    for (const r of prevRows) {
      prev.set(r.clientId, {
        revenue: Number(r.revenue) || 0,
        orders: Number(r.orders) || 0,
      });
    }
    const visits = new Map<string, number>();
    for (const r of visitRows) {
      visits.set(r.clientId, Number(r.visits) || 0);
    }

    // Aggregate prorated creative metrics per client.
    type MktMetrics = { adSpend: number; totalLeads: number; approvedLeads: number };
    const mkt = new Map<string, MktMetrics>();
    for (const c of creativeRows) {
      let frac = 1;
      if (c.activeFrom && c.activeTo) {
        const cFrom = new Date(c.activeFrom as string);
        const cTo = new Date(c.activeTo as string);
        const campaignMs = Math.max(1, cTo.getTime() - cFrom.getTime());
        const overlapMs = Math.max(
          0,
          Math.min(dateTo.getTime(), cTo.getTime()) - Math.max(dateFrom.getTime(), cFrom.getTime()),
        );
        frac = overlapMs / campaignMs;
      }
      const existing = mkt.get(c.clientId) ?? { adSpend: 0, totalLeads: 0, approvedLeads: 0 };
      mkt.set(c.clientId, {
        adSpend: existing.adSpend + c.spend * frac,
        totalLeads: existing.totalLeads + Math.round(c.leads * frac),
        approvedLeads: existing.approvedLeads + Math.round(c.approvedLeads * frac),
      });
    }

    enriched = rows.map((r) => {
      const c = curr.get(r.id) ?? { revenue: 0, orders: 0 };
      const p = prev.get(r.id) ?? { revenue: 0, orders: 0 };
      const v = visits.get(r.id) ?? 0;
      const m = mkt.get(r.id) ?? null;
      let growthPct: number | null;
      if (p.revenue > 0) {
        growthPct = ((c.revenue - p.revenue) / p.revenue) * 100;
      } else if (c.revenue > 0) {
        growthPct = 100;
      } else {
        growthPct = null;
      }
      return {
        ...r,
        avgOrderValue: c.orders > 0 ? c.revenue / c.orders : 0,
        // Clamp to 0–100 — visits can lag behind orders for back-dated
        // imports, which would otherwise render >100% conversions.
        conversionRate: v > 0 ? Math.min(100, (c.orders / v) * 100) : 0,
        periodGrowthPct: growthPct,
        periodRoas: m && m.adSpend > 0 ? c.revenue / m.adSpend : null,
        periodLeads: m ? m.totalLeads : null,
        periodApprovalRate: m && m.totalLeads > 0 ? (m.approvedLeads / m.totalLeads) * 100 : null,
      };
    });
  }

  res.json(
    ListClientsResponse.parse({
      data: enriched,
      total: count,
      page,
      pages: Math.max(1, Math.ceil(count / limit)),
    }),
  );
});

const CURRENCY_RE = /^[A-Z]{3}$/;
const LOCALE_RE = /^[a-zA-Z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

router.post("/clients", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: parsed.error.message,
      status: 400,
    });
    return;
  }
  const { currency, locale } = parsed.data;
  if (currency !== undefined && !CURRENCY_RE.test(currency)) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: "currency must be a 3-letter ISO 4217 code",
      status: 400,
    });
    return;
  }
  if (locale !== undefined && !LOCALE_RE.test(locale)) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: "locale must be a BCP 47 tag",
      status: 400,
    });
    return;
  }
  const adminId = req.user?.sub ?? null;
  const [created] = await db
    .insert(clientsTable)
    .values({ ...parsed.data, adminId })
    .returning();
  res.status(201).json(GetClientResponse.parse(created));
});

router.get("/clients/:clientId", async (req, res): Promise<void> => {
  const parsed = GetClientParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: parsed.error.message,
      status: 400,
    });
    return;
  }
  // Admins can read any client; CLIENT users can only read their own.
  if (
    req.user?.role !== "ADMIN" &&
    req.user?.clientId !== parsed.data.clientId
  ) {
    res.status(403).json({
      error: true,
      code: "FORBIDDEN",
      message: "You do not have access to this client",
      status: 403,
    });
    return;
  }
  const [row] = await db
    .select()
    .from(clientsTable)
    .where(and(eq(clientsTable.id, parsed.data.clientId)));
  if (!row) {
    res.status(404).json({
      error: true,
      code: "NOT_FOUND",
      message: "Client not found",
      status: 404,
    });
    return;
  }
  res.json(GetClientResponse.parse(row));
});

export default router;
