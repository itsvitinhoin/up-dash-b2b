import { and, eq } from "drizzle-orm";
import { db, creativesTable } from "@workspace/db";

const DEFAULT_GRAPH_VERSION = "v24.0";
const GRAPH_BASE = "https://graph.facebook.com";

type MetaAction = { action_type?: string; value?: string };
type MetaRoas = { action_type?: string; value?: string };

interface MetaInsightRow {
  ad_id?: string;
  ad_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  status?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  inline_link_clicks?: string;
  actions?: MetaAction[];
  action_values?: MetaAction[];
  cost_per_action_type?: MetaAction[];
  purchase_roas?: MetaRoas[];
  date_start: string;
  date_stop: string;
}

interface MetaCampaignRow {
  id: string;
  status?: string;
  effective_status?: string;
}

interface MetaAdCreativeDetails {
  id: string;
  name?: string;
  status?: string;
  effective_status?: string;
  preview_shareable_link?: string;
  creative?: {
    id?: string;
    name?: string;
    thumbnail_url?: string;
    image_url?: string;
    video_id?: string;
    effective_object_story_id?: string;
    object_story_spec?: {
      video_data?: {
        video_id?: string;
        image_url?: string;
        title?: string;
        message?: string;
      };
      link_data?: {
        picture?: string;
        image_hash?: string;
        message?: string;
        name?: string;
      };
      photo_data?: {
        url?: string;
        image_hash?: string;
      };
    };
  };
}

interface MetaVideoDetails {
  id: string;
  source?: string;
  picture?: string;
  permalink_url?: string;
  length?: number;
}

export interface MetaAdAccountOption {
  id: string;
  accountId: string;
  name: string;
  currency?: string;
  timezoneName?: string;
  accountStatus?: number;
}

type MetaAdAccountsResponse = {
  data?: Array<{
    id: string;
    account_id?: string;
    name?: string;
    account_status?: number;
    currency?: string;
    timezone_name?: string;
  }>;
  paging?: { next?: string };
};

export interface MetaDailyPoint {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  purchases: number;
  cpl: number | null;
}

export interface MetaAdMetric {
  id: string;
  name: string;
  status?: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  purchases: number;
  revenue: number;
  roas: number | null;
  cpl: number | null;
  cpa: number | null;
  dateStart: string;
  dateStop: string;
}

export interface MetaCreativeMetric {
  id: string;
  name: string;
  status: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  leads: number;
  purchases: number;
  cpl: number;
  cpa: number;
  previewUrl: string | null;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  mediaType: "video" | "image" | "unknown";
}

export interface MetaTopCreatives {
  ctr: MetaCreativeMetric[];
  cpl: MetaCreativeMetric[];
  leads: MetaCreativeMetric[];
}

export interface MetaMarketingData {
  daily: MetaDailyPoint[];
  ads: MetaAdMetric[];
  campaigns: MetaAdMetric[];
  topCreatives: MetaTopCreatives;
  summary: {
    spend: number;
    impressions: number;
    clicks: number;
    leads: number;
    purchases: number;
    cpl: number | null;
  };
}

export function normalizeMetaAdAccountId(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("act_")) return trimmed;
  if (trimmed.startsWith("act=")) return `act_${trimmed.slice(4)}`;
  return `act_${trimmed}`;
}

function graphVersion(): string {
  return process.env.META_GRAPH_VERSION ?? DEFAULT_GRAPH_VERSION;
}

async function fetchGraph<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok || body.error) {
    throw new Error(body.error?.message ?? `${res.status} ${res.statusText}`);
  }
  return body;
}

function numberValue(value: unknown): number {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(n) ? n : 0;
}

function preferredActionValue(
  actions: MetaAction[] | undefined,
  exactTypes: string[],
  fuzzyTypes: string[],
): number {
  if (!actions) return 0;
  const lowerExactTypes = exactTypes.map((type) => type.toLowerCase());
  for (const exactType of lowerExactTypes) {
    const match = actions.find((action) => (action.action_type ?? "").toLowerCase() === exactType);
    if (match) return numberValue(match.value);
  }
  for (const fuzzyType of fuzzyTypes) {
    const match = actions.find((action) => (action.action_type ?? "").toLowerCase().includes(fuzzyType));
    if (match) return numberValue(match.value);
  }
  return 0;
}

function actionValue(actions: MetaAction[] | undefined, kind: "lead" | "purchase"): number {
  if (kind === "lead") {
    return preferredActionValue(
      actions,
      [
        "complete_registration",
        "offsite_conversion.fb_pixel_complete_registration",
        "omni_complete_registration",
        "offsite_complete_registration_add_meta_leads",
        "lead",
      ],
      ["complete_registration", "lead", "submit_application"],
    );
  }
  return preferredActionValue(
    actions,
    [
      "purchase",
      "offsite_conversion.fb_pixel_purchase",
      "omni_purchase",
      "onsite_web_purchase",
      "onsite_web_app_purchase",
    ],
    ["purchase"],
  );
}

