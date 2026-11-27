import { describe, expect, it } from "vitest";
import {
  diagnoseCheckout,
  type CheckoutDiagnosticData,
  type CheckoutEvent,
} from "../src/services/up-manager-funnel-diagnostic";

function events(
  channel: string,
  campaign: string,
  previous: [number, number],
  current: [number, number],
): CheckoutEvent[] {
  return (["previous", "current"] as const).flatMap((period) => {
    const [carts, checkouts] = period === "previous" ? previous : current;
    const scope = { channel, campaign, device: "mobile", period };
    return [
      { ...scope, event: "add_to_cart", count: carts },
      { ...scope, event: "begin_checkout", count: checkouts },
    ];
  });
}

const expected = {
  previous: { carts: 112, checkouts: 54 },
  current: { carts: 157, checkouts: 49 },
};
const item = { channel: "Paid Social", id: "helena-p", name: "Helena Amarelo P" };
const data: CheckoutDiagnosticData = {
  source: "ga4",
  events: [
    ...events("Paid Social", "Black", [40, 19], [50, 14]),
    ...events("Paid Social", "Helena", [59, 28], [62, 30]),
    ...events("Direct", "", [3, 4], [19, 1]),
    ...events("Other", "", [10, 3], [26, 4]),
  ],
  items: [
    { ...item, campaign: "Black", period: "previous", carts: 5, checkouts: 5 },
    { ...item, campaign: "Black", period: "current", carts: 5, checkouts: 1 },
    { ...item, campaign: "Helena", period: "current", carts: 11, checkouts: 9 },
  ],
};

describe("diagnóstico da passagem do carrinho para o checkout", () => {
  it("localiza o desvio dentro do canal e cruza a variante com a campanha", () => {
    const result = diagnoseCheckout(data, expected);
    expect(result?.factors).toEqual([
      expect.objectContaining({ label: "Social Pago", detail: expect.stringContaining("47 de 99") }),
      expect.objectContaining({ label: "Campanha e dispositivo", detail: expect.stringContaining("14 de 50") }),
      expect.objectContaining({ label: "Variantes da campanha", detail: expect.stringContaining("Helena Amarelo P (5 de 5 → 1 de 5)") }),
      expect.objectContaining({ label: "Mudança no perfil de tráfego", detail: expect.stringContaining("Base anterior pequena") }),
    ]);
    expect(result?.action).toMatch(/no celular.*Black.*Helena Amarelo P/);
    expect(result?.unresolved).toContain("ainda exige verificar");
  });

  it("recusa um detalhamento que não bate com os eventos totais", () => {
    expect(diagnoseCheckout({ ...data, events: data.events.slice(1) }, expected)).toBeNull();
  });
});
