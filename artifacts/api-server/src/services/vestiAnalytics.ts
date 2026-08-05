import { eq } from "drizzle-orm";
import { db, clientsTable } from "@workspace/db";
import { bigquery, vestiTable } from "../lib/bigquery";
import { stateFromPhoneDdd } from "../lib/phoneState";
import { getOpenAIClient, isAIConfigured } from "../lib/openai";
import { addDaysToDateOnly } from "../lib/httpQuery";

/**
 * Se o client for Vesti e tiver dataset configurado, devolve o dataset.
 * Senão, `null` — usado pelas rotas em analytics.ts pra decidir se
 * delegam pro controller Vesti ou seguem o caminho Postgres normal.
 */
export async function resolveVestiDataset(clientId: string): Promise<string | null> {
  const [row] = await db
    .select({ commercePlatform: clientsTable.commercePlatform, bigqueryDataset: clientsTable.bigqueryDataset })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));
  if (row?.commercePlatform !== "VESTI") return null;
  return row.bigqueryDataset ?? null;
}

// Fonte: `dashboard_vendas_view` (BigQuery, projeto up-vesti-report) — a
// mesma view que o backend-dash já usa em produção (não a tabela
// `dashboard_vendas_cache_final`, que é uma materialização e fica
// desatualizada). Uma linha por item de pedido; valor_solicitado/
// valor_reservado vêm "esparsos" no nível do PEDIDO (o total aparece numa
// única linha, as demais linhas do mesmo pedido trazem 0) — por isso dá
// pra somar direto sem duplicar. Já produto_preco_unitario/quantidade são
// por ITEM de verdade, usados pro breakdown por categoria.
//
// Mapeamento de conceitos (não existe "sessão"/"tráfego" no lado Vesti,
// é venda por atacado via vendedora, não e-commerce):
//   leads         = pedidos solicitados (todo pedido que entrou)
//   approvedLeads = pedidos pagos (pago = true)
//   approvalRate  = approvedLeads / leads
//   orders        = pedidos pagos (equivalente ao "orders" já confirmados)
//   revenue       = soma do valor reservado/pago
//   requestedRevenue = soma do valor solicitado (independente de ter sido pago)
//
// Filtros suportados: category (via join com produtos_vesti, primeira
// categoria do produto), channel (= campo `origin`), sellerId (matched
// contra o nome da `vendedora` — a Vesti não tem uma tabela de vendedores
// com IDs sincronizada, então isso só funciona se o chamador já souber o
// nome; a UI de seleção de vendedor ainda não existe pro lado Vesti).

export type VestiFilters = {
  category?: string;
  sellerId?: string;
  channel?: string;
};

export type VestiKpis = {
  revenue: number;
  orders: number;
  avgTicket: number;
  conversionRate: number;
  approvalRate: number;
  leads: number;
  approvedLeads: number;
  customers: number;
  repeatCustomers: number;
  requestedRevenue: number;
  newBuyers: number;
  returningBuyers: number;
  retentionPct: number;
};

export type VestiSeriesPoint = { date: string; value: number };

export type VestiWindow = {
  kpis: VestiKpis;
  dailyRevenue: VestiSeriesPoint[];
  dailyOrders: VestiSeriesPoint[];
  dailyLeads: VestiSeriesPoint[];
  dailyNewBuyers: VestiSeriesPoint[];
  dailyReturningBuyers: VestiSeriesPoint[];
  revenueByCategory: { category: string; revenue: number; orders: number }[];
  stateRevenue: { state: string; revenue: number }[];
};

const ZERO_VESTI_KPIS: VestiKpis = {
  revenue: 0,
  orders: 0,
  avgTicket: 0,
  conversionRate: 0,
  approvalRate: 0,
  leads: 0,
  approvedLeads: 0,
  customers: 0,
  repeatCustomers: 0,
  requestedRevenue: 0,
  newBuyers: 0,
  returningBuyers: 0,
  retentionPct: 0,
};

function toDateOnly(value: unknown): string {
  if (value && typeof value === "object" && "value" in (value as Record<string, unknown>)) {
    return String((value as { value: unknown }).value);
  }
  return String(value);
}

type FilterClause = { clause: string; params: Record<string, string> };

function buildFilterClause(alias: string, view: string, produtos: string, filters: VestiFilters): FilterClause {
  const parts: string[] = [];
  const params: Record<string, string> = {};
  if (filters.sellerId) {
    parts.push(`${alias}.vendedora = @sellerId`);
    params.sellerId = filters.sellerId;
  }
  if (filters.channel) {
    parts.push(`${alias}.origin = @channel`);
    params.channel = filters.channel;
  }
  if (filters.category) {
    parts.push(`${alias}.pedido_id IN (
      SELECT DISTINCT v2.pedido_id
      FROM ${view} v2
      JOIN ${produtos} p2 ON p2.id = v2.produto_id
      WHERE ARRAY_LENGTH(p2.categories) > 0 AND p2.categories[SAFE_OFFSET(0)].name = @category
    )`);
    params.category = filters.category;
  }
  return { clause: parts.length ? `AND ${parts.join(" AND ")}` : "", params };
}

async function fetchKpis(
  view: string,
  dateFrom: string,
  dateTo: string,
  filter: FilterClause,
): Promise<VestiKpis> {
  const query = `
    WITH first_purchase AS (
      SELECT cliente_id, MIN(data_ref) AS first_date
      FROM ${view}
      WHERE cliente_id IS NOT NULL
      GROUP BY cliente_id
    ),
    window_rows AS (
      SELECT *
      FROM ${view} v
      WHERE v.data_ref BETWEEN @dateFrom AND @dateTo ${filter.clause}
    ),
    orders_per_customer AS (
      SELECT cliente_id, COUNT(DISTINCT pedido_id) AS pedidos
      FROM window_rows
      WHERE cliente_id IS NOT NULL
      GROUP BY cliente_id
    )
    SELECT
      COALESCE(SUM(v.valor_reservado), 0) AS revenue,
      COALESCE(SUM(v.valor_solicitado), 0) AS requested_revenue,
      COUNT(DISTINCT v.pedido_id) AS leads,
      COUNT(DISTINCT IF(v.pago, v.pedido_id, NULL)) AS approved_leads,
      COUNT(DISTINCT v.cliente_id) AS customers,
      COUNT(DISTINCT IF(fp.first_date >= @dateFrom, v.cliente_id, NULL)) AS new_buyers,
      COUNT(DISTINCT IF(fp.first_date < @dateFrom, v.cliente_id, NULL)) AS returning_buyers,
      COUNT(DISTINCT IF(opc.pedidos > 1, v.cliente_id, NULL)) AS repeat_customers
    FROM window_rows v
    LEFT JOIN first_purchase fp ON fp.cliente_id = v.cliente_id
    LEFT JOIN orders_per_customer opc ON opc.cliente_id = v.cliente_id
  `;

  const [rows] = await bigquery.query({ query, params: { dateFrom, dateTo, ...filter.params } });
  const row = rows[0] as Record<string, number> | undefined;
  if (!row) return { ...ZERO_VESTI_KPIS };

  const revenue = Number(row.revenue) || 0;
  const requestedRevenue = Number(row.requested_revenue) || 0;
  const leads = Number(row.leads) || 0;
  const approvedLeads = Number(row.approved_leads) || 0;
  const orders = approvedLeads;
  const newBuyers = Number(row.new_buyers) || 0;
  const returningBuyers = Number(row.returning_buyers) || 0;
  const totalBuyers = newBuyers + returningBuyers;

  return {
    revenue,
    orders,
    avgTicket: orders > 0 ? revenue / orders : 0,
    // Vesti não tem sessão/visita no nível de pedido pra calcular conversão
    // de tráfego de verdade (isso só existe via stape_logs, usado no
    // Funil/Jornada/Escala). O card "Conversion rate" do dashboard, pro
    // lado não-B2C, já rotula os sub-valores como "Approved leads"/"Orders"
    // (não "Sessões"/"Pedidos") — ou seja, aqui ele representa a mesma
    // conversão de lead→pedido pago que approvalRate, então reaproveita a
    // fórmula em vez de ficar zerado.
    conversionRate: leads > 0 ? (approvedLeads / leads) * 100 : 0,
    approvalRate: leads > 0 ? (approvedLeads / leads) * 100 : 0,
    leads,
    approvedLeads,
    customers: Number(row.customers) || 0,
    repeatCustomers: Number(row.repeat_customers) || 0,
    requestedRevenue,
    newBuyers,
    returningBuyers,
    retentionPct: totalBuyers > 0 ? (returningBuyers / totalBuyers) * 100 : 0,
  };
}

async function fetchDailySeries(
  view: string,
  dateFrom: string,
  dateTo: string,
  filter: FilterClause,
): Promise<{ dailyRevenue: VestiSeriesPoint[]; dailyOrders: VestiSeriesPoint[]; dailyLeads: VestiSeriesPoint[] }> {
  const query = `
    SELECT
      data_ref,
      COALESCE(SUM(valor_reservado), 0) AS revenue,
      COUNT(DISTINCT IF(pago, pedido_id, NULL)) AS orders,
      COUNT(DISTINCT pedido_id) AS leads
    FROM ${view} v
    WHERE v.data_ref BETWEEN @dateFrom AND @dateTo ${filter.clause}
    GROUP BY data_ref
    ORDER BY data_ref
  `;
  const [rows] = await bigquery.query({ query, params: { dateFrom, dateTo, ...filter.params } });
  const dailyRevenue: VestiSeriesPoint[] = [];
  const dailyOrders: VestiSeriesPoint[] = [];
  const dailyLeads: VestiSeriesPoint[] = [];
  for (const r of rows as Array<Record<string, unknown>>) {
    const date = toDateOnly(r.data_ref);
    dailyRevenue.push({ date, value: Number(r.revenue) || 0 });
    dailyOrders.push({ date, value: Number(r.orders) || 0 });
    dailyLeads.push({ date, value: Number(r.leads) || 0 });
  }
  return { dailyRevenue, dailyOrders, dailyLeads };
}

async function fetchDailyBuyers(
  view: string,
  dateFrom: string,
  dateTo: string,
  filter: FilterClause,
): Promise<{ dailyNewBuyers: VestiSeriesPoint[]; dailyReturningBuyers: VestiSeriesPoint[] }> {
  const query = `
    WITH first_purchase AS (
      SELECT cliente_id, MIN(data_ref) AS first_date
      FROM ${view}
      WHERE cliente_id IS NOT NULL
      GROUP BY cliente_id
    ),
    window_rows AS (
      SELECT DISTINCT v.data_ref, v.cliente_id
      FROM ${view} v
      WHERE v.data_ref BETWEEN @dateFrom AND @dateTo AND v.cliente_id IS NOT NULL ${filter.clause}
    )
    SELECT
      w.data_ref,
      COUNT(DISTINCT IF(fp.first_date = w.data_ref, w.cliente_id, NULL)) AS new_buyers,
      COUNT(DISTINCT IF(fp.first_date < w.data_ref, w.cliente_id, NULL)) AS returning_buyers
    FROM window_rows w
    JOIN first_purchase fp ON fp.cliente_id = w.cliente_id
    GROUP BY w.data_ref
    ORDER BY w.data_ref
  `;
  const [rows] = await bigquery.query({ query, params: { dateFrom, dateTo, ...filter.params } });
  const dailyNewBuyers: VestiSeriesPoint[] = [];
  const dailyReturningBuyers: VestiSeriesPoint[] = [];
  for (const r of rows as Array<Record<string, unknown>>) {
    const date = toDateOnly(r.data_ref);
    dailyNewBuyers.push({ date, value: Number(r.new_buyers) || 0 });
    dailyReturningBuyers.push({ date, value: Number(r.returning_buyers) || 0 });
  }
  return { dailyNewBuyers, dailyReturningBuyers };
}

async function fetchRevenueByCategory(
  view: string,
  produtos: string,
  dateFrom: string,
  dateTo: string,
  filter: FilterClause,
): Promise<{ category: string; revenue: number; orders: number }[]> {
  const query = `
    SELECT
      COALESCE(p.categories[SAFE_OFFSET(0)].name, 'Sem categoria') AS category,
      COALESCE(SUM(v.produto_preco_unitario * v.produto_quantidade_reservada), 0) AS revenue,
      COUNT(DISTINCT v.pedido_id) AS orders
    FROM ${view} v
    JOIN ${produtos} p ON p.id = v.produto_id
    WHERE v.data_ref BETWEEN @dateFrom AND @dateTo AND v.pago ${filter.clause}
    GROUP BY category
    ORDER BY revenue DESC
    LIMIT 20
  `;
  const [rows] = await bigquery.query({ query, params: { dateFrom, dateTo, ...filter.params } });
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    category: String(r.category),
    revenue: Number(r.revenue) || 0,
    orders: Number(r.orders) || 0,
  }));
}

async function fetchStateRevenue(
  view: string,
  winFrom: string,
  winTo: string,
): Promise<{ state: string; revenue: number }[]> {
  const query = `
    SELECT estado AS state, COALESCE(SUM(valor_reservado), 0) AS revenue
    FROM ${view}
    WHERE data_ref BETWEEN @winFrom AND @winTo AND estado IS NOT NULL AND estado != ''
    GROUP BY estado
  `;
  const [rows] = await bigquery.query({ query, params: { winFrom, winTo } });
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    state: String(r.state),
    revenue: Number(r.revenue) || 0,
  }));
}

export async function computeVestiWindow(
  dataset: string,
  dateFrom: string,
  dateTo: string,
  filters: VestiFilters = {},
  full = true,
): Promise<VestiWindow> {
  const view = vestiTable(dataset, "dashboard_vendas_view");
  const produtos = vestiTable(dataset, "produtos_vesti");
  const filter = buildFilterClause("v", view, produtos, filters);

  const [kpis, daily, buyers, revenueByCategory] = await Promise.all([
    fetchKpis(view, dateFrom, dateTo, filter),
    full
      ? fetchDailySeries(view, dateFrom, dateTo, filter)
      : Promise.resolve({ dailyRevenue: [], dailyOrders: [], dailyLeads: [] }),
    full
      ? fetchDailyBuyers(view, dateFrom, dateTo, filter)
      : Promise.resolve({ dailyNewBuyers: [], dailyReturningBuyers: [] }),
    full ? fetchRevenueByCategory(view, produtos, dateFrom, dateTo, filter) : Promise.resolve([]),
  ]);

  return {
    kpis,
    ...daily,
    ...buyers,
    revenueByCategory,
    stateRevenue: [],
  };
}

/** Receita por estado numa janela — usado só pro signal de regiões em alta. */
export async function computeVestiStateRevenue(
  dataset: string,
  winFrom: string,
  winTo: string,
): Promise<{ state: string; revenue: number }[]> {
  const view = vestiTable(dataset, "dashboard_vendas_view");
  return fetchStateRevenue(view, winFrom, winTo);
}

// ───────── Clientes atribuídos a campanhas pagas (agência) ─────────
//
// Fonte: `clientes_atribuidos_consolidados` + `pedidos_atribuidos_consolidados`
// — tabelas já pré-consolidadas por um job separado (não em tempo real,
// diferente do jeito UpZero que chama a API deles ao vivo). A lógica de
// classificação já vem pronta nelas: um cliente entra em
// `clientes_atribuidos_consolidados` quando foi "tocado" por um anúncio
// da agência (evento `getUpAgency` ou clique com fbc, capturado via
// server-side tagging em `stape_logs`) E tem cadastro na Vesti com o
// mesmo email. `tipo_atribuicao` já vem calculado: "Novo Lead" (tocado
// antes/no dia do cadastro — o anúncio trouxe o cliente) vs "Re-impacto"
// (tocado bem depois do cadastro — o anúncio reengajou alguém que já
// existia).
//
// Diferente do lado UpZero, aqui NÃO temos granularidade de UTM
// source/medium/campaign por evento — só um "foi tocado pela agência ou
// não" + a classificação novo/re-impacto. Por isso os campos de
// multi-toque (`campaigns[]`, `addToCartCount`, `checkoutCount`,
// `productViewCount`) ficam vazios/zerados — não têm de onde vir.

export type VestiAttributedCustomer = {
  email: string;
  name: string | null;
  cnpj: string | null;
  profile: string | null;
  attributionType: string | null; // "Novo Lead" | "Re-impacto"
  registeredAt: string | null; // data_cadastro
  firstTouchAt: string | null; // primeiro_toque_agencia
  purchaseCount: number;
  totalPurchaseValue: number; // valor_reservado (pago) dos pedidos atribuídos
  totalRequestedValue: number; // valor_solicitado (bruto, independente de pago) dos pedidos atribuídos
  lastPurchaseAt: string | null;
};

