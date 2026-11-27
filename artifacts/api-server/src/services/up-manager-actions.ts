import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  upManagerAdActionsTable as actions,
  upManagerArchiveTable as archive,
} from "@workspace/db";
import { analyzeProductCampaigns, localized } from "./product-campaign-analysis";
import {
  getProductCampaignCheck,
  type CampaignSnapshot,
} from "./product-campaign-monitor";
import { productCampaignRecommendations } from "./product-campaign-recommendations";
import {
  fetchCampaignAds,
  fetchCampaignCatalog,
  fetchManagerCatalogProduct,
  fetchManagerStockAd,
  fetchManagerStoreDomains,
} from "./product-campaign-sources";
import { normalizeMetaAdAccountId } from "./meta-ads";
import { verifiedCriticalGradePause, verifiedGradePause, type GradeEvidence } from "./up-manager-grade";
import {
  approvedCreativeWindow,
  buildCreativeReview,
} from "./up-manager-creatives";
import {
  managerMetaToken,
  priorPeriod,
  readMedia,
  type ManagerClient,
} from "./up-manager";

type ActionStatus = typeof actions.$inferSelect.status;

export function managerActions(clientId: string) {
  return db
    .select({
      recommendationId: actions.recommendationId,
      evidence: actions.evidence,
      status: actions.status,
      updatedAt: actions.updatedAt,
    })
    .from(actions)
    .where(eq(actions.clientId, clientId))
    .orderBy(desc(actions.createdAt))
    .limit(20);
}

async function readMetaAd(url: URL, accessToken: string) {
  const request = new URL(url.href);
  request.searchParams.set("fields", "id,account_id,status,effective_status");
  const response = await fetch(request, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(6000),
    redirect: "error",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Estado do anúncio indisponível na Meta.");
  return (await response.json()) as {
    id?: string;
    account_id?: string;
    status?: string;
    effective_status?: string;
  };
}

export async function pauseManagerAd({
  adId,
  accountId,
  accessToken,
}: {
  adId: string;
  accountId: string;
  accessToken: string;
}): Promise<ActionStatus> {
  const version = process.env.META_GRAPH_VERSION ?? "v24.0";
  if (!/^\d+$/.test(adId) || !/^v\d+\.0$/.test(version)) return "stale";
  const url = new URL(`https://graph.facebook.com/${version}/${adId}`);
  const isSameAd = (ad: Awaited<ReturnType<typeof readMetaAd>>) =>
    ad.id === adId &&
    Boolean(
      ad.account_id &&
      normalizeMetaAdAccountId(ad.account_id) ===
        normalizeMetaAdAccountId(accountId),
    );

  const current = await readMetaAd(url, accessToken);
  if (!isSameAd(current)) return "stale";
  if (current.status === "PAUSED") return "paused";
  if (current.status !== "ACTIVE" || current.effective_status !== "ACTIVE")
    return "stale";

  try {
    await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: new URLSearchParams({ status: "PAUSED" }),
      signal: AbortSignal.timeout(8000),
      redirect: "error",
    });
  } catch {
    // Reconcile the remote state even if the write timed out or lost its response.
  }
  const observed = await readMetaAd(url, accessToken).catch(() => null);
  return observed && isSameAd(observed) && observed.status === "PAUSED"
    ? "paused"
    : "uncertain";
}

