import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@workspace/db/schema";
import { shouldStoreGa4ProductViewsInPostgres } from "../src/services/ga4-daily-rules";

// Produtos do GA4 de cliente B2B ficam so no BigQuery (09/11/2026): a tabela de produtos do Postgres so e lida pela tela de Produtos do
// B2C, e 395 mil linhas de 14 clientes B2B ocupavam 36% dela sem ninguem ler. Estes testes usam um Postgres de verdade em memoria
// (PGlite) com as duas tabelas do GA4; a API do GA4 e o BigQuery sao simulados.

const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("@workspace/db", async () => ({
  ...(await import("@workspace/db/schema")),
  db: new Proxy(
    {},
    {
      get: (_, key) => {
        const member = state.db[key];
        return typeof member === "function" ? member.bind(state.db) : member;
      },
    },
  ),
}));

vi.mock("../src/services/ga4", () => ({
  fetchGa4DailyMetrics: vi.fn(async () => [
    { date: "2026-11-08", sessions: 10, pageViews: 20, productViews: 5, addToCarts: 2, checkouts: 1, purchases: 1 },
  ]),
  fetchGa4ProductViewsDaily: vi.fn(async () => [
    { date: "2026-11-08", itemId: "sku-1", itemName: "Camiseta", itemVariant: null, views: 3 },
    { date: "2026-11-08", itemId: "sku-2", itemName: "Calca", itemVariant: "P", views: 2 },
  ]),
  fetchGa4FunnelMetrics: vi.fn(async () => null),
  fetchGa4ProductViewMetrics: vi.fn(async () => null),
}));

const bq = vi.hoisted(() => ({ write: vi.fn() }));
vi.mock("../src/services/ga4-bigquery", () => ({
  writeGa4ToBigQuery: (...args: unknown[]) => bq.write(...args),
}));

import { syncGa4DailyForClient } from "../src/services/ga4-daily-sync";

const pg = new PGlite();

beforeAll(async () => {
  await pg.exec(`
    CREATE TABLE ga4_daily_metrics (
      client_id text NOT NULL, metric_date date NOT NULL,
      sessions integer NOT NULL DEFAULT 0, page_views integer NOT NULL DEFAULT 0, product_views integer NOT NULL DEFAULT 0,
      add_to_carts integer NOT NULL DEFAULT 0, checkouts integer NOT NULL DEFAULT 0, purchases integer NOT NULL DEFAULT 0,
      synced_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (client_id, metric_date)
    );
    CREATE TABLE ga4_product_views_daily (
      client_id text NOT NULL, metric_date date NOT NULL,
      item_id text NOT NULL DEFAULT '', item_name text NOT NULL DEFAULT '', item_variant text NOT NULL DEFAULT '',
      views integer NOT NULL DEFAULT 0, synced_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (client_id, metric_date, item_id, item_name, item_variant)
    );
  `);
  state.db = drizzle(pg, { schema });
});

afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  await pg.exec("DELETE FROM ga4_daily_metrics; DELETE FROM ga4_product_views_daily;");
  bq.write.mockReset();
  bq.write.mockResolvedValue({ dailyRows: 1, productRows: 2 });
});

