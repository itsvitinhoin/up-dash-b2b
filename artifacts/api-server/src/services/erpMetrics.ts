export type ErpCampaignSignal = {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
};

function normalizeCampaignText(value: string | null | undefined): string {
  return value
    ?.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim() ?? "";
}

export function hasPaidErpCampaignSignal(attribution: ErpCampaignSignal): boolean {
  const source = normalizeCampaignText(attribution.utmSource);
  const medium = normalizeCampaignText(attribution.utmMedium);
  const campaign = normalizeCampaignText(attribution.utmCampaign);

  if (source === "instagram" && medium === "linktree" && campaign === "linktree") return false;

  const paidSources = [
    "fb",
    "facebook",
    "ig",
    "instagram",
    "meta",
    "google",
    "google_ads",
    "googleads",
    "gads",
    "gc",
    "tiktok",
    "tiktok_ads",
    "pinterest",
    "pinterest_ads",
  ];
  const hasPaidMedium = ["paid", "cpc", "ppc", "pmax", "ads"].some((signal) => medium.includes(signal));
  const hasPaidPlacement = [
    "facebook_mobile_feed",
    "facebook_desktop_feed",
    "facebook_stories",
    "instagram_feed",
    "instagram_stories",
    "instagram_reels",
  ].some((signal) => medium.includes(signal));
  const hasPaidCampaign = ["up.", "upzero", "up zero", "rmkt", "remarketing", "retarget"].some((signal) =>
    campaign.includes(signal),
  );

  return (
    hasPaidMedium ||
    hasPaidPlacement ||
    hasPaidCampaign ||
    (paidSources.includes(source) && campaign.length > 0 && campaign !== "linktree")
  );
}

export function calculateErpRetentionPct(returningCustomers: number, uniqueCustomers: number): number {
  return uniqueCustomers > 0 ? (returningCustomers / uniqueCustomers) * 100 : 0;
}

export function calculateErpFulfilledQuantity(requestedQuantity: number, returnedQuantity: number): number {
  return Math.max(requestedQuantity - returnedQuantity, 0);
}

export function calculateErpStockTurnoverPct(unitsSold: number, currentStock: number): number {
  const sold = Math.max(unitsSold, 0);
  const stock = Math.max(currentStock, 0);
  return sold + stock > 0 ? (sold / (sold + stock)) * 100 : 0;
}

export function calculateErpStockCoverageDays(
  unitsSold: number,
  currentStock: number,
  periodDays: number,
): number | null {
  const sold = Math.max(unitsSold, 0);
  if (sold === 0) return null;

  const dailySales = sold / Math.max(periodDays, 1);
  return Math.max(currentStock, 0) / dailySales;
}

export function calculateErpSalesPower(currentStock: number, catalogPrice: number): number {
  return Math.max(currentStock, 0) * Math.max(catalogPrice, 0);
}
