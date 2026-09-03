import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { clientsTable } from "./clients";
import { customersTable } from "./customers";

// Criada 03/09/2026 -- guarda evidência de clique/toque de mídia paga POR
// EVENTO (não um carimbo único por cliente como `campaign_attribution_stamps`
// já fazia). Necessário pra responder "esse pedido específico teve clique
// pago ANTES dele" -- um cliente pode ter vários touchpoints ao longo do
// tempo, e cada pedido precisa olhar só o que aconteceu antes dele.
//
// `occurredAt` é a hora REAL do clique, não a hora que o evento chegou no
// nosso sistema -- decodificada do cookie `fbc` da Meta quando disponível
// (formato fb.<subdomain>.<timestamp_ms>.<fbclid>), que carrega a hora
// original do clique mesmo em eventos vistos dias depois. Achado 03/09/2026
// validando o PDF de atribuição da MX Fashion: o endpoint agregado
// `/analytics/metrics` não mostrava click pago pra clientes específicos
// que comprovadamente tinham clique real (confirmado via `fbc` decodificado
// direto no endpoint bruto `/analytics/facts?user_id=`).
export const paidTouchpointsTable = pgTable(
  "paid_touchpoints",
  {
    id: text("id").primaryKey().$defaultFn(() => nanoid()),
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    customerId: text("customer_id")
      .notNull()
      .references(() => customersTable.id, { onDelete: "cascade" }),
    externalUserId: integer("external_user_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    eventName: text("event_name"),
    source: text("source"),
    medium: text("medium"),
    campaign: text("campaign"),
    fbc: text("fbc"),
    fbclid: text("fbclid"),
    gclid: text("gclid"),
    // Chave de dedup: o valor de fbc/fbclid/gclid quando existe (o mesmo
    // clique aparece em várias linhas de evento -- só queremos 1 touchpoint
    // por clique real), senão uma combinação sintética de utm+occurredAt.
    evidenceKey: text("evidence_key").notNull(),
    rawEvent: jsonb("raw_event"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clientCustomerEvidenceUq: uniqueIndex("paid_touchpoints_client_customer_evidence_uq").on(
      table.clientId,
      table.customerId,
      table.evidenceKey,
    ),
    clientCustomerOccurredIdx: index("paid_touchpoints_client_customer_occurred_idx").on(
      table.clientId,
      table.customerId,
      table.occurredAt,
    ),
  }),
);

export type PaidTouchpoint = typeof paidTouchpointsTable.$inferSelect;
export type InsertPaidTouchpoint = typeof paidTouchpointsTable.$inferInsert;
