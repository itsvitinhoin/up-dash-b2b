import { and, eq, inArray } from "drizzle-orm";
import { db, campaignAttributionStampsTable, clientsTable, customersTable } from "@workspace/db";
import { bigquery, vestiTable } from "../lib/bigquery";
import { hashDocument } from "./upzero/customers";
import {
  calculateErpFulfilledQuantity,
  calculateErpRetentionPct,
  hasPaidErpCampaignSignal,
} from "./erpMetrics";

/**
 * Se o client tiver um dataset de ERP configurado (independente de
 * commercePlatform — um client UpZero como a Obzee pode ter ERP sem ser
 * Vesti), devolve o dataset. Senão, `null`.
 */
export async function resolveErpDataset(clientId: string): Promise<string | null> {
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

async function matchErpDocumentsToUpzero(
  clientId: string,
  documents: Array<string | null | undefined>,
): Promise<Map<string, ErpAttribution>> {
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
    .where(and(eq(customersTable.clientId, clientId), inArray(customersTable.documentHash, hashes)));

  const byHash = new Map<string, ErpAttribution>();
  for (const r of rows) {
    if (!r.documentHash) continue;
    const attribution: ErpAttribution = {
      utmSource: r.stampSource ?? r.utmSource,
      utmMedium: r.stampMedium ?? r.utmMedium,
      utmCampaign: r.stampCampaign ?? r.utmCampaign,
      evidenceType: r.stampEvidenceType ?? "customer_utm",
      evidenceAt: r.stampEvidenceAt ?? null,
    };
    if (!r.stampId && !hasPaidErpCampaignSignal(attribution)) continue;

    const current = byHash.get(r.documentHash);
    if (!current || (!current.evidenceAt && attribution.evidenceAt) || (current.evidenceAt && attribution.evidenceAt && attribution.evidenceAt < current.evidenceAt)) {
      byHash.set(r.documentHash, attribution);
    }
  }

  const byDocument = new Map<string, ErpAttribution>();
  for (const [doc, hash] of hashByDocument) {
    const match = byHash.get(hash);
    if (match) byDocument.set(doc, match);
  }
  return byDocument;
}

function toDateOnly(value: unknown): string {
  if (value && typeof value === "object" && "value" in (value as Record<string, unknown>)) {
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
};

const ERP_CANCELLED_STATUSES = ["CANCELADO", "EXCLUIDO"];

export async function fetchErpDashboard(clientId: string, dataset: string, dateFrom: string, dateTo: string): Promise<ErpDashboard> {
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
  const dailyRevenue = raw.map((r) => ({ date: toDateOnly(r.date), value: Number(r.net_revenue) || 0 }));
  const dailyOrders = raw.map((r) => ({ date: toDateOnly(r.date), value: Number(r.orders) || 0 }));
  const dailyNewCustomers = raw.map((r) => ({ date: toDateOnly(r.date), value: Number(r.new_customers) || 0 }));
  const dailyReturningCustomers = raw.map((r) => ({ date: toDateOnly(r.date), value: Number(r.returning_customers) || 0 }));

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
  const customerSegments = (customerSegmentRows as Array<Record<string, unknown>>)[0];
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
  const customerRevenueRaw = customerRevenueRows as Array<Record<string, unknown>>;
  const customerAttribution = await matchErpDocumentsToUpzero(clientId, customerRevenueRaw.map((r) => r.customer_id as string | null));
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

  const netRevenue = dailyRevenue.reduce((sum, r) => sum + r.value, 0);
  const grossRevenue = raw.reduce((sum, r) => sum + (Number(r.gross_revenue) || 0), 0);
  const discountAmount = raw.reduce((sum, r) => sum + (Number(r.discount_amount) || 0), 0);
  const returnAmount = raw.reduce((sum, r) => sum + (Number(r.return_amount) || 0), 0);
  const totalQuantity = raw.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);
  const returnedQuantity = raw.reduce((sum, r) => sum + (Number(r.returned_quantity) || 0), 0);
  const cancelledOrders = raw.reduce((sum, r) => sum + (Number(r.cancelled_orders) || 0), 0);
  const cancelledAmount = raw.reduce((sum, r) => sum + (Number(r.cancelled_amount) || 0), 0);
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
      retentionPct: calculateErpRetentionPct(returningCustomers, uniqueCustomers),
      cancelledOrders,
      cancelledAmount,
      avgTicket: orders > 0 ? netRevenue / orders : 0,
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
  };
}