export async function fetchVestiAttributedCustomers(
  dataset: string,
  dateFrom: string,
  dateTo: string,
): Promise<VestiAttributedCustomer[]> {
  const clientes = vestiTable(dataset, "clientes_atribuidos_consolidados");
  const pedidos = vestiTable(dataset, "pedidos_atribuidos_consolidados");
  const view = vestiTable(dataset, "dashboard_vendas_view");

  const query = `
    WITH attributed_orders AS (
      SELECT po.email, po.pedido_id, po.purchase_ts
      FROM ${pedidos} po
      WHERE po.data_ref BETWEEN @dateFrom AND @dateTo
    ),
    order_revenue AS (
      SELECT DISTINCT v.pedido_id, v.valor_reservado, v.valor_solicitado
      FROM ${view} v
      WHERE v.pedido_id IN (SELECT pedido_id FROM attributed_orders)
    ),
    per_customer_orders AS (
      SELECT
        ao.email,
        COUNT(DISTINCT ao.pedido_id) AS purchase_count,
        COALESCE(SUM(orv.valor_reservado), 0) AS total_purchase_value,
        COALESCE(SUM(orv.valor_solicitado), 0) AS total_requested_value,
        MAX(ao.purchase_ts) AS last_purchase_ts
      FROM attributed_orders ao
      LEFT JOIN order_revenue orv ON orv.pedido_id = ao.pedido_id
      GROUP BY ao.email
    )
    SELECT
      c.email,
      c.nome AS name,
      c.cnpj,
      c.profile,
      c.tipo_atribuicao AS attribution_type,
      c.data_cadastro AS registered_at,
      c.primeiro_toque_agencia AS first_touch_at,
      COALESCE(pco.purchase_count, 0) AS purchase_count,
      COALESCE(pco.total_purchase_value, 0) AS total_purchase_value,
      COALESCE(pco.total_requested_value, 0) AS total_requested_value,
      pco.last_purchase_ts AS last_purchase_at
    FROM ${clientes} c
    LEFT JOIN per_customer_orders pco ON pco.email = c.email
    WHERE (c.data_cadastro BETWEEN @dateFrom AND @dateTo) OR pco.email IS NOT NULL
    ORDER BY total_purchase_value DESC
    LIMIT 500
  `;

  const [rows] = await bigquery.query({ query, params: { dateFrom, dateTo } });
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    email: String(r.email),
    name: (r.name as string) ?? null,
    cnpj: (r.cnpj as string) || null,
    profile: (r.profile as string) ?? null,
    attributionType: (r.attribution_type as string) ?? null,
    registeredAt: r.registered_at ? toDateOnly(r.registered_at) : null,
    firstTouchAt: r.first_touch_at ? String((r.first_touch_at as { value?: string })?.value ?? r.first_touch_at) : null,
    purchaseCount: Number(r.purchase_count) || 0,
    totalPurchaseValue: Number(r.total_purchase_value) || 0,
    totalRequestedValue: Number(r.total_requested_value) || 0,
    lastPurchaseAt: r.last_purchase_at
      ? String((r.last_purchase_at as { value?: string })?.value ?? r.last_purchase_at)
      : null,
  }));
}

// ───────── Página de pedidos ─────────
//
// `dashboard_vendas_view` já tem pedido + item juntos, então a lista de
// pedidos vem de um GROUP BY pedido_id, e o detalhe vem das linhas cruas
// daquele pedido_id (cada linha é um item). `origin` aqui é o campo real
// da Vesti (ex: "Link", "Site") — conceito diferente de UTM/tracking, mas
// mapeado pro mesmo formato que a tela já espera.

function maskCnpj(cnpj: string | null): string | null {
  if (!cnpj) return null;
  const digits = cnpj.replace(/\D/g, "");
  if (digits.length < 2) return null;
  return `**.***.***/****-${digits.slice(-2)}`;
}

export type VestiOrderRow = {
  id: string;
  externalId: string | null;
  status: string | null;
  amount: number;
  fulfilledAmount: number;
  requestedQuantity: number;
  fulfilledQuantity: number;
  createdAt: string;
  customerId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  document: string | null;
  state: string | null;
  city: string | null;
  originLabel: string | null;
  isAttributed: boolean;
};

export type VestiOrdersPage = {
  kpis: {
    requestedRevenue: number;
    fulfilledRevenue: number;
    requestedQuantity: number;
    fulfilledQuantity: number;
    fulfilledPct: number;
    orders: number;
    newCustomers: number;
    returningCustomers: number;
    retentionPct: number;
    approvedLeads: number;
  };
  rows: VestiOrderRow[];
  total: number;
};

export async function fetchVestiOrdersPage(
  dataset: string,
  dateFrom: string,
  dateTo: string,
  page: number,
  limit: number,
  search: string | undefined,
): Promise<VestiOrdersPage> {
  const view = vestiTable(dataset, "dashboard_vendas_view");
  const clientesAtribuidos = vestiTable(dataset, "clientes_atribuidos_consolidados");
  const offset = (page - 1) * limit;

  const kpiQuery = `
    WITH pedidos AS (
      SELECT
        pedido_id,
        ANY_VALUE(cliente_id) AS cliente_id,
        COALESCE(SUM(valor_solicitado), 0) AS amount,
        COALESCE(SUM(valor_reservado), 0) AS fulfilled_amount,
        COALESCE(SUM(produto_quantidade_solicitada), 0) AS requested_quantity,
        COALESCE(SUM(produto_quantidade_reservada), 0) AS fulfilled_quantity,
        LOGICAL_OR(pago) AS pago
      FROM ${view}
      WHERE data_ref BETWEEN @dateFrom AND @dateTo
      GROUP BY pedido_id
    ),
    orders_per_customer AS (
      SELECT cliente_id, COUNT(*) AS n
      FROM pedidos
      WHERE cliente_id IS NOT NULL
      GROUP BY cliente_id
    )
    SELECT
      COALESCE(SUM(p.amount), 0) AS requested_revenue,
      COALESCE(SUM(p.fulfilled_amount), 0) AS fulfilled_revenue,
      COALESCE(SUM(p.requested_quantity), 0) AS requested_quantity,
      COALESCE(SUM(p.fulfilled_quantity), 0) AS fulfilled_quantity,
      COUNT(DISTINCT p.pedido_id) AS orders,
      COUNT(DISTINCT IF(opc.n = 1, p.cliente_id, NULL)) AS new_customers,
      COUNT(DISTINCT IF(opc.n > 1, p.cliente_id, NULL)) AS returning_customers,
      COUNT(DISTINCT IF(p.pago, p.cliente_id, NULL)) AS approved_leads
    FROM pedidos p
    LEFT JOIN orders_per_customer opc ON opc.cliente_id = p.cliente_id
  `;

  const searchClause = search ? `AND (
    LOWER(cliente_nome) LIKE @search OR LOWER(cliente_email) LIKE @search
    OR documento_cliente LIKE @search OR CAST(pedido_code AS STRING) LIKE @search
  )` : "";
  const listQuery = `
    WITH pedidos AS (
      SELECT
        pedido_id,
        ANY_VALUE(pedido_code) AS pedido_code,
        ANY_VALUE(status_pedido) AS status_pedido,
        COALESCE(SUM(valor_solicitado), 0) AS amount,
        COALESCE(SUM(valor_reservado), 0) AS fulfilled_amount,
        COALESCE(SUM(produto_quantidade_solicitada), 0) AS requested_quantity,
        COALESCE(SUM(produto_quantidade_reservada), 0) AS fulfilled_quantity,
        ANY_VALUE(data_ref) AS created_at,
        ANY_VALUE(cliente_id) AS customer_id,
        ANY_VALUE(cliente_nome) AS customer_name,
        ANY_VALUE(cliente_email) AS customer_email,
        ANY_VALUE(documento_cliente) AS document,
        ANY_VALUE(estado) AS state,
        ANY_VALUE(cidade) AS city,
        ANY_VALUE(origin) AS origin_label
      FROM ${view}
      WHERE data_ref BETWEEN @dateFrom AND @dateTo ${searchClause}
      GROUP BY pedido_id
    )
    SELECT p.*, ca.email IS NOT NULL AS is_attributed
    FROM pedidos p
    LEFT JOIN ${clientesAtribuidos} ca ON LOWER(ca.email) = LOWER(p.customer_email)
    ORDER BY created_at DESC
    LIMIT @limit OFFSET @offset
  `;

  const countQuery = `
    SELECT COUNT(DISTINCT pedido_id) AS total
    FROM ${view}
    WHERE data_ref BETWEEN @dateFrom AND @dateTo ${searchClause}
  `;

  const searchParam = search ? `%${search.toLowerCase()}%` : undefined;
  const [[kpiRows], [listRows], [countRows]] = await Promise.all([
    bigquery.query({ query: kpiQuery, params: { dateFrom, dateTo } }),
    bigquery.query({
      query: listQuery,
      params: { dateFrom, dateTo, limit, offset, ...(searchParam ? { search: searchParam } : {}) },
    }),
    bigquery.query({ query: countQuery, params: { dateFrom, dateTo, ...(searchParam ? { search: searchParam } : {}) } }),
  ]);

  const k = kpiRows[0] as Record<string, number> | undefined;
  const requestedRevenue = Number(k?.requested_revenue) || 0;
  const fulfilledRevenue = Number(k?.fulfilled_revenue) || 0;
  const newCustomers = Number(k?.new_customers) || 0;
  const returningCustomers = Number(k?.returning_customers) || 0;
  const customerCount = newCustomers + returningCustomers;

  const rows: VestiOrderRow[] = (listRows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.pedido_id),
    externalId: r.pedido_code != null ? String(r.pedido_code) : null,
    status: (r.status_pedido as string) ?? null,
    amount: Number(r.amount) || 0,
    fulfilledAmount: Number(r.fulfilled_amount) || 0,
    requestedQuantity: Number(r.requested_quantity) || 0,
    fulfilledQuantity: Number(r.fulfilled_quantity) || 0,
    createdAt: toDateOnly(r.created_at),
    customerId: (r.customer_id as string) ?? null,
    customerName: (r.customer_name as string) ?? null,
    customerEmail: (r.customer_email as string) ?? null,
    document: maskCnpj((r.document as string) ?? null),
    state: (r.state as string) || null,
    city: (r.city as string) || null,
    originLabel: (r.origin_label as string) || null,
    isAttributed: Boolean(r.is_attributed),
  }));

  return {
    kpis: {
      requestedRevenue,
      fulfilledRevenue,
      requestedQuantity: Number(k?.requested_quantity) || 0,
      fulfilledQuantity: Number(k?.fulfilled_quantity) || 0,
      fulfilledPct: requestedRevenue > 0 ? (fulfilledRevenue / requestedRevenue) * 100 : 0,
      orders: Number(k?.orders) || 0,
      newCustomers,
      returningCustomers,
      retentionPct: customerCount > 0 ? (returningCustomers / customerCount) * 100 : 0,
      approvedLeads: Number(k?.approved_leads) || 0,
    },
    rows,
    total: Number(countRows[0]?.total) || 0,
  };
}

export type VestiOrderDetail = {
  order: VestiOrderRow & { requestedItems: number; fulfilledItems: number };
  customer: {
    id: string | null;
    name: string | null;
    email: string | null;
    phone: string | null;
    state: string | null;
    city: string | null;
    document: string | null;
    totalOrders: number | null;
    totalSpent: number | null;
  };
  items: Array<{
    id: string;
    quantity: number;
    fulfilledQuantity: number;
    priceAtSale: number;
    size: string | null;
    color: string | null;
    productId: string | null;
    sku: string | null;
    name: string | null;
    category: string | null;
  }>;
};

export async function fetchVestiOrderDetail(dataset: string, pedidoId: string): Promise<VestiOrderDetail | null> {
  const view = vestiTable(dataset, "dashboard_vendas_view");
  const clientes = vestiTable(dataset, "clientes_vesti");

  const query = `
    SELECT *
    FROM ${view}
    WHERE pedido_id = @pedidoId
  `;
  const [rows] = await bigquery.query({ query, params: { pedidoId } });
  if (rows.length === 0) return null;
  const items = rows as Array<Record<string, unknown>>;
  const first = items[0] as Record<string, unknown>;

  const document = (first.documento_cliente as string) ?? null;
  const custQuery = document
    ? `SELECT phone, active FROM ${clientes} WHERE document = @document LIMIT 1`
    : null;
  const custRows = custQuery
    ? (await bigquery.query({ query: custQuery, params: { document } }))[0]
    : [];
  const custRow = (custRows as Array<Record<string, unknown>>)[0];

  const amount = items.reduce((sum, r) => sum + (Number(r.valor_solicitado) || 0), 0);
  const fulfilledAmount = items.reduce((sum, r) => sum + (Number(r.valor_reservado) || 0), 0);
  const requestedQuantity = items.reduce((sum, r) => sum + (Number(r.produto_quantidade_solicitada) || 0), 0);
  const fulfilledQuantity = items.reduce((sum, r) => sum + (Number(r.produto_quantidade_reservada) || 0), 0);

  return {
    order: {
      id: pedidoId,
      externalId: first.pedido_code != null ? String(first.pedido_code) : null,
      status: (first.status_pedido as string) ?? null,
      amount,
      fulfilledAmount,
      requestedQuantity,
      fulfilledQuantity,
      createdAt: toDateOnly(first.data_ref),
      customerId: (first.cliente_id as string) ?? null,
      customerName: (first.cliente_nome as string) ?? null,
      customerEmail: (first.cliente_email as string) ?? null,
      document: maskCnpj(document),
      state: (first.estado as string) || null,
      city: (first.cidade as string) || null,
      originLabel: (first.origin as string) || null,
      isAttributed: false,
      requestedItems: items.length,
      fulfilledItems: items.filter((r) => (Number(r.produto_quantidade_reservada) || 0) > 0).length,
    },
    customer: {
      id: (first.cliente_id as string) ?? null,
      name: (first.cliente_nome as string) ?? null,
      email: (first.cliente_email as string) ?? null,
      phone: (custRow?.phone as string) ?? null,
      state: (first.estado as string) || null,
      city: (first.cidade as string) || null,
      document: maskCnpj(document),
      totalOrders: null,
      totalSpent: null,
    },
    items: items.map((r, i) => ({
      id: `${pedidoId}-${i}`,
      quantity: Number(r.produto_quantidade_solicitada) || 0,
      fulfilledQuantity: Number(r.produto_quantidade_reservada) || 0,
      priceAtSale: Number(r.produto_preco_unitario) || 0,
      size: (r.produto_tamanho as string) || null,
      color: (r.produto_cor as string) || null,
      productId: (r.produto_id as string) ?? null,
      sku: (r.produto_sku as string) ?? null,
      name: (r.produto_nome as string) ?? null,
      category: null,
    })),
  };
}

// ───────── Clientes ─────────
//
// Fonte: `clientes_vesti` (cadastro) + agregação de `dashboard_vendas_view`
// por cliente_id (pedidos/receita). Não existe RFM pronto e consistente
// entre datasets (`rfm_clientes_final` só existe nalguns, ex: le_ricard,
// não no namine) — por isso `rfmSegment`/scores ficam null, e o filtro/
// contagem por segmento usa `registrationStatus` como proxy (é o dado
// real disponível: perfil "Liberado"/"VIP" = aprovado).

function inferRegistrationStatus(active: boolean | null, profileName: string | null): "APPROVED" | "PENDING" | "REJECTED" {
  if (active === false) return "REJECTED";
  if (profileName === "Liberado" || profileName === "VIP") return "APPROVED";
  return "PENDING";
}

export type VestiCustomerRow = {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  document: string | null;
  documentType: "CPF" | "CNPJ" | null;
  state: string | null;
  city: string | null;
  registrationStatus: "APPROVED" | "PENDING" | "REJECTED";
  totalOrders: number;
  totalSpent: number;
  firstPurchaseAt: string | null;
  lastPurchaseAt: string | null;
  createdAt: string;
};

export type VestiCustomersPage = {
  rows: VestiCustomerRow[];
  total: number;
  segmentCounts: { segment: string; count: number }[];
};

type VestiCustomersFilters = {
  search?: string;
  purchaseStatus?: "buyers" | "non_buyers";
  registrationStatus?: "PENDING" | "APPROVED" | "REJECTED";
  documentType?: "CPF" | "CNPJ";
};

const CUSTOMER_SORT_COLUMNS: Record<string, string> = {
  totalSpent: "total_spent",
  totalOrders: "total_orders",
  createdAt: "created_at",
  firstPurchaseAt: "first_purchase_at",
  lastPurchaseAt: "last_purchase_at",
  name: "name",
};

