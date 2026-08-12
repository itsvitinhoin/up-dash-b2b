import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { HealthCheckResponse } from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { getBigQueryCredentialDiagnostics } from "../lib/bigquery";
import { authenticate, requireAdmin } from "../middlewares/auth";

const router: IRouter = Router();

// Diagnóstico temporário pra investigar a credencial do BigQuery em
// produção. Não expõe a chave privada. Remover depois de resolver.
router.get("/debug/bigquery", (_req, res) => {
  res.json(getBigQueryCredentialDiagnostics());
});

// Diagnóstico temporário pra planejar a migração Supabase -> Cloud SQL
// (07/08/2026): não temos acesso ao painel do Supabase, então em vez de
// alguém digitar a connection string em algum lugar, a própria API (que já
// está conectada com sua própria credencial) responde versão/tamanho do
// banco. Admin-only, não expõe segredo nenhum. Remover depois de decidida a
// migração.
router.get("/admin/db-diagnostics", authenticate, requireAdmin, async (_req, res) => {
  try {
    const versionResult = await db.execute(sql`SELECT version()`);
    const sizeResult = await db.execute(sql`
      SELECT
        pg_size_pretty(pg_database_size(current_database())) AS size_pretty,
        pg_database_size(current_database()) AS size_bytes
    `);
    const maxConnResult = await db.execute(sql`SHOW max_connections`);
    res.json({
      version: (versionResult.rows[0] as Record<string, unknown> | undefined)?.version ?? null,
      databaseSize: (sizeResult.rows[0] as Record<string, unknown> | undefined) ?? null,
      maxConnections: (maxConnResult.rows[0] as Record<string, unknown> | undefined)?.max_connections ?? null,
    });
  } catch (err) {
    logger.error({ err }, "[db-diagnostics] falhou");
    res.status(500).json({
      error: true,
      code: "DB_DIAGNOSTICS_FAILED",
      message: err instanceof Error ? err.message : "unknown error",
      status: 500,
    });
  }
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
