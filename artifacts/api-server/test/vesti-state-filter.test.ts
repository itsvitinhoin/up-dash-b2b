import { beforeEach, describe, expect, it, vi } from "vitest";

// Filtro de ESTADO (UF) da Visão geral para clientes Vesti (BigQuery) e a cobertura de estado dos pedidos pagos.
// O BigQuery é simulado: o que se verifica é o SQL e os parâmetros que saem, e a conta da cobertura.

const calls = vi.hoisted(() => [] as Array<{ query: string; params?: Record<string, unknown> }>);
const respond = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));

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
    query: vi.fn(async (options: { query: string; params?: Record<string, unknown> }) => {
      calls.push(options);
      return [respond.rows];
    }),
  },
  vestiTable: (dataset: string, table: string) => `\`up-vesti-report.${dataset}.${table}\``,
}));

import { computeVestiWindow, fetchVestiStateCoverage } from "../src/services/vestiAnalytics";

beforeEach(() => {
  calls.length = 0;
  respond.rows = [];
});

describe("filtro de estado nos clientes Vesti", () => {
  it("com estado: todas as consultas da janela filtram por UF (maiúsculas dos dois lados) e levam o parâmetro", async () => {
    await computeVestiWindow("vogabox", "2026-10-01", "2026-10-26", { state: "sp" }, false);
    const withFilter = calls.filter((c) => c.query.includes("UPPER(v.estado) = UPPER(@state)"));
    expect(withFilter.length).toBeGreaterThan(0);
    // toda consulta que usa o filtro manda o parâmetro; nenhum valor é colado no SQL
    for (const call of withFilter) expect(call.params).toMatchObject({ state: "sp" });
    expect(calls.every((c) => !c.query.includes("'sp'"))).toBe(true);
  });

  it("sem estado: o SQL não ganha nenhuma condição de estado", async () => {
    await computeVestiWindow("vogabox", "2026-10-01", "2026-10-26", {}, false);
    expect(calls.some((c) => c.query.includes("@state"))).toBe(false);
  });

  it("estado junto com vendedora: as duas condições entram", async () => {
    await computeVestiWindow("vogabox", "2026-10-01", "2026-10-26", { state: "MG", sellerId: "Ana" }, false);
    const joined = calls.find((c) => c.query.includes("@state") && c.query.includes("@sellerId"));
    expect(joined?.params).toMatchObject({ state: "MG", sellerId: "Ana" });
  });
});

describe("fetchVestiStateCoverage", () => {
  it("é a fração de pedidos PAGOS com estado preenchido; ignora o filtro de estado e usa só os pedidos pagos", async () => {
    respond.rows = [{ pagos: 473, pagos_com_estado: 105 }];
    const coverage = await fetchVestiStateCoverage("vogabox", "2026-07-28", "2026-10-26");
    expect(coverage).toBeCloseTo(105 / 473, 5);
    expect(calls[0].query).toContain("IF(pago, pedido_id, NULL)");
    expect(calls[0].query).toContain("estado IS NOT NULL AND TRIM(estado) != ''");
    expect(calls[0].query).not.toContain("@state");
    expect(calls[0].params).toEqual({ dateFrom: "2026-07-28", dateTo: "2026-10-26" });
  });

  it("cliente com 100% e cliente com 0%", async () => {
    respond.rows = [{ pagos: 15, pagos_com_estado: 15 }];
    expect(await fetchVestiStateCoverage("fiore", "2026-07-28", "2026-10-26")).toBe(1);
    respond.rows = [{ pagos: 107, pagos_com_estado: 0 }];
    expect(await fetchVestiStateCoverage("tuba_plus", "2026-07-28", "2026-10-26")).toBe(0);
  });

  it("sem pedido pago na janela: nulo (a tela não avisa nada)", async () => {
    respond.rows = [{ pagos: 0, pagos_com_estado: 0 }];
    expect(await fetchVestiStateCoverage("estime", "2026-07-28", "2026-10-26")).toBeNull();
    respond.rows = [];
    expect(await fetchVestiStateCoverage("estime", "2026-07-28", "2026-10-26")).toBeNull();
  });

  it("nunca passa de 100%", async () => {
    respond.rows = [{ pagos: 10, pagos_com_estado: 12 }];
    expect(await fetchVestiStateCoverage("x", "2026-07-28", "2026-10-26")).toBe(1);
  });
});
