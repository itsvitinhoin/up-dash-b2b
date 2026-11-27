import type { B2cFinding } from "./up-manager-b2c";
import type { CatalogSnapshot, buildAbc } from "./up-manager-b2c-products";
import type { getProductCampaignCheck } from "./product-campaign-monitor";
import type { readVariantSales } from "./up-manager";
import {
  localized, matchProductUrl, variantStock, type CampaignAd, type CampaignAnalysis, type CatalogProduct,
} from "./product-campaign-analysis";

export type GradeAdLink = {
  adId: string;
  adName: string;
  campaignName: string;
  adsetName: string;
  affected: boolean;
  pauseEligible?: boolean;
};

export function gradeAdLinks(snapshot: Pick<CampaignAnalysis, "rows"> | null) {
  const links = new Map<string, Map<string, GradeAdLink>>();
  for (const row of snapshot?.rows ?? []) {
    const product = links.get(row.productId) ?? new Map<string, GradeAdLink>();
    for (const ad of row.ads) {
      if (ad.effectiveStatus !== "ACTIVE" || ad.catalog || !/^\d+$/.test(ad.id)) continue;
      const found = product.get(ad.id);
      product.set(ad.id, {
        adId: ad.id, adName: ad.name, campaignName: ad.campaignName, adsetName: ad.adsetName,
        affected: Boolean(found?.affected || row.missingVariants.length),
      });
    }
    links.set(row.productId, product);
  }
  return new Map([...links].map(([productId, ads]) => [productId, [...ads.values()]]));
}

export function verifiedGradePause(ad: CampaignAd, product: CatalogProduct, domains: string[]) {
  if (ad.effectiveStatus !== "ACTIVE" || ad.catalog) return null;
  const visible = product.published === true || product.visibility === "visible" || product.visibility === "published";
  if (!visible || product.published === false || ["hidden", "unpublished"].includes(product.visibility ?? ""))
    return null;
  if (!ad.urls.some((url) => matchProductUrl(url, domains, [product]) !== null)) return null;
  const outOfStock = (product.variants ?? []).filter((variant) => variantStock(variant) === 0).length;
  return outOfStock > 0 ? { outOfStock } : null;
}

export function verifiedCriticalGradePause(ad: CampaignAd, product: CatalogProduct, domains: string[]) {
  if (!verifiedGradePause(ad, product, domains)) return null;
  const matches = ad.urls.map(url => matchProductUrl(url, domains, [product]));
  if (matches.some(match => match === null)) return null;

  const colorIndex = product.attributes?.findIndex(attribute =>
    /^(cor|color|colour)$/i.test(localized(attribute).trim())) ?? -1;
  const colors = matches.map(match => match?.variant && colorIndex >= 0
    ? localized(match.variant.values?.[colorIndex]) : null);
  const selectedColor = colors[0] && colors.every(color => color === colors[0]) ? colors[0] : null;
  const scoped = (product.variants ?? []).filter(variant => !selectedColor || localized(variant.values?.[colorIndex]) === selectedColor);
  const sizes = scoped.map(variant => ({
    stock: variantStock(variant), label: (variant.values ?? []).map(localized).filter(Boolean).join(" / ") || String(variant.id),
  }));
  if (sizes.some(({ stock }) => stock === null)) return null;
  const available = sizes.filter(({ stock }) => stock! > 0);
  const missing = sizes.filter(({ stock }) => stock === 0);
  if (available.length !== 1 || missing.length < 2) return null;
  return { outOfStock: missing.length, unavailable: missing.map(({ label }) => label), remaining: available[0] };
}

