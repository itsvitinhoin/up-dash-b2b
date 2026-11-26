import { PROVINCE_TO_STATE } from "../lib/brazilian-states";
import { variantAttributesFromValues } from "./variant-attributes";
import { and, eq, sql } from "drizzle-orm";
import {
  customersTable,
  db,
  eventsTable,
  orderItemsTable,
  ordersTable,
  productsTable,
} from "@workspace/db";

const NUVEMSHOP_BASE_URL = "https://api.nuvemshop.com.br/v1";
const DEFAULT_USER_AGENT = "UP Dash (vendas@upagencybrasil.com.br)";

export interface NuvemshopSyncResult {
  customersCreated: number;
  customersUpdated: number;
  ordersCreated: number;
  ordersUpdated: number;
  productsCreated: number;
  productsUpdated: number;
  productsFetched: number;
  productPagesFetched: number;
  productPaginationComplete: boolean;
  catalogComplete: boolean | null;
  ordersFetched: number;
  orderPagesFetched: number;
  orderPaginationComplete: boolean;
  ordersComplete: boolean;
  orderItemsSynced: number;
  eventsSynced: number;
  cancelledOrders: number;
  refundedOrders: number;
  paidOrders: number;
  invoicedRevenue: number;
  paidRevenue: number;
  shippingRevenue: number;
  discounts: number;
  errors: string[];
}

type LocalOrderStatus = "PENDING" | "APPROVED" | "REJECTED" | "SHIPPED" | "DELIVERED";

type NuvemshopCustomer = {
  id?: number | string | null;
  email?: string | null;
  name?: string | null;
  phone?: string | null;
};

type NuvemshopProduct = {
  id?: number | string | null;
  product_id?: number | string | null;
  variant_id?: number | string | null;
  name?: string | Record<string, string> | null;
  sku?: string | null;
  quantity?: number | string | null;
  price?: number | string | null;
  promotional_price?: number | string | null;
  compare_at_price?: number | string | null;
  image?: { src?: string | null } | null;
  categories?: NuvemshopCategory[] | null;
  product?: {
    id?: number | string | null;
    name?: string | Record<string, string> | null;
    images?: Array<{ src?: string | null }> | null;
    categories?: NuvemshopCategory[] | null;
  } | null;
};

type NuvemshopVariant = {
  id?: number | string | null;
  sku?: string | null;
  stock?: number | string | null;
  inventory_quantity?: number | string | null;
  quantity?: number | string | null;
  price?: number | string | null;
  promotional_price?: number | string | null;
  compare_at_price?: number | string | null;
  image?: { src?: string | null } | null;
  image_id?: number | string | null;
  inventory_levels?: Array<{ stock?: number | string | null }> | null;
  values?: Array<{ pt?: string | null; en?: string | null; name?: string | Record<string, string> | null }> | null;
};

type NuvemshopOrder = {
  id: number | string;
  number?: number | string | null;
  status?: string | null;
  payment_status?: string | null;
  shipping_status?: string | null;
  total?: number | string | null;
  total_paid?: number | string | null;
  subtotal?: number | string | null;
  discount?: number | string | null;
  discount_coupon?: number | string | null;
  promotional_discount?: number | string | null;
  shipping_cost_owner?: number | string | null;
  shipping_cost_customer?: number | string | null;
  products?: NuvemshopProduct[] | null;
  customer?: NuvemshopCustomer | null;
  contact_email?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  billing_city?: string | null;
  billing_province?: string | null;
  shipping_address?: {
    city?: string | null;
    province?: string | null;
  } | null;
  created_at?: string | null;
  paid_at?: string | null;
  closed_at?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
};

type NuvemshopCategory = {
  id?: number | string | null;
  name?: string | Record<string, string> | null;
  parent?: number | string | null;
};

type NuvemshopProductDetails = {
  id?: number | string | null;
  name?: string | Record<string, string> | null;
  categories?: NuvemshopCategory[] | null;
  images?: Array<{ id?: number | string | null; src?: string | null; position?: number | string | null }> | null;
  variants?: NuvemshopVariant[] | null;
};

