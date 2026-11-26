import { getBlingAnalytics, type BlingQuery } from "./bling-analytics";
import { BlingError } from "./bling-api";

type Product = {
  id: string;
  parentId?: string | null;
  name?: string;
  sku?: string;
  price: number;
  units: number;
  value: number;
  stock?: { available: number; physical: number } | null;
};
type Order = {
  id: string;
  number: string;
  day: string;
  customerId?: string;
  customerName?: string;
  channelName: string;
  statusId?: string;
  total: number;
  items: Array<{
    id: string;
    productId?: string;
    sku?: string;
    name?: string;
    quantity: number;
    unitPrice: number;
  }>;
};
type Buyer = {
  id: string;
  name: string;
  orders: number;
  value: number;
  first_day: string;
  last_day: string;
};
type Summary = {
  orders: number;
  orderValue: number;
  customers: number;
  units: number;
  channels: Array<{ id: string; name: string; orders: number; value: number }>;
  daily: Array<{ day: string; orders: number; value: number }>;
  statuses: Array<{ id: string; orders: number; value: number }>;
  coverage: { from: string | null; to: string | null };
};
export type BlingLayoutQuery = BlingQuery & {
  layout: "dashboard" | "orders" | "customers" | "products";
  limit: number;
  category?: string;
  stockStatus?: string;
  layoutSort?: string;
  layoutBuyerType?: "NEW" | "RETURNING";
};

