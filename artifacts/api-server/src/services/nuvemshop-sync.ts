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
  compare_at_price?: number | string | null;
  promotional_price?: number | string | null;
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

const PROVINCE_TO_STATE: Record<string, string> = {
  acre: "AC",
  alagoas: "AL",
  amapá: "AP",
  amapa: "AP",
  amazonas: "AM",
  bahia: "BA",
  ceará: "CE",
  ceara: "CE",
  "distrito federal": "DF",
  "espírito santo": "ES",
  "espirito santo": "ES",
  goiás: "GO",
  goias: "GO",
  maranhão: "MA",
  maranhao: "MA",
  "minas gerais": "MG",
  "mato grosso": "MT",
  "mato grosso do sul": "MS",
  pará: "PA",
  para: "PA",
  paraíba: "PB",
  paraiba: "PB",
  paraná: "PR",
  parana: "PR",
  pernambuco: "PE",
  piauí: "PI",
  piaui: "PI",
  "rio de janeiro": "RJ",
  "rio grande do norte": "RN",
  "rio grande do sul": "RS",
  rondônia: "RO",
  rondonia: "RO",
  roraima: "RR",
  "santa catarina": "SC",
  "são paulo": "SP",
  "sao paulo": "SP",
  sergipe: "SE",
  tocantins: "TO",
};