type NuvemshopMoney = {
  value?: string | number | null;
  currency?: string | null;
} | null;

type NuvemshopTransaction = {
  id?: number | string | null;
  status?: string | null;
  refunded_amount?: NuvemshopMoney;
};


function emptyResult(): NuvemshopSyncResult {
  return {
    customersCreated: 0,
    customersUpdated: 0,
    ordersCreated: 0,
    ordersUpdated: 0,
    productsCreated: 0,
    productsUpdated: 0,
    productsFetched: 0,
    productPagesFetched: 0,
    productPaginationComplete: true,
    catalogComplete: null,
    ordersFetched: 0,
    orderPagesFetched: 0,
    orderPaginationComplete: false,
    ordersComplete: false,
    orderItemsSynced: 0,
    eventsSynced: 0,
    cancelledOrders: 0,
    refundedOrders: 0,
    paidOrders: 0,
    invoicedRevenue: 0,
    paidRevenue: 0,
    shippingRevenue: 0,
    discounts: 0,
    errors: [],
  };
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function asDate(value: unknown): Date {
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date;
  }
  return new Date();
}

function localized(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const first = record.pt ?? record.en ?? Object.values(record)[0];
    return typeof first === "string" ? first : "";
  }
  return "";
}

function normalizeState(province?: string | null): string | null {
  const value = (province ?? "").trim();
  if (!value) return null;
  if (/^[A-Z]{2}$/.test(value)) return value;
  return PROVINCE_TO_STATE[value.toLowerCase()] ?? null;
}

const PAID_LIKE_PAYMENT_STATUSES = new Set(["paid", "partially_refunded", "refunded"]);
const REFUNDED_PAYMENT_STATUSES = new Set(["refunded", "partially_refunded"]);

function isPaidLike(order: NuvemshopOrder): boolean {
  return PAID_LIKE_PAYMENT_STATUSES.has(order.payment_status ?? "");
}

function orderStatus(order: NuvemshopOrder, paid: boolean): LocalOrderStatus {
  if (order.status === "cancelled") return "REJECTED";
  if (order.status === "closed" && paid) return "DELIVERED";
  if (order.shipping_status === "shipped") return "SHIPPED";
  if (paid) return "APPROVED";
  return "PENDING";
}

function skuFor(item: NuvemshopProduct): string {
  const sku = (item.sku ?? "").trim();
  if (sku) return sku;
  return `nuvemshop-${item.product_id ?? item.id ?? "item"}`;
}

// Lojas Nuvemshop repetem SKU entre variantes (ou anuncios) diferentes, mas a tabela de produtos tem DUAS chaves unicas: (cliente, external_id) e
// (cliente, sku). Quando o SKU do item ja e de OUTRO produto, o produto novo ganha um SKU proprio derivado do external_id (unico por cliente),
// igual ao Braavo (`ref#braavo-<id>`). Antes o upsert falhava, o item era descartado e o apagamento previo dos itens do pedido o removia de vez
// (Lila Rosa: 47% dos pedidos dos ultimos 7 dias sem nenhum item; 17/11/2026).
export function collisionSku(sku: string, externalId: string): string {
  return `${sku}#nuvemshop-${externalId.replace(/:/g, "-")}`;
}

type KnownProduct = { id: string; sku: string };
type ProductIndex = {
  byExternalId: Map<string, KnownProduct>;
  // SKU -> external_id do produto que o usa (null = produto antigo sem external_id, que tambem conta como "de outro").
  externalIdBySku: Map<string, string | null>;
};

// Uma leitura por cliente e rodada (centenas a poucos milhares de linhas) no lugar de uma tentativa que falha por item.
async function loadProductIndex(clientId: string): Promise<ProductIndex> {
  const rows = await db
    .select({ id: productsTable.id, externalId: productsTable.externalId, sku: productsTable.sku })
    .from(productsTable)
    .where(eq(productsTable.clientId, clientId));
  const index: ProductIndex = { byExternalId: new Map(), externalIdBySku: new Map() };
  for (const row of rows) {
    if (row.externalId) index.byExternalId.set(row.externalId, { id: row.id, sku: row.sku });
    index.externalIdBySku.set(row.sku, row.externalId);
  }
  return index;
}

