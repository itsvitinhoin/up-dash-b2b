import { createHash } from "node:crypto";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db, ordersTable } from "@workspace/db";
import { addDaysToDateOnly, saoPauloDateOnlyStart } from "../lib/reporting-period";
import { brazilianState } from "../lib/brazilian-states";
import { paidOrderStatus } from "./metric-rules";
import { fetchMetaGraph } from "./meta-graph";
import { normalizeMetaAdAccountId } from "./meta-ads";
import { managerMetaToken, type ManagerClient, type ManagerPeriod } from "./up-manager";
import type { MetaNode } from "./up-manager-meta-structure";
import type { PaidMediaReview } from "./up-manager-paid-media";
import type { AudienceTest } from "./up-manager-media-opportunities";

type Option = { id: string; name: string };
type Metrics = { spend: number; revenue: number; purchases: number; roas: number | null; cpa: number | null };
type Segment = {
  label: string; kind: "lookalike" | "remarketing" | "interests" | "broad" | "mixed";
  sets: number; current: Metrics; previous: Metrics | null;
};
type Delivery = { age?: string; region?: string; spend?: string; inline_link_clicks?: string; impressions?: string };
type Age = { label: string; spend: number; clicks: number; impressions: number; cpc: number | null };
type State = { code: string; orders: number; spend: number; orderShare: number; spendShare: number; underexposed: boolean };
type Sort = { mode: "lookalike"; originId: string; from: number; to: number; country: "BR" }
  | { mode: "remarketing"; pixelId: string; event: "InitiateCheckout" | "AddToCart"; days: number; excludePurchasesDays: number }
  | { mode: "interest"; interests: Option[]; combination?: "or" | "and"; country: "BR"; age: { min: number; max: number } | null; states: string[] };
export type AudienceRecommendation = { id: string; title: string; evidence: string; test: string; rule: Sort };
export type ManagerAudienceStudy = {
  window: ManagerPeriod; previousWindow: ManagerPeriod | null; observedAt: string; accountId: string;
  referenceRoas: number | null;
  segments: Segment[]; ages: Age[]; states: State[]; recommendations: AudienceRecommendation[];
  products: string[];
};
type ListPage<T> = { data?: T[]; paging?: { next?: string } };
const idPattern = /^\d{1,32}$/;
const standard = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });
const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

export function audienceGraph(client: ManagerClient) {
  const token = managerMetaToken(client);
  const account = client.accountId && normalizeMetaAdAccountId(client.accountId);
  const version = process.env.META_GRAPH_VERSION ?? "v24.0";
  if (!token || !account || !/^act_\d+$/.test(account) || !/^v\d+\.0$/.test(version)) return null;
  return { token, account, version, base: `https://graph.facebook.com/${version}` };
}

export async function readAudienceEdge<T>(client: ManagerClient, edge: string, params: Record<string, string>, pages = 1) {
  const graph = audienceGraph(client);
  if (!graph) return null;
  const path = `/${graph.version}/${graph.account}/${edge}`;
  let url: URL | null = new URL(`https://graph.facebook.com${path}?${new URLSearchParams(params)}`);
  const items: T[] = [];
  for (let i = 0; url && i < pages; i++) {
    if (url.origin !== "https://graph.facebook.com" || url.pathname !== path) return null;
    url.searchParams.set("access_token", graph.token);
    const response: ListPage<T> | null = await fetchMetaGraph<ListPage<T>>(url.toString()).catch(() => null);
    if (!Array.isArray(response?.data)) return null;
    items.push(...response.data);
    const next: string | undefined = response.paging?.next;
    url = next && URL.canParse(next) ? new URL(next) : null;
  }
  return { items, complete: !url };
}

function totals(items: PaidMediaReview["rows"]): Metrics {
  const summary = items.reduce((s, { spending }) => ({ spend: s.spend + spending.spend,
    revenue: s.revenue + spending.revenue, purchases: s.purchases + spending.purchases }), { spend: 0, revenue: 0, purchases: 0 });
  return { ...summary, roas: summary.spend && items.every(({ roas }) => roas !== null) ? summary.revenue / summary.spend : null,
    cpa: summary.purchases ? summary.spend / summary.purchases : null };
}