function actionCost(costs: MetaAction[] | undefined, kind: "lead" | "purchase"): number | null {
  if (!costs) return null;
  const exactTypes =
    kind === "lead"
      ? [
          "complete_registration",
          "offsite_conversion.fb_pixel_complete_registration",
          "omni_complete_registration",
          "offsite_complete_registration_add_meta_leads",
          "lead",
        ]
      : [
          "purchase",
          "offsite_conversion.fb_pixel_purchase",
          "omni_purchase",
          "onsite_web_purchase",
          "onsite_web_app_purchase",
        ];
  const value = preferredActionValue(costs, exactTypes, kind === "lead" ? ["complete_registration", "lead"] : ["purchase"]);
  return value > 0 ? value : null;
}

function purchaseRoas(row: MetaInsightRow, spend: number, revenue: number): number | null {
  const roas = preferredActionValue(
    row.purchase_roas,
    ["purchase", "offsite_conversion.fb_pixel_purchase", "omni_purchase"],
    ["purchase"],
  );
  if (roas > 0) return roas;
  return spend > 0 && revenue > 0 ? revenue / spend : null;
}

async function fetchCampaignStatuses(accessToken: string, adAccountId: string): Promise<Map<string, string>> {
  const statuses = new Map<string, string>();
  let url: string | null = `${GRAPH_BASE}/${graphVersion()}/${normalizeMetaAdAccountId(adAccountId)}/campaigns?${new URLSearchParams({
    access_token: accessToken,
    fields: "id,status,effective_status",
    limit: "500",
  })}`;

  while (url) {
    const res = await fetch(url);
    const body = (await res.json()) as {
      data?: MetaCampaignRow[];
      paging?: { next?: string };
      error?: { message?: string };
    };
    if (!res.ok || body.error) {
      throw new Error(body.error?.message ?? `${res.status} ${res.statusText}`);
    }
    for (const campaign of body.data ?? []) {
      statuses.set(campaign.id, campaign.effective_status ?? campaign.status ?? "UNKNOWN");
    }
    url = body.paging?.next ?? null;
  }

  return statuses;
}

export async function fetchMetaAdAccounts(accessToken: string): Promise<MetaAdAccountOption[]> {
  const accounts: MetaAdAccountOption[] = [];
  let url: string | null = `${GRAPH_BASE}/${graphVersion()}/me/adaccounts?${new URLSearchParams({
    access_token: accessToken,
    fields: "id,account_id,name,account_status,currency,timezone_name",
    limit: "200",
  })}`;

  while (url) {
    const body: MetaAdAccountsResponse = await fetchGraph<MetaAdAccountsResponse>(url);
    for (const account of body.data ?? []) {
      accounts.push({
        id: normalizeMetaAdAccountId(account.id),
        accountId: account.account_id ?? account.id.replace(/^act_/, ""),
        name: account.name ?? account.id,
        currency: account.currency,
        timezoneName: account.timezone_name,
        accountStatus: account.account_status,
      });
    }
    url = body.paging?.next ?? null;
  }

  return accounts;
}

function costPerLead(costs: MetaAction[] | undefined): number | null {
  return actionCost(costs, "lead");
}

async function fetchInsights(
  accessToken: string,
  adAccountId: string,
  params: Record<string, string>,
): Promise<MetaInsightRow[]> {
  const rows: MetaInsightRow[] = [];
  let url: string | null = `${GRAPH_BASE}/${graphVersion()}/${normalizeMetaAdAccountId(adAccountId)}/insights?${new URLSearchParams({
    access_token: accessToken,
    ...params,
  })}`;

  while (url) {
    const res = await fetch(url);
    const body = (await res.json()) as {
      data?: MetaInsightRow[];
      paging?: { next?: string };
      error?: { message?: string; code?: number; type?: string };
    };
    if (!res.ok || body.error) {
      const message = body.error?.message ?? `${res.status} ${res.statusText}`;
      throw new Error(`Meta Marketing API error: ${message}`);
    }
    rows.push(...(body.data ?? []));
    url = body.paging?.next ?? null;
  }

  return rows;
}

function dailyPoint(row: MetaInsightRow): MetaDailyPoint {
  const spend = numberValue(row.spend);
  const leads = actionValue(row.actions, "lead");
  return {
    date: row.date_start,
    spend,
    impressions: Math.round(numberValue(row.impressions)),
    clicks: Math.round(numberValue(row.inline_link_clicks ?? row.clicks)),
    leads: Math.round(leads),
    purchases: Math.round(actionValue(row.actions, "purchase")),
    cpl: costPerLead(row.cost_per_action_type) ?? (leads > 0 ? spend / leads : null),
  };
}