function isSkuConflict(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 3) return false;
  const e = error as { code?: unknown; constraint?: unknown; message?: unknown; cause?: unknown };
  if (e.code === "23505" && (e.constraint === "products_client_sku_uq" || String(e.message ?? "").includes("products_client_sku_uq"))) return true;
  return isSkuConflict(e.cause, depth + 1);
}

async function upsertNuvemshopProduct(
  clientId: string,
  index: ProductIndex,
  input: {
    externalId: string;
    sku: string;
    name: string;
    category: string | null;
    price: number;
    imageUrl: string | null;
    stock?: number;
    status?: "ACTIVE";
  },
): Promise<{ id: string; wasInserted: boolean } | undefined> {
  const { externalId, sku: sourceSku, ...fields } = input;
  const chooseSku = () => {
    const isTaken = (sku: string) => index.externalIdBySku.has(sku) &&
      index.externalIdBySku.get(sku) !== externalId;
    if (!isTaken(sourceSku)) return sourceSku;
    const own = index.byExternalId.get(externalId);
    if (own) return own.sku;

    const alias = collisionSku(sourceSku, externalId);
    let sku = alias;
    for (let suffix = 2; isTaken(sku); suffix++) sku = `${alias}-${suffix}`;
    return sku;
  };
  const write = async (sku: string) => {
    const [row] = await db
      .insert(productsTable)
      .values({ clientId, externalId, sku, ...fields })
      .onConflictDoUpdate({
        // externalId (product_id:variant_id da Nuvemshop) e o identificador estavel; o sku pode ser reatribuido pelo lojista (ver
        // investigacao 2026-09-17).
        target: [productsTable.clientId, productsTable.externalId],
        set: { sku, ...fields },
      })
      .returning({ id: productsTable.id, wasInserted: sql<boolean>`(xmax = 0)` });
    return row;
  };

  let used = chooseSku();
  let row: { id: string; wasInserted: boolean } | undefined;
  try {
    row = await write(used);
  } catch (error) {
    // Another sync may assign the SKU after we read the index.
    if (!isSkuConflict(error)) throw error;
    Object.assign(index, await loadProductIndex(clientId));
    used = chooseSku();
    row = await write(used);
  }
  if (row) {
    const own = index.byExternalId.get(externalId);
    if (own && own.sku !== used && index.externalIdBySku.get(own.sku) === externalId) index.externalIdBySku.delete(own.sku);
    index.externalIdBySku.set(used, externalId);
    index.byExternalId.set(externalId, { id: row.id, sku: used });
  }
  return row;
}

function skuForVariant(product: NuvemshopProductDetails, variant: NuvemshopVariant): string {
  const sku = (variant.sku ?? "").trim();
  if (sku) return sku;
  return `nuvemshop-${product.id ?? "product"}-${variant.id ?? "variant"}`;
}

function stockForVariant(variant: NuvemshopVariant): number {
  const inventoryLevelsStock = (variant.inventory_levels ?? []).reduce(
    (sum, level) => sum + asNumber(level.stock),
    0,
  );
  if (inventoryLevelsStock > 0) return Math.round(inventoryLevelsStock);
  const stock = asNumber(variant.stock);
  const inventoryQuantity = asNumber(variant.inventory_quantity);
  const quantity = asNumber(variant.quantity);
  if (stock > 0) return Math.round(stock);
  if (inventoryQuantity > 0) return Math.round(inventoryQuantity);
  if (quantity > 0) return Math.round(quantity);
  if (variant.stock === 0 || variant.stock === "0") return 0;
  if (variant.inventory_quantity === 0 || variant.inventory_quantity === "0") return 0;
  if (variant.quantity === 0 || variant.quantity === "0") return 0;
  return 0;
}

function variantLabel(variant: NuvemshopVariant): string {
  return (variant.values ?? [])
    .map((value) => localized(value.name ?? value).trim())
    .filter(Boolean)
    .join(" / ");
}

