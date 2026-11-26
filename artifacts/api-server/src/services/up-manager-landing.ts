import { localized, matchProductUrl, safeUrl, type CampaignAd, type CatalogCategory, type CatalogProduct } from "./product-campaign-analysis";
import type { CampaignSnapshot } from "./product-campaign-monitor";
import type { fetchGa4LandingEvidence } from "./ga4";
import type { CatalogSnapshot } from "./up-manager-b2c-products";
import type { PaidMediaRow } from "./up-manager-paid-media";
import type { PublicAssortment } from "./up-manager-public-assortment";

type Analytics = NonNullable<Awaited<ReturnType<typeof fetchGa4LandingEvidence>>>;
type Traffic = NonNullable<Analytics["traffic"]>[number];
type Destination = { host: string; path: string; urls: string[]; ads: CampaignAd[]; derived?: boolean };
type Catalog = { products: CatalogProduct[]; domains: string[] };

const hostKey = (host: string) => host.toLowerCase().replace(/^www\./, "");
const pathKey = (path: string) => path.replace(/\/$/, "") || "/";
const key = ({ host, path }: { host: string; path: string }) => `${hostKey(host)}${pathKey(path)}`;
const handles = (handle: CatalogCategory["handle"]) => typeof handle === "string" ? [handle] : Object.values(handle);
const campaignKey = (value: string) => value.replace(/\+/g, " ").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const slugKey = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const scoped = (ad: CampaignAd, row: PaidMediaRow) => row.level === "campaign" ? ad.campaignId === row.id
  : row.level === "adset" ? ad.adsetId === row.id : ad.id === row.id;

export function managerDestinations(snapshot: CampaignSnapshot | null, currency: string) {
  const pages = new Map<string, Destination>();
  if (!snapshot || snapshot.currency !== currency) return [];
  const ads = new Map([...snapshot.rows.flatMap((row) => row.ads), ...snapshot.unidentified.map(({ ad }) => ad)].map((ad) => [ad.id, ad]));
  for (const ad of ads.values()) for (const raw of ad.urls) {
    const url = safeUrl(raw);
    if (!url || url.port || !url.hostname.includes(".") || url.pathname.length > 300) continue;
    const point = { host: hostKey(url.hostname), path: pathKey(url.pathname) };
    const destination = pages.get(key(point)) ?? { ...point, urls: [], ads: [] };
    const variant = url.searchParams.get("variant") ?? url.searchParams.get("variant_id");
    url.search = "";
    url.hash = "";
    if (variant && /^\d+$/.test(variant)) url.searchParams.set("variant", variant);
    if (!destination.urls.includes(url.href)) destination.urls.push(url.href);
    if (!destination.ads.some(({ id }) => id === ad.id)) destination.ads.push(ad);
    pages.set(key(point), destination);
  }
  const spend = (page: Destination) => page.ads.reduce((total, ad) => total + (ad.spend ?? 0), 0);
  return [...pages.values()].sort((a, b) => spend(b) - spend(a));
}

export function instrumentedLandingPages(pages: Destination[], analytics: Analytics | null, snapshot: CampaignSnapshot | null) {
  const inferred = new Map<string, Destination>();
  if (!analytics?.traffic || !snapshot) return pages;
  const linkedCampaigns = new Set(pages.flatMap((page) => page.ads.map(({ campaignId }) => campaignId)));
  const byTag = new Map<string, CampaignAd[]>();
  for (const { ad } of snapshot.unidentified) {
    if (!ad.campaignId || linkedCampaigns.has(ad.campaignId)) continue;
    for (const tag of [ad.campaignId, campaignKey(ad.campaignName)].filter(Boolean)) {
      const group = byTag.get(tag) ?? [];
      group.push(ad);
      byTag.set(tag, group);
    }
  }
  for (const { host, path, campaign, sessions } of [...analytics.traffic].sort((a, b) => b.sessions - a.sessions)) {
    if (inferred.size >= 25) break;
    const ads = byTag.get(campaignKey(campaign));
    if (!ads?.length || new Set(ads.map(({ campaignId }) => campaignId)).size !== 1 || !host.includes(".") || !path.startsWith("/") || sessions < 1) continue;
    const page = { host: hostKey(host), path: pathKey(path), urls: [`https://${hostKey(host)}${pathKey(path)}`], ads, derived: true };
    inferred.set(`${ads[0].campaignId}:${key(page)}`, page);
  }
  return [...pages, ...inferred.values()];
}

