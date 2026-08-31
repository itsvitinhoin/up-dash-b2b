import type { Request, Response } from "express";
import { z } from "zod";
import {
  coerceDateQuery,
  dateRange,
  queryDateOnly,
  requireClient,
} from "../lib/httpQuery";
import { cached } from "../lib/queryCache";
import {
  resolveErpDataset,
  fetchErpDashboard,
  fetchErpOrdersPage,
  fetchErpCustomersPage,
  fetchErpProductsPage,
} from "../services/erpAnalytics";
import { fetchPerformanceDashboard } from "../services/performanceAnalytics";

const ERP_CACHE_TTL_MS = 5 * 60 * 1000;

async function requireErpDataset(
  req: Request,
  res: Response,
): Promise<{ clientId: string; dataset: string } | null> {
  const clientId = requireClient(req, res);
  if (!clientId) return null;
  const dataset = await resolveErpDataset(clientId);
  if (!dataset) {
    res
      .status(404)
      .json({
        error: true,
        code: "NO_ERP_INTEGRATION",
        message: "Client não tem integração de ERP configurada.",
        status: 404,
      });
    return null;
  }
  return { clientId, dataset };
}

export async function getDashboard(req: Request, res: Response): Promise<void> {
  const ctx = await requireErpDataset(req, res);
  if (!ctx) return;

  const rawQuery = req.query as Record<string, unknown>;
  const parsed = z
    .object({ dateFrom: z.date().optional(), dateTo: z.date().optional() })
    .safeParse(coerceDateQuery(rawQuery));
  if (!parsed.success) {
    res
      .status(400)
      .json({
        error: true,
        code: "VALIDATION_ERROR",
        message: parsed.error.message,
        status: 400,
      });
    return;
  }
  const { from, to } = dateRange(parsed.data.dateFrom, parsed.data.dateTo);
  const dateFromOnly = queryDateOnly(rawQuery, "dateFrom", from);
  const dateToOnly = queryDateOnly(rawQuery, "dateTo", to);

  const dashboard = await cached(
    `erp:dashboard:${ctx.dataset}:${dateFromOnly}:${dateToOnly}`,
    ERP_CACHE_TTL_MS,
    () =>
      fetchErpDashboard(ctx.clientId, ctx.dataset, dateFromOnly, dateToOnly),
  );

  res.json({
    period: { from: from.toISOString(), to: to.toISOString() },
    kpis: dashboard.kpis,
    revenueOverTime: dashboard.dailyRevenue,
    ordersOverTime: dashboard.dailyOrders,
    newCustomersOverTime: dashboard.dailyNewCustomers,
    returningCustomersOverTime: dashboard.dailyReturningCustomers,
    attribution: dashboard.attribution,
    breakdowns: dashboard.breakdowns,
  });
}

const GetErpOrdersQueryParams = z.object({
  page: z.coerce.number().int().min(1).default(1),
  // Achado 26/08/2026 (ClickUp Vogabox item 4.2): tela mostrava 300+
  // pedidos, mas o export CSV pedia limit=100 (o teto da API) -- exportava
  // só a 1ª página sem avisar. Teto subiu de 100 pra 5000 pra caber um
  // export de verdade; a paginação da TELA continua em 25/página (default
  // não mudou).
  limit: z.coerce.number().int().min(1).max(5000).default(25),
  search: z.coerce.string().trim().optional(),
  status: z.coerce.string().trim().optional(),
  customerDocument: z.coerce.string().trim().optional(),
  allTime: z.enum(["true", "false"]).optional(),
});

