import type { CheckoutDiagnosticData, CheckoutDiagnosis } from "./up-manager-funnel-diagnostic";
import type { readFunnel } from "./up-manager-b2c-data";

type Funnel = Awaited<ReturnType<typeof readFunnel>>;
const stageConfig = [
  { id: "sessions", label: "Sessões" },
  { id: "productViews", label: "Produto", event: "view_item", action: "Testar uma página de destino mais alinhada à oferta do anúncio e medir visualizações de produto por sessão." },
  { id: "addToCarts", label: "Carrinho", event: "add_to_cart", action: "Testar disponibilidade de tamanhos, preço e condições de entrega próximos ao botão de compra." },
  { id: "checkouts", label: "Checkout", event: "begin_checkout", action: "Testar frete e subtotal visíveis no carrinho e conferir o avanço ao checkout no celular." },
  { id: "purchases", label: "Compra no GA4", event: "purchase", action: "Testar Pix e cartão no checkout e cruzar compras do GA4 com a aprovação na loja para localizar a diferença." },
] as const;

export type FunnelStageResult = {
  id: (typeof stageConfig)[number]["id"];
  label: string;
  current: number | null;
  previous: number | null;
  rate: number | null;
  previousRate: number | null;
  movement: "entry" | "improved" | "worsened" | "stable" | "insufficient";
  reason: string;
  action: string;
  factors?: CheckoutDiagnosis["factors"];
  unresolved?: string;
};

const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });
const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const known = (value: string) => Boolean(value?.trim()) && !value.startsWith("(");
const labels: Record<string, string> = { "Paid Social": "Social Pago", "Organic Social": "Social Orgânico", "Paid Search": "Busca Paga", "Organic Search": "Busca Orgânica", Direct: "Direto" };

function strongestChannel(
  detail: CheckoutDiagnosticData, entryEvent: string, exitEvent: string,
  total: { currentBase: number; previousBase: number; currentExit: number; previousExit: number },
) {
  const byChannel = new Map<string, { current: number[]; previous: number[] }>();
  for (const row of detail.events) {
    if (row.event !== entryEvent && row.event !== exitEvent) continue;
    const item = byChannel.get(row.channel) ?? { current: [0, 0], previous: [0, 0] };
    item[row.period][row.event === entryEvent ? 0 : 1] += row.count;
    byChannel.set(row.channel, item);
  }
  const rows = [...byChannel.entries()];
  const sum = (period: "current" | "previous", index: number) => rows.reduce((value, [, pair]) => value + pair[period][index], 0);
  if (sum("current", 0) !== total.currentBase || sum("previous", 0) !== total.previousBase ||
    sum("current", 1) !== total.currentExit || sum("previous", 1) !== total.previousExit) return null;
  const losses = rows.flatMap(([channel, { current, previous }]) => {
    if (!known(channel) || Math.min(current[0], previous[0]) < 20 || current[1] > current[0] || previous[1] > previous[0]) return [];
    const before = previous[1] / previous[0];
    const after = current[1] / current[0];
    const loss = current[0] * before - current[1];
    return loss >= 1 ? [{ channel: labels[channel] ?? channel, before, after, loss }] : [];
  }).sort((a, b) => b.loss - a.loss);
  return losses[0] ?? null;
}

export function reportFunnelStages(
  funnel: Pick<Funnel, "current" | "previous">,
  detail: CheckoutDiagnosticData | null = null,
  checkout: CheckoutDiagnosis | null = null,
): FunnelStageResult[] {
  return stageConfig.map((item, index): FunnelStageResult => {
    const current = funnel.current?.[item.id] ?? null;
    const previous = funnel.previous?.[item.id] ?? null;
    const output = { id: item.id, label: item.label, current, previous };
    if (index === 0) {
      const comparable = current !== null && previous !== null;
      return { ...output, rate: null, previousRate: null, movement: comparable ? "entry" : "insufficient",
        reason: comparable ? `${decimal.format(previous)} → ${decimal.format(current)} sessões medidas no GA4. Esta é a entrada do funil.`
          : "Uma das janelas de sessões não tem cobertura no GA4.",
        action: comparable && current < previous
          ? "Concentrar a revisão nos canais responsáveis pela perda de sessões antes de ampliar a mídia."
          : "Acompanhar o volume e a qualidade da entrada até a próxima leitura." };
    }
    const entry = stageConfig[index - 1];
    const currentBase = funnel.current?.[entry.id] ?? null;
    const previousBase = funnel.previous?.[entry.id] ?? null;
    const density = index === 1;
    const rate = current !== null && currentBase !== null && currentBase > 0 && (density || current <= currentBase) ? current / currentBase : null;
    const previousRate = previous !== null && previousBase !== null && previousBase > 0 && (density || previous <= previousBase) ? previous / previousBase : null;
    const comparable = rate !== null && previousRate !== null && currentBase !== null && previousBase !== null &&
      currentBase >= 30 && previousBase >= 30;
    if (!comparable) {
      return { ...output, rate, previousRate, movement: "insufficient",
        reason: "A etapa precisa de 30 eventos de entrada em cada período e contagens compatíveis para diagnosticar uma queda.",
        action: "Acompanhar a próxima janela comparável e conferir os eventos desta etapa no GA4." };
    }
    const delta = rate - previousRate;
    const movement = delta <= -0.02 ? "worsened" : delta >= 0.02 ? "improved" : "stable";
    const quantitative = density
      ? `${decimal.format(previousRate)} → ${decimal.format(rate)} visualizações por sessão.`
      : `Taxa de avanço de ${percent.format(previousRate)} → ${percent.format(rate)}.`;
    if (movement !== "worsened") return { ...output, rate, previousRate, movement,
      reason: quantitative, action: movement === "improved"
        ? "Manter a configuração e conferir se a melhora se repete com volume comparável."
        : "Acompanhar na próxima análise." };
    if (item.id === "checkouts" && checkout) {
      return { ...output, rate, previousRate, movement, reason: checkout.factors[0]?.detail ?? quantitative,
        action: checkout.action, factors: checkout.factors, unresolved: checkout.unresolved };
    }
    const channel = detail && "event" in entry && "event" in item && current !== null && previous !== null
      ? strongestChannel(detail, entry.event, item.event, { currentBase, previousBase, currentExit: current, previousExit: previous })
      : null;
    return { ...output, rate, previousRate, movement,
      reason: channel ? `${channel.channel} concentrou a maior perda nos canais comparáveis (${percent.format(channel.before)} → ${percent.format(channel.after)}).`
        : `${quantitative} Os dados disponíveis localizam a perda nesta etapa. O fator causal ainda precisa de confirmação.`,
      action: "action" in item ? item.action : "Acompanhar a próxima leitura." };
  });
}
