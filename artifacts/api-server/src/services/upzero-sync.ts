import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  clientsTable,
  customersTable,
  ordersTable,
  orderItemsTable,
  productsTable,
} from "@workspace/db";

const UPZERO_BASE = "https://api.upzero.com.br";
const PAGE_LIMIT = 200;
const SYNC_DAYS = 90;
const INVENTORY_CONCURRENCY = 20;

type UpZeroStatus =
  | "RESERVED"
  | "CONFIRMED"
  | "PROCESSING"
  | "INVOICED"
  | "SHIPPED"
  | "CANCELED";

function mapOrderStatus(
  s: UpZeroStatus,
): "PENDING" | "APPROVED" | "SHIPPED" | "REJECTED" {
  switch (s) {
    case "RESERVED":
      return "PENDING";
    case "CONFIRMED":
    case "PROCESSING":
    case "INVOICED":
      return "APPROVED";
    case "SHIPPED":
      return "SHIPPED";
    case "CANCELED":
      return "REJECTED";
    default:
      return "PENDING";
  }
}

function mapProductStatus(
  s: string,
): "ACTIVE" | "INACTIVE" | "DISCONTINUED" {
  switch (s) {
    case "active":
      return "ACTIVE";
    case "inactive":
      return "INACTIVE";
    case "archived":
      return "DISCONTINUED";
    default:
      return "ACTIVE";
  }
}

interface UpZeroAddress {
  address_state?: string | null;
  address_city?: string | null;
}

interface UpZeroCustomer {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  address_state?: string | null;
  address_city?: string | null;
  wholesale_profile?: UpZeroAddress | null;
  retail_profile?: UpZeroAddress | null;
}

interface UpZeroVariantAttribute {
  attribute: { id?: string; name?: string; code?: string };
  term: { name?: string; code?: string };
}

interface UpZeroVariant {
  id: string;
  sku?: string | null;
  price?: string | null;
  cost?: string | null;
  active?: boolean;
  attributes?: UpZeroVariantAttribute[];
}

interface UpZeroProduct {
  id: string;
  product_id?: string;
  code?: string | null;
  name: string;
  status: string;
  variants?: UpZeroVariant[];
  created_at?: string;
  updated_at?: string;
}

interface UpZeroOrderItem {
  id: string;
  variant_id?: string | null;
  sku?: string | null;
  qty: number;
  unit_price?: string | null;
  status: "active" | "removed";
}

interface UpZeroOrder {
  id: string;
  order_status: UpZeroStatus;
  total: string;
  subtotal?: string;
  created_at: string;
  customer?: UpZeroCustomer | null;
  shipping_address?: UpZeroAddress | null;
  items?: UpZeroOrderItem[];
}

interface PagedResponse<T> {
  data: T[];
  page: number;
  total_pages: number;
  total: number;
}

interface CursorResponse<T> {
  data: T[];
  next_cursor: string | null;
}

async function fetchAllPages<T>(
  apiKey: string,
  path: string,
  extraParams: Record<string, string> = {},
): Promise<T[]> {
  const results: T[] = [];
  let page = 1;

  while (true) {
    const params = new URLSearchParams({
      limit: String(PAGE_LIMIT),
      page: String(page),
      ...extraParams,
    });
    const url = `${UPZERO_BASE}${path}?${params}`;
    const res = await fetch(url, {
      headers: { "X-API-Key": apiKey },
    });
    if (!res.ok) {
      throw new Error(
        `UP Zero API error: ${res.status} ${res.statusText} — ${path}`,
      );
    }
    const body = (await res.json()) as PagedResponse<T>;
    results.push(...(body.data ?? []));
    if (page >= (body.total_pages ?? 1)) break;
    page++;
  }

  return results;
}

