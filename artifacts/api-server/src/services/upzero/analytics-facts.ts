import type { UpzeroAnalyticsMetric } from "./analytics-metrics";

const UPZERO_ANALYTICS_FACTS_URL =
  "https://api.upzero.com.br/external/v1/analytics/facts";

export type GetUpzeroAnalyticsFactsParams = {
  from: string;
  to?: string;
  apiKey?: string | null;
  limit?: number;
  cursor?: string | null;
  eventName?: string;
  userId?: number;
  sessionId?: string;
  visitorId?: string;
  anonymousId?: string;
  productId?: number;
  orderId?: number;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
};

export type UpzeroAnalyticsFact = {
  id: number;
  occurred_at: string;
  event_id: string;
  event_name: string;
  user_id: number | null;
  user?: UpzeroAnalyticsMetric["user"];
  anonymous_id: string | null;
  session_id: string | null;
  visitor_id: string | null;
  fbclid: string | null;
  fbc: string | null;
  fbp: string | null;
  gclid: string | null;
  landing_url: string | null;
  landing_host: string | null;
  landing_path: string | null;
  referrer: string | null;
  referrer_host: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  source: string | null;
  channel: string | null;
  device_type: string | null;
  product_id: number | null;
  product?: UpzeroAnalyticsMetric["product"];
  product_variant_id: number | null;
  category_id: number | null;
  category?: UpzeroAnalyticsMetric["category"];
  order_id: number | null;
  quantity: number | null;
  value: number | null;
};

export type UpzeroAnalyticsFactsResponse = {
  data: UpzeroAnalyticsFact[];
  total: number;
  next_cursor: string | null;
};

function resolveUpzeroApiKey(explicitApiKey?: string | null): string {
  const raw = explicitApiKey ?? process.env.UPZERO_API_TOKEN ?? process.env.UPZERO_CELEB_API_KEY;
  const apiKey = raw?.trim().replace(/^Bearer\s+/i, "");
  if (!apiKey) {
    throw new Error("UPZERO_API_TOKEN não definido.");
  }
  return apiKey;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseProduct(row: Record<string, unknown>): UpzeroAnalyticsMetric["product"] {
  const product = asRecord(row.product);
  const id = nullableNumber(product?.id) ?? nullableNumber(row.product_id);
  if (id === null) return null;
  return {
    id,
    name: nullableString(product?.name) ?? "",
    sku: nullableString(product?.sku) ?? "",
  };
}

function parseCategory(row: Record<string, unknown>): UpzeroAnalyticsMetric["category"] {
  const category = asRecord(row.category);
  const id = nullableNumber(category?.id) ?? nullableNumber(row.category_id);
  if (id === null) return null;
  return {
    id,
    name: nullableString(category?.name) ?? "",
  };
}

function parseUser(value: unknown): UpzeroAnalyticsMetric["user"] {
  const record = asRecord(value);
  if (!record) return null;
  const id = nullableNumber(record.id);
  if (id === null) return null;
  return {
    id,
    type: nullableString(record.type),
    name: nullableString(record.name),
    cpf: nullableString(record.cpf),
    cnpj: nullableString(record.cnpj),
    company_name: nullableString(record.company_name),
  };
}

function parseFact(value: unknown): UpzeroAnalyticsFact | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = nullableNumber(row.id);
  const occurredAt = nullableString(row.occurred_at);
  const eventId = nullableString(row.event_id);
  const eventName = nullableString(row.event_name);
  if (id === null || !occurredAt || !eventId || !eventName) return null;
  return {
    id,
    occurred_at: occurredAt,
    event_id: eventId,
    event_name: eventName,
    user_id: nullableNumber(row.user_id),
    user: parseUser(row.user),
    anonymous_id: nullableString(row.anonymous_id),
    session_id: nullableString(row.session_id),
    visitor_id: nullableString(row.visitor_id),
    fbclid: nullableString(row.fbclid),
    fbc: nullableString(row.fbc),
    fbp: nullableString(row.fbp),
    gclid: nullableString(row.gclid),
    landing_url: nullableString(row.landing_url),
    landing_host: nullableString(row.landing_host),
    landing_path: nullableString(row.landing_path),
    referrer: nullableString(row.referrer),
    referrer_host: nullableString(row.referrer_host),
    utm_source: nullableString(row.utm_source),
    utm_medium: nullableString(row.utm_medium),
    utm_campaign: nullableString(row.utm_campaign),
    utm_content: nullableString(row.utm_content),
    utm_term: nullableString(row.utm_term),
    source: nullableString(row.source),
    channel: nullableString(row.channel),
    device_type: nullableString(row.device_type),
    product_id: nullableNumber(row.product_id),
    product: parseProduct(row),
    product_variant_id: nullableNumber(row.product_variant_id),
    category_id: nullableNumber(row.category_id),
    category: parseCategory(row),
    order_id: nullableNumber(row.order_id),
    quantity: nullableNumber(row.quantity),
    value: nullableNumber(row.value),
  };
}

