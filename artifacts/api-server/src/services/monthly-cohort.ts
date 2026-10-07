import type { PurchaseEvent } from "./purchase-progression";

const monthFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit",
});
function monthIndex(date: Date) {
  const parts = monthFormatter.formatToParts(date);
  return Number(parts.find(p => p.type === "year")!.value) * 12
    + Number(parts.find(p => p.type === "month")!.value) - 1;
}
const monthKey = (index: number) => `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, "0")}`;

/** Calendar-month retention, distinct customers, with an explicit observation cutoff.
 * Uses the complete paid-order history to avoid treating old customers as new.
 * This is separate from the existing cumulative 30/60/90-day retention. */
export function buildMonthlyCohort(history: Map<string, PurchaseEvent[]>, dateTo: string, months = 4) {
  const cutoff = new Date(`${dateTo}T23:59:59.999-03:00`);
  const lastMonth = monthIndex(cutoff);
  const groups = new Map<number, Set<number>[]>();
  for (const events of history.values()) {
    const observed = events.filter(event => event.grossValue > 0
      && Number.isFinite(event.requestedAt.getTime()) && event.requestedAt <= cutoff)
      .sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime());
    if (!observed.length) continue;
    const firstMonth = monthIndex(observed[0].requestedAt);
    const customers = groups.get(firstMonth) ?? [];
    customers.push(new Set(observed.map(event => monthIndex(event.requestedAt))));
    groups.set(firstMonth, customers);
  }
  const rows = Array.from({ length: months }, (_, index) => {
    const cohortMonth = lastMonth - months + 1 + index;
    const customers = groups.get(cohortMonth) ?? [];
    return {
      month: monthKey(cohortMonth), customers: customers.length,
      retention: Array.from({ length: 4 }, (_, offset) => {
        if (!customers.length || cohortMonth + offset > lastMonth) return null;
        const returned = customers.filter(purchases => purchases.has(cohortMonth + offset)).length;
        return Math.round(returned / customers.length * 1000) / 10;
      }),
    };
  });
  return { rows, observedThrough: dateTo };
}
