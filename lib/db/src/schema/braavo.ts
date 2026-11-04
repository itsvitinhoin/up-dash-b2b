import {
  pgTable,
  text,
  timestamp,
  jsonb,
  primaryKey,
} from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";

export const BRAAVO_PHASES = [
  "categories",
  "variations",
  "products",
  "skus",
  "customers",
  "orders",
  "pending",
  "done",
] as const;
export type BraavoCursor = {
  phase: (typeof BRAAVO_PHASES)[number];
  page: number;
  day: string | null;
  fromDay: string | null;
  untilDay: string;
  full: boolean;
  startedAt: string;
  afterId?: string;
  processedIds?: string[];
};

export const braavoSyncStatesTable = pgTable("braavo_sync_states", {
  clientId: text("client_id")
    .primaryKey()
    .references(() => clientsTable.id, { onDelete: "cascade" }),
  fingerprint: text("fingerprint").notNull(),
  jobId: text("job_id"),
  cursor: jsonb("cursor").$type<BraavoCursor>(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  fullCompletedAt: timestamp("full_completed_at", { withTimezone: true }),
  leaseId: text("lease_id"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  error: text("error"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Only catalog metadata is cached here. Customer documents and contact details
// are normalized into customers; webhook-provided URLs are never stored/executed.
export const braavoCatalogTable = pgTable(
  "braavo_catalog",
  {
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["categories", "variations", "products"],
    }).notNull(),
    externalId: text("external_id").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.clientId, table.kind, table.externalId] }),
  ],
);

// Reserving the next slot in SQL keeps the limit shared across server instances,
// and across clients configured with the same shop domain.
export const braavoRequestSlotsTable = pgTable("braavo_request_slots", {
  domain: text("domain").primaryKey(),
  nextAt: timestamp("next_at", { withTimezone: true }).notNull(),
});