function categoryProducts(page: Destination, categories: CatalogCategory[], catalog: Catalog, braavoPage: boolean) {
  const owned = catalog.domains.some((domain) => {
    const configured = safeUrl(domain.includes("://") ? domain : `https://${domain}`);
    return configured && hostKey(configured.hostname) === page.host;
  });
  if (!owned && !braavoPage) return null;
  let parts: string[];
  try { parts = decodeURIComponent(page.path).split("/").filter(Boolean); } catch { return null; }
  if (["pt", "es", "en"].includes(parts[0])) parts.shift();
  if (["categorias", "categories", "colecoes", "collections"].includes(parts[0])) parts.shift();
  const slug = parts.at(-1);
  if (!slug) return null;
  const byId = new Map(categories.map((category) => [String(category.id), category]));
  const braavoCategory = braavoPage && parts.length === 3 && parts[0] === "cat" ? byId.get(parts[1]) : null;
  const categorySlug = braavoCategory && slugKey(localized(braavoCategory.name));
  const numericCategoryMatches = categorySlug && (categorySlug === slug || categorySlug.endsWith(`-${slug}`));
  const matches = braavoCategory && numericCategoryMatches ? [braavoCategory] : owned ? categories.filter((category) => {
    if (!handles(category.handle).includes(slug)) return false;
    let parent = category.parent;
    return parts.slice(0, -1).reverse().every((part) => {
      const ancestor = byId.get(String(parent));
      parent = ancestor?.parent;
      return Boolean(ancestor && handles(ancestor.handle).includes(part));
    });
  }) : [];
  if (matches.length !== 1) return null;
  const category = matches[0];
  const selected = new Set([String(category.id)]);
  const children = (parent: CatalogCategory) => {
    for (const child of categories.filter((item) => String(item.parent) === String(parent.id))) {
      if (selected.has(String(child.id))) continue;
      selected.add(String(child.id));
      children(child);
    }
  };
  children(category);
  return { name: localized(category.name), products: catalog.products.filter((product) =>
    product.published === true && product.categories?.some((id) => selected.has(String(typeof id === "object" ? id.id : id)))) };
}

function summarizeTraffic(rows: Traffic[]) {
  const period = (interval: Traffic["period"]) => {
    const total = rows.filter((row) => row.period === interval).reduce((acc, row) => ({ sessions: acc.sessions + row.sessions,
      engaged: acc.engaged + row.engaged, purchases: acc.purchases + row.purchases, engagementSeconds: acc.engagementSeconds + row.engagementSeconds }),
    { sessions: 0, engaged: 0, purchases: 0, engagementSeconds: 0 });
    return total.sessions > 0 ? { ...total, bounce: total.engaged <= total.sessions ? 1 - total.engaged / total.sessions : null,
      purchaseRate: total.purchases / total.sessions, secondsPerSession: total.engagementSeconds / total.sessions } : null;
  };
  return { previous: period("previous"), current: period("current") };
}