function segmentType(node: MetaNode, audiences: Map<string, MetaNode>) {
  const targeting = node.targeting;
  if (!targeting) return null;
  const custom = targeting.custom_audiences ?? [];
  const interests = targeting.interests ?? [];
  if (targeting.flexible_spec?.length || custom.length > 1 || (custom.length && interests.length)) {
    return { key: `mixed:${node.id}`, label: node.name, kind: "mixed" as const };
  }
  if (custom.length) {
    const audience = audiences.get(custom[0].id);
    if (!audience || !audience.subtype) return null;
    return { key: `custom:${audience.id}`, label: audience.name, kind: audience.subtype === "LOOKALIKE" ? "lookalike" as const : "remarketing" as const };
  }
  if (interests.length) {
    return { key: `interests:${interests.map(({ id }) => id).sort().join(",")}`,
      label: interests.map(({ name }) => name).filter(Boolean).join(" · ") || node.name, kind: "interests" as const };
  }
  return { key: `broad:${node.id}`, label: node.name, kind: "broad" as const };
}

export function summarizeAudienceSegments(review: PaidMediaReview, previous: PaidMediaReview | null,
  sets: Map<string, MetaNode>, audiences: Map<string, MetaNode>, stable: Set<string>) {
  const groups = new Map<string, { kind: Segment["kind"]; label: string; rows: PaidMediaReview["rows"] }>();
  for (const row of review.rows) {
    const node = sets.get(row.id);
    if (row.level !== "adset" || row.spending.spend <= 0 || !node || node.campaign_id !== row.campaignId) continue;
    const group = segmentType(node, audiences);
    if (!group || !stable.has(row.id)) continue;
    const entry = groups.get(group.key) ?? { kind: group.kind, label: group.label, rows: [] };
    entry.rows.push(row);
    groups.set(group.key, entry);
  }
  const prior = new Map(previous?.rows.filter(({ level }) => level === "adset").map((row) => [row.id, row]));
  return [...groups.values()].map(({ kind, label, rows }): Segment => {
    const history = rows.flatMap(({ id }) => { const row = prior.get(id); return row ? [row] : []; });
    return { kind, label, sets: rows.length, current: totals(rows),
      previous: history.length === rows.length ? totals(history) : null };
  }).sort((a, b) => b.current.purchases - a.current.purchases || b.current.spend - a.current.spend).slice(0, 24);
}

async function readOrdersByState(client: ManagerClient, window: ManagerPeriod) {
  const rows = await db.select({ state: ordersTable.state, orders: sql<number>`count(*)::int` })
    .from(ordersTable).where(and(eq(ordersTable.clientId, client.id), paidOrderStatus(),
      gte(ordersTable.createdAt, saoPauloDateOnlyStart(window.dateFrom)),
      lt(ordersTable.createdAt, saoPauloDateOnlyStart(addDaysToDateOnly(window.dateTo, 1))))).groupBy(ordersTable.state);
  const orders = new Map<string, number>();
  for (const row of rows) {
    const state = brazilianState(row.state, "BR");
    if (state) orders.set(state, (orders.get(state) ?? 0) + row.orders);
  }
  return orders;
}

function deliveryAges(rows: Delivery[] | undefined) {
  return (rows ?? []).filter(({ age }) => age && /^\d{2}(?:-\d{2}|\+)$/.test(age)).map((row): Age => {
    const clicks = Number(row.inline_link_clicks) || 0;
    const spend = Number(row.spend) || 0;
    return { label: row.age!, spend, clicks, impressions: Number(row.impressions) || 0, cpc: clicks ? spend / clicks : null };
  }).sort((a, b) => a.label.localeCompare(b.label));
}