function parseFactsResponse(value: unknown): UpzeroAnalyticsFactsResponse {
  const record = asRecord(value);
  const rawRows = Array.isArray(record?.data) ? record.data : [];
  return {
    data: rawRows.map(parseFact).filter((row): row is UpzeroAnalyticsFact => row !== null),
    total: numberValue(record?.total, rawRows.length),
    next_cursor: nullableString(record?.next_cursor),
  };
}

export async function getUpzeroAnalyticsFacts({
  from,
  to,
  apiKey: explicitApiKey,
  limit = 1000,
  cursor,
  eventName,
  userId,
  sessionId,
  visitorId,
  anonymousId,
  productId,
  orderId,
  utmSource,
  utmMedium,
  utmCampaign,
}: GetUpzeroAnalyticsFactsParams): Promise<UpzeroAnalyticsFactsResponse> {
  const apiKey = resolveUpzeroApiKey(explicitApiKey);
  const url = new URL(UPZERO_ANALYTICS_FACTS_URL);
  url.searchParams.set("from", from);
  if (to) url.searchParams.set("to", to);
  url.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 1000)));
  if (cursor) url.searchParams.set("cursor", cursor);
  if (eventName) url.searchParams.set("event_name", eventName);
  if (typeof userId === "number") url.searchParams.set("user_id", String(userId));
  if (sessionId) url.searchParams.set("session_id", sessionId);
  if (visitorId) url.searchParams.set("visitor_id", visitorId);
  if (anonymousId) url.searchParams.set("anonymous_id", anonymousId);
  if (typeof productId === "number") url.searchParams.set("product_id", String(productId));
  if (typeof orderId === "number") url.searchParams.set("order_id", String(orderId));
  if (utmSource) url.searchParams.set("utm_source", utmSource);
  if (utmMedium) url.searchParams.set("utm_medium", utmMedium);
  if (utmCampaign) url.searchParams.set("utm_campaign", utmCampaign);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "X-API-Key": apiKey,
      Accept: "application/json",
    },
  });

  const text = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Resposta inválida da UP Zero facts: ${text}`);
  }

  if (!response.ok) {
    throw new Error(`Erro UP Zero facts ${response.status}: ${JSON.stringify(payload)}`);
  }

  return parseFactsResponse(payload);
}

export function factToAnalyticsMetric(fact: UpzeroAnalyticsFact): UpzeroAnalyticsMetric {
  return {
    id: fact.id,
    period_start: fact.occurred_at,
    period_type: "event",
    event_name: fact.event_name,
    product: fact.product,
    product_image_url: null,
    product_variant: fact.product_variant_id !== null ? { id: fact.product_variant_id } : null,
    category: fact.category,
    user: fact.user ?? null,
    user_id: fact.user_id,
    order_id: fact.order_id,
    utm_source: fact.utm_source,
    utm_medium: fact.utm_medium,
    utm_campaign: fact.utm_campaign,
    source: fact.source,
    channel: fact.channel,
    device_type: fact.device_type,
    total_events: 1,
    unique_users: fact.user_id !== null || fact.user ? 1 : 0,
    unique_sessions: fact.session_id ? 1 : 0,
    total_quantity: fact.quantity ?? 0,
    total_value: fact.value ?? 0,
    updated_at: fact.occurred_at,
    event_id: fact.event_id,
    anonymous_id: fact.anonymous_id,
    session_id: fact.session_id,
    visitor_id: fact.visitor_id,
    fbclid: fact.fbclid,
    fbc: fact.fbc,
    fbp: fact.fbp,
    gclid: fact.gclid,
    landing_url: fact.landing_url,
    landing_host: fact.landing_host,
    landing_path: fact.landing_path,
    referrer: fact.referrer,
    referrer_host: fact.referrer_host,
    utm_content: fact.utm_content,
    utm_term: fact.utm_term,
  };
}

export async function getUpzeroAnalyticsFactsAsMetrics(
  params: GetUpzeroAnalyticsFactsParams,
): Promise<UpzeroAnalyticsMetric[]> {
  const rows: UpzeroAnalyticsMetric[] = [];
  let cursor = params.cursor ?? null;
  const seenCursors = new Set<string>();

  for (let page = 0; page < 50; page += 1) {
    const response = await getUpzeroAnalyticsFacts({ ...params, cursor, limit: params.limit ?? 1000 });
    rows.push(...response.data.map(factToAnalyticsMetric));
    if (!response.next_cursor || seenCursors.has(response.next_cursor)) break;
    seenCursors.add(response.next_cursor);
    cursor = response.next_cursor;
  }

  return rows;
}
