import { afterEach, describe, expect, it } from "vitest";
import {
  clipGa4Start,
  evaluateGa4Breaker,
  ga4BackfillMaxClients,
  ga4BackfillStaleMinutes,
  ga4ChunkDays,
  ga4EveryHours,
  isGa4BackfillSeparate,
  isTransientGa4Error,
  shouldRunGa4InHourlyBundle,
  shouldWaitBeforeBackfillRetry,
  splitGa4Window,
  type Ga4RecentJob,
} from "../src/services/ga4-daily-rules";

// 13/11/2026: backfill em pedacos (memoria), disjuntor por cliente (erros 502 do Google) e backfill em job proprio.

describe("splitGa4Window (pedaços do backfill)", () => {
  it("janela que cabe num pedaço volta inteira (a rodada horária não muda)", () => {
    expect(splitGa4Window("2026-11-14", "2026-11-16", 60)).toEqual([{ from: "2026-11-14", to: "2026-11-16" }]);
    expect(splitGa4Window("2026-09-17", "2026-11-15", 60)).toEqual([{ from: "2026-09-17", to: "2026-11-15" }]);
  });

  it("janela larga vira pedaços consecutivos, sem sobra nem sobreposição, do mais antigo ao mais novo", () => {
    const chunks = splitGa4Window("2025-10-10", "2026-11-13", 60);
    expect(chunks[0].from).toBe("2025-10-10");
    expect(chunks[chunks.length - 1].to).toBe("2026-11-13");
    for (let i = 1; i < chunks.length; i += 1) {
      const previousEnd = new Date(`${chunks[i - 1].to}T00:00:00Z`).getTime();
      const start = new Date(`${chunks[i].from}T00:00:00Z`).getTime();
      expect(start - previousEnd).toBe(86_400_000);
    }
    // 400 dias em pedaços de 60: 6 pedaços de 60 e um de 40.
    expect(chunks).toHaveLength(7);
    for (const chunk of chunks.slice(0, -1)) {
      const days = Math.round((new Date(`${chunk.to}T00:00:00Z`).getTime() - new Date(`${chunk.from}T00:00:00Z`).getTime()) / 86_400_000) + 1;
      expect(days).toBe(60);
    }
  });

  it("um dia só, e janela invertida", () => {
    expect(splitGa4Window("2026-11-13", "2026-11-13", 60)).toEqual([{ from: "2026-11-13", to: "2026-11-13" }]);
    expect(splitGa4Window("2026-11-14", "2026-11-13", 60)).toEqual([]);
  });

  it("tamanho inválido vira 1 dia por pedaço, nunca laço infinito", () => {
    expect(splitGa4Window("2026-11-01", "2026-11-03", 0)).toHaveLength(3);
    expect(splitGa4Window("2026-11-01", "2026-11-03", Number.NaN)).toHaveLength(3);
  });
});

describe("clipGa4Start (cada tabela tem a própria janela dentro do pedaço)", () => {
  const chunk = { from: "2026-02-01", to: "2026-03-31" };

  it("início antes do pedaço: começa no início do pedaço", () => {
    expect(clipGa4Start("2025-10-10", chunk)).toBe("2026-02-01");
  });

  it("início dentro do pedaço: mantém o início da tabela", () => {
    expect(clipGa4Start("2026-03-10", chunk)).toBe("2026-03-10");
  });

  it("início depois do pedaço (tabela só precisa dos dias recentes) ou ausente: não entra neste pedaço", () => {
    expect(clipGa4Start("2026-04-01", chunk)).toBeNull();
    expect(clipGa4Start(null, chunk)).toBeNull();
    expect(clipGa4Start(undefined, chunk)).toBeNull();
  });
});

