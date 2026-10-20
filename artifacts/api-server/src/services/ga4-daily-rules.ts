import type { Ga4DailyMetrics } from "./ga4";

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
