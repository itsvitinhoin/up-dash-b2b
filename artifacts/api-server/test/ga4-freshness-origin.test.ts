import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@workspace/db/schema";
import type { BigQueryLike } from "../src/services/excluded-clients-bq";

// Alerta da origem do tráfego (10/11/2026) de ponta a ponta no lado do Postgres: a verificação lê sync_jobs de verdade (PGlite, um
// Postgres em memória), então a consulta em jsonb (result->>'trafficTo' / 'trafficError') é exercitada de fato. O BigQuery é simulado.

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
vi.mock("../src/lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { logger } from "../src/lib/logger";
import { runGa4FreshnessCheck } from "../src/services/ga4-freshness";

const pg = new PGlite();

beforeAll(async () => {
  await pg.exec(`
    CREATE TABLE clients (id text PRIMARY KEY, name text NOT NULL, ga4_property_id text, archived_at timestamptz);
    CREATE TABLE sync_jobs (
      id text PRIMARY KEY, client_id text NOT NULL, status text NOT NULL DEFAULT 'pending',
      job_type text NOT NULL DEFAULT 'upzero_transactional', result jsonb, error text,
      finished_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE ga4_daily_metrics (
      client_id text NOT NULL, metric_date date NOT NULL,
      sessions integer NOT NULL DEFAULT 0, page_views integer NOT NULL DEFAULT 0, product_views integer NOT NULL DEFAULT 0,
      add_to_carts integer NOT NULL DEFAULT 0, checkouts integer NOT NULL DEFAULT 0, purchases integer NOT NULL DEFAULT 0,
      synced_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (client_id, metric_date)
    );
  `);
  state.db = drizzle(pg, { schema });
});

afterAll(async () => {
  await pg.close();
});

const NOW = new Date("2026-11-10T15:30:00.000Z"); // 12:30 em São Paulo
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

let jobSeq = 0;
// Uma rodada do ga4_daily de um cliente: criada há `hours` horas e concluída 1 minuto depois.
async function job(clientId: string, hours: number, status: "done" | "failed", result: Record<string, unknown> | null, error: string | null = null) {
  const created = new Date(NOW.getTime() - hours * 3_600_000);
  const finished = new Date(created.getTime() + 60_000);
  await pg.query(
    `INSERT INTO sync_jobs (id, client_id, status, job_type, result, error, finished_at, created_at) VALUES ($1, $2, $3, 'ga4_daily', $4::jsonb, $5, $6, $7)`,
    [`j${++jobSeq}`, clientId, status, result === null ? null : JSON.stringify(result), error, finished.toISOString(), created.toISOString()],
  );
}

async function client(id: string, name: string, firstSyncHoursAgo: number | null) {
  await pg.query(`INSERT INTO clients (id, name, ga4_property_id) VALUES ($1, $2, $3)`, [id, name, `prop-${id}`]);
  if (firstSyncHoursAgo !== null) {
    await pg.query(`INSERT INTO ga4_daily_metrics (client_id, metric_date, sessions, synced_at) VALUES ($1, DATE '2026-11-10', 120, $2)`, [id, ago(firstSyncHoursAgo)]);
  }
}

const ok = { trafficTo: "2026-11-10", trafficError: null };

// BigQuery de mentira: todos os clientes em dia no diário (o que se quer testar aqui é só a origem do tráfego).
function fakeBigQuery(clientIds: string[]): BigQueryLike {
  return {
    createQueryJob: async () =>
      [
        {
          getQueryResults: async () => [clientIds.map((id) => ({ client_id: id, first_day: "2025-10-06", last_day: "2026-11-10" }))],
          metadata: {},
        },
      ] as never,
    dataset: () => {
      throw new Error("nao usado");
    },
  };
}

beforeEach(async () => {
  await pg.exec("DELETE FROM sync_jobs; DELETE FROM ga4_daily_metrics; DELETE FROM clients;");
  vi.mocked(logger.error).mockClear();
  vi.mocked(logger.warn).mockClear();
});

describe("runGa4FreshnessCheck: origem do tráfego", () => {
  it("cliente com a origem do tráfego gravada na última rodada não gera achado", async () => {
    await client("c-ok", "Em Dia", 24 * 30);
    for (const h of [1, 2, 3]) await job("c-ok", h, "done", ok);

    const r = await runGa4FreshnessCheck({ bq: fakeBigQuery(["c-ok"]), now: NOW });

    expect(r).toMatchObject({ total: 1, healthy: 1, problems: 0, warnings: 0, failed: 0 });
    expect(r.findings).toEqual([]);
  });

  it("caso real a evitar: o diário segue 'done' e só a origem do tráfego falha -> PROBLEMA com o erro da última rodada", async () => {
    await client("c-err", "La Cleo", 24 * 30);
    await job("c-err", 9, "done", ok); // última gravação de verdade, há ~9h
    for (const h of [1, 2, 3, 4, 5, 6, 7, 8]) await job("c-err", h, "done", { trafficTo: null, trafficError: "busca no GA4: boom" });

    const r = await runGa4FreshnessCheck({ bq: fakeBigQuery(["c-err"]), now: NOW });

    expect(r).toMatchObject({ total: 1, healthy: 0, problems: 1, failed: 1 });
    expect(r.findings[0]).toMatchObject({ severity: "problem", kind: "origem_trafego_parada", clientName: "La Cleo" });
    expect(r.findings[0].message).toContain("nao e gravada ha");
    expect(r.findings[0].message).toContain("busca no GA4: boom");
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logger.error).mock.calls[0][1]).toContain("[ga4-freshness] PROBLEMA La Cleo");
  });

  it("nunca gravou desde que o cliente sincroniza: problema com o erro, e o início do histórico na mensagem", async () => {
    await client("c-never", "Jini", 47);
    for (const h of [1, 2, 24, 47]) await job("c-never", h, "done", { trafficTo: null, trafficError: "gravacao no BigQuery: cota" });

    const r = await runGa4FreshnessCheck({ bq: fakeBigQuery(["c-never"]), now: NOW });

    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ severity: "problem", kind: "origem_trafego_parada" });
    expect(r.findings[0].message).toContain("nunca foi gravada");
    expect(r.findings[0].message).toContain("cota");
  });

  it("cliente novo (primeira rodada há poucas horas) ainda não é cobrado", async () => {
    await client("c-new", "Cliente Novo", 3);
    await job("c-new", 1, "done", { trafficTo: null, trafficError: "busca no GA4: falha passageira" });

    const r = await runGa4FreshnessCheck({ bq: fakeBigQuery(["c-new"]), now: NOW });

    expect(r.findings).toEqual([]);
  });

  it("rodada que não tentou a origem (sem erro) também conta como parada, e a mensagem diz que nada foi registrado; rodada que FALHOU não vale como gravação", async () => {
    await client("c-silent", "Silencioso", 24 * 30);
    await job("c-silent", 12, "done", ok); // última gravação de verdade, há ~12h
    for (const h of [2, 3, 4, 5]) await job("c-silent", h, "done", { trafficTo: null, trafficError: null }); // não tentou
    await job("c-silent", 1, "failed", { trafficTo: "2026-11-10" }, "timeout"); // falhou: o trafficTo dela não vale

    const r = await runGa4FreshnessCheck({ bq: fakeBigQuery(["c-silent"]), now: NOW });

    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ severity: "problem", kind: "origem_trafego_parada" });
    expect(r.findings[0].message).toContain("Nenhum erro registrado");
    expect(r.findings[0].message).toContain("2026-11-10 03:"); // a gravação de 12h atrás (03:29 UTC), não a do job que falhou
  });

  it("cliente sem acesso continua só como aviso de acesso, e os saudáveis não são tocados", async () => {
    await client("c-ok", "Em Dia", 24 * 30);
    await job("c-ok", 1, "done", ok);
    await client("c-noaccess", "Aiyu Fashion", null);
    await job("c-noaccess", 1, "failed", null, "User does not have sufficient permissions for this property.");
    await client("c-err", "La Cleo", 24 * 30);
    await job("c-err", 10, "done", ok);
    await job("c-err", 1, "done", { trafficTo: null, trafficError: "busca no GA4: boom" });

    const r = await runGa4FreshnessCheck({ bq: fakeBigQuery(["c-ok", "c-err"]), now: NOW });

    expect(r).toMatchObject({ total: 3, healthy: 1, problems: 1, warnings: 1, failed: 1 });
    expect(r.findings.map((f) => `${f.clientName}:${f.kind}`).sort()).toEqual(["Aiyu Fashion:nunca_sincronizou", "La Cleo:origem_trafego_parada"]);
  });

  it("BigQuery desligado (bq: null): a regra não cobra uma tabela que nem é gravada", async () => {
    await client("c-err", "La Cleo", 24 * 30);
    await job("c-err", 20, "done", ok);
    await job("c-err", 1, "done", { trafficTo: null, trafficError: "busca no GA4: boom" });

    const r = await runGa4FreshnessCheck({ bq: null, now: NOW });

    expect(r.findings).toEqual([]);
  });
});
