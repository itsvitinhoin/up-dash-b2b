import { addDaysToDateOnly } from "../lib/reporting-period";
import type { CampaignSnapshot } from "./product-campaign-monitor";
import type { CatalogSnapshot } from "./up-manager-b2c-products";
import type { ManagerPeriod, readVariantSales } from "./up-manager";
import { buildPaidMediaReview, mediaRoas, type MediaLevel, type MediaMetrics, type PaidMediaReview, type PaidMediaRow } from "./up-manager-paid-media";
import type { MetaMarketingData } from "./meta-ads";
import type { landingEvidenceFor } from "./up-manager-landing";
import type { firstMediaBreak } from "./up-manager-timeline";
import type { AuctionEvaluation } from "./up-manager-auction";

export const campaignWindows = [30, 14, 7, 3] as const;
type Days = (typeof campaignWindows)[number];
type Reviews = Record<Days, PaidMediaReview>;
type Sales = Awaited<ReturnType<typeof readVariantSales>>;
type Scope = { id: string; level: MediaLevel; campaignId?: string; adsetId?: string };
export type WindowPoint = {
  days: Days; period: ManagerPeriod; spend: number | null; purchases: number | null; roas: number | null;
  accountRoas: number | null; peerRoas: number | null; peerCpa: number | null; cpa: number | null;
};
export type ProductCoverage = {
  id: string; name: string; color: string | null; imageUrl: string | null; grade: "complete" | "broken" | "out_of_stock" | "unknown";
  stock: number | null; units7: number; units14: number;
  unitsPerDay: number | null; coverageDays: number | null; gradeDays: number | null; coverageAtScale: number | null;
  firstSizeAtRisk: string | null; missing: string[]; ads: number;
  variants: { id: string; label: string; color: string | null; size: string | null; stock: number | null; sold14Days: number }[];
  linkedAds: { adId: string; adName: string; campaignName: string; adsetName: string; affected: boolean }[];
};
export type CampaignEvaluation = {
  windows: WindowPoint[];
  inventory: { products: ProductCoverage[]; totalProducts: number; unknownAds: number; unmatchedReasons?: string[]; coverageDays: number | null; gradeDays: number | null; scaleReady: boolean };
  decision: "maintain" | "investigate" | "scale" | "pause";
  diagnosis?: { factors: { label: string; detail: string }[]; summary?: string; followUp?: string };
  auction?: AuctionEvaluation;
  breakpoint?: NonNullable<ReturnType<typeof firstMediaBreak>>;
  watch?: { kind: "grade" | "recovery" | "decline"; detail: string; action: string };
  destinations?: ReturnType<typeof landingEvidenceFor>;
  comparison?: { previousRoas: number; currentRoas: number; previousPurchases: number; currentPurchases: number };
  opportunity: boolean;
  reason: string;
  action: string;
};

export function comparePaidWeeks(total: MediaMetrics | undefined, current: MediaMetrics | undefined) {
  if (!total || !current || current.missingValue || total.missingValue) return null;
  const previous = {
    spend: total.spend - current.spend,
    revenue: total.revenue - current.revenue,
    purchases: total.purchases - current.purchases,
    clicks: total.clicks - current.clicks,
    impressions: total.impressions != null && current.impressions != null && total.impressions >= current.impressions
      ? total.impressions - current.impressions : null,
    missingValue: 0,
  };
  if (previous.spend <= 0 || current.spend <= 0 || Math.min(previous.revenue, previous.purchases, previous.clicks) < 0) return null;
  return { previous, current, before: previous.revenue / previous.spend, after: current.revenue / current.spend };
}

export function campaignWeeklyComparison(reviews: Reviews, scope: Scope) {
  const metrics = (days: 7 | 14) => reviews[days].rows.find(({ id, level }) => id === scope.id && level === scope.level)?.spending;
  return comparePaidWeeks(metrics(14), metrics(7));
}

export function campaignPeriod(end: string, days: number): ManagerPeriod {
  return { dateFrom: addDaysToDateOnly(end, 1 - days), dateTo: end };
}

export function buildCampaignWindows(
  media: (MetaMarketingData | null)[], end: string, snapshot: CampaignSnapshot | null, currency: string,
): Reviews {
  const build = (index: number, days: Days) => {
    const window = campaignPeriod(end, days);
    return buildPaidMediaReview({ current: media[index] ?? null, previous: null, snapshot, currency, window,
      previousWindow: campaignPeriod(addDaysToDateOnly(window.dateFrom, -1), days) });
  };
  return { 30: build(0, 30), 14: build(1, 14), 7: build(2, 7), 3: build(3, 3) };
}

