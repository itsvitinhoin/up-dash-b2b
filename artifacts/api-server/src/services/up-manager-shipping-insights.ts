import { addDaysToDateOnly, saoPauloDateOnlyStart } from "../lib/reporting-period";
import { readBraavoManagerFreight } from "./up-manager-braavo";
import { fetchManagerOrderShipping, type NuvemOrderShipping } from "./product-campaign-sources";
import type { B2cFinding } from "./up-manager-b2c";
import type { ManagerClient, ManagerPeriod } from "./up-manager";

export type ShippingObservation = Pick<NuvemOrderShipping, "shippingState" | "shipping_carrier_name" |
  "shipping_option_code" | "shipping_option" | "shipping_cost_customer" | "shipping_max_days" | "total">;

type Direction = "improved" | "worsened" | "stable" | "small-sample" | "unavailable";
type Measure = "price" | "delivery";
type Samples = { count: number; average: number | null };
type Mode = { label: string; price: number[]; delivery: number[] };
type StateOrders = { orders: number; freeShipping: number; modes: Map<string, Mode> };
type Contribution = {
  mode: string;
  type: "mix" | "within-mode";
  delta: number;
  previousAverage: number | null;
  currentAverage: number | null;
  previousShare: number;
  currentShare: number;
};
type Comparison = {
  current: Samples;
  previous: Samples;
  delta: number | null;
  direction: Direction;
  material: boolean;
  reasons: string[];
  contributions: Contribution[];
};
export type FreightScenario = {
  state: string; sample: number; comparisonOrders: number; averageOrder: number;
  free: { threshold: number; orders: number; subsidy: number };
  fixed: { ceiling: number; orders: number; subsidy: number };
};
export type FreightReport = {
  scenarios?: FreightScenario[];
  currentWindow: ManagerPeriod;
  previousWindow: ManagerPeriod;
  observedAt: string;
  currency: string;
  coverage: {
    current: { orders: number; missingState: number } | null;
    previous: { orders: number; missingState: number } | null;
  };
  states: {
    state: string;
    currentOrders: number;
    previousOrders: number;
    currentFreeShare: number | null;
    previousFreeShare: number | null;
    price: Comparison;
    delivery: Comparison;
  }[];
};

const minSamples = 10;
const measures = { price: { material: 200, resolution: 1 }, delivery: { material: 1, resolution: 0.05 } };
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const percentage = (fraction: number) => `${number.format(fraction * 100)}%`;
const mean = (values: number[]): Samples => ({
  count: values.length,
  average: values.length ? values.reduce((total, value) => total + value, 0) / values.length : null,
});

