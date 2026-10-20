import type { Ga4DailyMetrics, Ga4FunnelMetrics } from "./ga4";

// Regras puras do sync diario do GA4 (sem banco), testaveis isoladamente.

const GA4_BACKFILL_DAYS = Number.parseInt(process.env.GA4_BACKFILL_DAYS ?? "400", 10);
const GA4_LOOKBACK_DAYS = Number.parseInt(process.env.GA4_LOOKBACK_DAYS ?? "3", 10);

function positiveOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function shiftDate(value: string, days: number): string {
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function dayRange(from: string, to: string): string[] {
  const days: string[] = [];
  for (let cursor = from; cursor <= to; cursor = shiftDate(cursor, 1)) days.push(cursor);
  return days;
}

// Data de "hoje" em Sao Paulo (UTC-3): evita pedir "amanha" ao GA4 a noite.
export function saoPauloDate(value: Date): string {
  return new Date(value.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Sem historico guardado (cliente novo ou GA4 recem-ligado): backfill largo
// uma vez. Depois so os ultimos dias, porque o GA4 ainda revisa os numeros de
// ontem e anteontem. `lookbackDays` explicito (LOOKBACK_DAYS) sempre vence.
export function resolveGa4SyncWindow(params: {
  hasHistory: boolean;
  now?: Date;
  lookbackDays?: number;
}): { from: string; to: string } {
  const to = saoPauloDate(params.now ?? new Date());
  const days =
    params.lookbackDays && params.lookbackDays > 0
      ? params.lookbackDays
      : params.hasHistory
        ? positiveOr(GA4_LOOKBACK_DAYS, 3)
        : positiveOr(GA4_BACKFILL_DAYS, 400);
  return { from: shiftDate(to, -(days - 1)), to };
}

// O GA4 so devolve os dias que tiveram trafego. Preenche os demais com zero
// pra que "existe linha" signifique "este dia ja foi sincronizado".
export function fillGa4Days(from: string, to: string, fetched: Ga4DailyMetrics[]): Ga4DailyMetrics[] {
  const byDate = new Map(fetched.map((row) => [row.date, row]));
  return dayRange(from, to).map(
    (date) =>
      byDate.get(date) ?? {
        date,
        sessions: 0,
        pageViews: 0,
        productViews: 0,
        addToCarts: 0,
        checkouts: 0,
        purchases: 0,
      },
  );
}

// ── Leitura do dado guardado pelas telas de um cliente só ───────────────────
// O funil de um periodo e a soma dos dias (sessoes, pageviews e contagens de
// evento sao aditivos). Mesmo formato que fetchGa4FunnelMetrics devolve.
export function aggregateGa4Rows(rows: Ga4DailyMetrics[]): Ga4FunnelMetrics {
  const total: Ga4FunnelMetrics = {
    sessions: 0,
    pageViews: 0,
    productViews: 0,
    addToCarts: 0,
    checkouts: 0,
    purchases: 0,
    source: "ga4",
  };
  for (const row of rows) {
    total.sessions += row.sessions;
    total.pageViews += row.pageViews;
    total.productViews += row.productViews;
    total.addToCarts += row.addToCarts;
    total.checkouts += row.checkouts;
    total.purchases += row.purchases;
  }
  return total;
}

export const GA4_STORE_MAX_AGE_HOURS = 48;

// O dado guardado so serve se (1) cobre o inicio do periodo pedido -- o
// backfill nao vai alem de GA4_BACKFILL_DAYS, e somar so parte do periodo daria
// um numero menor sem avisar -- e (2) foi atualizado recentemente; se o job
// parou de funcionar pra essa loja, e melhor cair no ao vivo do que mostrar
// numero velho como se fosse atual.
export function isGa4StoreUsable(params: {
  earliestDate: string | null;
  latestSyncedAt: Date | null;
  dateFrom: string;
  now?: Date;
}): boolean {
  if (!params.earliestDate || !params.latestSyncedAt) return false;
  if (params.dateFrom < params.earliestDate) return false;
  const ageMs = (params.now ?? new Date()).getTime() - params.latestSyncedAt.getTime();
  return ageMs <= GA4_STORE_MAX_AGE_HOURS * 60 * 60 * 1000;
}
