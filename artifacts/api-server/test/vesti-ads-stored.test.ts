import { describe, expect, it, vi } from "vitest";
import {
  ctrOf,
  fetchStoredAds,
  fetchStoredAdsDaily,
  fetchStoredCampaigns,
  spendSeries,
  storedAccountId,
  toMetaAdMetric,
  toNumber,
  topCreativesFromStored,
  totalSpend,
  type StoredAd,
  type StoredAdsQuery,
} from "../src/services/vesti-ads-stored";

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

describe("fetchStoredCampaigns", () => {
  const rows = [
    { id: "c1", name: "Campanha A", status: "ACTIVE", null_spend_rows: 0, spend: 300.5, impressions: 10000, clicks: 200, leads: 4, purchases: 3, revenue: 900 },
    { id: "c2", name: null, status: null, null_spend_rows: 0, spend: { toString: () => "10.25" }, impressions: "500", clicks: null, leads: undefined, purchases: 0, revenue: null },
    { id: "", name: "sem id", null_spend_rows: 0, spend: 1 },
  ];

  it("consulta só a conta e o período pedidos, com parâmetros (nunca texto colado no SQL)", async () => {
    const query = vi.fn<StoredAdsQuery>(async () => rows);
    await fetchStoredCampaigns("123", "2026-10-01", "2026-10-18", query);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual({ adAccountId: "act_123", dateFrom: "2026-10-01", dateTo: "2026-10-18" });
    expect(sql).toContain("data_ads_global");
    expect(sql).toContain("ads_insights");
    expect(sql).toContain("ads_campaigns");
    expect(sql).toContain("ad_account_id = @adAccountId");
    expect(sql).toContain("date_start BETWEEN @dateFrom AND @dateTo");
    expect(sql).toContain("QUALIFY ROW_NUMBER() OVER (PARTITION BY campaign_id ORDER BY last_updated DESC) = 1");
    expect(sql).not.toContain("act_123");
  });

  it("converte em números, usa nome padrão quando falta e descarta linha sem id", async () => {
    const campaigns = await fetchStoredCampaigns("act_1", "2026-10-01", "2026-10-18", async () => rows);
    expect(campaigns).toEqual([
      { id: "c1", name: "Campanha A", status: "ACTIVE", spend: 300.5, impressions: 10000, clicks: 200, leads: 4, purchases: 3, revenue: 900 },
      { id: "c2", name: "Campanha c2", status: null, spend: 10.25, impressions: 500, clicks: 0, leads: 0, purchases: 0, revenue: 0 },
    ]);
  });

  it("sem conta cadastrada: não consulta o BigQuery", async () => {
    const query = vi.fn<StoredAdsQuery>(async () => rows);
    expect(await fetchStoredCampaigns("  ", "2026-10-01", "2026-10-18", query)).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("linha sem valor de gasto = leitura incompleta (sobe como erro, não vira zero)", async () => {
    await expect(
      fetchStoredCampaigns("act_1", "2026-10-01", "2026-10-18", async () => [{ id: "c1", null_spend_rows: 2, spend: 0 }]),
    ).rejects.toThrow("incompleta");
  });

  it("período sem dado: lista vazia; erro do BigQuery sobe", async () => {
    expect(await fetchStoredCampaigns("act_1", "2026-10-01", "2026-10-18", async () => [])).toEqual([]);
    await expect(
      fetchStoredCampaigns("act_1", "2026-10-01", "2026-10-18", async () => {
        throw new Error("quota");
      }),
    ).rejects.toThrow("quota");
  });
});

describe("fetchStoredAds", () => {
  it("em ads_details o id da conta é sem act_: envia as duas formas e compara sem o prefixo", async () => {
    const query = vi.fn<StoredAdsQuery>(async () => []);
    await fetchStoredAds("act_1020729182224194", "2026-10-01", "2026-10-18", query);
    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual({ adAccountId: "act_1020729182224194", adAccountIdBare: "1020729182224194", dateFrom: "2026-10-01", dateTo: "2026-10-18" });
    expect(sql).toContain("ads_details");
    expect(sql).toContain("REGEXP_REPLACE(ad_account_id, r'^act_', '') = @adAccountIdBare");
    expect(sql).toContain("QUALIFY ROW_NUMBER() OVER (PARTITION BY ad_id ORDER BY last_updated DESC) = 1");
    expect(sql).not.toContain("1020729182224194");
  });

  it("nome: detalhe do anúncio, depois nome da campanha, depois texto padrão; imagem vazia vira nulo", async () => {
    const ads = await fetchStoredAds("act_1", "2026-10-01", "2026-10-18", async () => [
      { id: "a1", name: "Anúncio 1", campaign_name: "Camp", status: "PAUSED", thumbnail_url: "https://img/1.jpg", null_spend_rows: 0, spend: 50, impressions: 1000, clicks: 20, leads: 2, purchases: 1, revenue: 120 },
      { id: "a2", name: null, campaign_name: "Camp B", status: null, thumbnail_url: "", null_spend_rows: 0, spend: 5, impressions: 100, clicks: 1, leads: 0, purchases: 0, revenue: 0 },
      { id: "a3", name: null, campaign_name: null, status: null, thumbnail_url: null, null_spend_rows: 0, spend: 1 },
    ]);
    expect(ads.map((a) => [a.id, a.name, a.status, a.thumbnailUrl])).toEqual([
      ["a1", "Anúncio 1", "PAUSED", "https://img/1.jpg"],
      ["a2", "Camp B", null, null],
      ["a3", "Anúncio a3", null, null],
    ]);
  });

  it("sem conta: não consulta; linha sem valor de gasto: erro", async () => {
    const query = vi.fn<StoredAdsQuery>(async () => []);
    expect(await fetchStoredAds("", "2026-10-01", "2026-10-18", query)).toEqual([]);
    expect(query).not.toHaveBeenCalled();
    await expect(fetchStoredAds("act_1", "2026-10-01", "2026-10-18", async () => [{ id: "a1", null_spend_rows: 1 }])).rejects.toThrow("incompleta");
  });
});

describe("toMetaAdMetric / ctrOf", () => {
  const base = { id: "a1", name: "A", status: "ACTIVE", spend: 100, impressions: 2000, clicks: 50, leads: 4, purchases: 2, revenue: 300 };
  it("calcula ROAS, custo por lead e por compra; zero vira nulo (não infinito)", () => {
    expect(toMetaAdMetric(base, "2026-10-01", "2026-10-18")).toEqual({
      ...base,
      roas: 3,
      cpl: 25,
      cpa: 50,
      dateStart: "2026-10-01",
      dateStop: "2026-10-18",
    });
    const empty = toMetaAdMetric({ ...base, spend: 0, leads: 0, purchases: 0, revenue: 0 }, "a", "b");
    expect([empty.roas, empty.cpl, empty.cpa]).toEqual([null, null, null]);
  });
  it("CTR em % e zero sem impressões", () => {
    expect(ctrOf(base)).toBeCloseTo(2.5, 10);
    expect(ctrOf({ clicks: 5, impressions: 0 })).toBe(0);
  });
});

describe("topCreativesFromStored", () => {
  const ad = (id: string, over: Partial<StoredAd> = {}): StoredAd => ({
    id,
    name: `Anúncio ${id}`,
    status: "ACTIVE",
    spend: 100,
    impressions: 1000,
    clicks: 10,
    leads: 0,
    purchases: 0,
    revenue: 0,
    thumbnailUrl: `https://img/${id}.jpg`,
    ...over,
  });

  it("CTR: maior primeiro, só com impressão e clique, no máximo 5", () => {
    const ads = [
      ...Array.from({ length: 7 }, (_, i) => ad(`c${i}`, { clicks: 10 + i })),
      ad("sem-clique", { clicks: 0 }),
      ad("sem-impressao", { impressions: 0, clicks: 5 }),
    ];
    const top = topCreativesFromStored(ads);
    expect(top.ctr.map((c) => c.id)).toEqual(["c6", "c5", "c4", "c3", "c2"]);
  });

  it("custo por lead: menor primeiro e só com lead; mais leads: maior primeiro", () => {
    const ads = [
      ad("barato", { leads: 10, spend: 50 }),
      ad("caro", { leads: 2, spend: 100 }),
      ad("medio", { leads: 5, spend: 100 }),
      ad("sem-lead", { leads: 0 }),
    ];
    const top = topCreativesFromStored(ads);
    expect(top.cpl.map((c) => c.id)).toEqual(["barato", "medio", "caro"]);
    expect(top.leads.map((c) => c.id)).toEqual(["barato", "medio", "caro"]);
  });

  it("monta o criativo com imagem da miniatura; sem miniatura o tipo é desconhecido; status ausente vira UNKNOWN", () => {
    const top = topCreativesFromStored([ad("a", { leads: 1 }), ad("b", { leads: 1, thumbnailUrl: null, status: null })]);
    const a = top.leads.find((c) => c.id === "a")!;
    const b = top.leads.find((c) => c.id === "b")!;
    expect(a).toMatchObject({ imageUrl: "https://img/a.jpg", thumbnailUrl: "https://img/a.jpg", mediaType: "image", videoUrl: null, previewUrl: null, ctr: 1, cpl: 100 });
    expect(b).toMatchObject({ imageUrl: null, mediaType: "unknown", status: "UNKNOWN" });
  });

  it("lista vazia: três listas vazias", () => {
    expect(topCreativesFromStored([])).toEqual({ ctr: [], cpl: [], leads: [] });
  });
});
