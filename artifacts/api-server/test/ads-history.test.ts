import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: { select: () => ({ from: () => ({ where: async () => [] }) }) },
  clientsTable: {},
}));
vi.mock("../src/lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import {
  adAccountDigits,
  buildHistoryView,
  classifyHistoryError,
  hasOpenRequest,
  validateStartDate,
  RUNNING_STALE_MS,
  type HistoryStatusRow,
} from "../src/services/ads-history-rules";
import {
  ENSURE_REQUESTS_QUERY,
  INSERT_REQUEST_QUERY,
  READ_COVERAGE_QUERY,
  READ_REQUEST_QUERY,
  READ_STATUS_QUERY,
  insertHistoryRequest,
  readAdsHistory,
  toCoverage,
  toStatusRow,
} from "../src/services/ads-history-bq";
import { AdsHistoryError, getAdsHistory, requestAdsHistory, type AdsHistoryDeps, type HistoryClient } from "../src/services/ads-history";
import type { BigQueryLike } from "../src/services/excluded-clients-bq";

const NOW = new Date("2026-10-23T15:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const H = 60 * 60 * 1000;
const NO_COVERAGE = { firstDay: null, lastDay: null, days: 0 };

const status = (over: Partial<HistoryStatusRow> = {}): HistoryStatusRow => ({
  state: "done",
  attempts: 1,
  requestedAt: null,
  startedAt: ago(5 * H),
  finishedAt: ago(4 * H),
  startDate: "2025-01-01",
  endDate: null,
  resumeFrom: null,
  rowsAd: 100,
  rowsAccount: 10,
  error: null,
  updatedAt: ago(4 * H),
  ...over,
});

const view = (over: Partial<Parameters<typeof buildHistoryView>[0]> = {}) =>
  buildHistoryView({ status: null, request: null, coverage: NO_COVERAGE, now: NOW, ...over });

describe("adAccountDigits / classifyHistoryError", () => {
  it("act_, act= e só dígitos viram só dígitos; inválida vira nulo", () => {
    expect(adAccountDigits("act_1447102162403037")).toBe("1447102162403037");
    expect(adAccountDigits("act=1447102162403037")).toBe("1447102162403037");
    expect(adAccountDigits(" 1447102162403037 ")).toBe("1447102162403037");
    expect(adAccountDigits("test")).toBeNull();
    expect(adAccountDigits(null)).toBeNull();
  });

  it.each([
    ["Facebook API Error: (17) User request limit reached", "rate_limit"],
    ["Facebook API Error: (200) (#200) Ad account owner has NOT grant ads_management or ads_read permission", "permission"],
    ["Facebook API Error: Invalid parameter", "other"],
    [null, "other"],
  ])("%s => %s", (message, kind) => {
    expect(classifyHistoryError(message as string | null)).toBe(kind);
  });
});

describe("buildHistoryView: fase e botão", () => {
  it("conta sem estado e sem pedido: 'none', pode pedir", () => {
    expect(view()).toMatchObject({ phase: "none", canRequest: true, permissionProblem: false });
  });

  it("pedido sem estado, ou mais novo que o último atendido: 'queued' e não pode pedir de novo", () => {
    const request = { requestedAt: ago(10 * 60_000), startDate: null, requestedBy: "a@b.c" };
    expect(view({ request })).toMatchObject({ phase: "queued", canRequest: false });
    expect(view({ request, status: status({ requestedAt: ago(3 * H) }) })).toMatchObject({ phase: "queued", canRequest: false });
  });

  it("pedido já atendido (o estado guarda o horário do pedido que atendeu): mostra o estado final e pode pedir de novo", () => {
    const requestedAt = ago(3 * H);
    const request = { requestedAt, startDate: null, requestedBy: null };
    expect(hasOpenRequest(status({ requestedAt }), request)).toBe(false);
    expect(view({ request, status: status({ requestedAt }) })).toMatchObject({ phase: "done", canRequest: true });
  });

  it("'running' recente = rodando agora (não pede); 'running' antigo = travou, será retomado ('queued')", () => {
    expect(view({ status: status({ state: "running", updatedAt: ago(RUNNING_STALE_MS - 60_000) }) })).toMatchObject({ phase: "running", canRequest: false });
    expect(view({ status: status({ state: "running", updatedAt: ago(RUNNING_STALE_MS + 60_000) }) })).toMatchObject({ phase: "queued", canRequest: false });
  });

  it("pedido novo enquanto roda outro histórico da mesma conta continua 'running'", () => {
    const request = { requestedAt: ago(60_000), startDate: null, requestedBy: null };
    expect(view({ request, status: status({ state: "running", updatedAt: ago(60_000), requestedAt: ago(30 * 60_000) }) }).phase).toBe("running");
  });

  it("'pending' (parou pelo limite do Facebook) = 'waiting': volta sozinho, não pede", () => {
    expect(view({ status: status({ state: "pending", attempts: 0 }) })).toMatchObject({ phase: "waiting", canRequest: false });
  });

  it("falha por falta de permissão: avisa o problema de permissão e deixa pedir de novo (para depois que o acesso voltar)", () => {
    const error = "2025-01: Facebook API Error: (#200) Ad account owner has NOT grant ads_management or ads_read permission";
    expect(view({ status: status({ state: "failed", error }) })).toMatchObject({ phase: "failed", canRequest: true, permissionProblem: true });
  });

  it("falha por outro motivo e parcial: pode pedir; sem problema de permissão", () => {
    expect(view({ status: status({ state: "failed", error: "ECONNRESET" }) })).toMatchObject({ phase: "failed", canRequest: true, permissionProblem: false });
    expect(view({ status: status({ state: "partial", resumeFrom: "2026-04-01", error: "Invalid parameter" }) })).toMatchObject({ phase: "partial", canRequest: true });
  });

  it("carrega a cobertura sem alterar", () => {
    const coverage = { firstDay: "2025-01-01", lastDay: "2026-10-23", days: 659 };
    expect(view({ coverage, status: status() }).coverage).toEqual(coverage);
  });
});

describe("validateStartDate", () => {
  const today = "2026-10-23";
  it("vazio = usar o padrão do backend", () => {
    for (const empty of [undefined, null, ""]) expect(validateStartDate(empty, today)).toEqual({ ok: true, value: null });
  });
  it("data válida dentro do intervalo passa", () => {
    expect(validateStartDate("2025-01-01", today)).toEqual({ ok: true, value: "2025-01-01" });
    expect(validateStartDate("2026-10-23", today)).toEqual({ ok: true, value: "2026-10-23" });
  });
  it.each(["01/01/2025", "2025-1-1", "2025-02-30", "ontem", "2022-12-31", "2026-10-24", 20250101])("%s é recusada", (raw) => {
    expect(validateStartDate(raw, today).ok).toBe(false);
  });
});

type FakeCall = { query: string; params?: Record<string, unknown>; types?: Record<string, unknown> };
function fakeBigQuery(respond: (call: FakeCall) => Array<Record<string, unknown>> | Error): { bq: BigQueryLike; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const bq = {
    createQueryJob: async (options: FakeCall) => {
      calls.push(options);
      const result = respond(options);
      if (result instanceof Error) throw result;
      return [{ getQueryResults: async () => [result] }] as never;
    },
    dataset: () => {
      throw new Error("não usado");
    },
  } as unknown as BigQueryLike;
  return { bq, calls };
}

describe("BigQuery do histórico", () => {
  it("o pedido usa a MESMA definição de tabela do backend, parâmetros tipados e a data como texto convertido no SQL", async () => {
    const { bq, calls } = fakeBigQuery(() => []);
    await insertHistoryRequest(bq, { adAccountDigits: "1418950000264215", requestedBy: "admin@updash.com", startDate: "2025-06-01" });
    expect(calls.map((c) => c.query)).toEqual([ENSURE_REQUESTS_QUERY, INSERT_REQUEST_QUERY]);
    expect(ENSURE_REQUESTS_QUERY).toContain("`up-vesti-report.up_global.ads_backfill_requests`");
    expect(ENSURE_REQUESTS_QUERY).toContain("ad_account_id STRING NOT NULL");
    expect(ENSURE_REQUESTS_QUERY).toContain("requested_at TIMESTAMP NOT NULL");
    expect(ENSURE_REQUESTS_QUERY).toContain("start_date DATE");
    expect(INSERT_REQUEST_QUERY).toContain("CURRENT_TIMESTAMP()");
    expect(INSERT_REQUEST_QUERY).toContain("SAFE.PARSE_DATE('%Y-%m-%d', @start_date)");
    expect(INSERT_REQUEST_QUERY).not.toContain("1418950000264215");
    expect(calls[1].params).toEqual({ ad_account_id: "1418950000264215", requested_by: "admin@updash.com", start_date: "2025-06-01" });
    expect(calls[1].types).toEqual({ ad_account_id: "STRING", requested_by: "STRING", start_date: "STRING" });
  });

  it("sem data de início o texto vai nulo (o backend usa o padrão)", async () => {
    const { bq, calls } = fakeBigQuery(() => []);
    await insertHistoryRequest(bq, { adAccountDigits: "111111", requestedBy: null, startDate: null });
    expect(calls[1].params).toMatchObject({ requested_by: null, start_date: null });
  });

  it("as leituras filtram a conta por parâmetro e as consultas de insights têm filtro de data (a tabela exige)", () => {
    for (const query of [READ_STATUS_QUERY, READ_REQUEST_QUERY, READ_COVERAGE_QUERY]) expect(query).toContain("@digits");
    expect(READ_COVERAGE_QUERY).toContain("date_start >= '2023-01-01'");
    expect(READ_COVERAGE_QUERY).toContain("COUNT(DISTINCT date_start)");
    expect(READ_STATUS_QUERY).toContain("up_global.ads_backfill_status");
  });

  it("converte estado com objetos { value } do cliente do BigQuery e ignora estado desconhecido", () => {
    expect(
      toStatusRow({
        state: "partial",
        attempts: { value: "2" },
        requested_at: { value: "2026-10-23T14:00:00.000000Z" },
        start_date: { value: "2025-01-01" },
        end_date: null,
        resume_from: { value: "2026-04-01" },
        rows_ad: 8403,
        rows_account: null,
        error: "Invalid parameter",
        updated_at: { value: "2026-10-23T14:59:59.000000Z" },
      }),
    ).toMatchObject({ state: "partial", attempts: 2, requestedAt: "2026-10-23T14:00:00.000Z", startDate: "2025-01-01", endDate: null, resumeFrom: "2026-04-01", rowsAd: 8403, rowsAccount: null, error: "Invalid parameter" });
    expect(toStatusRow({ state: "inventado" })).toBeNull();
    expect(toStatusRow(undefined)).toBeNull();
  });

  it("cobertura: dias e extremos; sem linhas = zero", () => {
    expect(toCoverage({ first_day: "2025-01-01", last_day: "2026-10-23", days: 659 })).toEqual({ firstDay: "2025-01-01", lastDay: "2026-10-23", days: 659 });
    expect(toCoverage({ first_day: null, last_day: null, days: 0 })).toEqual(NO_COVERAGE);
    expect(toCoverage(undefined)).toEqual(NO_COVERAGE);
  });

  it("tabela que ainda não existe = vazio, sem erro; outro erro sobe", async () => {
    const { bq } = fakeBigQuery(() => Object.assign(new Error("Not found: Table up_global.ads_backfill_status"), { code: 404 }));
    expect(await readAdsHistory(bq, "111111")).toEqual({ status: null, request: null, coverage: NO_COVERAGE });
    const denied = fakeBigQuery(() => Object.assign(new Error("Access Denied"), { code: 403 })).bq;
    await expect(readAdsHistory(denied, "111111")).rejects.toThrow("Access Denied");
  });
});

const client = (over: Partial<HistoryClient> = {}): HistoryClient => ({ id: "c1", name: "Clio Modas", metaAdAccountId: "act_1657539425761507", isActive: true, archivedAt: null, ...over });

function makeDeps(opts: { client?: HistoryClient | null; rows?: (call: FakeCall) => Array<Record<string, unknown>>; available?: boolean } = {}) {
  const fake = fakeBigQuery(opts.rows ?? (() => []));
  const publish = vi.fn(async () => {});
  const deps: AdsHistoryDeps = {
    loadClient: async () => (opts.client === undefined ? client() : opts.client),
    bigQuery: async () => fake.bq,
    bigQueryAvailable: () => opts.available ?? true,
    now: () => NOW,
    publishAccounts: publish,
  };
  return { deps, calls: fake.calls, publish };
}

const rejects = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (err) {
    return err as AdsHistoryError;
  }
  throw new Error("era para falhar");
};

