// Funil de conversão contado em PESSOAS (e não em eventos) e com taxas que nunca passam de 100%.
//
// Achado 09/10/2026 (MX Fashion, 7 dias): o funil somava EVENTOS. "Produtos vistos" juntava `product_view` com
// `product_item_impression` (cada card de produto exibido numa listagem) -> 43.537 "visualizações" e conversão de
// 11.078% contra "Categorias vistas". Etapas sem rastreamento (0) viravam "queda de 100%" e a "maior perda" do topo
// da tela era só dado ausente. Aqui:
//   - cada etapa conta pessoas distintas (usuário identificado > visitante > anônimo > sessão);
//   - `product_item_impression` não entra em "Produtos vistos";
//   - etapa só de rastreamento com 0 pessoas = "sem dado" (não é perda), conversão/queda 0; cadastro, aprovação e
//     compra vêm do banco: 0 ali é real e continua sendo perda;
//   - conversão limitada a 100% (a mesma pessoa pode ter feito a etapa anterior antes do período).
import type { UpzeroAnalyticsMetric } from "./upzero/analytics-metrics";

export type FunnelStepKey =
  | "VISIT"
  | "CATEGORY_VIEW"
  | "PRODUCT_VIEW"
  | "FORM_START"
  | "REGISTER_START"
  | "REGISTRATION"
  | "APPROVED_REGISTRATION"
  | "LOGIN"
  | "ADD_TO_CART"
  | "CHECKOUT_STARTED"
  | "ORDER_CREATED"
  | "PURCHASE"
  | "PAYMENT_APPROVED";

type TrackedStepKey = Exclude<FunnelStepKey, "APPROVED_REGISTRATION">;

/** Eventos da UP Zero que alimentam cada etapa (APPROVED_REGISTRATION vem do cadastro, não de evento). */
export const FUNNEL_EVENTS: Record<TrackedStepKey, readonly string[]> = {
  VISIT: ["page_view"],
  CATEGORY_VIEW: ["category_view"],
  PRODUCT_VIEW: ["product_view"],
  FORM_START: ["form_start"],
  REGISTER_START: ["register_start"],
  REGISTRATION: ["register_submitted"],
  LOGIN: ["login"],
  ADD_TO_CART: ["add_to_cart"],
  CHECKOUT_STARTED: ["initiate_checkout", "checkout_start"],
  ORDER_CREATED: ["order_created"],
  PURCHASE: ["purchase"],
  PAYMENT_APPROVED: ["order_paid", "payment_approved"],
};

export const FUNNEL_EVENT_NAMES: readonly string[] = Object.values(FUNNEL_EVENTS).flat();

/**
 * Etapas cujo número vem do banco (e não do rastreamento): 0 aqui é real. Nas demais, 0 pessoas quase sempre é
 * rastreamento que não existe (ex.: pagamento confirmado fora do site), então não conta como perda.
 */
const FUNNEL_DATABASE_STEPS: ReadonlySet<FunnelStepKey> = new Set(["REGISTRATION", "APPROVED_REGISTRATION", "PURCHASE"]);

/** Etapas depois da aprovação medem-se contra os cadastros aprovados do período (regra que já existia). */
export const FUNNEL_POST_APPROVAL_STEPS: ReadonlySet<FunnelStepKey> = new Set([
  "LOGIN",
  "ADD_TO_CART",
  "CHECKOUT_STARTED",
  "ORDER_CREATED",
  "PURCHASE",
  "PAYMENT_APPROVED",
]);

export type FunnelRow = Pick<
  UpzeroAnalyticsMetric,
  "event_name" | "total_events" | "unique_sessions" | "unique_users" | "period_type" | "user_id" | "user" | "visitor_id" | "anonymous_id" | "session_id" | "event_id"
>;

/** Quem fez o evento: usuário identificado > visitante > id anônimo > sessão. */
export function funnelActorKey(row: Partial<FunnelRow>): string | null {
  const userId = row.user_id ?? row.user?.id ?? null;
  if (userId !== null && userId !== undefined) return `u:${userId}`;
  if (row.visitor_id) return `v:${row.visitor_id}`;
  if (row.anonymous_id) return `a:${row.anonymous_id}`;
  if (row.session_id) return `s:${row.session_id}`;
  if (row.event_id) return `e:${row.event_id}`;
  return null;
}

