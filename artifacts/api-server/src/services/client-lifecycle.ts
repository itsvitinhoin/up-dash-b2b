// Ciclo de vida do cliente: o que sai junto quando ele é apagado de vez e a limpeza automática dos que passaram do prazo.
// Para o time isso é "excluir"; por trás, excluir = arquivar (some do painel, sai das atualizações, login bloqueado) e só depois
// de ARCHIVE_RETENTION_DAYS os dados são apagados de verdade. As regras de prazo ficam em client-archive-rules.ts.
import { and, asc, eq, inArray, isNotNull, lte, ne } from "drizzle-orm";
import { db, clientsTable, clientUserAccessesTable, usersTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { ARCHIVE_RETENTION_DAYS, archivePurgeCutoff } from "./client-archive-rules";
import {
  computeExcludedRows,
  datasetsToDrop,
  isBigQueryAvailable,
  tombstonesFor,
  type ClientKeySource,
  type DatasetSkipReason,
  type ExcludedRow,
} from "./excluded-clients-rules";
import { deleteTenantRows, dropDataset, dropGa4Tables, readTombstones, replaceExcludedRows, type BigQueryLike } from "./excluded-clients-bq";

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
  name: string;
  userId: string | null;
  bigqueryDataset: string | null;
  erpDataset: string | null;
  metaAdAccountId: string | null;
  ga4PropertyId: string | null;
};

