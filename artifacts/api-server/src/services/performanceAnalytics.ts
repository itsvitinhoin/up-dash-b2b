import { eq, sql } from "drizzle-orm";
import { db, clientsTable, eventsTable } from "@workspace/db";
import { bigquery, vestiTable } from "../lib/bigquery";
import { fetchMetaMarketingData } from "./meta-ads";
import { fetchErpDashboard, matchErpDocumentsWithUpzero, matchErpDocumentsWithVestiAttribution, fetchVestiFunnelEventCounts } from "./erpAnalytics";
import {
  calculatePerformanceRatios,
  normalizePerformanceChannel,
  percentage,
} from "./performanceMetrics";

const CANCELLED_STATUSES = ["CANCELADO", "EXCLUIDO"];

function getMetaAccessToken(fallback?: string | null): string | null {
  return (
    process.env.META_ADS_API_KEY ??
    process.env.META_ACCESS_TOKEN ??
    process.env.META_API_KEY ??
    process.env.META_TOKEN ??
    fallback ??
    null
  );
}

function dateOnly(value: unknown): string {
  if (
    value &&
    typeof value === "object" &&
    "value" in (value as Record<string, unknown>)
  ) {
    return String((value as { value: unknown }).value);
  }
  return String(value);
}

type CustomerDayRow = {
  date: unknown;
  customer_id: string | null;
  customer_name: string | null;
  company: string | null;
  document: string | null;
  state: string | null;
  orders: number | string;
  net_revenue: number | string;
  quantity: number | string;
  historical_orders: number | string | null;
  is_identified: boolean | null;
};

type BreakdownRow = {
  dimension: "color" | "size" | "state";
  name: string;
  value: number | string;
};

type EventSummaryRow = {
  visits: number | string;
  registrations: number | string;
  approvals: number | string;
  product_views: number | string;
  add_to_cart: number | string;
  checkouts: number | string;
  purchases: number | string;
};

type PerformanceStage = {
  key: string;
  label: string;
  value: number;
  previousRate: number | null;
  overallRate: number | null;
  source: "Meta Ads" | "UP Zero" | "ERP";
};

type PerformanceQualityItem = {
  key: string;
  label: string;
  value: number;
  status: "good" | "attention" | "critical";
  detail: string;
};

export type PerformanceDashboard = {
  generatedAt: string;
  sources: {
    erp: { status: "connected"; label: string };
    ecommerce: {
      status: "connected" | "unavailable";
      label: string;
      message: string | null;
    };
    media: {
      status: "connected" | "unavailable" | "not_configured";
      label: string;
      message: string | null;
    };
  };
  kpis: {
    grossRevenue: number;
    netRevenue: number;
    returnAmount: number;
    attributedRevenue: number;
    unattributedRevenue: number;
    mediaSpend: number;
    roas: number | null;
    mer: number | null;
    cogs: number;
    grossProfit: number;
    roi: number | null;
    roiStatus: "available" | "partial" | "unavailable";
    costCoveragePct: number;
    orders: number;
    attributedOrders: number;
    attributionCoveragePct: number;
    uniqueBuyers: number;
    newBuyers: number;
    returningBuyers: number;
    retentionPct: number;
    totalQuantity: number;
    returnedQuantity: number;
    discountAmount: number;
    cancelledOrders: number;
    cancelledAmount: number;
    averageTicket: number;
    avgItemsPerOrder: number;
    returnRatePct: number;
    discountRatePct: number;
    grossMarginPct: number;
    attributedBuyers: number;
    newAttributedBuyers: number;
    revenueAttributionCoveragePct: number;
    impressions: number;
    clicks: number;
    leads: number;
    metaPurchases: number;
    ctr: number;
    cpc: number | null;
    cpl: number | null;
    cac: number | null;
  };
  reconciliation: Array<{ label: string; value: number; detail: string }>;
  daily: Array<{
    date: string;
    revenue: number;
    attributedRevenue: number;
    spend: number;
    orders: number;
  }>;
  channels: Array<{
    channel: string;
    spend: number;
    revenue: number;
    orders: number;
    roas: number | null;
  }>;
  breakdowns: {
    colors: Array<{ name: string; value: number }>;
    sizes: Array<{ name: string; value: number }>;
    states: Array<{ name: string; value: number }>;
  };
  funnel: PerformanceStage[];
  quality: PerformanceQualityItem[];
  campaigns: Array<{
    id: string;
    name: string;
    spend: number;
    leads: number;
    purchases: number;
    revenue: number;
    orders: number;
    roas: number | null;
    cpl: number | null;
  }>;
  buyerTypeByDocument: Record<string, "NEW" | "RETURNING">;
};