export function criticalGradeAdDecisions(
  catalog: { products: CatalogProduct[]; domains: string[] } | null,
  snapshot: Pick<CampaignAnalysis, "rows"> | null,
  findings: B2cFinding[],
) {
  const results = new Map<string, { evidence: string; action: string }>();
  if (!catalog || !snapshot) return results;
  const gradeFindings = new Map(findings.filter(({ grade }) => grade).map(item => [item.grade!.productId, item]));
  const products = new Map(catalog.products.map(product => [String(product.id), product]));
  for (const row of snapshot.rows) {
    const product = products.get(row.productId);
    const finding = gradeFindings.get(row.productId);
    if (!product || !finding?.grade || row.grade !== "broken") continue;
    for (const ad of row.ads) {
      if (results.has(ad.id) || !finding.grade.ads?.some(link => link.adId === ad.id && link.pauseEligible !== false)) continue;
      const proof = verifiedCriticalGradePause(ad, product, catalog.domains);
      if (!proof) continue;
      const evidence = `${row.name} tem ${proof.outOfStock} opções zeradas (${proof.unavailable.join(", ")}). Só ${proof.remaining.label} está disponível (${proof.remaining.stock} un.).`;
      const action = "Desativar o anúncio vinculado. Reavaliar a veiculação quando a grade for recomposta.";
      results.set(ad.id, { evidence, action });
      finding.priority = "P0";
      finding.evidence = evidence;
      finding.action = action;
    }
  }
  return results;
}

export interface GradeEvidence {
  productId: string;
  imageUrl?: string | null;
  productUrl?: string | null;
  ads?: GradeAdLink[];
  missing: { id: string; label: string; stock?: number; sold14Days?: number }[];
  variants?: {
    id: string;
    label: string;
    color: string | null;
    size: string | null;
    stock: number | null;
    sold14Days: number;
  }[];
  availableVariants?: number;
  stockAvailable?: number;
  replenishmentEta?: string | null;
  confirmedOutOfStock: boolean;
  unknownVariants: number;
  campaignCount: number;
  leadingProduct: boolean;
  observedAt: string | null;
}

