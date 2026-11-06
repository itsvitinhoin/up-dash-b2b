// Parte BigQuery do GA4: cria as tabelas up_global.ga4_daily e up_global.ga4_product_views_daily,
// grava sem duplicar e informa ate que dia cada cliente ja esta la. Recebe o cliente do BigQuery por
// parametro (BigQueryLike) para dar para testar sem a nuvem. Mesmo desenho de ads-accounts-bq.ts.
import { randomBytes } from "node:crypto";
import type { Ga4DailyMetrics } from "./ga4";
import type { StoredProductViewKey } from "./ga4-daily-rules";
import { BIGQUERY_PROJECT, runQuery, type BigQueryLike } from "./excluded-clients-bq";
import {
  GA4_BQ_DAILY_TABLE,
  GA4_BQ_DATASET,
  GA4_BQ_PRODUCTS_TABLE,
  GA4_BQ_PRODUCT_BATCH,
  buildGa4DailyBqRows,
  buildGa4ProductBqRows,
  chunk,
  type Ga4BqClient,
} from "./ga4-bigquery-rules";

const DAILY_SQL = `\`${BIGQUERY_PROJECT}.${GA4_BQ_DATASET}.${GA4_BQ_DAILY_TABLE}\``;
const PRODUCTS_SQL = `\`${BIGQUERY_PROJECT}.${GA4_BQ_DATASET}.${GA4_BQ_PRODUCTS_TABLE}\``;

export const ENSURE_GA4_DAILY_QUERY = `CREATE TABLE IF NOT EXISTS ${DAILY_SQL} (
  client_id STRING NOT NULL,
  client_name STRING,
  property_id STRING NOT NULL,
  \`date\` DATE NOT NULL,
  sessions INT64,
  total_users INT64,
  page_views INT64,
  view_item INT64,
  add_to_cart INT64,
  begin_checkout INT64,
  purchases INT64,
  purchase_revenue FLOAT64,
  synced_at TIMESTAMP
)
PARTITION BY \`date\`
CLUSTER BY client_id`;

export const ENSURE_GA4_PRODUCTS_QUERY = `CREATE TABLE IF NOT EXISTS ${PRODUCTS_SQL} (
  client_id STRING NOT NULL,
  client_name STRING,
  property_id STRING NOT NULL,
  \`date\` DATE NOT NULL,
  item_id STRING,
  item_name STRING,
  item_variant STRING,
  items_viewed INT64,
  synced_at TIMESTAMP
)
PARTITION BY \`date\`
CLUSTER BY client_id`;

// Criar as tabelas uma vez por processo basta: o job roda de hora em hora, cada rodada e um processo novo.
const ensured = new WeakSet<object>();

export async function ensureGa4Tables(bq: BigQueryLike): Promise<void> {
  if (ensured.has(bq)) return;
  await runQuery(bq, { query: ENSURE_GA4_DAILY_QUERY });
  await runQuery(bq, { query: ENSURE_GA4_PRODUCTS_QUERY });
  ensured.add(bq);
}

function isNotFound(err: unknown): boolean {
  const e = err as { code?: number; message?: string } | null;
  return e?.code === 404 || /not found/i.test(e?.message ?? "");
}

export type Ga4BigQueryCoverage = { firstDay: string; lastDay: string };

/**
 * Primeiro e ultimo dia que cada cliente ja tem em up_global.ga4_daily. A tabela diaria e o marcador
 * de cobertura: ela so e gravada DEPOIS dos produtos, entao "tem dia" quer dizer "os dois chegaram".
 * Tabela ainda inexistente = ninguem tem historico (cria e devolve vazio).
 */
export async function readGa4BigQueryCoverage(bq: BigQueryLike): Promise<Map<string, Ga4BigQueryCoverage>> {
  let rows: Array<Record<string, unknown>>;
  try {
    ({ rows } = await runQuery(bq, {
      query: `SELECT client_id, CAST(MIN(\`date\`) AS STRING) AS first_day, CAST(MAX(\`date\`) AS STRING) AS last_day
        FROM ${DAILY_SQL} WHERE \`date\` >= DATE '2000-01-01' GROUP BY client_id`,
    }));
  } catch (err) {
    if (!isNotFound(err)) throw err;
    await ensureGa4Tables(bq);
    return new Map();
  }
  return new Map(
    rows.map((row) => [String(row.client_id), { firstDay: String(row.first_day), lastDay: String(row.last_day) }]),
  );
}