function emptyResult(): NuvemshopSyncResult {
  return {
    customersCreated: 0,
    customersUpdated: 0,
    ordersCreated: 0,
    ordersUpdated: 0,
    productsCreated: 0,
    productsUpdated: 0,
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

function orderStatus(order: NuvemshopOrder): LocalOrderStatus {
  if (order.status === "cancelled") return "REJECTED";
  if (order.status === "closed") return "DELIVERED";
  if (order.shipping_status === "shipped") return "SHIPPED";
  if (order.payment_status === "paid") return "APPROVED";
  return "PENDING";
}

function skuFor(item: NuvemshopProduct): string {
  const sku = (item.sku ?? "").trim();
  if (sku) return sku;
  return `nuvemshop-${item.product_id ?? item.id ?? "item"}`;
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

async function fetchOrders(
  storeId: string,
  accessToken: string,
  since?: Date,
  maxPages = 50,
): Promise<NuvemshopOrder[]> {
  const orders: NuvemshopOrder[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const rows = await fetchNuvemshopPage<NuvemshopOrder>(storeId, accessToken, "/orders", {
      page,
      per_page: 200,
      ...(since ? { created_at_min: since.toISOString() } : {}),
    });
    orders.push(...rows);
    if (rows.length < 200) break;
  }
  return orders;
}

async function fetchProducts(
  storeId: string,
  accessToken: string,
  maxPages = 50,
): Promise<NuvemshopProductDetails[]> {
  const products: NuvemshopProductDetails[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const rows = await fetchNuvemshopPage<NuvemshopProductDetails>(storeId, accessToken, "/products", {
      page,
      per_page: 200,
    });
    products.push(...rows);
    if (rows.length < 200) break;
  }
  return products;
}

async function syncProductCatalog(params: {
  clientId: string;
  storeId: string;
  accessToken: string;
  maxPages?: number;
  result: NuvemshopSyncResult;
}) {
  const products = await fetchProducts(params.storeId, params.accessToken, params.maxPages);
  for (const product of products) {
    try {
      const productId = product.id ? String(product.id) : null;
      const variants = product.variants && product.variants.length > 0 ? product.variants : [{ id: productId, sku: productId }] as NuvemshopVariant[];
      const productName = localized(product.name) || `Produto ${productId ?? ""}`.trim();
      const category = categoryName(product.categories);
      const variantsBySku = new Map<string, {
        externalId: string;
        name: string;
        price: number;
        stock: number;
        imageUrl: string | null;
      }>();

      for (const variant of variants) {
        const sku = skuForVariant(product, variant);
        const variantId = variant.id ? String(variant.id) : sku;
        const externalId = productId ? `${productId}:${variantId}` : variantId;
        const label = variantLabel(variant);
        const stock = stockForVariant(variant);
        const existing = variantsBySku.get(sku);
        if (existing) {
          existing.stock += stock;
          existing.externalId = productId ? productId : existing.externalId;
          continue;
        }
        variantsBySku.set(sku, {
          externalId,
          name: label ? `${productName} - ${label}` : productName,
          price: asNumber(variant.promotional_price) || asNumber(variant.compare_at_price) || asNumber(variant.price),
          stock,
          imageUrl: imageForVariant(product, variant),
        });
      }

      for (const [sku, row] of variantsBySku.entries()) {
        const [upserted] = await db
          .insert(productsTable)
          .values({
            clientId: params.clientId,
            externalId: row.externalId,
            sku,
            name: row.name,
            category,
            price: row.price,
            stock: row.stock,
            imageUrl: row.imageUrl,
            status: "ACTIVE",
          })
          .onConflictDoUpdate({
            target: [productsTable.clientId, productsTable.sku],
            set: {
              externalId: row.externalId,
              name: row.name,
              category,
              price: row.price,
              stock: row.stock,
              imageUrl: row.imageUrl,
              status: "ACTIVE",
            },
          })
          .returning({ wasInserted: sql<boolean>`(xmax = 0)` });
        if (upserted?.wasInserted) params.result.productsCreated++;
        else params.result.productsUpdated++;
      }
    } catch (error) {
      params.result.errors.push(`Product ${product.id ?? "unknown"}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export async function syncNuvemshopClient(params: {
  clientId: string;
  storeId: string;
  accessToken: string;
  since?: Date;
  maxPages?: number;
  catalogMaxPages?: number;
}): Promise<NuvemshopSyncResult> {
  const result = emptyResult();
  try {
    await syncProductCatalog({
      clientId: params.clientId,
      storeId: params.storeId,
      accessToken: params.accessToken,
      maxPages: params.catalogMaxPages ?? 50,
      result,
    });
  } catch (error) {
    result.errors.push(`Product catalog: ${error instanceof Error ? error.message : String(error)}`);
  }
  let orders: NuvemshopOrder[] = [];
  try {
    orders = await fetchOrders(params.storeId, params.accessToken, params.since, params.maxPages);
  } catch (error) {
    result.errors.push(`Orders: ${error instanceof Error ? error.message : String(error)}`);
    return result;
  }
  const productDetailsCache = new Map<string, Promise<NuvemshopProductDetails | null>>();

  for (const order of orders) {
    try {
      const externalOrderId = String(order.id);
      const createdAt = asDate(order.created_at);
      const status = orderStatus(order);
      const cancelled = status === "REJECTED";
      const paid = order.payment_status === "paid";
      const total = asNumber(order.total);
      const subtotal = asNumber(order.subtotal);
      const discount = Math.max(
        asNumber(order.discount),
        asNumber(order.discount_coupon) + asNumber(order.promotional_discount),
      );
      const shipping = asNumber(order.shipping_cost_customer) || asNumber(order.shipping_cost_owner);
      const refundedAmount = 0;
      const cancelledAmount = cancelled ? total : 0;
      const invoicedAmount = cancelled ? 0 : total;
      const paidAmount = paid && !cancelled ? asNumber(order.total_paid) || total : 0;
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
          requestedQuantity,
          fulfilledQuantity: paid ? requestedQuantity : 0,
          amount: invoicedAmount,
          fulfilledAmount: paidAmount,
          grossAmount: subtotal,
          discountAmount: discount,
          shippingAmount: shipping,
          refundedAmount,
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
            customerId: upsertedCustomer.id,
            requestedQuantity,
            fulfilledQuantity: paid ? requestedQuantity : 0,
            amount: invoicedAmount,
            fulfilledAmount: paidAmount,
            grossAmount: subtotal,
            discountAmount: discount,
            shippingAmount: shipping,
            refundedAmount,
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
        const productName = localized(item.name) || localized(item.product?.name) || localized(productDetails?.name) || sku;
        const category = categoryName(item.categories) ?? categoryName(item.product?.categories) ?? categoryName(productDetails?.categories);
        const grossUnitPrice = asNumber(item.compare_at_price) || asNumber(item.price);
        const itemGross = asNumber(item.price) * quantity;
        const itemDiscount = itemGrossTotal > 0 ? discount * (itemGross / itemGrossTotal) : 0;
        const netUnitPrice = Math.max(0, (itemGross - itemDiscount) / quantity);

        const [product] = await db
          .insert(productsTable)
          .values({
            clientId: params.clientId,
            externalId: productExternalId,
            sku,
            name: productName,
            category,
            price: grossUnitPrice,
            imageUrl: item.image?.src ?? item.product?.images?.[0]?.src ?? productDetails?.images?.[0]?.src ?? null,
          })
          .onConflictDoUpdate({
            target: [productsTable.clientId, productsTable.sku],
            set: {
              externalId: productExternalId,
              name: productName,
              category,
              price: grossUnitPrice,
              imageUrl: item.image?.src ?? item.product?.images?.[0]?.src ?? productDetails?.images?.[0]?.src ?? null,
            },
          })
          .returning({ id: productsTable.id, wasInserted: sql<boolean>`(xmax = 0)` });
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
        });
        result.orderItemsSynced++;
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

  return result;
}
