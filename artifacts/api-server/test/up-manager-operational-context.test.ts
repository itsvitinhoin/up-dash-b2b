import { expect, it } from "vitest";
import { applyCampaignWatch, comparableWatchResult } from "../src/services/up-manager-campaign-watch";
import type { AuctionEvaluation } from "../src/services/up-manager-auction";
import type { CampaignEvaluation, ProductCoverage } from "../src/services/up-manager-campaign-evaluation";
import type { PaidMediaRow } from "../src/services/up-manager-paid-media";
import { groupProductTraffic } from "../src/services/up-manager-product-traffic";
import { compareStateFreight, simulateShipping } from "../src/services/up-manager-shipping-insights";

const week = { dateFrom: "2026-11-12", dateTo: "2026-11-18" };
const point = { period: week, spend: 200, purchases: 5, roas: 4, cpm: 20, cpc: 1, ctr: 0.02, purchaseRate: 0.025, ticket: 160 };
function recovering(grade: ProductCoverage["grade"], gradeDays: number, recommendation: PaidMediaRow["recommendation"] = "scale") {
  const product = { name: "Conjunto", grade, gradeDays, missing: ["M"], firstSizeAtRisk: "M" } as ProductCoverage;
  const auction: AuctionEvaluation = { current: point, before: { ...point, roas: 2 }, preceding: null, trend: "recovery",
    summary: "ROAS em recuperação.", detail: null };
  const evaluation = { auction, inventory: { products: [product], unknownAds: 0 }, decision: recommendation } as CampaignEvaluation;
  return { evaluation, recommendation } as PaidMediaRow;
}

it("segura escala de recuperação com primeira quebra próxima e preserva pausa por estoque", () => {
  const candidate = recovering("complete", 4);
  applyCampaignWatch(candidate, "BRL");
  expect(candidate.recommendation).toBe("investigate");
  expect(candidate.evaluation?.watch?.detail).toContain("4 dias");
  const paused = recovering("out_of_stock", 0, "pause");
  paused.pauseReason = "stock";
  applyCampaignWatch(paused, "BRL");
  expect(paused.recommendation).toBe("pause");
  const scalable = recovering("complete", 9);
  applyCampaignWatch(scalable, "BRL");
  expect(scalable.recommendation).toBe("scale");
});

it("usa apenas janelas fora do dia de mudança para medir o resultado", () => {
  expect(comparableWatchResult(point, { ...point, period: { dateFrom: "2026-11-20", dateTo: "2026-11-26" } }, "2026-11-19")).toBe(true);
  expect(comparableWatchResult(point, { ...point, period: { dateFrom: "2026-11-19", dateTo: "2026-11-25" } }, "2026-11-19")).toBe(false);
});

it("agrupa GA4 por produto sem inventar vínculo de DPA", () => {
  const result = groupProductTraffic([
    { itemId: "P42-M", itemName: null, itemVariant: null, views: 20 },
    { itemId: "P42-P", itemName: null, itemVariant: null, views: 15 },
    { itemId: "outro", itemName: "Ambíguo", itemVariant: null, views: 10 },
  ], [{ id: "42", name: "Conjunto", variants: [{ id: "5", sku: "P42-M" }, { id: "6", sku: "P42-P" }] },
    { id: "2", name: "Ambíguo" }, { id: "3", name: "Ambíguo" }], [
    { key: "42:5", productId: "42", published: true, name: "Conjunto", options: "M", stock: 0, listedPrice: 10, promotion: null },
    { key: "42:6", productId: "42", published: true, name: "Conjunto", options: "P", stock: 3, listedPrice: 10, promotion: null },
  ], new Map(), new Map(), week, 1);
  expect(result?.unlinkedViews).toBe(10);
  expect(result?.items[0]).toMatchObject({ views: 35, status: "broken", ads: [] });
});

it("simula só a cobrança que deixa de entrar nos mesmos pedidos", () => {
  const current = Array.from({ length: 12 }, (_, i) => ({
    shippingState: "SP", shipping_cost_customer: i < 3 ? 30 : 20, total: i < 3 ? 230 : 120, shipping_option_code: "PAC",
  }));
  const previous = current.map((order) => ({ ...order, shipping_cost_customer: 10 }));
  const report = compareStateFreight(current, previous, week, week, "BRL", "2026-11-19");
  expect(simulateShipping(current, report)).toEqual([{ state: "SP", sample: 12, comparisonOrders: 12, averageOrder: 12500,
    free: { threshold: 13000, orders: 3, subsidy: 9000 }, fixed: { ceiling: 2000, orders: 3, subsidy: 3000 } }]);
});
