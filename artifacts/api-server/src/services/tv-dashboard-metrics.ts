import type { TvBrand, TvTotals } from "@workspace/api-zod";

export function tvWindow(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (key: string) => parts.find((p) => p.type === key)!.value;
  const dateTo = `${get("year")}-${get("month")}-${get("day")}`;
  const start = new Date(`${dateTo}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 89);
  const dateFrom = start.toISOString().slice(0, 10);
  return {
    dateFrom,
    dateTo,
    from: new Date(`${dateFrom}T00:00:00-03:00`),
    to: new Date(`${dateTo}T23:59:59.999-03:00`),
  };
}

// The configured cron runs at 03:00 and 15:00 UTC (00:00 and 12:00 Brasília).
export function tvCycle(now: Date): string {
  const cycle = new Date(now);
  cycle.setUTCHours(now.getUTCHours() >= 15 ? 15 : 3, 0, 0, 0);
  if (cycle > now) {
    cycle.setUTCDate(cycle.getUTCDate() - 1);
    cycle.setUTCHours(15);
  }
  return cycle.toISOString();
}

export function tvMer(
  revenue: number,
  investment: number | null,
): number | null {
  return investment !== null && investment > 0 ? revenue / investment : null;
}

export function summarizeTv(rows: TvBrand[]): TvTotals[] {
  const grouped = new Map<string, TvTotals>();
  for (const row of rows) {
    const total = grouped.get(row.currency) ?? {
      currency: row.currency,
      revenue: 0,
      investment: 0,
      mer: null,
    };
    total.revenue += row.revenue;
    total.investment =
      total.investment === null || row.investment === null
        ? null
        : total.investment + row.investment;
    grouped.set(row.currency, total);
  }
  return [...grouped.values()]
    .sort((a, b) => a.currency.localeCompare(b.currency))
    .map((total) => ({
      ...total,
      mer: tvMer(total.revenue, total.investment),
    }));
}

export function rankTv(rows: TvBrand[]): TvBrand[] {
  return [...rows].sort(
    (a, b) =>
      b.revenue - a.revenue ||
      a.name.localeCompare(b.name, "pt-BR") ||
      a.id.localeCompare(b.id),
  );
}

export function buildTvRevenueTrend(
  orders: Array<{
    clientId: string;
    date: string;
    requested: number;
    paid: number;
  }>,
  clients: Array<{ id: string; currency: string; dashboardType: string }>,
  dateFrom: string,
  dateTo: string,
) {
  const byClient = new Map(clients.map((c) => [c.id, c]));
  const points = new Map<
    string,
    { date: string; currency: string; total: number; b2b: number; b2c: number }
  >();
  const currencies = [...new Set(clients.map((c) => c.currency))].sort();
  for (
    let day = new Date(`${dateFrom}T12:00:00Z`);
    day.toISOString().slice(0, 10) <= dateTo;
    day.setUTCDate(day.getUTCDate() + 1)
  ) {
    const date = day.toISOString().slice(0, 10);
    for (const currency of currencies)
      points.set(`${date}:${currency}`, {
        date,
        currency,
        total: 0,
        b2b: 0,
        b2c: 0,
      });
  }
  for (const row of orders) {
    const client = byClient.get(row.clientId);
    if (!client) continue;
    const point = points.get(`${row.date}:${client.currency}`);
    if (!point) continue;
    const value =
      Number(client.dashboardType === "B2C" ? row.paid : row.requested) || 0;
    point.total += value;
    point[client.dashboardType === "B2C" ? "b2c" : "b2b"] += value;
  }
  return [...points.values()];
}
