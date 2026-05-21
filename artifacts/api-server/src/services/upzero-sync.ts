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
const PRODUCT_IMAGE_CONCURRENCY = 20;
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
  | "DELIVERED"
  | "CANCELED";

function mapOrderStatus(
  s: UpZeroStatus | string,
): "PENDING" | "APPROVED" | "SHIPPED" | "DELIVERED" | "REJECTED" {
  switch (String(s).toUpperCase()) {
    case "RESERVED":
      return "PENDING";
    case "CONFIRMED":
    case "PROCESSING":
    case "INVOICED":
      return "APPROVED";
    case "SHIPPED":
      return "SHIPPED";
    case "DELIVERED":
      return "DELIVERED";
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

interface UpZeroRetailProfile extends UpZeroAddress {
  cpf?: string | null;
}

interface UpZeroWholesaleProfile extends UpZeroAddress {
  cnpj?: string | null;
}

interface UpZeroCustomer {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  customer_type?: "RETAIL" | "WHOLESALE" | string | null;
  approved?: boolean | string | number | null;
  is_approved?: boolean | string | number | null;
  rejected?: boolean | string | number | null;
  is_rejected?: boolean | string | number | null;
  status?: string | null;
  registration_status?: string | null;
  approval_status?: string | null;
  lead_status?: string | null;
  created_at?: string | null;
  registered_at?: string | null;
  registration_date?: string | null;
  lead_created_at?: string | null;
  approved_at?: string | null;
  approval_date?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  utm?: {
    source?: string | null;
    medium?: string | null;
    campaign?: string | null;
    content?: string | null;
    term?: string | null;
  } | null;
  // Top-level address fields do NOT exist on CustomerResponse per the live spec.
  // Geography lives inside wholesale_profile and retail_profile only.
  wholesale_profile?: UpZeroWholesaleProfile | null;
  retail_profile?: UpZeroRetailProfile | null;
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
  description_html?: string | null;
  status: string;
  category_name?: string | null;
  category_names?: string[] | string | null;
  image_url?: string | null;
  imageUrl?: string | null;
  thumbnail_url?: string | null;
  thumbnailUrl?: string | null;
  photo_url?: string | null;
  picture?: string | null;
  image?: string | { url?: string | null; src?: string | null } | null;
  images?: Array<string | { url?: string | null; src?: string | null; image_url?: string | null }> | null;
  media?: Array<string | { url?: string | null; src?: string | null; image_url?: string | null; type?: string | null }> | null;
  tags?: string[] | null;
  category_ids?: string[] | null;
  category?: { name?: string | null } | string | null;
  categories?: Array<{ name?: string | null } | string> | null;
  variants?: UpZeroVariant[];
  created_at?: string;
  updated_at?: string;
}

type UpZeroProductImageBody = Record<string, unknown> | Array<unknown>;

/**
 * Build a human-readable product name from the UP Zero product object.
 *
 * The top-level `name` field is a generic category label ("BLUSA", "CONJUNTO").
 * `description_html` contains the real product description but may also include
 * appended defect/return notices and fabric composition lines, e.g.:
 *
 *   "BLUSA REGATA GOLA BAIXA COM RECORTE NO OMBRO (*PRODUTO COM LEVE DEFEITO - TONALIDADE / ESTE PRODUTO NÃO TEM TROCA E/OU DEVOLUÇÃO*)"
 *   "(*PRODUTO COM LEVE DEFEITO - TECIDO / ESTE PRODUTO NÃO TEM TROCA E/OU DEVOLUÇÃO*)"   ← only a notice, no real name
 *   "*****PRODUTO COM DEFEITO - FORRO PODE RASGAR / ESTE PRODUTO NÃO TEM TROCA OU DEVOLUÇÃO*****"
 *   "100% Poliéster"   ← fabric composition only
 *
 * Strategy:
 *   1. Strip HTML tags.
 *   2. Remove all defect/return-policy notices (starred prefixes and parenthetical notices).
 *   3. If nothing meaningful remains (empty, starts with %, or starts with a digit
 *      followed by % indicating pure fabric composition), fall back to the generic `name`.
 *   4. Title-case via split/join (not \b regex) so Portuguese accented characters
 *      such as ã, ç, ô are handled correctly.
 */
function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(" ")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseNumberLike(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const normalized = value
    .trim()
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = parseNumberLike(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const parsed = cleanString(value);
    if (parsed) return parsed;
  }
  return null;
}

function boolLike(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  const s = cleanString(value)?.toLowerCase();
  if (!s) return null;
  if (["true", "1", "yes", "sim", "approved", "aprovado"].includes(s)) return true;
  if (["false", "0", "no", "nao", "não", "rejected", "recusado"].includes(s)) return false;
  return null;
}

function parseDateLike(value: unknown): Date | null {
  const s = cleanString(value);
  if (!s) return null;
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function firstDate(...values: unknown[]): Date | null {
  for (const value of values) {
    const parsed = parseDateLike(value);
    if (parsed) return parsed;
  }
  return null;
}

function buildProductName(p: UpZeroProduct): string {
  const raw = p.description_html
    ? p.description_html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    : "";
  if (!raw) return titleCase(p.name);

  // Remove defect/return-policy notices in two forms:
  //   (*PRODUTO COM LEVE DEFEITO - ...*)  — parenthetical, with or without leading *
  //   *****PRODUTO COM DEFEITO - ...*****  — asterisk-bordered block
  //   *PRODUTO COM LEVE DEFEITO ...  — bare asterisk prefix (no closing)
  const cleaned = raw
    .replace(/\s*\(\s*\*+\s*produto\b[^)]*\)/gi, "")   // (*produto com defeito...)
    .replace(/\s*\*{2,}\s*produto\b[^*]*\*{2,}/gi, "")  // *****produto com defeito*****
    .replace(/\s*\*\s*produto\b.*/gi, "")               // *produto com leve defeito... (to EOL)
    .trim();

  // Fall back to generic name when nothing usable remains:
  //   - empty string
  //   - starts with '(' meaning only a parenthetical notice survived
  //   - starts with digits followed by '%' meaning pure fabric composition ("100% Poliéster")
  if (!cleaned || cleaned.startsWith("(") || /^\d+\s*%/.test(cleaned)) {
    return titleCase(p.name);
  }

  return titleCase(cleaned);
}

function inferProductCategory(p: UpZeroProduct): string | null {
  if (p.category_name?.trim()) return titleCase(p.category_name.trim());
  if (typeof p.category_names === "string" && p.category_names.trim()) {
    return titleCase(p.category_names.trim());
  }
  if (Array.isArray(p.category_names)) {
    const categoryName = p.category_names.find((name) => name.trim());
    if (categoryName) return titleCase(categoryName.trim());
  }
  if (typeof p.category === "string" && p.category.trim()) return titleCase(p.category.trim());
  if (p.category && typeof p.category === "object" && p.category.name?.trim()) {
    return titleCase(p.category.name.trim());
  }
  const firstCategory = p.categories?.find((c) =>
    typeof c === "string" ? c.trim() : c.name?.trim(),
  );
  if (typeof firstCategory === "string" && firstCategory.trim()) {
    return titleCase(firstCategory.trim());
  }
  if (firstCategory && typeof firstCategory === "object" && firstCategory.name?.trim()) {
    return titleCase(firstCategory.name.trim());
  }

  const firstWord = (p.name ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")[0];
  if (!firstWord) return null;
  return titleCase(firstWord);
}

function imageFromValue(value: unknown): string | null {
  if (typeof value === "string") return cleanString(value);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const direct = firstString(
      record.url,
      record.src,
      record.image_url,
      record.imageUrl,
      record.thumbnail_url,
      record.thumbnailUrl,
      record.original_url,
      record.originalUrl,
      record.preview_url,
      record.previewUrl,
      record.file_url,
      record.fileUrl,
      record.path,
    );
    if (direct) return direct;
    return imageFromValue(record.image) ?? imageFromValue(record.file) ?? imageFromValue(record.asset);
  }
  return null;
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeProductImageUrl(value: string | null): string | null {
  const url = cleanString(value);
  if (!url) return null;
  const decoded = decodeHtmlAttribute(url);
  if (/^https?:\/\//i.test(decoded)) return decoded;
  if (decoded.startsWith("//")) return `https:${decoded}`;
  if (decoded.startsWith("/")) return `${UPZERO_BASE}${decoded}`;
  try {
    return new URL(decoded, UPZERO_BASE).toString();
  } catch {
    return decoded;
  }
}

function extractImageFromHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  const imgMatch = html.match(/<img\b[^>]*(?:src|data-src|data-original)=["']?([^"'\s>]+)/i);
  if (imgMatch?.[1]) return normalizeProductImageUrl(imgMatch[1]);
  const srcSetMatch = html.match(/<source\b[^>]*srcset=["']?([^"',\s>]+)/i);
  return srcSetMatch?.[1] ? normalizeProductImageUrl(srcSetMatch[1]) : null;
}

function collectProductImageCandidates(value: unknown): unknown[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value !== "object") return [value];

  const record = value as Record<string, unknown>;
  const nested =
    record.data ??
    record.images ??
    record.items ??
    record.results ??
    record.records ??
    record.product_images ??
    record.productImages ??
    record.media;

  if (nested && nested !== value) return collectProductImageCandidates(nested);
  return [value];
}

function extractProductImageUrlFromBody(body: UpZeroProductImageBody): string | null {
  for (const candidate of collectProductImageCandidates(body)) {
    const url = imageFromValue(candidate);
    if (url) return normalizeProductImageUrl(url);
  }
  return null;
}

function extractProductImageUrl(p: UpZeroProduct): string | null {
  const direct = firstString(p.image_url, p.imageUrl, p.thumbnail_url, p.thumbnailUrl, p.photo_url, p.picture);
  if (direct) return normalizeProductImageUrl(direct);
  const image = imageFromValue(p.image);
  if (image) return normalizeProductImageUrl(image);
  for (const source of [p.images, p.media]) {
    if (!Array.isArray(source)) continue;
    for (const entry of source) {
      const url = imageFromValue(entry);
      if (url) return normalizeProductImageUrl(url);
    }
  }
  const htmlImage = extractImageFromHtml(p.description_html);
  if (htmlImage) return htmlImage;
  return null;
}

/**
 * Build a display name from the UP Zero customer name field.
 * Some customers are stored in all-caps in UP Zero (e.g. "CHIRLENE IZABEL DA SILVA").
 * When every letter in the name is uppercase we title-case it so names render
 * naturally in the UI ("Chirlene Izabel Da Silva").  Mixed-case names such as
 * "Renata Vilas Boas Badaró" are returned unchanged, preserving accented chars.
 */
function buildCustomerName(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  // Detect all-caps: strip non-alpha characters and compare to uppercase version.
  const lettersOnly = trimmed.replace(/[^a-zA-ZÀ-ÖØ-öø-ÿ]/g, "");
  if (lettersOnly.length > 0 && lettersOnly === lettersOnly.toUpperCase()) {
    return titleCase(trimmed);
  }
  return trimmed;
}

interface UpZeroOrderItem {
  id: string;
  variant_id?: string | null;
  sku?: string | null;
  qty?: number;
  quantity?: number;
  requested_qty?: number | string | null;
  quantity_requested?: number | string | null;
  requested_quantity?: number | string | null;
  qty_requested?: number | string | null;
  qtd_solicitada?: number | string | null;
  fulfilled_qty?: number | string | null;
  quantity_fulfilled?: number | string | null;
  fulfilled_quantity?: number | string | null;
  qty_fulfilled?: number | string | null;
  attended_qty?: number | string | null;
  qtd_atendida?: number | string | null;
  unit_price?: string | number | null;
  status?: "active" | "removed" | string | null;
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
  requested_amount?: string | number | null;
  requested_total?: string | number | null;
  amount_requested?: string | number | null;
  total_requested?: string | number | null;
  valor_solicitado?: string | number | null;
  fulfilled_amount?: string | number | null;
  fulfilled_total?: string | number | null;
  amount_fulfilled?: string | number | null;
  total_fulfilled?: string | number | null;
  attended_amount?: string | number | null;
  valor_atendido?: string | number | null;
  requested_quantity?: string | number | null;
  requested_items_qty?: string | number | null;
  quantity_requested?: string | number | null;
  qty_requested?: string | number | null;
  qtd_solicitada?: string | number | null;
  fulfilled_quantity?: string | number | null;
  total_items_qty?: string | number | null;
  quantity_fulfilled?: string | number | null;
  qty_fulfilled?: string | number | null;
  attended_quantity?: string | number | null;
  qtd_atendida?: string | number | null;
  subtotal?: string;
  created_at: string;
  updated_at?: string | null;
  customer?: UpZeroCustomer | null;
  customer_id?: string | number | null;
  shipping_address?: UpZeroAddress | null;
  items?: UpZeroOrderItem[];
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
}

interface UpZeroEvent {
  id?: string | number | null;
  event_id?: string | number | null;
  type?: string | null;
  event_type?: string | null;
  name?: string | null;
  created_at?: string | null;
  occurred_at?: string | null;
  timestamp?: string | null;
  customer_id?: string | number | null;
  customer?: UpZeroCustomer | null;
  order_id?: string | number | null;
  product_id?: string | number | null;
  sku?: string | null;
  metadata?: Record<string, unknown> | null;
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
  const seenPageSignatures = new Set<string>();

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

    if (!hasPaginationMeta) {
      const signature = JSON.stringify({
        count: items.length,
        first: (items[0] as { id?: unknown } | undefined)?.id ?? null,
        last: (items[items.length - 1] as { id?: unknown } | undefined)?.id ?? null,
      });
      if (seenPageSignatures.has(signature)) {
        console.warn(
          `[upzero-sync] ${path} page ${page} repeated a previous page without pagination metadata; stopping pagination`,
        );
        break;
      }
      seenPageSignatures.add(signature);
    }

    results.push(...items);

    if (items.length === 0 || items.length < PAGE_LIMIT) break;
    if (hasPaginationMeta && page >= resolveTotalPages(body)) break;
    page++;
  }

  return results;
}

async function fetchOptionalPages<T>(
  apiKey: string,
  path: string,
  extraParams: Record<string, string> = {},
): Promise<T[]> {
  try {
    return await fetchAllPages<T>(apiKey, path, extraParams);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("404")) {
      console.warn(`[upzero-sync] optional endpoint ${path} is not available yet`);
      return [];
    }
    throw err;
  }
}

async function fetchCustomerById(apiKey: string, id: number): Promise<UpZeroCustomer | null> {
  const path = `/external/v1/customers/${id}`;
  let res: Response;
  try {
    res = await fetch(`${UPZERO_BASE}${path}`, {
      headers: { "X-API-Key": apiKey },
      signal: makeTimeoutSignal(),
    });
  } catch (err) {
    throw wrapFetchError(err, path);
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`UP Zero API error: ${res.status} ${res.statusText} — ${path}`);
  }
  return (await res.json()) as UpZeroCustomer;
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

async function backfillCustomersByNumericId(
  clientId: string,
  apiKey: string,
  customers: UpZeroCustomer[],
): Promise<UpZeroCustomer[]> {
  const byId = new Map<string, UpZeroCustomer>();
  for (const customer of customers) byId.set(customer.id, customer);

  const numericIds = customers
    .map((customer) => Number.parseInt(customer.id, 10))
    .filter((id) => Number.isFinite(id) && id > 0);
  const maxId = numericIds.length > 0 ? Math.max(...numericIds) : 0;
  if (maxId === 0) return customers;

  const existingRows = await db
    .select({ externalId: customersTable.externalId })
    .from(customersTable)
    .where(eq(customersTable.clientId, clientId));
  const existingIds = new Set(
    existingRows
      .map((row) => Number.parseInt(row.externalId ?? "", 10))
      .filter((id) => Number.isFinite(id) && id > 0),
  );

  const idsToFetch: number[] = [];
  for (let id = 1; id <= maxId; id++) {
    if (byId.has(String(id)) || existingIds.has(id)) continue;
    idsToFetch.push(id);
  }

  if (idsToFetch.length === 0) return customers;
  console.log(
    `[upzero-sync] /external/v1/customers: list endpoint returned ${customers.length}; ` +
      `backfilling ${idsToFetch.length} numeric customer IDs up to ${maxId}`,
  );

  const fetched = await runConcurrent(idsToFetch, 25, async (id) => {
    try {
      return await fetchCustomerById(apiKey, id);
    } catch (err) {
      console.warn(`[upzero-sync] customer detail ${id} failed: ${String(err)}`);
      return null;
    }
  });

  let added = 0;
  for (const customer of fetched) {
    if (!customer || byId.has(customer.id)) continue;
    byId.set(customer.id, customer);
    added++;
  }
  console.log(`[upzero-sync] /external/v1/customers: backfilled ${added} additional customers`);

  return [...byId.values()];
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

async function fetchProductImageUrl(
  apiKey: string,
  productId: string,
): Promise<string | null> {
  const path = `/external/v1/products/${encodeURIComponent(productId)}/images`;
  try {
    const res = await fetch(`${UPZERO_BASE}${path}`, {
      headers: { "X-API-Key": apiKey },
      signal: makeInventoryTimeoutSignal(),
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      console.warn(`[upzero-sync] product images ${productId} failed: ${res.status} ${res.statusText}`);
      return null;
    }
    const body = (await res.json()) as UpZeroProductImageBody;
    return extractProductImageUrlFromBody(body);
  } catch (err) {
    const isTimeout = err instanceof Error &&
      (err.name === "AbortError" || err.name === "TimeoutError");
    if (isTimeout) {
      console.warn(
        `[upzero-sync] product images ${productId} timed out after ${INVENTORY_TIMEOUT_MS / 1000}s`,
      );
    }
    return null;
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

const DDD_TO_STATE: Record<string, string> = {
  "11": "SP", "12": "SP", "13": "SP", "14": "SP", "15": "SP", "16": "SP", "17": "SP", "18": "SP", "19": "SP",
  "21": "RJ", "22": "RJ", "24": "RJ",
  "27": "ES", "28": "ES",
  "31": "MG", "32": "MG", "33": "MG", "34": "MG", "35": "MG", "37": "MG", "38": "MG",
  "41": "PR", "42": "PR", "43": "PR", "44": "PR", "45": "PR", "46": "PR",
  "47": "SC", "48": "SC", "49": "SC",
  "51": "RS", "53": "RS", "54": "RS", "55": "RS",
  "61": "DF",
  "62": "GO", "64": "GO",
  "63": "TO",
  "65": "MT", "66": "MT",
  "67": "MS",
  "68": "AC",
  "69": "RO",
  "71": "BA", "73": "BA", "74": "BA", "75": "BA", "77": "BA",
  "79": "SE",
  "81": "PE", "87": "PE",
  "82": "AL",
  "83": "PB",
  "84": "RN",
  "85": "CE", "88": "CE",
  "86": "PI", "89": "PI",
  "91": "PA", "93": "PA", "94": "PA",
  "92": "AM", "97": "AM",
  "95": "RR",
  "96": "AP",
  "98": "MA", "99": "MA",
};

function stateFromPhoneDdd(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return null;
  let national = digits;
  if (national.startsWith("55") && national.length >= 12) national = national.slice(2);
  if (national.startsWith("0") && national.length >= 11) national = national.slice(1);
  const ddd = national.slice(0, 2);
  return DDD_TO_STATE[ddd] ?? null;
}

function getDocumentType(c: UpZeroCustomer): "CPF" | "CNPJ" | null {
  if (c.wholesale_profile?.cnpj || c.customer_type === "WHOLESALE") return "CNPJ";
  if (c.retail_profile?.cpf || c.customer_type === "RETAIL") return "CPF";
  return null;
}

function mapRegistrationStatus(c: UpZeroCustomer): "PENDING" | "APPROVED" | "REJECTED" | null {
  if (boolLike(c.rejected) === true || boolLike(c.is_rejected) === true) return "REJECTED";
  if (boolLike(c.approved) === true || boolLike(c.is_approved) === true) return "APPROVED";
  const raw = firstString(c.registration_status, c.approval_status, c.lead_status, c.status)?.toLowerCase();
  if (!raw) return null;
  if (["approved", "aprovado", "accepted", "active", "qualified"].some((v) => raw.includes(v))) return "APPROVED";
  if (["rejected", "recusado", "declined", "denied", "canceled", "cancelado"].some((v) => raw.includes(v))) return "REJECTED";
  return "PENDING";
}

function getRegistrationDate(c: UpZeroCustomer, fallback = new Date()): Date {
  return firstDate(c.lead_created_at, c.registered_at, c.registration_date, c.created_at) ?? fallback;
}

function getApprovalDate(c: UpZeroCustomer, status: "PENDING" | "APPROVED" | "REJECTED" | null, fallback: Date): Date | null {
  const explicit = firstDate(c.approved_at, c.approval_date);
  if (explicit) return explicit;
  return status === "APPROVED" ? fallback : null;
}

function getCustomerUtm(c: UpZeroCustomer): {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
} {
  return {
    utmSource: firstString(c.utm_source, c.utm?.source),
    utmMedium: firstString(c.utm_medium, c.utm?.medium),
    utmCampaign: firstString(c.utm_campaign, c.utm?.campaign),
    utmContent: firstString(c.utm_content, c.utm?.content),
    utmTerm: firstString(c.utm_term, c.utm?.term),
  };
}

function getOrderUtm(o: UpZeroOrder): ReturnType<typeof getCustomerUtm> {
  return {
    utmSource: firstString(o.utm_source, o.customer?.utm_source, o.customer?.utm?.source),
    utmMedium: firstString(o.utm_medium, o.customer?.utm_medium, o.customer?.utm?.medium),
    utmCampaign: firstString(o.utm_campaign, o.customer?.utm_campaign, o.customer?.utm?.campaign),
    utmContent: firstString(o.utm_content, o.customer?.utm_content, o.customer?.utm?.content),
    utmTerm: firstString(o.utm_term, o.customer?.utm_term, o.customer?.utm?.term),
  };
}

function mapEventType(raw: string | null): "VISIT" | "REGISTRATION" | "APPROVED_REGISTRATION" | "PRODUCT_VIEW" | "ADD_TO_CART" | "CHECKOUT_STARTED" | "PURCHASE" | null {
  if (!raw) return null;
  const normalized = raw.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  if (/(approved|aprovado|approval|lead_approved|cadastro_aprovado)/.test(normalized)) return "APPROVED_REGISTRATION";
  if (/(registration|registered|register|lead|cadastro|signup|sign_up)/.test(normalized)) return "REGISTRATION";
  if (/(add_to_cart|cart|carrinho)/.test(normalized)) return "ADD_TO_CART";
  if (/(checkout|checkout_started|inicio_checkout|started_checkout)/.test(normalized)) return "CHECKOUT_STARTED";
  if (/(purchase|order|pedido|paid|payment|compra)/.test(normalized)) return "PURCHASE";
  if (/(product_view|view_product|produto_visualizado|view_item)/.test(normalized)) return "PRODUCT_VIEW";
  if (/(visit|page_view|session|visita)/.test(normalized)) return "VISIT";
  return null;
}

function getEventCreatedAt(e: UpZeroEvent): Date {
  return firstDate(e.occurred_at, e.created_at, e.timestamp) ?? new Date();
}

function getEventExternalId(e: UpZeroEvent, mappedType: string, customerExternalId: string | null, orderExternalId: string | null): string {
  if ((mappedType === "REGISTRATION" || mappedType === "APPROVED_REGISTRATION") && customerExternalId) {
    return mappedType === "APPROVED_REGISTRATION"
      ? `customer:${customerExternalId}`
      : `customer:${customerExternalId}:registration`;
  }
  if (mappedType === "PURCHASE" && orderExternalId) return `order:${orderExternalId}`;
  return `upzero:event:${e.id ?? e.event_id ?? `${mappedType}:${customerExternalId ?? "anon"}:${getEventCreatedAt(e).toISOString()}`}`;
}

function getItemRequestedQuantity(item: UpZeroOrderItem): number {
  const value = firstNumber(
    item.requested_quantity,
    item.quantity_requested,
    item.requested_qty,
    item.qty_requested,
    item.qtd_solicitada,
    item.qty,
    item.quantity,
  );
  return Math.max(1, Math.round(value ?? 1));
}

function getItemFulfilledQuantity(item: UpZeroOrderItem, requestedQuantity: number): number {
  const value = firstNumber(
    item.fulfilled_quantity,
    item.quantity_fulfilled,
    item.fulfilled_qty,
    item.qty_fulfilled,
    item.attended_qty,
    item.qtd_atendida,
  );
  return Math.max(0, Math.round(value ?? requestedQuantity));
}

function getOrderRequestedAmount(o: UpZeroOrder): number {
  return firstNumber(
    o.requested_amount,
    o.requested_total,
    o.amount_requested,
    o.total_requested,
    o.valor_solicitado,
    o.total,
    o.total_amount,
    o.amount,
    o.subtotal,
  ) ?? 0;
}

function getOrderFulfilledAmount(o: UpZeroOrder, requestedAmount: number, status: ReturnType<typeof mapOrderStatus>): number {
  const explicit = firstNumber(
    o.fulfilled_amount,
    o.fulfilled_total,
    o.amount_fulfilled,
    o.total_fulfilled,
    o.attended_amount,
    o.valor_atendido,
    o.total,
    o.total_amount,
    o.amount,
  );
  if (explicit !== null) return explicit;
  return status === "APPROVED" || status === "SHIPPED" || status === "DELIVERED" ? requestedAmount : 0;
}

async function updateExistingFunnelEvents(
  clientId: string,
  eventType: "REGISTRATION" | "APPROVED_REGISTRATION" | "PURCHASE",
  values: Array<{ externalSourceId: string; customerId: string | null; createdAt: Date }>,
): Promise<void> {
  const BATCH = 200;
  for (let i = 0; i < values.length; i += BATCH) {
    const batch = values.slice(i, i + BATCH);
    if (batch.length === 0) continue;
    await db.execute(sql`
      UPDATE events e
      SET
        customer_id = COALESCE(v.customer_id, e.customer_id),
        created_at = v.created_at::timestamptz
      FROM (
        VALUES ${sql.join(
          batch.map((v) => sql`(${v.externalSourceId}, ${v.customerId}, ${v.createdAt})`),
          sql`, `,
        )}
      ) AS v(external_source_id, customer_id, created_at)
      WHERE e.client_id = ${clientId}
        AND e.event_type = ${eventType}
        AND e.external_source_id = v.external_source_id
    `);
  }
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
  let upEvents: UpZeroEvent[] = [];

  try {
    [upCustomers, upOrders, upProducts, upEvents] = await Promise.all([
      fetchAllPages<UpZeroCustomer>(apiKey, "/external/v1/customers"),
      fetchAllPages<UpZeroOrder>(apiKey, "/external/v1/orders", orderDateParams),
      fetchAllCursorPages<UpZeroProduct>(apiKey, "/external/v1/products"),
      fetchOptionalPages<UpZeroEvent>(apiKey, "/external/v1/events", orderDateParams),
    ]);
    upCustomers = await backfillCustomersByNumericId(clientId, apiKey, upCustomers);
  } catch (err) {
    result.errors.push(String(err));
    return result;
  }

  // ── 1. Product sync ──────────────────────────────────────────────────────

  // Build a map of variantId → {size, color} for use in order item sync
  const variantAttrs = new Map<string, { size: string | null; color: string | null }>();

  // Collect ONE representative active variant per product for inventory lookup.
  // Fetching all variants would require ~15k+ individual API calls which always
  // exceed the 60s budget, leaving most products at stock=0.  One call per
  // product (~956 calls total) fits comfortably within the budget and ensures
  // every product gets a real stock number rather than showing zero.
  // The stored stock reflects that one representative variant's qty_available;
  // a dedicated stock-refresh job (Task #71) will later provide full precision.
  const inventoryTargets: Array<{
    productExternalId: string;
    sku: string;
  }> = [];

  for (const p of upProducts) {
    let representativeSku: string | null = null;
    for (const v of p.variants ?? []) {
      const isActive = v.active !== false;
      if (v.sku) {
        const size = extractVariantAttribute(v.attributes, ["size", "tamanho"]);
        const color = extractVariantAttribute(v.attributes, ["cor", "color", "colour"]);
        variantAttrs.set(v.id, { size, color });
        // Pick the first active variant as the inventory representative
        if (isActive && !representativeSku) {
          representativeSku = v.sku;
        }
      }
    }
    if (representativeSku) {
      inventoryTargets.push({ productExternalId: p.id, sku: representativeSku });
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

  // Product photos are exposed by UP Zero on a dedicated per-product endpoint:
  // /external/v1/products/{product_id}/images. Prefer any URL already present
  // in the product payload, then fill gaps from that endpoint.
  const imageUrlByProduct = new Map<string, string>();
  const imageTargets: UpZeroProduct[] = [];
  for (const p of upProducts) {
    const directImageUrl = extractProductImageUrl(p);
    if (directImageUrl) {
      imageUrlByProduct.set(p.id, directImageUrl);
    } else {
      imageTargets.push(p);
    }
  }

  if (imageTargets.length > 0) {
    const fetchedImages = await runConcurrent(
      imageTargets,
      PRODUCT_IMAGE_CONCURRENCY,
      async (p) => {
        const ids = Array.from(
          new Set([p.product_id, p.id].filter(Boolean).map((id) => String(id))),
        );
        for (const id of ids) {
          const imageUrl = await fetchProductImageUrl(apiKey, id);
          if (imageUrl) return { productExternalId: p.id, imageUrl };
        }
        return { productExternalId: p.id, imageUrl: null };
      },
    );
    let imagesFound = 0;
    for (const { productExternalId, imageUrl } of fetchedImages) {
      if (!imageUrl) continue;
      imageUrlByProduct.set(productExternalId, imageUrl);
      imagesFound++;
    }
    console.log(
      `[upzero-sync] product images endpoint: found ${imagesFound}/${imageTargets.length} missing image URLs`,
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
      const category = inferProductCategory(p);
      const imageUrl = imageUrlByProduct.get(p.id) ?? null;

      if (existingProductByExtId.has(p.id)) {
        // Row already linked to this UP Zero product — update in place.
        const internalId = existingProductByExtId.get(p.id)!;
        await db
          .update(productsTable)
          .set({ sku, name: buildProductName(p), category, imageUrl: imageUrl ?? undefined, price, cost: cost ?? undefined, ...stockFields, status })
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
            name: buildProductName(p),
            category,
            imageUrl: imageUrl ?? undefined,
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
            name: buildProductName(p),
            category,
            imageUrl,
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

  // Maps externalCustomerId → customer timestamps used by real/synthesized
  // funnel events. registrationDate now comes from the UP Zero lead creation
  // date instead of the sync time.
  const externalToInternalCustomer = new Map<string, {
    id: string;
    registrationDate: Date;
    approvalDate: Date | null;
    status: "PENDING" | "APPROVED" | "REJECTED";
  }>();

  if (upCustomers.length > 0) {
    const externalIds = upCustomers.map((c) => c.id);

    const existing = await db
      .select({
        id: customersTable.id,
        externalId: customersTable.externalId,
        approvalDate: customersTable.approvalDate,
        createdAt: customersTable.createdAt,
        registrationStatus: customersTable.registrationStatus,
      })
      .from(customersTable)
      .where(
        and(
          eq(customersTable.clientId, clientId),
          inArray(customersTable.externalId, externalIds),
        ),
      );

    const existingByExtId = new Map<string, {
      id: string;
      registrationDate: Date;
      approvalDate: Date | null;
      status: "PENDING" | "APPROVED" | "REJECTED";
    }>();
    for (const row of existing) {
      if (row.externalId) {
        existingByExtId.set(row.externalId, {
          id: row.id,
          registrationDate: row.createdAt,
          approvalDate: row.approvalDate,
          status: row.registrationStatus as "PENDING" | "APPROVED" | "REJECTED",
        });
      }
    }

    const emails = upCustomers
      .filter((c) => c.email && !existingByExtId.has(c.id))
      .map((c) => c.email as string);

    const existingByEmail = new Map<string, {
      id: string;
      registrationDate: Date;
      approvalDate: Date | null;
      status: "PENDING" | "APPROVED" | "REJECTED";
    }>();
    if (emails.length > 0) {
      const emailRows = await db
        .select({
          id: customersTable.id,
          email: customersTable.email,
          approvalDate: customersTable.approvalDate,
          createdAt: customersTable.createdAt,
          registrationStatus: customersTable.registrationStatus,
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
          registrationDate: row.createdAt,
          approvalDate: row.approvalDate,
          status: row.registrationStatus as "PENDING" | "APPROVED" | "REJECTED",
        });
      }
    }

    for (const c of upCustomers) {
      try {
        const state = getAddressState(c) ?? stateFromPhoneDdd(c.phone);
        const city = getAddressCity(c);
        const documentType = getDocumentType(c);
        const email = c.email ?? `upzero-${c.id}@noemail.internal`;
        const apiRegistrationStatus = mapRegistrationStatus(c);
        const registrationDate = getRegistrationDate(c);
        const utm = getCustomerUtm(c);

        if (existingByExtId.has(c.id)) {
          const entry = existingByExtId.get(c.id)!;
          const registrationStatus = apiRegistrationStatus ?? entry.status;
          const approvalDate = getApprovalDate(c, registrationStatus, entry.approvalDate ?? registrationDate);
          const mapped = { id: entry.id, registrationDate, approvalDate, status: registrationStatus };
          externalToInternalCustomer.set(c.id, mapped);
          await db
            .update(customersTable)
            .set({
              email: c.email ?? undefined,
              name: buildCustomerName(c.name) ?? undefined,
              phone: c.phone ?? undefined,
              documentType: documentType ?? undefined,
              state: state ?? undefined,
              city: city ?? undefined,
              ...utm,
              registrationStatus,
              approvalDate,
              createdAt: registrationDate,
            })
            .where(
              and(
                eq(customersTable.clientId, clientId),
                eq(customersTable.id, entry.id),
              ),
            );
          result.customersUpdated++;
        } else if (c.email && existingByEmail.has(c.email)) {
          const { id: internalId, status: existingStatus, approvalDate: existingApprovalDate } = existingByEmail.get(c.email)!;
          const registrationStatus = apiRegistrationStatus ?? existingStatus;
          const approvalDate = getApprovalDate(c, registrationStatus, existingApprovalDate ?? registrationDate);
          externalToInternalCustomer.set(c.id, { id: internalId, registrationDate, approvalDate, status: registrationStatus });
          await db
            .update(customersTable)
            .set({
              externalId: c.id,
              name: buildCustomerName(c.name) ?? undefined,
              phone: c.phone ?? undefined,
              documentType: documentType ?? undefined,
              state: state ?? undefined,
              city: city ?? undefined,
              ...utm,
              registrationStatus,
              approvalDate,
              createdAt: registrationDate,
            })
            .where(
              and(
                eq(customersTable.clientId, clientId),
                eq(customersTable.id, internalId),
              ),
            );
          result.customersUpdated++;
        } else {
          const registrationStatus = apiRegistrationStatus ?? "PENDING";
          const approvalDate = getApprovalDate(c, registrationStatus, registrationDate);
          const [upserted] = await db
            .insert(customersTable)
            .values({
              clientId,
              externalId: c.id,
              email,
              name: buildCustomerName(c.name),
              phone: c.phone ?? null,
              documentType,
              state,
              city,
              ...utm,
              registrationStatus,
              approvalDate,
              createdAt: registrationDate,
            })
            .onConflictDoUpdate({
              target: [customersTable.clientId, customersTable.externalId],
              set: {
                email,
                name: buildCustomerName(c.name),
                phone: c.phone ?? null,
                documentType,
                state,
                city,
                ...utm,
                registrationStatus,
                approvalDate,
                createdAt: registrationDate,
              },
            })
            .returning({
              id: customersTable.id,
              wasInserted: sql<boolean>`(xmax = 0)`,
          });
          if (upserted) {
            externalToInternalCustomer.set(c.id, { id: upserted.id, registrationDate, approvalDate, status: registrationStatus });
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
  const externalToInternalOrder = new Map<string, {
    id: string;
    customerId: string;
    createdAt: Date;
  }>();

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
      const activeItems = (o.items ?? []).filter((item) => item.status !== "removed");
      const itemQuantities = activeItems.map((item) => {
        const requested = getItemRequestedQuantity(item);
        return { requested, fulfilled: getItemFulfilledQuantity(item, requested) };
      });
      const requestedQuantity = Math.max(
        0,
        Math.round(
          firstNumber(o.requested_quantity, o.requested_items_qty, o.quantity_requested, o.qty_requested, o.qtd_solicitada) ??
            itemQuantities.reduce((sum, item) => sum + item.requested, 0),
        ),
      );
      const fulfilledQuantity = Math.max(
        0,
        Math.round(
          firstNumber(o.fulfilled_quantity, o.total_items_qty, o.quantity_fulfilled, o.qty_fulfilled, o.attended_quantity, o.qtd_atendida) ??
            itemQuantities.reduce((sum, item) => sum + item.fulfilled, 0),
        ),
      );
      // `amount` is intentionally the requested value because the dashboard's
      // revenue KPIs and product sales views represent demand/solicitation.
      const amount = getOrderRequestedAmount(o);
      const fulfilledAmount = getOrderFulfilledAmount(o, amount, status);
      const createdAt = new Date(o.created_at);
      const approvalDate =
        status === "APPROVED" || status === "SHIPPED" || status === "DELIVERED" ? createdAt : undefined;

      const uzCustomer = o.customer;
      let customerId: string | null = null;

      if (uzCustomer) {
        customerId = externalToInternalCustomer.get(uzCustomer.id)?.id ?? null;

        if (!customerId) {
          const email =
            uzCustomer.email ??
            `upzero-${uzCustomer.id}@noemail.internal`;
          const state = getAddressState(uzCustomer) ?? stateFromPhoneDdd(uzCustomer.phone);
          const city = getAddressCity(uzCustomer);
          const documentType = getDocumentType(uzCustomer);
          const registrationStatus = mapRegistrationStatus(uzCustomer) ?? "APPROVED";
          const registrationDate = getRegistrationDate(uzCustomer);
          const approvalDate = getApprovalDate(uzCustomer, registrationStatus, registrationDate);
          const utm = getCustomerUtm(uzCustomer);
          const [upsertedCust] = await db
            .insert(customersTable)
            .values({
              clientId,
              externalId: uzCustomer.id,
              email,
              name: buildCustomerName(uzCustomer.name),
              phone: uzCustomer.phone ?? null,
              documentType,
              state,
              city,
              ...utm,
              registrationStatus,
              approvalDate,
              createdAt: registrationDate,
            })
            .onConflictDoUpdate({
              target: [customersTable.clientId, customersTable.externalId],
              set: {
                name: buildCustomerName(uzCustomer.name),
                phone: uzCustomer.phone ?? null,
                documentType,
                state,
                city,
                ...utm,
                registrationStatus,
                approvalDate,
                createdAt: registrationDate,
              },
            })
            .returning({
              id: customersTable.id,
              wasInserted: sql<boolean>`(xmax = 0)`,
            });
          if (upsertedCust) {
            customerId = upsertedCust.id;
            externalToInternalCustomer.set(uzCustomer.id, { id: upsertedCust.id, registrationDate, approvalDate, status: registrationStatus });
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
      const orderUtm = getOrderUtm(o);
      if (orderUtm.utmSource || orderUtm.utmMedium || orderUtm.utmCampaign || orderUtm.utmContent || orderUtm.utmTerm) {
        await db
          .update(customersTable)
          .set(orderUtm)
          .where(
            and(
              eq(customersTable.clientId, clientId),
              eq(customersTable.id, customerId),
            ),
          );
      }

      let internalOrderId: string;

      if (existingOrderByExtId.has(o.id)) {
        internalOrderId = existingOrderByExtId.get(o.id)!;
        await db
          .update(ordersTable)
          .set({ requestedQuantity, fulfilledQuantity, amount, fulfilledAmount, status, state, city })
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
            requestedQuantity,
            fulfilledQuantity,
            amount,
            fulfilledAmount,
            status,
            approvalDate,
            state,
            city,
            createdAt,
          })
          .onConflictDoUpdate({
            target: [ordersTable.clientId, ordersTable.externalId],
            set: { requestedQuantity, fulfilledQuantity, amount, fulfilledAmount, status, state, city },
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
      externalToInternalOrder.set(o.id, { id: internalOrderId, customerId, createdAt });

      // Collect approved/shipped orders as PURCHASE event candidates
      if (status === "APPROVED" || status === "SHIPPED" || status === "DELIVERED") {
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
        const requestedItemQuantity = getItemRequestedQuantity(item);
        const fulfilledItemQuantity = getItemFulfilledQuantity(item, requestedItemQuantity);
        try {
          await db.insert(orderItemsTable).values({
            orderId: internalOrderId,
            productId: localProductId,
            quantity: requestedItemQuantity,
            fulfilledQuantity: fulfilledItemQuantity,
            priceAtSale: firstNumber(item.unit_price) ?? 0,
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

  const allCustomerRows = await db
    .select({
      id: customersTable.id,
      externalId: customersTable.externalId,
      createdAt: customersTable.createdAt,
      approvalDate: customersTable.approvalDate,
      registrationStatus: customersTable.registrationStatus,
    })
    .from(customersTable)
    .where(eq(customersTable.clientId, clientId));
  for (const row of allCustomerRows) {
    if (!row.externalId || externalToInternalCustomer.has(row.externalId)) continue;
    externalToInternalCustomer.set(row.externalId, {
      id: row.id,
      registrationDate: row.createdAt,
      approvalDate: row.approvalDate,
      status: row.registrationStatus as "PENDING" | "APPROVED" | "REJECTED",
    });
  }

  // ── 4. Synthesize funnel events ───────────────────────────────────────────
  //
  // First insert real UP Zero funnel events when available, then synthesize
  // registration/approval/purchase events that are missing from older API
  // payloads. We use stable external_source_id values so re-running sync never
  // creates duplicates.

  const realEventValues = [];
  for (const e of upEvents) {
    const rawType = firstString(e.event_type, e.type, e.name);
    const eventType = mapEventType(rawType);
    if (!eventType) continue;

    const orderExternalId = e.order_id !== undefined && e.order_id !== null ? String(e.order_id) : null;
    const orderMatch = orderExternalId ? externalToInternalOrder.get(orderExternalId) : undefined;
    const customerExternalId =
      e.customer?.id ??
      (e.customer_id !== undefined && e.customer_id !== null ? String(e.customer_id) : null) ??
      null;
    const customerMatch = customerExternalId ? externalToInternalCustomer.get(customerExternalId) : undefined;
    const productExternalId = e.product_id !== undefined && e.product_id !== null ? String(e.product_id) : null;
    const productId =
      (productExternalId ? existingProductByExtId.get(productExternalId) : undefined) ??
      (e.sku ? skuToLocalProductId.get(e.sku) : undefined) ??
      null;
    const customerId = customerMatch?.id ?? orderMatch?.customerId ?? null;
    const orderId = orderMatch?.id ?? null;

    realEventValues.push({
      clientId,
      customerId,
      productId,
      orderId,
      eventType,
      externalSourceId: getEventExternalId(e, eventType, customerExternalId, orderExternalId),
      metadata: {
        source: "upzero",
        rawType,
        metadata: e.metadata ?? null,
      },
      createdAt: getEventCreatedAt(e),
    });
  }

  if (realEventValues.length > 0) {
    const BATCH = 200;
    for (let i = 0; i < realEventValues.length; i += BATCH) {
      const batch = realEventValues.slice(i, i + BATCH);
      const inserted = await db
        .insert(eventsTable)
        .values(batch)
        .onConflictDoNothing()
        .returning({ id: eventsTable.id });
      result.eventsCreated += inserted.length;
    }
  }

  // 4a. REGISTRATION / APPROVED_REGISTRATION events from synced customers.
  // REGISTRATION uses the UP Zero lead creation date; approvals use the real
  // approval date/status when present.
  const customerEventValues = [];
  for (const [externalCustomerId, { id: internalCustomerId, registrationDate, approvalDate, status }] of externalToInternalCustomer) {
    customerEventValues.push({
      clientId,
      customerId: internalCustomerId,
      eventType: "REGISTRATION" as const,
      externalSourceId: `customer:${externalCustomerId}:registration`,
      createdAt: registrationDate,
    });
    if (status !== "APPROVED" || !approvalDate) continue;
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
    await updateExistingFunnelEvents(
      clientId,
      "REGISTRATION",
      customerEventValues
        .filter((event) => event.eventType === "REGISTRATION")
        .map((event) => ({
          externalSourceId: event.externalSourceId,
          customerId: event.customerId,
          createdAt: event.createdAt,
        })),
    );
    await updateExistingFunnelEvents(
      clientId,
      "APPROVED_REGISTRATION",
      customerEventValues
        .filter((event) => event.eventType === "APPROVED_REGISTRATION")
        .map((event) => ({
          externalSourceId: event.externalSourceId,
          customerId: event.customerId,
          createdAt: event.createdAt,
        })),
    );
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
    await updateExistingFunnelEvents(
      clientId,
      "PURCHASE",
      purchaseEventValues.map((event) => ({
        externalSourceId: event.externalSourceId,
        customerId: event.customerId,
        createdAt: event.createdAt,
      })),
    );
  }

  console.log(
    `[upzero-sync] events synced — real: ${realEventValues.length}, ` +
    `customer funnel candidates: ${customerEventValues.length}, ` +
    `PURCHASE candidates: ${purchaseEventValues.length}, new events inserted: ${result.eventsCreated}`,
  );

  // ── 5. Zero-records detection ─────────────────────────────────────────────
  // If every fetch returned 0 records and there were no errors, that almost
  // certainly means the API response shape doesn't match what we expect.
  // Surface a clear warning instead of silently succeeding with all-zeros.
  const totalFetched = upOrders.length + upCustomers.length + upProducts.length + upEvents.length;
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
      `customers: ${upCustomers.length}, products: ${upProducts.length}, events: ${upEvents.length}`,
    );
  }

  // ── 6. Post-sync aggregations ─────────────────────────────────────────────

  // Full recompute for all products belonging to this client.
  // Product/customer lists represent sales activity by item, so rejected orders
  // are excluded but pending/reserved orders still contribute. Faturamento KPIs
  // remain stricter and use APPROVED/SHIPPED/DELIVERED only.
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
              AND o.status <> 'REJECTED'
          ), 0
        )::int AS total_qty,
        COALESCE(
          SUM(oi.quantity * oi.price_at_sale) FILTER (
            WHERE o.id IS NOT NULL
              AND o.client_id = ${clientId}
              AND o.status <> 'REJECTED'
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

  await db.execute(sql`
    UPDATE customers c
    SET
      total_orders      = COALESCE(agg.total_orders, 0),
      total_spent       = COALESCE(agg.total_spent, 0),
      first_purchase_at = agg.first_purchase_at,
      last_purchase_at  = agg.last_purchase_at
    FROM (
      SELECT
        c2.id AS customer_id,
        COUNT(o.id) FILTER (
          WHERE o.id IS NOT NULL
            AND o.client_id = ${clientId}
            AND o.status <> 'REJECTED'
        )::int AS total_orders,
        COALESCE(
          SUM(o.amount) FILTER (
            WHERE o.id IS NOT NULL
              AND o.client_id = ${clientId}
              AND o.status <> 'REJECTED'
          ), 0
        )::float AS total_spent,
        MIN(o.created_at) FILTER (
          WHERE o.id IS NOT NULL
            AND o.client_id = ${clientId}
            AND o.status <> 'REJECTED'
        ) AS first_purchase_at,
        MAX(o.created_at) FILTER (
          WHERE o.id IS NOT NULL
            AND o.client_id = ${clientId}
            AND o.status <> 'REJECTED'
        ) AS last_purchase_at
      FROM customers c2
      LEFT JOIN orders o ON o.customer_id = c2.id
      WHERE c2.client_id = ${clientId}
      GROUP BY c2.id
    ) agg
    WHERE c.id = agg.customer_id
      AND c.client_id = ${clientId}
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
