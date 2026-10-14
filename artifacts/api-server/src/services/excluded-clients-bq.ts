// Parte BigQuery do ciclo de vida do cliente: publicar a lista de excluídos, limpar as linhas dele na up_global e apagar o dataset.
// Recebe o cliente do BigQuery por parâmetro (BigQueryLike) para dar para testar sem a nuvem.
import {
  EXCLUDED_CLIENTS_DATASET,
  EXCLUDED_CLIENTS_TABLE,
  isProtectedDataset,
  isValidDatasetId,
  type ExcludedKind,
  type ExcludedRow,
  type ExcludedState,
} from "./excluded-clients-rules";

export const BIGQUERY_PROJECT = "up-vesti-report";
const BIGQUERY_LOCATION = "US";

type QueryOptions = {
  query: string;
  params?: Record<string, unknown>;
  types?: Record<string, unknown>;
  location?: string;
};

export type BigQueryLike = {
  createQueryJob(options: QueryOptions): Promise<[
    {
      getQueryResults(): Promise<[Array<Record<string, unknown>>, ...unknown[]]>;
      metadata?: { statistics?: { query?: { numDmlAffectedRows?: string } } };
    },
    ...unknown[],
  ]>;
  dataset(id: string): { delete(options?: { force?: boolean }): Promise<unknown> };
};

async function runQuery(bq: BigQueryLike, options: Omit<QueryOptions, "location">) {
  const [job] = await bq.createQueryJob({ ...options, location: BIGQUERY_LOCATION });
  const [rows] = await job.getQueryResults();
  const affected = Number(job.metadata?.statistics?.query?.numDmlAffectedRows ?? 0);
  return { rows, dmlAffectedRows: Number.isFinite(affected) ? affected : 0 };
}

function isNotFound(err: unknown): boolean {
  const e = err as { code?: number; message?: string } | null;
  return e?.code === 404 || /not found/i.test(e?.message ?? "");
}

const EXCLUDED_TABLE_SQL = `\`${BIGQUERY_PROJECT}.${EXCLUDED_CLIENTS_DATASET}.${EXCLUDED_CLIENTS_TABLE}\``;

export async function ensureExcludedClientsTable(bq: BigQueryLike): Promise<void> {
  await runQuery(bq, {
    query: `CREATE TABLE IF NOT EXISTS ${EXCLUDED_TABLE_SQL} (
      kind STRING NOT NULL,
      value STRING NOT NULL,
      client_id STRING,
      client_name STRING,
      state STRING NOT NULL,
      excluded_at TIMESTAMP
    )`,
  });
}

const READ_TOMBSTONES_SQL = `SELECT kind, value, client_id, client_name, state,
  FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%E3SZ', excluded_at) AS excluded_at
  FROM ${EXCLUDED_TABLE_SQL} WHERE state = 'deleted'`;

/** Lápides (apagados de vez) já publicadas. Se a tabela ainda não existe, cria e devolve vazio. */
export async function readTombstones(bq: BigQueryLike): Promise<ExcludedRow[]> {
  let rows: Array<Record<string, unknown>>;
  try {
    ({ rows } = await runQuery(bq, { query: READ_TOMBSTONES_SQL }));
  } catch (err) {
    if (!isNotFound(err)) throw err;
    await ensureExcludedClientsTable(bq);
    return [];
  }
  return rows.map((row) => ({
    kind: String(row.kind) as ExcludedKind,
    value: String(row.value),
    clientId: String(row.client_id ?? ""),
    clientName: String(row.client_name ?? ""),
    state: String(row.state) as ExcludedState,
    excludedAt: String(row.excluded_at ?? ""),
  }));
}

/** Consulta (script) que troca o conteúdo inteiro da tabela por `rows`, numa transação só (ou entra tudo, ou nada). */
export function buildReplaceExcludedRowsQuery(rows: ExcludedRow[]): Omit<QueryOptions, "location"> {
  return {
    query: `BEGIN TRANSACTION;
      DELETE FROM ${EXCLUDED_TABLE_SQL} WHERE TRUE;
      INSERT INTO ${EXCLUDED_TABLE_SQL} (kind, value, client_id, client_name, state, excluded_at)
      SELECT r.kind, r.value, r.client_id, r.client_name, r.state, TIMESTAMP(r.excluded_at) FROM UNNEST(@rows) AS r;
      COMMIT TRANSACTION;`,
    params: {
      rows: rows.map((row) => ({
        kind: row.kind,
        value: row.value,
        client_id: row.clientId,
        client_name: row.clientName,
        state: row.state,
        excluded_at: row.excludedAt,
      })),
    },
    types: {
      rows: [{ kind: "STRING", value: "STRING", client_id: "STRING", client_name: "STRING", state: "STRING", excluded_at: "STRING" }],
    },
  };
}

