import { eq } from "drizzle-orm";
import { db, clientsTable } from "@workspace/db";
import { bigquery, vestiTable } from "../lib/bigquery";
import { fetchMetaMarketingData } from "./meta-ads";
import {
  fetchErpDashboard,
  matchErpDocumentsWithUpzero,
} from "./erpAnalytics";
import {
  calculatePerformanceRatios,
  normalizePerformanceChannel,
  percentage,
} from "./performanceMetrics";

const CANCELLED_STATUSES = ["CANCELADO", "EXCLUIDO"];

function getMetaAccessToken(fallback?: string | null): string | null {
  return process.env.META_ADS_API_KEY
    ?? process.env.META_ACCESS_TOKEN
    ?? process.env.META_API_KEY
    ?? process.env.META_TOKEN
    ?? fallback
    ?? null;
}

function dateOnly(value: unknown): string {
  if (value && typeof value === "object" && "value" in (value as Record<string, unknown>)) {
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

export type PerformanceDashboard = {
  generatedAt: string;
  sources: {
    erp: { status: "connected"; label: string };
    ecommerce: { status: "connected"; label: string };
    media: { status: "connected" | "unavailable" | "not_configured"; label: string; message: string | null };
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
  };
  reconciliation: Array<{ label: string; value: number; detail: string }>;
  daily: Array<{ date: string; revenue: number; attributedRevenue: number; spend: number; orders: number }>;
  channels: Array<{ channel: string; spend: number; revenue: number; orders: number; roas: number | null }>;
  breakdowns: {
    colors: Array<{ name: string; value: number }>;
    sizes: Array<{ name: string; value: number }>;
    states: Array<{ name: string; value: number }>;
  };
  buyerTypeByDocument: Record<string, "NEW" | "RETURNING">;
};

export async function fetchPerformanceDashboard(
  clientId: string,
  dataset: string,
  dateFrom: string,
  dateTo: string,
): Promise<PerformanceDashboard> {
  const pedidos = vestiTable(dataset, "pedidos_erp");
  const clientes = vestiTable(dataset, "clientes_erp");
  const cancelledList = CANCELLED_STATUSES.map((status) => `'${status}'`).join(", ");

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

  const [erp, customerDayResult, itemSummaryResult, breakdownResult, clientRows] = await Promise.all([
    fetchErpDashboard(clientId, dataset, dateFrom, dateTo),
    bigquery.query({ query: customerDayQuery, params: { dateFrom, dateTo } }),
    bigquery.query({ query: itemSummaryQuery, params: { dateFrom, dateTo } }),
    bigquery.query({ query: breakdownQuery, params: { dateFrom, dateTo } }),
    db.select({
      metaAdsApiKey: clientsTable.metaAdsApiKey,
      metaAdAccountId: clientsTable.metaAdAccountId,
    }).from(clientsTable).where(eq(clientsTable.id, clientId)),
  ]);

  const customerDays = customerDayResult[0] as CustomerDayRow[];
  const documents = customerDays.map((row) => row.document ?? row.customer_id);
  const matches = await matchErpDocumentsWithUpzero(clientId, documents);
  const client = clientRows[0];
  const token = getMetaAccessToken(client?.metaAdsApiKey);

  let mediaStatus: PerformanceDashboard["sources"]["media"]["status"] = "not_configured";
  let mediaMessage: string | null = "Conta de anúncios Meta não configurada para este cliente.";
  let mediaSpend = 0;
  let mediaDaily: Array<{ date: string; spend: number }> = [];
  if (token && client?.metaAdAccountId) {
    try {
      const meta = await fetchMetaMarketingData({
        accessToken: token,
        adAccountId: client.metaAdAccountId,
        since: dateFrom,
        until: dateTo,
      });
      mediaSpend = meta.summary.spend;
      mediaDaily = meta.daily.map((point) => ({ date: point.date, spend: point.spend }));
      mediaStatus = "connected";
      mediaMessage = null;
    } catch (error) {
      mediaStatus = "unavailable";
      mediaMessage = "A Meta Ads não respondeu nesta conciliação. Tente atualizar novamente.";
      console.warn("[performance] Meta insights unavailable:", error);
    }
  }

  const dailyMap = new Map<string, { date: string; revenue: number; attributedRevenue: number; spend: number; orders: number }>();
  for (const point of erp.dailyRevenue) {
    dailyMap.set(point.date, {
      date: point.date,
      revenue: point.value,
      attributedRevenue: 0,
      spend: 0,
      orders: erp.dailyOrders.find((order) => order.date === point.date)?.value ?? 0,
    });
  }
  for (const point of mediaDaily) {
    const current = dailyMap.get(point.date) ?? { date: point.date, revenue: 0, attributedRevenue: 0, spend: 0, orders: 0 };
    current.spend = point.spend;
    dailyMap.set(point.date, current);
  }

  const channelMap = new Map<string, { channel: string; spend: number; revenue: number; orders: number; roas: number | null }>();
  const periodBuyerDocuments = new Set<string>();
  const matchedBuyerDocuments = new Set<string>();
  const attributedBuyerDocuments = new Set<string>();
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
      buyerTypeByDocument[document] = historicalOrders > 1 ? "RETURNING" : "NEW";
    }
    if (match && document) {
      matchedBuyerDocuments.add(document);
      ecommerceMatchedOrders += orders;
    }
    if (!match?.attribution) continue;

    attributedOrders += orders;
    attributedRevenue += revenue;
    if (document) attributedBuyerDocuments.add(document);
    const daily = dailyMap.get(day) ?? { date: day, revenue: 0, attributedRevenue: 0, spend: 0, orders: 0 };
    daily.attributedRevenue += revenue;
    dailyMap.set(day, daily);

    const channel = normalizePerformanceChannel(match.attribution);
    const current = channelMap.get(channel) ?? { channel, spend: 0, revenue: 0, orders: 0, roas: null };
    current.revenue += revenue;
    current.orders += orders;
    channelMap.set(channel, current);
  }

  if (mediaStatus === "connected") {
    const meta = channelMap.get("Meta") ?? { channel: "Meta", spend: 0, revenue: 0, orders: 0, roas: null };
    meta.spend = mediaSpend;
    channelMap.set("Meta", meta);
  }
  for (const channel of channelMap.values()) {
    channel.roas = channel.spend > 0 ? channel.revenue / channel.spend : null;
  }

  const itemSummary = (itemSummaryResult[0] as Array<Record<string, unknown>>)[0];
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
    return rows.map((row) => ({ name: row.name, value: percentage(row.rawValue, total) }));
  };

  const newBuyers = Object.values(buyerTypeByDocument).filter((type) => type === "NEW").length;
  const returningBuyers = Object.values(buyerTypeByDocument).filter((type) => type === "RETURNING").length;

  return {
    generatedAt: new Date().toISOString(),
    sources: {
      erp: { status: "connected", label: `Miré · ${dataset}` },
      ecommerce: { status: "connected", label: "UP Zero · documento + evidência paga" },
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
    },
    reconciliation: [
      { label: "Pedidos no ERP", value: erp.kpis.orders, detail: "Pedidos válidos no período" },
      { label: "Identificados no e-commerce", value: ecommerceMatchedOrders, detail: `${matchedBuyerDocuments.size} comprador(es) conciliado(s)` },
      { label: "Pedidos atribuídos", value: attributedOrders, detail: `${attributedBuyerDocuments.size} comprador(es) com evidência paga` },
      { label: "Sem evidência paga", value: Math.max(0, erp.kpis.orders - attributedOrders), detail: "Orgânico, direto ou sem identificação" },
    ],
    daily: Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
    channels: Array.from(channelMap.values()).sort((a, b) => b.revenue - a.revenue),
    breakdowns: {
      colors: buildBreakdown("color"),
      sizes: buildBreakdown("size"),
      states: buildBreakdown("state"),
    },
    buyerTypeByDocument,
  };
}
