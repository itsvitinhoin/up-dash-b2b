import { describe, expect, it, vi } from "vitest";
import { fetchStoredAdsDaily, spendSeries, storedAccountId, toNumber, totalSpend, type StoredAdsQuery } from "../src/services/vesti-ads-stored";

// O módulo importa o cliente do BigQuery (sem credenciais no teste), mas só usa o `query` injetado: nada vai para a rede.

describe("toNumber", () => {
  it("aceita número, texto numérico e objeto estilo Big (NUMERIC do BigQuery)", () => {
    expect(toNumber(12.5)).toBe(12.5);
    expect(toNumber("7")).toBe(7);
    expect(toNumber({ toString: () => "1234.56" })).toBe(1234.56);
  });
  it("nulo, vazio, texto inválido e infinito viram 0", () => {
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber("abc")).toBe(0);
    expect(toNumber(Number.POSITIVE_INFINITY)).toBe(0);
    expect(toNumber({ toString: () => "NaN" })).toBe(0);
  });
});

describe("storedAccountId", () => {
  it("padroniza para act_ (formato gravado pela coleta)", () => {
    expect(storedAccountId("act_123")).toBe("act_123");
    expect(storedAccountId("123")).toBe("act_123");
    expect(storedAccountId("act=123")).toBe("act_123");
    expect(storedAccountId("  123 ")).toBe("act_123");
  });
  it("vazio ou nulo: sem conta", () => {
    expect(storedAccountId("")).toBeNull();
    expect(storedAccountId("   ")).toBeNull();
    expect(storedAccountId(null)).toBeNull();
    expect(storedAccountId(undefined)).toBeNull();
  });
});

describe("fetchStoredAdsDaily", () => {
  const rows = [
    { day: "2026-10-01", spend: 100.5, impressions: 1000, clicks: 40, leads: 3, purchases: 2, purchase_value: 800 },
    { day: "2026-10-02", spend: { toString: () => "50.25" }, impressions: "2000", clicks: null, leads: undefined, purchases: 0, purchase_value: null },
  ];

  it("consulta só a conta e o período pedidos, com parâmetros (nunca texto colado no SQL)", async () => {
    const query = vi.fn<StoredAdsQuery>(async () => rows);
    await fetchStoredAdsDaily("123", "2026-10-01", "2026-10-02", query);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual({ adAccountId: "act_123", dateFrom: "2026-10-01", dateTo: "2026-10-02" });
    expect(sql).toContain("data_ads_global");
    expect(sql).toContain("ads_insights_account");
    expect(sql).toContain("ad_account_id = @adAccountId");
    expect(sql).toContain("date_start BETWEEN @dateFrom AND @dateTo");
    expect(sql).not.toContain("act_123");
  });

  it("converte cada linha em números, com nulo virando 0", async () => {
    const days = await fetchStoredAdsDaily("act_1", "2026-10-01", "2026-10-02", async () => rows);
    expect(days).toEqual([
      { date: "2026-10-01", spend: 100.5, impressions: 1000, clicks: 40, leads: 3, purchases: 2, purchaseValue: 800 },
      { date: "2026-10-02", spend: 50.25, impressions: 2000, clicks: 0, leads: 0, purchases: 0, purchaseValue: 0 },
    ]);
  });

  it("descarta linha sem data válida", async () => {
    const days = await fetchStoredAdsDaily("act_1", "2026-10-01", "2026-10-02", async () => [{ day: "", spend: 5 }, { day: "lixo", spend: 6 }, { day: "2026-10-01", spend: 7 }]);
    expect(days.map((d) => d.date)).toEqual(["2026-10-01"]);
  });

  it("sem conta cadastrada: não consulta o BigQuery", async () => {
    const query = vi.fn<StoredAdsQuery>(async () => rows);
    expect(await fetchStoredAdsDaily("", "2026-10-01", "2026-10-02", query)).toEqual([]);
    expect(await fetchStoredAdsDaily("   ", "2026-10-01", "2026-10-02", query)).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("período sem dado coletado: lista vazia", async () => {
    expect(await fetchStoredAdsDaily("act_1", "2026-10-01", "2026-10-02", async () => [])).toEqual([]);
  });

  it("linha guardada sem valor de gasto: leitura incompleta sobe como erro (não vira zero)", async () => {
    await expect(
      fetchStoredAdsDaily("act_1", "2026-10-01", "2026-10-02", async () => [{ day: "2026-10-01", spend: 0, null_spend_rows: 1 }]),
    ).rejects.toThrow("incompleta");
    const days = await fetchStoredAdsDaily("act_1", "2026-10-01", "2026-10-02", async () => [{ day: "2026-10-01", spend: 7, null_spend_rows: 0 }]);
    expect(days[0]?.spend).toBe(7);
  });

  it("erro do BigQuery sobe (quem chama decide o que mostrar)", async () => {
    await expect(fetchStoredAdsDaily("act_1", "2026-10-01", "2026-10-02", async () => { throw new Error("quota"); })).rejects.toThrow("quota");
  });
});

describe("totalSpend / spendSeries", () => {
  const days = [
    { date: "2026-10-01", spend: 10.1, impressions: 0, clicks: 0, leads: 0, purchases: 0, purchaseValue: 0 },
    { date: "2026-10-02", spend: 20.2, impressions: 0, clicks: 0, leads: 0, purchases: 0, purchaseValue: 0 },
  ];
  it("soma o gasto e monta a série por dia", () => {
    expect(totalSpend(days)).toBeCloseTo(30.3, 10);
    expect(spendSeries(days)).toEqual([{ date: "2026-10-01", value: 10.1 }, { date: "2026-10-02", value: 20.2 }]);
  });
  it("vazio: zero e série vazia", () => {
    expect(totalSpend([])).toBe(0);
    expect(spendSeries([])).toEqual([]);
  });
});
