const UPZERO_ANALYTICS_METRICS_URL =
  "https://api.upzero.com.br/external/v1/analytics/metrics";

export type GetUpzeroAnalyticsMetricsParams = {
  from: string;
  to: string;
  apiKey?: string | null;
};

export type UpzeroAnalyticsResponse = {
  data: UpzeroAnalyticsMetric[];
  total: number;
};

export type UpzeroAnalyticsMetric = {
  id: number;
  period_start: string;
  period_type: string;
  event_name: string;
  product: {
    id: number;
    name: string;
    sku: string;
  } | null;
  product_variant: unknown | null;
  category: {
    id: number;
    name: string;
  } | null;
  user: {
    id: number;
    type: string | null;
    name: string | null;
    cpf: string | null;
    cnpj: string | null;
    company_name: string | null;
  } | null;
  user_id: number | null;
  order_id: number | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  source: string | null;
  channel: string | null;
  device_type: string | null;
  total_events: number;
  unique_users: number;
  unique_sessions: number;
  total_quantity: number;
  total_value: number;
  updated_at: string;
  event_id?: string | null;
  anonymous_id?: string | null;
  session_id?: string | null;
  visitor_id?: string | null;
  fbclid?: string | null;
  fbc?: string | null;
  fbp?: string | null;
  gclid?: string | null;
  landing_url?: string | null;
  landing_host?: string | null;
  landing_path?: string | null;
  referrer?: string | null;
  referrer_host?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
};

export type UpzeroMetricUser = {
  id: number;
  type: string | null;
  name: string | null;
  cpf: string | null;
  cnpj: string | null;
  companyName: string | null;
};

export type CustomerTimelineEvent = {
  id: string;
  userId: number;
  occurredAt: string;
  periodType: string;
  eventName: string;
  eventLabel: string;
  productId: number | null;
  productName: string | null;
  productSku: string | null;
  categoryId: number | null;
  categoryName: string | null;
  orderId: number | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  normalizedSource: string;
  normalizedMedium: string;
  deviceType: string | null;
  totalEvents: number;
  totalQuantity: number;
  totalValue: number;
  attributionType:
    | "first_touch"
    | "last_touch"
    | "return_touch"
    | "direct"
    | null;
  rawMetricId: number;
  updatedAt: string;
  eventId: string | null;
  anonymousId: string | null;
  sessionId: string | null;
  visitorId: string | null;
  fbclid: string | null;
  fbc: string | null;
  fbp: string | null;
  gclid: string | null;
  landingUrl: string | null;
  landingHost: string | null;
  landingPath: string | null;
  referrer: string | null;
  referrerHost: string | null;
  utmContent: string | null;
  utmTerm: string | null;
};

type TimelineTouch = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  occurredAt: string | null;
};

export type CustomerTimelineResponse = {
  userId: number;
  attribution: {
    firstTouch: TimelineTouch;
    lastTouch: TimelineTouch;
    lastReturn: TimelineTouch;
  };
  summary: {
    totalEvents: number;
    productViews: number;
    categoryViews: number;
    formStarts: number;
    registerStarts: number;
    registerSubmitted: number;
    logins: number;
    addToCartEvents: number;
    checkoutStarts: number;
    purchases: number;
    totalCartValue: number;
    totalPurchaseValue: number;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
  };
  timeline: CustomerTimelineEvent[];
};

const EVENT_LABELS: Record<string, string> = {
  page_view: "Visualizou página",
  product_view: "Visualizou produto",
  product_item_impression: "Visualizou produto",
  product_item_click: "Clicou no produto",
  category_view: "Visualizou categoria",
  form_start: "Iniciou formulário",
  register_start: "Iniciou cadastro",
  register_submitted: "Enviou cadastro",
  login: "Fez login",
  add_to_cart: "Adicionou ao carrinho",
  initiate_checkout: "Iniciou checkout",
  checkout_start: "Iniciou checkout",
  purchase: "Realizou compra",
  order_created: "Pedido criado",
  order_paid: "Pedido pago",
  payment_approved: "Pagamento aprovado",
};

const EVENT_PRIORITY: Record<string, number> = {
  page_view: 10,
  category_view: 20,
  product_view: 30,
  product_item_impression: 31,
  product_item_click: 32,
  form_start: 40,
  register_start: 50,
  register_submitted: 60,
  login: 70,
  add_to_cart: 80,
  initiate_checkout: 90,
  checkout_start: 90,
  purchase: 100,
  order_created: 105,
  order_paid: 110,
  payment_approved: 120,
};

