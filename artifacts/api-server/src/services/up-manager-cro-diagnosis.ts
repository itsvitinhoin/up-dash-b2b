import type { B2cFinding } from "./up-manager-b2c";
import type { CheckoutDiagnosticData } from "./up-manager-funnel-diagnostic";
import { shippingFinding, type FreightReport } from "./up-manager-shipping-insights";
import type { ManagerPeriod } from "./up-manager";

type Scope = { current: ManagerPeriod; previous: ManagerPeriod };
type Step = readonly [label: string, entry: string, exit: string];
const checkout: Step[] = [
  ["Checkout → dados de entrega", "begin_checkout", "add_shipping_info"],
  ["Entrega → dados de pagamento", "add_shipping_info", "add_payment_info"],
  ["Dados de pagamento → compra", "add_payment_info", "purchase"],
];
const edges: Record<string, Step> = {
  "Produto → carrinho": ["Produto → carrinho", "view_item", "add_to_cart"],
  "Carrinho → checkout": ["Carrinho → checkout", "add_to_cart", "begin_checkout"],
  "Checkout → compra": ["Checkout → compra", "begin_checkout", "purchase"],
};
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });
const date = (value: string) => `${value.slice(8, 10)}/${value.slice(5, 7)}`;

export function enrichCroFinding(finding: B2cFinding, label: string, ga4: CheckoutDiagnosticData | null, scope: Scope,
  freight: FreightReport | null, approvals: { before: { approved: number; created: number }; after: { approved: number; created: number } } | null) {
  const factors = [...finding.diagnosis?.factors ?? []];
  const compare = (step: Step, device?: string) => {
    const count = (event: string, period: "previous" | "current") => (ga4?.events ?? []).filter((row) =>
      row.event === event && row.period === period && (!device || row.device === device)).reduce((sum, row) => sum + row.count, 0);
    const previous = count(step[1], "previous");
    const current = count(step[1], "current");
    const previousExits = count(step[2], "previous");
    const currentExits = count(step[2], "current");
    if (Math.min(previous, current) < 25 || previousExits > previous || currentExits > current) return null;
    return { label: step[0], previous, current, previousExits, currentExits, delta: currentExits / current - previousExits / previous,
      detail: `${previousExits} de ${previous} (${percent.format(previousExits / previous)}) → ${currentExits} de ${current} (${percent.format(currentExits / current)}).` };
  };
  const stages = label === "Checkout → compra" ? checkout.flatMap((step) => {
    const comparable = compare(step);
    const eventVisible = ga4?.events.some((row) => row.event === step[2]) && ga4?.events.some((row) => row.event === step[1]);
    return comparable && eventVisible ? [comparable] : [];
  }) : [];
  factors.push({ label: "Períodos comparados", detail: `${date(scope.previous.dateFrom)} a ${date(scope.previous.dateTo)} → ${date(scope.current.dateFrom)} a ${date(scope.current.dateTo)}.` });
  for (const stage of stages) factors.push({ label: stage.label, detail: stage.detail });
  const mobile = edges[label] ? compare(edges[label], "mobile") : null;
  if (mobile && mobile.delta <= -0.04) factors.push({ label: "Celular", detail: mobile.detail });
  if (label === "Checkout → compra" && approvals && Math.min(approvals.before.created, approvals.after.created) >= 10) {
    const { before, after } = approvals;
    factors.push({ label: "Aprovação de pedidos na loja", detail: `${before.approved} de ${before.created} (${percent.format(before.approved / before.created)}) → ${after.approved} de ${after.created} (${percent.format(after.approved / after.created)}).` });
  }
  const alignedFreight = freight && freight.currentWindow.dateFrom === scope.current.dateFrom && freight.currentWindow.dateTo === scope.current.dateTo &&
    freight.previousWindow.dateFrom === scope.previous.dateFrom && freight.previousWindow.dateTo === scope.previous.dateTo ? shippingFinding(freight) : null;
  if (alignedFreight?.priority === "P1") factors.push(...(alignedFreight.diagnosis?.factors.slice(0, 3) ?? []));
  const worst = [...stages].sort((a, b) => a.delta - b.delta)[0];
  const action = label !== "Checkout → compra" ? finding.action : worst?.delta < -0.04 && worst.label.includes("entrega") && !worst.label.includes("pagamento")
    ? "Reproduzir o preenchimento de endereço e as opções de entrega nas regiões sinalizadas. Medir o avanço para a próxima etapa após a correção."
    : worst?.delta < -0.04 && worst.label === "Dados de pagamento → compra"
      ? "Reproduzir a conclusão por Pix e cartão e cruzar divergências com os pedidos aprovados da loja."
      : "Reproduzir o checkout da entrega à conclusão em celular. Conferir subtotal, frete e Pix/cartão e registrar em qual etapa a tentativa para.";
  const unresolved = label === "Checkout → compra" && !stages.length
    ? "O GA4 localiza a perda entre checkout e compra. Ainda não há eventos intermediários comparáveis para atribuí-la à entrega, à forma de pagamento ou à medição."
    : finding.diagnosis?.unresolved ?? "As taxas localizam o trecho da perda. O motivo técnico depende de reproduzir a etapa com os recortes de maior impacto.";
  finding.action = action;
  finding.diagnosis = { ...finding.diagnosis, source: ga4?.source ?? finding.diagnosis?.source ?? "bigquery", factors,
    action, followUp: finding.followUp, unresolved };
}
