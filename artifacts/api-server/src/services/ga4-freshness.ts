// Verificacao "o GA4 esta chegando?": le o que o ga4_daily deixou no Postgres (sync_jobs) e no BigQuery e aponta o que
// parou. O julgamento mora em ga4-freshness-rules.ts (puro, testado); aqui so se junta o dado e se escreve o log.
//
// Roda como TASK=check_data_freshness. Com PROBLEMA devolve `failed` > 0, e o upzero-sync-job sai com codigo 1 -> a execucao
// do Cloud Run falha -> um alerta do Cloud Monitoring sobre execucao falha avisa (ver docs/ga4-alerta.md). Aviso
// (cliente que nunca leu, falta acesso) so aparece no log.
import { and, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db, clientsTable, ga4DailyMetricsTable, syncJobsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import type { BigQueryLike } from "./excluded-clients-bq";
import { readGa4BigQueryCoverage, type Ga4BigQueryCoverage } from "./ga4-bigquery";
import { isGa4BigQueryEnabled } from "./ga4-bigquery-rules";
import {
  DEFAULT_MAX_AGE_HOURS,
  evaluateGa4Freshness,
  type Ga4ClientHealthInput,
  type Ga4FreshnessFinding,
} from "./ga4-freshness-rules";

export type Ga4FreshnessSummary = {
  jobType: "check_data_freshness";
  total: number;
  healthy: number;
  problems: number;
  warnings: number;
  /** Quantos PROBLEMAS (nao avisos): o upzero-sync-job sai com erro quando > 0. */
  failed: number;
  findings: Ga4FreshnessFinding[];
};

const RECENT_ATTEMPTS_DAYS = 3;

type IsolatedTableKey = "trafficTo" | "productFunnelTo";

// Quando foi a ultima gravacao COM SUCESSO de uma tabela isolada de cada cliente (o resultado do job guarda `key` so quando a tabela foi
// escrita). A chave vem de um tipo fechado (entra no SQL como texto), nunca de fora. Falha de leitura devolve null: a regra daquela
// tabela fica sem julgar, e a verificacao inteira segue.
async function readLastOkByClient(ids: string[], key: IsolatedTableKey): Promise<Map<string, Date> | null> {
  if (ids.length === 0) return new Map();
  try {
    const rows = await db
      .select({
        clientId: syncJobsTable.clientId,
        at: sql<string | null>`MAX(COALESCE(${syncJobsTable.finishedAt}, ${syncJobsTable.createdAt}))`,
      })
      .from(syncJobsTable)
      .where(
        and(
          eq(syncJobsTable.jobType, "ga4_daily"),
          eq(syncJobsTable.status, "done"),
          inArray(syncJobsTable.clientId, ids),
          sql`${syncJobsTable.result}->>${sql.raw(`'${key}'`)} IS NOT NULL`,
        ),
      )
      .groupBy(syncJobsTable.clientId);
    const found = new Map<string, Date>();
    for (const row of rows) if (row.at) found.set(row.clientId, new Date(row.at));
    return found;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), key }, "[ga4-freshness] nao consegui ler a gravacao de uma tabela isolada; pulei essa regra");
    return null;
  }
}

