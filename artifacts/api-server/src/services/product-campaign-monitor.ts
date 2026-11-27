import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  db,
  clientsTable,
  productCampaignChecksTable as checks,
  productCampaignReviewsTable as reviews,
  type ProductCampaignReviewDecision,
} from "@workspace/db";
import {
  analyzeProductCampaigns,
  type CampaignAnalysis,
} from "./product-campaign-analysis";
import {
  fetchCampaignAds,
  fetchCampaignCatalog,
} from "./product-campaign-sources";
import { productCampaignRecommendations } from "./product-campaign-recommendations";

const STALE_MS = 36 * 60 * 60 * 1000;
const LEASE_MS = 5 * 60 * 1000;
export interface CampaignSnapshot extends CampaignAnalysis {
  version: 1;
  accountId: string;
  storeId: string;
  adsObservedAt: string;
  stockObservedAt: string;
  window: { since: string; until: string };
  currency: string;
  timeZone: string;
  warnings: string[];
}

export async function campaignClient(clientId: string) {
  const [client] = await db
    .select({
      id: clientsTable.id,
      name: clientsTable.name,
      currency: clientsTable.currency,
      dashboardType: clientsTable.dashboardType,
      commercePlatform: clientsTable.commercePlatform,
      isActive: clientsTable.isActive,
      archivedAt: clientsTable.archivedAt,
      accountId: clientsTable.metaAdAccountId,
      ga4PropertyId: clientsTable.ga4PropertyId,
      metaToken: clientsTable.metaAdsApiKey,
      storeId: clientsTable.nuvemshopStoreId,
      storeToken: clientsTable.nuvemshopAccessToken,
    })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));
  return client;
}
type Client = NonNullable<Awaited<ReturnType<typeof campaignClient>>>;
function metaToken(client: Client) {
  return (
    process.env.META_ADS_API_KEY ||
    process.env.META_ACCESS_TOKEN ||
    process.env.META_API_KEY ||
    process.env.META_TOKEN ||
    client.metaToken
  );
}
function configured(client: Client) {
  return Boolean(
    client.isActive &&
    client.dashboardType === "B2C" &&
    client.commercePlatform === "NUVEMSHOP" &&
    client.accountId &&
    metaToken(client) &&
    client.storeId &&
    client.storeToken,
  );
}

function reviewPilotEnabled(client: Client) {
  return Boolean(
    client.isActive &&
    client.dashboardType === "B2C" &&
    client.commercePlatform === "NUVEMSHOP" &&
    process.env.PRODUCT_CAMPAIGN_REVIEW_CLIENT_ID?.trim() === client.id,
  );
}

function checkState(
  client: Client,
  row: typeof checks.$inferSelect | undefined,
) {
  let snapshot = row?.payload as unknown as CampaignSnapshot | null;
  if (
    snapshot?.version !== 1 ||
    snapshot.accountId !== client.accountId ||
    snapshot.storeId !== client.storeId
  )
    snapshot = null;
  const isConfigured = configured(client);
  // Age the source reads themselves, not just when the result was saved.
  const observed = snapshot
    ? Math.min(
        Date.parse(snapshot.adsObservedAt),
        Date.parse(snapshot.stockObservedAt),
      )
    : NaN;
  const stale =
    !Number.isFinite(observed) ||
    Date.now() - observed > STALE_MS ||
    Boolean(row?.error) ||
    !isConfigured;
  return {
    configured: isConfigured,
    snapshot: snapshot ?? null,
    stale,
    checkedAt: snapshot ? (row?.checkedAt?.toISOString() ?? null) : null,
    attemptedAt: row?.attemptedAt?.toISOString() ?? null,
    error: row?.error ?? null,
    running: Boolean(row?.leaseUntil && row.leaseUntil.getTime() > Date.now()),
  };
}

const reviewStatusColumns = {
  recommendationId: reviews.recommendationId,
  decision: reviews.decision,
  reviewedAt: reviews.reviewedAt,
};

export async function getProductCampaignCheck(client: Client) {
  const [row] = await db
    .select()
    .from(checks)
    .where(eq(checks.clientId, client.id));
  const state = checkState(client, row);
  if (!reviewPilotEnabled(client)) return state;

  const recommendations =
    state.snapshot && !state.stale
      ? productCampaignRecommendations(state.snapshot)
      : [];
  const [history, decisions] = await Promise.all([
    db
      .select({ ...reviewStatusColumns, evidence: reviews.evidence })
      .from(reviews)
      .where(eq(reviews.clientId, client.id))
      .orderBy(desc(reviews.reviewedAt))
      .limit(20),
    recommendations.length > 0
      ? db
          .select(reviewStatusColumns)
          .from(reviews)
          .where(
            and(
              eq(reviews.clientId, client.id),
              inArray(
                reviews.recommendationId,
                recommendations.map(({ id }) => id),
              ),
            ),
          )
      : [],
  ]);
  const byId = new Map(
    decisions.map((review) => [review.recommendationId, review]),
  );
  return {
    ...state,
    reviewPilot: {
      recommendations: recommendations.map((item) => ({
        ...item,
        review: byId.get(item.id) ?? null,
      })),
      history,
    },
  };
}

