import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import {
  clientsTable,
  creativesTable,
  customersTable,
  db,
  eventsTable,
  orderItemsTable,
  ordersTable,
  productsTable,
} from "@workspace/db";
import { fetchMetaMarketingData } from "./meta-ads";
import { getUpzeroAnalyticsFactsAsMetrics } from "./upzero/analytics-facts";
import {
  getUpzeroAnalyticsMetrics,
  type UpzeroAnalyticsMetric,
} from "./upzero/analytics-metrics";

const TIMEZONE = "America/Sao_Paulo";
const REVENUE_STATUSES = ["APPROVED", "SHIPPED", "DELIVERED"] as const;

export interface PortfolioReportParams {
  dateFrom: string;
  dateTo: string;
}

type MetricCard = { label: string; value: string; delta: string };

export interface PortfolioReport {
  meta: {
    title: string;
    timezone: string;
    period_start: string;
    period_end: string;
    period_label: string;
    period: string;
    generated_at: string;
    source: string;
    read_only: true;
  };
  excluded_clients: Array<{ name: string; reason: string }>;
  summary_metrics: MetricCard[];
  executive_summary: Array<{ title: string; body: string }>;
  priorities: string[];
  quality_note: string;
  clients: PortfolioClientReport[];
  lists: {
    products: Array<Record<string, unknown>>;
    orders: Array<Record<string, unknown>>;
    registrations: Array<Record<string, unknown>>;
  };
}

interface PortfolioClientReport {
  name: string;
  type: "B2B" | "B2C";
  status: string;
  period_note: string;
  metric_values: Record<string, number>;
  metrics: MetricCard[];
  diagnosis: string;
  details: Array<{ label: string; value: string }>;
  actions: string[];
  caveat: string;
  caveats: string[];
  lists: {
    products: Array<Record<string, unknown>>;
    orders: Array<Record<string, unknown>>;
    registrations: Array<Record<string, unknown>>;
  };
}

type AggregateRow = {
  requested_revenue: string | number | null;
  fulfilled_revenue: string | number | null;
  orders: string | number | null;
  requested_items: string | number | null;
  fulfilled_items: string | number | null;
  buyers: string | number | null;
};

type RegistrationRow = {
  registrations: string | number | null;
  approved: string | number | null;
  pending: string | number | null;
  rejected: string | number | null;
};

type EventRow = {
  visits: string | number | null;
  product_views: string | number | null;
  add_to_cart: string | number | null;
  purchases: string | number | null;
};

type StockRow = {
  products: string | number | null;
  active_products: string | number | null;
  low_stock: string | number | null;
  out_of_stock: string | number | null;
  inventory_value: string | number | null;
};

type ProductReportRow = {
  id: string;
  external_id: string | null;
  sku: string;
  name: string;
  category: string | null;
  image_url: string | null;
  stock: number;
  restock_threshold: number;
  status: string;
  units: string | number | null;
  fulfilled_units: string | number | null;
  revenue: string | number | null;
};

type ProductViewRow = {
  product_id: string | null;
  views: string | number | null;
};

type OrderReportRow = {
  id: string;
  external_id: string | null;
  created_at: Date;
  status: string;
  requested_value: number;
  fulfilled_value: number;
  requested_items: number;
  fulfilled_items: number;
  source: string | null;
  medium: string | null;
  campaign: string | null;
};

type RegistrationReportRow = {
  id: string;
  created_at: Date;
  status: string;
  type: string | null;
  source: string | null;
  medium: string | null;
  campaign: string | null;
};

type UtmRow = {
  source: string;
  registrations: string | number | null;
  approved: string | number | null;
  orders: string | number | null;
  revenue: string | number | null;
};

