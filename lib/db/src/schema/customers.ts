import {
  pgTable,
  text,
  timestamp,
  doublePrecision,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { clientsTable } from "./clients";

export const customersTable = pgTable(
  "customers",
  {
    id: text("id").primaryKey().$defaultFn(() => nanoid()),
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    externalId: text("external_id"),
    email: text("email").notNull(),
    phone: text("phone"),
    name: text("name"),
    documentType: text("document_type", { enum: ["CPF", "CNPJ"] }),
    documentHash: text("document_hash"),
    documentLast4: text("document_last4"),
    state: text("state"),
    city: text("city"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    utmContent: text("utm_content"),
    utmTerm: text("utm_term"),
    registrationStatus: text("registration_status", {
      enum: ["PENDING", "APPROVED", "REJECTED"],
    })
      .notNull()
      .default("PENDING"),
    approvalDate: timestamp("approval_date", { withTimezone: true }),
    rfmSegment: text("rfm_segment"),
    recencyScore: integer("recency_score"),
    frequencyScore: integer("frequency_score"),
    monetaryScore: integer("monetary_score"),
    totalOrders: integer("total_orders").notNull().default(0),
    totalSpent: doublePrecision("total_spent").notNull().default(0),
    firstPurchaseAt: timestamp("first_purchase_at", { withTimezone: true }),
    lastPurchaseAt: timestamp("last_purchase_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    clientEmailUq: uniqueIndex("customers_client_email_uq").on(
      table.clientId,
      table.email,
    ),
    externalIdIdx: uniqueIndex("customers_client_external_id_uq").on(
      table.clientId,
      table.externalId,
    ),
    clientIdx: index("customers_client_idx").on(table.clientId),
    rfmIdx: index("customers_rfm_idx").on(table.clientId, table.rfmSegment),
    statusIdx: index("customers_status_idx").on(
      table.clientId,
      table.registrationStatus,
    ),
    clientCreatedIdx: index("customers_client_created_idx").on(
      table.clientId,
      table.createdAt,
    ),
  }),
);

export type Customer = typeof customersTable.$inferSelect;
export type InsertCustomer = typeof customersTable.$inferInsert;
