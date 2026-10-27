import { describe, expect, it } from "vitest";
import {
  buildFunnelSteps,
  countFunnelPeople,
  funnelActorKey,
  worstFunnelStep,
  type FunnelStepKey,
} from "../src/services/funnel-people";

const fact = (event_name: string, who: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  event_name,
  period_type: "event",
  total_events: 1,
  user_id: null,
  user: null,
  ...who,
  ...extra,
});

describe("funnelActorKey", () => {
  it("prefere usuário identificado, depois visitante, anônimo e sessão", () => {
    expect(funnelActorKey({ user_id: 7, visitor_id: "v" })).toBe("u:7");
    expect(funnelActorKey({ user: { id: 9 } as never, visitor_id: "v" })).toBe("u:9");
    expect(funnelActorKey({ visitor_id: "v", anonymous_id: "a", session_id: "s" })).toBe("v:v");
    expect(funnelActorKey({ anonymous_id: "a", session_id: "s" })).toBe("a:a");
    expect(funnelActorKey({ session_id: "s" })).toBe("s:s");
    expect(funnelActorKey({})).toBeNull();
  });
});

describe("countFunnelPeople", () => {
  it("conta pessoas distintas, não eventos", () => {
    const rows = [
      fact("page_view", { visitor_id: "a" }),
      fact("page_view", { visitor_id: "a" }),
      fact("page_view", { visitor_id: "b" }),
      fact("product_view", { user_id: 1 }),
      fact("product_view", { user_id: 1 }),
      fact("product_view", { user_id: 1 }),
    ];
    const { counts, exact } = countFunnelPeople(rows);
    expect(counts.VISIT).toBe(2);
    expect(counts.PRODUCT_VIEW).toBe(1);
    expect(exact).toBe(true);
  });

  it("impressão de produto numa listagem NÃO conta como produto visto", () => {
    const rows = Array.from({ length: 500 }, (_, i) => fact("product_item_impression", { visitor_id: `v${i}` }));
    rows.push(fact("product_view", { visitor_id: "v1" }) as never);
    expect(countFunnelPeople(rows).counts.PRODUCT_VIEW).toBe(1);
  });

  it("junta eventos equivalentes de checkout e de pagamento", () => {
    const rows = [
      fact("initiate_checkout", { user_id: 1 }),
      fact("checkout_start", { user_id: 1 }),
      fact("checkout_start", { user_id: 2 }),
      fact("order_paid", { user_id: 3 }),
      fact("payment_approved", { user_id: 3 }),
    ];
    const { counts } = countFunnelPeople(rows);
    expect(counts.CHECKOUT_STARTED).toBe(2);
    expect(counts.PAYMENT_APPROVED).toBe(1);
  });

  it("linha agregada por hora usa as sessões da linha (e não os eventos) quando existem", () => {
    const rows = [
      { event_name: "page_view", period_type: "hour", total_events: 50, unique_sessions: 20, unique_users: 3, user_id: null, user: null },
      { event_name: "page_view", period_type: "hour", total_events: 10, unique_sessions: 0, unique_users: 2, user_id: null, user: null },
    ];
    expect(countFunnelPeople(rows).counts.VISIT).toBe(22);
  });

  it("linha agregada por hora não dá para separar pessoas: soma eventos e avisa que não é exato", () => {
    const rows = [
      { event_name: "login", period_type: "hour", total_events: 5, user_id: null, user: null },
      { event_name: "login", period_type: "hour", total_events: 3, user_id: null, user: null },
    ];
    const result = countFunnelPeople(rows);
    expect(result.counts.LOGIN).toBe(8);
    expect(result.exact).toBe(false);
  });
});

const ORDER: Array<{ step: FunnelStepKey; label: string }> = [
  { step: "VISIT", label: "Visitas" },
  { step: "PRODUCT_VIEW", label: "Produtos vistos" },
  { step: "REGISTRATION", label: "Cadastros" },
  { step: "APPROVED_REGISTRATION", label: "Aprovados" },
  { step: "LOGIN", label: "Logins" },
  { step: "ADD_TO_CART", label: "Carrinho" },
  { step: "PURCHASE", label: "Compras" },
];