export type ErpOrderRow = {
  id: string;
  createdAt: string;
  customerId: string | null;
  customerName: string | null;
  company: string | null;
  document: string | null;
  seller: string | null;
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
        ANY_VALUE(valor_total) AS gross_amount,
        ANY_VALUE(desconto) AS discount_amount,
        ANY_VALUE(valor_liquido) AS net_amount,
        COALESCE(ANY_VALUE(devolucao), 0) AS return_amount,
        COALESCE(ANY_VALUE(devolucao_quantidade), 0) AS returned_quantity,
        SUM(item_quantidade) AS requested_quantity,
        ANY_VALUE(data_criado) AS created_at
      FROM ${pedidos}
      WHERE DATE(data_criado) BETWEEN @dateFrom AND @dateTo
      GROUP BY pedido_id
    ),
    base AS (
      SELECT
        o.pedido_id, o.customer_id, o.status, o.seller, o.gross_amount,
        o.discount_amount, o.net_amount, o.return_amount, o.returned_quantity,
        o.requested_quantity, o.created_at,
        c.nome AS customer_name, c.marca AS company, c.documento AS document,
        c.estado AS state, c.cidade AS city
      FROM orders o
      LEFT JOIN ${clientes} c ON c.documento = o.customer_id
    )
  `;

  const conditions: string[] = [];
  if (search) conditions.push("(LOWER(customer_name) LIKE @search OR LOWER(document) LIKE @search OR CAST(pedido_id AS STRING) LIKE @search)");
  if (status) conditions.push("status = @status");
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const params: Record<string, unknown> = { dateFrom, dateTo, limit, offset };
  if (search) params.search = `%${search.toLowerCase()}%`;
  if (status) params.status = status;

  const [[listRows], [countRows]] = await Promise.all([
    bigquery.query({
      query: `${baseQuery} SELECT * FROM base ${whereClause} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`,
      params,
    }),
    bigquery.query({ query: `${baseQuery} SELECT COUNT(*) AS total FROM base ${whereClause}`, params }),
  ]);

  const rawRows = listRows as Array<Record<string, unknown>>;
  const attribution = await matchErpDocumentsToUpzero(
    clientId,
    rawRows.map((r) => (r.document as string | null) ?? (r.customer_id as string | null)),
  );

  const rows: ErpOrderRow[] = rawRows.map((r) => {
    const customerId = (r.customer_id as string) || null;
    const document = (r.document as string) || null;
    const attributionDocument = document ?? customerId;
    const match = attributionDocument ? attribution.get(attributionDocument) : undefined;
    return {
      id: String(r.pedido_id),
      createdAt: toDateOnly(r.created_at),
      customerId,
      customerName: (r.customer_name as string) || null,
      company: (r.company as string) || null,
      document,
      seller: (r.seller as string) || null,
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
    };
  });

  return { rows, total: Number((countRows as Array<Record<string, unknown>>)[0]?.total) || 0 };
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
  page: number,
  limit: number,
  search?: string,
): Promise<ErpCustomersPage> {
  const clientes = vestiTable(dataset, "clientes_erp");
  const pedidos = vestiTable(dataset, "pedidos_erp");
  const offset = (page - 1) * limit;
  const cancelledList = ERP_CANCELLED_STATUSES.map((s) => `'${s}'`).join(", ");

  const baseQuery = `
    WITH orders_agg AS (
      SELECT
        customer_id,
        COUNT(DISTINCT pedido_id) AS orders,
        SUM(valor_liquido_dedup) AS total_spent,
        MIN(created_at) AS first_order_at,
        MAX(created_at) AS last_order_at
      FROM (
        SELECT
          pedido_id, customer_id,
          ANY_VALUE(valor_liquido) AS valor_liquido_dedup,
          ANY_VALUE(data_criado) AS created_at,
          ANY_VALUE(status) AS status
        FROM ${pedidos}
        GROUP BY pedido_id, customer_id
      )
      WHERE status NOT IN (${cancelledList})
      GROUP BY customer_id
    ),
    base AS (
      SELECT
        c.documento AS id, c.nome AS name, c.marca AS company, c.documento AS document,
        c.email, c.celular AS phone, c.cidade AS city, c.estado AS state, c.seller,
        COALESCE(oa.orders, 0) AS orders, COALESCE(oa.total_spent, 0) AS total_spent,
        oa.first_order_at, oa.last_order_at
      FROM ${clientes} c
      LEFT JOIN orders_agg oa ON oa.customer_id = c.documento
    )
  `;

  const whereClause = search
    ? `WHERE (LOWER(name) LIKE @search OR LOWER(document) LIKE @search OR LOWER(email) LIKE @search)`
    : "";
  const params: Record<string, unknown> = { limit, offset };
  if (search) params.search = `%${search.toLowerCase()}%`;

  const [[listRows], [countRows]] = await Promise.all([
    bigquery.query({
      query: `${baseQuery} SELECT * FROM base ${whereClause} ORDER BY total_spent DESC LIMIT @limit OFFSET @offset`,
      params,
    }),
    bigquery.query({ query: `${baseQuery} SELECT COUNT(*) AS total FROM base ${whereClause}`, params }),
  ]);

  const rawRows = listRows as Array<Record<string, unknown>>;
  const attribution = await matchErpDocumentsToUpzero(clientId, rawRows.map((r) => r.document as string | null));

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
      averageTicket: Number(r.orders) > 0 ? Number(r.total_spent) / Number(r.orders) : 0,
      firstOrderAt: r.first_order_at ? toDateOnly(r.first_order_at) : null,
      lastOrderAt: r.last_order_at ? toDateOnly(r.last_order_at) : null,
      utmSource: match?.utmSource ?? null,
      utmMedium: match?.utmMedium ?? null,
      utmCampaign: match?.utmCampaign ?? null,
      attributed: !!match,
    };
  });

  return { rows, total: Number((countRows as Array<Record<string, unknown>>)[0]?.total) || 0 };
}

export type ErpProductRow = {
  id: string;
  name: string | null;
  sku: string;
  category: string | null;
  color: string | null;
  size: string | null;
  units: number;
  revenue: number;
  averagePrice: number;
  stock: number;
};

export type ErpProductsPage = {
  rows: ErpProductRow[];
  total: number;
  filteredTotal: number;
  totalRevenue: number;
  totalUnits: number;
  totalStock: number;
  outOfStockCount: number;
};

export async function fetchErpProductsPage(
  dataset: string,
  filters: { search?: string; category?: string; dateFrom: string; dateTo: string; page: number; limit: number },
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
    conditions.push("(LOWER(produto_descricao) LIKE @search OR LOWER(sku_id) LIKE @search)");
    params.search = `%${filters.search.toLowerCase()}%`;
  }
  if (filters.category) {
    conditions.push("categoria = @category");
    params.category = filters.category;
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const baseCte = `
    WITH vendas AS (
      SELECT item_sku_id AS sku_id, SUM(item_quantidade) AS units, SUM(item_valor_liquido) AS revenue
      FROM ${pedidos}
      WHERE DATE(data_criado) BETWEEN @dateFrom AND @dateTo
        AND status NOT IN (${ERP_CANCELLED_STATUSES.map((status) => `'${status}'`).join(", ")})
      GROUP BY item_sku_id
    ),
    estoque_agg AS (
      SELECT sku_id, SUM(estoque) AS stock
      FROM ${estoque}
      GROUP BY sku_id
    ),
    base AS (
      SELECT
        p.sku_id, p.produto_descricao, p.categoria, p.cor, p.tamanho,
        COALESCE(v.units, 0) AS units, COALESCE(v.revenue, 0) AS revenue,
        COALESCE(e.stock, 0) AS stock
      FROM ${produtos} p
      LEFT JOIN vendas v ON v.sku_id = p.sku_id
      LEFT JOIN estoque_agg e ON e.sku_id = p.sku_id
    )
  `;

  const [[rows], [filteredTotalRows], [totalsRows]] = await Promise.all([
    bigquery.query({
      query: `
      ${baseCte}
      SELECT * FROM base
      ${whereClause}
      ORDER BY revenue DESC
      LIMIT @limit OFFSET @offset
    `,
      params,
    }),
    bigquery.query({
      query: `${baseCte} SELECT COUNT(*) AS total FROM base ${whereClause}`,
      params,
    }),
    bigquery.query({
      query: `
        WITH vendas AS (
          SELECT SUM(item_quantidade) AS units, SUM(item_valor_liquido) AS revenue
          FROM ${pedidos}
          WHERE DATE(data_criado) BETWEEN @dateFrom AND @dateTo
            AND status NOT IN (${ERP_CANCELLED_STATUSES.map((status) => `'${status}'`).join(", ")})
        ),
        estoque_agg AS (
          SELECT sku_id, SUM(estoque) AS stock
          FROM ${estoque}
          GROUP BY sku_id
        ),
        catalog_stock AS (
          SELECT p.sku_id, COALESCE(e.stock, 0) AS stock
          FROM ${produtos} p
          LEFT JOIN estoque_agg e ON e.sku_id = p.sku_id
        )
        SELECT
          (SELECT COUNT(*) FROM ${produtos}) AS total_products,
          (SELECT revenue FROM vendas) AS total_revenue,
          (SELECT units FROM vendas) AS total_units,
          (SELECT SUM(stock) FROM catalog_stock) AS total_stock,
          (SELECT COUNTIF(stock <= 0) FROM catalog_stock) AS out_of_stock_count
      `,
      params,
    }),
  ]);

  const t = (totalsRows as Array<Record<string, unknown>>)[0];

  return {
    rows: (rows as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.sku_id),
      name: (r.produto_descricao as string) || null,
      sku: String(r.sku_id),
      category: (r.categoria as string) || null,
      color: (r.cor as string) || null,
      size: (r.tamanho as string) || null,
      units: Number(r.units) || 0,
      revenue: Number(r.revenue) || 0,
      averagePrice: Number(r.units) > 0 ? Number(r.revenue) / Number(r.units) : 0,
      stock: Number(r.stock) || 0,
    })),
    total: Number(t?.total_products) || 0,
    filteredTotal: Number((filteredTotalRows as Array<Record<string, unknown>>)[0]?.total) || 0,
    totalRevenue: Number(t?.total_revenue) || 0,
    totalUnits: Number(t?.total_units) || 0,
    totalStock: Number(t?.total_stock) || 0,
    outOfStockCount: Number(t?.out_of_stock_count) || 0,
  };
}
