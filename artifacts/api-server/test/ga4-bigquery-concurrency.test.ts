import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BigQueryLike } from "../src/services/excluded-clients-bq";
import { GA4_BQ_PRODUCT_BATCH } from "../src/services/ga4-bigquery-rules";
import {
  dmlRetryConfig,
  GA4_BQ_DML_ATTEMPTS,
  isBigQueryConcurrentUpdateError,
  mergeGa4Daily,
  replaceGa4ProductViews,
  retryOnConcurrentUpdate,
} from "../src/services/ga4-bigquery";

// 17/11/2026: o backfill da Vivadress (troca de janela em transação) foi abortado pelo BigQuery porque a rodada horária escrevia na mesma
// tabela ao mesmo tempo. As gravações são idempotentes, então repetem depois de uma espera curta.

const REAL_ERROR =
  "Query error: Transaction is aborted due to concurrent update against table up-vesti-report:up_global.ga4_product_views_daily. Transaction ID: 6bb1fb86-0000-2545-96c1-14c14ee5f73c. Blocking job: up-vesti-report:US.0672c64e-f985-45ae-9639-25ae43d2cc89 under transaction: N/A. at [2:7]";

const originalSleep = dmlRetryConfig.sleep;
const originalRandom = dmlRetryConfig.random;
const waits: number[] = [];

beforeEach(() => {
  waits.length = 0;
  dmlRetryConfig.sleep = async (ms: number) => {
    waits.push(ms);
  };
  dmlRetryConfig.random = () => 0;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  dmlRetryConfig.sleep = originalSleep;
  dmlRetryConfig.random = originalRandom;
  vi.restoreAllMocks();
});

describe("isBigQueryConcurrentUpdateError", () => {
  it("reconhece a mensagem real do BigQuery e a variante de serialização", () => {
    expect(isBigQueryConcurrentUpdateError(new Error(REAL_ERROR))).toBe(true);
    expect(isBigQueryConcurrentUpdateError(new Error("Could not serialize access to table x due to concurrent update"))).toBe(true);
    expect(isBigQueryConcurrentUpdateError({ message: REAL_ERROR })).toBe(true);
  });

  it("não confunde outros erros do BigQuery com escrita simultânea", () => {
    expect(isBigQueryConcurrentUpdateError(new Error("Exceeded rate limits: too many table update operations"))).toBe(false);
    expect(isBigQueryConcurrentUpdateError(new Error("Not found: Table up_global.ga4_daily"))).toBe(false);
    expect(isBigQueryConcurrentUpdateError(new Error("Query error: Syntax error at [1:1]"))).toBe(false);
    expect(isBigQueryConcurrentUpdateError(null)).toBe(false);
  });
});

