import { date, index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";

// Visualizacoes de produto (evento view_item do GA4) por dia, guardadas pelo job
// ga4_daily junto de ga4_daily_metrics. Equivale ao analytics_ga4_view_item que
// o script-vesti-nuvem (legado) ja mantem no BigQuery. A tela de produtos B2C
// somava isso ao vivo (fetchGa4ProductViewMetrics); agora le daqui.
//
// itemId/itemName/itemVariant ficam '' quando o GA4 nao informa (a chave
// primaria nao aceita null); quem le converte '' de volta pra null.
export const ga4ProductViewsDailyTable = pgTable(
  "ga4_product_views_daily",
  {
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    metricDate: date("metric_date").notNull(),
    itemId: text("item_id").notNull().default(""),
    itemName: text("item_name").notNull().default(""),
    itemVariant: text("item_variant").notNull().default(""),
    views: integer("views").notNull().default(0),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({
      name: "ga4_product_views_daily_pk",
      columns: [table.clientId, table.metricDate, table.itemId, table.itemName, table.itemVariant],
    }),
    clientDateIdx: index("ga4_product_views_daily_client_date_idx").on(table.clientId, table.metricDate),
  }),
);

export type Ga4ProductViewsDailyRow = typeof ga4ProductViewsDailyTable.$inferSelect;
export type InsertGa4ProductViewsDailyRow = typeof ga4ProductViewsDailyTable.$inferInsert;
