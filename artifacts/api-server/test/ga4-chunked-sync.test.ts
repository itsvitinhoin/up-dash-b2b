import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@workspace/db/schema";

// 13/11/2026: backfill de janela larga buscado e gravado em PEDAÇOS (a Vivadress estourou a memória do job ao guardar 400 dias de produto e
// funil de uma vez). Banco de verdade em memória (PGlite); a API do GA4 e o BigQuery são simulados e registram cada chamada.

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

type Window = { dateFrom: string; dateTo: string };
const ga4 = vi.hoisted(() => ({ daily: vi.fn(), products: vi.fn(), traffic: vi.fn(), funnel: vi.fn() }));
vi.mock("../src/services/ga4", () => ({
  fetchGa4DailyMetrics: (...args: unknown[]) => ga4.daily(...args),
  fetchGa4ProductViewsDaily: (...args: unknown[]) => ga4.products(...args),
  fetchGa4TrafficDaily: (...args: unknown[]) => ga4.traffic(...args),
  fetchGa4ProductFunnelDaily: (...args: unknown[]) => ga4.funnel(...args),
  fetchGa4FunnelMetrics: vi.fn(async () => null),
  fetchGa4ProductViewMetrics: vi.fn(async () => null),
}));

const bq = vi.hoisted(() => ({ write: vi.fn() }));
vi.mock("../src/services/ga4-bigquery", () => ({
  writeGa4ToBigQuery: (...args: unknown[]) => bq.write(...args),
}));

import { planGa4Chunks, syncGa4DailyForClient } from "../src/services/ga4-daily-sync";

const pg = new PGlite();
const originalChunkDays = process.env.GA4_CHUNK_DAYS;

beforeAll(async () => {
  // 90 dias em pedaços de 40: [01/01-09/02], [10/02-21/03], [22/03-31/03].
  process.env.GA4_CHUNK_DAYS = "40";
  await pg.exec(`
    CREATE TABLE ga4_daily_metrics (
      client_id text NOT NULL, metric_date date NOT NULL,
      sessions integer NOT NULL DEFAULT 0, page_views integer NOT NULL DEFAULT 0, product_views integer NOT NULL DEFAULT 0,
      add_to_carts integer NOT NULL DEFAULT 0, checkouts integer NOT NULL DEFAULT 0, purchases integer NOT NULL DEFAULT 0,
      synced_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (client_id, metric_date)
    );
    CREATE TABLE ga4_product_views_daily (
      client_id text NOT NULL, metric_date date NOT NULL,
      item_id text NOT NULL DEFAULT '', item_name text NOT NULL DEFAULT '', item_variant text NOT NULL DEFAULT '',
      views integer NOT NULL DEFAULT 0, synced_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (client_id, metric_date, item_id, item_name, item_variant)
    );
    CREATE TABLE sync_jobs (
      id text PRIMARY KEY, client_id text NOT NULL, status text NOT NULL DEFAULT 'pending',
      job_type text NOT NULL DEFAULT 'upzero_transactional', result jsonb
    );
  `);
  state.db = drizzle(pg, { schema });
});

afterAll(async () => {
  if (originalChunkDays === undefined) delete process.env.GA4_CHUNK_DAYS;
  else process.env.GA4_CHUNK_DAYS = originalChunkDays;
  await pg.close();
});

const trafficRow = (date: string) => ({
  date,
  channelGroup: "Paid Social",
  source: "facebook",
  medium: "cpm",
  campaign: "Remarketing",
  sessions: 100,
  totalUsers: 90,
  engagedSessions: 60,
  addToCarts: 12,
  checkouts: 6,
  purchases: 3,
  purchaseRevenue: 450.5,
});

const funnelRow = (date: string) => ({
  date,
  itemId: "sku-1",
  itemName: "Camiseta",
  itemVariant: null,
  itemsViewed: 30,
  itemsAddedToCart: 8,
  itemsCheckedOut: 4,
  itemsPurchased: 2,
  itemRevenue: 199.8,
  grossItemRevenue: 199.8,
  itemRefundAmount: 0,
});

type BqCall = {
  to: string;
  daily?: unknown[];
  from?: string;
  productViews?: unknown[];
  productFrom?: string;
  traffic?: unknown[];
  trafficFrom?: string;
  productFunnel?: unknown[];
  productFunnelFrom?: string;
};

