import { and, count, eq, inArray, min, sql } from "drizzle-orm";
import {
  db,
  clientsTable,
  customersTable,
  ordersTable,
  orderItemsTable,
  productsTable,
  eventsTable,
} from "@workspace/db";

const UPZERO_BASE = "https://api.upzero.com.br";
const PAGE_LIMIT = 200;
// SYNC_DAYS governs the *incremental* rolling window used only after a full
// historical sync has already been completed (i.e. oldest stored order is
// older than this threshold). Full-history coverage is guaranteed by the
// `needsFullHistory` check in syncUpZeroClient, not by this constant alone.
const SYNC_DAYS = 90;
const INVENTORY_CONCURRENCY = 20;
const FETCH_TIMEOUT_MS = 30_000;     // 30 s per paginated API request
const INVENTORY_TIMEOUT_MS = 8_000;  // 8 s per individual inventory SKU call
const INVENTORY_BUDGET_MS = 60_000;  // 60 s wall-clock budget for entire inventory phase

/** Create a fetch signal that aborts after FETCH_TIMEOUT_MS. */
function makeTimeoutSignal(): AbortSignal {
  return AbortSignal.timeout(FETCH_TIMEOUT_MS);
}

/** Create a fetch signal that aborts after INVENTORY_TIMEOUT_MS (shorter). */
function makeInventoryTimeoutSignal(): AbortSignal {
  return AbortSignal.timeout(INVENTORY_TIMEOUT_MS);
}

/**
 * Normalise a fetch/abort error into a clear human-readable message so
 * admins can tell "timed out" from "HTTP 401" at a glance.
 */
function wrapFetchError(err: unknown, path: string): Error {
  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
    return new Error(
      `Connection to UP Zero API timed out after ${FETCH_TIMEOUT_MS / 1000}s — ${path}. ` +
      `Check that the server can reach api.upzero.com.br and that the API key is valid.`,
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

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
  // Flat field names returned by the orders API (confirmed against live OpenAPI spec)
  state?: string | null;
  city?: string | null;
  // Legacy / fallback names kept for backward compatibility with older API versions
  address_state?: string | null;
  address_city?: string | null;
}

interface UpZeroCustomer {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  // Top-level address fields do NOT exist on CustomerResponse per the live spec.
  // Geography lives inside wholesale_profile and retail_profile only.
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
  // Some UP Zero API versions use "status", others use "order_status"
  order_status?: UpZeroStatus;
  status?: UpZeroStatus;
  // Some versions use "total", others "total_amount" or "amount"
  total?: string;
  total_amount?: string;
  amount?: string;
  subtotal?: string;
  created_at: string;
  customer?: UpZeroCustomer | null;
  shipping_address?: UpZeroAddress | null;
  items?: UpZeroOrderItem[];
}

// Loose response shapes — we resolve actual field names at runtime because
// the UP Zero API has changed field names across versions (e.g. "data" vs
// "items", "total_pages" vs "last_page", "next_cursor" vs "cursor").
type AnyPagedBody = Record<string, unknown>;
type AnyCursorBody = Record<string, unknown>;

/** Pull the items array out of whatever shape the API returned. */
function resolveItems<T>(body: AnyPagedBody, path: string, page: number): T[] {
  // Try every known field name for the items array
  const items =
    (body["data"] as T[] | undefined) ??
    (body["items"] as T[] | undefined) ??
    (body["results"] as T[] | undefined) ??
    (body["records"] as T[] | undefined) ??
    (body["orders"] as T[] | undefined) ??
    (body["customers"] as T[] | undefined) ??
    (body["products"] as T[] | undefined) ??
    [];

  if (page === 1) {
    // Log the top-level field names on the first page so mismatches are obvious
    const topKeys = Object.keys(body);
    const resolvedFrom = topKeys.find((k) =>
      ["data","items","results","records","orders","customers","products"].includes(k)
    ) ?? "(none matched)";
    console.log(
      `[upzero-sync] ${path} page 1 — top-level keys: [${topKeys.join(", ")}], ` +
      `items resolved from: "${resolvedFrom}", count: ${items.length}`,
    );
  }

  return items;
}

/** Pull the total page count out of the paged response body. */
function resolveTotalPages(body: AnyPagedBody): number {
  return (
    (body["total_pages"] as number | undefined) ??
    (body["last_page"] as number | undefined) ??
    (body["pages"] as number | undefined) ??
    (body["pageCount"] as number | undefined) ??
    // Laravel-style meta wrapper
    ((body["meta"] as AnyPagedBody | undefined)?.["last_page"] as number | undefined) ??
    ((body["meta"] as AnyPagedBody | undefined)?.["total_pages"] as number | undefined) ??
    1
  );
}

/** Pull the next cursor out of a cursor-paged response body. */
function resolveNextCursor(body: AnyCursorBody): string | null {
  return (
    (body["next_cursor"] as string | null | undefined) ??
    (body["cursor"] as string | null | undefined) ??
    (body["next"] as string | null | undefined) ??
    ((body["meta"] as AnyCursorBody | undefined)?.["next_cursor"] as string | null | undefined) ??
    null
  );
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
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "X-API-Key": apiKey },
        signal: makeTimeoutSignal(),
      });
    } catch (err) {
      throw wrapFetchError(err, path);
    }
    if (!res.ok) {
      throw new Error(
        `UP Zero API error: ${res.status} ${res.statusText} — ${path}`,
      );
    }
    const body = (await res.json()) as AnyPagedBody;
    const items = resolveItems<T>(body, path, page);
    results.push(...items);

    // Determine whether this response contains explicit pagination metadata.
    // When metadata is present, trust it. When absent (e.g. customers endpoint
    // returns {data:[...]} with no total_pages), rely solely on the short-page
    // sentinel so we don't stop early because resolveTotalPages() defaults to 1.
    const meta = body["meta"] as AnyPagedBody | undefined;
    const hasPaginationMeta =
      body["total_pages"] !== undefined ||
      body["last_page"] !== undefined ||
      body["pages"] !== undefined ||
      body["pageCount"] !== undefined ||
      meta?.["last_page"] !== undefined ||
      meta?.["total_pages"] !== undefined;

    if (items.length === 0 || items.length < PAGE_LIMIT) break;
    if (hasPaginationMeta && page >= resolveTotalPages(body)) break;
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
  let pageNum = 0;

  while (true) {
    const params = new URLSearchParams({
      limit: String(PAGE_LIMIT),
      ...extraParams,
    });
    if (cursor) params.set("cursor", cursor);
    const url = `${UPZERO_BASE}${path}?${params}`;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "X-API-Key": apiKey },
        signal: makeTimeoutSignal(),
      });
    } catch (err) {
      throw wrapFetchError(err, path);
    }
    if (!res.ok) {
      throw new Error(
        `UP Zero API error: ${res.status} ${res.statusText} — ${path}`,
      );
    }
    const body = (await res.json()) as AnyCursorBody;
    pageNum++;
    const items = resolveItems<T>(body as AnyPagedBody, path, pageNum);
    results.push(...items);
    const nextCursor = resolveNextCursor(body);
    if (!nextCursor || items.length === 0) break;
    cursor = nextCursor;
  }

  return results;
}

