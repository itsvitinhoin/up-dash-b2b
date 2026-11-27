import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";
import type { ProductCampaignReviewEvidence } from "./productCampaignChecks";

export const upManagerReportsTable = pgTable(
  "up_manager_reports",
  {
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    analysisDay: text("analysis_day").notNull(),
    dateFrom: text("date_from").notNull(),
    dateTo: text("date_to").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.clientId,
        table.analysisDay,
        table.dateFrom,
        table.dateTo,
      ],
    }),
    index("up_manager_reports_recent_idx").on(
      table.clientId,
      table.createdAt.desc(),
    ),
  ],
).enableRLS();

export interface UpManagerCreativePauseEvidence {
  kind: "creative-performance";
  adId: string;
  adName: string;
  campaignName: string;
  creativeId: string;
  adsetName: string;
  window: { since: string; until: string };
  spend: number;
  purchases: number;
  peerCpa: number;
  reason: string;
}

export type UpManagerGradePauseEvidence = {
  kind: "grade-stock";
  adId: string;
  adName: string;
  campaignName: string;
  adsetName: string;
  productId: string;
  productName: string;
  runId: string;
  outOfStockVariants: number;
};

export type UpManagerMediaActionEvidence = {
  kind: "media-pause" | "media-budget" | "media-reactivate";
  runId: string;
  entityId: string;
  entityLevel: "campaign" | "adset" | "ad";
  ownerId?: string;
  ownerLevel?: "campaign" | "adset";
  field?: "daily_budget" | "lifetime_budget";
  before?: number;
  after?: number;
  percent?: number;
  currency?: string;
  windowEnd: string;
};

export type UpManagerAudienceActionEvidence = {
  kind: "audience-create";
  runId: string;
  planId: string;
  name: string;
  audienceId?: string;
};

export type UpManagerDpaRemovalEvidence = {
  kind: "dpa-removal";
  catalogId: string;
  setId: string;
  productId: string;
  productName: string;
  variants: number;
  outOfStock: string[];
};

export const upManagerAdActionsTable = pgTable(
  "up_manager_ad_actions",
  {
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    recommendationId: text("recommendation_id").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    accountId: text("account_id").notNull(),
    status: text("status", {
      enum: ["pending", "paused", "stale", "uncertain", "applied"],
    }).notNull(),
    evidence: jsonb("evidence")
      .$type<ProductCampaignReviewEvidence | UpManagerCreativePauseEvidence | UpManagerGradePauseEvidence | UpManagerMediaActionEvidence | UpManagerAudienceActionEvidence | UpManagerDpaRemovalEvidence>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.clientId, table.recommendationId] }),
  ],
).enableRLS();

export const upManagerArchiveTable = pgTable(
  "up_manager_archive",
  {
    runId: text("run_id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    analysisDay: text("analysis_day").notNull(),
    dateFrom: text("date_from").notNull(),
    dateTo: text("date_to").notNull(),
    trigger: text("trigger", { enum: ["manual", "scheduled"] }).notNull(),
    version: text("version").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    archiveAttempt: integer("archive_attempt").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    index("up_manager_archive_pending_idx").on(
      table.clientId,
      table.archivedAt,
      table.createdAt,
    ),
  ],
).enableRLS();

export const upManagerInsightReviewsTable = pgTable(
  "up_manager_insight_reviews",
  {
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => upManagerArchiveTable.runId, { onDelete: "cascade" }),
    insightId: text("insight_id").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.insightId] })],
).enableRLS();

export const upManagerFollowupsTable = pgTable(
  "up_manager_followups",
  {
    clientId: text("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
    runId: text("run_id").notNull().references(() => upManagerArchiveTable.runId, { onDelete: "cascade" }),
    insightId: text("insight_id").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    measureOn: text("measure_on").notNull(),
    plan: jsonb("plan").$type<{
      title: string; action: string; expectation: string; note: string;
      metric: "revenue" | "purchases" | "roas" | "cac" | "checkout" | "repeat";
      target: number;
    }>().notNull(),
    result: jsonb("result").$type<{
      status: "improved" | "worsened" | "stable" | "mixed" | "insufficient";
      before: number | null; after: number | null; targetReached: boolean | null;
      checkedAt: string;
    }>(),
  },
  (table) => [
    primaryKey({ columns: [table.clientId, table.runId, table.insightId] }),
    index("up_manager_followups_due_idx").on(table.clientId, table.measureOn),
  ],
).enableRLS();

export const upManagerWeeklyGoalsTable = pgTable(
  "up_manager_weekly_goals",
  {
    clientId: text("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
    weekStart: text("week_start").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    updatedBy: text("updated_by").notNull(),
    goals: jsonb("goals").$type<{
      spendCap: number | null; targetCpa: number | null; targetRoas: number | null; context: string;
    }>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.clientId, table.weekStart] })],
).enableRLS();
