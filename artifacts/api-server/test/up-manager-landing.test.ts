import { expect, it } from "vitest";
import { indexLandingEvidence, instrumentedLandingPages, landingEvidenceFor } from "../src/services/up-manager-landing";
import type { CampaignAd, CatalogProduct } from "../src/services/product-campaign-analysis";
import type { PaidMediaRow } from "../src/services/up-manager-paid-media";
import type { CampaignSnapshot } from "../src/services/product-campaign-monitor";
import { parsePublicAssortment, readProductCardIds } from "../src/services/up-manager-public-assortment";

const ad: CampaignAd = { id: "7", name: "Criativo", campaignId: "10", campaignName: "Varejo", adsetName: "Frio",
  effectiveStatus: "ACTIVE", urls: [], catalog: true, imageUrl: null, spend: 30, impressions: 200 };
const products: CatalogProduct[] = [
  { id: 1, name: "Saia A", handle: "saia-a", published: true, categories: [{ id: 4 }], variants: [{ id: 90, stock: 0 }] },
  { id: 2, name: "Saia B", handle: "saia-b", published: true, categories: [5], variants: [{ id: 91, stock: 5 }] },
  { id: 3, name: "Saia oculta", handle: "saia-c", published: false, categories: [4], variants: [{ id: 91, stock: 0 }] },
];

it("mede tráfego e grade da categoria confirmada, incluindo subcategorias e excluindo produtos ocultos", () => {
  const page = { host: "loja.example", path: "/saias", urls: ["https://loja.example/saias"], ads: [ad] };
  const categories = [{ id: 4, handle: "saias", name: "Saias" }, { id: 5, handle: "midi", name: "Midi", parent: 4 }];
  const snapshot = products.map((product) => ({ key: `${product.id}:91`, productId: String(product.id), name: String(product.name),
    options: "P", size: "P", published: product.published!, stock: Number(product.variants![0].stock), listedPrice: 100, promotion: null }));
  const traffic = { host: "www.loja.example", path: "/saias/", campaign: "10", device: "mobile", sessions: 100,
    engaged: 40, purchases: 3, engagementSeconds: 600 };
  const pages = indexLandingEvidence([page], { products: null, traffic: [{ ...traffic, period: "previous" },
    { ...traffic, period: "current", engaged: 30, purchases: 1 }] }, { products, domains: ["loja.example"] }, categories,
    snapshot, snapshot.map((item) => ({ ...item, stock: 7 })));
  const [result] = landingEvidenceFor({ id: "10", level: "campaign" } as PaidMediaRow, pages);
  expect(result).toMatchObject({ source: "categoria", products: 2, soldOut: 1, unknown: 0,
    affected: [{ name: "Saia A", recentlyBroken: 1 }], campaign: { previous: { bounce: 0.6, purchaseRate: 0.03 }, current: { bounce: 0.7, purchaseRate: 0.01 } } });
});

it("mantém páginas atribuídas pelo GA4 no nível de campanha quando o anúncio de catálogo não fornece URL", () => {
  const snapshot = { unidentified: [{ ad, reason: "Catálogo" }] } as CampaignSnapshot;
  const data = { products: null, traffic: [{ host: "loja.example", path: "/saias", campaign: "10", device: "mobile", period: "current" as const,
    sessions: 100, engaged: 40, purchases: 3, engagementSeconds: 600 }] };
  const pages = indexLandingEvidence(instrumentedLandingPages([], data, snapshot), data, null, [], null, null);
  expect(landingEvidenceFor({ id: "10", level: "campaign" } as PaidMediaRow, pages)).toMatchObject([{ derived: true, path: "/saias" }]);
  expect(landingEvidenceFor({ id: "7", level: "ad" } as PaidMediaRow, pages)).toEqual([]);
});

it("confirma produto e categoria do Braavo por ID, slug e host observado no GA4", () => {
  const product: CatalogProduct = { id: "braavo:3625", name: "Vestido de Festa Preto", categories: ["70"], published: true, variants: [{ id: 91, stock: 0 }] };
  const paths = ["/prod/3625/vestido-de-festa-preto", "/cat/70/black-ate-75-off", "/prod/3625/outro-produto"];
  const pages = paths.map((path) => ({ host: "loja.example", path, urls: [`https://loja.example${path}`], ads: [ad] }));
  const stock = [{ key: "braavo:3625:91", productId: "braavo:3625", name: "Vestido de Festa Preto", options: "M", size: "M",
    published: true, stock: 0, listedPrice: 100, promotion: null }];
  const data = { products: null, traffic: paths.map((path) => ({ host: "loja.example", path, campaign: "10", device: "mobile", period: "current" as const,
    sessions: 100, engaged: 40, purchases: 3, engagementSeconds: 600 })) };
  const category = { id: "70", handle: "BLACK ATÉ 75% OFF", name: "BLACK ATÉ 75% OFF" };
  const indexed = indexLandingEvidence(pages, data, { products: [product], domains: [] }, [category], stock, null);
  const evidence = landingEvidenceFor({ id: "10", level: "campaign" } as PaidMediaRow, indexed);
  expect(evidence.map(({ source, products, soldOut }) => ({ source, products, soldOut }))).toEqual([
    { source: "produto", products: 1, soldOut: 1 }, { source: "categoria", products: 1, soldOut: 1 }, { source: "página", products: 0, soldOut: 0 },
  ]);
});

it("lê apenas IDs das fichas de produto do mesmo site, deduplicando repetições", () => {
  const html = `<a href="/prod/8/bolsa" class="ev-listagem-prod-link">Produto</a>
    <a class="ev-listagem-prod-link" href="/prod/8/bolsa">Repetido</a>
    <a href="/prod/9/cinto">Menu</a>
    <a href="https://example.org/prod/10/anel" class="ev-listagem-prod-link">Outro site</a>`;
  expect(readProductCardIds(html, "https://loja.example")).toEqual(["8"]);
});

it("registra zeros explícitos das variantes publicadas sem presumir saldo de outras variantes", () => {
  const html = `<li class="js-produto-card" data-skus="[{&quot;id&quot;:22,&quot;estoque&quot;:0},{&quot;id&quot;:23,&quot;estoque&quot;:6}]">
    <a href="/prod/8/bolsa" class="ev-listagem-prod-link">Produto</a></li>`;
  expect(parsePublicAssortment(html, "https://loja.example").stock.get("8")).toEqual([{ sku: "22", units: 0 }, { sku: "23", units: 6 }]);
});
