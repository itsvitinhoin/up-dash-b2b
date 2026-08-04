import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  campaignAttributionStampsTable,
  clientsTable,
  customersTable,
} from "@workspace/db";
import { bigquery, vestiTable } from "../lib/bigquery";
import { hashDocument } from "./upzero/customers";
import {
  calculateErpFulfilledQuantity,
  calculateErpRetentionPct,
  calculateErpStockTurnoverPct,
  hasPaidErpCampaignSignal,
} from "./erpMetrics";

/**
 * Se o client tiver um dataset de ERP configurado (independente de
 * commercePlatform — um client UpZero como a Obzee pode ter ERP sem ser
 * Vesti), devolve o dataset. Senão, `null`.
 */
export async function resolveErpDataset(
  clientId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ erpDataset: clientsTable.erpDataset })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));
  return row?.erpDataset ?? null;
}

// Fonte: tabelas `*_erp` (BigQuery, projeto up-vesti-report, mesmo dataset
// do client — ex: `obzee`), sincronizadas pelo job Miredata em
// script-vesti-nuvem/erp/miredata. `pedidos_erp` é uma linha por ITEM de
// pedido: campos do pedido (valor_total, valor_liquido, desconto, status,
// customer_id, data_criado, ...) vêm REPETIDOS idênticos em todas as linhas
// do mesmo pedido — diferente do padrão "esparso" da Vesti, aqui precisa
// agrupar por pedido_id com ANY_VALUE()/MAX(), nunca SUM() direto nesses
// campos. Só os campos `item_*` são valores reais por linha, somáveis.
//
// Não existe UTM/atribuição/gasto de mídia em nenhuma tabela ERP em si — mas
// dá pra recuperar por cruzamento: o Postgres já guarda, por client UpZero, o
// utm_source/medium/campaign de primeiro toque de cada customer rastreado,
// indexado por `document_hash` (sha256 do documento só com dígitos, ver
// services/upzero/customers.ts::hashDocument). Cliente do ERP e customer
// rastreado pela UpZero são a MESMA pessoa quando o hash do documento bate.
// O pedido só recebe atribuição quando esse customer também possui um carimbo
// persistente de campanha ou UTM com sinal pago. A simples igualdade de CNPJ
// identifica a pessoa, mas não é evidência suficiente de mídia.

export type ErpAttribution = {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  evidenceType: string;
  evidenceAt: Date | null;
};

export type ErpDocumentMatch = {
  customerId: string;
  attribution: ErpAttribution | null;
};

export async function matchErpDocumentsWithUpzero(
  clientId: string,
  documents: Array<string | null | undefined>,
): Promise<Map<string, ErpDocumentMatch>> {
  const hashByDocument = new Map<string, string>();
  for (const doc of documents) {
    const hash = hashDocument(doc);
    if (hash) hashByDocument.set(String(doc), hash);
  }
  const hashes = Array.from(new Set(hashByDocument.values()));
  if (hashes.length === 0) return new Map();

  const rows = await db
    .select({
      customerId: customersTable.id,
      documentHash: customersTable.documentHash,
      utmSource: customersTable.utmSource,
      utmMedium: customersTable.utmMedium,
      utmCampaign: customersTable.utmCampaign,
      stampId: campaignAttributionStampsTable.id,
      stampSource: campaignAttributionStampsTable.source,
      stampMedium: campaignAttributionStampsTable.medium,
      stampCampaign: campaignAttributionStampsTable.campaign,
      stampEvidenceType: campaignAttributionStampsTable.evidenceType,
      stampEvidenceAt: campaignAttributionStampsTable.evidenceAt,
    })
    .from(customersTable)
    .leftJoin(
      campaignAttributionStampsTable,
      and(
        eq(campaignAttributionStampsTable.clientId, clientId),
        eq(campaignAttributionStampsTable.customerId, customersTable.id),
      ),
    )
    .where(
      and(
        eq(customersTable.clientId, clientId),
        inArray(customersTable.documentHash, hashes),
      ),
    );

  const byHash = new Map<string, ErpDocumentMatch>();
  for (const r of rows) {
    if (!r.documentHash) continue;
    const attribution: ErpAttribution = {
      utmSource: r.stampSource ?? r.utmSource,
      utmMedium: r.stampMedium ?? r.utmMedium,
      utmCampaign: r.stampCampaign ?? r.utmCampaign,
      evidenceType: r.stampEvidenceType ?? "customer_utm",
      evidenceAt: r.stampEvidenceAt ?? null,
    };
    const paidAttribution =
      r.stampId || hasPaidErpCampaignSignal(attribution) ? attribution : null;

    const current = byHash.get(r.documentHash);
    if (
      !current ||
      (!current.attribution && paidAttribution) ||
      (current.attribution &&
        paidAttribution?.evidenceAt &&
        (!current.attribution.evidenceAt ||
          paidAttribution.evidenceAt < current.attribution.evidenceAt))
    ) {
      byHash.set(r.documentHash, {
        customerId: r.customerId,
        attribution: paidAttribution,
      });
    }
  }

  const byDocument = new Map<string, ErpDocumentMatch>();
  for (const [doc, hash] of hashByDocument) {
    const match = byHash.get(hash);
    if (match) byDocument.set(doc, match);
  }
  return byDocument;
}

export async function matchErpDocumentsToUpzero(
  clientId: string,
  documents: Array<string | null | undefined>,
): Promise<Map<string, ErpAttribution>> {
  const identityMatches = await matchErpDocumentsWithUpzero(
    clientId,
    documents,
  );
  const attributed = new Map<string, ErpAttribution>();
  for (const [document, match] of identityMatches) {
    if (match.attribution) attributed.set(document, match.attribution);
  }
  return attributed;
}

function toDateOnly(value: unknown): string {
  if (
    value &&
    typeof value === "object" &&
    "value" in (value as Record<string, unknown>)
  ) {
    return String((value as { value: unknown }).value);
  }
  return String(value);
}

