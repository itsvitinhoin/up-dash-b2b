import type { ManagerAudienceStudy } from "./up-manager-audience-study";
import type { AudienceTest, BudgetAssessment } from "./up-manager-media-opportunities";
import type { CampaignEvaluation } from "./up-manager-campaign-evaluation";
import type { MetaAdMetric, MetaMarketingData } from "./meta-ads";
import type { CampaignSnapshot } from "./product-campaign-monitor";
import type { B2cFinding } from "./up-manager-b2c";
import type { ManagerPeriod } from "./up-manager";
import type { AuctionSeasonality } from "./up-manager-auction";

export type MediaLevel = "campaign" | "adset" | "ad";
export type MediaRecommendation = "pause" | "investigate" | "reduce" | "optimize" | "monitor" | "maintain" | "scale" | "reactivate" | "reactivation-blocked" | "unavailable";
export type MediaMetrics = { spend: number; revenue: number; purchases: number; clicks: number; impressions?: number | null; missingValue: number };
type Entity = { id: string; level: MediaLevel; name: string; campaignId: string; adsetId?: string; metrics: MediaMetrics };
type Benchmark = { label: string; roas: number; spend: number; purchases: number; revenue: number; clicks: number };
export type PaidMediaRow = {
  id: string;
  level: MediaLevel;
  name: string;
  parent: string | null;
  campaignId?: string;
  adsetId?: string;
  recommendation?: MediaRecommendation;
  status: "active" | "inactive" | "unknown";
  spending: MediaMetrics;
  roas: number | null;
  previousRoas: number | null;
  previousSpending?: MediaMetrics | null;
  pauseReason?: "stock" | "performance";
  pauseEvidence?: "critical-grade" | "recent" | "mature" | "multiWindow" | "sibling";
  comparisonAdId?: string;
  scaleBudgets?: BudgetAssessment[];
  evaluation?: CampaignEvaluation;
  benchmark: Benchmark | null;
  below: boolean;
  signal: "optimize" | "monitor" | "healthy" | "unavailable";
  driver: string;
  action: string;
};
export type PaidMediaReview = {
  window: ManagerPeriod;
  previousWindow: ManagerPeriod;
  recentWindow?: ManagerPeriod;
  multiWindowEnd?: string;
  reference: number | null;
  accountSpending?: MediaMetrics;
  auctionSeasonality?: AuctionSeasonality;
  agencyBenchmark?: { accounts: number; eligibleAccounts: number; medianRoas: number; window: ManagerPeriod } | null;
  attributedSpend: number;
  rows: PaidMediaRow[];
  missingValue: number;
  available: boolean;
  accountPriceComparable: boolean;
  audienceTests?: AudienceTest[];
  audienceStudy?: ManagerAudienceStudy;
};

export const mediaLevelLabels = { campaign: "Campanha", adset: "Conjunto", ad: "Anúncio" };
const salesObjectives = new Set(["OUTCOME_SALES", "CONVERSIONS", "WEBSITE_CONVERSIONS", "PRODUCT_CATALOG_SALES"]);
const empty: MediaMetrics = { spend: 0, revenue: 0, purchases: 0, clicks: 0, impressions: 0, missingValue: 0 };
const valid = (value?: string): value is string => Boolean(value && /^\d+$/.test(value));
const ratio = (numerator: number, denominator: number) => denominator > 0 ? numerator / denominator : null;
const roas = (metrics: MediaMetrics) => metrics.missingValue ? null : ratio(metrics.revenue, metrics.spend);
const standard = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
export const mediaRoas = (value: number | null) => value === null ? "indisponível" : `${standard.format(value)}×`;
const keyOf = ({ level, id }: Pick<Entity, "level" | "id">) => `${level}:${id}`;

function add(a: MediaMetrics, b: MediaMetrics): MediaMetrics {
  return {
    spend: a.spend + b.spend, revenue: a.revenue + b.revenue, purchases: a.purchases + b.purchases,
    clicks: a.clicks + b.clicks, missingValue: a.missingValue + b.missingValue,
    impressions: a.impressions != null && b.impressions != null ? a.impressions + b.impressions : null,
  };
}

