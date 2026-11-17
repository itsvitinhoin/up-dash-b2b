import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@workspace/db/schema";

// 13/11/2026: a rodada do GA4 ganhou o modo "backfill" (TASK=ga4_backfill, job próprio), a opção de a rodada horária deixar os clientes de
// janela larga para ele (GA4_BACKFILL_SEPARATE=1) e o disjuntor por cliente. Banco de verdade em memória (PGlite); a busca/gravação do GA4 é
// simulada (só registramos para quais clientes o sync foi chamado).

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

// O runner importa todos os outros syncs (UpZero, Nuvemshop, Braavo, Meta, BigQuery...). Nada disso roda aqui.
vi.mock("../src/services/meta-ads", () => ({ upsertMetaCreatives: vi.fn() }));
vi.mock("../src/services/stored-marketing", () => ({ fetchStoredMarketingData: vi.fn() }));
vi.mock("../src/services/nuvemshop-sync", () => ({ syncNuvemshopClient: vi.fn() }));
vi.mock("../src/services/upzero/analytics-metrics", () => ({
  getMetricUser: vi.fn(),
  getUpzeroAnalyticsMetrics: vi.fn(),
  summarizeUpzeroSellerPurchases: vi.fn(),
}));
vi.mock("../src/services/braavo-sync", () => ({ runBraavoBatch: vi.fn() }));
vi.mock("../src/services/upzero/customers", () => ({ documentLast4: vi.fn(), hashDocument: vi.fn() }));
vi.mock("../src/services/upzero-sync", () => ({ syncUpZeroClient: vi.fn() }));
vi.mock("../src/services/daily-client-metrics", () => ({ refreshDailyClientMetrics: vi.fn() }));
vi.mock("../src/services/paid-touchpoints", () => ({ syncPaidTouchpointsForCustomer: vi.fn() }));
vi.mock("../src/services/erp-attribution", () => ({ ERP_STATUS_FILTER: "" }));
vi.mock("../src/lib/bigquery", () => ({ bigquery: {}, vestiTable: vi.fn() }));
vi.mock("../src/services/ga4-bigquery", () => ({ readGa4BigQueryCoverage: vi.fn(async () => new Map()), writeGa4ToBigQuery: vi.fn() }));
vi.mock("../src/services/ga4", () => ({
  fetchGa4DailyMetrics: vi.fn(),
  fetchGa4ProductViewsDaily: vi.fn(),
  fetchGa4TrafficDaily: vi.fn(),
  fetchGa4ProductFunnelDaily: vi.fn(),
  fetchGa4FunnelMetrics: vi.fn(),
  fetchGa4ProductViewMetrics: vi.fn(),
}));

const sync = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../src/services/ga4-daily-sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/services/ga4-daily-sync")>()),
  syncGa4DailyForClient: (...args: unknown[]) => sync.fn(...args),
}));

import { runGa4DailyExtraction, runHourlyExtractionBundle } from "../src/services/extraction-runner";
import { saoPauloDate, shiftDate } from "../src/services/ga4-daily-rules";

const pg = new PGlite();
const ENV_KEYS = ["GA4_BIGQUERY", "GA4_EVERY_HOURS", "GA4_BACKFILL_SEPARATE", "GA4_BACKFILL_MAX_CLIENTS", "GA4_BACKFILL_STALE_MINUTES"] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

