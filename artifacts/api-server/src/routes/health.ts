import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { HealthCheckResponse } from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { getBigQueryCredentialDiagnostics } from "../lib/bigquery";

const router: IRouter = Router();

// Diagnóstico temporário pra investigar a credencial do BigQuery em
// produção. Não expõe a chave privada. Remover depois de resolver.
router.get("/debug/bigquery", (_req, res) => {
  res.json(getBigQueryCredentialDiagnostics());
});

router.get("/healthz", async (_req, res) => {
  let dbStatus: "ok" | "error" = "ok";
  try {
    await db.execute(sql`SELECT 1`);
  } catch (err) {
    dbStatus = "error";
    logger.error({ err }, "Healthz DB check failed");
  }
  const payload = HealthCheckResponse.parse({
    status: dbStatus === "ok" ? "ok" : "degraded",
    db: dbStatus,
    uptime: Math.round(process.uptime()),
  });
  res.status(dbStatus === "ok" ? 200 : 503).json(payload);
});

export default router;
