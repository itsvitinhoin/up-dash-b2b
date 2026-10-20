import { date, index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";

// Criada 20/10/2026 -- a lista de clientes (GET /clients) chamava a API do
// GA4 ao vivo pra cada loja B2C a cada recarga (~2s da lista, e 4 de 7
// propriedades recusadas em silencio). Agora um job (TASK=ga4_daily) puxa as
// metricas diarias e guarda aqui; a tela so le. Uma linha por (cliente, dia),
// com zeros nos dias sem trafego -- assim "tem linha" quer dizer "ja
// sincronizou", e a tela distingue "sem dado ainda" de "0 sessoes".
//
// Nao reaproveita `daily_client_metrics.visits`: aquela coluna conta eventos
// VISIT da UpZero e e sobrescrita por refreshDailyClientMetrics.
export const ga4DailyMetricsTable = pgTable(
  "ga4_daily_metrics",
  {
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    metricDate: date("metric_date").notNull(),
    sessions: integer("sessions").notNull().default(0),
    pageViews: integer("page_views").notNull().default(0),
    productViews: integer("product_views").notNull().default(0),
    addToCarts: integer("add_to_carts").notNull().default(0),
    checkouts: integer("checkouts").notNull().default(0),
    purchases: integer("purchases").notNull().default(0),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.clientId, table.metricDate] }),
    dateIdx: index("ga4_daily_metrics_date_idx").on(table.metricDate),
  }),
);

export type Ga4DailyMetricRow = typeof ga4DailyMetricsTable.$inferSelect;
export type InsertGa4DailyMetricRow = typeof ga4DailyMetricsTable.$inferInsert;