function envPositiveInt(name: string): number | undefined {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export async function runGa4FreshnessCheck(
  options: { bq?: BigQueryLike | null; now?: Date; maxAgeHours?: number } = {},
): Promise<Ga4FreshnessSummary> {
  const now = options.now ?? new Date();
  const maxAgeHours = options.maxAgeHours ?? Number.parseInt(process.env.GA4_FRESHNESS_MAX_AGE_HOURS ?? "", 10);

  const clients = (
    await db
      .select({ id: clientsTable.id, name: clientsTable.name, propertyId: clientsTable.ga4PropertyId })
      .from(clientsTable)
      .where(and(isNotNull(clientsTable.ga4PropertyId), isNull(clientsTable.archivedAt)))
      .orderBy(clientsTable.name)
  ).filter((client) => client.propertyId?.trim());
  const ids = clients.map((client) => client.id);

  const lastDone = new Map<string, Date>();
  const lastAttempt = new Map<string, { at: Date; status: string; error: string | null }>();
  // Tabelas isoladas (origem do trafego e funil por produto): na rodada CONCLUIDA mais recente de cada cliente, o erro de cada uma
  // (sync_jobs.result.trafficError / productFunnelError) e se a rodada ja chegou a TENTAR (a chave trafficTo / productFunnelTo existe no
  // resultado, mesmo nula: so o job com a tabela nova a escreve).
  const latestDone = new Map<
    string,
    { trafficError: string | null; trafficAttempted: boolean; productFunnelError: string | null; productFunnelAttempted: boolean }
  >();
  if (ids.length > 0) {
    // Ultimo sucesso de cada cliente, de QUALQUER data: "nunca sincronizou" so vale para quem nunca teve um.
    const done = await db
      .select({
        clientId: syncJobsTable.clientId,
        at: sql<string | null>`MAX(COALESCE(${syncJobsTable.finishedAt}, ${syncJobsTable.createdAt}))`,
      })
      .from(syncJobsTable)
      .where(and(eq(syncJobsTable.jobType, "ga4_daily"), eq(syncJobsTable.status, "done"), inArray(syncJobsTable.clientId, ids)))
      .groupBy(syncJobsTable.clientId);
    for (const row of done) if (row.at) lastDone.set(row.clientId, new Date(row.at));

    // Ultima tentativa de cada cliente (so olha os ultimos dias: sem tentativa recente = job parado).
    const since = new Date(now.getTime() - RECENT_ATTEMPTS_DAYS * 24 * 3_600_000);
    const attempts = await db
      .select({
        clientId: syncJobsTable.clientId,
        status: syncJobsTable.status,
        error: syncJobsTable.error,
        at: syncJobsTable.createdAt,
        trafficError: sql<string | null>`${syncJobsTable.result}->>'trafficError'`,
        trafficAttempted: sql<boolean>`(${syncJobsTable.result}->'trafficTo') IS NOT NULL`,
        productFunnelError: sql<string | null>`${syncJobsTable.result}->>'productFunnelError'`,
        productFunnelAttempted: sql<boolean>`(${syncJobsTable.result}->'productFunnelTo') IS NOT NULL`,
      })
      .from(syncJobsTable)
      .where(and(eq(syncJobsTable.jobType, "ga4_daily"), inArray(syncJobsTable.clientId, ids), gte(syncJobsTable.createdAt, since)))
      .orderBy(desc(syncJobsTable.createdAt));
    for (const row of attempts) {
      if (!lastAttempt.has(row.clientId)) lastAttempt.set(row.clientId, { at: row.at, status: row.status, error: row.error });
      if (row.status === "done" && !latestDone.has(row.clientId)) {
        latestDone.set(row.clientId, {
          trafficError: row.trafficError ?? null,
          trafficAttempted: Boolean(row.trafficAttempted),
          productFunnelError: row.productFunnelError ?? null,
          productFunnelAttempted: Boolean(row.productFunnelAttempted),
        });
      }
    }
  }

  // Tabelas isoladas do BigQuery (origem do trafego em up_global.ga4_traffic_daily e funil por produto em ga4_product_funnel_daily):
  // quando foi a ULTIMA gravacao com sucesso de cada cliente. O job deixa sync_jobs.result.trafficTo / productFunnelTo preenchido so quando
  // a tabela foi gravada (inclusive com zero linhas); falha dela nao preenche. Regra secundaria: se a leitura de uma falhar, as demais
  // continuam e a regra daquela tabela fica sem julgar (null aqui -> undefined na entrada), com aviso no log.
  const trafficOriginLastOk = await readLastOkByClient(ids, "trafficTo");
  const productFunnelLastOk = await readLastOkByClient(ids, "productFunnelTo");

  // Trafego: a propriedade ainda recebe visitas? Le so o que ja esta guardado (uma linha por cliente e dia, com zeros nos dias
  // sem visita). Regra secundaria: se esta leitura falhar, as demais continuam e o log avisa (nao derruba a verificacao).
  const traffic = new Map<string, { storedDays: number; firstSyncedAt: Date | null; lastTrafficDay: string | null }>();
  if (ids.length > 0) {
    try {
      const rows = await db
        .select({
          clientId: ga4DailyMetricsTable.clientId,
          storedDays: sql<number>`COUNT(*)::int`,
          firstSyncedEpoch: sql<string | number | null>`EXTRACT(EPOCH FROM MIN(${ga4DailyMetricsTable.syncedAt}))`,
          lastTrafficDay: sql<string | null>`TO_CHAR(MAX(CASE WHEN ${ga4DailyMetricsTable.sessions} > 0 THEN ${ga4DailyMetricsTable.metricDate} END), 'YYYY-MM-DD')`,
        })
        .from(ga4DailyMetricsTable)
        .where(inArray(ga4DailyMetricsTable.clientId, ids))
        .groupBy(ga4DailyMetricsTable.clientId);
      for (const row of rows) {
        const epoch = row.firstSyncedEpoch === null ? Number.NaN : Number(row.firstSyncedEpoch);
        traffic.set(row.clientId, {
          storedDays: Number(row.storedDays) || 0,
          firstSyncedAt: Number.isFinite(epoch) ? new Date(epoch * 1000) : null,
          lastTrafficDay: row.lastTrafficDay ?? null,
        });
      }
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[ga4-freshness] nao consegui ler o trafego guardado; pulei a regra de visitas");
    }
  }

  const bigQueryEnabled = options.bq !== undefined ? options.bq !== null : isGa4BigQueryEnabled();
  let coverage = new Map<string, Ga4BigQueryCoverage>();
  let bigQueryReadable = true;
  if (bigQueryEnabled && ids.length > 0) {
    try {
      const bq = options.bq ?? ((await import("../lib/bigquery")).bigquery as unknown as BigQueryLike);
      coverage = await readGa4BigQueryCoverage(bq);
    } catch (err) {
      bigQueryReadable = false;
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[ga4-freshness] nao consegui ler o BigQuery");
    }
  }

  const inputs: Ga4ClientHealthInput[] = clients.map((client) => {
    const attempt = lastAttempt.get(client.id);
    return {
      clientId: client.id,
      clientName: client.name,
      propertyId: client.propertyId!.trim(),
      lastDoneAt: lastDone.get(client.id) ?? null,
      lastRunAt: attempt?.at ?? null,
      lastRunStatus: attempt?.status ?? null,
      lastError: attempt?.error ?? null,
      bigQueryLastDay: coverage.get(client.id)?.lastDay ?? null,
      storedDays: traffic.get(client.id)?.storedDays ?? 0,
      firstSyncedAt: traffic.get(client.id)?.firstSyncedAt ?? null,
      lastTrafficDay: traffic.get(client.id)?.lastTrafficDay ?? null,
      trafficOriginLastOkAt: trafficOriginLastOk ? (trafficOriginLastOk.get(client.id) ?? null) : undefined,
      trafficOriginError: trafficOriginLastOk ? (latestDone.get(client.id)?.trafficError ?? null) : undefined,
      trafficOriginAttempted: latestDone.get(client.id)?.trafficAttempted,
      productFunnelLastOkAt: productFunnelLastOk ? (productFunnelLastOk.get(client.id) ?? null) : undefined,
      productFunnelError: productFunnelLastOk ? (latestDone.get(client.id)?.productFunnelError ?? null) : undefined,
      productFunnelAttempted: latestDone.get(client.id)?.productFunnelAttempted,
    };
  });

  const { findings, healthy, total } = evaluateGa4Freshness(inputs, {
    now,
    maxAgeHours: Number.isFinite(maxAgeHours) && maxAgeHours > 0 ? maxAgeHours : DEFAULT_MAX_AGE_HOURS,
    bigQueryEnabled,
    bigQueryReadable,
    noTrafficDays: envPositiveInt("GA4_NO_TRAFFIC_DAYS"),
    stoppedAlertDays: envPositiveInt("GA4_STOPPED_ALERT_DAYS"),
    newClientDays: envPositiveInt("GA4_NEW_CLIENT_DAYS"),
  });

  const problems = findings.filter((finding) => finding.severity === "problem");
  const warnings = findings.filter((finding) => finding.severity === "warning");
  // Mensagens com prefixo fixo: dá para criar um alerta por log em cima de "[ga4-freshness] PROBLEMA".
  for (const finding of problems) logger.error({ kind: finding.kind, client: finding.clientName }, `[ga4-freshness] PROBLEMA ${finding.message}`);
  for (const finding of warnings) logger.warn({ kind: finding.kind, client: finding.clientName }, `[ga4-freshness] aviso ${finding.message}`);
  logger.info({ total, healthy, problems: problems.length, warnings: warnings.length }, "[ga4-freshness] verificacao concluida");

  return {
    jobType: "check_data_freshness",
    total,
    healthy,
    problems: problems.length,
    warnings: warnings.length,
    failed: problems.length,
    findings,
  };
}