export function buildGradeFindings(
  catalog: CatalogSnapshot | null,
  abc: ReturnType<typeof buildAbc>,
  monitor: Pick<
    Awaited<ReturnType<typeof getProductCampaignCheck>>,
    "snapshot" | "stale"
  >,
  observedAt: string | null,
  sales: Awaited<ReturnType<typeof readVariantSales>> = [],
): B2cFinding[] {
  if (!catalog) return [];
  const byProduct = new Map<string, CatalogSnapshot>();
  for (const variant of catalog) {
    if (variant.published !== true) continue;
    const rows = byProduct.get(variant.productId) ?? [];
    rows.push(variant);
    byProduct.set(variant.productId, rows);
  }
  const abcById = new Map(abc.products.map((product) => [product.id, product]));
  const links = gradeAdLinks(monitor.stale ? null : monitor.snapshot);
  const salesByKey = new Map<string, number>();
  for (const { externalId, units } of sales) {
    if (externalId) salesByKey.set(externalId, (salesByKey.get(externalId) ?? 0) + units);
  }
  const findings: B2cFinding[] = [];
  for (const [productId, rows] of byProduct) {
    const leader = abcById.get(productId);
    const salesByVariant = new Map(
      leader?.outOfStockVariants.map((row) => [row.id, row.units]),
    );
    const variants = rows.map((row) => ({
      id: row.key,
      label: row.options || row.key.split(":").at(-1)!,
      color: row.color ?? null,
      size: row.size ?? null,
      stock: row.stock,
      sold14Days: salesByKey.get(row.key) ?? salesByVariant.get(row.key.split(":").at(-1)!) ?? 0,
    }));
    const available = variants.filter((row) => row.stock !== null && row.stock > 0);
    const missing = variants
      .filter((row) => row.stock === 0)
      .map(({ id, label, sold14Days }) => ({ id, label, sold14Days, stock: 0 }))
      .sort(
        (a, b) => b.sold14Days - a.sold14Days || a.label.localeCompare(b.label),
      );
    if (!missing.length) continue;
    const ads = links.get(productId) ?? [];
    const grade: GradeEvidence = {
      productId,
      imageUrl: rows[0].imageUrl ?? null,
      ads,
      missing,
      variants,
      availableVariants: available.length,
      stockAvailable: available.reduce((sum, row) => sum + (row.stock ?? 0), 0),
      replenishmentEta: null,
      confirmedOutOfStock: missing.length === rows.length,
      unknownVariants: rows.filter((row) => row.stock === null).length,
      campaignCount: ads.filter(({ affected }) => affected).length,
      leadingProduct: leader?.abc === "A",
      observedAt,
    };
    const first = missing
      .slice(0, 3)
      .map(
        ({ label, sold14Days }) =>
          `${label} (saldo zero; ${sold14Days} un. vendidas em 14 dias)`,
      )
      .join(", ");
    const evidence = [
      missing.length === 1
        ? `Sem estoque em ${first}.`
        : `${missing.length} variantes sem estoque, incluindo ${first}.`,
      grade.campaignCount > 0
        ? `${grade.campaignCount} anúncio(s) ativo(s) com destino afetado.`
        : "",
      grade.leadingProduct && leader
        ? `Curva A com ${leader.units} vendas em 14 dias.`
        : "",
      grade.stockAvailable! > 0
        ? `Há ${grade.stockAvailable} un. em ${grade.availableVariants} outras variantes.`
        : "",
      "Prazo de reposição indisponível no catálogo.",
      grade.unknownVariants
        ? `${grade.unknownVariants} variante(s) sem estoque confirmado.`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    findings.push({
      id: `grade:${productId}`,
      title: rows[0].name,
      section: "products",
      focus: "stock",
      priority:
        grade.confirmedOutOfStock && grade.campaignCount
          ? "P0"
          : grade.campaignCount || grade.leadingProduct
            ? "P1"
            : "P2",
      evidence,
      grade,
      hypothesis: grade.confirmedOutOfStock
        ? "O saldo zero foi confirmado em toda a grade publicada."
        : "O saldo zero foi confirmado para as opções listadas.",
      action: available.length
        ? `Preservar a oferta das opções com saldo (${available
            .slice(0, 3)
            .map((row) => row.label)
            .join(
              ", ",
            )}). Se houver reposição, priorizar as variantes zeradas com giro recente.`
        : "Sinalizar a quebra de grade na operação e priorizar as opções com giro quando houver uma janela de abastecimento.",
      owner: grade.campaignCount ? "Mídia e e-commerce" : "Estoque",
      followUp:
        "Observar a disponibilidade nas próximas sincronizações de estoque.",
    });
  }
  return findings.sort(
    (a, b) =>
      a.priority.localeCompare(b.priority) ||
      b.grade!.campaignCount - a.grade!.campaignCount ||
      a.title.localeCompare(b.title),
  );
}

export function gradeSummaryFinding(findings: B2cFinding[]): B2cFinding | null {
  if (!findings.length) return null;
  const priorityVariants = findings.flatMap(({ grade }) =>
    grade && (grade.leadingProduct || grade.campaignCount)
      ? grade.missing.filter((option) => (option.sold14Days ?? 0) > 0)
      : [],
  ).length;
  return {
    id: "grade-summary",
    title: "Quebras de grade e reposição",
    section: "products",
    focus: "stock",
    priority: priorityVariants ? "P1" : "P2",
    evidence: `${findings.length} produtos com variantes esgotadas. ${priorityVariants} opções com vendas recentes em produtos Curva A ou anunciados.`,
    hypothesis:
      "As quebras foram verificadas no catálogo e ordenadas pelo giro recente.",
    action:
      "Manter em destaque as opções disponíveis. Se houver reposição, priorizar as variantes com giro listadas no card.",
    owner: "E-commerce e estoque",
    followUp: "Monitorar o saldo na próxima sincronização.",
  };
}
