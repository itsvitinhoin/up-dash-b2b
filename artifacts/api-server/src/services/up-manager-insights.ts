import { funnelFingerprint, hasClosedOrders, reopenedSources } from "./up-manager-source-readiness";
import { readCommerceFreshness, readFunnel } from "./up-manager-b2c-data";
import { managerClientIds, managerScheduledAnalysisMode } from "./up-manager-config";
import { analyzeProductCampaigns } from "./product-campaign-analysis";
import { fetchCampaignAds } from "./product-campaign-sources";
import { readManagerAuditTrail, readManagerLongTermLessons } from "./up-manager-memory";
import { buildManagerSectorMemory } from "./up-manager-sector-memory";
import { listManagerFollowups, measureManagerFollowups } from "./up-manager-workflow";
import { randomUUID } from "node:crypto";
import {
  db,
  pool,
  upManagerArchiveTable as archive,
  upManagerReportsTable as reports,
} from "@workspace/db";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { addDaysToDateOnly, saoPauloDateOnly } from "../lib/reporting-period";
import {
  campaignClient,
  getProductCampaignCheck,
  runProductCampaignCheck,
} from "./product-campaign-monitor";
import {
  B2C_VERSION,
  buildB2cReport,
  type CommercialSnapshot,
} from "./up-manager-b2c";
import {
  analyzeManagerWithOpenAI,
  draftManagerClientUpdates,
  managerAgentConfigured,
  managerScheduledModel,
  type ReadyManagerAnalysis,
} from "./up-manager-agent";
import { archiveManagerReports } from "./up-manager-brain";
import {
  managerCommerceSupported, managerMetaToken,
  type readManagerOverview,
  type readManagerProducts,
  type ManagerClient,
  type ManagerPeriod,
} from "./up-manager";

type ManagerOverview = Awaited<ReturnType<typeof readManagerOverview>>;
type ManagerProducts = Awaited<ReturnType<typeof readManagerProducts>>;
type MonitorState = Awaited<ReturnType<typeof getProductCampaignCheck>>;

async function readManagerProductMonitor(client: ManagerClient): Promise<MonitorState> {
  const state = await getProductCampaignCheck(client);
  if (client.commercePlatform !== "BRAAVO" || !client.accountId) return state;
  const token = managerMetaToken(client);
  if (!token) return state;
  const meta = await fetchCampaignAds(client.accountId, token, AbortSignal.timeout(20_000)).catch(() => null);
  if (!meta) return state;
  return { ...state, configured: true, checkedAt: meta.observedAt, stale: false, error: null,
    snapshot: { ...analyzeProductCampaigns(meta.ads, [], []), version: 1, accountId: client.accountId,
      storeId: client.id, adsObservedAt: meta.observedAt, stockObservedAt: meta.observedAt,
      window: meta.window, currency: meta.currency, timeZone: meta.timeZone, warnings: meta.warnings } };
}

export interface ManagerFinding {
  id: string;
  title: string;
  evidence: string;
  action: string;
  section: "campaigns" | "products";
}