function adMetric(row: MetaInsightRow, since: string, until: string): MetaAdMetric {
  const spend = numberValue(row.spend);
  const leads = actionValue(row.actions, "lead");
  const purchases = actionValue(row.actions, "purchase");
  const revenue = actionValue(row.action_values, "purchase");
  return {
    id: row.ad_id ?? row.campaign_id ?? `${row.ad_name ?? row.campaign_name ?? "meta"}:${since}:${until}`,
    name: row.ad_name ?? row.campaign_name ?? "Meta ad",
    status: row.status,
    spend,
    impressions: Math.round(numberValue(row.impressions)),
    clicks: Math.round(numberValue(row.inline_link_clicks ?? row.clicks)),
    leads: Math.round(leads),
    purchases: Math.round(purchases),
    revenue,
    roas: purchaseRoas(row, spend, revenue),
    cpl: costPerLead(row.cost_per_action_type) ?? (leads > 0 ? spend / leads : null),
    cpa: actionCost(row.cost_per_action_type, "purchase") ?? (purchases > 0 ? spend / purchases : null),
    dateStart: row.date_start ?? since,
    dateStop: row.date_stop ?? until,
  };
}

function summarize(daily: MetaDailyPoint[]) {
  const spend = daily.reduce((sum, p) => sum + p.spend, 0);
  const leads = daily.reduce((sum, p) => sum + p.leads, 0);
  return {
    spend,
    impressions: daily.reduce((sum, p) => sum + p.impressions, 0),
    clicks: daily.reduce((sum, p) => sum + p.clicks, 0),
    leads,
    purchases: daily.reduce((sum, p) => sum + p.purchases, 0),
    cpl: leads > 0 ? spend / leads : null,
  };
}

function metricWithCtr(ad: MetaAdMetric): MetaCreativeMetric {
  return {
    id: ad.id,
    name: ad.name,
    status: ad.status ?? "UNKNOWN",
    spend: ad.spend,
    impressions: ad.impressions,
    clicks: ad.clicks,
    ctr: ad.impressions > 0 ? (ad.clicks / ad.impressions) * 100 : 0,
    leads: ad.leads,
    purchases: ad.purchases,
    cpl: ad.cpl ?? (ad.leads > 0 ? ad.spend / ad.leads : 0),
    cpa: ad.cpa ?? (ad.purchases > 0 ? ad.spend / ad.purchases : 0),
    previewUrl: null,
    thumbnailUrl: null,
    imageUrl: null,
    videoUrl: null,
    mediaType: "unknown",
  };
}

function imageFromCreative(details: MetaAdCreativeDetails): string | null {
  return (
    details.creative?.object_story_spec?.video_data?.image_url ??
    details.creative?.object_story_spec?.link_data?.picture ??
    details.creative?.object_story_spec?.photo_data?.url ??
    details.creative?.image_url ??
    details.creative?.thumbnail_url ??
    null
  );
}

function videoIdFromCreative(details: MetaAdCreativeDetails): string | null {
  return (
    details.creative?.object_story_spec?.video_data?.video_id ??
    details.creative?.video_id ??
    null
  );
}

async function fetchVideoDetails(accessToken: string, videoId: string): Promise<MetaVideoDetails | null> {
  try {
    return await fetchGraph<MetaVideoDetails>(`${GRAPH_BASE}/${graphVersion()}/${videoId}?${new URLSearchParams({
      access_token: accessToken,
      fields: "id,source,picture,permalink_url,length",
    })}`);
  } catch {
    return null;
  }
}

async function fetchAdCreativeDetails(accessToken: string, adId: string): Promise<MetaAdCreativeDetails | null> {
  try {
    return await fetchGraph<MetaAdCreativeDetails>(`${GRAPH_BASE}/${graphVersion()}/${adId}?${new URLSearchParams({
      access_token: accessToken,
      fields: "id,name,status,effective_status,preview_shareable_link,creative{id,name,thumbnail_url,image_url,video_id,effective_object_story_id,object_story_spec}",
    })}`);
  } catch {
    return null;
  }
}

