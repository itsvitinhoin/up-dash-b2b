import type { Request, Response } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, clientsTable } from "@workspace/db";
import { GetDashboardQueryParams, GetDashboardResponse, GetGeographyQueryParams, GetGeographyResponse, GetJourneyQueryParams, GetJourneyResponse } from "@workspace/api-zod";
import { coerceDateQuery, dateRange, queryDateOnly, requireClient, saoPauloDateOnly } from "../lib/httpQuery";
import { cached } from "../lib/queryCache";
import { fetchMetaMarketingData, upsertMetaCreatives } from "../services/meta-ads";
import {
  resolveVestiDataset,
  computeVestiWindow,
  computeVestiStateRevenue,
  fetchVestiAttributedCustomers,
  fetchVestiFunnel,
  fetchVestiDailyBreakdown,
  generateVestiDailyReportText,
  fetchVestiGeography,
  fetchVestiJourney,
  type VestiFilters,
} from "../services/vestiAnalytics";

// Duplicado de propósito (mesmo padrão de routes/analytics.ts e
// routes/clients.ts) — evita import circular controller↔routes.
function getGlobalMetaAccessToken(fallback?: string | null): string | null {
  return process.env.META_ADS_API_KEY ?? process.env.META_ACCESS_TOKEN ?? process.env.META_API_KEY ?? process.env.META_TOKEN ?? fallback ?? null;
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

const VESTI_CACHE_TTL_MS = 5 * 60 * 1000;

// Espelha CampaignCustomersQueryParams (routes/analytics.ts) — duplicado
// aqui de propósito pra não criar import circular controller↔routes.
// Se um filtro novo for adicionado lá pro caminho UpZero, replicar aqui.
const CampaignCustomersQueryParams = GetDashboardQueryParams.pick({
  clientId: true,
  dateFrom: true,
  dateTo: true,
}).extend({
  limit: z.coerce.number().int().min(1).max(1000).default(250),
  source: z.coerce.string().optional(),
  campaign: z.coerce.string().optional(),
  purchase: z.enum(["all", "yes", "no"]).default("all"),
  repurchase: z.enum(["all", "yes", "no"]).default("all"),
  remarketing: z.enum(["all", "yes", "no"]).default("all"),
  customerType: z.coerce.string().optional(),
  document: z.enum(["all", "CPF", "CNPJ", "none"]).default("all"),
  search: z.coerce.string().optional(),
});

const EMPTY_CAMPAIGN_CUSTOMERS_RESPONSE = {
  rows: [],
  data: [],
  total: 0,
  filters: { sources: [], campaigns: [], customerTypes: [] },
  summary: { impactedCustomers: 0, attributedRevenue: 0, orders: 0, itemQuantity: 0, registrations: 0 },
};

export async function getDashboard(req: Request, res: Response): Promise<void> {
  const parsed = GetDashboardQueryParams.safeParse(coerceDateQuery(req.query as Record<string, unknown>));
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

  const rawQuery = req.query as Record<string, unknown>;
  const { from, to } = dateRange(parsed.data.dateFrom, parsed.data.dateTo);
  const dateFromOnly = queryDateOnly(rawQuery, "dateFrom", from);
  const dateToOnly = queryDateOnly(rawQuery, "dateTo", to);
  const { category, sellerId, channel, compare } = parsed.data;

  const vestiFilters: VestiFilters = {
    category: category || undefined,
    sellerId: sellerId || undefined,
    channel: channel || undefined,
  };
  const filterKey = JSON.stringify(vestiFilters);

  const vestiCurrent = await cached(
    `vesti:window:${dataset}:${dateFromOnly}:${dateToOnly}:${filterKey}`,
    VESTI_CACHE_TTL_MS,
    () => computeVestiWindow(dataset, dateFromOnly, dateToOnly, vestiFilters, true),
  );

  let vestiPrev: Awaited<ReturnType<typeof computeVestiWindow>> | null = null;
  if (compare) {
    const lengthMs = to.getTime() - from.getTime();
    const prevTo = new Date(from.getTime() - 1);
    const prevFrom = new Date(prevTo.getTime() - lengthMs);
    const prevFromOnly = saoPauloDateOnly(prevFrom);
    const prevToOnly = saoPauloDateOnly(prevTo);
    vestiPrev = await cached(
      `vesti:window:${dataset}:${prevFromOnly}:${prevToOnly}:${filterKey}`,
      VESTI_CACHE_TTL_MS,
      () => computeVestiWindow(dataset, prevFromOnly, prevToOnly, vestiFilters, false),
    );
  }

  // Signal: regiões em alta (mesma lógica do caminho Postgres, usando
  // estado em vez de customersTable.state). Não computamos o signal de
  // "alta demanda, baixa conversão" pro Vesti — não existe conceito de
  // sessão/visita nesse lado (venda por atacado via vendedora).
  const wkEnd = to;
  const wkStart = new Date(wkEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
  const pwkEnd = new Date(wkStart.getTime() - 1);
  const pwkStart = new Date(pwkEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
  const [currStates, prevStates] = await Promise.all([
    cached(`vesti:states:${dataset}:${saoPauloDateOnly(wkStart)}:${saoPauloDateOnly(wkEnd)}`, VESTI_CACHE_TTL_MS, () =>
      computeVestiStateRevenue(dataset, saoPauloDateOnly(wkStart), saoPauloDateOnly(wkEnd)),
    ),
    cached(`vesti:states:${dataset}:${saoPauloDateOnly(pwkStart)}:${saoPauloDateOnly(pwkEnd)}`, VESTI_CACHE_TTL_MS, () =>
      computeVestiStateRevenue(dataset, saoPauloDateOnly(pwkStart), saoPauloDateOnly(pwkEnd)),
    ),
  ]);
  const prevStateMap = new Map(prevStates.map((r) => [r.state, r.revenue]));
  const risingStates = currStates
    .filter((r) => r.state && r.revenue > 0)
    .map((r) => {
      const prior = prevStateMap.get(r.state) ?? 0;
      const growthPct = prior > 0 ? ((r.revenue - prior) / prior) * 100 : null;
      return { state: r.state, revenue: r.revenue, growthPct };
    })
    .filter((r) => r.growthPct !== null && r.growthPct > 10)
    .sort((a, b) => (b.growthPct ?? 0) - (a.growthPct ?? 0))
    .slice(0, 3);
  const vestiSignals =
    risingStates.length > 0
      ? [
          {
            type: "high_performing_regions" as const,
            severity: "info" as const,
            title: "High-performing regions this week",
            body: `${risingStates.map((s) => `${s.state} (+${s.growthPct!.toFixed(0)}%)`).join(", ")} ${risingStates.length === 1 ? "is surging" : "are surging"} week-over-week. Consider shifting inventory or ad budget to these regions.`,
            meta: { regions: risingStates.map((s) => ({ state: s.state, growthPct: +(s.growthPct!.toFixed(1)) })) },
          },
        ]
      : [];

  res.json(
    GetDashboardResponse.parse({
      kpis: vestiCurrent.kpis,
      revenueOverTime: vestiCurrent.dailyRevenue,
      ordersOverTime: vestiCurrent.dailyOrders,
      leadsOverTime: vestiCurrent.dailyLeads,
      revenueByCategory: vestiCurrent.revenueByCategory,
      newBuyersOverTime: vestiCurrent.dailyNewBuyers,
      returningBuyersOverTime: vestiCurrent.dailyReturningBuyers,
      traffic: { sessions: 0, orders: vestiCurrent.kpis.orders, source: "none" },
      dailyPerformance: vestiCurrent.dailyRevenue.map((r, i) => ({
        date: r.date,
        revenue: r.value,
        orders: vestiCurrent.dailyOrders[i]?.value ?? 0,
        sessions: 0,
        conversionRate: 0,
      })),
      signals: vestiSignals,
      ...(vestiPrev
        ? {
            prevKpis: vestiPrev.kpis,
            prevRevenueOverTime: vestiPrev.dailyRevenue,
            prevOrdersOverTime: vestiPrev.dailyOrders,
          }
        : {}),
    }),
  );
}

export async function getCampaignCustomers(req: Request, res: Response): Promise<void> {
  const parsed = CampaignCustomersQueryParams.safeParse(coerceDateQuery(req.query as Record<string, unknown>));
  if (!parsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }
  const clientId = requireClient(req, res);
  if (!clientId) return;

  const dataset = await resolveVestiDataset(clientId);
  if (!dataset) {
    res.json(EMPTY_CAMPAIGN_CUSTOMERS_RESPONSE);
    return;
  }

  const { from, to } = dateRange(parsed.data.dateFrom, parsed.data.dateTo);
  const dateFromOnly = saoPauloDateOnly(from);
  const dateToOnly = saoPauloDateOnly(to);
  const attributed = await cached(
    `vesti:attributed:${dataset}:${dateFromOnly}:${dateToOnly}`,
    VESTI_CACHE_TTL_MS,
    () => fetchVestiAttributedCustomers(dataset, dateFromOnly, dateToOnly),
  );

  let rows = attributed.map((c, index) => {
    const touch = { source: "UP Agency", medium: null, campaign: null, occurredAt: c.firstTouchAt };
    return {
      customerId: null,
      userId: index,
      name: c.name,
      email: c.email,
      phone: null,
      type: c.attributionType,
      cpf: null,
      cnpj: c.cnpj,
      companyName: null,
      documentType: c.cnpj ? "CNPJ" : null,
      registrationStatus: null,
      registeredAt: c.registeredAt,
      firstSeenAt: c.firstTouchAt,
      lastSeenAt: c.lastPurchaseAt ?? c.firstTouchAt,
      firstTouch: touch,
      lastTouch: touch,
      returnTouch: null,
      campaigns: c.firstTouchAt
        ? [{ source: "UP Agency", medium: null, campaign: null, firstSeenAt: c.firstTouchAt, lastSeenAt: c.firstTouchAt, eventsCount: 1 }]
        : [],
      hasPurchase: c.purchaseCount > 0,
      isRemarketing: c.attributionType === "Re-impacto",
      purchaseCount: c.purchaseCount,
      orderIds: [] as number[],
      totalPurchaseValue: c.totalPurchaseValue,
      addToCartCount: 0,
      checkoutCount: 0,
      registerSubmittedCount: 1,
      productViewCount: 0,
      lastEventName: null,
      lastEventAt: c.lastPurchaseAt ?? c.firstTouchAt,
    };
  });

  if (parsed.data.customerType) rows = rows.filter((r) => r.type === parsed.data.customerType);
  if (parsed.data.purchase === "yes") rows = rows.filter((r) => r.hasPurchase);
  if (parsed.data.purchase === "no") rows = rows.filter((r) => !r.hasPurchase);
  if (parsed.data.remarketing === "yes") rows = rows.filter((r) => r.isRemarketing);
  if (parsed.data.remarketing === "no") rows = rows.filter((r) => !r.isRemarketing);
  if (parsed.data.document === "CNPJ") rows = rows.filter((r) => r.documentType === "CNPJ");
  if (parsed.data.document === "none") rows = rows.filter((r) => r.documentType === null);
  if (parsed.data.search) {
    const search = parsed.data.search.toLowerCase();
    rows = rows.filter(
      (r) => r.name?.toLowerCase().includes(search) || r.email?.toLowerCase().includes(search) || r.cnpj?.includes(search),
    );
  }

  const registeredInWindow = attributed.filter(
    (c) => c.registeredAt && c.registeredAt >= dateFromOnly && c.registeredAt <= dateToOnly,
  ).length;

  res.json({
    rows,
    data: rows,
    total: rows.length,
    filters: {
      sources: ["UP Agency"],
      campaigns: [],
      customerTypes: [...new Set(attributed.map((c) => c.attributionType).filter((v): v is string => !!v))],
    },
    summary: {
      impactedCustomers: attributed.length,
      attributedRevenue: attributed.reduce((sum, c) => sum + c.totalPurchaseValue, 0),
      orders: attributed.reduce((sum, c) => sum + c.purchaseCount, 0),
      itemQuantity: 0,
      registrations: registeredInWindow,
    },
  });
}

export async function getFunnel(req: Request, res: Response): Promise<void> {
  const parsed = GetDashboardQueryParams.pick({ dateFrom: true, dateTo: true }).safeParse(
    coerceDateQuery(req.query as Record<string, unknown>),
  );
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

  const rawQuery = req.query as Record<string, unknown>;
  const { from, to } = dateRange(parsed.data.dateFrom, parsed.data.dateTo);
  const dateFromOnly = queryDateOnly(rawQuery, "dateFrom", from);
  const dateToOnly = queryDateOnly(rawQuery, "dateTo", to);

  const funnel = await cached(`vesti:funnel:${dataset}:${dateFromOnly}:${dateToOnly}`, VESTI_CACHE_TTL_MS, () =>
    fetchVestiFunnel(dataset, dateFromOnly, dateToOnly),
  );

  res.json({
    steps: funnel.steps,
    overallConversion: funnel.overallConversion,
    insights: funnel.insights,
    avgEventsBeforePurchase: 0,
    topPaths: [],
    suggestedActions: funnel.suggestedActions,
    hasSiteVisitData: funnel.hasSiteVisitData,
  });
}

export async function getDailyReport(req: Request, res: Response): Promise<void> {
  const parsed = z.object({ dateFrom: z.date().optional(), dateTo: z.date().optional() }).safeParse(coerceDateQuery(req.query as Record<string, unknown>));
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

  const [client] = await db
    .select({ name: clientsTable.name, metaAdsApiKey: clientsTable.metaAdsApiKey, metaAdAccountId: clientsTable.metaAdAccountId })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));

  const rawQuery = req.query as Record<string, unknown>;
  const { from, to } = dateRange(parsed.data.dateFrom, parsed.data.dateTo);
  const dateFromOnly = queryDateOnly(rawQuery, "dateFrom", from);
  const dateToOnly = queryDateOnly(rawQuery, "dateTo", to);
  const span = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - span);
  const prevDateFromOnly = saoPauloDateOnly(prevFrom);
  const prevDateToOnly = saoPauloDateOnly(prevTo);

  const metaAccessToken = getGlobalMetaAccessToken(client?.metaAdsApiKey);
  const [metaCurrent, metaPrev] = await Promise.all([
    metaAccessToken && client?.metaAdAccountId
      ? fetchMetaMarketingData({ accessToken: metaAccessToken, adAccountId: client.metaAdAccountId, since: dateFromOnly, until: dateToOnly }).catch((err) => {
          console.warn("[vesti-daily-report] Meta current fetch failed:", err);
          return null;
        })
      : Promise.resolve(null),
    metaAccessToken && client?.metaAdAccountId
      ? fetchMetaMarketingData({ accessToken: metaAccessToken, adAccountId: client.metaAdAccountId, since: prevDateFromOnly, until: prevDateToOnly }).catch((err) => {
          console.warn("[vesti-daily-report] Meta previous fetch failed:", err);
          return null;
        })
      : Promise.resolve(null),
  ]);
  if (metaCurrent) await upsertMetaCreatives(clientId, metaCurrent.ads);

  const [currentWindow, prevWindow, breakdown] = await Promise.all([
    cached(`vesti:window:${dataset}:${dateFromOnly}:${dateToOnly}:{}`, 5 * 60 * 1000, () => computeVestiWindow(dataset, dateFromOnly, dateToOnly, {}, false)),
    cached(`vesti:window:${dataset}:${prevDateFromOnly}:${prevDateToOnly}:{}`, 5 * 60 * 1000, () => computeVestiWindow(dataset, prevDateFromOnly, prevDateToOnly, {}, false)),
    cached(`vesti:daily-breakdown:${dataset}:${dateFromOnly}:${dateToOnly}`, 5 * 60 * 1000, () => fetchVestiDailyBreakdown(dataset, dateFromOnly, dateToOnly)),
  ]);

  const kpis = {
    approvedRevenue: currentWindow.kpis.revenue,
    sales: currentWindow.kpis.orders,
    avgTicket: currentWindow.kpis.avgTicket,
    mediaSpend: metaCurrent?.summary.spend ?? 0,
    costPerPurchase: currentWindow.kpis.orders > 0 ? (metaCurrent?.summary.spend ?? 0) / currentWindow.kpis.orders : 0,
    roas: (metaCurrent?.summary.spend ?? 0) > 0 ? currentWindow.kpis.revenue / (metaCurrent?.summary.spend ?? 0) : 0,
  };
  const prevKpis = {
    approvedRevenue: prevWindow.kpis.revenue,
    sales: prevWindow.kpis.orders,
    avgTicket: prevWindow.kpis.avgTicket,
    mediaSpend: metaPrev?.summary.spend ?? 0,
    costPerPurchase: prevWindow.kpis.orders > 0 ? (metaPrev?.summary.spend ?? 0) / prevWindow.kpis.orders : 0,
    roas: (metaPrev?.summary.spend ?? 0) > 0 ? prevWindow.kpis.revenue / (metaPrev?.summary.spend ?? 0) : 0,
  };

  const campaigns = (metaCurrent?.campaigns ?? [])
    .map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      spend: campaign.spend,
      purchases: campaign.purchases,
      revenue: campaign.revenue,
      roas: campaign.roas ?? (campaign.spend > 0 ? campaign.revenue / campaign.spend : 0),
      cpa: campaign.cpa ?? (campaign.purchases > 0 ? campaign.spend / campaign.purchases : 0),
      clicks: campaign.clicks,
      impressions: campaign.impressions,
    }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 10);

  const analysis = await generateVestiDailyReportText({
    brand: client?.name ?? "",
    dateFrom: dateFromOnly,
    dateTo: dateToOnly,
    kpis,
    prevKpis,
    campaigns,
    breakdown,
  });

  res.json({
    client: { id: clientId, name: client?.name ?? "" },
    period: { from: dateFromOnly, to: dateToOnly },
    previousPeriod: { from: prevDateFromOnly, to: prevDateToOnly },
    kpis,
    prevKpis,
    changes: {
      approvedRevenue: pctChange(kpis.approvedRevenue, prevKpis.approvedRevenue),
      sales: pctChange(kpis.sales, prevKpis.sales),
      avgTicket: pctChange(kpis.avgTicket, prevKpis.avgTicket),
      costPerPurchase: pctChange(kpis.costPerPurchase, prevKpis.costPerPurchase),
      mediaSpend: pctChange(kpis.mediaSpend, prevKpis.mediaSpend),
      roas: pctChange(kpis.roas, prevKpis.roas),
    },
    campaigns,
    products: breakdown.products,
    categories: breakdown.categories,
    colors: breakdown.colors,
    sizes: breakdown.sizes,
    analysis,
    generatedAt: new Date().toISOString(),
  });
}

export async function getGeography(req: Request, res: Response): Promise<void> {
  const parsed = GetGeographyQueryParams.safeParse(coerceDateQuery(req.query as Record<string, unknown>));
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

  const geography = await cached(`vesti:geography:${dataset}:${dateFromOnly}:${dateToOnly}`, 5 * 60 * 1000, () =>
    fetchVestiGeography(dataset, dateFromOnly, dateToOnly),
  );

  res.json(GetGeographyResponse.parse(geography));
}

export async function getJourney(req: Request, res: Response): Promise<void> {
  const parsed = GetJourneyQueryParams.safeParse(coerceDateQuery(req.query as Record<string, unknown>));
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

  const journey = await cached(`vesti:journey:${dataset}:${dateFromOnly}:${dateToOnly}`, 5 * 60 * 1000, () =>
    fetchVestiJourney(dataset, dateFromOnly, dateToOnly),
  );

  res.json(GetJourneyResponse.parse(journey));
}
