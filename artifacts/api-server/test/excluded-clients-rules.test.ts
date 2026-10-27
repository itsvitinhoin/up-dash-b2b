import { describe, expect, it } from "vitest";
import {
  clientKeys,
  computeExcludedRows,
  datasetsToDrop,
  isBigQueryAvailable,
  isBigQueryPurgeEnabled,
  isProtectedDataset,
  normalizeAdAccountId,
  normalizeGa4PropertyId,
  tombstonesFor,
  type ClientKeySource,
  type ExcludedRow,
} from "../src/services/excluded-clients-rules";

const archivedAt = new Date("2026-10-13T12:00:00.000Z");
const client = (id: string, extra: Partial<ClientKeySource> = {}): ClientKeySource => ({
  id,
  name: `Marca ${id}`,
  archivedAt: null,
  bigqueryDataset: null,
  erpDataset: null,
  metaAdAccountId: null,
  ga4PropertyId: null,
  ...extra,
});

describe("normalização das chaves", () => {
  it("conta de anúncios: tira act_ / act=", () => {
    expect(normalizeAdAccountId("act_123")).toBe("123");
    expect(normalizeAdAccountId("act=123")).toBe("123");
    expect(normalizeAdAccountId(" 123 ")).toBe("123");
    expect(normalizeAdAccountId("abc")).toBeNull();
    expect(normalizeAdAccountId("")).toBeNull();
    expect(normalizeAdAccountId(null)).toBeNull();
  });

  it("propriedade GA4: tira properties/", () => {
    expect(normalizeGa4PropertyId("properties/387817325")).toBe("387817325");
    expect(normalizeGa4PropertyId("387817325")).toBe("387817325");
    expect(normalizeGa4PropertyId("G-XXXX")).toBeNull();
  });

  it("datasets protegidos", () => {
    for (const name of ["up_global", "stape_logs", "stape_dataset", "vesti_dados", "analytics_ga4_traffic", "analytics_ga4_view_item", "UP_GLOBAL"]) {
      expect(isProtectedDataset(name)).toBe(true);
    }
    expect(isProtectedDataset("namine")).toBe(false);
    expect(isProtectedDataset("beniah")).toBe(false);
  });
});

describe("clientKeys", () => {
  it("junta dataset Vesti, dataset ERP, conta de anúncios e GA4, sem repetir nem aceitar nome inválido ou protegido", () => {
    const keys = clientKeys(client("a", {
      bigqueryDataset: "beniah",
      erpDataset: "beniah",
      metaAdAccountId: "act_55",
      ga4PropertyId: "properties/9",
    }));
    expect(keys).toEqual([
      { kind: "dataset", value: "beniah" },
      { kind: "meta_ad_account", value: "55" },
      { kind: "ga4_property", value: "9" },
    ]);
    expect(clientKeys(client("b", { bigqueryDataset: "up_global", erpDataset: "nome com espaco" }))).toEqual([]);
  });
});

describe("computeExcludedRows", () => {
  it("cliente na lixeira entra como excluded, com a data em que foi excluído", () => {
    const rows = computeExcludedRows({
      clients: [client("a", { archivedAt, bigqueryDataset: "beniah", metaAdAccountId: "act_55" }), client("b", { bigqueryDataset: "outro" })],
      tombstones: [],
    });
    expect(rows.map((r) => `${r.kind}:${r.value}:${r.state}`)).toEqual(["dataset:beniah:excluded", "meta_ad_account:55:excluded"]);
    expect(rows[0].excludedAt).toBe("2026-10-13T12:00:00.000Z");
    expect(rows[0].clientId).toBe("a");
  });

  it("cliente ativo nunca entra", () => {
    expect(computeExcludedRows({ clients: [client("a", { bigqueryDataset: "beniah" })], tombstones: [] })).toEqual([]);
  });

  it("chave compartilhada com um cliente ATIVO não pode travar quem continua ativo", () => {
    const rows = computeExcludedRows({
      clients: [client("a", { archivedAt, bigqueryDataset: "compartilhado", metaAdAccountId: "7" }), client("b", { bigqueryDataset: "compartilhado" })],
      tombstones: [],
    });
    expect(rows.map((r) => `${r.kind}:${r.value}`)).toEqual(["meta_ad_account:7"]);
  });

  it("lápides existentes continuam, mesmo sem o cliente existir mais", () => {
    const tombstone: ExcludedRow = { kind: "dataset", value: "velho", clientId: "x", clientName: "Marca x", state: "deleted", excludedAt: "2026-01-01T00:00:00.000Z" };
    const rows = computeExcludedRows({ clients: [], tombstones: [tombstone] });
    expect(rows).toEqual([tombstone]);
  });

  it("lápide some se um cliente ativo passar a usar a mesma chave (cadastro novo da mesma marca)", () => {
    const tombstone: ExcludedRow = { kind: "dataset", value: "velho", clientId: "x", clientName: "Marca x", state: "deleted", excludedAt: "2026-01-01T00:00:00.000Z" };
    expect(computeExcludedRows({ clients: [client("novo", { bigqueryDataset: "velho" })], tombstones: [tombstone] })).toEqual([]);
  });

  it("'excluded' que vira 'deleted': a lápide vence", () => {
    const a = client("a", { archivedAt, bigqueryDataset: "beniah" });
    const rows = computeExcludedRows({ clients: [a], tombstones: [], newlyDeleted: tombstonesFor(a, new Date("2027-01-12T00:00:00.000Z")) });
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("deleted");
  });

  it("ordem estável (mesma entrada, mesma saída)", () => {
    const clients = [client("b", { archivedAt, bigqueryDataset: "zeta" }), client("a", { archivedAt, bigqueryDataset: "alfa" })];
    const one = computeExcludedRows({ clients, tombstones: [] });
    const two = computeExcludedRows({ clients: [...clients].reverse(), tombstones: [] });
    expect(one).toEqual(two);
    expect(one.map((r) => r.value)).toEqual(["alfa", "zeta"]);
  });
});

