import { db, upManagerArchiveTable as archive, upManagerAdActionsTable as actions } from "@workspace/db";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { EntityDay } from "./up-manager-timeline";
import { z } from "zod";
import { addDaysToDateOnly, saoPauloDateOnly, saoPauloDateOnlyStart } from "../lib/reporting-period";
import { normalizeMetaAdAccountId } from "./meta-ads";
import { fetchMetaGraph } from "./meta-graph";
import { managerMetaToken, readMedia, type ManagerClient, type ManagerPeriod } from "./up-manager";
import { buildPaidMediaReview, type MediaLevel, type PaidMediaReview, type PaidMediaRow } from "./up-manager-paid-media";

const mediaEvents = {
  create_campaign: ["campaign", "Campanha criada"],
  update_campaign_name: ["campaign", "Nome da campanha alterado"],
  create_ad_set: ["adset", "Conjunto criado"],
  update_ad_set_name: ["adset", "Nome do conjunto alterado"],
  update_ad_set_duration: ["adset", "Programação do conjunto alterada"],
  create_ad: ["ad", "Anúncio criado"],
  update_ad_friendly_name: ["ad", "Nome do anúncio alterado"],
  ad_review_approved: ["ad", "Anúncio aprovado na Meta"],
  ad_review_declined: ["ad", "Anúncio recusado na Meta"],
  create_audience: ["audience", "Público criado"],
  delete_audience: ["audience", "Público excluído"],
  update_campaign_budget: ["campaign", "Alteração de orçamento"],
  update_campaign_group_budget: ["campaign", "Alteração de orçamento"],
  update_campaign_run_status: ["campaign", "Alteração de veiculação"],
  update_campaign_group_run_status: ["campaign", "Alteração de veiculação"],
  update_ad_set_budget: ["adset", "Alteração de orçamento"],
  update_ad_set_target_spec: ["adset", "Alteração de público"],
  update_ad_set_bid_strategy: ["adset", "Alteração de lance"],
  update_ad_set_bidding: ["adset", "Alteração de lance"],
  update_ad_set_optimization_goal: ["adset", "Alteração de otimização"],
  update_ad_set_run_status: ["adset", "Alteração de veiculação"],
  update_ad_creative: ["ad", "Alteração de criativo"],
  update_ad_run_status: ["ad", "Alteração de veiculação"],
  update_adgroup_run_status: ["ad", "Alteração de veiculação"],
} as const satisfies Record<string, readonly [MediaLevel | "audience", string]>;

type MediaEvent = { id: string; level: MediaLevel | "audience"; changedAt: string; day: string; title: string; name: string; detail?: string; source?: "updash"; family?: "budget" | "status" };
type OutcomePoint = { window: ManagerPeriod; roas: number | null; purchases: number; spend: number };
export type MediaLesson = MediaEvent & {
  before: OutcomePoint | null;
  after: OutcomePoint | null;
  status: "maturing" | "insufficient" | "improved" | "worsened" | "mixed" | "stable";
  description: string;
};
type MediaChangeFeed = { events: MediaEvent[]; partial: boolean };
export type MediaLearning = {
  source: "meta" | "partial" | "history" | "unavailable";
  lessons: MediaLesson[];
  pending: MediaEvent[];
  events: MediaEvent[];
};

function uniqueChanges(events: MediaEvent[]) {
  const unique = new Map<string, MediaEvent>();
  for (const event of [...events].sort((a, b) => b.changedAt.localeCompare(a.changedAt))) {
    const key = `${event.level}:${event.id}:${event.changedAt}:${event.title}`;
    if (!unique.has(key) || (!unique.get(key)?.detail && event.detail)) unique.set(key, event);
  }
  return [...unique.values()];
}

const eventSchema = z.object({
  object_id: z.string().regex(/^\d+$/),
  object_name: z.string().optional().nullable(),
  event_type: z.string(),
  event_time: z.string(),
  extra_data: z.unknown().optional(),
});