function variantAttributesFromName(name: string): { color: string | null; size: string | null } {
  const tuple = name.trim().match(/^(.*?)\s*\(([^(),]+),\s*([^()]+)\)\s*$/);
  if (tuple) return variantAttributesFromValues([tuple[2],tuple[3]]);
  const separatorIndex = name.lastIndexOf(" - ");
  if (separatorIndex >= 0) {
    const values = name.slice(separatorIndex + 3).split("/").map((part) => part.trim()).filter(Boolean);
    return variantAttributesFromValues(values);
  }
  return { color: null, size: null };
}

function imageForVariant(
  product: NuvemshopProductDetails,
  variant: NuvemshopVariant,
): string | null {
  const imageId = variant.image_id ? String(variant.image_id) : null;
  return (
    variant.image?.src ??
    (imageId ? product.images?.find((image) => String(image.position) === imageId || String((image as { id?: unknown }).id ?? "") === imageId)?.src : null) ??
    product.images?.[0]?.src ??
    null
  );
}

function categoryName(categories?: NuvemshopCategory[] | null): string | null {
  const rows = categories ?? [];
  if (rows.length === 0) return null;
  const generic = new Set(["todos os produtos", "marcas", "tipo de pele"]);
  const readable = rows
    .map((category) => ({
      name: localized(category.name).trim(),
      parent: category.parent,
    }))
    .filter((category) => category.name && !generic.has(category.name.toLowerCase()));
  const topLevel = readable.find((category) => !category.parent);
  return topLevel?.name ?? readable[0]?.name ?? null;
}

async function fetchProductDetails(
  storeId: string,
  accessToken: string,
  productId: string,
): Promise<NuvemshopProductDetails | null> {
  return fetchNuvemshopObject<NuvemshopProductDetails>(storeId, accessToken, `/products/${productId}`);
}