function safeMetrics(row: MetaAdMetric): MediaMetrics {
  return {
    spend: row.spend, revenue: row.revenue, purchases: row.purchases, clicks: row.clicks, impressions: row.impressions > 0 ? row.impressions : null,
    missingValue: row.purchases > 0 && row.revenue <= 0 ? 1 : 0,
  };
}

function entities(media: MetaMarketingData | null, salesCampaigns: Set<string>) {
  const entities = new Map<string, Entity>();
  const push = (entity: Entity) => {
    const key = keyOf(entity);
    const known = entities.get(key);
    if (known) known.metrics = add(known.metrics, entity.metrics);
    else entities.set(key, entity);
  };
  for (const row of media?.ads ?? []) {
    if (!valid(row.id) || !valid(row.campaignId) || !salesCampaigns.has(row.campaignId) || row.spend <= 0) continue;
    const metrics = safeMetrics(row);
    const campaignId = row.campaignId;
    const adsetId = valid(row.adsetId) ? row.adsetId : undefined;
    push({ id: row.id, level: "ad", name: row.name, campaignId, adsetId, metrics });
    if (adsetId) push({ id: adsetId, level: "adset", name: row.adsetName || adsetId, campaignId, adsetId, metrics });
    push({ id: campaignId, level: "campaign", name: row.campaignName || campaignId, campaignId, metrics });
  }
  return entities;
}

function benchmarkFor(entity: Entity, list: Entity[]): Benchmark | null {
  const peer = (candidates: Entity[], label: string): Benchmark | null => {
    const references = candidates.filter((item) => item.id !== entity.id && !item.metrics.missingValue);
    const total = references.reduce((running, row) => add(running, row.metrics), empty);
    if (total.spend <= 0 || total.revenue <= 0 || total.purchases < 3) return null;
    return { label, roas: total.revenue / total.spend, ...total };
  };
  if (entity.level === "ad") {
    const own = entity.adsetId && peer(list.filter((x) => x.level === "ad" && x.adsetId === entity.adsetId), "Outros anúncios do conjunto");
    if (own) return own;
  }
  if (entity.level === "adset") {
    const own = peer(list.filter((x) => x.level === "adset" && x.campaignId === entity.campaignId), "Outros conjuntos da campanha");
    if (own) return own;
  }
  const rest = list.filter((x) => x.level === "campaign" && x.campaignId !== entity.campaignId);
  return peer(rest, "Outras campanhas de venda da conta");
}

function diagnose(metrics: MediaMetrics, peer: Benchmark, money: Intl.NumberFormat) {
  const cpc = ratio(metrics.spend, metrics.clicks);
  const peerCpc = ratio(peer.spend, peer.clicks);
  const cvr = ratio(metrics.purchases, metrics.clicks);
  const peerCvr = ratio(peer.purchases, peer.clicks);
  const ticket = ratio(metrics.revenue, metrics.purchases);
  const peerTicket = ratio(peer.revenue, peer.purchases);
  const signals: { impact: number; evidence: string; action: string }[] = [];
  if (cpc && peerCpc && metrics.clicks >= 20 && cpc > peerCpc * 1.2) {
    signals.push({
      impact: cpc / peerCpc,
      evidence: `O clique de link custa ${money.format(cpc)} contra ${money.format(peerCpc)} na referência.`,
      action: "Testar uma abertura e uma oferta diferentes no criativo. Manter o teste no mesmo público para medir o custo por clique.",
    });
  }
  if (cvr !== null && peerCvr && metrics.clicks >= 20 && cvr < peerCvr * 0.8) {
    signals.push({
      impact: peerCvr / Math.max(cvr, 0.002),
      evidence: `${metrics.purchases} compras atribuídas em ${metrics.clicks} cliques de link, abaixo da relação observada nos pares.`,
      action: "Testar uma versão do anúncio com a oferta e o preço já visíveis. Medir compras por clique antes de ampliar a entrega.",
    });
  }
  if (ticket && peerTicket && metrics.purchases >= 4 && ticket < peerTicket * 0.8) {
    signals.push({
      impact: peerTicket / ticket,
      evidence: `O valor atribuído por compra é ${money.format(ticket)} contra ${money.format(peerTicket)} na referência.`,
      action: "Testar um produto ou combinação de maior valor no mesmo público e acompanhar o valor atribuído por compra.",
    });
  }
  return signals.sort((a, b) => b.impact - a.impact)[0];
}

