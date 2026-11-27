// Pure matching rules: no database, credentials or network access.
export type Grade = "complete" | "broken" | "out_of_stock" | "unknown";
type Localized = string | Record<string, string>;
export interface CatalogVariant {
  id: string | number;
  sku?: string | null;
  stock?: number | string | null;
  stock_management?: boolean;
  price?: number | string | null;
  promotional_price?: number | string | null;
  values?: Localized[];
}
export interface CatalogProduct {
  id: string | number;
  name: Localized;
  handle?: Localized;
  attributes?: Localized[];
  visibility?: string;
  published?: boolean;
  images?: { src: string }[];
  categories?: (number | string | { id: number | string })[];
  variants?: CatalogVariant[];
}
export type CatalogCategory = { id: number | string; handle: Localized; name: Localized; parent?: number | string | null };
export interface CampaignAd {
  id: string;
  name: string;
  campaignName: string;
  campaignId?: string;
  adsetId?: string;
  creativeId?: string;
  creativeName?: string;
  adsetName: string;
  effectiveStatus: string;
  urls: string[];
  catalog: boolean;
  reviewableDestination?: boolean;
  imageUrl: string | null;
  spend: number | null;
  impressions: number | null;
}
export interface CampaignProductRow {
  id: string;
  productId: string;
  name: string;
  color: string | null;
  scope: "selected_color" | "destination_product";
  imageUrl: string | null;
  productUrl: string;
  grade: Grade;
  unavailable: boolean;
  publicationConfirmed?: boolean;
  availableVariants: number;
  variantCount: number;
  missingVariants: string[];
  stock: number | null;
  ads: CampaignAd[];
}
export interface CampaignAnalysis {
  rows: CampaignProductRow[];
  unidentified: { ad: CampaignAd; reason: string }[];
  totalAds: number;
  identifiedAds: number;
  spend: number | null;
  riskSpend: number | null;
}

export function localized(value: Localized | undefined): string {
  if (typeof value === "string") return value;
  return (
    value?.pt ||
    value?.es ||
    value?.en ||
    Object.values(value ?? {}).find(Boolean) ||
    ""
  );
}
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}
export function safeUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}
function host(value: string): string | null {
  const url = safeUrl(value.includes("://") ? value : `https://${value}`);
  return url && !url.port
    ? url.hostname.toLowerCase().replace(/^www\./, "")
    : null;
}

// Never fetch or follow destinations: exact store-domain + product-path matching.
export function matchProductUrl(
  raw: string,
  domains: string[],
  products: CatalogProduct[],
) {
  const url = safeUrl(raw);
  const destinationHost = url ? host(url.origin) : null;
  if (
    !url ||
    !destinationHost ||
    !domains.some((domain) => host(domain) === destinationHost)
  )
    return null;
  let parts: string[];
  try {
    parts = decodeURIComponent(url.pathname).split("/").filter(Boolean);
  } catch {
    return null;
  }
  if (parts.length === 3 && ["pt", "es", "en"].includes(parts[0]))
    parts.shift();
  if (
    parts.length !== 2 ||
    !["produtos", "productos", "products"].includes(parts[0])
  )
    return null;
  const matches = products.filter((product) => {
    const handles =
      typeof product.handle === "string"
        ? [product.handle]
        : Object.values(product.handle ?? {});
    return handles.some((handle) => handle === parts[1]);
  });
  if (matches.length !== 1) return null;
  const product = matches[0];
  const variantId =
    url.searchParams.get("variant") ?? url.searchParams.get("variant_id");
  const variant = variantId
    ? product.variants?.find((item) => String(item.id) === variantId)
    : undefined;
  // An invalid variant selector must not silently widen to the entire product.
  if (variantId && !variant) return null;
  url.search = "";
  url.hash = "";
  return { product, variant, productUrl: url.toString() };
}

export function variantStock(variant: CatalogVariant): number | null {
  if (variant.stock_management === false) return null;
  if (
    variant.stock === null ||
    variant.stock === undefined ||
    String(variant.stock).trim() === ""
  )
    return null;
  const stock = Number(variant.stock);
  return Number.isFinite(stock) ? Math.max(0, stock) : null;
}
export function classifyGrade(variants: CatalogVariant[]): Grade {
  if (
    !variants.length ||
    variants.some((variant) => variantStock(variant) === null)
  )
    return "unknown";
  const available = variants.filter(
    (variant) => variantStock(variant)! > 0,
  ).length;
  return available === 0
    ? "out_of_stock"
    : available === variants.length
      ? "complete"
      : "broken";
}

