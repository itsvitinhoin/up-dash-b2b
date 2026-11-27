import { describe, expect, it } from "vitest";
import {
  approvedCreativeWindow,
  buildCreativeReview,
} from "../src/services/up-manager-creatives";
import type { CampaignAd } from "../src/services/product-campaign-analysis";
import type { MetaMarketingData, MetaAdMetric } from "../src/services/meta-ads";

const scope = { dateFrom: "2026-11-14", dateTo: "2026-11-20" };

function ad(id: string, creativeId: string, adsetId = "11"): CampaignAd {
  return {
    id,
    name: `Ad ${id}`,
    creativeId,
    campaignId: "55",
    campaignName: "Campanha",
    adsetId,
    adsetName: `Conjunto ${adsetId}`,
    effectiveStatus: "ACTIVE",
    urls: [],
    catalog: false,
    imageUrl: null,
    spend: 0,
    impressions: 0,
  };
}
function metrics(id: string, spend: number, purchases: number): MetaAdMetric {
  return {
    id,
    name: id,
    spend,
    purchases,
    impressions: 1000,
    clicks: 30,
    leads: 0,
    revenue: purchases * 100,
    roas: null,
    cpa: null,
    cpl: null,
    dateStart: scope.dateFrom,
    dateStop: scope.dateTo,
  };
}
function media(ads: MetaAdMetric[]) {
  return { ads } as MetaMarketingData;
}

describe("decision by creative and exact ad", () => {
  it("shows the efficient creative and only recommends pause against a better peer in the same ad set", () => {
    const weekly = media([
      metrics("1", 300, 10),
      metrics("2", 120, 0),
      metrics("3", 140, 0),
    ]);
    const prior = media([
      metrics("1", 240, 8),
      metrics("2", 60, 0),
      metrics("3", 70, 0),
    ]);
    const review = buildCreativeReview({
      activeAds: [ad("1", "401"), ad("2", "402"), ad("3", "403", "12")],
      media: weekly,
      previousMedia: prior,
      currency: "BRL",
      window: scope,
    });
    expect(review.creatives[0]).toMatchObject({
      creativeId: "401",
      best: true,
    });
    expect(
      review.creatives.flatMap(({ recommendations }) =>
        recommendations.map(({ adId }) => adId),
      ),
    ).toEqual(["2"]);
  });

  it("does not suggest pausing copies of the same creative or use missing delivery as zero", () => {
    const review = buildCreativeReview({
      activeAds: [ad("1", "401"), ad("2", "401"), ad("3", "403")],
      media: media([metrics("1", 300, 10), metrics("2", 140, 0)]),
      previousMedia: media([metrics("1", 240, 8), metrics("2", 60, 0)]),
      currency: "BRL",
      window: scope,
    });
    expect(
      review.creatives.every(({ recommendations }) => !recommendations.length),
    ).toBe(true);
    expect(
      review.creatives.find(({ creativeId }) => creativeId === "403")?.current,
    ).toBeNull();
  });

  it("only authorizes the current mature seven-day window", () => {
    expect(
      approvedCreativeWindow(scope, new Date("2026-11-23T15:00:00Z")),
    ).toBe(true);
    expect(
      approvedCreativeWindow(scope, new Date("2026-11-24T15:00:00Z")),
    ).toBe(false);
  });
});
