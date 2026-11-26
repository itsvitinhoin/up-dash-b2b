import { describe, expect, it } from "vitest";
import { assessScaleBudgets, audienceTests, findSiblingBudgetWaste, historicalReactivation } from "../src/services/up-manager-media-opportunities";
import { campaignInventoryContext, campaignPeriod, type CampaignEvaluation } from "../src/services/up-manager-campaign-evaluation";
import type { PaidMediaReview, PaidMediaRow } from "../src/services/up-manager-paid-media";
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
