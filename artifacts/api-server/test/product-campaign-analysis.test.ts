import { describe, expect, it } from "vitest";
import {
  analyzeProductCampaigns,
  classifyGrade,
  matchProductUrl,
  variantStock,
  type CampaignAd,
  type CatalogProduct,
} from "../src/services/product-campaign-analysis";
import { productCampaignRecommendations } from "../src/services/product-campaign-recommendations";

const product: CatalogProduct = {
  id: 10,
  name: { pt: "Camisa Helena" },
  handle: { pt: "camisa-helena" },
  attributes: [{ pt: "Tamanho" }, { pt: "Cor" }],
  variants: [
    {
      id: 1,
      stock: 0,
      stock_management: true,
      values: [{ pt: "P" }, { pt: "Azul" }],
    },
    {
      id: 2,
      stock: 4,
      stock_management: true,
      values: [{ pt: "M" }, { pt: "Azul" }],
    },
    {
      id: 3,
      stock: 8,
      stock_management: true,
      values: [{ pt: "P" }, { pt: "Preto" }],
    },
  ],
};
const ad: CampaignAd = {
  id: "123",
  name: "Criativo sem SKU no nome",
  campaignName: "Campanha",
  adsetName: "Conjunto",
  effectiveStatus: "ACTIVE",
  urls: ["https://www.loja.com.br/produtos/camisa-helena/?utm_source=facebook"],
  imageUrl: null,
  catalog: false,
  spend: 25,
  impressions: 100,
};

describe("automatic product matching", () => {
  it("never matches two invalid domain values", () => {
    expect(
      matchProductUrl(
        "https://evil.com:8080/produtos/camisa-helena",
        ["loja.com.br:8080"],
        [product],
      ),
    ).toBeNull();
  });
  it("matches store aliases and strips tracking without requiring naming conventions", () => {
    const result = matchProductUrl(ad.urls[0], ["loja.com.br"], [product]);
    expect(result?.product.id).toBe(10);
    expect(result?.productUrl).toBe(
      "https://www.loja.com.br/produtos/camisa-helena/",
    );
  });
  it.each([
    "https://evil.com/produtos/camisa-helena",
    "https://loja.com.br.evil.com/produtos/camisa-helena",
    "https://loja.com.br/colecoes/camisa-helena",
    "javascript:alert(1)",
    "https://loja.com.br/produtos/%ZZ",
    "https://user:secret@loja.com.br/produtos/camisa-helena",
    "https://loja.com.br:8080/produtos/camisa-helena",
  ])("rejects unsafe or non-product URL %s", (url) => {
    expect(matchProductUrl(url, ["loja.com.br"], [product])).toBeNull();
  });
  it("rejects duplicate handles and nonexistent variant selectors", () => {
    expect(
      matchProductUrl(
        ad.urls[0],
        ["loja.com.br"],
        [product, { ...product, id: 20 }],
      ),
    ).toBeNull();
    expect(
      matchProductUrl(
        "https://loja.com.br/produtos/camisa-helena?variant=999",
        ["loja.com.br"],
        [product],
      ),
    ).toBeNull();
  });
  it("evaluates every color separately and does not infer creative color from the name", () => {
    const result = analyzeProductCampaigns([ad], [product], ["loja.com.br"]);
    expect(result.rows.map((row) => [row.color, row.grade])).toEqual([
      ["Azul", "broken"],
      ["Preto", "complete"],
    ]);
    expect(result.rows[0].missingVariants).toEqual(["P / Azul"]);
    expect(result.rows[0].scope).toBe("destination_product");
  });
  it("uses a verified variant URL to scope the color, including its other sizes", () => {
    const result = analyzeProductCampaigns(
      [
        {
          ...ad,
          urls: ["https://loja.com.br/produtos/camisa-helena?variant=1"],
        },
      ],
      [product],
      ["loja.com.br"],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      color: "Azul",
      grade: "broken",
      variantCount: 2,
      scope: "selected_color",
    });
  });
  it("does not double count spend across products, colors, duplicate URLs or duplicate ads", () => {
    const second = { ...product, id: 20, handle: "segunda-peca" };
    const multi = {
      ...ad,
      urls: [
        ...ad.urls,
        ...ad.urls,
        "https://loja.com.br/produtos/segunda-peca",
      ],
    };
    const result = analyzeProductCampaigns(
      [multi, multi],
      [product, second],
      ["loja.com.br"],
    );
    expect(result.rows).toHaveLength(4);
    expect(result.totalAds).toBe(1);
    expect(result.identifiedAds).toBe(1);
    expect(result.riskSpend).toBe(25);
    expect(result.rows.every((row) => row.ads.length === 1)).toBe(true);
  });
  it("retains incomplete carousel coverage and leaves dynamic catalogs unidentified", () => {
    const result = analyzeProductCampaigns(
      [
        { ...ad, urls: [...ad.urls, "https://loja.com.br/"] },
        { ...ad, id: "456", catalog: true },
      ],
      [product],
      ["loja.com.br"],
    );
    expect(result.identifiedAds).toBe(1);
    expect(result.unidentified).toHaveLength(2);
    expect(result.rows[0].ads).toHaveLength(1);
  });
  it("excludes paused ads and treats missing spend as unknown", () => {
    expect(
      analyzeProductCampaigns(
        [{ ...ad, effectiveStatus: "PAUSED" }],
        [product],
        ["loja.com.br"],
      ).rows,
    ).toEqual([]);
    expect(
      analyzeProductCampaigns(
        [{ ...ad, spend: null }],
        [product],
        ["loja.com.br"],
      ).riskSpend,
    ).toBeNull();
  });
});

