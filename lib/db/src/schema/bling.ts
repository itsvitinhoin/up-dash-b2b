import {
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";

export type BlingCursor = {
  phase: "channels" | "products" | "customers" | "orders";
  page: number;
  pending: string[];
  lastPage: boolean;
  from: string;
  until: string;
  incremental: boolean;
};

export const blingConnectionsTable = pgTable(
  "bling_connections",
  {
    clientId: text("client_id")
      .primaryKey()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    companyId: text("company_id"),
    companyName: text("company_name"),
    tokens: text("tokens"), // AES-256-GCM, separate deployment key
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    nuvemshopChannelId: text("nuvemshop_channel_id"),
    historyDays: integer("history_days").notNull().default(30),
    cursor: jsonb("cursor").$type<BlingCursor>(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    watermark: text("watermark"),
    leaseId: text("lease_id"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    nextRequestAt: timestamp("next_request_at", { withTimezone: true }),
    error: text("error"),
  },
  (t) => [uniqueIndex("bling_company_uq").on(t.companyId)],
);

export const blingOauthStatesTable = pgTable("bling_oauth_states", {
  hash: text("hash").primaryKey(),
  clientId: text("client_id")
    .notNull()
    .references(() => clientsTable.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// ERP records stay separate from storefront records. Consolidation must use
// explicit channel/order links; importing them never adds a second store sale.
export const blingRecordsTable = pgTable(
  "bling_records",
  {
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["channels", "products", "customers", "orders"],
    }).notNull(),
    externalId: text("external_id").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.clientId, t.kind, t.externalId] }),
    index("bling_records_kind_idx").on(t.clientId, t.kind),
  ],
);
