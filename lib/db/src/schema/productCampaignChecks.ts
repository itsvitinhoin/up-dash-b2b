import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";

// One atomic snapshot per client. Failed runs keep the last successful payload.
export const productCampaignChecksTable = pgTable("product_campaign_checks", {
  clientId: text("client_id")
    .primaryKey()
    .references(() => clientsTable.id, { onDelete: "cascade" }),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }),
  error: text("error"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  leaseId: text("lease_id"),
}).enableRLS();

export const productCampaignReviewDecisions = [
  "agree",
  "dismiss",
  "investigate",
] as const;
export type ProductCampaignReviewDecision =
  (typeof productCampaignReviewDecisions)[number];

export interface ProductCampaignReviewEvidence {
  adId: string;
  adName: string;
  campaignName: string;
  adsetName: string;
  productId: string;
  productName: string;
  productUrl: string;
  observedAt: { ads: string; stock: string };
  window: { since: string; until: string };
  currency: string;
  timeZone: string;
  impressions: number;
  spend: number | null;
}

export const productCampaignReviewsTable = pgTable(
  "product_campaign_reviews",
  {
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    recommendationId: text("recommendation_id").notNull(),
    decision: text("decision", {
      enum: productCampaignReviewDecisions,
    }).notNull(),
    reviewerUserId: text("reviewer_user_id").notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    evidence: jsonb("evidence")
      .$type<ProductCampaignReviewEvidence>()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.clientId, table.recommendationId] }),
    index("product_campaign_reviews_client_time_idx").on(
      table.clientId,
      table.reviewedAt.desc(),
    ),
    check(
      "product_campaign_reviews_decision_check",
      sql`${table.decision} IN ('agree', 'dismiss', 'investigate')`,
    ),
  ],
).enableRLS();
