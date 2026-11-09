import { describe, expect, it, vi } from "vitest";
import type { BigQueryLike } from "../src/services/excluded-clients-bq";
import {
  buildGa4DailyBqRows,
  buildGa4ProductBqRows,
  buildGa4TrafficBqRows,
  chunk,
  GA4_BQ_PRODUCT_BATCH,
  GA4_BQ_TRAFFIC_BATCH,
  isGa4BigQueryEnabled,
  resolveGa4BigQueryDataset,
} from "../src/services/ga4-bigquery-rules";
import {
  buildMergeGa4DailyQuery,
  buildSwapProductsQuery,
  buildSwapTrafficQuery,
  deleteGa4Rows,
  ensureGa4Tables,
  mergeGa4Daily,
  readGa4BigQueryCoverage,
  replaceGa4ProductViews,
  replaceGa4Traffic,
  writeGa4ToBigQuery,
} from "../src/services/ga4-bigquery";
import { fillGa4Days, toStoredProductViews } from "../src/services/ga4-daily-rules";

const client = { clientId: "c1", clientName: "Giah Studio", propertyId: "422756040" };

// BigQuery de mentira: guarda cada consulta recebida e deixa o teste escolher o que responder ou quando falhar.
function fakeBigQuery(handler: (query: string, index: number) => Array<Record<string, unknown>> | Error = () => []) {
  const calls: Array<{ query: string; params?: Record<string, unknown>; types?: Record<string, unknown> }> = [];
  const bq: BigQueryLike = {
    createQueryJob: async (options) => {
      const index = calls.length;
      calls.push({ query: options.query, params: options.params, types: options.types });
      const outcome = handler(options.query, index);
      if (outcome instanceof Error) throw outcome;
      return [{ getQueryResults: async () => [outcome], metadata: {} }] as never;
    },
    dataset: () => {
      throw new Error("nao usado");
    },
  };
  return { bq, calls };
}

const productDay = (date: string, itemId: string, views: number) => ({ date, itemId, itemName: `Produto ${itemId}`, itemVariant: null, views });

// Uma linha de origem do trafego: cada compra vem com 3 "carrinhos" e 2 "checkouts", para as contas dos testes ficarem simples.
const trafficDay = (
  date: string,
  source: string,
  medium: string,
  campaign: string,
  sessions: number,
  purchases = 0,
  purchaseRevenue = 0,
) => ({
  date,
  channelGroup: "Paid Social",
  source,
  medium,
  campaign,
  sessions,
  totalUsers: sessions,
  engagedSessions: Math.round(sessions / 2),
  addToCarts: purchases * 3,
  checkouts: purchases * 2,
  purchases,
  purchaseRevenue,
});

describe("buildGa4DailyBqRows", () => {
  it("leva cliente, propriedade e todas as métricas, com totalUsers/receita ausentes virando 0", () => {
    const [row] = buildGa4DailyBqRows(client, [
      { date: "2026-11-05", sessions: 2092, pageViews: 5000, productViews: 900, addToCarts: 80, checkouts: 40, purchases: 12 },
    ]);
    expect(row).toEqual({
      client_id: "c1",
      client_name: "Giah Studio",
      property_id: "422756040",
      date: "2026-11-05",
      sessions: 2092,
      total_users: 0,
      page_views: 5000,
      view_item: 900,
      add_to_cart: 80,
      begin_checkout: 40,
      purchases: 12,
      purchase_revenue: 0,
    });
  });

  it("arredonda a receita a centavos e não deixa NaN passar", () => {
    const [row] = buildGa4DailyBqRows(client, [
      { date: "2026-11-05", sessions: Number.NaN, pageViews: 1, productViews: 0, addToCarts: 0, checkouts: 0, purchases: 0, totalUsers: 7, purchaseRevenue: 1234.5678 },
    ]);
    expect(row.sessions).toBe(0);
    expect(row.total_users).toBe(7);
    expect(row.purchase_revenue).toBe(1234.57);
  });

  it("dias zerados também viram linha (a linha existir quer dizer 'já sincronizou')", () => {
    const rows = buildGa4DailyBqRows(client, fillGa4Days("2026-11-04", "2026-11-06", []));
    expect(rows.map((r) => [r.date, r.sessions])).toEqual([
      ["2026-11-04", 0],
      ["2026-11-05", 0],
      ["2026-11-06", 0],
    ]);
  });
});