const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const minKnown = (values: (number | null)[]) => {
  const known = values.filter((x): x is number => x !== null);
  return known.length ? Math.min(...known) : null;
};
const ratio = (value: number, count: number) => count > 0 ? value / count : null;
const match = (ad: { id: string; campaignId?: string; adsetId?: string }, scope: Scope) =>
  scope.level === "ad" ? ad.id === scope.id : scope.level === "adset" ? ad.adsetId === scope.id : ad.campaignId === scope.id;
const fold = (value: string | null | undefined) => (value ?? "").trim().normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export function campaignInventoryContext(snapshot: CampaignSnapshot | null, catalog: CatalogSnapshot | null, weekly: Sales, fortnightly: Sales) {
  const units = (sales: Sales) => {
    const values = new Map<string, number>();
    for (const row of sales) if (row.externalId) values.set(row.externalId, (values.get(row.externalId) ?? 0) + row.units);
    return values;
  };
  const byProduct = new Map<string, CatalogSnapshot>();
  for (const variant of catalog ?? []) {
    const product = byProduct.get(variant.productId) ?? [];
    product.push(variant);
    byProduct.set(variant.productId, product);
  }
  return { snapshot, byProduct, sales7: units(weekly), sales14: units(fortnightly) };
}

export function evaluateCampaignInventory(scope: Scope, ctx: ReturnType<typeof campaignInventoryContext>): CampaignEvaluation["inventory"] {
  const { snapshot, byProduct, sales7, sales14 } = ctx;
  const rows = (snapshot?.rows ?? []).filter((row) => row.ads.some((ad) => match(ad, scope)));
  const unknown = snapshot?.unidentified.filter(({ ad }) => match(ad, scope)) ?? [];
  const unknownAds = unknown.length;
  const products = rows.map((row): ProductCoverage => {
    const product = byProduct.get(row.productId) ?? [];
    const scoped = row.color ? product.filter((variant) => fold(variant.color) === fold(row.color)) : product;
    const ads = row.ads.filter((ad) => match(ad, scope));
    const stockKnown = row.publicationConfirmed === true && !row.unavailable && scoped.length > 0 &&
      scoped.every((variant) => variant.published === true && variant.stock !== null);
    const stock = stockKnown ? scoped.reduce((value, item) => value + (item.stock ?? 0), 0) : null;
    const units7 = scoped.reduce((value, item) => value + (sales7.get(item.key) ?? 0), 0);
    const units14 = scoped.reduce((value, item) => value + (sales14.get(item.key) ?? 0), 0);
    const days = Math.max(units7 / 7, units14 / 14);
    const coverageDays = stock === null ? null : stock === 0 ? 0 : ratio(stock, days);
    const grade = !stockKnown ? "unknown" : stock === 0 ? "out_of_stock" : row.grade;
    const risk = scoped.flatMap((variant) => {
      const pace = Math.max((sales7.get(variant.key) ?? 0) / 7, (sales14.get(variant.key) ?? 0) / 14);
      return variant.stock === null || pace <= 0 ? [] : [{
        label: variant.size || variant.options || "Variante", days: variant.stock / pace,
      }];
    }).sort((a, b) => a.days - b.days)[0];
    return {
      id: row.id, name: row.name, color: row.color, imageUrl: row.imageUrl, grade, stock, units7, units14,
      unitsPerDay: days > 0 ? days : null, coverageDays, gradeDays: stockKnown ? (grade === "broken" || grade === "out_of_stock" ? 0 : risk?.days ?? null) : null,
      firstSizeAtRisk: risk?.label ?? null,
      coverageAtScale: coverageDays === null ? null : coverageDays / 1.2,
      missing: row.missingVariants, ads: ads.length,
      variants: scoped.map((variant) => ({ id: variant.key, label: variant.options || variant.key,
        color: variant.color ?? null, size: variant.size ?? null, stock: variant.stock, sold14Days: sales14.get(variant.key) ?? 0 })),
      linkedAds: ads.map((ad) => ({
        adId: ad.id, adName: ad.name, campaignName: ad.campaignName, adsetName: ad.adsetName,
        affected: grade === "broken" || grade === "out_of_stock",
      })),
    };
  }).sort((a, b) => (a.gradeDays ?? Infinity) - (b.gradeDays ?? Infinity) ||
    (a.coverageDays ?? Infinity) - (b.coverageDays ?? Infinity) || b.units14 - a.units14);
  const scaleReady = !!snapshot && unknownAds === 0 && products.length > 0 && products.every((item) =>
    item.grade === "complete" && item.coverageAtScale !== null && item.coverageAtScale >= 7 &&
    item.gradeDays !== null && item.gradeDays / 1.2 >= 3);
  return { products, totalProducts: products.length, unknownAds, unmatchedReasons: [...new Set(unknown.map(({ reason }) => reason))],
    coverageDays: minKnown(products.map((item) => item.coverageDays)),
    gradeDays: minKnown(products.map((item) => item.gradeDays)), scaleReady };
}

