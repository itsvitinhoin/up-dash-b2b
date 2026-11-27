import { describe, expect, it, vi } from "vitest";
import { applyMediaOpportunities, assessScaleBudgets, audienceTests, findSiblingBudgetWaste, historicalReactivation } from "../src/services/up-manager-media-opportunities";
import { campaignInventoryContext, campaignPeriod, evaluateCampaignInventory, type CampaignEvaluation } from "../src/services/up-manager-campaign-evaluation";
import { mediaActionSignature, type PaidMediaReview, type PaidMediaRow } from "../src/services/up-manager-paid-media";
import { analyzeProductCampaigns, type CampaignAd, type CatalogProduct } from "../src/services/product-campaign-analysis";
import { catalogSnapshot } from "../src/services/up-manager-b2c-products";
import type { ManagerClient, readVariantSales } from "../src/services/up-manager";
import * as graph from "../src/services/up-manager-meta-structure";
import * as sources from "../src/services/product-campaign-sources";
import { applyCampaignWatch } from "../src/services/up-manager-campaign-watch";
import type { MetaNode } from "../src/services/up-manager-meta-structure";

const ad = (id: string, spend: number, purchases: number, revenue: number, options: Partial<PaidMediaRow> = {}): PaidMediaRow => ({
  id, level: "ad", name: id, campaignId: "11", adsetId: "12", parent: "Conjunto", status: "active",
  spending: { spend, purchases, revenue, clicks: 100, missingValue: 0 }, roas: spend ? revenue / spend : null,
  benchmark: null, previousRoas: null, below: false, signal: "healthy", driver: "", action: "", ...options,
});
const review = (rows: PaidMediaRow[], days = 30): PaidMediaReview => ({
  rows, window: campaignPeriod("2026-11-22", days), previousWindow: campaignPeriod("2026-10-23", days),
  reference: 3.46, attributedSpend: 0, missingValue: 0, available: true, accountPriceComparable: true,
});

describe("decisões de mídia por estrutura", () => {
  it("prioriza pausar o gasto sem compras quando o vencedor divide a verba do mesmo conjunto", () => {
    const wasted = ad("AD01", 123.89, 0, 0);
    const winner = ad("AD04", 61.48, 3, 485.91);
    const month = review([wasted, winner, ad("AD02", 28.80, 0, 0), ad("AD03", 13.26, 0, 0)]);
    const weeks = { 30: month, 14: review([], 14), 7: review([], 7), 3: review([], 3) };
    const result = findSiblingBudgetWaste(weeks, wasted.id, (row) => row.id === winner.id);
    expect(result).toMatchObject({ days: 30, ad: { id: "AD01" }, winner: { id: "AD04" } });
    expect(result?.share).toBeCloseTo(0.545, 3);
    expect(findSiblingBudgetWaste(weeks, wasted.id, () => false)).toBeNull();
    expect(findSiblingBudgetWaste({ ...weeks, 3: review([ad("AD01", 30, 1, 200)], 3) }, wasted.id, () => true)).toBeNull();
    expect(findSiblingBudgetWaste({ ...weeks, 30: review([wasted, { ...winner, adsetId: "13" }]) }, wasted.id, () => true)).toBeNull();
  });

  it("usa o histórico de anúncio pausado e seu par ativo para decidir se vale testar a volta", () => {
    const paused = ad("AD04", 224.93, 8, 1874.72, { status: "inactive" });
    const peer = ad("AD01", 1923.71, 36, 9142.58);
    const set = ad("12", 2267.7, 45, 11204.22, { level: "adset" });
    const month = review([paused, peer, set]);
    const weeks = { 30: month, 14: month, 7: month, 3: month };
    expect(historicalReactivation(paused, weeks)).toMatchObject({ row: { id: "AD04" }, peer: { id: "AD01" } });
    expect(historicalReactivation({ ...paused, status: "active" }, weeks)).toBeNull();
  });

  it("tira a escala quando o orçamento compartilhado tem destino sem grade verificada", () => {
    const preview = { decision: "scale", opportunity: true } as CampaignEvaluation;
    const row = ad("13", 61.48, 3, 485.91, { recommendation: "scale", evaluation: preview });
    const campaign: MetaNode = { id: "11", name: "Campanha", status: "ACTIVE", effective_status: "ACTIVE", daily_budget: "4500" };
    const set: MetaNode = { id: "12", name: "Conjunto", campaign_id: "11", status: "ACTIVE", effective_status: "ACTIVE",
      daily_budget: "0", lifetime_budget: "0" };
    assessScaleBudgets([row], new Map([["11", campaign]]), new Map([["12", set]]),
      campaignInventoryContext(null, null, [], []), "BRL");
    expect(row.recommendation).toBe("maintain");
    expect(row.scaleBudgets).toMatchObject([{ ownerId: "11", ownerLevel: "campaign", before: 4500, blockers: expect.any(Array) }]);
    expect(row.scaleBudgets?.[0].blockers).toHaveLength(1);
  });

  it("sugere testar faixa adjacente só para Lookalike confirmado e com referência das mesmas campanhas", () => {
    const winner = ad("12", 200, 10, 1000, { level: "adset" });
    const peer = ad("13", 300, 10, 900, { level: "adset" });
    const sets = new Map<string, MetaNode>([
      ["12", { id: "12", name: "LAL", targeting: { custom_audiences: [{ id: "14" }] } }],
      ["13", { id: "13", name: "Comparação" }],
    ]);
    const audiences = new Map<string, MetaNode>([["14", {
      id: "14", name: "LAL Compra", subtype: "LOOKALIKE", lookalike_spec: { ratio: 0.01, origin: [{ name: "Compradores" }] },
    }]]);
    expect(audienceTests(review([winner, peer]), sets, audiences)).toMatchObject([{
      name: "LAL Compra", source: "Compradores", roas: 5, cpa: 20, referenceRoas: 3, referenceCpa: 30,
      action: expect.stringContaining("1%–3%"),
    }]);
    expect(audienceTests(review([winner, { ...peer, campaignId: "99" }]), sets, audiences)).toEqual([]);
  });
});