export type FunnelPeopleCounts = {
  counts: Record<TrackedStepKey, number>;
  /** false quando alguma linha é agregada por hora (não dá para separar pessoas): aí a etapa soma eventos. */
  exact: boolean;
};

export function countFunnelPeople(rows: readonly Partial<FunnelRow>[]): FunnelPeopleCounts {
  const eventToStep = new Map<string, TrackedStepKey>();
  for (const [step, names] of Object.entries(FUNNEL_EVENTS) as Array<[TrackedStepKey, readonly string[]]>) {
    for (const name of names) eventToStep.set(name, step);
  }
  const actors = new Map<TrackedStepKey, Set<string>>();
  const aggregated = new Map<TrackedStepKey, number>();
  let exact = true;
  for (const row of rows) {
    const step = row.event_name ? eventToStep.get(row.event_name) : undefined;
    if (!step) continue;
    if (row.period_type && row.period_type !== "event") {
      exact = false;
      // Linha agregada por hora: sessões (ou usuários) do período; sem isso, o total de eventos da linha.
      const people = Math.max(row.unique_sessions || 0, row.unique_users || 0);
      aggregated.set(step, (aggregated.get(step) ?? 0) + (people || row.total_events || 0));
      continue;
    }
    const key = funnelActorKey(row);
    if (!key) continue;
    const set = actors.get(step) ?? new Set<string>();
    set.add(key);
    actors.set(step, set);
  }
  const counts = {} as Record<TrackedStepKey, number>;
  for (const step of Object.keys(FUNNEL_EVENTS) as TrackedStepKey[]) {
    counts[step] = Math.max(actors.get(step)?.size ?? 0, aggregated.get(step) ?? 0);
  }
  return { counts, exact };
}

export type FunnelStepInput = { step: FunnelStepKey; label: string };
export type FunnelStepOutput = {
  step: string;
  label: string;
  count: number;
  conversionRate: number;
  dropOffRate: number;
};

const cap = (value: number) => Math.max(0, Math.min(100, value));

/**
 * Calcula conversão e queda de cada etapa.
 * - 1ª etapa: 100%.
 * - Cadastros aprovados: contra a etapa anterior COM dado.
 * - Etapas após a aprovação: contra os cadastros aprovados do período (se houver); senão, contra a anterior.
 * - Demais: contra a etapa anterior COM dado.
 * - Etapa sem dado (0 pessoas e só rastreamento): conversão e queda 0, não entra como "perda".
 */
export function buildFunnelSteps(
  order: readonly FunnelStepInput[],
  counts: Partial<Record<FunnelStepKey, number>>,
  approvedBaseline: number,
): FunnelStepOutput[] {
  const countOf = (step: FunnelStepKey) => counts[step] ?? 0;
  let lastWithData = -1;
  return order.map((item, index) => {
    const count = countOf(item.step);
    const noData = index > 0 && count === 0 && !FUNNEL_DATABASE_STEPS.has(item.step);
    let conversionRate = 0;
    if (index === 0) {
      conversionRate = 100;
    } else if (noData) {
      conversionRate = 0;
    } else {
      const previous = lastWithData >= 0 ? countOf(order[lastWithData].step) : 0;
      if (item.step === "APPROVED_REGISTRATION") {
        conversionRate = previous > 0 ? (count / previous) * 100 : count > 0 ? 100 : 0;
      } else if (FUNNEL_POST_APPROVAL_STEPS.has(item.step) && approvedBaseline > 0) {
        conversionRate = (count / approvedBaseline) * 100;
      } else {
        conversionRate = previous > 0 ? (count / previous) * 100 : count > 0 ? 100 : 0;
      }
    }
    conversionRate = cap(conversionRate);
    if (count > 0 || index === 0) lastWithData = index;
    return {
      step: item.step,
      label: item.label,
      count,
      conversionRate,
      dropOffRate: index === 0 || noData ? 0 : cap(100 - conversionRate),
    };
  });
}

/** Etapa com maior perda real (ignora a 1ª e as sem dado). */
export function worstFunnelStep(steps: readonly FunnelStepOutput[]): { idx: number; drop: number } {
  let worst = { idx: -1, drop: -1 };
  for (let i = 1; i < steps.length; i++) {
    if (steps[i].count === 0 && !FUNNEL_DATABASE_STEPS.has(steps[i].step as FunnelStepKey)) continue;
    if (steps[i].dropOffRate > worst.drop) worst = { idx: i, drop: steps[i].dropOffRate };
  }
  return worst;
}