export function buildPaidMediaReview({
  current, previous, snapshot, currency, window, previousWindow,
}: {
  current: MetaMarketingData | null;
  previous: MetaMarketingData | null;
  snapshot: CampaignSnapshot | null;
  currency: string;
  window: ManagerPeriod;
  previousWindow: ManagerPeriod;
}): PaidMediaReview {
  const objective = new Map<string, string>();
  for (const metric of [...(previous?.ads ?? []), ...(current?.ads ?? [])]) {
    if (metric.campaignId && metric.objective) objective.set(metric.campaignId, metric.objective);
  }
  const sales = new Set([...objective].filter(([, value]) => salesObjectives.has(value)).map(([id]) => id));
  const actual = [...entities(current, sales).values()];
  const baseline = entities(previous, sales);
  const historical = [...baseline.values()];
  const all = actual.filter((item) => item.level === "campaign").reduce((sum, row) => add(sum, row.metrics), empty);
  const accountRoas = roas(all);
  const runningAds = new Map<string, string | null>();
  const runningParents = new Set<string>();
  for (const [ads, blocked] of [
    ...(snapshot?.rows.map((row) => [row.ads, row.grade === "out_of_stock" || row.unavailable ? row.name : null] as const) ?? []),
    ...(snapshot?.unidentified.map(({ ad }) => [[ad], null] as const) ?? []),
  ]) {
    for (const ad of ads) {
      if (!runningAds.has(ad.id) || blocked) runningAds.set(ad.id, blocked);
      if (ad.adsetId) runningParents.add(`adset:${ad.adsetId}`);
      if (ad.campaignId) runningParents.add(`campaign:${ad.campaignId}`);
    }
  }
  const currencyOk = snapshot?.currency === currency;
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency });
  const index = new Map(actual.map((row) => [keyOf(row), row.name]));
  const statusByCampaign = new Map(current?.campaigns.map((row) => [row.id, row.status]));
  const rows = actual.map((entity): PaidMediaRow => {
    const key = keyOf(entity);
    const prior = baseline.get(key);
    const historicalPeer = prior && benchmarkFor(prior, historical);
    const peer = benchmarkFor(entity, actual);
    const currentRoas = roas(entity.metrics);
    const previousRoas = prior ? roas(prior.metrics) : null;
    const below = currentRoas !== null && peer !== null && currentRoas < peer.roas;
    const active = entity.level === "ad" ? runningAds.has(entity.id) : runningParents.has(key);
    const campaign = statusByCampaign.get(entity.campaignId);
    const campaignIsActive = entity.level === "campaign" && campaign === "ACTIVE";
    const notDelivering = Boolean(snapshot || (campaign && campaign !== "ACTIVE" && campaign !== "UNKNOWN"));
    const status = active || campaignIsActive ? "active" : notDelivering ? "inactive" : "unknown";
    const threshold = peer ? peer.spend / peer.purchases : Infinity;
    const persisted = previousRoas !== null && historicalPeer && previousRoas < historicalPeer.roas * 0.9;
    const material = peer && currentRoas !== null && currentRoas <= peer.roas * 0.85 &&
      (entity.metrics.purchases >= 4 || entity.metrics.spend >= threshold * 2);
    const zeroAcrossWindows = entity.metrics.purchases === 0 && entity.metrics.spend >= threshold * 3 &&
      prior && prior.metrics.purchases === 0 && prior.metrics.spend >= threshold;
    const optimize = Boolean(below && status === "active" && currencyOk && material && (persisted || zeroAcrossWindows));
    const explanation = below && peer && currencyOk ? diagnose(entity.metrics, peer, money) : undefined;
    const blocked = entity.level === "ad" ? runningAds.get(entity.id) : null;
    const parent = entity.level === "adset"
      ? index.get(`campaign:${entity.campaignId}`) ?? null
      : entity.level === "ad" && entity.adsetId
        ? index.get(`adset:${entity.adsetId}`) ?? null : null;
    const driver = currentRoas === null
      ? "A Meta registrou compras sem valor atribuído suficiente para calcular o ROAS."
      : peer === null ? "Os pares disponíveis têm poucas compras atribuídas para formar uma referência."
        : blocked ? `O destino de ${blocked} tem indisponibilidade confirmada.`
          : explanation?.evidence ?? (below
            ? "O valor de compra atribuído por real investido ficou abaixo da referência ponderada."
            : "O retorno atribuído atingiu a referência desta janela.");
    const action = optimize
      ? blocked
        ? `Aprovar a revisão deste anúncio e direcionar a oferta às variantes disponíveis de ${blocked}.`
        : zeroAcrossWindows
          ? "Revisar a pausa deste item com o gestor. Houve investimento sem compras em duas janelas fechadas."
          : explanation?.action ?? "Testar reduzir a entrega neste item em até 10% e concentrar a distribuição em pares com melhor resultado. Rever em sete dias."
      : below
        ? status === "inactive" ? "Registrar o resultado para orientar futuras reativações."
          : "Acompanhar a próxima janela madura. Manter a decisão de verba em revisão até confirmar volume e persistência."
        : "Manter acompanhamento na rotina diária.";
    const signal = optimize ? "optimize" : below ? "monitor" : currentRoas !== null && peer ? "healthy" : "unavailable";
    const recommendation = signal === "healthy" ? "maintain"
      : optimize && zeroAcrossWindows && accountRoas !== null && accountRoas > 0 ? "pause" : signal;
    return {
      id: entity.id, level: entity.level, name: entity.name, parent, status,
      campaignId: entity.campaignId, adsetId: entity.adsetId, recommendation,
      spending: entity.metrics, roas: currentRoas, previousRoas, previousSpending: prior?.metrics ?? null, benchmark: peer, below,
      pauseReason: recommendation === "pause" ? "performance" : undefined,
      pauseEvidence: recommendation === "pause" ? "mature" : undefined,
      signal, driver, action,
    };
  }).sort((a, b) => b.spending.spend - a.spending.spend);
  return { window, previousWindow, reference: accountRoas, accountSpending: all, attributedSpend: all.spend, rows, missingValue: all.missingValue, available: current !== null && sales.size > 0, accountPriceComparable: currencyOk };
}

