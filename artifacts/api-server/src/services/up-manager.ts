import { and, eq, gte, lte, sql } from "drizzle-orm";
import {
  customersTable,
  db,
  orderItemsTable,
  ordersTable,
  productsTable,
} from "@workspace/db";
import {
  addDaysToDateOnly,
  saoPauloDateOnlyEnd,
  saoPauloDateOnlyStart,
} from "../lib/reporting-period";
import {
  localized,
  safeUrl,
  variantStock,
  type CatalogCategory,
  type CatalogProduct,
} from "./product-campaign-analysis";
import { readBraavoManagerCatalog } from "./up-manager-braavo";
import { fetchCampaignCatalog } from "./product-campaign-sources";
import { campaignClient } from "./product-campaign-monitor";
import { fetchMetaMarketingData } from "./meta-ads";
import { paidOrderStatus, paidRevenueColumn } from "./metric-rules";

export type ManagerPeriod = { dateFrom: string; dateTo: string };
export type ManagerClient = NonNullable<
  Awaited<ReturnType<typeof campaignClient>>
>;

export function managerCommerceSupported(client: ManagerClient | undefined): client is ManagerClient {
  return Boolean(client?.isActive && !client.archivedAt && client.dashboardType === "B2C" &&
    (client.commercePlatform === "NUVEMSHOP" || client.commercePlatform === "BRAAVO"));
}

export function managerMetaToken(client: ManagerClient) {
  return (
    process.env.META_ADS_API_KEY ||
    process.env.META_ACCESS_TOKEN ||
    process.env.META_API_KEY ||
    process.env.META_TOKEN ||
    client.metaToken
  )?.trim();
}

export function priorPeriod(period: ManagerPeriod): ManagerPeriod {
  const days =
    Math.round(
      (Date.parse(period.dateTo) - Date.parse(period.dateFrom)) / 86_400_000,
    ) + 1;
  return {
    dateFrom: addDaysToDateOnly(period.dateFrom, -days),
    dateTo: addDaysToDateOnly(period.dateFrom, -1),
  };
}

async function commerceSummary(clientId: string, period: ManagerPeriod) {
  const from = saoPauloDateOnlyStart(period.dateFrom);
  const to = saoPauloDateOnlyEnd(period.dateTo);
  const currentOrders = db.$with("manager_period_orders").as(
    db
      .select({
        customerId: ordersTable.customerId,
        revenue: paidRevenueColumn(true).as("revenue"),
      })
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.clientId, clientId),
          paidOrderStatus(),
          gte(ordersTable.createdAt, from),
          lte(ordersTable.createdAt, to),
        ),
      ),
  );
  const currentBuyers = db
    .$with("manager_period_buyers")
    .as(
      db
        .selectDistinct({ customerId: currentOrders.customerId })
        .from(currentOrders),
    );
  const [row] = await db
    .with(currentOrders, currentBuyers)
    .select({
      revenue: sql<number>`(SELECT COALESCE(SUM(revenue), 0)::float FROM manager_period_orders)`,
      orders: sql<number>`(SELECT COUNT(*)::int FROM manager_period_orders)`,
      buyers: sql<number>`COUNT(*)::int`,
      returningBuyers: sql<number>`COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM ${ordersTable}
      WHERE ${ordersTable.clientId} = ${clientId}
        AND ${ordersTable.customerId} = ${currentBuyers.customerId}
        AND ${ordersTable.createdAt} < ${from} AND ${paidOrderStatus()}
    ))::int`,
    })
    .from(currentBuyers)
    .innerJoin(
      customersTable,
      and(
        eq(customersTable.id, currentBuyers.customerId),
        eq(customersTable.clientId, clientId),
      ),
    );
  return row;
}

export function readMedia(
  client: ManagerClient,
  period: ManagerPeriod,
  summaryOnly = false,
  includeReach = false,
  refresh = false,
) {
  const accessToken = managerMetaToken(client);
  if (!accessToken || !client.accountId) return Promise.resolve(null);
  return fetchMetaMarketingData({
    accessToken,
    adAccountId: client.accountId,
    since: period.dateFrom,
    until: period.dateTo,
    isB2C: true,
    summaryOnly,
    includeReach,
    refresh,
  }).catch(() => null);
}

