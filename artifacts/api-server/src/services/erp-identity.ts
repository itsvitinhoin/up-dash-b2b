// Extraído de erp-attribution.ts (21/09/2026) pra reaproveitar em
// recompra-analytics.ts sem duplicar a lógica de matching CNPJ/CPF ->
// cliente UpZero, que precisa ficar idêntica nos dois lugares. Mesmo
// comportamento de antes: cache em `customer_identity_links` primeiro,
// hash de documento direto, fallback e-mail/telefone só pra quem sobrou.
import { and, eq, inArray } from "drizzle-orm";
import { db, customersTable, customerIdentityLinksTable } from "@workspace/db";
import { hashDocument } from "./upzero/customers";

export type ResolvedErpCustomer = {
  id: string;
  externalId: string | null;
  documentHash: string | null;
  name: string | null;
  createdAt: Date | null;
};

export type ErpContactInfo = {
  email: string | null;
  ddd: string | null;
  celular: string | null;
  telefone: string | null;
};

function normalizeEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.includes("@") ? trimmed : null;
}

// Compara só os últimos 10 dígitos (DDD + número, sem DDI/zero na frente)
// -- ERP e UpZero podem guardar o telefone em formato diferente (com/sem
// +55, com/sem 9º dígito de celular antigo), os últimos 10 dígitos são o
// que sobra igual nos dois casos na maioria da vez.
function normalizePhoneLast10(ddd: string | null | undefined, phone: string | null | undefined): string | null {
  const digits = `${ddd ?? ""}${phone ?? ""}`.replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(-10) : null;
}

// Resolve uma lista de CNPJ/CPF crus do ERP pro customer_id estável da
// UpZero. Prioridade: 1) cache já resolvido em customer_identity_links;
// 2) hash do documento batendo direto com customers.document_hash; 3)
// fallback por e-mail/telefone normalizado (só pra quem sobrou sem match
// nos passos 1-2) -- full scan de customers do cliente, então só roda
// pros CNPJs realmente não resolvidos. Links novos (passos 2 e 3) são
// persistidos com onConflictDoNothing (link é estável, não "última escrita
// vence").
export async function resolveErpCustomerIdentities(params: {
  clientId: string;
  erpCustomerIds: string[]; // CNPJ/CPF cru, como vem de pedidos_erp.customer_id
  contactByDocument: Map<string, ErpContactInfo>; // pro fallback e-mail/telefone
}): Promise<{
  cnpjToHash: Map<string, string>;
  hashToCustomer: Map<string, ResolvedErpCustomer>;
}> {
  const cnpjToHash = new Map<string, string>();
  const hashToCustomer = new Map<string, ResolvedErpCustomer>();

  for (const cnpj of params.erpCustomerIds) {
    const hash = hashDocument(cnpj);
    if (hash) cnpjToHash.set(cnpj, hash);
  }
  const hashes = [...new Set(cnpjToHash.values())];

  const newIdentityLinks: Array<{ clientId: string; erpDocumentHash: string; customerId: string; matchMethod: "document_hash" | "email" | "phone" }> = [];

  const linkedRows = hashes.length
    ? await db
        .select({
          erpDocumentHash: customerIdentityLinksTable.erpDocumentHash,
          id: customersTable.id,
          externalId: customersTable.externalId,
          documentHash: customersTable.documentHash,
          name: customersTable.name,
          createdAt: customersTable.createdAt,
        })
        .from(customerIdentityLinksTable)
        .innerJoin(customersTable, eq(customersTable.id, customerIdentityLinksTable.customerId))
        .where(and(eq(customerIdentityLinksTable.clientId, params.clientId), inArray(customerIdentityLinksTable.erpDocumentHash, hashes)))
    : [];
  for (const row of linkedRows) {
    hashToCustomer.set(row.erpDocumentHash, { id: row.id, externalId: row.externalId, documentHash: row.documentHash, name: row.name, createdAt: row.createdAt });
  }

  const unlinkedHashes = hashes.filter((h) => !hashToCustomer.has(h));
  const hashMatches = unlinkedHashes.length
    ? await db
        .select({ id: customersTable.id, externalId: customersTable.externalId, documentHash: customersTable.documentHash, name: customersTable.name, createdAt: customersTable.createdAt })
        .from(customersTable)
        .where(and(eq(customersTable.clientId, params.clientId), inArray(customersTable.documentHash, unlinkedHashes)))
    : [];
  for (const m of hashMatches) {
    if (!m.documentHash) continue;
    hashToCustomer.set(m.documentHash, m);
    newIdentityLinks.push({ clientId: params.clientId, erpDocumentHash: m.documentHash, customerId: m.id, matchMethod: "document_hash" });
  }

  const cnpjMatchedSet = new Set(
    params.erpCustomerIds.filter((cnpj) => {
      const hash = cnpjToHash.get(cnpj);
      return Boolean(hash && hashToCustomer.get(hash));
    }),
  );
  const unmatchedCnpjs = params.erpCustomerIds.filter((cnpj) => !cnpjMatchedSet.has(cnpj));
  if (unmatchedCnpjs.length > 0) {
    const allClientCustomers = await db
      .select({
        id: customersTable.id,
        externalId: customersTable.externalId,
        documentHash: customersTable.documentHash,
        name: customersTable.name,
        createdAt: customersTable.createdAt,
        email: customersTable.email,
        phone: customersTable.phone,
      })
      .from(customersTable)
      .where(eq(customersTable.clientId, params.clientId));
    const byEmail = new Map<string, (typeof allClientCustomers)[number]>();
    const byPhone = new Map<string, (typeof allClientCustomers)[number]>();
    for (const c of allClientCustomers) {
      const email = normalizeEmail(c.email);
      if (email && !byEmail.has(email)) byEmail.set(email, c);
      const phone = normalizePhoneLast10(null, c.phone);
      if (phone && !byPhone.has(phone)) byPhone.set(phone, c);
    }

    const unmatchedSet = new Set(unmatchedCnpjs);
    for (const cnpj of unmatchedCnpjs) {
      const contact = params.contactByDocument.get(cnpj);
      const email = normalizeEmail(contact?.email ?? null);
      const phone = normalizePhoneLast10(contact?.ddd ?? null, contact?.celular ?? contact?.telefone ?? null);
      const matchedByEmail = email ? byEmail.get(email) : undefined;
      const match = matchedByEmail || (phone && byPhone.get(phone)) || null;
      if (!match) continue;
      // Chave sintética só pra reaproveitar hashToCustomer sem duplicar
      // toda a lógica de resolução que já existe acima dela.
      const syntheticKey = `email-or-phone:${match.id}`;
      cnpjToHash.set(cnpj, syntheticKey);
      if (!hashToCustomer.has(syntheticKey)) {
        hashToCustomer.set(syntheticKey, match);
        newIdentityLinks.push({
          clientId: params.clientId,
          erpDocumentHash: syntheticKey,
          customerId: match.id,
          matchMethod: matchedByEmail ? "email" : "phone",
        });
      }
      unmatchedSet.delete(cnpj);
    }
  }

  if (newIdentityLinks.length > 0) {
    await db.insert(customerIdentityLinksTable).values(newIdentityLinks).onConflictDoNothing({
      target: [customerIdentityLinksTable.clientId, customerIdentityLinksTable.erpDocumentHash],
    });
  }

  return { cnpjToHash, hashToCustomer };
}
