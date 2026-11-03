import { describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/bigquery", () => ({
  bigquery: { query: vi.fn() },
  vestiTable: (dataset: string, table: string) => `\`up-vesti-report.${dataset}.${table}\``,
}));

import { vestiSalesView } from "../src/services/vesti-sales-view";

// Decisão (29/10/2026): "pago" na Vesti = valor atendido menos o desconto do pedido (summary.discount) + status pago, igual ao ERP. Sem frete e sem cupom.

describe("vendas da Vesti com o valor atendido menos o desconto", () => {
  const sql = vestiSalesView("vogabox");

  it("lê a view de vendas e o desconto dos pedidos do mesmo dataset", () => {
    expect(sql).toContain("`up-vesti-report.vogabox.dashboard_vendas_view`");
    expect(sql).toContain("`up-vesti-report.vogabox.pedidos_vesti`");
    expect(sql).toContain("summary.discount");
    expect(sql).not.toContain("total_value");
  });

  it("desconta o desconto só onde já havia valor (nunca negativo), e guarda o antigo em valor_atendido", () => {
    expect(sql).toContain("IF(s.valor_reservado > 0, GREATEST(s.valor_reservado - COALESCE(p.desconto, 0), 0), 0) AS valor_reservado");
    expect(sql).toContain("s.valor_reservado AS valor_atendido");
  });

  it("o dia do pedido é o created_at da Vesti (horário de Brasília), não a data da view que soma 3 horas", () => {
    expect(sql).toContain("COALESCE(DATE(p.criado_em), s.data_ref) AS data_ref");
    expect(sql).toContain("ANY_VALUE(created_at) AS criado_em");
  });

  it("junta pelo id do pedido sem duplicar linha (agrupa os pedidos antes do join)", () => {
    expect(sql).toContain("GROUP BY id");
    expect(sql).toContain("ON p.id = s.pedido_id");
  });
});
