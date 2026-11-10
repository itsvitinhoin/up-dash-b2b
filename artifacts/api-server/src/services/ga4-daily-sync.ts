import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, ga4DailyMetricsTable, ga4ProductViewsDailyTable, syncJobsTable } from "@workspace/db";
import { aggregateGa4Rows, fillGa4Days, isGa4StoreUsable, toStoredProductViews } from "./ga4-daily-rules";
import type { BigQueryLike } from "./excluded-clients-bq";
import { writeGa4ToBigQuery, type Ga4BigQueryWrite } from "./ga4-bigquery";
import {
  fetchGa4DailyMetrics,
  fetchGa4FunnelMetrics,
  fetchGa4ProductFunnelDaily,
  fetchGa4ProductViewMetrics,
  fetchGa4ProductViewsDaily,
  fetchGa4TrafficDaily,
  type Ga4DailyMetrics,
  type Ga4FunnelMetrics,
  type Ga4ProductFunnelDay,
  type Ga4ProductViewMetric,
  type Ga4TrafficDay,
} from "./ga4";

export async function clientIdsWithGa4History(clientIds: string[]): Promise<Set<string>> {
  if (clientIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ clientId: ga4DailyMetricsTable.clientId })
    .from(ga4DailyMetricsTable)
    .where(inArray(ga4DailyMetricsTable.clientId, clientIds));
  return new Set(rows.map((row) => row.clientId));
}

// Quem ja teve o backfill de produtos. O criterio e o marcador productFrom no
// resultado do job (so jobs desta versao o gravam), nao a existencia de linhas:
// a imagem anterior gravou so os ultimos dias de produtos, e isso nao e historico.
export async function clientIdsWithGa4ProductHistory(clientIds: string[]): Promise<Set<string>> {
  if (clientIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ clientId: syncJobsTable.clientId })
    .from(syncJobsTable)
    .where(
      and(
        inArray(syncJobsTable.clientId, clientIds),
        eq(syncJobsTable.jobType, "ga4_daily"),
        eq(syncJobsTable.status, "done"),
        sql`${syncJobsTable.result}->>'productFrom' IS NOT NULL`,
      ),
    );
  return new Set(rows.map((row) => row.clientId));
}

// Ultimo dia que cada cliente tem em ga4_daily_metrics. Serve para o job que ficou parado retomar de onde
// parou em vez de so olhar os ultimos dias (ver resolveGa4SyncWindow).
export async function lastStoredGa4DayByClient(clientIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (clientIds.length === 0) return result;
  const rows = await db
    .select({
      clientId: ga4DailyMetricsTable.clientId,
      lastDay: sql<string>`MAX(${ga4DailyMetricsTable.metricDate})::text`,
    })
    .from(ga4DailyMetricsTable)
    .where(inArray(ga4DailyMetricsTable.clientId, clientIds))
    .groupBy(ga4DailyMetricsTable.clientId);
  for (const row of rows) if (row.lastDay) result.set(row.clientId, row.lastDay);
  return result;
}

// Ultimo dia de ORIGEM DO TRAFEGO que o job gravou com sucesso para cada cliente (sync_jobs.result.trafficTo). E o marcador de
// cobertura dessa tabela (ver resolveGa4TrafficFrom): ela nao pode usar o do diario porque roda isolada e pode falhar sozinha, e
// um cliente sem nenhuma venda recente nao tem linhas que sirvam de marcador no proprio BigQuery.
export async function lastGa4TrafficToByClient(clientIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (clientIds.length === 0) return result;
  const rows = await db
    .select({
      clientId: syncJobsTable.clientId,
      lastTo: sql<string | null>`MAX(${syncJobsTable.result}->>'trafficTo')`,
    })
    .from(syncJobsTable)
    .where(
      and(
        inArray(syncJobsTable.clientId, clientIds),
        eq(syncJobsTable.jobType, "ga4_daily"),
        eq(syncJobsTable.status, "done"),
        sql`${syncJobsTable.result}->>'trafficTo' IS NOT NULL`,
      ),
    )
    .groupBy(syncJobsTable.clientId);
  for (const row of rows) if (row.lastTo) result.set(row.clientId, row.lastTo);
  return result;
}

