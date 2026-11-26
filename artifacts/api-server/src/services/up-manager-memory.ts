import type { DpaResult } from "./up-manager-dpa";
import { and, count, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db, upManagerAdActionsTable as actions, upManagerArchiveTable as archive } from "@workspace/db";
import { addDaysToDateOnly, saoPauloDateOnly, saoPauloDateOnlyStart } from "../lib/reporting-period";
import type { MediaLearning } from "./up-manager-media-learning";
import type { buildManagerSectorMemory } from "./up-manager-sector-memory";
import type { ManagerAudienceStudy } from "./up-manager-audience-study";
import type { PaidMediaReview } from "./up-manager-paid-media";

type Branch = "media" | "audiences" | "stock" | "funnel" | "sales" | "shipping" | "decisions" | "knowledge";
type Entry = { id: string; branch: Branch; title: string; date: string; source: string; summary: string; decision?: string; outcome?: string };
type Lesson = { key: string; day: string; subject: string; change: string; outcome: string };
type MediaMetric = { before: number | null; after: number | null; unit: string };
type Finding = { id: string; title: string; evidence?: string; action?: string; followUp?: string; focus?: string; section?: string };
type StoredPayload = {
  findings?: Finding[];
  agent?: { status?: string; model?: string; summary?: string; insights?: (Finding & { problem?: string; verification?: string })[] };
  b2c?: {
    clientName?: string; currency?: string; summary?: string; limitations?: string[];
    product?: { dpa?: DpaResult | null; scenarios?: { name?: string; label?: string; rate: number; revenue: number; mediaBudget: number | null }[] };
    media?: { learning?: MediaLearning; roasReview?: { audienceStudy?: ManagerAudienceStudy } & Partial<Pick<PaidMediaReview, "rows" | "agencyBenchmark">> };
    sectorMemory?: ReturnType<typeof buildManagerSectorMemory>;
    tracked?: { plan: { title: string; action: string; metric?: string; target?: number }; insightId: string; startedAt: string; measureOn: string;
      result?: { status: string; before: number | null; after: number | null; checkedAt: string; beforeWindow?: { dateFrom: string; dateTo: string }; afterWindow?: { dateFrom: string; dateTo: string } } | null }[];
  };
  checkoutTest?: { result?: { status: string; product: string; testedAt: string; steps?: { label: string; status: string; detail?: string }[] } };
  auditTrail?: Entry[];
  learned?: Lesson[];
};

const changes = {
  improved: "Melhorou", worsened: "Piorou", stable: "Estável", mixed: "Resultado misto",
  insufficient: "Dados insuficientes", maturing: "Em maturação", unavailable: "Sem base comparável",
} as const;
const sourceStatus = {
  meta: "Atividades da Meta consultadas",
  partial: "Atividades da Meta consultadas parcialmente",
  history: "Últimas atividades conhecidas da Meta",
  unavailable: "Atividades da Meta indisponíveis na leitura",
};
const integer = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const money = (value: number, currency: string) => new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
const label = ({ before, after, unit }: MediaMetric, currency: string) => {
  const show = (value: number | null) => {
    if (value === null) return "—";
    if (unit === "money" || unit === "cents") return money(unit === "cents" ? value / 100 : value, currency);
    if (unit === "percent") return `${integer.format(value * 100)}%`;
    if (unit === "ratio") return `${integer.format(value)}×`;
    return `${integer.format(value)}${unit === "days" ? " dias" : ""}`;
  };
  return `${show(before)} → ${show(after)}`;
};

function findingBranch(focus?: string): Branch {
  switch (focus) {
    case "campaigns": case "creatives": return "media";
    case "audiences": return "audiences";
    case "products": case "stock": return "stock";
    case "funnel": return "funnel";
    case "freight": return "shipping";
    case "acquisition": case "retention": case "revenue": return "sales";
    default: return "decisions";
  }
}

const sectors: Record<string, Branch> = { Campanhas: "media", Criativos: "media", Estoque: "stock",
  Comercial: "sales", Aquisição: "sales", Retenção: "sales", Funil: "funnel", Frete: "shipping", Públicos: "audiences" };

