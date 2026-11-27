import type { ManagerPeriod } from "./up-manager";
import type { CampaignEvaluation } from "./up-manager-campaign-evaluation";
import type { PaidMediaRow } from "./up-manager-paid-media";

const days = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
export function applyCampaignWatch(row: PaidMediaRow, currency: string) {
  const evaluation = row.evaluation;
  if (row.status !== "active" || !evaluation?.auction) return;
  const { auction, inventory } = evaluation;
  const product = inventory.products.find(({ grade }) => grade === "broken" || grade === "out_of_stock");
  const atRisk = inventory.products.find(({ grade, gradeDays }) => grade === "complete" && gradeDays != null && gradeDays <= 7);
  const knownComplete = inventory.unknownAds === 0 && inventory.products.length > 0 &&
    inventory.products.every(({ grade }) => grade === "complete");
  const prior = auction.before?.roas != null && auction.before.roas > 0 ? auction.before : auction.preceding;
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency });
  let watch: CampaignEvaluation["watch"];

  if (auction.trend === "recovery") {
    if (product) {
      watch = { kind: "grade", detail: `${product.name} já tem quebra de grade${product.missing.length ? ` em ${product.missing.slice(0, 4).join(", ")}` : ""}.`,
        action: "Acompanhar as compras e o saldo das variantes diariamente. Segurar a escala enquanto a grade estiver comprometida." };
    } else if (atRisk) {
      watch = { kind: "grade", detail: `${atRisk.name} tem grade completa. ${atRisk.firstSizeAtRisk ?? "A primeira variante"} pode zerar em ${days.format(atRisk.gradeDays!)} dias ao giro recente.`,
        action: "Acompanhar a grade diariamente e preparar um destino com disponibilidade antes de aumentar a verba." };
    } else if (row.recommendation !== "scale") {
      watch = { kind: "recovery", detail: knownComplete ? "A grade dos destinos vinculados segue completa." : "A cobertura de grade dos destinos ainda é parcial.",
        action: "Manter a verba durante a validação da recuperação. Reavaliar a escala com a próxima leitura de compras e estoque." };
    }
  }
  if (auction.trend === "decline" && knownComplete) {
    const cpm = prior?.cpm != null && auction.current.cpm != null ? ` CPM de ${money.format(prior.cpm)} para ${money.format(auction.current.cpm)}.` : "";
    watch = { kind: "decline", detail: `A grade confirmada dos destinos segue completa.${cpm}`,
      action: "Priorizar os fatores medidos no anúncio e no destino. Cruzar as datas de mudanças comerciais e os sinais do GA4 antes de atribuir a queda." };
  }

  if (!watch) return;
  evaluation.watch = watch;
  if (row.recommendation === "pause") return;
  if (watch.kind !== "decline" || row.recommendation === "maintain") {
    row.recommendation = "investigate";
    evaluation.decision = "investigate";
    row.scaleBudgets = undefined;
    row.action = evaluation.action = watch.action;
  }
  if (auction.summary) row.driver = evaluation.reason = auction.summary;
}

export type WatchPoint = { period: ManagerPeriod; roas: number; purchases: number; spend: number };
export function comparableWatchResult(before: WatchPoint, after: WatchPoint, eventDay: string) {
  return before.period.dateTo < eventDay && after.period.dateFrom > eventDay && before.spend > 0 && after.spend > 0;
}