// Idem para o FUNIL POR PRODUTO (sync_jobs.result.productFunnelTo): marcador de cobertura de ga4_product_funnel_daily, pelos mesmos motivos.
export async function lastGa4ProductFunnelToByClient(clientIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (clientIds.length === 0) return result;
  const rows = await db
    .select({
      clientId: syncJobsTable.clientId,
      lastTo: sql<string | null>`MAX(${syncJobsTable.result}->>'productFunnelTo')`,
    })
    .from(syncJobsTable)
    .where(
      and(
        inArray(syncJobsTable.clientId, clientIds),
        eq(syncJobsTable.jobType, "ga4_daily"),
        eq(syncJobsTable.status, "done"),
        sql`${syncJobsTable.result}->>'productFunnelTo' IS NOT NULL`,
      ),
    )
    .groupBy(syncJobsTable.clientId);
  for (const row of rows) if (row.lastTo) result.set(row.clientId, row.lastTo);
  return result;
}

export async function syncGa4DailyForClient(params: {
  clientId: string;
  clientName?: string;
  propertyId: string;
  from: string;
  // Inicio da janela de produtos (>= 1o dia do backfill); padrao = from.
  productFrom?: string;
  to: string;
  // Presente = grava tambem em up_global.ga4_daily / ga4_product_views_daily. Ausente = so o Postgres.
  bigQuery?: BigQueryLike | null;
  // false = os produtos ficam so no BigQuery (cliente B2B, ver shouldStoreGa4ProductViewsInPostgres): nao grava a tabela de produtos do
  // Postgres e apaga a copia antiga do cliente, mas so depois de o BigQuery ter gravado nesta rodada. Sem BigQuery grava no Postgres
  // mesmo assim. Padrao: true.
  storeProductViewsInPostgres?: boolean;
  // Inicio da janela de ORIGEM DO TRAFEGO (so BigQuery; ver resolveGa4TrafficFrom). Ausente/null = nao busca nem grava.
  trafficFrom?: string | null;
  // Inicio da janela do FUNIL POR PRODUTO (so BigQuery; ver resolveGa4ProductFunnelFrom). Ausente/null = nao busca nem grava.
  productFunnelFrom?: string | null;
}): Promise<{
  from: string;
  to: string;
  productFrom: string;
  days: number;
  sessions: number;
  productViewRows: number;
  /** Linhas de produto da copia antiga do Postgres apagadas nesta rodada (0 quando nao havia nada ou quando o cliente guarda produtos no Postgres). */
  prunedProductRows: number;
  /** Linhas de origem do trafego gravadas no BigQuery nesta rodada. */
  trafficRows: number;
  /** Janela de origem do trafego gravada COM SUCESSO (null = nao rodou ou falhou: o marcador nao anda). `trafficTo` vira o marcador. */
  trafficFrom: string | null;
  trafficTo: string | null;
  /** Falha so da origem do trafego (busca no GA4 ou gravacao no BigQuery); o diario e os produtos seguiram normalmente. */
  trafficError: string | null;
  /** Linhas do funil por produto gravadas no BigQuery nesta rodada. */
  productFunnelRows: number;
  /** Janela do funil por produto gravada COM SUCESSO (null = nao rodou ou falhou: o marcador nao anda). `productFunnelTo` vira o marcador. */
  productFunnelFrom: string | null;
  productFunnelTo: string | null;
  /** Falha so do funil por produto (busca no GA4 ou gravacao no BigQuery); o resto seguiu normalmente. */
  productFunnelError: string | null;
  bigQuery: Ga4BigQueryWrite | null;
}> {
  const fetched = await fetchGa4DailyMetrics({
    propertyId: params.propertyId,
    dateFrom: params.from,
    dateTo: params.to,
  });
  // null = sem propriedade ou sem credencial. Falhar aqui deixa o motivo em
  // sync_jobs.error, em vez de gravar "0 sessoes" como se fosse dado real.
  if (fetched === null) {
    throw new Error(
      "GA4 sem credencial: rode no Cloud Run (usa a conta de servico do job) ou defina GA4_SERVICE_ACCOUNT_JSON.",
    );
  }

  // Busca as duas coisas ANTES de gravar qualquer uma: se uma falhar, nada muda e
  // as tabelas nao ficam uma atualizada e a outra velha.
  const productFrom = params.productFrom ?? params.from;
  const fetchedProductViews = await fetchGa4ProductViewsDaily({
    propertyId: params.propertyId,
    dateFrom: productFrom,
    dateTo: params.to,
  });
  if (fetchedProductViews === null) throw new Error("GA4 sem credencial ao buscar visualizacoes de produto.");
  const productViews = toStoredProductViews(fetchedProductViews);
  // Sem BigQuery nao ha segunda copia: ai o Postgres guarda os produtos de qualquer jeito.
  const storeProducts = params.storeProductViewsInPostgres !== false || !params.bigQuery;

  // Origem do trafego: so com BigQuery (nao ha copia no Postgres) e ISOLADA. Tabela nova: se a busca falhar, o diario e os produtos
  // seguem, o marcador nao anda e a proxima rodada refaz a janela que faltou.
  const trafficFrom = params.bigQuery ? (params.trafficFrom ?? null) : null;
  let traffic: Ga4TrafficDay[] | undefined;
  let trafficFetchError: string | null = null;
  if (trafficFrom) {
    try {
      const fetchedTraffic = await fetchGa4TrafficDaily({
        propertyId: params.propertyId,
        dateFrom: trafficFrom,
        dateTo: params.to,
      });
      if (fetchedTraffic === null) throw new Error("GA4 sem credencial ao buscar a origem do trafego.");
      traffic = fetchedTraffic;
    } catch (err) {
      trafficFetchError = `busca no GA4: ${errorMessage(err)}`;
    }
  }

  // Funil por produto: so com BigQuery e ISOLADO, como a origem do trafego (marcador e janela proprios).
  const productFunnelFrom = params.bigQuery ? (params.productFunnelFrom ?? null) : null;
  let productFunnel: Ga4ProductFunnelDay[] | undefined;
  let productFunnelFetchError: string | null = null;
  if (productFunnelFrom) {
    try {
      const fetchedFunnel = await fetchGa4ProductFunnelDaily({
        propertyId: params.propertyId,
        dateFrom: productFunnelFrom,
        dateTo: params.to,
      });
      if (fetchedFunnel === null) throw new Error("GA4 sem credencial ao buscar o funil por produto.");
      productFunnel = fetchedFunnel;
    } catch (err) {
      productFunnelFetchError = `busca no GA4: ${errorMessage(err)}`;
    }
  }

  const filled = fillGa4Days(params.from, params.to, fetched);
  const rows = filled.map((row) => ({
    clientId: params.clientId,
    metricDate: row.date,
    sessions: row.sessions,
    pageViews: row.pageViews,
    productViews: row.productViews,
    addToCarts: row.addToCarts,
    checkouts: row.checkouts,
    purchases: row.purchases,
    syncedAt: new Date(),
  }));

  const writePostgres = async (): Promise<void> => {
    // Lotes pequenos: um backfill de 400 dias passa de 60k parametros se for de uma vez.
    const BATCH = 200;
    for (let i = 0; i < rows.length; i += BATCH) {
      await db
        .insert(ga4DailyMetricsTable)
        .values(rows.slice(i, i + BATCH))
        .onConflictDoUpdate({
          target: [ga4DailyMetricsTable.clientId, ga4DailyMetricsTable.metricDate],
          set: {
            sessions: sql`excluded.sessions`,
            pageViews: sql`excluded.page_views`,
            productViews: sql`excluded.product_views`,
            addToCarts: sql`excluded.add_to_carts`,
            checkouts: sql`excluded.checkouts`,
            purchases: sql`excluded.purchases`,
            syncedAt: sql`excluded.synced_at`,
          },
        });
    }

    if (!storeProducts) return;

    // Troca a janela inteira (apaga e regrava): o GA4 revisa contagens recentes e
    // um item que sumiu da revisao nao pode ficar com o numero velho.
    const PRODUCT_BATCH = 1000;
    await db.transaction(async (tx) => {
      await tx
        .delete(ga4ProductViewsDailyTable)
        .where(
          and(
            eq(ga4ProductViewsDailyTable.clientId, params.clientId),
            gte(ga4ProductViewsDailyTable.metricDate, productFrom),
            lte(ga4ProductViewsDailyTable.metricDate, params.to),
          ),
        );
      const syncedAt = new Date();
      for (let i = 0; i < productViews.length; i += PRODUCT_BATCH) {
        await tx.insert(ga4ProductViewsDailyTable).values(
          productViews.slice(i, i + PRODUCT_BATCH).map((row) => ({ clientId: params.clientId, ...row, syncedAt })),
        );
      }
    });
  };

  const writeBigQuery = async (): Promise<Ga4BigQueryWrite | null> => {
    if (!params.bigQuery) return null;
    return writeGa4ToBigQuery(params.bigQuery, {
      client: {
        clientId: params.clientId,
        clientName: params.clientName ?? params.clientId,
        propertyId: params.propertyId,
      },
      daily: filled,
      from: params.from,
      productViews,
      productFrom,
      to: params.to,
      ...(traffic && trafficFrom ? { traffic, trafficFrom } : {}),
      ...(productFunnel && productFunnelFrom ? { productFunnel, productFunnelFrom } : {}),
    });
  };

  // Os dois destinos andam separados: se um falhar o outro termina mesmo assim (o Postgres alimenta as
  // telas, o BigQuery alimenta os agentes), e o erro de cada um aparece em sync_jobs.error com o nome do destino.
  const [postgres, bigQuery] = await Promise.allSettled([writePostgres(), writeBigQuery()]);
  const failures: string[] = [];
  if (postgres.status === "rejected") failures.push(`Postgres: ${errorMessage(postgres.reason)}`);
  if (bigQuery.status === "rejected") failures.push(`BigQuery: ${errorMessage(bigQuery.reason)}`);
  if (failures.length > 0) throw new Error(failures.join(" | "));

  // Produtos de cliente B2B ficam so no BigQuery: apaga a copia antiga do banco do painel, mas SO depois de o BigQuery ter gravado
  // (sem ele nao ha segunda copia). Falha aqui nao derruba o job: o dado do GA4 ja foi guardado.
  let prunedProductRows = 0;
  if (!storeProducts && bigQuery.status === "fulfilled" && bigQuery.value) {
    try {
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(ga4ProductViewsDailyTable)
        .where(eq(ga4ProductViewsDailyTable.clientId, params.clientId));
      if (n > 0) {
        await db.delete(ga4ProductViewsDailyTable).where(eq(ga4ProductViewsDailyTable.clientId, params.clientId));
        prunedProductRows = n;
      }
    } catch (err) {
      console.warn("[ga4-daily] nao consegui apagar a copia antiga de produtos do Postgres", {
        clientId: params.clientId,
        error: errorMessage(err),
      });
    }
  }

  const bigQueryWrite = bigQuery.status === "fulfilled" ? bigQuery.value : null;
  const trafficError = trafficFetchError ?? (bigQueryWrite?.trafficError ? `gravacao no BigQuery: ${bigQueryWrite.trafficError}` : null);
  const trafficWritten = Boolean(traffic && trafficFrom && bigQueryWrite && !bigQueryWrite.trafficError);
  if (trafficError) {
    console.warn("[ga4-daily] origem do trafego nao gravada; o resto seguiu e a proxima rodada refaz a janela", {
      clientId: params.clientId,
      error: trafficError,
    });
  }
  const productFunnelError =
    productFunnelFetchError ?? (bigQueryWrite?.productFunnelError ? `gravacao no BigQuery: ${bigQueryWrite.productFunnelError}` : null);
  const productFunnelWritten = Boolean(productFunnel && productFunnelFrom && bigQueryWrite && !bigQueryWrite.productFunnelError);
  if (productFunnelError) {
    console.warn("[ga4-daily] funil por produto nao gravado; o resto seguiu e a proxima rodada refaz a janela", {
      clientId: params.clientId,
      error: productFunnelError,
    });
  }

  return {
    from: params.from,
    to: params.to,
    productFrom,
    days: rows.length,
    sessions: rows.reduce((sum, row) => sum + row.sessions, 0),
    productViewRows: productViews.length,
    prunedProductRows,
    trafficRows: bigQueryWrite?.trafficRows ?? 0,
    trafficFrom: trafficWritten ? trafficFrom : null,
    trafficTo: trafficWritten ? params.to : null,
    trafficError,
    productFunnelRows: bigQueryWrite?.productFunnelRows ?? 0,
    productFunnelFrom: productFunnelWritten ? productFunnelFrom : null,
    productFunnelTo: productFunnelWritten ? params.to : null,
    productFunnelError,
    bigQuery: bigQueryWrite,
  };
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

// Usado pela lista de clientes: soma de sessoes por cliente no periodo, so de
// dado guardado. Cliente sem nenhuma linha no periodo fica de fora do mapa
// (a tela mostra "sem dado" em vez de 0).
export async function sumGa4SessionsByClient(params: {
  clientIds: string[];
  dateFrom: string;
  dateTo: string;
}): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (params.clientIds.length === 0) return result;
  const rows = await db
    .select({
      clientId: ga4DailyMetricsTable.clientId,
      sessions: sql<number>`COALESCE(SUM(${ga4DailyMetricsTable.sessions}), 0)::int`,
    })
    .from(ga4DailyMetricsTable)
    .where(
      and(
        inArray(ga4DailyMetricsTable.clientId, params.clientIds),
        gte(ga4DailyMetricsTable.metricDate, params.dateFrom),
        lte(ga4DailyMetricsTable.metricDate, params.dateTo),
      ),
    )
    .groupBy(ga4DailyMetricsTable.clientId);
  for (const row of rows) result.set(row.clientId, Number(row.sessions) || 0);
  return result;
}