describe("stock and grade", () => {
  it.each([
    {},
    { stock: null },
    { stock: "" },
    { stock: "invalid" },
    { stock: 0, stock_management: false },
  ])("does not interpret missing/unmanaged stock as sold out", (fields) => {
    expect(variantStock({ id: 1, ...fields })).toBeNull();
    expect(classifyGrade([{ id: 1, ...fields }])).toBe("unknown");
  });
  it("distinguishes complete, broken, exhausted and incomplete inventories", () => {
    expect(classifyGrade([])).toBe("unknown");
    expect(classifyGrade([{ id: 1, stock: "4" }])).toBe("complete");
    expect(
      classifyGrade([
        { id: 1, stock: -1 },
        { id: 2, stock: 0 },
      ]),
    ).toBe("out_of_stock");
    expect(
      classifyGrade([
        { id: 1, stock: 0 },
        { id: 2, stock: null },
      ]),
    ).toBe("unknown");
  });
});

describe("pause recommendation pilot", () => {
  const soldOut = {
    ...product,
    variants: product.variants!.map((variant) => ({ ...variant, stock: 0 })),
  };
  const reviewableAd = { ...ad, reviewableDestination: true };
  const meta = {
    version: 1 as const,
    accountId: "act_1",
    storeId: "12",
    adsObservedAt: "2026-11-23T09:00:00Z",
    stockObservedAt: "2026-11-23T09:01:00Z",
    window: { since: "2026-11-16", until: "2026-11-22" },
    currency: "BRL",
    timeZone: "America/Sao_Paulo",
    warnings: [],
  };

  it("proposes a single review per delivered ad with a confirmed sold-out destination", () => {
    const snapshot = {
      ...analyzeProductCampaigns([reviewableAd], [soldOut], ["loja.com.br"]),
      ...meta,
    };
    const result = productCampaignRecommendations(snapshot);
    expect(result).toHaveLength(1);
    expect(result[0].evidence).toMatchObject({
      adId: ad.id,
      productName: "Camisa Helena",
      impressions: 100,
      spend: 25,
      window: meta.window,
    });
    expect(productCampaignRecommendations(snapshot)[0].id).toBe(result[0].id);
    expect(
      productCampaignRecommendations({
        ...snapshot,
        stockObservedAt: "2026-11-24T09:01:00Z",
      })[0].id,
    ).not.toBe(result[0].id);
  });

  it("leaves partial stock, incomplete links, ambiguous creatives and unverified delivery to the monitor", () => {
    const candidates = [
      {
        ...reviewableAd,
        id: "1",
        urls: [...ad.urls, "https://www.loja.com.br/colecoes"],
      },
      { ...reviewableAd, id: "2", impressions: 0 },
      { ...reviewableAd, id: "3", impressions: null },
      { ...reviewableAd, id: "4", reviewableDestination: false },
      {
        ...reviewableAd,
        id: "5",
        urls: ["https://www.loja.com.br/produtos/segunda-peca"],
      },
    ];
    const second = { ...product, id: 20, handle: "segunda-peca" };
    const analysis = analyzeProductCampaigns(
      candidates,
      [soldOut, second],
      ["loja.com.br"],
    );
    expect(productCampaignRecommendations({ ...analysis, ...meta })).toEqual(
      [],
    );
  });
});
