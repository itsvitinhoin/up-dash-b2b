// Verificacao "o GA4 esta chegando?": le o que o ga4_daily deixou no Postgres (sync_jobs) e no BigQuery e aponta o que
// parou. O julgamento mora em ga4-freshness-rules.ts (puro, testado); aqui so se junta o dado e se escreve o log.
//
// Roda como TASK=check_data_freshness. Com PROBLEMA devolve `failed` > 0, e o upzero-sync-job sai com codigo 1 -> a execucao
// do Cloud Run falha -> um alerta do Cloud Monitoring sobre execucao falha avisa (ver docs/ga4-alerta.md). Aviso
// (cliente que nunca leu, falta acesso) so aparece no log.
import { and, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db, clientsTable, syncJobsTable } from "@workspace/db";
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
      })
      .from(syncJobsTable)
      .where(and(eq(syncJobsTable.jobType, "ga4_daily"), inArray(syncJobsTable.clientId, ids), gte(syncJobsTable.createdAt, since)))
      .orderBy(desc(syncJobsTable.createdAt));
    for (const row of attempts) if (!lastAttempt.has(row.clientId)) lastAttempt.set(row.clientId, { at: row.at, status: row.status, error: row.error });
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
    };
  });

  const { findings, healthy, total } = evaluateGa4Freshness(inputs, {
    now,
    maxAgeHours: Number.isFinite(maxAgeHours) && maxAgeHours > 0 ? maxAgeHours : DEFAULT_MAX_AGE_HOURS,
    bigQueryEnabled,
    bigQueryReadable,
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