export function managerActivityDetail(type: string, value: unknown, currency: string) {
  let raw = value;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { return undefined; }
  }
  if (!raw || typeof raw !== "object") return undefined;
  const { old_value: before, new_value: after } = raw as { old_value?: unknown; new_value?: unknown };
  if (type.includes("budget")) {
    if (!before || !after || typeof before !== "object" || typeof after !== "object") return undefined;
    const old = before as { old_value?: unknown; currency?: string; type?: string };
    const next = after as { new_value?: unknown; currency?: string; type?: string };
    const amount = (input: unknown) => (typeof input === "string" || typeof input === "number") && /^\d{1,14}$/.test(String(input)) ? Number(input) : null;
    const a = amount(old.old_value);
    const b = amount(next.new_value);
    if (a === null || b === null || old.currency !== currency || next.currency !== currency) return undefined;
    const format = new Intl.NumberFormat("pt-BR", { style: "currency", currency });
    const divisor = 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2);
    return `${format.format(a / divisor)} → ${format.format(b / divisor)}`;
  }
  if (type.includes("run_status") && typeof before === "string" && typeof after === "string" &&
    /^[\p{L} _-]{1,40}$/u.test(before) && /^[\p{L} _-]{1,40}$/u.test(after)) return `${before} → ${after}`;
  return undefined;
}

export async function readPaidMediaChanges(client: ManagerClient, analysisDay: string): Promise<MediaChangeFeed | null> {
  const token = managerMetaToken(client);
  if (!token || !client.accountId) return null;
  const account = normalizeMetaAdAccountId(client.accountId);
  type GraphPage = { data?: unknown[]; paging?: { next?: string } };
  const cutoff = (days: number) => String(saoPauloDateOnlyStart(addDaysToDateOnly(analysisDay, -days)).getTime() / 1000);
  const load = async (since: string, until?: string) => {
    const version = process.env.META_GRAPH_VERSION ?? "v24.0";
    const path = `/${version}/${account}/activities`;
    let next: string | undefined = `https://graph.facebook.com${path}?${new URLSearchParams({
      access_token: token, fields: "event_type,event_time,object_id,object_name,extra_data", since,
      ...(until ? { until } : {}), limit: "100",
    })}`;
    const rows: unknown[] = [];
    let complete = false;
    let read = false;
    for (let page = 0; next && page < 3; page++) {
      if (!URL.canParse(next)) break;
      const url: URL = new URL(next);
      if (url.origin !== "https://graph.facebook.com" || url.pathname !== path) break;
      const result: GraphPage | null = await fetchMetaGraph<GraphPage>(url.toString(), 5 * 60_000).catch(() => null);
      if (!Array.isArray(result?.data)) break;
      rows.push(...result.data);
      next = result.paging?.next;
      read = true;
      complete = !next;
    }
    return { rows, read, complete };
  };
  const parts = await Promise.all([
    load(cutoff(2)), load(cutoff(9), cutoff(2)), load(cutoff(19), cutoff(9)), load(cutoff(30), cutoff(19)),
  ]);
  if (!parts.some(({ read }) => read)) return null;
  const events = parts.flatMap(({ rows }) => rows.flatMap((raw): MediaEvent[] => {
    const checked = eventSchema.safeParse(raw);
    if (!checked.success) return [];
    const event = checked.data;
    const kind = Object.hasOwn(mediaEvents, event.event_type) ? mediaEvents[event.event_type as keyof typeof mediaEvents] : null;
    const date = new Date(event.event_time);
    if (!kind || !Number.isFinite(date.getTime())) return [];
    return [{
      id: event.object_id, level: kind[0], title: kind[1], name: event.object_name?.trim() || event.object_id,
      changedAt: date.toISOString(), day: saoPauloDateOnly(date),
      detail: managerActivityDetail(event.event_type, event.extra_data, client.currency),
    }];
  }));
  return { events: uniqueChanges(events), partial: parts.some(({ complete }) => !complete) };
}

