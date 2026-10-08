import { describe, expect, it } from "vitest";
import { buildAcquisitionBlock } from "../src/services/recompra-acquisition";

describe("buildAcquisitionBlock", () => {
  it("soma todos os pedidos pagos dos clientes na primeira compra e calcula o ticket", () => {
    const block = buildAcquisitionBlock([
      [{ paidValue: 100 }],
      [{ paidValue: 50 }, { paidValue: 150 }], // cliente novo com 2 pedidos no periodo: ambos entram
    ]);
    expect(block).toEqual({ faturamento: 300, vendas: 3, clientes: 2, ticketMedio: 100 });
  });

  it("sem clientes novos: zeros e ticket nulo (nunca divide por zero)", () => {
    expect(buildAcquisitionBlock([])).toEqual({ faturamento: 0, vendas: 0, clientes: 0, ticketMedio: null });
  });
});
