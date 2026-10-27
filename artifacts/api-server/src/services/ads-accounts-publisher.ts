// Publica no BigQuery (up_global.ads_accounts) as contas de anúncio dos clientes do dash, para a coleta do backend-dash.
// Idempotente: sempre reescreve a tabela inteira a partir do estado atual do cadastro. Sem credencial do BigQuery (só desenvolvimento/teste
// local), não faz nada. Chamado quando o cadastro muda (criar/editar/arquivar/recuperar cliente) e de hora em hora pelo job.
import { db, clientsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { buildAdsAccountRows, type AdsAccountClientRow } from "./ads-accounts-list";
import { ensureAdsAccountsTable, replaceAdsAccounts } from "./ads-accounts-bq";
import type { BigQueryLike } from "./excluded-clients-bq";
import { isBigQueryAvailable } from "./excluded-clients-rules";

async function defaultBigQuery(): Promise<BigQueryLike> {
  return (await import("../lib/bigquery")).bigquery as unknown as BigQueryLike;
}

async function loadClients(): Promise<AdsAccountClientRow[]> {
  return db
    .select({
      id: clientsTable.id,
      name: clientsTable.name,
      commercePlatform: clientsTable.commercePlatform,
      metaAdAccountId: clientsTable.metaAdAccountId,
      isActive: clientsTable.isActive,
      archivedAt: clientsTable.archivedAt,
    })
    .from(clientsTable);
}

export async function publishAdsAccounts(options: { bq?: BigQueryLike; clients?: AdsAccountClientRow[] } = {}): Promise<{ skipped: boolean; rows: number }> {
  if (!options.bq && !isBigQueryAvailable()) return { skipped: true, rows: 0 };
  // Lê o cadastro ANTES de mexer no BigQuery: se a leitura falhar, a tabela publicada fica como está.
  const clients = options.clients ?? (await loadClients());
  const { rows } = buildAdsAccountRows(clients);
  const bq = options.bq ?? (await defaultBigQuery());
  await ensureAdsAccountsTable(bq);
  await replaceAdsAccounts(bq, rows);
  return { skipped: false, rows: rows.length };
}

/** Para rotas e jobs: nunca derruba quem chamou. A lista é renovada de hora em hora, então uma falha aqui se corrige sozinha. */
export async function publishAdsAccountsSafely(context = "cadastro"): Promise<void> {
  try {
    await publishAdsAccounts();
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), context }, "não consegui publicar a lista de contas de anúncio (up_global.ads_accounts)");
  }
}
