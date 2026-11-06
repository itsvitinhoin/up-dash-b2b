// Parte BigQuery da lista de contas de anúncio: criar a tabela up_global.ads_accounts e trocar o conteúdo inteiro por `rows`.
// Mesmo desenho de excluded-clients-bq.ts (a coleta do backend-dash lê esta tabela, como já lê a de excluídos).
import { ADS_ACCOUNTS_DATASET, ADS_ACCOUNTS_TABLE, type AdsAccountRow } from "./ads-accounts-list";
import { BIGQUERY_PROJECT, runQuery, type BigQueryLike } from "./excluded-clients-bq";

const TABLE_SQL = `\`${BIGQUERY_PROJECT}.${ADS_ACCOUNTS_DATASET}.${ADS_ACCOUNTS_TABLE}\``;

export const ENSURE_ADS_ACCOUNTS_TABLE_QUERY = `CREATE TABLE IF NOT EXISTS ${TABLE_SQL} (
  ad_account_id STRING NOT NULL,
  client_id STRING NOT NULL,
  client_name STRING,
  commerce_platform STRING,
  updated_at TIMESTAMP
)`;

export async function ensureAdsAccountsTable(bq: BigQueryLike): Promise<void> {
  await runQuery(bq, { query: ENSURE_ADS_ACCOUNTS_TABLE_QUERY });
}

/** Consulta (script) que troca o conteúdo inteiro da tabela por `rows`, numa transação só (ou entra tudo, ou nada). */
export function buildReplaceAdsAccountsQuery(rows: AdsAccountRow[]) {
  return {
    query: `BEGIN TRANSACTION;
      DELETE FROM ${TABLE_SQL} WHERE TRUE;
      INSERT INTO ${TABLE_SQL} (ad_account_id, client_id, client_name, commerce_platform, updated_at)
      SELECT r.ad_account_id, r.client_id, r.client_name, r.commerce_platform, CURRENT_TIMESTAMP() FROM UNNEST(@rows) AS r;
      COMMIT TRANSACTION;`,
    params: {
      rows: rows.map((row) => ({
        ad_account_id: row.adAccountId,
        client_id: row.clientId,
        client_name: row.clientName,
        commerce_platform: row.commercePlatform,
      })),
    },
    types: {
      rows: [{ ad_account_id: "STRING", client_id: "STRING", client_name: "STRING", commerce_platform: "STRING" }],
    },
  };
}

export async function replaceAdsAccounts(bq: BigQueryLike, rows: AdsAccountRow[]): Promise<void> {
  await runQuery(bq, buildReplaceAdsAccountsQuery(rows));
}