async function buildTopCreatives(accessToken: string, ads: MetaAdMetric[]): Promise<MetaTopCreatives> {
  const base = ads.map(metricWithCtr);
  const byCtr = [...base]
    .filter((ad) => ad.impressions > 0 && ad.clicks > 0)
    .sort((a, b) => b.ctr - a.ctr)
    .slice(0, 5);
  const byCpl = [...base]
    .filter((ad) => ad.leads > 0 && ad.cpl > 0)
    .sort((a, b) => a.cpl - b.cpl)
    .slice(0, 5);
  const byLeads = [...base]
    .filter((ad) => ad.leads > 0)
    .sort((a, b) => b.leads - a.leads)
    .slice(0, 5);

  const ids = [...new Set([...byCtr, ...byCpl, ...byLeads].map((ad) => ad.id))];
  const detailEntries = await Promise.all(
    ids.map(async (id) => [id, await fetchAdCreativeDetails(accessToken, id)] as const),
  );
  const detailsById = new Map(detailEntries);

  const videoIds = [...new Set(detailEntries.map(([, details]) => details && videoIdFromCreative(details)).filter(Boolean) as string[])];
  const videoEntries = await Promise.all(
    videoIds.map(async (id) => [id, await fetchVideoDetails(accessToken, id)] as const),
  );
  const videosById = new Map(videoEntries);

  const enrich = (creative: MetaCreativeMetric): MetaCreativeMetric => {
    const details = detailsById.get(creative.id);
    if (!details) return creative;
    const videoId = videoIdFromCreative(details);
    const video = videoId ? videosById.get(videoId) : null;
    const imageUrl = imageFromCreative(details) ?? video?.picture ?? null;
    const videoUrl = video?.source ?? null;
    return {
      ...creative,
      name: details.name ?? creative.name,
      status: details.effective_status ?? details.status ?? creative.status,
      previewUrl: details.preview_shareable_link ?? (video?.permalink_url ? `https://www.facebook.com${video.permalink_url}` : null),
      thumbnailUrl: details.creative?.thumbnail_url ?? imageUrl,
      imageUrl,
      videoUrl,
      mediaType: videoId ? "video" : imageUrl ? "image" : "unknown",
    };
  };

  return {
    ctr: byCtr.map(enrich),
    cpl: byCpl.map(enrich),
    leads: byLeads.map(enrich),
  };
}

export async function fetchMetaMarketingData(params: {
  accessToken: string;
  adAccountId: string;
  since: string;
  until: string;
}): Promise<MetaMarketingData> {
  const fields =
    "spend,impressions,clicks,inline_link_clicks,actions,action_values,cost_per_action_type,purchase_roas,date_start,date_stop";
  const timeRange = JSON.stringify({ since: params.since, until: params.until });

  const [dailyRows, adRows, campaignRows, campaignStatuses] = await Promise.all([
    fetchInsights(params.accessToken, params.adAccountId, {
      level: "account",
      fields,
      time_range: timeRange,
      time_increment: "1",
      limit: "500",
    }),
    fetchInsights(params.accessToken, params.adAccountId, {
      level: "ad",
      fields: `ad_id,ad_name,campaign_id,campaign_name,${fields}`,
      time_range: timeRange,
      limit: "500",
    }),
    fetchInsights(params.accessToken, params.adAccountId, {
      level: "campaign",
      fields: `campaign_id,campaign_name,${fields}`,
      time_range: timeRange,
      limit: "500",
    }),
    fetchCampaignStatuses(params.accessToken, params.adAccountId).catch(() => new Map<string, string>()),
  ]);

  const daily = dailyRows.map(dailyPoint);
  const ads = adRows.map((row) => adMetric(row, params.since, params.until));
  const campaigns = campaignRows.map((row) => {
    const metric = adMetric(row, params.since, params.until);
    return {
      ...metric,
      status: row.campaign_id ? campaignStatuses.get(row.campaign_id) ?? metric.status : metric.status,
    };
  });
  return { daily, ads, campaigns, topCreatives: await buildTopCreatives(params.accessToken, ads), summary: summarize(daily) };
}

export async function upsertMetaCreatives(clientId: string, ads: MetaAdMetric[]): Promise<void> {
  for (const ad of ads) {
    await db
      .insert(creativesTable)
      .values({
        id: `meta:${clientId}:${ad.id}`,
        clientId,
        name: ad.name,
        platform: "META",
        status: "ACTIVE",
        clicks: ad.clicks,
        impressions: ad.impressions,
        spend: ad.spend,
        leads: ad.leads,
        approvedLeads: ad.purchases,
        activeFrom: ad.dateStart,
        activeTo: ad.dateStop,
      })
      .onConflictDoUpdate({
        target: creativesTable.id,
        set: {
          name: ad.name,
          status: "ACTIVE",
          clicks: ad.clicks,
          impressions: ad.impressions,
          spend: ad.spend,
          leads: ad.leads,
          approvedLeads: ad.purchases,
          activeFrom: ad.dateStart,
          activeTo: ad.dateStop,
          updatedAt: new Date(),
        },
      });
  }

  if (ads.length === 0) {
    await db
      .update(creativesTable)
      .set({ status: "INACTIVE", updatedAt: new Date() })
      .where(and(eq(creativesTable.clientId, clientId), eq(creativesTable.platform, "META")));
  }
}
