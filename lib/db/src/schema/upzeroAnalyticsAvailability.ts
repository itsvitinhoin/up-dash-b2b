import { pgTable, text, timestamp, primaryKey } from "drizzle-orm/pg-core";

export const upzeroAnalyticsAvailabilityTable = pgTable("upzero_analytics_availability", {
  scope: text("scope").notNull(),
  endpoint: text("endpoint").notNull(),
  retryAfter: timestamp("retry_after", { withTimezone: true }).notNull(),
  reason: text("reason").notNull(),
}, (table) => ({ pk: primaryKey({ columns: [table.scope, table.endpoint] }) }));