export async function getOrders(req: Request, res: Response): Promise<void> {
  const ctx = await requireErpDataset(req, res);
  if (!ctx) return;

  const rawQuery = req.query as Record<string, unknown>;
  const dateParsed = z
    .object({ dateFrom: z.date().optional(), dateTo: z.date().optional() })
    .safeParse(coerceDateQuery(rawQuery));
  const queryParsed = GetErpOrdersQueryParams.safeParse(rawQuery);
  if (!dateParsed.success || !queryParsed.success) {
    res
      .status(400)
      .json({
        error: true,
        code: "VALIDATION_ERROR",
        message: (dateParsed.error ?? queryParsed.error)?.message,
        status: 400,
      });
    return;
  }
  const { from, to } = dateRange(
    dateParsed.data.dateFrom,
    dateParsed.data.dateTo,
  );
  const dateFromOnly = queryDateOnly(rawQuery, "dateFrom", from);
  const dateToOnly = queryDateOnly(rawQuery, "dateTo", to);
  const { page, limit, search, status, customerDocument, allTime } =
    queryParsed.data;
  const useAllTime = allTime === "true";

  const cacheKey = `erp:orders:${ctx.dataset}:${dateFromOnly}:${dateToOnly}:${page}:${limit}:${search ?? ""}:${status ?? ""}:${customerDocument ?? ""}:${useAllTime}`;
  const result = await cached(cacheKey, ERP_CACHE_TTL_MS, () =>
    fetchErpOrdersPage(
      ctx.clientId,
      ctx.dataset,
      dateFromOnly,
      dateToOnly,
      page,
      limit,
      search,
      status,
      { customerDocument, allTime: useAllTime },
    ),
  );

  res.json({
    period: { from: from.toISOString(), to: to.toISOString() },
    rows: result.rows,
    total: result.total,
    page,
    limit,
  });
}

const GetErpCustomersQueryParams = z.object({
  page: z.coerce.number().int().min(1).default(1),
  // Mesmo achado do item acima (orders) -- teto pro export de verdade.
  limit: z.coerce.number().int().min(1).max(5000).default(20),
  search: z.coerce.string().trim().optional(),
  buyerType: z.enum(["NEW", "RETURNING"]).optional(),
  seller: z.coerce.string().trim().optional(),
  state: z.coerce.string().trim().optional(),
});

export async function getCustomers(req: Request, res: Response): Promise<void> {
  const ctx = await requireErpDataset(req, res);
  if (!ctx) return;

  const rawQuery = req.query as Record<string, unknown>;
  const dateParsed = z
    .object({ dateFrom: z.date().optional(), dateTo: z.date().optional() })
    .safeParse(coerceDateQuery(rawQuery));
  const parsed = GetErpCustomersQueryParams.safeParse(rawQuery);
  if (!dateParsed.success || !parsed.success) {
    res
      .status(400)
      .json({
        error: true,
        code: "VALIDATION_ERROR",
        message: (dateParsed.error ?? parsed.error)?.message,
        status: 400,
      });
    return;
  }
  const { page, limit, search, buyerType, seller, state } = parsed.data;
  const { from, to } = dateRange(
    dateParsed.data.dateFrom,
    dateParsed.data.dateTo,
  );
  const dateFromOnly = queryDateOnly(rawQuery, "dateFrom", from);
  const dateToOnly = queryDateOnly(rawQuery, "dateTo", to);

  const cacheKey = `erp:customers:${ctx.dataset}:${dateFromOnly}:${dateToOnly}:${page}:${limit}:${search ?? ""}:${buyerType ?? ""}:${seller ?? ""}:${state ?? ""}`;
  const result = await cached(cacheKey, ERP_CACHE_TTL_MS, () =>
    fetchErpCustomersPage(
      ctx.clientId,
      ctx.dataset,
      dateFromOnly,
      dateToOnly,
      page,
      limit,
      search,
      { buyerType, seller, state },
    ),
  );

  res.json({
    rows: result.rows,
    total: result.total,
    page,
    limit,
    period: { from: from.toISOString(), to: to.toISOString() },
  });
}

const GetErpProductsQueryParams = z.object({
  page: z.coerce.number().int().min(1).default(1),
  // Mesmo achado do item 4.2 (orders/customers) -- teto pro export de
  // verdade. Vogabox sozinha tem 3500+ produtos, bem acima do teto antigo.
  limit: z.coerce.number().int().min(1).max(5000).default(50),
  search: z.coerce.string().trim().optional(),
  category: z.coerce.string().trim().optional(),
  stockStatus: z.enum(["in_stock", "out_of_stock", "negative"]).optional(),
  sort: z
    .enum([
      "revenue",
      "units",
      "stock",
      "turnover",
      "sales_power",
      "coverage",
      "margin",
    ])
    .optional(),
});