export type ErpDashboard = {
  kpis: {
    grossRevenue: number;
    netRevenue: number;
    discountAmount: number;
    orders: number;
    totalQuantity: number;
    returnedQuantity: number;
    uniqueCustomers: number;
    newCustomers: number;
    returningCustomers: number;
    retentionPct: number;
    cancelledOrders: number;
    cancelledAmount: number;
    avgTicket: number;
    returnAmount: number;
    avgItemsPerOrder: number;
    returnRatePct: number;
    discountRatePct: number;
  };
  dailyRevenue: { date: string; value: number }[];
  dailyOrders: { date: string; value: number }[];
  dailyNewCustomers: { date: string; value: number }[];
  dailyReturningCustomers: { date: string; value: number }[];
  attribution: {
    attributedCustomers: number;
    unattributedCustomers: number;
    attributedRevenue: number;
    unattributedRevenue: number;
  };
  breakdowns: {
    statuses: Array<{ label: string; orders: number; revenue: number }>;
    payments: Array<{ label: string; orders: number; revenue: number }>;
    sellers: Array<{
      label: string;
      orders: number;
      revenue: number;
      customers: number;
    }>;
    stores: Array<{ label: string; orders: number; revenue: number }>;
    states: Array<{
      label: string;
      orders: number;
      revenue: number;
      customers: number;
    }>;
  };
};

const ERP_CANCELLED_STATUSES = ["CANCELADO", "EXCLUIDO"];