const CONVERSION_EVENTS = new Set([
  "register_submitted",
  "add_to_cart",
  "initiate_checkout",
  "checkout_start",
  "purchase",
  "order_created",
  "order_paid",
  "payment_approved",
]);

const CHECKOUT_EVENTS = new Set(["initiate_checkout", "checkout_start"]);
const PURCHASE_VALUE_EVENTS = new Set(["purchase", "order_paid", "payment_approved"]);
const DEFAULT_LOOKBACK_DAYS = 30;

export function getEventLabel(eventName: string): string {
  return EVENT_LABELS[eventName] ?? eventName;
}

export function getEventPriority(eventName: string): number {
  return EVENT_PRIORITY[eventName] ?? 999;
}

export function normalizeSource(source: string | null): string {
  const value = source?.toLowerCase().trim();
  if (!value) return "Direto / Não identificado";
  if (["ig", "instagram"].includes(value)) return "Instagram";
  if (["fb", "facebook"].includes(value)) return "Facebook";
  if (["an", "audience_network"].includes(value)) return "Audience Network";
  return source ?? "Direto / Não identificado";
}

export function normalizeMedium(medium: string | null): string {
  const value = medium?.toLowerCase().trim();
  if (!value) return "Não identificado";
  if (value.includes("instagram_feed")) return "Instagram Feed";
  if (value.includes("instagram_stories")) return "Instagram Stories";
  if (value.includes("instagram_reels")) return "Instagram Reels";
  if (value.includes("facebook_mobile_feed")) return "Facebook Mobile Feed";
  if (value.includes("facebook_desktop_feed")) return "Facebook Desktop Feed";
  if (value.includes("facebook_stories")) return "Facebook Stories";
  if (value.includes("linktree")) return "Linktree";
  if (value.includes("paid")) return "Pago";
  if (value.includes("social")) return "Social";
  return medium ?? "Não identificado";
}

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
  return typeof value === "string" ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function requiredNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseProduct(value: unknown): UpzeroAnalyticsMetric["product"] {
  const record = asRecord(value);
  if (!record) return null;
  const id = nullableNumber(record.id);
  const name = nullableString(record.name);
  const sku = nullableString(record.sku);
  if (id === null || !name || !sku) return null;
  return { id, name, sku };
}

function parseCategory(value: unknown): UpzeroAnalyticsMetric["category"] {
  const record = asRecord(value);
  if (!record) return null;
  const id = nullableNumber(record.id);
  const name = nullableString(record.name);
  if (id === null || !name) return null;
  return { id, name };
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

export function getMetricUser(row: UpzeroAnalyticsMetric): UpzeroMetricUser | null {
  if (row.user && typeof row.user.id === "number") {
    return {
      id: row.user.id,
      type: row.user.type ?? null,
      name: row.user.name ?? null,
      cpf: row.user.cpf ?? null,
      cnpj: row.user.cnpj ?? null,
      companyName: row.user.company_name ?? null,
    };
  }

  if (typeof row.user_id === "number") {
    return {
      id: row.user_id,
      type: null,
      name: null,
      cpf: null,
      cnpj: null,
      companyName: null,
    };
  }

  return null;
}

function parseMetric(value: unknown, fallbackId: number): UpzeroAnalyticsMetric | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = nullableNumber(row.id) ?? fallbackId;
  const periodStart = nullableString(row.period_start);
  const periodType = nullableString(row.period_type);
  const eventName = nullableString(row.event_name);
  if (!periodStart || !periodType || !eventName) return null;
  const updatedAt = nullableString(row.updated_at) ?? periodStart;
  return {
    id,
    period_start: periodStart,
    period_type: periodType,
    event_name: eventName,
    product: parseProduct(row.product),
    product_variant: row.product_variant ?? null,
    category: parseCategory(row.category),
    user: parseUser(row.user),
    user_id: nullableNumber(row.user_id),
    order_id: nullableNumber(row.order_id),
    utm_source: nullableString(row.utm_source),
    utm_medium: nullableString(row.utm_medium),
    utm_campaign: nullableString(row.utm_campaign),
    source: nullableString(row.source),
    channel: nullableString(row.channel),
    device_type: nullableString(row.device_type),
    total_events: requiredNumber(row.total_events),
    unique_users: requiredNumber(row.unique_users),
    unique_sessions: requiredNumber(row.unique_sessions),
    total_quantity: requiredNumber(row.total_quantity),
    total_value: requiredNumber(row.total_value),
    updated_at: updatedAt,
    event_id: nullableString(row.event_id),
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
    utm_content: nullableString(row.utm_content),
    utm_term: nullableString(row.utm_term),
  };
}

