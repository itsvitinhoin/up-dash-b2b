import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: { select: () => ({ from: async () => [] }) },
  clientsTable: {},
}));
vi.mock("../src/lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { buildAdsAccountRows, normalizeAdAccountId, type AdsAccountClientRow } from "../src/services/ads-accounts-list";
import { buildReplaceAdsAccountsQuery, ENSURE_ADS_ACCOUNTS_TABLE_QUERY } from "../src/services/ads-accounts-bq";
import { publishAdsAccounts } from "../src/services/ads-accounts-publisher";
import type { BigQueryLike } from "../src/services/excluded-clients-bq";

const client = (over: Partial<AdsAccountClientRow> & { id: string }): AdsAccountClientRow => ({
  name: `Marca ${over.id}`,
  commercePlatform: "VESTI",
  metaAdAccountId: "act_1447102162403037",
  isActive: true,
  archivedAt: null,
  ...over,
});

describe("normalizeAdAccountId", () => {
  it("padroniza para act_ + dígitos", () => {
    expect(normalizeAdAccountId("act_1447102162403037")).toBe("act_1447102162403037");
    expect(normalizeAdAccountId("act=1447102162403037")).toBe("act_1447102162403037");
    expect(normalizeAdAccountId(" 1447102162403037 ")).toBe("act_1447102162403037");
  });
  it("texto, vazio, letras e número curto demais viram nulo", () => {
    for (const bad of ["", "   ", null, undefined, "test", "act_abc", "act_", "123", "act_12 34"]) {
      expect(normalizeAdAccountId(bad as string | null | undefined)).toBeNull();
    }
  });
});

describe("buildAdsAccountRows", () => {
  it("a mesma conta em dois clientes gera uma linha por cliente (ex.: Aurami e Cocci)", () => {
    const { rows } = buildAdsAccountRows([
      client({ id: "c2", name: "Cocci", metaAdAccountId: "act_1483477112868321" }),
      client({ id: "c1", name: "Aurami", metaAdAccountId: "1483477112868321" }),
    ]);
    expect(rows).toEqual([
      { adAccountId: "act_1483477112868321", clientId: "c1", clientName: "Aurami", commercePlatform: "VESTI" },
      { adAccountId: "act_1483477112868321", clientId: "c2", clientName: "Cocci", commercePlatform: "VESTI" },
    ]);
  });

  it("ordena por conta e não repete o mesmo cliente", () => {
    const dup = client({ id: "a", metaAdAccountId: "act_9000000000000002" });
    const { rows } = buildAdsAccountRows([dup, dup, client({ id: "b", metaAdAccountId: "act_1000000000000001" })]);
    expect(rows.map((r) => r.adAccountId)).toEqual(["act_1000000000000001", "act_9000000000000002"]);
  });

  it("arquivado, inativo e conta inválida ficam de fora e são explicados; sem conta nem entra na lista de ignorados", () => {
    const { rows, ignored } = buildAdsAccountRows([
      client({ id: "ok", name: "Ok", metaAdAccountId: "act_1000000000000001" }),
      client({ id: "arq", name: "Arquivado", archivedAt: new Date("2026-10-01") }),
      client({ id: "ina", name: "Inativo", isActive: false }),
      client({ id: "inv", name: "Inválido", metaAdAccountId: "test" }),
      client({ id: "sem", name: "Sem conta", metaAdAccountId: null }),
      client({ id: "vaz", name: "Vazio", metaAdAccountId: "  " }),
    ]);
    expect(rows.map((r) => r.clientId)).toEqual(["ok"]);
    expect(ignored).toEqual([
      { clientId: "arq", clientName: "Arquivado", reason: "archived" },
      { clientId: "ina", clientName: "Inativo", reason: "inactive" },
      { clientId: "inv", clientName: "Inválido", reason: "invalid_account" },
    ]);
  });

  it("conta compartilhada: se um cliente está arquivado e o outro ativo, a conta continua com o ativo", () => {
    const { rows } = buildAdsAccountRows([client({ id: "a", name: "A", archivedAt: new Date() }), client({ id: "b", name: "B" })]);
    expect(rows.map((r) => [r.clientId, r.adAccountId])).toEqual([["b", "act_1447102162403037"]]);
  });

  it("plataforma ausente vira texto vazio (a tabela não aceita nulo nesse campo na leitura)", () => {
    const { rows } = buildAdsAccountRows([client({ id: "x", commercePlatform: null })]);
    expect(rows[0].commercePlatform).toBe("");
  });
});

describe("consultas do BigQuery", () => {
  it("cria a tabela up_global.ads_accounts só se não existir", () => {
    expect(ENSURE_ADS_ACCOUNTS_TABLE_QUERY).toContain("CREATE TABLE IF NOT EXISTS `up-vesti-report.up_global.ads_accounts`");
    expect(ENSURE_ADS_ACCOUNTS_TABLE_QUERY).toContain("ad_account_id STRING NOT NULL");
  });

  it("troca o conteúdo inteiro numa transação, com parâmetros (nada colado no SQL)", () => {
    const rows = [{ adAccountId: "act_1000000000000001", clientId: "c1", clientName: "O'Brien \"x\"", commercePlatform: "VESTI" }];
    const q = buildReplaceAdsAccountsQuery(rows);
    expect(q.query).toMatch(/BEGIN TRANSACTION;[\s\S]*DELETE FROM `up-vesti-report\.up_global\.ads_accounts` WHERE TRUE;[\s\S]*INSERT INTO[\s\S]*COMMIT TRANSACTION;/);
    expect(q.query).not.toContain("act_1000000000000001");
    expect(q.query).not.toContain("O'Brien");
    expect(q.params.rows).toEqual([{ ad_account_id: "act_1000000000000001", client_id: "c1", client_name: "O'Brien \"x\"", commerce_platform: "VESTI" }]);
    expect(q.types.rows[0]).toEqual({ ad_account_id: "STRING", client_id: "STRING", client_name: "STRING", commerce_platform: "STRING" });
  });

  it("lista vazia também é uma troca válida (todas as contas saíram do cadastro)", () => {
    expect(buildReplaceAdsAccountsQuery([]).params.rows).toEqual([]);
  });
});

function fakeBigQuery() {
  const queries: string[] = [];
  const bq = {
    createQueryJob: vi.fn(async (options: { query: string }) => {
      queries.push(options.query);
      return [{ getQueryResults: async () => [[]], metadata: {} }] as unknown as Awaited<ReturnType<BigQueryLike["createQueryJob"]>>;
    }),
    dataset: vi.fn(),
  } as unknown as BigQueryLike;
  return { bq, queries };
}

describe("publishAdsAccounts", () => {
  it("cria a tabela e troca o conteúdo; devolve quantas linhas publicou", async () => {
    const { bq, queries } = fakeBigQuery();
    const result = await publishAdsAccounts({
      bq,
      clients: [client({ id: "c1", metaAdAccountId: "act_1000000000000001" }), client({ id: "c2", metaAdAccountId: null })],
    });
    expect(result).toEqual({ skipped: false, rows: 1 });
    expect(queries).toHaveLength(2);
    expect(queries[0]).toContain("CREATE TABLE IF NOT EXISTS");
    expect(queries[1]).toContain("DELETE FROM");
  });

  it("sem credencial do BigQuery (desenvolvimento local): não faz nada", async () => {
    const saved = { ...process.env };
    for (const key of ["GOOGLE_APPLICATION_CREDENTIALS_JSON", "GOOGLE_SERVICE_ACCOUNT_JSON", "GOOGLE_APPLICATION_CREDENTIALS", "CLOUD_RUN_JOB", "K_SERVICE", "VERCEL"]) delete process.env[key];
    try {
      expect(await publishAdsAccounts({ clients: [client({ id: "c1" })] })).toEqual({ skipped: true, rows: 0 });
    } finally {
      process.env = saved;
    }
  });

  it("erro do BigQuery sobe (e a tabela antiga fica como está, porque a troca é uma transação)", async () => {
    const bq = { createQueryJob: vi.fn().mockRejectedValue(new Error("quota")), dataset: vi.fn() } as unknown as BigQueryLike;
    await expect(publishAdsAccounts({ bq, clients: [client({ id: "c1" })] })).rejects.toThrow("quota");
  });
});