describe("buildFunnelSteps", () => {
  it("nunca passa de 100% de conversão nem tem queda negativa", () => {
    const steps = buildFunnelSteps(ORDER, { VISIT: 100, PRODUCT_VIEW: 4000, REGISTRATION: 24, APPROVED_REGISTRATION: 116, LOGIN: 300, ADD_TO_CART: 10, PURCHASE: 1 }, 116);
    for (const step of steps) {
      expect(step.conversionRate).toBeGreaterThanOrEqual(0);
      expect(step.conversionRate).toBeLessThanOrEqual(100);
      expect(step.dropOffRate).toBeGreaterThanOrEqual(0);
      expect(step.dropOffRate).toBeLessThanOrEqual(100);
    }
  });

  it("etapa sem rastreamento (0, com gente depois) não vira queda de 100%", () => {
    const steps = buildFunnelSteps(ORDER, { VISIT: 0, PRODUCT_VIEW: 0, REGISTRATION: 747, APPROVED_REGISTRATION: 507, LOGIN: 0, ADD_TO_CART: 0, PURCHASE: 14 }, 507);
    const cart = steps.find((s) => s.step === "ADD_TO_CART")!;
    expect(cart.dropOffRate).toBe(0);
    expect(cart.conversionRate).toBe(0);
    const purchase = steps.find((s) => s.step === "PURCHASE")!;
    expect(purchase.conversionRate).toBeCloseTo((14 / 507) * 100, 6);
    // a maior perda real é entre cadastro e aprovação, não "carrinho"
    const worst = worstFunnelStep(steps);
    expect(steps[worst.idx].step).toBe("PURCHASE");
    expect(worst.drop).toBeCloseTo(100 - (14 / 507) * 100, 6);
  });

  it("pagamento confirmado zerado (só rastreamento) não vira \"maior queda\"", () => {
    const order = [...ORDER, { step: "PAYMENT_APPROVED" as FunnelStepKey, label: "Pagamentos" }];
    const steps = buildFunnelSteps(order, { VISIT: 50, PRODUCT_VIEW: 30, REGISTRATION: 10, APPROVED_REGISTRATION: 8, LOGIN: 5, ADD_TO_CART: 2, PURCHASE: 1, PAYMENT_APPROVED: 0 }, 8);
    const payment = steps.find((s) => s.step === "PAYMENT_APPROVED")!;
    expect(payment.dropOffRate).toBe(0);
    expect(steps[worstFunnelStep(steps).idx].step).not.toBe("PAYMENT_APPROVED");
  });

  it("etapa final zerada (ninguém comprou) continua sendo perda de 100%", () => {
    const steps = buildFunnelSteps(ORDER, { VISIT: 50, PRODUCT_VIEW: 30, REGISTRATION: 10, APPROVED_REGISTRATION: 8, LOGIN: 5, ADD_TO_CART: 2, PURCHASE: 0 }, 8);
    const purchase = steps.find((s) => s.step === "PURCHASE")!;
    expect(purchase.conversionRate).toBe(0);
    expect(purchase.dropOffRate).toBe(100);
  });

  it("aprovados são medidos contra a etapa anterior com dado; pós-aprovação contra os aprovados", () => {
    const steps = buildFunnelSteps(ORDER, { VISIT: 1000, PRODUCT_VIEW: 400, REGISTRATION: 200, APPROVED_REGISTRATION: 100, LOGIN: 50, ADD_TO_CART: 25, PURCHASE: 10 }, 100);
    const by = Object.fromEntries(steps.map((s) => [s.step, s.conversionRate]));
    expect(by.PRODUCT_VIEW).toBe(40);
    expect(by.REGISTRATION).toBe(50);
    expect(by.APPROVED_REGISTRATION).toBe(50);
    expect(by.LOGIN).toBe(50);
    expect(by.ADD_TO_CART).toBe(25);
    expect(by.PURCHASE).toBe(10);
  });

  it("sem cadastros aprovados, etapa pós-aprovação usa a etapa anterior", () => {
    const steps = buildFunnelSteps(ORDER, { VISIT: 100, PRODUCT_VIEW: 50, REGISTRATION: 20, APPROVED_REGISTRATION: 0, LOGIN: 10, ADD_TO_CART: 5, PURCHASE: 1 }, 0);
    const login = steps.find((s) => s.step === "LOGIN")!;
    expect(login.conversionRate).toBeLessThanOrEqual(100);
  });
});