export async function readManagerAuditTrail(clientId: string, through: Date, days = 30): Promise<Entry[]> {
  const from = saoPauloDateOnlyStart(addDaysToDateOnly(saoPauloDateOnly(through), -days));
  const rows = await db.select({ id: actions.recommendationId, evidence: actions.evidence,
    status: actions.status, at: actions.updatedAt }).from(actions).where(and(eq(actions.clientId, clientId),
    gte(actions.updatedAt, from), lte(actions.updatedAt, through))).orderBy(desc(actions.updatedAt)).limit(180);
  return rows.flatMap(({ id, evidence, status, at }): Entry[] => {
    const date = at.toISOString();
    const base = { id: `up:${id}`, date, source: "UP Dash" };
    const state = status === "paused" || status === "applied" ? "Confirmado na Meta"
      : status === "uncertain" ? "Confirmação pendente" : status === "stale" ? "Revalidar" : "Processando";
    if ("kind" in evidence && evidence.kind === "dpa-removal") return [{ ...base, branch: "stock",
      title: `DPA · ${evidence.productName}`, summary: `${evidence.variants} variantes na solicitação de retirada do conjunto ${evidence.setId} · Grade sem saldo em ${evidence.outOfStock.join(", ")}`,
      outcome: state }];
    if ("kind" in evidence && evidence.kind === "audience-create") return [{ ...base, branch: "audiences", title: evidence.name,
      summary: evidence.audienceId ? `Público criado · ID ${evidence.audienceId}` : "Solicitação de criação de público", outcome: state }];
    if ("kind" in evidence && evidence.kind === "media-budget") {
      const currency = evidence.currency ?? "BRL";
      return [{ ...base, branch: "media", title: "Ajuste de orçamento",
        summary: [evidence.ownerLevel === "adset" ? "Conjunto" : "Campanha", evidence.ownerId ?? evidence.entityId,
          label({ before: evidence.before ?? null, after: evidence.after ?? null, unit: "cents" }, currency),
          evidence.field === "daily_budget" ? "por dia" : "no período"].join(" · "), outcome: state }];
    }
    if ("kind" in evidence && (evidence.kind === "media-pause" || evidence.kind === "media-reactivate")) return [{
      ...base, branch: "media", title: evidence.kind === "media-reactivate" ? "Reativação na Meta" : "Pausa na Meta",
      summary: `${{ campaign: "Campanha", adset: "Conjunto", ad: "Anúncio" }[evidence.entityLevel]} · ID ${evidence.entityId}`, outcome: state }];
    if ("adName" in evidence) return [{ ...base, branch: "media", title: evidence.adName,
      summary: "Pausa solicitada pelo gestor", outcome: state }];
    return [];
  });
}

export async function readBrainIndex(clientId: string, offset: number) {
  const [runs, metadata, audit] = await Promise.all([
    db.select({ id: archive.runId, day: archive.analysisDay, dateFrom: archive.dateFrom, dateTo: archive.dateTo,
      version: archive.version, trigger: archive.trigger, createdAt: archive.createdAt, archivedAt: archive.archivedAt,
      summary: sql<string | null>`coalesce(${archive.payload}#>>'{agent,summary}',${archive.payload}#>>'{b2c,summary}')` })
      .from(archive).where(eq(archive.clientId, clientId)).orderBy(desc(archive.createdAt), desc(archive.runId)).limit(21).offset(offset),
    db.select({ total: count(), oldest: sql<string | null>`min(${archive.dateFrom})`,
      archived: sql<number>`count(${archive.archivedAt})::int` }).from(archive).where(eq(archive.clientId, clientId)),
    offset === 0 ? readManagerAuditTrail(clientId, new Date(), 7).catch(() => []) : [],
  ]);
  return { runs: runs.slice(0, 20), nextOffset: runs.length > 20 ? offset + 20 : null, history: metadata[0], audit };
}

