import { syncManagerDpaSet } from "./up-manager-dpa";
import { entityDays, firstMediaBreak } from "./up-manager-timeline";
import { fetchManagerMetaAdDays, type MetaAdMetric } from "./meta-ads";
import { hasClosedOrders, funnelFingerprint } from "./up-manager-source-readiness";
import { applyMediaOpportunities } from "./up-manager-media-opportunities";
import { buildCampaignEvaluation, buildCampaignWindows, campaignInventoryContext, campaignPeriod, campaignWindows } from "./up-manager-campaign-evaluation";
import { diagnoseCampaignDecline } from "./up-manager-campaign-diagnosis";
import { readAgencyMediaBenchmark } from "./up-manager-media-benchmark";
import { indexLandingEvidence, instrumentedLandingPages, landingEvidenceFor, managerDestinations } from "./up-manager-landing";
import { buildStoreDecline } from "./up-manager-store-decline";
import { enrichCroFinding } from "./up-manager-cro-diagnosis";
import { readPublicAssortments } from "./up-manager-public-assortment";
import { auctionReferencePeriods, buildAuctionSeasonality, evaluateAuction } from "./up-manager-auction";
import { saoPauloDateOnlyStart } from "../lib/reporting-period";
import { reportFunnelStages } from "./up-manager-funnel-stages";
import { weeklyManagerPlan } from "./up-manager-workflow";
import { addDaysToDateOnly } from "../lib/reporting-period";
import { localized, matchProductUrl, safeUrl } from "./product-campaign-analysis";
import { fetchManagerCategories, fetchManagerCoupons } from "./product-campaign-sources";
import {
  buildAbc,
  catalogSnapshot,
  compareCatalog,
  sellableInventory,
  type CatalogSnapshot,
} from "./up-manager-b2c-products";
import {
  endingOn,
  readCohorts,
  readCommerceFreshness,
  readFunnel,
  readOrderContext,
  readRetentionSegments,
  readManagerGa4Connection,
  readWarehouseCheckoutDiagnostic,
} from "./up-manager-b2c-data";
import {
  priorPeriod,
  rankManagerProducts,
  readCatalog,
  readManagerOverview,
  readMedia,
  managerMetaToken,
  readVariantSales,
  type ManagerClient,
  type ManagerPeriod,
} from "./up-manager";
import type { getProductCampaignCheck } from "./product-campaign-monitor";

import { buildGradeFindings, criticalGradeAdDecisions, type GradeEvidence } from "./up-manager-grade";

import { decideManagerCampaigns } from "./up-manager-campaign-decisions";
import {
  buildGrowthDecisions,
  evaluateManagerFunnel,
  explainProductRevenue,
} from "./up-manager-growth-decisions";

import {
  buildCreativeReview,
  collectActiveManagerAds,
} from "./up-manager-creatives";
import { gradeSummaryFinding } from "./up-manager-grade";

import { fetchGa4CheckoutDiagnostic, fetchGa4LandingEvidence } from "./ga4";
import { diagnoseCheckout, type CheckoutDiagnosis } from "./up-manager-funnel-diagnostic";

import { getGa4ProductViews } from "./ga4-daily-sync";
import { groupProductTraffic, type ProductDestination } from "./up-manager-product-traffic";
import { applyCampaignWatch } from "./up-manager-campaign-watch";
import { readManagerShipping, shippingFinding } from "./up-manager-shipping-insights";

import { buildPaidMediaReview, resolveMediaActions, buildPaidMediaFinding, type PaidMediaRow } from "./up-manager-paid-media";
import { combinePaidMediaChanges, evaluatePaidMediaChanges, readAppliedManagerMediaChanges, readPaidMediaChanges, readPaidMediaHistory, seedPaidMediaHistory } from "./up-manager-media-learning";

export const B2C_VERSION = "up-b2c-v35";

function readManagerInputs<const T extends readonly (() => unknown)[]>(inputs: T, concurrency: number) {
  const workers: Promise<unknown>[] = Array.from({ length: Math.min(concurrency, inputs.length) }, () => Promise.resolve());
  return Promise.all(inputs.map((read, index) => {
    const worker = index % workers.length;
    const pending = workers[worker].then(read);
    workers[worker] = pending.catch(() => undefined);
    return pending;
  })) as Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }>;
}
const AMOUNT = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const pct = (amount: number) => `${AMOUNT.format(amount * 100)}%`;
const ratio = (n: number, d: number) => (d > 0 ? n / d : null);

type CouponSnapshot = Awaited<ReturnType<typeof fetchManagerCoupons>>;
export type CommercialSnapshot = {
  catalog: CatalogSnapshot | null;
  stockObservedAt: string | null;
  coupons: CouponSnapshot | null;
};
export interface B2cFinding {
  id: string;
  title: string;
  evidence: string;
  action: string;
  clientDraft?: string;
  section: "campaigns" | "products" | "analysis";
  priority: "P0" | "P1" | "P2";
  hypothesis: string;
  owner: string;
  followUp: string;
  grade?: GradeEvidence;
  diagnosis?: CheckoutDiagnosis;
  focus?: "campaigns" | "stock" | "funnel" | "acquisition" | "retention";
}

function parseRate(value: string | undefined, fallback: number) {
  const numeric = Number(value);
  return value && numeric > 0 && numeric <= 1 ? numeric : fallback;
}