export async function reviewProductCampaignRecommendation(
  client: Client,
  recommendationId: string,
  decision: ProductCampaignReviewDecision,
  reviewerUserId: string,
) {
  if (!reviewPilotEnabled(client)) return { status: "not_enabled" as const };

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(checks)
      .where(eq(checks.clientId, client.id))
      .for("update");
    const [previous] = await tx
      .select(reviewStatusColumns)
      .from(reviews)
      .where(
        and(
          eq(reviews.clientId, client.id),
          eq(reviews.recommendationId, recommendationId),
        ),
      );
    if (previous)
      return previous.decision === decision
        ? { status: "saved" as const, review: previous }
        : { status: "already_reviewed" as const };

    const state = checkState(client, row);
    if (state.stale || state.running || !state.snapshot)
      return { status: "expired" as const };
    const item = productCampaignRecommendations(state.snapshot).find(
      ({ id }) => id === recommendationId,
    );
    if (!item) return { status: "expired" as const };

    const [review] = await tx
      .insert(reviews)
      .values({
        clientId: client.id,
        recommendationId,
        decision,
        reviewerUserId,
        evidence: item.evidence,
      })
      .returning(reviewStatusColumns);
    return { status: "saved" as const, review };
  });
}

export async function runProductCampaignCheck(client: Client) {
  if (!configured(client)) return { status: "not_configured" as const };
  const now = new Date();
  const leaseId = nanoid();
  const leaseUntil = new Date(now.getTime() + LEASE_MS);
  const claimed = await db
    .insert(checks)
    .values({ clientId: client.id, leaseId, leaseUntil, attemptedAt: now })
    .onConflictDoUpdate({
      target: checks.clientId,
      set: { leaseId, leaseUntil, attemptedAt: now },
      setWhere: and(
        or(
          sql`${checks.leaseUntil} IS NULL`,
          sql`${checks.leaseUntil} < ${now}`,
        ),
        or(
          sql`${checks.attemptedAt} IS NULL`,
          sql`${checks.attemptedAt} < ${new Date(now.getTime() - 60_000)}`,
        ),
      ),
    })
    .returning({ clientId: checks.clientId });
  if (!claimed.length) return { status: "busy" as const };
  const owned = and(
    eq(checks.clientId, client.id),
    eq(checks.leaseId, leaseId),
  );
  const abort = new AbortController();
  // Leave room to persist failure before the host's 60-second request limit.
  const deadline = setTimeout(() => abort.abort(), 40_000);
  try {
    const [meta, catalog] = await Promise.all([
      fetchCampaignAds(client.accountId!, metaToken(client)!, abort.signal),
      fetchCampaignCatalog(client.storeId!, client.storeToken!, abort.signal),
    ]);
    const analysis = analyzeProductCampaigns(
      meta.ads,
      catalog.products,
      catalog.domains,
    );
    const snapshot: CampaignSnapshot = {
      ...analysis,
      version: 1,
      accountId: client.accountId!,
      storeId: client.storeId!,
      adsObservedAt: meta.observedAt,
      stockObservedAt: catalog.observedAt,
      window: meta.window,
      currency: meta.currency,
      timeZone: meta.timeZone,
      warnings: meta.warnings,
    };
    await db
      .update(checks)
      .set({
        payload: snapshot as unknown as Record<string, unknown>,
        checkedAt: new Date(),
        error: null,
        leaseId: null,
        leaseUntil: null,
      })
      .where(owned);
    return {
      status: "done" as const,
      products: analysis.rows.length,
      ads: analysis.totalAds,
    };
  } catch {
    abort.abort();
    // The prior snapshot survives outages; the UI marks it as unverified.
    await db
      .update(checks)
      .set({
        error:
          "Não foi possível concluir a análise. Verifique as integrações Meta e Nuvemshop; os dados anteriores foram preservados.",
        leaseId: null,
        leaseUntil: null,
      })
      .where(owned);
    return { status: "failed" as const };
  } finally {
    clearTimeout(deadline);
  }
}
