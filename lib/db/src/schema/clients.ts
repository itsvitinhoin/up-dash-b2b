import {
  pgTable,
  text,
  timestamp,
  doublePrecision,
  integer,
  boolean,
  index,
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