function buildBrainEntries(payload: StoredPayload, date: string, version: string) {
  const report = payload.b2c;
  const currency = report?.currency ?? "BRL";
  const entries: Entry[] = [];
  for (const finding of payload.findings ?? []) {
    entries.push({ id: `finding:${finding.id}`, branch: findingBranch(finding.focus ?? finding.section), date,
      title: finding.title, source: "Skill B2C", summary: finding.evidence ?? "", decision: finding.action, outcome: finding.followUp });
  }
  const roasReview = report?.media?.roasReview;
  for (const row of roasReview?.rows?.filter((item) => item.level === "campaign" && item.evaluation?.diagnosis).slice(0, 12) ?? []) {
    entries.push({ id: `campaign-diagnosis:${row.id}`, branch: "media", title: row.name, date, source: "Meta, GA4 e loja",
      summary: [row.driver, ...row.evaluation!.diagnosis!.factors.map(({ label, detail }) => `${label} · ${detail}`)].join("\n"),
      decision: row.action });
  }
  for (const row of roasReview?.rows ?? []) {
    const item = row.evaluation?.breakpoint;
    if (!item) continue;
    entries.push({ id: `break:${row.level}:${row.id}`, branch: "media", title: row.name, date: item.firstWeakPeriod,
      source: "Série diária Meta", summary: `Primeiro recuo sustentado observado no nível ${row.level}, ID ${row.id}.`,
      outcome: `ROAS ${label({ before: item.before.roas, after: item.after.roas, unit: "ratio" }, currency)} · ${item.before.dateFrom} a ${item.before.dateTo} → ${item.after.dateFrom} a ${item.after.dateTo}.` });
  }
  if (roasReview?.agencyBenchmark) {
    const { accounts, eligibleAccounts, medianRoas, window } = roasReview.agencyBenchmark;
    entries.push({ id: "agency-b2c-benchmark", branch: "media", title: "Referência agregada B2C da agência", date, source: "BigQuery",
      summary: `ROAS mediano de ${integer.format(medianRoas)}× em ${accounts} de ${eligibleAccounts} contas B2C elegíveis · ${window.dateFrom} a ${window.dateTo}.` });
  }
  for (const insight of payload.agent?.insights ?? []) {
    entries.push({ id: `agent:${insight.id}`, branch: findingBranch(insight.focus), date, title: insight.title,
      source: payload.agent?.model ?? "UP Agent", summary: insight.problem ?? "", decision: insight.action, outcome: insight.verification });
  }

  const media = report?.media?.learning;
  const lessons = new Map(media?.lessons.map((lesson) => [`${lesson.level}:${lesson.id}:${lesson.changedAt}:${lesson.title}`, lesson]));
  for (const event of media?.events ?? []) {
    const id = `${event.level}:${event.id}:${event.changedAt}:${event.title}`;
    const lesson = lessons.get(id);
    const impact = lesson && lesson.before && lesson.after
      ? `ROAS ${label({ before: lesson.before.roas, after: lesson.after.roas, unit: "ratio" }, currency)} · ${lesson.before.purchases} → ${lesson.after.purchases} compras. ` : "";
    entries.push({ id: `meta:${id}`, branch: event.title.toLowerCase().includes("público") ? "audiences" : "media",
      date: event.changedAt, title: event.name, source: event.source === "updash" ? "UP Dash" : "Atividade da Meta",
      summary: [event.title, event.detail].filter(Boolean).join(" · "),
      outcome: lesson ? `${changes[lesson.status]} · ${impact}${lesson.description}` : undefined });
  }
  for (const event of report?.sectorMemory?.events ?? []) {
    if (event.source === "meta") continue;
    entries.push({ id: event.id, branch: sectors[event.sector] ?? "decisions", date: event.day,
      title: event.subject, source: event.source === "freight" ? "Pedidos pagos" : event.source === "braavo" ? "Braavo" : "Nuvemshop", summary: event.detail,
      outcome: event.result ? `Saldo observado em ${event.result.observedOn} · ${integer.format(event.result.stock)} un.` : undefined });
  }
  for (const item of report?.sectorMemory?.campaignImpacts ?? []) {
    entries.push({ id: item.id, branch: "media", title: item.campaign, date: item.day, source: "Meta Ads e loja",
      summary: [item.leading && "Curva A", item.change].filter(Boolean).join(" · "),
      decision: "Acompanhar o desempenho e o contexto após a mudança observada.",
      outcome: item.before && item.after
        ? `ROAS ${label({ before: item.before.roas, after: item.after.roas, unit: "ratio" }, currency)} · ${item.before.purchases} → ${item.after.purchases} compras. ${item.before.period.dateFrom} a ${item.before.period.dateTo} → ${item.after.period.dateFrom} a ${item.after.period.dateTo}. Associação temporal.`
        : "Aguardando uma janela fechada de sete dias após a mudança com atribuição madura." });
  }
  for (const [index, measure] of (report?.sectorMemory?.measures ?? []).entries()) {
    entries.push({ id: `measure:${index}`, branch: sectors[measure.sector] ?? "decisions", title: `${measure.subject} · ${measure.metric}`,
      date, source: "Métricas observadas", summary: `${changes[measure.direction]} · ${label(measure, currency)}`, outcome: measure.context });
  }
  const audiences = report?.media?.roasReview?.audienceStudy;
  for (const item of audiences?.recommendations ?? []) {
    entries.push({ id: `audience:${item.id}`, branch: "audiences", title: item.title, date,
      source: "Meta Ads + Up Manager", summary: item.evidence, decision: item.test });
  }
  for (const [index, item] of (audiences?.segments ?? []).entries()) {
    entries.push({ id: `segment:${index}`, branch: "audiences", title: item.label, date, source: "Meta Ads",
      summary: `${item.current.purchases} compras · ROAS ${item.current.roas == null ? "—" : integer.format(item.current.roas)}× · ${money(item.current.spend, currency)} investidos`,
      outcome: item.previous ? `ROAS ${label({ before: item.previous.roas, after: item.current.roas, unit: "ratio" }, currency)}` : undefined });
  }
  for (const tracked of report?.tracked ?? []) {
    entries.push({ id: `followup:${tracked.insightId}:${tracked.startedAt}`, branch: "decisions", title: tracked.plan.title,
      date: tracked.result?.checkedAt ?? tracked.startedAt, source: "Acompanhamento", summary: tracked.plan.action,
      decision: tracked.plan.metric ? `Indicador ${tracked.plan.metric} · meta ${tracked.plan.target ?? "—"} · reavaliar em ${tracked.measureOn}` : undefined,
      outcome: tracked.result ? [changes[tracked.result.status as keyof typeof changes],
        `${tracked.result.before ?? "—"} → ${tracked.result.after ?? "—"}`,
        tracked.result.beforeWindow && tracked.result.afterWindow
          ? `${tracked.result.beforeWindow.dateFrom} a ${tracked.result.beforeWindow.dateTo} → ${tracked.result.afterWindow.dateFrom} a ${tracked.result.afterWindow.dateTo}` : null,
      ].filter(Boolean).join(" · ") : `Medição prevista para ${tracked.measureOn}` });
  }
  const checkout = payload.checkoutTest?.result;
  if (checkout?.testedAt && checkout.product) {
    entries.push({ id: `checkout:${checkout.testedAt}`, branch: "decisions", title: "Teste de carrinho, frete e checkout",
      date: checkout.testedAt, source: "Teste do Up Manager", summary: checkout.product,
      outcome: checkout.steps?.map(({ label, detail }) => [label, detail].filter(Boolean).join(" · ")).join(" | ") || undefined });
  }
  const dpa = report?.product?.dpa;
  if (dpa) {
    const dpaStatus = { preview: "Simulação", applied: "Confirmado na Meta", unchanged: "Sem alteração",
      blocked: "Bloqueado", pending: "Confirmação pendente" }[dpa.status];
    entries.push({ id: "meta-dpa", branch: "stock", title: "Conjunto de produtos DPA", date: dpa.checkedAt, source: "Meta e estoque da loja",
      summary: dpa.eligible === undefined ? dpaStatus : `${dpaStatus} · ${dpa.current ?? 0} → ${dpa.eligible} variantes no conjunto · ${dpa.gradeExcluded?.length ?? 0} produtos fora por grade ou publicação.`,
      outcome: [dpa.detail, ...(dpa.additions ?? []).slice(0, 8).map(item => `Entrada: ${item.product}`),
        ...(dpa.exclusions ?? []).slice(0, 8).map(item => `Saída: ${item.product} (${item.reason})`)].filter(Boolean).join(" · ") || undefined });
  }
  for (const scenario of report?.product?.scenarios ?? []) {
    const name = scenario.name ?? scenario.label;
    if (!name || !Number.isFinite(scenario.revenue) || !Number.isFinite(scenario.rate)) continue;
    entries.push({ id: `forecast:${name}`, branch: "sales", title: `Cenário ${name.toLowerCase()}`, date,
      source: "Projeção da skill B2C", summary: `${money(scenario.revenue, currency)} de receita estimada com realização de ${integer.format(scenario.rate * 100)}% do estoque precificado.`,
      outcome: "Estimativa condicionada à realização do estoque." });
  }
  for (const lesson of payload.learned ?? []) {
    entries.push({ id: `learned:${lesson.key}`, branch: "knowledge", title: lesson.subject, date: lesson.day, source: "Memória recuperada",
      summary: lesson.change, outcome: lesson.outcome });
  }
  if (payload.agent?.summary || report?.summary) {
    entries.push({ id: "skill", branch: "knowledge", title: `Skill B2C · ${version}`, date, source: payload.agent?.model ?? "Up Manager",
      summary: payload.agent?.summary ?? report?.summary ?? "", outcome: media ? sourceStatus[media.source] : undefined });
  }
  for (const [index, limitation] of (report?.limitations ?? []).entries()) {
    entries.push({ id: `coverage:${index}`, branch: "knowledge", title: "Cobertura das fontes", date,
      source: "Up Manager", summary: limitation });
  }
  return [...payload.auditTrail ?? [], ...entries].sort((a, b) => b.date.localeCompare(a.date));
}

