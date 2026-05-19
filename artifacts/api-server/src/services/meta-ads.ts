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

export interface MetaMarketingData {
  daily: MetaDailyPoint[];
  ads: MetaAdMetric[];
  campaigns: MetaAdMetric[];
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
  return { daily, ads, campaigns, summary: summarize(daily) };
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
