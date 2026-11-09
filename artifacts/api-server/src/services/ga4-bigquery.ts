// Parte BigQuery do GA4: cria as tabelas up_global.ga4_daily e up_global.ga4_product_views_daily,
// grava sem duplicar e informa ate que dia cada cliente ja esta la. Recebe o cliente do BigQuery por
// parametro (BigQueryLike) para dar para testar sem a nuvem. Mesmo desenho de ads-accounts-bq.ts.
import { randomBytes } from "node:crypto";
import type { Ga4DailyMetrics, Ga4TrafficDay } from "./ga4";
import type { StoredProductViewKey } from "./ga4-daily-rules";
import { BIGQUERY_PROJECT, runQuery, type BigQueryLike } from "./excluded-clients-bq";
import {
  GA4_BQ_DAILY_TABLE,
  GA4_BQ_DATASET,
  GA4_BQ_DEFAULT_DATASET,
  GA4_BQ_PRODUCTS_TABLE,
  GA4_BQ_PRODUCT_BATCH,
  GA4_BQ_TRAFFIC_BATCH,
  GA4_BQ_TRAFFIC_TABLE,
  buildGa4DailyBqRows,
  buildGa4ProductBqRows,
  buildGa4TrafficBqRows,
  chunk,
  type Ga4BqClient,
} from "./ga4-bigquery-rules";

const DAILY_SQL = `\`${BIGQUERY_PROJECT}.${GA4_BQ_DATASET}.${GA4_BQ_DAILY_TABLE}\``;
const PRODUCTS_SQL = `\`${BIGQUERY_PROJECT}.${GA4_BQ_DATASET}.${GA4_BQ_PRODUCTS_TABLE}\``;
const TRAFFIC_SQL = `\`${BIGQUERY_PROJECT}.${GA4_BQ_DATASET}.${GA4_BQ_TRAFFIC_TABLE}\``;

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

// Origem do trafego: de onde vieram as sessoes de cada dia (canal, origem, midia e campanha) e quanto cada uma vendeu. Sem chave
// primaria (BigQuery): a troca de janela por transacao (replaceGa4Traffic) e que impede duplicar.
export const ENSURE_GA4_TRAFFIC_QUERY = `CREATE TABLE IF NOT EXISTS ${TRAFFIC_SQL} (
  client_id STRING NOT NULL,
  client_name STRING,
  property_id STRING NOT NULL,
  \`date\` DATE NOT NULL,
  channel_group STRING,
  source STRING,
  medium STRING,
  campaign STRING,
  sessions INT64,
  total_users INT64,
  engaged_sessions INT64,
  add_to_cart INT64,
  begin_checkout INT64,
  purchases INT64,
  purchase_revenue FLOAT64,
  synced_at TIMESTAMP
)
PARTITION BY \`date\`
CLUSTER BY client_id`;

// Criar as tabelas uma vez por processo basta: o job roda de hora em hora, cada rodada e um processo novo.
const ensured = new WeakSet<object>();

// Dataset de teste (GA4_BQ_DATASET) ainda nao existe: cria. O up_global padrao ja existe e nao e criado por aqui.
export const ENSURE_GA4_DATASET_QUERY = `CREATE SCHEMA IF NOT EXISTS \`${BIGQUERY_PROJECT}.${GA4_BQ_DATASET}\` OPTIONS (location = 'US')`;

