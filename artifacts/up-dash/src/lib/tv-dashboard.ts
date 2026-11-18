import type { TvSnapshot } from "@workspace/api-client-react";

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