export function blingDashboardLayout(summary: Summary) {
  const unknown = null;
  return {
    kpis: {
      grossRevenue: unknown,
      netRevenue: unknown,
      discountAmount: unknown,
      orders: summary.orders,
      totalQuantity: summary.units,
      returnedQuantity: unknown,
      uniqueCustomers: summary.customers,
      newCustomers: unknown,
      returningCustomers: unknown,
      retentionPct: unknown,
      cancelledOrders: unknown,
      cancelledAmount: unknown,
      avgTicket: summary.orders ? summary.orderValue / summary.orders : 0,
      returnAmount: unknown,
      avgItemsPerOrder: summary.orders ? summary.units / summary.orders : 0,
      returnRatePct: unknown,
      discountRatePct: unknown,
    },
    revenueOverTime: summary.daily.map((d) => ({ date: d.day, value: d.value })),
    ordersOverTime: summary.daily.map((d) => ({
      date: d.day,
      value: d.orders,
    })),
    newCustomersOverTime: [],
    returningCustomersOverTime: [],
    attribution: {
      attributedCustomers: null,
      unattributedCustomers: null,
      attributedRevenue: null,
      unattributedRevenue: null,
    },
    breakdowns: {
      statuses: summary.statuses.map((s) => ({
        label: `ID ${s.id}`,
        orders: s.orders,
        revenue: null,
      })),
      payments: [],
      sellers: [],
      stores: summary.channels.map((c) => ({
        label: c.name,
        orders: c.orders,
        revenue: c.value,
      })),
      states: [],
    },
    source: {
      provider: "BLING",
      coverage: summary.coverage,
      orderValue: summary.orderValue,
      unavailable: [
        "financialRevenue",
        "payments",
        "returns",
        "costs",
        "lifetime",
        "seller",
        "geography",
        "attribution",
      ],
      statusOptions: summary.statuses
        .filter((s) => s.id)
        .map((s) => ({ value: s.id, label: `ID ${s.id}` })),
    },
  };
}
export function blingOrderLayout(order: Order) {
  return {
    id: order.number || order.id,
    externalId: order.id,
    createdAt: order.day,
    customerId: order.customerId ?? null,
    customerName: order.customerName ?? null,
    company: null,
    document: null,
    seller: null,
    store: order.channelName,
    paymentMethod: null,
    freightAmount: null,
    channel: order.channelName,
    status: order.statusId ? `ID ${order.statusId}` : null,
    requestedQuantity: order.items.reduce((n, i) => n + i.quantity, 0),
    fulfilledQuantity: null,
    returnedQuantity: null,
    grossAmount: null,
    discountAmount: null,
    netAmount: null,
    returnAmount: null,
    state: null,
    city: null,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    attributed: false,
    orderValue: order.total,
    items: order.items.map((i) => ({
      ...i,
      category: null,
      color: null,
      size: null,
      costPrice: null,
      discountAmount: null,
      grossAmount: i.quantity * i.unitPrice,
      netAmount: null,
    })),
  };
}
export function blingBuyerLayout(buyer: Buyer) {
  return {
    id: buyer.id,
    name: buyer.name,
    company: null,
    document: null,
    email: null,
    phone: null,
    city: null,
    state: null,
    seller: null,
    orders: buyer.orders,
    totalSpent: buyer.value,
    averageTicket: buyer.orders ? buyer.value / buyer.orders : 0,
    historicalOrders: null,
    lifetimeValue: null,
    buyerType: null,
    daysSinceLastOrder: null,
    segment: null,
    firstOrderAt: null,
    lastOrderAt: buyer.last_day || null,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    attributed: false,
  };
}
export function blingProductLayout(
  products: Product[],
  query: Pick<
    BlingLayoutQuery,
    "page" | "limit" | "search" | "category" | "stockStatus" | "layoutSort"
  >,
) {
  const catalog = new Map(products.map((p) => [p.id, p]));
  const groups = new Map<string, Product[]>();
  for (const p of products) {
    const key = p.parentId || p.id;
    const rows = groups.get(key) ?? [];
    rows.push(p);
    groups.set(key, rows);
  }
  const allRows = Array.from(groups, ([id, group]) => {
    const parent = catalog.get(id);
    const children = group.filter((p) => p.id !== id);
    // Parent stock often includes its children. Never sum both snapshots.
    const skus = children.length
      ? [...children, ...(parent?.units ? [{ ...parent, stock: null }] : [])]
      : group;
    const variants = skus.map((p) => ({
      id: p.id,
      sku: p.sku || p.id,
      color: null,
      size: null,
      units: p.units,
      revenue: p.value,
      averagePrice: p.units ? p.value / p.units : 0,
      catalogPrice: p.price,
      stock: p.stock?.available ?? null,
      turnoverPct: null,
      salesPower: p.stock ? Math.max(0, p.stock.available) * p.price : null,
      costAmount: null,
      grossProfit: null,
      grossMarginPct: null,
      coverageDays: null,
    }));
    const known = variants.filter((v) => v.stock !== null);
    return {
      id,
      name: parent?.name || group[0]?.name || id,
      category: null,
      units: variants.reduce((n, v) => n + v.units, 0),
      revenue: variants.reduce((n, v) => n + v.revenue, 0),
      averagePrice: 0,
      stock: known.length
        ? known.reduce((n, v) => n + (v.stock ?? 0), 0)
        : null,
      turnoverPct: null,
      salesPower: known.length
        ? known.reduce((n, v) => n + (v.salesPower ?? 0), 0)
        : null,
      costAmount: null,
      grossProfit: null,
      grossMarginPct: null,
      coverageDays: null,
      variantCount: variants.length,
      outOfStockCount: known.filter((v) => v.stock === 0).length,
      variants,
    };
  });
  const search = query.search.toLocaleLowerCase();
  const filtered = allRows.filter(
    (p) =>
      !query.category &&
      (!search ||
        `${p.name} ${p.id} ${p.variants.map((v) => v.sku).join(" ")}`
          .toLocaleLowerCase()
          .includes(search)) &&
      (query.stockStatus === "in_stock"
        ? p.variants.some((v) => v.stock !== null && v.stock > 0)
        : query.stockStatus === "out_of_stock"
          ? p.variants.some((v) => v.stock === 0)
          : query.stockStatus === "negative"
            ? p.variants.some((v) => v.stock !== null && v.stock < 0)
            : true),
  );
  const sort = query.layoutSort;
  filtered.sort((a, b) => {
    const value = (p: typeof a) =>
      sort === "units"
        ? p.units
        : sort === "stock"
          ? p.stock
          : sort === "sales_power"
            ? p.salesPower
            : sort === "revenue"
              ? p.revenue
              : null;
    return (
      (value(b) ?? -Infinity) - (value(a) ?? -Infinity) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id)
    );
  });
  const variants = filtered.flatMap((p) => p.variants),
    known = variants.filter((v) => v.stock !== null);
  return {
    rows: filtered.slice(
      (query.page - 1) * query.limit,
      query.page * query.limit,
    ),
    total: allRows.length,
    filteredTotal: filtered.length,
    totalSkus: variants.length,
    totalRevenue: variants.reduce((n, v) => n + v.revenue, 0),
    totalUnits: variants.reduce((n, v) => n + v.units, 0),
    totalStock: known.length
      ? known.reduce((n, v) => n + (v.stock ?? 0), 0)
      : null,
    outOfStockCount: known.filter((v) => v.stock === 0).length,
    turnoverPct: null,
    salesPower: known.length
      ? known.reduce((n, v) => n + (v.salesPower ?? 0), 0)
      : null,
    totalCost: null,
    grossProfit: null,
    grossMarginPct: null,
    negativeStockCount: known.filter((v) => v.stock !== null && v.stock < 0)
      .length,
    coverageDays: null,
    breakdowns: { categories: [], colors: [], sizes: [] },
  };
}
export async function getBlingErpLayout(query: BlingLayoutQuery) {
  const result = await getBlingAnalytics({
    ...query,
    view: query.layout === "dashboard" ? "overview" : query.layout,
    search: query.layout === "products" ? "" : query.search,
    stock: "all",
    buyerType: "all",
    export: query.layout === "products",
    limit: query.limit,
  });
  const summary = result.summary as Summary;
  const source = blingDashboardLayout(summary).source;
  if (query.layout === "dashboard") return blingDashboardLayout(summary);
  if (query.layout === "products") {
    if (Number(result.total) > 10000)
      throw new BlingError(
        "O catálogo excede a capacidade desta consulta. Refine a integração antes de usar os totais.",
        "BLING_LAYOUT_LIMIT",
        422,
      );
    return { ...blingProductLayout(result.rows as Product[], query), source };
  }
  if (query.layout === "orders")
    return {
      rows: (result.rows as Order[]).map(blingOrderLayout),
      total: result.total,
      source,
    };
  if (query.layoutBuyerType) return { rows: [], total: 0, source }; // Full lifetime classification is unavailable, never inferred from 30 days.
  return {
    rows: (result.rows as Buyer[]).map(blingBuyerLayout),
    total: result.total,
    source,
  };
}
