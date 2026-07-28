import type { Request, Response } from "express";
import { z } from "zod";
import { GetCustomerDetailParams, GetCustomerDetailQueryParams } from "@workspace/api-zod";
import { DATE_ONLY_RE, requireClient } from "../lib/httpQuery";
import { cached } from "../lib/queryCache";
import { resolveClientId } from "../middlewares/auth";
import {
  resolveVestiDataset,
  fetchVestiCustomersPage,
  fetchVestiCustomerSummary,
  fetchVestiCustomerDetail,
  fetchVestiCustomerEmail,
  fetchVestiCustomerTimeline,
} from "../services/vestiAnalytics";

const VESTI_CACHE_TTL_MS = 5 * 60 * 1000;

// Query params próprios do caminho Vesti (não existe schema equivalente em
// @workspace/api-zod — os campos não batem com o caminho Postgres, que já
// valida clientId/search/rfmSegment/utmSource/utmMedium antes de delegar
// aqui, mas não conhece sortBy/sortDir/purchaseStatus do lado Vesti).
const GetVestiCustomersQueryParams = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(["totalSpent", "totalOrders", "createdAt", "firstPurchaseAt", "lastPurchaseAt", "name"]).default("totalSpent"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  search: z.coerce.string().trim().optional(),
  purchaseStatus: z.enum(["buyers", "non_buyers"]).optional(),
  documentType: z.enum(["CPF", "CNPJ"]).optional(),
  registrationStatus: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
});

const GetVestiCustomerSummaryQueryParams = z.object({
  dateFrom: z.string().regex(DATE_ONLY_RE).optional(),
  dateTo: z.string().regex(DATE_ONLY_RE).optional(),
});

export async function getCustomers(req: Request, res: Response): Promise<void> {
  const parsed = GetVestiCustomersQueryParams.safeParse(req.query);
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

  const {
    page: vPage,
    limit: vLimit,
    sortBy: vSortBy,
    sortDir: vSortDir,
    search: vSearch,
    purchaseStatus: vPurchaseStatus,
    documentType: vDocumentType,
    registrationStatus: vRegistrationStatus,
  } = parsed.data;
  const cacheKey = `vesti:customers:${dataset}:${vPage}:${vLimit}:${vSortBy}:${vSortDir}:${vSearch ?? ""}:${vPurchaseStatus ?? ""}:${vDocumentType ?? ""}:${vRegistrationStatus ?? ""}`;
  const page_ = await cached(cacheKey, VESTI_CACHE_TTL_MS, () =>
    fetchVestiCustomersPage(dataset, vPage, vLimit, vSortBy, vSortDir, {
      search: vSearch,
      purchaseStatus: vPurchaseStatus,
      documentType: vDocumentType,
      registrationStatus: vRegistrationStatus,
    }),
  );
  res.json({
    data: page_.rows.map((c) => ({
      id: c.id,
      clientId,
      email: c.email,
      name: c.name,
      phone: c.phone,
      documentType: c.documentType,
      state: c.state,
      city: c.city,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      registrationStatus: c.registrationStatus,
      approvalDate: null,
      rfmSegment: null,
      recencyScore: null,
      frequencyScore: null,
      monetaryScore: null,
      totalOrders: c.totalOrders,
      totalSpent: c.totalSpent,
      firstPurchaseAt: c.firstPurchaseAt,
      lastPurchaseAt: c.lastPurchaseAt,
      opportunityLevel: c.totalSpent > 5000 ? "HIGH" : c.totalOrders > 0 ? "MEDIUM" : "LOW",
      createdAt: c.createdAt,
    })),
    total: page_.total,
    page: vPage,
    pages: Math.max(1, Math.ceil(page_.total / vLimit)),
    segmentCounts: page_.segmentCounts,
  });
}

export async function getCustomerSummary(req: Request, res: Response): Promise<void> {
  const parsed = GetVestiCustomerSummaryQueryParams.safeParse(req.query);
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

  const vDateFrom = parsed.data.dateFrom ?? null;
  const vDateTo = parsed.data.dateTo ?? null;
  const cacheKey = `vesti:customer-summary:${dataset}:${vDateFrom}:${vDateTo}`;
  const summary = await cached(cacheKey, VESTI_CACHE_TTL_MS, () =>
    fetchVestiCustomerSummary(dataset, vDateFrom, vDateTo),
  );
  res.json({
    kpis: {
      ...summary.kpis,
      avgTimeToFirstPurchaseDays: null,
      avgTimeBetweenPurchasesDays: null,
    },
    registrationsOverTime: summary.registrationsOverTime,
    registrationsByState: summary.registrationsByState,
    registrationsBySource: summary.registrationsBySource,
  });
}