async function fetchAllCursorPages<T>(
  apiKey: string,
  path: string,
  extraParams: Record<string, string> = {},
): Promise<T[]> {
  const results: T[] = [];
  let cursor: string | null | undefined = undefined;

  while (true) {
    const params = new URLSearchParams({
      limit: String(PAGE_LIMIT),
      ...extraParams,
    });
    if (cursor) params.set("cursor", cursor);
    const url = `${UPZERO_BASE}${path}?${params}`;
    const res = await fetch(url, {
      headers: { "X-API-Key": apiKey },
    });
    if (!res.ok) {
      throw new Error(
        `UP Zero API error: ${res.status} ${res.statusText} — ${path}`,
      );
    }
    const body = (await res.json()) as CursorResponse<T>;
    results.push(...(body.data ?? []));
    if (!body.next_cursor) break;
    cursor = body.next_cursor;
  }

  return results;
}

async function fetchInventoryQty(
  apiKey: string,
  sku: string,
): Promise<number | null> {
  const params = new URLSearchParams({ sku });
  const res = await fetch(
    `${UPZERO_BASE}/external/v1/inventory/availability?${params}`,
    { headers: { "X-API-Key": apiKey } },
  );
  if (!res.ok) return null;
  const body = await res.json() as {
    totals?: { qty_available?: number };
  };
  return Math.max(0, Number(body?.totals?.qty_available ?? 0));
}

async function runConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

function getAddressState(c: UpZeroCustomer): string | null {
  return (
    c.address_state ??
    c.wholesale_profile?.address_state ??
    c.retail_profile?.address_state ??
    null
  );
}

function getAddressCity(c: UpZeroCustomer): string | null {
  return (
    c.address_city ??
    c.wholesale_profile?.address_city ??
    c.retail_profile?.address_city ??
    null
  );
}

function extractVariantAttribute(
  attributes: UpZeroVariantAttribute[] | undefined,
  codes: string[],
): string | null {
  if (!attributes) return null;
  for (const attr of attributes) {
    const code = (attr.attribute?.code ?? "").toLowerCase();
    if (codes.includes(code)) {
      return attr.term?.name ?? attr.term?.code ?? null;
    }
  }
  return null;
}

export interface SyncResult {
  customersCreated: number;
  customersUpdated: number;
  ordersCreated: number;
  ordersUpdated: number;
  productsCreated: number;
  productsUpdated: number;
  orderItemsSynced: number;
  errors: string[];
}