export async function fetchVestiCustomersPage(
  dataset: string,
  page: number,
  limit: number,
  sortBy: string,
  sortDir: "asc" | "desc",
  filters: VestiCustomersFilters,
): Promise<VestiCustomersPage> {
  const view = vestiTable(dataset, "dashboard_vendas_view");
  const clientes = vestiTable(dataset, "clientes_vesti");
  const offset = (page - 1) * limit;

  // As condições abaixo rodam contra `base` (`SELECT * FROM base WHERE ...`),
  // não contra os aliases `c`/`oa` usados só dentro da definição do CTE — por
  // isso as colunas aqui não levam prefixo (bug corrigido: antes usava
  // `c.name`/`oa.total_orders`, que não existem nesse escopo e quebravam com
  // "Unrecognized name" no BigQuery).
  const conditions: string[] = [];
  const params: Record<string, unknown> = { limit, offset };
  if (filters.search) {
    conditions.push("(LOWER(name) LIKE @search OR LOWER(email) LIKE @search)");
    params.search = `%${filters.search.toLowerCase()}%`;
  }
  if (filters.purchaseStatus === "buyers") conditions.push("COALESCE(total_orders, 0) > 0");
  if (filters.purchaseStatus === "non_buyers") conditions.push("COALESCE(total_orders, 0) = 0");
  if (filters.documentType === "CPF") conditions.push("LENGTH(REGEXP_REPLACE(document, r'[^0-9]', '')) = 11");
  if (filters.documentType === "CNPJ") conditions.push("document IS NOT NULL AND LENGTH(REGEXP_REPLACE(document, r'[^0-9]', '')) != 11");
  if (filters.registrationStatus === "REJECTED") conditions.push("active = false");
  if (filters.registrationStatus === "APPROVED") {
    conditions.push("COALESCE(active, true) != false AND profile_name IN ('Liberado', 'VIP')");
  }
  if (filters.registrationStatus === "PENDING") {
    conditions.push("COALESCE(active, true) != false AND COALESCE(profile_name, '') NOT IN ('Liberado', 'VIP')");
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const sortColumn = CUSTOMER_SORT_COLUMNS[sortBy] ?? "total_spent";

  const baseQuery = `
    WITH orders_agg AS (
      SELECT
        cliente_id,
        COUNT(DISTINCT pedido_id) AS total_orders,
        COALESCE(SUM(valor_reservado), 0) AS total_spent,
        MIN(data_ref) AS first_purchase_at,
        MAX(data_ref) AS last_purchase_at,
        ARRAY_AGG(estado IGNORE NULLS ORDER BY data_ref DESC LIMIT 1)[SAFE_OFFSET(0)] AS state,
        ARRAY_AGG(cidade IGNORE NULLS ORDER BY data_ref DESC LIMIT 1)[SAFE_OFFSET(0)] AS city
      FROM ${view}
      WHERE cliente_id IS NOT NULL
      GROUP BY cliente_id
    ),
    base AS (
      SELECT
        c.id, c.name, c.document, c.email, c.phone, c.active,
        c.profile.name AS profile_name, c.created_at,
        COALESCE(oa.total_orders, 0) AS total_orders,
        COALESCE(oa.total_spent, 0) AS total_spent,
        oa.first_purchase_at, oa.last_purchase_at, oa.state, oa.city
      FROM ${clientes} c
      LEFT JOIN orders_agg oa ON oa.cliente_id = c.id
    )
  `;

  const listQuery = `
    ${baseQuery}
    SELECT * FROM base
    ${whereClause}
    ORDER BY ${sortColumn} ${sortDir === "asc" ? "ASC" : "DESC"}
    LIMIT @limit OFFSET @offset
  `;
  const countQuery = `${baseQuery} SELECT COUNT(*) AS total FROM base ${whereClause}`;
  const segmentQuery = `
    ${baseQuery}
    SELECT
      CASE WHEN active = false THEN 'Bloqueado' WHEN profile_name IN ('Liberado', 'VIP') THEN 'Liberado' ELSE 'Pendente' END AS segment,
      COUNT(*) AS count
    FROM base
    ${whereClause}
    GROUP BY segment
  `;

  const [[listRows], [countRows], [segmentRows]] = await Promise.all([
    bigquery.query({ query: listQuery, params }),
    bigquery.query({ query: countQuery, params }),
    bigquery.query({ query: segmentQuery, params }),
  ]);

  const rows: VestiCustomerRow[] = (listRows as Array<Record<string, unknown>>).map((r) => {
    const document = (r.document as string) ?? null;
    return {
      id: String(r.id),
      name: (r.name as string) || null,
      email: String(r.email ?? ""),
      phone: (r.phone as string) || null,
      document: maskCnpj(document),
      documentType: document ? (document.replace(/\D/g, "").length === 11 ? "CPF" : "CNPJ") : null,
      state: (r.state as string) || stateFromPhoneDdd(r.phone as string) || null,
      city: (r.city as string) || null,
      registrationStatus: inferRegistrationStatus(r.active as boolean | null, (r.profile_name as string) ?? null),
      totalOrders: Number(r.total_orders) || 0,
      totalSpent: Number(r.total_spent) || 0,
      firstPurchaseAt: r.first_purchase_at ? toDateOnly(r.first_purchase_at) : null,
      lastPurchaseAt: r.last_purchase_at ? toDateOnly(r.last_purchase_at) : null,
      createdAt: toDateOnly(r.created_at),
    };
  });

  return {
    rows,
    total: Number((countRows as Array<Record<string, unknown>>)[0]?.total) || 0,
    segmentCounts: (segmentRows as Array<Record<string, unknown>>).map((r) => ({
      segment: String(r.segment),
      count: Number(r.count) || 0,
    })),
  };
}

export type VestiCustomerDetail = {
  customer: VestiCustomerRow;
  orders: Array<{ id: string; amount: number; status: string | null; state: string | null; city: string | null; itemCount: number; createdAt: string }>;
  productsPurchased: Array<{ productId: string; name: string; sku: string; quantity: number; totalSpent: number; firstOrderDate: string | null }>;
  journey: { visits: number; registered: boolean; approved: boolean; productViews: number; addedToCart: number; purchased: number };
};

export async function fetchVestiCustomerDetail(dataset: string, customerId: string): Promise<VestiCustomerDetail | null> {
  const view = vestiTable(dataset, "dashboard_vendas_view");
  const clientes = vestiTable(dataset, "clientes_vesti");

  const [custRows] = await bigquery.query({
    query: `SELECT id, name, document, email, phone, active, profile.name AS profile_name, created_at FROM ${clientes} WHERE id = @customerId LIMIT 1`,
    params: { customerId },
  });
  const cust = (custRows as Array<Record<string, unknown>>)[0];
  if (!cust) return null;

  const [orderRows] = await bigquery.query({
    query: `
      SELECT
        pedido_id,
        ANY_VALUE(status_pedido) AS status,
        ANY_VALUE(estado) AS state,
        ANY_VALUE(cidade) AS city,
        ANY_VALUE(data_ref) AS created_at,
        COALESCE(SUM(valor_reservado), 0) AS amount,
        COUNT(*) AS item_count
      FROM ${view}
      WHERE cliente_id = @customerId
      GROUP BY pedido_id
      ORDER BY created_at DESC
      LIMIT 50
    `,
    params: { customerId },
  });

  const [productRows] = await bigquery.query({
    query: `
      SELECT
        produto_id, ANY_VALUE(produto_nome) AS name, ANY_VALUE(produto_sku) AS sku,
        SUM(produto_quantidade_reservada) AS quantity,
        SUM(produto_preco_unitario * produto_quantidade_reservada) AS total_spent,
        MIN(data_ref) AS first_order_date
      FROM ${view}
      WHERE cliente_id = @customerId AND produto_id IS NOT NULL
      GROUP BY produto_id
      ORDER BY total_spent DESC
      LIMIT 20
    `,
    params: { customerId },
  });

  // Totais reais (não limitados aos 50 pedidos exibidos acima).
  const [totalsRows] = await bigquery.query({
    query: `
      SELECT
        COUNT(DISTINCT pedido_id) AS total_orders,
        COALESCE(SUM(valor_reservado), 0) AS total_spent,
        MIN(data_ref) AS first_purchase_at,
        MAX(data_ref) AS last_purchase_at,
        ARRAY_AGG(NULLIF(estado, '') IGNORE NULLS ORDER BY data_ref DESC LIMIT 1)[SAFE_OFFSET(0)] AS state,
        ARRAY_AGG(NULLIF(cidade, '') IGNORE NULLS ORDER BY data_ref DESC LIMIT 1)[SAFE_OFFSET(0)] AS city
      FROM ${view}
      WHERE cliente_id = @customerId
    `,
    params: { customerId },
  });
  const t = (totalsRows as Array<Record<string, unknown>>)[0];

  const document = (cust.document as string) ?? null;
  const totals = {
    totalOrders: Number(t?.total_orders) || 0,
    totalSpent: Number(t?.total_spent) || 0,
  };
  const registrationStatus = inferRegistrationStatus(cust.active as boolean | null, (cust.profile_name as string) ?? null);
  const paidOrders = (orderRows as Array<Record<string, unknown>>).filter((r) => r.status === "PAID").length;
  const eventCounts = cust.email
    ? await fetchVestiEventCounts(dataset, String(cust.email)).catch(() => ({ visits: 0, productViews: 0, addedToCart: 0 }))
    : { visits: 0, productViews: 0, addedToCart: 0 };

  return {
    customer: {
      id: String(cust.id),
      name: (cust.name as string) || null,
      email: String(cust.email ?? ""),
      phone: (cust.phone as string) || null,
      document: maskCnpj(document),
      documentType: document ? (document.replace(/\D/g, "").length === 11 ? "CPF" : "CNPJ") : null,
      state: (t?.state as string) || null,
      city: (t?.city as string) || null,
      registrationStatus,
      totalOrders: totals.totalOrders,
      totalSpent: totals.totalSpent,
      firstPurchaseAt: t?.first_purchase_at ? toDateOnly(t.first_purchase_at) : null,
      lastPurchaseAt: t?.last_purchase_at ? toDateOnly(t.last_purchase_at) : null,
      createdAt: toDateOnly(cust.created_at),
    },
    orders: (orderRows as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.pedido_id),
      amount: Number(r.amount) || 0,
      status: (r.status as string) ?? null,
      state: (r.state as string) || null,
      city: (r.city as string) || null,
      itemCount: Number(r.item_count) || 0,
      createdAt: toDateOnly(r.created_at),
    })),
    productsPurchased: (productRows as Array<Record<string, unknown>>).map((r) => ({
      productId: String(r.produto_id),
      name: (r.name as string) ?? "",
      sku: (r.sku as string) ?? "",
      quantity: Number(r.quantity) || 0,
      totalSpent: Number(r.total_spent) || 0,
      firstOrderDate: r.first_order_date ? toDateOnly(r.first_order_date) : null,
    })),
    journey: {
      visits: eventCounts.visits,
      registered: true,
      approved: registrationStatus === "APPROVED",
      productViews: eventCounts.productViews,
      addedToCart: eventCounts.addedToCart,
      purchased: paidOrders,
    },
  };
}

// ───────── Timeline de eventos (comportamento) ─────────
//
// Não existe integração UpZero pro lado Vesti (o customerId nem existe na
// tabela Postgres que a rota /customers/:id/timeline usa hoje). Mas existe
// dado de evento real vindo do server-side tagging: BigQuery
// `up-vesti-report.stape_logs.EventsLogsTratado`, filtrado por
// `client = <dataset>` e casado por e-mail. Confirmado com dado real
// (28/07/2026): AddToCart, PageView, ViewContent, Purchase,
// InitiateCheckout, Lead, Contact, GetUpagency.
//
// Matching hoje é só por e-mail. Existe uma coluna `ga4Tid` na tabela
// `User` do Postgres `vesti-database` que poderia dar um match mais
// preciso, mas isso está fora de alcance daqui (banco diferente, sem
// credencial configurada neste projeto) e a decisão da empresa é não
// generalizar filtro por TID pras outras marcas — só Namine tem sinal
// verde. Não implementado ainda; e-mail já é suficiente pra validar.

const VESTI_EVENT_LABELS: Record<string, { eventName: string; eventLabel: string }> = {
  ViewContent: { eventName: "product_view", eventLabel: "Visualizou produto" },
  AddToCart: { eventName: "add_to_cart", eventLabel: "Adicionou ao carrinho" },
  InitiateCheckout: { eventName: "checkout_start", eventLabel: "Iniciou checkout" },
  Purchase: { eventName: "purchase", eventLabel: "Comprou" },
  PageView: { eventName: "page_view", eventLabel: "Visitou o site" },
  Lead: { eventName: "register_submitted", eventLabel: "Enviou cadastro" },
  GetUpagency: { eventName: "referral", eventLabel: "Indicação/agência" },
  Contact: { eventName: "contact", eventLabel: "Contato" },
};

export type VestiTimelineEvent = {
  id: string;
  occurredAt: string;
  eventName: string;
  eventLabel: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
};

export type VestiTouch = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  occurredAt: string | null;
};

export type VestiCustomerTimeline = {
  summary: {
    totalEvents: number;
    productViews: number;
    addToCartEvents: number;
    checkoutStarts: number;
    purchases: number;
    registerSubmitted: number;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
  };
  firstTouch: VestiTouch;
  lastTouch: VestiTouch;
  timeline: VestiTimelineEvent[];
};

// O hit de tracking (`request_url`) carrega a página visitada dentro do
// parâmetro `dl` (document location), URL-encoded — e é essa URL de página
// que tem os utm_* de verdade (o request em si não tem colunas utm_* soltas).
// Ex.: .../g/collect?...&dl=https%3A%2F%2Fsite%2F%3Futm_source%3Dup_agency...
function extractUtmFromRequestUrl(requestUrl: string | null | undefined): {
  source: string | null;
  medium: string | null;
  campaign: string | null;
} {
  const empty = { source: null, medium: null, campaign: null };
  if (!requestUrl) return empty;
  try {
    const query = requestUrl.includes("?") ? requestUrl.slice(requestUrl.indexOf("?") + 1) : requestUrl;
    const params = new URLSearchParams(query);
    const dl = params.get("dl") ?? params.get("dr");
    if (!dl) return empty;
    const pageUrl = new URL(dl);
    return {
      source: pageUrl.searchParams.get("utm_source"),
      medium: pageUrl.searchParams.get("utm_medium"),
      campaign: pageUrl.searchParams.get("utm_campaign"),
    };
  } catch {
    return empty;
  }
}

export async function fetchVestiCustomerEmail(dataset: string, customerId: string): Promise<string | null> {
  const clientes = vestiTable(dataset, "clientes_vesti");
  const [rows] = await bigquery.query({
    query: `SELECT email FROM ${clientes} WHERE id = @customerId LIMIT 1`,
    params: { customerId },
  });
  const email = (rows as Array<Record<string, unknown>>)[0]?.email;
  return email ? String(email) : null;
}

async function fetchVestiEventCounts(
  storeSlug: string,
  email: string,
): Promise<{ visits: number; productViews: number; addedToCart: number }> {
  const [rows] = await bigquery.query({
    query: `
      SELECT event_name, COUNT(*) AS c
      FROM \`up-vesti-report.stape_logs.EventsLogsTratado\`
      WHERE client = @storeSlug AND LOWER(email) = LOWER(@email)
      GROUP BY event_name
    `,
    params: { storeSlug, email },
  });
  const counts = new Map((rows as Array<Record<string, unknown>>).map((r) => [String(r.event_name), Number(r.c) || 0]));
  return {
    visits: counts.get("PageView") ?? 0,
    productViews: counts.get("ViewContent") ?? 0,
    addedToCart: counts.get("AddToCart") ?? 0,
  };
}

export async function fetchVestiCustomerTimeline(
  storeSlug: string,
  email: string,
): Promise<VestiCustomerTimeline> {
  const [rows] = await bigquery.query({
    query: `
      SELECT event_ts, event_name, request_url
      FROM \`up-vesti-report.stape_logs.EventsLogsTratado\`
      WHERE client = @storeSlug AND LOWER(email) = LOWER(@email)
      ORDER BY event_ts ASC
      LIMIT 200
    `,
    params: { storeSlug, email },
  });

  const raw = rows as Array<Record<string, unknown>>;
  const withUtm = raw.map((r) => ({
    row: r,
    occurredAt: toDateOnly(r.event_ts),
    utm: extractUtmFromRequestUrl(r.request_url as string | null),
  }));

  const timeline: VestiTimelineEvent[] = withUtm
    .map(({ row: r, occurredAt, utm }, i) => {
      const rawName = String(r.event_name ?? "");
      const mapped = VESTI_EVENT_LABELS[rawName] ?? { eventName: rawName.toLowerCase() || "event", eventLabel: rawName || "Evento" };
      return {
        id: `${storeSlug}_${i}`,
        occurredAt,
        eventName: mapped.eventName,
        eventLabel: mapped.eventLabel,
        utmSource: utm.source,
        utmMedium: utm.medium,
        utmCampaign: utm.campaign,
      };
    })
    .reverse(); // volta pra mais recente primeiro (a query buscou ASC pra achar first/last touch fácil)

  const countRaw = (name: string) => raw.filter((r) => r.event_name === name).length;
  const timestamps = withUtm.map((e) => e.occurredAt).filter(Boolean);
  const touchesWithUtm = withUtm.filter((e) => e.utm.source || e.utm.campaign);
  const firstTouchRaw = touchesWithUtm[0];
  const lastTouchRaw = touchesWithUtm[touchesWithUtm.length - 1];
  const toTouch = (t: typeof firstTouchRaw): VestiTouch =>
    t ? { source: t.utm.source, medium: t.utm.medium, campaign: t.utm.campaign, occurredAt: t.occurredAt } : { source: null, medium: null, campaign: null, occurredAt: null };

  return {
    summary: {
      totalEvents: raw.length,
      productViews: countRaw("ViewContent"),
      addToCartEvents: countRaw("AddToCart"),
      checkoutStarts: countRaw("InitiateCheckout"),
      purchases: countRaw("Purchase"),
      registerSubmitted: countRaw("Lead"),
      firstSeenAt: timestamps[0] ?? null,
      lastSeenAt: timestamps[timestamps.length - 1] ?? null,
    },
    firstTouch: toTouch(firstTouchRaw),
    lastTouch: toTouch(lastTouchRaw),
    timeline,
  };
}

// ───────── Funil de conversão ─────────
//
// Mesmo taxonomia de evento do stape_logs usada na Timeline. Não existe
// "sessão" separada de PageView pra Vesti (like GA4 tem) — usamos contagem
// de PageView como proxy de visita, mesmo espírito do que o funil B2C faz
// com sessions do GA4. `avgEventsBeforePurchase`/`topPaths` ficam vazios
// (0/[]), igual o próprio caminho GA4 já faz hoje — não são triviais de
// calcular e nem o funil B2C tenta.

const VESTI_FUNNEL_STEPS: Array<{ step: string; label: string; eventName: string }> = [
  { step: "VISIT", label: "Visitas", eventName: "PageView" },
  { step: "PRODUCT_VIEW", label: "Produtos vistos", eventName: "ViewContent" },
  { step: "ADD_TO_CART", label: "Adições ao carrinho", eventName: "AddToCart" },
  { step: "CHECKOUT_STARTED", label: "Checkouts iniciados", eventName: "InitiateCheckout" },
  { step: "PURCHASE", label: "Pedidos", eventName: "Purchase" },
];

export type VestiFunnel = {
  steps: { step: string; label: string; count: number; conversionRate: number; dropOffRate: number }[];
  overallConversion: number;
  insights: string[];
  suggestedActions: string[];
  hasSiteVisitData: boolean;
};