function numeric(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function currency(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function integer(value: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(value);
}

function percent(value: number): string {
  return `${value.toFixed(1).replace(".", ",")}%`;
}

function dateBounds(dateFrom: string, dateTo: string): { from: Date; to: Date } {
  return {
    from: new Date(`${dateFrom}T03:00:00.000Z`),
    to: new Date(`${addDays(dateTo, 1)}T02:59:59.999Z`),
  };
}

function addDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function formatPeriod(dateFrom: string, dateTo: string): string {
  const formatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const from = new Date(`${dateFrom}T12:00:00.000Z`);
  const to = new Date(`${dateTo}T12:00:00.000Z`);
  return dateFrom === dateTo
    ? formatter.format(from)
    : `${formatter.format(from)} a ${formatter.format(to)}`;
}

function maskIdentifier(value: string | null | undefined): string {
  const normalized = value?.trim() || "registro";
  return `***${normalized.slice(-4).padStart(4, "*")}`;
}

function normalizedSource(value: string | null): string {
  const source = value?.trim();
  return source || "direct";
}

function isInternalClient(name: string): boolean {
  const normalized = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  return (
    normalized === "grupo up" ||
    normalized === "up test" ||
    normalized.includes("agencia up teste") ||
    /(^|\s)test(e)?($|\s)/.test(normalized)
  );
}

function overlapFraction(
  row: { activeFrom: string | null; activeTo: string | null },
  dateFrom: string,
  dateTo: string,
): number {
  const campaignFrom = row.activeFrom ?? dateFrom;
  const campaignTo = row.activeTo ?? dateTo;
  const totalStart = new Date(`${campaignFrom}T12:00:00.000Z`).getTime();
  const totalEnd = new Date(`${campaignTo}T12:00:00.000Z`).getTime();
  const rangeStart = new Date(`${dateFrom}T12:00:00.000Z`).getTime();
  const rangeEnd = new Date(`${dateTo}T12:00:00.000Z`).getTime();
  const overlapStart = Math.max(totalStart, rangeStart);
  const overlapEnd = Math.min(totalEnd, rangeEnd);
  if (overlapEnd < overlapStart) return 0;
  const totalDays = Math.max(1, Math.round((totalEnd - totalStart) / 86_400_000) + 1);
  const overlapDays = Math.round((overlapEnd - overlapStart) / 86_400_000) + 1;
  return Math.min(1, overlapDays / totalDays);
}

function metaAccessToken(clientToken: string | null): string | null {
  return (
    process.env.META_ADS_API_KEY ??
    process.env.META_ACCESS_TOKEN ??
    process.env.META_API_KEY ??
    process.env.META_TOKEN ??
    clientToken ??
    null
  );
}

function productGroupId(row: ProductReportRow): string {
  const external = row.external_id?.trim();
  return external?.split(":")[0] || row.id;
}

function productBaseName(name: string): string {
  const tuple = name.trim().match(/^(.*?)\s*\([^(),]+,\s*[^()]+\)\s*$/);
  if (tuple?.[1]) return tuple[1].trim();
  const separator = name.lastIndexOf(" - ");
  return separator > 0 ? name.slice(0, separator).trim() : name.trim();
}

function buildTopProducts(
  rows: ProductReportRow[],
  isB2C: boolean,
  viewsByProductId: ReadonlyMap<string, number>,
) {
  const groups = new Map<string, ProductReportRow[]>();
  for (const row of rows) {
    const key = isB2C ? productGroupId(row) : row.id;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()]
    .map(([groupId, variants]) => {
      const first = variants[0];
      const units = variants.reduce((sum, row) => sum + numeric(row.units), 0);
      const productViews = variants.reduce(
        (sum, row) => sum + (viewsByProductId.get(row.id) ?? 0),
        0,
      );
      const stock = variants.reduce((sum, row) => sum + numeric(row.stock), 0);
      const restockThreshold = variants.reduce(
        (sum, row) => sum + numeric(row.restock_threshold),
        0,
      );
      return {
        product_key: maskIdentifier(groupId),
        name: isB2C ? productBaseName(first.name) : first.name,
        sku: variants.length > 1 ? `${variants.length} SKUs` : first.sku,
        category: first.category,
        image_url: first.image_url,
        units,
        fulfilled_units: variants.reduce((sum, row) => sum + numeric(row.fulfilled_units), 0),
        revenue: variants.reduce((sum, row) => sum + numeric(row.revenue), 0),
        product_views: productViews,
        conversion_pct: productViews > 0 ? (units / productViews) * 100 : 0,
        stock,
        status: variants.every((row) => row.status === "ACTIVE") ? "ACTIVE" : "MIXED",
        grade_status: variants.every((row) => numeric(row.stock) > 0) ? "complete" : "broken",
        variant_count: variants.length,
        available_variants: variants.filter((row) => numeric(row.stock) > 0).length,
        level: stock <= 0
          ? "Out of Stock"
          : stock <= restockThreshold
            ? "Low Stock"
            : units > 0
              ? "Selling"
              : "No Sales",
      };
    })
    .sort((a, b) => b.revenue - a.revenue || b.units - a.units)
    .slice(0, 10)
    .map((row, index) => ({ rank: index + 1, ...row }));
}

async function readExternalProductViews(params: {
  apiKey: string | null;
  from: Date;
  to: Date;
  products: ProductReportRow[];
}): Promise<Map<string, number>> {
  if (!params.apiKey) return new Map();
  let rows: UpzeroAnalyticsMetric[];
  try {
    rows = await getUpzeroAnalyticsFactsAsMetrics({
      from: params.from.toISOString(),
      to: params.to.toISOString(),
      apiKey: params.apiKey,
    });
  } catch {
    try {
      rows = (
        await getUpzeroAnalyticsMetrics({
          from: params.from.toISOString(),
          to: params.to.toISOString(),
          apiKey: params.apiKey,
        })
      ).data;
    } catch {
      return new Map();
    }
  }

  const byExternalId = new Map(
    params.products
      .filter((product) => product.external_id)
      .map((product) => [product.external_id as string, product.id]),
  );
  const bySku = new Map(params.products.map((product) => [product.sku, product.id]));
  const views = new Map<string, number>();
  for (const row of rows) {
    if (!row.product || !["product_view", "product_item_impression"].includes(row.event_name)) continue;
    const productId = byExternalId.get(String(row.product.id)) ?? bySku.get(row.product.sku);
    if (!productId) continue;
    views.set(productId, (views.get(productId) ?? 0) + numeric(row.total_events));
  }
  return views;
}

async function readMarketingSpend(params: {
  clientId: string;
  clientToken: string | null;
  adAccountId: string | null;
  dateFrom: string;
  dateTo: string;
}): Promise<{ spend: number; source: string; caveat: string | null }> {
  const token = metaAccessToken(params.clientToken);
  if (token && params.adAccountId) {
    try {
      const data = await fetchMetaMarketingData({
        accessToken: token,
        adAccountId: params.adAccountId,
        since: params.dateFrom,
        until: params.dateTo,
      });
      return { spend: data.summary.spend, source: "Meta Ads API", caveat: null };
    } catch {
      // Fall through to the persisted creative snapshot without leaking credentials.
    }
  }

  const rows = await db
    .select({ spend: creativesTable.spend, activeFrom: creativesTable.activeFrom, activeTo: creativesTable.activeTo })
    .from(creativesTable)
    .where(eq(creativesTable.clientId, params.clientId));
  const spend = rows.reduce(
    (sum, row) => sum + numeric(row.spend) * overlapFraction(row, params.dateFrom, params.dateTo),
    0,
  );
  return {
    spend,
    source: "snapshot local de mídia",
    caveat: spend > 0 ? "Investimento estimado por sobreposição do período da campanha." : "Investimento indisponível para o período.",
  };
}

async function buildClientReport(
  client: {
    id: string;
    name: string;
    dashboardType: "B2B" | "B2C";
    isActive: boolean;
    metaAdsApiKey: string | null;
    metaAdAccountId: string | null;
    upZeroApiKey: string | null;
  },
  params: PortfolioReportParams,
): Promise<PortfolioClientReport> {
  const { from, to } = dateBounds(params.dateFrom, params.dateTo);
  const orderWhere = and(
    eq(ordersTable.clientId, client.id),
    gte(ordersTable.createdAt, from),
    lte(ordersTable.createdAt, to),
  );
  const customerWhere = and(
    eq(customersTable.clientId, client.id),
    gte(customersTable.createdAt, from),
    lte(customersTable.createdAt, to),
  );
  const eventWhere = and(
    eq(eventsTable.clientId, client.id),
    gte(eventsTable.createdAt, from),
    lte(eventsTable.createdAt, to),
  );

  const [
    orderAggregateRaw,
    registrationAggregateRaw,
    eventAggregateRaw,
    stockAggregateRaw,
    productRowsRaw,
    productViewRows,
    orderRows,
    registrationRows,
    utmRowsRaw,
    marketing,
  ] = await Promise.all([
    db.execute<AggregateRow>(sql`
      SELECT
        COALESCE(SUM(${ordersTable.amount}), 0)::float AS requested_revenue,
        COALESCE(SUM(${ordersTable.fulfilledAmount}), 0)::float AS fulfilled_revenue,
        COUNT(*)::int AS orders,
        COALESCE(SUM(${ordersTable.requestedQuantity}), 0)::int AS requested_items,
        COALESCE(SUM(${ordersTable.fulfilledQuantity}), 0)::int AS fulfilled_items,
        COUNT(DISTINCT ${ordersTable.customerId})::int AS buyers
      FROM ${ordersTable}
      WHERE ${orderWhere}
    `),
    db.execute<RegistrationRow>(sql`
      SELECT
        COUNT(*)::int AS registrations,
        COUNT(*) FILTER (WHERE ${customersTable.registrationStatus} = 'APPROVED')::int AS approved,
        COUNT(*) FILTER (WHERE ${customersTable.registrationStatus} = 'PENDING')::int AS pending,
        COUNT(*) FILTER (WHERE ${customersTable.registrationStatus} = 'REJECTED')::int AS rejected
      FROM ${customersTable}
      WHERE ${customerWhere}
    `),
    db.execute<EventRow>(sql`
      SELECT
        COUNT(*) FILTER (WHERE ${eventsTable.eventType} = 'VISIT')::int AS visits,
        COUNT(*) FILTER (WHERE ${eventsTable.eventType} = 'PRODUCT_VIEW')::int AS product_views,
        COUNT(*) FILTER (WHERE ${eventsTable.eventType} = 'ADD_TO_CART')::int AS add_to_cart,
        COUNT(*) FILTER (WHERE ${eventsTable.eventType} = 'PURCHASE')::int AS purchases
      FROM ${eventsTable}
      WHERE ${eventWhere}
    `),
    db.execute<StockRow>(sql`
      SELECT
        COUNT(*)::int AS products,
        COUNT(*) FILTER (WHERE ${productsTable.status} = 'ACTIVE')::int AS active_products,
        COUNT(*) FILTER (WHERE ${productsTable.stock} > 0 AND ${productsTable.stock} <= ${productsTable.restockThreshold})::int AS low_stock,
        COUNT(*) FILTER (WHERE ${productsTable.stock} <= 0)::int AS out_of_stock,
        COALESCE(SUM(${productsTable.stock} * ${productsTable.price}), 0)::float AS inventory_value
      FROM ${productsTable}
      WHERE ${productsTable.clientId} = ${client.id}
    `),
    db.execute<ProductReportRow>(sql`
      SELECT
        ${productsTable.id} AS id,
        ${productsTable.externalId} AS external_id,
        ${productsTable.sku} AS sku,
        ${productsTable.name} AS name,
        ${productsTable.category} AS category,
        ${productsTable.imageUrl} AS image_url,
        ${productsTable.stock} AS stock,
        ${productsTable.restockThreshold} AS restock_threshold,
        ${productsTable.status} AS status,
        COALESCE(SUM(${orderItemsTable.quantity}), 0)::int AS units,
        COALESCE(SUM(${orderItemsTable.fulfilledQuantity}), 0)::int AS fulfilled_units,
        COALESCE(SUM(${orderItemsTable.quantity} * ${orderItemsTable.priceAtSale}), 0)::float AS revenue
      FROM ${orderItemsTable}
      INNER JOIN ${ordersTable} ON ${orderItemsTable.orderId} = ${ordersTable.id}
      INNER JOIN ${productsTable} ON ${orderItemsTable.productId} = ${productsTable.id}
      WHERE ${orderWhere}
      GROUP BY ${productsTable.id}
      ORDER BY revenue DESC
    `),
    db
      .select({
        product_id: eventsTable.productId,
        views: sql<number>`COUNT(*)::int`,
      })
      .from(eventsTable)
      .where(and(eventWhere, eq(eventsTable.eventType, "PRODUCT_VIEW")))
      .groupBy(eventsTable.productId),
    db
      .select({
        id: ordersTable.id,
        external_id: ordersTable.externalId,
        created_at: ordersTable.createdAt,
        status: ordersTable.status,
        requested_value: ordersTable.amount,
        fulfilled_value: ordersTable.fulfilledAmount,
        requested_items: ordersTable.requestedQuantity,
        fulfilled_items: ordersTable.fulfilledQuantity,
        source: customersTable.utmSource,
        medium: customersTable.utmMedium,
        campaign: customersTable.utmCampaign,
      })
      .from(ordersTable)
      .leftJoin(customersTable, eq(ordersTable.customerId, customersTable.id))
      .where(orderWhere)
      .orderBy(desc(ordersTable.createdAt))
      .limit(8),
    db
      .select({
        id: customersTable.id,
        created_at: customersTable.createdAt,
        status: customersTable.registrationStatus,
        type: customersTable.documentType,
        source: customersTable.utmSource,
        medium: customersTable.utmMedium,
        campaign: customersTable.utmCampaign,
      })
      .from(customersTable)
      .where(customerWhere)
      .orderBy(desc(customersTable.createdAt))
      .limit(8),
    db.execute<UtmRow>(sql`
      SELECT
        COALESCE(NULLIF(TRIM(${customersTable.utmSource}), ''), 'direct') AS source,
        COUNT(DISTINCT ${customersTable.id})::int AS registrations,
        COUNT(DISTINCT ${customersTable.id}) FILTER (WHERE ${customersTable.registrationStatus} = 'APPROVED')::int AS approved,
        COUNT(DISTINCT ${ordersTable.id})::int AS orders,
        COALESCE(SUM(${ordersTable.amount}), 0)::float AS revenue
      FROM ${customersTable}
      LEFT JOIN ${ordersTable}
        ON ${ordersTable.customerId} = ${customersTable.id}
        AND ${ordersTable.createdAt} >= ${from}
        AND ${ordersTable.createdAt} <= ${to}
      WHERE ${customersTable.clientId} = ${client.id}
        AND (
          (${customersTable.createdAt} >= ${from} AND ${customersTable.createdAt} <= ${to})
          OR ${ordersTable.id} IS NOT NULL
        )
      GROUP BY source
      ORDER BY revenue DESC, registrations DESC
      LIMIT 10
    `),
    readMarketingSpend({
      clientId: client.id,
      clientToken: client.metaAdsApiKey,
      adAccountId: client.metaAdAccountId,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
    }),
  ]);

  const orderAggregate = ((orderAggregateRaw.rows ?? orderAggregateRaw) as unknown as AggregateRow[])[0];
  const registrationAggregate = ((registrationAggregateRaw.rows ?? registrationAggregateRaw) as unknown as RegistrationRow[])[0];
  const eventAggregate = ((eventAggregateRaw.rows ?? eventAggregateRaw) as unknown as EventRow[])[0];
  const stockAggregate = ((stockAggregateRaw.rows ?? stockAggregateRaw) as unknown as StockRow[])[0];
  const productRows = (productRowsRaw.rows ?? productRowsRaw) as unknown as ProductReportRow[];
  const viewsByProductId = new Map(
    (productViewRows as ProductViewRow[])
      .filter((row): row is ProductViewRow & { product_id: string } => Boolean(row.product_id))
      .map((row) => [row.product_id, numeric(row.views)]),
  );
  const externalProductViews = await readExternalProductViews({
    apiKey: client.upZeroApiKey,
    from,
    to,
    products: productRows,
  });
  for (const [productId, views] of externalProductViews) {
    viewsByProductId.set(productId, (viewsByProductId.get(productId) ?? 0) + views);
  }
  const utmRows = (utmRowsRaw.rows ?? utmRowsRaw) as unknown as UtmRow[];

  const requestedRevenue = numeric(orderAggregate?.requested_revenue);
  const fulfilledRevenue = numeric(orderAggregate?.fulfilled_revenue);
  const orders = numeric(orderAggregate?.orders);
  const registrations = numeric(registrationAggregate?.registrations);
  const approved = numeric(registrationAggregate?.approved);
  const approvalRate = registrations > 0 ? (approved / registrations) * 100 : 0;
  const roas = marketing.spend > 0 ? requestedRevenue / marketing.spend : 0;
  const fulfilledRate = requestedRevenue > 0 ? (fulfilledRevenue / requestedRevenue) * 100 : 0;
  const topProducts = buildTopProducts(
    productRows,
    client.dashboardType === "B2C",
    viewsByProductId,
  );
  const safeOrders = (orderRows as OrderReportRow[]).map((row) => ({
    masked_id: maskIdentifier(row.external_id ?? row.id),
    date: row.created_at.toISOString(),
    status: row.status,
    requested_value: numeric(row.requested_value),
    fulfilled_value: numeric(row.fulfilled_value),
    requested_items: numeric(row.requested_items),
    fulfilled_items: numeric(row.fulfilled_items),
    origin: normalizedSource(row.source),
    medium: row.medium?.trim() || "none",
    campaign: row.campaign?.trim() || "sem campanha",
  }));
  const safeRegistrations = (registrationRows as RegistrationReportRow[]).map((row) => ({
    masked_id: maskIdentifier(row.id),
    date: row.created_at.toISOString(),
    status: row.status,
    customer_type: row.type ?? "não informado",
    origin: normalizedSource(row.source),
    medium: row.medium?.trim() || "none",
    campaign: row.campaign?.trim() || "sem campanha",
  }));
  const utm = utmRows.map((row) => ({
    source: normalizedSource(row.source),
    registrations: numeric(row.registrations),
    approved: numeric(row.approved),
    orders: numeric(row.orders),
    revenue: numeric(row.revenue),
  }));

  const hasActivity = orders > 0 || registrations > 0 || numeric(eventAggregate?.visits) > 0;
  const status = !client.isActive
    ? "Inativo"
    : orders > 0
      ? "Ativo com vendas"
      : hasActivity
        ? "Ativo sem vendas"
        : "Sem atividade";
  const diagnosis = orders > 0
    ? `${integer(orders)} pedido(s) e ${currency(requestedRevenue)} solicitados no período; atendimento em ${percent(fulfilledRate)}.`
    : registrations > 0
      ? `${integer(registrations)} cadastro(s), mas nenhuma compra no período. Priorizar ativação e contato comercial.`
      : "Nenhuma atividade comercial identificada na janela selecionada.";
  const caveats = [marketing.caveat].filter((item): item is string => Boolean(item));

  const metricValues = {
    requested_revenue: requestedRevenue,
    fulfilled_revenue: fulfilledRevenue,
    orders,
    buyers: numeric(orderAggregate?.buyers),
    requested_items: numeric(orderAggregate?.requested_items),
    fulfilled_items: numeric(orderAggregate?.fulfilled_items),
    registrations,
    approved_registrations: approved,
    pending_registrations: numeric(registrationAggregate?.pending),
    rejected_registrations: numeric(registrationAggregate?.rejected),
    approval_rate_pct: approvalRate,
    visits: numeric(eventAggregate?.visits),
    product_views: numeric(eventAggregate?.product_views),
    add_to_cart: numeric(eventAggregate?.add_to_cart),
    purchases: numeric(eventAggregate?.purchases),
    marketing_spend: marketing.spend,
    roas,
    products: numeric(stockAggregate?.products),
    active_products: numeric(stockAggregate?.active_products),
    low_stock: numeric(stockAggregate?.low_stock),
    out_of_stock: numeric(stockAggregate?.out_of_stock),
    inventory_value: numeric(stockAggregate?.inventory_value),
  };

  return {
    name: client.name,
    type: client.dashboardType,
    status,
    period_note: formatPeriod(params.dateFrom, params.dateTo),
    metric_values: metricValues,
    metrics: [
      { label: "Faturamento solicitado", value: currency(requestedRevenue), delta: "Período selecionado" },
      { label: "Faturamento atendido", value: currency(fulfilledRevenue), delta: `${percent(fulfilledRate)} do solicitado` },
      { label: "Pedidos", value: integer(orders), delta: `${integer(numeric(orderAggregate?.buyers))} comprador(es)` },
      { label: "Cadastros", value: integer(registrations), delta: `${integer(approved)} aprovado(s)` },
      { label: "Investimento", value: currency(marketing.spend), delta: marketing.source },
      { label: "ROAS", value: `${roas.toFixed(2)}x`, delta: "Solicitado / investimento" },
      { label: "Itens solicitados", value: integer(numeric(orderAggregate?.requested_items)), delta: `${integer(numeric(orderAggregate?.fulfilled_items))} atendido(s)` },
      { label: "Estoque crítico", value: integer(numeric(stockAggregate?.low_stock) + numeric(stockAggregate?.out_of_stock)), delta: "SKUs baixos ou zerados" },
    ],
    diagnosis,
    details: [
      { label: "Aprovação", value: `${integer(approved)} de ${integer(registrations)} (${percent(approvalRate)})` },
      { label: "Funil", value: `${integer(numeric(eventAggregate?.visits))} visitas · ${integer(numeric(eventAggregate?.product_views))} views · ${integer(numeric(eventAggregate?.add_to_cart))} carrinhos` },
      { label: "Estoque", value: `${integer(numeric(stockAggregate?.active_products))} ativos · ${integer(numeric(stockAggregate?.out_of_stock))} zerados` },
      { label: "Origem líder", value: utm[0] ? `${utm[0].source} · ${currency(utm[0].revenue)}` : "N/D" },
    ],
    actions: orders > 0
      ? ["Acompanhar atendimento dos pedidos do período.", "Revisar os produtos líderes e riscos de estoque."]
      : ["Ativar os cadastros do período por WhatsApp.", "Revisar origem, oferta e navegação até o primeiro pedido."],
    caveat: caveats.join(" "),
    caveats,
    lists: { products: topProducts, orders: safeOrders, registrations: safeRegistrations },
  };
}

const FORBIDDEN_PII_KEYS = new Set([
  "customerid",
  "customername",
  "customeremail",
  "customerphone",
  "externalcustomerid",
  "userid",
  "email",
  "phone",
  "cpf",
  "cnpj",
  "document",
  "documenthash",
  "documentlast4",
  "address",
  "street",
  "zipcode",
]);

export function findPortfolioPiiPaths(value: unknown, path = "root"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findPortfolioPiiPaths(item, `${path}[${index}]`));
  }
  if (!value || typeof value !== "object") return [];
  const issues: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (FORBIDDEN_PII_KEYS.has(normalizedKey)) issues.push(`${path}.${key}`);
    issues.push(...findPortfolioPiiPaths(child, `${path}.${key}`));
  }
  return issues;
}