describe("getAdsHistory", () => {
  it("cliente inexistente = 404", async () => {
    const err = await rejects(getAdsHistory("x", makeDeps({ client: null }).deps));
    expect([err.status, err.code]).toEqual([404, "NOT_FOUND"]);
  });

  it("cliente sem conta válida: avisa e nem consulta o BigQuery", async () => {
    const { deps, calls } = makeDeps({ client: client({ metaAdAccountId: "teste" }) });
    expect(await getAdsHistory("c1", deps)).toEqual({ available: true, hasAccount: false, adAccountId: null, history: null });
    expect(calls).toEqual([]);
  });

  it("ambiente sem BigQuery: indisponível, sem consultar", async () => {
    const { deps, calls } = makeDeps({ available: false });
    expect(await getAdsHistory("c1", deps)).toMatchObject({ available: false, hasAccount: true, adAccountId: "act_1657539425761507", history: null });
    expect(calls).toEqual([]);
  });

  it("devolve a visão da conta com a fase e a cobertura", async () => {
    const { deps } = makeDeps({
      rows: (call) => {
        if (call.query === READ_STATUS_QUERY) return [{ state: "failed", attempts: 1, error: "(#200) Ad account owner has NOT grant ads_management or ads_read permission", updated_at: { value: ago(H) } }];
        if (call.query === READ_COVERAGE_QUERY) return [{ first_day: null, last_day: null, days: 0 }];
        return [];
      },
    });
    const result = await getAdsHistory("c1", deps);
    expect(result.history).toMatchObject({ phase: "failed", canRequest: true, permissionProblem: true });
  });
});