export async function getCustomerTimeline(req: Request, res: Response): Promise<void> {
  const pathParsed = GetCustomerDetailParams.safeParse(req.params);
  if (!pathParsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: pathParsed.error.message, status: 400 });
    return;
  }
  const clientId = resolveClientId(req) ?? (req.query.clientId as string | undefined);
  if (!clientId) {
    res.status(400).json({ error: true, code: "CLIENT_REQUIRED", message: "clientId is required for admin users", status: 400 });
    return;
  }

  const { customerId } = pathParsed.data;

  const dataset = await resolveVestiDataset(clientId);
  if (!dataset) {
    res.status(404).json({ error: true, code: "NOT_VESTI_CLIENT", message: "Client não é Vesti ou não foi encontrado.", status: 404 });
    return;
  }

  const email = await fetchVestiCustomerEmail(dataset, customerId);
  if (!email) {
    res.status(404).json({ error: true, code: "NOT_FOUND", message: "Customer not found", status: 404 });
    return;
  }

  const timeline = await fetchVestiCustomerTimeline(dataset, email);

  res.json({
    userId: 0,
    attribution: {
      firstTouch: timeline.firstTouch,
      lastTouch: timeline.lastTouch,
      lastReturn: { source: null, medium: null, campaign: null, occurredAt: null },
    },
    summary: {
      totalEvents: timeline.summary.totalEvents,
      productViews: timeline.summary.productViews,
      categoryViews: 0,
      formStarts: 0,
      registerStarts: 0,
      registerSubmitted: timeline.summary.registerSubmitted,
      logins: 0,
      addToCartEvents: timeline.summary.addToCartEvents,
      checkoutStarts: timeline.summary.checkoutStarts,
      purchases: timeline.summary.purchases,
      totalCartValue: 0,
      totalPurchaseValue: 0,
      firstSeenAt: timeline.summary.firstSeenAt,
      lastSeenAt: timeline.summary.lastSeenAt,
    },
    timeline: timeline.timeline.map((e) => ({
      id: e.id,
      userId: 0,
      occurredAt: e.occurredAt,
      periodType: "event",
      eventName: e.eventName,
      eventLabel: e.eventLabel,
      productId: null,
      productName: null,
      productSku: null,
      categoryId: null,
      categoryName: null,
      orderId: null,
      utmSource: e.utmSource,
      utmMedium: e.utmMedium,
      utmCampaign: e.utmCampaign,
      normalizedSource: e.utmSource ?? "direct",
      normalizedMedium: e.utmMedium ?? "none",
      deviceType: null,
      totalEvents: 1,
      totalQuantity: 0,
      totalValue: 0,
      attributionType: null,
      rawMetricId: 0,
      updatedAt: e.occurredAt,
    })),
  });
}

export async function getCustomerDetail(req: Request, res: Response): Promise<void> {
  const pathParsed = GetCustomerDetailParams.safeParse(req.params);
  if (!pathParsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: pathParsed.error.message, status: 400 });
    return;
  }
  const queryParsed = GetCustomerDetailQueryParams.safeParse(req.query);
  if (!queryParsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: queryParsed.error.message, status: 400 });
    return;
  }

  const clientId = resolveClientId(req) ?? queryParsed.data.clientId;
  if (!clientId) {
    res.status(400).json({ error: true, code: "CLIENT_REQUIRED", message: "clientId is required for admin users", status: 400 });
    return;
  }

  const { customerId } = pathParsed.data;

  const dataset = await resolveVestiDataset(clientId);
  if (!dataset) {
    res.status(404).json({ error: true, code: "NOT_VESTI_CLIENT", message: "Client não é Vesti ou não foi encontrado.", status: 404 });
    return;
  }

  const detail = await fetchVestiCustomerDetail(dataset, customerId);
  if (!detail) {
    res.status(404).json({ error: true, code: "NOT_FOUND", message: "Customer not found", status: 404 });
    return;
  }
  res.json({
    customer: {
      ...detail.customer,
      clientId,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      approvalDate: null,
      rfmSegment: null,
      recencyScore: null,
      frequencyScore: null,
      monetaryScore: null,
      opportunityLevel: detail.customer.totalSpent > 5000 ? "HIGH" : detail.customer.totalOrders > 0 ? "MEDIUM" : "LOW",
    },
    orders: detail.orders.map((o) => ({ ...o, sellerName: null })),
    events: [],
    productsPurchased: detail.productsPurchased.map((p) => ({ ...p, category: null, imageUrl: null, unitPrice: null })),
    journey: detail.journey,
    opportunityLevel: detail.customer.totalSpent > 5000 ? "HIGH" : detail.customer.totalOrders > 0 ? "MEDIUM" : "LOW",
    assignedSeller: null,
  });
}
