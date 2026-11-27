import { managerActionReadiness } from "./up-manager-source-readiness";
import { budgetBlockers, findSiblingBudgetWaste, historicalReactivation } from "./up-manager-media-opportunities";
import { metaNodeActive, readOwnedBudget, type MetaBudget } from "./up-manager-meta-structure";
import { buildCampaignWindows, campaignInventoryContext, campaignPeriod, campaignWindowPoints, campaignWindows, evaluateCampaignInventory, performanceAcrossWindows } from "./up-manager-campaign-evaluation";
import { catalogSnapshot } from "./up-manager-b2c-products";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, upManagerAdActionsTable as actions, upManagerArchiveTable as archive } from "@workspace/db";
import { addDaysToDateOnly, saoPauloDateOnly } from "../lib/reporting-period";
import { readPaidMediaChanges } from "./up-manager-media-learning";
import { productCampaignRecommendations } from "./product-campaign-recommendations";
import { analyzeProductCampaigns } from "./product-campaign-analysis";
import { fetchCampaignAds, fetchCampaignCatalog, fetchManagerStockAd } from "./product-campaign-sources";
import { normalizeMetaAdAccountId } from "./meta-ads";
import { executeManagerGradePause, pauseManagerAd } from "./up-manager-actions";
import { approvedCreativeWindow } from "./up-manager-creatives";
import { buildPaidMediaReview, hasHealthyMediaDescendant, scaleStockConfirmed, verifiedPerformancePause, verifiedRecentPause, type MediaLevel, type PaidMediaReview, type PaidMediaRow } from "./up-manager-paid-media";
import { managerMetaToken, priorPeriod, readMedia, readVariantSales, type ManagerClient } from "./up-manager";

type ActionStatus = typeof actions.$inferSelect.status;
type Field = "daily_budget" | "lifetime_budget";
type Budget = MetaBudget;
export class ManagerMediaActionError extends Error {}
type MoneyChange = Pick<Budget, "ownerId" | "field" | "before">;
type GraphNode = {
  id: string; name: string; account_id: string; status: string; effective_status: string;
  campaign_id?: string; adset_id?: string; daily_budget?: string; lifetime_budget?: string;
};
type Selection = { level: MediaLevel; id: string };
type StoredMedia = NonNullable<Parameters<typeof managerActionReadiness>[0]> & { media?: { roasReview?: PaidMediaReview } };
type Finding = { id: string; grade?: { productId?: string; ads?: { adId: string }[] } };
type Context = { client: ManagerClient; accountId: string; token: string; row: PaidMediaRow; review: PaidMediaReview; findings: Finding[] };

