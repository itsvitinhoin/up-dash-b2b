import { buildManagerAudienceStudy } from "./up-manager-audience-study";
import { addDaysToDateOnly } from "../lib/reporting-period";
import { analyzeProductCampaigns } from "./product-campaign-analysis";
import { fetchManagerStockAd, type fetchCampaignCatalog } from "./product-campaign-sources";
import type { CampaignSnapshot } from "./product-campaign-monitor";
import { campaignWindowPoints, evaluateCampaignInventory, type CampaignEvaluation, type campaignInventoryContext, type buildCampaignWindows } from "./up-manager-campaign-evaluation";
import { mediaRoas, type PaidMediaReview, type PaidMediaRow } from "./up-manager-paid-media";
import { metaNodeActive, readManagerMetaNodes, readOwnedBudget, type MetaBudget, type MetaNode } from "./up-manager-meta-structure";
import { managerMetaToken, type ManagerClient } from "./up-manager";

type Reviews = ReturnType<typeof buildCampaignWindows>;
type Inventory = ReturnType<typeof campaignInventoryContext>;
type Lookup = Map<string, MetaNode>;
type Activity = { id: string; level: string; day: string; title: string };
const pauseActivity = new Set(["Alteração de veiculação", "Pausa confirmada", "Pausa por estoque confirmada"]);
export type BudgetAssessment = MetaBudget & { blockers: string[] };
export type AudienceTest = {
  name: string; source: string | null; range: string | null; spend: number; purchases: number;
  roas: number; cpa: number; referenceRoas: number; referenceCpa: number; sets: number; action: string;
};

const pct = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });
const count = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const budgetFields = "status,effective_status,daily_budget,lifetime_budget";
const adCpa = (row: PaidMediaRow) => row.spending.spend / row.spending.purchases;

export function findSiblingBudgetWaste(reviews: Reviews, id: string, isEligible: (row: PaidMediaRow) => boolean) {
  for (const days of [7, 14, 30] as const) {
    const review = reviews[days];
    const ad = review.rows.find((row) => row.level === "ad" && row.id === id);
    if (!ad?.adsetId || ad.status !== "active" || ad.spending.purchases > 0 || !review.reference) continue;
    const recent = reviews[3].rows.find((row) => row.level === "ad" && row.id === id);
    if (recent?.spending.purchases) continue;
    const siblings = review.rows.filter((row) => row.level === "ad" && row.adsetId === ad.adsetId && row.campaignId === ad.campaignId);
    const total = siblings.reduce((sum, row) => sum + row.spending.spend, 0);
    const share = ad.spending.spend / total;
    if (share < 0.35) continue;
    const winner = siblings.filter((row) => row.id !== id && row.status === "active" && row.spending.purchases >= 3 &&
      (row.roas ?? 0) >= review.reference! && ad.spending.spend >= adCpa(row) * 3 && isEligible(row))
      .sort((a, b) => adCpa(a) - adCpa(b))[0];
    if (winner) return { ad, winner, days, share };
  }
  return null;
}

export function budgetBlockers(inventory: ReturnType<typeof evaluateCampaignInventory>) {
  const blockers = inventory.products.filter((product) => product.grade !== "complete" ||
    (product.coverageAtScale ?? 0) < 7 || (product.gradeDays ?? 0) / 1.2 < 3)
    .slice(0, 5).map((product) => {
      const name = product.color && !product.name.toLowerCase().includes(product.color.toLowerCase()) ? `${product.name} · ${product.color}` : product.name;
      if (product.grade === "out_of_stock") return `${name} esgotado`;
      if (product.grade === "broken") return `${name} com grade incompleta${product.missing.length ? ` (${product.missing.join(", ")})` : ""}`;
      if (product.grade === "unknown") return `${name} com grade ou saldo sem confirmação`;
      const coverage = product.coverageAtScale == null ? "cobertura sem estimativa" : `${count.format(product.coverageAtScale)} dias de estoque no giro da escala`;
      return `${name} · ${coverage}${product.gradeDays != null ? ` · próxima quebra em ${count.format(product.gradeDays / 1.2)} dias` : ""}`;
    });
  if (inventory.unknownAds) blockers.push(`${inventory.unknownAds} anúncio(s) com destino sem vínculo confirmado`);
  if (!inventory.products.length) blockers.push("Nenhum destino com estoque verificado para este orçamento");
  return blockers;
}