export async function executeManagerPause(
  client: ManagerClient,
  recommendationId: string,
  actorUserId: string,
) {
  const token = managerMetaToken(client);
  if (!token || !client.accountId || !client.storeId || !client.storeToken)
    return { status: "stale" as const };
  const check = await getProductCampaignCheck(client);
  const item =
    "reviewPilot" in check
      ? check.reviewPilot?.recommendations.find(
          ({ id }) => id === recommendationId,
        )
      : null;
  if (
    !item ||
    !item.review ||
    item.review.decision !== "agree" ||
    check.stale ||
    check.running
  )
    return { status: "stale" as const };
  const guard = and(
    eq(actions.clientId, client.id),
    eq(actions.recommendationId, recommendationId),
  );
  const [claimed] = await db
    .insert(actions)
    .values({
      clientId: client.id,
      recommendationId,
      actorUserId,
      accountId: client.accountId,
      status: "pending",
      evidence: item.evidence,
    })
    .onConflictDoNothing()
    .returning({ status: actions.status });
  if (!claimed) {
    const [current] = await db
      .select({ status: actions.status })
      .from(actions)
      .where(guard);
    return { status: current?.status ?? "uncertain" };
  }

  let status: ActionStatus = "stale";
  try {
    const signal = AbortSignal.timeout(22_000);
    const [meta, catalog] = await Promise.all([
      fetchCampaignAds(client.accountId, token, signal),
      fetchCampaignCatalog(client.storeId, client.storeToken, signal),
    ]);
    const fresh: CampaignSnapshot = {
      ...analyzeProductCampaigns(meta.ads, catalog.products, catalog.domains),
      version: 1,
      accountId: client.accountId,
      storeId: client.storeId,
      adsObservedAt: meta.observedAt,
      stockObservedAt: catalog.observedAt,
      window: meta.window,
      currency: meta.currency,
      timeZone: meta.timeZone,
      warnings: meta.warnings,
    };
    const stillEligible = productCampaignRecommendations(fresh).some(
      ({ evidence }) =>
        evidence.adId === item.evidence.adId &&
        evidence.productId === item.evidence.productId,
    );
    if (stillEligible) {
      status = await pauseManagerAd({
        adId: item.evidence.adId,
        accountId: client.accountId,
        accessToken: token,
      }).catch(() => "uncertain");
    }
  } catch {
    // Source reads failed before attempting a change.
  }
  await db.update(actions).set({ status, updatedAt: new Date() }).where(guard);
  return { status };
}

export async function executeCreativePause(
  client: ManagerClient,
  runId: string,
  adId: string,
  actorUserId: string,
  now = new Date(),
): Promise<{ status: ActionStatus }> {
  const token = managerMetaToken(client);
  if (!token || !client.accountId) return { status: "stale" };
  const [run] = await db
    .select({ payload: archive.payload })
    .from(archive)
    .where(and(eq(archive.clientId, client.id), eq(archive.runId, runId)));
  const stored = run?.payload.b2c as
    | { media?: { creativeReview?: ReturnType<typeof buildCreativeReview> } }
    | undefined;
  const report = stored?.media?.creativeReview;
  const creative = report?.creatives.find((item) =>
    item.recommendations.some((row) => row.adId === adId),
  );
  if (!report || !creative || !approvedCreativeWindow(report.window, now))
    return { status: "stale" };
  const accountId = client.accountId;
  const recommendationId = createHash("sha256")
    .update(
      JSON.stringify([
        "creative-performance",
        normalizeMetaAdAccountId(accountId),
        adId,
        report.window.dateTo,
      ]),
    )
    .digest("hex");
  const guard = and(
    eq(actions.clientId, client.id),
    eq(actions.recommendationId, recommendationId),
  );
  const [existing] = await db
    .select({ status: actions.status })
    .from(actions)
    .where(guard);
  if (existing && existing.status !== "stale")
    return { status: existing.status };

  const observed = await Promise.all([
    fetchCampaignAds(accountId, token, AbortSignal.timeout(35_000)),
    readMedia(client, report.window, false, false, true),
    readMedia(client, priorPeriod(report.window), false, false, true),
  ]).catch(() => null);
  if (
    !observed ||
    !observed[1] ||
    !observed[2] ||
    observed[0].currency !== client.currency
  ) {
    return { status: "stale" };
  }
  const refreshed = buildCreativeReview({
    activeAds: observed[0].ads,
    media: observed[1],
    previousMedia: observed[2],
    currency: client.currency,
    window: report.window,
  });
  const match = refreshed.creatives
    .find((row) => row.key === creative.key)
    ?.recommendations.find((row) => row.adId === adId);
  if (!match) return { status: "stale" };

  const evidence = {
    kind: "creative-performance" as const,
    adId,
    adName: match.adName,
    campaignName: creative.campaignName,
    adsetName: match.adsetName,
    creativeId: creative.creativeId,
    window: { since: report.window.dateFrom, until: report.window.dateTo },
    spend: match.current.spend,
    purchases: match.current.purchases,
    peerCpa: match.peerCpa,
    reason: match.reason,
  };
  const [claim] = await db
    .insert(actions)
    .values({
      clientId: client.id,
      recommendationId,
      actorUserId,
      accountId,
      status: "pending",
      evidence,
    })
    .onConflictDoUpdate({
      target: [actions.clientId, actions.recommendationId],
      set: { actorUserId, status: "pending", updatedAt: now, evidence },
      setWhere: eq(actions.status, "stale"),
    })
    .returning({ status: actions.status });
  if (!claim) {
    const [same] = await db
      .select({ status: actions.status })
      .from(actions)
      .where(guard);
    return { status: same?.status ?? "uncertain" };
  }
  const status = await pauseManagerAd({
    adId,
    accountId,
    accessToken: token,
  }).catch(() => "uncertain" as const);
  await db.update(actions).set({ status, updatedAt: new Date() }).where(guard);
  return { status };
}