function parseAnalyticsResponse(value: unknown): UpzeroAnalyticsResponse {
  const record = asRecord(value);
  const rawRows = Array.isArray(record?.data) ? record.data : [];
  return {
    data: rawRows.map((row, index) => parseMetric(row, index + 1)).filter((row): row is UpzeroAnalyticsMetric => row !== null),
    total: requiredNumber(record?.total, rawRows.length),
  };
}

export async function getUpzeroAnalyticsMetrics({
  from,
  to,
  apiKey: explicitApiKey,
}: GetUpzeroAnalyticsMetricsParams): Promise<UpzeroAnalyticsResponse> {
  const apiKey = resolveUpzeroApiKey(explicitApiKey);
  const url = new URL(UPZERO_ANALYTICS_METRICS_URL);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);

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
    throw new Error(`Resposta inválida da UP Zero: ${text}`);
  }

  if (!response.ok) {
    throw new Error(`Erro UP Zero ${response.status}: ${JSON.stringify(payload)}`);
  }

  return parseAnalyticsResponse(payload);
}

export function metricToTimelineEvent(row: UpzeroAnalyticsMetric): CustomerTimelineEvent | null {
  const user = getMetricUser(row);
  if (!user) return null;

  return {
    id: `upzero_metric_${row.id}`,
    userId: user.id,
    occurredAt: row.period_start,
    periodType: row.period_type,
    eventName: row.event_name,
    eventLabel: getEventLabel(row.event_name),
    productId: row.product?.id ?? null,
    productName: row.product?.name ?? null,
    productSku: row.product?.sku ?? null,
    categoryId: row.category?.id ?? null,
    categoryName: row.category?.name ?? null,
    orderId: row.order_id ?? null,
    utmSource: row.utm_source,
    utmMedium: row.utm_medium,
    utmCampaign: row.utm_campaign,
    normalizedSource: normalizeSource(row.utm_source),
    normalizedMedium: normalizeMedium(row.utm_medium),
    deviceType: row.device_type,
    totalEvents: row.total_events,
    totalQuantity: row.total_quantity,
    totalValue: row.total_value,
    attributionType: null,
    rawMetricId: row.id,
    updatedAt: row.updated_at,
    eventId: row.event_id ?? null,
    anonymousId: row.anonymous_id ?? null,
    sessionId: row.session_id ?? null,
    visitorId: row.visitor_id ?? null,
    fbclid: row.fbclid ?? null,
    fbc: row.fbc ?? null,
    fbp: row.fbp ?? null,
    gclid: row.gclid ?? null,
    landingUrl: row.landing_url ?? null,
    landingHost: row.landing_host ?? null,
    landingPath: row.landing_path ?? null,
    referrer: row.referrer ?? null,
    referrerHost: row.referrer_host ?? null,
    utmContent: row.utm_content ?? null,
    utmTerm: row.utm_term ?? null,
  };
}

function sortTimeline(events: CustomerTimelineEvent[]): CustomerTimelineEvent[] {
  return [...events].sort((a, b) => {
    const dateDiff = new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
    if (dateDiff !== 0) return dateDiff;
    const priorityDiff = getEventPriority(a.eventName) - getEventPriority(b.eventName);
    if (priorityDiff !== 0) return priorityDiff;
    return a.rawMetricId - b.rawMetricId;
  });
}

function emptyTouch(): TimelineTouch {
  return { source: null, medium: null, campaign: null, occurredAt: null };
}

function touchFromEvent(event: CustomerTimelineEvent): TimelineTouch {
  return {
    source: event.normalizedSource,
    medium: event.normalizedMedium,
    campaign: event.utmCampaign,
    occurredAt: event.occurredAt,
  };
}

function campaignKey(event: Pick<CustomerTimelineEvent, "utmSource" | "utmMedium" | "utmCampaign">): string | null {
  if (!event.utmCampaign) return null;
  return [event.utmSource ?? "", event.utmMedium ?? "", event.utmCampaign].join("::").toLowerCase();
}

