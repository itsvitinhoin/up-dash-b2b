import { describe, expect, it } from "vitest";
import { audienceCreationParams, audienceWindowCanCreate } from "../src/services/up-manager-audience-actions";
import { recommendation, summarizeAudienceSegments } from "../src/services/up-manager-audience-study";
import type { MetaNode } from "../src/services/up-manager-meta-structure";
import type { PaidMediaReview, PaidMediaRow } from "../src/services/up-manager-paid-media";

const window = { dateFrom: "2026-10-24", dateTo: "2026-11-22" };
const previous = { dateFrom: "2026-09-24", dateTo: "2026-10-23" };

function set(id: string, spend: number, purchases: number, revenue: number): PaidMediaRow {
  return {
    id, level: "adset", campaignId: "01", name: id, parent: "Campanha", status: "active",
    spending: { spend, purchases, revenue, clicks: 100, missingValue: 0 },
    roas: revenue / spend, previousRoas: null, benchmark: null, below: false, signal: "healthy", driver: "", action: "",
  };
}

const review = (rows: PaidMediaRow[]): PaidMediaReview => ({
  rows, window, previousWindow: previous, reference: 3,
  attributedSpend: 500, missingValue: 0, available: true, accountPriceComparable: true,
});

describe("estudo e criação de públicos do UP Manager", () => {
  it("soma gastos e compras por segmentação confirmada e separa públicos mistos", () => {
    const audience: MetaNode = { id: "11", name: "Semelhante de compradores", subtype: "LOOKALIKE" };
    const nodes = new Map<string, MetaNode>([
      ["12", { id: "12", name: "A", campaign_id: "01", targeting: { custom_audiences: [{ id: "11" }] } }],
      ["13", { id: "13", name: "B", campaign_id: "01", targeting: { custom_audiences: [{ id: "11" }] } }],
      ["14", { id: "14", name: "C", campaign_id: "01", targeting: { flexible_spec: [{ interests: [{ id: "15" }] }] } }],
      ["16", { id: "16", name: "Público alterado", campaign_id: "01", targeting: { custom_audiences: [{ id: "11" }] } }],
    ]);
    const current = review([set("12", 600, 12, 2000), set("13", 200, 4, 1000), set("14", 20, 1, 50), set("16", 80, 4, 500)]);
    const before = review([set("12", 400, 4, 800), set("13", 300, 3, 600)]);
    expect(summarizeAudienceSegments(current, before, nodes, new Map([["11", audience]]), new Set(["12", "13", "14"]))).toMatchObject([
      { kind: "lookalike", label: "Semelhante de compradores", sets: 2, current: { spend: 800, roas: 3.75, cpa: 50 }, previous: { roas: 2, cpa: 100 } },
      { kind: "mixed", label: "C", current: { purchases: 1 }, previous: null },
    ]);
  });

  it("cria o intervalo Lookalike adjacente usando o identificador da base", () => {
    const plan = recommendation("Semelhante", "", "", { mode: "lookalike", originId: "11", from: 0.01, to: 0.03, country: "BR" });
    const params = audienceCreationParams(plan, "UP Manager");
    expect(params).toMatchObject({ name: "UP Manager", subtype: "LOOKALIKE", origin_audience_id: "11" });
    expect(JSON.parse(params!.lookalike_spec)).toEqual({ country: "BR", starting_ratio: 0.01, ratio: 0.03 });
  });

  it("separa a inclusão de checkout da exclusão de compradores, com janelas distintas", () => {
    const plan = recommendation("Checkout", "", "", { mode: "remarketing", pixelId: "99", event: "InitiateCheckout", days: 14, excludePurchasesDays: 30 });
    const params = audienceCreationParams(plan, "UP Manager")!;
    expect(JSON.parse(params.rule)).toMatchObject({
      inclusions: { rules: [{ event_sources: [{ id: "99", type: "pixel" }], retention_seconds: 14 * 86400,
        filter: { filters: [{ field: "event", operator: "eq", value: "InitiateCheckout" }] } }] },
      exclusions: { rules: [{ retention_seconds: 30 * 86400, filter: { filters: [{ value: "Purchase" }] } }] },
    });
  });

  it("preserva o ID de interesse validado e reserva a criação aos tipos suportados", () => {
    const plan = recommendation("Moda Feminina", "", "", {
      mode: "interest", interests: [{ id: "15", name: "Moda Feminina" }], country: "BR", age: null, states: [],
    });
    expect(plan.id).toHaveLength(64);
    expect(audienceCreationParams(plan, "UP Manager")).toBeNull();
    expect(audienceWindowCanCreate({ window, previousWindow: null, observedAt: "", accountId: "11", referenceRoas: 3, segments: [], ages: [], states: [],
      recommendations: [], products: [] }, new Date("2026-11-23T19:00:00Z"))).toBe(true);
  });
});
