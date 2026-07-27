import { bigquery, vestiTable } from "../lib/bigquery";

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
    conversionRate: 0,
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
  totalPurchaseValue: number;
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
      SELECT DISTINCT v.pedido_id, v.valor_reservado
      FROM ${view} v
      WHERE v.pedido_id IN (SELECT pedido_id FROM attributed_orders)
    ),
    per_customer_orders AS (
      SELECT
        ao.email,
        COUNT(DISTINCT ao.pedido_id) AS purchase_count,
        COALESCE(SUM(orv.valor_reservado), 0) AS total_purchase_value,
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
    lastPurchaseAt: r.last_purchase_at
      ? String((r.last_purchase_at as { value?: string })?.value ?? r.last_purchase_at)
      : null,
  }));
}
