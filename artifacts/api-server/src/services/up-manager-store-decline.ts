import type { B2cFinding } from "./up-manager-b2c";
import type { compareCatalog } from "./up-manager-b2c-products";
import type { readFunnel, readOrderContext } from "./up-manager-b2c-data";
import type { explainProductRevenue } from "./up-manager-growth-decisions";
import type { FreightReport } from "./up-manager-shipping-insights";
import type { ManagerPeriod, readManagerOverview } from "./up-manager";

type Overview = Awaited<ReturnType<typeof readManagerOverview>>;
type Funnel = Awaited<ReturnType<typeof readFunnel>>;
type Orders = Awaited<ReturnType<typeof readOrderContext>>;
export type RevenueBridge = { orderVolume: number; ticket: number; traffic: number | null; ordersPerSession: number | null };

const count = new Intl.NumberFormat("pt-BR");
const pct = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 2 });
const ratio = (part: number, total: number) => total > 0 ? part / total : null;
const rate = (value: number | null) => value === null ? "indisponível" : pct.format(value);
const showDays = ({ dateFrom, dateTo }: ManagerPeriod) => dateFrom === dateTo ? dateTo : `${dateFrom} a ${dateTo}`;
const paidChannels = new Set(["Paid Social", "Paid Search", "Paid Shopping", "Paid Video", "Paid Other", "Display", "Cross-network"]);
const channelLabels: Record<string, string> = {
  "Paid Social": "Social Pago", "Organic Social": "Social Orgânico",
  "Paid Search": "Busca Paga", "Organic Search": "Busca Orgânica", Direct: "Direto",
};

function compareChannels(data: Funnel["channelComparison"]) {
  if (!data) return [];
  const afterByName = new Map(data.current.map((row) => [row.name, row]));
  return data.previous.flatMap((before) => {
    if (before.traffic < 20) return [];
    const current = afterByName.get(before.name) ?? { ...before, traffic: 0, purchases: 0, engaged: null };
    const bounce = (row: typeof before) => row.engaged !== null && row.engaged >= 0 && row.engaged <= row.traffic
      ? ratio(row.traffic - row.engaged, row.traffic) : null;
    const beforeRate = before.purchases / before.traffic;
    const currentRate = ratio(current.purchases, current.traffic);
    const sessionsLost = before.traffic - current.traffic;
    return [{ name: channelLabels[before.name] ?? before.name, paid: paidChannels.has(before.name), sessionsLost,
      purchaseLossFromTraffic: sessionsLost * beforeRate,
      purchaseLossFromRate: currentRate === null ? 0 : current.traffic * (beforeRate - currentRate),
      beforeRate, currentRate, before, current,
      beforeBounce: bounce(before), currentBounce: bounce(current) }];
  });
}

