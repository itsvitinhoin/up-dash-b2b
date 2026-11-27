import { addDaysToDateOnly, saoPauloDateOnly } from "../lib/reporting-period";
import type { CampaignAd, CampaignAnalysis } from "./product-campaign-analysis";
import type { MetaAdMetric, MetaMarketingData } from "./meta-ads";
import { daysIn, endingOn } from "./up-manager-b2c-data";
import { priorPeriod, type ManagerPeriod } from "./up-manager";

type RawMetrics = Pick<
  MetaAdMetric,
  "spend" | "purchases" | "impressions" | "clicks" | "revenue"
>;
type CreativeMetrics = RawMetrics & {
  cpa: number | null;
  roas: number | null;
  ctr: number | null;
};
const blank: RawMetrics = {
  spend: 0,
  purchases: 0,
  impressions: 0,
  clicks: 0,
  revenue: 0,
};
const fmt = (metrics: RawMetrics): CreativeMetrics => ({
  ...metrics,
  spend: Math.round(metrics.spend * 100) / 100,
  cpa: metrics.purchases > 0 ? metrics.spend / metrics.purchases : null,
  roas: metrics.spend > 0 ? metrics.revenue / metrics.spend : null,
  ctr: metrics.impressions > 0 ? metrics.clicks / metrics.impressions : null,
});

function sum(rows: RawMetrics[]) {
  return fmt(
    rows.reduce<RawMetrics>(
      (total, row) => ({
        spend: total.spend + row.spend,
        purchases: total.purchases + row.purchases,
        impressions: total.impressions + row.impressions,
        clicks: total.clicks + row.clicks,
        revenue: total.revenue + row.revenue,
      }),
      { ...blank },
    ),
  );
}

export function matureCreativeWindow(now: Date) {
  return endingOn(addDaysToDateOnly(saoPauloDateOnly(now), -3), 7);
}

export function approvedCreativeWindow(window: ManagerPeriod, now: Date) {
  const mature = matureCreativeWindow(now);
  return (
    daysIn(window) === 7 &&
    window.dateTo === mature.dateTo &&
    window.dateFrom === mature.dateFrom
  );
}

export function collectActiveManagerAds(
  source: Pick<CampaignAnalysis, "rows" | "unidentified">,
): CampaignAd[] {
  return [
    ...new Map(
      [
        ...source.rows.flatMap((row) => row.ads),
        ...source.unidentified.map(({ ad }) => ad),
      ].map((ad) => [ad.id, ad]),
    ).values(),
  ];
}

const validId = (value?: string) => Boolean(value && /^\d{1,32}$/.test(value));

export function buildCreativeReview({
  activeAds,
  media,
  previousMedia,
  currency,
  window,
}: {
  activeAds: CampaignAd[];
  media: MetaMarketingData | null;
  previousMedia: MetaMarketingData | null;
  currency: string;
  window: ManagerPeriod;
}) {
  const money = new Intl.NumberFormat("pt-BR", { currency, style: "currency" });
  const available = media !== null;
  const previous = priorPeriod(window);
  const currentById = new Map(media?.ads.map((row) => [row.id, row]));
  const priorById = new Map(previousMedia?.ads.map((row) => [row.id, row]));
  const grouped = new Map<string, CampaignAd[]>();
  const sets = new Map<string, CampaignAd[]>();
  for (const ad of activeAds) {
    if (
      ad.effectiveStatus !== "ACTIVE" ||
      !validId(ad.id) ||
      !validId(ad.campaignId) ||
      !validId(ad.creativeId)
    )
      continue;
    const key = `${ad.campaignId}:${ad.creativeId}`;
    const records = grouped.get(key) ?? [];
    records.push(ad);
    grouped.set(key, records);
    if (validId(ad.adsetId)) {
      const set = sets.get(ad.adsetId!) ?? [];
      set.push(ad);
      sets.set(ad.adsetId!, set);
    }
  }

  const candidates = [];
  const campaignWinners = new Map<string, { key: string; cost: number }>();
  for (const [key, ads] of grouped) {
    const first = ads[0];
    const measured = ads.flatMap(({ id }) => currentById.get(id) ?? []);
    const current = measured.length ? sum(measured) : null;
    const previousRows = ads.flatMap(({ id }) => priorById.get(id) ?? []);
    const previousMetrics = previousRows.length ? sum(previousRows) : null;
    if (
      current &&
      current.purchases >= 5 &&
      current.spend > 0 &&
      current.cpa !== null
    ) {
      const best = campaignWinners.get(first.campaignId!);
      if (!best || current.cpa < best.cost)
        campaignWinners.set(first.campaignId!, { key, cost: current.cpa });
    }
    const recommendations = ads.flatMap((ad) => {
      const recent = currentById.get(ad.id);
      const before = priorById.get(ad.id);
      if (!recent || !before || !ad.adsetId) return [];
      // Keep at least one delivering, better-performing creative in the same ad set.
      const peers = (sets.get(ad.adsetId) ?? []).filter(
        (other) => other.creativeId !== ad.creativeId,
      );
      const peer = sum(peers.flatMap(({ id }) => currentById.get(id) ?? []));
      const peerBefore = sum(
        peers.flatMap(({ id }) => priorById.get(id) ?? []),
      );
      const reference = peer.cpa;
      const referenceBefore = peerBefore.cpa;
      if (peer.purchases < 8 || reference === null || reference <= 0) return [];
      const recentMetrics = fmt(recent);
      const priorMetrics = fmt(before);
      const noPurchases =
        recent.purchases === 0 &&
        before.purchases === 0 &&
        recent.spend >= reference * 3 &&
        before.spend >= reference;
      const expensive =
        recent.purchases >= 3 &&
        before.purchases >= 3 &&
        peerBefore.purchases >= 5 &&
        referenceBefore !== null &&
        referenceBefore > 0 &&
        recentMetrics.cpa !== null &&
        priorMetrics.cpa !== null &&
        recentMetrics.cpa >= reference * 1.6 &&
        priorMetrics.cpa >= referenceBefore * 1.6;
      if (!noPurchases && !expensive) return [];
      return [
        {
          adId: ad.id,
          adName: ad.name,
          adsetName: ad.adsetName,
          current: recentMetrics,
          previous: priorMetrics,
          peerCpa: reference,
          reason: noPurchases
            ? `Zero compras atribuídas nas duas janelas, com gasto de ${money.format(before.spend)} e ${money.format(recent.spend)}. Os outros criativos do conjunto atingiram ${peer.purchases} compras a ${money.format(reference)}.`
            : `CPA de ${money.format(recentMetrics.cpa!)} no recorte atual e ${money.format(priorMetrics.cpa!)} no anterior, pelo menos 60% acima dos outros criativos do conjunto nas duas janelas.`,
        },
      ];
    });
    candidates.push({
      key,
      creativeId: first.creativeId!,
      name: first.creativeName || first.name,
      campaignId: first.campaignId!,
      campaignName: first.campaignName,
      imageUrl: first.imageUrl,
      current,
      previous: previousMetrics,
      activeAds: ads.length,
      dynamic: ads.some((ad) => ad.catalog),
      recommendations,
    });
  }
  const creatives = candidates
    .map((row) => ({
      ...row,
      best: campaignWinners.get(row.campaignId)?.key === row.key,
    }))
    .sort(
      (a, b) =>
        Number(b.best) - Number(a.best) ||
        b.recommendations.length - a.recommendations.length ||
        (b.current?.spend ?? 0) - (a.current?.spend ?? 0) ||
        a.key.localeCompare(b.key),
    );
  return { available, window, previous, creatives };
}