export function assertPortfolioReportHasNoPii(report: unknown): void {
  const paths = findPortfolioPiiPaths(report);
  if (paths.length > 0) {
    throw new Error(`Portfolio report contains forbidden PII fields: ${paths.join(", ")}`);
  }
}

export async function buildPortfolioReport(params: PortfolioReportParams): Promise<PortfolioReport> {
  const allClients = await db
    .select({
      id: clientsTable.id,
      name: clientsTable.name,
      dashboardType: clientsTable.dashboardType,
      isActive: clientsTable.isActive,
      metaAdsApiKey: clientsTable.metaAdsApiKey,
      metaAdAccountId: clientsTable.metaAdAccountId,
      upZeroApiKey: clientsTable.upZeroApiKey,
    })
    .from(clientsTable)
    .orderBy(clientsTable.dashboardType, clientsTable.name);

  const excluded = allClients.filter((client) => isInternalClient(client.name));
  const included = allClients.filter((client) => !isInternalClient(client.name));
  const clients: PortfolioClientReport[] = [];
  for (let index = 0; index < included.length; index += 3) {
    const batch = included.slice(index, index + 3);
    clients.push(...(await Promise.all(batch.map((client) => buildClientReport(client, params)))));
  }

  const totals = clients.reduce(
    (acc, client) => ({
      revenue: acc.revenue + client.metric_values.requested_revenue,
      fulfilled: acc.fulfilled + client.metric_values.fulfilled_revenue,
      orders: acc.orders + client.metric_values.orders,
      registrations: acc.registrations + client.metric_values.registrations,
      approved: acc.approved + client.metric_values.approved_registrations,
      spend: acc.spend + client.metric_values.marketing_spend,
    }),
    { revenue: 0, fulfilled: 0, orders: 0, registrations: 0, approved: 0, spend: 0 },
  );
  const generatedAt = new Date().toISOString();
  const periodLabel = formatPeriod(params.dateFrom, params.dateTo);
  const report: PortfolioReport = {
    meta: {
      title: "Relatório de performance da carteira",
      timezone: TIMEZONE,
      period_start: params.dateFrom,
      period_end: params.dateTo,
      period_label: periodLabel,
      period: periodLabel,
      generated_at: generatedAt,
      source: "UP Dash · banco operacional e integrações oficiais",
      read_only: true,
    },
    excluded_clients: excluded.map((client) => ({ name: client.name, reason: "conta interna/teste" })),
    summary_metrics: [
      { label: "Faturamento solicitado", value: currency(totals.revenue), delta: `${integer(clients.length)} marcas` },
      { label: "Faturamento atendido", value: currency(totals.fulfilled), delta: totals.revenue > 0 ? percent((totals.fulfilled / totals.revenue) * 100) : "0,0%" },
      { label: "Pedidos", value: integer(totals.orders), delta: "Carteira consolidada" },
      { label: "Cadastros", value: integer(totals.registrations), delta: `${integer(totals.approved)} aprovado(s)` },
      { label: "Investimento", value: currency(totals.spend), delta: "Meta/API ou snapshot local" },
      { label: "ROAS", value: `${(totals.spend > 0 ? totals.revenue / totals.spend : 0).toFixed(2)}x`, delta: "Solicitado / investimento" },
    ],
    executive_summary: [
      { title: "Carteira", body: `${integer(clients.length)} marcas produtivas analisadas entre ${periodLabel}.` },
      { title: "Comercial", body: `${integer(totals.orders)} pedidos somaram ${currency(totals.revenue)} em valor solicitado.` },
      { title: "Captação", body: `${integer(totals.registrations)} cadastros no período, com ${integer(totals.approved)} aprovações.` },
    ],
    priorities: clients
      .filter((client) => client.metric_values.orders === 0 && client.metric_values.registrations > 0)
      .slice(0, 5)
      .map((client) => `${client.name}: ativar cadastros aprovados que ainda não compraram.`),
    quality_note: "Relatório gerado por endpoint somente leitura. Identificadores transacionais são mascarados e dados pessoais não são exportados.",
    clients,
    lists: {
      products: clients.flatMap((client) => client.lists.products.map((row) => ({ client: client.name, ...row }))),
      orders: clients.flatMap((client) => client.lists.orders.map((row) => ({ client: client.name, ...row }))),
      registrations: clients.flatMap((client) => client.lists.registrations.map((row) => ({ client: client.name, ...row }))),
    },
  };
  if (report.priorities.length === 0) {
    report.priorities.push("Manter a rotina de acompanhamento diário e validar as maiores variações por marca.");
  }
  assertPortfolioReportHasNoPii(report);
  return report;
}