const count = async (table: string, clientId: string): Promise<number> =>
  Number((await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE client_id = $1`, [clientId])).rows[0].n);

// Copia antiga: 3 linhas de produto do cliente B2B e 2 de um cliente B2C.
const seedOldProductRows = () =>
  pg.exec(`
    INSERT INTO ga4_product_views_daily (client_id, metric_date, item_id, item_name, item_variant, views) VALUES
      ('b2b', '2026-10-01', 'old-1', 'Velho', '', 9),
      ('b2b', '2026-10-02', 'old-2', 'Velho 2', '', 8),
      ('b2b', '2026-11-08', 'sku-1', 'Camiseta', '', 1),
      ('b2c', '2026-11-08', 'sku-9', 'Outro', '', 4),
      ('b2c', '2026-11-07', 'sku-8', 'Outro 2', '', 5);
  `);

const base = (clientId: string) => ({
  clientId,
  clientName: `Cliente ${clientId}`,
  propertyId: "123456789",
  from: "2026-11-08",
  to: "2026-11-08",
  productFrom: "2026-11-08",
});

describe("shouldStoreGa4ProductViewsInPostgres", () => {
  it("B2B com BigQuery disponivel: produtos so no BigQuery", () => {
    expect(shouldStoreGa4ProductViewsInPostgres({ dashboardType: "B2B", bigQueryAvailable: true })).toBe(false);
  });

  it("B2B sem BigQuery neste turno: o Postgres segue sendo o unico destino (nada se perde)", () => {
    expect(shouldStoreGa4ProductViewsInPostgres({ dashboardType: "B2B", bigQueryAvailable: false })).toBe(true);
  });

  it("B2C continua gravando no Postgres, com ou sem BigQuery (a tela de Produtos le de la)", () => {
    expect(shouldStoreGa4ProductViewsInPostgres({ dashboardType: "B2C", bigQueryAvailable: true })).toBe(true);
    expect(shouldStoreGa4ProductViewsInPostgres({ dashboardType: "B2C", bigQueryAvailable: false })).toBe(true);
  });

  it("tipo desconhecido grava no Postgres (na duvida, nao perde)", () => {
    expect(shouldStoreGa4ProductViewsInPostgres({ dashboardType: null, bigQueryAvailable: true })).toBe(true);
    expect(shouldStoreGa4ProductViewsInPostgres({ dashboardType: undefined, bigQueryAvailable: true })).toBe(true);
  });
});

describe("syncGa4DailyForClient: onde ficam os produtos", () => {
  it("padrao (B2C): grava o diario e os produtos no Postgres e manda os produtos ao BigQuery", async () => {
    const result = await syncGa4DailyForClient({ ...base("b2c"), bigQuery: {} as any });
    expect(await count("ga4_daily_metrics", "b2c")).toBe(1);
    expect(await count("ga4_product_views_daily", "b2c")).toBe(2);
    expect(result.prunedProductRows).toBe(0);
    expect(bq.write).toHaveBeenCalledTimes(1);
    expect(bq.write.mock.calls[0][1].productViews).toHaveLength(2);
  });

  it("B2B: grava o diario no Postgres, NAO grava produtos e apaga so a copia antiga desse cliente", async () => {
    await seedOldProductRows();
    const result = await syncGa4DailyForClient({ ...base("b2b"), bigQuery: {} as any, storeProductViewsInPostgres: false });

    expect(await count("ga4_daily_metrics", "b2b")).toBe(1); // o diario fica (o alerta de visitas usa)
    expect(await count("ga4_product_views_daily", "b2b")).toBe(0); // copia antiga apagada, nada novo gravado
    expect(await count("ga4_product_views_daily", "b2c")).toBe(2); // outro cliente intacto
    expect(result.prunedProductRows).toBe(3);
    expect(result.productViewRows).toBe(2); // buscou os 2 itens no GA4 ...
    expect(bq.write.mock.calls[0][1].productViews).toHaveLength(2); // ... e entregou ao BigQuery
  });

  it("B2B sem nada para apagar: nao apaga nem conta nada (rodadas seguintes sao so uma contagem)", async () => {
    const result = await syncGa4DailyForClient({ ...base("b2b"), bigQuery: {} as any, storeProductViewsInPostgres: false });
    expect(result.prunedProductRows).toBe(0);
    expect(await count("ga4_product_views_daily", "b2b")).toBe(0);
  });

  it("B2B: se o BigQuery falhar, NAO apaga a copia do Postgres (seria a unica)", async () => {
    await seedOldProductRows();
    bq.write.mockRejectedValue(new Error("bigquery fora do ar"));

    await expect(
      syncGa4DailyForClient({ ...base("b2b"), bigQuery: {} as any, storeProductViewsInPostgres: false }),
    ).rejects.toThrow(/BigQuery: bigquery fora do ar/);

    expect(await count("ga4_product_views_daily", "b2b")).toBe(3);
  });

  it("sem BigQuery nesta chamada, mesmo pedindo B2B grava os produtos no Postgres", async () => {
    const result = await syncGa4DailyForClient({ ...base("b2b"), bigQuery: null, storeProductViewsInPostgres: false });
    expect(await count("ga4_product_views_daily", "b2b")).toBe(2);
    expect(result.prunedProductRows).toBe(0);
    expect(bq.write).not.toHaveBeenCalled();
  });
});
