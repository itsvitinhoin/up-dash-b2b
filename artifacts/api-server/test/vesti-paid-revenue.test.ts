import { beforeEach, describe, expect, it, vi } from "vitest";

// Faturamento PAGO do e-commerce Vesti. `revenue` da Vesti soma todos os pedidos (paridade com o legado); a Visão geral precisa do valor só
// dos pedidos pagos. O BigQuery é simulado: verifica-se o SQL e a leitura do resultado.

const calls = vi.hoisted(() => [] as Array<{ query: string }>);
const kpiRow = vi.hoisted(() => ({ row: null as Record<string, unknown> | null }));

vi.mock("@workspace/db", () => ({
  db: { select: () => ({ from: () => ({ where: async () => [] }) }) },
  clientsTable: { commercePlatform: {}, bigqueryDataset: {}, id: {} },
}));
vi.mock("../src/middlewares/auth", () => ({
  authenticate: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
  resolveClientId: () => undefined,
}));
vi.mock("../src/lib/bigquery", () => ({
  bigquery: {
    query: vi.fn(async (options: { query: string }) => {
      calls.push(options);
      // a consulta dos indicadores é a única que cria "first_purchase"
      return [options.query.includes("first_purchase") && kpiRow.row ? [kpiRow.row] : []];
    }),
  },
  vestiTable: (dataset: string, table: string) => `\`up-vesti-report.${dataset}.${table}\``,
}));

import { computeVestiWindow } from "../src/services/vestiAnalytics";

beforeEach(() => {
  calls.length = 0;
  kpiRow.row = null;
});

describe("Vesti: faturamento pago", () => {
  it("soma só o valor reservado dos pedidos PAGOS, separado de `revenue` (todos os pedidos)", async () => {
    kpiRow.row = { revenue: 1000, requested_revenue: 1500, paid_revenue: 700, leads: 10, approved_leads: 7, customers: 6, new_buyers: 4, returning_buyers: 2, repeat_customers: 1 };
    const window = await computeVestiWindow("vogabox", "2026-10-01", "2026-10-27", {}, false);
    expect(window.kpis).toMatchObject({ revenue: 1000, paidRevenue: 700, requestedRevenue: 1500, orders: 7 });
    const kpiQuery = calls.find((c) => c.query.includes("first_purchase"))!.query;
    expect(kpiQuery).toContain("COALESCE(SUM(IF(v.pago, v.valor_reservado, 0)), 0) AS paid_revenue");
    // `revenue` continua somando todos (não ganhou filtro de pago)
    expect(kpiQuery).toContain("COALESCE(SUM(v.valor_reservado), 0) AS revenue");
  });

  it("sem linha de resultado: tudo zero, inclusive o faturamento pago", async () => {
    const window = await computeVestiWindow("vogabox", "2026-10-01", "2026-10-27", {}, false);
    expect(window.kpis.paidRevenue).toBe(0);
    expect(window.kpis.revenue).toBe(0);
  });

  it("o filtro de estado continua valendo junto: o faturamento pago respeita a mesma janela de pedidos filtrada", async () => {
    kpiRow.row = { revenue: 1, requested_revenue: 1, paid_revenue: 1, leads: 1, approved_leads: 1, customers: 1, new_buyers: 1, returning_buyers: 0, repeat_customers: 0 };
    await computeVestiWindow("vogabox", "2026-10-01", "2026-10-27", { state: "SP" }, false);
    const kpiQuery = calls.find((c) => c.query.includes("first_purchase"))!.query;
    expect(kpiQuery).toContain("UPPER(v.estado) = UPPER(@state)");
    expect(kpiQuery).toContain("paid_revenue");
  });
});