export async function fetchVestiFunnel(storeSlug: string, dateFrom: string, dateTo: string): Promise<VestiFunnel> {
  const [rows] = await bigquery.query({
    query: `
      SELECT event_name, COUNT(*) AS c
      FROM \`up-vesti-report.stape_logs.EventsLogsTratado\`
      WHERE client = @storeSlug AND DATE(event_ts) BETWEEN @dateFrom AND @dateTo
      GROUP BY event_name
    `,
    params: { storeSlug, dateFrom, dateTo },
  });
  const counts = new Map((rows as Array<Record<string, unknown>>).map((r) => [String(r.event_name), Number(r.c) || 0]));

  const [anyEventRows] = await bigquery.query({
    query: `SELECT COUNT(*) AS c FROM \`up-vesti-report.stape_logs.EventsLogsTratado\` WHERE client = @storeSlug AND event_name = 'PageView' LIMIT 1`,
    params: { storeSlug },
  });
  const hasSiteVisitData = (Number((anyEventRows as Array<Record<string, unknown>>)[0]?.c) || 0) > 0;

  const steps = VESTI_FUNNEL_STEPS.map((step, index) => {
    const count = counts.get(step.eventName) ?? 0;
    const previous = index === 0 ? count : counts.get(VESTI_FUNNEL_STEPS[index - 1].eventName) ?? 0;
    const conversionRate = index === 0 ? 100 : previous > 0 ? (count / previous) * 100 : 0;
    return {
      step: step.step,
      label: step.label,
      count,
      conversionRate,
      dropOffRate: index === 0 ? 0 : Math.max(0, 100 - conversionRate),
    };
  });

  const visits = steps[0]?.count ?? 0;
  const purchases = steps[steps.length - 1]?.count ?? 0;
  const overallConversion = visits > 0 ? (purchases / visits) * 100 : 0;

  let worst = { idx: -1, drop: -1 };
  for (let i = 1; i < steps.length; i++) {
    if (steps[i].dropOffRate > worst.drop) worst = { idx: i, drop: steps[i].dropOffRate };
  }

  const insights = [
    `Funil alimentado pelo rastreamento da Vesti (stape_logs) com ${visits} visita(s) no período.`,
    `Conversão geral de ${overallConversion.toFixed(2)}% calculada por pedidos pagos / visitas.`,
    ...(worst.idx > 0
      ? [`Maior queda (${worst.drop.toFixed(1)}%) entre ${steps[worst.idx - 1].label} e ${steps[worst.idx].label}.`]
      : []),
  ];

  const suggestedActions =
    worst.idx > 0
      ? [`Revisar a etapa "${steps[worst.idx].label}" — é onde mais se perde cliente em relação à etapa anterior.`]
      : [];

  return { steps, overallConversion, insights, suggestedActions, hasSiteVisitData };
}

// ───────── Resumo de clientes (KPIs de cadastro) ─────────

export type VestiCustomerSummary = {
  kpis: {
    totalRegistrations: number;
    approvedRegistrations: number;
    pendingRegistrations: number;
    rejectedRegistrations: number;
    approvalRatePct: number;
    customersWithoutPurchase: number;
    totalBuyers: number;
  };
  registrationsOverTime: { date: string; registrations: number; approved: number }[];
  registrationsByState: { state: string; count: number }[];
  registrationsBySource: { source: string; count: number }[];
};

export async function fetchVestiCustomerSummary(
  dataset: string,
  dateFrom: string | null,
  dateTo: string | null,
): Promise<VestiCustomerSummary> {
  const clientes = vestiTable(dataset, "clientes_vesti");
  const view = vestiTable(dataset, "dashboard_vendas_view");
  const dateFilter = dateFrom && dateTo ? "AND DATE(created_at) BETWEEN @dateFrom AND @dateTo" : "";
  const params: Record<string, unknown> = dateFrom && dateTo ? { dateFrom, dateTo } : {};

  const kpiQuery = `
    WITH regs AS (
      SELECT id, active, profile.name AS profile_name, created_at
      FROM ${clientes}
      WHERE 1=1 ${dateFilter}
    ),
    buyers AS (
      SELECT DISTINCT cliente_id FROM ${view} WHERE cliente_id IS NOT NULL
    )
    SELECT
      COUNT(*) AS total_registrations,
      COUNTIF(COALESCE(active, true) != false AND profile_name IN ('Liberado', 'VIP')) AS approved_registrations,
      COUNTIF(COALESCE(active, true) != false AND COALESCE(profile_name, '') NOT IN ('Liberado', 'VIP')) AS pending_registrations,
      COUNTIF(active = false) AS rejected_registrations,
      COUNTIF(b.cliente_id IS NOT NULL) AS total_buyers,
      COUNTIF(b.cliente_id IS NULL) AS customers_without_purchase
    FROM regs r
    LEFT JOIN buyers b ON b.cliente_id = r.id
  `;

  const dailyQuery = `
    SELECT
      DATE(created_at) AS date,
      COUNT(*) AS registrations,
      COUNTIF(active != false AND profile.name IN ('Liberado', 'VIP')) AS approved
    FROM ${clientes}
    WHERE 1=1 ${dateFilter}
    GROUP BY date
    ORDER BY date
  `;

  const sourceQuery = `
    SELECT COALESCE(NULLIF(origin, ''), 'Direto') AS source, COUNT(*) AS count
    FROM ${clientes}
    WHERE 1=1 ${dateFilter}
    GROUP BY source
    ORDER BY count DESC
    LIMIT 20
  `;

  // Pega o estado real (via pedidos) quando existir; onde não existe, o
  // fallback por DDD do telefone é aplicado em JS logo abaixo (mesma lógica
  // já usada pro heat map de clients UpZero, ver lib/phoneState.ts).
  const stateQuery = `
    WITH regs AS (
      SELECT id, phone FROM ${clientes} WHERE 1=1 ${dateFilter}
    ),
    customer_state AS (
      SELECT cliente_id, ARRAY_AGG(NULLIF(estado, '') IGNORE NULLS ORDER BY data_ref DESC LIMIT 1)[SAFE_OFFSET(0)] AS state
      FROM ${view}
      WHERE cliente_id IS NOT NULL
      GROUP BY cliente_id
    )
    SELECT r.phone AS phone, cs.state AS state
    FROM regs r
    LEFT JOIN customer_state cs ON cs.cliente_id = r.id
  `;

  const [[kpiRows], [dailyRows], [sourceRows], [stateRows]] = await Promise.all([
    bigquery.query({ query: kpiQuery, params }),
    bigquery.query({ query: dailyQuery, params }),
    bigquery.query({ query: sourceQuery, params }),
    bigquery.query({ query: stateQuery, params }),
  ]);

  const k = (kpiRows as Array<Record<string, unknown>>)[0];
  const totalRegistrations = Number(k?.total_registrations) || 0;
  const approvedRegistrations = Number(k?.approved_registrations) || 0;

  const stateCounts = new Map<string, number>();
  for (const row of stateRows as Array<Record<string, unknown>>) {
    const state = (row.state as string) || stateFromPhoneDdd(row.phone as string);
    if (!state) continue;
    stateCounts.set(state, (stateCounts.get(state) ?? 0) + 1);
  }
  const registrationsByState = Array.from(stateCounts.entries())
    .map(([state, count]) => ({ state, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);

  return {
    kpis: {
      totalRegistrations,
      approvedRegistrations,
      pendingRegistrations: Number(k?.pending_registrations) || 0,
      rejectedRegistrations: Number(k?.rejected_registrations) || 0,
      approvalRatePct: totalRegistrations > 0 ? (approvedRegistrations / totalRegistrations) * 100 : 0,
      customersWithoutPurchase: Number(k?.customers_without_purchase) || 0,
      totalBuyers: Number(k?.total_buyers) || 0,
    },
    registrationsOverTime: (dailyRows as Array<Record<string, unknown>>).map((r) => ({
      date: toDateOnly(r.date),
      registrations: Number(r.registrations) || 0,
      approved: Number(r.approved) || 0,
    })),
    registrationsByState,
    registrationsBySource: (sourceRows as Array<Record<string, unknown>>).map((r) => ({
      source: String(r.source),
      count: Number(r.count) || 0,
    })),
  };
}

// ───────── Produtos ─────────
//
// Catálogo vem de `produtos_vesti` (sem `cost`/`restockThreshold` — a
// Vesti não tem esses conceitos; `cost` fica null, `restockThreshold` usa
// um valor fixo razoável). Estoque vem de `estoques_vesti` (somado por
// produto). Vendas (totalSold/totalRevenue) vêm de `dashboard_vendas_view`
// agregada por `produto_id`.

const VESTI_DEFAULT_RESTOCK_THRESHOLD = 10;

function computeVestiProductLevel(
  totalSold: number,
  stock: number,
  recent30dSold: number,
  catalogAvgSellThrough: number,
): "High Conversion" | "Standard" | "Low" | "At Risk" {
  if (totalSold === 0) return "At Risk";
  const total = totalSold + stock;
  const sellThrough = total > 0 ? totalSold / total : 0;
  if (recent30dSold === 0 && sellThrough < catalogAvgSellThrough * 0.4) return "At Risk";
  if (sellThrough < 0.15 && stock > VESTI_DEFAULT_RESTOCK_THRESHOLD * 3) return "At Risk";
  if (sellThrough >= 0.65 || (sellThrough >= 0.5 && sellThrough > catalogAvgSellThrough * 1.3)) return "High Conversion";
  if (sellThrough >= 0.35 || (sellThrough >= 0.25 && sellThrough >= catalogAvgSellThrough * 0.7)) return "Standard";
  return "Low";
}

export type VestiProductRow = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  price: number;
  stock: number;
  totalSold: number;
  totalRevenue: number;
  createdAt: string;
};

export async function fetchVestiProductsPage(
  dataset: string,
  filters: { search?: string; category?: string; sort: "revenue" | "units" | "created"; limit: number },
): Promise<VestiProductRow[]> {
  const produtos = vestiTable(dataset, "produtos_vesti");
  const estoques = vestiTable(dataset, "estoques_vesti");
  const view = vestiTable(dataset, "dashboard_vendas_view");

  const conditions: string[] = [];
  const params: Record<string, unknown> = { limit: filters.limit };
  if (filters.search) {
    conditions.push("(LOWER(p.name) LIKE @search OR LOWER(p.code) LIKE @search)");
    params.search = `%${filters.search.toLowerCase()}%`;
  }
  if (filters.category) {
    conditions.push("p.categories[SAFE_OFFSET(0)].name = @category");
    params.category = filters.category;
  }
  const whereClause = conditions.length ? `AND ${conditions.join(" AND ")}` : "";
  const orderBy = filters.sort === "units" ? "total_sold DESC" : filters.sort === "created" ? "created_at DESC" : "total_revenue DESC";

  const query = `
    WITH stock_agg AS (
      SELECT product_id, COALESCE(SUM(quantity), 0) AS stock
      FROM ${estoques}
      GROUP BY product_id
    ),
    sales_agg AS (
      SELECT
        produto_id,
        COALESCE(SUM(produto_quantidade_reservada), 0) AS total_sold,
        COALESCE(SUM(produto_preco_unitario * produto_quantidade_reservada), 0) AS total_revenue
      FROM ${view}
      WHERE produto_id IS NOT NULL
      GROUP BY produto_id
    )
    SELECT
      p.id, p.code, p.name, p.price, p.created_at,
      p.categories[SAFE_OFFSET(0)].name AS category,
      COALESCE(sa.total_sold, 0) AS total_sold,
      COALESCE(sa.total_revenue, 0) AS total_revenue,
      COALESCE(st.stock, 0) AS stock
    FROM ${produtos} p
    LEFT JOIN stock_agg st ON st.product_id = p.id
    LEFT JOIN sales_agg sa ON sa.produto_id = p.id
    WHERE p.active != false ${whereClause}
    ORDER BY ${orderBy}
    LIMIT @limit
  `;

  const [rows] = await bigquery.query({ query, params });
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    sku: (r.code as string) ?? "",
    name: (r.name as string) ?? "",
    category: (r.category as string) || null,
    price: Number(r.price) || 0,
    stock: Number(r.stock) || 0,
    totalSold: Number(r.total_sold) || 0,
    totalRevenue: Number(r.total_revenue) || 0,
    createdAt: toDateOnly(r.created_at),
  }));
}

export type VestiProductDetail = {
  product: VestiProductRow;
  kpis: { totalRevenue: number; totalUnitsSold: number; avgTicket: number; uniqueBuyers: number; percentSold: number };
  revenueOverTime: { date: string; revenue: number; units: number }[];
  byColor: { label: string; units: number; revenue: number }[];
  bySize: { label: string; units: number; revenue: number }[];
  byState: { label: string; units: number; revenue: number }[];
  level: "High Conversion" | "Standard" | "Low" | "At Risk";
};

export async function fetchVestiProductDetail(dataset: string, productId: string): Promise<VestiProductDetail | null> {
  const produtos = vestiTable(dataset, "produtos_vesti");
  const estoques = vestiTable(dataset, "estoques_vesti");
  const view = vestiTable(dataset, "dashboard_vendas_view");

  const [prodRows] = await bigquery.query({
    query: `SELECT id, code, name, price, created_at, categories[SAFE_OFFSET(0)].name AS category FROM ${produtos} WHERE id = @productId LIMIT 1`,
    params: { productId },
  });
  const prod = (prodRows as Array<Record<string, unknown>>)[0];
  if (!prod) return null;

  const [[stockRows], [salesRows], [dailyRows], [colorRows], [sizeRows], [stateRows], [catalogRows]] = await Promise.all([
    bigquery.query({ query: `SELECT COALESCE(SUM(quantity), 0) AS stock FROM ${estoques} WHERE product_id = @productId`, params: { productId } }),
    bigquery.query({
      query: `
        SELECT
          COALESCE(SUM(produto_quantidade_reservada), 0) AS total_sold,
          COALESCE(SUM(produto_preco_unitario * produto_quantidade_reservada), 0) AS total_revenue,
          COUNT(DISTINCT IF(produto_quantidade_reservada > 0, cliente_id, NULL)) AS unique_buyers
        FROM ${view} WHERE produto_id = @productId
      `,
      params: { productId },
    }),
    bigquery.query({
      query: `
        SELECT data_ref AS date, COALESCE(SUM(produto_preco_unitario * produto_quantidade_reservada), 0) AS revenue, COALESCE(SUM(produto_quantidade_reservada), 0) AS units
        FROM ${view} WHERE produto_id = @productId
        GROUP BY date ORDER BY date
      `,
      params: { productId },
    }),
    bigquery.query({
      query: `
        SELECT COALESCE(NULLIF(produto_cor, ''), 'Sem cor') AS label, COALESCE(SUM(produto_quantidade_reservada), 0) AS units, COALESCE(SUM(produto_preco_unitario * produto_quantidade_reservada), 0) AS revenue
        FROM ${view} WHERE produto_id = @productId GROUP BY label ORDER BY revenue DESC
      `,
      params: { productId },
    }),
    bigquery.query({
      query: `
        SELECT COALESCE(NULLIF(produto_tamanho, ''), 'Único') AS label, COALESCE(SUM(produto_quantidade_reservada), 0) AS units, COALESCE(SUM(produto_preco_unitario * produto_quantidade_reservada), 0) AS revenue
        FROM ${view} WHERE produto_id = @productId GROUP BY label ORDER BY revenue DESC
      `,
      params: { productId },
    }),
    bigquery.query({
      query: `
        SELECT NULLIF(estado, '') AS label, COALESCE(SUM(produto_quantidade_reservada), 0) AS units, COALESCE(SUM(produto_preco_unitario * produto_quantidade_reservada), 0) AS revenue
        FROM ${view} WHERE produto_id = @productId AND estado IS NOT NULL AND estado != '' GROUP BY label ORDER BY revenue DESC
      `,
      params: { productId },
    }),
    bigquery.query({
      query: `
        WITH stock_agg AS (SELECT product_id, COALESCE(SUM(quantity), 0) AS stock FROM ${estoques} GROUP BY product_id),
        sales_agg AS (SELECT produto_id, COALESCE(SUM(produto_quantidade_reservada), 0) AS total_sold FROM ${view} WHERE produto_id IS NOT NULL GROUP BY produto_id)
        SELECT COALESCE(sa.total_sold, 0) AS total_sold, COALESCE(st.stock, 0) AS stock
        FROM ${produtos} p
        LEFT JOIN stock_agg st ON st.product_id = p.id
        LEFT JOIN sales_agg sa ON sa.produto_id = p.id
        WHERE p.active != false
      `,
    }),
  ]);

  const stock = Number((stockRows as Array<Record<string, unknown>>)[0]?.stock) || 0;
  const sales = (salesRows as Array<Record<string, unknown>>)[0];
  const totalSold = Number(sales?.total_sold) || 0;
  const totalRevenue = Number(sales?.total_revenue) || 0;

  const catalog = catalogRows as Array<Record<string, unknown>>;
  const catalogAvgSellThrough =
    catalog.length > 0
      ? catalog.reduce((sum, r) => {
          const sold = Number(r.total_sold) || 0;
          const st = Number(r.stock) || 0;
          const t = sold + st;
          return sum + (t > 0 ? sold / t : 0);
        }, 0) / catalog.length
      : 0;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const recent30dSold = (dailyRows as Array<Record<string, unknown>>)
    .filter((r) => new Date(toDateOnly(r.date)) >= thirtyDaysAgo)
    .reduce((sum, r) => sum + (Number(r.units) || 0), 0);

  return {
    product: {
      id: String(prod.id),
      sku: (prod.code as string) ?? "",
      name: (prod.name as string) ?? "",
      category: (prod.category as string) || null,
      price: Number(prod.price) || 0,
      stock,
      totalSold,
      totalRevenue,
      createdAt: toDateOnly(prod.created_at),
    },
    kpis: {
      totalRevenue,
      totalUnitsSold: totalSold,
      avgTicket: totalSold > 0 ? totalRevenue / totalSold : 0,
      uniqueBuyers: Number(sales?.unique_buyers) || 0,
      percentSold: totalSold + stock > 0 ? totalSold / (totalSold + stock) : 0,
    },
    revenueOverTime: (dailyRows as Array<Record<string, unknown>>).map((r) => ({
      date: toDateOnly(r.date),
      revenue: Number(r.revenue) || 0,
      units: Number(r.units) || 0,
    })),
    byColor: (colorRows as Array<Record<string, unknown>>).map((r) => ({ label: String(r.label), units: Number(r.units) || 0, revenue: Number(r.revenue) || 0 })),
    bySize: (sizeRows as Array<Record<string, unknown>>).map((r) => ({ label: String(r.label), units: Number(r.units) || 0, revenue: Number(r.revenue) || 0 })),
    byState: (stateRows as Array<Record<string, unknown>>).map((r) => ({ label: String(r.label), units: Number(r.units) || 0, revenue: Number(r.revenue) || 0 })),
    level: computeVestiProductLevel(totalSold, stock, recent30dSold, catalogAvgSellThrough),
  };
}