export async function fetchErpDashboard(
  clientId: string,
  dataset: string,
  dateFrom: string,
  dateTo: string,
): Promise<ErpDashboard> {
  const pedidos = vestiTable(dataset, "pedidos_erp");
  const clientes = vestiTable(dataset, "clientes_erp");
  const cancelledList = ERP_CANCELLED_STATUSES.map((s) => `'${s}'`).join(", ");

  const [dailyRows] = await bigquery.query({
    query: `
      WITH all_orders AS (
        SELECT
          pedido_id,
          ANY_VALUE(customer_id) AS customer_id,
          ANY_VALUE(status) AS status,
          ANY_VALUE(valor_total) AS gross_amount,
          ANY_VALUE(desconto) AS discount_amount,
          ANY_VALUE(valor_liquido) AS net_amount,
          ANY_VALUE(devolucao) AS return_amount,
          SUM(item_quantidade) AS sold_quantity,
          COALESCE(ANY_VALUE(devolucao_quantidade), 0) AS returned_quantity,
          ANY_VALUE(DATE(data_criado)) AS date
        FROM ${pedidos}
        GROUP BY pedido_id
      ),
      customer_documents AS (
        SELECT DISTINCT REGEXP_REPLACE(CAST(documento AS STRING), r'[^0-9]', '') AS document
        FROM ${clientes}
        WHERE documento IS NOT NULL
      ),
      orders AS (
        SELECT * FROM all_orders
        WHERE date BETWEEN @dateFrom AND @dateTo
      ),
      customer_history AS (
        SELECT o.customer_id, COUNT(*) AS total_orders
        FROM all_orders o
        JOIN customer_documents c
          ON c.document = REGEXP_REPLACE(CAST(o.customer_id AS STRING), r'[^0-9]', '')
        WHERE o.customer_id IS NOT NULL AND o.status NOT IN (${cancelledList})
        GROUP BY o.customer_id
      )
      SELECT
        o.date,
        COUNTIF(o.status NOT IN (${cancelledList})) AS orders,
        COALESCE(SUM(IF(o.status IN (${cancelledList}), 0, o.gross_amount)), 0) AS gross_revenue,
        COALESCE(SUM(IF(o.status IN (${cancelledList}), 0, o.discount_amount)), 0) AS discount_amount,
        COALESCE(SUM(IF(o.status IN (${cancelledList}), 0, o.net_amount)), 0) AS net_revenue,
        COALESCE(SUM(IF(o.status IN (${cancelledList}), 0, COALESCE(o.return_amount, 0))), 0) AS return_amount,
        COALESCE(SUM(IF(o.status IN (${cancelledList}), 0, o.sold_quantity)), 0) AS quantity,
        COALESCE(SUM(IF(o.status IN (${cancelledList}), 0, o.returned_quantity)), 0) AS returned_quantity,
        COUNTIF(o.status IN (${cancelledList})) AS cancelled_orders,
        COALESCE(SUM(IF(o.status IN (${cancelledList}), o.net_amount, 0)), 0) AS cancelled_amount,
        COUNT(DISTINCT IF(o.status NOT IN (${cancelledList}) AND ch.total_orders <= 1, o.customer_id, NULL)) AS new_customers,
        COUNT(DISTINCT IF(o.status NOT IN (${cancelledList}) AND ch.total_orders > 1, o.customer_id, NULL)) AS returning_customers
      FROM orders o
      LEFT JOIN customer_history ch ON ch.customer_id = o.customer_id
      GROUP BY o.date
      ORDER BY o.date
    `,
    params: { dateFrom, dateTo },
  });

  const raw = dailyRows as Array<Record<string, unknown>>;
  const dailyRevenue = raw.map((r) => ({
    date: toDateOnly(r.date),
    value: Number(r.net_revenue) || 0,
  }));
  const dailyOrders = raw.map((r) => ({
    date: toDateOnly(r.date),
    value: Number(r.orders) || 0,
  }));
  const dailyNewCustomers = raw.map((r) => ({
    date: toDateOnly(r.date),
    value: Number(r.new_customers) || 0,
  }));
  const dailyReturningCustomers = raw.map((r) => ({
    date: toDateOnly(r.date),
    value: Number(r.returning_customers) || 0,
  }));

  const [customerSegmentRows] = await bigquery.query({
    query: `
      WITH all_orders AS (
        SELECT pedido_id, ANY_VALUE(customer_id) AS customer_id, ANY_VALUE(status) AS status, ANY_VALUE(DATE(data_criado)) AS date
        FROM ${pedidos}
        GROUP BY pedido_id
      ),
      customer_documents AS (
        SELECT DISTINCT REGEXP_REPLACE(CAST(documento AS STRING), r'[^0-9]', '') AS document
        FROM ${clientes}
        WHERE documento IS NOT NULL
      ),
      customer_history AS (
        SELECT o.customer_id, COUNT(*) AS total_orders
        FROM all_orders o
        JOIN customer_documents c
          ON c.document = REGEXP_REPLACE(CAST(o.customer_id AS STRING), r'[^0-9]', '')
        WHERE o.customer_id IS NOT NULL AND o.status NOT IN (${cancelledList})
        GROUP BY o.customer_id
      ),
      period_buyers AS (
        SELECT DISTINCT o.customer_id
        FROM all_orders o
        JOIN customer_documents c
          ON c.document = REGEXP_REPLACE(CAST(o.customer_id AS STRING), r'[^0-9]', '')
        WHERE o.date BETWEEN @dateFrom AND @dateTo
          AND o.customer_id IS NOT NULL
          AND o.status NOT IN (${cancelledList})
      )
      SELECT
        COUNT(*) AS unique_customers,
        COUNTIF(ch.total_orders <= 1) AS new_customers,
        COUNTIF(ch.total_orders > 1) AS returning_customers
      FROM period_buyers pb
      JOIN customer_history ch USING (customer_id)
    `,
    params: { dateFrom, dateTo },
  });
  const customerSegments = (
    customerSegmentRows as Array<Record<string, unknown>>
  )[0];
  const uniqueCustomers = Number(customerSegments?.unique_customers) || 0;
  const newCustomers = Number(customerSegments?.new_customers) || 0;
  const returningCustomers = Number(customerSegments?.returning_customers) || 0;

  const [customerRevenueRows] = await bigquery.query({
    query: `
      WITH orders AS (
        SELECT
          pedido_id,
          ANY_VALUE(customer_id) AS customer_id,
          ANY_VALUE(status) AS status,
          ANY_VALUE(valor_liquido) AS net_amount
        FROM ${pedidos}
        WHERE DATE(data_criado) BETWEEN @dateFrom AND @dateTo
        GROUP BY pedido_id
      ),
      customer_documents AS (
        SELECT DISTINCT REGEXP_REPLACE(CAST(documento AS STRING), r'[^0-9]', '') AS document
        FROM ${clientes}
        WHERE documento IS NOT NULL
      )
      SELECT
        o.customer_id,
        SUM(o.net_amount) AS net_revenue,
        LOGICAL_OR(c.document IS NOT NULL) AS is_identified
      FROM orders o
      LEFT JOIN customer_documents c
        ON c.document = REGEXP_REPLACE(CAST(o.customer_id AS STRING), r'[^0-9]', '')
      WHERE o.customer_id IS NOT NULL AND o.status NOT IN (${cancelledList})
      GROUP BY o.customer_id
    `,
    params: { dateFrom, dateTo },
  });
  const customerRevenueRaw = customerRevenueRows as Array<
    Record<string, unknown>
  >;
  const customerAttribution = await matchErpDocumentsToUpzero(
    clientId,
    customerRevenueRaw.map((r) => r.customer_id as string | null),
  );
  let attributedCustomers = 0;
  let unattributedCustomers = 0;
  let attributedRevenue = 0;
  let unattributedRevenue = 0;
  for (const r of customerRevenueRaw) {
    const customerId = r.customer_id as string | null;
    const revenue = Number(r.net_revenue) || 0;
    const isIdentified = r.is_identified === true;
    if (customerId && customerAttribution.has(customerId)) {
      if (isIdentified) attributedCustomers += 1;
      attributedRevenue += revenue;
    } else {
      if (isIdentified) unattributedCustomers += 1;
      unattributedRevenue += revenue;
    }
  }

  const [breakdownRows] = await bigquery.query({
    query: `
      WITH orders AS (
        SELECT
          pedido_id,
          ANY_VALUE(customer_id) AS customer_id,
          COALESCE(ANY_VALUE(status), 'NAO_IDENTIFICADO') AS status,
          COALESCE(ANY_VALUE(payment_method), 'NAO_IDENTIFICADO') AS payment_method,
          COALESCE(ANY_VALUE(seller), 'NAO_IDENTIFICADO') AS seller,
          COALESCE(ANY_VALUE(store_nome), CONCAT('Loja ', CAST(ANY_VALUE(store_id) AS STRING))) AS store_name,
          ANY_VALUE(valor_liquido) AS net_amount
        FROM ${pedidos}
        WHERE DATE(data_criado) BETWEEN @dateFrom AND @dateTo
        GROUP BY pedido_id
      ),
      customer_geo AS (
        SELECT
          REGEXP_REPLACE(CAST(documento AS STRING), r'[^0-9]', '') AS document,
          COALESCE(ANY_VALUE(estado), 'NAO_IDENTIFICADO') AS state
        FROM ${clientes}
        WHERE documento IS NOT NULL
        GROUP BY document
      ),
      enriched AS (
        SELECT o.*, COALESCE(c.state, 'NAO_IDENTIFICADO') AS state
        FROM orders o
        LEFT JOIN customer_geo c
          ON c.document = REGEXP_REPLACE(CAST(o.customer_id AS STRING), r'[^0-9]', '')
      )
      SELECT
        ARRAY(
          SELECT AS STRUCT status AS label, COUNT(*) AS orders,
            SUM(IF(status IN (${cancelledList}), 0, net_amount)) AS revenue
          FROM enriched GROUP BY status ORDER BY orders DESC
        ) AS statuses,
        ARRAY(
          SELECT AS STRUCT payment_method AS label, COUNT(*) AS orders,
            SUM(IF(status IN (${cancelledList}), 0, net_amount)) AS revenue
          FROM enriched WHERE status NOT IN (${cancelledList})
          GROUP BY payment_method ORDER BY revenue DESC LIMIT 10
        ) AS payments,
        ARRAY(
          SELECT AS STRUCT seller AS label, COUNT(*) AS orders,
            SUM(net_amount) AS revenue, COUNT(DISTINCT customer_id) AS customers
          FROM enriched WHERE status NOT IN (${cancelledList})
          GROUP BY seller ORDER BY revenue DESC LIMIT 10
        ) AS sellers,
        ARRAY(
          SELECT AS STRUCT store_name AS label, COUNT(*) AS orders,
            SUM(net_amount) AS revenue
          FROM enriched WHERE status NOT IN (${cancelledList})
          GROUP BY store_name ORDER BY revenue DESC
        ) AS stores,
        ARRAY(
          SELECT AS STRUCT state AS label, COUNT(*) AS orders,
            SUM(net_amount) AS revenue, COUNT(DISTINCT customer_id) AS customers
          FROM enriched WHERE status NOT IN (${cancelledList})
          GROUP BY state ORDER BY revenue DESC LIMIT 15
        ) AS states
    `,
    params: { dateFrom, dateTo },
  });

  const breakdown = (breakdownRows as Array<Record<string, unknown>>)[0] ?? {};
  const mapBreakdown = <T>(
    value: unknown,
    mapper: (row: Record<string, unknown>) => T,
  ): T[] =>
    (Array.isArray(value) ? (value as Array<Record<string, unknown>>) : []).map(
      mapper,
    );

  const netRevenue = dailyRevenue.reduce((sum, r) => sum + r.value, 0);
  const grossRevenue = raw.reduce(
    (sum, r) => sum + (Number(r.gross_revenue) || 0),
    0,
  );
  const discountAmount = raw.reduce(
    (sum, r) => sum + (Number(r.discount_amount) || 0),
    0,
  );
  const returnAmount = raw.reduce(
    (sum, r) => sum + (Number(r.return_amount) || 0),
    0,
  );
  const totalQuantity = raw.reduce(
    (sum, r) => sum + (Number(r.quantity) || 0),
    0,
  );
  const returnedQuantity = raw.reduce(
    (sum, r) => sum + (Number(r.returned_quantity) || 0),
    0,
  );
  const cancelledOrders = raw.reduce(
    (sum, r) => sum + (Number(r.cancelled_orders) || 0),
    0,
  );
  const cancelledAmount = raw.reduce(
    (sum, r) => sum + (Number(r.cancelled_amount) || 0),
    0,
  );
  const orders = dailyOrders.reduce((sum, r) => sum + r.value, 0);

  return {
    kpis: {
      grossRevenue,
      netRevenue,
      discountAmount,
      returnAmount,
      orders,
      totalQuantity,
      returnedQuantity,
      uniqueCustomers,
      newCustomers,
      returningCustomers,
      retentionPct: calculateErpRetentionPct(
        returningCustomers,
        uniqueCustomers,
      ),
      cancelledOrders,
      cancelledAmount,
      avgTicket: orders > 0 ? netRevenue / orders : 0,
      avgItemsPerOrder: orders > 0 ? totalQuantity / orders : 0,
      returnRatePct: grossRevenue > 0 ? (returnAmount / grossRevenue) * 100 : 0,
      discountRatePct:
        grossRevenue > 0 ? (discountAmount / grossRevenue) * 100 : 0,
    },
    dailyRevenue,
    dailyOrders,
    dailyNewCustomers,
    dailyReturningCustomers,
    attribution: {
      attributedCustomers,
      unattributedCustomers,
      attributedRevenue,
      unattributedRevenue,
    },
    breakdowns: {
      statuses: mapBreakdown(breakdown.statuses, (row) => ({
        label: String(row.label ?? "NAO_IDENTIFICADO"),
        orders: Number(row.orders) || 0,
        revenue: Number(row.revenue) || 0,
      })),
      payments: mapBreakdown(breakdown.payments, (row) => ({
        label: String(row.label ?? "NAO_IDENTIFICADO"),
        orders: Number(row.orders) || 0,
        revenue: Number(row.revenue) || 0,
      })),
      sellers: mapBreakdown(breakdown.sellers, (row) => ({
        label: String(row.label ?? "NAO_IDENTIFICADO"),
        orders: Number(row.orders) || 0,
        revenue: Number(row.revenue) || 0,
        customers: Number(row.customers) || 0,
      })),
      stores: mapBreakdown(breakdown.stores, (row) => ({
        label: String(row.label ?? "NAO_IDENTIFICADO"),
        orders: Number(row.orders) || 0,
        revenue: Number(row.revenue) || 0,
      })),
      states: mapBreakdown(breakdown.states, (row) => ({
        label: String(row.label ?? "NAO_IDENTIFICADO"),
        orders: Number(row.orders) || 0,
        revenue: Number(row.revenue) || 0,
        customers: Number(row.customers) || 0,
      })),
    },
  };
}

