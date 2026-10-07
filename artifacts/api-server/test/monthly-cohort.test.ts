import { describe, expect, it } from "vitest";
import { buildMonthlyCohort } from "../src/services/monthly-cohort";
const purchase = (date: string, grossValue = 100) => ({requestedAt: new Date(date), grossValue});
describe("Calendar-month cohort retention", () => {
  it("counts distinct customers by calendar month, not cumulative 30-day windows", () => {
    const history = new Map([
      ["a", [purchase("2026-06-30T12:00:00-03:00"), purchase("2026-07-01T12:00:00-03:00"), purchase("2026-07-02T12:00:00-03:00"), purchase("2026-09-01T12:00:00-03:00")]],
      ["b", [purchase("2026-06-01T12:00:00-03:00"), purchase("2026-08-31T12:00:00-03:00")]],
      ["old", [purchase("2026-01-01T12:00:00-03:00"), purchase("2026-07-10T12:00:00-03:00")]],
    ]);
    const {rows} = buildMonthlyCohort(history, "2026-09-30");
    expect(rows[0]).toEqual({month:"2026-06",customers:2,retention:[100,50,50,50]});
    expect(rows[1].customers).toBe(0);
    expect(rows[1].retention).toEqual([null,null,null,null]);
  });
  it("respects the Brazilian month boundary, cutoff, future cells and positive orders", () => {
    const history = new Map([
      ["a", [purchase("2026-10-01T02:59:00Z"), purchase("2026-10-06T20:00:00Z"), purchase("2026-10-07T12:00:00Z")]],
      ["b", [purchase("2026-10-01T03:00:00Z"), purchase("2026-11-01T12:00:00Z")]],
      ["future", [purchase("2026-10-07T12:00:00Z")]],
      ["zero", [purchase("2026-09-10T12:00:00Z",0), purchase("2026-10-02T12:00:00Z")]],
    ]);
    const result = buildMonthlyCohort(history,"2026-10-06");
    expect(result.rows[2]).toEqual({month:"2026-09",customers:1,retention:[100,100,null,null]});
    expect(result.rows[3]).toEqual({month:"2026-10",customers:2,retention:[100,null,null,null]});
    expect(result.observedThrough).toBe("2026-10-06");
    expect(history.get("a")).toHaveLength(3);
  });
});
