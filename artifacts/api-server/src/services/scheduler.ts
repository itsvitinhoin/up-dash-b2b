import { isNotNull } from "drizzle-orm";
import { db, clientsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { syncUpZeroClient } from "./upzero-sync";

const SYNC_HOUR_UTC = 2; // 2:00 AM UTC

function msUntilNextRun(): number {
  const now = new Date();
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      SYNC_HOUR_UTC,
      0,
      0,
      0,
    ),
  );
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

async function runNightlySync(): Promise<void> {
  logger.info("Nightly UP Zero sync starting");

  let clients: { id: string; name: string; upZeroApiKey: string }[];
  try {
    clients = await db
      .select({
        id: clientsTable.id,
        name: clientsTable.name,
        upZeroApiKey: clientsTable.upZeroApiKey,
      })
      .from(clientsTable)
      .where(isNotNull(clientsTable.upZeroApiKey)) as {
        id: string;
        name: string;
        upZeroApiKey: string;
      }[];
  } catch (err) {
    logger.error({ err }, "Nightly sync: failed to fetch clients");
    return;
  }

  logger.info({ count: clients.length }, "Nightly sync: clients with UP Zero key");

  for (const client of clients) {
    try {
      const result = await syncUpZeroClient(client.id, client.upZeroApiKey);
      logger.info(
        {
          clientId: client.id,
          clientName: client.name,
          ordersCreated: result.ordersCreated,
          ordersUpdated: result.ordersUpdated,
          customersCreated: result.customersCreated,
          customersUpdated: result.customersUpdated,
          productsCreated: result.productsCreated,
          productsUpdated: result.productsUpdated,
          orderItemsSynced: result.orderItemsSynced,
          errors: result.errors.length,
        },
        "Nightly sync: client complete",
      );
      if (result.errors.length > 0) {
        logger.warn(
          { clientId: client.id, errors: result.errors },
          "Nightly sync: client finished with errors",
        );
      }
    } catch (err) {
      logger.error(
        { err, clientId: client.id, clientName: client.name },
        "Nightly sync: client failed",
      );
    }
  }

  logger.info("Nightly UP Zero sync complete");
}

function scheduleNext(): void {
  const delay = msUntilNextRun();
  const nextRun = new Date(Date.now() + delay);
  logger.info(
    { nextRun: nextRun.toISOString() },
    "Nightly UP Zero sync scheduled",
  );
  setTimeout(() => {
    runNightlySync().finally(scheduleNext);
  }, delay).unref();
}

export function startScheduler(): void {
  scheduleNext();
}
