import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { clientsTable } from "./clients";
import { customersTable } from "./customers";

// Criada 10/09/2026 -- resolução de identidade CNPJ/e-mail/telefone (feita
// hoje ao vivo em erp-attribution.ts, toda vez que o relatório abre) gera o
// mesmo resultado a cada vez pra um dado cliente ERP -- vale guardar em vez
// de recalcular. `erpDocumentHash` guarda `hashDocument(cnpj)` (o mesmo hash
// já comparado contra `customersTable.documentHash`) OU, quando o match foi
// por e-mail/telefone (CNPJ não bateu), a chave sintética
// `email-or-phone:<customerId>` já usada hoje -- nunca o documento cru,
// seguindo a mesma convenção de `customersTable` (que também só guarda hash).
export const customerIdentityLinksTable = pgTable(
  "customer_identity_links",
  {
    id: text("id").primaryKey().$defaultFn(() => nanoid()),
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    erpDocumentHash: text("erp_document_hash").notNull(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customersTable.id, { onDelete: "cascade" }),
    matchMethod: text("match_method", {
      enum: ["document_hash", "email", "phone"],
    }).notNull(),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clientDocumentUq: uniqueIndex("customer_identity_links_client_document_uq").on(
      table.clientId,
      table.erpDocumentHash,
    ),
  }),
);

export type CustomerIdentityLink = typeof customerIdentityLinksTable.$inferSelect;
export type InsertCustomerIdentityLink = typeof customerIdentityLinksTable.$inferInsert;