export async function managerGradePauseActions(clientId: string, runId: string) {
  const rows = await db.select({ evidence: actions.evidence, status: actions.status })
    .from(actions).where(and(
      eq(actions.clientId, clientId),
      sql`${actions.evidence}->>'kind' = 'grade-stock' AND ${actions.evidence}->>'runId' = ${runId}`,
    ));
  return rows.flatMap(({ evidence, status }) =>
    "kind" in evidence && evidence.kind === "grade-stock" ? [{ adId: evidence.adId, status }] : [],
  );
}

export async function executeManagerGradePause(
  client: ManagerClient,
  runId: string,
  productId: string,
  adId: string,
  actorUserId: string,
  critical = false,
): Promise<{ status: ActionStatus }> {
  const token = managerMetaToken(client);
  if (!token || !client.accountId || !client.storeId || !client.storeToken) return { status: "stale" };
  const { accountId, storeId, storeToken } = client;
  const [report] = await db.select({
    findings: sql<{ id: string; grade?: GradeEvidence }[]>`${archive.payload}->'findings'`,
  }).from(archive).where(and(eq(archive.clientId, client.id), eq(archive.runId, runId)));
  const grade = report?.findings?.find(({ id }) => id === `grade:${productId}`)?.grade;
  if (!grade?.missing.length || grade.productId !== productId ||
    !grade.ads?.some((ad) => ad.adId === adId)) return { status: "stale" };

  const recommendationId = createHash("sha256")
    .update(JSON.stringify(["grade-stock", normalizeMetaAdAccountId(accountId), adId, runId]))
    .digest("hex");
  const guard = and(eq(actions.clientId, client.id), eq(actions.recommendationId, recommendationId));
  const [existing] = await db.select({ status: actions.status }).from(actions).where(guard);
  if (existing && existing.status !== "stale") return { status: existing.status };

  const signal = AbortSignal.timeout(18_000);
  const fresh = await Promise.all([
    fetchManagerStockAd(accountId, adId, token, signal),
    fetchManagerCatalogProduct(storeId, storeToken, productId),
    fetchManagerStoreDomains(storeId, storeToken, signal),
  ]).catch(() => null);
  if (!fresh || !fresh[0]) return { status: "stale" };
  const [ad, product, domains] = fresh;
  const proof = (critical ? verifiedCriticalGradePause : verifiedGradePause)(ad, product, domains);
  if (!proof) return { status: "stale" };

  const evidence = {
    kind: "grade-stock" as const, runId, productId, adId, adName: ad.name,
    productName: localized(product.name) || productId,
    campaignName: ad.campaignName, adsetName: ad.adsetName, outOfStockVariants: proof.outOfStock,
  };
  const [claim] = await db.insert(actions)
    .values({ clientId: client.id, recommendationId, actorUserId, accountId, status: "pending", evidence })
    .onConflictDoUpdate({
      target: [actions.clientId, actions.recommendationId],
      set: { actorUserId, status: "pending", updatedAt: new Date(), evidence },
      setWhere: eq(actions.status, "stale"),
    })
    .returning({ status: actions.status });
  if (!claim) {
    const [same] = await db.select({ status: actions.status }).from(actions).where(guard);
    return { status: same?.status ?? "uncertain" };
  }
  const status = await pauseManagerAd({ accountId, adId, accessToken: token })
    .catch(() => "uncertain" as const);
  await db.update(actions).set({ status, updatedAt: new Date() }).where(guard);
  return { status };
}