describe("buildGa4ProductBqRows", () => {
  it("usa as linhas já normalizadas e somadas pelo mesmo passo do Postgres", () => {
    const stored = toStoredProductViews([productDay("2026-11-05", "A1", 5), productDay("2026-11-05", "A1", 3)]);
    const rows = buildGa4ProductBqRows(client, stored);
    expect(rows).toEqual([
      {
        client_id: "c1",
        client_name: "Giah Studio",
        property_id: "422756040",
        date: "2026-11-05",
        item_id: "A1",
        item_name: "Produto A1",
        item_variant: "",
        items_viewed: 8,
      },
    ]);
  });
});

describe("chunk", () => {
  it("divide em lotes e mantém a ordem", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
  it("lote de tamanho inválido é erro, não laço infinito", () => {
    expect(() => chunk([1], 0)).toThrow();
  });
});

describe("isGa4BigQueryEnabled", () => {
  it("fica desligado sem credencial (teste e desenvolvimento)", () => {
    expect(isGa4BigQueryEnabled({})).toBe(false);
  });
  it("liga no Cloud Run Job", () => {
    expect(isGa4BigQueryEnabled({ CLOUD_RUN_JOB: "upzero-sync-job-hourly" })).toBe(true);
  });
  it("GA4_BIGQUERY=0 desliga mesmo com credencial", () => {
    expect(isGa4BigQueryEnabled({ CLOUD_RUN_JOB: "x", GA4_BIGQUERY: "0" })).toBe(false);
    expect(isGa4BigQueryEnabled({ CLOUD_RUN_JOB: "x", GA4_BIGQUERY: "off" })).toBe(false);
  });
});

describe("resolveGa4BigQueryDataset", () => {
  it("sem variável usa up_global", () => {
    expect(resolveGa4BigQueryDataset({})).toBe("up_global");
    expect(resolveGa4BigQueryDataset({ GA4_BQ_DATASET: "  " })).toBe("up_global");
  });
  it("aceita um dataset de teste", () => {
    expect(resolveGa4BigQueryDataset({ GA4_BQ_DATASET: "ga4_teste" })).toBe("ga4_teste");
  });
  it("nome inválido dá erro em vez de cair em up_global (erro de digitação no canário não pode gravar em produção)", () => {
    expect(() => resolveGa4BigQueryDataset({ GA4_BQ_DATASET: "ga4-teste" })).toThrow("GA4_BQ_DATASET");
    expect(() => resolveGa4BigQueryDataset({ GA4_BQ_DATASET: "x`; DROP SCHEMA up_global; --" })).toThrow();
  });
});

describe("dataset de teste (GA4_BQ_DATASET) nas consultas", () => {
  it("troca o dataset em todas as tabelas e cria o dataset antes das tabelas", async () => {
    vi.resetModules();
    vi.stubEnv("GA4_BQ_DATASET", "ga4_teste");
    try {
      const mod = await import("../src/services/ga4-bigquery");
      const { bq, calls } = fakeBigQuery();
      await mod.ensureGa4Tables(bq);
      expect(calls.map((c) => c.query.trim().split(/\s+/).slice(0, 3).join(" "))).toEqual([
        "CREATE SCHEMA IF",
        "CREATE TABLE IF",
        "CREATE TABLE IF",
        "CREATE TABLE IF",
      ]);
      expect(calls[0].query).toContain("`up-vesti-report.ga4_teste`");
      expect(calls[1].query).toContain("up-vesti-report.ga4_teste.ga4_daily");
      expect(calls[2].query).toContain("up-vesti-report.ga4_teste.ga4_product_views_daily");
      expect(calls[3].query).toContain("up-vesti-report.ga4_teste.ga4_traffic_daily");
      expect(mod.buildMergeGa4DailyQuery(client, [], "2026-11-01", "2026-11-06").query).not.toContain("up_global");
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it("no padrão (up_global) não tenta criar o dataset", async () => {
    const { bq, calls } = fakeBigQuery();
    await ensureGa4Tables(bq);
    expect(calls.some((c) => c.query.includes("CREATE SCHEMA"))).toBe(false);
  });
});

describe("ensureGa4Tables", () => {
  it("cria as três tabelas, particionadas por data e agrupadas por cliente, uma vez só por cliente do BigQuery", async () => {
    const { bq, calls } = fakeBigQuery();
    await ensureGa4Tables(bq);
    await ensureGa4Tables(bq);
    expect(calls).toHaveLength(3);
    expect(calls[0].query).toContain("up-vesti-report.up_global.ga4_daily");
    expect(calls[1].query).toContain("up-vesti-report.up_global.ga4_product_views_daily");
    expect(calls[2].query).toContain("up-vesti-report.up_global.ga4_traffic_daily");
    expect(calls[2].query).toContain("channel_group STRING");
    expect(calls[2].query).toContain("purchase_revenue FLOAT64");
    for (const call of calls) {
      expect(call.query).toContain("CREATE TABLE IF NOT EXISTS");
      expect(call.query).toContain("PARTITION BY `date`");
      expect(call.query).toContain("CLUSTER BY client_id");
    }
  });
});

describe("readGa4BigQueryCoverage", () => {
  it("devolve primeiro e último dia de cada cliente", async () => {
    const { bq } = fakeBigQuery(() => [
      { client_id: "c1", first_day: "2025-09-16", last_day: "2026-11-05" },
      { client_id: "c2", first_day: "2026-10-01", last_day: "2026-11-05" },
    ]);
    const coverage = await readGa4BigQueryCoverage(bq);
    expect(coverage.get("c1")).toEqual({ firstDay: "2025-09-16", lastDay: "2026-11-05" });
    expect(coverage.size).toBe(2);
  });

  it("tabela ainda inexistente: cria as tabelas e diz que ninguém tem histórico", async () => {
    const notFound = Object.assign(new Error("Not found: Table up-vesti-report:up_global.ga4_daily"), { code: 404 });
    const { bq, calls } = fakeBigQuery((_query, index) => (index === 0 ? notFound : []));
    const coverage = await readGa4BigQueryCoverage(bq);
    expect(coverage.size).toBe(0);
    expect(calls.map((c) => c.query.trim().split(/\s+/)[0])).toEqual(["SELECT", "CREATE", "CREATE", "CREATE"]);
  });

  it("outro erro do BigQuery sobe (o job então pula o BigQuery em vez de supor que ninguém tem histórico)", async () => {
    const { bq } = fakeBigQuery(() => Object.assign(new Error("Access Denied"), { code: 403 }));
    await expect(readGa4BigQueryCoverage(bq)).rejects.toThrow("Access Denied");
  });
});

describe("mergeGa4Daily", () => {
  const rows = fillGa4Days("2026-11-04", "2026-11-06", [
    { date: "2026-11-05", sessions: 10, pageViews: 20, productViews: 5, addToCarts: 2, checkouts: 1, purchases: 1 },
  ]);

  it("faz MERGE por cliente e dia, limitado à janela, sem duplicar ao repetir", () => {
    const query = buildMergeGa4DailyQuery(client, rows, "2026-11-04", "2026-11-06");
    expect(query.query).toContain("MERGE");
    expect(query.query).toContain("T.client_id = S.client_id AND T.`date` = S.`date`");
    expect(query.query).toContain("BETWEEN DATE(@from_date) AND DATE(@to_date)");
    expect(query.params.from_date).toBe("2026-11-04");
    expect(query.params.to_date).toBe("2026-11-06");
    expect(query.params.rows).toHaveLength(3);
    expect(query.types.rows[0]).toMatchObject({ sessions: "INT64", purchase_revenue: "FLOAT64", date: "STRING" });
  });

  it("sem linhas não chama o BigQuery", async () => {
    const { bq, calls } = fakeBigQuery();
    expect(await mergeGa4Daily(bq, client, [], "2026-11-04", "2026-11-06")).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("devolve quantas linhas enviou", async () => {
    const { bq, calls } = fakeBigQuery();
    expect(await mergeGa4Daily(bq, client, rows, "2026-11-04", "2026-11-06")).toBe(3);
    expect(calls).toHaveLength(1);
  });
});

describe("replaceGa4ProductViews", () => {
  const manyItems = (n: number) =>
    toStoredProductViews(Array.from({ length: n }, (_, i) => productDay("2026-11-05", `P${i}`, 1)));
  const ids = () => "abc12345";

  it("carrega em lotes numa tabela temporária e só então troca a janela de uma vez", async () => {
    const { bq, calls } = fakeBigQuery();
    const total = GA4_BQ_PRODUCT_BATCH * 2 + 10;
    const written = await replaceGa4ProductViews(bq, client, manyItems(total), "2026-10-01", "2026-11-06", ids);
    expect(written).toBe(total);
    const kinds = calls.map((c) => c.query.trim().split(/\s+/).slice(0, 2).join(" "));
    expect(kinds).toEqual(["CREATE TABLE", "INSERT INTO", "INSERT INTO", "INSERT INTO", "BEGIN TRANSACTION;", "DROP TABLE"]);
    expect(calls[0].query).toContain("ga4_product_views_stg_abc12345");
    expect(calls[0].query).toContain("expiration_timestamp");
    expect((calls[1].params?.rows as unknown[]).length).toBe(GA4_BQ_PRODUCT_BATCH);
    expect((calls[3].params?.rows as unknown[]).length).toBe(10);
    const swap = calls[4];
    expect(swap.query).toContain("DELETE FROM `up-vesti-report.up_global.ga4_product_views_daily`");
    expect(swap.query).toContain("NULLIF(item_id, '')");
    expect(swap.params).toEqual({ client_id: "c1", from_date: "2026-10-01", to_date: "2026-11-06" });
  });

  it("se um lote falhar a troca NÃO acontece (a tabela de verdade fica como estava) e a temporária é apagada", async () => {
    const { bq, calls } = fakeBigQuery((query) => (query.startsWith("INSERT INTO") ? new Error("quota") : []));
    await expect(
      replaceGa4ProductViews(bq, client, manyItems(GA4_BQ_PRODUCT_BATCH + 1), "2026-10-01", "2026-11-06", ids),
    ).rejects.toThrow("quota");
    const kinds = calls.map((c) => c.query.trim().split(/\s+/)[0]);
    expect(kinds).toEqual(["CREATE", "INSERT", "DROP"]);
    expect(calls.some((c) => c.query.includes("BEGIN TRANSACTION"))).toBe(false);
  });

  it("janela curta (cabe num lote): uma consulta só (MERGE), sem tabela temporária nem transação", async () => {
    const { bq, calls } = fakeBigQuery();
    const written = await replaceGa4ProductViews(bq, client, manyItems(50), "2026-11-07", "2026-11-09", ids);
    expect(written).toBe(50);
    expect(calls).toHaveLength(1);
    const [merge] = calls;
    expect(merge.query).toMatch(/^MERGE `up-vesti-report\.up_global\.ga4_product_views_daily` T/);
    expect(merge.query).toContain("NULLIF(r.item_id, '')"); // o mesmo "vazio vira NULL" da troca por tabela temporária
    expect(merge.query).toContain("T.item_variant IS NOT DISTINCT FROM S.item_variant"); // variante vazia (NULL) também casa
    expect(merge.query).toContain("GROUP BY"); // chave repetida na origem é somada, nunca erro de MERGE
    expect(merge.query).toContain("WHEN NOT MATCHED BY SOURCE AND T.client_id = @client_id");
    expect(merge.query).toContain("THEN DELETE"); // o que o GA4 deixou de devolver sai, só dentro da janela e deste cliente
    expect(merge.query).not.toContain("BEGIN TRANSACTION");
    expect(merge.query).not.toContain("_stg_");
    expect((merge.params?.rows as unknown[]).length).toBe(50);
    expect(merge.params).toMatchObject({ client_id: "c1", from_date: "2026-11-07", to_date: "2026-11-09" });
  });

  it("no limite do lote ainda é uma consulta só; uma linha a mais passa pela tabela temporária", async () => {
    const exact = fakeBigQuery();
    expect(await replaceGa4ProductViews(exact.bq, client, manyItems(GA4_BQ_PRODUCT_BATCH), "2026-11-05", "2026-11-06", ids)).toBe(
      GA4_BQ_PRODUCT_BATCH,
    );
    expect(exact.calls.map((c) => c.query.trim().split(/\s+/)[0])).toEqual(["MERGE"]);

    const over = fakeBigQuery();
    await replaceGa4ProductViews(over.bq, client, manyItems(GA4_BQ_PRODUCT_BATCH + 1), "2026-11-05", "2026-11-06", ids);
    expect(over.calls.map((c) => c.query.trim().split(/\s+/)[0])).toEqual(["CREATE", "INSERT", "INSERT", "BEGIN", "DROP"]);
  });

  it("janela curta: se o MERGE falhar o erro sobe e nada mais é chamado (uma instrução só, entra tudo ou nada)", async () => {
    const { bq, calls } = fakeBigQuery(() => new Error("cota"));
    await expect(replaceGa4ProductViews(bq, client, manyItems(5), "2026-11-05", "2026-11-06", ids)).rejects.toThrow("cota");
    expect(calls).toHaveLength(1);
  });

  it("loja sem nenhum view_item na janela só limpa o que estava lá", async () => {
    const { bq, calls } = fakeBigQuery();
    expect(await replaceGa4ProductViews(bq, client, [], "2026-10-01", "2026-11-06", ids)).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].query).toContain("DELETE FROM");
    expect(calls[0].params).toEqual({ client_id: "c1", from_date: "2026-10-01", to_date: "2026-11-06" });
  });

  it("não aceita nome de tabela temporária fora do padrão (nada de SQL montado com entrada solta)", () => {
    expect(() => buildSwapProductsQuery("x`; DROP TABLE y; --", "c1", "2026-10-01", "2026-11-06")).toThrow();
  });
});

describe("deleteGa4Rows (exclusão definitiva do cliente)", () => {
  it("apaga por client_id nas TRÊS tabelas e soma as linhas removidas", async () => {
    const calls: Array<{ query: string; params?: Record<string, unknown> }> = [];
    const affected = [400, 113487, 25246];
    const bq: BigQueryLike = {
      createQueryJob: async (options) => {
        calls.push({ query: options.query, params: options.params });
        const n = affected[calls.length - 1];
        return [{ getQueryResults: async () => [[]], metadata: { statistics: { query: { numDmlAffectedRows: String(n) } } } }] as never;
      },
      dataset: () => {
        throw new Error("nao usado");
      },
    };
    expect(await deleteGa4Rows(bq, "c1")).toBe(400 + 113487 + 25246);
    expect(calls).toHaveLength(3);
    expect(calls[0].query).toContain("DELETE FROM `up-vesti-report.up_global.ga4_daily`");
    expect(calls[1].query).toContain("DELETE FROM `up-vesti-report.up_global.ga4_product_views_daily`");
    expect(calls[2].query).toContain("DELETE FROM `up-vesti-report.up_global.ga4_traffic_daily`");
    for (const call of calls) {
      expect(call.query).toContain("client_id = @client_id");
      expect(call.params).toEqual({ client_id: "c1" });
    }
  });

  it("tabela que ainda não existe conta como nada a apagar (não trava a exclusão)", async () => {
    const notFound = Object.assign(new Error("Not found: Table up-vesti-report:up_global.ga4_daily"), { code: 404 });
    const { bq } = fakeBigQuery(() => notFound);
    expect(await deleteGa4Rows(bq, "c1")).toBe(0);
  });

  it("outro erro do BigQuery sobe, para o cliente continuar na lixeira e tentar de novo depois", async () => {
    const { bq } = fakeBigQuery(() => Object.assign(new Error("Access Denied"), { code: 403 }));
    await expect(deleteGa4Rows(bq, "c1")).rejects.toThrow("Access Denied");
  });

  it("client_id vazio é recusado (nunca um DELETE sem dono)", async () => {
    const { bq, calls } = fakeBigQuery();
    await expect(deleteGa4Rows(bq, "  ")).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe("writeGa4ToBigQuery", () => {
  const daily = fillGa4Days("2026-11-05", "2026-11-06", []);
  const productViews = toStoredProductViews([productDay("2026-11-05", "A1", 4)]);
  const base = { client, daily, from: "2026-11-05", productViews, productFrom: "2026-11-05", to: "2026-11-06", newId: () => "abc12345" };

  // Posição do MERGE de cada tabela (janela curta = uma consulta por tabela); -1 se a tabela não foi tocada por MERGE.
  const mergeOn = (calls: Array<{ query: string }>, table: string) =>
    calls.findIndex((c) => c.query.startsWith("MERGE") && c.query.includes(`.${table}\``));

  it("grava os produtos primeiro e o diário por último (o diário é o marcador de cobertura)", async () => {
    const { bq, calls } = fakeBigQuery();
    const result = await writeGa4ToBigQuery(bq, base);
    expect(result).toEqual({ dailyRows: 2, productRows: 1, trafficRows: 0 });
    const products = mergeOn(calls, "ga4_product_views_daily");
    const dailyMerge = mergeOn(calls, "ga4_daily");
    expect(products).toBeGreaterThan(-1);
    expect(dailyMerge).toBe(calls.length - 1);
    expect(products).toBeLessThan(dailyMerge);
  });

  it("se os produtos falharem o diário não é gravado, então a próxima rodada refaz o backfill dos dois", async () => {
    const { bq, calls } = fakeBigQuery((query) =>
      query.startsWith("MERGE") && query.includes("ga4_product_views_daily") ? new Error("conflito") : [],
    );
    await expect(writeGa4ToBigQuery(bq, base)).rejects.toThrow("conflito");
    expect(mergeOn(calls, "ga4_daily")).toBe(-1);
  });

  describe("com a origem do tráfego", () => {
    const traffic = [
      trafficDay("2026-11-05", "facebook", "cpm", "Remarketing", 100, 3, 450.5),
      trafficDay("2026-11-05", "google", "organic", "(organic)", 40, 1, 120),
    ];
    const withTraffic = { ...base, traffic, trafficFrom: "2026-11-03" };

    it("grava produtos, depois a origem do tráfego e o diário por último", async () => {
      const { bq, calls } = fakeBigQuery();
      const result = await writeGa4ToBigQuery(bq, withTraffic);
      expect(result).toEqual({ dailyRows: 2, productRows: 1, trafficRows: 2 });
      const products = mergeOn(calls, "ga4_product_views_daily");
      const trafficMerge = mergeOn(calls, "ga4_traffic_daily");
      const dailyMerge = mergeOn(calls, "ga4_daily");
      expect(products).toBeGreaterThan(-1);
      expect(products).toBeLessThan(trafficMerge);
      expect(trafficMerge).toBeLessThan(dailyMerge);
      expect(dailyMerge).toBe(calls.length - 1);
      expect(calls[trafficMerge].params).toMatchObject({ client_id: "c1", from_date: "2026-11-03", to_date: "2026-11-06" });
      expect(calls.some((c) => c.query.includes("BEGIN TRANSACTION"))).toBe(false); // janela curta: nenhuma tabela temporária
    });

    it("com tudo em janela curta cada cliente custa 3 consultas (produtos, origem do tráfego e diário)", async () => {
      const { bq, calls } = fakeBigQuery();
      await ensureGa4Tables(bq); // criar as tabelas é por processo, não por cliente
      const before = calls.length;
      await writeGa4ToBigQuery(bq, withTraffic);
      expect(calls.length - before).toBe(3);
    });

    it("sem a origem do tráfego nenhuma consulta toca a tabela dela (além de criá-la)", async () => {
      const { bq, calls } = fakeBigQuery();
      await writeGa4ToBigQuery(bq, base);
      const touching = calls.filter((c) => c.query.includes("ga4_traffic") && !c.query.startsWith("CREATE TABLE IF"));
      expect(touching).toHaveLength(0);
    });

    it("se SÓ a origem do tráfego falhar o diário e os produtos são gravados e o erro volta em trafficError (isolada)", async () => {
      const { bq, calls } = fakeBigQuery((query) =>
        query.startsWith("MERGE") && query.includes("ga4_traffic_daily") ? new Error("cota do BigQuery") : [],
      );
      const result = await writeGa4ToBigQuery(bq, withTraffic);
      expect(result).toMatchObject({ dailyRows: 2, productRows: 1, trafficRows: 0, trafficError: "cota do BigQuery" });
      expect(mergeOn(calls, "ga4_daily")).toBeGreaterThan(-1);
      expect(mergeOn(calls, "ga4_product_views_daily")).toBeGreaterThan(-1);
    });

    it("o mesmo isolamento vale na janela longa (tabela temporária): falha ao criá-la não derruba produtos nem diário", async () => {
      const { bq, calls } = fakeBigQuery((query) => (query.includes("ga4_traffic_stg_") && query.startsWith("CREATE") ? new Error("cota do BigQuery") : []));
      const bigTraffic = Array.from({ length: GA4_BQ_TRAFFIC_BATCH + 1 }, (_, i) => trafficDay("2026-11-05", `origem${i}`, "referral", "(not set)", 1));
      const result = await writeGa4ToBigQuery(bq, { ...base, traffic: bigTraffic, trafficFrom: "2025-10-06" });
      expect(result).toMatchObject({ dailyRows: 2, productRows: 1, trafficRows: 0, trafficError: "cota do BigQuery" });
      expect(mergeOn(calls, "ga4_daily")).toBe(calls.length - 1);
    });
  });
});

describe("buildGa4TrafficBqRows", () => {
  it("leva cliente, propriedade, canal, origem, mídia, campanha e as métricas de cada linha", () => {
    const [row] = buildGa4TrafficBqRows(client, [trafficDay("2026-11-05", "facebook", "cpm", "Remarketing", 100, 3, 450.5)]);
    expect(row).toEqual({
      client_id: "c1",
      client_name: "Giah Studio",
      property_id: "422756040",
      date: "2026-11-05",
      channel_group: "Paid Social",
      source: "facebook",
      medium: "cpm",
      campaign: "Remarketing",
      sessions: 100,
      total_users: 100,
      engaged_sessions: 50,
      add_to_cart: 9,
      begin_checkout: 6,
      purchases: 3,
      purchase_revenue: 450.5,
    });
  });

  it('texto vazio vira "(not set)" (o mesmo nome do GA4) e espaços nas pontas são aparados', () => {
    const [row] = buildGa4TrafficBqRows(client, [
      { ...trafficDay("2026-11-05", "  google  ", "   ", "", 10), channelGroup: "" },
    ]);
    expect(row).toMatchObject({ source: "google", medium: "(not set)", campaign: "(not set)", channel_group: "(not set)" });
  });

  it("linhas que caem na mesma chave depois de normalizar são SOMADAS (a tabela não tem chave primária: duplicar contaria a venda duas vezes)", () => {
    const rows = buildGa4TrafficBqRows(client, [
      trafficDay("2026-11-05", "google", "cpc", "Marca", 10, 1, 100.1),
      trafficDay("2026-11-05", " google ", "cpc", "Marca", 5, 2, 50.2),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sessions: 15, purchases: 3, purchase_revenue: 150.3 });
  });

  it("dias, origens ou campanhas diferentes continuam linhas separadas", () => {
    const rows = buildGa4TrafficBqRows(client, [
      trafficDay("2026-11-05", "google", "cpc", "Marca", 10),
      trafficDay("2026-11-06", "google", "cpc", "Marca", 10),
      trafficDay("2026-11-05", "google", "cpc", "Genérica", 10),
      trafficDay("2026-11-05", "facebook", "cpc", "Marca", 10),
    ]);
    expect(rows).toHaveLength(4);
  });

  it("valores quebrados (NaN) viram 0 e a receita é arredondada a centavos", () => {
    const [row] = buildGa4TrafficBqRows(client, [
      { ...trafficDay("2026-11-05", "google", "cpc", "Marca", Number.NaN), purchaseRevenue: 10.456 },
    ]);
    expect(row.sessions).toBe(0);
    expect(row.purchase_revenue).toBe(10.46);
  });

  it("receita negativa (estorno) é mantida e abate a venda da mesma chave", () => {
    const rows = buildGa4TrafficBqRows(client, [
      trafficDay("2026-11-05", "google", "cpc", "Marca", 10, 2, 300),
      trafficDay("2026-11-05", "google", "cpc", "Marca", 0, 0, -120.5),
      trafficDay("2026-11-06", "(direct)", "(none)", "(direct)", 16, 0, -3048),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ sessions: 10, purchases: 2, purchase_revenue: 179.5 });
    expect(rows[1]).toMatchObject({ sessions: 16, purchase_revenue: -3048 });
  });
});

describe("replaceGa4Traffic", () => {
  const manyOrigins = (n: number) =>
    Array.from({ length: n }, (_, i) => trafficDay("2026-11-05", `origem${i}`, "referral", "(not set)", 1));
  const ids = () => "abc12345";

  it("carrega em lotes numa tabela temporária e só então troca a janela de uma vez", async () => {
    const { bq, calls } = fakeBigQuery();
    const total = GA4_BQ_TRAFFIC_BATCH * 2 + 10;
    const written = await replaceGa4Traffic(bq, client, manyOrigins(total), "2025-10-06", "2026-11-09", ids);
    expect(written).toBe(total);
    const kinds = calls.map((c) => c.query.trim().split(/\s+/).slice(0, 2).join(" "));
    expect(kinds).toEqual(["CREATE TABLE", "INSERT INTO", "INSERT INTO", "INSERT INTO", "BEGIN TRANSACTION;", "DROP TABLE"]);
    expect(calls[0].query).toContain("ga4_traffic_stg_abc12345");
    expect(calls[0].query).toContain("expiration_timestamp");
    expect((calls[1].params?.rows as unknown[]).length).toBe(GA4_BQ_TRAFFIC_BATCH);
    expect((calls[3].params?.rows as unknown[]).length).toBe(10);
    const swap = calls[4];
    expect(swap.query).toContain("DELETE FROM `up-vesti-report.up_global.ga4_traffic_daily`");
    expect(swap.params).toEqual({ client_id: "c1", from_date: "2025-10-06", to_date: "2026-11-09" });
  });

  it("se um lote falhar a troca NÃO acontece (a tabela de verdade fica como estava) e a temporária é apagada", async () => {
    const { bq, calls } = fakeBigQuery((query) => (query.startsWith("INSERT INTO") ? new Error("quota") : []));
    await expect(
      replaceGa4Traffic(bq, client, manyOrigins(GA4_BQ_TRAFFIC_BATCH + 1), "2025-10-06", "2026-11-09", ids),
    ).rejects.toThrow("quota");
    expect(calls.map((c) => c.query.trim().split(/\s+/)[0])).toEqual(["CREATE", "INSERT", "DROP"]);
    expect(calls.some((c) => c.query.includes("BEGIN TRANSACTION"))).toBe(false);
  });

  it("janela curta (cabe num lote): uma consulta só (MERGE), sem tabela temporária nem transação", async () => {
    const { bq, calls } = fakeBigQuery();
    const written = await replaceGa4Traffic(bq, client, manyOrigins(150), "2026-11-07", "2026-11-09", ids);
    expect(written).toBe(150);
    expect(calls).toHaveLength(1);
    const [merge] = calls;
    expect(merge.query).toMatch(/^MERGE `up-vesti-report\.up_global\.ga4_traffic_daily` T/);
    expect(merge.query).toContain("T.channel_group = S.channel_group AND T.source = S.source");
    expect(merge.query).toContain("T.medium = S.medium AND T.campaign = S.campaign");
    expect(merge.query).toContain("WHEN NOT MATCHED BY SOURCE AND T.client_id = @client_id");
    expect(merge.query).toContain("THEN DELETE"); // a origem que o GA4 deixou de devolver sai, só dentro da janela e deste cliente
    expect(merge.query).not.toContain("BEGIN TRANSACTION");
    expect(merge.query).not.toContain("_stg_");
    expect((merge.params?.rows as unknown[]).length).toBe(150);
    expect(merge.params).toMatchObject({ client_id: "c1", from_date: "2026-11-07", to_date: "2026-11-09" });
  });

  it("no limite do lote ainda é uma consulta só; uma linha a mais passa pela tabela temporária", async () => {
    const exact = fakeBigQuery();
    expect(await replaceGa4Traffic(exact.bq, client, manyOrigins(GA4_BQ_TRAFFIC_BATCH), "2026-11-05", "2026-11-06", ids)).toBe(
      GA4_BQ_TRAFFIC_BATCH,
    );
    expect(exact.calls.map((c) => c.query.trim().split(/\s+/)[0])).toEqual(["MERGE"]);

    const over = fakeBigQuery();
    await replaceGa4Traffic(over.bq, client, manyOrigins(GA4_BQ_TRAFFIC_BATCH + 1), "2026-11-05", "2026-11-06", ids);
    expect(over.calls.map((c) => c.query.trim().split(/\s+/)[0])).toEqual(["CREATE", "INSERT", "INSERT", "BEGIN", "DROP"]);
  });

  it("janela curta: se o MERGE falhar o erro sobe e nada mais é chamado (uma instrução só, entra tudo ou nada)", async () => {
    const { bq, calls } = fakeBigQuery(() => new Error("cota"));
    await expect(replaceGa4Traffic(bq, client, manyOrigins(5), "2026-11-05", "2026-11-06", ids)).rejects.toThrow("cota");
    expect(calls).toHaveLength(1);
  });

  it("janela sem nenhuma sessão só limpa o que estava lá", async () => {
    const { bq, calls } = fakeBigQuery();
    expect(await replaceGa4Traffic(bq, client, [], "2026-11-06", "2026-11-09", ids)).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].query).toContain("DELETE FROM `up-vesti-report.up_global.ga4_traffic_daily`");
    expect(calls[0].params).toEqual({ client_id: "c1", from_date: "2026-11-06", to_date: "2026-11-09" });
  });

  it("não aceita nome de tabela temporária fora do padrão (nada de SQL montado com entrada solta)", () => {
    expect(() => buildSwapTrafficQuery("x`; DROP TABLE y; --", "c1", "2026-11-01", "2026-11-06")).toThrow();
    expect(() => buildSwapTrafficQuery("ga4_product_views_stg_abc12345", "c1", "2026-11-01", "2026-11-06")).toThrow();
  });
});
