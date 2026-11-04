import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", async () => ({
  ...(await import("@workspace/db/schema")),
  db: {},
}));

import { getOrderPanelAmount } from "../src/services/upzero-sync";

// MX Fashion, set/2026: pedido 2150 pedido por R$ 3.609,81; o painel da UP Zero mostra R$ 3.484,82 porque 1 unidade de R$ 124,99 foi cortada
// (original_qty 2, qty 1). A API manda discount = 0,00; o item removido por inteiro (R$ 154,99) continua somado no painel.
describe("total do pedido UP Zero como o painel", () => {
  it("tira as unidades cortadas do valor pedido (pedido 2150)", () => {
    const order = {
      id: "2150",
      requested_total: "3609.81",
      discount: "0.00",
      items: [
        { id: "1", qty: 1, original_qty: 1, unit_price: "219.99", status: "attended" },
        { id: "2", qty: 1, original_qty: 2, unit_price: "124.99", status: "attended" },
        { id: "3", qty: 1, original_qty: 1, unit_price: "154.99", status: "removed" },
      ],
    };
    expect(getOrderPanelAmount(order as never)).toBe(3484.82);
  });

  it("sem corte, mantém o valor do pedido (Kalli)", () => {
    const order = {
      id: "115",
      requested_total: "1226.69",
      items: [
        { id: "1", qty: 19, original_qty: 19, unit_price: "58.00", status: "attended" },
        { id: "2", qty: 1, original_qty: 1, unit_price: "60.89", status: "removed" },
      ],
    };
    expect(getOrderPanelAmount(order as never)).toBe(1226.69);
  });

  it("item sem original_qty ou sem preço não corta nada", () => {
    const order = {
      id: "x",
      requested_total: "100.00",
      items: [{ id: "1", qty: 1, unit_price: "50.00" }, { id: "2", qty: 1, original_qty: 3 }],
    };
    expect(getOrderPanelAmount(order as never)).toBe(100);
  });

  it("quantidade atual maior que a original não soma nada", () => {
    const order = { id: "y", requested_total: "100.00", items: [{ id: "1", qty: 3, original_qty: 2, unit_price: "10.00" }] };
    expect(getOrderPanelAmount(order as never)).toBe(100);
  });
});
