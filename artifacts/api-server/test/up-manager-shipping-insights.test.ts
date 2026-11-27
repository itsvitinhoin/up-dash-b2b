import { expect, it } from "vitest";
import { brazilianState } from "../src/lib/brazilian-states";
import { compareStateFreight, shippingFinding } from "../src/services/up-manager-shipping-insights";
import type { NuvemOrderShipping } from "../src/services/product-campaign-sources";

const order = (id: number, shippingState: string | null, price: string | null, days: number | null, option = "PAC"): NuvemOrderShipping => ({
  id, shippingState, created_at: "2026-11-22T10:00:00Z", status: "closed", payment_status: "paid",
  shipping_cost_customer: price, shipping_max_days: days, shipping_option_code: option.toLowerCase(), shipping_option: option,
});
const batch = (size: number, state: string, price: string, days: number, mode: string) =>
  Array.from({ length: size }, (_, index) => order(index, state, price, days, mode));
const current = { dateFrom: "2026-11-16", dateTo: "2026-11-22" };
const previous = { dateFrom: "2026-11-09", dateTo: "2026-11-15" };
const compare = (now: NuvemOrderShipping[] | null, then: NuvemOrderShipping[] | null) =>
  compareStateFreight(now, then, current, previous, "BRL", "2026-11-23T17:00:00Z");

it("normaliza o estado da entrega e ignora destinos sem UF reconhecida", () => {
  expect(brazilianState(" Rio   de Janeiro ", "BR")).toBe("RJ");
  expect(brazilianState("sp", "BR")).toBe("SP");
  expect(brazilianState("São Paulo", "BR")).toBe("SP");
  expect(brazilianState("Não informado", "BR")).toBeNull();
  expect(brazilianState("BA", "AR")).toBeNull();
});

it("conta frete grátis como zero, diferencia dados faltantes e mantém estados de baixa amostra", () => {
  const report = compare([
    order(1, "SP", "0.00", 3), order(2, "SP", "19.00", 7), order(3, "SP", null, null), order(4, null, "100.00", 40),
  ], [order(5, "SP", "12.00", 5), order(6, "RJ", "11.00", 5)]);
  expect(report.coverage.current).toEqual({ orders: 4, missingState: 1 });
  expect(report.states.find(({ state }) => state === "SP")).toMatchObject({
    currentFreeShare: 0.5,
    price: { current: { count: 2, average: 950 }, delta: -250, direction: "small-sample" },
    delivery: { current: { count: 2, average: 5 }, direction: "small-sample" },
  });
  expect(report.states.find(({ state }) => state === "RJ")?.price.direction).toBe("unavailable");
});

it("compara as médias por UF e explica o efeito de preços e prazos na mesma modalidade", () => {
  const report = compare([...batch(10, "SP", "20", 4, "PAC"), ...batch(10, "RJ", "10", 3, "PAC")],
    [...batch(10, "SP", "15", 5, "PAC"), ...batch(10, "RJ", "10", 3, "PAC")]);
  const sp = report.states.find(({ state }) => state === "SP")!;
  expect(sp.price).toMatchObject({ delta: 500, direction: "worsened", material: true });
  expect(sp.price.contributions).toMatchObject([{ mode: "PAC", type: "within-mode", delta: 500 }]);
  expect(sp.delivery).toMatchObject({ delta: -1, direction: "improved", material: true });
  expect(shippingFinding(report)).toMatchObject({ priority: "P1", title: "Preço e prazo de frete por estado" });
  expect(report.states.find(({ state }) => state === "RJ")?.price.direction).toBe("stable");
});

it("distingue mudança de modalidade de alteração no preço de uma modalidade", () => {
  const state = compare([...batch(7, "SP", "10", 7, "PAC"), ...batch(13, "SP", "30", 2, "SEDEX")],
    [...batch(13, "SP", "10", 7, "PAC"), ...batch(7, "SP", "30", 2, "SEDEX")]).states[0];
  expect(state.price.direction).toBe("worsened");
  expect(state.delivery.direction).toBe("improved");
  expect(state.price.contributions.every(({ type }) => type === "mix")).toBe(true);
  expect(state.price.contributions.reduce((total, { delta }) => total + delta, 0)).toBeCloseTo(state.price.delta!);
  expect(state.price.reasons.join(" ")).toContain("mudança de participação");
});

it("preserva indisponibilidade da API sem preencher médias com zero", () => {
  const report = compare(null, batch(10, "MG", "12.00", 6, "PAC"));
  expect(report.coverage.current).toBeNull();
  expect(report.states[0].delivery).toMatchObject({ current: { count: 0, average: null }, direction: "unavailable" });
});
