import { createSign } from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DATA_API_BASE = "https://analyticsdata.googleapis.com/v1beta";
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

export type Ga4Source = "ga4" | "events" | "none";

export interface Ga4FunnelMetrics {
  sessions: number;
  pageViews: number;
  productViews: number;
  addToCarts: number;
  checkouts: number;
  purchases: number;
  source: Ga4Source;
}

export interface Ga4DailyMetrics {
  date: string;
  sessions: number;
  pageViews: number;
  productViews: number;
  addToCarts: number;
  checkouts: number;
  purchases: number;
}

type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

type RunReportResponse = {
  rows?: Array<{
    dimensionValues?: Array<{ value?: string }>;
    metricValues?: Array<{ value?: string }>;
  }>;
};

let cachedToken: { token: string; expiresAt: number } | null = null;

function base64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function readServiceAccount(): ServiceAccount | null {
  const raw =
    process.env.GA4_SERVICE_ACCOUNT_JSON ??
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ??
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ??
    null;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    if (!parsed.client_email || !parsed.private_key) return null;
    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key.replace(/\\n/g, "\n"),
      token_uri: parsed.token_uri,
    };
  } catch {
    return null;
  }
}

async function getAccessToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }
  const serviceAccount = readServiceAccount();
  if (!serviceAccount) return null;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: serviceAccount.client_email,
    scope: SCOPE,
    aud: serviceAccount.token_uri ?? TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(serviceAccount.private_key);
  const assertion = `${unsigned}.${base64Url(signature)}`;

  const response = await fetch(serviceAccount.token_uri ?? TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body = (await response.json().catch(() => null)) as
    | { access_token?: string; expires_in?: number; error_description?: string }
    | null;
  if (!response.ok || !body?.access_token) {
    throw new Error(body?.error_description ?? `GA4 auth failed: ${response.status}`);
  }

  cachedToken = {
    token: body.access_token,
    expiresAt: Date.now() + Math.max(60, body.expires_in ?? 3600) * 1000,
  };
  return cachedToken.token;
}

function metricValue(row: NonNullable<RunReportResponse["rows"]>[number], index: number): number {
  const value = Number(row.metricValues?.[index]?.value ?? "0");
  return Number.isFinite(value) ? value : 0;
}

function ga4Date(value: string | undefined): string {
  const raw = value ?? "";
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  return raw;
}

async function runReport(propertyId: string, body: Record<string, unknown>): Promise<RunReportResponse> {
  const token = await getAccessToken();
  if (!token) return {};
  const response = await fetch(`${DATA_API_BASE}/properties/${propertyId}:runReport`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as RunReportResponse & {
    error?: { message?: string };
  };
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error?.message ?? `GA4 runReport failed: ${response.status}`);
  }
  return payload;
}

export async function fetchGa4FunnelMetrics(params: {
  propertyId?: string | null;
  dateFrom: string;
  dateTo: string;
}): Promise<Ga4FunnelMetrics | null> {
  if (!params.propertyId) return null;
  const token = await getAccessToken();
  if (!token) return null;

  const [sessionsReport, eventsReport] = await Promise.all([
    runReport(params.propertyId, {
      dateRanges: [{ startDate: params.dateFrom, endDate: params.dateTo }],
      metrics: [{ name: "sessions" }, { name: "screenPageViews" }],
    }),
    runReport(params.propertyId, {
      dateRanges: [{ startDate: params.dateFrom, endDate: params.dateTo }],
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: {
        filter: {
          fieldName: "eventName",
          inListFilter: {
            values: ["view_item", "add_to_cart", "begin_checkout", "purchase"],
          },
        },
      },
    }),
  ]);

  const sessionRow = sessionsReport.rows?.[0];
  const byEvent = new Map<string, number>();
  for (const row of eventsReport.rows ?? []) {
    const eventName = row.dimensionValues?.[0]?.value ?? "";
    byEvent.set(eventName, metricValue(row, 0));
  }

  return {
    sessions: sessionRow ? metricValue(sessionRow, 0) : 0,
    pageViews: sessionRow ? metricValue(sessionRow, 1) : 0,
    productViews: byEvent.get("view_item") ?? 0,
    addToCarts: byEvent.get("add_to_cart") ?? 0,
    checkouts: byEvent.get("begin_checkout") ?? 0,
    purchases: byEvent.get("purchase") ?? 0,
    source: "ga4",
  };
}

export async function fetchGa4DailyMetrics(params: {
  propertyId?: string | null;
  dateFrom: string;
  dateTo: string;
}): Promise<Ga4DailyMetrics[] | null> {
  if (!params.propertyId) return null;
  const token = await getAccessToken();
  if (!token) return null;

  const report = await runReport(params.propertyId, {
    dateRanges: [{ startDate: params.dateFrom, endDate: params.dateTo }],
    dimensions: [{ name: "date" }],
    metrics: [{ name: "sessions" }, { name: "screenPageViews" }],
    orderBys: [{ dimension: { dimensionName: "date" } }],
  });

  // GA4 cannot apply different eventName filters per metric in a single flat
  // report, so fetch per-event daily counts separately and merge them.
  const eventsReport = await runReport(params.propertyId, {
    dateRanges: [{ startDate: params.dateFrom, endDate: params.dateTo }],
    dimensions: [{ name: "date" }, { name: "eventName" }],
    metrics: [{ name: "eventCount" }],
    dimensionFilter: {
      filter: {
        fieldName: "eventName",
        inListFilter: {
          values: ["view_item", "add_to_cart", "begin_checkout", "purchase"],
        },
      },
    },
    orderBys: [{ dimension: { dimensionName: "date" } }],
  });

  const byDate = new Map<string, Ga4DailyMetrics>();
  for (const row of report.rows ?? []) {
    const date = ga4Date(row.dimensionValues?.[0]?.value);
    byDate.set(date, {
      date,
      sessions: metricValue(row, 0),
      pageViews: metricValue(row, 1),
      productViews: 0,
      addToCarts: 0,
      checkouts: 0,
      purchases: 0,
    });
  }
  for (const row of eventsReport.rows ?? []) {
    const date = ga4Date(row.dimensionValues?.[0]?.value);
    const eventName = row.dimensionValues?.[1]?.value ?? "";
    const current = byDate.get(date) ?? {
      date,
      sessions: 0,
      pageViews: 0,
      productViews: 0,
      addToCarts: 0,
      checkouts: 0,
      purchases: 0,
    };
    if (eventName === "view_item") current.productViews = metricValue(row, 0);
    if (eventName === "add_to_cart") current.addToCarts = metricValue(row, 0);
    if (eventName === "begin_checkout") current.checkouts = metricValue(row, 0);
    if (eventName === "purchase") current.purchases = metricValue(row, 0);
    byDate.set(date, current);
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