const bqCalls = (): BqCall[] => bq.write.mock.calls.map((call) => call[1] as BqCall);
const windows = (fn: { mock: { calls: unknown[][] } }): Array<[string, string]> =>
  fn.mock.calls.map((call) => [(call[0] as Window).dateFrom, (call[0] as Window).dateTo]);

beforeEach(async () => {
  await pg.exec("DELETE FROM ga4_daily_metrics; DELETE FROM ga4_product_views_daily; DELETE FROM sync_jobs;");
  for (const fn of Object.values(ga4)) fn.mockReset();
  ga4.daily.mockResolvedValue([]);
  // Cada busca devolve UMA linha datada no início da janela pedida (como o GA4 devolve dentro do período).
  ga4.products.mockImplementation(async (w: Window) => [{ date: w.dateFrom, itemId: "sku-1", itemName: "Camiseta", itemVariant: null, views: 3 }]);
  ga4.traffic.mockImplementation(async (w: Window) => [trafficRow(w.dateFrom)]);
  ga4.funnel.mockImplementation(async (w: Window) => [funnelRow(w.dateFrom)]);
  bq.write.mockReset();
  bq.write.mockImplementation(async (_bq: unknown, params: BqCall) => ({
    dailyRows: params.daily ? params.daily.length : 0,
    productRows: params.productViews ? params.productViews.length : 0,
    trafficRows: params.traffic ? params.traffic.length : 0,
    productFunnelRows: params.productFunnel ? params.productFunnel.length : 0,
  }));
});

// Cliente em dia no diário (3 dias) que precisa do backfill de 90 dias de produtos, origem do tráfego e funil (como no dia em que a tabela nova entrou).
const wide = (overrides: Record<string, unknown> = {}) => ({
  clientId: "c1",
  clientName: "Cliente c1",
  propertyId: "123456789",
  from: "2026-03-29",
  to: "2026-03-31",
  productFrom: "2026-01-01",
  trafficFrom: "2026-01-01",
  productFunnelFrom: "2026-01-01",
  bigQuery: {} as never,
  ...overrides,
});

describe("planGa4Chunks", () => {
  it("janela curta (a rodada horária) é um pedaço só: caminho de sempre", () => {
    expect(
      planGa4Chunks({ from: "2026-03-29", to: "2026-03-31", productFrom: "2026-03-29", trafficFrom: "2026-03-29", productFunnelFrom: "2026-03-29", bigQuery: {} as never }),
    ).toHaveLength(1);
  });

  it("usa a união das janelas das tabelas: o funil pode precisar de 90 dias enquanto o diário precisa de 3", () => {
    expect(planGa4Chunks(wide())).toEqual([
      { from: "2026-01-01", to: "2026-02-09" },
      { from: "2026-02-10", to: "2026-03-21" },
      { from: "2026-03-22", to: "2026-03-31" },
    ]);
  });

  it("sem BigQuery a origem do tráfego e o funil não rodam, então não alargam a janela", () => {
    expect(planGa4Chunks(wide({ bigQuery: null, productFrom: "2026-03-29" }))).toHaveLength(1);
  });
});