describe("retorno de anúncio após reposição", () => {
  const domain = "marca.example";
  const makeProduct = (stock: number): CatalogProduct => ({
    id: 123, name: "Conjunto Helena", handle: "conjunto-helena", published: true,
    attributes: ["Cor", "Tamanho"],
    variants: [{ id: 8, stock, values: ["Marinho", "P"] }, { id: 9, stock: 35, values: ["Marinho", "M"] }],
  });
  const creative: CampaignAd = {
    id: "511", name: "Criativo Helena", campaignId: "11", campaignName: "Vendas", adsetId: "12", adsetName: "Público",
    effectiveStatus: "PAUSED", urls: [`https://${domain}/produtos/conjunto-helena/`], catalog: false, imageUrl: null, spend: null, impressions: null,
  };
  const sales = ["123:8", "123:9"].map((externalId) => ({
    externalId, id: externalId, units: 7, name: "Helena", color: "Marinho", size: null, sku: "", revenue: 700,
  })) satisfies Awaited<ReturnType<typeof readVariantSales>>;
  const snapshot = (product: CatalogProduct, advertising: CampaignAd) => ({
    ...analyzeProductCampaigns([advertising], [product], [domain], advertising.effectiveStatus === "PAUSED" ? "PAUSED" : "ACTIVE"),
    version: 1 as const, accountId: "1", storeId: "1", adsObservedAt: "", stockObservedAt: "",
    window: campaignPeriod("2026-11-22", 7), currency: "BRL", timeZone: "America/Sao_Paulo", warnings: [],
  });
  const priorProduct = makeProduct(0);
  const priorStock = evaluateCampaignInventory({ id: creative.id, level: "ad" }, campaignInventoryContext(
    snapshot(priorProduct, { ...creative, effectiveStatus: "ACTIVE" }), catalogSnapshot([priorProduct]), sales, sales,
  ));
  const prior = ad(creative.id, 224.93, 8, 1874.72, {
    recommendation: "pause", pauseReason: "stock", evaluation: { inventory: priorStock } as CampaignEvaluation,
  });
  const history = { ...review([prior]), multiWindowEnd: "2026-11-21" };

  it.each([
    { stock: 24, goodHistory: true, recommendation: "reactivate" },
    { stock: 24, goodHistory: false, recommendation: "reactivation-blocked" },
    { stock: 0, goodHistory: true, recommendation: undefined },
  ])("reavalia a pausa de ontem com estoque $stock e bom histórico $goodHistory", async ({ stock, goodHistory, recommendation }) => {
    const meta = vi.spyOn(graph, "readManagerMetaNodes").mockImplementation(async (_client, ids) => new Map(ids
      .filter((id) => id === creative.id)
      .map((id) => [id, { id, name: creative.name, status: "PAUSED", effective_status: "PAUSED", adset_id: "12", campaign_id: "11" }])));
    const readAd = vi.spyOn(sources, "fetchManagerStockAd").mockResolvedValue(creative);
    try {
      const current = makeProduct(stock);
      const row = ad(creative.id, 224.93, goodHistory ? 8 : 1, 1874.72, { status: "inactive" });
      const month = review([row, ad("600", 1923.71, 36, 9142.58), ad("12", 2267.7, 45, 11204.22, { level: "adset" })]);
      const currentReview = { ...review([row], 7), multiWindowEnd: "2026-11-22" };
      await applyMediaOpportunities(
        { id: "fixture", currency: "BRL", accountId: "1", metaToken: "test" } as ManagerClient,
        currentReview, { 30: month, 14: month, 7: month, 3: month },
        campaignInventoryContext(snapshot(current, creative), catalogSnapshot([current]), sales, sales),
        { products: [current], domains: [domain], observedAt: "2026-11-23T10:00:00Z" },
        [{ id: row.id, level: "ad", day: "2026-11-21", title: "Pausa por estoque confirmada" }],
        { previous: null, products: [], funnel: { checkouts: 0, purchases: 0, window: currentReview.window }, stockPauseHistory: [history] },
      );
      expect(row.recommendation).toBe(recommendation);
      if (recommendation) {
        expect(row.driver).toContain("Reposição confirmada");
        expect(row.driver).toContain("0 → 24 un.");
      }
      if (recommendation === "reactivate") {
        expect(row.action).toContain("verba atual");
        expect(mediaActionSignature([row])).not.toEqual(mediaActionSignature([prior]));
        row.evaluation!.auction = { trend: "recovery" } as NonNullable<CampaignEvaluation["auction"]>;
        applyCampaignWatch(row, "BRL");
        expect(row.recommendation).toBe("reactivate");
      }
    } finally {
      meta.mockRestore();
      readAd.mockRestore();
    }
  });
});