function ratio(numerator: number | null, denominator: number) {
  return numerator !== null && denominator > 0 ? numerator / denominator : null;
}

function managerMetrics(
  commerce: Awaited<ReturnType<typeof commerceSummary>>,
  media: Awaited<ReturnType<typeof readMedia>>,
) {
  const spend = media?.summary.spend ?? null;
  const newBuyers = commerce.buyers - commerce.returningBuyers;
  return {
    approvedRevenue: commerce.revenue,
    orders: commerce.orders,
    averageOrder: ratio(commerce.revenue, commerce.orders),
    costPerPurchase: ratio(spend, commerce.orders),
    spend,
    roas: media?.summary.roas ?? null,
    cac: ratio(spend, newBuyers),
    returningBuyers: commerce.returningBuyers,
    newBuyers,
    repeatRate: ratio(commerce.returningBuyers * 100, commerce.buyers),
    mer: spend === null ? null : ratio(commerce.revenue, spend),
  };
}

export async function readManagerOverview(
  client: ManagerClient,
  period: ManagerPeriod,
  reportOptions?: { previousPeriod: ManagerPeriod },
) {
  const previousPeriod = reportOptions?.previousPeriod ?? priorPeriod(period);
  const [commerce, previousCommerce, media, previousMedia] = await Promise.all([
    commerceSummary(client.id, period),
    commerceSummary(client.id, previousPeriod),
    readMedia(client, period, false, Boolean(reportOptions)),
    readMedia(client, previousPeriod, !reportOptions, Boolean(reportOptions)),
  ]);
  return {
    period,
    previousPeriod,
    metrics: managerMetrics(commerce, media),
    previous: managerMetrics(previousCommerce, previousMedia),
    campaigns: media
      ? [...media.campaigns].sort((a, b) => b.spend - a.spend)
      : null,
    mediaAvailable: media !== null,
    ...(reportOptions
      ? {
          reportMedia: {
            current: media?.summary ?? null,
            previous: previousMedia?.summary ?? null,
            previousCampaigns: previousMedia?.campaigns ?? null,
            currentData: media,
            previousData: previousMedia,
          },
        }
      : {}),
  };
}

type CatalogRead = Awaited<ReturnType<typeof fetchCampaignCatalog>> & { categories?: CatalogCategory[] };
const catalogCache = new Map<
  string,
  { expiresAt: number; pending: Promise<CatalogRead> }
>();
export function readCatalog(client: ManagerClient): Promise<CatalogRead | null> {
  if (client.commercePlatform === "BRAAVO") return readBraavoManagerCatalog(client.id).catch(() => null);
  if (!client.storeId || !client.storeToken) return Promise.resolve(null);
  const key = `${client.id}:${client.storeId}`;
  const current = catalogCache.get(key);
  if (current && current.expiresAt > Date.now())
    return current.pending.catch(() => null);
  const pending = fetchCampaignCatalog(
    client.storeId,
    client.storeToken,
    AbortSignal.timeout(22_000),
  );
  if (catalogCache.size >= 25)
    catalogCache.delete(catalogCache.keys().next().value!);
  const entry = { expiresAt: Date.now() + 5 * 60_000, pending };
  catalogCache.set(key, entry);
  return pending.catch(() => {
    if (catalogCache.get(key) === entry) catalogCache.delete(key);
    return null;
  });
}

interface VariantSales {
  id: string;
  externalId: string | null;
  name: string;
  sku: string;
  color: string | null;
  size: string | null;
  units: number;
  revenue: number;
}

export async function readVariantSales(
  clientId: string,
  period: ManagerPeriod,
) {
  return db
    .select({
      id: productsTable.id,
      externalId: productsTable.externalId,
      name: sql<string>`MIN(${productsTable.name})`,
      sku: sql<string>`MIN(${productsTable.sku})`,
      color: sql<string | null>`MIN(${orderItemsTable.color})`,
      size: sql<string | null>`MIN(${orderItemsTable.size})`,
      units: sql<number>`SUM(${orderItemsTable.fulfilledQuantity})::int`,
      revenue: sql<number>`SUM(${orderItemsTable.fulfilledQuantity} * ${orderItemsTable.priceAtSale})::float`,
    })
    .from(orderItemsTable)
    .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
    .innerJoin(
      productsTable,
      and(
        eq(orderItemsTable.productId, productsTable.id),
        eq(productsTable.clientId, clientId),
      ),
    )
    .where(
      and(
        eq(ordersTable.clientId, clientId),
        paidOrderStatus(),
        gte(ordersTable.createdAt, saoPauloDateOnlyStart(period.dateFrom)),
        lte(ordersTable.createdAt, saoPauloDateOnlyEnd(period.dateTo)),
        sql`${orderItemsTable.fulfilledQuantity} > 0`,
      ),
    )
    .groupBy(productsTable.id, productsTable.externalId);
}