function rules() {
  const a = parseRate(process.env.UP_MANAGER_ABC_A, 0.8);
  const b = parseRate(process.env.UP_MANAGER_ABC_B, 0.95);
  const reactivation = Number(process.env.UP_MANAGER_REACTIVATION_DAYS);
  return {
    abc: a < b ? { a, b } : { a: 0.8, b: 0.95 },
    realization: parseRate(process.env.UP_MANAGER_REALIZATION_RATE, 0.3),
    reactivationDays:
      Number.isInteger(reactivation) && reactivation >= 1 && reactivation <= 365
        ? reactivation
        : 90,
  };
}

function periodReference(period: ManagerPeriod, scheduled: boolean) {
  if (!scheduled) return priorPeriod(period);
  const day = addDaysToDateOnly(period.dateTo, -7);
  return { dateFrom: day, dateTo: day };
}

function couponChanges(
  current: CouponSnapshot | null,
  prior: CouponSnapshot | null,
) {
  if (!current || !prior) return null;
  const before = new Map(prior.items.map((item) => [item.id, item]));
  const after = new Map(current.items.map((item) => [item.id, item]));
  return [
    ...current.items.flatMap((item) => {
      const value = before.get(item.id);
      if (value?.terms === item.terms) return [];
      return [
        {
          id: item.id,
          status: value ? "changed" : "entered",
          freeShipping: item.freeShipping,
        },
      ];
    }),
    ...prior.items
      .filter((item) => !after.has(item.id))
      .map((item) => ({
        id: item.id,
        status: "left",
        freeShipping: item.freeShipping,
      })),
  ];
}

function commercialChanges(
  current: CommercialSnapshot,
  previous: CommercialSnapshot | null,
) {
  return {
    previousObservedAt:
      previous?.stockObservedAt ?? previous?.coupons?.observedAt ?? null,
    currentObservedAt:
      current.stockObservedAt ?? current.coupons?.observedAt ?? null,
    previousCouponObservedAt: previous?.coupons?.observedAt ?? null,
    currentCouponObservedAt: current.coupons?.observedAt ?? null,
    catalog: compareCatalog(current.catalog, previous?.catalog ?? null),
    coupons: couponChanges(current.coupons, previous?.coupons ?? null),
  };
}

type Overview = Awaited<ReturnType<typeof readManagerOverview>>;
type PeriodMetrics = Overview["metrics"];

function compareMetrics(metrics: PeriodMetrics, previous: PeriodMetrics) {
  return Object.fromEntries(
    Object.entries(metrics).map(([key, value]) => {
      const prior = previous[key as keyof PeriodMetrics];
      return [
        key,
        value === null || prior === null
          ? null
          : {
              absolute: value - prior,
              percent: prior > 0 ? (value - prior) / prior : null,
            },
      ];
    }),
  );
}

function decompose(
  metrics: PeriodMetrics,
  prior: PeriodMetrics,
  funnel: Awaited<ReturnType<typeof readFunnel>>,
) {
  const { current, previous } = funnel;
  if (prior.averageOrder === null || (metrics.averageOrder === null && metrics.orders > 0)) return null;
  const ticket = metrics.averageOrder === null ? 0 : metrics.orders * (metrics.averageOrder - prior.averageOrder);
  const orderVolume = (metrics.orders - prior.orders) * prior.averageOrder;
  if (
    !current ||
    !previous ||
    current.sessions <= 0 ||
    previous.sessions <= 0
  ) {
    return { orderVolume, ticket, traffic: null, ordersPerSession: null };
  }
  const currentRate = metrics.orders / current.sessions;
  const priorRate = prior.orders / previous.sessions;
  // Sequential bridge using approved orders per GA4 session as a comparison proxy.
  return {
    orderVolume,
    ticket,
    traffic:
      (current.sessions - previous.sessions) * priorRate * prior.averageOrder,
    ordersPerSession:
      current.sessions * (currentRate - priorRate) * prior.averageOrder,
  };
}

function funnelRates(
  funnel: Awaited<ReturnType<typeof readFunnel>>["current"],
) {
  if (!funnel) return null;
  return {
    ...funnel,
    purchasesPerSession: ratio(funnel.purchases, funnel.sessions),
    cartsPerProductView: ratio(funnel.addToCarts, funnel.productViews),
    checkoutEventsPerCart: ratio(funnel.checkouts, funnel.addToCarts),
    purchaseEventsPerCheckout: ratio(funnel.purchases, funnel.checkouts),
  };
}

function mediaCampaigns(overview: Overview) {
  const previous = new Map(
    overview.reportMedia?.previousCampaigns?.map((item) => [item.id, item]),
  );
  return (
    overview.campaigns?.map((item) => ({
      id: item.id,
      name: item.name,
      spend: item.spend,
      roas: item.roas,
      purchases: item.purchases,
      attributedRevenue: item.revenue,
      ctr: ratio(item.clicks, item.impressions),
      cpc: ratio(item.spend, item.clicks),
      cpm: ratio(item.spend * 1_000, item.impressions),
      previousSpend: overview.reportMedia?.previous
        ? (previous.get(item.id)?.spend ?? 0)
        : null,
      previousRoas: previous.get(item.id)?.roas ?? null,
    })) ?? null
  );
}

