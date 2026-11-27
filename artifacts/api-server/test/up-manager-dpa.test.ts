import { parsePublicProductStock } from "../src/services/up-manager-public-assortment";
import { afterEach, describe, expect, it, vi } from "vitest";
import { criticalGradeAdDecisions, verifiedCriticalGradePause } from "../src/services/up-manager-grade";
import { buildDpaInventory, planDpaProducts, planDpaRemoval, removeManagerDpaProduct, syncManagerDpaSet, type CatalogItem } from "../src/services/up-manager-dpa";
import { analyzeProductCampaigns, type CampaignAd, type CatalogProduct } from "../src/services/product-campaign-analysis";
import type { ManagerClient } from "../src/services/up-manager";
import type { B2cFinding } from "../src/services/up-manager-b2c";

vi.mock("../src/services/up-manager", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/services/up-manager")>(),
  managerMetaToken: () => "fixture-only",
}));
const { saved, updated } = vi.hoisted(() => ({ saved: vi.fn(), updated: vi.fn() }));
vi.mock("@workspace/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@workspace/db")>(),
  pool: { connect: async () => ({ query: async () => ({ rows: [{ held: true }] }), release: vi.fn() }) },
  db: { insert: () => ({ values: saved }), update: () => ({ set: (value: unknown) => ({ where: () => updated(value) }) }) },
}));
vi.mock("../src/services/product-campaign-sources", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/services/product-campaign-sources")>(),
  fetchManagerCatalogProduct: vi.fn(),
  fetchManagerStoreDomains: vi.fn(),
}));
import { fetchManagerCatalogProduct, fetchManagerStoreDomains } from "../src/services/product-campaign-sources";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const domains = ["loja.example"];
const product = (id: number, stock: (number | null)[]): CatalogProduct => ({
  id, name: id === 1 ? "Helena Azul Bebê" : `Produto ${id}`, handle: `produto-${id}`, published: true,
  variants: stock.map((value, index) => ({ id: id * 10 + index, stock: value, values: [["P", "M", "G"][index]] })),
});
const store = (...products: CatalogProduct[]) => ({ products, domains, observedAt: new Date().toISOString() });
const items = (data: CatalogProduct): CatalogItem[] => (data.variants ?? []).map(variant => ({
  retailer_id: String(variant.id), retailer_product_group_id: String(data.id),
  availability: (variant.stock ?? 0) > 0 ? "in stock" : "out of stock",
  url: `https://loja.example/produtos/${data.handle}/?variant=${variant.id}`,
}));
const ad: CampaignAd = { id: "101", name: "Anúncio Helena", campaignName: "Compra", adsetName: "Compradores",
  effectiveStatus: "ACTIVE", catalog: false, imageUrl: null, spend: 50, impressions: 640,
  urls: ["https://loja.example/produtos/produto-1/"],
};

describe("quebra crítica em anúncio de produto", () => {
  it("recomenda desativar o anúncio com P e M zerados e só G disponível", () => {
    const entry = product(1, [0, 0, 9]);
    const snapshot = analyzeProductCampaigns([ad], [entry], domains);
    const finding = { priority: "P1", grade: { productId: "1", ads: [{ adId: ad.id }] } } as B2cFinding;
    const decisions = criticalGradeAdDecisions(store(entry), snapshot, [finding]);
    expect(decisions.get(ad.id)?.evidence).toContain("P, M");
    expect(decisions.get(ad.id)?.action).toContain("Desativar");
    expect(finding.priority).toBe("P0");
  });
  it("revalida a grade, o vínculo exclusivo e o tipo do anúncio antes da pausa", () => {
    expect(verifiedCriticalGradePause(ad, product(1, [0, 0, 9]), domains)?.remaining).toEqual({ stock: 9, label: "G" });
    expect(verifiedCriticalGradePause(ad, product(1, [0, 1, 9]), domains)).toBeNull();
    expect(verifiedCriticalGradePause(ad, product(1, [0, null, 9]), domains)).toBeNull();
    expect(verifiedCriticalGradePause({ ...ad, catalog: true }, product(1, [0, 0, 9]), domains)).toBeNull();
    expect(verifiedCriticalGradePause({ ...ad, urls: [...ad.urls, "https://loja.example/categoria/"] },
      product(1, [0, 0, 9]), domains)).toBeNull();
  });
});