function normalizeAttribute(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function catalogOption(
  product: CatalogProduct,
  options: string[],
  labels: string[],
) {
  const index =
    product.attributes?.findIndex((attribute) =>
      labels.includes(normalizeAttribute(localized(attribute))),
    ) ?? -1;
  return index >= 0 ? options[index] || null : null;
}

export function catalogVariantLabels(product: CatalogProduct, options: string[]) {
  return {
    size: catalogOption(product, options, ["tamanho", "tamanhos", "size", "sizes", "talla", "talle"]),
    color: catalogOption(product, options, ["cor", "cores", "color", "colors", "colour"]),
  };
}

function managerCatalogProduct(
  id: string,
  sales: VariantSales[],
  product?: CatalogProduct,
) {
  const pendingSales = new Map(
    sales.map((line) => [line.externalId ?? line.id, line]),
  );
  const current =
    product?.variants?.map((variant) => {
      const variantId = String(variant.id);
      const salesKey = `${id}:${variantId}`;
      const sale = pendingSales.get(salesKey);
      pendingSales.delete(salesKey);
      const options = (variant.values ?? []).map(localized);
      return {
        id: variantId,
        sku: variant.sku ?? sale?.sku ?? null,
        options: options.filter(Boolean),
        ...catalogVariantLabels(product, options),
        stock: variantStock(variant),
        units: sale?.units ?? 0,
        current: true,
      };
    }) ?? [];
  const historical = [...pendingSales.values()].map((sale) => ({
    id: `historical:${sale.id}`,
    sku: sale.sku,
    options: [] as string[],
    size: sale.size,
    color: sale.color,
    stock: null,
    units: sale.units,
    current: false,
  }));
  const measured = current.filter((variant) => variant.stock !== null);
  return {
    id,
    name: (product && localized(product.name)) || sales[0].name,
    imageUrl: safeUrl(product?.images?.[0]?.src)?.href ?? null,
    units: sales.reduce((sum, row) => sum + row.units, 0),
    revenue: sales.reduce((sum, row) => sum + row.revenue, 0),
    stock:
      current.length > 0 && measured.length === current.length
        ? measured.reduce((sum, variant) => sum + variant.stock!, 0)
        : null,
    variants: [...current, ...historical],
  };
}

export function rankManagerProducts(
  rows: VariantSales[],
  catalog: CatalogProduct[],
  limit = 20,
) {
  const products = new Map(
    catalog.map((product) => [String(product.id), product]),
  );
  const salesByProduct = new Map<string, VariantSales[]>();
  for (const row of rows) {
    const id =
      row.externalId?.match(/^(braavo:[^:]+):[^:]+$/)?.[1] ?? row.externalId?.match(/^(\d+)(?::\d+)?$/)?.[1] ?? `local:${row.id}`;
    const stock = salesByProduct.get(id) ?? [];
    stock.push(row);
    salesByProduct.set(id, stock);
  }
  return [...salesByProduct]
    .map(([id, sales]) => managerCatalogProduct(id, sales, products.get(id)))
    .sort(
      (a, b) =>
        b.units - a.units ||
        b.revenue - a.revenue ||
        a.name.localeCompare(b.name),
    )
    .slice(0, limit);
}

export async function readManagerProducts(
  client: ManagerClient,
  period: ManagerPeriod,
) {
  const [sales, catalog] = await Promise.all([
    readVariantSales(client.id, period),
    readCatalog(client),
  ]);
  return {
    products: rankManagerProducts(sales, catalog?.products ?? []),
    stockObservedAt: catalog?.observedAt ?? null,
  };
}
