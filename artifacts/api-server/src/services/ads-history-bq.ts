// Parte BigQuery do histórico de anúncios no painel: grava o pedido do botão e lê estado, último pedido e cobertura de uma conta.
// Recebe o cliente do BigQuery por parâmetro (BigQueryLike) para dar para testar sem a nuvem.
//
// O dash só ESCREVE em ads_backfill_requests; ads_backfill_status e as tabelas de insights ele só LÊ. As duas tabelas de up_global são criadas
// pelo backend-dash (job ads-onboarding) e, no caso do pedido, também aqui (CREATE TABLE IF NOT EXISTS com a mesma definição): quem chegar
// primeiro cria, o outro não muda nada.
import { BIGQUERY_PROJECT, runQuery, type BigQueryLike } from "./excluded-clients-bq";
import {
  ADS_HISTORY_DATASET,
  ADS_HISTORY_MIN_DATE,
  ADS_REQUESTS_TABLE,
  ADS_STATUS_TABLE,
  isHistoryState,
  type HistoryCoverage,
  type HistoryRequestRow,
  type HistoryStatusRow,
} from "./ads-history-rules";

const REQUESTS_SQL = `\`${BIGQUERY_PROJECT}.${ADS_HISTORY_DATASET}.${ADS_REQUESTS_TABLE}\``;
const STATUS_SQL = `\`${BIGQUERY_PROJECT}.${ADS_HISTORY_DATASET}.${ADS_STATUS_TABLE}\``;
const ACCOUNT_INSIGHTS_SQL = `\`${BIGQUERY_PROJECT}.data_ads_global.ads_insights_account\``;

/** Mesma definição de backend-dash/src/lib/adsOnboardingBq.ts (ENSURE_REQUESTS_SQL). */
export const ENSURE_REQUESTS_QUERY = `CREATE TABLE IF NOT EXISTS ${REQUESTS_SQL} (
  ad_account_id STRING NOT NULL,
  requested_at TIMESTAMP NOT NULL,
  requested_by STRING,
  start_date DATE
)`;

/**
 * Grava um pedido. Texto simples em parâmetro de DATA vira NULL sem aviso no cliente do BigQuery; por isso a data vai como STRING e é
 * convertida no SQL (SAFE.PARSE_DATE devolve NULL para texto nulo, que é o "usar a data padrão").
 */
export const INSERT_REQUEST_QUERY = `INSERT INTO ${REQUESTS_SQL} (ad_account_id, requested_at, requested_by, start_date)
VALUES (@ad_account_id, CURRENT_TIMESTAMP(), @requested_by, SAFE.PARSE_DATE('%Y-%m-%d', @start_date))`;

export async function insertHistoryRequest(
  bq: BigQueryLike,
  request: { adAccountDigits: string; requestedBy: string | null; startDate: string | null },
): Promise<void> {
  await runQuery(bq, { query: ENSURE_REQUESTS_QUERY });
  await runQuery(bq, {
    query: INSERT_REQUEST_QUERY,
    params: { ad_account_id: request.adAccountDigits, requested_by: request.requestedBy, start_date: request.startDate },
    types: { ad_account_id: "STRING", requested_by: "STRING", start_date: "STRING" },
  });
}

// Leituras: `SELECT *` no estado porque a tabela ganhou colunas depois da primeira versão (end_date); datas e horas saem como texto.
export const READ_STATUS_QUERY = `SELECT * FROM ${STATUS_SQL} WHERE ad_account_id = @digits LIMIT 1`;
export const READ_REQUEST_QUERY = `SELECT FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%E3SZ', TIMESTAMP_TRUNC(requested_at, MILLISECOND)) AS requested_at,
  FORMAT_DATE('%Y-%m-%d', start_date) AS start_date, requested_by
  FROM ${REQUESTS_SQL} WHERE ad_account_id = @digits ORDER BY requested_at DESC LIMIT 1`;
export const READ_COVERAGE_QUERY = `SELECT FORMAT_DATE('%Y-%m-%d', MIN(date_start)) AS first_day, FORMAT_DATE('%Y-%m-%d', MAX(date_start)) AS last_day,
  COUNT(DISTINCT date_start) AS days
  FROM ${ACCOUNT_INSIGHTS_SQL}
  WHERE date_start >= '${ADS_HISTORY_MIN_DATE}' AND REGEXP_REPLACE(CAST(ad_account_id AS STRING), r'^act[_=]', '') = @digits`;

type Row = Record<string, unknown>;

function isNotFound(err: unknown): boolean {
  const e = err as { code?: number; message?: string } | null;
  return e?.code === 404 || /not found/i.test(e?.message ?? "");
}

/** Tabela que ainda não existe (primeira vez) = nenhuma linha, sem erro. */
async function rowsOrEmpty(bq: BigQueryLike, query: string, digits: string): Promise<Row[]> {
  try {
    return (await runQuery(bq, { query, params: { digits }, types: { digits: "STRING" } })).rows;
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }
}

// O cliente do BigQuery devolve DATE e TIMESTAMP como objeto { value }; texto simples também é aceito.
const raw = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = typeof value === "object" && "value" in (value as object) ? String((value as { value: unknown }).value) : String(value);
  return text === "" ? null : text;
};
const day = (value: unknown): string | null => {
  const text = raw(value);
  return text && /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
};
const instant = (value: unknown): string | null => {
  const text = raw(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};
const count = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(typeof value === "object" && "value" in (value as object) ? (value as { value: unknown }).value : value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function toStatusRow(row: Row | undefined): HistoryStatusRow | null {
  if (!row) return null;
  const state = row.state;
  if (!isHistoryState(state)) return null;
  return {
    state,
    attempts: count(row.attempts) ?? 0,
    requestedAt: instant(row.requested_at),
    startedAt: instant(row.started_at),
    finishedAt: instant(row.finished_at),
    startDate: day(row.start_date),
    endDate: day(row.end_date),
    resumeFrom: day(row.resume_from),
    rowsAd: count(row.rows_ad),
    rowsAccount: count(row.rows_account),
    error: typeof row.error === "string" && row.error ? row.error : null,
    updatedAt: instant(row.updated_at),
  };
}

export function toRequestRow(row: Row | undefined): HistoryRequestRow | null {
  if (!row) return null;
  const requestedAt = instant(row.requested_at);
  if (!requestedAt) return null;
  return { requestedAt, startDate: day(row.start_date), requestedBy: typeof row.requested_by === "string" ? row.requested_by : null };
}

export function toCoverage(row: Row | undefined): HistoryCoverage {
  return { firstDay: day(row?.first_day), lastDay: day(row?.last_day), days: count(row?.days) ?? 0 };
}

export async function readAdsHistory(bq: BigQueryLike, digits: string): Promise<{ status: HistoryStatusRow | null; request: HistoryRequestRow | null; coverage: HistoryCoverage }> {
  const [statusRows, requestRows, coverageRows] = await Promise.all([
    rowsOrEmpty(bq, READ_STATUS_QUERY, digits),
    rowsOrEmpty(bq, READ_REQUEST_QUERY, digits),
    rowsOrEmpty(bq, READ_COVERAGE_QUERY, digits),
  ]);
  return { status: toStatusRow(statusRows[0]), request: toRequestRow(requestRows[0]), coverage: toCoverage(coverageRows[0]) };
}