// ── Leitura pelas telas de um cliente (dashboard, funil, pedidos, escala) ───
// Le de ga4_daily_metrics e so cai na chamada ao vivo se a loja ainda nao tem
// dado guardado utilizavel (ainda sem acesso no GA4, periodo mais antigo que o
// backfill ou job parado ha mais de 48h). Assim a troca nao tira dado de quem
// funciona ao vivo hoje. Quando todas as lojas estiverem sincronizando, o
// ramo ao vivo pode sair.
async function queryStoredGa4Days(params: {
  clientId: string;
  dateFrom: string;
  dateTo: string;
}): Promise<Ga4DailyMetrics[] | null> {
  const rows = await db
    .select({
      date: ga4DailyMetricsTable.metricDate,
      sessions: ga4DailyMetricsTable.sessions,
      pageViews: ga4DailyMetricsTable.pageViews,
      productViews: ga4DailyMetricsTable.productViews,
      addToCarts: ga4DailyMetricsTable.addToCarts,
      checkouts: ga4DailyMetricsTable.checkouts,
      purchases: ga4DailyMetricsTable.purchases,
      earliest: sql<string | null>`(SELECT MIN(metric_date)::text FROM ga4_daily_metrics WHERE client_id = ${params.clientId})`,
      latestSyncedAt: sql<string | null>`(SELECT MAX(synced_at) FROM ga4_daily_metrics WHERE client_id = ${params.clientId})`,
    })
    .from(ga4DailyMetricsTable)
    .where(
      and(
        eq(ga4DailyMetricsTable.clientId, params.clientId),
        gte(ga4DailyMetricsTable.metricDate, params.dateFrom),
        lte(ga4DailyMetricsTable.metricDate, params.dateTo),
      ),
    )
    .orderBy(ga4DailyMetricsTable.metricDate);
  if (rows.length === 0) return null;
  const usable = isGa4StoreUsable({
    earliestDate: rows[0].earliest,
    latestSyncedAt: rows[0].latestSyncedAt ? new Date(rows[0].latestSyncedAt) : null,
    dateFrom: params.dateFrom,
  });
  if (!usable) return null;
  return rows.map((row) => ({
    date: row.date,
    sessions: row.sessions,
    pageViews: row.pageViews,
    productViews: row.productViews,
    addToCarts: row.addToCarts,
    checkouts: row.checkouts,
    purchases: row.purchases,
  }));
}

