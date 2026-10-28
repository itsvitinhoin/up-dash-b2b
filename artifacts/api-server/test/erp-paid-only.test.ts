import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", async () => ({
  ...(await import("@workspace/db/schema")),
  db: {},
}));

const calls: Array<{ query: string }> = [];
vi.mock("../src/lib/bigquery", () => ({
  bigquery: {
    query: vi.fn(async (options: { query: string }) => {
      calls.push(options);
      return [[]];
    }),
  },
  vestiTable: (dataset: string, table: string) => `\`up-vesti-report.${dataset}.${table}\``,
}));

import { ERP_UNPAID_STATUSES, fetchErpDashboard } from "../src/services/erpAnalytics";

// Cards da Visão geral (decisão do time, 27/10/2026): venda paga no ERP = sem pedido em ESPERA.
// Só quem pede `paidOnly` muda; as páginas de ERP e a Performance continuam contando tudo que não é cancelado/excluído.

const dashboardQueries = () => calls.filter((call) => call.query.includes("net_amount"));

beforeEach(() => {
  calls.length = 0;
});

describe("ERP: só venda paga (sem ESPERA) apenas quando pedido", () => {
  it("a lista de não pagos é só ESPERA", () => {
    expect(ERP_UNPAID_STATUSES).toEqual(["ESPERA"]);
  });

  it("sem paidOnly o ESPERA continua contando (como sempre foi)", async () => {
    await fetchErpDashboard("c1", "ds", "2026-09-01", "2026-09-30").catch(() => {});
    const queries = dashboardQueries();
    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) expect(q.query).not.toContain("ESPERA");
  });

  it("com paidOnly o ESPERA sai da receita, dos pedidos e do histórico de clientes", async () => {
    await fetchErpDashboard("c1", "ds", "2026-09-01", "2026-09-30", { paidOnly: true }).catch(() => {});
    const queries = dashboardQueries();
    expect(queries.length).toBeGreaterThan(0);
    const main = queries.find((q) => q.query.includes("cancelled_orders"))!;
    expect(main.query).toContain("o.status NOT IN ('CANCELADO', 'EXCLUIDO', 'ESPERA')");
    expect(main.query).toContain("IF(o.status IN ('CANCELADO', 'EXCLUIDO', 'ESPERA'), 0, o.net_amount)");
  });

  it("com paidOnly os contadores de cancelado seguem contando só CANCELADO e EXCLUIDO", async () => {
    await fetchErpDashboard("c1", "ds", "2026-09-01", "2026-09-30", { paidOnly: true }).catch(() => {});
    const main = dashboardQueries().find((q) => q.query.includes("cancelled_orders"))!;
    expect(main.query).toContain("COUNTIF(o.status IN ('CANCELADO', 'EXCLUIDO')) AS cancelled_orders");
    expect(main.query).toContain("SUM(IF(o.status IN ('CANCELADO', 'EXCLUIDO'), o.net_amount, 0))");
  });
});