const DAILY_ROW_TYPES = {
  client_id: "STRING",
  client_name: "STRING",
  property_id: "STRING",
  date: "STRING",
  sessions: "INT64",
  total_users: "INT64",
  page_views: "INT64",
  view_item: "INT64",
  add_to_cart: "INT64",
  begin_checkout: "INT64",
  purchases: "INT64",
  purchase_revenue: "FLOAT64",
};

/** MERGE por (cliente, dia): rodar de novo a mesma janela atualiza em vez de duplicar. */
export function buildMergeGa4DailyQuery(client: Ga4BqClient, rows: Ga4DailyMetrics[], from: string, to: string) {
  return {
    query: `MERGE ${DAILY_SQL} T
      USING (
        SELECT r.client_id, r.client_name, r.property_id, DATE(r.date) AS \`date\`, r.sessions, r.total_users, r.page_views,
               r.view_item, r.add_to_cart, r.begin_checkout, r.purchases, r.purchase_revenue
        FROM UNNEST(@rows) AS r
      ) S
      ON T.client_id = S.client_id AND T.\`date\` = S.\`date\` AND T.\`date\` BETWEEN DATE(@from_date) AND DATE(@to_date)
      WHEN MATCHED THEN UPDATE SET
        client_name = S.client_name, property_id = S.property_id, sessions = S.sessions, total_users = S.total_users,
        page_views = S.page_views, view_item = S.view_item, add_to_cart = S.add_to_cart, begin_checkout = S.begin_checkout,
        purchases = S.purchases, purchase_revenue = S.purchase_revenue, synced_at = CURRENT_TIMESTAMP()
      WHEN NOT MATCHED THEN INSERT
        (client_id, client_name, property_id, \`date\`, sessions, total_users, page_views, view_item, add_to_cart, begin_checkout,
         purchases, purchase_revenue, synced_at)
      VALUES
        (S.client_id, S.client_name, S.property_id, S.\`date\`, S.sessions, S.total_users, S.page_views, S.view_item,
         S.add_to_cart, S.begin_checkout, S.purchases, S.purchase_revenue, CURRENT_TIMESTAMP())`,
    params: { rows: buildGa4DailyBqRows(client, rows), from_date: from, to_date: to },
    types: { rows: [DAILY_ROW_TYPES], from_date: "STRING", to_date: "STRING" },
  };
}

export async function mergeGa4Daily(
  bq: BigQueryLike,
  client: Ga4BqClient,
  rows: Ga4DailyMetrics[],
  from: string,
  to: string,
): Promise<number> {
  if (rows.length === 0) return 0;
  await runQuery(bq, buildMergeGa4DailyQuery(client, rows, from, to));
  return rows.length;
}

const STAGING_ID_RE = /^ga4_product_views_stg_[a-f0-9]{8,32}$/;

const PRODUCT_ROW_TYPES = {
  client_id: "STRING",
  client_name: "STRING",
  property_id: "STRING",
  date: "STRING",
  item_id: "STRING",
  item_name: "STRING",
  item_variant: "STRING",
  items_viewed: "INT64",
};

function stagingSql(stagingId: string): string {
  if (!STAGING_ID_RE.test(stagingId)) throw new Error(`nome de tabela temporaria invalido: "${stagingId}"`);
  return `\`${BIGQUERY_PROJECT}.${GA4_BQ_DATASET}.${stagingId}\``;
}

// A tabela temporaria some sozinha em 1 hora, mesmo se o processo morrer antes do DROP.
export function buildCreateStagingQuery(stagingId: string) {
  return {
    query: `CREATE TABLE ${stagingSql(stagingId)} (
      client_id STRING, client_name STRING, property_id STRING, \`date\` DATE,
      item_id STRING, item_name STRING, item_variant STRING, items_viewed INT64
    ) OPTIONS (expiration_timestamp = TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR))`,
  };
}

export function buildInsertStagingQuery(stagingId: string, rows: ReturnType<typeof buildGa4ProductBqRows>) {
  return {
    query: `INSERT INTO ${stagingSql(stagingId)}
        (client_id, client_name, property_id, \`date\`, item_id, item_name, item_variant, items_viewed)
      SELECT r.client_id, r.client_name, r.property_id, DATE(r.date), r.item_id, r.item_name, r.item_variant, r.items_viewed
      FROM UNNEST(@rows) AS r`,
    params: { rows },
    types: { rows: [PRODUCT_ROW_TYPES] },
  };
}

