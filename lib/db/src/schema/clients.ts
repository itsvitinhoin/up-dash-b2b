import {
  pgTable,
  text,
  timestamp,
  doublePrecision,
  integer,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { usersTable } from "./users";

export const clientsTable = pgTable(
  "clients",
  {
    id: text("id").primaryKey().$defaultFn(() => nanoid()),
    name: text("name").notNull().unique(),
    email: text("email").notNull().unique(),
    apiKey: text("api_key").notNull().unique(),
    adminId: text("admin_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    userId: text("user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    revenueYtd: doublePrecision("revenue_ytd").notNull().default(0),
    ordersYtd: integer("orders_ytd").notNull().default(0),
    leadsYtd: integer("leads_ytd").notNull().default(0),
    approvedLeads: integer("approved_leads").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    metaAdsApiKey: text("meta_ads_api_key"),
    metaAdAccountId: text("meta_ad_account_id"),
    upZeroApiKey: text("up_zero_api_key"),
    dashboardType: text("dashboard_type", { enum: ["B2B", "B2C"] }).notNull().default("B2B"),
    commercePlatform: text("commerce_platform", { enum: ["UPZERO", "NUVEMSHOP", "MANUAL"] })
      .notNull()
      .default("UPZERO"),
    nuvemshopStoreId: text("nuvemshop_store_id"),
    nuvemshopAccessToken: text("nuvemshop_access_token"),
    ga4MeasurementId: text("ga4_measurement_id"),
    ga4PropertyId: text("ga4_property_id"),
    ga4ApiSecret: text("ga4_api_secret"),
    currency: text("currency").notNull().default("BRL"),
    locale: text("locale").notNull().default("pt-BR"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    adminIdx: index("clients_admin_idx").on(table.adminId),
    userIdx: index("clients_user_idx").on(table.userId),
  }),
);

export type Client = typeof clientsTable.$inferSelect;
export type InsertClient = typeof clientsTable.$inferInsert;

export const clientUserAccessesTable = pgTable(
  "client_user_accesses",
  {
    id: text("id").primaryKey().$defaultFn(() => nanoid()),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    userIdx: index("client_user_accesses_user_idx").on(table.userId),
    clientIdx: index("client_user_accesses_client_idx").on(table.clientId),
    userClientUnique: uniqueIndex("client_user_accesses_user_client_unique").on(
      table.userId,
      table.clientId,
    ),
  }),
);

export type ClientUserAccess = typeof clientUserAccessesTable.$inferSelect;
export type InsertClientUserAccess = typeof clientUserAccessesTable.$inferInsert;
