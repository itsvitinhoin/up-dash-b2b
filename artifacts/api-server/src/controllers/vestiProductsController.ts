import type { Request, Response } from "express";
import { GetProductsQueryParams, GetProductDetailQueryParams, GetStockQueryParams, GetStockResponse } from "@workspace/api-zod";
import { coerceDateQuery, dateRange, requireClient, saoPauloDateOnly } from "../lib/httpQuery";
import { cached } from "../lib/queryCache";
import { resolveVestiDataset, fetchVestiProductsPage, fetchVestiProductDetail, fetchVestiStock } from "../services/vestiAnalytics";

const VESTI_CACHE_TTL_MS = 5 * 60 * 1000;

export async function getProducts(req: Request, res: Response): Promise<void> {
  const parsed = GetProductsQueryParams.safeParse(coerceDateQuery(req.query as Record<string, unknown>));
  if (!parsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }
  const clientId = requireClient(req, res);
  if (!clientId) return;

  const dataset = await resolveVestiDataset(clientId);
  if (!dataset) {
    res.status(404).json({ error: true, code: "NOT_VESTI_CLIENT", message: "Client não é Vesti ou não foi encontrado.", status: 404 });
    return;
  }

  const vSort = (["revenue", "units", "created"].includes(parsed.data.sort ?? "") ? parsed.data.sort : "revenue") as "revenue" | "units" | "created";
  const vLimit = Math.min(200, parsed.data.limit ?? 50);
  const cacheKey = `vesti:products:${dataset}:${vSort}:${vLimit}:${parsed.data.search ?? ""}:${parsed.data.category ?? ""}`;
  const rows = await cached(cacheKey, VESTI_CACHE_TTL_MS, () =>
    fetchVestiProductsPage(dataset, {
      search: parsed.data.search,
      category: parsed.data.category,
      sort: vSort,
      limit: vLimit,
    }),
  );
  res.json(
    rows.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category,
      price: p.price,
      cost: null,
      stock: p.stock,
      restockThreshold: 10,
      totalSold: p.totalSold,
      totalRevenue: p.totalRevenue,
      productViews: 0,
      productConversionPct: 0,
      status: "ACTIVE",
      imageUrl: null,
      percentSold: p.totalSold + p.stock > 0 ? p.totalSold / (p.totalSold + p.stock) : 0,
      level: p.totalSold === 0 ? "At Risk" : p.totalSold / (p.totalSold + p.stock || 1) >= 0.5 ? "High Conversion" : "Standard",
      createdAt: p.createdAt,
    })),
  );
}

export async function getProductDetail(req: Request, res: Response): Promise<void> {
  const qParsed = GetProductDetailQueryParams.safeParse(coerceDateQuery(req.query as Record<string, unknown>));
  if (!qParsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: qParsed.error.message, status: 400 });
    return;
  }
  const clientId = requireClient(req, res);
  if (!clientId) return;
  // Express 5's ParamsDictionary allows string[] for repeated path segments,
  // que não é o caso desta rota (:productId simples).
  const productId = req.params.productId as string;

  const dataset = await resolveVestiDataset(clientId);
  if (!dataset) {
    res.status(404).json({ error: true, code: "NOT_VESTI_CLIENT", message: "Client não é Vesti ou não foi encontrado.", status: 404 });
    return;
  }

  const detail = await fetchVestiProductDetail(dataset, productId);
  if (!detail) {
    res.status(404).json({ error: true, code: "NOT_FOUND", message: "Product not found", status: 404 });
    return;
  }
  res.json({
    product: {
      ...detail.product,
      description: null,
      cost: null,
      restockThreshold: 10,
      imageUrl: null,
      status: "ACTIVE",
      percentSold: detail.kpis.percentSold,
      level: detail.level,
    },
    kpis: detail.kpis,
    revenueOverTime: detail.revenueOverTime,
    prevRevenueOverTime: [],
    byColor: detail.byColor,
    bySize: detail.bySize,
    byState: detail.byState,
  });
}

export async function getStock(req: Request, res: Response): Promise<void> {
  const parsed = GetStockQueryParams.safeParse(coerceDateQuery(req.query as Record<string, unknown>));
  if (!parsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }
  const clientId = requireClient(req, res);
  if (!clientId) return;

  const dataset = await resolveVestiDataset(clientId);
  if (!dataset) {
    res.status(404).json({ error: true, code: "NOT_VESTI_CLIENT", message: "Client não é Vesti ou não foi encontrado.", status: 404 });
    return;
  }

  const { from, to } = dateRange(parsed.data.dateFrom, parsed.data.dateTo);
  const dateFromOnly = saoPauloDateOnly(from);
  const dateToOnly = saoPauloDateOnly(to);
  const { page, limit, sort, sortDir, search, category, risk } = parsed.data;

  const stock = await cached(
    `vesti:stock:${dataset}:${dateFromOnly}:${dateToOnly}:${sort}:${sortDir}:${search ?? ""}:${category ?? ""}:${risk ?? ""}:${page}:${limit}`,
    VESTI_CACHE_TTL_MS,
    () => fetchVestiStock(dataset, dateFromOnly, dateToOnly, { sort, sortDir, search, category, risk, page, limit }),
  );

  res.json(GetStockResponse.parse({ ...stock, page, limit }));
}
