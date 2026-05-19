import { and, eq } from "drizzle-orm";
import { db, creativesTable } from "@workspace/db";

const DEFAULT_GRAPH_VERSION = "v24.0";
const GRAPH_BASE = "https://graph.facebook.com";

type MetaAction = { action_type?: string; value?: string };

interface MetaInsightRow {
  ad_id?: string;
  ad_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  inline_link_clicks?: string;
  actions?: MetaAction[];
  cost_per_action_type?: MetaAction[];
  date_start: string;
  date_stop: string;
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
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  purchases: number;
  cpl: number | null;
  dateStart: string;
  dateStop: string;
}

export interface MetaMarketingData {
  daily: MetaDailyPoint[];
  ads: MetaAdMetric[];
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

function actionValue(actions: MetaAction[] | undefined, kind: "lead" | "purchase"): number {
  if (!actions) return 0;
  return actions.reduce((sum, action) => {
    const type = (action.action_type ?? "").toLowerCase();
    const isLead =
      type === "lead" ||
      type.includes("lead") ||
      type.includes("complete_registration") ||
      type.includes("submit_application");
    const isPurchase = type.includes("purchase");
    if ((kind === "lead" && isLead) || (kind === "purchase" && isPurchase)) {
      return sum + numberValue(action.value);
    }
    return sum;
  }, 0);
}

function costPerLead(costs: MetaAction[] | undefined): number | null {
  if (!costs) return null;
  const match = costs.find((action) => {
    const type = (action.action_type ?? "").toLowerCase();
    return type === "lead" || type.includes("lead") || type.includes("complete_registration");
  });
  if (!match) return null;
  const value = numberValue(match.value);
  return value > 0 ? value : null;
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
  return {
    id: row.ad_id ?? row.campaign_id ?? `${row.ad_name ?? row.campaign_name ?? "meta"}:${since}:${until}`,
    name: row.ad_name ?? row.campaign_name ?? "Meta ad",
    spend,
    impressions: Math.round(numberValue(row.impressions)),
    clicks: Math.round(numberValue(row.inline_link_clicks ?? row.clicks)),
    leads: Math.round(leads),
    purchases: Math.round(actionValue(row.actions, "purchase")),
    cpl: costPerLead(row.cost_per_action_type) ?? (leads > 0 ? spend / leads : null),
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
    "spend,impressions,clicks,inline_link_clicks,actions,cost_per_action_type,date_start,date_stop";
  const timeRange = JSON.stringify({ since: params.since, until: params.until });

  const [dailyRows, adRows] = await Promise.all([
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
  ]);

  const daily = dailyRows.map(dailyPoint);
  const ads = adRows.map((row) => adMetric(row, params.since, params.until));
  return { daily, ads, summary: summarize(daily) };
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