// Relatório Diário (Vesti) — reaproveita o mesmo dado do dashboard
// (computeVestiWindow) pros KPIs de venda; aqui só o breakdown por
// produto/categoria/cor/tamanho no período, equivalente ao que o
// caminho B2C tira de order_items (routes/analytics.ts).
export type VestiDailyBreakdownRow = { name: string; category?: string | null; units: number; revenue: number };

export type VestiDailyBreakdown = {
  products: VestiDailyBreakdownRow[];
  categories: VestiDailyBreakdownRow[];
  colors: VestiDailyBreakdownRow[];
  sizes: VestiDailyBreakdownRow[];
};

export async function fetchVestiDailyBreakdown(dataset: string, dateFrom: string, dateTo: string): Promise<VestiDailyBreakdown> {
  const view = vestiTable(dataset, "dashboard_vendas_view");
  const produtos = vestiTable(dataset, "produtos_vesti");
  const params = { dateFrom, dateTo };

  const [[productRows], [categoryRows], [colorRows], [sizeRows]] = await Promise.all([
    bigquery.query({
      query: `
        SELECT p.name AS name, p.categories[SAFE_OFFSET(0)].name AS category,
          COALESCE(SUM(v.produto_quantidade_reservada), 0) AS units,
          COALESCE(SUM(v.produto_preco_unitario * v.produto_quantidade_reservada), 0) AS revenue
        FROM ${view} v
        JOIN ${produtos} p ON p.id = v.produto_id
        WHERE v.data_ref BETWEEN @dateFrom AND @dateTo AND v.pago
        GROUP BY p.name, category
        ORDER BY revenue DESC
        LIMIT 10
      `,
      params,
    }),
    bigquery.query({
      query: `
        SELECT COALESCE(p.categories[SAFE_OFFSET(0)].name, 'Sem categoria') AS name,
          COALESCE(SUM(v.produto_quantidade_reservada), 0) AS units,
          COALESCE(SUM(v.produto_preco_unitario * v.produto_quantidade_reservada), 0) AS revenue
        FROM ${view} v
        JOIN ${produtos} p ON p.id = v.produto_id
        WHERE v.data_ref BETWEEN @dateFrom AND @dateTo AND v.pago
        GROUP BY name
        ORDER BY revenue DESC
        LIMIT 8
      `,
      params,
    }),
    bigquery.query({
      query: `
        SELECT COALESCE(NULLIF(produto_cor, ''), 'Sem cor') AS name,
          COALESCE(SUM(produto_quantidade_reservada), 0) AS units,
          COALESCE(SUM(produto_preco_unitario * produto_quantidade_reservada), 0) AS revenue
        FROM ${view}
        WHERE data_ref BETWEEN @dateFrom AND @dateTo AND pago
        GROUP BY name
        ORDER BY revenue DESC
        LIMIT 8
      `,
      params,
    }),
    bigquery.query({
      query: `
        SELECT COALESCE(NULLIF(produto_tamanho, ''), 'Único') AS name,
          COALESCE(SUM(produto_quantidade_reservada), 0) AS units,
          COALESCE(SUM(produto_preco_unitario * produto_quantidade_reservada), 0) AS revenue
        FROM ${view}
        WHERE data_ref BETWEEN @dateFrom AND @dateTo AND pago
        GROUP BY name
        ORDER BY revenue DESC
        LIMIT 8
      `,
      params,
    }),
  ]);

  const mapRow = (r: Record<string, unknown>): VestiDailyBreakdownRow => ({
    name: String(r.name),
    category: (r.category as string) ?? null,
    units: Number(r.units) || 0,
    revenue: Number(r.revenue) || 0,
  });

  return {
    products: (productRows as Array<Record<string, unknown>>).map(mapRow),
    categories: (categoryRows as Array<Record<string, unknown>>).map(mapRow),
    colors: (colorRows as Array<Record<string, unknown>>).map(mapRow),
    sizes: (sizeRows as Array<Record<string, unknown>>).map(mapRow),
  };
}

export type VestiDailyMetricSet = {
  approvedRevenue: number;
  sales: number;
  avgTicket: number;
  costPerPurchase: number;
  mediaSpend: number;
  roas: number;
};

function vestiPctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

function vestiDailyHeuristic(params: {
  kpis: VestiDailyMetricSet;
  prevKpis: VestiDailyMetricSet;
  campaigns: Array<{ name: string; spend: number; roas: number; purchases: number }>;
  breakdown: VestiDailyBreakdown;
}): { generalAnalysis: string; reportSummary: string[]; source: "ai" | "heuristic" } {
  const revenueChange = vestiPctChange(params.kpis.approvedRevenue, params.prevKpis.approvedRevenue);
  const salesChange = vestiPctChange(params.kpis.sales, params.prevKpis.sales);
  const topCampaign = params.campaigns[0];
  const topProduct = params.breakdown.products[0];
  const topCategory = params.breakdown.categories[0];
  const revenueTrend =
    revenueChange == null ? "sem base anterior comparável" : revenueChange >= 0 ? `cresceu ${revenueChange.toFixed(1)}%` : `caiu ${Math.abs(revenueChange).toFixed(1)}%`;

  return {
    generalAnalysis: `No período, o faturamento aprovado ${revenueTrend}, com ${params.kpis.sales} pedidos pagos e ticket médio de R$${params.kpis.avgTicket.toFixed(2)}.${params.kpis.mediaSpend > 0 ? ` O investimento em mídia foi de R$${params.kpis.mediaSpend.toFixed(2)}, com ROAS de ${params.kpis.roas.toFixed(2)}x.` : ""}`,
    reportSummary: [
      salesChange == null
        ? `Foram ${params.kpis.sales} pedidos pagos no período, ainda sem base anterior sólida para comparação.`
        : `A quantidade de pedidos pagos ${salesChange >= 0 ? "subiu" : "caiu"} ${Math.abs(salesChange).toFixed(1)}% versus o período anterior.`,
      topCampaign
        ? `Campanha de maior investimento: ${topCampaign.name}, com R$${topCampaign.spend.toFixed(2)} investidos, ${topCampaign.purchases} compras e ROAS ${topCampaign.roas.toFixed(2)}x.`
        : "Não houve campanhas de mídia com dados disponíveis para o período.",
      topProduct
        ? `Produto mais vendido: ${topProduct.name}, com ${topProduct.units} unidades e R$${topProduct.revenue.toFixed(2)} em receita.`
        : "Não houve produtos vendidos no período.",
      topCategory
        ? `Categoria líder: ${topCategory.name}, com ${topCategory.units} unidades vendidas e R$${topCategory.revenue.toFixed(2)} em receita.`
        : "Não houve categoria com venda registrada no período.",
    ],
    source: "heuristic",
  };
}

export async function generateVestiDailyReportText(params: {
  brand: string;
  dateFrom: string;
  dateTo: string;
  kpis: VestiDailyMetricSet;
  prevKpis: VestiDailyMetricSet;
  campaigns: Array<{ name: string; spend: number; purchases: number; revenue: number; roas: number; cpa: number }>;
  breakdown: VestiDailyBreakdown;
}): Promise<{ generalAnalysis: string; reportSummary: string[]; source: "ai" | "heuristic" }> {
  const heuristic = vestiDailyHeuristic(params);
  const ai = getOpenAIClient();
  if (!ai || !isAIConfigured()) return heuristic;

  try {
    const completion = await ai.chat.completions.create({
      model: process.env.AI_INTEGRATIONS_OPENAI_MODEL ?? "gpt-5-nano",
      max_completion_tokens: 1200,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Você é um analista sênior de vendas por atacado (venda via vendedora, não e-commerce) e mídia paga. Responda somente JSON válido, em português do Brasil, com análise objetiva para enviar ao cliente. Nunca diga que uma campanha não tem eficiência ou é ineficiente; quando houver queda ou baixo retorno, descreva a ação necessária.",
        },
        {
          role: "user",
          content: `Crie um relatório diário para "${params.brand}" no período ${params.dateFrom} até ${params.dateTo}.

Métricas atuais:
- Faturamento aprovado: R$${params.kpis.approvedRevenue.toFixed(2)}
- Pedidos pagos: ${params.kpis.sales}
- Ticket médio: R$${params.kpis.avgTicket.toFixed(2)}
- Investimento em mídia: R$${params.kpis.mediaSpend.toFixed(2)}
- ROAS: ${params.kpis.roas.toFixed(2)}x

Período anterior:
- Faturamento aprovado: R$${params.prevKpis.approvedRevenue.toFixed(2)}
- Pedidos pagos: ${params.prevKpis.sales}
- Ticket médio: R$${params.prevKpis.avgTicket.toFixed(2)}

Campanhas principais: ${params.campaigns.slice(0, 8).map((c) => `${c.name}: gasto R$${c.spend.toFixed(2)}, compras ${c.purchases}, receita R$${c.revenue.toFixed(2)}, ROAS ${c.roas.toFixed(2)}x`).join(" | ") || "sem dados"}
Produtos mais vendidos: ${params.breakdown.products.slice(0, 8).map((p) => `${p.name}${p.category ? ` (${p.category})` : ""}: ${p.units} un., R$${p.revenue.toFixed(2)}`).join(" | ") || "sem dados"}
Categorias: ${params.breakdown.categories.slice(0, 8).map((c) => `${c.name}: ${c.units} un., R$${c.revenue.toFixed(2)}`).join(" | ") || "sem dados"}
Cores: ${params.breakdown.colors.slice(0, 8).map((c) => `${c.name}: ${c.units} un., R$${c.revenue.toFixed(2)}`).join(" | ") || "sem dados"}
Tamanhos: ${params.breakdown.sizes.slice(0, 8).map((s) => `${s.name}: ${s.units} un., R$${s.revenue.toFixed(2)}`).join(" | ") || "sem dados"}

Retorne exatamente:
{
  "generalAnalysis": "<1 parágrafo curto com a leitura geral>",
  "reportSummary": ["<insight 1>", "<insight 2>", "<insight 3>", "... opcional até 6"]
}

Não use markdown.`,
        },
      ],
    });
    const text = completion.choices[0]?.message?.content;
    if (!text) return heuristic;
    const parsed = JSON.parse(text) as { generalAnalysis?: string; reportSummary?: unknown };
    const bullets = Array.isArray(parsed.reportSummary) ? parsed.reportSummary.map((item) => String(item).trim()).filter(Boolean) : [];
    const generalAnalysis = typeof parsed.generalAnalysis === "string" ? parsed.generalAnalysis.trim() : "";
    if (generalAnalysis || bullets.length > 0) {
      return {
        generalAnalysis: (generalAnalysis || heuristic.generalAnalysis).slice(0, 1200),
        reportSummary: (bullets.length > 0 ? bullets : heuristic.reportSummary).slice(0, 6).map((item) => item.slice(0, 300)),
        source: "ai",
      };
    }
  } catch (err) {
    console.warn("[vesti-daily-report] AI generation failed, using heuristic:", err instanceof Error ? err.message : err);
  }
  return heuristic;
}

// RFM (Vesti) — mesmas 5 faixas e mesma fórmula do lado B2C
// (routes/analytics.ts, `deriveRfmSegment`), pra manter o contrato de
// resposta (`GetRfmResponse`) idêntico. Existe uma tabela
// `rfm_clientes_final` já pré-calculada no BigQuery, mas com uma
// taxonomia de segmento diferente (12 segmentos em PT-BR) — em vez de
// tentar mapear pra essas 5 faixas (perderia nuance e ia divergir da
// fórmula real), recalculamos direto de `dashboard_vendas_view` +
// `clientes_vesti`, igual todo o resto do Vesti já faz.
const RFM_SEGMENT_ORDER = ["Champions", "Loyal", "Potential", "At Risk", "Lost"] as const;
type VestiRfmSegmentName = (typeof RFM_SEGMENT_ORDER)[number];

function deriveVestiRfmSegment(recencyDays: number, frequency: number, monetary: number): VestiRfmSegmentName {
  if (recencyDays <= 30 && frequency >= 3 && monetary >= 3000) return "Champions";
  if (recencyDays <= 90 && frequency >= 2) return "Loyal";
  if (recencyDays <= 60) return "Potential";
  if (recencyDays <= 180) return "At Risk";
  return "Lost";
}

export type VestiRfm = {
  segments: Array<{ segment: string; customerCount: number; revenue: number; avgTicket: number; pct: number }>;
  composition: Array<{ month: string; Champions: number; Loyal: number; Potential: number; AtRisk: number; Lost: number }>;
  customers: Array<{ id: string; name: string | null; email: string; segment: string; recencyDays: number; frequency: number; monetary: number }>;
  total: number;
};

export async function fetchVestiRfm(
  dataset: string,
  dateFrom: string,
  dateTo: string,
  filters: { segment?: string; sortBy: string; sortDir: "asc" | "desc"; page: number; limit: number },
): Promise<VestiRfm> {
  const view = vestiTable(dataset, "dashboard_vendas_view");
  const clientes = vestiTable(dataset, "clientes_vesti");

  const [rows] = await bigquery.query({
    query: `
      WITH orders_agg AS (
        SELECT
          cliente_id,
          COUNT(DISTINCT pedido_id) AS frequency,
          COALESCE(SUM(valor_reservado), 0) AS monetary,
          MIN(data_ref) AS first_purchase_at,
          MAX(data_ref) AS last_purchase_at
        FROM ${view}
        WHERE cliente_id IS NOT NULL AND data_ref BETWEEN @dateFrom AND @dateTo
        GROUP BY cliente_id
      )
      SELECT
        c.id, c.name, c.email,
        oa.frequency, oa.monetary, oa.first_purchase_at, oa.last_purchase_at
      FROM ${clientes} c
      JOIN orders_agg oa ON oa.cliente_id = c.id
    `,
    params: { dateFrom, dateTo },
  });

  const toEnd = new Date(`${dateTo}T23:59:59`).getTime();
  const enriched = (rows as Array<Record<string, unknown>>).map((r) => {
    const lastPurchaseAt = r.last_purchase_at ? new Date(toDateOnly(r.last_purchase_at)) : null;
    const recencyDays =
      lastPurchaseAt && Number.isFinite(lastPurchaseAt.getTime())
        ? Math.max(0, Math.round((toEnd - lastPurchaseAt.getTime()) / 86_400_000))
        : 9999;
    const frequency = Number(r.frequency) || 0;
    const monetary = Number(r.monetary) || 0;
    return {
      id: String(r.id),
      name: (r.name as string) || null,
      email: String(r.email ?? ""),
      firstPurchaseAt: r.first_purchase_at ? toDateOnly(r.first_purchase_at) : null,
      lastPurchaseAt: r.last_purchase_at ? toDateOnly(r.last_purchase_at) : null,
      recencyDays,
      frequency,
      monetary,
      segment: deriveVestiRfmSegment(recencyDays, frequency, monetary),
    };
  });

  const segmentAggMap = new Map<string, { customerCount: number; revenue: number }>();
  for (const row of enriched) {
    const current = segmentAggMap.get(row.segment) ?? { customerCount: 0, revenue: 0 };
    current.customerCount += 1;
    current.revenue += row.monetary;
    segmentAggMap.set(row.segment, current);
  }
  const totalCustomers = enriched.length;
  const segments = RFM_SEGMENT_ORDER.map((seg) => {
    const agg = segmentAggMap.get(seg) ?? { customerCount: 0, revenue: 0 };
    return {
      segment: seg,
      customerCount: agg.customerCount,
      revenue: agg.revenue,
      avgTicket: agg.customerCount > 0 ? agg.revenue / agg.customerCount : 0,
      pct: totalCustomers > 0 ? (agg.customerCount / totalCustomers) * 100 : 0,
    };
  });

  // Composição mensal: em qual mês cada cliente (já classificado acima)
  // teve pedido dentro da janela — mesma lógica do lado B2C (não é uma
  // reconstrução histórica do segmento mês a mês, é "em quais meses os
  // clientes de cada segmento atual compraram").
  const segmentByCustomerId = new Map(enriched.map((row) => [row.id, row.segment]));
  const customerIds = enriched.map((row) => row.id);
  const monthMap = new Map<string, { Champions: number; Loyal: number; Potential: number; AtRisk: number; Lost: number }>();
  if (customerIds.length > 0) {
    const [monthRows] = await bigquery.query({
      query: `
        SELECT FORMAT_DATE('%Y-%m', data_ref) AS month, cliente_id
        FROM ${view}
        WHERE cliente_id IN UNNEST(@customerIds) AND data_ref BETWEEN @dateFrom AND @dateTo
        GROUP BY month, cliente_id
      `,
      params: { customerIds, dateFrom, dateTo },
    });
    for (const r of monthRows as Array<Record<string, unknown>>) {
      const month = String(r.month);
      const seg = segmentByCustomerId.get(String(r.cliente_id));
      if (!seg) continue;
      const existing = monthMap.get(month) ?? { Champions: 0, Loyal: 0, Potential: 0, AtRisk: 0, Lost: 0 };
      if (seg === "At Risk") existing.AtRisk += 1;
      else existing[seg as Exclude<VestiRfmSegmentName, "At Risk">] += 1;
      monthMap.set(month, existing);
    }
  }
  const composition = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, ...v }));

  const filtered = filters.segment ? enriched.filter((row) => row.segment === filters.segment) : enriched;
  const sorted = filtered.sort((a, b) => {
    const dir = filters.sortDir === "asc" ? 1 : -1;
    if (filters.sortBy === "name") return dir * (a.name ?? "").localeCompare(b.name ?? "", "pt-BR");
    if (filters.sortBy === "segment") return dir * a.segment.localeCompare(b.segment, "pt-BR");
    const key = filters.sortBy as "recencyDays" | "frequency" | "monetary";
    return dir * ((a[key] ?? 0) - (b[key] ?? 0));
  });
  const offset = (filters.page - 1) * filters.limit;
  const customers = sorted.slice(offset, offset + filters.limit).map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    segment: row.segment,
    recencyDays: row.recencyDays,
    frequency: row.frequency,
    monetary: row.monetary,
  }));

  return { segments, composition, customers, total: sorted.length };
}

