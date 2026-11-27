import { localized, safeUrl, type CatalogProduct } from "./product-campaign-analysis";
import type { CatalogSnapshot } from "./up-manager-b2c-products";
import type { getGa4ProductViews } from "./ga4-daily-sync";
import type { PublicAssortment } from "./up-manager-public-assortment";
import type { GradeEvidence } from "./up-manager-grade";
import type { ManagerPeriod } from "./up-manager";

type Views = NonNullable<Awaited<ReturnType<typeof getGa4ProductViews>>>;
export type ProductDestination = { url: string; ads: NonNullable<GradeEvidence["ads"]> };
const normalize = (value: string) => value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").trim().replace(/\s+/g, " ").toLowerCase();

export function summarizeProductViews(views: Views, catalog: CatalogProduct[]) {
  const identities = new Map<string, Set<string>>();
  const names = new Map<string, Set<string>>();
  function index(map: Map<string, Set<string>>, key: string, id: string) {
    if (!key) return;
    const group = map.get(key) ?? new Set();
    group.add(id);
    map.set(key, group);
  }
  for (const product of catalog) {
    const id = String(product.id);
    for (const key of [id, id.replace(/^braavo:/, ""), ...(product.variants ?? []).flatMap((variant) => [
      String(variant.id), variant.sku?.trim(), `${id}:${variant.id}`,
    ])]) if (key) index(identities, key, id);
    index(names, normalize(localized(product.name)), id);
  }
  const totals = new Map<string, { views: number; matchedByName: boolean }>();
  let unlinkedViews = 0;
  for (const item of views) {
    if (item.views <= 0) continue;
    const key = item.itemId?.trim();
    const ids = key ? identities.get(key) : undefined;
    const named = !ids && item.itemName ? names.get(normalize(item.itemName)) : undefined;
    const match = ids ?? named;
    if (match?.size !== 1) {
      unlinkedViews += item.views;
      continue;
    }
    const id = [...match][0];
    const total = totals.get(id) ?? { views: 0, matchedByName: false };
    totals.set(id, { views: total.views + item.views, matchedByName: total.matchedByName || Boolean(named) });
  }
  return { totals, unlinkedViews };
}

export function groupProductTraffic(views: Views | null, catalog: CatalogProduct[], snapshot: CatalogSnapshot | null,
  grades: Map<string, GradeEvidence>, destinations: Map<string, ProductDestination>, period: ManagerPeriod, catalogAds: number,
  assortments: Iterable<PublicAssortment> = []) {
  if (!views) return null;
  const storefront = new Map<string, number | null>();
  const storefrontUrls = new Map<string, string>();
  for (const listing of assortments) {
    for (const [id, url] of listing.urls ?? []) storefrontUrls.set(`braavo:${id}`, url);
    for (const [product, variants] of listing.stock) for (const { sku, units } of variants) {
      const key = `braavo:${product}:${sku}`;
      storefront.set(key, storefront.has(key) && storefront.get(key) !== units ? null : units);
    }
  }
  const variantsByProduct = new Map<string, CatalogSnapshot>();
  for (const variant of snapshot ?? []) {
    if (variant.published !== true) continue;
    const list = variantsByProduct.get(variant.productId) ?? [];
    list.push(variant);
    variantsByProduct.set(variant.productId, list);
  }
  const { totals, unlinkedViews } = summarizeProductViews(views, catalog);
  const ranked = [...totals].sort((a, b) => b[1].views - a[1].views).flatMap(([id, total], index) => {
    const variants = variantsByProduct.get(id);
    const grade = grades.get(id);
    if (!variants?.length && !grade) return [];
    const fromStorefront = (variants ?? []).some(({ stock, key }) => stock === null && storefront.get(key) != null);
    const sizes = grade?.variants ?? (variants ?? []).map(({ key, options, color, size, stock }) => ({
      id: key, label: options || key, color: color ?? null, size: size ?? null, stock: stock ?? storefront.get(key) ?? null,
    }));
    const zero = sizes.filter(({ stock }) => stock === 0).length;
    const status = zero > 0 && zero === sizes.length ? "out_of_stock"
      : zero || grade?.missing.length ? "broken" : sizes.length && sizes.every(({ stock }) => stock != null) ? "complete" : "unknown";
    return [{ id, rank: index + 1, name: variants?.[0].name ?? id, imageUrl: grade?.imageUrl ?? variants?.[0].imageUrl,
      status, url: safeUrl(destinations.get(id)?.url ?? storefrontUrls.get(id))?.href ?? null, fromStorefront, ...total,
      variants: sizes,
      ads: grade?.ads ?? destinations.get(id)?.ads ?? [],
    }];
  });
  return { period, catalogAds, unlinkedViews, items: ranked.slice(0, 20) };
}
