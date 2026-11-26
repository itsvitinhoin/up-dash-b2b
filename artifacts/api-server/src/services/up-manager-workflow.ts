import { db, upManagerArchiveTable as archive, upManagerFollowupsTable as followups,
  upManagerWeeklyGoalsTable as weeklyGoals } from "@workspace/db";
import { and, asc, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { addDaysToDateOnly, saoPauloDateOnly, saoPauloDateOnlyStart } from "../lib/reporting-period";
import { hasClosedOrders } from "./up-manager-source-readiness";
import { readCommerceFreshness, readFunnel } from "./up-manager-b2c-data";
import { readManagerOverview, readMedia, type ManagerClient, type ManagerPeriod } from "./up-manager";
import type { decideManagerCampaigns } from "./up-manager-campaign-decisions";
import type { PaidMediaReview } from "./up-manager-paid-media";
import type { buildCreativeReview } from "./up-manager-creatives";

const metrics = ["revenue", "purchases", "roas", "cac", "checkout", "repeat"] as const;
type Metric = (typeof metrics)[number];
type Followup = typeof followups.$inferSelect;
type Goals = typeof weeklyGoals.$inferInsert.goals;
const publicFollowups = {
  runId: followups.runId, insightId: followups.insightId, startedAt: followups.startedAt,
  measureOn: followups.measureOn, plan: followups.plan, result: followups.result,
};
export const startFollowupSchema = z.object({
  insightId: z.string().regex(/^[a-zA-Z0-9:_-]{1,160}$/),
  metric: z.enum(metrics),
  target: z.number().positive().max(1_000_000_000),
  note: z.string().trim().min(3).max(500),
}).superRefine(({ metric, target }, ctx) => {
  if ((metric === "checkout" || metric === "repeat") && target > 100)
    ctx.addIssue({ code: "custom", path: ["target"], message: "A meta percentual deve estar entre 0 e 100." });
  if (metric === "purchases" && !Number.isInteger(target))
    ctx.addIssue({ code: "custom", path: ["target"], message: "Informe um número inteiro de compras." });
});
export const managerWeeklyGoalsSchema = z.object({
  spendCap: z.number().positive().max(100_000_000).nullable(),
  targetCpa: z.number().positive().max(100_000).nullable(),
  targetRoas: z.number().positive().max(1_000).nullable(),
  context: z.string().trim().max(700),
});
const emptyGoals: Goals = { spendCap: null, targetCpa: null, targetRoas: null, context: "" };

export function managerWeek(day: string): ManagerPeriod {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  const monday = addDaysToDateOnly(day, -((weekday + 6) % 7));
  return { dateFrom: monday, dateTo: addDaysToDateOnly(monday, 6) };
}

export function followupWindows(day: string) {
  const before = { dateFrom: addDaysToDateOnly(day, -7), dateTo: addDaysToDateOnly(day, -1) };
  const after = { dateFrom: addDaysToDateOnly(day, 1), dateTo: addDaysToDateOnly(day, 7) };
  return { before, after, measureOn: addDaysToDateOnly(after.dateTo, 4) };
}

export async function listManagerFollowups(clientId: string) {
  return db.select(publicFollowups).from(followups).where(eq(followups.clientId, clientId))
    .orderBy(desc(followups.startedAt)).limit(60);
}

export async function startManagerFollowup(
  clientId: string, runId: string, actorUserId: string, input: z.infer<typeof startFollowupSchema>, now = new Date(),
) {
  const [row] = await db.select({ payload: archive.payload }).from(archive)
    .where(and(eq(archive.clientId, clientId), eq(archive.runId, runId)));
  type Insight = { id: string; title: string; action: string; evidence?: string; hypothesis?: string; problem?: string };
  const findings = row?.payload.findings as Insight[] | undefined;
  const agent = row?.payload.agent as { insights?: Insight[] } | undefined;
  const finding = findings?.find(({ id }) => id === input.insightId) ?? agent?.insights?.find(({ id }) => id === input.insightId);
  if (!finding?.title || !finding.action) return null;
  const guard = and(eq(followups.clientId, clientId), eq(followups.runId, runId), eq(followups.insightId, input.insightId));
  const { measureOn } = followupWindows(saoPauloDateOnly(now));
  const [saved] = await db.insert(followups).values({
    clientId, runId, insightId: input.insightId, actorUserId, startedAt: now, measureOn,
    plan: { title: finding.title, action: finding.action, expectation: finding.hypothesis ?? finding.evidence ?? finding.problem ?? finding.action,
      note: input.note, metric: input.metric, target: input.target },
  }).onConflictDoNothing().returning(publicFollowups);
  if (saved) return saved;
  const [previous] = await db.select(publicFollowups).from(followups).where(guard);
  return previous ?? null;
}

export async function readManagerWeeklyGoals(clientId: string, now = new Date()) {
  const week = managerWeek(saoPauloDateOnly(now));
  const [row] = await db.select({ goals: weeklyGoals.goals }).from(weeklyGoals)
    .where(and(eq(weeklyGoals.clientId, clientId), eq(weeklyGoals.weekStart, week.dateFrom)));
  return { week, goals: row?.goals ?? emptyGoals };
}

export async function setManagerWeeklyGoals(clientId: string, actorUserId: string, weekStart: string, goals: Goals, now = new Date()) {
  const week = managerWeek(saoPauloDateOnly(now));
  if (week.dateFrom !== weekStart) return null;
  const fields = { goals, updatedBy: actorUserId, updatedAt: now };
  await db.insert(weeklyGoals).values({ clientId, weekStart, ...fields })
    .onConflictDoUpdate({ target: [weeklyGoals.clientId, weeklyGoals.weekStart], set: fields });
  return { week, goals };
}

export async function weeklyManagerPlan(client: ManagerClient, args: {
  operating: ReturnType<typeof decideManagerCampaigns>;
  roas: PaidMediaReview; creative: ReturnType<typeof buildCreativeReview>; now: Date;
}) {
  const { week, goals } = await readManagerWeeklyGoals(client.id, args.now);
  const lastClosedDay = addDaysToDateOnly(saoPauloDateOnly(args.now), -1);
  const weekMedia = lastClosedDay >= week.dateFrom
    ? await readMedia(client, { dateFrom: week.dateFrom, dateTo: lastClosedDay }, true) : null;
  const spendToDate = !args.roas.accountPriceComparable ? null : lastClosedDay < week.dateFrom ? 0 : weekMedia?.summary.spend ?? null;
  const operating = args.operating;
  const items = args.roas.rows.flatMap((row) => {
    if (row.status !== "active" || (row.recommendation !== "pause" && row.recommendation !== "scale")) return [];
    const cpa = row.spending.purchases > 0 ? row.spending.spend / row.spending.purchases : null;
    const blocked = row.recommendation === "scale" && (
      (goals.targetCpa !== null && (cpa === null || cpa > goals.targetCpa)) ||
      (goals.targetRoas !== null && (row.roas === null || row.roas < goals.targetRoas)) ||
      (goals.spendCap !== null && (spendToDate === null || spendToDate >= goals.spendCap))
    );
    if (blocked) return [];
    return [{
      id: row.id, name: row.name, level: row.level, decision: row.recommendation,
      reason: row.driver, action: row.action, cpa, roas: row.roas,
      spend: row.spending.spend, purchases: row.spending.purchases,
    }];
  }).sort((a, b) => Number(a.decision === "scale") - Number(b.decision === "scale") || b.spend - a.spend);
  const winner = args.creative.creatives.find(({ best }) => best);
  const testCreative = winner && args.creative.creatives.find(({ key, recommendations }) =>
    key.split(":")[0] === winner.key.split(":")[0] && recommendations.length)?.recommendations[0];
  const creative = winner?.current ? {
    name: winner.name, campaign: winner.campaignName,
    hypothesis: testCreative
      ? "Testar uma abertura ou oferta do criativo de referência no lugar da variante com evidência de pausa. Manter público e posicionamentos para a comparação."
      : "Testar uma variação da abertura ou da oferta do criativo de referência, preservando o público e o criativo atual como base.",
    action: "Definir a variante, manter o controle e medir CPA e compras por sete dias após a atribuição amadurecer.",
    cpa: winner.current.cpa, purchases: winner.current.purchases, weaker: testCreative?.adName ?? null,
  } : null;
  return {
    week, goals, spendToDate, spendThrough: spendToDate !== null && lastClosedDay >= week.dateFrom ? lastClosedDay : null,
    comparison: args.roas.window, historicalCpa: operating.targetCpa, campaignItems: items, creative,
  };
}

export function compareFollowup(before: number | null, after: number | null, metric: Metric, target: number, overlap: boolean) {
  if (before === null || after === null) return { status: "insufficient" as const, targetReached: null };
  const targetReached = metric === "cac" ? after <= target : after >= target;
  if (overlap) return { status: "mixed" as const, targetReached };
  const delta = metric === "cac" ? before - after : after - before;
  const threshold = metric === "checkout" || metric === "repeat" ? 1
    : metric === "purchases" ? Math.max(1, before * 0.1) : Math.max(0.01, before * 0.1);
  return { status: delta >= threshold ? "improved" as const : delta <= -threshold ? "worsened" as const : "stable" as const, targetReached };
}

export async function measureManagerFollowups(client: ManagerClient, now: Date) {
  const day = saoPauloDateOnly(now);
  const rows = await db.select().from(followups).where(and(
    eq(followups.clientId, client.id), lte(followups.measureOn, day),
    or(isNull(followups.result), and(sql`${followups.result}->>'status' = 'insufficient'`,
      gte(followups.measureOn, addDaysToDateOnly(day, -7)),
      sql`${followups.result}->>'checkedAt' < ${saoPauloDateOnlyStart(day).toISOString()}`)),
  )).orderBy(asc(followups.measureOn)).limit(12);
  if (!rows.length) return;
  const earliest = saoPauloDateOnlyStart(addDaysToDateOnly(saoPauloDateOnly(rows[0].startedAt), -7));
  const active = await db.select({ runId: followups.runId, insightId: followups.insightId, startedAt: followups.startedAt,
    metric: sql<Metric>`${followups.plan}->>'metric'` }).from(followups)
    .where(and(eq(followups.clientId, client.id), gte(followups.startedAt, earliest)));
  const commerce = rows.some(({ plan }) => plan.metric !== "checkout" && plan.metric !== "roas")
    ? await readCommerceFreshness(client.id, client.commercePlatform).catch(() => null) : null;
  const groups = new Map<string, Followup[]>();
  for (const item of rows) {
    const start = saoPauloDateOnly(item.startedAt);
    const list = groups.get(start) ?? [];
    list.push(item);
    groups.set(start, list);
  }
  for (const [start, items] of groups) {
    const { before, after } = followupWindows(start);
    const [overview, ga] = await Promise.all([
      items.some(({ plan }) => plan.metric !== "checkout")
        ? readManagerOverview(client, after, { previousPeriod: before }).catch(() => null) : null,
      items.some(({ plan }) => plan.metric === "checkout")
        ? readFunnel(client.id, after, before).catch(() => null) : null,
    ]);
    for (const item of items) {
      const read = (side: "previous" | "current") => {
        const values = side === "previous" ? overview?.previous : overview?.metrics;
        const source = side === "previous" ? overview?.reportMedia?.previous : overview?.reportMedia?.current;
        const f = ga?.[side];
        if (item.plan.metric === "checkout") return f && f.addToCarts >= 20 ? f.checkouts * 100 / f.addToCarts : null;
        if (item.plan.metric === "roas") return source && source.purchases >= 3 && source.spend > 0 ? source.roas : null;
        if (!values || !hasClosedOrders(commerce, after.dateTo)) return null;
        switch (item.plan.metric) {
          case "revenue": return values.approvedRevenue;
          case "purchases": return values.orders;
          case "cac": return values.newBuyers >= 5 ? values.cac : null;
          case "repeat": return (values.newBuyers + values.returningBuyers) >= 20 ? values.repeatRate : null;
        }
      };
      const baseline = read("previous");
      const measured = read("current");
      const overlap = active.some((other) => {
        if ((other.runId === item.runId && other.insightId === item.insightId) || other.metric !== item.plan.metric) return false;
        const date = saoPauloDateOnly(other.startedAt);
        return date >= before.dateFrom && date <= after.dateTo;
      });
      const result = { ...compareFollowup(baseline, measured, item.plan.metric, item.plan.target, overlap),
        before: baseline, after: measured, beforeWindow: before, afterWindow: after, checkedAt: now.toISOString() };
      await db.update(followups).set({ result }).where(and(eq(followups.clientId, client.id),
        eq(followups.runId, item.runId), eq(followups.insightId, item.insightId)));
    }
  }
}
