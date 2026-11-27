import { createHash } from "node:crypto";
import type { ProductCampaignReviewEvidence } from "@workspace/db";
import type {
  CampaignAd,
  CampaignProductRow,
} from "./product-campaign-analysis";
import type { CampaignSnapshot } from "./product-campaign-monitor";

export interface ProductCampaignRecommendation {
  id: string;
  evidence: ProductCampaignReviewEvidence;
}

export function productCampaignRecommendations(
  snapshot: CampaignSnapshot,
): ProductCampaignRecommendation[] {
  const incomplete = new Set(snapshot.unidentified.map(({ ad }) => ad.id));
  const destinationsByAd = new Map<
    string,
    { ad: CampaignAd; rows: CampaignProductRow[] }
  >();
  for (const row of snapshot.rows) {
    for (const ad of row.ads) {
      const destinations = destinationsByAd.get(ad.id) ?? { ad, rows: [] };
      destinations.rows.push(row);
      destinationsByAd.set(ad.id, destinations);
    }
  }

  const recommendations: ProductCampaignRecommendation[] = [];
  for (const { ad, rows } of destinationsByAd.values()) {
    if (
      !ad.reviewableDestination ||
      incomplete.has(ad.id) ||
      ad.catalog ||
      ad.effectiveStatus !== "ACTIVE" ||
      ad.impressions === null ||
      ad.impressions <= 0
    )
      continue;
    const [product] = rows;
    if (
      !product ||
      !rows.every(
        (row) =>
          row.productId === product.productId && row.grade === "out_of_stock",
      )
    )
      continue;

    const id = createHash("sha256")
      .update(
        JSON.stringify([
          snapshot.accountId,
          snapshot.storeId,
          snapshot.adsObservedAt,
          snapshot.stockObservedAt,
          ad.id,
        ]),
      )
      .digest("hex");
    recommendations.push({
      id,
      evidence: {
        adId: ad.id,
        adName: ad.name,
        campaignName: ad.campaignName,
        adsetName: ad.adsetName,
        productId: product.productId,
        productName: product.name,
        productUrl: product.productUrl,
        observedAt: {
          ads: snapshot.adsObservedAt,
          stock: snapshot.stockObservedAt,
        },
        window: snapshot.window,
        currency: snapshot.currency,
        timeZone: snapshot.timeZone,
        impressions: ad.impressions,
        spend: ad.spend,
      },
    });
  }

  return recommendations.sort(
    (a, b) => (b.evidence.spend ?? -1) - (a.evidence.spend ?? -1),
  );
}
