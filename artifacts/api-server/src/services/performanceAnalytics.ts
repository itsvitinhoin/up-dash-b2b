import { and, eq, gt, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { db, clientsTable, eventsTable, ordersTable, orderItemsTable, productsTable } from "@workspace/db";
import { bigquery, vestiTable } from "../lib/bigquery";
import { vestiSalesView } from "./vesti-sales-view";
import { fetchStoredMarketingData } from "./stored-marketing";
import { fetchErpDashboard, matchErpDocumentsWithUpzero, matchErpDocumentsWithVestiAttribution, matchUpzeroCustomersById, fetchVestiFunnelEventCounts, resolveErpSellerName, type ErpDocumentMatch, type VestiErpAttributionMatcher } from "./erpAnalytics";
import { dedupeSameDaySameValue, dedupeSameDaySumAcrossErpVesti, type PositiveEvent } from "./recompra-analytics";
import {
  calculatePerformanceRatios,
  normalizePerformanceChannel,
  percentage,
} from "./performanceMetrics";

const CANCELLED_STATUSES = ["CANCELADO", "EXCLUIDO"];
// Venda ainda nao paga (so sai da conta com `paidOnly`, usado pelos cards da Visao geral).
const UNPAID_STATUSES = ["ESPERA"];

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
  gross_revenue: number | string;
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
    erp: { status: "connected" | "not_configured"; label: string };
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
    mediaSpend: number | null;
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
    /** Sub-filtro Tipo=Anúncios (slides, 19/11/2026): parte de attributedRevenue cujo pedido também tem
     * contrapartida real no e-commerce (Vesti/UP Zero) no mesmo dia do comprador. */
    attributedRevenueEcommerce: number;
    /** Resto de attributedRevenue: atribuído a anúncio, mas fechado só no ERP (sem contrapartida no e-commerce). */
    attributedRevenueErp: number;
    /** Achado 19/11/2026: faturamento líquido ERP + pedido nativo do e-commerce (Vesti/UP Zero)
     * SEM gêmeo no ERP (ex: sincronização ainda não chegou) -- feito pra Tipo=Todos bater com
     * Aquisição×Retenção (recompra-analytics.ts), que já combina as duas fontes. */
    combinedNetRevenue: number;
    /** Mesma ideia de combinedNetRevenue, só que pro "Bruto" (antes das devoluções) -- sem isso,
     * "Bruto" ficava só do ERP e aparecia MENOR que o Faturamento combinado em Tipo=Todos. */
    combinedGrossRevenue: number;
    uniqueBuyers: number;
    newBuyers: number;
    /** Faturamento líquido e pedidos do ERP dos compradores novos do período (mesma base de `newBuyers`). */
    newBuyersRevenue: number;
    newBuyersOrders: number;
    /** Idem para os compradores recorrentes (já tinham compra paga antes do período): base ERP dos cards de Recompra. */
    returningBuyersRevenue: number;
    returningBuyersOrders: number;
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

// Sub-filtro Tipo=Anúncios (slides, 19/11/2026, etapas 1/2): "E-commerce" = pedido atribuído que
// também existe de verdade na plataforma de e-commerce (Vesti ou UP Zero); "ERP" = atribuído, mas
// fechado só no ERP, sem contrapartida. Checa por identidade+dia (não por pedido/valor exato) --
// mesma folga que o resto do app já usa pra cruzar ERP x e-commerce (ver dedup em erp-attribution.ts).
// Devolve os dias com pedido no e-commerce por identidade: customerId da UpZero (upzeroCustomerIds)
// e/ou documento da Vesti (vestiDocuments) -- um cliente pode precisar das duas buscas (ex: Vogabox).
async function fetchEcommerceOrderDaysByIdentity(params: {
  clientId: string;
  dataset: string;
  dateFrom: string;
  dateToExclusive: string;
  upzeroCustomerIds: string[];
  vestiDocuments: string[];
}): Promise<Map<string, Set<string>>> {
  const daysByIdentity = new Map<string, Set<string>>();
  const addDay = (identity: string, day: string) => {
    const set = daysByIdentity.get(identity) ?? new Set<string>();
    set.add(day);
    daysByIdentity.set(identity, set);
  };

  const dateFromDate = new Date(`${params.dateFrom}T00:00:00.000Z`);
  const dateToExclusiveDate = new Date(params.dateToExclusive);
  const fetches: Promise<void>[] = [];

  if (params.upzeroCustomerIds.length > 0) {
    fetches.push(
      db
        .select({ customerId: ordersTable.customerId, createdAt: ordersTable.createdAt })
        .from(ordersTable)
        .where(
          and(
            eq(ordersTable.clientId, params.clientId),
            inArray(ordersTable.customerId, params.upzeroCustomerIds),
            gte(ordersTable.createdAt, dateFromDate),
            lt(ordersTable.createdAt, dateToExclusiveDate),
          ),
        )
        .then((rows) => {
          for (const r of rows) addDay(r.customerId, r.createdAt.toISOString().slice(0, 10));
        })
        .catch((err) => {
          console.warn("[performance] e-commerce (UpZero) indisponível pro sub-filtro Anúncios:", err instanceof Error ? err.message : err);
        }),
    );
  }

  if (params.vestiDocuments.length > 0) {
    const view = vestiSalesView(params.dataset);
    fetches.push(
      bigquery
        .query({
          query: `
            SELECT REGEXP_REPLACE(CAST(documento_cliente AS STRING), r'\\D', '') AS document, data_ref
            FROM ${view}
            WHERE data_ref >= @dateFrom AND data_ref < @dateToExclusive
              AND REGEXP_REPLACE(CAST(documento_cliente AS STRING), r'\\D', '') IN UNNEST(@documents)
            GROUP BY document, data_ref
          `,
          params: { dateFrom: params.dateFrom, dateToExclusive: params.dateToExclusive.slice(0, 10), documents: params.vestiDocuments },
        })
        .then(([rows]) => {
          for (const r of rows as Array<Record<string, unknown>>) {
            const doc = String(r.document ?? "");
            if (!doc) continue;
            const day = r.data_ref && typeof r.data_ref === "object" && "value" in (r.data_ref as object)
              ? String((r.data_ref as { value: unknown }).value)
              : String(r.data_ref);
            addDay(doc, day.slice(0, 10));
          }
        })
        .catch((err) => {
          console.warn("[performance] e-commerce (Vesti) indisponível pro sub-filtro Anúncios:", err instanceof Error ? err.message : err);
        }),
    );
  }

  await Promise.all(fetches);
  return daysByIdentity;
}

// Achado 19/11/2026: investigando por que "Aquisição + Retenção" (recompra-analytics.ts,
// que já combina ERP + pedido nativo do e-commerce) não batia com "Faturamento" de
// Tipo=Anúncios aqui (ERP só) -- a diferença é pedido nativo (Vesti/UP Zero) que ainda não
// tem gêmeo no ERP (ex: sincronização atrasada). Esta função acha esses pedidos "só
// e-commerce" no recorte e resolve atribuição a anúncio neles com o MESMO critério já usado
// pro resto desta página (UTM/carimbo de campanha via matches/matchUpzeroCustomersById pra
// UpZero; matcher por documento da Vesti) -- NUNCA o touchpoint ao vivo que erp-attribution.ts
// usa (critério diferente, não é essa a conta que esta página faz).
//
// Dedup contra o ERP: primeira versão comparava só "o ERP tem ALGUM pedido nesse dia" (binário)
// -- jogou fora pedido Vesti nativo de verdade sempre que o cliente TINHA qualquer outro pedido
// ERP no mesmo dia, mesmo sem relação (medido na Vogabox: Faturamento de Anúncios ficava ~33%
// abaixo da coorte depois do resto dos ajustes desta sessão). Troquei pela MESMA dedup por
// dia+valor que erp-attribution.ts/recompra-analytics.ts já usam (dedupeSameDaySameValue +
// dedupeSameDaySumAcrossErpVesti) -- `erpEventsByDocument` chega de fora com um evento
// "erp" por cliente+dia (já com o bruto/líquido do dia inteiro), comparado contra o pedido
// nativo real. `vestiMatcher` recebido de fora é reaproveitado quando já carregado; só carrega
// de novo (dataset inteiro, caro) se o recorte tiver pedido Vesti nativo e ainda não existir
// um matcher pronto.
async function fetchEcommerceOnlyRevenue(params: {
  clientId: string;
  // Achado 19/11/2026 (página sem ERP): null quando o client não tem dataset nativo da Vesti
  // configurado nenhum (ex: client UpZero puro) -- a promise da Vesti abaixo só roda com dataset.
  dataset: string | null;
  dateFrom: string;
  dateToExclusive: string;
  statusBucket?: "pago" | "cancelado" | "outro";
  // Achado 19/11/2026: faltava Vendedora/Estado aqui -- o resto da página já filtra por eles,
  // mas essa adição ainda contava pedido nativo de QUALQUER vendedora/estado. `sellerId` (bruto,
  // id da UpZero) serve pro Postgres orders; `resolvedSellerName` (já resolvido pro nome de
  // verdade, igual o lado ERP já faz) serve pra comparar com `vendedora` da Vesti.
  sellerId?: string;
  resolvedSellerName?: string;
  state?: string;
  matches: Map<string, ErpDocumentMatch>;
  vestiMatcher: VestiErpAttributionMatcher | null;
  erpEventsByDocument: Map<string, PositiveEvent[]>;
}): Promise<{
  netRevenue: number;
  attributedRevenue: number;
  orders: number;
  // Achado 19/11/2026: o gráfico "Faturamento, atribuição e mídia" soma essa parte por DIA
  // (daily.attributedRevenue) -- sem o detalhamento por dia aqui, o gráfico ficava sem essa
  // fatia e não batia mais com o card Faturamento (que já soma tudo certo).
  attributedRevenueByDay: Map<string, number>;
}> {
  let netRevenue = 0;
  let attributedRevenue = 0;
  const attributedRevenueByDay = new Map<string, number>();
  const addAttributedDay = (day: string, value: number) => {
    attributedRevenueByDay.set(day, (attributedRevenueByDay.get(day) ?? 0) + value);
  };
  let orders = 0;

  // ERP também precisa existir no espaço de identidade "customerId da UpZero" (via matches)
  // pra dedup correto contra pedido nativo da UpZero -- a Fonte 2 "site" usa esse espaço.
  const erpEventsByUpzeroCustomer = new Map<string, PositiveEvent[]>();
  for (const [document, events] of params.erpEventsByDocument) {
    const match = params.matches.get(document);
    if (!match) continue;
    const list = erpEventsByUpzeroCustomer.get(match.customerId) ?? [];
    list.push(...events);
    erpEventsByUpzeroCustomer.set(match.customerId, list);
  }

  const dateFromDate = new Date(`${params.dateFrom}T00:00:00.000Z`);
  const dateToExclusiveDate = new Date(params.dateToExclusive);
  const siteStatusCondition =
    params.statusBucket === "cancelado"
      ? eq(ordersTable.status, "REJECTED")
      : params.statusBucket === "outro"
        ? eq(ordersTable.status, "PENDING")
        : params.statusBucket === "pago"
          ? inArray(ordersTable.status, ["APPROVED", "SHIPPED", "DELIVERED"])
          : ne(ordersTable.status, "REJECTED");

  const upzeroPromise = db
    .select({ id: ordersTable.id, customerId: ordersTable.customerId, createdAt: ordersTable.createdAt, amount: ordersTable.amount })
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.clientId, params.clientId),
        gte(ordersTable.createdAt, dateFromDate),
        lt(ordersTable.createdAt, dateToExclusiveDate),
        siteStatusCondition,
        gt(ordersTable.amount, 0),
        ...(params.sellerId ? [eq(ordersTable.sellerId, params.sellerId)] : []),
        ...(params.state ? [eq(ordersTable.state, params.state)] : []),
      ),
    )
    .then(async (rows) => {
      const combined = new Map<string, PositiveEvent[]>();
      for (const [customerId, events] of erpEventsByUpzeroCustomer) combined.set(customerId, [...events]);
      for (const r of rows) {
        const list = combined.get(r.customerId) ?? [];
        list.push({
          channel: "site",
          orderId: r.id,
          requestedAt: r.createdAt,
          grossValue: r.amount,
          paidValue: r.amount,
          seller: null,
          origem: null,
          document: null,
        });
        combined.set(r.customerId, list);
      }
      const onlyNativeByCustomer = new Map<string, PositiveEvent[]>();
      for (const [customerId, events] of combined) {
        const onlyNative = dedupeSameDaySameValue(dedupeSameDaySumAcrossErpVesti(events)).filter((e) => e.channel === "site");
        if (onlyNative.length > 0) onlyNativeByCustomer.set(customerId, onlyNative);
      }
      if (onlyNativeByCustomer.size === 0) return;
      const attributionByCustomer = await matchUpzeroCustomersById(params.clientId, [...onlyNativeByCustomer.keys()]);
      for (const [customerId, events] of onlyNativeByCustomer) {
        const attribution = attributionByCustomer.get(customerId);
        for (const e of events) {
          netRevenue += e.paidValue;
          orders += 1;
          // Mesma checagem de data da etapa 3 (ver loop principal de fetchPerformanceDashboard):
          // evidenceAt=null (UTM do próprio cadastro, etapas 1/2) sempre conta; com data, só
          // conta se o pedido foi no dia do toque pago ou depois.
          const evidenceAt = attribution?.evidenceAt;
          if (attribution && (!evidenceAt || evidenceAt.toISOString().slice(0, 10) <= e.requestedAt.toISOString().slice(0, 10))) {
            attributedRevenue += e.paidValue;
            addAttributedDay(e.requestedAt.toISOString().slice(0, 10), e.paidValue);
          }
        }
      }
    })
    .catch((err) => {
      console.warn("[performance] pedido nativo UpZero (sem ERP) indisponível:", err instanceof Error ? err.message : err);
    });

  const vestiStatusCondition =
    params.statusBucket === "cancelado"
      ? "status_pedido = 'CANCELADO'"
      : params.statusBucket === "outro"
        ? "status_pedido IN ('WAITING', 'ANALYSING')"
        : params.statusBucket === "pago"
          ? "pago"
          : "status_pedido != 'CANCELADO'";
  const vestiDataset = params.dataset;
  const vestiPromise = vestiDataset
    ? bigquery
        .query({
          query: `
            SELECT
              pedido_id,
              ANY_VALUE(documento_cliente) AS document,
              ANY_VALUE(data_ref) AS data_ref,
              SUM(valor_solicitado) AS gross_value,
              SUM(valor_reservado) AS net_value
            FROM ${vestiSalesView(vestiDataset)}
            WHERE data_ref >= @dateFrom AND data_ref < @dateToExclusive
              AND ${vestiStatusCondition}
              AND documento_cliente IS NOT NULL
              ${params.resolvedSellerName ? "AND UPPER(vendedora) = UPPER(@sellerName)" : ""}
              ${params.state ? "AND estado = @state" : ""}
            GROUP BY pedido_id
            HAVING gross_value > 0
          `,
          params: {
            dateFrom: params.dateFrom,
            dateToExclusive: params.dateToExclusive.slice(0, 10),
            ...(params.resolvedSellerName ? { sellerName: params.resolvedSellerName } : {}),
            ...(params.state ? { state: params.state } : {}),
          },
        })
        .then(async ([rows]) => {
          const combined = new Map<string, PositiveEvent[]>();
          for (const [document, events] of params.erpEventsByDocument) combined.set(document, [...events]);
          for (const r of rows as Array<Record<string, unknown>>) {
            const document = String(r.document ?? "").replace(/\D/g, "");
            if (!document) continue;
            const list = combined.get(document) ?? [];
            list.push({
              channel: "vesti",
              orderId: String(r.pedido_id),
              requestedAt: new Date(dateOnly(r.data_ref)),
              grossValue: Number(r.gross_value) || 0,
              paidValue: Number(r.net_value) || 0,
              seller: null,
              origem: null,
              document,
            });
            combined.set(document, list);
          }
          const onlyNativeByDocument = new Map<string, PositiveEvent[]>();
          for (const [document, events] of combined) {
            const onlyNative = dedupeSameDaySameValue(dedupeSameDaySumAcrossErpVesti(events)).filter((e) => e.channel === "vesti");
            if (onlyNative.length > 0) onlyNativeByDocument.set(document, onlyNative);
          }
          if (onlyNativeByDocument.size === 0) return;
          const vestiMatcher = params.vestiMatcher ?? (await matchErpDocumentsWithVestiAttribution(vestiDataset));
          for (const [document, events] of onlyNativeByDocument) {
            for (const e of events) {
              netRevenue += e.paidValue;
              orders += 1;
              const match = vestiMatcher.match(document, e.requestedAt.toISOString());
              if (match?.attribution) {
                attributedRevenue += e.paidValue;
                addAttributedDay(e.requestedAt.toISOString().slice(0, 10), e.paidValue);
              }
            }
          }
        })
        .catch((err) => {
          console.warn("[performance] pedido nativo Vesti (sem ERP) indisponível:", err instanceof Error ? err.message : err);
        })
    : Promise.resolve();

  await Promise.all([upzeroPromise, vestiPromise]);
  return { netRevenue, attributedRevenue, orders, attributedRevenueByDay };
}