export function verifiedPerformancePause(row: PaidMediaRow | undefined, averageRoas: number | null = null) {
  const peer = row?.benchmark;
  const prior = row?.previousSpending;
  if (!row || !row.below || !peer || !prior || peer.purchases < 3 || averageRoas === null || averageRoas <= 0 || row.roas === null || row.roas >= averageRoas) return false;
  const cpa = peer.spend / peer.purchases;
  return cpa > 0 && row.spending.purchases === 0 && row.spending.spend >= cpa * 3 &&
    prior.purchases === 0 && prior.spend >= cpa;
}

export function verifiedRecentPause(row: PaidMediaRow | undefined, recent: PaidMediaRow | undefined, averageRoas: number | null) {
  const peer = row?.benchmark;
  if (!row || !recent || !peer || peer.purchases < 3 || averageRoas === null || averageRoas <= 0 ||
    row.roas === null || recent.roas === null) return false;
  const roasFloor = Math.min(averageRoas, peer.roas) * 0.7;
  const cpa = peer.spend / peer.purchases;
  if (cpa <= 0 || row.roas >= Math.min(averageRoas, peer.roas)) return false;
  const noRecentPurchases = recent.spending.purchases === 0 && recent.spending.spend >= cpa * 2;
  const weakInBoth = recent.spending.purchases > 0 && row.roas <= roasFloor && recent.roas <= roasFloor &&
    row.spending.spend >= cpa * 2 && recent.spending.spend >= cpa;
  return noRecentPurchases || weakInBoth;
}