// Geografia (Vesti) — mesmo desenho do `/analytics/geography` B2C
// (states + cities), a partir de `dashboard_vendas_view.estado`/`.cidade`
// (já usado no signal de "regiões em alta" do dashboard). Pedido é
// deduplicado por `pedido_id` antes de agregar, já que a view é por item.
export type VestiGeography = {
  states: Array<{ state: string; orders: number; revenue: number; customers: number }>;
  cities: Array<{ state: string; city: string; orders: number; revenue: number }>;
};

export async function fetchVestiGeography(dataset: string, dateFrom: string, dateTo: string): Promise<VestiGeography> {
  const view = vestiTable(dataset, "dashboard_vendas_view");
  const clientes = vestiTable(dataset, "clientes_vesti");

  // `estado` vem vazio na maior parte das linhas (mesma limitação já
  // documentada na página de Clientes) — por isso o mesmo fallback:
  // infere o estado pelo DDD do telefone quando falta endereço real.
  // Precisa trazer telefone e agregar em JS (não dá pra aplicar
  // `stateFromPhoneDdd` dentro do BigQuery).
  const [rows] = await bigquery.query({
    query: `
      WITH pedidos AS (
        SELECT
          pedido_id,
          ANY_VALUE(estado) AS state,
          ANY_VALUE(cidade) AS city,
          ANY_VALUE(cliente_id) AS cliente_id,
          COALESCE(SUM(valor_reservado), 0) AS revenue
        FROM ${view}
        WHERE data_ref BETWEEN @dateFrom AND @dateTo AND pago
        GROUP BY pedido_id
      )
      SELECT p.*, c.phone
      FROM pedidos p
      LEFT JOIN ${clientes} c ON c.id = p.cliente_id
    `,
    params: { dateFrom, dateTo },
  });

  const stateMap = new Map<string, { orders: number; revenue: number; customers: Set<string> }>();
  const cityMap = new Map<string, { state: string; city: string; orders: number; revenue: number }>();
  for (const r of rows as Array<Record<string, unknown>>) {
    const rawState = (r.state as string) || null;
    const state = rawState || stateFromPhoneDdd(r.phone as string) || "Unknown";
    const city = (r.city as string) || "Unknown";
    const clienteId = r.cliente_id ? String(r.cliente_id) : null;
    const revenue = Number(r.revenue) || 0;

    const stateAgg = stateMap.get(state) ?? { orders: 0, revenue: 0, customers: new Set<string>() };
    stateAgg.orders += 1;
    stateAgg.revenue += revenue;
    if (clienteId) stateAgg.customers.add(clienteId);
    stateMap.set(state, stateAgg);

    const cityKey = `${state}::${city}`;
    const cityAgg = cityMap.get(cityKey) ?? { state, city, orders: 0, revenue: 0 };
    cityAgg.orders += 1;
    cityAgg.revenue += revenue;
    cityMap.set(cityKey, cityAgg);
  }

  return {
    states: Array.from(stateMap.entries())
      .map(([state, v]) => ({ state, orders: v.orders, revenue: v.revenue, customers: v.customers.size }))
      .sort((a, b) => b.revenue - a.revenue),
    cities: Array.from(cityMap.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 50),
  };
}

// Estoque (Vesti) — mesma fórmula do lado B2C (routes/analytics.ts,
// /analytics/stock):
//   dailyVelocity = unitsSold / periodDays
//   coverageDays  = stock / dailyVelocity  (null quando velocity = 0)
//   Stockout      = velocity > 0 && coverageDays < 7
//   Overstock     = (velocity == 0 && stock > restockThreshold*2) || coverageDays > 90
//   Healthy       = resto
// Reaproveita o mesmo join estoque+produto de `fetchVestiProductsPage`.
export type VestiStockRow = {
  productId: string;
  sku: string;
  name: string;
  category: string | null;
  stock: number;
  restockThreshold: number;
  dailyVelocity: number;
  coverageDays: number | null;
  risk: "Stockout" | "Overstock" | "Healthy";
  unitsSold: number;
  lastRestockDate: string | null;
  bySize: Array<{ size: string; unitsSold: number }>;
  byColor: Array<{ color: string; unitsSold: number }>;
};

export type VestiStock = {
  kpis: { totalUnits: number; avgCoverageDays: number; stockoutRiskCount: number; overstockRiskCount: number; sellThroughRate: number };
  prevKpis: { totalUnits: number; avgCoverageDays: number; stockoutRiskCount: number; overstockRiskCount: number; sellThroughRate: number };
  stockoutRisk: VestiStockRow[];
  overstockRisk: VestiStockRow[];
  highTurnover: VestiStockRow[];
  categoryBreakdown: Array<{ category: string; stockUnits: number; unitsSold: number; dailyVelocity: number }>;
  colorBreakdown: Array<{ color: string; unitsSold: number; stockUnits: number }>;
  sizeBreakdown: Array<{ size: string; unitsSold: number; stockUnits: number }>;
  skus: VestiStockRow[];
  total: number;
};

function classifyVestiStockRisk(stock: number, restockThreshold: number, coverageDays: number | null, dailyVelocity: number): "Stockout" | "Overstock" | "Healthy" {
  if (dailyVelocity > 0 && coverageDays !== null && coverageDays < 7) return "Stockout";
  if ((dailyVelocity === 0 && stock > restockThreshold * 2) || (coverageDays !== null && coverageDays > 90)) return "Overstock";
  return "Healthy";
}

export async function fetchVestiStock(
  dataset: string,
  dateFrom: string,
  dateTo: string,
  filters: { sort: string; sortDir: "asc" | "desc"; search?: string; category?: string; risk?: "Stockout" | "Overstock" | "Healthy"; page: number; limit: number },
): Promise<VestiStock> {
  const produtos = vestiTable(dataset, "produtos_vesti");
  const estoques = vestiTable(dataset, "estoques_vesti");
  const view = vestiTable(dataset, "dashboard_vendas_view");

  const [fromY, fromM, fromD] = dateFrom.split("-").map(Number);
  const [toY, toM, toD] = dateTo.split("-").map(Number);
  const periodDays = Math.max(1, Math.round((Date.UTC(toY, toM - 1, toD) - Date.UTC(fromY, fromM - 1, fromD)) / 86_400_000) + 1);
  const prevDateTo = addDaysToDateOnly(dateFrom, -1);
  const prevDateFrom = addDaysToDateOnly(dateFrom, -periodDays);

  const [[productRows], [salesRows], [prevSalesRows], [sizeRows], [colorRows]] = await Promise.all([
    bigquery.query({
      query: `
        WITH stock_agg AS (
          SELECT product_id, COALESCE(SUM(quantity), 0) AS stock
          FROM ${estoques}
          GROUP BY product_id
        )
        SELECT p.id, p.code, p.name, p.created_at,
          p.categories[SAFE_OFFSET(0)].name AS category,
          COALESCE(st.stock, 0) AS stock
        FROM ${produtos} p
        LEFT JOIN stock_agg st ON st.product_id = p.id
        WHERE p.active != false
      `,
    }),
    bigquery.query({
      query: `
        SELECT produto_id, COALESCE(SUM(produto_quantidade_reservada), 0) AS units_sold
        FROM ${view}
        WHERE produto_id IS NOT NULL AND data_ref BETWEEN @dateFrom AND @dateTo
        GROUP BY produto_id
      `,
      params: { dateFrom, dateTo },
    }),
    bigquery.query({
      query: `
        SELECT produto_id, COALESCE(SUM(produto_quantidade_reservada), 0) AS units_sold
        FROM ${view}
        WHERE produto_id IS NOT NULL AND data_ref BETWEEN @prevDateFrom AND @prevDateTo
        GROUP BY produto_id
      `,
      params: { prevDateFrom, prevDateTo },
    }),
    bigquery.query({
      query: `
        SELECT produto_id, COALESCE(NULLIF(produto_tamanho, ''), 'Único') AS size, COALESCE(SUM(produto_quantidade_reservada), 0) AS units_sold
        FROM ${view}
        WHERE produto_id IS NOT NULL AND data_ref BETWEEN @dateFrom AND @dateTo
        GROUP BY produto_id, size
      `,
      params: { dateFrom, dateTo },
    }),
    bigquery.query({
      query: `
        SELECT produto_id, COALESCE(NULLIF(produto_cor, ''), 'Sem cor') AS color, COALESCE(SUM(produto_quantidade_reservada), 0) AS units_sold
        FROM ${view}
        WHERE produto_id IS NOT NULL AND data_ref BETWEEN @dateFrom AND @dateTo
        GROUP BY produto_id, color
      `,
      params: { dateFrom, dateTo },
    }),
  ]);

  const salesById = new Map((salesRows as Array<Record<string, unknown>>).map((r) => [String(r.produto_id), Number(r.units_sold) || 0]));
  const prevSalesById = new Map((prevSalesRows as Array<Record<string, unknown>>).map((r) => [String(r.produto_id), Number(r.units_sold) || 0]));
  const sizesById = new Map<string, Array<{ size: string; unitsSold: number }>>();
  for (const r of sizeRows as Array<Record<string, unknown>>) {
    const pid = String(r.produto_id);
    const list = sizesById.get(pid) ?? [];
    list.push({ size: String(r.size), unitsSold: Number(r.units_sold) || 0 });
    sizesById.set(pid, list);
  }
  const colorsById = new Map<string, Array<{ color: string; unitsSold: number }>>();
  for (const r of colorRows as Array<Record<string, unknown>>) {
    const pid = String(r.produto_id);
    const list = colorsById.get(pid) ?? [];
    list.push({ color: String(r.color), unitsSold: Number(r.units_sold) || 0 });
    colorsById.set(pid, list);
  }

  const buildRows = (salesMap: Map<string, number>): VestiStockRow[] =>
    (productRows as Array<Record<string, unknown>>).map((r) => {
      const id = String(r.id);
      const stock = Number(r.stock) || 0;
      const unitsSold = salesMap.get(id) ?? 0;
      const dailyVelocity = unitsSold / periodDays;
      const coverageDays = dailyVelocity > 0 ? stock / dailyVelocity : null;
      return {
        productId: id,
        sku: (r.code as string) ?? "",
        name: (r.name as string) ?? "",
        category: (r.category as string) || null,
        stock,
        restockThreshold: VESTI_DEFAULT_RESTOCK_THRESHOLD,
        dailyVelocity,
        coverageDays,
        risk: classifyVestiStockRisk(stock, VESTI_DEFAULT_RESTOCK_THRESHOLD, coverageDays, dailyVelocity),
        unitsSold,
        lastRestockDate: r.created_at ? toDateOnly(r.created_at) : null,
        bySize: sizesById.get(id) ?? [],
        byColor: colorsById.get(id) ?? [],
      };
    });

  const allProducts = buildRows(salesById);
  const allProductsPrev = buildRows(prevSalesById);

  function buildKpis(rows: VestiStockRow[]) {
    const totalUnits = rows.reduce((s, r) => s + r.stock, 0);
    const withVelocity = rows.filter((r) => r.coverageDays !== null);
    const avgCoverageDays = withVelocity.length > 0 ? withVelocity.reduce((s, r) => s + (r.coverageDays ?? 0), 0) / withVelocity.length : 0;
    const stockoutRiskCount = rows.filter((r) => r.risk === "Stockout").length;
    const overstockRiskCount = rows.filter((r) => r.risk === "Overstock").length;
    const totalSold = rows.reduce((s, r) => s + r.unitsSold, 0);
    const sellThroughRate = totalSold + totalUnits > 0 ? (totalSold / (totalSold + totalUnits)) * 100 : 0;
    return { totalUnits, avgCoverageDays, stockoutRiskCount, overstockRiskCount, sellThroughRate };
  }

  const stockoutRisk = [...allProducts].filter((r) => r.risk === "Stockout").sort((a, b) => (a.coverageDays ?? 999) - (b.coverageDays ?? 999)).slice(0, 10);
  const overstockRisk = [...allProducts].filter((r) => r.risk === "Overstock").sort((a, b) => (b.coverageDays ?? 0) - (a.coverageDays ?? 0)).slice(0, 10);
  const highTurnover = [...allProducts].filter((r) => r.dailyVelocity > 0).sort((a, b) => b.dailyVelocity - a.dailyVelocity).slice(0, 10);

  const categoryMap = new Map<string, { stockUnits: number; unitsSold: number }>();
  const colorMap = new Map<string, { unitsSold: number; stockUnits: number }>();
  const sizeMap = new Map<string, { unitsSold: number; stockUnits: number }>();
  for (const row of allProducts) {
    const cat = row.category ?? "Sem categoria";
    const catRow = categoryMap.get(cat) ?? { stockUnits: 0, unitsSold: 0 };
    catRow.stockUnits += row.stock;
    catRow.unitsSold += row.unitsSold;
    categoryMap.set(cat, catRow);
    for (const s of row.bySize) {
      const sizeRow = sizeMap.get(s.size) ?? { unitsSold: 0, stockUnits: 0 };
      sizeRow.unitsSold += s.unitsSold;
      sizeMap.set(s.size, sizeRow);
    }
    for (const c of row.byColor) {
      const colorRow = colorMap.get(c.color) ?? { unitsSold: 0, stockUnits: 0 };
      colorRow.unitsSold += c.unitsSold;
      colorMap.set(c.color, colorRow);
    }
  }
  const categoryBreakdown = Array.from(categoryMap.entries()).map(([category, v]) => ({
    category,
    stockUnits: v.stockUnits,
    unitsSold: v.unitsSold,
    dailyVelocity: v.unitsSold / periodDays,
  }));
  const colorBreakdown = Array.from(colorMap.entries()).map(([color, v]) => ({ color, unitsSold: v.unitsSold, stockUnits: v.stockUnits }));
  const sizeBreakdown = Array.from(sizeMap.entries()).map(([size, v]) => ({ size, unitsSold: v.unitsSold, stockUnits: v.stockUnits }));

  let filtered = allProducts;
  if (filters.search) {
    const s = filters.search.toLowerCase();
    filtered = filtered.filter((r) => r.name.toLowerCase().includes(s) || r.sku.toLowerCase().includes(s));
  }
  if (filters.category) filtered = filtered.filter((r) => r.category === filters.category);
  if (filters.risk) filtered = filtered.filter((r) => r.risk === filters.risk);

  const dir = filters.sortDir === "asc" ? 1 : -1;
  const sorted = [...filtered].sort((a, b) => {
    switch (filters.sort) {
      case "sku": return dir * a.sku.localeCompare(b.sku, "pt-BR");
      case "name": return dir * a.name.localeCompare(b.name, "pt-BR");
      case "category": return dir * (a.category ?? "").localeCompare(b.category ?? "", "pt-BR");
      case "risk": return dir * a.risk.localeCompare(b.risk, "pt-BR");
      case "lastRestockDate": return dir * (a.lastRestockDate ?? "").localeCompare(b.lastRestockDate ?? "");
      case "dailyVelocity": return dir * (a.dailyVelocity - b.dailyVelocity);
      case "unitsSold": return dir * (a.unitsSold - b.unitsSold);
      case "coverageDays": return dir * ((a.coverageDays ?? 999999) - (b.coverageDays ?? 999999));
      default: return dir * (a.stock - b.stock);
    }
  });

  const offset = (filters.page - 1) * filters.limit;
  const skus = sorted.slice(offset, offset + filters.limit);

  return {
    kpis: buildKpis(allProducts),
    prevKpis: buildKpis(allProductsPrev),
    stockoutRisk,
    overstockRisk,
    highTurnover,
    categoryBreakdown,
    colorBreakdown,
    sizeBreakdown,
    skus,
    total: sorted.length,
  };
}

// Vendedores (Vesti) — não existe tabela de vendedor com ID sincronizada
// (diferente do B2C, que tem `sellersTable` própria); só o nome em texto
// livre no campo `vendedora` de `dashboard_vendas_view`. Usamos o próprio
// nome como "id" sintético (é o que identifica um vendedor de forma
// estável nesse lado) — mesma resolução prática já usada nos filtros de
// vendedor do Dashboard.
export type VestiSellerRow = { id: string; name: string; email: null; totalOrders: number; totalRevenue: number; avgTicket: number };

