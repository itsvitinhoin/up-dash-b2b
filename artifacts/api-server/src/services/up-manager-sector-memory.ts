import { addDaysToDateOnly } from "../lib/reporting-period";
import { comparableWatchResult, type WatchPoint } from "./up-manager-campaign-watch";
import type { buildB2cReport } from "./up-manager-b2c";

type Result = Awaited<ReturnType<typeof buildB2cReport>>;
type Sector = "Campanhas" | "Criativos" | "Estoque" | "Comercial" | "Funil" | "Frete" | "Aquisição" | "Retenção" | "Públicos";
type Measure = {
  sector: Sector; subject: string; metric: string;
  before: number | null; after: number | null;
  unit: "money" | "cents" | "ratio" | "percent" | "days" | "count";
  direction: "improved" | "worsened" | "stable" | "unavailable";
  context: string;
};
type Event = {
  id: string; sector: Sector; subject: string; day: string;
  source: "meta" | "nuvemshop" | "braavo" | "freight"; detail: string;
  variantKey?: string; previousStock?: number | null;
  result?: { observedOn: string; stock: number };
};
type CampaignImpact = {
  id: string; campaignId: string; campaign: string; day: string; change: string; leading?: boolean;
  before: WatchPoint | null; after?: WatchPoint;
};
type PriorMemory = { events?: Event[]; campaignImpacts?: CampaignImpact[] };

