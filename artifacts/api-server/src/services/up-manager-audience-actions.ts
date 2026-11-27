import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, upManagerAdActionsTable as actions, upManagerArchiveTable as archive } from "@workspace/db";
import { addDaysToDateOnly, saoPauloDateOnly } from "../lib/reporting-period";
import { audienceGraph, readAudienceEdge, type AudienceRecommendation, type ManagerAudienceStudy } from "./up-manager-audience-study";
import type { ManagerClient } from "./up-manager";

type MetaAudience = { id: string; name: string; subtype: string };
type Outcome = { status: "applied" | "pending" | "stale" | "uncertain"; audienceId?: string };
const validId = /^\d{1,32}$/;

export function audienceCreationParams(plan: AudienceRecommendation, name: string): Record<string, string> | null {
  const { rule } = plan;
  if (rule.mode === "interest") return null;
  if (rule.mode === "lookalike") {
    if (!validId.test(rule.originId) || rule.country !== "BR" || !(rule.from >= 0 && rule.to > rule.from && rule.to <= 0.1)) return null;
    return { name, subtype: "LOOKALIKE", origin_audience_id: rule.originId,
      lookalike_spec: JSON.stringify({ country: rule.country, starting_ratio: rule.from, ratio: rule.to }) };
  }
  if (!validId.test(rule.pixelId) || !["InitiateCheckout", "AddToCart"].includes(rule.event) ||
    ![7, 14, 30].includes(rule.days) || ![14, 30, 60, 90].includes(rule.excludePurchasesDays)) return null;
  const websiteEvent = (event: string, days: number) => ({
    operator: "or",
    rules: [{
      event_sources: [{ id: rule.pixelId, type: "pixel" }], retention_seconds: days * 86400,
      filter: { operator: "and", filters: [{ field: "event", operator: "eq", value: event }] },
    }],
  });
  return { name, subtype: "WEBSITE", retention_days: String(rule.days),
    rule: JSON.stringify({ inclusions: websiteEvent(rule.event, rule.days), exclusions: websiteEvent("Purchase", rule.excludePurchasesDays) }) };
}

export async function managerAudienceStatuses(clientId: string, recommendationIds: string[]) {
  if (!recommendationIds.length) return [];
  const rows = await db.select({ evidence: actions.evidence, status: actions.status }).from(actions)
    .where(and(eq(actions.clientId, clientId), sql`${actions.evidence}->>'kind' = 'audience-create'
      AND ${actions.evidence}->>'planId' IN (${sql.join(recommendationIds.map((id) => sql`${id}`), sql`, `)})`));
  return rows.flatMap(({ evidence, status }) => "kind" in evidence && evidence.kind === "audience-create" && status !== "paused"
    ? [{ id: evidence.planId, status, audienceId: evidence.audienceId }] : []);
}

export function audienceWindowCanCreate(study: ManagerAudienceStudy, now = new Date()) {
  const today = saoPauloDateOnly(now);
  return study.window.dateTo >= addDaysToDateOnly(today, -4) && study.window.dateTo < today;
}

export async function createManagerAudience(client: ManagerClient, runId: string, planId: string, actorUserId: string): Promise<Outcome> {
  const graph = audienceGraph(client);
  if (!graph) return { status: "stale" };
  const [run] = await db.select({ payload: archive.payload }).from(archive)
    .where(and(eq(archive.clientId, client.id), eq(archive.runId, runId)));
  const study = (run?.payload.b2c as { media?: { roasReview?: { audienceStudy?: ManagerAudienceStudy } } } | undefined)?.media?.roasReview?.audienceStudy;
  const plan = study?.recommendations.find(({ id }) => id === planId);
  const today = saoPauloDateOnly(new Date());
  if (!plan || !study || !audienceWindowCanCreate(study)) return { status: "stale" };
  const key = createHash("sha256").update(`audience-create:${graph.account}:${planId}`).digest("hex");
  const name = `UP Manager · ${plan.title.slice(0, 160)} · ${key.slice(0, 10)}`;
  const params = audienceCreationParams(plan, name);
  if (!params) return { status: "stale" };

  const findExisting = async () => {
    const page = await readAudienceEdge<MetaAudience>(client, "customaudiences", { fields: "id,name,subtype", limit: "100" }, 3);
    return { page, match: page?.items.find((item) => item.name === name && validId.test(item.id) &&
      (params.subtype === "LOOKALIKE" ? item.subtype === "LOOKALIKE" : ["WEBSITE", "MULTI_DATA"].includes(item.subtype))) };
  };
  const guard = and(eq(actions.clientId, client.id), eq(actions.recommendationId, key));
  const [saved] = await db.select({ evidence: actions.evidence, status: actions.status }).from(actions).where(guard);
  if (saved?.status === "applied" && "kind" in saved.evidence && saved.evidence.kind === "audience-create") {
    return { status: "applied", audienceId: saved.evidence.audienceId };
  }
  const { page, match } = await findExisting();
  const record = { kind: "audience-create" as const, planId, runId, name };
  if (match) {
    const evidence = { ...record, audienceId: match.id };
    await db.insert(actions).values({ clientId: client.id, recommendationId: key, accountId: graph.account, actorUserId,
      status: "applied", evidence }).onConflictDoUpdate({ target: [actions.clientId, actions.recommendationId],
      set: { status: "applied", evidence, updatedAt: new Date() } });
    return { status: "applied", audienceId: match.id };
  }
  if (saved && saved.status !== "stale") return { status: saved.status === "pending" ? "pending" : "uncertain" };
  if (!page?.complete) return { status: "stale" };
  if (plan.rule.mode === "lookalike") {
    const originId = plan.rule.originId;
    if (!page.items.some(({ id, subtype }) => id === originId && subtype !== "LOOKALIKE")) return { status: "stale" };
  }
  if (plan.rule.mode === "remarketing") {
    const pixelId = plan.rule.pixelId;
    const pixels = await readAudienceEdge<{ id: string; last_fired_time?: string }>(client, "adspixels", { fields: "id,last_fired_time", limit: "100" }, 2);
    if (!pixels?.items.some(({ id, last_fired_time }) => id === pixelId && last_fired_time &&
      Date.parse(last_fired_time) >= Date.parse(addDaysToDateOnly(today, -8)))) return { status: "stale" };
  }
  const [claim] = await db.insert(actions).values({
    clientId: client.id, recommendationId: key, accountId: graph.account, actorUserId, status: "pending", evidence: record,
  }).onConflictDoUpdate({ target: [actions.clientId, actions.recommendationId],
    set: { evidence: record, status: "pending", actorUserId, updatedAt: new Date() },
    setWhere: eq(actions.status, "stale"),
  }).returning({ status: actions.status });
  if (!claim) return { status: "pending" };

  const response = await fetch(`${graph.base}/${graph.account}/customaudiences`, {
    method: "POST", headers: { Authorization: `Bearer ${graph.token}` },
    body: new URLSearchParams(params), signal: AbortSignal.timeout(10000), redirect: "error",
  }).catch(() => null);
  const result = await response?.json().catch(() => null) as { id?: string; error?: { code?: number } } | null | undefined;
  const audienceId = response?.ok && result?.id && validId.test(result.id) ? result.id : (await findExisting()).match?.id;
  const status = audienceId ? "applied" : response && response.status >= 400 && response.status < 500 && result?.error?.code ? "stale" : "uncertain";
  await db.update(actions).set({ status, evidence: { ...record, audienceId }, updatedAt: new Date() }).where(guard);
  return { status, audienceId };
}