export async function fetchVestiSellers(dataset: string, limit: number): Promise<VestiSellerRow[]> {
  const view = vestiTable(dataset, "dashboard_vendas_view");
  const [rows] = await bigquery.query({
    query: `
      WITH pedidos AS (
        SELECT pedido_id, ANY_VALUE(vendedora) AS vendedora, COALESCE(SUM(valor_reservado), 0) AS revenue
        FROM ${view}
        WHERE vendedora IS NOT NULL AND vendedora != ''
        GROUP BY pedido_id
      )
      SELECT vendedora, COUNT(*) AS total_orders, COALESCE(SUM(revenue), 0) AS total_revenue
      FROM pedidos
      GROUP BY vendedora
      ORDER BY total_revenue DESC
      LIMIT @limit
    `,
    params: { limit },
  });
  return (rows as Array<Record<string, unknown>>).map((r) => {
    const totalOrders = Number(r.total_orders) || 0;
    const totalRevenue = Number(r.total_revenue) || 0;
    return {
      id: String(r.vendedora),
      name: String(r.vendedora),
      email: null,
      totalOrders,
      totalRevenue,
      avgTicket: totalOrders > 0 ? totalRevenue / totalOrders : 0,
    };
  });
}

export type VestiSellerKpis = { revenue: number; orders: number; avgTicket: number; uniqueCustomers: number; approvalRate: number; conversionRate: number };
export type VestiSellerDetail = {
  seller: { id: string; name: string; email: null; phone: null; createdAt: string };
  kpis: VestiSellerKpis;
  prevKpis: VestiSellerKpis;
  revenueOverTime: Array<{ date: string; revenue: number }>;
  prevRevenueOverTime: Array<{ date: string; revenue: number }>;
  categoryBreakdown: Array<{ category: string; revenue: number }>;
  stateBreakdown: Array<{ state: string; revenue: number }>;
} | null;

async function fetchVestiSellerKpisAndSeries(
  view: string,
  sellerName: string,
  dateFrom: string,
  dateTo: string,
): Promise<{ kpis: VestiSellerKpis; revenueOverTime: Array<{ date: string; revenue: number }> }> {
  const [rows] = await bigquery.query({
    query: `
      WITH pedidos AS (
        SELECT
          pedido_id,
          ANY_VALUE(data_ref) AS data_ref,
          ANY_VALUE(pago) AS pago,
          ANY_VALUE(cliente_id) AS cliente_id,
          COALESCE(SUM(valor_reservado), 0) AS revenue
        FROM ${view}
        WHERE vendedora = @sellerName AND data_ref BETWEEN @dateFrom AND @dateTo
        GROUP BY pedido_id
      )
      SELECT data_ref, pago, cliente_id, revenue
      FROM pedidos
    `,
    params: { sellerName, dateFrom, dateTo },
  });
  const orderRows = rows as Array<Record<string, unknown>>;
  const orders = orderRows.length;
  const approvedOrders = orderRows.filter((r) => r.pago).length;
  const revenue = orderRows.reduce((s, r) => s + (Number(r.revenue) || 0), 0);
  const uniqueCustomers = new Set(orderRows.filter((r) => r.cliente_id).map((r) => String(r.cliente_id))).size;

  const seriesMap = new Map<string, number>();
  for (const r of orderRows) {
    const date = toDateOnly(r.data_ref);
    seriesMap.set(date, (seriesMap.get(date) ?? 0) + (Number(r.revenue) || 0));
  }
  const revenueOverTime = Array.from(seriesMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rev]) => ({ date, revenue: rev }));

  return {
    kpis: {
      revenue,
      orders,
      avgTicket: approvedOrders > 0 ? revenue / approvedOrders : 0,
      uniqueCustomers,
      approvalRate: orders > 0 ? (approvedOrders / orders) * 100 : 0,
      conversionRate: orders > 0 ? (approvedOrders / orders) * 100 : 0,
    },
    revenueOverTime,
  };
}

export async function fetchVestiSellerDetail(dataset: string, sellerName: string, dateFrom: string, dateTo: string, prevDateFrom: string, prevDateTo: string): Promise<VestiSellerDetail> {
  const view = vestiTable(dataset, "dashboard_vendas_view");
  const produtos = vestiTable(dataset, "produtos_vesti");

  const [current, prev, [categoryRows], [stateRows], [existsRows]] = await Promise.all([
    fetchVestiSellerKpisAndSeries(view, sellerName, dateFrom, dateTo),
    fetchVestiSellerKpisAndSeries(view, sellerName, prevDateFrom, prevDateTo),
    bigquery.query({
      query: `
        SELECT COALESCE(p.categories[SAFE_OFFSET(0)].name, 'Sem categoria') AS category,
          COALESCE(SUM(v.produto_preco_unitario * v.produto_quantidade_reservada), 0) AS revenue
        FROM ${view} v
        JOIN ${produtos} p ON p.id = v.produto_id
        WHERE v.vendedora = @sellerName AND v.data_ref BETWEEN @dateFrom AND @dateTo AND v.pago
        GROUP BY category
        ORDER BY revenue DESC
        LIMIT 10
      `,
      params: { sellerName, dateFrom, dateTo },
    }),
    bigquery.query({
      query: `
        SELECT COALESCE(NULLIF(estado, ''), 'Desconhecido') AS state, COALESCE(SUM(valor_reservado), 0) AS revenue
        FROM ${view}
        WHERE vendedora = @sellerName AND data_ref BETWEEN @dateFrom AND @dateTo AND pago
        GROUP BY state
        ORDER BY revenue DESC
        LIMIT 10
      `,
      params: { sellerName, dateFrom, dateTo },
    }),
    bigquery.query({
      query: `SELECT 1 FROM ${view} WHERE vendedora = @sellerName LIMIT 1`,
      params: { sellerName },
    }),
  ]);

  if ((existsRows as unknown[]).length === 0) return null;

  return {
    seller: { id: sellerName, name: sellerName, email: null, phone: null, createdAt: new Date(0).toISOString() },
    kpis: current.kpis,
    prevKpis: prev.kpis,
    revenueOverTime: current.revenueOverTime,
    prevRevenueOverTime: prev.revenueOverTime,
    categoryBreakdown: (categoryRows as Array<Record<string, unknown>>).map((r) => ({ category: String(r.category), revenue: Number(r.revenue) || 0 })),
    stateBreakdown: (stateRows as Array<Record<string, unknown>>).map((r) => ({ state: String(r.state), revenue: Number(r.revenue) || 0 })),
  };
}

export type VestiSellerOrderRow = { id: string; customerId: string; customerName: string; amount: number; status: string; state: string | null; city: string | null; createdAt: string };

export async function fetchVestiSellerOrders(
  dataset: string,
  sellerName: string,
  dateFrom: string,
  dateTo: string,
  page: number,
  limit: number,
): Promise<{ rows: VestiSellerOrderRow[]; total: number }> {
  const view = vestiTable(dataset, "dashboard_vendas_view");
  const offset = (page - 1) * limit;

  const [[listRows], [countRows]] = await Promise.all([
    bigquery.query({
      query: `
        WITH pedidos AS (
          SELECT
            pedido_id,
            ANY_VALUE(cliente_id) AS cliente_id,
            ANY_VALUE(cliente_nome) AS cliente_nome,
            ANY_VALUE(status_pedido) AS status_pedido,
            ANY_VALUE(estado) AS state,
            ANY_VALUE(cidade) AS city,
            ANY_VALUE(data_ref) AS data_ref,
            COALESCE(SUM(valor_reservado), 0) AS amount
          FROM ${view}
          WHERE vendedora = @sellerName AND data_ref BETWEEN @dateFrom AND @dateTo
          GROUP BY pedido_id
        )
        SELECT * FROM pedidos
        ORDER BY data_ref DESC
        LIMIT @limit OFFSET @offset
      `,
      params: { sellerName, dateFrom, dateTo, limit, offset },
    }),
    bigquery.query({
      query: `
        SELECT COUNT(DISTINCT pedido_id) AS total
        FROM ${view}
        WHERE vendedora = @sellerName AND data_ref BETWEEN @dateFrom AND @dateTo
      `,
      params: { sellerName, dateFrom, dateTo },
    }),
  ]);

  return {
    rows: (listRows as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.pedido_id),
      customerId: r.cliente_id ? String(r.cliente_id) : "",
      customerName: (r.cliente_nome as string) || "",
      amount: Number(r.amount) || 0,
      status: (r.status_pedido as string) || "",
      state: (r.state as string) || null,
      city: (r.city as string) || null,
      createdAt: toDateOnly(r.data_ref),
    })),
    total: Number((countRows as Array<Record<string, unknown>>)[0]?.total) || 0,
  };
}

// Jornada (Vesti) — mesma fonte do Funil (`stape_logs.EventsLogsTratado`),
// mas aqui sequenciamos os eventos por `client_id` (visitante rastreado)
// em vez de só contar por etapa. Cada visitante forma uma "jornada"
// ordenada por `event_ts`; a partir disso: caminhos mais comuns
// (topPaths), grafo de transições evento→evento (eventNodes/eventEdges) e
// comparação compradores vs não-compradores.
const VESTI_JOURNEY_LAYER: Record<string, number> = {
  PageView: 0,
  Lead: 0,
  GetUpagency: 0,
  Contact: 0,
  ViewContent: 1,
  AddToCart: 2,
  InitiateCheckout: 3,
  Purchase: 4,
};

function toEpochMs(value: unknown): number {
  if (value && typeof value === "object" && "value" in (value as Record<string, unknown>)) {
    return new Date(String((value as { value: unknown }).value)).getTime();
  }
  return new Date(String(value)).getTime();
}

export type VestiJourney = {
  kpis: {
    avgEventsBeforePurchase: number;
    avgTimeToFirstPurchaseDays: number | null;
    avgTimeBetweenPurchasesDays: number | null;
    pctBuyersFromFirstSession: number;
  };
  topPaths: Array<{ steps: string[]; visitCount: number; conversionRate: number }>;
  eventNodes: Array<{ id: string; label: string; count: number; layer: number }>;
  eventEdges: Array<{ source: string; target: string; count: number }>;
  buyers: { avgSessionDepth: number; eventCounts: Array<{ eventType: string; count: number }>; topUtmSources: Array<{ source: string; count: number }> };
  nonBuyers: { avgSessionDepth: number; eventCounts: Array<{ eventType: string; count: number }>; topUtmSources: Array<{ source: string; count: number }> };
};