describe("requestAdsHistory", () => {
  it("registra o pedido com a conta em dígitos, quem pediu e a data, e atualiza a lista de contas", async () => {
    const { deps, calls, publish } = makeDeps();
    const result = await requestAdsHistory("c1", { requestedBy: "admin@updash.com", startDate: "2025-06-01" }, deps);
    expect(result).toEqual({ requested: true, startDate: "2025-06-01" });
    const insert = calls.find((c) => c.query === INSERT_REQUEST_QUERY)!;
    expect(insert.params).toEqual({ ad_account_id: "1657539425761507", requested_by: "admin@updash.com", start_date: "2025-06-01" });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["cliente na lixeira", { client: client({ archivedAt: new Date("2026-10-01") }) }, 409, "CLIENT_ARCHIVED"],
    ["cliente sem conta válida", { client: client({ metaAdAccountId: null }) }, 400, "NO_AD_ACCOUNT"],
    ["ambiente sem BigQuery", { available: false }, 503, "BIGQUERY_UNAVAILABLE"],
  ])("%s é recusado sem gravar nada", async (_name, opts, status, code) => {
    const { deps, calls } = makeDeps(opts as Parameters<typeof makeDeps>[0]);
    const err = await rejects(requestAdsHistory("c1", { requestedBy: null, startDate: undefined }, deps));
    expect([err.status, err.code]).toEqual([status, code]);
    expect(calls.some((c) => c.query === INSERT_REQUEST_QUERY)).toBe(false);
  });

  it("data de início inválida é recusada sem gravar nada", async () => {
    const { deps, calls } = makeDeps();
    const err = await rejects(requestAdsHistory("c1", { requestedBy: null, startDate: "2022-01-01" }, deps));
    expect([err.status, err.code]).toEqual([400, "VALIDATION_ERROR"]);
    expect(calls).toEqual([]);
  });

  it("já tem pedido na fila / histórico rodando: 409 e não grava de novo (vale também para botão velho na tela)", async () => {
    const queued = makeDeps({ rows: (call) => (call.query === READ_REQUEST_QUERY ? [{ requested_at: ago(60_000), start_date: null, requested_by: "x" }] : []) });
    const err = await rejects(requestAdsHistory("c1", { requestedBy: null, startDate: null }, queued.deps));
    expect([err.status, err.code]).toEqual([409, "ALREADY_IN_PROGRESS"]);
    expect(queued.calls.some((c) => c.query === INSERT_REQUEST_QUERY)).toBe(false);

    const running = makeDeps({ rows: (call) => (call.query === READ_STATUS_QUERY ? [{ state: "running", attempts: 0, updated_at: { value: ago(60_000) } }] : []) });
    expect((await rejects(requestAdsHistory("c1", { requestedBy: null, startDate: null }, running.deps))).message).toContain("sendo buscado");
    expect(running.calls.some((c) => c.query === INSERT_REQUEST_QUERY)).toBe(false);
  });

  it("conta cujo último histórico falhou por permissão pode pedir de novo (depois que o acesso voltar)", async () => {
    const { deps, calls } = makeDeps({
      rows: (call) => (call.query === READ_STATUS_QUERY ? [{ state: "failed", attempts: 1, error: "(#200) permission", updated_at: { value: ago(H) } }] : []),
    });
    await requestAdsHistory("c1", { requestedBy: "a@b.c", startDate: null }, deps);
    expect(calls.some((c) => c.query === INSERT_REQUEST_QUERY)).toBe(true);
  });
});