export type ErpOrderItemRow = {
  id: string;
  sku: string | null;
  productId: string | null;
  name: string | null;
  category: string | null;
  color: string | null;
  size: string | null;
  quantity: number;
  unitPrice: number;
  costPrice: number;
  discountAmount: number;
  grossAmount: number;
  netAmount: number;
};

export type ErpOrderRow = {
  id: string;
  createdAt: string;
  customerId: string | null;
  customerName: string | null;
  company: string | null;
  document: string | null;
  seller: string | null;
  store: string | null;
  paymentMethod: string | null;
  freightAmount: number;
  channel: string;
  status: string | null;
  requestedQuantity: number;
  fulfilledQuantity: number;
  returnedQuantity: number;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  returnAmount: number;
  state: string | null;
  city: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  attributed: boolean;
  attributionEvidenceType: string | null;
  attributionEvidenceAt: string | null;
  items: ErpOrderItemRow[];
};

export type ErpOrdersPage = { rows: ErpOrderRow[]; total: number };

export async function fetchErpOrdersPage(
  clientId: string,
  dataset: string,
  dateFrom: string,
  dateTo: string,
  page: number,
  limit: number,
  search?: string,
  status?: string,
): Promise<ErpOrdersPage> {
  const pedidos = vestiTable(dataset, "pedidos_erp");
  const clientes = vestiTable(dataset, "clientes_erp");
  const offset = (page - 1) * limit;

  const baseQuery = `
    WITH orders AS (
      SELECT
        pedido_id,
        ANY_VALUE(customer_id) AS customer_id,
        ANY_VALUE(status) AS status,
        ANY_VALUE(seller) AS seller,
        ANY_VALUE(store_nome) AS store_name,
        ANY_VALUE(payment_method) AS payment_method,
        COALESCE(ANY_VALUE(frete), 0) AS freight_amount,
        COALESCE(ANY_VALUE(online), 0) AS online,
        COALESCE(ANY_VALUE(retail), 0) AS retail,
        ANY_VALUE(valor_total) AS gross_amount,
        ANY_VALUE(desconto) AS discount_amount,
        ANY_VALUE(valor_liquido) AS net_amount,
        COALESCE(ANY_VALUE(devolucao), 0) AS return_amount,
        COALESCE(ANY_VALUE(devolucao_quantidade), 0) AS returned_quantity,
        SUM(item_quantidade) AS requested_quantity,
        ANY_VALUE(data_criado) AS created_at,
        ARRAY_AGG(STRUCT(
          CAST(item_id AS STRING) AS item_id,
          CAST(item_sku_id AS STRING) AS sku_id,
          CAST(item_produto_id AS STRING) AS product_id,
          item_descricao AS item_name,
          item_categoria AS category,
          item_cor AS color,
          item_tamanho AS size,
          item_quantidade AS quantity,
          item_preco AS unit_price,
          item_preco_custo AS cost_price,
          item_desconto AS discount_amount,
          item_valor_total AS gross_amount,
          item_valor_liquido AS net_amount
        ) ORDER BY item_descricao, item_cor, item_tamanho) AS items
      FROM ${pedidos}
      WHERE DATE(data_criado) BETWEEN @dateFrom AND @dateTo
      GROUP BY pedido_id
    ),
    base AS (
      SELECT
        o.pedido_id, o.customer_id, o.status, o.seller, o.store_name, o.payment_method,
        o.freight_amount, o.online, o.retail, o.items, o.gross_amount,
        o.discount_amount, o.net_amount, o.return_amount, o.returned_quantity,
        o.requested_quantity, o.created_at,
        c.nome AS customer_name, c.marca AS company, c.documento AS document,
        c.estado AS state, c.cidade AS city
      FROM orders o
      LEFT JOIN ${clientes} c ON c.documento = o.customer_id
    )
  `;

  const conditions: string[] = [];
  if (search)
    conditions.push(
      "(LOWER(customer_name) LIKE @search OR LOWER(document) LIKE @search OR CAST(pedido_id AS STRING) LIKE @search)",
    );
  if (status) conditions.push("status = @status");
  const whereClause = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";
  const params: Record<string, unknown> = { dateFrom, dateTo, limit, offset };
  if (search) params.search = `%${search.toLowerCase()}%`;
  if (status) params.status = status;

  const [[listRows], [countRows]] = await Promise.all([
    bigquery.query({
      query: `${baseQuery} SELECT * FROM base ${whereClause} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`,
      params,
    }),
    bigquery.query({
      query: `${baseQuery} SELECT COUNT(*) AS total FROM base ${whereClause}`,
      params,
    }),
  ]);

  const rawRows = listRows as Array<Record<string, unknown>>;
  const attribution = await matchErpDocumentsToUpzero(
    clientId,
    rawRows.map(
      (r) => (r.document as string | null) ?? (r.customer_id as string | null),
    ),
  );

  const rows: ErpOrderRow[] = rawRows.map((r) => {
    const customerId = (r.customer_id as string) || null;
    const document = (r.document as string) || null;
    const attributionDocument = document ?? customerId;
    const match = attributionDocument
      ? attribution.get(attributionDocument)
      : undefined;
    return {
      id: String(r.pedido_id),
      createdAt: toDateOnly(r.created_at),
      customerId,
      customerName: (r.customer_name as string) || null,
      company: (r.company as string) || null,
      document,
      seller: (r.seller as string) || null,
      store: (r.store_name as string) || null,
      paymentMethod: (r.payment_method as string) || null,
      freightAmount: Number(r.freight_amount) || 0,
      channel:
        Number(r.online) === 1
          ? "Online"
          : Number(r.retail) === 1
            ? "Loja física"
            : "Não identificado",
      status: (r.status as string) || null,
      requestedQuantity: Number(r.requested_quantity) || 0,
      fulfilledQuantity: calculateErpFulfilledQuantity(
        Number(r.requested_quantity) || 0,
        Number(r.returned_quantity) || 0,
      ),
      returnedQuantity: Number(r.returned_quantity) || 0,
      grossAmount: Number(r.gross_amount) || 0,
      discountAmount: Number(r.discount_amount) || 0,
      netAmount: Number(r.net_amount) || 0,
      returnAmount: Number(r.return_amount) || 0,
      state: (r.state as string) || null,
      city: (r.city as string) || null,
      utmSource: match?.utmSource ?? null,
      utmMedium: match?.utmMedium ?? null,
      utmCampaign: match?.utmCampaign ?? null,
      attributed: !!match,
      attributionEvidenceType: match?.evidenceType ?? null,
      attributionEvidenceAt: match?.evidenceAt?.toISOString() ?? null,
      items: (Array.isArray(r.items)
        ? (r.items as Array<Record<string, unknown>>)
        : []
      ).map((item) => ({
        id: String(item.item_id ?? item.sku_id ?? ""),
        sku: item.sku_id ? String(item.sku_id) : null,
        productId: item.product_id ? String(item.product_id) : null,
        name: (item.item_name as string) || null,
        category: (item.category as string) || null,
        color: (item.color as string) || null,
        size: (item.size as string) || null,
        quantity: Number(item.quantity) || 0,
        unitPrice: Number(item.unit_price) || 0,
        costPrice: Number(item.cost_price) || 0,
        discountAmount: Number(item.discount_amount) || 0,
        grossAmount: Number(item.gross_amount) || 0,
        netAmount: Number(item.net_amount) || 0,
      })),
    };
  });

  return {
    rows,
    total: Number((countRows as Array<Record<string, unknown>>)[0]?.total) || 0,
  };
}

