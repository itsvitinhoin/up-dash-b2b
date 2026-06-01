import { Router, type IRouter } from "express";
import { and, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  db,
  clientsTable,
  ordersTable,
  eventsTable,
  creativesTable,
  syncJobsTable,
  customersTable,
  usersTable,
  clientUserAccessesTable,
} from "@workspace/db";
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
import { syncUpZeroClient } from "../services/upzero-sync";
import { syncNuvemshopClient } from "../services/nuvemshop-sync";
import { fetchMetaAdAccounts, normalizeMetaAdAccountId } from "../services/meta-ads";
import { hashPassword } from "../lib/auth";

const router: IRouter = Router();

router.use("/clients", authenticate);
router.use("/accesses", authenticate);

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

function clientPublicFields<T extends typeof clientsTable.$inferSelect>(client: T) {
  return {
    ...client,
    hasNuvemshopIntegration: Boolean(
      client.nuvemshopStoreId?.trim() && client.nuvemshopAccessToken?.trim(),
    ),
    hasGa4Integration: Boolean(
      client.ga4MeasurementId?.trim() &&
        client.ga4PropertyId?.trim() &&
        client.ga4ApiSecret?.trim(),
    ),
  };
}

// Coerce ISO date-time strings on the query before zod sees them — orval
// generates `z.coerce.date()` for date-time params, but Express delivers
// strings, and we want graceful fallback if either bound is missing.
function coerceClientsQuery(query: Record<string, unknown>): Record<string, unknown> {
  const out = { ...query };
  for (const key of ["dateFrom", "dateTo"]) {
    const v = out[key];
    if (typeof v === "string" && v.length > 0) {
      const parsed = new Date(v);
      if (!Number.isNaN(parsed.getTime())) {
        if (key === "dateTo" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
          parsed.setUTCHours(23, 59, 59, 999);
        }
        out[key] = parsed;
      }
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
  const { search, page = 1, limit = 20, dateFrom, dateTo, dashboardType } = parsed.data;
  const filters: SQL[] = [];
  if (search) filters.push(ilike(clientsTable.name, `%${search}%`));
  if (dashboardType) filters.push(eq(clientsTable.dashboardType, dashboardType));
  const where = filters.length > 0 ? and(...filters) : undefined;

  const offset = (page - 1) * limit;

  const rows = await db
    .select()
    .from(clientsTable)
    .where(where)
    .orderBy(clientsTable.createdAt)
    .limit(limit)
    .offset(offset);

  const accessRows = rows.length > 0
    ? await db
        .select({
          clientId: clientUserAccessesTable.clientId,
          email: usersTable.email,
          firstName: usersTable.firstName,
          lastName: usersTable.lastName,
        })
        .from(clientUserAccessesTable)
        .innerJoin(usersTable, eq(clientUserAccessesTable.userId, usersTable.id))
        .where(inArray(clientUserAccessesTable.clientId, rows.map((r) => r.id)))
    : [];
  const loginByClientId = new Map<string, { email: string; name: string; count: number }>();
  for (const row of accessRows) {
    const current = loginByClientId.get(row.clientId);
    if (current) {
      current.count += 1;
      continue;
    }
    loginByClientId.set(row.clientId, {
      email: row.email,
      name: `${row.firstName} ${row.lastName}`.trim(),
      count: 1,
    });
  }

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

    // Requested revenue/orders per client in the window. The client list uses
    // demand created in the period, so it intentionally does not filter final
    // order status.
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
          ),
        )
        .groupBy(ordersTable.clientId);

    const registrationAgg = db
      .select({
        clientId: customersTable.clientId,
        totalLeads: sql<number>`COUNT(*)::int`,
        approvedLeads: sql<number>`COUNT(*) FILTER (WHERE ${customersTable.registrationStatus} = 'APPROVED')::int`,
      })
      .from(customersTable)
      .where(
        and(
          inArray(customersTable.clientId, ids),
          gte(customersTable.createdAt, dateFrom),
          lte(customersTable.createdAt, dateTo),
        ),
      )
      .groupBy(customersTable.clientId);

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

    const [currRows, prevRows, registrationRows, creativeRows] = await Promise.all([
      orderAgg(dateFrom, dateTo),
      orderAgg(prevFrom, prevTo),
      registrationAgg,
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
    const registrations = new Map<string, { totalLeads: number; approvedLeads: number }>();
    for (const r of registrationRows) {
      registrations.set(r.clientId, {
        totalLeads: Number(r.totalLeads) || 0,
        approvedLeads: Number(r.approvedLeads) || 0,
      });
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
      const regs = registrations.get(r.id) ?? { totalLeads: 0, approvedLeads: 0 };
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
        revenueYtd: c.revenue,
        ordersYtd: c.orders,
        avgOrderValue: c.orders > 0 ? c.revenue / c.orders : 0,
        conversionRate: regs.approvedLeads > 0 ? (c.orders / regs.approvedLeads) * 100 : 0,
        periodGrowthPct: growthPct,
        periodRoas: m && m.adSpend > 0 ? c.revenue / m.adSpend : null,
        periodLeads: regs.totalLeads,
        periodApprovalRate: regs.totalLeads > 0 ? (regs.approvedLeads / regs.totalLeads) * 100 : null,
      };
    });
  }

  const enrichedWithAccess = enriched.map((row) => {
    const login = loginByClientId.get(row.id);
    return {
      ...clientPublicFields(row),
      hasClientLogin: Boolean(login),
      clientLoginEmail: login?.email ?? null,
      clientLoginName: login?.name ?? null,
      clientLoginCount: login?.count ?? 0,
    };
  });

  res.json(
    ListClientsResponse.parse({
      data: enrichedWithAccess,
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
  const dashboardType = parsed.data.dashboardType ?? (
    parsed.data.commercePlatform === "NUVEMSHOP" ? "B2C" : "B2B"
  );
  const commercePlatform = parsed.data.commercePlatform ?? (
    dashboardType === "B2C" ? "NUVEMSHOP" : "UPZERO"
  );
  const values = {
    ...parsed.data,
    dashboardType,
    commercePlatform,
    metaAdAccountId: parsed.data.metaAdAccountId?.trim()
      ? normalizeMetaAdAccountId(parsed.data.metaAdAccountId)
      : undefined,
    nuvemshopStoreId: parsed.data.nuvemshopStoreId?.trim()
      ? parsed.data.nuvemshopStoreId.trim()
      : undefined,
    nuvemshopAccessToken: parsed.data.nuvemshopAccessToken?.trim()
      ? parsed.data.nuvemshopAccessToken.trim()
      : undefined,
    ga4MeasurementId: parsed.data.ga4MeasurementId?.trim()
      ? parsed.data.ga4MeasurementId.trim()
      : undefined,
    ga4PropertyId: parsed.data.ga4PropertyId?.trim()
      ? parsed.data.ga4PropertyId.trim()
      : undefined,
    ga4ApiSecret: parsed.data.ga4ApiSecret?.trim()
      ? parsed.data.ga4ApiSecret.trim()
      : undefined,
    adminId,
  };
  const [created] = await db
    .insert(clientsTable)
    .values(values)
    .returning();
  res.status(201).json(GetClientResponse.parse(clientPublicFields(created)));
});

const ImportRowSchema = z.object({
  name: z.string().min(1, "name is required"),
  email: z.string().email("invalid email"),
  apiKey: z.string().min(1, "apiKey is required"),
  dashboardType: z.enum(["B2B", "B2C"]).optional(),
  commercePlatform: z.enum(["UPZERO", "NUVEMSHOP", "MANUAL"]).optional(),
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
    dashboardType?: "B2B" | "B2C";
    commercePlatform?: "UPZERO" | "NUVEMSHOP" | "MANUAL";
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
    const dashboardType = rowParsed.data.dashboardType ?? (
      rowParsed.data.commercePlatform === "NUVEMSHOP" ? "B2C" : "B2B"
    );
    const commercePlatform = rowParsed.data.commercePlatform ?? (
      dashboardType === "B2C" ? "NUVEMSHOP" : "UPZERO"
    );
    validRows.push({ originalIndex: i, ...rowParsed.data, dashboardType, commercePlatform, adminId });
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

const ClientCredentialsBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
});

const ClientAccessBody = ClientCredentialsBody.extend({
  clientId: z.string().min(1),
});

router.get("/accesses", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: clientUserAccessesTable.id,
      userId: usersTable.id,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      role: usersTable.role,
      clientId: clientsTable.id,
      clientName: clientsTable.name,
      createdAt: clientUserAccessesTable.createdAt,
      updatedAt: clientUserAccessesTable.updatedAt,
    })
    .from(clientUserAccessesTable)
    .innerJoin(usersTable, eq(clientUserAccessesTable.userId, usersTable.id))
    .innerJoin(clientsTable, eq(clientUserAccessesTable.clientId, clientsTable.id));

  res.json({ data: rows });
});