export function managerFindings(
  overview: ManagerOverview,
  catalog: ManagerProducts,
  monitor: MonitorState,
  today: string,
  currency: string,
): ManagerFinding[] {
  const insights: ManagerFinding[] = [];
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency });
  const { metrics, previous, period } = overview;
  const stockout = catalog.products.find(
    (product) => product.stock === 0 && product.units > 0,
  );
  if (stockout)
    insights.push({
      id: "bestseller-stockout",
      title: "Produto mais vendido esgotado",
      evidence: `${stockout.name} vendeu ${stockout.units} unidade(s) no período e o catálogo atual indica estoque zero nas variantes medidas.`,
      action:
        "Conferir reposição e revisar a exposição do produto até o estoque voltar.",
      section: "products",
    });
  if (
    !monitor.stale &&
    monitor.snapshot &&
    monitor.snapshot.unidentified.length > 0
  )
    insights.push({
      id: "campaign-coverage",
      title: "Destinos de anúncios para revisar",
      evidence: `${monitor.snapshot.unidentified.length} de ${monitor.snapshot.totalAds} anúncios ativos têm pelo menos um destino sem vínculo completo com o catálogo.`,
      action:
        "Revisar links de coleção, catálogo ou destinos ambíguos antes de tomar uma decisão baseada no estoque.",
      section: "campaigns",
    });
  if (
    period.dateTo < today &&
    metrics.spend !== null &&
    previous.spend !== null &&
    previous.orders >= 5 &&
    metrics.spend > previous.spend &&
    metrics.orders < previous.orders
  )
    insights.push({
      id: "spend-up-sales-down",
      title: "Investimento subiu e vendas caíram",
      evidence: `O gasto Meta passou de ${money.format(previous.spend)} para ${money.format(metrics.spend)} e os pedidos aprovados passaram de ${previous.orders} para ${metrics.orders}, em janelas de mesma duração.`,
      action:
        "Investigar campanhas, oferta e estoque dos produtos líderes para verificar o que pode explicar a diferença.",
      section: "campaigns",
    });
  return insights;
}

export function managerHistory(clientId: string) {
  return db
    .select({
      analysisDay: reports.analysisDay,
      dateFrom: reports.dateFrom,
      dateTo: reports.dateTo,
      payload: sql<
        Record<string, unknown>
      >`jsonb_strip_nulls(jsonb_build_object(
        'findings', CASE WHEN ${reports.payload}#>>'{b2c,version}' IN ('up-b2c-v2','up-b2c-v3','up-b2c-v3.1','up-b2c-v4','up-b2c-v5','up-b2c-v6','up-b2c-v7','up-b2c-v8','up-b2c-v9','up-b2c-v10','up-b2c-v11','up-b2c-v12','up-b2c-v13','up-b2c-v14','up-b2c-v15','up-b2c-v16','up-b2c-v17','up-b2c-v18','up-b2c-v19','up-b2c-v20','up-b2c-v21')
          THEN '[]'::jsonb ELSE ${reports.payload}->'findings' END,
        'runId', ${reports.payload}->'runId',
        'trigger', ${reports.payload}->'trigger',
        'summary', ${reports.payload}#>>'{b2c,summary}'
      ))`,
      createdAt: reports.createdAt,
    })
    .from(reports)
    .where(eq(reports.clientId, clientId))
    .orderBy(desc(reports.createdAt))
    .limit(14);
}

export async function managerReportDetails(clientId: string, runId: string) {
  const [row] = await db
    .select({
      analysisDay: archive.analysisDay,
      dateFrom: archive.dateFrom,
      dateTo: archive.dateTo,
      archivedAt: archive.archivedAt,
      createdAt: archive.createdAt,
      payload: sql<
        Record<string, unknown>
      >`${archive.payload} - 'commercialSnapshot' - 'checkoutTest'`,
    })
    .from(archive)
    .where(and(eq(archive.clientId, clientId), eq(archive.runId, runId)));
  return row;
}

async function previousManagerFindings(clientId: string, analysisDay: string) {
  const [previous] = await db
    .select({ dateTo: reports.dateTo, payload: reports.payload })
    .from(reports)
    .where(
      and(
        eq(reports.clientId, clientId),
        lt(reports.analysisDay, analysisDay),
        sql`${reports.payload}->>'trigger' = 'scheduled'`,
      ),
    )
    .orderBy(desc(reports.analysisDay), desc(reports.createdAt))
    .limit(1);
  return previous;
}

