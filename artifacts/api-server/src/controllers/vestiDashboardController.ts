import type { Request, Response } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, clientsTable } from "@workspace/db";
import { GetDashboardQueryParams, GetDashboardResponse, GetGeographyQueryParams, GetGeographyResponse, GetJourneyQueryParams, GetJourneyResponse, GetMarketingQueryParams, GetMarketingResponse, GetUtmQueryParams, GetUtmResponse } from "@workspace/api-zod";
import { addDaysToDateOnly, coerceDateQuery, dateRange, queryDateOnly, requireClient, saoPauloDateOnly, saoPauloDateOnlyEnd, saoPauloDateOnlyStart } from "../lib/httpQuery";
import { cached } from "../lib/queryCache";
import { fetchMetaMarketingData, upsertMetaCreatives, getLastCreativeFetchError } from "../services/meta-ads";
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
  fetchVestiScaleData,
  fetchVestiMarketingData,
  fetchVestiUtmData,
  fetchVestiMetaSpendFromBigQuery,
  type VestiFilters,
} from "../services/vestiAnalytics";

// Duplicado de propósito (mesmo padrão de routes/analytics.ts e
// routes/clients.ts) — evita import circular controller↔routes.
function getGlobalMetaAccessToken(fallback?: string | null): string | null {
  return process.env.META_ADS_API_KEY ?? process.env.META_ACCESS_TOKEN ?? process.env.META_API_KEY ?? process.env.META_TOKEN ?? fallback ?? null;
}