function budgetOwners(row: PaidMediaRow, rows: PaidMediaRow[], campaigns: Lookup, sets: Lookup, currency: string) {
  const campaign = campaigns.get(row.level === "campaign" ? row.id : row.campaignId ?? "");
  if (!campaign || !metaNodeActive(campaign)) return [];
  const candidates = row.level === "campaign"
    ? rows.filter((item) => item.level === "adset" && item.campaignId === row.id && item.status === "active" && item.evaluation?.decision === "scale")
      .map(({ id }) => id)
    : [row.level === "adset" ? row.id : row.adsetId ?? ""];
  const owned = readOwnedBudget(campaign, "campaign", currency);
  const setBudgets = candidates.flatMap((id) => {
    const set = sets.get(id);
    if (!set || set.campaign_id !== campaign.id || !metaNodeActive(set)) return [];
    const budget = readOwnedBudget(set, "adset", currency);
    return budget ? [budget] : [];
  });
  if (owned && setBudgets.length) return [];
  if (owned && row.level !== "campaign" && (!metaNodeActive(sets.get(candidates[0])) ||
    sets.get(candidates[0])?.campaign_id !== campaign.id)) return [];
  return owned ? [owned] : setBudgets;
}

export function assessScaleBudgets(rows: PaidMediaRow[], campaigns: Lookup, sets: Lookup, ctx: Inventory, currency: string) {
  for (const row of rows) {
    if (row.recommendation !== "scale" || !row.evaluation) continue;
    const owners = (() => {
      try { return budgetOwners(row, rows, campaigns, sets, currency); } catch { return []; }
    })();
    row.scaleBudgets = owners.map((owner) => {
      const inventory = evaluateCampaignInventory({ id: owner.ownerId, level: owner.ownerLevel }, ctx);
      const blockers = budgetBlockers(inventory);
      if (inventory.scaleReady && rows.some((item) => item.recommendation === "pause" && (
        owner.ownerLevel === "campaign" ? item.campaignId === owner.ownerId || item.id === owner.ownerId
          : item.adsetId === owner.ownerId || item.id === owner.ownerId
      ))) blockers.push("Há uma pausa recomendada na mesma estrutura. Meça o efeito antes de aumentar a verba.");
      return { ...owner, blockers };
    });
    if (row.scaleBudgets.some(({ blockers }) => !blockers.length)) continue;
    const reason = row.scaleBudgets.length
      ? "O anúncio ou a estrutura tem desempenho para escala, mas o orçamento que paga pela entrega também cobre destinos ou itens que precisam de revisão."
      : "O desempenho indica uma oportunidade, mas o nível e o valor da verba ainda não foram confirmados.";
    row.recommendation = "maintain";
    row.driver = reason;
    row.action = row.scaleBudgets.length && row.level === "ad"
      ? "Manter a verba atual. Para escalar este anúncio isoladamente, testar um conjunto com orçamento próprio. Reavaliar a grade e a entrega antes de aumentar o orçamento compartilhado."
      : "Manter a verba e reavaliar a escala de 15% a 20% quando a estrutura e o saldo estiverem confirmados.";
    row.evaluation = { ...row.evaluation, decision: "maintain", reason, action: row.action };
  }
}

export function historicalReactivation(ad: PaidMediaRow, reviews: Reviews) {
  if (ad.level !== "ad" || ad.status !== "inactive" || !ad.adsetId) return null;
  const row = reviews[30].rows.find((item) => item.level === "ad" && item.id === ad.id);
  const set = reviews[30].rows.find((item) => item.level === "adset" && item.id === ad.adsetId);
  const reference = Math.max(reviews[30].reference ?? 0, set?.roas ?? 0);
  if (!row || !set || !reference || (row.roas ?? 0) < reference * 1.25 || row.spending.purchases < 5) return null;
  const peers = reviews[30].rows.filter((item) => item.level === "ad" && item.adsetId === ad.adsetId &&
    item.status === "active" && item.spending.purchases >= 3 && item.roas !== null);
  const peer = peers.sort((a, b) => adCpa(a) - adCpa(b))[0];
  if (!peer || adCpa(row) > adCpa(peer) * 0.85) return null;
  return { row, peer, reference };
}

