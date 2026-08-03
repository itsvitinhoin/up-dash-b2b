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
