import type { MetaMarketingData } from "./meta-ads";

export function usesMetaRevenue(
  commercePlatform: string | null | undefined,
): boolean {
  return commercePlatform === "MANUAL";
}

export function manualMarketingKpis(meta: MetaMarketingData) {
  const { spend, revenue, purchases, leads, cpl } = meta.summary;
  return {
    totalSpend: spend,
    attributedRevenue: revenue,
    roas: spend > 0 ? revenue / spend : 0,
    purchases,
    totalLeads: leads,
    // Registration approval is an ecommerce metric, not a Meta purchase.
    approvedLeads: 0,
    approvalRate: 0,
    cpl: cpl ?? 0,
    cpa: purchases > 0 ? spend / purchases : 0,
  };
}
