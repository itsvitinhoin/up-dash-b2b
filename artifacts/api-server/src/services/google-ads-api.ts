import jwt from "jsonwebtoken";
import { z } from "zod";

const tokenUrl = "https://oauth2.googleapis.com/token";
const scope = "https://www.googleapis.com/auth/adwords";
const apiBase = "https://googleads.googleapis.com/v26";

export class GoogleAdsError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const credentialSchema = z.object({
  client_email: z.string().email(),
  private_key: z.string().min(1),
});
const tokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().positive() });
let cachedToken: { credential: string; token: string; expiresAt: number } | undefined;

export function googleAdsConfigured() {
  return Boolean(process.env.GOOGLE_ADS_SERVICE_ACCOUNT_JSON?.trim());
}

async function accessToken() {
  const credential = process.env.GOOGLE_ADS_SERVICE_ACCOUNT_JSON?.trim();
  if (!credential) throw new GoogleAdsError("Credencial do Google Ads pendente no servidor.", 503);
  if (cachedToken?.credential === credential && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  let assertion: string;
  try {
    const account = credentialSchema.parse(JSON.parse(credential));
    assertion = jwt.sign({ scope }, account.private_key, {
      algorithm: "RS256",
      audience: tokenUrl,
      issuer: account.client_email,
      expiresIn: "1h",
    });
  } catch {
    throw new GoogleAdsError("Credencial da conta de serviço do Google Ads inválida.", 503);
  }

  const response = await googleFetch(tokenUrl, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const token = tokenSchema.safeParse(await response.json().catch(() => null));
  if (!response.ok || !token.success) {
    throw new GoogleAdsError("O Google recusou a autenticação da conta de serviço.", 502);
  }
  cachedToken = {
    credential,
    token: token.data.access_token,
    expiresAt: Date.now() + token.data.expires_in * 1000,
  };
  return cachedToken.token;
}

async function googleFetch(url: string, init: RequestInit) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new GoogleAdsError("O Google Ads não respondeu à consulta.", 502);
  }
}

export type GoogleAdsAccountIds = { customerId: string; managerId: string | null };
export type GoogleAdsDates = { dateFrom: string; dateTo: string };

const failureSchema = z.object({
  error: z.object({
    details: z.array(z.object({
      errors: z.array(z.object({ errorCode: z.record(z.string()) })).optional(),
    })).optional(),
  }),
});

function reportError(payload: unknown, response: Response) {
  const parsed = failureSchema.safeParse(payload);
  const code = parsed.success
    ? parsed.data.error.details?.flatMap((detail) =>
      detail.errors?.flatMap((error) => Object.values(error.errorCode)) ?? [],
    ).find((value) => /^[A-Z0-9_]+$/.test(value))
    : undefined;
  const requestId = response.headers.get("request-id");
  const diagnostic = [code ?? String(response.status), requestId].filter(Boolean).join(" · ");
  return new GoogleAdsError(`O Google Ads recusou a consulta (${diagnostic}).`, 502);
}

export async function searchGoogleAds<Schema extends z.ZodTypeAny>(
  ids: GoogleAdsAccountIds,
  query: string,
  row: Schema,
): Promise<z.output<Schema>[]> {
  const token = await accessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (ids.managerId) headers["login-customer-id"] = ids.managerId;
  const response = await googleFetch(`${apiBase}/customers/${ids.customerId}/googleAds:searchStream`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw reportError(payload, response);
  const batches = z.array(z.object({
    results: z.array(row).default([]),
    error: z.never().optional(),
  })).safeParse(payload);
  if (!batches.success) {
    throw new GoogleAdsError("Resposta incompleta do Google Ads. Tente sincronizar novamente.", 502);
  }
  return batches.data.flatMap((batch) => batch.results);
}

const customerRow = z.object({
  customer: z.object({
    id: z.string(),
    descriptiveName: z.string().optional(),
    currencyCode: z.string().regex(/^[A-Z]{3}$/),
    timeZone: z.string().min(1),
    manager: z.boolean().optional(),
  }),
});

export async function readGoogleAdsAccount(ids: GoogleAdsAccountIds) {
  const [row] = await searchGoogleAds(ids,
    "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager FROM customer",
    customerRow);
  if (!row || row.customer.id !== ids.customerId || row.customer.manager) {
    throw new GoogleAdsError("Informe a conta anunciante do Google Ads.", 422);
  }
  const { customer } = row;
  return {
    accountName: customer.descriptiveName || customer.id,
    currency: customer.currencyCode,
    timeZone: customer.timeZone,
  };
}

const metric = z.union([z.number(), z.string().regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/)])
  .transform(Number).pipe(z.number().finite()).optional();
const campaignRow = z.object({
  campaign: z.object({
    id: z.string(),
    name: z.string(),
    advertisingChannelType: z.string().optional(),
  }),
  segments: z.object({ date: z.string().date() }),
  metrics: z.object({
    costMicros: metric,
    clicks: metric,
    impressions: metric,
    conversions: metric,
    conversionsValue: metric,
  }).optional(),
});

export async function readGoogleAdsCampaigns(ids: GoogleAdsAccountIds, dates: GoogleAdsDates) {
  const rows = await searchGoogleAds(ids, `
    SELECT campaign.id, campaign.name, campaign.advertising_channel_type, segments.date,
           metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value
      FROM campaign
     WHERE segments.date BETWEEN '${dates.dateFrom}' AND '${dates.dateTo}'
  `, campaignRow);
  return rows.map(({ campaign, segments, metrics }) => ({
    day: segments.date,
    campaignId: campaign.id,
    name: campaign.name,
    channel: campaign.advertisingChannelType ?? "UNKNOWN",
    costMicros: metrics?.costMicros ?? 0,
    clicks: metrics?.clicks ?? 0,
    impressions: metrics?.impressions ?? 0,
    conversions: metrics?.conversions ?? 0,
    conversionValue: metrics?.conversionsValue ?? 0,
  }));
}