router.post("/accesses", requireAdmin, async (req, res): Promise<void> => {
  const bodyParsed = ClientAccessBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: bodyParsed.error.message,
      status: 400,
    });
    return;
  }

  const [client] = await db
    .select({ id: clientsTable.id, name: clientsTable.name })
    .from(clientsTable)
    .where(eq(clientsTable.id, bodyParsed.data.clientId));
  if (!client) {
    res.status(404).json({
      error: true,
      code: "NOT_FOUND",
      message: "Client not found",
      status: 404,
    });
    return;
  }

  const [emailOwner] = await db
    .select({
      id: usersTable.id,
      role: usersTable.role,
    })
    .from(usersTable)
    .where(eq(usersTable.email, bodyParsed.data.email));

  if (emailOwner?.role === "ADMIN") {
    res.status(409).json({
      error: true,
      code: "EMAIL_ALREADY_IN_USE",
      message: "Admin users cannot be assigned as client accesses",
      status: 409,
    });
    return;
  }

  const passwordHash = await hashPassword(bodyParsed.data.password);
  let userId = emailOwner?.id ?? null;
  if (userId) {
    const existingAccesses = await db
      .select({
        id: clientUserAccessesTable.id,
        clientId: clientUserAccessesTable.clientId,
      })
      .from(clientUserAccessesTable)
      .where(eq(clientUserAccessesTable.userId, userId));
    const sameClientAccess = existingAccesses.find((access) => access.clientId === client.id);
    if (!sameClientAccess && existingAccesses.length > 0) {
      res.status(409).json({
        error: true,
        code: "EMAIL_ALREADY_IN_USE",
        message: "This email already has access to another client",
        status: 409,
      });
      return;
    }

    await db
      .update(usersTable)
      .set({
        email: bodyParsed.data.email,
        passwordHash,
        firstName: bodyParsed.data.firstName,
        lastName: bodyParsed.data.lastName,
        role: "CLIENT",
      })
      .where(eq(usersTable.id, userId));

    if (sameClientAccess) {
      res.json({
        id: sameClientAccess.id,
        userId,
        clientId: client.id,
        email: bodyParsed.data.email,
      });
      return;
    }
  } else {
    const [createdUser] = await db
      .insert(usersTable)
      .values({
        email: bodyParsed.data.email,
        passwordHash,
        firstName: bodyParsed.data.firstName,
        lastName: bodyParsed.data.lastName,
        role: "CLIENT",
      })
      .returning({ id: usersTable.id });
    userId = createdUser.id;
  }

  const [access] = await db
    .insert(clientUserAccessesTable)
    .values({
      id: nanoid(),
      userId,
      clientId: client.id,
    })
    .returning({ id: clientUserAccessesTable.id });

  res.json({
    id: access.id,
    userId,
    clientId: client.id,
    email: bodyParsed.data.email,
  });
});