async function priorCommercialSnapshot(
  clientId: string,
  analysisDay: string,
): Promise<CommercialSnapshot | null> {
  const base = and(
    eq(reports.clientId, clientId),
    lt(reports.analysisDay, analysisDay),
  );
  const read = async (source: "catalog" | "coupons") => {
    const [row] = await db
      .select({
        snapshot: sql<CommercialSnapshot>`${reports.payload}->'commercialSnapshot'`,
      })
      .from(reports)
      .where(
        and(
          base,
          sql`jsonb_typeof(${reports.payload}->'commercialSnapshot'->${source}::text) IN ('array', 'object')`,
        ),
      )
      .orderBy(desc(reports.analysisDay), desc(reports.createdAt))
      .limit(1);
    return row?.snapshot ?? null;
  };
  const [catalog, coupons] = await Promise.all([
    read("catalog"),
    read("coupons"),
  ]);
  if (!catalog && !coupons) return null;
  return {
    catalog: catalog?.catalog ?? null,
    stockObservedAt: catalog?.stockObservedAt ?? null,
    coupons: coupons?.coupons ?? null,
  };
}

export async function saveManagerReport(
  client: ManagerClient,
  period: ManagerPeriod,
  options: {
    trigger?: "manual" | "scheduled";
    now?: Date;
    refresh?: boolean;
    analysisMode?: ReturnType<typeof managerScheduledAnalysisMode>;
  } = {},
) {
  const now = options.now ?? new Date();
  const analysisDay = saoPauloDateOnly(now);
  const trigger = options.trigger ?? "manual";
  const scheduled = trigger === "scheduled";
  const analysisMode = scheduled ? options.analysisMode : undefined;
  const rulesOnly = analysisMode === "rules_only";
  const onceDaily = analysisMode === "once_daily";
  let refresh = scheduled && options.refresh === true;
  const agentConfigured = !rulesOnly && managerAgentConfigured();
  const key = {
    clientId: client.id,
    analysisDay,
    dateFrom: period.dateFrom,
    dateTo: period.dateTo,
  };
  const byKey = and(
    eq(reports.clientId, key.clientId),
    eq(reports.analysisDay, key.analysisDay),
    eq(reports.dateFrom, key.dateFrom),
    eq(reports.dateTo, key.dateTo),
  );

  let previousAgent: ReadyManagerAnalysis | null = null;
  if (scheduled && (!refresh || onceDaily)) {
    const [existing] = await db
      .select({
        commerceAt: sql<string | null>`${reports.payload}#>>'{b2c,coverage,commerce,observedAt}'`,
        ga4: sql<(string | null)[] | null>`${reports.payload}#>'{b2c,coverage,ga4Fingerprint}'`,
        dpaStatus: sql<string | null>`${reports.payload}#>>'{b2c,product,dpa,status}'`,
        agentStatus: sql<string | null>`${reports.payload}#>>'{agent,status}'`,
        agent: sql<ReadyManagerAnalysis | null>`${reports.payload}->'agent'`,
        complete: sql<boolean>`COALESCE(${reports.payload}->>'trigger' = 'scheduled' AND ${reports.payload}#>>'{b2c,scope,commerceConfirmed}' = 'true'
          AND ${reports.payload}#>>'{b2c,version}' = ${B2C_VERSION}
          AND (NOT ${agentConfigured} OR ${reports.payload}#>>'{agent,status}' = 'ready')
          AND (NOT ${onceDaily} OR ${reports.payload}#>>'{agent,status}' IS DISTINCT FROM 'scheduled_for_later'), false)`,
      })
      .from(reports)
      .where(byKey);
    if (existing?.complete) {
      if (onceDaily && existing.agentStatus === "ready") {
        return { ...key, status: "existing" as const, commerceConfirmed: true, agentStatus: existing.agentStatus };
      }
      previousAgent = existing.agent;
      const ref = { dateFrom: addDaysToDateOnly(period.dateFrom, -7), dateTo: addDaysToDateOnly(period.dateTo, -7) };
      const [commerce, ga] = await Promise.all([
        readCommerceFreshness(client.id, client.commercePlatform).catch(() => null),
        readFunnel(client.id, period, ref, false).catch(() => null),
      ]);
      refresh = existing.dpaStatus === "blocked" || existing.dpaStatus === "pending" || reopenedSources({ commerceAt: existing.commerceAt, ga4: existing.ga4 ?? [] }, {
        commerceAt: hasClosedOrders(commerce, period.dateTo) ? commerce!.observedAt : null,
        ga4: [funnelFingerprint(ga?.current), funnelFingerprint(ga?.previous)],
      });
      if (!refresh) return {
        ...key,
        status: "existing" as const,
        commerceConfirmed: true,
        agentStatus: existing.agentStatus,
      };
    }
  }
  if (scheduled && client.commercePlatform === "NUVEMSHOP") await runProductCampaignCheck(client);
  const [monitor, prior, previousDaily, tracked, auditTrail, learned] = await Promise.all([
    readManagerProductMonitor(client),
    priorCommercialSnapshot(client.id, analysisDay),
    scheduled ? previousManagerFindings(client.id, analysisDay) : undefined,
    scheduled ? measureManagerFollowups(client, now).then(() => listManagerFollowups(client.id))
      .catch(() => null) : null,
    readManagerAuditTrail(client.id, now).catch(() => []),
    readManagerLongTermLessons(client.id, analysisDay).catch(() => []),
  ]);
  const result = await buildB2cReport(
    client,
    period,
    scheduled,
    analysisDay,
    monitor,
    prior,
    !(previousDaily?.payload.b2c as { media?: { perEntity?: unknown[] } } | undefined)?.media?.perEntity?.length,
  );
  const { overview, products, report } = result;
  const findings = result.findings;
  const previousFindings = previousDaily?.payload.findings as
    | ManagerFinding[]
    | undefined;
  const followThrough =
    previousFindings
      ?.filter(({ id }) => !id.startsWith("grade:"))
      .map(({ id, title }) => ({
        id,
        title,
        previousDay: previousDaily!.dateTo,
        status: findings.some((item) => item.id === id)
          ? "persistent"
          : "verify",
      })) ?? [];
  const sectorMemory = buildManagerSectorMemory(result, analysisDay, previousDaily?.payload);
  const checkoutVariant = report.cro.evaluation.checkoutDiagnosis?.targetVariantId;
  const shouldGenerate = !rulesOnly && (!scheduled || report.scope.commerceConfirmed);
  const selection = scheduled && shouldGenerate ? managerScheduledModel(report.media.roasReview.rows, findings) : undefined;
  const [agent, tested] = await Promise.all([
    shouldGenerate
      ? analyzeManagerWithOpenAI(result, findings, tracked ?? [], sectorMemory, learned, { existing: previousAgent, selection })
      : { status: rulesOnly ? "scheduled_for_later" as const : "waiting_for_orders" as const },
    checkoutVariant ? db.select({
      test: sql<Record<string, unknown>>`${archive.payload}->'checkoutTest'`,
    }).from(archive).where(and(
      eq(archive.clientId, client.id),
      eq(archive.dateFrom, period.dateFrom),
      eq(archive.dateTo, period.dateTo),
      sql`${archive.payload}#>>'{checkoutTest,result,shipping,variantId}' = ${checkoutVariant}`,
    )).orderBy(desc(archive.createdAt)).limit(1) : [],
    draftManagerClientUpdates(result, findings, { allowGeneration: shouldGenerate }),
  ]);
  const runId = randomUUID();
  const payload = {
    runId,
    trigger,
    findings,
    agent,
    metrics: overview.metrics,
    previous: overview.previous,
    previousPeriod: overview.previousPeriod,
    sources: {
      mediaAvailable: overview.mediaAvailable,
      stockObservedAt: products.stockObservedAt,
      productCampaignCheckedAt: monitor.checkedAt,
      productCampaignStale: monitor.stale,
    },
    b2c: { ...report, followThrough, tracked, sectorMemory },
    commercialSnapshot: result.snapshot,
    auditTrail,
    learned,
    ...(tested[0]?.test ? { checkoutTest: tested[0].test } : {}),
  };
  const stored = await db.transaction(async (tx) => {
    const [saved] = await tx
      .insert(reports)
      .values({ ...key, payload, createdAt: now })
      .onConflictDoUpdate({
        target: [
          reports.clientId,
          reports.analysisDay,
          reports.dateFrom,
          reports.dateTo,
        ],
        set: { payload, createdAt: now },
        setWhere: scheduled
          ? sql`(${refresh} OR ${reports.payload}->>'trigger' IS DISTINCT FROM 'scheduled' OR ${reports.payload}#>>'{b2c,scope,commerceConfirmed}' IS DISTINCT FROM 'true' OR
              ${reports.payload}#>>'{b2c,version}' IS DISTINCT FROM ${B2C_VERSION} OR
              (${agentConfigured} AND ${reports.payload}#>>'{agent,status}' IS DISTINCT FROM 'ready') OR
              (${onceDaily} AND ${reports.payload}#>>'{agent,status}' = 'scheduled_for_later')) AND ${reports.createdAt} <= ${now}`
          : sql`${reports.payload}->>'trigger' IS DISTINCT FROM 'scheduled' AND ${reports.createdAt} <= ${now}`,
      })
      .returning({ clientId: reports.clientId });
    if (scheduled && !saved) return false;
    await tx.insert(archive).values({
      ...key,
      runId,
      trigger,
      version: B2C_VERSION,
      payload,
      createdAt: now,
    });
    return true;
  });
  const { commercialSnapshot, ...publicPayload } = payload;
  return {
    ...key,
    payload: { runId: publicPayload.runId, trigger },
    agentStatus: agent.status,
    createdAt: now,
    status: stored ? ("saved" as const) : ("existing" as const),
    commerceConfirmed: report.scope.commerceConfirmed,
  };
}