export async function readAppliedManagerMediaChanges(clientId: string, day: string): Promise<MediaEvent[]> {
  const rows = await db.select({ evidence: actions.evidence, updatedAt: actions.updatedAt }).from(actions)
    .where(and(eq(actions.clientId, clientId), gte(actions.updatedAt, saoPauloDateOnlyStart(addDaysToDateOnly(day, -30))),
      sql`${actions.status} IN ('applied','paused')`)).orderBy(desc(actions.updatedAt)).limit(100);
  return rows.flatMap(({ evidence, updatedAt }): MediaEvent[] => {
    if (!("kind" in evidence)) return [];
    const base = { day: saoPauloDateOnly(updatedAt), changedAt: updatedAt.toISOString(), source: "updash" as const };
    if (evidence.kind === "media-budget") {
      if (!evidence.ownerId || !evidence.ownerLevel) return [];
      const format = new Intl.NumberFormat("pt-BR", { style: "currency", currency: evidence.currency ?? "BRL" });
      const before = evidence.before, after = evidence.after;
      return [{ ...base, id: evidence.ownerId, level: evidence.ownerLevel, name: evidence.ownerId, family: "budget",
        title: "Aumento de orçamento confirmado", detail: before != null && after != null ? `${format.format(before / 100)} → ${format.format(after / 100)}` : undefined }];
    }
    if (evidence.kind === "media-pause" || evidence.kind === "media-reactivate") {
      return [{ ...base, id: evidence.entityId, level: evidence.entityLevel, name: evidence.entityId, family: "status",
        title: evidence.kind === "media-pause" ? "Pausa confirmada" : "Reativação confirmada" }];
    }
    if (evidence.kind === "grade-stock" || evidence.kind === "creative-performance") {
      return [{ ...base, id: evidence.adId, level: "ad", name: evidence.adName, family: "status",
        title: evidence.kind === "grade-stock" ? "Pausa por estoque confirmada" : "Pausa de criativo confirmada" }];
    }
    return [];
  });
}

export async function readPaidMediaHistory(clientId: string, analysisDay: string) {
  const value = sql`${archive.payload}#>'{b2c,media,roasReview}'`;
  const rows = await db.selectDistinctOn([archive.dateTo], {
    review: sql<PaidMediaReview>`${value}`,
    perEntity: sql<EntityDay[] | null>`${archive.payload}#>'{b2c,media,perEntity}'`,
    seeded: sql<PaidMediaReview[] | null>`${archive.payload}#>'{b2c,media,learningWindows}'`,
  })
    .from(archive)
    .where(and(
      eq(archive.clientId, clientId), eq(archive.trigger, "scheduled"),
      gte(archive.dateTo, addDaysToDateOnly(analysisDay, -48)), lte(archive.dateTo, analysisDay),
      sql`${value}->>'available' = 'true'`,
    ))
    .orderBy(desc(archive.dateTo), desc(archive.createdAt))
    .limit(48);
  const memory = sql`${archive.payload}#>'{b2c,media,learning}'`;
  const [last] = await db.select({
    events: sql<MediaEvent[] | null>`${memory}->'events'`,
    lessons: sql<MediaLesson[] | null>`${memory}->'lessons'`,
  }).from(archive).where(and(eq(archive.clientId, clientId), eq(archive.trigger, "scheduled"),
    sql`${memory}->>'source' IN ('meta', 'partial', 'history')`,
  )).orderBy(desc(archive.createdAt)).limit(1);
  return {
    reviews: rows.map(({ review }) => review),
    perEntity: rows.flatMap(({ perEntity }) => perEntity ?? []),
    seeded: rows.find(({ seeded }) => seeded?.length)?.seeded ?? [],
    events: last?.events ?? last?.lessons?.map(({ id, level, changedAt, day, title, name, detail }) =>
      ({ id, level, changedAt, day, title, name, detail })) ?? [],
  };
}

