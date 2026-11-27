import { expect, it } from "vitest";
import { reportFunnelStages } from "../src/services/up-manager-funnel-stages";
import type { CheckoutDiagnosticData } from "../src/services/up-manager-funnel-diagnostic";

const funnel = {
  previous: { sessions: 100, productViews: 140, addToCarts: 100, checkouts: 50, purchases: 35, source: "GA4", observedAt: null },
  current: { sessions: 200, productViews: 200, addToCarts: 100, checkouts: 35, purchases: 24, source: "GA4", observedAt: null },
};

it("preserva métricas por etapa e distingue eventos por sessão de taxa de conversão", () => {
  const stages = reportFunnelStages(funnel);
  expect(stages.map(({ id }) => id)).toEqual(["sessions", "productViews", "addToCarts", "checkouts", "purchases"]);
  expect(stages[1]).toMatchObject({ rate: 1, previousRate: 1.4, movement: "worsened" });
  expect(stages[3]).toMatchObject({ current: 35, previous: 50, rate: 0.35, previousRate: 0.5, movement: "worsened" });
  expect(stages[4].movement).toBe("stable");
  expect(stages[2].reason).toContain("fator causal ainda precisa de confirmação");
});

it("só explica o canal quando a abertura reconcilia com o total do GA4", () => {
  const detail: CheckoutDiagnosticData = { source: "ga4", items: [], events: [
    ...(["current", "previous"] as const).flatMap((period) => [
      { period, channel: "Paid Social", campaign: "", device: "", event: "add_to_cart", count: 100 },
      { period, channel: "Paid Social", campaign: "", device: "", event: "begin_checkout", count: period === "current" ? 35 : 50 },
    ]),
  ] };
  expect(reportFunnelStages(funnel, detail)[3].reason).toContain("Social Pago");
  detail.events[0].count = 80;
  expect(reportFunnelStages(funnel, detail)[3].reason).not.toContain("Social Pago");
});

it("mostra a etapa com cobertura insuficiente sem fabricar a taxa anterior", () => {
  const stages = reportFunnelStages({ ...funnel, previous: null });
  expect(stages[3]).toMatchObject({ current: 35, previous: null, previousRate: null, movement: "insufficient" });
});
