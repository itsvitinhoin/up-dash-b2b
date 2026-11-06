import { beforeEach, describe, expect, it, vi } from "vitest";

// RFM dos clientes Vesti: o contrato GetRfmResponse exige `latestOrders` em cada cliente; sem isso a rota dava 500 (ZodError) em toda conta Vesti.
// O BigQuery é simulado: as 3 consultas do RFM saem em ordem (clientes agregados, meses, últimos pedidos).

const calls = vi.hoisted(() => [] as Array<{ query: string; params?: Record<string, unknown> }>);
const answers = vi.hoisted(() => [] as Array<Array<Record<string, unknown>>>);

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
      return [answers.shift() ?? []];
    }),
  },
  vestiTable: (dataset: string, table: string) => `\`up-vesti-report.${dataset}.${table}\``,
}));

import { GetRfmResponse } from "@workspace/api-zod";
import { fetchVestiRfm } from "../src/services/vestiAnalytics";

beforeEach(() => {
  calls.length = 0;
  answers.length = 0;
});

const filters = { sortBy: "monetary", sortDir: "desc" as const, page: 1, limit: 25 };

describe("RFM Vesti com últimos pedidos", () => {
  it("devolve latestOrders por cliente (até 3, vindos da consulta) e a resposta passa no contrato", async () => {
    answers.push(
      [
        { id: "c1", name: "Ana", email: "ana@x.com", frequency: 2, monetary: 500, first_purchase_at: "2026-09-02", last_purchase_at: "2026-09-20" },
        { id: "c2", name: null, email: "b@x.com", frequency: 1, monetary: 100, first_purchase_at: "2026-09-05", last_purchase_at: "2026-09-05" },
      ],
      [{ month: "2026-09", cliente_id: "c1" }],
      [
        { pedido_id: "p2", cliente_id: "c1", pedido_code: 1002, status_pedido: "Faturado", amount: 300, fulfilled_amount: 280, requested_quantity: 3, fulfilled_quantity: 3, created_at: "2026-09-20" },
        { pedido_id: "p1", cliente_id: "c1", pedido_code: 1001, status_pedido: null, amount: 220, fulfilled_amount: 220, requested_quantity: 2, fulfilled_quantity: 2, created_at: "2026-09-02" },
      ],
    );

    const rfm = await fetchVestiRfm("vogabox", "2026-09-01", "2026-09-30", filters);
    const parsed = GetRfmResponse.parse({ ...rfm, page: 1, limit: 25 });

    const ana = parsed.customers.find((c) => c.id === "c1");
    expect(ana?.latestOrders.map((o) => o.externalId)).toEqual(["1002", "1001"]);
    expect(ana?.latestOrders[1].status).toBe("Sem status");
    // cliente sem pedido na consulta fica com lista vazia, não undefined
    expect(parsed.customers.find((c) => c.id === "c2")?.latestOrders).toEqual([]);
  });

  it("a consulta dos últimos pedidos só olha os clientes da página, pega 3 por cliente e usa o valor da regra nova", async () => {
    answers.push([{ id: "c1", name: "Ana", email: "ana@x.com", frequency: 1, monetary: 10, first_purchase_at: "2026-09-02", last_purchase_at: "2026-09-02" }], [], []);
    await fetchVestiRfm("vogabox", "2026-09-01", "2026-09-30", filters);

    const last = calls[calls.length - 1];
    expect(last.query).toContain("<= 3");
    expect(last.query).toContain("PARTITION BY cliente_id");
    expect(last.query).toContain("summary.discount");
    expect(last.params?.customerIds).toEqual(["c1"]);
  });

  it("sem clientes na página não faz a consulta dos últimos pedidos", async () => {
    answers.push([], [], []);
    await fetchVestiRfm("vogabox", "2026-09-01", "2026-09-30", filters);
    expect(calls.some((c) => c.query.includes("<= 3"))).toBe(false);
  });
});