export async function replaceExcludedRows(bq: BigQueryLike, rows: ExcludedRow[]): Promise<void> {
  await runQuery(bq, buildReplaceExcludedRowsQuery(rows));
}

const IDENTIFIER_RE = /^[A-Za-z0-9_]+$/;

export type TenantTable = { table: string; partitionColumn: string | null; partitionType: string | null };

/**
 * Tabelas da up_global que têm a coluna `tenant` (consolidados de todos os clientes), com a coluna de partição de cada uma.
 * Descobertas na hora, sem lista fixa. Várias exigem filtro de partição em qualquer DELETE (require_partition_filter).
 */
export async function listTenantTables(bq: BigQueryLike): Promise<TenantTable[]> {
  const { rows } = await runQuery(bq, {
    query: `SELECT c.table_name AS table_name,
        MAX(IF(c.is_partitioning_column = 'YES', c.column_name, NULL)) AS partition_column,
        MAX(IF(c.is_partitioning_column = 'YES', c.data_type, NULL)) AS partition_type
      FROM \`${BIGQUERY_PROJECT}.up_global.INFORMATION_SCHEMA.COLUMNS\` c
      JOIN \`${BIGQUERY_PROJECT}.up_global.INFORMATION_SCHEMA.TABLES\` t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
      GROUP BY c.table_name
      HAVING LOGICAL_OR(c.column_name = 'tenant')
      ORDER BY c.table_name`,
  });
  return rows
    .map((row) => ({
      table: String(row.table_name),
      partitionColumn: row.partition_column ? String(row.partition_column) : null,
      partitionType: row.partition_type ? String(row.partition_type) : null,
    }))
    .filter((entry) => IDENTIFIER_RE.test(entry.table));
}

/** Filtro que "toca" todas as partições (inclusive a de valores nulos), exigido por tabelas com require_partition_filter. */
export function partitionFilterSql(column: string, type: string | null): string {
  if (!IDENTIFIER_RE.test(column)) throw new Error(`coluna de partição inválida: "${column}"`);
  const literal =
    type === "TIMESTAMP" ? "TIMESTAMP '1900-01-01 00:00:00+00'" :
    type === "DATETIME" ? "DATETIME '1900-01-01 00:00:00'" :
    type === "DATE" ? "DATE '1900-01-01'" :
    null;
  if (!literal) throw new Error(`partição do tipo ${type ?? "desconhecido"} não é suportada na limpeza`);
  return `(\`${column}\` IS NULL OR \`${column}\` >= ${literal})`;
}

/**
 * Apaga as linhas do cliente (tenant = nome do dataset) em todas as tabelas consolidadas da up_global e a linha dele em
 * dataset_tid_map. Devolve quantas linhas saíram. (pagamentos_vesti não tem coluna de cliente: não dá para separar.)
 */
export async function deleteTenantRows(bq: BigQueryLike, tenant: string): Promise<number> {
  if (!isValidDatasetId(tenant) || isProtectedDataset(tenant)) throw new Error(`tenant inválido para limpeza: "${tenant}"`);
  let total = 0;
  for (const { table, partitionColumn, partitionType } of await listTenantTables(bq)) {
    const filter = partitionColumn ? ` AND ${partitionFilterSql(partitionColumn, partitionType)}` : "";
    const { dmlAffectedRows } = await runQuery(bq, {
      query: `DELETE FROM \`${BIGQUERY_PROJECT}.up_global.${table}\` WHERE tenant = @tenant${filter}`,
      params: { tenant },
      types: { tenant: "STRING" },
    });
    total += dmlAffectedRows;
  }
  try {
    const { dmlAffectedRows } = await runQuery(bq, {
      query: `DELETE FROM \`${BIGQUERY_PROJECT}.up_global.dataset_tid_map\` WHERE dataset = @tenant`,
      params: { tenant },
      types: { tenant: "STRING" },
    });
    total += dmlAffectedRows;
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
  return total;
}

/** Apaga o dataset do cliente com tudo dentro. Devolve false se ele já não existia. */
export async function dropDataset(bq: BigQueryLike, dataset: string): Promise<boolean> {
  if (!isValidDatasetId(dataset) || isProtectedDataset(dataset)) throw new Error(`dataset não pode ser apagado: "${dataset}"`);
  try {
    await bq.dataset(dataset).delete({ force: true });
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}
