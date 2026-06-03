import {
  pgTable,
  text,
  timestamp,
  integer,
  doublePrecision,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { clientsTable } from "./clients";
import { customersTable } from "./customers";

export const campaignAttributionStampsTable = pgTable(
  "campaign_attribution_stamps",
  {
    id: text("id").primaryKey().$defaultFn(() => nanoid()),
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    customerId: text("customer_id")
      .notNull()
      .references(() => customersTable.id, { onDelete: "cascade" }),
    userId: integer("user_id"),
    source: text("source"),
    medium: text("medium"),
    campaign: text("campaign"),
    label: text("label"),
    evidenceType: text("evidence_type").notNull().default("tracking"),
    evidenceEventName: text("evidence_event_name"),
    evidenceEventId: text("evidence_event_id"),
    evidenceAt: timestamp("evidence_at", { withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    totalPurchaseValueAtStamp: doublePrecision("total_purchase_value_at_stamp").notNull().default(0),
    purchaseCountAtStamp: integer("purchase_count_at_stamp").notNull().default(0),
    rawEvidence: jsonb("raw_evidence"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    clientIdx: index("campaign_attribution_stamps_client_idx").on(table.clientId),
    customerIdx: index("campaign_attribution_stamps_customer_idx").on(table.customerId),
    userIdx: index("campaign_attribution_stamps_user_idx").on(table.clientId, table.userId),
    customerUq: uniqueIndex("campaign_attribution_stamps_customer_uq").on(table.clientId, table.customerId),
  }),
);

export type CampaignAttributionStamp = typeof campaignAttributionStampsTable.$inferSelect;
export type InsertCampaignAttributionStamp = typeof campaignAttributionStampsTable.$inferInsert;
