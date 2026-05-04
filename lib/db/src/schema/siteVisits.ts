import { pgTable, text, date, integer, uniqueIndex, index } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { clientsTable } from "./clients";

export const siteVisitsTable = pgTable(
  "site_visits",
  {
    id: text("id").primaryKey().$defaultFn(() => nanoid()),
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    visitDate: date("visit_date").notNull(),
    visitCount: integer("visit_count").notNull().default(0),
  },
  (table) => ({
    clientDateUniq: uniqueIndex("site_visits_client_date_uniq").on(table.clientId, table.visitDate),
    clientIdx: index("site_visits_client_idx").on(table.clientId),
  }),
);

export type SiteVisit = typeof siteVisitsTable.$inferSelect;
export type InsertSiteVisit = typeof siteVisitsTable.$inferInsert;
