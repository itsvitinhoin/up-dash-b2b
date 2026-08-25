/**
 * Cloud Run Job — roda as extrações periódicas (UpZero, Meta Ads,
 * Nuvemshop, métricas diárias) fora da Vercel, perto do banco de verdade.
 *
 * Por quê: a Vercel roda em São Paulo (gru1), o Cloud SQL em us-central1
 * (Iowa) -- cada consulta paga ~360ms de latência de rede (ver
 * docs/cloud-sql-regiao-errada-14-08-2026.md). O timeout de função
 * serverless da Vercel (60s) some quando esse mesmo código roda como Cloud
 * Run Job (sem limite de tempo prático) na região certa (us-central1,
 * perto do banco) -- resolve o gargalo de vez, sem precisar de mais
 * otimização de código.
 *
 * Reaproveita inteiramente a lógica já existente em services/extraction-runner.ts
 * (a mesma usada pelas rotas /cron/extractions/* chamadas hoje pelo GitHub
 * Actions) -- esse arquivo só troca "chamada HTTP disparada pelo GitHub
 * Actions" por "processo que roda até terminar, disparado pelo Cloud
 * Scheduler".
 *
 * Variáveis de ambiente:
 *   TASK=upzero_transactional  -> sync de pedidos/clientes/produtos UpZero (padrão)
 *   TASK=upzero_analytics      -> sync de eventos de comportamento UpZero
 *   TASK=meta_ads              -> sync de métricas de anúncio Meta
 *   TASK=nuvemshop_transactional -> sync de pedidos/clientes/produtos Nuvemshop
 *   TASK=daily_metrics         -> recalcula métricas diárias agregadas
 *   TASK=hourly_bundle         -> roda upzero_analytics + meta_ads juntos
 *   TASK=whatsapp_fix_phone_waba -> corrige o waba_id de UM número em
 *     whatsapp_phone_numbers (ver CLIENT_ID/PHONE_NUMBER_ID/WABA_ID abaixo)
 *   TASK=run_migrations       -> aplica as migrations pendentes de lib/db/migrations
 *
 *   TRIGGER=cron|manual   -> como fica registrado em sync_jobs (padrão: cron)
 *   CLIENT_ID=xxx         -> restringe a um cliente só (todas as tasks exceto hourly_bundle/daily_metrics)
 *   LIMIT=10 OFFSET=0     -> pagina os clientes processados (upzero_transactional/nuvemshop_transactional)
 *   LOOKBACK_DAYS=3       -> só nuvemshop_transactional
 *   SKIP_CATALOG=1        -> só nuvemshop_transactional
 *   ALLOW_PARTIAL=1       -> só nuvemshop_transactional
 *   DATE_FROM=YYYY-MM-DD DATE_TO=YYYY-MM-DD -> obrigatório pra daily_metrics
 *   PHONE_NUMBER_ID=xxx WABA_ID=xxx -> obrigatório pra whatsapp_fix_phone_waba
 *
 * TASK=whatsapp_fix_phone_waba existe porque /api/whatsapp/connections/sync
 * (Vercel, gru1) estoura FUNCTION_INVOCATION_TIMEOUT em clientes com 2+ WABAs
 * -- mesmo motivo de todas as outras migrações deste arquivo (ver
 * docs/cloud-sql-regiao-errada-14-08-2026.md). Achado em 17/08/2026
 * investigando bug relatado pelo Lucas (números "sumindo" da Sline
 * Spoorte): whatsapp_phone_numbers.waba_id pode ficar desatualizado em
 * relação a whatsapp_integrations.waba_id (fonte da verdade) quando um
 * cliente tem múltiplos WABAs. Corrige só esse campo, sem chamar a API da
 * Meta -- não substitui um sync completo, é a correção pontual que o sync
 * faria pra esse número específico.
 */
import "dotenv/config";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, whatsappPhoneNumbersTable } from "@workspace/db";
import { logger } from "../lib/logger";
import {
  runUpzeroTransactionalExtraction,
  runUpzeroAnalyticsExtraction,
  runMetaAdsExtraction,
  runNuvemshopTransactionalExtraction,
  runDailyMetricsBackfill,
  runHourlyExtractionBundle,
  type ExtractionTrigger,
} from "../services/extraction-runner";

