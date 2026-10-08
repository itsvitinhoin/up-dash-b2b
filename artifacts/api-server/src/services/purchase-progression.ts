/** Deriva as novas análises da mesma sequência de pedidos positivos já conciliada. */
export type PurchaseEvent = { requestedAt: Date; grossValue: number };
const DAY_MS = 86_400_000;
const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
const sameDay = (a: Date, b: Date) => dayFormatter.format(a) === dayFormatter.format(b);

export function buildPurchaseProgression(
  history: Map<string, PurchaseEvent[]>, approvals: Map<string, Date | null>,
  dateFrom: string, dateTo: string,
) {
  const from = new Date(`${dateFrom}T00:00:00-03:00`).getTime();
  const to = new Date(`${dateTo}T23:59:59.999-03:00`).getTime();
  const cohort = [...history.entries()].map(([id, events]) => ({ id, events: events.filter(e => Number.isFinite(e.requestedAt.getTime()) && e.grossValue > 0).sort((a,b) => a.requestedAt.getTime()-b.requestedAt.getTime()) }))
    .filter(({ events }) => events.length && events[0].requestedAt.getTime() >= from && events[0].requestedAt.getTime() <= to)
    .map(({ id, events }) => ({ id, events: events.filter(e => e.requestedAt.getTime() <= to) }));
  let accumulatedRevenue = 0;
  const baseEvolution = [1,2,3,4].map((step, index) => {
    const customers = cohort.filter(c => c.events.length >= step).length;
    const previousCount = index === 0 ? cohort.length : cohort.filter(c => c.events.length >= step-1).length;
    const revenue = cohort.reduce((total, c) => total + (index === 3 ? c.events.slice(3).reduce((s,e) => s+e.grossValue,0) : c.events[index]?.grossValue ?? 0),0);
    accumulatedRevenue += revenue;
    return { label: `Compra ${step}${step === 4 ? "+" : ""}`, customers, basePct: cohort.length ? customers/cohort.length*100 : null, continuationPct: previousCount ? customers/previousCount*100 : null, revenue, accumulatedRevenue };
  });
  const labels = ["Mesmo dia", "Até 3 dias", "Até 7 dias", "Até 14 dias", "Até 30 dias", "Até 60 dias", "Mais de 60"];
  const counts = labels.map(() => 0);
  const elapsedDays: number[] = [];
  let missingApproval = 0, invalidChronology = 0;
  for (const customer of cohort) {
    const approval = approvals.get(customer.id);
    if (!approval || !Number.isFinite(approval.getTime())) { missingApproval++; continue; }
    const first = customer.events[0].requestedAt;
    const elapsed = (first.getTime()-approval.getTime())/DAY_MS;
    if (elapsed < 0) { invalidChronology++; continue; }
    elapsedDays.push(elapsed);
    const bucket = sameDay(approval, first) ? 0 : elapsed <= 3 ? 1 : elapsed <= 7 ? 2 : elapsed <= 14 ? 3 : elapsed <= 30 ? 4 : elapsed <= 60 ? 5 : 6;
    counts[bucket]++;
  }
  const sorted = [...elapsedDays].sort((a,b)=>a-b);
  const middle = Math.floor(sorted.length/2);
  const medianDays = sorted.length ? sorted.length%2 ? sorted[middle] : (sorted[middle-1]+sorted[middle])/2 : null;
  const firstWeekCount = elapsedDays.filter(d=>d<=7).length;
  const within30Count = elapsedDays.filter(d=>d<=30).length;
  const conversionVelocity = { sampleSize: sorted.length, cohortSize: cohort.length, missingApproval, invalidChronology,
    buckets: labels.map((label,i)=>({ label, customers: counts[i], pct: sorted.length ? counts[i]/sorted.length*100 : null })),
    firstWeekCount, firstWeekPct: sorted.length ? firstWeekCount/sorted.length*100 : null,
    within30Count, within30Pct: sorted.length ? within30Count/sorted.length*100 : null,
    medianDays, averageDays: sorted.length ? sorted.reduce((a,b)=>a+b,0)/sorted.length : null,
  };
  return { baseEvolution, conversionVelocity, period: { dateFrom, dateTo }, purchaseDateBasis: "paid-order-source-date" as const };
}