export function buildStoreDecline(input: {
  overview: Overview;
  bridge: RevenueBridge | null;
  funnel: Funnel;
  period: ManagerPeriod;
  reference: ManagerPeriod;
  currency: string;
  revenueContext: ReturnType<typeof explainProductRevenue> | null;
  catalogChanges: ReturnType<typeof compareCatalog>;
  couponChanges: number | null;
  shipping: FreightReport | null;
  orders: { previous: Orders; current: Orders };
  basketUnits: { previous: number; current: number };
}): B2cFinding | null {
  const { overview, bridge, funnel, period, reference, revenueContext, orders } = input;
  const { metrics, previous } = overview;
  const delta = metrics.approvedRevenue - previous.approvedRevenue;
  if (delta >= 0 || previous.approvedRevenue <= 0) return null;
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: input.currency });
  const value = (n: number | null) => n === null ? "indisponível" : money.format(n);
  const periods = `${showDays(reference)} → ${showDays(period)}`;
  const channels = compareChannels(funnel.channelComparison);
  const lostTraffic = channels.filter(({ sessionsLost }) => sessionsLost > 0).sort((a, b) =>
    b.purchaseLossFromTraffic - a.purchaseLossFromTraffic || b.sessionsLost - a.sessionsLost)[0];
  const lostPurchases = channels.filter(({ purchaseLossFromRate }) => purchaseLossFromRate > 0).sort((a, b) =>
    b.purchaseLossFromRate - a.purchaseLossFromRate)[0];
  const item = revenueContext?.declining[0];
  const hasSessions = funnel.current && funnel.previous && funnel.current.sessions > 0 && funnel.previous.sessions > 0;
  const components = [
    { name: "Ticket médio", impact: bridge?.ticket, key: "ticket" },
    { name: "Volume de sessões", impact: bridge?.traffic, key: "traffic" },
    { name: "Pedidos aprovados por sessão", impact: bridge?.ordersPerSession, key: "rate" },
    { name: "Volume de pedidos", impact: bridge?.traffic == null ? bridge?.orderVolume : null, key: "orders" },
  ];
  // Traffic and conversion can offset each other. Compare their net order effect
  // against the ticket before choosing which part of the drop to address.
  const primary = bridge && bridge.ticket < Math.min(0, bridge.orderVolume)
    ? components[0]
    : components.slice(1).filter(({ impact }) => impact != null && impact < 0)
      .sort((a, b) => a.impact! - b.impact!)[0];
  const smallSample = previous.orders < 5 || (metrics.orders > 0 && metrics.orders < 5);
  const evidence = `${money.format(previous.approvedRevenue)} → ${money.format(metrics.approvedRevenue)} (${pct.format(delta / previous.approvedRevenue)}). ${primary ? `O maior impacto estimado veio de ${primary.name.toLowerCase()} (${money.format(primary.impact!)}).` : "Os pedidos e o ticket estão disponíveis para comparação."}`;
  const factors = [{ label: "Volume e ticket da loja", detail: `${count.format(previous.orders)} → ${count.format(metrics.orders)} pedidos aprovados e ticket de ${value(previous.averageOrder)} → ${value(metrics.averageOrder)}. ${periods}.${smallSample ? " Amostra pequena de pedidos." : ""}` }];
  if (bridge) factors.push({ label: "Contribuições estimadas para a receita",
    detail: components.flatMap(({ name, impact }) => impact == null ? [] : [`${name}: ${money.format(impact)}`]).join(" · ") +
      (hasSessions ? ". A razão entre pedidos da loja e sessões do GA4 é uma aproximação agregada." : ".") });
  if (hasSessions && funnel.current && funnel.previous) {
    const before = funnel.previous;
    const after = funnel.current;
    factors.push({ label: "Tráfego e conversão no GA4", detail: `${count.format(before.sessions)} → ${count.format(after.sessions)} sessões. Compras GA4 por sessão ${rate(ratio(before.purchases, before.sessions))} → ${rate(ratio(after.purchases, after.sessions))}. Visualizações de produto por sessão ${rate(ratio(before.productViews, before.sessions))} → ${rate(ratio(after.productViews, after.sessions))}. Adições por visualização ${rate(ratio(before.addToCarts, before.productViews))} → ${rate(ratio(after.addToCarts, after.productViews))}.` });
  }
  for (const segment of new Set([lostTraffic, lostPurchases])) {
    if (!segment) continue;
    const { before, current, name, beforeRate, currentRate, beforeBounce, currentBounce } = segment;
    factors.push({ label: `${name} · canal GA4`, detail: `${count.format(before.traffic)} → ${count.format(current.traffic)} sessões, ${before.purchases} → ${current.purchases} compras e conversão de ${rate(beforeRate)} → ${rate(currentRate)}. Rejeição ${rate(beforeBounce)} → ${rate(currentBounce)} no recorte de origem e campanha.` });
  }
  const priorMedia = overview.reportMedia?.previous;
  const currentMedia = overview.reportMedia?.current;
  if (priorMedia && currentMedia) factors.push({ label: "Entrega na Meta", detail:
    `Verba ${money.format(priorMedia.spend)} → ${money.format(currentMedia.spend)}, cliques de link ${count.format(priorMedia.clicks)} → ${count.format(currentMedia.clicks)}, CPM ${value(priorMedia.cpm)} → ${value(currentMedia.cpm)}, CTR de link ${rate(priorMedia.ctr === null ? null : priorMedia.ctr / 100)} → ${rate(currentMedia.ctr === null ? null : currentMedia.ctr / 100)}, frequência ${priorMedia.frequency === null ? "indisponível" : count.format(priorMedia.frequency)} → ${currentMedia.frequency === null ? "indisponível" : count.format(currentMedia.frequency)}.` });
  if (item) factors.push({ label: "Produto com maior perda de receita", detail: `${item.name}: ${item.priorUnits} → ${item.units} unidades e ${money.format(item.deltaRevenue)} na receita de itens.` });
  const unitsPerOrder = (units: number, orders: number) => orders > 0 ? count.format(units / orders) : "indisponível";
  factors.push({ label: "Composição das compras", detail:
    `Unidades por pedido ${unitsPerOrder(input.basketUnits.previous, previous.orders)} → ${unitsPerOrder(input.basketUnits.current, metrics.orders)}. Receita de novos clientes ${money.format(orders.previous.newRevenue)} → ${money.format(orders.current.newRevenue)}. Receita de recorrentes ${money.format(orders.previous.returningRevenue)} → ${money.format(orders.current.returningRevenue)}. Desconto médio por pedido aprovado ${value(ratio(orders.previous.discount, orders.previous.approved))} → ${value(ratio(orders.current.discount, orders.current.approved))}.` });
  const changes = input.catalogChanges?.filter(({ changed }) => changed.some((change) => change.includes("Preço"))).length;
  const freight = input.shipping?.states.filter(({ price, delivery }) => [price, delivery]
    .some(({ material, direction }) => material && direction === "worsened")).slice(0, 4);
  if (changes || input.couponChanges || freight?.length) factors.push({ label: "Oferta e frete · sinais observados", detail: [
    changes ? `${changes} variantes com mudança de preço entre leituras do catálogo` : "",
    input.couponChanges ? `${input.couponChanges} mudanças de cupom entre leituras` : "",
    freight?.length ? `Piora em preço ou prazo de frete em ${freight.map(({ state }) => state).join(", ")} nas janelas semanais` : "",
  ].filter(Boolean).join(". ") + "." });

  const action = primary?.key === "ticket"
    ? `Testar uma vitrine ou combinação com ticket maior e grade disponível${item ? `, começando pela linha de ${item.name}` : ""}. Manter a oferta atual como comparação.`
    : primary?.key === "traffic"
      ? lostTraffic?.paid
        ? `Priorizar ${lostTraffic.name}. Comparar criativos, distribuição e custo por visita, preservando o destino atual durante o teste.`
        : `Priorizar ${lostTraffic?.name ?? "a origem que perdeu tráfego"}. Comparar quais páginas de entrada perderam sessões e recuperar exposição nos destinos que mais convertem.`
      : `Testar mensagem e página de destino em ${lostPurchases?.name ?? "um recorte com perda de compras"}${lostPurchases?.paid ? ", preservando público e verba" : ""}. Usar os itens de maior perda para escolher uma oferta comparável com grade disponível.`;
  const followUp = primary?.key === "ticket" ? "Comparar ticket, unidades e receita por pedido com o grupo de controle."
    : primary?.key === "traffic" ? `Comparar sessões qualificadas${lostTraffic?.paid ? ", custo por visita" : ""} e pedidos aprovados em janelas equivalentes.`
      : "Comparar compras por sessão, avanço para carrinho e pedidos aprovados com a página atual.";
  return {
    id: "store-revenue-decline", title: "O que puxou a queda de faturamento",
    section: "analysis", focus: "funnel",
    priority: smallSample || -delta < previous.approvedRevenue * 0.1 ? "P2" : "P1",
    evidence, hypothesis: evidence, action, owner: "E-commerce e mídia", followUp,
    diagnosis: { source: "loja", factors, action, followUp,
      unresolved: "As contribuições de receita são estimativas contábeis. O vínculo entre mudanças de oferta, frete ou mídia e a queda precisa de comparação no grupo exposto." },
  };
}
