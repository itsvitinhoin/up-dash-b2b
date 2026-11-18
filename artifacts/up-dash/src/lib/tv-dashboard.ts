import type {
  TvSnapshot,
  TvBrand,
  TvTotals,
} from "@workspace/api-client-react";

export const TV_STATUS_POLL_MS = 60_000;
export const TV_PAGE_MS = 20_000;
export const TV_PAGE_SIZE = 6;

export function revenueIncreased(
  previous: TvSnapshot | undefined,
  next: TvSnapshot,
): boolean {
  if (!previous || previous.cycle === next.cycle) return false;
  const old = new Map(previous.brands.map((brand) => [brand.id, brand]));
  const changes = new Map<string, number>();
  for (const brand of next.brands) {
    const before = old.get(brand.id);
    if (
      !before ||
      before.currency !== brand.currency ||
      before.area !== brand.area
    )
      continue;
    changes.set(
      brand.currency,
      (changes.get(brand.currency) ?? 0) + brand.revenue - before.revenue,
    );
  }
  return [...changes.values()].some((change) => change > 0.005);
}

export function readBrandSelection(raw: string | null): string[] | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) && value.every((id) => typeof id === "string")
      ? [...new Set(value)]
      : null;
  } catch {
    return null;
  }
}

export function selectPortfolioBrands(
  snapshot: TvSnapshot,
  ids: string[] | null,
): TvSnapshot {
  if (ids === null) return snapshot;
  const selected = new Set(ids);
  const brands = snapshot.brands.filter((b) => selected.has(b.id));
  const totalFor = (rows: TvBrand[]): TvTotals[] => {
    const currencies = new Map<string, TvTotals>();
    for (const row of rows) {
      const total = currencies.get(row.currency) ?? {
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
      currencies.set(row.currency, total);
    }
    return [...currencies.values()]
      .sort((a, b) => a.currency.localeCompare(b.currency))
      .map((total) => ({
        ...total,
        mer:
          total.investment !== null && total.investment > 0
            ? total.revenue / total.investment
            : null,
      }));
  };
  const byBrand = new Map(brands.map((b) => [b.id, b]));
  const currencies = new Set(brands.map((b) => b.currency));
  const trend = (snapshot.revenueTrend ?? [])
    .filter((p) => currencies.has(p.currency))
    .map((p) => ({ ...p, total: 0, b2b: 0, b2c: 0 }));
  const byDay = new Map(trend.map((p) => [`${p.date}:${p.currency}`, p]));
  for (const row of snapshot.brandRevenueTrend ?? []) {
    const brand = byBrand.get(row.clientId);
    if (!brand) continue;
    const point = byDay.get(`${row.date}:${brand.currency}`);
    if (!point) continue;
    point.total += row.revenue;
    point[brand.area === "B2B" ? "b2b" : "b2c"] += row.revenue;
  }
  return {
    ...snapshot,
    brands,
    total: totalFor(brands),
    b2b: totalFor(brands.filter((b) => b.area === "B2B")),
    b2c: totalFor(brands.filter((b) => b.area === "B2C")),
    revenueTrend: snapshot.brandRevenueTrend ? trend : [],
    brandRevenueTrend: snapshot.brandRevenueTrend?.filter((p) =>
      selected.has(p.clientId),
    ),
  };
}

export function portfolioInvestment(brands: TvBrand[], currency: string) {
  const rows = brands.filter((brand) => brand.currency === currency);
  const covered = rows.filter((brand) => brand.investment !== null);
  return {
    available: covered.length
      ? covered.reduce((sum, brand) => sum + brand.investment!, 0)
      : null,
    missing: rows.length - covered.length,
  };
}
