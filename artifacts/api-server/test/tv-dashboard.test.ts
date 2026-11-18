import { describe, expect, it } from "vitest";
import {
  rankTv,
  summarizeTv,
  tvCycle,
  tvMer,
  tvWindow,
} from "../src/services/tv-dashboard-metrics";
import { revenueIncreased } from "../../up-dash/src/lib/tv-dashboard";
import type { TvBrand, TvSnapshot } from "@workspace/api-zod";

const brand = (
  id: string,
  revenue: number,
  investment: number | null,
  area: "B2B" | "B2C" = "B2B",
  currency = "BRL",
): TvBrand => ({
  id,
  name: id,
  area,
  currency,
  revenue,
  investment,
  mer: tvMer(revenue, investment),
  warning: null,
});
const snapshot = (cycle: string, brands: TvBrand[]): TvSnapshot => ({
  cycle,
  brands,
  dateFrom: "2026-08-21",
  dateTo: "2026-11-18",
  updatedAt: cycle,
  total: summarizeTv(brands),
  b2b: [],
  b2c: [],
});

describe("90-day portfolio monitor", () => {
  it("uses exactly 90 inclusive dates in Brasília around midnight and leap years", () => {
    const before = tvWindow(new Date("2026-11-19T02:59:59Z"));
    expect(before.dateTo).toBe("2026-11-18");
    expect(before.dateFrom).toBe("2026-08-21");
    expect(before.from.toISOString()).toBe("2026-08-21T03:00:00.000Z");
    expect(before.to.toISOString()).toBe("2026-11-19T02:59:59.999Z");
    expect(tvWindow(new Date("2024-03-01T12:00:00Z")).dateFrom).toBe(
      "2023-12-03",
    );
  });
  it("rolls the cycle only at the two existing scheduled extraction times", () => {
    expect(tvCycle(new Date("2026-11-18T02:59:59Z"))).toBe(
      "2026-11-17T15:00:00.000Z",
    );
    expect(tvCycle(new Date("2026-11-18T03:00:00Z"))).toBe(
      "2026-11-18T03:00:00.000Z",
    );
    expect(tvCycle(new Date("2026-11-18T14:59:59Z"))).toBe(
      "2026-11-18T03:00:00.000Z",
    );
    expect(tvCycle(new Date("2026-11-18T15:00:00Z"))).toBe(
      "2026-11-18T15:00:00.000Z",
    );
  });
  it("calculates consolidated MER from sums rather than averaging brand ratios", () => {
    expect(
      summarizeTv([brand("a", 1000, 100), brand("b", 600, 300, "B2C")]),
    ).toEqual([{ currency: "BRL", revenue: 1600, investment: 400, mer: 4 }]);
    expect(tvMer(100, 0)).toBeNull();
    expect(tvMer(100, null)).toBeNull();
  });
  it("does not treat missing spend as zero or mix currencies", () => {
    expect(
      summarizeTv([
        brand("a", 100, 10),
        brand("b", 200, null),
        brand("c", 50, 5, "B2C", "USD"),
      ]),
    ).toEqual([
      { currency: "BRL", revenue: 300, investment: null, mer: null },
      { currency: "USD", revenue: 50, investment: 5, mer: 10 },
    ]);
  });
  it("ranks every brand by revenue descending, including zero-sales brands", () => {
    const input = [brand("z", 0, 0), brand("a", 100, 10), brand("b", 200, 10)];
    expect(rankTv(input).map((b) => b.id)).toEqual(["b", "a", "z"]);
    expect(input[0].id).toBe("z");
  });
  it("sounds only on an increased total after a new extraction cycle", () => {
    const old = snapshot("cycle1", [brand("a", 100, 10), brand("b", 100, 10)]);
    expect(revenueIncreased(undefined, old)).toBe(false);
    expect(
      revenueIncreased(old, snapshot("cycle1", [brand("a", 300, 10)])),
    ).toBe(false);
    expect(
      revenueIncreased(
        old,
        snapshot("cycle2", [brand("a", 110, 10), brand("b", 100, 10)]),
      ),
    ).toBe(true);
    expect(
      revenueIncreased(
        old,
        snapshot("cycle2", [brand("a", 110, 10), brand("b", 80, 10)]),
      ),
    ).toBe(false);
    expect(
      revenueIncreased(
        old,
        snapshot("cycle2", [brand("a", 100, 10), brand("new", 999, 10)]),
      ),
    ).toBe(false);
    expect(
      revenueIncreased(
        old,
        snapshot("cycle2", [brand("a", 100, 10, "B2B", "USD")]),
      ),
    ).toBe(false);
  });
});

describe("daily revenue line series", () => {
  it("fills calendar gaps and separates paid B2C from requested B2B without mixing currencies", async () => {
    const { buildTvRevenueTrend } =
      await import("../src/services/tv-dashboard-metrics");
    const points = buildTvRevenueTrend(
      [
        { clientId: "a", date: "2026-11-17", requested: 1000, paid: 100 },
        { clientId: "b", date: "2026-11-17", requested: 900, paid: 200 },
        { clientId: "c", date: "2026-11-18", requested: 50, paid: 5 },
      ],
      [
        { id: "a", dashboardType: "B2B", currency: "BRL" },
        { id: "b", dashboardType: "B2C", currency: "BRL" },
        { id: "c", dashboardType: "B2B", currency: "USD" },
      ],
      "2026-11-17",
      "2026-11-18",
    );
    expect(points).toEqual([
      { date: "2026-11-17", currency: "BRL", total: 1200, b2b: 1000, b2c: 200 },
      { date: "2026-11-17", currency: "USD", total: 0, b2b: 0, b2c: 0 },
      { date: "2026-11-18", currency: "BRL", total: 0, b2b: 0, b2c: 0 },
      { date: "2026-11-18", currency: "USD", total: 50, b2b: 50, b2c: 0 },
    ]);
  });
});
