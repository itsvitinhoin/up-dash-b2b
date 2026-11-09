import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@workspace/db/schema";
import { resolveGa4TrafficFrom } from "../src/services/ga4-daily-rules";

// Origem do trafego (09/11/2026): so no BigQuery, com janela e marcador proprios, isolada do diario e dos produtos. Banco de verdade em
// memoria (PGlite) para o job e o marcador; a API do GA4 e o BigQuery sao simulados.

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

const ga4 = vi.hoisted(() => ({ traffic: vi.fn() }));
vi.mock("../src/services/ga4", () => ({
  fetchGa4DailyMetrics: vi.fn(async () => [
    { date: "2026-11-08", sessions: 10, pageViews: 20, productViews: 5, addToCarts: 2, checkouts: 1, purchases: 1 },
  ]),
  fetchGa4ProductViewsDaily: vi.fn(async () => [{ date: "2026-11-08", itemId: "sku-1", itemName: "Camiseta", itemVariant: null, views: 3 }]),
  fetchGa4TrafficDaily: (...args: unknown[]) => ga4.traffic(...args),
  fetchGa4FunnelMetrics: vi.fn(async () => null),
  fetchGa4ProductViewMetrics: vi.fn(async () => null),
}));

const bq = vi.hoisted(() => ({ write: vi.fn() }));
vi.mock("../src/services/ga4-bigquery", () => ({
  writeGa4ToBigQuery: (...args: unknown[]) => bq.write(...args),
}));

import { lastGa4TrafficToByClient, syncGa4DailyForClient } from "../src/services/ga4-daily-sync";

const pg = new PGlite();

beforeAll(async () => {
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
  await pg.close();
});

const trafficRows = [
  {
    date: "2026-11-08",
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
  },
];

beforeEach(async () => {
  await pg.exec("DELETE FROM ga4_daily_metrics; DELETE FROM ga4_product_views_daily; DELETE FROM sync_jobs;");
  ga4.traffic.mockReset();
  ga4.traffic.mockResolvedValue(trafficRows);
  bq.write.mockReset();
  bq.write.mockImplementation(async (_bq: unknown, params: { traffic?: unknown[] }) => ({
    dailyRows: 1,
    productRows: 1,
    trafficRows: params.traffic ? params.traffic.length : 0,
  }));
});

const base = (clientId = "c1") => ({
  clientId,
  clientName: `Cliente ${clientId}`,
  propertyId: "123456789",
  from: "2026-11-08",
  to: "2026-11-09",
  productFrom: "2026-11-08",
});

describe("resolveGa4TrafficFrom (janela própria da origem do tráfego)", () => {
  const now = new Date("2026-11-09T15:00:00.000Z"); // 09/11 em São Paulo

  it("sem BigQuery neste turno não roda (não há cópia no Postgres) e o marcador não anda", () => {
    expect(resolveGa4TrafficFrom({ bigQueryAvailable: false, lastTrafficTo: "2026-11-08", now })).toBeNull();
  });

  it("cliente sem marcador: backfill de 400 dias", () => {
    expect(resolveGa4TrafficFrom({ bigQueryAvailable: true, lastTrafficTo: null, now })).toBe("2025-10-06");
    expect(resolveGa4TrafficFrom({ bigQueryAvailable: true, now })).toBe("2025-10-06");
  });

  it("com marcador de ontem: refaz só os últimos dias (o GA4 ainda revisa os recentes)", () => {
    expect(resolveGa4TrafficFrom({ bigQueryAvailable: true, lastTrafficTo: "2026-11-08", now })).toBe("2026-11-06");
  });

  it("marcador antigo (a origem do tráfego falhou por dias): retoma dali, sem deixar buraco", () => {
    expect(resolveGa4TrafficFrom({ bigQueryAvailable: true, lastTrafficTo: "2026-09-01", now })).toBe("2026-08-30");
  });

  it("janela explícita (reprocessar um período) sempre vence", () => {
    expect(resolveGa4TrafficFrom({ bigQueryAvailable: true, lastTrafficTo: "2026-11-08", lookbackDays: 10, now })).toBe("2026-10-31");
  });
});

