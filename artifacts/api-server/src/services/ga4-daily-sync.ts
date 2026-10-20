import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, ga4DailyMetricsTable, ga4ProductViewsDailyTable, syncJobsTable } from "@workspace/db";
import { aggregateGa4Rows, fillGa4Days, isGa4StoreUsable, toStoredProductViews } from "./ga4-daily-rules";
import {
  fetchGa4DailyMetrics,
  fetchGa4FunnelMetrics,
  fetchGa4ProductViewMetrics,
  fetchGa4ProductViewsDaily,
  type Ga4DailyMetrics,
  type Ga4FunnelMetrics,
  type Ga4ProductViewMetric,
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
        sql`${syncJobsTable.result}->>productFrom IS NOT NULL`,
      ),
    );
  return new Set(rows.map((row) => row.clientId));
}

export async function syncGa4DailyForClient(params: {
  clientId: string;
  propertyId: string;
  from: string;
  // Inicio da janela de produtos (>= 1o dia do backfill); padrao = from.
  productFrom?: string;
  to: string;
}): Promise<{
  from: string;
  to: string;
  productFrom: string;
  days: number;
  sessions: number;
  productViewRows: number;
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

  const rows = fillGa4Days(params.from, params.to, fetched).map((row) => ({
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

  return {
    from: params.from,
    to: params.to,
    productFrom,
    days: rows.length,
    sessions: rows.reduce((sum, row) => sum + row.sessions, 0),
    productViewRows: productViews.length,
  };
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
        .select({ earliest: sql<string | null>`MIN(${syncJobsTable.result}->>productFrom)` })
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
