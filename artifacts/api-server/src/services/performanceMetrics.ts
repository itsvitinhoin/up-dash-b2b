export type PerformanceAttribution = {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
};

export function calculatePerformanceRatios(params: {
  netRevenue: number;
  attributedRevenue: number;
  mediaSpend: number;
  cogs: number;
  returnAmount?: number;
  costCoveragePct: number;
}): {
  roas: number | null;
  mer: number | null;
  grossProfit: number;
  roi: number | null;
  roiStatus: "available" | "partial" | "unavailable";
} {
  const { netRevenue, attributedRevenue, mediaSpend, cogs, costCoveragePct } = params;
  const realizedRevenue = netRevenue - (params.returnAmount ?? 0);
  const grossProfit = realizedRevenue - cogs;
  const investmentBase = cogs + mediaSpend;
  const roiStatus = costCoveragePct >= 95
    ? "available"
    : costCoveragePct > 0
      ? "partial"
      : "unavailable";

  return {
    roas: mediaSpend > 0 ? attributedRevenue / mediaSpend : null,
    mer: mediaSpend > 0 ? netRevenue / mediaSpend : null,
    grossProfit,
    roi: roiStatus === "available" && investmentBase > 0
      ? ((realizedRevenue - investmentBase) / investmentBase) * 100
      : null,
    roiStatus,
  };
}

function normalize(value: string | null | undefined): string {
  return value?.toLowerCase().trim() ?? "";
}

export function normalizePerformanceChannel(attribution: PerformanceAttribution): string {
  const source = normalize(attribution.utmSource);
  const medium = normalize(attribution.utmMedium);
  const campaign = normalize(attribution.utmCampaign);
  const value = `${source} ${medium} ${campaign}`;

  if (["fb", "facebook", "ig", "instagram", "meta"].includes(source) || /facebook|instagram|meta_ads/.test(value)) return "Meta";
  if (["google", "google_ads", "googleads", "gads", "gc"].includes(source) || /google|pmax|adwords/.test(value)) return "Google";
  if (["tiktok", "tik_tok", "ttads"].includes(source) || /tiktok|tik_tok|ttads/.test(value)) return "TikTok";
  if (["pinterest", "pinterest_ads", "pinads"].includes(source) || /pinterest|pinads/.test(value)) return "Pinterest";
  if (campaign.includes("upzero") || campaign.includes("up zero") || campaign.includes("up.")) return "UP";
  return "Mídia paga não identificada";
}

export function percentage(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0;
}