function applyAttribution(
  timeline: CustomerTimelineEvent[],
  lookbackDays: number,
): CustomerTimelineResponse["attribution"] {
  let firstTouch: TimelineTouch = emptyTouch();
  let lastTouch: TimelineTouch = emptyTouch();
  let lastReturn: TimelineTouch = emptyTouch();
  let firstCampaignKey: string | null = null;
  let previousCampaignKey: string | null = null;
  let lastKnownTouch: CustomerTimelineEvent | null = null;
  const lookbackMs = Math.max(1, lookbackDays) * 24 * 60 * 60 * 1000;

  for (const event of timeline) {
    const currentCampaignKey = campaignKey(event);

    if (currentCampaignKey) {
      if (!firstCampaignKey) {
        firstCampaignKey = currentCampaignKey;
        firstTouch = touchFromEvent(event);
        event.attributionType = "first_touch";
      } else if (
        currentCampaignKey !== firstCampaignKey &&
        currentCampaignKey !== previousCampaignKey
      ) {
        lastReturn = touchFromEvent(event);
        if (!event.attributionType) event.attributionType = "return_touch";
      }
      previousCampaignKey = currentCampaignKey;
      lastKnownTouch = event;
    }

    if (!CONVERSION_EVENTS.has(event.eventName)) continue;

    const eventTime = new Date(event.occurredAt).getTime();
    const knownTouchTime = lastKnownTouch ? new Date(lastKnownTouch.occurredAt).getTime() : null;
    const touchWithinLookback =
      knownTouchTime !== null && eventTime - knownTouchTime <= lookbackMs;
    const conversionTouch = currentCampaignKey
      ? event
      : touchWithinLookback
        ? lastKnownTouch
        : null;

    if (conversionTouch?.utmCampaign) {
      lastTouch = touchFromEvent(conversionTouch);
      if (!event.attributionType) event.attributionType = "last_touch";
    } else if (!event.attributionType) {
      event.attributionType = "direct";
    }
  }

  return { firstTouch, lastTouch, lastReturn };
}

function buildSummary(timeline: CustomerTimelineEvent[]): CustomerTimelineResponse["summary"] {
  const purchaseValueByOrder = new Map<number, number>();
  let purchaseValueWithoutOrder = 0;

  for (const event of timeline) {
    if (!PURCHASE_VALUE_EVENTS.has(event.eventName) || event.totalValue <= 0) continue;
    if (event.orderId !== null) {
      purchaseValueByOrder.set(
        event.orderId,
        Math.max(purchaseValueByOrder.get(event.orderId) ?? 0, event.totalValue),
      );
    } else {
      purchaseValueWithoutOrder += event.totalValue;
    }
  }

  return {
    totalEvents: timeline.reduce((sum, event) => sum + event.totalEvents, 0),
    productViews: timeline
      .filter((event) => ["product_view", "product_item_impression"].includes(event.eventName))
      .reduce((sum, event) => sum + event.totalEvents, 0),
    categoryViews: timeline
      .filter((event) => event.eventName === "category_view")
      .reduce((sum, event) => sum + event.totalEvents, 0),
    formStarts: timeline
      .filter((event) => event.eventName === "form_start")
      .reduce((sum, event) => sum + event.totalEvents, 0),
    registerStarts: timeline
      .filter((event) => event.eventName === "register_start")
      .reduce((sum, event) => sum + event.totalEvents, 0),
    registerSubmitted: timeline
      .filter((event) => event.eventName === "register_submitted")
      .reduce((sum, event) => sum + event.totalEvents, 0),
    logins: timeline
      .filter((event) => event.eventName === "login")
      .reduce((sum, event) => sum + event.totalEvents, 0),
    addToCartEvents: timeline
      .filter((event) => event.eventName === "add_to_cart")
      .reduce((sum, event) => sum + event.totalEvents, 0),
    checkoutStarts: timeline
      .filter((event) => CHECKOUT_EVENTS.has(event.eventName))
      .reduce((sum, event) => sum + event.totalEvents, 0),
    purchases: timeline
      .filter((event) => event.eventName === "purchase")
      .reduce((sum, event) => sum + event.totalEvents, 0),
    totalCartValue: timeline
      .filter((event) => event.eventName === "add_to_cart")
      .reduce((sum, event) => sum + event.totalValue, 0),
    totalPurchaseValue:
      [...purchaseValueByOrder.values()].reduce((sum, value) => sum + value, 0) +
      purchaseValueWithoutOrder,
    firstSeenAt: timeline[0]?.occurredAt ?? null,
    lastSeenAt: timeline[timeline.length - 1]?.occurredAt ?? null,
  };
}

export function buildCustomerTimelineResponse(
  userId: number,
  metrics: UpzeroAnalyticsMetric[],
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
): CustomerTimelineResponse {
  const timeline = sortTimeline(
    metrics
      .filter((row) => getMetricUser(row)?.id === userId)
      .map(metricToTimelineEvent)
      .filter((event): event is CustomerTimelineEvent => event !== null),
  );

  return {
    userId,
    attribution: applyAttribution(timeline, lookbackDays),
    summary: buildSummary(timeline),
    timeline,
  };
}