// Falha de leitura (ex.: migration ainda nao aplicada) cai no ao vivo, nao quebra a tela.
async function readStoredGa4Days(params: {
  clientId: string;
  dateFrom: string;
  dateTo: string;
}): Promise<Ga4DailyMetrics[] | null> {
  try {
    return await queryStoredGa4Days(params);
  } catch (err) {
    console.warn("[ga4] leitura de ga4_daily_metrics falhou; usando o GA4 ao vivo", err);
    return null;
  }
}

export async function getGa4Funnel(params: {
  clientId: string;
  propertyId?: string | null;
  dateFrom: string;
  dateTo: string;
}): Promise<Ga4FunnelMetrics | null> {
  if (!params.propertyId) return null;
  const stored = await readStoredGa4Days(params);
  if (stored) return aggregateGa4Rows(stored);
  return fetchGa4FunnelMetrics(params);
}

export async function getGa4Daily(params: {
  clientId: string;
  propertyId?: string | null;
  dateFrom: string;
  dateTo: string;
}): Promise<Ga4DailyMetrics[] | null> {
  if (!params.propertyId) return null;
  const stored = await readStoredGa4Days(params);
  if (stored) return stored;
  return fetchGa4DailyMetrics(params);
}

// Visualizacoes de produto do periodo, somadas por item -- mesmo formato de
// fetchGa4ProductViewMetrics. Usa a cobertura da tabela diaria (o job grava as
// duas juntas) e cai no ao vivo se a loja ainda nao tem dado guardado.
async function storeCovers(params: { clientId: string; dateFrom: string }): Promise<boolean> {
  try {
    // Frescor: o job grava as duas tabelas juntas, entao o ultimo synced_at do
    // trafego vale pros dois. Cobertura: a data de onde o backfill de PRODUTOS
    // partiu fica no resultado do job (productFrom) -- a tabela de produtos nao
    // serve de prova, pois loja sem nenhuma view_item tem zero linhas.
    const [[fresh], [coverage]] = await Promise.all([
      db
        .select({ latestSyncedAt: sql<string | null>`MAX(${ga4DailyMetricsTable.syncedAt})` })
        .from(ga4DailyMetricsTable)
        .where(eq(ga4DailyMetricsTable.clientId, params.clientId)),
      db
        .select({ earliest: sql<string | null>`MIN(${syncJobsTable.result}->>'productFrom')` })
        .from(syncJobsTable)
        .where(
          and(
            eq(syncJobsTable.clientId, params.clientId),
            eq(syncJobsTable.jobType, "ga4_daily"),
            eq(syncJobsTable.status, "done"),
          ),
        ),
    ]);
    return isGa4StoreUsable({
      earliestDate: coverage?.earliest ?? null,
      latestSyncedAt: fresh?.latestSyncedAt ? new Date(fresh.latestSyncedAt) : null,
      dateFrom: params.dateFrom,
    });
  } catch (err) {
    console.warn("[ga4] cobertura de visualizacoes de produto falhou; usando o GA4 ao vivo", err);
    return false;
  }
}

