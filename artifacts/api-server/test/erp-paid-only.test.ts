import { beforeEach, describe, expect, it, vi } from "vitest";

// db.select(...).from(sellersTable).where(...) -- usado por resolveErpSellerName pra
// achar o nome de verdade (cliente UpZero com ERP); lista vazia = "não achei", a função
// cai no fallback de tratar o sellerId recebido como já sendo o nome (caso Vesti).
// `sellerLookupResult` é configurável por teste (ver sellerLookupResult.length = 0 no beforeEach).
let sellerLookupResult: Array<{ name: string }> = [];
vi.mock("@workspace/db", async () => ({
  ...(await import("@workspace/db/schema")),
  db: { select: () => ({ from: () => ({ where: () => Promise.resolve(sellerLookupResult) }) }) },
}));

const calls: Array<{ query: string; params?: Record<string, unknown> }> = [];
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
  sellerLookupResult = [];
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
    expect(main.query).toContain("IF(o.status NOT IN ('CANCELADO', 'EXCLUIDO', 'ESPERA'), o.net_amount, 0)");
  });

  it("com paidOnly os contadores de cancelado seguem contando só CANCELADO e EXCLUIDO", async () => {
    await fetchErpDashboard("c1", "ds", "2026-09-01", "2026-09-30", { paidOnly: true }).catch(() => {});
    const main = dashboardQueries().find((q) => q.query.includes("cancelled_orders"))!;
    expect(main.query).toContain("COUNTIF(o.status IN ('CANCELADO', 'EXCLUIDO')) AS cancelled_orders");
    expect(main.query).toContain("SUM(IF(o.status IN ('CANCELADO', 'EXCLUIDO'), o.net_amount, 0))");
  });
});

// Filtros novos de Status/Vendedora/Estado (pedido do time, 18/11/2026). Sem eles, nada muda
// (ver testes acima); com eles, só muda a condição usada pra decidir "essa linha conta".
describe("ERP: filtros novos de Status/Vendedora/Estado", () => {
  it("sem nenhum filtro novo, a query não ganha seller/state no WHERE", async () => {
    await fetchErpDashboard("c1", "ds", "2026-09-01", "2026-09-30").catch(() => {});
    const main = dashboardQueries().find((q) => q.query.includes("cancelled_orders"))!;
    expect(main.query).not.toContain("o.seller");
    expect(main.query).not.toContain("o.state =");
  });

  it("statusBucket=pago usa o mesmo recorte de paidOnly (CANCELADO/EXCLUIDO/ESPERA fora)", async () => {
    await fetchErpDashboard("c1", "ds", "2026-09-01", "2026-09-30", { statusBucket: "pago" }).catch(() => {});
    const main = dashboardQueries().find((q) => q.query.includes("cancelled_orders"))!;
    expect(main.query).toContain("IF(o.status NOT IN ('CANCELADO', 'EXCLUIDO', 'ESPERA'), o.net_amount, 0)");
  });

  it("statusBucket=cancelado inverte a conta: só CANCELADO/EXCLUIDO entra no faturamento", async () => {
    await fetchErpDashboard("c1", "ds", "2026-09-01", "2026-09-30", { statusBucket: "cancelado" }).catch(() => {});
    const main = dashboardQueries().find((q) => q.query.includes("cancelled_orders"))!;
    expect(main.query).toContain("IF(o.status IN ('CANCELADO', 'EXCLUIDO'), o.net_amount, 0)");
  });

  it("statusBucket=outro usa só ESPERA", async () => {
    await fetchErpDashboard("c1", "ds", "2026-09-01", "2026-09-30", { statusBucket: "outro" }).catch(() => {});
    const main = dashboardQueries().find((q) => q.query.includes("cancelled_orders"))!;
    expect(main.query).toContain("IF(o.status IN ('ESPERA'), o.net_amount, 0)");
  });

  it("sellerId sem match em sellersTable (caso Vesti): usa o valor recebido como nome, comparação sem diferenciar maiúscula", async () => {
    await fetchErpDashboard("c1", "ds", "2026-09-01", "2026-09-30", { sellerId: "ROSA" }).catch(() => {});
    const main = dashboardQueries().find((q) => q.query.includes("cancelled_orders"))!;
    expect(main.query).toContain("AND UPPER(o.seller) = UPPER(@sellerName)");
    expect(main.query).not.toContain("ROSA");
    expect(main.params?.sellerName).toBe("ROSA");
  });

  it("sellerId COM match em sellersTable (caso UpZero+ERP, ex: MX Fashion/Obzee): usa o nome resolvido, não o id cru", async () => {
    sellerLookupResult = [{ name: "Clarice" }];
    await fetchErpDashboard("c1", "ds", "2026-09-01", "2026-09-30", { sellerId: "seller_uuid_abc123" }).catch(() => {});
    const main = dashboardQueries().find((q) => q.query.includes("cancelled_orders"))!;
    expect(main.query).toContain("AND UPPER(o.seller) = UPPER(@sellerName)");
    expect(main.params?.sellerName).toBe("Clarice");
    expect(main.query).not.toContain("seller_uuid_abc123");
  });

  it("state vira condição no WHERE e vai nos params (não é concatenado na string)", async () => {
    await fetchErpDashboard("c1", "ds", "2026-09-01", "2026-09-30", { state: "SP" }).catch(() => {});
    const main = dashboardQueries().find((q) => q.query.includes("cancelled_orders"))!;
    // Achado 19/11/2026: era "o.state" -- "o" (all_orders) nunca teve essa coluna, só nasce
    // depois do JOIN (SELECT o.*, g.state). BigQuery real dava "Name state not found inside o"
    // sempre que o filtro de Estado era de fato usado; g (customer_geo) tem a coluna de verdade.
    expect(main.query).toContain("AND g.state = @state");
    expect(main.query).not.toContain("= 'SP'");
    expect(main.params?.state).toBe("SP");
  });
});