describe("ga4ChunkDays", () => {
  const original = process.env.GA4_CHUNK_DAYS;
  afterEach(() => {
    if (original === undefined) delete process.env.GA4_CHUNK_DAYS;
    else process.env.GA4_CHUNK_DAYS = original;
  });

  it("padrão 60; GA4_CHUNK_DAYS muda; valor inválido volta ao padrão", () => {
    delete process.env.GA4_CHUNK_DAYS;
    expect(ga4ChunkDays()).toBe(60);
    process.env.GA4_CHUNK_DAYS = "30";
    expect(ga4ChunkDays()).toBe(30);
    process.env.GA4_CHUNK_DAYS = "abc";
    expect(ga4ChunkDays()).toBe(60);
    process.env.GA4_CHUNK_DAYS = "0";
    expect(ga4ChunkDays()).toBe(60);
  });
});

describe("isTransientGa4Error (erro do lado do Google)", () => {
  it("reconhece o 502 e os outros 5xx do GA4, e a cota", () => {
    expect(isTransientGa4Error("GA4 runReport failed: 502")).toBe(true);
    expect(isTransientGa4Error("GA4 runReport failed: 503")).toBe(true);
    expect(isTransientGa4Error("GA4 runReport failed: 429")).toBe(true);
    expect(isTransientGa4Error("Resource has been exhausted (e.g. check quota).")).toBe(true);
    expect(isTransientGa4Error("Exhausted potentially thresholded requests quota")).toBe(true);
    expect(isTransientGa4Error("Internal error encountered.")).toBe(true);
    expect(isTransientGa4Error("The service is currently unavailable.")).toBe(true);
  });

  it("reconhece falha de rede", () => {
    expect(isTransientGa4Error("fetch failed")).toBe(true);
    expect(isTransientGa4Error("read ECONNRESET")).toBe(true);
    expect(isTransientGa4Error("connect ETIMEDOUT 142.250.0.1:443")).toBe(true);
  });

  it("NÃO trata falta de acesso, propriedade errada nem erro de gravação como transitório", () => {
    expect(isTransientGa4Error("User does not have sufficient permissions for this property. To learn more about Property ID, see https://developers.google.com")).toBe(false);
    expect(isTransientGa4Error("GA4 runReport failed: 403")).toBe(false);
    expect(isTransientGa4Error("GA4 runReport failed: 400")).toBe(false);
    expect(isTransientGa4Error("Postgres: duplicate key value violates unique constraint")).toBe(false);
    expect(isTransientGa4Error("GA4 sem credencial: rode no Cloud Run")).toBe(false);
    expect(isTransientGa4Error(null)).toBe(false);
    expect(isTransientGa4Error("")).toBe(false);
  });
});

