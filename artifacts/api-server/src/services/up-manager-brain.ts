import { db, upManagerArchiveTable as archive } from "@workspace/db";
import { and, asc, eq, isNull } from "drizzle-orm";

export async function archiveManagerReports(clientId: string) {
  const dataset = process.env.UP_MANAGER_BRAIN_DATASET?.trim();
  if (!dataset) return { status: "disabled" as const, delivered: 0 };
  const { bigquery, vestiTable } = await import("../lib/bigquery");
  const table = vestiTable(dataset, "analysis_runs");
  let delivered = 0;
  // Bound each execution. Oldest revisions are drained first, including manual diagnoses.
  const batch = await db
    .select({ runId: archive.runId })
    .from(archive)
    .where(and(eq(archive.clientId, clientId), isNull(archive.archivedAt)))
    .orderBy(asc(archive.createdAt), asc(archive.runId))
    .limit(40);

  for (const { runId } of batch) {
    const result = await db
      .transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(archive)
          .where(
            and(
              eq(archive.clientId, clientId),
              eq(archive.runId, runId),
              isNull(archive.archivedAt),
            ),
          )
          .for("update", { skipLocked: true });
        if (!row) return "skipped";
        // The same BigQuery job ID is reused by concurrent retries and after lost
        // responses. MERGE remains idempotent after BigQuery job metadata expires.
        const jobId = `up_manager_${row.runId.replaceAll("-", "_")}_${row.archiveAttempt}`;
        const location = "US";
        const query = `
      MERGE ${table} AS target
      USING (
        SELECT @runId AS run_id, @clientId AS client_id, DATE(@analysisDay) AS analysis_day,
               DATE(@dateFrom) AS date_from, DATE(@dateTo) AS date_to, @trigger AS trigger,
               @version AS skill_version, TIMESTAMP(@createdAt) AS created_at, PARSE_JSON(@payload, wide_number_mode => 'round') AS payload
      ) AS incoming
      ON target.date_to = DATE(@dateTo) AND target.client_id = @clientId AND target.run_id = incoming.run_id
      WHEN NOT MATCHED THEN INSERT
        (run_id, client_id, analysis_day, date_from, date_to, trigger, skill_version, created_at, archived_at, payload)
        VALUES (incoming.run_id, incoming.client_id, incoming.analysis_day, incoming.date_from, incoming.date_to,
                incoming.trigger, incoming.skill_version, incoming.created_at, CURRENT_TIMESTAMP(), incoming.payload)
    `;
        const params = {
          runId: row.runId,
          clientId: row.clientId,
          analysisDay: row.analysisDay,
          dateFrom: row.dateFrom,
          dateTo: row.dateTo,
          trigger: row.trigger,
          version: row.version,
          createdAt: row.createdAt.toISOString(),
          payload: JSON.stringify(row.payload),
        };
        let job;
        try {
          [job] = await bigquery.createQueryJob({
            query,
            params,
            location,
            jobId,
            jobTimeoutMs: 60_000,
          });
        } catch (error) {
          if ((error as { code?: number }).code !== 409) throw error;
          job = bigquery.job(jobId, { location });
        }
        try {
          await job.getQueryResults();
        } catch (error) {
          const [metadata] = await job.getMetadata();
          if (!metadata.status?.errorResult) throw error;
          // Persist the increment only after BigQuery confirms a terminal failure.
          await tx
            .update(archive)
            .set({ archiveAttempt: row.archiveAttempt + 1 })
            .where(eq(archive.runId, runId));
          return "failed";
        }
        await tx
          .update(archive)
          .set({ archivedAt: new Date() })
          .where(eq(archive.runId, runId));
        return "delivered";
      })
      .catch(() => "failed");
    if (result === "failed")
      throw new Error(
        "Falha ao publicar a memória B2C no BigQuery. A revisão continua pendente no Cloud SQL.",
      );
    if (result === "delivered") delivered++;
  }
  return { status: "available" as const, delivered };
}