function normalizedCampaignKey(value: string | null | undefined): string {
  return value?.toLowerCase().replace(/\s+/g, " ").trim() ?? "";
}

function qualityStatus(
  value: number,
  good: number,
  attention: number,
): PerformanceQualityItem["status"] {
  if (value >= good) return "good";
  if (value >= attention) return "attention";
  return "critical";
}

export async function fetchPerformanceDashboard(
  clientId: string,
  dataset: string,
  dateFrom: string,
  dateTo: string,
): Promise<PerformanceDashboard> {
  const pedidos = vestiTable(dataset, "pedidos_erp");
  const clientes = vestiTable(dataset, "clientes_erp");
  const cancelledList = CANCELLED_STATUSES.map((status) => `'${status}'`).join(
    ", ",
  );

  const customerDayQuery = `
    WITH all_orders AS (
      SELECT
        pedido_id,
        ANY_VALUE(customer_id) AS customer_id,
        ANY_VALUE(status) AS status,
        ANY_VALUE(valor_liquido) AS net_amount,
        SUM(COALESCE(item_quantidade, 0)) AS quantity,
        ANY_VALUE(DATE(data_criado)) AS date
      FROM ${pedidos}
      GROUP BY pedido_id
    ),
    customer_history AS (
      SELECT
        REGEXP_REPLACE(CAST(customer_id AS STRING), r'[^0-9]', '') AS document,
        COUNT(*) AS historical_orders
      FROM all_orders
      WHERE customer_id IS NOT NULL AND status NOT IN (${cancelledList})
      GROUP BY document
    ),
    customer_dimension AS (
      SELECT * EXCEPT(row_number) FROM (
        SELECT
          REGEXP_REPLACE(CAST(documento AS STRING), r'[^0-9]', '') AS document,
          nome AS customer_name,
          marca AS company,
          estado AS state,
          ROW_NUMBER() OVER (
            PARTITION BY REGEXP_REPLACE(CAST(documento AS STRING), r'[^0-9]', '')
            ORDER BY data_alterado DESC
          ) AS row_number
        FROM ${clientes}
        WHERE documento IS NOT NULL
      )
      WHERE row_number = 1
    )
    SELECT
      o.date,
      o.customer_id,
      d.customer_name,
      d.company,
      d.document,
      d.state,
      COUNT(*) AS orders,
      SUM(o.net_amount) AS net_revenue,
      SUM(o.quantity) AS quantity,
      ANY_VALUE(h.historical_orders) AS historical_orders,
      LOGICAL_OR(d.document IS NOT NULL) AS is_identified
    FROM all_orders o
    LEFT JOIN customer_dimension d
      ON d.document = REGEXP_REPLACE(CAST(o.customer_id AS STRING), r'[^0-9]', '')
    LEFT JOIN customer_history h
      ON h.document = REGEXP_REPLACE(CAST(o.customer_id AS STRING), r'[^0-9]', '')
    WHERE o.date BETWEEN @dateFrom AND @dateTo
      AND o.status NOT IN (${cancelledList})
    GROUP BY o.date, o.customer_id, d.customer_name, d.company, d.document, d.state
    ORDER BY o.date
  `;

  const itemSummaryQuery = `
    WITH valid_orders AS (
      SELECT pedido_id, ANY_VALUE(status) AS status, ANY_VALUE(DATE(data_criado)) AS date
      FROM ${pedidos}
      GROUP BY pedido_id
    )
    SELECT
      COALESCE(SUM(IF(COALESCE(p.item_preco_custo, 0) > 0, p.item_preco_custo * p.item_quantidade, 0)), 0) AS cogs,
      COALESCE(SUM(IF(COALESCE(p.item_preco_custo, 0) > 0, p.item_quantidade, 0)), 0) AS costed_quantity,
      COALESCE(SUM(p.item_quantidade), 0) AS total_quantity
    FROM ${pedidos} p
    JOIN valid_orders o USING (pedido_id)
    WHERE o.date BETWEEN @dateFrom AND @dateTo
      AND o.status NOT IN (${cancelledList})
  `;

  const breakdownQuery = `
    WITH valid_orders AS (
      SELECT pedido_id, ANY_VALUE(status) AS status, ANY_VALUE(DATE(data_criado)) AS date
      FROM ${pedidos}
      GROUP BY pedido_id
    ),
    items AS (
      SELECT p.*
      FROM ${pedidos} p
      JOIN valid_orders o USING (pedido_id)
      WHERE o.date BETWEEN @dateFrom AND @dateTo
        AND o.status NOT IN (${cancelledList})
    ),
    order_states AS (
      SELECT
        p.pedido_id,
        ANY_VALUE(p.customer_id) AS customer_id,
        ANY_VALUE(p.valor_liquido) AS net_amount
      FROM items p
      GROUP BY p.pedido_id
    ),
    customer_states AS (
      SELECT
        REGEXP_REPLACE(CAST(documento AS STRING), r'[^0-9]', '') AS document,
        ANY_VALUE(NULLIF(TRIM(estado), '')) AS state
      FROM ${clientes}
      WHERE documento IS NOT NULL
      GROUP BY document
    )
    SELECT 'color' AS dimension, COALESCE(NULLIF(TRIM(item_cor), ''), 'Não informado') AS name, SUM(item_quantidade) AS value
    FROM items GROUP BY name
    UNION ALL
    SELECT 'size' AS dimension, COALESCE(NULLIF(TRIM(item_tamanho), ''), 'Não informado') AS name, SUM(item_quantidade) AS value
    FROM items GROUP BY name
    UNION ALL
    SELECT 'state' AS dimension, COALESCE(s.state, 'Não informado') AS name, SUM(o.net_amount) AS value
    FROM order_states o
    LEFT JOIN customer_states s
      ON s.document = REGEXP_REPLACE(CAST(o.customer_id AS STRING), r'[^0-9]', '')
    GROUP BY name
  `;

  let ecommerceStatus: PerformanceDashboard["sources"]["ecommerce"]["status"] =
    "connected";
  let ecommerceMessage: string | null = null;
  const eventSummaryPromise = db
    .execute<EventSummaryRow>(
      sql`
      SELECT
        COUNT(*) FILTER (WHERE ${eventsTable.eventType} = 'VISIT')::int AS visits,
        COUNT(*) FILTER (WHERE ${eventsTable.eventType} = 'REGISTRATION')::int AS registrations,
        COUNT(*) FILTER (WHERE ${eventsTable.eventType} = 'APPROVED_REGISTRATION')::int AS approvals,
        COUNT(*) FILTER (WHERE ${eventsTable.eventType} = 'PRODUCT_VIEW')::int AS product_views,
        COUNT(*) FILTER (WHERE ${eventsTable.eventType} = 'ADD_TO_CART')::int AS add_to_cart,
        COUNT(*) FILTER (WHERE ${eventsTable.eventType} = 'CHECKOUT_STARTED')::int AS checkouts,
        COUNT(*) FILTER (WHERE ${eventsTable.eventType} = 'PURCHASE')::int AS purchases
      FROM ${eventsTable}
      WHERE ${eventsTable.clientId} = ${clientId}
        AND DATE(timezone('America/Sao_Paulo', ${eventsTable.createdAt}))
          BETWEEN ${dateFrom}::date AND ${dateTo}::date
    `,
    )
    .catch((error) => {
      ecommerceStatus = "unavailable";
      ecommerceMessage =
        "Os eventos da UP Zero não responderam nesta conciliação.";
      console.warn("[performance] Ecommerce events unavailable:", error);
      return { rows: [] as EventSummaryRow[] };
    });

  const [
    erp,
    customerDayResult,
    itemSummaryResult,
    breakdownResult,
    eventSummaryResult,
    clientRows,
  ] = await Promise.all([
    fetchErpDashboard(clientId, dataset, dateFrom, dateTo),
    bigquery.query({ query: customerDayQuery, params: { dateFrom, dateTo } }),
    bigquery.query({ query: itemSummaryQuery, params: { dateFrom, dateTo } }),
    bigquery.query({ query: breakdownQuery, params: { dateFrom, dateTo } }),
    eventSummaryPromise,
    db
      .select({
        metaAdsApiKey: clientsTable.metaAdsApiKey,
        metaAdAccountId: clientsTable.metaAdAccountId,
      })
      .from(clientsTable)
      .where(eq(clientsTable.id, clientId)),
  ]);

  const customerDays = customerDayResult[0] as CustomerDayRow[];
  const documents = customerDays.map((row) => row.document ?? row.customer_id);
  const matches = await matchErpDocumentsWithUpzero(clientId, documents);
  // Client Vesti nativo não tem comprador nenhum rastreado no Postgres (ver
  // matchErpDocumentsWithVestiAttribution) — preenche só o que a UpZero não
  // achou, sem sobrescrever um match que já veio de lá.
  const unmatchedDocuments = documents.filter((doc) => {
    const normalized = doc ? String(doc).replace(/[^0-9]/g, "") : null;
    return normalized && !matches.has(String(doc));
  });
  if (unmatchedDocuments.length > 0) {
    const vestiMatches = await matchErpDocumentsWithVestiAttribution(dataset, unmatchedDocuments);
    for (const doc of unmatchedDocuments) {
      const normalized = String(doc).replace(/[^0-9]/g, "");
      const vestiMatch = vestiMatches.get(normalized);
      if (vestiMatch) matches.set(String(doc), vestiMatch);
    }
  }
  const client = clientRows[0];
  const token = getMetaAccessToken(client?.metaAdsApiKey);

  let mediaStatus: PerformanceDashboard["sources"]["media"]["status"] =
    "not_configured";
  let mediaMessage: string | null =
    "Conta de anúncios Meta não configurada para este cliente.";
  let mediaSpend = 0;
  let mediaDaily: Array<{ date: string; spend: number }> = [];
  let mediaSummary = {
    impressions: 0,
    clicks: 0,
    leads: 0,
    purchases: 0,
    cpl: null as number | null,
  };
  let mediaCampaigns: Array<{
    id: string;
    name: string;
    spend: number;
    leads: number;
    purchases: number;
    cpl: number | null;
  }> = [];
  if (token && client?.metaAdAccountId) {
    try {
      const meta = await fetchMetaMarketingData({
        accessToken: token,
        adAccountId: client.metaAdAccountId,
        since: dateFrom,
        until: dateTo,
      });
      mediaSpend = meta.summary.spend;
      mediaSummary = meta.summary;
      mediaDaily = meta.daily.map((point) => ({
        date: point.date,
        spend: point.spend,
      }));
      mediaCampaigns = meta.campaigns.map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        spend: campaign.spend,
        leads: campaign.leads,
        purchases: campaign.purchases,
        cpl: campaign.cpl,
      }));
      mediaStatus = "connected";
      mediaMessage = null;
    } catch (error) {
      mediaStatus = "unavailable";
      mediaMessage =
        "A Meta Ads não respondeu nesta conciliação. Tente atualizar novamente.";
      console.warn("[performance] Meta insights unavailable:", error);
    }
  }

  const dailyMap = new Map<
    string,
    {
      date: string;
      revenue: number;
      attributedRevenue: number;
      spend: number;
      orders: number;
    }
  >();
  for (const point of erp.dailyRevenue) {
    dailyMap.set(point.date, {
      date: point.date,
      revenue: point.value,
      attributedRevenue: 0,
      spend: 0,
      orders:
        erp.dailyOrders.find((order) => order.date === point.date)?.value ?? 0,
    });
  }
  for (const point of mediaDaily) {
    const current = dailyMap.get(point.date) ?? {
      date: point.date,
      revenue: 0,
      attributedRevenue: 0,
      spend: 0,
      orders: 0,
    };
    current.spend = point.spend;
    dailyMap.set(point.date, current);
  }

  const channelMap = new Map<
    string,
    {
      channel: string;
      spend: number;
      revenue: number;
      orders: number;
      roas: number | null;
    }
  >();
  const periodBuyerDocuments = new Set<string>();
  const matchedBuyerDocuments = new Set<string>();
  const attributedBuyerDocuments = new Set<string>();
  const campaignRevenueMap = new Map<
    string,
    { name: string; revenue: number; orders: number }
  >();
  const buyerTypeByDocument: Record<string, "NEW" | "RETURNING"> = {};
  let attributedOrders = 0;
  let attributedRevenue = 0;
  let ecommerceMatchedOrders = 0;

  for (const row of customerDays) {
    const document = row.document ?? row.customer_id;
    const orders = Number(row.orders) || 0;
    const revenue = Number(row.net_revenue) || 0;
    const day = dateOnly(row.date);
    const match = document ? matches.get(document) : undefined;
    const historicalOrders = Number(row.historical_orders) || 0;

    if (row.is_identified && document) {
      periodBuyerDocuments.add(document);
      buyerTypeByDocument[document] =
        historicalOrders > 1 ? "RETURNING" : "NEW";
    }
    if (match && document) {
      matchedBuyerDocuments.add(document);
      ecommerceMatchedOrders += orders;
    }
    if (!match?.attribution) continue;

    attributedOrders += orders;
    attributedRevenue += revenue;
    if (document) attributedBuyerDocuments.add(document);
    const daily = dailyMap.get(day) ?? {
      date: day,
      revenue: 0,
      attributedRevenue: 0,
      spend: 0,
      orders: 0,
    };
    daily.attributedRevenue += revenue;
    dailyMap.set(day, daily);

    const channel = normalizePerformanceChannel(match.attribution);
    const current = channelMap.get(channel) ?? {
      channel,
      spend: 0,
      revenue: 0,
      orders: 0,
      roas: null,
    };
    current.revenue += revenue;
    current.orders += orders;
    channelMap.set(channel, current);

    const campaignName = match.attribution.utmCampaign?.trim();
    if (campaignName) {
      const campaignKey = normalizedCampaignKey(campaignName);
      const campaign = campaignRevenueMap.get(campaignKey) ?? {
        name: campaignName,
        revenue: 0,
        orders: 0,
      };
      campaign.revenue += revenue;
      campaign.orders += orders;
      campaignRevenueMap.set(campaignKey, campaign);
    }
  }

  if (mediaStatus === "connected") {
    const meta = channelMap.get("Meta") ?? {
      channel: "Meta",
      spend: 0,
      revenue: 0,
      orders: 0,
      roas: null,
    };
    meta.spend = mediaSpend;
    channelMap.set("Meta", meta);
  }
  for (const channel of channelMap.values()) {
    channel.roas = channel.spend > 0 ? channel.revenue / channel.spend : null;
  }

  const itemSummary = (
    itemSummaryResult[0] as Array<Record<string, unknown>>
  )[0];
  const cogs = Number(itemSummary?.cogs) || 0;
  const costedQuantity = Number(itemSummary?.costed_quantity) || 0;
  const itemQuantity = Number(itemSummary?.total_quantity) || 0;
  const costCoveragePct = percentage(costedQuantity, itemQuantity);
  const ratios = calculatePerformanceRatios({
    netRevenue: erp.kpis.netRevenue,
    attributedRevenue,
    mediaSpend,
    cogs,
    returnAmount: erp.kpis.returnAmount,
    costCoveragePct,
  });

  const breakdownRows = breakdownResult[0] as BreakdownRow[];
  const buildBreakdown = (dimension: BreakdownRow["dimension"]) => {
    const rows = breakdownRows
      .filter((row) => row.dimension === dimension)
      .map((row) => ({ name: row.name, rawValue: Number(row.value) || 0 }))
      .sort((a, b) => b.rawValue - a.rawValue)
      .slice(0, 8);
    const total = breakdownRows
      .filter((row) => row.dimension === dimension)
      .reduce((sum, row) => sum + (Number(row.value) || 0), 0);
    return rows.map((row) => ({
      name: row.name,
      value: percentage(row.rawValue, total),
    }));
  };

  const newBuyers = Object.values(buyerTypeByDocument).filter(
    (type) => type === "NEW",
  ).length;
  const returningBuyers = Object.values(buyerTypeByDocument).filter(
    (type) => type === "RETURNING",
  ).length;
  const newAttributedBuyers = Array.from(attributedBuyerDocuments).filter(
    (document) => buyerTypeByDocument[document] === "NEW",
  ).length;
  const eventSummary = eventSummaryResult.rows[0] ?? ({} as EventSummaryRow);
  let eventCounts = {
    visits: Number(eventSummary.visits) || 0,
    registrations: Number(eventSummary.registrations) || 0,
    approvals: Number(eventSummary.approvals) || 0,
    productViews: Number(eventSummary.product_views) || 0,
    addToCart: Number(eventSummary.add_to_cart) || 0,
    checkouts: Number(eventSummary.checkouts) || 0,
    purchases: Number(eventSummary.purchases) || 0,
  };
  // Client Vesti nativo não tem evento nenhum na tabela `events` do
  // Postgres (rastreamento é via stape_logs/BigQuery) — as 5 etapas do
  // funil ficavam sempre em 0. Heurística: se as 4 etapas de evento vierem
  // todas zeradas, tenta o equivalente Vesti antes de assumir que é zero
  // de verdade (client pequeno/sem tráfego no período).
  if (
    eventCounts.registrations === 0 &&
    eventCounts.addToCart === 0 &&
    eventCounts.checkouts === 0 &&
    eventCounts.purchases === 0
  ) {
    const vestiFunnel = await fetchVestiFunnelEventCounts(dataset, dateFrom, dateTo);
    eventCounts = { ...eventCounts, ...vestiFunnel };
  }
  const funnelValues = [
    {
      key: "clicks",
      label: "Cliques pagos",
      value: mediaSummary.clicks,
      source: "Meta Ads" as const,
    },
    {
      key: "registrations",
      label: "Cadastros",
      value: eventCounts.registrations,
      source: "UP Zero" as const,
    },
    {
      key: "approvals",
      label: "Cadastros aprovados",
      value: eventCounts.approvals,
      source: "UP Zero" as const,
    },
    {
      key: "add_to_cart",
      label: "Adições ao carrinho",
      value: eventCounts.addToCart,
      source: "UP Zero" as const,
    },
    {
      key: "checkout",
      label: "Checkouts iniciados",
      value: eventCounts.checkouts,
      source: "UP Zero" as const,
    },
    {
      key: "ecommerce_orders",
      label: "Pedidos no e-commerce",
      value: eventCounts.purchases,
      source: "UP Zero" as const,
    },
    {
      key: "erp_orders",
      label: "Pedidos no ERP",
      value: erp.kpis.orders,
      source: "ERP" as const,
    },
    {
      key: "attributed_orders",
      label: "Pedidos atribuídos",
      value: attributedOrders,
      source: "ERP" as const,
    },
  ];
  const funnel: PerformanceStage[] = funnelValues.map((stage, index) => ({
    ...stage,
    previousRate:
      index === 0
        ? null
        : percentage(stage.value, funnelValues[index - 1]?.value ?? 0),
    overallRate:
      index === 0 ? null : percentage(stage.value, funnelValues[0]?.value ?? 0),
  }));

  const allBuyerDocuments = new Set(
    customerDays
      .map((row) => row.document ?? row.customer_id)
      .filter((document): document is string => Boolean(document)),
  );
  const documentCoveragePct = percentage(
    periodBuyerDocuments.size,
    allBuyerDocuments.size,
  );
  const ecommerceMatchCoveragePct = percentage(
    matchedBuyerDocuments.size,
    allBuyerDocuments.size,
  );
  const attributionCoveragePct = percentage(attributedOrders, erp.kpis.orders);
  const quality: PerformanceQualityItem[] = [
    {
      key: "documents",
      label: "Identificação por documento",
      value: documentCoveragePct,
      status: qualityStatus(documentCoveragePct, 95, 80),
      detail: `${periodBuyerDocuments.size} de ${allBuyerDocuments.size} comprador(es) com CPF/CNPJ`,
    },
    {
      key: "ecommerce_match",
      label: "Conciliação com e-commerce",
      value: ecommerceMatchCoveragePct,
      status: qualityStatus(ecommerceMatchCoveragePct, 85, 60),
      detail: `${matchedBuyerDocuments.size} comprador(es) encontrados na UP Zero`,
    },
    {
      key: "cost",
      label: "Cobertura de custo",
      value: costCoveragePct,
      status: qualityStatus(costCoveragePct, 95, 75),
      detail: `${costedQuantity} de ${itemQuantity} peça(s) com custo conhecido`,
    },
    {
      key: "attribution",
      label: "Cobertura de atribuição",
      value: attributionCoveragePct,
      status: qualityStatus(attributionCoveragePct, 60, 30),
      detail: `${attributedOrders} de ${erp.kpis.orders} pedido(s) com evidência paga`,
    },
  ];

  const campaignKeysFromMeta = new Set(
    mediaCampaigns.map((campaign) => normalizedCampaignKey(campaign.name)),
  );
  const campaigns = [
    ...mediaCampaigns.map((campaign) => {
      const attribution = campaignRevenueMap.get(
        normalizedCampaignKey(campaign.name),
      );
      return {
        ...campaign,
        revenue: attribution?.revenue ?? 0,
        orders: attribution?.orders ?? 0,
        roas:
          campaign.spend > 0
            ? (attribution?.revenue ?? 0) / campaign.spend
            : null,
      };
    }),
    ...Array.from(campaignRevenueMap.entries())
      .filter(([key]) => !campaignKeysFromMeta.has(key))
      .map(([, campaign], index) => ({
        id: `attribution-${index}`,
        name: campaign.name,
        spend: 0,
        leads: 0,
        purchases: 0,
        cpl: null,
        revenue: campaign.revenue,
        orders: campaign.orders,
        roas: null,
      })),
  ].sort((a, b) => b.revenue - a.revenue || b.spend - a.spend);

  return {
    generatedAt: new Date().toISOString(),
    sources: {
      erp: { status: "connected", label: `Miré · ${dataset}` },
      ecommerce: {
        status: ecommerceStatus,
        label: "UP Zero · documento + evidência paga",
        message: ecommerceMessage,
      },
      media: { status: mediaStatus, label: "Meta Ads", message: mediaMessage },
    },
    kpis: {
      grossRevenue: erp.kpis.grossRevenue,
      netRevenue: erp.kpis.netRevenue,
      returnAmount: erp.kpis.returnAmount,
      attributedRevenue,
      unattributedRevenue: Math.max(0, erp.kpis.netRevenue - attributedRevenue),
      mediaSpend,
      roas: ratios.roas,
      mer: ratios.mer,
      cogs,
      grossProfit: ratios.grossProfit,
      roi: ratios.roi,
      roiStatus: ratios.roiStatus,
      costCoveragePct,
      orders: erp.kpis.orders,
      attributedOrders,
      attributionCoveragePct: percentage(attributedOrders, erp.kpis.orders),
      uniqueBuyers: periodBuyerDocuments.size,
      newBuyers,
      returningBuyers,
      retentionPct: percentage(returningBuyers, periodBuyerDocuments.size),
      totalQuantity: erp.kpis.totalQuantity,
      returnedQuantity: erp.kpis.returnedQuantity,
      discountAmount: erp.kpis.discountAmount,
      cancelledOrders: erp.kpis.cancelledOrders,
      cancelledAmount: erp.kpis.cancelledAmount,
      averageTicket: erp.kpis.avgTicket,
      avgItemsPerOrder: erp.kpis.avgItemsPerOrder,
      returnRatePct: erp.kpis.returnRatePct,
      discountRatePct: erp.kpis.discountRatePct,
      grossMarginPct: percentage(
        ratios.grossProfit,
        Math.max(0, erp.kpis.netRevenue - erp.kpis.returnAmount),
      ),
      attributedBuyers: attributedBuyerDocuments.size,
      newAttributedBuyers,
      revenueAttributionCoveragePct: percentage(
        attributedRevenue,
        erp.kpis.netRevenue,
      ),
      impressions: mediaSummary.impressions,
      clicks: mediaSummary.clicks,
      leads: mediaSummary.leads,
      metaPurchases: mediaSummary.purchases,
      ctr: percentage(mediaSummary.clicks, mediaSummary.impressions),
      cpc: mediaSummary.clicks > 0 ? mediaSpend / mediaSummary.clicks : null,
      cpl: mediaSummary.cpl,
      cac: newAttributedBuyers > 0 ? mediaSpend / newAttributedBuyers : null,
    },
    reconciliation: [
      {
        label: "Pedidos no ERP",
        value: erp.kpis.orders,
        detail: "Pedidos válidos no período",
      },
      {
        label: "Identificados no e-commerce",
        value: ecommerceMatchedOrders,
        detail: `${matchedBuyerDocuments.size} comprador(es) conciliado(s)`,
      },
      {
        label: "Pedidos atribuídos",
        value: attributedOrders,
        detail: `${attributedBuyerDocuments.size} comprador(es) com evidência paga`,
      },
      {
        label: "Sem evidência paga",
        value: Math.max(0, erp.kpis.orders - attributedOrders),
        detail: "Orgânico, direto ou sem identificação",
      },
    ],
    daily: Array.from(dailyMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    ),
    channels: Array.from(channelMap.values()).sort(
      (a, b) => b.revenue - a.revenue,
    ),
    breakdowns: {
      colors: buildBreakdown("color"),
      sizes: buildBreakdown("size"),
      states: buildBreakdown("state"),
    },
    funnel,
    quality,
    campaigns,
    buyerTypeByDocument,
  };
}