export function campaignWindowPoints(reviews: Reviews, scope: Scope): WindowPoint[] {
  return campaignWindows.map((days) => {
    const review = reviews[days];
    const row = review.rows.find(({ id, level }) => id === scope.id && level === scope.level);
    return {
      days, period: review.window, spend: row?.spending.spend ?? (review.available ? 0 : null),
      purchases: row?.spending.purchases ?? (review.available ? 0 : null), roas: row?.roas ?? null,
      accountRoas: review.reference, peerRoas: row?.benchmark?.roas ?? null,
      peerCpa: row?.benchmark ? ratio(row.benchmark.spend, row.benchmark.purchases) : null,
      cpa: row ? ratio(row.spending.spend, row.spending.purchases) : null,
    };
  });
}

export function performanceAcrossWindows(windows: WindowPoint[]) {
  const [m30, m14, m7, m3] = windows;
  const observed = windows.filter(({ accountRoas }) => accountRoas !== null && accountRoas > 0).length;
  const costly = (point: WindowPoint, cpa: number, multiple = 1) => point.spend !== null && point.spend >= cpa * multiple;
  const beats = (point: WindowPoint, factor = 1) => point.accountRoas !== null && point.accountRoas > 0 &&
    point.roas !== null && point.roas >= point.accountRoas * factor;
  const weak = (point: WindowPoint, factor: number) => point.roas !== null && point.accountRoas !== null &&
    point.accountRoas > 0 && point.roas <= Math.min(point.accountRoas, point.peerRoas ?? point.accountRoas) * factor;
  const peer = m7.peerCpa ?? m14.peerCpa ?? m30.peerCpa;
  const pause = observed >= 3 && peer !== null && peer > 0 && weak(m3, 0.7) && weak(m7, 0.85) &&
    (weak(m14, 0.9) || weak(m30, 0.9)) && costly(m7, peer, 2) &&
    (m3.purchases === 0 ? costly(m3, peer, 2) : costly(m3, peer));
  const opportunity = observed >= 3 && beats(m3, 1.08) && beats(m7) && (beats(m14) || beats(m30)) &&
    (m3.purchases ?? 0) >= 3 && (m7.purchases ?? 0) >= 6 && (m14.purchases ?? m30.purchases ?? 0) >= 8;
  return { pause, opportunity };
}