export async function fetchPerformanceDashboard(
  clientId: string,
  dataset: string,
  dateFrom: string,
  dateTo: string,
  options: { paidOnly?: boolean; sellerId?: string; state?: string; statusBucket?: "pago" | "cancelado" | "outro" } = {},
): Promise<PerformanceDashboard> {
  const pedidos = vestiTable(dataset, "pedidos_erp");
  const clientes = vestiTable(dataset, "clientes_erp");
  const cancelledList = (options.paidOnly ? [...CANCELLED_STATUSES, ...UNPAID_STATUSES] : CANCELLED_STATUSES)
    .map((status) => `'${status}'`)
    .join(", ");
  // Filtros novos (pedido do time, 18/11/2026), mesmo tratamento do fetchErpDashboard
  // (erpAnalytics.ts) -- ver memoria do projeto. Sem eles, comportamento igual a antes.
  const unpaidList = UNPAID_STATUSES.map((status) => `'${status}'`).join(", ");
  const paidExcludedList = [...CANCELLED_STATUSES, ...UNPAID_STATUSES].map((status) => `'${status}'`).join(", ");
  const activeStatusCondition =
    options.statusBucket === "cancelado"
      ? `o.status IN (${CANCELLED_STATUSES.map((s) => `'${s}'`).join(", ")})`
      : options.statusBucket === "outro"
        ? `o.status IN (${unpaidList})`
        : options.statusBucket === "pago"
          ? `o.status NOT IN (${paidExcludedList})`
          : `o.status NOT IN (${cancelledList})`;
  // Vendedora: `sellerId` muda de identidade por plataforma (ver resolveErpSellerName,
  // erpAnalytics.ts) -- resolve pro nome de verdade antes de comparar com o ERP.
  const resolvedSellerName = options.sellerId ? await resolveErpSellerName(clientId, options.sellerId) : undefined;
  const sellerCondition = resolvedSellerName ? `AND UPPER(o.seller) = UPPER(@sellerName)` : "";
  const stateCondition = options.state ? `AND d.state = @state` : "";
  const dayQueryParams: Record<string, string> = { dateFrom, dateTo };
  if (resolvedSellerName) dayQueryParams.sellerName = resolvedSellerName;
  if (options.state) dayQueryParams.state = options.state;

  const customerDayQuery = `
    WITH all_orders AS (
      SELECT
        pedido_id,
        ANY_VALUE(customer_id) AS customer_id,
        ANY_VALUE(status) AS status,
        ANY_VALUE(seller) AS seller,
        ANY_VALUE(valor_liquido) AS net_amount,
        ANY_VALUE(valor_total) AS gross_amount,
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
      SUM(o.gross_amount) AS gross_revenue,
      SUM(o.quantity) AS quantity,
      ANY_VALUE(h.historical_orders) AS historical_orders,
      LOGICAL_OR(d.document IS NOT NULL) AS is_identified
    FROM all_orders o
    LEFT JOIN customer_dimension d
      ON d.document = REGEXP_REPLACE(CAST(o.customer_id AS STRING), r'[^0-9]', '')
    LEFT JOIN customer_history h
      ON h.document = REGEXP_REPLACE(CAST(o.customer_id AS STRING), r'[^0-9]', '')
    WHERE o.date BETWEEN @dateFrom AND @dateTo
      AND ${activeStatusCondition}
      ${sellerCondition}
      ${stateCondition}
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
    fetchErpDashboard(clientId, dataset, dateFrom, dateTo, options),
    bigquery.query({ query: customerDayQuery, params: dayQueryParams }),
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
  // achou, sem sobrescrever um match que já veio de lá. Fase 4 (23/09/2026):
  // o match Vesti agora depende da DATA do pedido (barreira de início da
  // marca), não só do documento -- por isso vira um matcher chamado por
  // linha dentro do loop de customerDays abaixo, em vez de um Map
  // pré-preenchido em lote.
  const hasUnmatchedDocuments = documents.some((doc) => {
    const normalized = doc ? String(doc).replace(/[^0-9]/g, "") : null;
    return normalized && !matches.has(String(doc));
  });
  const vestiMatcher = hasUnmatchedDocuments ? await matchErpDocumentsWithVestiAttribution(dataset) : null;
  const client = clientRows[0];

  // Sub-filtro Tipo=Anúncios (slides, 19/11/2026): pra separar "atribuído com pedido no
  // e-commerce" de "atribuído só no ERP", busca em que dias cada identidade teve pedido de
  // verdade na plataforma de e-commerce (UpZero via customerId resolvido em `matches`; Vesti
  // via documento, pra qualquer documento do recorte -- `vestiMatcher` só sabe no dia a dia).
  const ecommercePerformanceDateToExclusive = new Date(`${dateTo}T00:00:00.000Z`);
  ecommercePerformanceDateToExclusive.setUTCDate(ecommercePerformanceDateToExclusive.getUTCDate() + 1);
  const ecommerceOrderDaysByIdentity = await fetchEcommerceOrderDaysByIdentity({
    clientId,
    dataset,
    dateFrom,
    dateToExclusive: ecommercePerformanceDateToExclusive.toISOString(),
    upzeroCustomerIds: [...new Set([...matches.values()].map((m) => m.customerId))],
    vestiDocuments: vestiMatcher ? [...new Set(documents.filter((d): d is string => Boolean(d)).map((d) => String(d).replace(/\D/g, "")).filter(Boolean))] : [],
  });

  // Achado 19/11/2026: pedido nativo do e-commerce (Vesti/UP Zero) SEM gêmeo no ERP --
  // some do universo acima (que só olha pedidos_erp). Fecha a lacuna que fazia Faturamento/
  // atribuição de Tipo=Anúncios/Todos ficar atrás de Aquisição×Retenção (que já combina as
  // duas fontes). Um evento "erp" por cliente+dia (dia já vem agregado em customerDays) --
  // suficiente pra dedupeSameDaySumAcrossErpVesti, que soma por dia de qualquer forma. Ver
  // fetchEcommerceOnlyRevenue.
  const erpEventsByDocument = new Map<string, PositiveEvent[]>();
  for (const row of customerDays) {
    const document = row.document ?? row.customer_id;
    if (!document) continue;
    const list = erpEventsByDocument.get(document) ?? [];
    list.push({
      channel: "erp",
      orderId: `erp-day:${document}:${dateOnly(row.date)}`,
      requestedAt: new Date(dateOnly(row.date)),
      grossValue: Number(row.gross_revenue) || 0,
      paidValue: Number(row.net_revenue) || 0,
      seller: null,
      origem: null,
      document,
    });
    erpEventsByDocument.set(document, list);
  }
  const ecommerceOnly = await fetchEcommerceOnlyRevenue({
    clientId,
    dataset,
    dateFrom,
    dateToExclusive: ecommercePerformanceDateToExclusive.toISOString(),
    statusBucket: options.statusBucket,
    sellerId: options.sellerId,
    resolvedSellerName,
    state: options.state,
    matches,
    vestiMatcher,
    erpEventsByDocument,
  });

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
  // Gasto e campanhas lidos do dado guardado (BigQuery), sem Meta ao vivo: só a conta de anúncio importa, não o token.
  if (client?.metaAdAccountId) {
    try {
      const meta = await fetchStoredMarketingData({
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
  let attributedRevenueEcommerce = 0;
  let attributedRevenueErp = 0;
  let ecommerceMatchedOrders = 0;

  for (const row of customerDays) {
    const document = row.document ?? row.customer_id;
    const orders = Number(row.orders) || 0;
    const revenue = Number(row.net_revenue) || 0;
    const day = dateOnly(row.date);
    const upzeroMatch = document ? matches.get(document) : undefined;
    const match = upzeroMatch ?? (document ? vestiMatcher?.match(document, day) : undefined) ?? undefined;
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
    // Sub-filtro Tipo=Anúncios: a mesma identidade teve pedido no e-commerce nesse dia? Movido
    // pra ANTES da decisão de atribuir (abaixo) -- a etapa 3 depende disso pra decidir se conta.
    // UpZero checa pelo customerId resolvido; Vesti (sem customerId), pelo documento.
    const ecommerceIdentity = upzeroMatch ? upzeroMatch.customerId : document ? String(document).replace(/\D/g, "") : "";
    const hasEcommerceOrderSameDay = ecommerceIdentity ? (ecommerceOrderDaysByIdentity.get(ecommerceIdentity)?.has(day) ?? false) : false;
    // Achado 19/11/2026: matches (UpZero) é um veredito por cliente, sem olhar pedido a pedido.
    // Etapa 1/2 do PDF (sinal no próprio cadastro, ou toque ANTES/no cadastro = PAID_ORIGIN):
    // vale pra qualquer canal, inclusive pedido só-no-ERP. Etapa 3 (toque DEPOIS do cadastro,
    // cliente orgânico = PAID_ASSISTED): o PDF só libera pedido COM contrapartida no
    // e-commerce -- nunca pedido só-no-ERP (não dá pra ligar uma compra de loja física a um
    // clique de anúncio sem o rastro do e-commerce). Só o lado UpZero precisa disso -- o
    // matcher da Vesti já recebe `day` acima e decide a data por conta própria.
    if (upzeroMatch?.attribution) {
      const evidenceAt = upzeroMatch.attribution.evidenceAt;
      if (evidenceAt && evidenceAt.toISOString().slice(0, 10) > day) continue; // toque depois desse pedido, nunca conta
      const isPaidAssisted = !!evidenceAt && !!upzeroMatch.registeredAt && evidenceAt.getTime() > upzeroMatch.registeredAt.getTime();
      if (isPaidAssisted && !hasEcommerceOrderSameDay) continue; // etapa 3 exige contrapartida no e-commerce
    }

    attributedOrders += orders;
    attributedRevenue += revenue;
    if (hasEcommerceOrderSameDay) attributedRevenueEcommerce += revenue;
    else attributedRevenueErp += revenue;
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

  // Pedido nativo (Vesti/UP Zero) sem gêmeo no ERP: por definição tem contrapartida real no
  // e-commerce (ele mesmo), então entra sempre no balde "Ecommerce" do sub-filtro de Anúncios.
  attributedRevenue += ecommerceOnly.attributedRevenue;
  attributedRevenueEcommerce += ecommerceOnly.attributedRevenue;
  const combinedNetRevenue = erp.kpis.netRevenue + ecommerceOnly.netRevenue;
  const combinedGrossRevenue = erp.kpis.grossRevenue + ecommerceOnly.netRevenue;
  // Achado 19/11/2026: o gráfico "Faturamento, atribuição e mídia" usava dailyMap.attributedRevenue,
  // que só tinha a parte do ERP -- card Faturamento já somava certo (linha acima), mas o gráfico
  // ficava pra trás (medido na MX Fashion: card R$163.548,16, soma do gráfico só R$81.072,24).
  for (const [day, value] of ecommerceOnly.attributedRevenueByDay) {
    const daily = dailyMap.get(day) ?? { date: day, revenue: 0, attributedRevenue: 0, spend: 0, orders: 0 };
    daily.attributedRevenue += value;
    dailyMap.set(day, daily);
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

  // Compradores novos: o que eles compraram no período no ERP (base única dos cards de Novos clientes, decisão do time em 27/10/2026).
  let newBuyersRevenue = 0;
  let newBuyersOrders = 0;
  let returningBuyersRevenue = 0;
  let returningBuyersOrders = 0;
  for (const row of customerDays) {
    const document = row.document ?? row.customer_id;
    if (!row.is_identified || !document) continue;
    if (buyerTypeByDocument[document] === "NEW") {
      newBuyersRevenue += Number(row.net_revenue) || 0;
      newBuyersOrders += Number(row.orders) || 0;
    } else if (buyerTypeByDocument[document] === "RETURNING") {
      returningBuyersRevenue += Number(row.net_revenue) || 0;
      returningBuyersOrders += Number(row.orders) || 0;
    }
  }
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
      attributedRevenueEcommerce,
      attributedRevenueErp,
      combinedNetRevenue,
      combinedGrossRevenue,
      unattributedRevenue: Math.max(0, erp.kpis.netRevenue - attributedRevenue),
      mediaSpend: mediaStatus === "connected" ? mediaSpend : null,
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
      newBuyersRevenue,
      newBuyersOrders,
      returningBuyersRevenue,
      returningBuyersOrders,
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

// Achado 19/11/2026: custo de produto (pra COGS/ROI) É possível sem ERP pro lado UpZero --
// existe products.cost no Postgres -- mas NUNCA pra Vesti (schema confirmado sem nenhum campo
// de custo). Na prática está preenchido só pra uma minoria dos clientes reais (medido:
// Obzee 53/74, UP Adama 56/248, Aurora Atelier 24/24 -- vs. zero em vários outros); por isso
// usa a MESMA régua de cobertura (costCoveragePct) que o lado ERP já usa, nunca mostra ROI
// fingindo 100% quando a cobertura é baixa.
async function fetchUpzeroNativeCogs(params: {
  clientId: string;
  dateFrom: string;
  dateToExclusive: string;
  statusBucket?: "pago" | "cancelado" | "outro";
  sellerId?: string;
  state?: string;
}): Promise<{ cogs: number; costedQuantity: number; totalQuantity: number }> {
  const dateFromDate = new Date(`${params.dateFrom}T00:00:00.000Z`);
  const dateToExclusiveDate = new Date(params.dateToExclusive);
  // Mesmo mapeamento de status já usado pro pedido nativo em fetchEcommerceOnlyRevenue --
  // sem isso, COGS somava pedido fora do Status filtrado e dava lucro bruto sem sentido
  // (ex: custo > 0 com faturamento 0 quando "Pago" não tinha pedido, mas "não rejeitado" tinha).
  const statusCondition =
    params.statusBucket === "cancelado"
      ? eq(ordersTable.status, "REJECTED")
      : params.statusBucket === "outro"
        ? eq(ordersTable.status, "PENDING")
        : params.statusBucket === "pago"
          ? inArray(ordersTable.status, ["APPROVED", "SHIPPED", "DELIVERED"])
          : ne(ordersTable.status, "REJECTED");
  const rows = await db
    .select({ quantity: orderItemsTable.quantity, cost: productsTable.cost })
    .from(orderItemsTable)
    .innerJoin(ordersTable, eq(ordersTable.id, orderItemsTable.orderId))
    .innerJoin(productsTable, eq(productsTable.id, orderItemsTable.productId))
    .where(
      and(
        eq(ordersTable.clientId, params.clientId),
        gte(ordersTable.createdAt, dateFromDate),
        lt(ordersTable.createdAt, dateToExclusiveDate),
        statusCondition,
        ...(params.sellerId ? [eq(ordersTable.sellerId, params.sellerId)] : []),
        ...(params.state ? [eq(ordersTable.state, params.state)] : []),
      ),
    )
    .catch((err) => {
      console.warn("[performance] (sem ERP) custo de produto UpZero indisponível:", err instanceof Error ? err.message : err);
      return [] as Array<{ quantity: number; cost: number | null }>;
    });

  let cogs = 0;
  let costedQuantity = 0;
  let totalQuantity = 0;
  for (const r of rows) {
    totalQuantity += r.quantity;
    if (r.cost && r.cost > 0) {
      cogs += r.cost * r.quantity;
      costedQuantity += r.quantity;
    }
  }
  return { cogs, costedQuantity, totalQuantity };
}

// Achado 19/11/2026 (pedido do Marcelo: "sem erp pode usar tbm"): client sem erpDataset
// batia 404 direto nesta página (requireErpDataset, erpController.ts). Esta função é uma
// versão REDUZIDA do dashboard acima pra esse caso -- só o que dá pra saber sem ERP:
// faturamento/atribuição do pedido nativo do e-commerce (reaproveita fetchEcommerceOnlyRevenue
// de cima, sem base ERP pra comparar -- todo pedido nativo conta, sem dedup) + mídia paga +
// COGS/ROI via products.cost pra client UpZero (fetchUpzeroNativeCogs acima; nunca pra Vesti).
// Breakdown por cor/tamanho/estado e a tabela de pedidos do ERP não têm de onde vir pra esse
// client -- ficam explicitamente "indisponível", não um valor inventado.
export async function fetchPerformanceDashboardNoErp(
  clientId: string,
  dateFrom: string,
  dateTo: string,
  options: { sellerId?: string; state?: string; statusBucket?: "pago" | "cancelado" | "outro" } = {},
): Promise<PerformanceDashboard> {
  const [client] = await db
    .select({
      commercePlatform: clientsTable.commercePlatform,
      bigqueryDataset: clientsTable.bigqueryDataset,
      metaAdAccountId: clientsTable.metaAdAccountId,
    })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));

  // Dataset nativo da Vesti é uma coluna SEPARADA de erpDataset (client pode ter um sem o
  // outro -- ex: Milalai tem bigquery_dataset mas erp_dataset vazio).
  const vestiDataset = client?.commercePlatform === "VESTI" ? client.bigqueryDataset : null;
  // Vendedora: mesma resolução id->nome que o lado ERP já faz (resolveErpSellerName) -- sem
  // isso, o filtro de Vendedora da tela não tinha efeito nenhum aqui.
  const resolvedSellerName = options.sellerId ? await resolveErpSellerName(clientId, options.sellerId) : undefined;

  const dateToExclusiveDate = new Date(`${dateTo}T00:00:00.000Z`);
  dateToExclusiveDate.setUTCDate(dateToExclusiveDate.getUTCDate() + 1);

  const ecommerceOnly = await fetchEcommerceOnlyRevenue({
    clientId,
    dataset: vestiDataset,
    dateFrom,
    dateToExclusive: dateToExclusiveDate.toISOString(),
    statusBucket: options.statusBucket,
    sellerId: options.sellerId,
    resolvedSellerName,
    state: options.state,
    matches: new Map(),
    vestiMatcher: null,
    erpEventsByDocument: new Map(),
  });

  let eventCounts = {
    visits: 0,
    registrations: 0,
    approvals: 0,
    productViews: 0,
    addToCart: 0,
    checkouts: 0,
    purchases: 0,
  };
  if (vestiDataset) {
    const vestiFunnel = await fetchVestiFunnelEventCounts(vestiDataset, dateFrom, dateTo);
    eventCounts = { ...eventCounts, ...vestiFunnel };
  } else {
    const eventSummaryResult = await db
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
        console.warn("[performance] (sem ERP) eventos UP Zero indisponíveis:", error);
        return { rows: [] as EventSummaryRow[] };
      });
    const row = eventSummaryResult.rows[0];
    if (row) {
      eventCounts = {
        visits: Number(row.visits) || 0,
        registrations: Number(row.registrations) || 0,
        approvals: Number(row.approvals) || 0,
        productViews: Number(row.product_views) || 0,
        addToCart: Number(row.add_to_cart) || 0,
        checkouts: Number(row.checkouts) || 0,
        purchases: Number(row.purchases) || 0,
      };
    }
  }

  let mediaStatus: PerformanceDashboard["sources"]["media"]["status"] = "not_configured";
  let mediaMessage: string | null = "Conta de anúncios Meta não configurada para este cliente.";
  let mediaSpend = 0;
  let mediaSummary = { impressions: 0, clicks: 0, leads: 0, purchases: 0, cpl: null as number | null };
  if (client?.metaAdAccountId) {
    try {
      const meta = await fetchStoredMarketingData({ adAccountId: client.metaAdAccountId, since: dateFrom, until: dateTo });
      mediaSpend = meta.summary.spend;
      mediaSummary = meta.summary;
      mediaStatus = "connected";
      mediaMessage = null;
    } catch (error) {
      mediaStatus = "unavailable";
      mediaMessage = "A Meta Ads não respondeu nesta conciliação. Tente atualizar novamente.";
      console.warn("[performance] (sem ERP) Meta insights unavailable:", error);
    }
  }

  const netRevenue = ecommerceOnly.netRevenue;
  const attributedRevenue = ecommerceOnly.attributedRevenue;
  const effectiveMediaSpend = mediaStatus === "connected" ? mediaSpend : 0;

  // COGS/ROI: só tenta pro lado UpZero (products.cost existe, cobertura variável por cliente);
  // Vesti nunca tem custo de produto em lugar nenhum, fica sempre "unavailable" (cogs=0,
  // costCoveragePct=0 já cobre isso via calculatePerformanceRatios).
  const upzeroCogs = vestiDataset
    ? { cogs: 0, costedQuantity: 0, totalQuantity: 0 }
    : await fetchUpzeroNativeCogs({ clientId, dateFrom, dateToExclusive: dateToExclusiveDate.toISOString(), statusBucket: options.statusBucket, sellerId: options.sellerId, state: options.state });
  const costCoveragePct = percentage(upzeroCogs.costedQuantity, upzeroCogs.totalQuantity);
  const ratios = calculatePerformanceRatios({
    netRevenue,
    attributedRevenue,
    mediaSpend: effectiveMediaSpend,
    cogs: upzeroCogs.cogs,
    returnAmount: 0,
    costCoveragePct,
  });

  const funnelValues: Array<{ key: string; label: string; value: number; source: PerformanceStage["source"] }> = [
    { key: "clicks", label: "Cliques pagos", value: mediaSummary.clicks, source: "Meta Ads" },
    { key: "registrations", label: "Cadastros", value: eventCounts.registrations, source: "UP Zero" },
    { key: "approvals", label: "Cadastros aprovados", value: eventCounts.approvals, source: "UP Zero" },
    { key: "add_to_cart", label: "Adições ao carrinho", value: eventCounts.addToCart, source: "UP Zero" },
    { key: "checkout", label: "Checkouts iniciados", value: eventCounts.checkouts, source: "UP Zero" },
    { key: "ecommerce_orders", label: "Pedidos no e-commerce", value: ecommerceOnly.orders, source: "UP Zero" },
  ];
  const funnel: PerformanceStage[] = funnelValues.map((stage, index) => ({
    ...stage,
    previousRate: index === 0 ? null : percentage(stage.value, funnelValues[index - 1]?.value ?? 0),
    overallRate: index === 0 ? null : percentage(stage.value, funnelValues[0]?.value ?? 0),
  }));

  return {
    generatedAt: new Date().toISOString(),
    sources: {
      erp: { status: "not_configured", label: "ERP não configurado para este cliente" },
      ecommerce: { status: "connected", label: "Vesti/UP Zero · pedido nativo", message: null },
      media: { status: mediaStatus, label: "Meta Ads", message: mediaMessage },
    },
    kpis: {
      grossRevenue: netRevenue,
      netRevenue,
      returnAmount: 0,
      attributedRevenue,
      attributedRevenueEcommerce: attributedRevenue,
      attributedRevenueErp: 0,
      combinedNetRevenue: netRevenue,
      combinedGrossRevenue: netRevenue,
      unattributedRevenue: Math.max(0, netRevenue - attributedRevenue),
      mediaSpend: mediaStatus === "connected" ? mediaSpend : null,
      roas: ratios.roas,
      mer: ratios.mer,
      cogs: upzeroCogs.cogs,
      grossProfit: ratios.grossProfit,
      roi: ratios.roi,
      roiStatus: ratios.roiStatus,
      costCoveragePct,
      orders: ecommerceOnly.orders,
      attributedOrders: 0,
      attributionCoveragePct: 0,
      uniqueBuyers: 0,
      newBuyers: 0,
      newBuyersRevenue: 0,
      newBuyersOrders: 0,
      returningBuyersRevenue: 0,
      returningBuyersOrders: 0,
      returningBuyers: 0,
      retentionPct: 0,
      totalQuantity: upzeroCogs.totalQuantity,
      returnedQuantity: 0,
      discountAmount: 0,
      cancelledOrders: 0,
      cancelledAmount: 0,
      averageTicket: ecommerceOnly.orders > 0 ? netRevenue / ecommerceOnly.orders : 0,
      avgItemsPerOrder: 0,
      returnRatePct: 0,
      discountRatePct: 0,
      grossMarginPct: percentage(ratios.grossProfit, Math.max(0, netRevenue)),
      attributedBuyers: 0,
      newAttributedBuyers: 0,
      revenueAttributionCoveragePct: percentage(attributedRevenue, netRevenue),
      impressions: mediaSummary.impressions,
      clicks: mediaSummary.clicks,
      leads: mediaSummary.leads,
      metaPurchases: mediaSummary.purchases,
      ctr: percentage(mediaSummary.clicks, mediaSummary.impressions),
      cpc: mediaSummary.clicks > 0 ? mediaSpend / mediaSummary.clicks : null,
      cpl: mediaSummary.cpl,
      cac: null,
    },
    reconciliation: [],
    daily: [],
    channels: [],
    breakdowns: { colors: [], sizes: [], states: [] },
    funnel,
    quality: [],
    campaigns: [],
    buyerTypeByDocument: {},
  };
}
