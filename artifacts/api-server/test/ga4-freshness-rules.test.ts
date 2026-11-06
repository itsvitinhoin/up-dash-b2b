import { describe, expect, it } from "vitest";
import { evaluateGa4Freshness, type Ga4ClientHealthInput } from "../src/services/ga4-freshness-rules";

const NOW = new Date("2026-11-06T18:00:00.000Z"); // 15:00 em São Paulo
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const healthy = (over: Partial<Ga4ClientHealthInput> = {}): Ga4ClientHealthInput => ({
  clientId: "c1",
  clientName: "Giah Studio",
  propertyId: "422756040",
  lastDoneAt: hoursAgo(1),
  lastRunAt: hoursAgo(1),
  lastRunStatus: "done",
  lastError: null,
  bigQueryLastDay: "2026-11-06",
  ...over,
});

const noAccess = (over: Partial<Ga4ClientHealthInput> = {}): Ga4ClientHealthInput => ({
  clientId: "c9",
  clientName: "Aiyu Fashion",
  propertyId: "523834127",
  lastDoneAt: null,
  lastRunAt: hoursAgo(1),
  lastRunStatus: "failed",
  lastError: "User does not have sufficient permissions for this property.",
  bigQueryLastDay: null,
  ...over,
});

const run = (clients: Ga4ClientHealthInput[], over = {}) =>
  evaluateGa4Freshness(clients, { now: NOW, bigQueryEnabled: true, ...over });

describe("evaluateGa4Freshness", () => {
  it("tudo em dia: nenhum achado", () => {
    const r = run([healthy(), healthy({ clientId: "c2", clientName: "Jini" })]);
    expect(r.findings).toEqual([]);
    expect(r.healthy).toBe(2);
    expect(r.total).toBe(2);
  });

  it("sem clientes cadastrados não é problema (nada a vigiar)", () => {
    expect(run([])).toEqual({ findings: [], healthy: 0, total: 0 });
  });

  it("caso real de 03/11: ninguém sincroniza há horas -> UM problema do job, não um por cliente", () => {
    const parado = [
      healthy({ lastDoneAt: hoursAgo(72), lastRunAt: hoursAgo(72) }),
      healthy({ clientId: "c2", clientName: "Jini", lastDoneAt: hoursAgo(72), lastRunAt: hoursAgo(72) }),
      noAccess({ lastRunAt: hoursAgo(72) }),
    ];
    const r = run(parado);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ severity: "problem", kind: "job_parado", clientId: null });
    expect(r.findings[0].message).toContain("upzero-sync-job-hourly");
    expect(r.healthy).toBe(0);
  });

  it("cliente sem acesso desde sempre é AVISO (pendência), não problema: o alerta não fica vermelho para sempre", () => {
    const r = run([healthy(), noAccess()]);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ severity: "warning", kind: "nunca_sincronizou", clientName: "Aiyu Fashion" });
    expect(r.findings[0].message).toContain("sufficient permissions");
    expect(r.healthy).toBe(1);
  });

  it("quem JÁ sincronizou e parou (perdeu o acesso, por exemplo) é PROBLEMA", () => {
    const r = run([
      healthy(),
      healthy({
        clientId: "c3",
        clientName: "Hot Pink",
        lastDoneAt: hoursAgo(30),
        lastRunAt: hoursAgo(1),
        lastRunStatus: "failed",
        lastError: "User does not have sufficient permissions for this property.",
      }),
    ]);
    const problems = r.findings.filter((f) => f.severity === "problem");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ kind: "parou_de_atualizar", clientName: "Hot Pink" });
    expect(problems[0].message).toContain("30h");
    expect(problems[0].message).toContain("sufficient permissions");
    expect(r.healthy).toBe(1);
  });

  it("uma rodada ruim isolada (dentro das 6h) não vira problema", () => {
    const r = run([healthy({ lastDoneAt: hoursAgo(3), lastRunAt: hoursAgo(1), lastRunStatus: "failed", lastError: "timeout" })]);
    expect(r.findings).toEqual([]);
  });

  it("BigQuery atrasado com o Postgres em dia é problema", () => {
    const r = run([healthy({ bigQueryLastDay: "2026-11-03" })]);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ severity: "problem", kind: "bigquery_atrasado" });
    expect(r.findings[0].message).toContain("2026-11-03");
  });

  it("BigQuery até ontem ainda é aceitável (a janela do dia)", () => {
    expect(run([healthy({ bigQueryLastDay: "2026-11-05" })]).findings).toEqual([]);
  });

  it("cliente que sincroniza no Postgres mas não tem nada no BigQuery é problema", () => {
    const r = run([healthy({ bigQueryLastDay: null })]);
    expect(r.findings[0]).toMatchObject({ severity: "problem", kind: "bigquery_sem_dados" });
  });

  it("GA4_BIGQUERY desligado: não cobra o BigQuery", () => {
    const r = run([healthy({ bigQueryLastDay: null })], { bigQueryEnabled: false });
    expect(r.findings).toEqual([]);
  });

  it("não conseguir ler o BigQuery é problema (não dá para garantir) e não gera um erro falso por cliente", () => {
    const r = run([healthy({ bigQueryLastDay: null }), healthy({ clientId: "c2", clientName: "Jini", bigQueryLastDay: null })], {
      bigQueryReadable: false,
    });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ severity: "problem", kind: "bigquery_indisponivel" });
  });

  it("cliente que parou não empilha também o aviso do BigQuery", () => {
    const r = run([healthy({ lastDoneAt: hoursAgo(30), bigQueryLastDay: "2026-11-01" }), healthy({ clientId: "c2", clientName: "Jini" })]);
    expect(r.findings.filter((f) => f.clientName === "Giah Studio")).toHaveLength(1);
  });
});