export function buildCampaignEvaluation(
  row: PaidMediaRow, reviews: Reviews, ctx: ReturnType<typeof campaignInventoryContext>, recentChange: boolean,
): CampaignEvaluation {
  const windows = campaignWindowPoints(reviews, row);
  const inventory = evaluateCampaignInventory(row, ctx);
  const { pause, opportunity } = performanceAcrossWindows(windows);
  const [, pulse14, pulse7, pulse3] = windows;
  const weeks = campaignWeeklyComparison(reviews, row);
  const previousCpa = weeks && ratio(weeks.previous.spend, weeks.previous.purchases);
  const sharpDecline = weeks && weeks.before > 0 && weeks.after <= weeks.before * 0.75 &&
    weeks.previous.purchases >= 4 && (weeks.current.purchases >= 4 || (previousCpa && weeks.current.spend >= previousCpa * 3));
  const account14 = pulse14.accountRoas ?? 0;
  const peer14 = pulse14.peerRoas ?? account14;
  const historyGap = pulse14.roas !== null && account14 > 0 && pulse14.roas < Math.min(account14, peer14) * 0.75 &&
    pulse14.peerCpa !== null && (pulse14.spend ?? 0) >= pulse14.peerCpa * 3;
  const recentReference = pulse3.accountRoas ?? 0;
  const recentCpa = pulse3.peerCpa ?? pulse7.peerCpa;
  const recentGap = pulse3.roas !== null && recentReference > 0 && pulse3.roas < recentReference * 0.75 &&
    recentCpa !== null && recentCpa > 0 && (pulse3.spend ?? 0) >= recentCpa * 2;
  const summary = `ROAS de ${mediaRoas(pulse3.roas)} em 3d, ${mediaRoas(pulse7.roas)} em 7d e ${mediaRoas(pulse14.roas)} em 14d.`;
  const limited = inventory.products.find((item) => item.grade === "broken" || item.grade === "out_of_stock");
  if (row.pauseReason === "stock" && row.recommendation === "pause") {
    return { windows, inventory, decision: "pause", opportunity: false, reason: row.driver, action: row.action };
  }
  if (pause && !recentChange) {
    return { windows, inventory, decision: "pause", opportunity, reason: `${summary} O retorno ficou materialmente abaixo das referências recentes e também aparece fraco no histórico, com gasto suficiente.`,
      action: "Desativar o item após conferir o resultado mais recente na Meta." };
  }
  if (sharpDecline || historyGap || recentGap) {
    const account = comparePaidWeeks(reviews[14].accountSpending, reviews[7].accountSpending);
    const recent = pulse3.roas !== null
      ? ` Em 3 dias, ROAS de ${mediaRoas(pulse3.roas)} frente a ${mediaRoas(pulse3.accountRoas)} da conta.` : "";
    const reason = sharpDecline && weeks
      ? `ROAS de ${mediaRoas(weeks.before)} para ${mediaRoas(weeks.after)} em duas semanas fechadas, queda de ${decimal.format((1 - weeks.after / weeks.before) * 100)}%.${account ? ` Na conta, o ROAS passou de ${mediaRoas(account.before)} para ${mediaRoas(account.after)}.` : ""}${recent}`
      : historyGap ? `ROAS de ${mediaRoas(pulse14.roas)} em 14 dias, abaixo da média de ${mediaRoas(pulse14.accountRoas)} da própria conta.${recent}`
        : `O retorno recente está materialmente abaixo da média da própria conta.${recent}`;
    const action = sharpDecline || recentGap
      ? "Priorizar hoje o fator com maior perda e revisar os anúncios responsáveis antes de alterar a verba da campanha."
      : "Revisar os anúncios que puxam o retorno para baixo e usar os últimos 3 dias para confirmar se a recuperação se sustenta.";
    return { windows, inventory, decision: "investigate", opportunity: false, reason, action };
  }
  if (opportunity && inventory.scaleReady && !recentChange) {
    return { windows, inventory, decision: "scale", opportunity,
      reason: `${summary} Os destinos verificados têm grade completa e o saldo projeta pelo menos ${decimal.format(inventory.coverageDays!)} dias no giro atual.`,
      action: "Testar aumento de 15% a 20% e revisar ROAS, CPA e grade em 72 h." };
  }
  if (limited) {
    const runway = limited.coverageDays === null ? "O giro registrado ainda é insuficiente para estimar a cobertura restante."
      : `A cobertura projetada do saldo restante é de ${decimal.format(limited.coverageDays)} dias no giro atual da loja.`;
    return { windows, inventory, decision: "maintain", opportunity, reason: `${limited.name} tem grade interrompida. ${runway}`,
      action: "Preservar a verba e concentrar a oferta nas variantes disponíveis. Revisar a veiculação se a cobertura piorar." };
  }
  return { windows, inventory, decision: "maintain", opportunity, reason: recentChange
    ? `${summary} Houve uma alteração recente na estrutura; a leitura pós-ajuste está em andamento.`
    : opportunity
      ? `${summary} A mídia comporta um teste de escala. A grade, o vínculo ou a cobertura de estoque ainda não dão suporte à ampliação.`
      : windows.filter(({ roas }) => roas !== null).length < 3
        ? `${summary} As janelas disponíveis ainda não dão volume suficiente para uma alteração.`
        : `${summary} As janelas e o volume desta leitura sustentam a verba atual.`,
    action: opportunity ? "Manter a verba até a próxima conferência de estoque e grade dos destinos." : "Manter e rever na análise diária." };
}