describe("retryOnConcurrentUpdate", () => {
  it("repete depois de uma espera crescente (3 s, 6 s, ...) e devolve o resultado quando passa", async () => {
    let calls = 0;
    const result = await retryOnConcurrentUpdate(async () => {
      calls += 1;
      if (calls <= 2) throw new Error(REAL_ERROR);
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(3);
    expect(waits).toEqual([3_000, 6_000]);
  });

  it("a espera cresce até 30 s e o sorteio só soma (até 50%) para dois processos não baterem juntos de novo", async () => {
    dmlRetryConfig.random = () => 0.999;
    let calls = 0;
    await retryOnConcurrentUpdate(async () => {
      calls += 1;
      if (calls <= 6) throw new Error(REAL_ERROR);
      return "ok";
    });
    expect(waits).toHaveLength(6);
    // bases: 3, 6, 12, 24, 30, 30 s; cada espera fica entre a base e a base + 50%.
    const bases = [3_000, 6_000, 12_000, 24_000, 30_000, 30_000];
    waits.forEach((wait, i) => {
      expect(wait).toBeGreaterThanOrEqual(bases[i]);
      expect(wait).toBeLessThanOrEqual(bases[i] * 1.5);
    });
  });

  it("desiste depois de GA4_BQ_DML_ATTEMPTS tentativas e devolve o último erro", async () => {
    let calls = 0;
    await expect(
      retryOnConcurrentUpdate(async () => {
        calls += 1;
        throw new Error(REAL_ERROR);
      }),
    ).rejects.toThrow("aborted due to concurrent update");
    expect(calls).toBe(GA4_BQ_DML_ATTEMPTS);
    expect(waits).toHaveLength(GA4_BQ_DML_ATTEMPTS - 1);
  });

  it("outro erro sobe na hora, sem repetir nem esperar", async () => {
    let calls = 0;
    await expect(
      retryOnConcurrentUpdate(async () => {
        calls += 1;
        throw new Error("Not found: Table up_global.ga4_daily");
      }),
    ).rejects.toThrow("Not found");
    expect(calls).toBe(1);
    expect(waits).toEqual([]);
  });
});

// BigQuery de mentira: guarda as consultas e deixa o teste decidir quando falhar.
function fakeBigQuery(handler: (query: string, index: number) => Error | undefined) {
  const calls: string[] = [];
  const bq: BigQueryLike = {
    createQueryJob: async (options) => {
      const index = calls.length;
      calls.push(options.query);
      const failure = handler(options.query, index);
      if (failure) throw failure;
      return [{ getQueryResults: async () => [[]], metadata: {} }] as never;
    },
    dataset: () => {
      throw new Error("nao usado");
    },
  };
  return { bq, calls };
}

const client = { clientId: "c1", clientName: "Vivadress", propertyId: "388250802" };
const day = (n: number) => ({ date: "2026-11-05", itemId: `sku-${n}`, itemName: `Produto ${n}`, itemVariant: null, views: 1 });

describe("gravações do BigQuery repetem quando a troca é abortada por escrita simultânea", () => {
  it("troca de janela por tabela temporária (backfill): a transação abortada é repetida e a temporária só é apagada no fim", async () => {
    let swaps = 0;
    const { bq, calls } = fakeBigQuery((query) => {
      if (query.includes("BEGIN TRANSACTION")) {
        swaps += 1;
        if (swaps <= 2) return new Error(REAL_ERROR);
      }
      return undefined;
    });
    const rows = Array.from({ length: GA4_BQ_PRODUCT_BATCH + 1 }, (_, i) => day(i));

    const written = await replaceGa4ProductViews(bq, client, rows, "2026-11-05", "2026-11-05", () => "abc12345");

    expect(written).toBe(GA4_BQ_PRODUCT_BATCH + 1);
    expect(swaps).toBe(3);
    expect(waits).toEqual([3_000, 6_000]);
    // A tabela temporária não é apagada entre as tentativas (a repetição precisa dela) e é apagada uma vez no fim.
    expect(calls.filter((query) => query.startsWith("DROP TABLE"))).toHaveLength(1);
    expect(calls.at(-1)).toMatch(/^DROP TABLE/);
  });

  it("janela curta (MERGE): repete também", async () => {
    let merges = 0;
    const { bq } = fakeBigQuery((query) => {
      if (query.startsWith("MERGE")) {
        merges += 1;
        if (merges === 1) return new Error(REAL_ERROR);
      }
      return undefined;
    });

    expect(await replaceGa4ProductViews(bq, client, [day(1)], "2026-11-05", "2026-11-05")).toBe(1);
    expect(merges).toBe(2);
  });

  it("o diário (marcador de cobertura) também repete", async () => {
    let merges = 0;
    const { bq } = fakeBigQuery(() => {
      merges += 1;
      return merges === 1 ? new Error(REAL_ERROR) : undefined;
    });

    const rows = [{ date: "2026-11-05", sessions: 1, pageViews: 1, productViews: 1, addToCarts: 0, checkouts: 0, purchases: 0 }];
    expect(await mergeGa4Daily(bq, client, rows, "2026-11-05", "2026-11-05")).toBe(1);
    expect(merges).toBe(2);
  });

  it("outro erro do BigQuery na troca não é repetido e a temporária ainda é apagada", async () => {
    const { bq, calls } = fakeBigQuery((query) => (query.includes("BEGIN TRANSACTION") ? new Error("Query error: Syntax error") : undefined));
    const rows = Array.from({ length: GA4_BQ_PRODUCT_BATCH + 1 }, (_, i) => day(i));

    await expect(replaceGa4ProductViews(bq, client, rows, "2026-11-05", "2026-11-05", () => "abc12345")).rejects.toThrow("Syntax error");

    expect(calls.filter((query) => query.includes("BEGIN TRANSACTION"))).toHaveLength(1);
    expect(calls.at(-1)).toMatch(/^DROP TABLE/);
    expect(waits).toEqual([]);
  });
});