beforeAll(async () => {
  await pg.exec(`
    CREATE TABLE clients (
      id text PRIMARY KEY, name text NOT NULL, up_zero_api_key text, meta_ads_api_key text, meta_ad_account_id text,
      dashboard_type text NOT NULL DEFAULT 'B2B', commerce_platform text NOT NULL DEFAULT 'UPZERO',
      nuvemshop_store_id text, nuvemshop_access_token text,
      ga4_property_id text, archived_at timestamptz
    );
    CREATE TABLE ga4_daily_metrics (
      client_id text NOT NULL, metric_date date NOT NULL,
      sessions integer NOT NULL DEFAULT 0, page_views integer NOT NULL DEFAULT 0, product_views integer NOT NULL DEFAULT 0,
      add_to_carts integer NOT NULL DEFAULT 0, checkouts integer NOT NULL DEFAULT 0, purchases integer NOT NULL DEFAULT 0,
      synced_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (client_id, metric_date)
    );
    CREATE TABLE sync_jobs (
      id text PRIMARY KEY, client_id text NOT NULL, status text NOT NULL DEFAULT 'pending',
      job_type text NOT NULL DEFAULT 'upzero_transactional', trigger text NOT NULL DEFAULT 'manual', scope text NOT NULL DEFAULT 'client',
      result jsonb, error text, started_at timestamptz, finished_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  state.db = drizzle(pg, { schema });
});

afterAll(async () => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  await pg.close();
});

beforeEach(async () => {
  await pg.exec("DELETE FROM clients; DELETE FROM ga4_daily_metrics; DELETE FROM sync_jobs;");
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.GA4_BIGQUERY = "0"; // so Postgres: a janela de cada cliente vem so do historico dele
  sync.fn.mockReset();
  sync.fn.mockImplementation(async (params: { from: string; to: string }) => ({ from: params.from, to: params.to, days: 3 }));
});

const NO_ACCESS = "User does not have sufficient permissions for this property.";
const BAD_GATEWAY = "GA4 runReport failed: 502";

// "Em dia" = tem historico de ontem (janela curta); "largo" = sem historico (backfill de 400 dias).
async function addClient(id: string, options: { wide?: boolean } = {}) {
  await pg.query("INSERT INTO clients (id, name, ga4_property_id) VALUES ($1, $2, $3)", [id, `Cliente ${id}`, `p-${id}`]);
  if (!options.wide) {
    const today = saoPauloDate(new Date());
    await pg.query("INSERT INTO ga4_daily_metrics (client_id, metric_date) VALUES ($1, $2)", [id, shiftDate(today, -1)]);
    // O histórico de produtos é o marcador productFrom do último job concluído: sem ele a janela de produtos é de 400 dias e o cliente é "largo".
    await pg.query(
      `INSERT INTO sync_jobs (id, client_id, status, job_type, trigger, result, created_at, finished_at)
       VALUES ($1, $2, 'done', 'ga4_daily', 'cron', $3::jsonb, now() - interval '3 days', now() - interval '3 days')`,
      [`hist-${id}`, id, JSON.stringify({ productFrom: shiftDate(today, -399) })],
    );
  }
}

async function addJob(clientId: string, options: { status: "done" | "failed" | "running"; minutesAgo: number; error?: string; trigger?: string }) {
  await pg.query(
    `INSERT INTO sync_jobs (id, client_id, status, job_type, trigger, error, created_at, finished_at)
     VALUES ($1, $2, $3, 'ga4_daily', $4, $5, now() - ($6 || ' minutes')::interval, CASE WHEN $3 = 'running' THEN NULL ELSE now() - ($6 || ' minutes')::interval END)`,
    [`j-${Math.random().toString(36).slice(2)}`, clientId, options.status, options.trigger ?? "cron", options.error ?? null, String(options.minutesAgo)],
  );
}

const syncedClients = () => sync.fn.mock.calls.map((call) => (call[0] as { clientId: string }).clientId);

describe("rodada horária (modo padrão)", () => {
  it("sem GA4_BACKFILL_SEPARATE roda como sempre: quem está em dia primeiro e depois o backfill largo, se há tempo e vaga", async () => {
    await addClient("a");
    await addClient("w", { wide: true });

    const summary = await runGa4DailyExtraction("cron");

    expect(syncedClients()).toEqual(["a", "w"]);
    expect(summary.done).toBe(2);
    expect(summary.skipped).toBe(0);
  });

  it("com GA4_BACKFILL_SEPARATE=1 deixa o cliente de janela larga para o job de backfill", async () => {
    process.env.GA4_BACKFILL_SEPARATE = "1";
    await addClient("a");
    await addClient("w", { wide: true });

    const summary = await runGa4DailyExtraction("cron");

    expect(syncedClients()).toEqual(["a"]);
    expect(summary.skipped).toBe(1);
  });

  it("rodada manual de UM cliente largo roda mesmo com GA4_BACKFILL_SEPARATE=1 (sem limite, como antes)", async () => {
    process.env.GA4_BACKFILL_SEPARATE = "1";
    await addClient("w", { wide: true });

    await runGa4DailyExtraction("manual", { clientId: "w" });

    expect(syncedClients()).toEqual(["w"]);
  });
});

describe("modo backfill (TASK=ga4_backfill)", () => {
  it("roda SÓ os clientes de janela larga; quem está em dia fica com a rodada horária", async () => {
    await addClient("a");
    await addClient("w", { wide: true });

    const summary = await runGa4DailyExtraction("cron", { mode: "backfill" });

    expect(syncedClients()).toEqual(["w"]);
    expect(summary.done).toBe(1);
  });

  it("respeita GA4_BACKFILL_MAX_CLIENTS: o resto fica para a próxima execução", async () => {
    process.env.GA4_BACKFILL_MAX_CLIENTS = "2";
    for (const id of ["w1", "w2", "w3"]) await addClient(id, { wide: true });

    const summary = await runGa4DailyExtraction("cron", { mode: "backfill" });

    expect(syncedClients()).toHaveLength(2);
    expect(summary.skipped).toBe(1);
  });

  it("não tem limite de tempo da rodada horária: cliente largo roda mesmo depois de muito tempo de rodada", async () => {
    // O modo normal adia o backfill largo depois de 8 minutos; o job de backfill usa orçamento infinito.
    const nowSpy = vi.spyOn(Date, "now");
    const start = Date.now();
    let tick = 0;
    nowSpy.mockImplementation(() => start + tick++ * 60 * 60_000); // cada leitura do relógio passa 1 hora
    try {
      await addClient("w", { wide: true });
      await runGa4DailyExtraction("cron", { mode: "backfill" });
      expect(syncedClients()).toEqual(["w"]);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("pula o cliente que outra execução está processando agora, mas assume o job 'running' antigo (processo que caiu)", async () => {
    await addClient("vivo", { wide: true });
    await addClient("caiu", { wide: true });
    await addJob("vivo", { status: "running", minutesAgo: 10 });
    await addJob("caiu", { status: "running", minutesAgo: 180 });

    await runGa4DailyExtraction("cron", { mode: "backfill" });

    expect(syncedClients()).toEqual(["caiu"]);
  });

  it("falha de acesso (Aiyu, Hot Pink, Sonmur) espera 55 minutos antes de tentar de novo, para não gerar uma falha a cada execução", async () => {
    await addClient("recente", { wide: true });
    await addClient("antigo", { wide: true });
    await addJob("recente", { status: "failed", minutesAgo: 20, error: NO_ACCESS });
    await addJob("antigo", { status: "failed", minutesAgo: 70, error: NO_ACCESS });

    await runGa4DailyExtraction("cron", { mode: "backfill" });

    expect(syncedClients()).toEqual(["antigo"]);
  });

  it("cliente largo que falhou 'logo' (sem acesso) não ocupa a vaga de backfill", async () => {
    process.env.GA4_BACKFILL_MAX_CLIENTS = "1";
    // A fila segue a ordem do nome: o sem acesso vem primeiro, falha logo e devolve a vaga ao cliente novo.
    await addClient("a-sem-acesso", { wide: true });
    await addClient("novo", { wide: true });
    sync.fn.mockImplementation(async (params: { clientId: string; from: string; to: string }) => {
      if (params.clientId === "a-sem-acesso") throw new Error(NO_ACCESS);
      return { from: params.from, to: params.to, days: 3 };
    });

    const summary = await runGa4DailyExtraction("cron", { mode: "backfill" });

    expect(syncedClients()).toEqual(["a-sem-acesso", "novo"]);
    expect(summary.failed).toBe(1);
    expect(summary.done).toBe(1);
  });
});

describe("rodada horária completa: GA4 só nas horas de GA4_EVERY_HOURS", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // Só o relógio (Date) é falso: o banco em memória precisa dos timers de verdade.
  async function bundleAt(isoUtc: string, trigger: "cron" | "manual" = "cron") {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(isoUtc));
    return runHourlyExtractionBundle(trigger);
  }

  it("a cada 4 horas: às 12h e 16h UTC o GA4 roda; às 13h, 14h e 15h não (ga4 = null), e UpZero e Meta rodam em todas", async () => {
    process.env.GA4_EVERY_HOURS = "4";
    await addClient("a");

    const at12 = await bundleAt("2026-11-17T12:00:03.000Z");
    expect(at12.ga4).not.toBeNull();
    expect(syncedClients()).toEqual(["a"]);

    sync.fn.mockClear();
    for (const hour of ["13", "14", "15"]) {
      const result = await bundleAt(`2026-11-17T${hour}:00:03.000Z`);
      expect(result.ga4).toBeNull();
      expect(result.analytics.jobType).toBe("upzero_analytics");
      expect(result.meta.jobType).toBe("meta_ads");
    }
    expect(sync.fn).not.toHaveBeenCalled();

    const at16 = await bundleAt("2026-11-17T16:00:03.000Z");
    expect(at16.ga4).not.toBeNull();
    expect(syncedClients()).toEqual(["a"]);
  });

  it("sem GA4_EVERY_HOURS (padrão) o GA4 roda toda hora, como antes", async () => {
    await addClient("a");

    for (const hour of ["13", "14"]) {
      const result = await bundleAt(`2026-11-17T${hour}:00:03.000Z`);
      expect(result.ga4).not.toBeNull();
    }
    expect(sync.fn).toHaveBeenCalledTimes(2);
  });

  it("rodada manual do pacote inclui o GA4 mesmo fora da hora", async () => {
    process.env.GA4_EVERY_HOURS = "4";
    await addClient("a");

    const result = await bundleAt("2026-11-17T13:00:03.000Z", "manual");

    expect(result.ga4).not.toBeNull();
  });
});

describe("disjuntor por cliente", () => {
  it("duas falhas seguidas do Google (502) pausam o cliente na rodada horária; os demais seguem", async () => {
    await addClient("ruim");
    await addClient("bom");
    await addJob("ruim", { status: "failed", minutesAgo: 5, error: BAD_GATEWAY });
    await addJob("ruim", { status: "failed", minutesAgo: 65, error: BAD_GATEWAY });
    await addJob("bom", { status: "done", minutesAgo: 5 });

    const summary = await runGa4DailyExtraction("cron");

    expect(syncedClients()).toEqual(["bom"]);
    expect(summary.skipped).toBe(1);
  });

  it("depois do tempo de pausa o cliente é tentado de novo", async () => {
    await addClient("ruim");
    await addJob("ruim", { status: "failed", minutesAgo: 115, error: BAD_GATEWAY });
    await addJob("ruim", { status: "failed", minutesAgo: 175, error: BAD_GATEWAY });

    await runGa4DailyExtraction("cron");

    expect(syncedClients()).toEqual(["ruim"]);
  });

  it("uma falha só do Google, ou um sucesso depois, não pausa", async () => {
    await addClient("uma");
    await addClient("recuperou");
    await addJob("uma", { status: "failed", minutesAgo: 5, error: BAD_GATEWAY });
    await addJob("uma", { status: "done", minutesAgo: 65 });
    await addJob("recuperou", { status: "done", minutesAgo: 5 });
    await addJob("recuperou", { status: "failed", minutesAgo: 65, error: BAD_GATEWAY });
    await addJob("recuperou", { status: "failed", minutesAgo: 125, error: BAD_GATEWAY });

    await runGa4DailyExtraction("cron");

    expect(syncedClients().sort()).toEqual(["recuperou", "uma"]);
  });

  it("falta de acesso NUNCA pausa: falha na hora e volta sozinha quando alguém libera o acesso", async () => {
    await addClient("sem-acesso");
    for (const minutes of [5, 65, 125]) await addJob("sem-acesso", { status: "failed", minutesAgo: minutes, error: NO_ACCESS });

    await runGa4DailyExtraction("cron");

    expect(syncedClients()).toEqual(["sem-acesso"]);
  });

  it("rodada manual de um cliente ignora o disjuntor (é o jeito de forçar uma tentativa)", async () => {
    await addClient("ruim");
    await addJob("ruim", { status: "failed", minutesAgo: 5, error: BAD_GATEWAY });
    await addJob("ruim", { status: "failed", minutesAgo: 65, error: BAD_GATEWAY });

    await runGa4DailyExtraction("manual", { clientId: "ruim" });

    expect(syncedClients()).toEqual(["ruim"]);
  });

  it("falhas de rodada manual não contam para o disjuntor", async () => {
    await addClient("c");
    await addJob("c", { status: "failed", minutesAgo: 5, error: BAD_GATEWAY, trigger: "manual" });
    await addJob("c", { status: "failed", minutesAgo: 65, error: BAD_GATEWAY, trigger: "manual" });

    await runGa4DailyExtraction("cron");

    expect(syncedClients()).toEqual(["c"]);
  });

  it("vale também no job de backfill: cliente largo que o Google não responde fica pausado", async () => {
    await addClient("w", { wide: true });
    await addJob("w", { status: "failed", minutesAgo: 5, error: BAD_GATEWAY });
    await addJob("w", { status: "failed", minutesAgo: 35, error: BAD_GATEWAY });

    await runGa4DailyExtraction("cron", { mode: "backfill" });

    expect(syncedClients()).toEqual([]);
  });
});