router.delete("/accesses/:accessId", requireAdmin, async (req, res): Promise<void> => {
  const accessId = z.string().min(1).safeParse(req.params.accessId);
  if (!accessId.success) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: accessId.error.message,
      status: 400,
    });
    return;
  }

  const [deleted] = await db
    .delete(clientUserAccessesTable)
    .where(eq(clientUserAccessesTable.id, accessId.data))
    .returning({ id: clientUserAccessesTable.id });
  if (!deleted) {
    res.status(404).json({
      error: true,
      code: "NOT_FOUND",
      message: "Access not found",
      status: 404,
    });
    return;
  }
  res.json({ id: deleted.id });
});

router.post("/clients/:clientId/credentials", requireAdmin, async (req, res): Promise<void> => {
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
  const bodyParsed = ClientCredentialsBody.safeParse(req.body);
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
  const [client] = await db
    .select({ id: clientsTable.id, userId: clientsTable.userId })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));
  if (!client) {
    res.status(404).json({
      error: true,
      code: "NOT_FOUND",
      message: "Client not found",
      status: 404,
    });
    return;
  }

  const [emailOwner] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, bodyParsed.data.email));
  if (emailOwner && emailOwner.id !== client.userId) {
    res.status(409).json({
      error: true,
      code: "EMAIL_ALREADY_IN_USE",
      message: "A user with this email already exists",
      status: 409,
    });
    return;
  }

  const passwordHash = await hashPassword(bodyParsed.data.password);
  let userId = client.userId;
  if (userId) {
    const [updatedUser] = await db
      .update(usersTable)
      .set({
        email: bodyParsed.data.email,
        passwordHash,
        firstName: bodyParsed.data.firstName,
        lastName: bodyParsed.data.lastName,
        role: "CLIENT",
      })
      .where(eq(usersTable.id, userId))
      .returning({ id: usersTable.id, email: usersTable.email });
    userId = updatedUser?.id ?? null;
  }

  if (!userId) {
    const [createdUser] = await db
      .insert(usersTable)
      .values({
        email: bodyParsed.data.email,
        passwordHash,
        firstName: bodyParsed.data.firstName,
        lastName: bodyParsed.data.lastName,
        role: "CLIENT",
      })
      .returning({ id: usersTable.id, email: usersTable.email });
    userId = createdUser.id;
    await db.update(clientsTable).set({ userId }).where(eq(clientsTable.id, clientId));
  }

  const [existingAccess] = await db
    .select({ id: clientUserAccessesTable.id })
    .from(clientUserAccessesTable)
    .where(and(
      eq(clientUserAccessesTable.userId, userId),
      eq(clientUserAccessesTable.clientId, clientId),
    ));
  if (!existingAccess) {
    await db.insert(clientUserAccessesTable).values({
      id: nanoid(),
      userId,
      clientId,
    });
  }

  res.json({
    clientId,
    userId,
    email: bodyParsed.data.email,
  });
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
  if ("metaAdAccountId" in bodyParsed.data) {
    const accountId = bodyParsed.data.metaAdAccountId?.trim();
    updates.metaAdAccountId = accountId ? normalizeMetaAdAccountId(accountId) : null;
  }
  if ("upZeroApiKey" in bodyParsed.data) {
    updates.upZeroApiKey = bodyParsed.data.upZeroApiKey ?? null;
  }
  if ("dashboardType" in bodyParsed.data) {
    updates.dashboardType = bodyParsed.data.dashboardType;
    if (!("commercePlatform" in bodyParsed.data)) {
      updates.commercePlatform =
        bodyParsed.data.dashboardType === "B2C" ? "NUVEMSHOP" : "UPZERO";
    }
  }
  if ("commercePlatform" in bodyParsed.data) {
    updates.commercePlatform = bodyParsed.data.commercePlatform;
  }
  if ("nuvemshopStoreId" in bodyParsed.data) {
    const storeId = bodyParsed.data.nuvemshopStoreId?.trim();
    updates.nuvemshopStoreId = storeId || null;
  }
  if ("nuvemshopAccessToken" in bodyParsed.data) {
    const token = bodyParsed.data.nuvemshopAccessToken?.trim();
    updates.nuvemshopAccessToken = token || null;
  }
  if ("ga4MeasurementId" in bodyParsed.data) {
    const measurementId = bodyParsed.data.ga4MeasurementId?.trim();
    updates.ga4MeasurementId = measurementId || null;
  }
  if ("ga4PropertyId" in bodyParsed.data) {
    const propertyId = bodyParsed.data.ga4PropertyId?.trim();
    updates.ga4PropertyId = propertyId || null;
  }
  if ("ga4ApiSecret" in bodyParsed.data) {
    const apiSecret = bodyParsed.data.ga4ApiSecret?.trim();
    updates.ga4ApiSecret = apiSecret || null;
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
  res.json(GetClientResponse.parse(clientPublicFields(updated)));
});

