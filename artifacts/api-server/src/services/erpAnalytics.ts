import { eq } from "drizzle-orm";
import { db, clientsTable } from "@workspace/db";
import { bigquery, vestiTable } from "../lib/bigquery";

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
// Não existe UTM/atribuição/gasto de mídia em nenhuma tabela ERP — a
// atribuição por campanha/canal (que o mock de erp.tsx tem) não dá pra
// computar só com esse dado; ficou registrado como pendente separado.

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
    uniqueCustomers: number;
    newCustomers: number;
    returningCustomers: number;
    retentionPct: number;
    cancelledOrders: number;
    cancelledAmount: number;
    avgTicket: number;
  };
  dailyRevenue: { date: string; value: number }[];
  dailyOrders: { date: string; value: number }[];
  dailyNewCustomers: { date: string; value: number }[];
  dailyReturningCustomers: { date: string; value: number }[];
};

const ERP_CANCELLED_STATUSES = ["CANCELADO", "EXCLUIDO"];

export async function fetchErpDashboard(dataset: string, dateFrom: string, dateTo: string): Promise<ErpDashboard> {
  const pedidos = vestiTable(dataset, "pedidos_erp");
  const cancelledList = ERP_CANCELLED_STATUSES.map((s) => `'${s}'`).join(", ");

  const [dailyRows] = await bigquery.query({
    query: `
      WITH orders AS (
        SELECT
          pedido_id,
          ANY_VALUE(customer_id) AS customer_id,
          ANY_VALUE(status) AS status,
          ANY_VALUE(valor_total) AS gross_amount,
          ANY_VALUE(desconto) AS discount_amount,
          ANY_VALUE(valor_liquido) AS net_amount,
          SUM(item_quantidade) AS quantity,
          ANY_VALUE(DATE(data_criado)) AS date
        FROM ${pedidos}
        WHERE DATE(data_criado) BETWEEN @dateFrom AND @dateTo
        GROUP BY pedido_id
      ),
      customer_history AS (
        SELECT customer_id, COUNT(DISTINCT pedido_id) AS total_orders
        FROM ${pedidos}
        WHERE customer_id IS NOT NULL
        GROUP BY customer_id
      )
      SELECT
        o.date,
        COUNT(*) AS orders,
        COALESCE(SUM(IF(o.status IN (${cancelledList}), 0, o.gross_amount)), 0) AS gross_revenue,
        COALESCE(SUM(IF(o.status IN (${cancelledList}), 0, o.discount_amount)), 0) AS discount_amount,
        COALESCE(SUM(IF(o.status IN (${cancelledList}), 0, o.net_amount)), 0) AS net_revenue,
        COALESCE(SUM(IF(o.status IN (${cancelledList}), 0, o.quantity)), 0) AS quantity,
        COUNTIF(o.status IN (${cancelledList})) AS cancelled_orders,
        COALESCE(SUM(IF(o.status IN (${cancelledList}), o.net_amount, 0)), 0) AS cancelled_amount,
        COUNT(DISTINCT IF(ch.total_orders <= 1, o.customer_id, NULL)) AS new_customers,
        COUNT(DISTINCT IF(ch.total_orders > 1, o.customer_id, NULL)) AS returning_customers
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

  const [uniqueRows] = await bigquery.query({
    query: `
      WITH orders AS (
        SELECT pedido_id, ANY_VALUE(customer_id) AS customer_id
        FROM ${pedidos}
        WHERE DATE(data_criado) BETWEEN @dateFrom AND @dateTo
        GROUP BY pedido_id
      )
      SELECT COUNT(DISTINCT customer_id) AS unique_customers
      FROM orders
      WHERE customer_id IS NOT NULL
    `,
    params: { dateFrom, dateTo },
  });
  const uniqueCustomers = Number((uniqueRows as Array<Record<string, unknown>>)[0]?.unique_customers) || 0;

  const netRevenue = dailyRevenue.reduce((sum, r) => sum + r.value, 0);
  const grossRevenue = raw.reduce((sum, r) => sum + (Number(r.gross_revenue) || 0), 0);
  const discountAmount = raw.reduce((sum, r) => sum + (Number(r.discount_amount) || 0), 0);
  const totalQuantity = raw.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);
  const cancelledOrders = raw.reduce((sum, r) => sum + (Number(r.cancelled_orders) || 0), 0);
  const cancelledAmount = raw.reduce((sum, r) => sum + (Number(r.cancelled_amount) || 0), 0);
  const orders = dailyOrders.reduce((sum, r) => sum + r.value, 0) - cancelledOrders;
  const newCustomers = dailyNewCustomers.reduce((sum, r) => sum + r.value, 0);
  const returningCustomers = dailyReturningCustomers.reduce((sum, r) => sum + r.value, 0);
  const totalBuyers = newCustomers + returningCustomers;

  return {
    kpis: {
      grossRevenue,
      netRevenue,
      discountAmount,
      orders,
      totalQuantity,
      uniqueCustomers,
      newCustomers,
      returningCustomers,
      retentionPct: totalBuyers > 0 ? (returningCustomers / totalBuyers) * 100 : 0,
      cancelledOrders,
      cancelledAmount,
      avgTicket: orders > 0 ? netRevenue / orders : 0,
    },
    dailyRevenue,
    dailyOrders,
    dailyNewCustomers,
    dailyReturningCustomers,
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
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  state: string | null;
  city: string | null;
};

export type ErpOrdersPage = { rows: ErpOrderRow[]; total: number };

export async function fetchErpOrdersPage(
  dataset: string,
  dateFrom: string,
  dateTo: string,
  page: number,
  limit: number,
  search?: string,
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
        SUM(item_quantidade) AS requested_quantity,
        ANY_VALUE(data_criado) AS created_at
      FROM ${pedidos}
      WHERE DATE(data_criado) BETWEEN @dateFrom AND @dateTo
      GROUP BY pedido_id
    ),
    base AS (
      SELECT
        o.pedido_id, o.customer_id, o.status, o.seller, o.gross_amount,
        o.discount_amount, o.net_amount, o.requested_quantity, o.created_at,
        c.nome AS customer_name, c.marca AS company, c.documento AS document,
        c.estado AS state, c.cidade AS city
      FROM orders o
      LEFT JOIN ${clientes} c ON c.documento = o.customer_id
    )
  `;

  const whereClause = search
    ? `WHERE (LOWER(customer_name) LIKE @search OR LOWER(document) LIKE @search OR CAST(pedido_id AS STRING) LIKE @search)`
    : "";
  const params: Record<string, unknown> = { dateFrom, dateTo, limit, offset };
  if (search) params.search = `%${search.toLowerCase()}%`;

  const [[listRows], [countRows]] = await Promise.all([
    bigquery.query({
      query: `${baseQuery} SELECT * FROM base ${whereClause} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`,
      params,
    }),
    bigquery.query({ query: `${baseQuery} SELECT COUNT(*) AS total FROM base ${whereClause}`, params }),
  ]);

  const rows: ErpOrderRow[] = (listRows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.pedido_id),
    createdAt: toDateOnly(r.created_at),
    customerId: (r.customer_id as string) || null,
    customerName: (r.customer_name as string) || null,
    company: (r.company as string) || null,
    document: (r.document as string) || null,
    seller: (r.seller as string) || null,
    status: (r.status as string) || null,
    requestedQuantity: Number(r.requested_quantity) || 0,
    fulfilledQuantity: Number(r.requested_quantity) || 0,
    grossAmount: Number(r.gross_amount) || 0,
    discountAmount: Number(r.discount_amount) || 0,
    netAmount: Number(r.net_amount) || 0,
    state: (r.state as string) || null,
    city: (r.city as string) || null,
  }));

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
};

