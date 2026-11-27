import { addDaysToDateOnly, saoPauloDateOnlyStart } from "../lib/reporting-period";

type Commerce = { status?: string | null; observedAt?: string | null; partial?: boolean };
type Funnel = { sessions: number; productViews: number; addToCarts: number; checkouts: number; purchases: number };
type Coverage = {
  commerce?: Commerce;
  mediaAvailable?: boolean;
  monitorFresh?: boolean;
  stock?: { known: number; total: number };
};

export function hasClosedOrders(commerce: Commerce | null | undefined, dateTo: string) {
  return commerce?.status === "done" && !commerce.partial && !!commerce.observedAt &&
    Date.parse(commerce.observedAt) >= saoPauloDateOnlyStart(addDaysToDateOnly(dateTo, 1)).getTime();
}

export function funnelFingerprint(value: Funnel | null | undefined) {
  return value ? [value.sessions, value.productViews, value.addToCarts, value.checkouts, value.purchases].join(":") : null;
}

export function reopenedSources(before: { commerceAt: string | null; ga4: (string | null)[] }, after: typeof before) {
  return Boolean(after.commerceAt && (!before.commerceAt || Date.parse(after.commerceAt) > Date.parse(before.commerceAt))) ||
    after.ga4.some((key, index) => key != null && key !== before.ga4[index]);
}

export function managerActionReadiness(report: { scope?: { commerceConfirmed?: boolean }; coverage?: Coverage } | undefined) {
  const { scope, coverage } = report ?? {};
  if (scope?.commerceConfirmed !== true) return "Aguarde o fechamento de pedidos antes de alterar a mídia por desempenho.";
  if (coverage?.mediaAvailable !== true || coverage?.monitorFresh === false) return "Atualize o diagnóstico. A leitura da Meta está incompleta.";
  return null;
}
