import { pgTable, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { clientsTable } from "./clients";
import { customersTable } from "./customers";
import { productsTable } from "./products";
import { ordersTable } from "./orders";
import { sql } from "drizzle-orm";

export const eventsTable = pgTable(
  "events",
  {
    id: text("id").primaryKey().$defaultFn(() => nanoid()),
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    customerId: text("customer_id").references(() => customersTable.id, {
      onDelete: "cascade",
    }),
    eventType: text("event_type", {
      enum: [
        "VISIT",
        "REGISTRATION",
        "APPROVED_REGISTRATION",
        "PRODUCT_VIEW",
        "ADD_TO_CART",
        "CHECKOUT_STARTED",
        "PURCHASE",
      ],
    }).notNull(),
    productId: text("product_id").references(() => productsTable.id, {
      onDelete: "set null",
    }),
    orderId: text("order_id").references(() => ordersTable.id, {
      onDelete: "set null",
    }),
    externalSourceId: text("external_source_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clientIdx: index("events_client_idx").on(table.clientId),
    customerIdx: index("events_customer_idx").on(table.customerId),
    typeIdx: index("events_type_idx").on(table.clientId, table.eventType),
    createdAtIdx: index("events_created_idx").on(
      table.clientId,
      table.createdAt,
    ),
    externalSourceUniq: uniqueIndex("events_external_source_uniq")
      .on(table.clientId, table.eventType, table.externalSourceId)
      .where(sql`external_source_id IS NOT NULL`),
  }),
);

export type Event = typeof eventsTable.$inferSelect;
export type InsertEvent = typeof eventsTable.$inferInsert;
