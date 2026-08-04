import type { Request, Response } from "express";
import {
  GetSellersQueryParams,
  GetSellersResponse,
  GetSellerDetailQueryParams,
  GetSellerDetailResponse,
  GetSellerOrdersQueryParams,
  GetSellerOrdersResponse,
} from "@workspace/api-zod";
import { coerceDateQuery, dateRange, requireClient, saoPauloDateOnly } from "../lib/httpQuery";
import { cached } from "../lib/queryCache";
import {
  resolveVestiDataset,
  fetchVestiSellers,
  fetchVestiSellerDetail,
  fetchVestiSellerOrders,
} from "../services/vestiAnalytics";

const VESTI_CACHE_TTL_MS = 5 * 60 * 1000;

export async function getSellers(req: Request, res: Response): Promise<void> {
  const parsed = GetSellersQueryParams.safeParse(req.query as Record<string, unknown>);
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

  const { limit } = parsed.data;
  const sellers = await cached(`vesti:sellers:${dataset}:${limit}`, VESTI_CACHE_TTL_MS, () => fetchVestiSellers(dataset, limit));
  res.json(GetSellersResponse.parse(sellers));
}

export async function getSellerDetail(req: Request, res: Response): Promise<void> {
  const parsed = GetSellerDetailQueryParams.safeParse(coerceDateQuery(req.query as Record<string, unknown>));
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

  const sellerName = decodeURIComponent(String(req.params.sellerId));
  const { from, to } = dateRange(parsed.data.dateFrom, parsed.data.dateTo);
  const dateFromOnly = saoPauloDateOnly(from);
  const dateToOnly = saoPauloDateOnly(to);
  const periodMs = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - periodMs);
  const prevDateFromOnly = saoPauloDateOnly(prevFrom);
  const prevDateToOnly = saoPauloDateOnly(prevTo);

  const detail = await cached(`vesti:seller:${dataset}:${sellerName}:${dateFromOnly}:${dateToOnly}`, VESTI_CACHE_TTL_MS, () =>
    fetchVestiSellerDetail(dataset, sellerName, dateFromOnly, dateToOnly, prevDateFromOnly, prevDateToOnly),
  );
  if (!detail) {
    res.status(404).json({ error: true, code: "NOT_FOUND", message: "Seller not found", status: 404 });
    return;
  }
  res.json(GetSellerDetailResponse.parse(detail));
}

export async function getSellerOrders(req: Request, res: Response): Promise<void> {
  const parsed = GetSellerOrdersQueryParams.safeParse(coerceDateQuery(req.query as Record<string, unknown>));
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

  const sellerName = decodeURIComponent(String(req.params.sellerId));
  const { from, to } = dateRange(parsed.data.dateFrom, parsed.data.dateTo);
  const dateFromOnly = saoPauloDateOnly(from);
  const dateToOnly = saoPauloDateOnly(to);
  const { page, limit } = parsed.data;

  const { rows, total } = await fetchVestiSellerOrders(dataset, sellerName, dateFromOnly, dateToOnly, page, limit);
  res.json(GetSellerOrdersResponse.parse({ data: rows, total, page, limit }));
}