// Achado 25/08/2026: as migrations do lib/db (drizzle-kit) nunca rodam
// sozinhas no deploy da Vercel -- alguém precisa disparar isso à mão contra
// o banco de produção. Reaproveita a mesma conexão `db` (Cloud SQL
// Connector) que o resto do job já usa e testou o dia inteiro, em vez de
// precisar de um DATABASE_URL bruto separado (que exigiria montar a
// connection string com a senha à mão).
async function runMigrations() {
  const migrationsFolder = path.resolve(process.cwd(), "lib/db/migrations");
  logger.info({ migrationsFolder }, "[upzero-sync-job] aplicando migrations");
  await migrate(db, { migrationsFolder });
  return { ok: true };
}

async function fixWhatsappPhoneWaba(params: {
  clientId: string;
  phoneNumberId: string;
  wabaId: string;
}) {
  const [updated] = await db
    .update(whatsappPhoneNumbersTable)
    .set({ wabaId: params.wabaId, updatedAt: new Date() })
    .where(
      and(
        eq(whatsappPhoneNumbersTable.clientId, params.clientId),
        eq(whatsappPhoneNumbersTable.phoneNumberId, params.phoneNumberId),
      ),
    )
    .returning();
  return { updated: Boolean(updated), row: updated ?? null };
}

function envBool(name: string): boolean {
  return process.env[name] === "1" || process.env[name] === "true";
}

function envInt(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : undefined;
}

async function main() {
  const task = process.env.TASK ?? "upzero_transactional";
  const trigger = (process.env.TRIGGER === "manual" ? "manual" : "cron") as ExtractionTrigger;
  const clientId = process.env.CLIENT_ID || undefined;
  const limit = envInt("LIMIT");
  const offset = envInt("OFFSET");

  logger.info({ task, trigger, clientId, limit, offset }, "[upzero-sync-job] starting");
  const startedAt = Date.now();

  let result: unknown;
  switch (task) {
    case "upzero_transactional":
      result = await runUpzeroTransactionalExtraction(trigger, { clientId, limit, offset });
      break;
    case "upzero_analytics":
      result = await runUpzeroAnalyticsExtraction(trigger);
      break;
    case "meta_ads":
      result = await runMetaAdsExtraction(trigger);
      break;
    case "nuvemshop_transactional":
      result = await runNuvemshopTransactionalExtraction(trigger, {
        clientId,
        limit,
        offset,
        lookbackDays: envInt("LOOKBACK_DAYS"),
        skipCatalog: envBool("SKIP_CATALOG"),
        allowPartial: envBool("ALLOW_PARTIAL"),
      });
      break;
    case "daily_metrics": {
      const dateFrom = process.env.DATE_FROM;
      const dateTo = process.env.DATE_TO;
      if (!dateFrom || !dateTo) {
        logger.error("[upzero-sync-job] TASK=daily_metrics precisa de DATE_FROM e DATE_TO (YYYY-MM-DD)");
        process.exit(1);
      }
      result = await runDailyMetricsBackfill(trigger, { clientId, dateFrom, dateTo });
      break;
    }
    case "hourly_bundle":
      result = await runHourlyExtractionBundle(trigger);
      break;
    case "whatsapp_fix_phone_waba": {
      const phoneNumberId = process.env.PHONE_NUMBER_ID;
      const wabaId = process.env.WABA_ID;
      if (!clientId || !phoneNumberId || !wabaId) {
        logger.error("[upzero-sync-job] TASK=whatsapp_fix_phone_waba precisa de CLIENT_ID, PHONE_NUMBER_ID e WABA_ID");
        process.exit(1);
      }
      result = await fixWhatsappPhoneWaba({ clientId, phoneNumberId, wabaId });
      break;
    }
    case "run_migrations":
      result = await runMigrations();
      break;
    default:
      logger.error(`[upzero-sync-job] TASK desconhecida: "${task}". Válidas: upzero_transactional, upzero_analytics, meta_ads, nuvemshop_transactional, daily_metrics, hourly_bundle, whatsapp_fix_phone_waba, run_migrations.`);
      process.exit(1);
  }

  const durationMs = Date.now() - startedAt;
  logger.info({ task, durationMs, result }, "[upzero-sync-job] finished");

  // Segue o mesmo padrão do job Python legado (script-vesti-nuvem/scheduler_job.py):
  // sai com código != 0 se algo falhou, pro Cloud Run/Cloud Scheduler conseguir
  // alertar sem precisar reprocessar log manualmente.
  const failed = (result as { failed?: number })?.failed ?? 0;
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  logger.error({ err }, "[upzero-sync-job] unhandled error");
  process.exit(1);
});