describe("syncGa4DailyForClient em pedaços", () => {
  it("busca e grava um pedaço por vez, cada tabela só no trecho da própria janela, e o diário UMA vez no fim", async () => {
    const result = await syncGa4DailyForClient(wide());

    const expected: Array<[string, string]> = [
      ["2026-01-01", "2026-02-09"],
      ["2026-02-10", "2026-03-21"],
      ["2026-03-22", "2026-03-31"],
    ];
    expect(windows(ga4.products)).toEqual(expected);
    expect(windows(ga4.traffic)).toEqual(expected);
    expect(windows(ga4.funnel)).toEqual(expected);
    // Diário: janela curta, uma busca só.
    expect(windows(ga4.daily)).toEqual([["2026-03-29", "2026-03-31"]]);

    const calls = bqCalls();
    expect(calls).toHaveLength(4);
    calls.slice(0, 3).forEach((call, i) => {
      expect(call.daily).toBeUndefined();
      expect(call.from).toBeUndefined();
      expect([call.productFrom, call.to]).toEqual(expected[i]);
      expect([call.trafficFrom, call.to]).toEqual(expected[i]);
      expect([call.productFunnelFrom, call.to]).toEqual(expected[i]);
    });
    // O diário (marcador de cobertura) é o ÚLTIMO e só ele leva o diário.
    expect(calls[3].daily).toHaveLength(3);
    expect(calls[3].from).toBe("2026-03-29");
    expect(calls[3].to).toBe("2026-03-31");
    expect(calls[3].productViews).toBeUndefined();
    expect(calls[3].traffic).toBeUndefined();
    expect(calls[3].productFunnel).toBeUndefined();

    expect(result).toMatchObject({
      from: "2026-03-29",
      to: "2026-03-31",
      productFrom: "2026-01-01",
      days: 3,
      productViewRows: 3,
      trafficRows: 3,
      trafficFrom: "2026-01-01",
      trafficTo: "2026-03-31",
      trafficError: null,
      productFunnelRows: 3,
      productFunnelFrom: "2026-01-01",
      productFunnelTo: "2026-03-31",
      productFunnelError: null,
      bigQuery: { dailyRows: 3, productRows: 3, trafficRows: 3, productFunnelRows: 3 },
    });
  });

  it("tabela com janela curta não é buscada nos pedaços antigos (a origem do tráfego só precisa dos últimos dias)", async () => {
    await syncGa4DailyForClient(wide({ trafficFrom: "2026-03-29" }));

    expect(windows(ga4.traffic)).toEqual([["2026-03-29", "2026-03-31"]]);
    expect(windows(ga4.funnel)).toHaveLength(3);
    // Os pedaços antigos gravam só produtos e funil, sem a origem do tráfego.
    const calls = bqCalls();
    expect(calls[0].traffic).toBeUndefined();
    expect(calls[1].traffic).toBeUndefined();
    expect(calls[2].traffic).toHaveLength(1);
    expect(calls[2].trafficFrom).toBe("2026-03-29");
  });

  it("cada pedaço troca só a própria janela dos produtos no Postgres (cliente B2C): o que sumiu do GA4 dentro do pedaço é apagado", async () => {
    // Linha velha dentro do 1º pedaço (não vem mais do GA4) e outra FORA de todos os pedaços (tem que ficar).
    await pg.exec(`
      INSERT INTO ga4_product_views_daily (client_id, metric_date, item_id, item_name, item_variant, views) VALUES
        ('c1', '2026-01-15', 'velho', 'Item velho', '', 9),
        ('c1', '2025-12-31', 'fora', 'Item de antes', '', 7);
    `);

    await syncGa4DailyForClient(wide());

    const rows = (await pg.query("SELECT metric_date::text AS d, item_id FROM ga4_product_views_daily WHERE client_id = 'c1' ORDER BY metric_date")).rows as Array<{ d: string; item_id: string }>;
    expect(rows).toEqual([
      { d: "2025-12-31", item_id: "fora" },
      { d: "2026-01-01", item_id: "sku-1" },
      { d: "2026-02-10", item_id: "sku-1" },
      { d: "2026-03-22", item_id: "sku-1" },
    ]);
    // Diário gravado no Postgres no fim: 3 dias.
    expect(((await pg.query("SELECT count(*)::int AS n FROM ga4_daily_metrics WHERE client_id = 'c1'")).rows[0] as { n: number }).n).toBe(3);
  });

  it("cliente B2B: produtos só no BigQuery; a cópia antiga do Postgres é apagada depois de o BigQuery gravar", async () => {
    await pg.exec(`
      INSERT INTO ga4_product_views_daily (client_id, metric_date, item_id, item_name, item_variant, views) VALUES
        ('c1', '2026-01-15', 'a', 'A', '', 1), ('c1', '2026-02-15', 'b', 'B', '', 1);
    `);

    const result = await syncGa4DailyForClient(wide({ storeProductViewsInPostgres: false }));

    expect(result.prunedProductRows).toBe(2);
    expect(((await pg.query("SELECT count(*)::int AS n FROM ga4_product_views_daily WHERE client_id = 'c1'")).rows[0] as { n: number }).n).toBe(0);
  });

  it("falha da BUSCA da origem do tráfego num pedaço: a tabela para, o marcador NÃO anda, e o resto (produtos, funil, diário) segue", async () => {
    ga4.traffic.mockImplementation(async (w: Window) => {
      if (w.dateFrom === "2026-02-10") throw new Error("GA4 runReport failed: 502");
      return [trafficRow(w.dateFrom)];
    });

    const result = await syncGa4DailyForClient(wide());

    // 1º pedaço gravou, 2º falhou, 3º nem foi tentado.
    expect(windows(ga4.traffic)).toEqual([
      ["2026-01-01", "2026-02-09"],
      ["2026-02-10", "2026-03-21"],
    ]);
    expect(result.trafficError).toBe("busca no GA4: GA4 runReport failed: 502");
    expect(result.trafficTo).toBeNull();
    expect(result.trafficFrom).toBeNull();
    expect(result.trafficRows).toBe(1);
    // Funil e produtos completos, e o diário foi gravado.
    expect(result.productFunnelTo).toBe("2026-03-31");
    expect(result.productViewRows).toBe(3);
    expect(bqCalls().at(-1)?.daily).toHaveLength(3);
  });

  it("falha da GRAVAÇÃO do funil no BigQuery num pedaço: erro isolado, marcador não anda, diário gravado", async () => {
    bq.write.mockImplementation(async (_bq: unknown, params: BqCall) => ({
      dailyRows: params.daily ? params.daily.length : 0,
      productRows: params.productViews ? params.productViews.length : 0,
      trafficRows: params.traffic ? params.traffic.length : 0,
      productFunnelRows: 0,
      ...(params.productFunnel && params.productFunnelFrom === "2026-02-10" ? { productFunnelError: "quota do BigQuery" } : {}),
    }));

    const result = await syncGa4DailyForClient(wide());

    expect(result.productFunnelError).toBe("gravacao no BigQuery: quota do BigQuery");
    expect(result.productFunnelTo).toBeNull();
    expect(windows(ga4.funnel)).toHaveLength(2);
    expect(result.trafficTo).toBe("2026-03-31");
    expect(bqCalls().at(-1)?.daily).toHaveLength(3);
  });

  it("falha dos PRODUTOS num pedaço derruba o job e o diário (marcador de cobertura) NÃO é gravado", async () => {
    ga4.products.mockImplementation(async (w: Window) => {
      if (w.dateFrom === "2026-02-10") throw new Error("GA4 runReport failed: 502");
      return [{ date: w.dateFrom, itemId: "sku-1", itemName: "Camiseta", itemVariant: null, views: 3 }];
    });

    await expect(syncGa4DailyForClient(wide())).rejects.toThrow("GA4 runReport failed: 502");

    expect(bqCalls().some((call) => call.daily !== undefined)).toBe(false);
    expect(((await pg.query("SELECT count(*)::int AS n FROM ga4_daily_metrics")).rows[0] as { n: number }).n).toBe(0);
  });

  it("falha do BigQuery num pedaço derruba o job com o nome do destino e o diário não é gravado", async () => {
    bq.write.mockRejectedValueOnce(new Error("Exceeded rate limits"));

    await expect(syncGa4DailyForClient(wide())).rejects.toThrow("BigQuery: Exceeded rate limits");

    expect(bqCalls().some((call) => call.daily !== undefined)).toBe(false);
    expect(((await pg.query("SELECT count(*)::int AS n FROM ga4_daily_metrics")).rows[0] as { n: number }).n).toBe(0);
  });

  it("sem credencial do GA4 (diário null) falha logo, sem gravar nada", async () => {
    ga4.daily.mockResolvedValue(null);
    await expect(syncGa4DailyForClient(wide())).rejects.toThrow("GA4 sem credencial");
    expect(bq.write).not.toHaveBeenCalled();
  });

  it("janela curta continua sendo UMA busca e UMA gravação (a rodada horária não muda)", async () => {
    const result = await syncGa4DailyForClient(
      wide({ productFrom: "2026-03-29", trafficFrom: "2026-03-29", productFunnelFrom: "2026-03-29" }),
    );

    expect(bq.write).toHaveBeenCalledTimes(1);
    expect(bqCalls()[0].daily).toHaveLength(3);
    expect(bqCalls()[0].productViews).toHaveLength(1);
    expect(result.trafficTo).toBe("2026-03-31");
    expect(result.productFunnelTo).toBe("2026-03-31");
  });
});
