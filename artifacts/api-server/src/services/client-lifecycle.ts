// Ciclo de vida do cliente: o que sai junto quando ele é apagado de vez e a limpeza automática dos que passaram do prazo.
// Para o time isso é "excluir"; por trás, excluir = arquivar (some do painel, sai das atualizações, login bloqueado) e só depois
// de ARCHIVE_RETENTION_DAYS os dados são apagados de verdade. As regras de prazo ficam em client-archive-rules.ts.
import { and, asc, eq, inArray, isNotNull, lte, ne } from "drizzle-orm";
import { db, clientsTable, clientUserAccessesTable, usersTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { ARCHIVE_RETENTION_DAYS, archivePurgeCutoff } from "./client-archive-rules";

export type ClientLoginUser = { id: string; email: string };

export type ExternalDatasets = { bigqueryDataset: string | null; erpDataset: string | null };

export function externalDatasetsOf(client: { bigqueryDataset: string | null; erpDataset: string | null }): ExternalDatasets {
  return {
    bigqueryDataset: client.bigqueryDataset?.trim() || null,
    erpDataset: client.erpDataset?.trim() || null,
  };
}

// Logins (papel CLIENT) que existem só para este cliente: são os que saem junto quando o cliente é excluído/apagado.
// Quem tem acesso a outro cliente também fica de fora (não pode perder o acesso à marca que continua ativa).
export async function exclusiveClientLoginUsers(clientId: string, ownerUserId: string | null): Promise<ClientLoginUser[]> {
  const linked = await db
    .select({ id: usersTable.id, email: usersTable.email, role: usersTable.role })
    .from(clientUserAccessesTable)
    .innerJoin(usersTable, eq(usersTable.id, clientUserAccessesTable.userId))
    .where(eq(clientUserAccessesTable.clientId, clientId));
  const candidates = new Map<string, ClientLoginUser>();
  for (const user of linked) {
    if (user.role === "CLIENT") candidates.set(user.id, { id: user.id, email: user.email });
  }
  if (ownerUserId && !candidates.has(ownerUserId)) {
    const [owner] = await db
      .select({ id: usersTable.id, email: usersTable.email, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, ownerUserId));
    if (owner?.role === "CLIENT") candidates.set(owner.id, { id: owner.id, email: owner.email });
  }
  if (candidates.size === 0) return [];
  const ids = [...candidates.keys()];
  const [otherAccesses, otherOwned] = await Promise.all([
    db
      .select({ userId: clientUserAccessesTable.userId })
      .from(clientUserAccessesTable)
      .where(and(inArray(clientUserAccessesTable.userId, ids), ne(clientUserAccessesTable.clientId, clientId))),
    db
      .select({ userId: clientsTable.userId })
      .from(clientsTable)
      .where(and(inArray(clientsTable.userId, ids), ne(clientsTable.id, clientId))),
  ]);
  const shared = new Set<string>([
    ...otherAccesses.map((row) => row.userId),
    ...otherOwned.map((row) => row.userId).filter((id): id is string => Boolean(id)),
  ]);
  return [...candidates.values()].filter((user) => !shared.has(user.id));
}

export type ClientToDelete = {
  id: string;
  userId: string | null;
  bigqueryDataset: string | null;
  erpDataset: string | null;
};

// Apaga o cliente de vez. ON DELETE CASCADE leva junto pedidos, clientes finais, eventos, criativos, jobs, WhatsApp etc.
// Os logins exclusivos dele saem na mesma transação: ou apaga tudo, ou nada.
// Os datasets do BigQuery/ERP NÃO são apagados aqui: só voltam no resultado para quem for limpar à mão.
export async function deleteClientWithLogins(client: ClientToDelete): Promise<{ deletedLoginUsers: number; external: ExternalDatasets }> {
  const loginUsers = await exclusiveClientLoginUsers(client.id, client.userId);
  await db.transaction(async (tx) => {
    await tx.delete(clientsTable).where(eq(clientsTable.id, client.id));
    if (loginUsers.length > 0) {
      await tx.delete(usersTable).where(inArray(usersTable.id, loginUsers.map((user) => user.id)));
    }
  });
  return { deletedLoginUsers: loginUsers.length, external: externalDatasetsOf(client) };
}

export type PurgeSummary = {
  dryRun: boolean;
  retentionDays: number;
  /** Clientes que já passaram do prazo. */
  due: number;
  purged: number;
  /** Quantos falharam (o job sai com código != 0 quando > 0). */
  failed: number;
  clients: Array<{ id: string; name: string; archivedAt: string; deletedLoginUsers?: number; external: ExternalDatasets; error?: string }>;
};

// Limpeza automática: apaga de vez os clientes excluídos há mais de ARCHIVE_RETENTION_DAYS.
// Com dryRun só lista quem seria apagado. Falha de um cliente não impede os outros.
export async function purgeExpiredClients(options: { now?: Date; dryRun?: boolean } = {}): Promise<PurgeSummary> {
  const now = options.now ?? new Date();
  const dryRun = Boolean(options.dryRun);
  const cutoff = archivePurgeCutoff(now);
  const due = await db
    .select({
      id: clientsTable.id,
      name: clientsTable.name,
      userId: clientsTable.userId,
      archivedAt: clientsTable.archivedAt,
      bigqueryDataset: clientsTable.bigqueryDataset,
      erpDataset: clientsTable.erpDataset,
    })
    .from(clientsTable)
    .where(and(isNotNull(clientsTable.archivedAt), lte(clientsTable.archivedAt, cutoff)))
    .orderBy(asc(clientsTable.archivedAt));

  const summary: PurgeSummary = { dryRun, retentionDays: ARCHIVE_RETENTION_DAYS, due: due.length, purged: 0, failed: 0, clients: [] };
  for (const client of due) {
    const archivedAt = client.archivedAt ? client.archivedAt.toISOString() : "";
    const external = externalDatasetsOf(client);
    if (dryRun) {
      summary.clients.push({ id: client.id, name: client.name, archivedAt, external });
      continue;
    }
    try {
      const result = await deleteClientWithLogins(client);
      summary.purged += 1;
      summary.clients.push({ id: client.id, name: client.name, archivedAt, deletedLoginUsers: result.deletedLoginUsers, external });
      logger.warn({ clientId: client.id, name: client.name, archivedAt, external }, "Client purged after retention period");
    } catch (err) {
      summary.failed += 1;
      summary.clients.push({ id: client.id, name: client.name, archivedAt, external, error: err instanceof Error ? err.message : String(err) });
      logger.error({ err, clientId: client.id, name: client.name }, "Failed to purge client");
    }
  }
  return summary;
}