/** Reuses the last observed stock pause for this exact ad and its original destination. */
export function priorStockPauses(history: PaidMediaReview[], end: string) {
  const latest = new Map<string, PaidMediaRow>();
  for (const review of history) {
    const date = review.multiWindowEnd ?? review.window.dateTo;
    if (date > end || date < addDaysToDateOnly(end, -30)) continue;
    for (const row of review.rows) {
      if (row.level === "ad" && row.recommendation === "pause" && !latest.has(row.id)) latest.set(row.id, row);
    }
  }
  return new Map([...latest].filter(([, row]) => row.pauseReason === "stock" && row.evaluation?.inventory?.products?.length));
}

export function confirmedRestock(prior: PaidMediaRow | undefined, row: PaidMediaRow, inventory: CampaignEvaluation["inventory"]) {
  if (!prior?.evaluation?.inventory?.products || prior.id !== row.id || prior.campaignId !== row.campaignId || prior.adsetId !== row.adsetId) return [];
  const byId = new Map(prior.evaluation.inventory.products.map((product) => [product.id, product]));
  return inventory.products.flatMap((product) => {
    const previous = byId.get(product.id);
    if (!previous || product.grade === "unknown" || (previous.grade !== "broken" && previous.grade !== "out_of_stock")) return [];
    const unavailable = new Set((previous.variants ?? []).filter(({ stock }) => stock === 0).map(({ id }) => id));
    return product.variants.flatMap(({ id, label, stock }) => unavailable.has(id) && stock !== null && stock > 0
      ? [{ product: product.name, variant: label, stock }]
      : []);
  });
}

function uniqueSeed(set: MetaNode | undefined) {
  const targeting = set?.targeting;
  const includes = targeting?.custom_audiences;
  return includes?.length === 1 && !targeting?.flexible_spec?.length ? includes[0].id : null;
}

export function audienceTests(review: PaidMediaReview, sets: Lookup, audiences: Lookup): AudienceTest[] {
  const rows = review.rows.filter((row) => row.level === "adset" && row.spending.spend > 0 && row.roas !== null && sets.has(row.id));
  const group = (audienceId: string) => rows.filter((row) => uniqueSeed(sets.get(row.id)) === audienceId);
  return [...audiences.values()].flatMap((audience): AudienceTest[] => {
    if (audience.subtype !== "LOOKALIKE") return [];
    const selected = group(audience.id);
    const comparable = rows.filter((row) => uniqueSeed(sets.get(row.id)) !== audience.id &&
      selected.some((item) => item.campaignId === row.campaignId));
    const rollup = (items: PaidMediaRow[]) => items.reduce((acc, { spending }) => ({
      spend: acc.spend + spending.spend, revenue: acc.revenue + spending.revenue, purchases: acc.purchases + spending.purchases,
    }), { spend: 0, revenue: 0, purchases: 0 });
    const value = rollup(selected);
    const baseline = rollup(comparable);
    if (value.purchases < 8 || baseline.purchases < 8 || !value.spend || !baseline.spend || !baseline.revenue) return [];
    const roas = value.revenue / value.spend;
    const referenceRoas = baseline.revenue / baseline.spend;
    const cpa = value.spend / value.purchases;
    const referenceCpa = baseline.spend / baseline.purchases;
    if (roas < referenceRoas * 1.15 || cpa > referenceCpa * 0.9) return [];
    const end = Number(audience.lookalike_spec?.ratio);
    const start = Number(audience.lookalike_spec?.starting_ratio ?? 0);
    const range = end > 0 && end <= 0.1 && start >= 0 && start < end ? `${pct.format(start)}–${pct.format(end)}` : null;
    const wider = end > 0 && end < 0.1 ? `${pct.format(end)}–${pct.format(Math.min(end + 0.02, 0.1))}` : null;
    const source = audience.lookalike_spec?.origin?.map(({ name }) => name).filter(Boolean).join(", ") || null;
    const variant = wider
      ? `Testar faixa adjacente ${wider} com a mesma base e o mesmo criativo.`
      : "Testar variação isolada da base de origem, mantendo faixa e criativo.";
    return [{ name: audience.name, source, range, roas, cpa, referenceRoas, referenceCpa,
      spend: value.spend, purchases: value.purchases, sets: selected.length,
      action: `${variant} Em testes separados, comparar evento de compra ou uma lista de alto LTV quando a base estiver disponível. Medir CPA e ROAS atribuídos por pelo menos 7 dias fechados.` }];
  }).sort((a, b) => b.purchases - a.purchases).slice(0, 4);
}

