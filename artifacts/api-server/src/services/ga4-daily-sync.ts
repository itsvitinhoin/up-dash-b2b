import { and, gte, inArray, lte, sql } from "drizzle-orm";
import { db, ga4DailyMetricsTable } from "@workspace/db";
import { fillGa4Days } from "./ga4-daily-rules";
import { fetchGa4DailyMetrics } from "./ga4";

export async function clientIdsWithGa4History(clientIds: string[]): Promise<Set<string>> {
  if (clientIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ clientId: ga4DailyMetricsTable.clientId })
    .from(ga4DailyMetricsTable)
    .where(inArray(ga4DailyMetricsTable.clientId, clientIds));
  return new Set(rows.map((row) => row.clientId));
}

export async function syncGa4DailyForClient(params: {
  clientId: string;
  propertyId: string;
  from: string;
  to: string;
}): Promise<{ from: string; to: string; days: number; sessions: number }> {
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

  return {
    from: params.from,
    to: params.to,
    days: rows.length,
    sessions: rows.reduce((sum, row) => sum + row.sessions, 0),
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