describe("isBigQueryPurgeEnabled", () => {
  it("ligado por padrão (sem a variável)", () => {
    expect(isBigQueryPurgeEnabled({})).toBe(true);
    expect(isBigQueryPurgeEnabled({ BQ_PURGE_ENABLED: "" })).toBe(true);
    expect(isBigQueryPurgeEnabled({ BQ_PURGE_ENABLED: "true" })).toBe(true);
  });

  it("só desliga com valor explícito de desligar", () => {
    for (const value of ["false", "FALSE", "0", "no", "nao", "não", " false "]) {
      expect(isBigQueryPurgeEnabled({ BQ_PURGE_ENABLED: value })).toBe(false);
    }
  });
});

describe("isBigQueryAvailable", () => {
  it("local, sem credencial nem plataforma: não", () => {
    expect(isBigQueryAvailable({})).toBe(false);
    expect(isBigQueryAvailable({ NODE_ENV: "development", DATABASE_URL: "x" })).toBe(false);
  });

  it("credencial em variável de ambiente: sim", () => {
    expect(isBigQueryAvailable({ GOOGLE_APPLICATION_CREDENTIALS_JSON: "{}" })).toBe(true);
    expect(isBigQueryAvailable({ GOOGLE_SERVICE_ACCOUNT_JSON: "{}" })).toBe(true);
    expect(isBigQueryAvailable({ GOOGLE_APPLICATION_CREDENTIALS: "/x.json" })).toBe(true);
  });

  it("Cloud Run job/serviço e Vercel usam a credencial da plataforma (ADC): sim (foi o defeito do job que pulava tudo)", () => {
    expect(isBigQueryAvailable({ CLOUD_RUN_JOB: "upzero-sync-job" })).toBe(true);
    expect(isBigQueryAvailable({ K_SERVICE: "api" })).toBe(true);
    expect(isBigQueryAvailable({ VERCEL: "1" })).toBe(true);
  });
});

describe("datasetsToDrop", () => {
  const me = { id: "me", bigqueryDataset: "beniah", erpDataset: "beniah_erp" };

  it("apaga os datasets do próprio cliente (Vesti e ERP)", () => {
    expect(datasetsToDrop(me, [{ id: "o", bigqueryDataset: "outro", erpDataset: null }])).toEqual({ targets: ["beniah", "beniah_erp"], skipped: [] });
  });

  it("não apaga dataset que outro cliente também usa", () => {
    const result = datasetsToDrop(me, [{ id: "o", bigqueryDataset: "beniah", erpDataset: null }]);
    expect(result.targets).toEqual(["beniah_erp"]);
    expect(result.skipped).toEqual([{ dataset: "beniah", reason: "shared" }]);
  });

  it("não apaga dataset protegido nem inválido", () => {
    const result = datasetsToDrop({ id: "me", bigqueryDataset: "up_global", erpDataset: "x; DROP" }, []);
    expect(result.targets).toEqual([]);
    expect(result.skipped).toEqual([{ dataset: "up_global", reason: "protected" }, { dataset: "x; DROP", reason: "invalid" }]);
  });

  it("sem dataset: nada a apagar", () => {
    expect(datasetsToDrop({ id: "me", bigqueryDataset: null, erpDataset: "" }, [])).toEqual({ targets: [], skipped: [] });
  });
});