async function fetchNuvemshopPage<T>(
  storeId: string,
  accessToken: string,
  path: string,
  params: Record<string, string | number>,
): Promise<T[]> {
  const url = new URL(`${NUVEMSHOP_BASE_URL}/${storeId}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    headers: {
      Authentication: `bearer ${accessToken}`,
      "User-Agent": process.env.NUVEMSHOP_USER_AGENT ?? DEFAULT_USER_AGENT,
    },
  });
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "message" in body
        ? String((body as { message?: unknown }).message)
        : `${response.status} ${response.statusText}`;
    throw new Error(`Nuvemshop ${path} failed: ${message}`);
  }
  return Array.isArray(body) ? body as T[] : [];
}

async function fetchNuvemshopObject<T>(
  storeId: string,
  accessToken: string,
  path: string,
): Promise<T | null> {
  const response = await fetch(`${NUVEMSHOP_BASE_URL}/${storeId}${path}`, {
    headers: {
      Authentication: `bearer ${accessToken}`,
      "User-Agent": process.env.NUVEMSHOP_USER_AGENT ?? DEFAULT_USER_AGENT,
    },
  });
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "message" in body
        ? String((body as { message?: unknown }).message)
        : `${response.status} ${response.statusText}`;
    throw new Error(`Nuvemshop ${path} failed: ${message}`);
  }
  return body && typeof body === "object" ? body as T : null;
}

async function fetchOrderRefundedAmount(
  storeId: string,
  accessToken: string,
  orderId: string,
): Promise<number> {
  try {
    const transactions = await fetchNuvemshopPage<NuvemshopTransaction>(
      storeId,
      accessToken,
      `/orders/${orderId}/transactions`,
      {},
    );
    return transactions.reduce((sum, tx) => sum + asNumber(tx.refunded_amount?.value), 0);
  } catch {
    return 0;
  }
}

async function fetchOrders(
  storeId: string,
  accessToken: string,
  since?: Date,
  maxPages?: number,
): Promise<{
  rows: NuvemshopOrder[];
  pagesFetched: number;
  complete: boolean;
}> {
  const orders: NuvemshopOrder[] = [];
  let pagesFetched = 0;
  let complete = false;
  for (let page = 1; !maxPages || page <= maxPages; page++) {
    const rows = await fetchNuvemshopPage<NuvemshopOrder>(storeId, accessToken, "/orders", {
      page,
      per_page: 200,
      ...(since ? { updated_at_min: since.toISOString() } : {}),
    });
    pagesFetched++;
    orders.push(...rows);
    if (rows.length < 200) {
      complete = true;
      break;
    }
  }
  return { rows: orders, pagesFetched, complete };
}

async function fetchProducts(
  storeId: string,
  accessToken: string,
  maxPages?: number,
): Promise<{
  rows: NuvemshopProductDetails[];
  pagesFetched: number;
  complete: boolean;
}> {
  const products: NuvemshopProductDetails[] = [];
  let pagesFetched = 0;
  let complete = false;
  for (let page = 1; !maxPages || page <= maxPages; page++) {
    const rows = await fetchNuvemshopPage<NuvemshopProductDetails>(storeId, accessToken, "/products", {
      page,
      per_page: 200,
    });
    pagesFetched++;
    products.push(...rows);
    if (rows.length < 200) {
      complete = true;
      break;
    }
  }
  return { rows: products, pagesFetched, complete };
}

async function syncProductCatalog(params: {
  clientId: string;
  storeId: string;
  accessToken: string;
  maxPages?: number;
  result: NuvemshopSyncResult;
}) {
  const productPage = await fetchProducts(params.storeId, params.accessToken, params.maxPages);
  const products = productPage.rows;
  params.result.productsFetched = products.length;
  params.result.productPagesFetched = productPage.pagesFetched;
  params.result.productPaginationComplete = productPage.complete;
  if (!productPage.complete) {
    params.result.errors.push(
      `Product catalog pagination stopped after ${productPage.pagesFetched} page(s) before reaching the end. Increase NUVEMSHOP_CATALOG_MAX_PAGES or remove the cap.`,
    );
  }

  const index = await loadProductIndex(params.clientId);
  for (const product of products) {
    try {
      const productId = product.id ? String(product.id) : null;
      const variants = product.variants?.length ? product.variants : [{ id: productId, sku: productId }];
      const productName = localized(product.name) || `Produto ${productId ?? ""}`.trim();
      const category = categoryName(product.categories);
      const seenVariants = new Set<string>();

      for (const variant of variants) {
        const sku = skuForVariant(product, variant);
        const variantId = variant.id ? String(variant.id) : sku;
        const externalId = productId ? `${productId}:${variantId}` : variantId;
        // Keep each source variant distinct even when multiple sizes have the same SKU.
        if (seenVariants.has(externalId)) continue;
        seenVariants.add(externalId);
        try {
          const label = variantLabel(variant);
          const upserted = await upsertNuvemshopProduct(params.clientId, index, {
            externalId,
            sku,
            name: label ? `${productName} - ${label}` : productName,
            category,
            price: asNumber(variant.promotional_price) || asNumber(variant.price) || asNumber(variant.compare_at_price),
            stock: stockForVariant(variant),
            imageUrl: imageForVariant(product, variant),
            status: "ACTIVE",
          });
          if (upserted?.wasInserted) params.result.productsCreated++;
          else if (upserted) params.result.productsUpdated++;
        } catch (error) {
          params.result.errors.push(
            `Product ${productId ?? "unknown"} variant ${sku}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    } catch (error) {
      params.result.errors.push(
        `Product ${product?.id ?? "unknown"}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return index;
}

export async function syncNuvemshopClient(params: {
  clientId: string;
  storeId: string;
  accessToken: string;
  since?: Date;
  maxPages?: number;
  catalogMaxPages?: number;
  skipCatalog?: boolean;
}): Promise<NuvemshopSyncResult> {
  const result = emptyResult();
  let productIndex: ProductIndex | undefined;
  if (!params.skipCatalog) {
    try {
      productIndex = await syncProductCatalog({
        clientId: params.clientId,
        storeId: params.storeId,
        accessToken: params.accessToken,
        maxPages: params.catalogMaxPages,
        result,
      });
    } catch (error) {
      result.errors.push(`Product catalog: ${error instanceof Error ? error.message : String(error)}`);
    }
    result.catalogComplete = result.productPaginationComplete && result.errors.length === 0;
  }
  const catalogErrorCount = result.errors.length;
  let orders: NuvemshopOrder[] = [];
  try {
    const orderPage = await fetchOrders(params.storeId, params.accessToken, params.since, params.maxPages);
    orders = orderPage.rows;
    result.ordersFetched = orders.length;
    result.orderPagesFetched = orderPage.pagesFetched;
    result.orderPaginationComplete = orderPage.complete;
    if (!orderPage.complete) {
      result.errors.push(
        `Orders pagination stopped after ${orderPage.pagesFetched} page(s) before reaching the end. Increase NUVEMSHOP_CRON_MAX_PAGES or remove the cap.`,
      );
    }
  } catch (error) {
    result.errors.push(`Orders: ${error instanceof Error ? error.message : String(error)}`);
    return result;
  }
  const productDetailsCache = new Map<string, Promise<NuvemshopProductDetails | null>>();

  for (const order of orders) {
    try {
      const externalOrderId = String(order.id);
      const createdAt = asDate(order.created_at);
      const paid = isPaidLike(order);
      const status = orderStatus(order, paid);
      const cancelled = status === "REJECTED";
      const total = asNumber(order.total);
      const subtotal = asNumber(order.subtotal);
      const discount = Math.max(
        asNumber(order.discount),
        asNumber(order.discount_coupon) + asNumber(order.promotional_discount),
      );
      const shipping = asNumber(order.shipping_cost_customer) || asNumber(order.shipping_cost_owner);
      const hasRefundStatus = !cancelled && REFUNDED_PAYMENT_STATUSES.has(order.payment_status ?? "");
      const refundedAmount = hasRefundStatus
        ? await fetchOrderRefundedAmount(params.storeId, params.accessToken, externalOrderId)
        : 0;
      // A API da Nuvemshop confirma que houve reembolso via payment_status, mas nao expoe o
      // valor em nenhum endpoint testado (GET /orders/{id}/transactions volta [] mesmo pra
      // pedidos partially_refunded/refunded, nas duas versoes da API) -- ver reconciliacao
      // Nuvemshop de 2026-09. Guardamos isso pra sinalizar o pedido como "valor pode estar
      // incompleto" em vez de mostrar o total cheio silenciosamente como certo.
      const refundStatusUnverified = hasRefundStatus && refundedAmount === 0
        ? `Nuvemshop reporta payment_status="${order.payment_status}" mas nao informa o valor reembolsado via API; valor exibido pode nao descontar o reembolso.`
        : null;
      const cancelledAmount = cancelled ? total : 0;
      const invoicedAmount = cancelled ? 0 : Math.max(0, total - refundedAmount);
      const paidAmount = paid && !cancelled ? Math.max(0, (asNumber(order.total_paid) || total) - refundedAmount) : 0;
      const items = order.products ?? [];
      const requestedQuantity = items.reduce((sum, item) => sum + Math.max(1, Math.round(asNumber(item.quantity) || 1)), 0);
      const customer = order.customer ?? {};
      const email = (customer.email ?? order.contact_email ?? `nuvemshop-${customer.id ?? externalOrderId}@unknown.local`).trim();
      const name = customer.name ?? order.contact_name ?? null;
      const phone = customer.phone ?? order.contact_phone ?? null;
      const city = order.shipping_address?.city ?? order.billing_city ?? null;
      const state = normalizeState(order.shipping_address?.province ?? order.billing_province);

      const [upsertedCustomer] = await db
        .insert(customersTable)
        .values({
          clientId: params.clientId,
          externalId: customer.id ? String(customer.id) : `order-customer-${externalOrderId}`,
          email,
          name,
          phone,
          city,
          state,
          registrationStatus: "APPROVED",
          approvalDate: createdAt,
          createdAt,
        })
        .onConflictDoUpdate({
          target: [customersTable.clientId, customersTable.email],
          set: {
            externalId: customer.id ? String(customer.id) : undefined,
            name,
            phone,
            city,
            state,
            registrationStatus: "APPROVED",
            approvalDate: createdAt,
          },
        })
        .returning({ id: customersTable.id, wasInserted: sql<boolean>`(xmax = 0)` });
      if (!upsertedCustomer) continue;
      if (upsertedCustomer.wasInserted) result.customersCreated++;
      else result.customersUpdated++;

      const [upsertedOrder] = await db
        .insert(ordersTable)
        .values({
          clientId: params.clientId,
          customerId: upsertedCustomer.id,
          externalId: externalOrderId,
          sourceMetadata: { nuvemshop: { orderNumber: order.number == null ? null : String(order.number) } },
          requestedQuantity,
          fulfilledQuantity: paid ? requestedQuantity : 0,
          amount: invoicedAmount,
          fulfilledAmount: paidAmount,
          grossAmount: subtotal,
          discountAmount: discount,
          shippingAmount: shipping,
          refundedAmount,
          refundStatusUnverified,
          cancelledAmount,
          status,
          approvalDate: paid ? asDate(order.paid_at) : null,
          state,
          city,
          createdAt,
        })
        .onConflictDoUpdate({
          target: [ordersTable.clientId, ordersTable.externalId],
          set: {
            sourceMetadata: sql`COALESCE(${ordersTable.sourceMetadata}, '{}'::jsonb) || ${JSON.stringify({ nuvemshop: { orderNumber: order.number == null ? null : String(order.number) } })}::jsonb`,
            customerId: upsertedCustomer.id,
            requestedQuantity,
            fulfilledQuantity: paid ? requestedQuantity : 0,
            amount: invoicedAmount,
            fulfilledAmount: paidAmount,
            grossAmount: subtotal,
            discountAmount: discount,
            shippingAmount: shipping,
            refundedAmount,
            refundStatusUnverified,
            cancelledAmount,
            status,
            approvalDate: paid ? asDate(order.paid_at) : null,
            state,
            city,
          },
        })
        .returning({ id: ordersTable.id, wasInserted: sql<boolean>`(xmax = 0)` });
      if (!upsertedOrder) continue;
      if (upsertedOrder.wasInserted) result.ordersCreated++;
      else result.ordersUpdated++;

      await db.delete(orderItemsTable).where(eq(orderItemsTable.orderId, upsertedOrder.id));

      const itemGrossTotal = items.reduce((sum, item) => {
        const quantity = Math.max(1, Math.round(asNumber(item.quantity) || 1));
        return sum + asNumber(item.price) * quantity;
      }, 0);

      for (const item of items) {
        const quantity = Math.max(1, Math.round(asNumber(item.quantity) || 1));
        const sku = skuFor(item);
        const productId = item.product_id ? String(item.product_id) : String(item.id ?? sku);
        const variantId = item.variant_id ? String(item.variant_id) : null;
        const productExternalId = item.product_id && variantId ? `${productId}:${variantId}` : productId;
        const detailPromise = productDetailsCache.get(productId) ?? fetchProductDetails(params.storeId, params.accessToken, productId).catch(() => null);
        productDetailsCache.set(productId, detailPromise);
        const productDetails = await detailPromise;
        const variantDetails = productDetails?.variants?.find((variant) => String(variant.id ?? "") === String(variantId ?? ""));
        const variantAttrs = variantDetails ? variantAttributesFromValues((variantDetails.values ?? []).map(value => localized(value.name ?? value))) : variantAttributesFromName(localized(item.name));
        const productName = localized(item.name) || localized(item.product?.name) || localized(productDetails?.name) || sku;
        const category = categoryName(item.categories) ?? categoryName(item.product?.categories) ?? categoryName(productDetails?.categories);
        const productPrice = asNumber(item.promotional_price) || asNumber(item.price) || asNumber(item.compare_at_price);
        const grossUnitPrice = asNumber(item.compare_at_price) || asNumber(item.price);
        const itemGross = asNumber(item.price) * quantity;
        const itemDiscount = itemGrossTotal > 0 ? discount * (itemGross / itemGrossTotal) : 0;
        const netUnitPrice = Math.max(0, (itemGross - itemDiscount) / quantity);

        try {
          productIndex ??= await loadProductIndex(params.clientId);
          const product = await upsertNuvemshopProduct(params.clientId, productIndex, {
            externalId: productExternalId,
            sku,
            name: productName,
            category,
            price: productPrice,
            imageUrl: item.image?.src ?? item.product?.images?.[0]?.src ?? productDetails?.images?.[0]?.src ?? null,
          });
          if (!product) continue;
          if (product.wasInserted) result.productsCreated++;
          else result.productsUpdated++;

          await db.insert(orderItemsTable).values({
            orderId: upsertedOrder.id,
            productId: product.id,
            quantity,
            fulfilledQuantity: paid ? quantity : 0,
            priceAtSale: netUnitPrice,
            grossPriceAtSale: grossUnitPrice,
            discountAmount: itemDiscount,
            color: variantAttrs.color,
            size: variantAttrs.size,
          });
          result.orderItemsSynced++;
        } catch (itemError) {
          result.errors.push(
            `Order ${order.id} item ${sku}: ${itemError instanceof Error ? itemError.message : String(itemError)}`,
          );
        }
      }

      if (paid && !cancelled) {
        await db
          .insert(eventsTable)
          .values({
            clientId: params.clientId,
            customerId: upsertedCustomer.id,
            eventType: "PURCHASE",
            orderId: upsertedOrder.id,
            externalSourceId: `nuvemshop:purchase:${externalOrderId}`,
            metadata: {
              source: "nuvemshop",
              paymentStatus: order.payment_status,
              status: order.status,
            },
            createdAt: asDate(order.paid_at ?? order.created_at),
          })
          .onConflictDoNothing();
        result.eventsSynced++;
      }

      if (cancelled) result.cancelledOrders++;
      if (refundedAmount > 0) result.refundedOrders++;
      if (paid && !cancelled) result.paidOrders++;
      result.invoicedRevenue += invoicedAmount;
      result.paidRevenue += paidAmount;
      result.shippingRevenue += shipping;
      result.discounts += discount;
    } catch (error) {
      result.errors.push(`Order ${order.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await db.execute(sql`
    UPDATE products p
    SET
      total_sold = COALESCE(s.total_sold, 0),
      total_revenue = COALESCE(s.total_revenue, 0)
    FROM (
      SELECT
        oi.product_id,
        SUM(oi.fulfilled_quantity)::int AS total_sold,
        SUM(oi.fulfilled_quantity * oi.price_at_sale)::float AS total_revenue
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.client_id = ${params.clientId}
        AND o.status IN ('APPROVED', 'SHIPPED', 'DELIVERED')
      GROUP BY oi.product_id
    ) s
    WHERE p.id = s.product_id AND p.client_id = ${params.clientId}
  `);

  await db.execute(sql`
    UPDATE customers c
    SET
      total_orders = COALESCE(s.total_orders, 0),
      total_spent = COALESCE(s.total_spent, 0),
      first_purchase_at = s.first_purchase_at,
      last_purchase_at = s.last_purchase_at
    FROM (
      SELECT
        o.customer_id,
        COUNT(*)::int AS total_orders,
        SUM(o.fulfilled_amount)::float AS total_spent,
        MIN(o.created_at) AS first_purchase_at,
        MAX(o.created_at) AS last_purchase_at
      FROM orders o
      WHERE o.client_id = ${params.clientId}
        AND o.status IN ('APPROVED', 'SHIPPED', 'DELIVERED')
      GROUP BY o.customer_id
    ) s
    WHERE c.id = s.customer_id AND c.client_id = ${params.clientId}
  `);

  result.ordersComplete = result.orderPaginationComplete &&
    result.ordersCreated + result.ordersUpdated === result.ordersFetched &&
    result.errors.length === catalogErrorCount;
  return result;
}