export async function applyMediaOpportunities(
  client: ManagerClient, review: PaidMediaReview, reviews: Reviews, ctx: Inventory,
  catalog: Awaited<ReturnType<typeof fetchCampaignCatalog>> | null, activity: Activity[],
  audienceContext?: {
    previous: PaidMediaReview | null;
    products: string[];
    funnel: { checkouts: number; purchases: number; window: PaidMediaReview["window"] };
    stockPauseHistory?: PaidMediaReview[];
  },
) {
  if (!review.accountPriceComparable) return;
  const end = review.multiWindowEnd ?? review.window.dateTo;
  const recentlyChanged = (row: PaidMediaRow, days: number, ignoreOwnPause = false) => activity.some((event) =>
    event.day >= addDaysToDateOnly(end, 1 - days) && (
      !ignoreOwnPause || event.level !== "ad" || event.id !== row.id || !pauseActivity.has(event.title)
    ) && (
      (event.level === row.level && event.id === row.id) ||
      (event.level === "campaign" && event.id === row.campaignId) ||
      (event.level === "adset" && event.id === row.adsetId)));
  const ready = (row: PaidMediaRow) => evaluateCampaignInventory(row, ctx).scaleReady;
  const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: client.currency });
  for (const row of review.rows) {
    if (row.level !== "ad" || row.status !== "active" || !row.evaluation || row.pauseReason === "stock" || recentlyChanged(row, 3)) continue;
    const result = findSiblingBudgetWaste(reviews, row.id, ready);
    if (!result) continue;
    const { ad, winner, days, share } = result;
    const reason = `Em ${days} dias fechados, ${row.name} usou ${pct.format(share)} do gasto do conjunto (${currency.format(ad.spending.spend)}) e teve 0 compras. ${winner.name} fez ${winner.spending.purchases} compras com ROAS de ${mediaRoas(winner.roas)} e CPA de ${currency.format(adCpa(winner))}, com grade e cobertura confirmadas.`;
    const action = `Desativar somente ${row.name} e manter ${winner.name} ativo no mesmo conjunto, com a verba atual. A Meta redistribui a entrega entre os anúncios que continuarem ativos. Rever a distribuição e o CPA em 72 h.`;
    Object.assign(row, { recommendation: "pause", pauseReason: "performance", pauseEvidence: "sibling",
      comparisonAdId: winner.id, driver: reason, action, evaluation: { ...row.evaluation, decision: "pause", reason, action } });
  }

  const stockPauses = priorStockPauses(audienceContext?.stockPauseHistory ?? [], end);
  const candidates = review.rows.flatMap((row) => {
    if (row.level !== "ad" || row.status !== "inactive") return [];
    const prior = stockPauses.get(row.id);
    const changed = recentlyChanged(row, 3);
    const history = historicalReactivation(row, reviews);
    if ((!prior && !history) || (changed && (!prior || recentlyChanged(row, 3, true)))) return [];
    return [{ row, prior, history, changed }];
  });
  const potentialReturns = candidates.sort((a, b) => Number(Boolean(b.prior)) - Number(Boolean(a.prior))).slice(0, 12);
  const scaleCampaigns = review.rows.filter(({ recommendation }) => recommendation === "scale")
    .flatMap((row) => row.level === "campaign" ? [row.id] : row.campaignId ? [row.campaignId] : []);
  const setIds = [...reviews[30].rows.filter(({ level }) => level === "adset").map(({ id }) => id),
    ...review.rows.flatMap((row) => row.level === "adset" ? [row.id] : row.adsetId ? [row.adsetId] : [])];
  const [campaigns, sets, paused] = await Promise.all([
    readManagerMetaNodes(client, scaleCampaigns, budgetFields),
    readManagerMetaNodes(client, setIds, `campaign_id,targeting,promoted_object,${budgetFields}`),
    readManagerMetaNodes(client, potentialReturns.map(({ row }) => row.id), "adset_id,campaign_id,status,effective_status"),
  ]);
  assessScaleBudgets(review.rows, campaigns, sets, ctx, client.currency);

  const seedIds = [...sets.values()].flatMap(({ targeting }) => targeting?.custom_audiences?.map(({ id }) => id) ?? []);
  const audiences = await readManagerMetaNodes(client, seedIds, "subtype,lookalike_spec");
  const changedTargeting = new Set(activity.filter(({ level, title, day }) => level === "adset" &&
    title === "Alteração de público" && day >= reviews[30].window.dateFrom).map(({ id }) => id));
  const stableSets = new Map([...sets].filter(([id]) => !changedTargeting.has(id)));
  review.audienceTests = audienceTests(reviews[30], stableSets, audiences);
  if (audienceContext) {
    const stable = new Set(stableSets.keys());
    review.audienceStudy = await buildManagerAudienceStudy(client, reviews[30], audienceContext.previous, sets, audiences, stable,
      review.audienceTests, audienceContext.products, audienceContext.funnel).catch(() => undefined);
  }

  const token = managerMetaToken(client);
  if (!catalog || !token || !client.accountId || !ctx.snapshot) return;
  const signal = AbortSignal.timeout(12_000);
  await Promise.all(potentialReturns.filter(({ row }) => {
    const node = paused.get(row.id);
    return node?.status === "PAUSED" && node.effective_status === "PAUSED" && node.adset_id === row.adsetId && node.campaign_id === row.campaignId;
  }).map(async ({ row, prior, history, changed }) => {
    const ad = await fetchManagerStockAd(client.accountId!, row.id, token, signal, "PAUSED").catch(() => null);
    if (!ad || ad.adsetId !== row.adsetId || ad.campaignId !== row.campaignId) return;
    const linked = analyzeProductCampaigns([ad], catalog.products, catalog.domains, "PAUSED");
    const snapshot: CampaignSnapshot = { ...ctx.snapshot!, ...linked };
    const stock = evaluateCampaignInventory(row, { ...ctx, snapshot });
    const restored = confirmedRestock(prior, row, stock);
    if (!restored.length && (!history || changed)) return;
    const restock = restored.length ? `Reposição confirmada no destino deste anúncio: ${restored.slice(0, 4)
      .map(({ product, variant, stock }) => `${product} · ${variant} (0 → ${count.format(stock)} un.)`).join("; ")}. ` : "";
    const eligible = stock.scaleReady && Boolean(history);
    const reason = restock + (history
      ? `Em 30 dias fechados, ${row.name} teve ${history.row.spending.purchases} compras, ROAS ${mediaRoas(history.row.roas)} (referência ${mediaRoas(history.reference)}) e CPA ${currency.format(adCpa(history.row))}, contra ${currency.format(adCpa(history.peer))} de ${history.peer.name}, ativo no mesmo conjunto.`
      : "O histórico de desempenho e a comparação com o conjunto ainda não sustentam um novo teste.");
    const action = eligible
      ? "Testar a reativação no conjunto original com a verba atual. Medir CPA, ROAS e grade após 72 h."
      : history ? "Manter pausado até a grade e a cobertura do destino sustentarem um novo teste."
      : "Manter pausado. Acompanhar o desempenho dos anúncios ativos antes de retestar este criativo.";
    Object.assign(row, { recommendation: eligible ? "reactivate" : "reactivation-blocked", driver: reason, action,
      evaluation: { windows: campaignWindowPoints(reviews, row), inventory: stock, decision: "maintain", opportunity: true, reason, action } });
  }));
}
