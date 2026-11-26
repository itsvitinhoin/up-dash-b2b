import { date, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";

export type GoogleAdsCampaignMetrics = {
  campaignId: string;
  name: string;
  channel: string;
  costMicros: number;
  clicks: number;
  impressions: number;
  conversions: number;
  conversionValue: number;
};

export const googleAdsConnectionsTable = pgTable("google_ads_connections", {
  clientId: text("client_id").primaryKey().references(() => clientsTable.id, { onDelete: "cascade" }),
  customerId: text("customer_id").notNull().unique(),
  managerId: text("manager_id"),
  accountName: text("account_name").notNull(),
  currency: text("currency").notNull(),
  timeZone: text("time_zone").notNull(),
});

export const googleAdsDailyTable = pgTable("google_ads_daily", {
  customerId: text("customer_id").notNull().references(() => googleAdsConnectionsTable.customerId, { onDelete: "cascade" }),
  day: date("day").notNull(),
  campaigns: jsonb("campaigns").$type<GoogleAdsCampaignMetrics[]>().notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.customerId, table.day] }),
]);

export type GoogleAdsInsightSnapshot = {
  columns: Array<{ key: string; label: string; type: "text" | "number" | "currency" | "percent" | "ratio" }>;
  rows: Array<Record<string, string | number | null>>;
  limited: boolean;
  state: "ready" | "unavailable";
  source?: { campaign: string; url: string };
};

export const googleAdsInsightSnapshotsTable = pgTable("google_ads_insight_snapshots", {
  clientId: text("client_id").notNull().references(() => googleAdsConnectionsTable.clientId, { onDelete: "cascade" }),
  view: text("view").notNull(),
  dateFrom: date("date_from").notNull(),
  dateTo: date("date_to").notNull(),
  data: jsonb("data").$type<GoogleAdsInsightSnapshot>().notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.clientId, table.view, table.dateFrom, table.dateTo] }),
]);