export async function ensureGa4Tables(bq: BigQueryLike): Promise<void> {
  if (ensured.has(bq)) return;
  if (GA4_BQ_DATASET !== GA4_BQ_DEFAULT_DATASET) await runQuery(bq, { query: ENSURE_GA4_DATASET_QUERY });
  await runQuery(bq, { query: ENSURE_GA4_DAILY_QUERY });
  await runQuery(bq, { query: ENSURE_GA4_PRODUCTS_QUERY });
  await runQuery(bq, { query: ENSURE_GA4_TRAFFIC_QUERY });
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

// ── Origem do trafego: mesma troca de janela dos produtos (tabela temporaria + transacao) ────────────────────────────

const TRAFFIC_STAGING_ID_RE = /^ga4_traffic_stg_[a-f0-9]{8,32}$/;

const TRAFFIC_ROW_TYPES = {
  client_id: "STRING",
  client_name: "STRING",
  property_id: "STRING",
  date: "STRING",
  channel_group: "STRING",
  source: "STRING",
  medium: "STRING",
  campaign: "STRING",
  sessions: "INT64",
  total_users: "INT64",
  engaged_sessions: "INT64",
  add_to_cart: "INT64",
  begin_checkout: "INT64",
  purchases: "INT64",
  purchase_revenue: "FLOAT64",
};

function trafficStagingSql(stagingId: string): string {
  if (!TRAFFIC_STAGING_ID_RE.test(stagingId)) throw new Error(`nome de tabela temporaria invalido: "${stagingId}"`);
  return `\`${BIGQUERY_PROJECT}.${GA4_BQ_DATASET}.${stagingId}\``;
}

export function buildCreateTrafficStagingQuery(stagingId: string) {
  return {
    query: `CREATE TABLE ${trafficStagingSql(stagingId)} (
      client_id STRING, client_name STRING, property_id STRING, \`date\` DATE,
      channel_group STRING, source STRING, medium STRING, campaign STRING,
      sessions INT64, total_users INT64, engaged_sessions INT64, add_to_cart INT64, begin_checkout INT64,
      purchases INT64, purchase_revenue FLOAT64
    ) OPTIONS (expiration_timestamp = TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR))`,
  };
}

export function buildInsertTrafficStagingQuery(stagingId: string, rows: ReturnType<typeof buildGa4TrafficBqRows>) {
  return {
    query: `INSERT INTO ${trafficStagingSql(stagingId)}
        (client_id, client_name, property_id, \`date\`, channel_group, source, medium, campaign, sessions, total_users,
         engaged_sessions, add_to_cart, begin_checkout, purchases, purchase_revenue)
      SELECT r.client_id, r.client_name, r.property_id, DATE(r.date), r.channel_group, r.source, r.medium, r.campaign,
             r.sessions, r.total_users, r.engaged_sessions, r.add_to_cart, r.begin_checkout, r.purchases, r.purchase_revenue
      FROM UNNEST(@rows) AS r`,
    params: { rows },
    types: { rows: [TRAFFIC_ROW_TYPES] },
  };
}

/** Troca a janela do cliente por inteiro, numa transacao so (ou entra tudo, ou nada). */
export function buildSwapTrafficQuery(stagingId: string, clientId: string, from: string, to: string) {
  return {
    query: `BEGIN TRANSACTION;
      DELETE FROM ${TRAFFIC_SQL}
        WHERE client_id = @client_id AND \`date\` BETWEEN DATE(@from_date) AND DATE(@to_date);
      INSERT INTO ${TRAFFIC_SQL}
        (client_id, client_name, property_id, \`date\`, channel_group, source, medium, campaign, sessions, total_users,
         engaged_sessions, add_to_cart, begin_checkout, purchases, purchase_revenue, synced_at)
      SELECT client_id, client_name, property_id, \`date\`, channel_group, source, medium, campaign, sessions, total_users,
             engaged_sessions, add_to_cart, begin_checkout, purchases, purchase_revenue, CURRENT_TIMESTAMP()
      FROM ${trafficStagingSql(stagingId)};
      COMMIT TRANSACTION;`,
    params: { client_id: clientId, from_date: from, to_date: to },
    types: { client_id: "STRING", from_date: "STRING", to_date: "STRING" },
  };
}

export function buildDeleteTrafficWindowQuery(clientId: string, from: string, to: string) {
  return {
    query: `DELETE FROM ${TRAFFIC_SQL}
      WHERE client_id = @client_id AND \`date\` BETWEEN DATE(@from_date) AND DATE(@to_date)`,
    params: { client_id: clientId, from_date: from, to_date: to },
    types: { client_id: "STRING", from_date: "STRING", to_date: "STRING" },
  };
}

/**
 * Troca a origem do trafego da janela [from, to] do cliente. O GA4 revisa as contagens recentes e uma origem que sumiu da revisao
 * nao pode ficar com o numero velho, por isso apaga e regrava a janela, com as linhas novas antes numa tabela temporaria (em lotes)
 * e a troca de uma vez no fim: se um lote falhar, a tabela de verdade nao muda.
 */
export async function replaceGa4Traffic(
  bq: BigQueryLike,
  client: Ga4BqClient,
  rows: Ga4TrafficDay[],
  from: string,
  to: string,
  newId: () => string = () => randomBytes(8).toString("hex"),
): Promise<number> {
  const bqRows = buildGa4TrafficBqRows(client, rows);
  if (bqRows.length === 0) {
    // Sem nenhuma sessao na janela: so limpa o que estava la.
    await runQuery(bq, buildDeleteTrafficWindowQuery(client.clientId, from, to));
    return 0;
  }
  const stagingId = `ga4_traffic_stg_${newId()}`;
  await runQuery(bq, buildCreateTrafficStagingQuery(stagingId));
  try {
    for (const batch of chunk(bqRows, GA4_BQ_TRAFFIC_BATCH)) {
      await runQuery(bq, buildInsertTrafficStagingQuery(stagingId, batch));
    }
    await runQuery(bq, buildSwapTrafficQuery(stagingId, client.clientId, from, to));
  } finally {
    // Limpeza de cortesia; se falhar, a expiracao de 1 hora recolhe a tabela.
    await runQuery(bq, { query: `DROP TABLE IF EXISTS ${trafficStagingSql(stagingId)}` }).catch(() => undefined);
  }
  return bqRows.length;
}

/**
 * Apaga TODAS as linhas de GA4 do cliente nas tres tabelas (exclusao definitiva, depois da lixeira de 90 dias).
 * Estas tabelas usam client_id (nao `tenant`), por isso a limpeza generica de up_global nao as alcanca. Tabela que
 * ainda nao existe conta como "nada a apagar". Devolve quantas linhas sairam.
 */
export async function deleteGa4Rows(bq: BigQueryLike, clientId: string): Promise<number> {
  if (!clientId.trim()) throw new Error("client_id vazio: nao apaga GA4 sem saber de quem");
  let total = 0;
  for (const table of [DAILY_SQL, PRODUCTS_SQL, TRAFFIC_SQL]) {
    try {
      // O filtro de data "toca" todas as particoes (e satisfaz tabelas que exijam filtro de particao).
      const { dmlAffectedRows } = await runQuery(bq, {
        query: `DELETE FROM ${table} WHERE client_id = @client_id AND \`date\` >= DATE '2000-01-01'`,
        params: { client_id: clientId },
        types: { client_id: "STRING" },
      });
      total += dmlAffectedRows;
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }
  return total;
}

export type Ga4BigQueryWrite = {
  dailyRows: number;
  productRows: number;
  /** Linhas gravadas em ga4_traffic_daily (0 quando a origem do trafego nao foi enviada ou falhou). */
  trafficRows: number;
  /** Motivo da falha SO da origem do trafego: ela e isolada e nao impede o diario nem os produtos. */
  trafficError?: string;
};

/**
 * Grava o que veio do GA4 num cliente: PRODUTOS primeiro, ORIGEM DO TRAFEGO depois e DIARIO por ultimo. O diario e o marcador de
 * cobertura (readGa4BigQueryCoverage), entao se os produtos falharem o diario nao e gravado e a proxima
 * rodada refaz o backfill dos dois em vez de achar que o cliente ja esta completo.
 *
 * A origem do trafego e uma tabela NOVA e fica isolada: se ela falhar, o erro vai em `trafficError` e o resto segue (o marcador
 * dela e proprio, ver resolveGa4TrafficFrom, e a proxima rodada refaz a janela que faltou).
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
    /** Ausente = nao envia a origem do trafego. */
    traffic?: Ga4TrafficDay[];
    trafficFrom?: string;
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
  let trafficRows = 0;
  let trafficError: string | undefined;
  if (params.traffic && params.trafficFrom) {
    try {
      trafficRows = await replaceGa4Traffic(bq, params.client, params.traffic, params.trafficFrom, params.to, params.newId);
    } catch (err) {
      trafficError = err instanceof Error ? err.message : String(err);
    }
  }
  const dailyRows = await mergeGa4Daily(bq, params.client, params.daily, params.from, params.to);
  return { dailyRows, productRows, trafficRows, ...(trafficError ? { trafficError } : {}) };
}
