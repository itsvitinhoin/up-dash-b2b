import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./services/scheduler";
import { db, syncJobsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

/**
 * On every startup, mark any orphaned sync jobs (status = pending or running)
 * as failed. These jobs were created by a previous server instance whose
 * background IIFE runners no longer exist, so they would never complete.
 * Without this cleanup, the dedup check blocks all future sync attempts.
 */
async function cleanupOrphanedSyncJobs(): Promise<void> {
  try {
    const updated = await db
      .update(syncJobsTable)
      .set({
        status: "failed",
        error: "Server restarted while sync was in progress — please try again.",
      })
      .where(inArray(syncJobsTable.status, ["pending", "running"]))
      .returning({ id: syncJobsTable.id });

    if (updated.length > 0) {
      logger.warn(
        { count: updated.length, ids: updated.map((r) => r.id) },
        "Marked orphaned sync jobs as failed on startup",
      );
    }
  } catch (err) {
    // Non-fatal — log and continue. A failure here shouldn't prevent startup.
    logger.error({ err }, "Failed to clean up orphaned sync jobs on startup");
  }
}

// Clean up orphaned sync jobs before accepting traffic so that any stuck jobs
// from the previous server instance are cleared before the first sync request.
await cleanupOrphanedSyncJobs();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startScheduler();
});
