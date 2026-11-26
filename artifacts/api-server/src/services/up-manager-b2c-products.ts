import {
  localized,
  safeUrl,
  variantStock,
  type CatalogProduct,
  type CatalogVariant,
} from "./product-campaign-analysis";
import { catalogVariantLabels, rankManagerProducts, type readVariantSales } from "./up-manager";

type VariantSales = Awaited<ReturnType<typeof readVariantSales>>;
const ratio = (n: number, d: number) => (d > 0 ? n / d : null);

function positivePrice(value: CatalogVariant["price"]) {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function published(product: CatalogProduct): boolean | null {
  if (
    product.published === false ||
    product.visibility === "hidden" ||
    product.visibility === "unpublished"
  )
    return false;
  if (
    product.published === true ||
    product.visibility === "visible" ||
    product.visibility === "published"
  )
    return true;
  return null;
}

type CatalogVariantSnapshot = {
  key: string;
  productId: string;
  name: string;
  options: string;
  imageUrl?: string | null;
  size?: string | null;
  color?: string | null;
  published: boolean | null;
  stock: number | null;
  listedPrice: number | null;
  promotion: number | null;
};
export type CatalogSnapshot = CatalogVariantSnapshot[];

export function catalogSnapshot(products: CatalogProduct[]): CatalogSnapshot {
  return products.flatMap((product) =>
    (product.variants ?? []).map((variant) => {
      const options = (variant.values ?? []).map(localized);
      return {
      key: `${product.id}:${variant.id}`,
      productId: String(product.id),
      name: localized(product.name),
      imageUrl: safeUrl(product.images?.[0]?.src)?.toString() ?? null,
      options: options.filter(Boolean).join(" / "),
      ...catalogVariantLabels(product, options),
      published: published(product),
      stock: variantStock(variant),
      listedPrice: positivePrice(variant.price),
      promotion: positivePrice(variant.promotional_price),
      };
    }),
  );
}

export function sellableInventory(snapshot: CatalogSnapshot | null) {
  if (!snapshot) return null;
  let pricedValue = 0;
  let countedUnits = 0;
  let unknownVariants = 0;
  let sellableVariants = 0;
  for (const row of snapshot) {
    if (row.published === false || row.stock === 0) continue;
    const price = row.promotion ?? row.listedPrice;
    if (row.stock === null || price === null || row.published === null) {
      unknownVariants++;
      continue;
    }
    sellableVariants++;
    pricedValue += row.stock * price;
    countedUnits += row.stock;
  }
  return {
    pricedValue: Math.round(pricedValue * 100) / 100,
    countedUnits,
    sellableVariants,
    unknownVariants,
  };
}

export function compareCatalog(
  current: CatalogSnapshot | null,
  previous: CatalogSnapshot | null,
) {
  if (!current || !previous) return null;
  const previousByKey = new Map(previous.map((row) => [row.key, row]));
  const currentKeys = new Set(current.map(({ key }) => key));
  return [
    ...current.flatMap((after) => {
      const before = previousByKey.get(after.key);
      const changed: string[] = [];
      if (!before) changed.push("Variante adicionada ao catálogo");
      else {
        if (
          before.promotion !== after.promotion &&
          before.listedPrice !== null &&
          after.listedPrice !== null
        )
          changed.push("Preço promocional alterado");
        if (
          before.listedPrice !== after.listedPrice &&
          before.listedPrice !== null &&
          after.listedPrice !== null
        )
          changed.push("Preço de tabela alterado");
        if (
          before.published !== null &&
          after.published !== null &&
          before.published !== after.published
        )
          changed.push(
            after.published
              ? "Produto publicado"
              : "Produto retirado da vitrine",
          );
        if (
          before.stock !== null &&
          after.stock !== null &&
          before.stock > 0 &&
          after.stock === 0
        )
          changed.push("Variante esgotada");
        if (before.stock === 0 && after.stock !== null && after.stock > 0)
          changed.push("Variante reabastecida");
      }
      return changed.length
        ? [
            {
              key: after.key,
              name: after.name,
              options: after.options,
              changed,
              before: before ?? null,
              after,
            },
          ]
        : [];
    }),
    ...previous
      .filter((before) => !currentKeys.has(before.key))
      .map((before) => ({
        key: before.key,
        name: before.name,
        options: before.options,
        changed: ["Variante ausente no catálogo atual"],
        before,
        after: null,
      })),
  ];
}

export function buildAbc(
  days: number,
  sales: VariantSales,
  prior: VariantSales,
  catalog: CatalogProduct[] | null,
  limits: { a: number; b: number },
) {
  const current = rankManagerProducts(sales, catalog ?? [], Infinity).sort(
    (a, b) =>
      b.revenue - a.revenue || b.units - a.units || a.id.localeCompare(b.id),
  );
  const previous = new Map(
    rankManagerProducts(prior, [], Infinity).map((row) => [row.id, row]),
  );
  const catalogById = new Map(
    (catalog ?? []).map((product) => [String(product.id), product]),
  );
  const revenue = current.reduce(
    (sum, row) => sum + Math.max(0, row.revenue),
    0,
  );
  let cumulative = 0;
  const products = current.map((row) => {
    const product = catalogById.get(row.id);
    const before = previous.get(row.id);
    const active = product ? published(product) : null;
    const noStock = row.variants.filter((v) => v.current && v.stock === 0);
    const currentVariants = row.variants.filter((v) => v.current);
    const knownStock =
      currentVariants.length > 0 &&
      currentVariants.every((v) => v.stock !== null);
    const grade =
      active === false
        ? "hidden"
        : active !== true
          ? "unknown"
          : knownStock && currentVariants.every((v) => v.stock === 0)
            ? "out_of_stock"
            : noStock.length
              ? "broken"
              : knownStock
                ? "complete"
                : "unknown";
    const start = ratio(cumulative, revenue);
    const abc =
      row.revenue <= 0 || start === null
        ? null
        : start < limits.a
          ? "A"
          : start < limits.b
            ? "B"
            : "C";
    cumulative += Math.max(0, row.revenue);
    const missingUnits = noStock.reduce((sum, v) => sum + v.units, 0);
    return {
      id: row.id,
      name: row.name,
      abc,
      grade,
      units: row.units,
      revenue: row.revenue,
      revenueShare: ratio(row.revenue, revenue),
      priorUnits: before?.units ?? 0,
      priorRevenue: before?.revenue ?? 0,
      stock: active === true ? row.stock : null,
      coverageDays:
        active === true && row.stock !== null
          ? ratio(row.stock * days, row.units)
          : null,
      demandAtRiskShare:
        grade === "unknown" || grade === "hidden"
          ? null
          : ratio(missingUnits, row.units),
      unmatchedDemandUnits: row.variants
        .filter((v) => !v.current || v.stock === null)
        .reduce((sum, v) => sum + v.units, 0),
      outOfStockVariants: noStock.map((v) => ({
        id: v.id,
        label: v.options.join(" / ") || v.sku || v.id,
        size: v.size,
        units: v.units,
      })),
    };
  });
  return { days, limits, revenue, products };
}