/** Troca a janela do cliente por inteiro, numa transacao so (ou entra tudo, ou nada). */
export function buildSwapProductsQuery(stagingId: string, clientId: string, from: string, to: string) {
  return {
    query: `BEGIN TRANSACTION;
      DELETE FROM ${PRODUCTS_SQL}
        WHERE client_id = @client_id AND \`date\` BETWEEN DATE(@from_date) AND DATE(@to_date);
      INSERT INTO ${PRODUCTS_SQL}
        (client_id, client_name, property_id, \`date\`, item_id, item_name, item_variant, items_viewed, synced_at)
      SELECT client_id, client_name, property_id, \`date\`, NULLIF(item_id, ''), NULLIF(item_name, ''), NULLIF(item_variant, ''),
             items_viewed, CURRENT_TIMESTAMP()
      FROM ${stagingSql(stagingId)};
      COMMIT TRANSACTION;`,
    params: { client_id: clientId, from_date: from, to_date: to },
    types: { client_id: "STRING", from_date: "STRING", to_date: "STRING" },
  };
}

export function buildDeleteProductsWindowQuery(clientId: string, from: string, to: string) {
  return {
    query: `DELETE FROM ${PRODUCTS_SQL}
      WHERE client_id = @client_id AND \`date\` BETWEEN DATE(@from_date) AND DATE(@to_date)`,
    params: { client_id: clientId, from_date: from, to_date: to },
    types: { client_id: "STRING", from_date: "STRING", to_date: "STRING" },
  };
}

/**
 * Troca as visualizacoes de produto da janela [from, to] do cliente. O GA4 revisa contagens recentes e um item
 * que sumiu da revisao nao pode ficar com o numero velho, por isso apaga e regrava a janela. As linhas novas
 * vao primeiro para uma tabela temporaria, em lotes; so no fim a troca acontece, de uma vez. Se um lote falhar,
 * a tabela de verdade nao muda.
 */
export async function replaceGa4ProductViews(
  bq: BigQueryLike,
  client: Ga4BqClient,
  rows: StoredProductViewKey[],
  from: string,
  to: string,
  newId: () => string = () => randomBytes(8).toString("hex"),
): Promise<number> {
  const bqRows = buildGa4ProductBqRows(client, rows);
  if (bqRows.length === 0) {
    // Loja sem nenhum view_item na janela: so limpa o que estava la.
    await runQuery(bq, buildDeleteProductsWindowQuery(client.clientId, from, to));
    return 0;
  }
  const stagingId = `ga4_product_views_stg_${newId()}`;
  await runQuery(bq, buildCreateStagingQuery(stagingId));
  try {
    for (const batch of chunk(bqRows, GA4_BQ_PRODUCT_BATCH)) {
      await runQuery(bq, buildInsertStagingQuery(stagingId, batch));
    }
    await runQuery(bq, buildSwapProductsQuery(stagingId, client.clientId, from, to));
  } finally {
    // Limpeza de cortesia; se falhar, a expiracao de 1 hora recolhe a tabela.
    await runQuery(bq, { query: `DROP TABLE IF EXISTS ${stagingSql(stagingId)}` }).catch(() => undefined);
  }
  return bqRows.length;
}

export type Ga4BigQueryWrite = { dailyRows: number; productRows: number };

/**
 * Grava o que veio do GA4 num cliente: PRODUTOS primeiro, DIARIO por ultimo. O diario e o marcador de
 * cobertura (readGa4BigQueryCoverage), entao se os produtos falharem o diario nao e gravado e a proxima
 * rodada refaz o backfill dos dois em vez de achar que o cliente ja esta completo.
 */
export async function writeGa4ToBigQuery(
  bq: BigQueryLike,
  params: {
    client: Ga4BqClient;
    daily: Ga4DailyMetrics[];
    from: string;
    productViews: StoredProductViewKey[];
    productFrom: string;
    to: string;
    newId?: () => string;
  },
): Promise<Ga4BigQueryWrite> {
  await ensureGa4Tables(bq);
  const productRows = await replaceGa4ProductViews(
    bq,
    params.client,
    params.productViews,
    params.productFrom,
    params.to,
    params.newId,
  );
  const dailyRows = await mergeGa4Daily(bq, params.client, params.daily, params.from, params.to);
  return { dailyRows, productRows };
}