export function combinePaidMediaChanges(
  feed: MediaChangeFeed | null, stored: MediaEvent[], analysisDay: string, confirmed: MediaEvent[] = [],
) {
  const cutoff = addDaysToDateOnly(analysisDay, -30);
  const isSameExternalEvent = (candidate: MediaEvent) => !candidate.source && confirmed.some(action =>
    action.id === candidate.id && action.level === candidate.level &&
    (action.family === "budget" ? candidate.title === "Alteração de orçamento" : candidate.title === "Alteração de veiculação") &&
    Math.abs(Date.parse(action.changedAt) - Date.parse(candidate.changedAt)) <= 10 * 60_000);
  const events = uniqueChanges([...confirmed, ...(feed?.events ?? []), ...stored])
    .filter(event => event.day >= cutoff && !isSameExternalEvent(event));
  return {
    events,
    source: feed ? feed.partial ? "partial" as const : "meta" as const
      : events.length ? "history" as const : "unavailable" as const,
  };
}

/** Seed the first comparisons from a relevant mature adjustment without waiting for two weeks of snapshots. */
export async function seedPaidMediaHistory(
  client: ManagerClient,
  events: MediaEvent[] | null,
  current: PaidMediaReview,
  history: Awaited<ReturnType<typeof readPaidMediaHistory>>,
) {
  if (history.seeded.length) return history.seeded;
  if (!current.available || !events?.length || history.reviews.length >= 14) return [];
  const present = new Map(current.rows.map((row) => [`${row.level}:${row.id}`, row]));
  const candidates = events.filter((event) =>
    event.day <= addDaysToDateOnly(current.window.dateTo, -7) &&
    event.day >= addDaysToDateOnly(current.window.dateTo, -25) &&
    (present.get(`${event.level}:${event.id}`)?.spending.purchases ?? 0) >= 3);
  const overlaps = (event: MediaEvent) => events.filter((other) => other !== event &&
    event.level === other.level && event.id === other.id &&
    other.day >= addDaysToDateOnly(event.day, -7) && other.day <= addDaysToDateOnly(event.day, 7),
  ).length;
  const candidate = [...candidates].sort((a, b) =>
    overlaps(a) - overlaps(b) || Number(a.title.includes("veiculação")) - Number(b.title.includes("veiculação")) ||
    (present.get(`${b.level}:${b.id}`)?.spending.spend ?? 0) - (present.get(`${a.level}:${a.id}`)?.spending.spend ?? 0),
  )[0];
  if (!candidate) return [];
  const windows = [
    { dateFrom: addDaysToDateOnly(candidate.day, -7), dateTo: addDaysToDateOnly(candidate.day, -1) },
    { dateFrom: addDaysToDateOnly(candidate.day, 1), dateTo: addDaysToDateOnly(candidate.day, 7) },
  ];
  const snapshots = await Promise.all(windows.map(async (window) => {
    const source = await readMedia(client, window);
    return buildPaidMediaReview({
      current: source, previous: null, snapshot: null, currency: client.currency,
      window, previousWindow: { dateFrom: addDaysToDateOnly(window.dateFrom, -7), dateTo: addDaysToDateOnly(window.dateTo, -7) },
    });
  }));
  return snapshots.every(({ available }) => available) ? snapshots : [];
}

function point(review: PaidMediaReview | undefined, row: PaidMediaRow | undefined): OutcomePoint | null {
  if (!review || !row) return null;
  return { window: review.window, roas: row.roas, purchases: row.spending.purchases, spend: row.spending.spend };
}