export function applyRecentPauseReview(review: PaidMediaReview, recent: PaidMediaReview, currency: string) {
  const recentRows = new Map(recent.rows.map((row) => [`${row.level}:${row.id}`, row]));
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency });
  return review.rows.map((row): PaidMediaRow => {
    const current = recentRows.get(`${row.level}:${row.id}`);
    if (!current || row.status !== "active" || !review.accountPriceComparable ||
      !verifiedRecentPause(row, current, review.reference)) return row;
    const spend = money.format(current.spending.spend);
    const account = mediaRoas(review.reference);
    const peer = mediaRoas(row.benchmark?.roas ?? null);
    return { ...row, recommendation: "pause", pauseReason: "performance", pauseEvidence: "recent",
      driver: current.spending.purchases === 0
        ? `Nos últimos dois dias fechados, gastou ${spend} sem compras atribuídas. Na janela de referência, ROAS ${mediaRoas(row.roas)} frente a ${account} da conta e ${peer} dos pares.`
        : `ROAS de ${mediaRoas(current.roas)} nos últimos dois dias fechados e ${mediaRoas(row.roas)} na janela de referência, abaixo de ${account} da conta e ${peer} dos pares. Investiu ${spend} no recorte recente.`,
      action: "Desativar na Meta após confirmar o desempenho mais recente. Preservar a verba para os itens que seguem sustentando compras.",
    };
  });
}

function isDescendant(row: PaidMediaRow, parent: PaidMediaRow) {
  if (parent.level === "campaign") return row.level !== "campaign" && row.campaignId === parent.id;
  return parent.level === "adset" && row.level === "ad" && row.adsetId === parent.id && row.campaignId === parent.campaignId;
}

export function hasHealthyMediaDescendant(parent: PaidMediaRow, rows: PaidMediaRow[]) {
  const benchmark = parent.benchmark;
  return benchmark !== null && rows.some((child) => isDescendant(child, parent) && child.status !== "inactive" &&
    child.roas !== null && child.roas >= benchmark.roas && child.spending.purchases >= 3);
}

export function resolveMediaActions(rows: PaidMediaRow[]) {
  const active = rows.filter(({ status }) => status === "active");
  const eligible = active.filter((row) => row.recommendation === "pause" &&
    (row.pauseReason === "stock" || !hasHealthyMediaDescendant(row, active)));
  const pauses = eligible.filter((row) => !eligible.some((parent) => isDescendant(row, parent)));
  const paused = new Set(pauses.map(({ level, id }) => `${level}:${id}`));
  const scales = active.filter((row) => row.recommendation === "scale" &&
    !pauses.some((pause) => isDescendant(row, pause) || isDescendant(pause, row)));
  const owners = new Set<string>();
  const scalable = new Set(scales.filter((row) => !scales.some((parent) => isDescendant(row, parent)))
    .sort((a, b) => Number(b.level === "adset") - Number(a.level === "adset") || b.spending.purchases - a.spending.purchases)
    .flatMap(({ level, id, scaleBudgets }) => {
      const keys = scaleBudgets?.filter(({ blockers }) => !blockers.length).map(({ ownerId }) => ownerId) ?? [];
      if (keys.length && keys.every((key) => owners.has(key))) return [];
      keys.forEach((key) => owners.add(key));
      return [`${level}:${id}`];
    }));
  return rows.map((row): PaidMediaRow => {
    if (row.recommendation === "pause" && !paused.has(`${row.level}:${row.id}`)) return { ...row, recommendation: "monitor" };
    if (row.recommendation === "scale" && !scalable.has(`${row.level}:${row.id}`)) return { ...row, recommendation: "monitor" };
    return row;
  });
}