describe("evaluateGa4Breaker (disjuntor por cliente)", () => {
  const now = new Date("2026-11-13T15:00:00.000Z");
  const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
  const failed = (minutes: number, error = "GA4 runReport failed: 502"): Ga4RecentJob => ({ status: "failed", error, at: minutesAgo(minutes) });
  const done = (minutes: number): Ga4RecentJob => ({ status: "done", error: null, at: minutesAgo(minutes) });

  it("sem histórico, ou com sucesso por último, não pausa", () => {
    expect(evaluateGa4Breaker({ recent: [], now })).toEqual({ pause: false, failures: 0 });
    expect(evaluateGa4Breaker({ recent: [done(5), failed(65), failed(125)], now })).toEqual({ pause: false, failures: 0 });
  });

  it("uma falha só do Google não pausa (pode ser um soluço)", () => {
    expect(evaluateGa4Breaker({ recent: [failed(5), done(65)], now })).toEqual({ pause: false, failures: 1 });
  });

  it("duas falhas seguidas do Google pausam; a pausa espera até quase 2 horas depois da última falha", () => {
    const early = evaluateGa4Breaker({ recent: [failed(5), failed(65), done(125)], now });
    expect(early.pause).toBe(true);
    expect(early.failures).toBe(2);
    // Última falha há 5 min: tenta de novo em 2h - 20min depois dela.
    expect(early.retryAt?.toISOString()).toBe(new Date(minutesAgo(5).getTime() + 100 * 60_000).toISOString());

    // Na rodada seguinte (~1h depois) segue pausado; duas rodadas depois já tenta de novo.
    expect(evaluateGa4Breaker({ recent: [failed(65), failed(125)], now }).pause).toBe(true);
    expect(evaluateGa4Breaker({ recent: [failed(110), failed(170)], now }).pause).toBe(false);
  });

  it("a pausa cresce com as falhas seguidas, até 5 horas", () => {
    const four = Array.from({ length: 4 }, (_, i) => failed(130 + i * 60));
    // 4 falhas seguidas: pausa de 4h - 20min depois da última (há 130 min): ainda pausado.
    expect(evaluateGa4Breaker({ recent: four, now }).pause).toBe(true);
    const many = Array.from({ length: 12 }, (_, i) => failed(290 + i * 60));
    // 12 falhas: teto de 5h - 20min (280 min) depois da última. Última há 290 min: já pode tentar; há 270 min: ainda falta 10 min.
    expect(evaluateGa4Breaker({ recent: many, now }).pause).toBe(false);
    expect(evaluateGa4Breaker({ recent: [failed(270), ...many.slice(1)], now }).pause).toBe(true);
  });

  it("falta de acesso NUNCA pausa (falha na hora e volta sozinha quando alguém libera o acesso)", () => {
    const noAccess = "User does not have sufficient permissions for this property.";
    const recent = [failed(5, noAccess), failed(65, noAccess), failed(125, noAccess)];
    expect(evaluateGa4Breaker({ recent, now })).toEqual({ pause: false, failures: 0 });
  });

  it("uma falha que não é do Google no meio interrompe a contagem", () => {
    const recent = [failed(5), failed(65, "Postgres: connection terminated"), failed(125)];
    expect(evaluateGa4Breaker({ recent, now })).toEqual({ pause: false, failures: 1 });
  });

  it("job ainda rodando (ou pendente) não conta nem interrompe", () => {
    const recent: Ga4RecentJob[] = [{ status: "running", error: null, at: minutesAgo(1) }, failed(5), failed(65)];
    expect(evaluateGa4Breaker({ recent, now }).pause).toBe(true);
  });
});

describe("shouldWaitBeforeBackfillRetry (backfill não repete falha de acesso a cada execução)", () => {
  const now = new Date("2026-11-13T15:00:00.000Z");
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
  const noAccess = "User does not have sufficient permissions for this property.";

  it("falhou por acesso há pouco: espera", () => {
    expect(shouldWaitBeforeBackfillRetry([{ status: "failed", error: noAccess, at: ago(20) }], now)).toBe(true);
  });

  it("falhou por acesso há mais de 55 minutos: tenta de novo", () => {
    expect(shouldWaitBeforeBackfillRetry([{ status: "failed", error: noAccess, at: ago(56) }], now)).toBe(false);
  });

  it("falha do Google não espera aqui (quem cuida dela é o disjuntor); sucesso e histórico vazio também não", () => {
    expect(shouldWaitBeforeBackfillRetry([{ status: "failed", error: "GA4 runReport failed: 502", at: ago(5) }], now)).toBe(false);
    expect(shouldWaitBeforeBackfillRetry([{ status: "done", error: null, at: ago(5) }], now)).toBe(false);
    expect(shouldWaitBeforeBackfillRetry([], now)).toBe(false);
  });
});