// Apaga o cliente do banco do painel. ON DELETE CASCADE leva junto pedidos, clientes finais, eventos, criativos, jobs, WhatsApp etc.
// Os logins exclusivos dele saem na mesma transação: ou apaga tudo, ou nada. O BigQuery é tratado em purgeClientCompletely.
export async function deleteClientWithLogins(client: Pick<ClientToDelete, "id" | "userId" | "bigqueryDataset" | "erpDataset">): Promise<{ deletedLoginUsers: number; external: ExternalDatasets }> {
  const loginUsers = await exclusiveClientLoginUsers(client.id, client.userId);
  await db.transaction(async (tx) => {
    await tx.delete(clientsTable).where(eq(clientsTable.id, client.id));
    if (loginUsers.length > 0) {
      await tx.delete(usersTable).where(inArray(usersTable.id, loginUsers.map((user) => user.id)));
    }
  });
  return { deletedLoginUsers: loginUsers.length, external: externalDatasetsOf(client) };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// BigQuery
// ---------------------------------------------------------------------------------------------------------------------------------

/** Este ambiente fala com o BigQuery? (só o desenvolvimento/teste local, sem credencial nem plataforma, pula os passos do BigQuery) */
export function bigQueryConfigured(): boolean {
  return isBigQueryAvailable();
}

/** Apagar datasets, tabelas do GA4 e linhas consolidadas ao apagar de vez. DESLIGADO por padrão (apagar dataset não tem volta): liga com BQ_PURGE_ENABLED=true. A lista de excluídos continua sendo publicada. */
export function bigQueryPurgeEnabled(): boolean {
  return ["true", "1", "yes", "sim"].includes((process.env.BQ_PURGE_ENABLED ?? "").trim().toLowerCase());
}

async function defaultBigQuery(): Promise<BigQueryLike> {
  return (await import("../lib/bigquery")).bigquery as unknown as BigQueryLike;
}

async function loadClientKeySources(): Promise<ClientKeySource[]> {
  return db
    .select({
      id: clientsTable.id,
      name: clientsTable.name,
      archivedAt: clientsTable.archivedAt,
      bigqueryDataset: clientsTable.bigqueryDataset,
      erpDataset: clientsTable.erpDataset,
      metaAdAccountId: clientsTable.metaAdAccountId,
      ga4PropertyId: clientsTable.ga4PropertyId,
    })
    .from(clientsTable);
}

/**
 * Publica no BigQuery (up_global.excluded_clients) a lista de clientes excluídos, para os outros programas pararem de atualizá-los.
 * Idempotente: sempre reescreve a tabela inteira a partir do estado atual (clientes na lixeira + lápides). Sem credencial, não faz nada.
 */
export async function reconcileExcludedClients(options: { bq?: BigQueryLike; newlyDeleted?: ExcludedRow[] } = {}): Promise<{ skipped: boolean; rows: number }> {
  if (!options.bq && !bigQueryConfigured()) return { skipped: true, rows: 0 };
  const bq = options.bq ?? (await defaultBigQuery());
  // Lê tudo ANTES de reescrever: se qualquer leitura falhar, a tabela atual (e as lápides) ficam como estão.
  const [clients, tombstones] = await Promise.all([loadClientKeySources(), readTombstones(bq)]);
  const rows = computeExcludedRows({ clients, tombstones, newlyDeleted: options.newlyDeleted });
  await replaceExcludedRows(bq, rows);
  return { skipped: false, rows: rows.length };
}

export type PurgeClientBigQuery = {
  configured: boolean;
  enabled: boolean;
  tombstones: number;
  droppedDatasets: string[];
  droppedGa4Tables: string[];
  skippedDatasets: Array<{ dataset: string; reason: DatasetSkipReason }>;
  deletedGlobalRows: number;
};

/** O que seria feito no BigQuery se o cliente fosse apagado agora (só leitura do Postgres; não chama o BigQuery). */
export async function planBigQueryPurge(client: Pick<ClientToDelete, "id" | "bigqueryDataset" | "erpDataset">): Promise<{
  configured: boolean;
  enabled: boolean;
  willDrop: string[];
  skippedDatasets: Array<{ dataset: string; reason: DatasetSkipReason }>;
}> {
  const all = await loadClientKeySources();
  const plan = datasetsToDrop(client, all);
  const configured = bigQueryConfigured();
  return { configured, enabled: configured && bigQueryPurgeEnabled(), willDrop: configured && bigQueryPurgeEnabled() ? plan.targets : [], skippedDatasets: plan.skipped };
}

/**
 * Apaga o cliente de vez, na ordem que não deixa lixo para trás:
 *  1) lápide na lista de excluídos (senão o script, que ainda tem o cliente cadastrado, recriaria o dataset);
 *  2) linhas dele nas tabelas consolidadas da up_global + dataset do BigQuery;
 *  3) banco do painel (cascata + logins exclusivos).
 * Se o BigQuery falhar, lança erro ANTES de apagar do painel: o cliente continua na lixeira e a próxima limpeza tenta de novo.
 */
export async function purgeClientCompletely(
  client: ClientToDelete,
  options: { bq?: BigQueryLike } = {},
): Promise<{ deletedLoginUsers: number; external: ExternalDatasets; bigquery: PurgeClientBigQuery }> {
  const all = await loadClientKeySources();
  const me: ClientKeySource = all.find((candidate) => candidate.id === client.id) ?? { ...client, archivedAt: new Date() };
  const plan = datasetsToDrop(me, all);
  const available = Boolean(options.bq) || bigQueryConfigured();
  const bigquery: PurgeClientBigQuery = {
    configured: available,
    enabled: available && bigQueryPurgeEnabled(),
    tombstones: 0,
    droppedDatasets: [],
    droppedGa4Tables: [],
    skippedDatasets: plan.skipped,
    deletedGlobalRows: 0,
  };

  if (available) {
    const bq = options.bq ?? (await defaultBigQuery());
    const tombstones = tombstonesFor(me);
    await reconcileExcludedClients({ bq, newlyDeleted: tombstones });
    bigquery.tombstones = tombstones.length;
    if (bigquery.enabled) {
      for (const dataset of plan.targets) {
        bigquery.deletedGlobalRows += await deleteTenantRows(bq, dataset);
        bigquery.droppedGa4Tables.push(...(await dropGa4Tables(bq, dataset)));
        if (await dropDataset(bq, dataset)) bigquery.droppedDatasets.push(dataset);
      }
    }
  }

  const deleted = await deleteClientWithLogins(client);
  return { ...deleted, bigquery };
}

export type PurgeSummary = {
  dryRun: boolean;
  retentionDays: number;
  /** Clientes que já passaram do prazo. */
  due: number;
  purged: number;
  /** Quantos falharam (o job sai com código != 0 quando > 0). */
  failed: number;
  clients: Array<{
    id: string;
    name: string;
    archivedAt: string;
    deletedLoginUsers?: number;
    external: ExternalDatasets;
    /** Datasets que seriam (dry run) ou foram apagados no BigQuery. */
    bigqueryDatasets?: string[];
    bigquery?: PurgeClientBigQuery;
    error?: string;
  }>;
  /** Linhas publicadas na lista de excluídos ao final (null = BigQuery não configurado ou dry run). */
  excludedListRows: number | null;
};

// Limpeza automática: apaga de vez os clientes excluídos há mais de ARCHIVE_RETENTION_DAYS (banco do painel + BigQuery).
// Com dryRun só lista quem seria apagado e quais datasets. Falha de um cliente não impede os outros.
export async function purgeExpiredClients(options: { now?: Date; dryRun?: boolean; bq?: BigQueryLike } = {}): Promise<PurgeSummary> {
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
      metaAdAccountId: clientsTable.metaAdAccountId,
      ga4PropertyId: clientsTable.ga4PropertyId,
    })
    .from(clientsTable)
    .where(and(isNotNull(clientsTable.archivedAt), lte(clientsTable.archivedAt, cutoff)))
    .orderBy(asc(clientsTable.archivedAt));

  const summary: PurgeSummary = { dryRun, retentionDays: ARCHIVE_RETENTION_DAYS, due: due.length, purged: 0, failed: 0, clients: [], excludedListRows: null };
  const all = due.length > 0 ? await loadClientKeySources() : [];
  for (const client of due) {
    const archivedAt = client.archivedAt ? client.archivedAt.toISOString() : "";
    const external = externalDatasetsOf(client);
    if (dryRun) {
      const plan = datasetsToDrop(client, all);
      summary.clients.push({ id: client.id, name: client.name, archivedAt, external, bigqueryDatasets: bigQueryPurgeEnabled() ? plan.targets : [] });
      continue;
    }
    try {
      const result = await purgeClientCompletely(client, { bq: options.bq });
      summary.purged += 1;
      summary.clients.push({ id: client.id, name: client.name, archivedAt, deletedLoginUsers: result.deletedLoginUsers, external, bigquery: result.bigquery, bigqueryDatasets: result.bigquery.droppedDatasets });
      logger.warn({ clientId: client.id, name: client.name, archivedAt, bigquery: result.bigquery }, "Client purged after retention period");
    } catch (err) {
      summary.failed += 1;
      summary.clients.push({ id: client.id, name: client.name, archivedAt, external, error: err instanceof Error ? err.message : String(err) });
      logger.error({ err, clientId: client.id, name: client.name }, "Failed to purge client");
    }
  }

  // No fim (e mesmo sem ninguém vencido) republica a lista de excluídos: cura qualquer publicação que tenha falhado na hora de excluir.
  if (!dryRun) {
    try {
      const published = await reconcileExcludedClients({ bq: options.bq });
      summary.excludedListRows = published.skipped ? null : published.rows;
    } catch (err) {
      summary.failed += 1;
      logger.error({ err }, "Failed to publish the excluded clients list");
    }
  }
  return summary;
}
