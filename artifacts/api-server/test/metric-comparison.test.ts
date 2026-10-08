import { describe, expect, it } from "vitest";
import { metricComparison, precedingPeriod } from "../../up-dash/src/lib/metric-comparison";
describe("metric comparison", () => {
  it("compares equally sized inclusive windows across month and leap-year boundaries", () => {
    expect(precedingPeriod("2026-09-07", "2026-10-06")).toEqual({ dateFrom: "2026-08-08", dateTo: "2026-09-06" });
    expect(precedingPeriod("2024-03-01", "2024-03-01")).toEqual({ dateFrom: "2024-02-29", dateTo: "2024-02-29" });
    expect(precedingPeriod("2026-03-08", "2026-03-10")).toEqual({ dateFrom: "2026-03-05", dateTo: "2026-03-07" });
    expect(() => precedingPeriod("2026-10-06", "2026-10-05")).toThrow();
  });
  it("keeps the direction of changes even when a decline in cost is desirable", () => {
    expect(metricComparison(80, 100)).toEqual({ change: -20, status: "available" });
    expect(metricComparison(120, 100)).toEqual({ change: 20, status: "available" });
    expect(metricComparison(-50, -100)).toEqual({ change: 50, status: "available" });
  });
  it("distinguishes unavailable history, unchanged zero and undefined percent growth", () => {
    expect(metricComparison(0, 0)).toEqual({ change: 0, status: "available" });
    expect(metricComparison(50, 0)).toEqual({ change: null, status: "zero-base" });
    expect(metricComparison(0, 50)).toEqual({ change: -100, status: "available" });
    for (const previous of [null, undefined, NaN, Infinity]) expect(metricComparison(50, previous).status).toBe("unavailable");
    expect(metricComparison(null, 50).status).toBe("unavailable");
  });
});