describe("conjunto DPA", () => {
  it("retira a grade com saldo zero, adiciona grade completa e preserva saldo desconhecido", () => {
    const [broken, complete, unknown] = [product(1, [0, 0, 9]), product(2, [1, 2, 3]), product(3, [1, null, 2])];
    const plan = planDpaProducts(store(broken, complete, unknown), [broken, complete, unknown].flatMap(items),
      [...items(broken), items(unknown)[0]]);
    expect(plan.ids).toEqual(["20", "21", "22", "30"]);
    expect(plan.additions).toEqual([{ product: "Produto 2", variants: 3, reason: "Grade completa e publicada" }]);
    expect(plan.exclusions).toEqual([{ product: "Helena Azul Bebê", variants: 3, reason: "Grade quebrada" }]);
  });
  it("aguarda o feed concluir a publicação de todas as variantes de um produto novo", () => {
    const complete = product(2, [1, 2, 3]);
    expect(planDpaProducts(store(complete), items(complete).slice(0, 2), []).ids).toEqual([]);
    expect(planDpaProducts(store(complete), items(complete), []).ids).toEqual(["20", "21", "22"]);
  });
  it("valida a seleção no catálogo e escreve somente o conjunto novo identificado pelo Manager", async () => {
    vi.stubEnv("UP_MANAGER_DPA_CATALOGS", '{"brand":{"catalogId":"99","mode":"live"}}');
    const complete = product(2, [1, 2, 3]);
    const catalog = items(complete);
    const fetchGraph = vi.fn(async (url: URL, options: RequestInit) => {
      if (options.method === "POST") {
        expect(url.pathname).toBe("/v24.0/99/product_sets");
        expect(String(options.body)).toContain("retailer_id=up-manager-dpa-brand");
        return Response.json({ id: "555" });
      }
      if (url.pathname.endsWith("/product_sets")) return Response.json({ data: [{ id: "777", name: "Verão" }] });
      return Response.json({ data: catalog });
    });
    vi.stubGlobal("fetch", fetchGraph);
    const result = await syncManagerDpaSet({ id: "brand" } as ManagerClient, store(complete));
    expect(result).toMatchObject({ status: "applied", setId: "555", eligible: 3 });
    expect(fetchGraph.mock.calls.filter(([, opts]) => opts.method === "POST")).toHaveLength(1);
  });
  it("uma divergência entre prévia e filtro da Meta impede a escrita", async () => {
    vi.stubEnv("UP_MANAGER_DPA_CATALOGS", '{"brand":{"catalogId":"99","mode":"live"}}');
    const complete = product(2, [1, 2, 3]);
    const graph = vi.fn(async (url: URL, options: RequestInit) => {
      expect(options.method).toBe("GET");
      return Response.json({ data: url.pathname.endsWith("/product_sets") ? [] : url.searchParams.has("filter") ? [items(complete)[0]] : items(complete) });
    });
    vi.stubGlobal("fetch", graph);
    expect(await syncManagerDpaSet({ id: "brand" } as ManagerClient, store(complete))).toMatchObject({ status: "blocked" });
  });
});


describe("inventário do catálogo DPA", () => {
  it("inclui todos os itens Meta, soma o GA4 por produto e mantém saldo zero da loja", () => {
    const productWithGrade = { ...product(1, [0, 0, 9]), attributes: ["Tamanho"] };
    const catalog = items(productWithGrade);
    const noMatch = { retailer_id: "999", retailer_product_group_id: "2", size: "M", name: "Apenas Meta" };
    const views = [
      { itemId: "1", itemName: null, itemVariant: null, views: 7 },
      { itemId: "12", itemName: null, itemVariant: null, views: 5 },
      { itemId: "999", itemName: null, itemVariant: null, views: 3 },
    ];
    expect(buildDpaInventory([...catalog, noMatch], new Set(["12"]), store(productWithGrade), views)).toEqual([
      expect.objectContaining({ id: "1", views: 12, variants: [
        expect.objectContaining({ size: "P", stock: 0, inSet: false }),
        expect.objectContaining({ size: "M", stock: 0, inSet: false }),
        expect.objectContaining({ size: "G", stock: 9, inSet: true }),
      ] }),
      expect.objectContaining({ name: "Apenas Meta", views: 3, variants: [
        expect.objectContaining({ size: "M", stock: null, inSet: false }),
      ] }),
    ]);
  });

  it("preserva produtos sem visualizações vinculadas e distingue conjunto indisponível", () => {
    const data = product(1, [null, 1, 2]);
    expect(buildDpaInventory(items(data), null, store(data), []).at(0)).toMatchObject({
      id: "1", views: null,
      variants: [expect.objectContaining({ stock: null, inSet: null }),
        expect.objectContaining({ stock: 1 }), expect.objectContaining({ stock: 2 })],
    });
  });
});