export function buildManagerSectorMemory(
  { report, snapshot, overview, matureCampaigns }: Result, day: string, previousPayload?: Record<string, unknown>,
) {
  const previousReport = previousPayload?.b2c as { sectorMemory?: PriorMemory; product?: { inventory?: { countedUnits?: number } } } | undefined;
  const measures: Measure[] = [];
  function add(sector: Sector, subject: string, metric: string, before: number | null | undefined,
    after: number | null | undefined, unit: Measure["unit"], context: string, higherIsBetter = true) {
    const current = after != null && Number.isFinite(after) ? after : null;
    const prior = before != null && Number.isFinite(before) ? before : null;
    const change = current === null || prior === null ? null : (current - prior) * (higherIsBetter ? 1 : -1);
    measures.push({ sector, subject, metric, before: prior, after: current, unit, context,
      direction: change === null ? "unavailable" : Math.abs(change) < 1e-8 ? "stable" : change > 0 ? "improved" : "worsened" });
  }
  const review = report.media.roasReview;
  const mediaContext = `${review.previousWindow.dateFrom} a ${review.previousWindow.dateTo} → ${review.window.dateFrom} a ${review.window.dateTo}`;
  const previousCampaigns = review.rows.filter((row) => row.level === "campaign" && row.previousSpending);
  const spend = previousCampaigns.reduce((sum, row) => sum + (row.previousSpending?.spend ?? 0), 0);
  const revenue = previousCampaigns.reduce((sum, row) => sum + (row.previousSpending?.revenue ?? 0), 0);
  const comparable = previousCampaigns.length === review.rows.filter(({ level }) => level === "campaign").length &&
    previousCampaigns.every(({ previousSpending }) => !previousSpending?.missingValue);
  add("Campanhas", "Vendas Meta", "ROAS ponderado", comparable && spend > 0 ? revenue / spend : null,
    review.reference, "ratio", `${mediaContext} · Campanhas comparáveis na leitura atual`);
  if (review.auctionSeasonality) {
    const { current, baseline, previousYear, event } = review.auctionSeasonality;
    const scope = event ? ` · ${event.name}` : "";
    add("Campanhas", "Leilão da conta", "CPM Meta", baseline?.cpm, current?.cpm, "money", `Sete dias comparados à semana equivalente quatro semanas antes${scope}.`, false);
    if (previousYear) add("Campanhas", "Leilão da conta", "CPM Meta · ano anterior", previousYear.cpm, current?.cpm,
      "money", `Janela comparável do ano anterior${scope}.`, false);
  }
  for (const row of review.rows.filter((item) => item.level === "campaign" && item.evaluation?.comparison).slice(0, 12)) {
    const comparison = row.evaluation!.comparison!;
    add("Campanhas", row.name, "ROAS atribuído", comparison.previousRoas, comparison.currentRoas, "ratio", row.evaluation!.reason);
    add("Campanhas", row.name, "Compras atribuídas", comparison.previousPurchases, comparison.currentPurchases, "count", "Duas semanas fechadas sem sobreposição.");
  }
  for (const creative of report.media.creativeReview.creatives.filter((row) => row.best || row.recommendations.length).slice(0, 12)) {
    add("Criativos", creative.name, "CPA Meta", creative.previous?.cpa, creative.current?.cpa, "money", `${mediaContext} · Anúncios agrupados pelo criativo atual`, false);
  }
  add("Estoque", "Catálogo", "Unidades com saldo, preço e publicação confirmados", previousReport?.product?.inventory?.countedUnits,
    report.product.inventory?.countedUnits, "count", "Leituras do catálogo entre diagnósticos.");
  add("Comercial", "Loja", "Faturamento aprovado", report.scope.commerceConfirmed ? overview.previous.approvedRevenue : null,
    report.scope.commerceConfirmed ? overview.metrics.approvedRevenue : null, "money", report.scope.comparison);
  for (const stage of report.cro.evaluation.stages.filter(({ id }) => id !== "sessions")) {
    const valid = stage.movement !== "insufficient";
    add("Funil", stage.label, stage.id === "productViews" ? "Visualizações por sessão" : "Avanço de etapa",
      valid ? stage.previousRate : null, valid ? stage.rate : null, stage.id === "productViews" ? "ratio" : "percent", stage.reason);
  }
  for (const row of report.cro.shipping?.states ?? []) {
    for (const [unit, label, metric] of [["cents", "Frete médio cobrado", row.price], ["days", "Prazo médio prometido", row.delivery]] as const) {
      const valid = metric.direction !== "small-sample" && metric.direction !== "unavailable";
      add("Frete", row.state, label, valid ? metric.previous.average : null, valid ? metric.current.average : null,
        unit, metric.reasons.join(" ") || "Pedidos pagos em duas janelas de sete dias.", false);
    }
  }
  const payment = report.cro.evaluation.payment;
  if (payment) {
    const rate = ({ created, approved }: typeof payment.current) => created >= 10 ? approved / created : null;
    add("Funil", "Pagamento", "Taxa de aprovação de pedidos", rate(payment.previous), rate(payment.current), "percent",
      "Aprovação observada nos pedidos. Mudanças de regras e falhas de gateway exigem evidência do checkout.");
  }
  const acquisition = report.acquisition.comparison;
  add("Aquisição", "Loja", "CAC combinado", acquisition.priorMetrics.cac, acquisition.metrics.cac,
    "money", mediaContext, false);
  add("Retenção", "Loja", "Taxa de recompra", acquisition.priorMetrics.repeatRate === null ? null : acquisition.priorMetrics.repeatRate / 100,
    acquisition.metrics.repeatRate === null ? null : acquisition.metrics.repeatRate / 100, "percent", mediaContext);

  const catalogSource = report.commercePlatform === "BRAAVO" ? "braavo" : "nuvemshop";
  const freightEvents: Event[] = (report.cro.shipping?.states ?? []).flatMap(({ state, price, delivery }) =>
    ([["Preço de frete", price], ["Prazo prometido", delivery]] as const).flatMap(([metric, value]) => {
      if (!value.material || value.delta == null) return [];
      const display = metric === "Preço de frete"
        ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: report.currency }).format(value.delta / 100)
        : `${Number(value.delta.toFixed(1)).toLocaleString("pt-BR")} dias úteis`;
      return [{ id: `freight:${report.cro.shipping!.currentWindow.dateTo}:${state}:${metric}`, sector: "Frete" as const,
        subject: `${state} · ${metric}`, day, source: "freight" as const,
        detail: `${value.direction === "worsened" ? "Piora" : "Melhora"} de ${display}. ${value.reasons.join(" ")}` }];
    }));
  const fresh: Event[] = [
    ...freightEvents,
    ...report.media.learning.events.map((event): Event => ({
      id: `meta:${event.level}:${event.id}:${event.changedAt}:${event.title}`,
      sector: event.title.toLowerCase().includes("criativo") ? "Criativos" : event.level === "audience" || event.title.toLowerCase().includes("público") ? "Públicos" : "Campanhas",
      subject: event.name, day: event.day, source: "meta", detail: [event.title, event.detail].filter(Boolean).join(" · "),
    })),
    ...(report.commercial.catalog ?? []).map((item): Event => ({
      id: `catalog:${day}:${item.key}`,
      sector: item.changed.some((change) => change.includes("Preço")) ? "Comercial" : "Estoque",
      subject: [item.name, item.options].filter(Boolean).join(" · "), day, source: catalogSource, detail: item.changed.join(" · "),
      variantKey: item.key, previousStock: item.before?.stock,
    })),
    ...(report.commercial.coupons ?? []).map((item): Event => ({
      id: `coupon:${day}:${item.id}`,
      sector: item.freeShipping ? "Frete" : "Comercial", subject: "Cupom da loja", day, source: "nuvemshop",
      detail: { entered: "Cupom entrou no conjunto de regras observado", left: "Cupom saiu do conjunto de regras observado", changed: "Regra de cupom alterada" }[item.status] ?? "Mudança na regra observada",
    })),
  ];
  const stocks = new Map(snapshot.catalog?.map(({ key, stock }) => [key, stock]) ?? []);
  const cutoff = addDaysToDateOnly(day, -30);
  const combined = new Map(previousReport?.sectorMemory?.events?.filter((event) => event.day >= cutoff).map((event) => [event.id, event]));
  for (const event of fresh) if (!combined.has(event.id)) combined.set(event.id, event);
  const events = [...combined.values()].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 180).map((event) => {
    if (event.result || event.sector !== "Estoque" || !event.variantKey || addDaysToDateOnly(event.day, 7) > day) return event;
    const stock = stocks.get(event.variantKey);
    return stock == null ? event : { ...event, result: { observedOn: day, stock } };
  });
  const campaigns = review.rows.filter(({ level, evaluation }) => level === "campaign" && evaluation);
  const leading = new Set(report.product.abc14.products.filter(({ abc }) => abc === "A").map(({ id }) => id));
  const impacts = new Map(previousReport?.sectorMemory?.campaignImpacts?.filter((item) => item.day >= cutoff).map((item) => [item.id, item]));
  const matureById = new Map(matureCampaigns.map((row) => [row.id, row]));
  for (const row of campaigns) {
    const mature = matureById.get(row.id);
    const point = mature?.roas != null && !mature.spending.missingValue
      ? { period: mature.period, roas: mature.roas, spend: mature.spending.spend, purchases: mature.spending.purchases } : null;
    const register = (key: string, change: string, isLeading?: boolean) => {
      const id = `${key}:${row.id}`;
      if (!impacts.has(id)) impacts.set(id, { id, campaignId: row.id, campaign: row.name, day, change, leading: isLeading,
        before: point && point.period.dateTo < day ? point : null });
    };
    for (const item of report.commercial.catalog ?? []) {
      if (!item.before || !item.after || item.after.published !== true) continue;
      if (!row.evaluation!.inventory.products.some(({ variants }) => variants.some(({ id }) => id === item.key))) continue;
      const material = item.changed.filter((change) => change === "Variante esgotada" || change === "Variante reabastecida" || change.includes("Preço"));
      if (material.length) register(`catalog:${day}:${item.key}`, `${item.name} · ${item.options} · ${material.join(" · ")}`, leading.has(item.after.productId));
    }
    for (const item of report.commercial.coupons ?? []) {
      if (row.evaluation!.watch?.kind !== "decline") continue;
      register(`coupon:${day}:${item.id}`, "Mudança de cupom observada na loja. A associação com a campanha ainda precisa de evidência.");
    }
    if (row.evaluation!.watch?.kind === "decline") {
      for (const event of freightEvents.filter(({ detail }) => detail.startsWith("Piora")).slice(0, 3)) {
        register(event.id, `${event.subject} · ${event.detail} Variação no histórico da loja.`);
      }
    }
    if (point) {
      for (const entry of impacts.values()) {
        if (entry.campaignId === row.id && entry.before && !entry.after && comparableWatchResult(entry.before, point, entry.day)) entry.after = point;
      }
    }
  }
  const campaignImpacts = [...impacts.values()].sort((a, b) => b.day.localeCompare(a.day) || Number(Boolean(b.leading)) - Number(Boolean(a.leading))).slice(0, 180);
  return { observedOn: day, measures, events, campaignImpacts, observedChanges: fresh.length };
}