export async function getProducts(req: Request, res: Response): Promise<void> {
  const ctx = await requireErpDataset(req, res);
  if (!ctx) return;

  const rawQuery = req.query as Record<string, unknown>;
  const dateParsed = z
    .object({ dateFrom: z.date().optional(), dateTo: z.date().optional() })
    .safeParse(coerceDateQuery(rawQuery));
  const parsed = GetErpProductsQueryParams.safeParse(rawQuery);
  if (!dateParsed.success || !parsed.success) {
    res
      .status(400)
      .json({
        error: true,
        code: "VALIDATION_ERROR",
        message: (dateParsed.error ?? parsed.error)?.message,
        status: 400,
      });
    return;
  }
  const { page, limit, search, category, stockStatus, sort } = parsed.data;
  const { from, to } = dateRange(
    dateParsed.data.dateFrom,
    dateParsed.data.dateTo,
  );
  const dateFromOnly = queryDateOnly(rawQuery, "dateFrom", from);
  const dateToOnly = queryDateOnly(rawQuery, "dateTo", to);

  const cacheKey = `erp:products:${ctx.dataset}:${dateFromOnly}:${dateToOnly}:${page}:${limit}:${search ?? ""}:${category ?? ""}:${stockStatus ?? ""}:${sort ?? ""}`;
  const result = await cached(cacheKey, ERP_CACHE_TTL_MS, () =>
    fetchErpProductsPage(ctx.dataset, {
      search,
      category,
      stockStatus,
      sort,
      dateFrom: dateFromOnly,
      dateTo: dateToOnly,
      page,
      limit,
    }),
  );

  res.json({
    ...result,
    period: { from: from.toISOString(), to: to.toISOString() },
    page,
    limit,
  });
}

const GetPerformanceQueryParams = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

function maskDocument(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 14) return `CNPJ **.***.***/****-${digits.slice(-2)}`;
  if (digits.length === 11) return `CPF ***.***.***-${digits.slice(-2)}`;
  return `***${digits.slice(-4)}`;
}

export async function getPerformance(
  req: Request,
  res: Response,
): Promise<void> {
  const ctx = await requireErpDataset(req, res);
  if (!ctx) return;

  const rawQuery = req.query as Record<string, unknown>;
  const dateParsed = z
    .object({ dateFrom: z.date().optional(), dateTo: z.date().optional() })
    .safeParse(coerceDateQuery(rawQuery));
  const queryParsed = GetPerformanceQueryParams.safeParse(rawQuery);
  if (!dateParsed.success || !queryParsed.success) {
    res
      .status(400)
      .json({
        error: true,
        code: "VALIDATION_ERROR",
        message: (dateParsed.error ?? queryParsed.error)?.message,
        status: 400,
      });
    return;
  }

  const { from, to } = dateRange(
    dateParsed.data.dateFrom,
    dateParsed.data.dateTo,
  );
  const dateFromOnly = queryDateOnly(rawQuery, "dateFrom", from);
  const dateToOnly = queryDateOnly(rawQuery, "dateTo", to);
  const { page, limit } = queryParsed.data;

  const [dashboard, orders] = await Promise.all([
    cached(
      `performance:dashboard:${ctx.clientId}:${ctx.dataset}:${dateFromOnly}:${dateToOnly}`,
      ERP_CACHE_TTL_MS,
      () =>
        fetchPerformanceDashboard(
          ctx.clientId,
          ctx.dataset,
          dateFromOnly,
          dateToOnly,
        ),
    ),
    cached(
      `performance:orders:${ctx.clientId}:${ctx.dataset}:${dateFromOnly}:${dateToOnly}:${page}:${limit}`,
      ERP_CACHE_TTL_MS,
      () =>
        fetchErpOrdersPage(
          ctx.clientId,
          ctx.dataset,
          dateFromOnly,
          dateToOnly,
          page,
          limit,
        ),
    ),
  ]);

  const rows = orders.rows.map((order) => {
    const documentKey = (order.document ?? order.customerId ?? "").replace(
      /\D/g,
      "",
    );
    return {
      ...order,
      document: maskDocument(order.document ?? order.customerId),
      buyerType: dashboard.buyerTypeByDocument[documentKey] ?? "UNKNOWN",
      attribution: order.attributed ? "ATRIBUIDO" : "SEM_ORIGEM",
    };
  });
  const { buyerTypeByDocument: _buyerTypes, ...publicDashboard } = dashboard;

  res.json({
    period: { from: from.toISOString(), to: to.toISOString() },
    ...publicDashboard,
    orders: { rows, total: orders.total, page, limit },
  });
}