export function analyzeProductCampaigns(
  ads: CampaignAd[],
  products: CatalogProduct[],
  domains: string[],
  expectedStatus: "ACTIVE" | "PAUSED" = "ACTIVE",
): CampaignAnalysis {
  const rows = new Map<string, CampaignProductRow>();
  const identified = new Set<string>();
  const unidentified: CampaignAnalysis["unidentified"] = [];
  const uniqueAds = [
    ...new Map(
      ads
        .filter((ad) => ad.effectiveStatus === expectedStatus)
        .map((ad) => [ad.id, ad]),
    ).values(),
  ];
  for (const ad of uniqueAds) {
    let unmatched = 0;
    // Catalog templates are not evidence of a specific advertised product.
    const urls = ad.catalog ? [] : [...new Set(ad.urls)];
    for (const raw of urls) {
      const match = matchProductUrl(raw, domains, products);
      if (!match) {
        unmatched++;
        continue;
      }
      identified.add(ad.id);
      const { product, variant, productUrl } = match;
      const colorIndex =
        product.attributes?.findIndex((attribute) =>
          ["cor", "color", "colour"].includes(fold(localized(attribute))),
        ) ?? -1;
      const selectedColor =
        variant && colorIndex >= 0
          ? localized(variant.values?.[colorIndex])
          : null;
      const groups = new Map<string, CatalogVariant[]>();
      for (const item of product.variants ?? []) {
        const color =
          colorIndex >= 0 ? localized(item.values?.[colorIndex]) : "";
        if (selectedColor && color !== selectedColor) continue;
        const group = groups.get(color) ?? [];
        group.push(item);
        groups.set(color, group);
      }
      if (!groups.size) groups.set("", []);
      for (const [color, variants] of groups) {
        const id = `${product.id}:${color}`;
        const existing = rows.get(id);
        if (existing) {
          if (!existing.ads.some((item) => item.id === ad.id))
            existing.ads.push(ad);
          if (!selectedColor) existing.scope = "destination_product";
          continue;
        }
        const stocks = variants.map(variantStock);
        rows.set(id, {
          id,
          productId: String(product.id),
          name: localized(product.name),
          color: color || null,
          scope: selectedColor ? "selected_color" : "destination_product",
          imageUrl: safeUrl(product.images?.[0]?.src)?.toString() ?? null,
          productUrl,
          grade: classifyGrade(variants),
          unavailable:
            product.published === false ||
            product.visibility === "hidden" ||
            product.visibility === "unpublished",
          publicationConfirmed:
            product.published === true ||
            product.visibility === "visible" ||
            product.visibility === "published",
          availableVariants: stocks.filter(
            (stock) => stock !== null && stock > 0,
          ).length,
          variantCount: variants.length,
          missingVariants: variants
            .filter((item) => variantStock(item) === 0)
            .map(
              (item) =>
                (item.values ?? [])
                  .map(localized)
                  .filter(Boolean)
                  .join(" / ") ||
                item.sku ||
                String(item.id),
            ),
          stock:
            stocks.length && stocks.every((stock) => stock !== null)
              ? stocks.reduce<number>((sum, stock) => sum + stock!, 0)
              : null,
          ads: [ad],
        });
      }
    }
    if (ad.catalog || !urls.length || unmatched) {
      unidentified.push({
        ad,
        reason: ad.catalog
          ? "Anúncio de catálogo: correspondência ainda não disponível nesta versão."
          : !urls.length
            ? "Sem link de produto disponível. Imagem e vídeo ainda não são analisados."
            : "Um ou mais destinos não correspondem com segurança a um produto da loja.",
      });
    }
  }
  const priority: Record<Grade, number> = {
    out_of_stock: 0,
    broken: 1,
    unknown: 2,
    complete: 3,
  };
  const result = [...rows.values()].sort(
    (a, b) =>
      (a.unavailable ? -1 : priority[a.grade]) -
        (b.unavailable ? -1 : priority[b.grade]) ||
      a.name.localeCompare(b.name),
  );
  const riskAds = new Set(
    result
      .filter(
        (row) =>
          row.unavailable || ["out_of_stock", "broken"].includes(row.grade),
      )
      .flatMap((row) => row.ads.map((ad) => ad.id)),
  );
  const sumSpend = (items: CampaignAd[]) =>
    items.some((ad) => ad.spend === null)
      ? null
      : items.reduce((sum, ad) => sum + ad.spend!, 0);
  return {
    rows: result,
    unidentified,
    totalAds: uniqueAds.length,
    identifiedAds: identified.size,
    spend: sumSpend(uniqueAds),
    riskSpend: sumSpend(uniqueAds.filter((ad) => riskAds.has(ad.id))),
  };
}