export type ErpCustomersPage = { rows: ErpCustomerRow[]; total: number };

export async function fetchErpCustomersPage(
  dataset: string,
  page: number,
  limit: number,
  search?: string,
): Promise<ErpCustomersPage> {
  const clientes = vestiTable(dataset, "clientes_erp");
  const pedidos = vestiTable(dataset, "pedidos_erp");
  const offset = (page - 1) * limit;

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
          ANY_VALUE(data_criado) AS created_at
        FROM ${pedidos}
        GROUP BY pedido_id, customer_id
      )
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

  const rows: ErpCustomerRow[] = (listRows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    name: (r.name as string) || null,
    company: (r.company as string) || null,
    document: (r.document as string) || null,
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
  }));

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
  filters: { search?: string; category?: string; page: number; limit: number },
): Promise<ErpProductsPage> {
  const produtos = vestiTable(dataset, "produtos_erp");
  const estoque = vestiTable(dataset, "estoque_erp");
  const pedidos = vestiTable(dataset, "pedidos_erp");
  const offset = (filters.page - 1) * filters.limit;

  const conditions: string[] = [];
  const params: Record<string, unknown> = { limit: filters.limit, offset };
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
      SELECT item_sku_id AS sku_id, SUM(item_quantidade) AS units, SUM(item_valor_total) AS revenue
      FROM ${pedidos}
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
          SELECT SUM(item_quantidade) AS units, SUM(item_valor_total) AS revenue
          FROM ${pedidos}
        ),
        estoque_agg AS (
          SELECT SUM(estoque) AS stock, COUNTIF(estoque <= 0) AS out_of_stock
          FROM (SELECT sku_id, SUM(estoque) AS estoque FROM ${estoque} GROUP BY sku_id)
        )
        SELECT
          (SELECT COUNT(*) FROM ${produtos}) AS total_products,
          (SELECT revenue FROM vendas) AS total_revenue,
          (SELECT units FROM vendas) AS total_units,
          (SELECT stock FROM estoque_agg) AS total_stock,
          (SELECT out_of_stock FROM estoque_agg) AS out_of_stock_count
      `,
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