describe("lastGa4TrafficToByClient (o marcador)", () => {
  it("devolve o último trafficTo de rodadas CONCLUÍDAS e ignora falhas e rodadas sem a origem do tráfego", async () => {
    await pg.exec(`
      INSERT INTO sync_jobs (id, client_id, status, job_type, result) VALUES
        ('1', 'a', 'done',   'ga4_daily', '{"trafficTo": "2026-11-05"}'),
        ('2', 'a', 'done',   'ga4_daily', '{"trafficTo": "2026-11-08"}'),
        ('3', 'a', 'failed', 'ga4_daily', '{"trafficTo": "2026-11-09"}'),
        ('4', 'a', 'done',   'ga4_daily', '{"productFrom": "2026-10-01"}'),
        ('5', 'b', 'done',   'ga4_daily', '{"productFrom": "2026-10-01", "trafficTo": null}'),
        ('6', 'c', 'done',   'meta_ads',  '{"trafficTo": "2026-11-08"}');
    `);
    const found = await lastGa4TrafficToByClient(["a", "b", "c", "d"]);
    expect([...found.entries()]).toEqual([["a", "2026-11-08"]]);
  });

  it("sem clientes não consulta nada", async () => {
    expect((await lastGa4TrafficToByClient([])).size).toBe(0);
  });
});

describe("syncGa4DailyForClient: origem do tráfego", () => {
  it("com BigQuery e janela: busca no GA4 a partir do marcador, grava e devolve o novo marcador (trafficTo)", async () => {
    const result = await syncGa4DailyForClient({ ...base(), bigQuery: {} as any, trafficFrom: "2025-10-06" });

    expect(ga4.traffic).toHaveBeenCalledTimes(1);
    expect(ga4.traffic.mock.calls[0][0]).toEqual({ propertyId: "123456789", dateFrom: "2025-10-06", dateTo: "2026-11-09" });
    const sent = bq.write.mock.calls[0][1];
    expect(sent.traffic).toEqual(trafficRows);
    expect(sent.trafficFrom).toBe("2025-10-06");
    expect(result).toMatchObject({ trafficRows: 1, trafficFrom: "2025-10-06", trafficTo: "2026-11-09", trafficError: null });
  });

  it("sem janela (ou sem BigQuery) não busca nem grava a origem do tráfego e o marcador não anda", async () => {
    const semJanela = await syncGa4DailyForClient({ ...base(), bigQuery: {} as any });
    const semBigQuery = await syncGa4DailyForClient({ ...base("c2"), bigQuery: null, trafficFrom: "2025-10-06" });

    expect(ga4.traffic).not.toHaveBeenCalled();
    expect(bq.write.mock.calls[0][1].traffic).toBeUndefined();
    expect(semJanela).toMatchObject({ trafficRows: 0, trafficFrom: null, trafficTo: null, trafficError: null });
    expect(semBigQuery).toMatchObject({ trafficFrom: null, trafficTo: null });
  });

  it("se a BUSCA da origem do tráfego falhar o diário e os produtos são gravados, o erro fica no resultado e o marcador NÃO anda", async () => {
    ga4.traffic.mockRejectedValue(new Error("Please remove sessionCampaignName"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await syncGa4DailyForClient({ ...base(), bigQuery: {} as any, trafficFrom: "2025-10-06" });

    expect((await pg.query("SELECT count(*)::int AS n FROM ga4_daily_metrics")).rows[0]).toEqual({ n: 2 });
    expect((await pg.query("SELECT count(*)::int AS n FROM ga4_product_views_daily")).rows[0]).toEqual({ n: 1 });
    expect(bq.write).toHaveBeenCalledTimes(1);
    expect(bq.write.mock.calls[0][1].traffic).toBeUndefined();
    expect(result.trafficTo).toBeNull();
    expect(result.trafficFrom).toBeNull();
    expect(result.trafficError).toContain("busca no GA4");
    expect(result.trafficError).toContain("sessionCampaignName");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("se a GRAVAÇÃO da origem do tráfego no BigQuery falhar o marcador NÃO anda (a próxima rodada refaz a janela)", async () => {
    bq.write.mockResolvedValue({ dailyRows: 1, productRows: 1, trafficRows: 0, trafficError: "cota do BigQuery" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await syncGa4DailyForClient({ ...base(), bigQuery: {} as any, trafficFrom: "2025-10-06" });

    expect(result.trafficTo).toBeNull();
    expect(result.trafficFrom).toBeNull();
    expect(result.trafficError).toContain("gravacao no BigQuery");
    expect(result.trafficError).toContain("cota do BigQuery");
    warn.mockRestore();
  });

  it("credencial ausente na busca (null) também é erro da origem do tráfego, sem derrubar o resto", async () => {
    ga4.traffic.mockResolvedValue(null);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await syncGa4DailyForClient({ ...base(), bigQuery: {} as any, trafficFrom: "2025-10-06" });
    expect(result.trafficError).toContain("sem credencial");
    expect(result.trafficTo).toBeNull();
    expect(result.days).toBe(2);
    warn.mockRestore();
  });
});