function observed(value: number | string | null | undefined) {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function groupOrders(orders: ShippingObservation[] | null) {
  const states = new Map<string, StateOrders>();
  let missingState = 0;
  for (const order of orders ?? []) {
    if (!order.shippingState) {
      missingState++;
      continue;
    }
    const state = states.get(order.shippingState) ?? { orders: 0, freeShipping: 0, modes: new Map<string, Mode>() };
    states.set(order.shippingState, state);
    state.orders++;
    const carrier = order.shipping_carrier_name?.trim();
    const option = order.shipping_option?.trim();
    const code = order.shipping_option_code?.trim();
    const source = code || option;
    const key = source ? `${carrier?.toLowerCase() ?? ""}:${source.toLowerCase()}` : "";
    const label = [carrier, option || code].filter(Boolean).filter((value, index, all) => index === all.indexOf(value)).join(" · ");
    const mode = state.modes.get(key) ?? { label: label || "Modalidade não informada", price: [], delivery: [] };
    state.modes.set(key, mode);
    const price = observed(order.shipping_cost_customer);
    const days = observed(order.shipping_max_days);
    if (price !== null) {
      mode.price.push(Math.round(price * 100));
      if (price === 0) state.freeShipping++;
    }
    if (days !== null) mode.delivery.push(days);
  }
  return { states, coverage: orders ? { orders: orders.length, missingState } : null };
}

function compare(
  currentModes: Map<string, Mode>, previousModes: Map<string, Mode>, measure: Measure,
  money: (cents: number) => string, free: { current: number | null; previous: number | null },
): Comparison {
  const sample = (modes: Map<string, Mode>) => mean([...modes.values()].flatMap((mode) => mode[measure]));
  const current = sample(currentModes);
  const previous = sample(previousModes);
  const delta = current.average === null || previous.average === null ? null : current.average - previous.average;
  const { material, resolution } = measures[measure];
  const direction: Direction = delta === null ? "unavailable" : Math.min(current.count, previous.count) < minSamples
    ? "small-sample" : Math.abs(delta) < resolution ? "stable" : delta > 0 ? "worsened" : "improved";
  const result: Comparison = { current, previous, delta, direction, material: false, reasons: [], contributions: [] };
  if (direction === "unavailable" || direction === "small-sample" || delta === null) return result;
  result.material = Math.abs(delta) >= material;

  for (const key of new Set([...currentModes.keys(), ...previousModes.keys()])) {
    const now = currentModes.get(key);
    const before = previousModes.get(key);
    const currentMode = mean(now?.[measure] ?? []);
    const previousMode = mean(before?.[measure] ?? []);
    const currentShare = currentMode.count / current.count;
    const previousShare = previousMode.count / previous.count;
    const currentAverage = currentMode.average;
    const previousAverage = previousMode.average;
    if (currentAverage === null && previousAverage === null) continue;

    // Center the mix on the overall level so its direction reflects a cheaper/faster
    // or costlier/slower modality. The centered terms cancel across shares.
    const reference = (current.average! + previous.average!) / 2;
    const modeAverage = currentAverage === null ? previousAverage!
      : previousAverage === null ? currentAverage : (currentAverage + previousAverage) / 2;
    const mixDelta = (currentShare - previousShare) * (modeAverage - reference);
    const withinDelta = currentAverage !== null && previousAverage !== null
      ? (currentAverage - previousAverage) * (currentShare + previousShare) / 2 : 0;
    const mode = (now ?? before)!.label;
    const detail = { mode, currentShare, previousShare, currentAverage, previousAverage };
    if (Math.abs(mixDelta) > 1e-8) result.contributions.push({ ...detail, type: "mix", delta: mixDelta });
    if (Math.abs(withinDelta) > 1e-8) result.contributions.push({ ...detail, type: "within-mode", delta: withinDelta });
  }
  result.contributions.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  if (direction === "stable") return result;

  const format = measure === "price" ? money : (value: number) => `${number.format(value)} dias úteis`;
  for (const driver of result.contributions.filter((item) =>
    item.delta * delta > 0 && Math.abs(item.delta) >= resolution && item.mode !== "Modalidade não informada",
  ).slice(0, 2)) {
    const { mode, currentShare, previousShare, currentAverage, previousAverage } = driver;
    result.reasons.push(driver.type === "mix"
      ? `${mode} passou de ${percentage(previousShare)} para ${percentage(currentShare)} dos pedidos desta métrica. A mudança de participação contribuiu para a variação.`
      : `Em ${mode}, a média passou de ${format(previousAverage!)} para ${format(currentAverage!)}.`);
  }
  if (measure === "price" && free.current !== null && free.previous !== null &&
    Math.abs(free.current - free.previous) >= 0.05) {
    result.reasons.push(`A parcela de pedidos com frete grátis foi de ${percentage(free.previous)} para ${percentage(free.current)}.`);
  }
  if (!result.reasons.length) result.reasons.push("A variação foi observada nos pedidos, com evidência insuficiente para apontar a modalidade que mais pesou.");
  return result;
}

export function compareStateFreight(
  currentOrders: ShippingObservation[] | null, previousOrders: ShippingObservation[] | null,
  currentWindow: ManagerPeriod, previousWindow: ManagerPeriod, currency: string, observedAt: string,
): FreightReport {
  const current = groupOrders(currentOrders);
  const previous = groupOrders(previousOrders);
  const formatCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency });
  const money = (value: number) => formatCurrency.format(value / 100);
  const empty: StateOrders = { orders: 0, freeShipping: 0, modes: new Map() };
  const freeShare = ({ modes, freeShipping }: StateOrders) => {
    const count = [...modes.values()].reduce((value, mode) => value + mode.price.length, 0);
    return count ? freeShipping / count : null;
  };
  const states = [...new Set([...current.states.keys(), ...previous.states.keys()])].sort().map((state) => {
    const now = current.states.get(state) ?? empty;
    const before = previous.states.get(state) ?? empty;
    const free = { current: freeShare(now), previous: freeShare(before) };
    return {
      state, currentOrders: now.orders, previousOrders: before.orders,
      currentFreeShare: free.current, previousFreeShare: free.previous,
      price: compare(now.modes, before.modes, "price", money, free),
      delivery: compare(now.modes, before.modes, "delivery", money, free),
    };
  });
  return { currentWindow, previousWindow, observedAt, currency, states, coverage: { current: current.coverage, previous: previous.coverage } };
}