const digits = /^\d{1,32}$/;
const actionKey = (...parts: string[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");

async function context(client: ManagerClient, runId: string, selection: Selection, recommendation: "scale" | "pause" | "reactivate"): Promise<Context | null> {
  const token = managerMetaToken(client);
  if (!token || !client.accountId) return null;
  const [run] = await db.select({ payload: archive.payload }).from(archive)
    .where(and(eq(archive.clientId, client.id), eq(archive.runId, runId)));
  const report = run?.payload.b2c as StoredMedia | undefined;
  const review = report?.media?.roasReview;
  const row = review?.rows.find(({ id, level }) => id === selection.id && level === selection.level);
  if (!review || !row || row.status !== (recommendation === "reactivate" ? "inactive" : "active") || row.recommendation !== recommendation ||
    !approvedCreativeWindow(review.window, new Date())) return null;
  const pending = managerActionReadiness(report);
  if (pending && !(recommendation === "pause" && row.pauseReason === "stock")) {
    throw new ManagerMediaActionError(pending);
  }
  return { client, accountId: client.accountId, token, row, review, findings: (run?.payload.findings as Finding[] | undefined) ?? [] };
}

function graphUrl(id: string) {
  const version = process.env.META_GRAPH_VERSION ?? "v24.0";
  if (!digits.test(id) || !/^v\d+\.0$/.test(version)) throw new ManagerMediaActionError("Identificador da Meta inválido.");
  return new URL(`https://graph.facebook.com/${version}/${id}`);
}

async function readNode(ctx: Context, id: string, level: MediaLevel) {
  const url = graphUrl(id);
  const common = "id,name,account_id,status,effective_status";
  const fields = { ad: "campaign_id,adset_id", adset: "campaign_id,daily_budget,lifetime_budget", campaign: "daily_budget,lifetime_budget" };
  url.searchParams.set("fields", `${common},${fields[level]}`);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${ctx.token}` }, cache: "no-store",
    signal: AbortSignal.timeout(6000), redirect: "error",
  });
  if (!response.ok) throw new ManagerMediaActionError("Não foi possível consultar o orçamento na Meta.");
  const node = await response.json() as GraphNode;
  if (node.id !== id || !node.account_id ||
    normalizeMetaAdAccountId(node.account_id) !== normalizeMetaAdAccountId(ctx.accountId)) throw new ManagerMediaActionError("Objeto fora da conta conectada.");
  return node;
}

async function resolveBudgets(ctx: Context, selectedOwnerId?: string): Promise<Budget[]> {
  const { row, review, client } = ctx;
  if (!review.accountPriceComparable) throw new ManagerMediaActionError("Moeda da conta e da marca sem confirmação.");
  const campaignId = row.level === "campaign" ? row.id : row.campaignId;
  const adsetId = row.level === "adset" ? row.id : row.adsetId;
  if (!campaignId || (row.level !== "campaign" && !adsetId)) throw new ManagerMediaActionError("Hierarquia da Meta indisponível.");
  const [campaign, adset, ad] = await Promise.all([
    readNode(ctx, campaignId, "campaign"),
    adsetId ? readNode(ctx, adsetId, "adset") : null,
    row.level === "ad" ? readNode(ctx, row.id, "ad") : null,
  ]);
  if (!metaNodeActive(campaign) || (adset && (!metaNodeActive(adset) || adset.campaign_id !== campaignId)) ||
    (ad && (!metaNodeActive(ad) || ad.campaign_id !== campaignId || ad.adset_id !== adsetId))) {
    throw new ManagerMediaActionError("A hierarquia ou a veiculação mudou na Meta.");
  }
  const campaignBudget = readOwnedBudget(campaign, "campaign", client.currency);
  const adsetBudget = adset && readOwnedBudget(adset, "adset", client.currency);
  if (campaignBudget && adsetBudget) throw new ManagerMediaActionError("O nível do orçamento está indefinido na Meta.");
  const budget = campaignBudget ?? adsetBudget;
  if (budget) return [budget];
  if (row.level !== "campaign") throw new ManagerMediaActionError("Orçamento próprio indisponível para esta estrutura.");

  // For campaigns using ad-set budgets, only offer active sets without a negative recommendation.
  const eligibleSets = review.rows.filter((item) => item.level === "adset" && item.campaignId === campaignId &&
    item.status === "active" && (row.scaleBudgets ? row.scaleBudgets.some(({ ownerId }) => ownerId === item.id) :
      !item.below && (item.recommendation === "scale" || item.recommendation === "maintain")) &&
    (!selectedOwnerId || item.id === selectedOwnerId));
  const options = await Promise.all(eligibleSets.map(async ({ id }) => {
    const node = await readNode(ctx, id, "adset").catch(() => null);
    return node && metaNodeActive(node) && node.campaign_id === campaignId ? readOwnedBudget(node, "adset", client.currency) : null;
  }));
  const available = options.filter((option): option is Budget => option !== null);
  if (!available.length) throw new ManagerMediaActionError("Esta campanha usa orçamento por conjunto. Nenhum conjunto elegível tem verba confirmada na Meta.");
  return available;
}

export function budgetAfter(before: number, percent: number) {
  if (!Number.isSafeInteger(before) || before <= 0 || !Number.isInteger(percent) || percent < 15 || percent > 20) return null;
  const base = BigInt(before);
  const min = (base * 115n + 99n) / 100n;
  const max = base * 120n / 100n;
  const rounded = (base * BigInt(100 + percent) + 50n) / 100n;
  if (min > max || max > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(rounded < min ? min : rounded > max ? max : rounded);
}

export async function quoteManagerBudget(client: ManagerClient, runId: string, selection: Selection) {
  const ctx = await context(client, runId, selection, "scale");
  if (!ctx) throw new ManagerMediaActionError("A recomendação de escala está desatualizada.");
  const budgets = await resolveBudgets(ctx);
  const assessed = budgets.map((budget) => {
    const saved = ctx.row.scaleBudgets?.find(({ ownerId }) => ownerId === budget.ownerId);
    const inventory = ctx.review.rows.find((item) => item.id === budget.ownerId && item.level === budget.ownerLevel)?.evaluation?.inventory;
    const blockers = saved ? [...saved.blockers] : inventory ? budgetBlockers(inventory) : [];
    if (ctx.row.scaleBudgets && !saved) blockers.push("O nível da verba mudou. Atualize a análise.");
    return { ...budget, blockers };
  });
  return {
    options: assessed.filter(({ blockers }) => !blockers.length),
    blocked: assessed.filter(({ blockers }) => blockers.length),
  };
}

export async function managerMediaActionStatuses(clientId: string, runId: string) {
  const rows = await db.select({ evidence: actions.evidence, status: actions.status }).from(actions)
    .where(and(eq(actions.clientId, clientId), sql`${actions.evidence}->>'kind' IN ('media-pause', 'media-budget', 'media-reactivate') AND ${actions.evidence}->>'runId' = ${runId}`));
  return rows.flatMap(({ evidence, status }) =>
    "kind" in evidence && (evidence.kind === "media-pause" || evidence.kind === "media-budget" || evidence.kind === "media-reactivate")
      ? [{ level: evidence.entityLevel, id: evidence.entityId, kind: evidence.kind, status }] : []);
}

async function freshMediaInventory(ctx: Context) {
  const { client, accountId, token } = ctx;
  if (!client.storeId || !client.storeToken) return null;
  const end = ctx.review.multiWindowEnd;
  if (!end || end !== addDaysToDateOnly(saoPauloDateOnly(new Date()), -1)) return null;
  const signal = AbortSignal.timeout(26_000);
  const [[meta, catalog], weekly, fortnightly, media] = await Promise.all([
    Promise.all([fetchCampaignAds(accountId, token, signal), fetchCampaignCatalog(client.storeId, client.storeToken, signal)]),
    readVariantSales(client.id, campaignPeriod(end, 7)),
    readVariantSales(client.id, campaignPeriod(end, 14)),
    Promise.all(campaignWindows.map((days) => readMedia(client, campaignPeriod(end, days), false, false, true))),
  ]);
  if (meta.currency !== client.currency || meta.warnings.length) return null;
  const snapshot = {
    ...analyzeProductCampaigns(meta.ads, catalog.products, catalog.domains),
    version: 1 as const, accountId, storeId: client.storeId, adsObservedAt: meta.observedAt,
    stockObservedAt: catalog.observedAt, window: meta.window, currency: meta.currency, timeZone: meta.timeZone,
    warnings: meta.warnings,
  };
  const inventory = campaignInventoryContext(snapshot, catalogSnapshot(catalog.products), weekly, fortnightly);
  return { reviews: buildCampaignWindows(media, end, snapshot, client.currency), inventory, catalog };
}

async function freshScaleStock(ctx: Context, campaignId: string, budget: Budget) {
  if (!ctx.review.multiWindowEnd) {
    const { client, token, accountId } = ctx;
    if (!client.storeId || !client.storeToken) return false;
    const signal = AbortSignal.timeout(26_000);
    const [meta, catalog] = await Promise.all([
      fetchCampaignAds(accountId, token, signal), fetchCampaignCatalog(client.storeId, client.storeToken, signal),
    ]);
    return meta.currency === client.currency && scaleStockConfirmed({
      ...analyzeProductCampaigns(meta.ads, catalog.products, catalog.domains), version: 1,
      accountId, storeId: client.storeId, adsObservedAt: meta.observedAt,
      stockObservedAt: catalog.observedAt, window: meta.window, currency: meta.currency,
      timeZone: meta.timeZone, warnings: meta.warnings,
    }, campaignId);
  }
  const data = await freshMediaInventory(ctx);
  if (!data) return false;
  const inventory = evaluateCampaignInventory({ id: budget.ownerId, level: budget.ownerLevel, campaignId }, data.inventory);
  const points = campaignWindowPoints(data.reviews, ctx.row);
  const owner = performanceAcrossWindows(campaignWindowPoints(data.reviews, { id: budget.ownerId, level: budget.ownerLevel }));
  return inventory.scaleReady && performanceAcrossWindows(points).opportunity && !owner.pause &&
    (ctx.row.level !== "campaign" || budget.ownerLevel !== "adset" || owner.opportunity);
}

export async function executeManagerBudget(
  client: ManagerClient, runId: string, selection: Selection, expected: MoneyChange, percent: number, actorUserId: string,
): Promise<{ status: ActionStatus }> {
  const ctx = await context(client, runId, selection, "scale");
  if (!ctx) return { status: "stale" };
  const campaignId = ctx.row.campaignId ?? (ctx.row.level === "campaign" ? ctx.row.id : null);
  if (!campaignId) return { status: "stale" };
  const after = budgetAfter(expected.before, percent);
  if (!after) return { status: "stale" };

  const account = normalizeMetaAdAccountId(ctx.accountId);
  const recommendationId = actionKey("media-budget", account, expected.ownerId, ctx.review.window.dateTo);
  const guard = and(eq(actions.clientId, client.id), eq(actions.recommendationId, recommendationId));
  const currentAction = await db.select({ status: actions.status }).from(actions).where(guard);
  if (currentAction[0]) return { status: currentAction[0].status };

  const options = await resolveBudgets(ctx, expected.ownerId).catch(() => []);
  const budget = options.find(({ ownerId }) => ownerId === expected.ownerId);
  if (!budget || budget.field !== expected.field || budget.before !== expected.before ||
    (ctx.row.scaleBudgets && !ctx.row.scaleBudgets.some(({ ownerId, blockers }) => ownerId === budget.ownerId && !blockers.length)) ||
    !await freshScaleStock(ctx, campaignId, budget).catch(() => false)) return { status: "stale" };

  const claim = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`manager-budget:${account}:${budget.ownerId}`}, 0))`);
    const [existing] = await tx.select({ status: actions.status }).from(actions).where(guard);
    if (existing) return existing.status;
    const [recent] = await tx.select({ status: actions.status }).from(actions).where(and(
      eq(actions.clientId, client.id), eq(actions.accountId, account),
      sql`${actions.evidence}->>'kind' = 'media-budget' AND ${actions.evidence}->>'ownerId' = ${budget.ownerId}
        AND (${actions.status} IN ('pending', 'uncertain') OR (${actions.status} = 'applied' AND ${actions.updatedAt} >= ${new Date(Date.now() - 72 * 3_600_000).toISOString()}::timestamptz))`,
    )).limit(1);
    if (recent) return recent.status;
    await tx.insert(actions).values({
      clientId: client.id, recommendationId, actorUserId, accountId: account, status: "pending",
      evidence: { kind: "media-budget", runId, entityId: selection.id, entityLevel: selection.level,
        ownerId: budget.ownerId, ownerLevel: budget.ownerLevel, field: budget.field, before: budget.before,
        after, percent, currency: budget.currency, windowEnd: ctx.review.window.dateTo },
    });
    return "claimed" as const;
  });
  if (claim !== "claimed") return { status: claim };
  let status: ActionStatus = "stale";
  const owner = await readNode(ctx, budget.ownerId, budget.ownerLevel).catch(() => null);
  if (owner && metaNodeActive(owner) && Number(owner[budget.field]) === budget.before) {
    const response = await fetch(graphUrl(budget.ownerId), {
      method: "POST", headers: { Authorization: `Bearer ${ctx.token}` },
      body: new URLSearchParams({ [budget.field]: String(after) }),
      signal: AbortSignal.timeout(8000), redirect: "error",
    }).catch(() => null);
    const applied = await readNode(ctx, budget.ownerId, budget.ownerLevel).catch(() => null);
    const observed = applied ? Number(applied[budget.field]) : null;
    status = observed === after ? "applied"
      : response && response.status >= 400 && response.status < 500 && observed === budget.before ? "stale" : "uncertain";
  }
  if (status === "stale") {
    // No write was attempted. Allow a fresh quote after the operator sees the new budget.
    await db.delete(actions).where(guard);
  } else {
    await db.update(actions).set({ status, updatedAt: new Date() }).where(guard);
  }
  return { status };
}