// Fallback de investimento Meta Ads (05/08/2026): a maioria dos clients
// Vesti não tem token de API do Meta configurado (metaAdsApiKey), então a
// chamada ao vivo no Graph API nunca acontece e o card fica zerado — mesmo
// quando a marca tem campanha ativa. Só que o gasto real já existe
// pré-ingerido no BigQuery (`data_ads_global.ads_insights_account`, outro
// pipeline). Se a chamada ao vivo não trouxe nada mas o client tem
// `metaAdAccountId` cadastrado, busca de lá em vez de deixar em zero.
async function resolveVestiInvestment(
  client: { metaAdAccountId?: string | null } | undefined,
  dateFromOnly: string,
  dateToOnly: string,
  liveSpend: number,
): Promise<number> {
  if (liveSpend > 0) return liveSpend;
  if (!client?.metaAdAccountId) return 0;
  try {
    const bq = await fetchVestiMetaSpendFromBigQuery(client.metaAdAccountId, dateFromOnly, dateToOnly);
    return bq.spend;
  } catch (err) {
    console.warn("[vesti] Meta spend BigQuery fallback failed:", err);
    return 0;
  }
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
  summary: {
    impactedCustomers: 0,
    attributedRevenue: 0,
    requestedValue: 0,
    fulfilledValue: 0,
    investment: 0,
    roas: 0,
    orders: 0,
    itemQuantity: 0,
    registrations: 0,
  },
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

  // Investimento (Meta Ads) — mesmo padrão do getScale/getMarketing: só
  // busca se o client tiver conta de anúncio configurada, senão fica 0
  // (não é bug, é cliente sem Meta Ads ligado ainda).
  const [client] = await db
    .select({ metaAdsApiKey: clientsTable.metaAdsApiKey, metaAdAccountId: clientsTable.metaAdAccountId })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));
  const metaAccessToken = getGlobalMetaAccessToken(client?.metaAdsApiKey);
  const metaCurrent =
    metaAccessToken && client?.metaAdAccountId
      ? await fetchMetaMarketingData({ accessToken: metaAccessToken, adAccountId: client.metaAdAccountId, since: dateFromOnly, until: dateToOnly }).catch((err) => {
          console.warn("[vesti-campaign-customers] Meta spend fetch failed:", err);
          return null;
        })
      : null;
  if (metaCurrent) await upsertMetaCreatives(clientId, metaCurrent.ads);
  const investment = await resolveVestiInvestment(client, dateFromOnly, dateToOnly, metaCurrent?.summary.spend ?? 0);

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
      requestedValue: attributed.reduce((sum, c) => sum + c.totalRequestedValue, 0),
      fulfilledValue: attributed.reduce((sum, c) => sum + c.totalPurchaseValue, 0),
      investment,
      roas: investment > 0 ? attributed.reduce((sum, c) => sum + c.totalPurchaseValue, 0) / investment : 0,
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

  const [currentWindow, prevWindow, breakdown, currentMediaSpend, prevMediaSpend] = await Promise.all([
    cached(`vesti:window:${dataset}:${dateFromOnly}:${dateToOnly}:{}`, 5 * 60 * 1000, () => computeVestiWindow(dataset, dateFromOnly, dateToOnly, {}, false)),
    cached(`vesti:window:${dataset}:${prevDateFromOnly}:${prevDateToOnly}:{}`, 5 * 60 * 1000, () => computeVestiWindow(dataset, prevDateFromOnly, prevDateToOnly, {}, false)),
    cached(`vesti:daily-breakdown:${dataset}:${dateFromOnly}:${dateToOnly}`, 5 * 60 * 1000, () => fetchVestiDailyBreakdown(dataset, dateFromOnly, dateToOnly)),
    resolveVestiInvestment(client, dateFromOnly, dateToOnly, metaCurrent?.summary.spend ?? 0),
    resolveVestiInvestment(client, prevDateFromOnly, prevDateToOnly, metaPrev?.summary.spend ?? 0),
  ]);

  const kpis = {
    approvedRevenue: currentWindow.kpis.revenue,
    sales: currentWindow.kpis.orders,
    avgTicket: currentWindow.kpis.avgTicket,
    mediaSpend: currentMediaSpend,
    costPerPurchase: currentWindow.kpis.orders > 0 ? currentMediaSpend / currentWindow.kpis.orders : 0,
    roas: currentMediaSpend > 0 ? currentWindow.kpis.revenue / currentMediaSpend : 0,
  };
  const prevKpis = {
    approvedRevenue: prevWindow.kpis.revenue,
    sales: prevWindow.kpis.orders,
    avgTicket: prevWindow.kpis.avgTicket,
    mediaSpend: prevMediaSpend,
    costPerPurchase: prevWindow.kpis.orders > 0 ? prevMediaSpend / prevWindow.kpis.orders : 0,
    roas: prevMediaSpend > 0 ? prevWindow.kpis.revenue / prevMediaSpend : 0,
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

  // Guarda de escala (05/08/2026): fetchVestiJourney puxa evento BRUTO
  // (não agregado) do stape_logs pra sequenciar por client_id em JS — em
  // períodos muito largos (testado: 431 dias/Vogabox = 111mil+ linhas) o
  // tempo passa dos 60s configurados no Vercel (vercel.json) e a função
  // é morta por FUNCTION_INVOCATION_TIMEOUT, sem nenhum erro visível pro
  // usuário (a tela simplesmente não carrega nada). Em vez de deixar
  // travar silencioso, avisa antes de tentar.
  const journeyDays = Math.ceil((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
  const JOURNEY_MAX_DAYS = 180;
  if (journeyDays > JOURNEY_MAX_DAYS) {
    res.status(400).json({
      error: true,
      code: "DATE_RANGE_TOO_WIDE",
      message: `Jornada não suporta períodos maiores que ${JOURNEY_MAX_DAYS} dias (pedido: ${journeyDays} dias). Reduza o período — a página monta o caminho evento a evento, e períodos muito largos derrubam a consulta por timeout.`,
      status: 400,
    });
    return;
  }

  const journey = await cached(`vesti:journey:${dataset}:${dateFromOnly}:${dateToOnly}`, 5 * 60 * 1000, () =>
    fetchVestiJourney(dataset, dateFromOnly, dateToOnly),
  );

  res.json(GetJourneyResponse.parse(journey));
}

const GetVestiScaleQueryParams = z.object({
  dateFrom: z.date().optional(),
  dateTo: z.date().optional(),
  simulatedSalesPower: z.coerce.number().positive().optional(),
  targetRevenue: z.coerce.number().positive().optional(),
});

// Status/projeção — mesma matemática do caminho B2C (routes/analytics.ts,
// /analytics/scale). Não depende de nada específico de BigQuery, só dos
// números já calculados, por isso fica aqui em vez de duplicar no service.
function vestiScaleStatus(params: { brokenGradePct: number; conversionRate: number; roas: number; salesPowerGap: number }): "ready" | "caution" | "blocked" {
  if (params.salesPowerGap > 0 && params.brokenGradePct > 35) return "blocked";
  if (params.brokenGradePct <= 20 && params.conversionRate >= 1.2 && params.roas >= 3 && params.salesPowerGap <= 0) return "ready";
  return "caution";
}

function vestiScaleInsights(params: {
  brand: string;
  currentSalesPower: number;
  simulatedSalesPower: number;
  monthlyTurnoverPct: number;
  monthlyRevenue: number;
  projectedRevenue: number;
  monthlyMediaSpend: number;
  projectedMediaSpend: number;
  roas: number;
  brokenGradePct: number;
  topCategories: Array<{ name: string; revenue: number }>;
  status: "ready" | "caution" | "blocked";
}): { headline: string; summary: string; actions: string[]; risks: string[]; source: "heuristic" } {
  const topCategory = params.topCategories[0]?.name ?? "categoria líder";
  const incrementalRevenue = Math.max(0, params.projectedRevenue - params.monthlyRevenue);
  const headline =
    params.status === "ready"
      ? "Projeto com bom espaço para escalar em ondas controladas"
      : params.status === "blocked"
        ? "Escala depende primeiro de profundidade e recomposição de grade"
        : "Escala possível, mas com trava operacional para acompanhar";
  return {
    headline,
    summary: `Com R$${params.simulatedSalesPower.toFixed(0)} de poder de venda e giro mensal de ${params.monthlyTurnoverPct.toFixed(1)}%, ${params.brand} pode mirar cerca de R$${params.projectedRevenue.toFixed(0)} por mês — um incremento de aproximadamente R$${incrementalRevenue.toFixed(0)} sobre a média recente.`,
    actions: [
      `Priorizar profundidade em ${topCategory}, principal categoria em receita no período.`,
      "Usar o poder de venda simulado como teto operacional pra não acelerar mídia em cima de estoque que não sustenta a receita projetada.",
      params.roas > 0
        ? `Manter ROAS de referência (${params.roas.toFixed(2)}x) como piso pra decidir se vale subir investimento em mídia.`
        : "Ainda não há gasto de mídia atribuível no período — vale validar se há investimento de mídia sendo feito fora do Meta Ads cadastrado.",
    ],
    risks: [
      `${params.brokenGradePct.toFixed(1)}% das grades de produto estão incompletas (falta tamanho/cor); isso reduz a eficiência de qualquer aumento de mídia.`,
    ],
    source: "heuristic",
  };
}

export async function getScale(req: Request, res: Response): Promise<void> {
  const parsed = GetVestiScaleQueryParams.safeParse(coerceDateQuery(req.query as Record<string, unknown>));
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
  const days = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
  const months = Math.max(1 / 30, days / 30);
  const rollingDateToOnly = dateToOnly;
  const rollingDateFromOnly = addDaysToDateOnly(rollingDateToOnly, -89);
  const rollingFrom = saoPauloDateOnlyStart(rollingDateFromOnly);
  const rollingTo = saoPauloDateOnlyEnd(rollingDateToOnly);
  const rollingMonths = 3;

  const scaleData = await cached(`vesti:scale:${dataset}:${dateFromOnly}:${dateToOnly}`, 5 * 60 * 1000, () =>
    fetchVestiScaleData(dataset, dateFromOnly, dateToOnly, rollingDateFromOnly, rollingDateToOnly),
  );

  const revenue = scaleData.revenue;
  const orders = scaleData.orders;
  const avgTicket = orders > 0 ? revenue / orders : 0;
  const monthlyRevenue = revenue / months;
  const monthlyOrders = orders / months;
  const monthlyTurnoverPct = scaleData.currentSalesPower > 0 ? (monthlyRevenue / scaleData.currentSalesPower) * 100 : 0;
  const periodTurnoverPct = scaleData.currentSalesPower > 0 ? (revenue / scaleData.currentSalesPower) * 100 : 0;
  const rollingRevenue = scaleData.rollingRevenue;
  const rollingOrders = scaleData.rollingOrders;
  const rollingMonthlyRevenue = rollingRevenue / rollingMonths;
  const rollingMonthlyOrders = rollingOrders / rollingMonths;
  const rollingAvgTicket = rollingOrders > 0 ? rollingRevenue / rollingOrders : 0;
  const rollingMonthlyTurnoverPct = scaleData.currentSalesPower > 0 ? (rollingMonthlyRevenue / scaleData.currentSalesPower) * 100 : 0;

  const metaAccessToken = getGlobalMetaAccessToken(client?.metaAdsApiKey);
  const [metaCurrent, metaRolling] = await Promise.all([
    metaAccessToken && client?.metaAdAccountId
      ? fetchMetaMarketingData({ accessToken: metaAccessToken, adAccountId: client.metaAdAccountId, since: dateFromOnly, until: dateToOnly }).catch((err) => {
          console.warn("[vesti-scale] Meta current fetch failed:", err);
          return null;
        })
      : Promise.resolve(null),
    metaAccessToken && client?.metaAdAccountId
      ? fetchMetaMarketingData({ accessToken: metaAccessToken, adAccountId: client.metaAdAccountId, since: rollingDateFromOnly, until: rollingDateToOnly }).catch((err) => {
          console.warn("[vesti-scale] Meta rolling fetch failed:", err);
          return null;
        })
      : Promise.resolve(null),
  ]);
  if (metaCurrent) await upsertMetaCreatives(clientId, metaCurrent.ads);

  const [mediaSpend, rollingMediaSpend] = await Promise.all([
    resolveVestiInvestment(client, dateFromOnly, dateToOnly, metaCurrent?.summary.spend ?? 0),
    resolveVestiInvestment(client, rollingDateFromOnly, rollingDateToOnly, metaRolling?.summary.spend ?? 0),
  ]);
  const monthlyMediaSpend = mediaSpend / months;
  const rollingMonthlyMediaSpend = rollingMediaSpend / rollingMonths;
  const roas = mediaSpend > 0 ? revenue / mediaSpend : 0;
  const cpa = orders > 0 ? mediaSpend / orders : 0;
  const rollingRoas = rollingMediaSpend > 0 ? rollingRevenue / rollingMediaSpend : 0;
  const rollingCpa = rollingOrders > 0 ? rollingMediaSpend / rollingOrders : 0;

  const sessions = scaleData.sessions;
  const rollingSessions = scaleData.rollingSessions;
  const conversionRate = sessions > 0 ? (orders / sessions) * 100 : 0;
  const rollingConversionRate = rollingSessions > 0 ? (rollingOrders / rollingSessions) * 100 : 0;

  const baselineTurnoverPct = rollingMonthlyTurnoverPct || monthlyTurnoverPct;
  const baselineRoas = rollingRoas || roas;
  const baselineAvgTicket = rollingAvgTicket || avgTicket;
  const targetRevenue = parsed.data.targetRevenue ?? Math.max(rollingMonthlyRevenue || monthlyRevenue, 0) * 1.5;
  const requiredSalesPower = baselineTurnoverPct > 0 ? targetRevenue / (baselineTurnoverPct / 100) : 0;
  const simulatedSalesPower = parsed.data.simulatedSalesPower ?? requiredSalesPower;
  const projectedRevenue = targetRevenue;
  const projectedMediaSpend = baselineRoas > 0 ? targetRevenue / baselineRoas : 0;
  const projectedOrders = baselineAvgTicket > 0 ? targetRevenue / baselineAvgTicket : 0;
  const projectedCpa = projectedOrders > 0 ? projectedMediaSpend / projectedOrders : 0;
  const salesPowerGap = Math.max(0, requiredSalesPower - scaleData.currentSalesPower);
  const revenueIncrement = Math.max(0, projectedRevenue - rollingMonthlyRevenue);
  const mediaSpendIncrement = Math.max(0, projectedMediaSpend - rollingMonthlyMediaSpend);
  const status = vestiScaleStatus({ brokenGradePct: scaleData.brokenGradePct, conversionRate: rollingConversionRate || conversionRate, roas: baselineRoas, salesPowerGap });

  const insights = vestiScaleInsights({
    brand: client?.name ?? "",
    currentSalesPower: scaleData.currentSalesPower,
    simulatedSalesPower: requiredSalesPower,
    monthlyTurnoverPct: baselineTurnoverPct,
    monthlyRevenue: rollingMonthlyRevenue || monthlyRevenue,
    projectedRevenue,
    monthlyMediaSpend: rollingMonthlyMediaSpend || monthlyMediaSpend,
    projectedMediaSpend,
    roas: baselineRoas,
    brokenGradePct: scaleData.brokenGradePct,
    topCategories: scaleData.categories,
    status,
  });

  res.json({
    client: { id: clientId, name: client?.name ?? "" },
    period: { from: dateFromOnly, to: dateToOnly, days },
    kpis: {
      currentSalesPower: scaleData.currentSalesPower,
      revenue,
      orders,
      availableStockUnits: scaleData.availableStockUnits,
      activeProducts: scaleData.activeProducts,
      availableProducts: scaleData.availableProducts,
      periodTurnoverPct,
      monthlyRevenue,
      monthlyOrders,
      avgTicket,
      monthlyTurnoverPct,
      mediaSpend,
      monthlyMediaSpend,
      roas,
      cpa,
      sessions,
      conversionRate,
      brokenGradePct: scaleData.brokenGradePct,
      brokenGradeCount: scaleData.brokenGradeCount,
      productGroupCount: scaleData.productGroupCount,
    },
    benchmarks: {
      windowDays: 90,
      from: rollingDateFromOnly,
      to: rollingDateToOnly,
      monthlyRevenue: rollingMonthlyRevenue,
      monthlyOrders: rollingMonthlyOrders,
      avgTicket: rollingAvgTicket,
      monthlyTurnoverPct: rollingMonthlyTurnoverPct,
      mediaSpend: rollingMediaSpend,
      monthlyMediaSpend: rollingMonthlyMediaSpend,
      roas: rollingRoas,
      cpa: rollingCpa,
      sessions: rollingSessions,
      conversionRate: rollingConversionRate,
    },
    projection: {
      targetRevenue,
      simulatedSalesPower,
      requiredSalesPower,
      projectedRevenue,
      projectedMediaSpend,
      projectedOrders,
      projectedCpa,
      revenueIncrement,
      mediaSpendIncrement,
      salesPowerGap,
      status,
      scenarios: [0.8, 1, 1.25].map((factor) => {
        const scenarioRevenue = targetRevenue * factor;
        const power = baselineTurnoverPct > 0 ? scenarioRevenue / (baselineTurnoverPct / 100) : 0;
        const scenarioMedia = baselineRoas > 0 ? scenarioRevenue / baselineRoas : 0;
        return {
          name: factor < 1 ? "Conservador" : factor === 1 ? "Base" : "Agressivo",
          salesPower: power,
          revenue: scenarioRevenue,
          mediaSpend: scenarioMedia,
          orders: baselineAvgTicket > 0 ? scenarioRevenue / baselineAvgTicket : 0,
        };
      }),
    },
    breakdowns: {
      categories: scaleData.categories,
      colors: scaleData.colors,
      sizes: scaleData.sizes,
      stockByCategory: scaleData.stockByCategory,
    },
    insights,
    generatedAt: new Date().toISOString(),
  });
}

export async function getMarketing(req: Request, res: Response): Promise<void> {
  const parsed = GetMarketingQueryParams.safeParse(coerceDateQuery(req.query as Record<string, unknown>));
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
    .select({ metaAdsApiKey: clientsTable.metaAdsApiKey, metaAdAccountId: clientsTable.metaAdAccountId })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));

  const { from, to } = dateRange(parsed.data.dateFrom, parsed.data.dateTo);
  const dateFromOnly = saoPauloDateOnly(from);
  const dateToOnly = saoPauloDateOnly(to);
  const periodMs = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - periodMs);
  const prevDateFromOnly = saoPauloDateOnly(prevFrom);
  const prevDateToOnly = saoPauloDateOnly(prevTo);
  const { creativesPage, creativesPageSize, utmSource } = parsed.data;

  const [channelData, prevChannelData] = await Promise.all([
    cached(`vesti:marketing:${dataset}:${dateFromOnly}:${dateToOnly}`, 5 * 60 * 1000, () => fetchVestiMarketingData(dataset, dateFromOnly, dateToOnly)),
    cached(`vesti:marketing:${dataset}:${prevDateFromOnly}:${prevDateToOnly}`, 5 * 60 * 1000, () => fetchVestiMarketingData(dataset, prevDateFromOnly, prevDateToOnly)),
  ]);

  const metaAccessToken = getGlobalMetaAccessToken(client?.metaAdsApiKey);
  const [metaCurrent, metaPrev] = await Promise.all([
    metaAccessToken && client?.metaAdAccountId
      ? fetchMetaMarketingData({ accessToken: metaAccessToken, adAccountId: client.metaAdAccountId, since: dateFromOnly, until: dateToOnly }).catch((err) => {
          console.warn("[vesti-marketing] Meta current fetch failed:", err);
          return null;
        })
      : Promise.resolve(null),
    metaAccessToken && client?.metaAdAccountId
      ? fetchMetaMarketingData({ accessToken: metaAccessToken, adAccountId: client.metaAdAccountId, since: prevDateFromOnly, until: prevDateToOnly }).catch((err) => {
          console.warn("[vesti-marketing] Meta previous fetch failed:", err);
          return null;
        })
      : Promise.resolve(null),
  ]);
  if (metaCurrent) await upsertMetaCreatives(clientId, metaCurrent.ads);

  const [spend, prevSpend] = await Promise.all([
    resolveVestiInvestment(client, dateFromOnly, dateToOnly, metaCurrent?.summary.spend ?? 0),
    resolveVestiInvestment(client, prevDateFromOnly, prevDateToOnly, metaPrev?.summary.spend ?? 0),
  ]);

  const buildKpis = (channel: typeof channelData, spend: number) => {
    const roas = spend > 0 ? channel.totalAttributedRevenue / spend : 0;
    const cpl = channel.totalLeads > 0 ? spend / channel.totalLeads : 0;
    const cpa = channel.approvedLeads > 0 ? spend / channel.approvedLeads : 0;
    return {
      totalSpend: spend,
      attributedRevenue: channel.totalAttributedRevenue,
      roas,
      totalLeads: channel.totalLeads,
      approvedLeads: channel.approvedLeads,
      approvalRate: channel.totalLeads > 0 ? (channel.approvedLeads / channel.totalLeads) * 100 : 0,
      cpl,
      cpa,
    };
  };

  const allAds = metaCurrent?.ads ?? [];
  const filteredAds = utmSource ? allAds.filter((ad) => ad.name.toLowerCase().includes(utmSource.toLowerCase())) : allAds;
  const creativesOffset = (creativesPage - 1) * creativesPageSize;
  const pagedAds = filteredAds.slice(creativesOffset, creativesOffset + creativesPageSize);

  // Imagem do criativo (05/08/2026): `fetchMetaMarketingData` já busca a
  // imagem real via uma chamada extra no Graph API, mas só pros top-N por
  // métrica (`metaCurrent.topCreatives` — evita 1 chamada por anúncio,
  // que seria caro/lento pra lista inteira). O `creatives` aqui embaixo
  // sempre mandava `imageUrl: null` fixo, mesmo pros anúncios que JÁ
  // tinham imagem buscada. Reaproveita o que já foi buscado em vez de
  // não usar de propósito.
  const creativeImageById = new Map<string, string | null>();
  for (const group of [metaCurrent?.topCreatives?.ctr, metaCurrent?.topCreatives?.cpl, metaCurrent?.topCreatives?.leads]) {
    for (const creative of group ?? []) {
      if (!creativeImageById.has(creative.id)) {
        creativeImageById.set(creative.id, creative.imageUrl ?? creative.thumbnailUrl ?? null);
      }
    }
  }

  const spendByDay = new Map<string, number>();
  for (const point of metaCurrent?.daily ?? []) {
    spendByDay.set(point.date, (spendByDay.get(point.date) ?? 0) + point.spend);
  }

  const parsedResponse = GetMarketingResponse.parse({
    kpis: buildKpis(channelData, spend),
    prevKpis: buildKpis(prevChannelData, prevSpend),
    leadsOverTime: channelData.leadsOverTime,
    revenueOverTime: channelData.revenueOverTime,
    spendOverTime: Array.from(spendByDay.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value })),
    creatives: pagedAds.map((ad) => ({
      id: ad.id,
      name: ad.name,
      platform: "Meta",
      status: ad.status ?? "UNKNOWN",
      imageUrl: creativeImageById.get(ad.id) ?? null,
      clicks: ad.clicks,
      impressions: ad.impressions,
      ctr: ad.impressions > 0 ? (ad.clicks / ad.impressions) * 100 : 0,
      leads: ad.leads,
      approvedLeads: ad.purchases,
      spend: ad.spend,
      attributedRevenue: ad.revenue,
      roas: ad.roas ?? 0,
      cpl: ad.cpl ?? 0,
      cpa: ad.cpa ?? 0,
    })),
    platformBreakdown: channelData.platformBreakdown.map((p) => ({
      platform: p.platform,
      spend: 0,
      leads: p.leads,
      approvedLeads: p.leads,
      clicks: 0,
      impressions: 0,
      attributedRevenue: p.attributedRevenue,
      roas: 0,
    })),
    stateBreakdown: [],
    ageBreakdown: [],
    creativesTotal: filteredAds.length,
  });
  // Diagnóstico temporário (05/08/2026) — sem acesso a log do Vercel dos
  // dois lados, expõe o erro real (se algum) da busca de imagem do
  // criativo direto na resposta, fora do schema (parse já rodou). Tirar
  // depois de achar a causa.
  res.json({ ...parsedResponse, _debugCreativeImageError: getLastCreativeFetchError() });
}