function geoOpportunities(rows: Delivery[] | undefined, orders: Map<string, number>) {
  if (!rows?.length || !orders.size) return [];
  const byState = new Map<string, number>();
  for (const { region, spend } of rows) {
    const label = region?.replace(/\s*\(state\)$/i, "");
    const code = brazilianState(label === "Federal District" ? "DF" : label, "BR");
    if (code) byState.set(code, (byState.get(code) ?? 0) + (Number(spend) || 0));
  }
  const sumSpend = [...byState.values()].reduce((total, value) => total + value, 0);
  const sumOrders = [...orders.values()].reduce((total, value) => total + value, 0);
  if (!sumSpend || sumOrders < 30) return [];
  return [...orders].flatMap(([code, count]): State[] => {
    const spend = byState.get(code);
    if (spend === undefined) return [];
    const orderShare = count / sumOrders;
    const spendShare = spend / sumSpend;
    return [{ code, orders: count, spend, orderShare, spendShare,
      underexposed: count >= 10 && orderShare - spendShare >= 0.025 }];
  }).sort((a, b) => Number(b.underexposed) - Number(a.underexposed) || b.orders - a.orders).slice(0, 10);
}

export async function verifiedInterest(client: ManagerClient, query: string) {
  const page = await readAudienceEdge<Option & { type?: string }>(client, "targetingsearch", { q: query, type: "adinterest", locale: "pt_BR", limit: "12" });
  const found = page?.items.find((item) => idPattern.test(item.id) && typeof item.name === "string" &&
    (!item.type || item.type === "interests" || item.type === "adinterest") &&
    fold(item.name.replace(/\s*\([^()]*\)$/, "")) === fold(query));
  return found ? { id: found.id, name: found.name } : null;
}

function interestIdeas(products: string[]) {
  const ranked = products.map(fold);
  const themes = [
    { term: "Moda feminina", group: "fashion", match: /\b(conjunto|vestido|saia|blusa|macacao|calca|blazer)\b/ },
    { term: "Vestuário", group: "fashion", match: /\b(conjunto|vestido|saia|blusa|macacao|calca|blazer)\b/ },
    { term: "Vestidos", group: "style", match: /\bvestido\b/ },
    { term: "Roupas femininas", group: "style", match: /\b(conjunto|camiseta|short)\b/ },
    { term: "Alfaiataria", group: "style", match: /\b(alfaiataria|blazer|colete)\b/ },
    { term: "Acessórios de moda", group: "complement", match: /\b(conjunto|vestido|saia|blusa|macacao|calca|blazer)\b/ },
    { term: "Calçados", group: "complement", match: /\b(conjunto|vestido|saia|macacao|calca|blazer)\b/ },
    { term: "Compras na internet", group: "intent", match: /\b(conjunto|vestido|saia|blusa|macacao|calca|blazer)\b/ },
    { term: "Marcas de roupa feminina", group: "style", match: /\b(conjunto|vestido|saia|blusa|macacao|calca|blazer)\b/ },
  ];
  return themes.flatMap(({ term, group, match }) => {
    const index = ranked.findIndex((name) => match.test(name));
    return index < 0 ? [] : [{ term, group, leadingProduct: products[index] }];
  });
}

export function recommendation(title: string, evidence: string, test: string, rule: Sort): AudienceRecommendation {
  const id = createHash("sha256").update(JSON.stringify(rule.mode === "interest"
    ? { ...rule, interests: rule.interests.map(({ id }) => id).sort() } : rule)).digest("hex");
  return { id, title, evidence, test, rule };
}