export async function executeManagerRoasPause(
  client: ManagerClient, runId: string, selection: Selection, actorUserId: string,
): Promise<{ status: ActionStatus }> {
  const ctx = await context(client, runId, selection, "pause");
  if (!ctx) return { status: "stale" };
  const { id, level } = selection;
  const stock = ctx.row.pauseReason === "stock" || (level === "ad" && ctx.findings.some((finding) => finding.id === `ad-decision:${id}`));
  if (stock && level === "ad") {
    const eligible = ctx.findings.find(({ grade }) => grade?.productId && grade.ads?.some((ad) => ad.adId === id));
    return eligible?.grade?.productId ? executeManagerGradePause(client, runId, eligible.grade.productId, id, actorUserId, ctx.row.pauseEvidence === "critical-grade")
      : { status: "stale" };
  }
  const key = actionKey("media-pause", normalizeMetaAdAccountId(ctx.accountId), level, id, ctx.review.window.dateTo);
  const guard = and(eq(actions.clientId, client.id), eq(actions.recommendationId, key));
  const [existing] = await db.select({ status: actions.status }).from(actions).where(guard);
  if (existing) return { status: existing.status };

  if (stock) {
    if (!client.storeId || !client.storeToken) return { status: "stale" };
    const signal = AbortSignal.timeout(24_000);
    const observed = await Promise.all([
      fetchCampaignAds(ctx.accountId, ctx.token, signal),
      fetchCampaignCatalog(client.storeId, client.storeToken, signal),
    ]).catch(() => null);
    if (!observed) return { status: "stale" };
    const [meta, catalog] = observed;
    if (meta.warnings.length) return { status: "stale" };
    const linked = analyzeProductCampaigns(meta.ads, catalog.products, catalog.domains);
    const exact = new Set(productCampaignRecommendations({
      ...linked, version: 1, accountId: ctx.accountId, storeId: client.storeId,
      adsObservedAt: meta.observedAt, stockObservedAt: catalog.observedAt,
      window: meta.window, currency: meta.currency, timeZone: meta.timeZone, warnings: meta.warnings,
    }).map(({ evidence }) => evidence.adId));
    const affected = meta.ads.filter((ad) => level === "campaign" ? ad.campaignId === id : ad.adsetId === id);
    if (!affected.length || affected.some((ad) => !exact.has(ad.id))) return { status: "stale" };
  } else if (ctx.row.pauseEvidence === "sibling") {
    const [data, history] = await Promise.all([
      freshMediaInventory(ctx).catch(() => null),
      readPaidMediaChanges(client, saoPauloDateOnly(new Date())).catch(() => null),
    ]);
    if (!data || level !== "ad" || history?.events.some(({ id: changedId, day }) =>
      day >= data.reviews[3].window.dateFrom &&
      [id, ctx.row.comparisonAdId, ctx.row.adsetId, ctx.row.campaignId].includes(changedId))) return { status: "stale" };
    const candidate = findSiblingBudgetWaste(data.reviews, id, (row) =>
      row.id === ctx.row.comparisonAdId && evaluateCampaignInventory(row, data.inventory).scaleReady);
    if (!candidate) return { status: "stale" };
  } else if (ctx.row.pauseEvidence === "multiWindow") {
    const today = saoPauloDateOnly(new Date());
    const end = ctx.review.multiWindowEnd;
    if (!end || end !== addDaysToDateOnly(today, -1)) return { status: "stale" };
    const [media, activity] = await Promise.all([
      Promise.all(campaignWindows.map((days) => readMedia(client, campaignPeriod(end, days), false, false, true))),
      readPaidMediaChanges(client, today).catch(() => null),
    ]);
    const reviews = buildCampaignWindows(media, end, null, client.currency);
    const found = reviews[7].rows.find((row) => row.id === id && row.level === level);
    const changed = activity?.events.some((event) => event.day >= campaignPeriod(end, 3).dateFrom && (
      (event.level === level && event.id === id) ||
      (event.level === "campaign" && event.id === ctx.row.campaignId) ||
      (event.level === "adset" && event.id === ctx.row.adsetId)
    ));
    if (!found || changed || hasHealthyMediaDescendant(found, reviews[7].rows) ||
      !performanceAcrossWindows(campaignWindowPoints(reviews, selection)).pause) return { status: "stale" };
  } else {
    const recentWindow = ctx.review.recentWindow;
    const useRecent = ctx.row.pauseEvidence === "recent";
    const today = saoPauloDateOnly(new Date());
    if (useRecent && (!recentWindow || recentWindow.dateTo !== addDaysToDateOnly(today, -1) ||
      recentWindow.dateFrom !== addDaysToDateOnly(today, -2))) return { status: "stale" };
    const [current, previous, recent, activity] = await Promise.all([
      readMedia(client, ctx.review.window, false, false, true),
      readMedia(client, ctx.review.previousWindow, false, false, true),
      useRecent && recentWindow ? readMedia(client, recentWindow, false, false, true) : null,
      useRecent ? readPaidMediaChanges(client, today).catch(() => null) : null,
    ]);
    if (!current || !previous) return { status: "stale" };
    const fresh = buildPaidMediaReview({ current, previous, snapshot: null, currency: client.currency,
      window: ctx.review.window, previousWindow: ctx.review.previousWindow });
    const found = fresh.rows.find((row) => row.id === id && row.level === level);
    if (!found || hasHealthyMediaDescendant(found, fresh.rows)) return { status: "stale" };
    if (useRecent && recentWindow) {
      if (!recent || activity?.events.some((event) => event.day >= recentWindow.dateFrom && (
        (event.level === level && event.id === id) ||
        (event.level === "campaign" && event.id === found.campaignId) ||
        (event.level === "adset" && event.id === found.adsetId)
      ))) return { status: "stale" };
      const comparison = buildPaidMediaReview({ current: recent, previous: null, snapshot: null,
        currency: client.currency, window: recentWindow, previousWindow: priorPeriod(recentWindow) });
      if (!verifiedRecentPause(found, comparison.rows.find((row) => row.id === id && row.level === level), fresh.reference))
        return { status: "stale" };
    } else if (!verifiedPerformancePause(found, fresh.reference)) return { status: "stale" };
  }

  const [claim] = await db.insert(actions).values({
    clientId: client.id, recommendationId: key, actorUserId, accountId: ctx.accountId, status: "pending",
    evidence: { kind: "media-pause", runId, entityId: id, entityLevel: level, windowEnd: ctx.review.window.dateTo },
  }).onConflictDoNothing().returning({ status: actions.status });
  if (!claim) {
    const [same] = await db.select({ status: actions.status }).from(actions).where(guard);
    return { status: same?.status ?? "uncertain" };
  }
  const status = await pauseManagerAd({ adId: id, accountId: ctx.accountId, accessToken: ctx.token }).catch(() => "uncertain" as const);
  await db.update(actions).set({ status, updatedAt: new Date() }).where(guard);
  return { status };
}