export type ErpCustomerRow = {
  id: string;
  name: string | null;
  company: string | null;
  document: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  seller: string | null;
  orders: number;
  totalSpent: number;
  averageTicket: number;
  historicalOrders: number;
  lifetimeValue: number;
  buyerType: "NEW" | "RETURNING";
  daysSinceLastOrder: number | null;
  segment: "CHAMPION" | "LOYAL" | "POTENTIAL" | "AT_RISK";
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  attributed: boolean;
};

export type ErpCustomersPage = { rows: ErpCustomerRow[]; total: number };

export async function fetchErpCustomersPage(
  clientId: string,
  dataset: string,
  dateFrom: string,
  dateTo: string,
  page: number,
  limit: number,
  search?: string,
  filters?: { buyerType?: string; seller?: string; state?: string },
): Promise<ErpCustomersPage> {
  const clientes = vestiTable(dataset, "clientes_erp");
  const pedidos = vestiTable(dataset, "pedidos_erp");
  const offset = (page - 1) * limit;
  const cancelledList = ERP_CANCELLED_STATUSES.map((s) => `'${s}'`).join(", ");

  const baseQuery = `
    WITH order_level AS (
      SELECT
        pedido_id, customer_id,
        ANY_VALUE(valor_liquido) AS net_amount,
        ANY_VALUE(data_criado) AS created_at,
        ANY_VALUE(status) AS status
      FROM ${pedidos}
      GROUP BY pedido_id, customer_id
    ),
    history AS (
      SELECT
        customer_id,
        COUNT(DISTINCT pedido_id) AS orders,
        SUM(net_amount) AS total_spent,
        MIN(created_at) AS first_order_at,
        MAX(created_at) AS last_order_at
      FROM order_level
      WHERE status NOT IN (${cancelledList})
      GROUP BY customer_id
    ),
    period_orders AS (
      SELECT
        customer_id,
        COUNT(DISTINCT pedido_id) AS orders,
        SUM(net_amount) AS total_spent
      FROM order_level
      WHERE status NOT IN (${cancelledList})
        AND DATE(created_at) BETWEEN @dateFrom AND @dateTo
      GROUP BY customer_id
    ),
    base AS (
      SELECT
        c.documento AS id, c.nome AS name, c.marca AS company, c.documento AS document,
        c.email, c.celular AS phone, c.cidade AS city, c.estado AS state, c.seller,
        COALESCE(po.orders, 0) AS orders, COALESCE(po.total_spent, 0) AS total_spent,
        COALESCE(h.orders, 0) AS historical_orders,
        COALESCE(h.total_spent, 0) AS lifetime_value,
        h.first_order_at, h.last_order_at,
        IF(DATE(h.first_order_at) >= @dateFrom, 'NEW', 'RETURNING') AS buyer_type,
        DATE_DIFF(CURRENT_DATE('America/Sao_Paulo'), DATE(h.last_order_at), DAY) AS days_since_last_order,
        CASE
          WHEN h.orders >= 4 AND DATE_DIFF(CURRENT_DATE('America/Sao_Paulo'), DATE(h.last_order_at), DAY) <= 60 THEN 'CHAMPION'
          WHEN h.orders >= 2 AND DATE_DIFF(CURRENT_DATE('America/Sao_Paulo'), DATE(h.last_order_at), DAY) <= 90 THEN 'LOYAL'
          WHEN h.orders >= 2 AND DATE_DIFF(CURRENT_DATE('America/Sao_Paulo'), DATE(h.last_order_at), DAY) > 90 THEN 'AT_RISK'
          ELSE 'POTENTIAL'
        END AS segment
      FROM ${clientes} c
      JOIN period_orders po ON po.customer_id = c.documento
      JOIN history h ON h.customer_id = c.documento
    )
  `;

  const conditions: string[] = [];
  const params: Record<string, unknown> = { limit, offset, dateFrom, dateTo };
  if (search) {
    conditions.push(
      "(LOWER(name) LIKE @search OR LOWER(document) LIKE @search OR LOWER(email) LIKE @search)",
    );
    params.search = `%${search.toLowerCase()}%`;
  }
  if (filters?.buyerType) {
    conditions.push("buyer_type = @buyerType");
    params.buyerType = filters.buyerType;
  }
  if (filters?.seller) {
    conditions.push("seller = @seller");
    params.seller = filters.seller;
  }
  if (filters?.state) {
    conditions.push("state = @state");
    params.state = filters.state;
  }
  const whereClause = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  const [[listRows], [countRows]] = await Promise.all([
    bigquery.query({
      query: `${baseQuery} SELECT * FROM base ${whereClause} ORDER BY total_spent DESC LIMIT @limit OFFSET @offset`,
      params,
    }),
    bigquery.query({
      query: `${baseQuery} SELECT COUNT(*) AS total FROM base ${whereClause}`,
      params,
    }),
  ]);

  const rawRows = listRows as Array<Record<string, unknown>>;
  const attribution = await matchErpDocumentsToUpzero(
    clientId,
    rawRows.map((r) => r.document as string | null),
  );

  const rows: ErpCustomerRow[] = rawRows.map((r) => {
    const document = (r.document as string) || null;
    const match = document ? attribution.get(document) : undefined;
    return {
      id: String(r.id),
      name: (r.name as string) || null,
      company: (r.company as string) || null,
      document,
      email: (r.email as string) || null,
      phone: (r.phone as string) || null,
      city: (r.city as string) || null,
      state: (r.state as string) || null,
      seller: (r.seller as string) || null,
      orders: Number(r.orders) || 0,
      totalSpent: Number(r.total_spent) || 0,
      averageTicket:
        Number(r.orders) > 0 ? Number(r.total_spent) / Number(r.orders) : 0,
      historicalOrders: Number(r.historical_orders) || 0,
      lifetimeValue: Number(r.lifetime_value) || 0,
      buyerType: r.buyer_type === "RETURNING" ? "RETURNING" : "NEW",
      daysSinceLastOrder:
        r.days_since_last_order === null
          ? null
          : Number(r.days_since_last_order) || 0,
      segment: ["CHAMPION", "LOYAL", "AT_RISK"].includes(String(r.segment))
        ? (r.segment as "CHAMPION" | "LOYAL" | "AT_RISK")
        : "POTENTIAL",
      firstOrderAt: r.first_order_at ? toDateOnly(r.first_order_at) : null,
      lastOrderAt: r.last_order_at ? toDateOnly(r.last_order_at) : null,
      utmSource: match?.utmSource ?? null,
      utmMedium: match?.utmMedium ?? null,
      utmCampaign: match?.utmCampaign ?? null,
      attributed: !!match,
    };
  });

  return {
    rows,
    total: Number((countRows as Array<Record<string, unknown>>)[0]?.total) || 0,
  };
}

