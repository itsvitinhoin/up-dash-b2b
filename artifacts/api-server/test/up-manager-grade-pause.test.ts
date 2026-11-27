import { expect, it } from "vitest";
import { analyzeProductCampaigns, type CampaignAd, type CatalogProduct } from "../src/services/product-campaign-analysis";
import { gradeAdLinks, verifiedGradePause } from "../src/services/up-manager-grade";

const domain = "aiyu.example";
const product: CatalogProduct = {
  id: 123, name: "Conjunto Helena", handle: "conjunto-helena", published: true,
  attributes: ["Cor", "Tamanho"],
  variants: [
    { id: 8, stock: 0, values: ["Marinho", "P"] },
    { id: 9, stock: 12, values: ["Marinho", "M"] },
    { id: 10, stock: 4, values: ["Fendi", "P"] },
  ],
};
const ad: CampaignAd = {
  id: "511", name: "Criativo Helena", campaignName: "Vendas", adsetName: "Público",
  effectiveStatus: "ACTIVE", urls: [`https://${domain}/produtos/conjunto-helena/`],
  catalog: false, imageUrl: null, spend: null, impressions: null,
};

it("mantém uma linha por anúncio vinculado mesmo quando o produto tem várias cores", () => {
  const links = gradeAdLinks(analyzeProductCampaigns([ad], [product], [domain]));
  expect(links.get("123")).toEqual([{
    adId: "511", adName: "Criativo Helena", campaignName: "Vendas", adsetName: "Público", affected: true,
  }]);
});

it("revalida destino, status e quebra parcial antes da pausa", () => {
  expect(verifiedGradePause(ad, product, [domain])).toEqual({ outOfStock: 1 });
  expect(verifiedGradePause({ ...ad, effectiveStatus: "PAUSED" }, product, [domain])).toBeNull();
  expect(verifiedGradePause({ ...ad, urls: ["https://outra-loja.example/produtos/conjunto-helena/"] }, product, [domain])).toBeNull();
  expect(verifiedGradePause(ad, { ...product, variants: product.variants?.map((item) => ({ ...item, stock: 10 })) }, [domain])).toBeNull();
});