async function runManagerBrandDaily(client: ManagerClient, now: Date) {
  const day = addDaysToDateOnly(saoPauloDateOnly(now), -1);
  const lock = await pool.connect();
  const lockKey = `up-manager:${client.id}:${day}`;
  let held = false;
  let broken = false;
  try {
    // A session lock prevents overlapping billable calls for one scheduled day.
    const claim = await lock.query<{ held: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS held",
      [lockKey],
    );
    held = claim.rows[0]?.held === true;
    if (!held) return { day, status: "running", failed: 0 };
    const analysisMode = managerScheduledAnalysisMode(now);
    const report = await saveManagerReport(
      client,
      { dateFrom: day, dateTo: day },
      {
        trigger: "scheduled",
        now,
        refresh: process.env.UP_MANAGER_REFRESH_DAILY === "1",
        analysisMode,
      },
    );
    const brain = await archiveManagerReports(client.id);
    const analysisComplete = analysisMode === "rules_only" || !managerAgentConfigured() || report.agentStatus === "ready";
    return {
      day,
      status: report.status,
      commerceConfirmed: report.commerceConfirmed,
      agentStatus: report.agentStatus,
      brain,
      failed: report.commerceConfirmed && analysisComplete && brain.status === "available" ? 0 : 1,
    };
  } finally {
    if (held)
      await lock
        .query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [lockKey])
        .catch(() => {
          broken = true;
        });
    lock.release(broken);
  }
}


export async function runUpManagerDaily(now = new Date(), onlyClientId?: string) {
  const ids = managerClientIds().filter((id) => !onlyClientId || id === onlyClientId);
  if (!ids.length) throw new Error("Nenhuma marca habilitada para o Up Manager diário.");
  const brands = [];
  for (const id of ids) {
    const client = await campaignClient(id).catch(() => undefined);
    if (!managerCommerceSupported(client)) {
      brands.push({ id, status: "unavailable", failed: 1 });
      continue;
    }
    const result = await runManagerBrandDaily(client, now).catch(() => ({ status: "failed", failed: 1 }));
    brands.push({ id, ...result });
  }
  return brands.length === 1 ? brands[0] : { brands, failed: brands.reduce((total, brand) => total + brand.failed, 0) };
}