export function simulateShipping(orders: ShippingObservation[], report: FreightReport): FreightScenario[] {
  const worsening = report.states.filter(({ price, delivery }) =>
    (price.material && price.direction === "worsened") || (delivery.material && delivery.direction === "worsened"));
  return worsening.flatMap(({ state, currentOrders }) => {
    const sample = orders.flatMap((order) => {
      if (order.shippingState !== state) return [];
      const price = observed(order.shipping_cost_customer);
      const total = observed(order.total);
      if (price === null || total === null || total <= price) return [];
      return [{ merchandise: Math.round((total - price) * 100), price: Math.round(price * 100) }];
    });
    const charged = sample.map(({ price }) => price).filter((price) => price > 0).sort((a, b) => a - b);
    if (sample.length < minSamples || charged.length < 3) return [];
    const averageOrder = Math.round(mean(sample.map(({ merchandise }) => merchandise)).average!);
    const threshold = Math.max(1000, Math.ceil(averageOrder / 1000) * 1000);
    const ceiling = Math.max(100, Math.floor(charged[Math.floor((charged.length - 1) / 2)] / 100) * 100);
    const free = sample.filter(({ merchandise, price }) => merchandise >= threshold && price > 0);
    const fixed = sample.filter(({ price }) => price > ceiling);
    return [{ state, sample: sample.length, comparisonOrders: currentOrders, averageOrder,
      free: { threshold, orders: free.length, subsidy: free.reduce((sum, { price }) => sum + price, 0) },
      fixed: { ceiling, orders: fixed.length, subsidy: fixed.reduce((sum, { price }) => sum + price - ceiling, 0) } }];
  });
}

export async function readManagerShipping(client: ManagerClient, week: ManagerPeriod) {
  if (client.commercePlatform !== "BRAAVO" && (!client.storeId || !client.storeToken)) return null;
  const { storeId, storeToken } = client;
  const prior = { dateFrom: addDaysToDateOnly(week.dateFrom, -7), dateTo: addDaysToDateOnly(week.dateTo, -7) };
  const orders = (period: ManagerPeriod) => (client.commercePlatform === "BRAAVO" ? readBraavoManagerFreight(client.id, period) : fetchManagerOrderShipping(
    storeId!, storeToken!, saoPauloDateOnlyStart(period.dateFrom), saoPauloDateOnlyStart(addDaysToDateOnly(period.dateTo, 1)),
  )).catch(() => null);
  const [currentOrders, previousOrders] = await Promise.all([orders(week), orders(prior)]);
  const report = compareStateFreight(currentOrders, previousOrders, week, prior, client.currency, new Date().toISOString());
  return { ...report, scenarios: simulateShipping(currentOrders ?? [], report) };
}