export function scaleStockConfirmed(snapshot: CampaignSnapshot | null, campaignId: string) {
  if (!snapshot || (snapshot.warnings?.length ?? 0) > 0 ||
    snapshot.unidentified.some(({ ad }) => ad.campaignId === campaignId)) return false;
  const products = snapshot.rows.filter(({ ads }) => ads.some((ad) => ad.campaignId === campaignId));
  return products.length > 0 && products.every((row) =>
    row.grade === "complete" && !row.unavailable && row.publicationConfirmed,
  );
}

export function buildPaidMediaFinding(review: PaidMediaReview): B2cFinding | null {
  const actions = review.rows.filter((row) => (row.status === "active" && (row.recommendation === "pause" || row.recommendation === "scale")) ||
    row.recommendation === "reactivate");
  const evaluated = review.rows.filter((row) => row.level === "campaign" && row.status === "active" && row.evaluation);
  const attention = review.rows.filter((row) => row.status === "active" && row.recommendation === "investigate");
  if (!actions.length && !attention.length && evaluated.length) {
    const first = [...evaluated].sort((a, b) => Number(Boolean(b.evaluation?.opportunity)) - Number(Boolean(a.evaluation?.opportunity)))[0];
    const stock = evaluated.filter((row) => row.evaluation?.inventory.products.some((product) => product.grade === "broken" || product.grade === "out_of_stock"));
    return {
      id: "paid-media-roas", title: "Diagnóstico de campanhas · 30 / 14 / 7 / 3 dias",
      section: "campaigns", focus: "campaigns", priority: stock.length ? "P1" : "P2",
      evidence: `${evaluated.length} campanhas ativas analisadas. ${first.name}: ${first.evaluation!.reason}`,
      hypothesis: `${evaluated.length} para manter · ${stock.length} com quebra verificada nos destinos.`,
      action: first.evaluation!.action, owner: "Gestão de mídia",
      followUp: "Rever o giro, a grade e o desempenho no próximo diagnóstico.",
    };
  }
  if (!actions.length && !attention.length) return null;
  const paused = actions.filter(({ recommendation }) => recommendation === "pause");
  const scaling = actions.filter(({ recommendation }) => recommendation === "scale");
  const reactivation = actions.filter(({ recommendation }) => recommendation === "reactivate");
  const first = paused[0] ?? attention.find(({ level }) => level === "campaign") ?? attention[0] ?? scaling[0] ?? reactivation[0];
  const recommendations = [...paused, ...attention, ...scaling, ...reactivation];
  const factors = recommendations.slice(0, 8).map((row) => ({
    label: `${row.recommendation === "pause" ? "Desativar" : row.recommendation === "investigate" ? "Investigar" : row.recommendation === "scale" ? "Escalar" : "Testar reativação"} · ${row.name}`,
    detail: row.driver,
  })).concat(first.evaluation?.diagnosis?.factors ?? []);
  const action = `Começar por ${first.name}. ${first.action}`;
  return {
    id: "paid-media-roas", title: attention.length ? "Campanhas e anúncios que exigem atenção" : "Ações recomendadas na Meta",
    section: "campaigns", focus: "campaigns", priority: paused.length || attention.length ? "P1" : "P2",
    evidence: `${first.name}. ${first.evaluation?.auction?.summary ?? first.driver}`,
    hypothesis: `${paused.length} para desativar · ${attention.length} para investigar · ${scaling.length} para escalar · ${reactivation.length} para testar reativação.`,
    action, owner: "Gestão de mídia",
    followUp: "Medir compras, ROAS e CPA na próxima janela madura e cruzar com o funil da loja.",
    diagnosis: { source: "meta", factors, action, followUp: "Verificar o resultado após a mudança.",
      unresolved: "Os comparativos identificam em que etapa ou anúncio a perda se concentrou. A causa técnica depende das evidências ligadas ao anúncio e à loja." },
  };
}