export type ErpProductVariantRow = {
  id: string;
  sku: string;
  color: string | null;
  size: string | null;
  units: number;
  revenue: number;
  averagePrice: number;
  catalogPrice: number;
  stock: number;
  turnoverPct: number;
  salesPower: number;
  costAmount: number;
  grossProfit: number;
  grossMarginPct: number;
  coverageDays: number | null;
};

export type ErpProductRow = {
  id: string;
  name: string | null;
  category: string | null;
  units: number;
  revenue: number;
  averagePrice: number;
  stock: number;
  turnoverPct: number;
  salesPower: number;
  costAmount: number;
  grossProfit: number;
  grossMarginPct: number;
  coverageDays: number | null;
  variantCount: number;
  outOfStockCount: number;
  variants: ErpProductVariantRow[];
};

export type ErpProductsPage = {
  rows: ErpProductRow[];
  total: number;
  totalSkus: number;
  filteredTotal: number;
  totalRevenue: number;
  totalUnits: number;
  totalStock: number;
  outOfStockCount: number;
  turnoverPct: number;
  salesPower: number;
  totalCost: number;
  grossProfit: number;
  grossMarginPct: number;
  negativeStockCount: number;
  coverageDays: number | null;
  breakdowns: {
    categories: Array<{
      label: string;
      units: number;
      revenue: number;
      stock: number;
      salesPower: number;
    }>;
    colors: Array<{ label: string; units: number; revenue: number }>;
    sizes: Array<{ label: string; units: number; revenue: number }>;
  };
};

