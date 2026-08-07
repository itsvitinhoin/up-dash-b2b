import type { Request, Response } from "express";
import { z } from "zod";
import { coerceDateQuery, dateRange, queryDateOnly, requireClient } from "../lib/httpQuery";
import { cached } from "../lib/queryCache";
import { resolveVestiDataset, fetchVestiOrdersPage, fetchVestiOrderDetail } from "../services/vestiAnalytics";

const VESTI_CACHE_TTL_MS = 5 * 60 * 1000;

// Espelha GetOrdersPageQueryParams (routes/analytics.ts) — duplicado aqui
// de propósito pra não criar import circular controller↔routes.
const GetOrdersPageQueryParams = z.object({
  clientId: z.coerce.string().optional(),
  dateFrom: z.date().optional(),
  dateTo: z.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.coerce.string().trim().optional(),
});

export async function getOrdersPage(req: Request, res: Response): Promise<void> {
  const parsed = GetOrdersPageQueryParams.safeParse(coerceDateQuery(req.query as Record<string, unknown>));
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
  const rawQuery = req.query as Record<string, unknown>;
  const dateFromOnly = queryDateOnly(rawQuery, "dateFrom", from);
  const dateToOnly = queryDateOnly(rawQuery, "dateTo", to);
  const page = parsed.data.page;
  const limit = parsed.data.limit;
  const search = parsed.data.search?.trim();

  const cacheKey = `vesti:orders-page:${dataset}:${dateFromOnly}:${dateToOnly}:${page}:${limit}:${search ?? ""}`;
  const page_ = await cached(cacheKey, VESTI_CACHE_TTL_MS, () =>
    fetchVestiOrdersPage(dataset, dateFromOnly, dateToOnly, page, limit, search),
  );

  // "% de conversão" ficava sempre travada em 0% — o controller nem
  // tentava calcular. Mesma fórmula do B2C original pro lado não-B2C
  // (routes/analytics.ts: conversionBase = approvedLeads): pedidos do
  // período ÷ cadastros aprovados no período.
  const conversionPct = page_.kpis.approvedLeads > 0 ? (page_.kpis.orders / page_.kpis.approvedLeads) * 100 : 0;

  res.json({
    period: { from: from.toISOString(), to: to.toISOString() },
    kpis: { ...page_.kpis, conversionPct, sessions: 0 },
    rows: page_.rows.map((r) => ({
      id: r.id,
      externalId: r.externalId,
      status: r.status,
      amount: r.amount,
      fulfilledAmount: r.fulfilledAmount,
      grossAmount: r.amount,
      discountAmount: 0,
      shippingAmount: 0,
      requestedQuantity: r.requestedQuantity,
      fulfilledQuantity: r.fulfilledQuantity,
      approvalDate: null,
      createdAt: r.createdAt,
      customerId: r.customerId ?? "",
      customerExternalId: null,
      customerName: r.customerName,
      customerEmail: r.customerEmail,
      customerPhone: null,
      documentType: r.document ? "CNPJ" : null,
      document: r.document,
      state: r.state,
      city: r.city,
      origin: {
        source: r.isAttributed ? "UP Agency" : (r.originLabel ?? "direct"),
        medium: null,
        campaign: null,
        label: r.isAttributed ? "UP Agency" : (r.originLabel ?? "Direto"),
        attribution: r.isAttributed ? "tracking" : "direct",
      },
    })),
    page,
    limit,
    total: page_.total,
  });
}

export async function getOrderDetail(req: Request, res: Response): Promise<void> {
  const clientId = requireClient(req, res);
  if (!clientId) return;
  const orderId = z.string().safeParse(req.params.orderId);
  if (!orderId.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: orderId.error.message, status: 400 });
    return;
  }

  const dataset = await resolveVestiDataset(clientId);
  if (!dataset) {
    res.status(404).json({ error: true, code: "NOT_VESTI_CLIENT", message: "Client não é Vesti ou não foi encontrado.", status: 404 });
    return;
  }

  const detail = await fetchVestiOrderDetail(dataset, orderId.data);
  if (!detail) {
    res.status(404).json({ error: true, code: "NOT_FOUND", message: "Order not found", status: 404 });
    return;
  }
  res.json({
    order: {
      ...detail.order,
      customerExternalId: null,
      customerPhone: null,
      documentType: detail.order.document ? "CNPJ" : null,
      cancelledAmount: 0,
      refundedAmount: 0,
      customerState: detail.order.state,
      customerCity: detail.order.city,
    },
    customer: {
      ...detail.customer,
      externalId: null,
      documentType: detail.customer.document ? "CNPJ" : null,
    },
    items: detail.items.map((it) => ({
      ...it,
      grossPriceAtSale: it.priceAtSale,
      discountAmount: 0,
      imageUrl: null,
    })),
  });
}