router.post("/clients/:clientId/meta/ad-accounts", requireAdmin, async (req, res): Promise<void> => {
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
  const [client] = await db
    .select({ metaAdsApiKey: clientsTable.metaAdsApiKey })
    .from(clientsTable)
    .where(eq(clientsTable.id, paramParsed.data.clientId));
  if (!client) {
    res.status(404).json({
      error: true,
      code: "NOT_FOUND",
      message: "Client not found",
      status: 404,
    });
    return;
  }
  const token = getGlobalMetaAccessToken(client.metaAdsApiKey);
  if (!token) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: "Global Meta Ads API key is required to detect ad accounts",
      status: 400,
    });
    return;
  }

  try {
    const accounts = await fetchMetaAdAccounts(token);
    res.json({ accounts });
  } catch (err) {
    res.status(502).json({
      error: true,
      code: "META_AD_ACCOUNTS_FAILED",
      message: String(err),
      status: 502,
    });
  }
});

router.post("/clients/:clientId/sync/upzero", requireAdmin, async (req, res): Promise<void> => {
  const parsed = GetClientParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }
  const { clientId } = parsed.data;
  const [client] = await db.select({ upZeroApiKey: clientsTable.upZeroApiKey }).from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!client) {
    res.status(404).json({ error: true, code: "NOT_FOUND", message: "Client not found", status: 404 });
    return;
  }
  if (!client.upZeroApiKey) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: "No UP Zero API key configured for this client", status: 400 });
    return;
  }

  // Only treat a job as "active" if it was created within the last 15 minutes.
  // Jobs older than that are assumed to have hung (e.g., server restarted while
  // the sync was in progress but startup cleanup hadn't run yet), so we mark
  // them failed and proceed to start a fresh sync.
  const STALE_THRESHOLD_MS = 15 * 60 * 1000;
  const staleAfter = new Date(Date.now() - STALE_THRESHOLD_MS);

  const activeJobs = await db
    .select({ id: syncJobsTable.id, createdAt: syncJobsTable.createdAt })
    .from(syncJobsTable)
    .where(and(
      eq(syncJobsTable.clientId, clientId),
      eq(syncJobsTable.jobType, "upzero_transactional"),
      inArray(syncJobsTable.status, ["pending", "running"]),
    ));

  const freshJob = activeJobs.find((j) => j.createdAt > staleAfter);
  const staleJobs = activeJobs.filter((j) => j.createdAt <= staleAfter);

  // Expire any stale jobs so they don't block future syncs
  if (staleJobs.length > 0) {
    await db
      .update(syncJobsTable)
      .set({ status: "failed", error: "Sync job timed out — exceeded 15 minute limit without completing." })
      .where(inArray(syncJobsTable.id, staleJobs.map((j) => j.id)));
  }

  if (freshJob) {
    res.status(202).json({ jobId: freshJob.id });
    return;
  }

  const [job] = await db
    .insert(syncJobsTable)
    .values({
      clientId,
      jobType: "upzero_transactional",
      trigger: "manual",
      scope: "client",
      status: "pending",
    })
    .returning({ id: syncJobsTable.id });

  const jobId = job.id;
  const apiKey = client.upZeroApiKey;

  try {
    await db.update(syncJobsTable).set({ status: "running", startedAt: new Date() }).where(eq(syncJobsTable.id, jobId));
    const result = await syncUpZeroClient(clientId, apiKey);
    await db.update(syncJobsTable).set({ status: "done", result, finishedAt: new Date() }).where(eq(syncJobsTable.id, jobId));
    res.status(200).json({ jobId, result });
  } catch (err) {
    const message = String(err);
    try {
      await db.update(syncJobsTable).set({ status: "failed", error: message, finishedAt: new Date() }).where(eq(syncJobsTable.id, jobId));
    } catch (dbErr) {
      console.error("[sync-runner] failed to mark job %s as failed:", jobId, dbErr);
    }
    res.status(500).json({
      error: true,
      code: "SYNC_FAILED",
      message,
      status: 500,
      jobId,
    });
  }
});