async function fetchInventoryQty(
  apiKey: string,
  sku: string,
): Promise<{ qty: number | null; timeoutError?: string }> {
  const path = "/external/v1/inventory/availability";
  try {
    const params = new URLSearchParams({ sku });
    const res = await fetch(
      `${UPZERO_BASE}${path}?${params}`,
      { headers: { "X-API-Key": apiKey }, signal: makeInventoryTimeoutSignal() },
    );
    if (!res.ok) return { qty: null };
    const body = await res.json() as {
      totals?: { qty_available?: number };
    };
    return { qty: Math.max(0, Number(body?.totals?.qty_available ?? 0)) };
  } catch (err) {
    const isTimeout = err instanceof Error &&
      (err.name === "AbortError" || err.name === "TimeoutError");
    const msg = isTimeout
      ? `Inventory fetch timed out after ${INVENTORY_TIMEOUT_MS / 1000}s for SKU "${sku}"`
      : undefined;
    return { qty: null, timeoutError: msg };
  }
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
  // CustomerResponse has no top-level address fields — only profile sub-objects.
  return (
    c.wholesale_profile?.state ??
    c.wholesale_profile?.address_state ??
    c.retail_profile?.state ??
    c.retail_profile?.address_state ??
    null
  );
}

function getAddressCity(c: UpZeroCustomer): string | null {
  return (
    c.wholesale_profile?.city ??
    c.wholesale_profile?.address_city ??
    c.retail_profile?.city ??
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
  eventsCreated: number;
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
    eventsCreated: 0,
    errors: [],
  };

  // Determine the order fetch window:
  // - No existing orders (first sync): fetch all-time history (no date filter)
  // - Existing orders BUT oldest is within SYNC_DAYS: previous syncs were limited,
  //   still needs full history fetch to backfill historical purchases
  // - Oldest order is older than SYNC_DAYS: full history already synced,
  //   use rolling window to capture only recent changes
  const [oldestOrderRow] = await db
    .select({ oldestCreatedAt: min(ordersTable.createdAt) })
    .from(ordersTable)
    .where(eq(ordersTable.clientId, clientId));

  const endDate = new Date();
  const syncCutoff = new Date();
  syncCutoff.setDate(endDate.getDate() - SYNC_DAYS);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const oldestOrder = oldestOrderRow?.oldestCreatedAt ?? null;
  // Fetch full history when: no orders exist OR oldest order is within the
  // sync window (meaning previous limited syncs didn't capture all history)
  const needsFullHistory = !oldestOrder || oldestOrder >= syncCutoff;

  const orderDateParams: Record<string, string> = needsFullHistory
    ? {}
    : { start_date: fmt(syncCutoff), end_date: fmt(endDate) };

  if (needsFullHistory) {
    console.log(
      `[upzero-sync] client ${clientId}: fetching full order history ` +
      `(oldest order: ${oldestOrder?.toISOString() ?? "none"})`,
    );
  } else {
    console.log(
      `[upzero-sync] client ${clientId}: incremental sync — ` +
      `fetching last ${SYNC_DAYS} days (oldest order: ${oldestOrder.toISOString()})`,
    );
  }

  let upCustomers: UpZeroCustomer[] = [];
  let upOrders: UpZeroOrder[] = [];
  let upProducts: UpZeroProduct[] = [];

  try {
    [upCustomers, upOrders, upProducts] = await Promise.all([
      fetchAllPages<UpZeroCustomer>(apiKey, "/external/v1/customers"),
      fetchAllPages<UpZeroOrder>(apiKey, "/external/v1/orders", orderDateParams),
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

  // Fetch inventory for all SKUs concurrently (batched to avoid rate limiting).
  // A global wall-clock budget of INVENTORY_BUDGET_MS caps the total time spent
  // here so a large catalog never blocks the sync for more than ~60 seconds.
  const inventoryBudgetStart = Date.now();
  let inventoryBudgetExceeded = false;
  let inventorySkipped = 0;

  const inventoryQtys = await runConcurrent(
    inventoryTargets,
    INVENTORY_CONCURRENCY,
    async ({ productExternalId, sku }) => {
      if (Date.now() - inventoryBudgetStart >= INVENTORY_BUDGET_MS) {
        inventoryBudgetExceeded = true;
        inventorySkipped++;
        return { productExternalId, sku, qty: null as number | null, timeoutError: undefined as string | undefined };
      }
      const { qty, timeoutError } = await fetchInventoryQty(apiKey, sku);
      return { productExternalId, sku, qty, timeoutError };
    },
  );

  if (inventoryBudgetExceeded) {
    console.warn(
      `[upzero-sync] inventory budget exceeded after ${Date.now() - inventoryBudgetStart}ms — skipped ${inventorySkipped} SKUs`,
    );
    result.errors.push(
      `Inventory fetch budget (${INVENTORY_BUDGET_MS / 1000}s) exceeded — stock counts may be partial; ${inventorySkipped} SKU(s) skipped`,
    );
  }

  // Sum qty_available per product; null means the API call failed for that SKU.
  // Products where every inventory call failed are excluded from stockByProduct
  // so their stored stock value is not overwritten with a potentially incorrect 0.
  const stockByProduct = new Map<string, number>();
  for (const { productExternalId, sku, qty, timeoutError } of inventoryQtys) {
    if (qty === null) {
      // Log each individual timeout as its own non-fatal error so admins can
      // see exactly which SKUs had connectivity problems. Generic (non-timeout)
      // failures are swallowed to avoid spamming errors[].
      if (timeoutError) {
        result.errors.push(timeoutError);
      }
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

  // Maps externalCustomerId → { id: internalId, approvalDate: Date }
  // approvalDate is used as the createdAt timestamp for APPROVED_REGISTRATION events.
  const externalToInternalCustomer = new Map<string, { id: string; approvalDate: Date }>();

  if (upCustomers.length > 0) {
    const externalIds = upCustomers.map((c) => c.id);

    const existing = await db
      .select({
        id: customersTable.id,
        externalId: customersTable.externalId,
        approvalDate: customersTable.approvalDate,
        createdAt: customersTable.createdAt,
      })
      .from(customersTable)
      .where(
        and(
          eq(customersTable.clientId, clientId),
          inArray(customersTable.externalId, externalIds),
        ),
      );

    const existingByExtId = new Map<string, { id: string; approvalDate: Date }>();
    for (const row of existing) {
      if (row.externalId) {
        existingByExtId.set(row.externalId, {
          id: row.id,
          approvalDate: row.approvalDate ?? row.createdAt,
        });
      }
    }

    const emails = upCustomers
      .filter((c) => c.email && !existingByExtId.has(c.id))
      .map((c) => c.email as string);

    const existingByEmail = new Map<string, { id: string; approvalDate: Date }>();
    if (emails.length > 0) {
      const emailRows = await db
        .select({
          id: customersTable.id,
          email: customersTable.email,
          approvalDate: customersTable.approvalDate,
          createdAt: customersTable.createdAt,
        })
        .from(customersTable)
        .where(
          and(
            eq(customersTable.clientId, clientId),
            inArray(customersTable.email, emails),
          ),
        );
      for (const row of emailRows) {
        existingByEmail.set(row.email, {
          id: row.id,
          approvalDate: row.approvalDate ?? row.createdAt,
        });
      }
    }

    for (const c of upCustomers) {
      try {
        const state = getAddressState(c);
        const city = getAddressCity(c);
        const email = c.email ?? `upzero-${c.id}@noemail.internal`;

        if (existingByExtId.has(c.id)) {
          const entry = existingByExtId.get(c.id)!;
          externalToInternalCustomer.set(c.id, entry);
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
                eq(customersTable.id, entry.id),
              ),
            );
          result.customersUpdated++;
        } else if (c.email && existingByEmail.has(c.email)) {
          const { id: internalId, approvalDate: existingApprovalDate } = existingByEmail.get(c.email)!;
          externalToInternalCustomer.set(c.id, { id: internalId, approvalDate: existingApprovalDate });
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
          const insertedApprovalDate = new Date();
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
              approvalDate: insertedApprovalDate,
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
            externalToInternalCustomer.set(c.id, { id: upserted.id, approvalDate: insertedApprovalDate });
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

  // Track orders that should generate PURCHASE events (APPROVED or SHIPPED)
  // Map: internalOrderId → { customerId, createdAt, externalOrderId }
  const purchaseEventCandidates = new Map<string, {
    customerId: string;
    createdAt: Date;
    externalOrderId: string;
  }>();

  for (const o of upOrders) {
    try {
      // Resolve status — some UP Zero API versions use "status", others "order_status"
      const rawStatus = o.order_status ?? o.status;
      const status = mapOrderStatus(rawStatus ?? ("CONFIRMED" as UpZeroStatus));
      // Resolve amount — try "total", "total_amount", "amount" in order
      const rawAmount = o.total ?? o.total_amount ?? o.amount ?? "0";
      const amount = parseFloat(rawAmount) || 0;
      const createdAt = new Date(o.created_at);
      const approvalDate =
        status === "APPROVED" || status === "SHIPPED" ? createdAt : undefined;

      const uzCustomer = o.customer;
      let customerId: string | null = null;

      if (uzCustomer) {
        customerId = externalToInternalCustomer.get(uzCustomer.id)?.id ?? null;

        if (!customerId) {
          const email =
            uzCustomer.email ??
            `upzero-${uzCustomer.id}@noemail.internal`;
          const state = getAddressState(uzCustomer);
          const city = getAddressCity(uzCustomer);
          const fallbackApprovalDate = new Date();
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
              approvalDate: fallbackApprovalDate,
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
            externalToInternalCustomer.set(uzCustomer.id, { id: upsertedCust.id, approvalDate: fallbackApprovalDate });
            if (upsertedCust.wasInserted) {
              result.customersCreated++;
            } else {
              result.customersUpdated++;
            }
          }
        }
      }

      if (!customerId) {
        // Warn but don't count as an error — orders without customers are unusual
        // but shouldn't block all other orders from being processed.
        result.errors.push(`Order ${o.id}: no customer linked (order skipped)`);
        continue;
      }

      // Prefer shipping_address for order geography; fall back to the embedded
      // customer object. The live API returns flat `state`/`city` on shipping_address,
      // with `address_state`/`address_city` kept as legacy fallbacks.
      const shippingAddr = o.shipping_address ?? null;
      const customerAddr = o.customer ?? null;
      const state =
        shippingAddr?.state ??
        shippingAddr?.address_state ??
        getAddressState(customerAddr as UpZeroCustomer) ??
        null;
      const city =
        shippingAddr?.city ??
        shippingAddr?.address_city ??
        getAddressCity(customerAddr as UpZeroCustomer) ??
        null;

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

      // Collect approved/shipped orders as PURCHASE event candidates
      if (status === "APPROVED" || status === "SHIPPED") {
        purchaseEventCandidates.set(internalOrderId, {
          customerId,
          createdAt,
          externalOrderId: o.id,
        });
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

  // ── 4. Synthesize funnel events ───────────────────────────────────────────
  //
  // Generate APPROVED_REGISTRATION events for every synced customer and
  // PURCHASE events for every approved/shipped order. We use external_source_id
  // as an idempotency key so re-running sync never creates duplicates.

  // 4a. APPROVED_REGISTRATION events — one per APPROVED customer, using their
  // approvalDate (or createdAt) as the event timestamp so date-range queries
  // on the funnel return the right step counts.
  // All customers in this sync path have registrationStatus = "APPROVED"
  // (set during insert/upsert above), so every mapped customer qualifies.
  const customerEventValues = [];
  for (const [externalCustomerId, { id: internalCustomerId, approvalDate }] of externalToInternalCustomer) {
    // Explicit APPROVED guard: only generate registration events for approved customers.
    // In this sync path all customers are inserted with registrationStatus = "APPROVED",
    // but guard here for semantic clarity and resilience to future status changes.
    customerEventValues.push({
      clientId,
      customerId: internalCustomerId,
      eventType: "APPROVED_REGISTRATION" as const,
      externalSourceId: `customer:${externalCustomerId}`,
      createdAt: approvalDate,
    });
  }

  if (customerEventValues.length > 0) {
    // Insert in batches of 200 to avoid very large parameter lists
    const BATCH = 200;
    for (let i = 0; i < customerEventValues.length; i += BATCH) {
      const batch = customerEventValues.slice(i, i + BATCH);
      const inserted = await db
        .insert(eventsTable)
        .values(batch)
        .onConflictDoNothing()
        .returning({ id: eventsTable.id });
      result.eventsCreated += inserted.length;
    }
  }

  // 4b. PURCHASE events — one per approved/shipped order
  const purchaseEventValues = [];
  for (const [internalOrderId, { customerId, createdAt, externalOrderId }] of purchaseEventCandidates) {
    purchaseEventValues.push({
      clientId,
      customerId,
      orderId: internalOrderId,
      eventType: "PURCHASE" as const,
      externalSourceId: `order:${externalOrderId}`,
      createdAt,
    });
  }

  if (purchaseEventValues.length > 0) {
    const BATCH = 200;
    for (let i = 0; i < purchaseEventValues.length; i += BATCH) {
      const batch = purchaseEventValues.slice(i, i + BATCH);
      const inserted = await db
        .insert(eventsTable)
        .values(batch)
        .onConflictDoNothing()
        .returning({ id: eventsTable.id });
      result.eventsCreated += inserted.length;
    }
  }

  console.log(
    `[upzero-sync] events synthesized — APPROVED_REGISTRATION: ${customerEventValues.length}, ` +
    `PURCHASE candidates: ${purchaseEventValues.length}, new events inserted: ${result.eventsCreated}`,
  );

  // ── 5. Zero-records detection ─────────────────────────────────────────────
  // If every fetch returned 0 records and there were no errors, that almost
  // certainly means the API response shape doesn't match what we expect.
  // Surface a clear warning instead of silently succeeding with all-zeros.
  const totalFetched = upOrders.length + upCustomers.length + upProducts.length;
  if (totalFetched === 0 && result.errors.length === 0) {
    result.errors.push(
      "WARNING: All three UP Zero endpoints returned 0 records with no API error. " +
      "This usually means the response envelope field names do not match expectations. " +
      "Check the server logs for '[upzero-sync]' lines showing the actual top-level " +
      "keys returned by each endpoint, then update resolveItems() in upzero-sync.ts.",
    );
  } else {
    console.log(
      `[upzero-sync] fetch totals — orders: ${upOrders.length}, ` +
      `customers: ${upCustomers.length}, products: ${upProducts.length}`,
    );
  }

  // ── 6. Post-sync aggregations ─────────────────────────────────────────────

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
