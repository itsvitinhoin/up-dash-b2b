import { pgTable, text, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";
import { customersTable } from "./customers";

// Criada 08/09/2026 -- resolve a lentidão do relatório de atribuição
// (~35s pra ~70 clientes: cada um custa ~2s na API da UpZero, e o teto
// é do lado deles, paralelizar aqui não ajuda). Guarda QUAL janela de
// tempo já foi sincronizada de `/analytics/facts` pra cada cliente, pra
// próxima chamada com uma janela JÁ COBERTA poder ler direto de
// `paid_touchpoints` (Postgres, instantâneo) em vez de bater na UpZero
// de novo. Uma linha por (client, customer) -- syncedFrom/syncedTo é a
// UNIÃO de tudo que já foi buscado com sucesso até agora.
export const paidTouchpointsSyncTable = pgTable(
  "paid_touchpoints_sync",
  {
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    customerId: text("customer_id")
      .notNull()
      .references(() => customersTable.id, { onDelete: "cascade" }),
    syncedFrom: timestamp("synced_from", { withTimezone: true }).notNull(),
    syncedTo: timestamp("synced_to", { withTimezone: true }).notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.clientId, table.customerId] }),
  }),
);

export type PaidTouchpointsSync = typeof paidTouchpointsSyncTable.$inferSelect;
export type InsertPaidTouchpointsSync = typeof paidTouchpointsSyncTable.$inferInsert;
