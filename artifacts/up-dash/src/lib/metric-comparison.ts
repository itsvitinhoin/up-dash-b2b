import { differenceInCalendarDays, format, parseISO, subDays } from "date-fns";

/** Inclusive calendar days: DST and month boundaries cannot change the window. */
export function precedingPeriod(dateFrom: string, dateTo: string) {
  const from = parseISO(dateFrom), to = parseISO(dateTo);
  const days = differenceInCalendarDays(to, from) + 1;
  if (!Number.isFinite(days) || days < 1) throw new Error("Período inválido");
  return { dateFrom: format(subDays(from, days), "yyyy-MM-dd"), dateTo: format(subDays(from, 1), "yyyy-MM-dd") };
}

export function metricComparison(current: number | null | undefined, previous: number | null | undefined) {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous))
    return { change: null, status: "unavailable" as const };
  if (previous === 0 && current !== 0) return { change: null, status: "zero-base" as const };
  return { change: previous === 0 ? 0 : (current - previous) / Math.abs(previous) * 100, status: "available" as const };
}
