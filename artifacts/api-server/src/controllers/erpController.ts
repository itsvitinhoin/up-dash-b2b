import type { Request, Response } from "express";
import { z } from "zod";
import { coerceDateQuery, dateRange, queryDateOnly, requireClient } from "../lib/httpQuery";
import { cached } from "../lib/queryCache";
import {
  resolveErpDataset,
  fetchErpDashboard,
  fetchErpOrdersPage,
  fetchErpCustomersPage,
  fetchErpProductsPage,
} from "../services/erpAnalytics";

const ERP_CACHE_TTL_MS = 5 * 60 * 1000;

async function requireErpDataset(req: Request, res: Response): Promise<{ clientId: string; dataset: string } | null> {
  const clientId = requireClient(req, res);
  if (!clientId) return null;
  const dataset = await resolveErpDataset(clientId);
  if (!dataset) {
    res.status(404).json({ error: true, code: "NO_ERP_INTEGRATION", message: "Client não tem integração de ERP configurada.", status: 404 });
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
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }
  const { from, to } = dateRange(parsed.data.dateFrom, parsed.data.dateTo);
  const dateFromOnly = queryDateOnly(rawQuery, "dateFrom", from);
  const dateToOnly = queryDateOnly(rawQuery, "dateTo", to);

  const dashboard = await cached(`erp:dashboard:${ctx.dataset}:${dateFromOnly}:${dateToOnly}`, ERP_CACHE_TTL_MS, () =>
    fetchErpDashboard(ctx.dataset, dateFromOnly, dateToOnly),
  );

  res.json({
    period: { from: from.toISOString(), to: to.toISOString() },
    kpis: dashboard.kpis,
    revenueOverTime: dashboard.dailyRevenue,
    ordersOverTime: dashboard.dailyOrders,
    newCustomersOverTime: dashboard.dailyNewCustomers,
    returningCustomersOverTime: dashboard.dailyReturningCustomers,
  });
}

const GetErpOrdersQueryParams = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.coerce.string().trim().optional(),
});

export async function getOrders(req: Request, res: Response): Promise<void> {
  const ctx = await requireErpDataset(req, res);
  if (!ctx) return;

  const rawQuery = req.query as Record<string, unknown>;
  const dateParsed = z.object({ dateFrom: z.date().optional(), dateTo: z.date().optional() }).safeParse(coerceDateQuery(rawQuery));
  const queryParsed = GetErpOrdersQueryParams.safeParse(rawQuery);
  if (!dateParsed.success || !queryParsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: (dateParsed.error ?? queryParsed.error)?.message, status: 400 });
    return;
  }
  const { from, to } = dateRange(dateParsed.data.dateFrom, dateParsed.data.dateTo);
  const dateFromOnly = queryDateOnly(rawQuery, "dateFrom", from);
  const dateToOnly = queryDateOnly(rawQuery, "dateTo", to);
  const { page, limit, search } = queryParsed.data;

  const cacheKey = `erp:orders:${ctx.dataset}:${dateFromOnly}:${dateToOnly}:${page}:${limit}:${search ?? ""}`;
  const result = await cached(cacheKey, ERP_CACHE_TTL_MS, () =>
    fetchErpOrdersPage(ctx.dataset, dateFromOnly, dateToOnly, page, limit, search),
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
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.coerce.string().trim().optional(),
});

export async function getCustomers(req: Request, res: Response): Promise<void> {
  const ctx = await requireErpDataset(req, res);
  if (!ctx) return;

  const parsed = GetErpCustomersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }
  const { page, limit, search } = parsed.data;

  const cacheKey = `erp:customers:${ctx.dataset}:${page}:${limit}:${search ?? ""}`;
  const result = await cached(cacheKey, ERP_CACHE_TTL_MS, () => fetchErpCustomersPage(ctx.dataset, page, limit, search));

  res.json({ rows: result.rows, total: result.total, page, limit });
}

const GetErpProductsQueryParams = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  search: z.coerce.string().trim().optional(),
  category: z.coerce.string().trim().optional(),
});

export async function getProducts(req: Request, res: Response): Promise<void> {
  const ctx = await requireErpDataset(req, res);
  if (!ctx) return;

  const parsed = GetErpProductsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }
  const { page, limit, search, category } = parsed.data;

  const cacheKey = `erp:products:${ctx.dataset}:${page}:${limit}:${search ?? ""}:${category ?? ""}`;
  const result = await cached(cacheKey, ERP_CACHE_TTL_MS, () => fetchErpProductsPage(ctx.dataset, { search, category, page, limit }));

  res.json({ ...result, page, limit });
}