export async function syncUpZeroClient(
  clientId: string,
  apiKey: string,
): Promise<SyncResult> {
  const result: SyncResult = {
    customersCreated: 0,
    customersUpdated: 0,
    ordersCreated: 0,
    ordersUpdated: 0,
    productsCreated: 0,
    productsUpdated: 0,
    orderItemsSynced: 0,
    errors: [],
  };

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - SYNC_DAYS);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  let upCustomers: UpZeroCustomer[] = [];
  let upOrders: UpZeroOrder[] = [];
  let upProducts: UpZeroProduct[] = [];

  try {
    [upCustomers, upOrders, upProducts] = await Promise.all([
      fetchAllPages<UpZeroCustomer>(apiKey, "/external/v1/customers"),
      fetchAllPages<UpZeroOrder>(apiKey, "/external/v1/orders", {
        start_date: fmt(startDate),
        end_date: fmt(endDate),
      }),
      fetchAllCursorPages<UpZeroProduct>(apiKey, "/external/v1/products"),
    ]);
  } catch (err) {
    result.errors.push(String(err));
    return result;
  }

  // ── 1. Product sync ──────────────────────────────────────────────────────

  // Build a map of variantId → {size, color} for use in order item sync
  const variantAttrs = new Map<string, { size: string | null; color: string | null }>();

  // Collect all (productExternalId, sku) pairs across all variants to fetch inventory
  const inventoryTargets: Array<{
    productExternalId: string;
    sku: string;
  }> = [];

  for (const p of upProducts) {
    for (const v of p.variants ?? []) {
      const isActive = v.active !== false;
      if (v.sku) {
        const size = extractVariantAttribute(v.attributes, ["size", "tamanho"]);
        const color = extractVariantAttribute(v.attributes, ["cor", "color", "colour"]);
        variantAttrs.set(v.id, { size, color });
        // Only query inventory for active variants
        if (isActive) {
          inventoryTargets.push({ productExternalId: p.id, sku: v.sku });
        }
      }
    }
  }

  // Fetch inventory for all SKUs concurrently (batched to avoid rate limiting)
  const inventoryQtys = await runConcurrent(
    inventoryTargets,
    INVENTORY_CONCURRENCY,
    async ({ productExternalId, sku }) => {
      const qty = await fetchInventoryQty(apiKey, sku);
      return { productExternalId, sku, qty };
    },
  );

  // Sum qty_available per product; null means the API call failed for that SKU.
  // Products where every inventory call failed are excluded from stockByProduct
  // so their stored stock value is not overwritten with a potentially incorrect 0.
  const stockByProduct = new Map<string, number>();
  for (const { productExternalId, sku, qty } of inventoryQtys) {
    if (qty === null) {
      result.errors.push(
        `Inventory fetch failed for SKU "${sku}" (product ${productExternalId}); stock not updated`,
      );
      continue;
    }
    stockByProduct.set(
      productExternalId,
      (stockByProduct.get(productExternalId) ?? 0) + qty,
    );
  }

  // Pre-load ALL existing products for this client, indexed by both externalId
  // and SKU. This lets us safely merge legacy manual-import rows (which have a
  // SKU but no externalId) without violating the (client_id, sku) unique index.
  const allExisting = await db
    .select({
      id: productsTable.id,
      sku: productsTable.sku,
      externalId: productsTable.externalId,
    })
    .from(productsTable)
    .where(eq(productsTable.clientId, clientId));

  const existingProductByExtId = new Map<string, string>(); // externalId → rowId
  const existingProductBySku = new Map<string, string>();   // sku        → rowId
  for (const row of allExisting) {
    if (row.externalId) existingProductByExtId.set(row.externalId, row.id);
    existingProductBySku.set(row.sku, row.id);
  }

  // SKU → local product ID; seeded from DB so order-item linking works even
  // for products not touched in this sync (e.g., manual imports, partial catalog).
  const skuToLocalProductId = new Map<string, string>();
  for (const row of allExisting) {
    skuToLocalProductId.set(row.sku, row.id);
  }

  for (const p of upProducts) {
    try {
      const activeVariants = (p.variants ?? []).filter((v) => v.active !== false && v.sku);
      const firstVariant = activeVariants[0] ?? (p.variants ?? [])[0];
      if (!firstVariant) continue;

      const sku = firstVariant.sku ?? p.code ?? p.id;
      const price = parseFloat(firstVariant.price ?? "0") || 0;
      const cost = firstVariant.cost ? parseFloat(firstVariant.cost) : null;
      // Only update stock when at least one inventory call succeeded; if all
      // calls failed the product's existing stock value is preserved.
      const stockValue = stockByProduct.get(p.id);
      const stockFields = stockValue !== undefined ? { stock: stockValue } : {};
      const status = mapProductStatus(p.status);

      if (existingProductByExtId.has(p.id)) {
        // Row already linked to this UP Zero product — update in place.
        const internalId = existingProductByExtId.get(p.id)!;
        await db
          .update(productsTable)
          .set({ sku, name: p.name, price, cost: cost ?? undefined, ...stockFields, status })
          .where(
            and(
              eq(productsTable.clientId, clientId),
              eq(productsTable.id, internalId),
            ),
          );
        result.productsUpdated++;
        for (const v of p.variants ?? []) {
          if (v.sku) skuToLocalProductId.set(v.sku, internalId);
        }
      } else if (existingProductBySku.has(sku)) {
        // A row exists with the same SKU but no externalId (manual/imported).
        // Attach the externalId so future syncs follow the fast path above,
        // and avoid a (client_id, sku) unique-index violation on insert.
        const internalId = existingProductBySku.get(sku)!;
        await db
          .update(productsTable)
          .set({
            externalId: p.id,
            name: p.name,
            price,
            cost: cost ?? undefined,
            ...stockFields,
            status,
          })
          .where(
            and(
              eq(productsTable.clientId, clientId),
              eq(productsTable.id, internalId),
            ),
          );
        existingProductByExtId.set(p.id, internalId);
        result.productsUpdated++;
        for (const v of p.variants ?? []) {
          if (v.sku) skuToLocalProductId.set(v.sku, internalId);
        }
      } else {
        // Genuinely new product — insert with externalId as the primary key.
        const [inserted] = await db
          .insert(productsTable)
          .values({
            clientId,
            externalId: p.id,
            sku,
            name: p.name,
            price,
            cost: cost ?? undefined,
            stock: stockValue ?? 0,
            status,
          })
          .returning({ id: productsTable.id });

        if (inserted) {
          result.productsCreated++;
          existingProductByExtId.set(p.id, inserted.id);
          for (const v of p.variants ?? []) {
            if (v.sku) skuToLocalProductId.set(v.sku, inserted.id);
          }
        }
      }
    } catch (err) {
      result.errors.push(`Product ${p.id}: ${String(err)}`);
    }
  }

  // ── 2. Customer sync ─────────────────────────────────────────────────────

  const externalToInternalCustomer = new Map<string, string>();

  if (upCustomers.length > 0) {
    const externalIds = upCustomers.map((c) => c.id);

    const existing = await db
      .select({ id: customersTable.id, externalId: customersTable.externalId })
      .from(customersTable)
      .where(
        and(
          eq(customersTable.clientId, clientId),
          inArray(customersTable.externalId, externalIds),
        ),
      );

    const existingByExtId = new Map<string, string>();
    for (const row of existing) {
      if (row.externalId) existingByExtId.set(row.externalId, row.id);
    }

    const emails = upCustomers
      .filter((c) => c.email && !existingByExtId.has(c.id))
      .map((c) => c.email as string);

    const existingByEmail = new Map<string, string>();
    if (emails.length > 0) {
      const emailRows = await db
        .select({ id: customersTable.id, email: customersTable.email })
        .from(customersTable)
        .where(
          and(
            eq(customersTable.clientId, clientId),
            inArray(customersTable.email, emails),
          ),
        );
      for (const row of emailRows) {
        existingByEmail.set(row.email, row.id);
      }
    }

    for (const c of upCustomers) {
      try {
        const state = getAddressState(c);
        const city = getAddressCity(c);
        const email = c.email ?? `upzero-${c.id}@noemail.internal`;

        if (existingByExtId.has(c.id)) {
          const internalId = existingByExtId.get(c.id)!;
          externalToInternalCustomer.set(c.id, internalId);
          await db
            .update(customersTable)
            .set({
              name: c.name ?? undefined,
              phone: c.phone ?? undefined,
              state: state ?? undefined,
              city: city ?? undefined,
            })
            .where(
              and(
                eq(customersTable.clientId, clientId),
                eq(customersTable.id, internalId),
              ),
            );
          result.customersUpdated++;
        } else if (c.email && existingByEmail.has(c.email)) {
          const internalId = existingByEmail.get(c.email)!;
          externalToInternalCustomer.set(c.id, internalId);
          await db
            .update(customersTable)
            .set({
              externalId: c.id,
              name: c.name ?? undefined,
              phone: c.phone ?? undefined,
              state: state ?? undefined,
              city: city ?? undefined,
            })
            .where(
              and(
                eq(customersTable.clientId, clientId),
                eq(customersTable.id, internalId),
              ),
            );
          result.customersUpdated++;
        } else {
          const [upserted] = await db
            .insert(customersTable)
            .values({
              clientId,
              externalId: c.id,
              email,
              name: c.name ?? null,
              phone: c.phone ?? null,
              state,
              city,
              registrationStatus: "APPROVED",
              approvalDate: new Date(),
            })
            .onConflictDoUpdate({
              target: [customersTable.clientId, customersTable.externalId],
              set: {
                name: c.name ?? null,
                phone: c.phone ?? null,
                state,
                city,
              },
            })
            .returning({
              id: customersTable.id,
              wasInserted: sql<boolean>`(xmax = 0)`,
            });
          if (upserted) {
            externalToInternalCustomer.set(c.id, upserted.id);
            if (upserted.wasInserted) {
              result.customersCreated++;
            } else {
              result.customersUpdated++;
            }
          }
        }
      } catch (err) {
        result.errors.push(`Customer ${c.id}: ${String(err)}`);
      }
    }
  }

  // ── 3. Order + order item sync ───────────────────────────────────────────

  const externalOrderIds = upOrders.map((o) => o.id);

  const existingOrders =
    externalOrderIds.length > 0
      ? await db
          .select({
            id: ordersTable.id,
            externalId: ordersTable.externalId,
          })
          .from(ordersTable)
          .where(
            and(
              eq(ordersTable.clientId, clientId),
              inArray(ordersTable.externalId, externalOrderIds),
            ),
          )
      : [];

  const existingOrderByExtId = new Map<string, string>();
  for (const row of existingOrders) {
    if (row.externalId) existingOrderByExtId.set(row.externalId, row.id);
  }

  for (const o of upOrders) {
    try {
      const amount = parseFloat(o.total) || 0;
      const status = mapOrderStatus(o.order_status);
      const createdAt = new Date(o.created_at);
      const approvalDate =
        status === "APPROVED" || status === "SHIPPED" ? createdAt : undefined;

      const uzCustomer = o.customer;
      let customerId: string | null = null;

      if (uzCustomer) {
        customerId = externalToInternalCustomer.get(uzCustomer.id) ?? null;

        if (!customerId) {
          const email =
            uzCustomer.email ??
            `upzero-${uzCustomer.id}@noemail.internal`;
          const state = getAddressState(uzCustomer);
          const city = getAddressCity(uzCustomer);
          const [upsertedCust] = await db
            .insert(customersTable)
            .values({
              clientId,
              externalId: uzCustomer.id,
              email,
              name: uzCustomer.name ?? null,
              phone: uzCustomer.phone ?? null,
              state,
              city,
              registrationStatus: "APPROVED",
              approvalDate: new Date(),
            })
            .onConflictDoUpdate({
              target: [customersTable.clientId, customersTable.externalId],
              set: { name: uzCustomer.name ?? null },
            })
            .returning({
              id: customersTable.id,
              wasInserted: sql<boolean>`(xmax = 0)`,
            });
          if (upsertedCust) {
            customerId = upsertedCust.id;
            externalToInternalCustomer.set(uzCustomer.id, upsertedCust.id);
            if (upsertedCust.wasInserted) {
              result.customersCreated++;
            } else {
              result.customersUpdated++;
            }
          }
        }
      }

      if (!customerId) {
        result.errors.push(`Order ${o.id}: no customer found, skipping`);
        continue;
      }

      const shippingAddr = o.shipping_address ?? o.customer;
      const state =
        (shippingAddr as UpZeroAddress | null)?.address_state ?? null;
      const city =
        (shippingAddr as UpZeroAddress | null)?.address_city ?? null;

      let internalOrderId: string;

      if (existingOrderByExtId.has(o.id)) {
        internalOrderId = existingOrderByExtId.get(o.id)!;
        await db
          .update(ordersTable)
          .set({ amount, status, state, city })
          .where(
            and(
              eq(ordersTable.clientId, clientId),
              eq(ordersTable.id, internalOrderId),
            ),
          );
        result.ordersUpdated++;
      } else {
        const [upsertedOrder] = await db
          .insert(ordersTable)
          .values({
            clientId,
            customerId,
            externalId: o.id,
            amount,
            status,
            approvalDate,
            state,
            city,
            createdAt,
          })
          .onConflictDoUpdate({
            target: [ordersTable.clientId, ordersTable.externalId],
            set: { amount, status, state, city },
          })
          .returning({ id: ordersTable.id, wasInserted: sql<boolean>`(xmax = 0)` });
        if (!upsertedOrder) continue;
        internalOrderId = upsertedOrder.id;
        if (upsertedOrder.wasInserted) {
          result.ordersCreated++;
        } else {
          result.ordersUpdated++;
        }
      }

      // Always delete existing items before re-inserting; handles the case where
      // an order previously had items but all are now removed/inactive.
      await db
        .delete(orderItemsTable)
        .where(eq(orderItemsTable.orderId, internalOrderId));

      const activeItems = (o.items ?? []).filter((item) => item.status === "active");
      for (const item of activeItems) {
        const sku = item.sku;
        if (!sku) continue;
        const localProductId = skuToLocalProductId.get(sku);
        if (!localProductId) {
          result.errors.push(
            `Order ${o.id} item ${item.id}: SKU "${sku}" not found in synced products, skipping`,
          );
          continue;
        }
        const attrs = item.variant_id
          ? variantAttrs.get(item.variant_id)
          : undefined;
        try {
          await db.insert(orderItemsTable).values({
            orderId: internalOrderId,
            productId: localProductId,
            quantity: Math.max(1, Math.round(item.qty)),
            priceAtSale: parseFloat(item.unit_price ?? "0") || 0,
            size: attrs?.size ?? null,
            color: attrs?.color ?? null,
          });
          result.orderItemsSynced++;
        } catch (itemErr) {
          result.errors.push(
            `Order ${o.id} item ${item.id}: ${String(itemErr)}`,
          );
        }
      }
    } catch (err) {
      result.errors.push(`Order ${o.id}: ${String(err)}`);
    }
  }

  // ── 4. Post-sync aggregations ─────────────────────────────────────────────

  // Full recompute for all products belonging to this client.
  // Uses FILTER to ensure only items from approved orders contribute to totals;
  // products with no qualifying items are correctly reset to 0.
  await db.execute(sql`
    UPDATE products p
    SET
      total_sold    = COALESCE(agg.total_qty, 0),
      total_revenue = COALESCE(agg.total_rev, 0)
    FROM (
      SELECT
        p2.id AS product_id,
        COALESCE(
          SUM(oi.quantity) FILTER (
            WHERE o.id IS NOT NULL
              AND o.client_id = ${clientId}
              AND o.status IN ('APPROVED', 'SHIPPED', 'DELIVERED')
          ), 0
        )::int AS total_qty,
        COALESCE(
          SUM(oi.quantity * oi.price_at_sale) FILTER (
            WHERE o.id IS NOT NULL
              AND o.client_id = ${clientId}
              AND o.status IN ('APPROVED', 'SHIPPED', 'DELIVERED')
          ), 0
        )::float AS total_rev
      FROM products p2
      LEFT JOIN order_items oi ON oi.product_id = p2.id
      LEFT JOIN orders o       ON o.id = oi.order_id
      WHERE p2.client_id = ${clientId}
      GROUP BY p2.id
    ) agg
    WHERE p.id = agg.product_id
      AND p.client_id = ${clientId}
  `);

  // Recompute client YTD revenue / orders
  const aggResult = await db.execute<{ revenue: number; orders: number }>(
    sql`
      SELECT
        COALESCE(SUM(amount), 0)::float AS revenue,
        COUNT(*)::int AS orders
      FROM orders
      WHERE client_id = ${clientId}
        AND status IN ('APPROVED','SHIPPED','DELIVERED')
        AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM NOW())
    `,
  );
  const agg = aggResult.rows[0];
  if (agg) {
    await db
      .update(clientsTable)
      .set({
        revenueYtd: Number(agg.revenue) || 0,
        ordersYtd: Number(agg.orders) || 0,
      })
      .where(eq(clientsTable.id, clientId));
  }

  return result;
}