export function shippingFinding(report: FreightReport): B2cFinding {
  const worsened = report.states.filter(({ price, delivery }) =>
    (price.material && price.direction === "worsened") || (delivery.material && delivery.direction === "worsened"));
  const improved = report.states.filter(({ price, delivery }) =>
    (price.material && price.direction === "improved") || (delivery.material && delivery.direction === "improved"));
  const comparisons = report.states.filter(({ price, delivery }) =>
    [price.direction, delivery.direction].some((direction) => direction !== "small-sample" && direction !== "unavailable"));
  const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: report.currency });
  const money = (value: number) => currency.format(value / 100);
  const days = (value: number) => `${number.format(value)} dias úteis`;
  const factors = report.states.flatMap(({ state, price, delivery }) =>
    ([["Preço", price, money], ["Prazo prometido", delivery, days]] as const).flatMap(([label, metric, format]) =>
      metric.material && metric.previous.average !== null && metric.current.average !== null
        ? [{ label: `${state} · ${label}`, detail: `${format(metric.previous.average)} → ${format(metric.current.average)}. ${metric.reasons.join(" ")}` }]
        : []));
  const coverage = report.coverage.current && report.coverage.previous;
  const evidence = !coverage ? "Uma ou ambas as semanas do histórico de pedidos pagos estão indisponíveis."
    : !comparisons.length ? "Os pedidos pagos ainda têm pouca amostra para comparar preço e prazo por estado."
      : `${comparisons.length} UFs com comparativo. ${worsened.length ? `Piora relevante em ${worsened.map(({ state }) => state).join(", ")}. ` : ""}${improved.length ? `Melhora relevante em ${improved.map(({ state }) => state).join(", ")}.` : ""}`.trim();
  const action = worsened.length
    ? `Priorizar ${worsened.map(({ state }) => state).join(", ")}. Pedir cotação às transportadoras atuais e alternativas para as mesmas rotas. ${report.scenarios?.length ? "Levar os cenários de frete grátis e limitado para aprovação." : "Usar as cotações para calcular o custo de uma oferta de frete."}`
    : improved.length ? "Manter as modalidades que contribuíram para a melhora e conferir se ela se sustenta na próxima semana."
      : !comparisons.length ? "Acompanhar a cobertura antes de mudar a operação de frete."
        : "Manter a política de frete e acompanhar a próxima semana.";
  const reported = worsened.slice(0, 3).map(({ state, price, delivery }) => {
    const changes = [
      price.direction === "worsened" && price.material && price.previous.average != null && price.current.average != null
        ? `o frete médio cobrado dos clientes passou de ${money(price.previous.average)} para ${money(price.current.average)}` : "",
      delivery.direction === "worsened" && delivery.material && delivery.previous.average != null && delivery.current.average != null
        ? `o prazo máximo médio prometido passou de ${days(delivery.previous.average)} para ${days(delivery.current.average)}` : "",
    ];
    return `Em ${state}, ${changes.filter(Boolean).join(" e ")}.`;
  });
  const clientDraft = worsened.length ? `Olá! ${reported.join(" ")}${worsened.length > reported.length ? ` Também houve piora em outras ${worsened.length - reported.length} UFs.` : ""} Sugerimos cotar as mesmas rotas com outras transportadoras e avaliar os cenários de frete com a equipe.` : `Olá! ${evidence} ${action}`;
  return {
    id: "shipping-price-and-delivery",
    clientDraft,
    title: "Preço e prazo de frete por estado",
    evidence,
    hypothesis: "Média do frete cobrado e do prazo máximo prometido nos pedidos pagos com entrega por estado.",
    action,
    owner: "E-commerce e logística",
    followUp: "Comparar as próximas duas semanas fechadas e verificar se a mudança se mantém nas mesmas modalidades.",
    section: "analysis",
    focus: "funnel",
    priority: worsened.length ? "P1" : "P2",
    diagnosis: {
      source: "nuvemshop", factors, action,
      unresolved: "Os pedidos mostram o preço cobrado e o prazo prometido. Para medir atraso real ou isolar uma mudança de tarifa, são necessários eventos de entrega ou cotações comparáveis.",
      followUp: "Comparar preço, prazo e participação das modalidades na próxima janela fechada.",
    },
  };
}