export async function fetchErpProductsPage(
  dataset: string,
  filters: {
    search?: string;
    category?: string;
    stockStatus?: "in_stock" | "out_of_stock" | "negative";
    sort?:
      | "revenue"
      | "units"
      | "stock"
      | "turnover"
      | "sales_power"
      | "margin";
    dateFrom: string;
    dateTo: string;
    page: number;
    limit: number;
  },
): Promise<ErpProductsPage> {
  const produtos = vestiTable(dataset, "produtos_erp");
  const estoque = vestiTable(dataset, "estoque_erp");
  const pedidos = vestiTable(dataset, "pedidos_erp");
  const offset = (filters.page - 1) * filters.limit;

  const conditions: string[] = [];
  const params: Record<string, unknown> = {
    limit: filters.limit,
    offset,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
  };
  if (filters.search) {
    conditions.push(
      "(LOWER(product_name) LIKE @search OR LOWER(sku_id) LIKE @search OR LOWER(product_id) LIKE @search)",
    );
    params.search = `%${filters.search.toLowerCase()}%`;
  }
  if (filters.category) {
    conditions.push("category = @category");
    params.category = filters.category;
  }
  if (filters.stockStatus === "in_stock") conditions.push("stock > 0");
  if (filters.stockStatus === "out_of_stock") conditions.push("stock = 0");
  if (filters.stockStatus === "negative") conditions.push("stock < 0");
  const whereClause = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";
  const sortColumn = {
    revenue: "revenue",
    units: "units",
    stock: "stock",
    turnover: "SAFE_DIVIDE(units, units + GREATEST(stock, 0))",
    sales_power: "sales_power",
    margin: "SAFE_DIVIDE(revenue - cost_amount, revenue)",
  }[filters.sort ?? "revenue"];

  const baseCte = `
    WITH vendas AS (
      SELECT
        CAST(item_sku_id AS STRING) AS sku_id,
        SUM(item_quantidade) AS units,
        SUM(item_valor_liquido) AS revenue,
        SUM(COALESCE(item_preco_custo, 0) * COALESCE(item_quantidade, 0)) AS cost_amount
      FROM ${pedidos}
      WHERE DATE(data_criado) BETWEEN @dateFrom AND @dateTo
        AND status NOT IN (${ERP_CANCELLED_STATUSES.map((status) => `'${status}'`).join(", ")})
      GROUP BY item_sku_id
    ),
    estoque_agg AS (
      SELECT CAST(sku_id AS STRING) AS sku_id, SUM(estoque) AS stock
      FROM ${estoque}
      GROUP BY sku_id
    ),
    catalog AS (
      SELECT
        CAST(p.sku_id AS STRING) AS sku_id,
        COALESCE(ANY_VALUE(CAST(p.produto_id AS STRING)), CAST(p.sku_id AS STRING)) AS product_id,
        ANY_VALUE(p.produto_descricao) AS product_name,
        ANY_VALUE(p.categoria) AS category,
        ANY_VALUE(p.cor) AS color,
        ANY_VALUE(p.tamanho) AS size,
        MAX(COALESCE(p.preco_custo, 0)) AS cost_price,
        MAX(COALESCE(
          NULLIF(p.promocao_online, 0),
          NULLIF(p.preco_online, 0),
          NULLIF(p.promocao_varejo, 0),
          NULLIF(p.preco_varejo, 0),
          0
        )) AS catalog_price
      FROM ${produtos} p
      GROUP BY p.sku_id
    ),
    sku_base AS (
      SELECT
        p.sku_id, p.product_id, p.product_name, p.category, p.color, p.size,
        p.catalog_price, p.cost_price,
        COALESCE(v.units, 0) AS units, COALESCE(v.revenue, 0) AS revenue,
        COALESCE(v.cost_amount, 0) AS cost_amount,
        COALESCE(e.stock, 0) AS stock,
        GREATEST(COALESCE(e.stock, 0), 0) * GREATEST(p.catalog_price, 0) AS sales_power
      FROM catalog p
      LEFT JOIN vendas v ON v.sku_id = p.sku_id
      LEFT JOIN estoque_agg e ON e.sku_id = p.sku_id
    ),
    filtered_skus AS (
      SELECT * FROM sku_base ${whereClause}
    ),
    products AS (
      SELECT
        product_id,
        ANY_VALUE(product_name) AS product_name,
        ANY_VALUE(category) AS category,
        SUM(units) AS units,
        SUM(revenue) AS revenue,
        SUM(cost_amount) AS cost_amount,
        SUM(stock) AS stock,
        SUM(GREATEST(stock, 0)) AS available_stock,
        SUM(sales_power) AS sales_power,
        COUNT(*) AS variant_count,
        COUNTIF(stock <= 0) AS out_of_stock_count,
        ARRAY_AGG(STRUCT(
          sku_id,
          color,
          size,
          units,
          revenue,
          cost_amount,
          cost_price,
          catalog_price,
          stock,
          sales_power
        ) ORDER BY revenue DESC, sku_id) AS variants
      FROM filtered_skus
      GROUP BY product_id
    )
  `;

  const [[rows], [filteredTotalRows], [totalsRows], [breakdownRows]] =
    await Promise.all([
      bigquery.query({
        query: `
      ${baseCte}
      SELECT * FROM products
      ORDER BY ${sortColumn} DESC
      LIMIT @limit OFFSET @offset
    `,
        params,
      }),
      bigquery.query({
        query: `${baseCte} SELECT COUNT(*) AS total FROM products`,
        params,
      }),
      bigquery.query({
        query: `
        ${baseCte}
        SELECT
          COUNT(DISTINCT product_id) AS total_products,
          COUNT(*) AS total_skus,
          SUM(revenue) AS total_revenue,
          SUM(cost_amount) AS total_cost,
          SUM(units) AS total_units,
          SUM(stock) AS total_stock,
          SUM(GREATEST(stock, 0)) AS available_stock,
          COUNTIF(stock <= 0) AS out_of_stock_count,
          COUNTIF(stock < 0) AS negative_stock_count,
          SUM(sales_power) AS sales_power
        FROM filtered_skus
      `,
        params,
      }),
      bigquery.query({
        query: `
        ${baseCte}
        SELECT
          ARRAY(
            SELECT AS STRUCT COALESCE(category, 'NAO_IDENTIFICADO') AS label,
              SUM(units) AS units, SUM(revenue) AS revenue, SUM(stock) AS stock,
              SUM(sales_power) AS sales_power
            FROM filtered_skus GROUP BY label ORDER BY revenue DESC LIMIT 15
          ) AS categories,
          ARRAY(
            SELECT AS STRUCT COALESCE(color, 'NAO_IDENTIFICADO') AS label,
              SUM(units) AS units, SUM(revenue) AS revenue
            FROM filtered_skus GROUP BY label ORDER BY revenue DESC LIMIT 15
          ) AS colors,
          ARRAY(
            SELECT AS STRUCT COALESCE(size, 'NAO_IDENTIFICADO') AS label,
              SUM(units) AS units, SUM(revenue) AS revenue
            FROM filtered_skus GROUP BY label ORDER BY revenue DESC LIMIT 15
          ) AS sizes
      `,
        params,
      }),
    ]);

  const t = (totalsRows as Array<Record<string, unknown>>)[0];
  const breakdown = (breakdownRows as Array<Record<string, unknown>>)[0] ?? {};
  const periodDays = Math.max(
    1,
    Math.round(
      (new Date(`${filters.dateTo}T00:00:00Z`).getTime() -
        new Date(`${filters.dateFrom}T00:00:00Z`).getTime()) /
        86_400_000,
    ) + 1,
  );
  const coverageDays = (units: number, stock: number): number | null => {
    if (units <= 0) return null;
    return Math.max(stock, 0) / (units / periodDays);
  };
  const mapBreakdown = <T>(
    value: unknown,
    mapper: (row: Record<string, unknown>) => T,
  ): T[] =>
    (Array.isArray(value) ? (value as Array<Record<string, unknown>>) : []).map(
      mapper,
    );

  return {
    rows: (rows as Array<Record<string, unknown>>).map((r) => {
      const units = Number(r.units) || 0;
      const stock = Number(r.stock) || 0;
      const availableStock = Number(r.available_stock) || 0;
      const rawVariants = Array.isArray(r.variants)
        ? (r.variants as Array<Record<string, unknown>>)
        : [];
      const revenue = Number(r.revenue) || 0;
      const costAmount = Number(r.cost_amount) || 0;
      const grossProfit = revenue - costAmount;
      return {
        id: String(r.product_id),
        name: (r.product_name as string) || null,
        category: (r.category as string) || null,
        units,
        revenue,
        averagePrice: units > 0 ? revenue / units : 0,
        stock,
        turnoverPct: calculateErpStockTurnoverPct(units, availableStock),
        salesPower: Number(r.sales_power) || 0,
        costAmount,
        grossProfit,
        grossMarginPct: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
        coverageDays: coverageDays(units, availableStock),
        variantCount: Number(r.variant_count) || 0,
        outOfStockCount: Number(r.out_of_stock_count) || 0,
        variants: rawVariants.map((variant) => {
          const variantUnits = Number(variant.units) || 0;
          const variantStock = Number(variant.stock) || 0;
          const variantRevenue = Number(variant.revenue) || 0;
          const variantCost = Number(variant.cost_amount) || 0;
          const variantProfit = variantRevenue - variantCost;
          return {
            id: String(variant.sku_id),
            sku: String(variant.sku_id),
            color: (variant.color as string) || null,
            size: (variant.size as string) || null,
            units: variantUnits,
            revenue: variantRevenue,
            averagePrice: variantUnits > 0 ? variantRevenue / variantUnits : 0,
            catalogPrice: Number(variant.catalog_price) || 0,
            stock: variantStock,
            turnoverPct: calculateErpStockTurnoverPct(
              variantUnits,
              variantStock,
            ),
            salesPower: Number(variant.sales_power) || 0,
            costAmount: variantCost,
            grossProfit: variantProfit,
            grossMarginPct:
              variantRevenue > 0 ? (variantProfit / variantRevenue) * 100 : 0,
            coverageDays: coverageDays(variantUnits, variantStock),
          };
        }),
      };
    }),
    total: Number(t?.total_products) || 0,
    totalSkus: Number(t?.total_skus) || 0,
    filteredTotal:
      Number((filteredTotalRows as Array<Record<string, unknown>>)[0]?.total) ||
      0,
    totalRevenue: Number(t?.total_revenue) || 0,
    totalUnits: Number(t?.total_units) || 0,
    totalStock: Number(t?.total_stock) || 0,
    outOfStockCount: Number(t?.out_of_stock_count) || 0,
    turnoverPct: calculateErpStockTurnoverPct(
      Number(t?.total_units) || 0,
      Number(t?.available_stock) || 0,
    ),
    salesPower: Number(t?.sales_power) || 0,
    totalCost: Number(t?.total_cost) || 0,
    grossProfit: (Number(t?.total_revenue) || 0) - (Number(t?.total_cost) || 0),
    grossMarginPct:
      Number(t?.total_revenue) > 0
        ? (((Number(t?.total_revenue) || 0) - (Number(t?.total_cost) || 0)) /
            Number(t?.total_revenue)) *
          100
        : 0,
    negativeStockCount: Number(t?.negative_stock_count) || 0,
    coverageDays: coverageDays(
      Number(t?.total_units) || 0,
      Number(t?.available_stock) || 0,
    ),
    breakdowns: {
      categories: mapBreakdown(breakdown.categories, (row) => ({
        label: String(row.label ?? "NAO_IDENTIFICADO"),
        units: Number(row.units) || 0,
        revenue: Number(row.revenue) || 0,
        stock: Number(row.stock) || 0,
        salesPower: Number(row.salesPower ?? row.sales_power) || 0,
      })),
      colors: mapBreakdown(breakdown.colors, (row) => ({
        label: String(row.label ?? "NAO_IDENTIFICADO"),
        units: Number(row.units) || 0,
        revenue: Number(row.revenue) || 0,
      })),
      sizes: mapBreakdown(breakdown.sizes, (row) => ({
        label: String(row.label ?? "NAO_IDENTIFICADO"),
        units: Number(row.units) || 0,
        revenue: Number(row.revenue) || 0,
      })),
    },
  };
}