export async function buildB2cReport(
  client: ManagerClient,
  period: ManagerPeriod,
  scheduled: boolean,
  today: string,
  monitor: Awaited<ReturnType<typeof getProductCampaignCheck>>,
  previousSnapshot: CommercialSnapshot | null,
  backfillTimeline = false,
) {
  const settings = rules();
  const reference = periodReference(period, scheduled);
  const closed = period.dateTo < today;
  const end = closed ? period.dateTo : addDaysToDateOnly(today, -1);
  const day7 = endingOn(end, 7);
  const day14 = endingOn(end, 14);
  // Exclude the two most recent closed days to allow Meta attribution to mature.
  const matureWeek = endingOn(addDaysToDateOnly(end, -2), 7);
  const matureReference = priorPeriod(matureWeek);
  const recentWindow = campaignPeriod(end, 3);
  const auctionPeriods = auctionReferencePeriods(end);
  const month = { dateFrom: `${end.slice(0, 7)}-01`, dateTo: end };
  const sales = new Map<string, ReturnType<typeof readVariantSales>>();
  const loadSales = (window: ManagerPeriod) => {
    const key = `${window.dateFrom}:${window.dateTo}`;
    const existing = sales.get(key);
    if (existing) return existing;
    const pending = readVariantSales(client.id, window);
    sales.set(key, pending);
    return pending;
  };
  const orderContext = (window: ManagerPeriod) =>
    readOrderContext(client.id, window, settings.reactivationDays);
  const [
    overview,
    catalog,
    coupons,
    selected,
    weekly,
    priorWeekly,
    fortnightly,
    priorFortnightly,
    current,
    previous,
    cohorts,
    commerce,
    funnel,
    monthContext,
    selectedPrior,
    matureOverview,
    retentionSegments,
    ga4Connection,
    shipping,
    mediaChanges,
    paidHistory,
    confirmedMediaChanges,
    campaignMedia,
    previousAudienceMedia,
    auctionReferenceMedia,
    auctionBaseline,
    auctionPreviousYear,
  ] = await readManagerInputs([
    () => readManagerOverview(client, period, { previousPeriod: reference }),
    () => readCatalog(client),
    () => client.storeId && client.storeToken
      ? fetchManagerCoupons(client.storeId, client.storeToken).catch(() => null)
      : null,
    () => loadSales(period),
    () => loadSales(day7),
    () => loadSales(priorPeriod(day7)),
    () => loadSales(day14),
    () => loadSales(priorPeriod(day14)),
    () => orderContext(period),
    () => orderContext(reference),
    () => readCohorts(client.id, end),
    () => readCommerceFreshness(client.id, client.commercePlatform),
    () => readFunnel(client.id, period, reference),
    () => orderContext(month),
    () => loadSales(reference),
    () => readManagerOverview(client, matureWeek, {
      previousPeriod: matureReference,
    }),
    () => readRetentionSegments(client.id, end, settings.reactivationDays),
    () => readManagerGa4Connection(client.id),
    () => readManagerShipping(client, day7).catch(() => null),
    () => readPaidMediaChanges(client, today),
    () => readPaidMediaHistory(client.id, today).catch(() => ({ reviews: [], seeded: [], events: [], perEntity: [] })),
    () => readAppliedManagerMediaChanges(client.id, today).catch(() => []),
    () => Promise.all(campaignWindows.map((days) => readMedia(client, campaignPeriod(end, days)))),
    () => readMedia(client, priorPeriod(campaignPeriod(end, 30))),
    () => readMedia(client, auctionPeriods.recentReference),
    () => readMedia(client, auctionPeriods.baseline, true),
    () => readMedia(client, auctionPeriods.previousYear, true),
  ], client.commercePlatform === "BRAAVO" ? 3 : 32);
  const snapshot = {
    catalog: catalog ? catalogSnapshot(catalog.products) : null,
    stockObservedAt: catalog?.observedAt ?? null,
    coupons,
  };
  const commercial = commercialChanges(snapshot, previousSnapshot);
  const inventory = sellableInventory(snapshot.catalog);
  const abc7 = buildAbc(
    7,
    weekly,
    priorWeekly,
    catalog?.products ?? null,
    settings.abc,
  );
  const abc14 = buildAbc(
    14,
    fortnightly,
    priorFortnightly,
    catalog?.products ?? null,
    settings.abc,
  );
  const closedWithOrders = closed && hasClosedOrders(commerce, period.dateTo);
  const currentFunnel = funnelRates(funnel.current);
  const previousFunnel = funnelRates(funnel.previous);
  const targetMer =
    overview.metrics.orders >= 5 && closedWithOrders
      ? overview.metrics.mer
      : null;
  const scenarios =
    inventory && inventory.unknownVariants === 0 && closedWithOrders
      ? [
          {
            name: "Conservador",
            rate: settings.realization * 0.67,
            mer: targetMer === null ? null : targetMer * 0.85,
          },
          { name: "Base", rate: settings.realization, mer: targetMer },
          {
            name: "Otimista",
            rate: Math.min(1, settings.realization * 1.33),
            mer: targetMer === null ? null : targetMer * 1.15,
          },
        ].map((caseItem) => {
          const revenue = Math.round(inventory.pricedValue * caseItem.rate);
          return {
            ...caseItem,
            revenue,
            mediaBudget:
              caseItem.mer === null ? null : Math.round(revenue / caseItem.mer),
          };
        })
      : [];
  const findings: B2cFinding[] = [];
  const add = (item: B2cFinding) => findings.push(item);
  const campaignPlan = decideManagerCampaigns({
    media: matureOverview.reportMedia?.currentData ?? null,
    previousMedia: matureOverview.reportMedia?.previousData ?? null,
    monitor,
    currency: client.currency,
    window: matureWeek,
  });
  const creativeReview = buildCreativeReview({
    activeAds:
      !monitor.stale && monitor.snapshot?.currency === client.currency
        ? collectActiveManagerAds(monitor.snapshot)
        : [],
    media: matureOverview.reportMedia?.currentData ?? null,
    previousMedia: matureOverview.reportMedia?.previousData ?? null,
    currency: client.currency,
    window: matureWeek,
  });
  const roasReview = buildPaidMediaReview({
    current: matureOverview.reportMedia?.currentData ?? null,
    previous: matureOverview.reportMedia?.previousData ?? null,
    snapshot: monitor.stale ? null : monitor.snapshot,
    currency: client.currency,
    window: matureWeek,
    previousWindow: matureReference,
  });
  const monitorSnapshot = monitor.stale ? null : monitor.snapshot;
  const campaignReviews = buildCampaignWindows(campaignMedia, end, monitorSnapshot, client.currency);
  const auctionReference = buildPaidMediaReview({ current: auctionReferenceMedia, previous: null,
    snapshot: monitorSnapshot, currency: client.currency, window: auctionPeriods.recentReference, previousWindow: priorPeriod(auctionPeriods.recentReference) });
  roasReview.auctionSeasonality = buildAuctionSeasonality(campaignMedia[2], auctionBaseline, auctionPreviousYear, end);
  roasReview.recentWindow = recentWindow;
  roasReview.multiWindowEnd = end;
  const rowKey = (row: PaidMediaRow) => `${row.level}:${row.id}`;
  const allRows = new Map(roasReview.rows.map((row) => [rowKey(row), row]));
  for (const days of campaignWindows) {
    for (const row of campaignReviews[days].rows) {
      if (!allRows.has(rowKey(row))) allRows.set(rowKey(row), row);
    }
  }
  const inventoryContext = campaignInventoryContext(monitorSnapshot, snapshot.catalog, weekly, fortnightly);
  const dayRows = [
    ...(overview.reportMedia?.currentData?.ads ?? []), ...(overview.reportMedia?.previousData?.ads ?? []),
  ];
  const token = backfillTimeline && closed && scheduled ? managerMetaToken(client) : null;
  const backfill = token && client.accountId ? await fetchManagerMetaAdDays(token, client.accountId,
    addDaysToDateOnly(end, -13), end).catch(() => null) : null;
  const deduplicated = new Map<string, MetaAdMetric>();
  for (const row of [...backfill ?? [], ...dayRows]) {
    if (row.dateStart === row.dateStop) deduplicated.set(`${row.dateStart}:${row.id}`, row);
  }
  const perEntity = entityDays([...deduplicated.values()], client.currency);
  const mediaLog = combinePaidMediaChanges(mediaChanges, paidHistory.events, today, confirmedMediaChanges);
  const learningWindows = await seedPaidMediaHistory(client, mediaLog.events, roasReview, paidHistory);
  const matureEntityDays = [...paidHistory.perEntity].reverse().concat(perEntity).filter(({ date }) => date <= matureWeek.dateTo);
  const learning = evaluatePaidMediaChanges(mediaLog.events, roasReview, [...paidHistory.reviews, ...learningWindows], mediaLog.source, matureEntityDays);
  const entitySeries = new Map<string, typeof matureEntityDays>();
  for (const day of matureEntityDays) {
    const key = `${day.level}:${day.id}`;
    const series = entitySeries.get(key) ?? [];
    series.push(day);
    entitySeries.set(key, series);
  }
  const recentChanges = mediaLog.events.filter((change) => change.day >= recentWindow.dateFrom);
  const gradeFindings = buildGradeFindings(snapshot.catalog, abc14, monitor, snapshot.stockObservedAt, fortnightly);
  const criticalGrades = criticalGradeAdDecisions(catalog, monitorSnapshot, gradeFindings);
  const stockPauses = new Map(campaignPlan.findings.filter((item) =>
    item.id.startsWith("ad-decision:") || (item.id.startsWith("campaign-decision:") && item.priority === "P0"),
  ).map((item) => [item.id, item]));
  roasReview.rows = [...allRows.values()].map((row): PaidMediaRow => {
    if (row.status !== "active") return row;
    const critical = row.level === "ad" ? criticalGrades.get(row.id) : undefined;
    const finding = critical ?? stockPauses.get(`${row.level}-decision:${row.id}`);
    const stock = finding ? { ...row, pauseReason: "stock" as const, recommendation: "pause" as const,
      driver: finding.evidence, action: finding.action } : row;
    const changed = recentChanges.some((event) =>
      (event.level === row.level && event.id === row.id) ||
      (event.level === "campaign" && event.id === row.campaignId) ||
      (event.level === "adset" && event.id === row.adsetId));
    const evaluation = buildCampaignEvaluation(stock, campaignReviews, inventoryContext, changed);
    const actionable = evaluation.decision === "maintain" || evaluation.decision === "investigate" || stock.pauseReason === "stock" || roasReview.accountPriceComparable;
    const recommendation = actionable ? evaluation.decision : "investigate";
    return { ...stock, evaluation: actionable ? evaluation : {
      ...evaluation, decision: "investigate", reason: `${evaluation.reason} A moeda ou a cobertura da conta ainda precisa de confirmação para alterar a mídia.`,
      action: "Validar a cobertura e a moeda da conta antes de aplicar a alteração sugerida.",
    }, recommendation, driver: actionable ? evaluation.reason : "Moeda ou cobertura da conta indisponível.",
      action: actionable ? evaluation.action : "Validar a cobertura e a moeda da conta antes de aplicar a alteração sugerida.",
      pauseReason: recommendation === "pause" ? (stock.pauseReason === "stock" ? "stock" : "performance") : undefined,
      pauseEvidence: recommendation !== "pause" ? undefined : critical ? "critical-grade" : stock.pauseReason !== "stock" ? "multiWindow" : undefined };
  });
  const previousAudienceWindow = priorPeriod(campaignPeriod(end, 30));
  const previousAudienceReview = previousAudienceMedia ? buildPaidMediaReview({
    current: previousAudienceMedia, previous: null, snapshot: monitorSnapshot, currency: client.currency,
    window: previousAudienceWindow, previousWindow: priorPeriod(previousAudienceWindow),
  }) : null;
  await applyMediaOpportunities(client, roasReview, campaignReviews, inventoryContext, catalog, mediaLog.events, {
    previous: previousAudienceReview,
    products: abc14.products.filter(({ abc, grade, coverageDays }) => abc === "A" && (client.commercePlatform === "BRAAVO" || (grade === "complete" && (coverageDays ?? 0) >= 7)))
      .slice(0, 16).map(({ name }) => name),
    funnel: { checkouts: currentFunnel?.checkouts ?? 0, purchases: currentFunnel?.purchases ?? 0, window: period },
  });
  roasReview.rows = resolveMediaActions(roasReview.rows).map((row) => {
    if (row.evaluation && row.recommendation === "monitor") {
      const evaluation = { ...row.evaluation, decision: "investigate" as const,
        reason: `${row.evaluation.reason} A mudança deve ser feita no nível mais específico ou já está coberta pela decisão principal.`,
        action: "Seguir a decisão indicada no item responsável pela entrega antes de alterar a estrutura inteira.",
      };
      return { ...row, recommendation: "investigate", evaluation, driver: evaluation.reason, action: evaluation.action };
    }
    return row;
  });
  const needDiagnosis = roasReview.rows.filter((row) => row.evaluation && (row.recommendation === "investigate" || row.recommendation === "scale" ||
    (row.recommendation === "pause" && row.pauseReason === "performance")));
  const previousWeek = priorPeriod(day7);
  const pages = managerDestinations(monitorSnapshot, client.currency);
  const property = client.ga4PropertyId ?? funnel.propertyId;
  const addressable = roasReview.rows.filter((row) => row.level === "campaign" && row.status === "active" && row.evaluation).slice(0, 30);
  const campaignTags = [...new Set(addressable.flatMap(({ id, name }) => [id, name, name.replace(/ /g, "+")]))];
  const [weeklyFunnel, agencyBenchmark, pageAnalytics, categories, campaignFunnel, productViews] = await Promise.all([
    readFunnel(client.id, day7, previousWeek).catch(() => null),
    readAgencyMediaBenchmark(client, day7).catch(() => null),
    property ? fetchGa4LandingEvidence(property, pages.slice(0, 65), day7, previousWeek, campaignTags).catch(() => null) : null,
    client.storeId && client.storeToken && (pages.length || campaignTags.length) ? fetchManagerCategories(client.storeId, client.storeToken, AbortSignal.timeout(10_000)).catch(() => null) : null,
    property && needDiagnosis.length ? readWarehouseCheckoutDiagnostic(client.id, property, day7, previousWeek).catch(() => null) : null,
    property ? getGa4ProductViews({ clientId: client.id, propertyId: property, ...day7 }).catch(() => null) : null,
  ]);
  roasReview.agencyBenchmark = agencyBenchmark;
  const trackedPages = instrumentedLandingPages(pages, pageAnalytics, monitorSnapshot);
  const publicAssortments = client.commercePlatform === "BRAAVO" ? await readPublicAssortments(client.id, trackedPages) : undefined;
  const destinations = indexLandingEvidence(trackedPages, pageAnalytics, catalog, categories ?? catalog?.categories ?? [],
    snapshot.catalog, previousSnapshot?.catalog ?? null, publicAssortments);
  const productDestinations = new Map<string, ProductDestination>();
  const catalogAds = new Set(monitorSnapshot?.unidentified.filter(({ ad }) => ad.catalog && ad.effectiveStatus === "ACTIVE").map(({ ad }) => ad.id) ?? []);
  for (const { page, directProductId } of destinations) {
    if (!directProductId || !page.urls[0]) continue;
    const destination = productDestinations.get(directProductId) ?? { url: page.urls[0], ads: [] };
    for (const ad of page.derived ? [] : page.ads) {
      const direct = ad.urls.some((raw) => {
        if (catalog?.domains.length) return String(matchProductUrl(raw, catalog.domains, catalog.products)?.product.id) === directProductId;
        const url = safeUrl(raw);
        return url && url.hostname.replace(/^www\./, "") === page.host && (url.pathname.replace(/\/$/, "") || "/") === page.path;
      });
      if (!direct) continue;
      if (ad.catalog || ad.effectiveStatus !== "ACTIVE" || destination.ads.some(({ adId }) => adId === ad.id)) continue;
      destination.ads.push({ adId: ad.id, adName: ad.name, adsetName: ad.adsetName, campaignName: ad.campaignName,
        affected: false, pauseEligible: false });
    }
    productDestinations.set(directProductId, destination);
  }
  const storeDomain = catalog?.domains[0];
  const storeUrl = storeDomain ? safeUrl(storeDomain.includes("://") ? storeDomain : `https://${storeDomain}`) : null;
  if (storeUrl && !storeUrl.port) {
    for (const product of catalog?.products ?? []) {
      const id = String(product.id);
      const handle = localized(product.handle);
      if (handle && !productDestinations.has(id)) productDestinations.set(id, {
        url: new URL(`/produtos/${encodeURIComponent(handle)}/`, storeUrl.origin).href, ads: [],
      });
    }
  }
  const grades = new Map(gradeFindings.flatMap((finding) => {
    const { grade } = finding;
    if (!grade) return [];
    const destination = productDestinations.get(grade.productId);
    if (destination) {
      grade.productUrl = destination.url;
      const exactAds = new Map(grade.ads?.map((ad) => [ad.adId, ad]));
      for (const ad of destination.ads) if (!exactAds.has(ad.adId)) exactAds.set(ad.adId, { ...ad, affected: true });
      grade.ads = [...exactAds.values()];
      const observed = grade.ads.filter(({ affected }) => affected).length;
      if (observed > grade.campaignCount) {
        finding.evidence += ` Destino de produto confirmado em ${observed} anúncio(s) ativo(s).`;
        grade.campaignCount = observed;
        finding.priority = grade.confirmedOutOfStock ? "P0" : "P1";
        finding.owner = "Mídia e e-commerce";
      }
    }
    return [[grade.productId, grade] as const];
  }));
  const productTraffic = groupProductTraffic(productViews, catalog?.products ?? [], snapshot.catalog, grades, productDestinations, day7, catalogAds.size, publicAssortments?.values());
  const visitedWithBreaks = productTraffic?.items.filter(({ status }) => status === "broken" || status === "out_of_stock") ?? [];
  if (visitedWithBreaks.length) {
    const first = visitedWithBreaks[0];
    add({
      id: "visited-products-grade", title: "Produtos mais vistos com quebra de grade", section: "products", focus: "stock", priority: "P1",
      evidence: `${first.name}: ${first.views.toLocaleString("pt-BR")} visualizações em 7 dias, ${first.status === "out_of_stock" ? "esgotado" : "com opções sem saldo"}. ${visitedWithBreaks.length} entre os produtos mais vistos da lista.`,
      hypothesis: "O GA4 mediu as visualizações do item. O saldo vem do catálogo ou da vitrine para os SKUs identificados.",
      action: catalogAds.size ? "Priorizar os itens da lista. Conferir se os SKUs afetados fazem parte de conjuntos de produtos dos anúncios de catálogo ativos e excluir os indisponíveis quando o vínculo for confirmado."
        : "Revisar o destaque dos itens esgotados na loja e priorizar variantes disponíveis com maior procura.",
      owner: "E-commerce e mídia", followUp: "Cruzar o saldo e o tráfego no próximo diagnóstico.",
    });
  }
  for (const row of roasReview.rows) {
    if (!row.evaluation) continue;
    row.evaluation.auction = evaluateAuction(row, campaignReviews, auctionReference);
    const breakpoint = firstMediaBreak(entitySeries.get(rowKey(row)) ?? []);
    if (breakpoint) row.evaluation.breakpoint = breakpoint;
    row.evaluation.destinations = landingEvidenceFor(row, destinations);
    if (needDiagnosis.includes(row) || row.evaluation.auction?.trend === "decline") diagnoseCampaignDecline(row, campaignReviews, {
      currency: client.currency, stockObservedAt: snapshot.stockObservedAt, changes: commercial.catalog,
      destinations: row.evaluation.destinations, campaignFunnel, coupons: commercial.coupons, shipping, mediaEvents: mediaLog.events, maturePeriods: roasReview,
    });
    applyCampaignWatch(row, client.currency);
  }
  const executableCampaigns = campaignPlan.decisions.flatMap((item) => {
    const row = roasReview.rows.find((row) => row.level === "campaign" && row.id === item.id);
    if (row?.recommendation !== "pause" && row?.recommendation !== "scale") return [];
    return [{ ...item, decision: row.recommendation, reason: row.driver }];
  });
  const executableCampaignPlan = { ...campaignPlan, decisions: executableCampaigns };
  const weeklyPlan = await weeklyManagerPlan(client, {
    operating: executableCampaignPlan,
    roas: roasReview,
    creative: creativeReview,
    now: saoPauloDateOnlyStart(today),
  }).catch(() => null);
  const paidFinding = buildPaidMediaFinding(roasReview);
  if (paidFinding) add(paidFinding);
  const audiences = roasReview.audienceTests ?? [];
  if (audiences.length) {
    const first = audiences[0];
    const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
    const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: client.currency });
    add({
      id: "paid-media-audiences", title: "Testar Lookalike com histórico favorável",
      section: "campaigns", focus: "campaigns", priority: "P2",
      evidence: `${first.name} · ${first.purchases} compras atribuídas · ROAS ${number.format(first.roas)}× contra ${number.format(first.referenceRoas)}× em outros conjuntos das mesmas campanhas · CPA ${money.format(first.cpa)} contra ${money.format(first.referenceCpa)} nos últimos 30 dias fechados.`,
      hypothesis: "A associação observada sustenta um teste controlado com criativo e oferta comparáveis.",
      action: first.action, owner: "Gestão de mídia",
      followUp: "Medir o CPA e o ROAS do teste e do controle na primeira janela madura.",
    });
  }
  findings.push(...gradeFindings);
  const gradeSummary = gradeSummaryFinding(gradeFindings);
  if (gradeSummary) findings.push(gradeSummary);
  const { metrics, previous: baseline } = overview;
  const bridge = closedWithOrders ? decompose(metrics, baseline, funnel) : null;
  const revenueContext = closedWithOrders
    ? explainProductRevenue(
        rankManagerProducts(selected, [], Infinity),
        rankManagerProducts(selectedPrior, [], Infinity),
      )
    : null;
  if (closedWithOrders) {
    const revenueFinding = buildStoreDecline({
      overview, bridge, funnel, period, reference, currency: client.currency, revenueContext,
      catalogChanges: commercial.catalog, couponChanges: commercial.coupons?.length ?? null, shipping,
      orders: { current, previous },
      basketUnits: { current: selected.reduce((sum, item) => sum + item.units, 0),
        previous: selectedPrior.reduce((sum, item) => sum + item.units, 0) },
    });
    if (revenueFinding) add(revenueFinding);
  }
  let funnelEvaluation = evaluateManagerFunnel(
    funnel,
    current,
    previous,
    closedWithOrders,
  );
  let diagnosticFunnel = funnel;
  let funnelPeriod = period;
  let funnelReference = reference;
  let approval = closedWithOrders ? { before: previous, after: current } : null;
  const weeklyEvaluation = weeklyFunnel && evaluateManagerFunnel(weeklyFunnel, current, previous, closedWithOrders);
  if (weeklyFunnel && weeklyEvaluation?.finding?.id === "funnel-bottleneck" && funnelEvaluation.finding?.id !== "funnel-bottleneck") {
    const orders = await Promise.all([orderContext(day7), orderContext(previousWeek)]).catch(() => null);
    diagnosticFunnel = weeklyFunnel;
    funnelPeriod = day7;
    funnelReference = previousWeek;
    approval = orders ? { before: orders[1], after: orders[0] } : null;
    funnelEvaluation = orders ? evaluateManagerFunnel(weeklyFunnel, orders[0], orders[1], closedWithOrders) : weeklyEvaluation;
  }
  const funnelFinding = funnelEvaluation.finding;
  let checkoutDiagnosis: CheckoutDiagnosis | null = null;
  let funnelDetail: Awaited<ReturnType<typeof fetchGa4CheckoutDiagnostic>> = null;
  const initialStages = reportFunnelStages(diagnosticFunnel);
  if (initialStages.some(({ id, movement }) => id !== "productViews" && movement === "worsened") &&
    property && diagnosticFunnel.current && diagnosticFunnel.previous) {
    const expected = {
      current: { carts: diagnosticFunnel.current.addToCarts, checkouts: diagnosticFunnel.current.checkouts },
      previous: { carts: diagnosticFunnel.previous.addToCarts, checkouts: diagnosticFunnel.previous.checkouts },
    };
    const stock = snapshot.catalog && snapshot.stockObservedAt ? {
      observedAt: snapshot.stockObservedAt,
      variants: new Map(snapshot.catalog.map(({ key, stock }) => [key.slice(key.lastIndexOf(":") + 1), stock])),
    } : undefined;
    if (process.env.UP_MANAGER_GA4_DIAGNOSTICS === "1") {
      funnelDetail = await fetchGa4CheckoutDiagnostic(property, funnelPeriod, funnelReference).catch(() => null);
    }
    const checkoutDropped = initialStages.some(({ id, movement }) => id === "checkouts" && movement === "worsened");
    if (checkoutDropped && funnelDetail) checkoutDiagnosis = diagnoseCheckout(funnelDetail, expected, stock);
    if (!funnelDetail || (checkoutDropped && !checkoutDiagnosis)) {
      const warehouse = funnelPeriod === day7 && campaignFunnel ? campaignFunnel :
        await readWarehouseCheckoutDiagnostic(client.id, property, funnelPeriod, funnelReference).catch(() => null);
      funnelDetail ??= warehouse;
      if (checkoutDropped && warehouse) checkoutDiagnosis ??= diagnoseCheckout(warehouse, expected, stock);
    }
    if (checkoutDiagnosis && funnelFinding?.id === "funnel-bottleneck" && funnelEvaluation.weakest?.stage === "Carrinho → checkout") {
      funnelFinding.diagnosis = checkoutDiagnosis;
      funnelFinding.hypothesis = funnelFinding.evidence;
      funnelFinding.action = checkoutDiagnosis.action;
      funnelFinding.followUp = checkoutDiagnosis.followUp;
    }
  }
  if (funnelFinding?.id === "funnel-bottleneck" && funnelEvaluation.weakest) enrichCroFinding(funnelFinding, funnelEvaluation.weakest.stage,
    funnelDetail, { current: funnelPeriod, previous: funnelReference }, shipping, approval);
  if (funnelFinding) add(funnelFinding);
  const freightFinding = shipping ? shippingFinding(shipping) : null;
  if (freightFinding) {
    add(freightFinding);
  }
  const cohortRates = cohorts.map((row) => ({
    ...row,
    repeatRate: ratio(row.repeatBuyers, row.buyers),
  }));
  findings.push(
    ...buildGrowthDecisions({
      trend: matureOverview,
      campaigns: executableCampaignPlan,
      segments: retentionSegments,
      cohorts: cohortRates,
      abc: abc14,
      currency: client.currency,
      confirmed: closedWithOrders,
      dormantDays: settings.reactivationDays,
    }),
  );
  findings.sort((a, b) => a.priority.localeCompare(b.priority));
  const limitations = [
    ...(!closed
      ? ["Período aberto. As variações principais aguardam fechamento."]
      : []),
    ...(!closedWithOrders && closed
      ? [
          "A última sincronização conhecida da loja não confirma cobertura do fechamento. Os valores observados podem ser parciais.",
        ]
      : []),
    ...(!currentFunnel || !previousFunnel
      ? [
          ga4Connection?.issue === "permission"
            ? "GA4 cadastrado, com permissão recusada na última sincronização."
            : "GA4 sem cobertura completa em uma ou ambas as janelas.",
        ]
      : []),
    ...(!funnel.channels || !funnel.products
      ? ["Recortes GA4 por canal ou produto sem cobertura completa."]
      : []),
    "Funil por dispositivo requer uma fonte GA4 com esse recorte.",
    "Prazos de reposição dependem de um calendário de compras ou fornecedor. O catálogo informa o saldo disponível quando a leitura está atualizada.",
    "A leitura de mídia acompanha 30, 14, 7 e 3 dias. Para detectar perda recente, compara duas semanas fechadas sem sobreposição. O CPA atribuído da Meta mede compras atribuídas.",
    ...(!inventory || inventory.unknownVariants > 0
      ? ["Poder de venda sem cobertura total de publicação, preço ou estoque."]
      : []),
    ...(!catalog || !previousSnapshot?.catalog
      ? ["Histórico de catálogo ainda insuficiente para comparação."]
      : []),
    ...(!coupons || !previousSnapshot?.coupons
      ? ["Cupons sem leitura comparável."]
      : []),
    "Regras gerais de frete, parcelamento, pagamento, margem e devoluções por SKU dependem de fontes verificadas.",
    ...(client.commercePlatform === "BRAAVO" ? ["O estoque usa a última sincronização de cada SKU Braavo. A escala depende de um vínculo confirmado entre anúncio e produto. O frete compara cobranças positivas registradas. Prazo prometido e frete grátis dependem de confirmação na origem."] : []),
    "Investimento deste piloto cobre a conta Meta. CAC blended inclui toda a verba Meta e o ROAS atribuído segue a Meta. Coortes e LTV usam o histórico disponível.",
  ];
  const dpa = scheduled && closed ? await syncManagerDpaSet(client, catalog) : null;
  const dailyProducts = closed && scheduled && period.dateFrom === period.dateTo && closedWithOrders
    ? rankManagerProducts(selected, catalog?.products ?? [], selected.length).map(({ id, name, units, revenue }) => ({ id, name, units, revenue })) : [];
  return {
    snapshot,
    overview,
    matureCampaigns: buildPaidMediaReview({ current: matureOverview.reportMedia?.currentData ?? null, previous: null,
          snapshot: null, currency: client.currency, window: matureWeek, previousWindow: matureReference }).rows
          .filter(({ level }) => level === "campaign").map(({ id, roas, spending }) => ({ id, roas, spending, period: matureWeek })),
    products: {
      products: rankManagerProducts(selected, catalog?.products ?? []),
      stockObservedAt: snapshot.stockObservedAt,
    },
    findings,
    report: {
      version: B2C_VERSION,
      clientName: client.name,
      commercePlatform: client.commercePlatform,
      currency: client.currency,
      scope: {
        period,
        reference,
        closed,
        commerceConfirmed: closedWithOrders,
        calendarMonthToDate: month,
        comparison: scheduled
          ? "Mesmo dia da semana anterior"
          : "Período anterior de mesma duração",
      },
      summary:
        findings.find((item) => !item.grade)?.title ??
        (closedWithOrders
          ? "Nenhum sinal prioritário nas fontes observadas"
          : "Cobertura pendente para fechar o diagnóstico"),
      changes: closedWithOrders ? compareMetrics(metrics, baseline) : null,
      revenueDrivers: bridge,
      revenueContext,
      product: {
        abc7,
        abc14,
        inventory,
        traffic: productTraffic,
        dailySales: dailyProducts,
        dpa,
        realization: settings.realization,
        scenarios,
      },
      commercial,
      media: {
        current: overview.reportMedia?.current ?? null,
        previous: overview.reportMedia?.previous ?? null,
        campaigns: mediaCampaigns(overview),
        creativeReview,
        roasReview,
        perEntity,
        learning,
        learningWindows,
        operatingPlan: {
          window: campaignPlan.window,
          previousWindow: matureReference,
          targetCpa: campaignPlan.targetCpa,
          observedAt: campaignPlan.observedAt,
          decisions: executableCampaigns,
        },
      },
      weeklyPlan,
      cro: {
        shipping,
        current: currentFunnel,
        previous: previousFunnel,
        channels: funnel.channels,
        channelComparison: funnel.channelComparison,
        products: funnel.products,
        evaluation: {
          payment: approval ? funnelEvaluation.payment : null,
          rates: funnelEvaluation.rates,
          weakest: funnelEvaluation.weakest,
          checkoutDiagnosis,
          stages: reportFunnelStages(diagnosticFunnel, funnelDetail, checkoutDiagnosis),
          stagesWindow: funnelPeriod,
          stagesPreviousWindow: funnelReference,
        },
      },
      acquisition: {
        current,
        previous,
        reactivationDays: settings.reactivationDays,
        frequency: ratio(
          metrics.orders,
          metrics.newBuyers + metrics.returningBuyers,
        ),
        recurringRevenueShare: ratio(
          current.returningRevenue,
          metrics.approvedRevenue,
        ),
        cohorts: cohortRates,
        retentionSegments,
        comparison: {
          period: matureWeek,
          previous: matureReference,
          metrics: matureOverview.metrics,
          priorMetrics: matureOverview.previous,
        },
      },
      month: {
        orders: monthContext,
        approvedRevenue:
          monthContext.newRevenue + monthContext.returningRevenue,
        inventoryRealization:
          inventory && inventory.unknownVariants === 0
            ? ratio(
                monthContext.newRevenue + monthContext.returningRevenue,
                inventory.pricedValue,
              )
            : null,
      },
      coverage: {
        commerce,
        ga4Fingerprint: [funnelFingerprint(funnel.current), funnelFingerprint(funnel.previous)],
        stock: snapshot.catalog ? { total: snapshot.catalog.length, known: snapshot.catalog.filter(({ stock }) => stock !== null).length } : null,
        monitorFresh: !monitor.stale && Boolean(monitor.checkedAt),
        stockObservedAt: snapshot.stockObservedAt,
        couponsObservedAt: coupons?.observedAt ?? null,
        mediaAvailable: overview.mediaAvailable,
        monitorObservedAt: monitor.checkedAt,
        ga4Connection,
        unmatchedActiveAds: !monitor.stale
          ? (monitor.snapshot?.unidentified.length ?? null)
          : null,
      },
      limitations,
    },
  };
}
