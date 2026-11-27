import { describe, expect, it } from "vitest";
import { buildCampaignEvaluation, campaignInventoryContext, campaignPeriod, evaluateCampaignInventory, performanceAcrossWindows, type WindowPoint } from "../src/services/up-manager-campaign-evaluation";
import type { PaidMediaReview, PaidMediaRow } from "../src/services/up-manager-paid-media";
import type { CampaignSnapshot } from "../src/services/product-campaign-monitor";
import type { CatalogSnapshot } from "../src/services/up-manager-b2c-products";
import type { readVariantSales } from "../src/services/up-manager";

const ad = { id: "11", name: "Helena", campaignId: "1", campaignName: "Teste", adsetId: "20", adsetName: "Conjunto",
  effectiveStatus: "ACTIVE", urls: [], catalog: false, imageUrl: null, spend: 100, impressions: 50 };
const snapshot = { rows: [{ id: "1:Azul", productId: "1", name: "Helena", color: "Azul",
  scope: "selected_color", imageUrl: null, productUrl: "https://example.com/products/helena", grade: "complete",
  unavailable: false, publicationConfirmed: true, availableVariants: 2, variantCount: 2, missingVariants: [], stock: 60, ads: [ad],
}], unidentified: [] } as unknown as CampaignSnapshot;
const catalog = [
  { key: "1:10", productId: "1", name: "Helena", color: "Azul", options: "P", size: "P", published: true, stock: 20, listedPrice: 100, promotion: null },
  { key: "1:11", productId: "1", name: "Helena", color: "Azul", options: "M", size: "M", published: true, stock: 40, listedPrice: 100, promotion: null },
  { key: "1:12", productId: "1", name: "Helena", color: "Rosa", options: "P", size: "P", published: true, stock: 200, listedPrice: 100, promotion: null },
] satisfies CatalogSnapshot;
const sales = (values: [string, number][]) => values.map(([externalId, units]) =>
  ({ id: externalId, externalId, units, name: "Helena", color: null, size: null, sku: "", revenue: units * 100 })) satisfies Awaited<ReturnType<typeof readVariantSales>>;
const week = sales([["1:10", 7], ["1:11", 7], ["1:12", 7]]);
const fortnight = sales([["1:10", 28], ["1:11", 14], ["1:12", 60]]);
const scope = { id: "1", level: "campaign" as const };
const point = (days: WindowPoint["days"], roas: number, spend: number, purchases: number): WindowPoint => ({
  days, period: campaignPeriod("2026-11-22", days), spend, purchases, roas, accountRoas: 3.5, peerRoas: 3.3, peerCpa: 45, cpa: purchases > 0 ? spend / purchases : null,
});

describe("campanhas em quatro janelas", () => {
  it("usa 30, 14, 7 e 3 dias fechados que terminam na mesma data", () => {
    expect([30, 14, 7, 3].map((days) => campaignPeriod("2026-11-22", days).dateFrom))
      .toEqual(["2026-10-24", "2026-11-09", "2026-11-16", "2026-11-20"]);
  });
  it("identifica uma oportunidade com desempenho recente confirmado e protege uma recuperação de 3 dias", () => {
    expect(performanceAcrossWindows([point(30, 4.4, 800, 29), point(14, 4.4, 500, 14), point(7, 4.3, 250, 8), point(3, 4.1, 150, 4)]))
      .toEqual({ pause: false, opportunity: true });
    expect(performanceAcrossWindows([point(30, 1.9, 800, 29), point(14, 2, 500, 14), point(7, 1.9, 250, 8), point(3, 4.2, 150, 4)]))
      .toEqual({ pause: false, opportunity: false });
    expect(performanceAcrossWindows([point(30, 1.9, 800, 29), point(14, 2, 500, 14), point(7, 1.9, 250, 8), point(3, 0, 100, 0)]))
      .toEqual({ pause: true, opportunity: false });
  });
  it("prioriza a queda da Pêo em semanas distintas mesmo com ROAS acima da conta em 7 dias", () => {
    const makeReview = (days: WindowPoint["days"], spend: number, revenue: number, purchases: number, reference: number): PaidMediaReview => {
      const window = campaignPeriod("2026-11-22", days);
      const row: PaidMediaRow = { ...scope, name: "Varejo Pêo", parent: null, status: "active", roas: revenue / spend,
        spending: { spend, revenue, purchases, clicks: Math.round(spend), missingValue: 0 }, previousRoas: null,
        benchmark: { label: "Mesma conta", spend: 1500, revenue: 4950, purchases: 5, clicks: 700, roas: 3.3 },
        below: false, signal: "healthy", driver: "", action: "" };
      return { window, previousWindow: window, reference, attributedSpend: spend, rows: [row], missingValue: 0,
        available: true, accountPriceComparable: true };
    };
    const reviews = {
      30: makeReview(30, 16427.77, 126167.97, 81, 7.11),
      14: makeReview(14, 7934.74, 56267.97, 38, 6.2),
      7: makeReview(7, 3867.31, 13207, 9, 3.33),
      3: makeReview(3, 1717.88, 4333.86, 3, 2.78),
    };
    const evaluated = buildCampaignEvaluation(reviews[7].rows[0], reviews, campaignInventoryContext(null, null, [], []), false);
    expect(evaluated).toMatchObject({ decision: "investigate", opportunity: false });
    expect(evaluated.reason).toContain("10,59× para 3,42×");
  });
});

describe("cobertura da grade anunciada", () => {
  it("usa o maior giro diário de 7 e 14 dias da cor anunciada e estima a primeira quebra", () => {
    const evaluated = evaluateCampaignInventory(scope, campaignInventoryContext(snapshot, catalog, week, fortnight));
    expect(evaluated.products[0]).toMatchObject({
      color: "Azul", stock: 60, units7: 14, units14: 42, unitsPerDay: 3,
      coverageDays: 20, gradeDays: 10, firstSizeAtRisk: "P",
    });
    expect(evaluated.products[0].coverageAtScale).toBeCloseTo(16.67);
    expect(evaluated.scaleReady).toBe(true);
  });
  it("mostra saldo restante e barra escala quando um tamanho está zerado", () => {
    const imageUrl = "https://example.com/images/helena.jpg";
    const broken = { ...snapshot, rows: [{ ...snapshot.rows[0], imageUrl, grade: "broken" as const, missingVariants: ["P"],
      ads: [ad, { ...ad, id: "12", adsetId: "21" }],
    }] };
    const products = [{ ...catalog[0], stock: 0 }, ...catalog.slice(1)];
    const evaluated = evaluateCampaignInventory({ id: "20", level: "adset" }, campaignInventoryContext(broken, products, week, fortnight));
    expect(evaluated.products[0]).toMatchObject({
      grade: "broken", stock: 40, gradeDays: 0, missing: ["P"], imageUrl,
      variants: [
        { id: "1:10", color: "Azul", size: "P", stock: 0, sold14Days: 28 },
        { id: "1:11", color: "Azul", size: "M", stock: 40, sold14Days: 14 },
      ],
      linkedAds: [{ adId: "11", adName: "Helena", campaignName: "Teste", adsetName: "Conjunto", affected: true }],
    });
    expect(evaluated.products[0].coverageDays).toBeCloseTo(13.33);
    expect(evaluated.scaleReady).toBe(false);
  });
});
