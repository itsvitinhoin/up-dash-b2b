import { Router, type IRouter } from "express";
import { and, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, clientsTable, ordersTable, eventsTable, creativesTable } from "@workspace/db";
import {
  CreateClientBody,
  GetClientParams,
  GetClientResponse,
  ListClientsQueryParams,
  ListClientsResponse,
  RotateClientApiKeyParams,
  UpdateClientBody,
} from "@workspace/api-zod";
import { z } from "zod";
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

const ImportRowSchema = z.object({
  name: z.string().min(1, "name is required"),
  email: z.string().email("invalid email"),
  apiKey: z.string().min(1, "apiKey is required"),
  currency: z.string().optional(),
  locale: z.string().optional(),
});

router.post("/clients/import", requireAdmin, async (req, res): Promise<void> => {
  const bodyParsed = z.array(z.unknown()).min(1).max(500).safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: bodyParsed.error.message,
      status: 400,
    });
    return;
  }

  const adminId = req.user?.sub ?? null;
  const errors: Array<{ index: number; field: string; message: string }> = [];

  // First pass: validate each row and collect the ones that pass.
  const validRows: Array<{
    originalIndex: number;
    name: string;
    email: string;
    apiKey: string;
    currency?: string;
    locale?: string;
    adminId: string | null;
  }> = [];

  for (let i = 0; i < bodyParsed.data.length; i++) {
    const rowParsed = ImportRowSchema.safeParse(bodyParsed.data[i]);
    if (!rowParsed.success) {
      const first = rowParsed.error.errors[0];
      errors.push({
        index: i,
        field: first.path.join(".") || "row",
        message: first.message,
      });
      continue;
    }
    const { currency, locale } = rowParsed.data;
    if (currency !== undefined && !CURRENCY_RE.test(currency)) {
      errors.push({ index: i, field: "currency", message: "must be a 3-letter ISO 4217 code" });
      continue;
    }
    if (locale !== undefined && !LOCALE_RE.test(locale)) {
      errors.push({ index: i, field: "locale", message: "must be a BCP 47 tag" });
      continue;
    }
    validRows.push({ originalIndex: i, ...rowParsed.data, adminId });
  }

  // Second pass: detect conflicts against DB (apiKey, email, name all unique)
  // and within-payload duplicates before any insert so no row causes a 500.
  let created = 0;
  if (validRows.length > 0) {
    const candidateKeys   = validRows.map((r) => r.apiKey);
    const candidateEmails = validRows.map((r) => r.email);
    const candidateNames  = validRows.map((r) => r.name);

    const [existingKeyRows, existingEmailRows, existingNameRows] = await Promise.all([
      db.select({ apiKey: clientsTable.apiKey }).from(clientsTable).where(inArray(clientsTable.apiKey, candidateKeys)),
      db.select({ email: clientsTable.email }).from(clientsTable).where(inArray(clientsTable.email, candidateEmails)),
      db.select({ name: clientsTable.name }).from(clientsTable).where(inArray(clientsTable.name, candidateNames)),
    ]);

    const existingKeys   = new Set(existingKeyRows.map((r) => r.apiKey));
    const existingEmails = new Set(existingEmailRows.map((r) => r.email));
    const existingNames  = new Set(existingNameRows.map((r) => r.name));

    // Track within-payload uniqueness to catch intra-batch duplicates.
    const seenKeys   = new Set<string>();
    const seenEmails = new Set<string>();
    const seenNames  = new Set<string>();

    const insertableRows = validRows.filter((r) => {
      if (existingKeys.has(r.apiKey) || seenKeys.has(r.apiKey)) {
        errors.push({ index: r.originalIndex, field: "apiKey", message: "duplicate — a client with this API key already exists" });
        return false;
      }
      if (existingEmails.has(r.email) || seenEmails.has(r.email)) {
        errors.push({ index: r.originalIndex, field: "email", message: "duplicate — a client with this email already exists" });
        return false;
      }
      if (existingNames.has(r.name) || seenNames.has(r.name)) {
        errors.push({ index: r.originalIndex, field: "name", message: "duplicate — a client with this name already exists" });
        return false;
      }
      seenKeys.add(r.apiKey);
      seenEmails.add(r.email);
      seenNames.add(r.name);
      return true;
    });

    if (insertableRows.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const dbRows = insertableRows.map(({ originalIndex: _i, ...rest }) => rest);
      const inserted = await db.insert(clientsTable).values(dbRows).returning({ id: clientsTable.id });
      created = inserted.length;
    }
  }

  const skipped = bodyParsed.data.length - created;
  res.json({ created, skipped, errors });
});

router.get("/clients/lookup", requireAdmin, async (req, res): Promise<void> => {
  const apiKey = typeof req.query.apiKey === "string" ? req.query.apiKey.trim() : "";
  if (!apiKey) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: "apiKey query parameter is required",
      status: 400,
    });
    return;
  }
  const [row] = await db
    .select({
      id: clientsTable.id,
      name: clientsTable.name,
      email: clientsTable.email,
      currency: clientsTable.currency,
      locale: clientsTable.locale,
    })
    .from(clientsTable)
    .where(eq(clientsTable.apiKey, apiKey));
  if (!row) {
    res.status(404).json({
      error: true,
      code: "NOT_FOUND",
      message: "No client found with that API key",
      status: 404,
    });
    return;
  }
  res.json(row);
});

router.patch("/clients/:clientId/rotate-key", requireAdmin, async (req, res): Promise<void> => {
  const parsed = RotateClientApiKeyParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: parsed.error.message,
      status: 400,
    });
    return;
  }
  const { clientId } = parsed.data;
  const newApiKey = `sk_${nanoid(32)}`;
  const [updated] = await db
    .update(clientsTable)
    .set({ apiKey: newApiKey })
    .where(eq(clientsTable.id, clientId))
    .returning({ id: clientsTable.id });
  if (!updated) {
    res.status(404).json({
      error: true,
      code: "NOT_FOUND",
      message: "Client not found",
      status: 404,
    });
    return;
  }
  res.json({ clientId, apiKey: newApiKey });
});

router.patch("/clients/:clientId", requireAdmin, async (req, res): Promise<void> => {
  const paramParsed = GetClientParams.safeParse(req.params);
  if (!paramParsed.success) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: paramParsed.error.message,
      status: 400,
    });
    return;
  }
  const bodyParsed = UpdateClientBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: bodyParsed.error.message,
      status: 400,
    });
    return;
  }
  const { clientId } = paramParsed.data;
  const updates: Partial<typeof clientsTable.$inferInsert> = {};
  if ("metaAdsApiKey" in bodyParsed.data) {
    updates.metaAdsApiKey = bodyParsed.data.metaAdsApiKey ?? null;
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: "No updatable fields provided",
      status: 400,
    });
    return;
  }
  const [updated] = await db
    .update(clientsTable)
    .set(updates)
    .where(eq(clientsTable.id, clientId))
    .returning();
  if (!updated) {
    res.status(404).json({
      error: true,
      code: "NOT_FOUND",
      message: "Client not found",
      status: 404,
    });
    return;
  }
  res.json(GetClientResponse.parse(updated));
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
