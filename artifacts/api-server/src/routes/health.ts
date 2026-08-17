import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db, dbInitializationError } from "@workspace/db";
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
  // dbInitializationError: preenchido se o pool (Cloud SQL Connector ou
  // DATABASE_URL) falhou ao inicializar no boot do app — ver lib/db/src/index.ts.
  // Mostra isso sempre, mesmo se as queries abaixo também falharem.
  const base = {
    dbInitializationError,
    usingCloudSql: !!process.env.CLOUD_SQL_CONNECTION_NAME,
    cloudSqlConnectionName: process.env.CLOUD_SQL_CONNECTION_NAME ?? null,
    hasDbUser: !!process.env.DB_USER,
    hasDbPassword: !!process.env.DB_PASSWORD,
    hasDbName: !!process.env.DB_NAME,
    hasGoogleCredentialsJson: !!(
      process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ?? process.env.GOOGLE_SERVICE_ACCOUNT_JSON
    ),
  };
  try {
    const versionResult = await db.execute(sql`SELECT version()`);
    const sizeResult = await db.execute(sql`
      SELECT
        pg_size_pretty(pg_database_size(current_database())) AS size_pretty,
        pg_database_size(current_database()) AS size_bytes
    `);
    const maxConnResult = await db.execute(sql`SHOW max_connections`);

    // Checagem 13/08/2026: /api/analytics/orders-page estourando timeout de
    // 60s pra clientes que antes eram rapidos (Phize, Kalli Fashion) --
    // suspeita de estatistica desatualizada apos o pg_restore de ontem (sem
    // ANALYZE, o planner pode escolher sequential scan em vez de usar o
    // indice). Confirma aqui: quando foi o ultimo ANALYZE em orders/customers
    // e se o indice esperado (orders_client_created_idx) existe de verdade.
    const tableStats = await db.execute(sql`
      SELECT
        relname,
        n_live_tup,
        n_dead_tup,
        last_analyze,
        last_autoanalyze,
        last_vacuum,
        last_autovacuum
      FROM pg_stat_user_tables
      WHERE relname IN ('orders', 'customers', 'clients')
      ORDER BY relname
    `);
    const indexCheck = await db.execute(sql`
      SELECT tablename, indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'orders'
      ORDER BY indexname
    `);
    // Checagem 15/08/2026: revisando a branch codex/global-whatsapp-multi-waba
    // -- ela assume que whatsapp_integrations ainda tem a constraint antiga
    // (unique só em client_id), mas um comentário de dias atrás (fix do
    // 42P10) dizia que já tinha mudado pra (client_id, waba_id) no banco
    // real, sem isso nunca ter sido refletido no schema.ts. Confirma qual é
    // o estado real antes de aplicar a migration da branch.
    const whatsappIndexCheck = await db.execute(sql`
      SELECT tablename, indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'whatsapp_integrations'
      ORDER BY indexname
    `);
    // Suspeita nova: orders_client_created_idx existe e a tabela e pequena
    // (9928 linhas), entao nao deveria ser sequential scan lento. maxConnections
    // no Cloud SQL e 25 (era 60 na Supabase) -- conta quantas conexoes estao
    // ativas agora e ha quanto tempo, pra ver se e esgotamento de conexao.
    const connectionActivity = await db.execute(sql`
      SELECT
        state,
        count(*) AS count,
        max(EXTRACT(EPOCH FROM (now() - state_change))) AS max_seconds_in_state
      FROM pg_stat_activity
      WHERE datname = current_database()
      GROUP BY state
      ORDER BY count DESC
    `);

    // Checagem pontual pós-corte Cloud SQL (12/08/2026): confirmar se o dado
    // bate com o baseline pré-migração e se não ficou nenhuma escrita da
    // Supabase de fora (o plano previa um dump incremental final antes do
    // corte, que não rodou). Remover depois de confirmado.
    const counts = await db.execute(sql`
      SELECT
        (SELECT count(*) FROM clients) AS clients,
        (SELECT count(*) FROM orders) AS orders,
        (SELECT max(created_at) FROM orders) AS orders_max_created_at,
        (SELECT count(*) FROM customers) AS customers,
        (SELECT max(created_at) FROM customers) AS customers_max_created_at,
        (SELECT count(*) FROM whatsapp_messages) AS whatsapp_messages,
        (SELECT max(created_at) FROM whatsapp_messages) AS whatsapp_messages_max_created_at,
        (SELECT count(*) FROM notifications) AS notifications,
        (SELECT max(created_at) FROM notifications) AS notifications_max_created_at,
        (SELECT count(*) FROM sessions) AS sessions,
        (SELECT max(created_at) FROM sessions) AS sessions_max_created_at
    `);

    // Checagem 13/08/2026: o scheduler de sync noturno (services/scheduler.ts)
    // só é iniciado em src/index.ts (o server Node tradicional) -- o
    // deploy da Vercel roda src/app.ts (serverless.mjs), que nunca chama
    // startScheduler(). Confirma aqui se algum job com trigger='cron' já
    // rodou de verdade, ou se é tudo manual. Remover depois de decidido.
    const syncJobStats = await db.execute(sql`
      SELECT
        trigger,
        job_type,
        count(*) AS count,
        max(created_at) AS last_created_at
      FROM sync_jobs
      GROUP BY trigger, job_type
      ORDER BY last_created_at DESC
    `);

    // Checagem 14/08/2026: suspeita de que o gargalo do sync da UP Zero seja
    // gravação sequencial no banco (uma query por produto/cliente, sem
    // agrupar) -- mas o pool tem max:1 por instância serverless, então
    // "paralelizar" no app não adiantaria nada se o custo real for round-trip
    // de rede/protocolo por query. Mede isso na prática: 30 queries triviais
    // sequenciais, mesma conexão que o sync usaria, pra saber o custo real
    // por chamada antes de decidir a forma do fix.
    const queryTimingStart = Date.now();
    for (let i = 0; i < 30; i++) {
      await db.execute(sql`SELECT 1`);
    }
    const queryTimingTotalMs = Date.now() - queryTimingStart;

    res.json({
      ...base,
      version: (versionResult.rows[0] as Record<string, unknown> | undefined)?.version ?? null,
      databaseSize: (sizeResult.rows[0] as Record<string, unknown> | undefined) ?? null,
      maxConnections: (maxConnResult.rows[0] as Record<string, unknown> | undefined)?.max_connections ?? null,
      counts: counts.rows[0] ?? null,
      syncJobStats: syncJobStats.rows,
      tableStats: tableStats.rows,
      ordersIndexes: indexCheck.rows,
      whatsappIntegrationsIndexes: whatsappIndexCheck.rows,
      connectionActivity: connectionActivity.rows,
      queryTiming: { queries: 30, totalMs: queryTimingTotalMs, avgMsPerQuery: queryTimingTotalMs / 30 },
    });
  } catch (err) {
    logger.error({ err }, "[db-diagnostics] falhou");
    res.status(500).json({
      ...base,
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
