import {
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
  primaryKey,
} from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";

export const BRAAVO_PHASES = [
  "categories",
  "variations",
  "products",
  "skus",
  // Só na carga completa: copia os endereços de todos os clientes em lote, para ler a
  // lista de clientes sem uma consulta de detalhe por cliente.
  "customer_addresses",
  "customers",
  // Só na carga completa: copia os itens de todos os pedidos em lote (100 por chamada)
  // para o catálogo, em vez de uma chamada de detalhe por pedido.
  "order_items",
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
  /** Invalid records quarantined so far in this cycle (see braavo_record_issues). */
  skipped?: number;
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
      enum: ["categories", "variations", "products", "order_items", "customer_addresses"],
    }).notNull(),
    externalId: text("external_id").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.clientId, table.kind, table.externalId] }),
  ],
);

// Records the shop sent that cannot be imported (impossible value, unknown
// status...). The batch continues past them instead of stalling the whole shop;
// each row is removed automatically once a later import of that record succeeds.
export const braavoRecordIssuesTable = pgTable(
  "braavo_record_issues",
  {
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    phase: text("phase").notNull(),
    externalId: text("external_id").notNull(),
    reason: text("reason").notNull(),
    attempts: integer("attempts").notNull().default(1),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.clientId, table.phase, table.externalId] }),
  ],
);

// Reserving the next slot in SQL keeps the limit shared across server instances,
// and across clients configured with the same shop domain.
export const braavoRequestSlotsTable = pgTable("braavo_request_slots", {
  domain: text("domain").primaryKey(),
  nextAt: timestamp("next_at", { withTimezone: true }).notNull(),
});