router.post("/clients/:clientId/sync/nuvemshop", requireAdmin, async (req, res): Promise<void> => {
  const parsed = GetClientParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }
  const { clientId } = parsed.data;
  const [client] = await db
    .select({
      dashboardType: clientsTable.dashboardType,
      storeId: clientsTable.nuvemshopStoreId,
      accessToken: clientsTable.nuvemshopAccessToken,
    })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));
  if (!client) {
    res.status(404).json({ error: true, code: "NOT_FOUND", message: "Client not found", status: 404 });
    return;
  }
  if (client.dashboardType !== "B2C") {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: "Nuvemshop sync is only available for B2C clients", status: 400 });
    return;
  }
  if (!client.storeId || !client.accessToken) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: "Nuvemshop store ID and access token are required for this client", status: 400 });
    return;
  }

  const STALE_THRESHOLD_MS = 15 * 60 * 1000;
  const staleAfter = new Date(Date.now() - STALE_THRESHOLD_MS);
  const activeJobs = await db
    .select({ id: syncJobsTable.id, createdAt: syncJobsTable.createdAt })
    .from(syncJobsTable)
    .where(and(
      eq(syncJobsTable.clientId, clientId),
      eq(syncJobsTable.jobType, "nuvemshop_transactional"),
      inArray(syncJobsTable.status, ["pending", "running"]),
    ));

  const freshJob = activeJobs.find((j) => j.createdAt > staleAfter);
  const staleJobs = activeJobs.filter((j) => j.createdAt <= staleAfter);
  if (staleJobs.length > 0) {
    await db
      .update(syncJobsTable)
      .set({ status: "failed", error: "Sync job timed out — exceeded 15 minute limit without completing." })
      .where(inArray(syncJobsTable.id, staleJobs.map((j) => j.id)));
  }
  if (freshJob) {
    res.status(202).json({ jobId: freshJob.id });
    return;
  }

  const [job] = await db
    .insert(syncJobsTable)
    .values({
      clientId,
      jobType: "nuvemshop_transactional",
      trigger: "manual",
      scope: "client",
      status: "pending",
    })
    .returning({ id: syncJobsTable.id });

  const jobId = job.id;
  try {
    await db.update(syncJobsTable).set({ status: "running", startedAt: new Date() }).where(eq(syncJobsTable.id, jobId));
    const result = await syncNuvemshopClient({
      clientId,
      storeId: client.storeId,
      accessToken: client.accessToken,
    });
    await db.update(syncJobsTable).set({ status: "done", result, finishedAt: new Date() }).where(eq(syncJobsTable.id, jobId));
    res.status(200).json({ jobId, result });
  } catch (err) {
    const message = String(err);
    try {
      await db.update(syncJobsTable).set({ status: "failed", error: message, finishedAt: new Date() }).where(eq(syncJobsTable.id, jobId));
    } catch (dbErr) {
      console.error("[nuvemshop-sync] failed to mark job %s as failed:", jobId, dbErr);
    }
    res.status(500).json({
      error: true,
      code: "SYNC_FAILED",
      message,
      status: 500,
      jobId,
    });
  }
});