export async function getUtm(req: Request, res: Response): Promise<void> {
  const parsed = GetUtmQueryParams.safeParse(coerceDateQuery(req.query as Record<string, unknown>));
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
  const { utmSource } = parsed.data;

  const utmData = await cached(`vesti:utm:${dataset}:${dateFromOnly}:${dateToOnly}`, 5 * 60 * 1000, () => fetchVestiUtmData(dataset, dateFromOnly, dateToOnly));

  const rows = utmSource ? utmData.rows.filter((r) => r.source.toLowerCase() === utmSource.toLowerCase()) : utmData.rows;
  const totalRegistrations = rows.reduce((s, r) => s + r.registrations, 0);
  const totalApprovals = totalRegistrations;
  const totalBuyers = rows.reduce((s, r) => s + r.buyers, 0);
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const topRow = [...rows].sort((a, b) => b.revenue - a.revenue)[0] ?? null;

  res.json(
    GetUtmResponse.parse({
      kpis: {
        totalSessions: utmData.totalSessions,
        totalRegistrations,
        totalApprovals,
        approvalPct: totalRegistrations > 0 ? 100 : 0,
        totalBuyers,
        totalRevenue,
        conversionPct: totalRegistrations > 0 ? (totalBuyers / totalRegistrations) * 100 : 0,
        totalRoas: null,
        topSource: topRow?.source ?? null,
        topSourceRevenue: topRow?.revenue ?? 0,
      },
      rows,
    }),
  );
}