export async function executeManagerReactivation(client: ManagerClient, runId: string, id: string, actorUserId: string) {
  const ctx = await context(client, runId, { level: "ad", id }, "reactivate");
  if (!ctx) return { status: "stale" as const };
  const account = normalizeMetaAdAccountId(ctx.accountId);
  const key = actionKey("media-reactivate", account, id, ctx.review.window.dateTo);
  const guard = and(eq(actions.clientId, client.id), eq(actions.recommendationId, key));
  const [existing] = await db.select({ status: actions.status }).from(actions).where(guard);
  if (existing) return { status: existing.status };
  const [data, ad] = await Promise.all([
    freshMediaInventory(ctx),
    fetchManagerStockAd(ctx.accountId, id, ctx.token, AbortSignal.timeout(8_000), "PAUSED"),
  ]).catch(() => [null, null] as const);
  if (!data || !ad || ad.campaignId !== ctx.row.campaignId || ad.adsetId !== ctx.row.adsetId ||
    !historicalReactivation(ctx.row, data.reviews) || !data.inventory.snapshot) return { status: "stale" as const };
  const stock = analyzeProductCampaigns([ad], data.catalog.products, data.catalog.domains, "PAUSED");
  const inventory = evaluateCampaignInventory(ctx.row, { ...data.inventory, snapshot: { ...data.inventory.snapshot, ...stock } });
  if (!inventory.scaleReady) return { status: "stale" as const };
  const [claim] = await db.insert(actions).values({
    clientId: client.id, recommendationId: key, actorUserId, accountId: account, status: "pending",
    evidence: { kind: "media-reactivate", runId, entityId: id, entityLevel: "ad", windowEnd: ctx.review.window.dateTo },
  }).onConflictDoNothing().returning({ status: actions.status });
  if (!claim) {
    const [same] = await db.select({ status: actions.status }).from(actions).where(guard);
    return { status: same?.status ?? "uncertain" as const };
  }
  const confirmed = await fetchManagerStockAd(ctx.accountId, id, ctx.token, AbortSignal.timeout(5_000), "PAUSED").catch(() => null);
  if (!confirmed || confirmed.adsetId !== ad.adsetId || confirmed.campaignId !== ad.campaignId ||
    confirmed.catalog !== ad.catalog || JSON.stringify(confirmed.urls) !== JSON.stringify(ad.urls)) {
    await db.delete(actions).where(guard);
    return { status: "stale" as const };
  }
  const response = await fetch(graphUrl(id), {
    method: "POST", headers: { Authorization: `Bearer ${ctx.token}` }, body: new URLSearchParams({ status: "ACTIVE" }),
    signal: AbortSignal.timeout(8_000), redirect: "error",
  }).catch(() => null);
  const current = await readNode(ctx, id, "ad").catch(() => null);
  const status = current?.status === "ACTIVE" ? "applied"
    : response && response.status >= 400 && response.status < 500 && current?.status === "PAUSED" ? "stale" : "uncertain";
  await db.update(actions).set({ status, updatedAt: new Date() }).where(guard);
  return { status };
}