export async function fetchVestiJourney(dataset: string, dateFrom: string, dateTo: string): Promise<VestiJourney> {
  const [rows] = await bigquery.query({
    query: `
      SELECT client_id, event_name, event_ts, request_url
      FROM \`up-vesti-report.stape_logs.EventsLogsTratado\`
      WHERE client = @dataset AND DATE(event_ts) BETWEEN @dateFrom AND @dateTo AND client_id IS NOT NULL AND client_id != ''
      ORDER BY client_id, event_ts
    `,
    params: { dataset, dateFrom, dateTo },
  });

  type Ev = { event: string; ts: number; url: string | null };
  const byClient = new Map<string, Ev[]>();
  for (const r of rows as Array<Record<string, unknown>>) {
    const cid = String(r.client_id);
    const list = byClient.get(cid) ?? [];
    list.push({ event: String(r.event_name), ts: toEpochMs(r.event_ts), url: (r.request_url as string) ?? null });
    byClient.set(cid, list);
  }

  const emptyGroup = { avgSessionDepth: 0, eventCounts: [], topUtmSources: [] };
  if (byClient.size === 0) {
    return {
      kpis: { avgEventsBeforePurchase: 0, avgTimeToFirstPurchaseDays: null, avgTimeBetweenPurchasesDays: null, pctBuyersFromFirstSession: 0 },
      topPaths: [],
      eventNodes: [],
      eventEdges: [],
      buyers: emptyGroup,
      nonBuyers: emptyGroup,
    };
  }

  const pathCounts = new Map<string, { steps: string[]; count: number; withPurchase: number }>();
  const nodeCounts = new Map<string, number>();
  const edgeCounts = new Map<string, { source: string; target: string; count: number }>();
  const eventsBeforePurchase: number[] = [];
  const timeToFirstPurchaseDays: number[] = [];
  const timeBetweenPurchasesDays: number[] = [];
  let buyersFromFirstSession = 0;
  let totalBuyers = 0;

  const buyerEventCounts = new Map<string, number>();
  const nonBuyerEventCounts = new Map<string, number>();
  const buyerUtmCounts = new Map<string, number>();
  const nonBuyerUtmCounts = new Map<string, number>();
  let buyerDepthSum = 0;
  let nonBuyerDepthSum = 0;
  let buyerCount = 0;
  let nonBuyerCount = 0;

  for (const events of byClient.values()) {
    // Já vem ordenado por event_ts na query, mas garante (empates de
    // timestamp podem vir em qualquer ordem do BigQuery).
    events.sort((a, b) => a.ts - b.ts);

    // Caminho: eventos únicos consecutivos (colapsa repetição direta,
    // ex: 3x PageView seguidos vira 1 "PageView" no caminho), até 6 passos.
    const steps: string[] = [];
    for (const ev of events) {
      if (steps[steps.length - 1] !== ev.event) steps.push(ev.event);
      if (steps.length >= 6) break;
    }
    const purchaseIndex = events.findIndex((e) => e.event === "Purchase");
    const hasPurchase = purchaseIndex >= 0;

    const pathKey = steps.join(">");
    const pathEntry = pathCounts.get(pathKey) ?? { steps, count: 0, withPurchase: 0 };
    pathEntry.count += 1;
    if (hasPurchase) pathEntry.withPurchase += 1;
    pathCounts.set(pathKey, pathEntry);

    for (let i = 0; i < events.length; i++) {
      nodeCounts.set(events[i].event, (nodeCounts.get(events[i].event) ?? 0) + 1);
      if (i > 0 && events[i - 1].event !== events[i].event) {
        const key = `${events[i - 1].event}>${events[i].event}`;
        const edge = edgeCounts.get(key) ?? { source: events[i - 1].event, target: events[i].event, count: 0 };
        edge.count += 1;
        edgeCounts.set(key, edge);
      }
    }

    const firstTouchUtm = extractUtmFromRequestUrl(events[0]?.url);
    const utmKey = firstTouchUtm.source || "Direto";

    if (hasPurchase) {
      totalBuyers += 1;
      eventsBeforePurchase.push(purchaseIndex);
      const purchaseTs = events[purchaseIndex].ts;
      const firstTs = events[0].ts;
      timeToFirstPurchaseDays.push((purchaseTs - firstTs) / 86_400_000);
      if (new Date(purchaseTs).toISOString().slice(0, 10) === new Date(firstTs).toISOString().slice(0, 10)) {
        buyersFromFirstSession += 1;
      }
      const purchaseEvents = events.filter((e) => e.event === "Purchase");
      if (purchaseEvents.length > 1) {
        timeBetweenPurchasesDays.push((purchaseEvents[purchaseEvents.length - 1].ts - purchaseEvents[0].ts) / 86_400_000);
      }

      buyerCount += 1;
      buyerDepthSum += events.length;
      for (const ev of events) buyerEventCounts.set(ev.event, (buyerEventCounts.get(ev.event) ?? 0) + 1);
      buyerUtmCounts.set(utmKey, (buyerUtmCounts.get(utmKey) ?? 0) + 1);
    } else {
      nonBuyerCount += 1;
      nonBuyerDepthSum += events.length;
      for (const ev of events) nonBuyerEventCounts.set(ev.event, (nonBuyerEventCounts.get(ev.event) ?? 0) + 1);
      nonBuyerUtmCounts.set(utmKey, (nonBuyerUtmCounts.get(utmKey) ?? 0) + 1);
    }
  }

  const avg = (arr: number[]): number | null => (arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null);

  const topPaths = Array.from(pathCounts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map((p) => ({ steps: p.steps, visitCount: p.count, conversionRate: p.count > 0 ? (p.withPurchase / p.count) * 100 : 0 }));

  const eventNodes = Array.from(nodeCounts.entries()).map(([id, count]) => ({
    id,
    label: id,
    count,
    layer: VESTI_JOURNEY_LAYER[id] ?? 5,
  }));
  const eventEdges = Array.from(edgeCounts.values());

  const buildGroup = (eventCounts: Map<string, number>, utmCounts: Map<string, number>, depthSum: number, count: number) => ({
    avgSessionDepth: count > 0 ? depthSum / count : 0,
    eventCounts: Array.from(eventCounts.entries()).map(([eventType, c]) => ({ eventType, count: c })).sort((a, b) => b.count - a.count),
    topUtmSources: Array.from(utmCounts.entries()).map(([source, c]) => ({ source, count: c })).sort((a, b) => b.count - a.count).slice(0, 10),
  });

  return {
    kpis: {
      avgEventsBeforePurchase: avg(eventsBeforePurchase) ?? 0,
      avgTimeToFirstPurchaseDays: avg(timeToFirstPurchaseDays),
      avgTimeBetweenPurchasesDays: avg(timeBetweenPurchasesDays),
      pctBuyersFromFirstSession: totalBuyers > 0 ? (buyersFromFirstSession / totalBuyers) * 100 : 0,
    },
    topPaths,
    eventNodes,
    eventEdges,
    buyers: buildGroup(buyerEventCounts, buyerUtmCounts, buyerDepthSum, buyerCount),
    nonBuyers: buildGroup(nonBuyerEventCounts, nonBuyerUtmCounts, nonBuyerDepthSum, nonBuyerCount),
  };
}

// Escala (Vesti) — junta estoque+preço (mesmo padrão do Estoque) pra
// "poder de venda", vendas do período/rolling 90d (mesmo padrão do
// Dashboard) e visitas via `stape_logs` (mesmo truque do Funil). A
// matemática de projeção (cenários, gap de poder de venda, status) é
// idêntica à do B2C — fica no controller, não repetida aqui, porque não
// depende de nada específico de BigQuery/Vesti.
export type VestiScaleBreakdownRow = { name: string; revenue: number; units: number; orders: number };
export type VestiScaleStockRow = { name: string; stockUnits: number; salesPower: number };

export type VestiScaleData = {
  currentSalesPower: number;
  availableStockUnits: number;
  activeProducts: number;
  availableProducts: number;
  brokenGradePct: number;
  brokenGradeCount: number;
  productGroupCount: number;
  revenue: number;
  orders: number;
  rollingRevenue: number;
  rollingOrders: number;
  sessions: number;
  rollingSessions: number;
  categories: VestiScaleBreakdownRow[];
  colors: VestiScaleBreakdownRow[];
  sizes: VestiScaleBreakdownRow[];
  stockByCategory: VestiScaleStockRow[];
};

export async function fetchVestiScaleData(
  dataset: string,
  dateFrom: string,
  dateTo: string,
  rollingDateFrom: string,
  rollingDateTo: string,
): Promise<VestiScaleData> {
  const produtos = vestiTable(dataset, "produtos_vesti");
  const estoques = vestiTable(dataset, "estoques_vesti");
  const view = vestiTable(dataset, "dashboard_vendas_view");

  const [
    [productRows],
    [gradeRows],
    [salesRows],
    [rollingSalesRows],
    [sessionsRows],
    [rollingSessionsRows],
    [categoryRows],
    [colorRows],
    [sizeRows],
  ] = await Promise.all([
    bigquery.query({
      query: `
        WITH stock_agg AS (
          SELECT product_id, COALESCE(SUM(quantity), 0) AS stock
          FROM ${estoques}
          GROUP BY product_id
        )
        SELECT p.id, p.price, COALESCE(st.stock, 0) AS stock,
          p.categories[SAFE_OFFSET(0)].name AS category
        FROM ${produtos} p
        LEFT JOIN stock_agg st ON st.product_id = p.id
        WHERE p.active != false
      `,
    }),
    bigquery.query({
      query: `
        WITH sizes AS (
          SELECT product_id, size_id, COALESCE(SUM(quantity), 0) AS qty
          FROM ${estoques}
          GROUP BY product_id, size_id
        )
        SELECT product_id, COUNTIF(qty = 0) AS zero_sizes, COUNTIF(qty > 0) AS nonzero_sizes
        FROM sizes
        GROUP BY product_id
      `,
    }),
    bigquery.query({
      query: `
        SELECT COALESCE(SUM(valor_reservado), 0) AS revenue, COUNT(DISTINCT IF(pago, pedido_id, NULL)) AS orders
        FROM ${view}
        WHERE data_ref BETWEEN @dateFrom AND @dateTo
      `,
      params: { dateFrom, dateTo },
    }),
    bigquery.query({
      query: `
        SELECT COALESCE(SUM(valor_reservado), 0) AS revenue, COUNT(DISTINCT IF(pago, pedido_id, NULL)) AS orders
        FROM ${view}
        WHERE data_ref BETWEEN @rollingDateFrom AND @rollingDateTo
      `,
      params: { rollingDateFrom, rollingDateTo },
    }),
    bigquery.query({
      query: `SELECT COUNT(*) AS visits FROM \`up-vesti-report.stape_logs.EventsLogsTratado\` WHERE client = @dataset AND event_name = 'PageView' AND DATE(event_ts) BETWEEN @dateFrom AND @dateTo`,
      params: { dataset, dateFrom, dateTo },
    }),
    bigquery.query({
      query: `SELECT COUNT(*) AS visits FROM \`up-vesti-report.stape_logs.EventsLogsTratado\` WHERE client = @dataset AND event_name = 'PageView' AND DATE(event_ts) BETWEEN @rollingDateFrom AND @rollingDateTo`,
      params: { dataset, rollingDateFrom, rollingDateTo },
    }),
    bigquery.query({
      query: `
        SELECT COALESCE(p.categories[SAFE_OFFSET(0)].name, 'Sem categoria') AS name,
          COALESCE(SUM(v.produto_preco_unitario * v.produto_quantidade_reservada), 0) AS revenue,
          COALESCE(SUM(v.produto_quantidade_reservada), 0) AS units,
          COUNT(DISTINCT IF(v.pago, v.pedido_id, NULL)) AS orders
        FROM ${view} v
        JOIN ${produtos} p ON p.id = v.produto_id
        WHERE v.data_ref BETWEEN @dateFrom AND @dateTo AND v.pago
        GROUP BY name
        ORDER BY revenue DESC
        LIMIT 8
      `,
      params: { dateFrom, dateTo },
    }),
    bigquery.query({
      query: `
        SELECT COALESCE(NULLIF(produto_cor, ''), 'Sem cor') AS name,
          COALESCE(SUM(produto_preco_unitario * produto_quantidade_reservada), 0) AS revenue,
          COALESCE(SUM(produto_quantidade_reservada), 0) AS units
        FROM ${view}
        WHERE data_ref BETWEEN @dateFrom AND @dateTo AND pago
        GROUP BY name
        ORDER BY revenue DESC
        LIMIT 8
      `,
      params: { dateFrom, dateTo },
    }),
    bigquery.query({
      query: `
        SELECT COALESCE(NULLIF(produto_tamanho, ''), 'Único') AS name,
          COALESCE(SUM(produto_preco_unitario * produto_quantidade_reservada), 0) AS revenue,
          COALESCE(SUM(produto_quantidade_reservada), 0) AS units
        FROM ${view}
        WHERE data_ref BETWEEN @dateFrom AND @dateTo AND pago
        GROUP BY name
        ORDER BY revenue DESC
        LIMIT 8
      `,
      params: { dateFrom, dateTo },
    }),
  ]);

  const products = productRows as Array<Record<string, unknown>>;
  const availableProducts = products.filter((p) => (Number(p.stock) || 0) > 0);
  const currentSalesPower = availableProducts.reduce((s, p) => s + (Number(p.stock) || 0) * (Number(p.price) || 0), 0);
  const availableStockUnits = availableProducts.reduce((s, p) => s + (Number(p.stock) || 0), 0);

  const stockByCategoryMap = new Map<string, VestiScaleStockRow>();
  for (const p of availableProducts) {
    const name = (p.category as string) || "Sem categoria";
    const row = stockByCategoryMap.get(name) ?? { name, stockUnits: 0, salesPower: 0 };
    row.stockUnits += Number(p.stock) || 0;
    row.salesPower += (Number(p.stock) || 0) * (Number(p.price) || 0);
    stockByCategoryMap.set(name, row);
  }

  const grades = gradeRows as Array<Record<string, unknown>>;
  const brokenGroups = grades.filter((g) => (Number(g.zero_sizes) || 0) > 0 && (Number(g.nonzero_sizes) || 0) > 0).length;
  const productGroupCount = grades.length;
  const brokenGradePct = productGroupCount > 0 ? (brokenGroups / productGroupCount) * 100 : 0;

  const mapBreakdown = (rows: Array<Record<string, unknown>>): VestiScaleBreakdownRow[] =>
    rows.map((r) => ({ name: String(r.name), revenue: Number(r.revenue) || 0, units: Number(r.units) || 0, orders: Number(r.orders) || 0 }));

  return {
    currentSalesPower,
    availableStockUnits,
    activeProducts: products.length,
    availableProducts: availableProducts.length,
    brokenGradePct,
    brokenGradeCount: brokenGroups,
    productGroupCount,
    revenue: Number((salesRows as Array<Record<string, unknown>>)[0]?.revenue) || 0,
    orders: Number((salesRows as Array<Record<string, unknown>>)[0]?.orders) || 0,
    rollingRevenue: Number((rollingSalesRows as Array<Record<string, unknown>>)[0]?.revenue) || 0,
    rollingOrders: Number((rollingSalesRows as Array<Record<string, unknown>>)[0]?.orders) || 0,
    sessions: Number((sessionsRows as Array<Record<string, unknown>>)[0]?.visits) || 0,
    rollingSessions: Number((rollingSessionsRows as Array<Record<string, unknown>>)[0]?.visits) || 0,
    categories: mapBreakdown(categoryRows as Array<Record<string, unknown>>),
    colors: mapBreakdown(colorRows as Array<Record<string, unknown>>),
    sizes: mapBreakdown(sizeRows as Array<Record<string, unknown>>),
    stockByCategory: Array.from(stockByCategoryMap.values()).sort((a, b) => b.salesPower - a.salesPower).slice(0, 8),
  };
}

// Marketing (Vesti) — "caminho rápido" combinado com o time (04/08/2026):
// não existe UTM de campanha em pedido nativo Vesti, então em vez de tentar
// cruzar por e-mail com o `stape_logs` (frágil, e-mail nem sempre vem no
// evento de compra), usamos `clientes_atribuidos_consolidados` +
// `pedidos_atribuidos_consolidados` — tabelas já prontas no BigQuery,
// mesmas que o `backend-dash` usa em produção. `origem_vesti` é canal
// grosso (Site, Link, VestiShop, Erp, Aplicativo), não campanha/anúncio —
// por isso não dá pra montar `stateBreakdown`/`ageBreakdown` nem ROAS por
// criativo específico (ficam vazios/zerados, documentado no contrato).
export type VestiMarketingChannelRow = { platform: string; leads: number; attributedRevenue: number };

export type VestiMarketingData = {
  totalLeads: number;
  approvedLeads: number;
  totalAttributedRevenue: number;
  leadsOverTime: VestiSeriesPoint[];
  revenueOverTime: VestiSeriesPoint[];
  platformBreakdown: VestiMarketingChannelRow[];
};

export async function fetchVestiMarketingData(dataset: string, dateFrom: string, dateTo: string): Promise<VestiMarketingData> {
  const clientesAtribuidos = vestiTable(dataset, "clientes_atribuidos_consolidados");
  const pedidosAtribuidos = vestiTable(dataset, "pedidos_atribuidos_consolidados");
  const view = vestiTable(dataset, "dashboard_vendas_view");

  const [[leadsRows], [leadsSeriesRows], [revenueRows], [revenueSeriesRows]] = await Promise.all([
    bigquery.query({
      query: `SELECT COUNT(*) AS total FROM ${clientesAtribuidos} WHERE data_cadastro BETWEEN @dateFrom AND @dateTo`,
      params: { dateFrom, dateTo },
    }),
    bigquery.query({
      query: `
        SELECT FORMAT_DATE('%Y-%m-%d', data_cadastro) AS date, COUNT(*) AS value
        FROM ${clientesAtribuidos}
        WHERE data_cadastro BETWEEN @dateFrom AND @dateTo
        GROUP BY date
        ORDER BY date
      `,
      params: { dateFrom, dateTo },
    }),
    bigquery.query({
      query: `
        WITH pedidos_attr AS (
          SELECT pa.pedido_id, ca.origem_vesti
          FROM ${pedidosAtribuidos} pa
          JOIN ${clientesAtribuidos} ca ON LOWER(ca.email) = LOWER(pa.email)
          WHERE pa.data_ref BETWEEN @dateFrom AND @dateTo
        ),
        orders_rev AS (
          SELECT CAST(pedido_id AS STRING) AS pedido_id, COALESCE(SUM(valor_reservado), 0) AS revenue
          FROM ${view}
          WHERE data_ref BETWEEN @dateFrom AND @dateTo AND pago
          GROUP BY pedido_id
        )
        SELECT COALESCE(NULLIF(pa.origem_vesti, ''), 'Não identificado') AS platform,
          COUNT(DISTINCT pa.pedido_id) AS leads,
          COALESCE(SUM(o.revenue), 0) AS revenue
        FROM pedidos_attr pa
        LEFT JOIN orders_rev o ON o.pedido_id = pa.pedido_id
        GROUP BY platform
        ORDER BY revenue DESC
      `,
      params: { dateFrom, dateTo },
    }),
    bigquery.query({
      query: `
        WITH pedidos_attr AS (
          SELECT DISTINCT pa.pedido_id
          FROM ${pedidosAtribuidos} pa
          WHERE pa.data_ref BETWEEN @dateFrom AND @dateTo
        )
        SELECT v.data_ref AS date, COALESCE(SUM(v.valor_reservado), 0) AS value
        FROM ${view} v
        JOIN pedidos_attr pa ON CAST(v.pedido_id AS STRING) = pa.pedido_id
        WHERE v.data_ref BETWEEN @dateFrom AND @dateTo AND v.pago
        GROUP BY date
        ORDER BY date
      `,
      params: { dateFrom, dateTo },
    }),
  ]);

  const totalLeads = Number((leadsRows as Array<Record<string, unknown>>)[0]?.total) || 0;
  const platformBreakdown = (revenueRows as Array<Record<string, unknown>>).map((r) => ({
    platform: String(r.platform),
    leads: Number(r.leads) || 0,
    attributedRevenue: Number(r.revenue) || 0,
  }));
  const totalAttributedRevenue = platformBreakdown.reduce((s, r) => s + r.attributedRevenue, 0);

  return {
    totalLeads,
    approvedLeads: totalLeads,
    totalAttributedRevenue,
    leadsOverTime: (leadsSeriesRows as Array<Record<string, unknown>>).map((r) => ({ date: toDateOnly(r.date), value: Number(r.value) || 0 })),
    revenueOverTime: (revenueSeriesRows as Array<Record<string, unknown>>).map((r) => ({ date: toDateOnly(r.date), value: Number(r.value) || 0 })),
    platformBreakdown,
  };
}

// UTM (Vesti) — mesma fonte do Marketing (`clientes_atribuidos_consolidados`
// + `pedidos_atribuidos_consolidados`), só que agrupado por linha em vez de
// por canal solto. `groupBy` (source/campaign/sourceMediumCampaign) do
// contrato B2C não se aplica de verdade aqui — só temos `origem_vesti`
// (canal grosso), sem medium/campanha separados, então sempre agrupamos
// por canal independente do parâmetro (documentado, não é ignorado por
// engano). `subRows` fica sempre vazio pela mesma razão.
export type VestiUtmRow = {
  key: string;
  source: string;
  medium: null;
  campaign: null;
  registrations: number;
  approvals: number;
  approvalPct: number;
  buyers: number;
  revenue: number;
  conversionPct: number;
  roas: null;
  subRows: never[];
};

export type VestiUtmData = {
  totalSessions: number;
  rows: VestiUtmRow[];
};

export async function fetchVestiUtmData(dataset: string, dateFrom: string, dateTo: string): Promise<VestiUtmData> {
  const clientesAtribuidos = vestiTable(dataset, "clientes_atribuidos_consolidados");
  const pedidosAtribuidos = vestiTable(dataset, "pedidos_atribuidos_consolidados");
  const view = vestiTable(dataset, "dashboard_vendas_view");

  const [[rows], [sessionsRows]] = await Promise.all([
    bigquery.query({
      query: `
        WITH pedidos_attr AS (
          SELECT pa.pedido_id, pa.email, ca.origem_vesti
          FROM ${pedidosAtribuidos} pa
          JOIN ${clientesAtribuidos} ca ON LOWER(ca.email) = LOWER(pa.email)
          WHERE pa.data_ref BETWEEN @dateFrom AND @dateTo
        ),
        orders_rev AS (
          SELECT CAST(pedido_id AS STRING) AS pedido_id, COALESCE(SUM(valor_reservado), 0) AS revenue
          FROM ${view}
          WHERE data_ref BETWEEN @dateFrom AND @dateTo AND pago
          GROUP BY pedido_id
        ),
        registrations AS (
          SELECT COALESCE(NULLIF(origem_vesti, ''), 'Não identificado') AS source, COUNT(*) AS registrations
          FROM ${clientesAtribuidos}
          WHERE data_cadastro BETWEEN @dateFrom AND @dateTo
          GROUP BY source
        ),
        buyers AS (
          SELECT COALESCE(NULLIF(pa.origem_vesti, ''), 'Não identificado') AS source,
            COUNT(DISTINCT pa.email) AS buyers,
            COALESCE(SUM(o.revenue), 0) AS revenue
          FROM pedidos_attr pa
          LEFT JOIN orders_rev o ON o.pedido_id = pa.pedido_id
          GROUP BY source
        )
        SELECT
          COALESCE(r.source, b.source) AS source,
          COALESCE(r.registrations, 0) AS registrations,
          COALESCE(b.buyers, 0) AS buyers,
          COALESCE(b.revenue, 0) AS revenue
        FROM registrations r
        FULL OUTER JOIN buyers b ON b.source = r.source
        ORDER BY revenue DESC
      `,
      params: { dateFrom, dateTo },
    }),
    bigquery.query({
      query: `SELECT COUNT(*) AS visits FROM \`up-vesti-report.stape_logs.EventsLogsTratado\` WHERE client = @dataset AND event_name = 'PageView' AND DATE(event_ts) BETWEEN @dateFrom AND @dateTo`,
      params: { dataset, dateFrom, dateTo },
    }),
  ]);

  return {
    totalSessions: Number((sessionsRows as Array<Record<string, unknown>>)[0]?.visits) || 0,
    rows: (rows as Array<Record<string, unknown>>).map((r) => {
      const registrations = Number(r.registrations) || 0;
      const buyers = Number(r.buyers) || 0;
      return {
        key: String(r.source),
        source: String(r.source),
        medium: null,
        campaign: null,
        registrations,
        approvals: registrations,
        approvalPct: 100,
        buyers,
        revenue: Number(r.revenue) || 0,
        conversionPct: registrations > 0 ? (buyers / registrations) * 100 : 0,
        roas: null,
        subRows: [],
      };
    }),
  };
}