export function indexLandingEvidence(pages: Destination[], ga4: Analytics | null, catalog: Catalog | null,
  categories: CatalogCategory[], stock: CatalogSnapshot | null, previousStock: CatalogSnapshot | null,
  publicAssortments: ReadonlyMap<string, PublicAssortment> = new Map()) {
  const products = new Map<string, NonNullable<CatalogSnapshot>>();
  const braavo = Boolean(catalog?.products.some(({ id }) => String(id).startsWith("braavo:")));
  const skuProductIds = new Map<string, Set<string>>();
  const earlier = new Map((previousStock ?? []).map((variant) => [variant.key, variant.stock]));
  for (const variant of stock ?? []) {
    const entries = products.get(variant.productId) ?? [];
    entries.push(variant);
    products.set(variant.productId, entries);
  }
  for (const product of catalog?.products ?? []) for (const alias of [product.id, String(product.id).match(/^braavo:(.+)$/)?.[1], ...product.variants?.flatMap((item) => [item.id, item.sku]) ?? []]) {
    if (!alias) continue;
    const ids = skuProductIds.get(String(alias)) ?? new Set<string>();
    ids.add(String(product.id));
    skuProductIds.set(String(alias), ids);
  }
  return pages.map((page) => {
    const traffic = ga4?.traffic?.filter((row) => key(row) === key(page)) ?? [];
    const observed = ga4?.products?.filter((row) => key(row) === key(page) && row.period === "current" && row.views > 0) ?? [];
    const braavoPage = braavo && traffic.some(({ sessions }) => sessions > 0);
    let direct = catalog ? page.urls.flatMap((url) => {
      const match = matchProductUrl(url, catalog.domains, catalog.products);
      return match ? [match.product] : [];
    }) : [];
    const providerProduct = braavoPage ? page.path.match(/^\/prod\/(\d+)\/([a-zA-Z0-9%-]+)$/) : null;
    if (!direct.length && providerProduct && catalog) {
      const [, id, slug] = providerProduct;
      const match = catalog.products.find((product) => product.id === `braavo:${id}` && slugKey(localized(product.name)) === slugKey(slug));
      if (match) direct = [match];
    }
    const category = !direct.length && catalog ? categoryProducts(page, categories, catalog, braavoPage) : null;
    const assortment = braavoPage ? publicAssortments.get(key(page)) : undefined;
    const publicIds = assortment?.ids.map((id) => `braavo:${id}`);
    const source = direct.length ? "produto" : category || publicIds ? "categoria" : observed.length ? "itens vistos no GA4" : "página";
    const candidates = new Map<string, number>();
    for (const item of observed) {
      const matches = skuProductIds.get(item.id);
      if (matches?.size !== 1) continue;
      const id = [...matches][0];
      candidates.set(id, (candidates.get(id) ?? 0) + item.views);
    }
    const ids = new Set(direct.length ? direct.map(({ id }) => String(id)) : publicIds ?? (category ? category.products.map(({ id }) => String(id)) : candidates.keys()));
    const grades = [...ids].flatMap((id) => {
      const variants = products.get(id);
      const live = assortment?.stock.get(id.replace(/^braavo:/, ""));
      if (live?.length) {
        const missing = live.filter(({ units }) => units === 0);
        const labels = new Map(variants?.map((variant) => [variant.key.split(":").at(-1), variant.options]));
        return [{ id, name: variants?.[0]?.name || localized(catalog?.products.find((product) => product.id === id)?.name) || `Produto ${id.replace(/^braavo:/, "")}`,
          grade: missing.length === live.length ? "out_of_stock" : missing.length ? "broken" : "complete", variants: live.length,
          recentlyBroken: missing.filter(({ sku }) => (earlier.get(`${id}:${sku}`) ?? 0) > 0).length,
          observedViews: candidates.get(id) ?? null, missing: missing.slice(0, 8).map(({ sku }) => labels.get(sku) || `SKU ${sku}`) }];
      }
      if (!variants?.length) return [];
      const missing = variants.filter((variant) => variant.stock === 0);
      const counts = variants.map(({ stock }) => stock);
      const hasUnmeasured = counts.some((count) => count === null);
      const hasStock = counts.some((count) => count !== null && count > 0);
      const grade = variants[0].published !== true ? "unknown" : missing.length && hasStock ? "broken" :
        hasUnmeasured ? "unknown" : missing.length === variants.length ? "out_of_stock" : "complete";
      const recentlyBroken = missing.filter(({ key }) => (earlier.get(key) ?? 0) > 0).length;
      return [{ id, name: variants[0].name, grade, variants: variants.length, recentlyBroken, observedViews: candidates.get(id) ?? null,
        missing: missing.slice(0, 8).map(({ options, key }) => options || key) }];
    });
    return { page, directProductId: direct[0] ? String(direct[0].id) : null, traffic, all: summarizeTraffic(traffic), source, catalogProvider: braavo ? "Braavo" : null,
      publicListing: Boolean(publicIds), publicStockProducts: assortment?.stock.size ?? 0,
      name: direct[0] ? localized(direct[0].name) : category?.name,
      products: publicIds ? ids.size : grades.length,
      unknown: grades.filter(({ grade }) => grade === "unknown").length + (publicIds ? ids.size - grades.length : 0),
      broken: grades.filter(({ grade }) => grade === "broken").length, soldOut: grades.filter(({ grade }) => grade === "out_of_stock").length,
      affected: grades.filter(({ grade }) => grade === "broken" || grade === "out_of_stock").sort((a, b) =>
        (b.observedViews ?? 0) - (a.observedViews ?? 0) || b.recentlyBroken - a.recentlyBroken).slice(0, 4) };
  });
}

export function landingEvidenceFor(row: PaidMediaRow, pages: ReturnType<typeof indexLandingEvidence>) {
  return pages.filter(({ page }) => (!page.derived || row.level === "campaign") && page.ads.some((ad) => scoped(ad, row))).slice(0, 4).map(({ page, traffic, ...evidence }) => {
    const ads = page.ads.filter((ad) => scoped(ad, row));
    const aliases = new Set(ads.flatMap((ad) => [ad.campaignId ?? "", campaignKey(ad.campaignName)]).filter(Boolean));
    const selected = traffic.filter((point) => aliases.has(campaignKey(point.campaign)));
    const campaign = summarizeTraffic(selected);
    const mobile = summarizeTraffic(selected.filter(({ device }) => device === "mobile"));
    return { path: page.path, host: page.host, derived: Boolean(page.derived), ...evidence, campaign, mobile };
  });
}
