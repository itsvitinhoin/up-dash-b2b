import {
  date,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { clientsTable } from "./clients";

export const dailyClientMetricsTable = pgTable(
  "daily_client_metrics",
  {
    id: text("id").primaryKey().$defaultFn(() => nanoid()),
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    metricDate: date("metric_date").notNull(),
    approvedRevenue: doublePrecision("approved_revenue").notNull().default(0),
    requestedRevenue: doublePrecision("requested_revenue").notNull().default(0),
    approvedOrders: integer("approved_orders").notNull().default(0),
    requestedOrders: integer("requested_orders").notNull().default(0),
    visits: integer("visits").notNull().default(0),
    registrations: integer("registrations").notNull().default(0),
    approvedRegistrations: integer("approved_registrations").notNull().default(0),
    purchases: integer("purchases").notNull().default(0),
    newBuyers: integer("new_buyers").notNull().default(0),
    returningBuyers: integer("returning_buyers").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    clientDateUniq: uniqueIndex("daily_client_metrics_client_date_uq").on(
      table.clientId,
      table.metricDate,
    ),
    clientDateIdx: index("daily_client_metrics_client_date_idx").on(
      table.clientId,
      table.metricDate,
    ),
  }),
);

export type DailyClientMetric = typeof dailyClientMetricsTable.$inferSelect;
export type InsertDailyClientMetric = typeof dailyClientMetricsTable.$inferInsert;