describe("retirada manual por quebra de grade", () => {
  it("retira todas as variantes do produto com apenas uma falta e conserva os demais produtos", () => {
    const [partial, complete] = [product(1, [2, 0, 9]), product(2, [1, 2, 3])];
    const current = [...items(partial), ...items(complete)];
    expect(planDpaRemoval(current, store(partial, complete), "1")).toMatchObject({
      removed: ["10", "11", "12"], remaining: ["20", "21", "22"], product: { outOfStock: ["M"] },
    });
    expect(planDpaRemoval(current, store(product(1, [2, 1, 9]), complete), "1")).toBeNull();
    expect(planDpaRemoval(current, store(product(1, [2, null, 9]), complete), "1")).toBeNull();
    expect(planDpaProducts(store(product(1, [null, 0, 9]), complete), current, current).ids)
      .toEqual(["20", "21", "22"]);
  });

  it("revalida estoque, confirma na Meta e registra apenas o conjunto dedicado", async () => {
    vi.stubEnv("UP_MANAGER_DPA_CATALOGS", '{"brand":{"catalogId":"99","manualRemoval":true}}');
    const broken = product(1, [0, 2, 9]);
    const keep = items(product(2, [1, 2, 3]));
    vi.mocked(fetchManagerCatalogProduct).mockResolvedValue(broken);
    vi.mocked(fetchManagerStoreDomains).mockResolvedValue(domains);
    let applied = false;
    vi.stubGlobal("fetch", vi.fn(async (url: URL, options: RequestInit) => {
      if (options.method === "POST") {
        expect(url.pathname).toBe("/v24.0/555");
        const filter = new URLSearchParams(String(options.body)).get("filter");
        expect(filter && JSON.parse(filter)).toEqual({ retailer_id: { is_any: ["20", "21", "22"] } });
        applied = true;
        return Response.json({ success: true });
      }
      if (url.pathname.endsWith("/product_sets")) return Response.json({ data: [
        { id: "555", name: "Grade completa", retailer_id: "up-manager-dpa-brand" },
        { id: "888", name: "Outro conjunto" },
      ] });
      if (url.pathname.endsWith("/99/products")) return Response.json({ data: keep });
      return Response.json({ data: applied ? keep : [...items(broken), ...keep] });
    }));
    const client = { id: "brand", accountId: "act_1", commercePlatform: "NUVEMSHOP", storeId: "9", storeToken: "test" } as ManagerClient;
    expect(await removeManagerDpaProduct(client, { productId: "1", setId: "888" }, "gestor")).toMatchObject({ status: "blocked" });
    expect(await removeManagerDpaProduct(client, { productId: "1", setId: "555" }, "gestor")).toMatchObject({ status: "applied", removed: 3 });
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({ status: "pending", evidence: expect.objectContaining({ outOfStock: ["P"] }) }));
    expect(updated).toHaveBeenCalledWith(expect.objectContaining({ status: "applied" }));
  });

  it("vincula o código do catálogo oficial Braavo pelo produto e SKU presentes na URL", () => {
    const data = { ...product(1, [0, 1, 2]), id: "braavo:5613" };
    const itemsFromMeta = [10, 11, 12].map(id => ({
      retailer_id: `hash-${id}`, retailer_product_group_id: `default-${id}`,
      url: `https://loja.example/prod/5613/helena#s${id}`,
    }));
    expect(planDpaRemoval(itemsFromMeta, store(data), "braavo:5613")).toMatchObject({ removed: ["hash-10", "hash-11", "hash-12"] });
    expect(planDpaRemoval(itemsFromMeta, { ...store(data), domains: ["outramarca.example"] }, "braavo:5613")).toBeNull();
  });
});

it("lê apenas o saldo explícito por SKU da página do produto Braavo", () => {
  const source = '<input data-produto-id="21" data-sku-id="55" data-quantidade="0">' +
    '<input data-quantidade="7" data-sku-id="56" data-produto-id="21">' +
    '<input data-produto-id="22" data-sku-id="55" data-quantidade="19">' +
    '<input data-produto-id="21" data-sku-id="77" data-quantidade="">';
  expect([...parsePublicProductStock(source, "21")!]).toEqual([["55", 0], ["56", 7]]);
  expect(parsePublicProductStock(source + '<input data-produto-id="21" data-sku-id="55" data-quantidade="6">', "21")).toBeNull();
});
