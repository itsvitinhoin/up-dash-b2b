import { describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/bigquery", () => ({
  bigquery: { query: vi.fn() },
  vestiTable: (dataset: string, table: string) => `\`up-vesti-report.${dataset}.${table}\``,
}));

import { vestiSalesView } from "../src/services/vesti-sales-view";

// Decisão do time (29/10/2026): "pago" na Vesti = coluna Total (summary.total_value, já com desconto) + status pago, igual ao ERP.

describe("vendas da Vesti com o valor Total (já descontado)", () => {
  const sql = vestiSalesView("vogabox");

  it("lê a view de vendas e o Total dos pedidos do mesmo dataset", () => {
    expect(sql).toContain("`up-vesti-report.vogabox.dashboard_vendas_view`");
    expect(sql).toContain("`up-vesti-report.vogabox.pedidos_vesti`");
    expect(sql).toContain("summary.total_value");
  });

  it("troca o valor atendido pelo Total só onde já havia valor, e guarda o antigo em valor_atendido", () => {
    expect(sql).toContain("IF(s.valor_reservado > 0, COALESCE(p.total_value, s.valor_reservado), 0) AS valor_reservado");
    expect(sql).toContain("s.valor_reservado AS valor_atendido");
  });

  it("junta pelo id do pedido sem duplicar linha (agrupa os pedidos antes do join)", () => {
    expect(sql).toContain("GROUP BY id");
    expect(sql).toContain("ON p.id = s.pedido_id");
  });
});