describe("GA4_EVERY_HOURS (frequência do GA4 na rodada horária)", () => {
  it("só aceita divisores de 24; ausente ou inválido vale 1 (toda hora, como antes)", () => {
    expect(ga4EveryHours({})).toBe(1);
    expect(ga4EveryHours({ GA4_EVERY_HOURS: "" })).toBe(1);
    expect(ga4EveryHours({ GA4_EVERY_HOURS: "abc" })).toBe(1);
    expect(ga4EveryHours({ GA4_EVERY_HOURS: "0" })).toBe(1);
    expect(ga4EveryHours({ GA4_EVERY_HOURS: "-4" })).toBe(1);
    expect(ga4EveryHours({ GA4_EVERY_HOURS: "5" })).toBe(1); // 24 não é múltiplo de 5: intervalo irregular
    expect(ga4EveryHours({ GA4_EVERY_HOURS: "7" })).toBe(1);
    for (const valid of [1, 2, 3, 4, 6, 8, 12, 24]) expect(ga4EveryHours({ GA4_EVERY_HOURS: String(valid) })).toBe(valid);
  });

  it("a cada 4 horas: 0h, 4h, 8h, 12h, 16h e 20h UTC", () => {
    const hours = Array.from({ length: 24 }, (_, hour) =>
      shouldRunGa4InHourlyBundle({ now: new Date(Date.UTC(2026, 10, 17, hour, 0, 5)), everyHours: 4, trigger: "cron" }),
    );
    expect(hours.flatMap((run, hour) => (run ? [hour] : []))).toEqual([0, 4, 8, 12, 16, 20]);
  });

  it("toda hora (padrão) roda sempre; os minutos da hora não importam", () => {
    for (let hour = 0; hour < 24; hour += 1) {
      expect(shouldRunGa4InHourlyBundle({ now: new Date(Date.UTC(2026, 10, 17, hour, 59, 59)), everyHours: 1, trigger: "cron" })).toBe(true);
    }
    expect(shouldRunGa4InHourlyBundle({ now: new Date(Date.UTC(2026, 10, 17, 12, 59, 59)), everyHours: 4, trigger: "cron" })).toBe(true);
    expect(shouldRunGa4InHourlyBundle({ now: new Date(Date.UTC(2026, 10, 17, 13, 0, 0)), everyHours: 4, trigger: "cron" })).toBe(false);
  });

  it("rodada manual sempre inclui o GA4 (é o jeito de forçar uma atualização fora de hora)", () => {
    expect(shouldRunGa4InHourlyBundle({ now: new Date(Date.UTC(2026, 10, 17, 13, 0, 0)), everyHours: 4, trigger: "manual" })).toBe(true);
  });
});

describe("variáveis do backfill separado", () => {
  const keys = ["GA4_BACKFILL_SEPARATE", "GA4_BACKFILL_MAX_CLIENTS", "GA4_BACKFILL_STALE_MINUTES"] as const;
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  afterEach(() => {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it("GA4_BACKFILL_SEPARATE só liga com 1 ou true (padrão desligado: o comportamento antigo continua)", () => {
    delete process.env.GA4_BACKFILL_SEPARATE;
    expect(isGa4BackfillSeparate()).toBe(false);
    process.env.GA4_BACKFILL_SEPARATE = "1";
    expect(isGa4BackfillSeparate()).toBe(true);
    process.env.GA4_BACKFILL_SEPARATE = "true";
    expect(isGa4BackfillSeparate()).toBe(true);
    process.env.GA4_BACKFILL_SEPARATE = "0";
    expect(isGa4BackfillSeparate()).toBe(false);
  });

  it("clientes por execução (padrão 3) e minutos até um job 'running' ser tratado como caído (padrão 120)", () => {
    delete process.env.GA4_BACKFILL_MAX_CLIENTS;
    delete process.env.GA4_BACKFILL_STALE_MINUTES;
    expect(ga4BackfillMaxClients()).toBe(3);
    expect(ga4BackfillStaleMinutes()).toBe(120);
    process.env.GA4_BACKFILL_MAX_CLIENTS = "1";
    process.env.GA4_BACKFILL_STALE_MINUTES = "45";
    expect(ga4BackfillMaxClients()).toBe(1);
    expect(ga4BackfillStaleMinutes()).toBe(45);
  });
});