export function evaluatePaidMediaChanges(
  events: MediaEvent[] | null,
  current: PaidMediaReview,
  history: PaidMediaReview[],
  source: MediaLearning["source"] = "meta",
  daily: EntityDay[] = [],
): MediaLearning {
  if (events === null) return { source: "unavailable", lessons: [], pending: [], events: [] };
  const snapshots = [current, ...history].filter(({ available }) => available)
    .sort((a, b) => a.window.dateTo.localeCompare(b.window.dateTo));
  const known = new Set(snapshots.flatMap(({ rows }) => rows.map(({ level, id }) => `${level}:${id}`)));
  const relevant = events.filter(({ level, id, source }) => source === "updash" || known.has(`${level}:${id}`));
  const series = new Map<string, Map<string, EntityDay>>();
  for (const row of daily) {
    const key = `${row.level}:${row.id}`;
    const group = series.get(key) ?? new Map<string, EntityDay>();
    group.set(row.date, row);
    series.set(key, group);
  }
  const evaluated = relevant.map((event): MediaLesson => {
    const same = (row: PaidMediaRow) => row.id === event.id && row.level === event.level;
    const beforeWin = [...snapshots].reverse().find((item) =>
      item.window.dateTo < event.day && item.window.dateTo >= addDaysToDateOnly(event.day, -7) && item.rows.some(same),
    );
    const afterWin = snapshots.find((item) =>
      item.window.dateFrom > event.day && item.window.dateFrom <= addDaysToDateOnly(event.day, 7),
    );
    const values = series.get(`${event.level}:${event.id}`);
    function dailyWindow(first: number) {
      const dates = Array.from({ length: 7 }, (_, i) => addDaysToDateOnly(event.day, first + i));
      const rows = dates.flatMap(date => values?.get(date) ?? []);
      if (rows.length !== dates.length) return null;
      const spend = rows.reduce((sum, row) => sum + row.spend, 0);
      const revenue = rows.reduce((sum, row) => sum + row.revenue, 0);
      return { window: { dateFrom: dates[0], dateTo: dates.at(-1)! }, spend,
        purchases: rows.reduce((sum, row) => sum + row.purchases, 0),
        roas: spend > 0 && rows.every(({ roas }) => roas != null) ? revenue / spend : null };
    }
    const before = dailyWindow(-7) ?? point(beforeWin, beforeWin?.rows.find(same));
    const after = dailyWindow(1) ?? point(afterWin, afterWin?.rows.find(same));
    const recentName = current.rows.find(same)?.name ?? values?.values().next().value?.name;
    const base = { ...event, name: event.name === event.id ? recentName ?? event.name : event.name, before, after };
    if (current.window.dateTo < addDaysToDateOnly(event.day, 7)) {
      return { ...base, status: "maturing", description: "Aguardando sete dias fechados depois da mudança e a maturação da atribuição." };
    }
    if (before?.roas == null || after?.roas == null || Math.min(before.purchases, after.purchases) < 3) {
      return { ...base, status: "insufficient", description: "A comparação precisa de janelas de sete dias com compra atribuída suficiente antes e depois." };
    }
    const overlapped = relevant.some((other) => other !== event && other.id === event.id && other.level === event.level &&
      other.day >= before.window.dateFrom && other.day <= after.window.dateTo);
    const movement = before.roas > 0 ? after.roas / before.roas - 1 : 0;
    const lowerVolume = after.purchases < before.purchases * 0.8;
    if (overlapped || (movement >= 0.1 && lowerVolume)) {
      return { ...base, status: "mixed", description: overlapped
        ? "Outras mudanças no mesmo item ocorreram na janela de medição."
        : "O ROAS subiu e o volume de compras caiu no período pós-ajuste." };
    }
    if (movement >= 0.1) return { ...base, status: "improved", description: "O ROAS observado subiu nas janelas comparadas após o ajuste." };
    if (movement <= -0.1) return { ...base, status: "worsened", description: "O ROAS observado caiu nas janelas comparadas após o ajuste." };
    return { ...base, status: "stable", description: "O ROAS variou menos de 10% nas janelas comparadas." };
  });
  const pending = relevant.filter((event) => current.window.dateTo < addDaysToDateOnly(event.day, 7));
  const measured = evaluated.filter(({ status }) => !["maturing", "insufficient"].includes(status)).slice(0, 15);
  const recent = evaluated.filter(({ status }) => status === "maturing").slice(0, 15);
  const insufficient = evaluated.filter(({ status }) => status === "insufficient").slice(0, 5);
  return { source, lessons: [...measured, ...recent, ...insufficient], pending, events };
}