export async function getGa4ProductViews(params: {
  clientId: string;
  propertyId?: string | null;
  dateFrom: string;
  dateTo: string;
}): Promise<Ga4ProductViewMetric[] | null> {
  if (!params.propertyId) return null;
  if (await storeCovers(params)) {
    try {
      const rows = await db
        .select({
          itemId: ga4ProductViewsDailyTable.itemId,
          itemName: ga4ProductViewsDailyTable.itemName,
          itemVariant: ga4ProductViewsDailyTable.itemVariant,
          views: sql<number>`SUM(${ga4ProductViewsDailyTable.views})::int`,
        })
        .from(ga4ProductViewsDailyTable)
        .where(
          and(
            eq(ga4ProductViewsDailyTable.clientId, params.clientId),
            gte(ga4ProductViewsDailyTable.metricDate, params.dateFrom),
            lte(ga4ProductViewsDailyTable.metricDate, params.dateTo),
          ),
        )
        .groupBy(
          ga4ProductViewsDailyTable.itemId,
          ga4ProductViewsDailyTable.itemName,
          ga4ProductViewsDailyTable.itemVariant,
        );
      return rows.map((row) => ({
        itemId: row.itemId || null,
        itemName: row.itemName || null,
        itemVariant: row.itemVariant || null,
        views: Number(row.views) || 0,
      }));
    } catch (err) {
      console.warn("[ga4] leitura de ga4_product_views_daily falhou; usando o GA4 ao vivo", err);
    }
  }
  return fetchGa4ProductViewMetrics(params);
}