/**
 * GET /clients/:clientId/sync/upzero/probe
 * Admin-only debug endpoint. Fetches the raw first page from each UP Zero
 * endpoint (orders, customers, products) and returns the response shape so
 * field-name mismatches can be spotted without triggering a full sync.
 */
router.get("/clients/:clientId/sync/upzero/probe", requireAdmin, async (req, res): Promise<void> => {
  const parsed = GetClientParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }
  const { clientId } = parsed.data;
  const [client] = await db.select({ upZeroApiKey: clientsTable.upZeroApiKey }).from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!client) {
    res.status(404).json({ error: true, code: "NOT_FOUND", message: "Client not found", status: 404 });
    return;
  }
  if (!client.upZeroApiKey) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: "No UP Zero API key configured for this client", status: 400 });
    return;
  }

  const UPZERO_BASE = "https://api.upzero.com.br";
  const headers = { "X-API-Key": client.upZeroApiKey };

  async function probeEndpoint(path: string, extraParams: Record<string, string> = {}) {
    const params = new URLSearchParams({ limit: "1", page: "1", ...extraParams });
    const url = `${UPZERO_BASE}${path}?${params}`;
    try {
      const r = await fetch(url, { headers });
      const status = r.status;
      const raw = await r.json() as Record<string, unknown>;
      const topLevelKeys = Object.keys(raw);
      // Summarise each top-level field: show type + length for arrays
      const shape: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (Array.isArray(v)) shape[k] = `Array(${v.length})`;
        else if (v !== null && typeof v === "object") shape[k] = `Object(${Object.keys(v as object).join(", ")})`;
        else shape[k] = `${typeof v}: ${JSON.stringify(v)}`;
      }
      return { path, httpStatus: status, topLevelKeys, shape };
    } catch (err) {
      return { path, error: String(err) };
    }
  }

  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - 7);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const [orders, customers, products] = await Promise.all([
    probeEndpoint("/external/v1/orders", { start_date: fmt(start), end_date: fmt(now) }),
    probeEndpoint("/external/v1/customers"),
    probeEndpoint("/external/v1/products"),
  ]);

  res.json({ orders, customers, products });
});

router.get("/clients/:clientId/sync/upzero/:jobId", requireAdmin, async (req, res): Promise<void> => {
  const paramParsed = z.object({ clientId: z.string(), jobId: z.string() }).safeParse(req.params);
  if (!paramParsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: paramParsed.error.message, status: 400 });
    return;
  }
  const { clientId, jobId } = paramParsed.data;

  const [job] = await db
    .select()
    .from(syncJobsTable)
    .where(and(eq(syncJobsTable.id, jobId), eq(syncJobsTable.clientId, clientId)));

  if (!job) {
    res.status(404).json({ error: true, code: "NOT_FOUND", message: "Sync job not found", status: 404 });
    return;
  }

  res.json({
    jobId: job.id,
    status: job.status,
    result: job.result ?? null,
    error: job.error ?? null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
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
  res.json(GetClientResponse.parse(clientPublicFields(row)));
});

export default router;