export async function readBrainRun(clientId: string, runId: string) {
  const [row] = await db.select({ id: archive.runId, date: archive.dateTo, version: archive.version,
    archivedAt: archive.archivedAt, payload: sql<StoredPayload>`${archive.payload} - 'commercialSnapshot'` })
    .from(archive).where(and(eq(archive.clientId, clientId), eq(archive.runId, runId)));
  if (!row) return null;
  return { id: row.id, date: row.date, version: row.version, archivedAt: row.archivedAt,
    currency: row.payload.b2c?.currency, brand: row.payload.b2c?.clientName,
    coverage: row.payload.b2c?.media?.learning?.source,
    entries: buildBrainEntries(row.payload, row.date, row.version) };
}

export async function readManagerLongTermLessons(clientId: string, day: string) {
  const rows = await db.selectDistinctOn([archive.analysisDay], {
    lessons: sql<MediaLearning["lessons"] | null>`${archive.payload}#>'{b2c,media,learning,lessons}'`,
    campaignImpacts: sql<ReturnType<typeof buildManagerSectorMemory>["campaignImpacts"] | null>`${archive.payload}#>'{b2c,sectorMemory,campaignImpacts}'`,
    tracked: sql<NonNullable<StoredPayload["b2c"]>["tracked"]>`${archive.payload}#>'{b2c,tracked}'`,
  }).from(archive).where(and(eq(archive.clientId, clientId), eq(archive.trigger, "scheduled"),
    gte(archive.analysisDay, addDaysToDateOnly(day, -180)), sql`${archive.analysisDay} < ${day}`))
    .orderBy(desc(archive.analysisDay), desc(archive.createdAt)).limit(180);
  const unique = new Map<string, Lesson>();
  for (const { lessons, tracked, campaignImpacts } of rows) {
    for (const item of campaignImpacts ?? []) {
      if (!item.before || !item.after) continue;
      const key = `observed:${item.id}`;
      if (!unique.has(key)) unique.set(key, { key, day: item.day, subject: item.campaign,
        change: [item.leading && "Curva A", item.change].filter(Boolean).join(" · "),
        outcome: `ROAS ${integer.format(item.before.roas)}× → ${integer.format(item.after.roas)}× · ${item.before.purchases} → ${item.after.purchases} compras. Associação temporal em períodos fechados.` });
    }
    for (const lesson of lessons ?? []) {
      if (!["improved", "worsened", "stable"].includes(lesson.status) || lesson.before?.roas == null || lesson.after?.roas == null) continue;
      const key = `meta:${lesson.id}:${lesson.changedAt}`;
      if (!unique.has(key)) unique.set(key, { key, day: lesson.day, subject: lesson.name, change: lesson.title,
        outcome: `${changes[lesson.status]} · ROAS ${integer.format(lesson.before.roas)}× → ${integer.format(lesson.after.roas)}×. ${lesson.description}` });
    }
    for (const item of tracked ?? []) {
      if (!item.result || !["improved", "worsened", "stable"].includes(item.result.status)) continue;
      const key = `followup:${item.insightId}:${item.startedAt}`;
      if (!unique.has(key)) unique.set(key, { key, day: item.result.checkedAt.slice(0, 10),
        subject: item.plan.title, change: item.plan.action,
        outcome: `${changes[item.result.status as keyof typeof changes]} · ${item.result.before ?? "—"} → ${item.result.after ?? "—"}` });
    }
  }
  return [...unique.values()].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 30);
}