export async function buildManagerAudienceStudy(
  client: ManagerClient, review: PaidMediaReview, previous: PaidMediaReview | null,
  sets: Map<string, MetaNode>, audiences: Map<string, MetaNode>, stable: Set<string>, lookalikes: AudienceTest[],
  products: string[], funnel: { checkouts: number; purchases: number; window: ManagerPeriod },
): Promise<ManagerAudienceStudy | undefined> {
  const graph = audienceGraph(client);
  if (!graph || !review.available) return undefined;
  const window = review.window;
  const campaignIds = review.rows.filter(({ level }) => level === "campaign").map(({ id }) => id);
  if (!campaignIds.length) return undefined;
  const delivery = { time_range: JSON.stringify({ since: window.dateFrom, until: window.dateTo }), level: "account", limit: "100",
    fields: "spend,impressions,inline_link_clicks", filtering: JSON.stringify([{ field: "campaign.id", operator: "IN", value: campaignIds }]) };
  const interestQueries = interestIdeas(products);
  const [age, region, orders, interestHits, pixels, custom] = await Promise.all([
    readAudienceEdge<Delivery>(client, "insights", { ...delivery, breakdowns: "age" }),
    readAudienceEdge<Delivery>(client, "insights", { ...delivery, breakdowns: "region" }),
    readOrdersByState(client, window).catch(() => new Map<string, number>()),
    Promise.all(interestQueries.map(({ term }) => verifiedInterest(client, term))),
    readAudienceEdge<{ id: string; name: string; last_fired_time?: string }>(client, "adspixels", { fields: "id,name,last_fired_time", limit: "100" }),
    readAudienceEdge<MetaNode>(client, "customaudiences", { fields: "id,name,subtype,lookalike_spec,rule,retention_days", limit: "100" }, 3),
  ]);
  const ages = deliveryAges(age?.items);
  const states = geoOpportunities(region?.complete ? region.items : undefined, orders);
  const geo = states.find(({ underexposed }) => underexposed);
  const testAge = ages.filter(({ clicks, cpc }) => clicks >= 50 && cpc !== null)
    .sort((a, b) => a.cpc! - b.cpc!)[0];
  const ageBounds = testAge?.label.match(/^(\d{2})-(\d{2})$/);
  // Test one dimension at a time. Keep age and geography as separate readings.
  const used = new Set([...sets.values()].flatMap(({ targeting }) => [
    ...(targeting?.interests ?? []),
    ...(targeting?.flexible_spec ?? []).flatMap((group) => group.interests ?? []),
  ]).map(({ id }) => id));
  const ideas = interestHits.flatMap((interest, i) => interest ? [{ ...interestQueries[i], interest }] : []);
  const eligible = (options: Option[], combination: "or" | "and") => ![...sets.values()].some(({ targeting }) => {
    const groups = [targeting?.interests ?? [], ...(targeting?.flexible_spec ?? []).map(({ interests }) => interests ?? [])];
    return combination === "or" ? groups.some((group) => options.every(({ id }) => group.some((value) => value.id === id)))
      : groups.filter((group) => group.length).length >= 2 &&
        options.every(({ id }) => groups.some((group) => group.length === 1 && group[0].id === id));
  });
  const recommendations = interestHits.flatMap((interest, i) => {
    if (!interest || used.has(interest.id) || !sets.size) return [];
    const cpc = new Intl.NumberFormat("pt-BR", { style: "currency", currency: client.currency });
    return [recommendation(interest.name, `${interestQueries[i].leadingProduct} está entre os produtos líderes. A Meta confirma o interesse e ele não aparece nos conjuntos lidos na janela.`,
      `Comparar com público aberto usando o mesmo criativo e oferta. Avaliar CPA, compras e ROAS após 7 dias fechados.${ageBounds ? ` Em teste separado, avaliar ${testAge!.label} anos (CPC de link ${cpc.format(testAge!.cpc!)} na mídia atual).` : ""}`,
      { mode: "interest", interests: [interest], country: "BR", age: null, states: [] })];
  });
  if (geo && interestHits.some((interest) => interest && !used.has(interest.id))) {
    const interest = interestHits.find((item) => item && !used.has(item.id))!;
    recommendations.push(recommendation(`${interest.name} · ${geo.code}`,
      `${geo.code} teve ${geo.orders} pedidos aprovados, ${percent.format(geo.orderShare)} dos pedidos com UF e ${percent.format(geo.spendShare)} do gasto da Meta com UF identificada.`,
      "Comparar este estado com o restante da entrega usando a mesma oferta. Antes do teste, conferir prazo e frete da UF.",
      { mode: "interest", interests: [interest], country: "BR", age: null, states: [geo.code] }));
  }
  const fashion = ideas.find(({ group, interest }) => group === "fashion" && !used.has(interest.id))
    ?? ideas.find(({ group }) => group === "fashion");
  const style = ideas.find(({ group, interest }) => ["style", "complement"].includes(group) && interest.id !== fashion?.interest.id);
  const intent = ideas.find(({ group }) => group === "intent");
  for (const [match, combination] of [[style, "or"], [intent, "and"]] as const) {
    if (!fashion || !match || !sets.size) continue;
    const interests = [fashion.interest, match.interest];
    if (interests[0].id === interests[1].id || !eligible(interests, combination)) continue;
    const separator = combination === "or" ? " OU " : " E ";
    recommendations.push(recommendation(interests.map(({ name }) => name).join(separator),
      `${fashion.leadingProduct} está entre os mais vendidos no período. Os interesses têm IDs válidos na Meta e a combinação não foi encontrada nos conjuntos lidos.`,
      combination === "or"
        ? "Colocar os dois interesses no mesmo grupo para testar alcance. Comparar com público aberto mantendo criativo, oferta e geografia."
        : "Colocar cada interesse em um grupo e restringir ao segundo grupo. Comparar com o teste amplo mantendo criativo, oferta e geografia.",
      { mode: "interest", interests, combination, country: "BR", age: null, states: [] }));
  }
  for (const entry of lookalikes) {
    const winner = [...audiences.values()].find(({ name }) => name === entry.name);
    const spec = winner?.lookalike_spec;
    const origin = spec?.origin?.[0];
    const low = Number(spec?.ratio);
    const to = Math.min(0.10, Math.round((low + 0.02) * 100) / 100);
    if (!custom?.complete || !origin?.id || spec?.origin?.length !== 1 || !idPattern.test(origin.id) ||
      !custom.items.some(({ id, subtype }) => id === origin.id && subtype && subtype !== "LOOKALIKE") ||
      (spec?.country && spec.country !== "BR") || !(low > 0 && to > low)) continue;
    if (custom.items.some(({ lookalike_spec: existing }) => existing?.origin?.some(({ id }) => id === origin.id) &&
      existing.starting_ratio === low && existing.ratio === to && (!existing.country || existing.country === "BR"))) continue;
    recommendations.unshift(recommendation(`Lookalike ${percent.format(low)}–${percent.format(to)} · ${origin.name ?? entry.name}`,
      `${entry.name} teve ${entry.purchases} compras, ROAS ${standard.format(entry.roas)}× contra ${standard.format(entry.referenceRoas)}× nos pares.`,
      "Testar a faixa adjacente com o mesmo criativo e manter a origem. Medir CPA e ROAS após 7 dias fechados.",
      { mode: "lookalike", originId: origin.id, from: low, to, country: "BR" }));
  }
  const purchasePixelIds = [...new Set([...sets.values()].flatMap(({ promoted_object }) =>
    promoted_object?.custom_event_type === "PURCHASE" && promoted_object.pixel_id ? [promoted_object.pixel_id] : []))];
  const pixel = purchasePixelIds.length === 1 && pixels?.items.find(({ id, last_fired_time }) => id === purchasePixelIds[0] &&
    last_fired_time && Date.parse(last_fired_time) >= Date.parse(addDaysToDateOnly(window.dateTo, -7)));
  const checkoutExists = custom?.items.some(({ rule, retention_days }) => retention_days === 14 &&
    /initiatecheckout/i.test(typeof rule === "string" ? rule : JSON.stringify(rule) ?? "") &&
    /purchase/i.test(typeof rule === "string" ? rule : JSON.stringify(rule) ?? ""));
  if (pixel && custom?.complete && !checkoutExists && funnel.checkouts >= 30 && funnel.purchases >= 0 &&
    funnel.checkouts - funnel.purchases >= 15) {
    const shortDate = (date: string) => date.slice(5).split("-").reverse().join("/");
    const checkoutPeriod = `${shortDate(funnel.window.dateFrom)} a ${shortDate(funnel.window.dateTo)}`;
    recommendations.push(recommendation("Remarketing · iniciou checkout em 14 dias",
      `O GA4 registrou ${funnel.checkouts} inícios de checkout e ${funnel.purchases} compras de ${checkoutPeriod}. A conta tem o pixel ${pixel.name} com atividade recente.`,
      "Usar o público de checkout dos últimos 14 dias, excluindo compras dos últimos 30. Testar criativo que esclareça entrega, pagamento ou troca.",
      { mode: "remarketing", pixelId: pixel.id, event: "InitiateCheckout", days: 14, excludePurchasesDays: 30 }));
  }
  return { window, previousWindow: previous?.window ?? null, observedAt: new Date().toISOString(),
    accountId: graph.account.slice(4), referenceRoas: review.reference,
    segments: summarizeAudienceSegments(review, previous, sets, audiences, stable), ages, states,
    recommendations, products };
}
