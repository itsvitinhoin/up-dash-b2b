import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { clientsTable } from "./clients";
import { customersTable } from "./customers";

// Criada 10/09/2026 -- snapshot da decisão de atribuição por pedido,
// gravado como efeito colateral de `computeErpPaidAttribution`
// (erp-attribution.ts) toda vez que ela roda. NÃO substitui a query ao
// vivo de pedidos (ERP/BigQuery + site/Postgres) -- a tela precisa mostrar
// todo pedido do período, valor/status atual, então isso continua ao vivo.
// O ganho aqui é histórico/auditoria: sobreviver a mudança de regra
// (`ruleVersion`) e responder "como esse pedido foi classificado quando
// calculado" mesmo depois da regra mudar.
export const orderAttributionsTable = pgTable(
  "order_attributions",
  {
    id: text("id").primaryKey().$defaultFn(() => nanoid()),
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    channel: text("channel", { enum: ["erp", "site"] }).notNull(),
    orderId: text("order_id").notNull(),
    customerId: text("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
    attributionState: text("attribution_state", {
      enum: ["PAID_ORIGIN", "PAID_ASSISTED"],
    }),
    touchpointAt: timestamp("touchpoint_at", { withTimezone: true }),
    touchpointSource: text("touchpoint_source"),
    touchpointMedium: text("touchpoint_medium"),
    touchpointCampaign: text("touchpoint_campaign"),
    cohort: text("cohort", { enum: ["novo", "recorrente", "reativado"] }),
    ruleVersion: text("rule_version").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clientChannelOrderUq: uniqueIndex("order_attributions_client_channel_order_uq").on(
      table.clientId,
      table.channel,
      table.orderId,
    ),
  }),
);

export type OrderAttribution = typeof orderAttributionsTable.$inferSelect;
export type InsertOrderAttribution = typeof orderAttributionsTable.$inferInsert;
