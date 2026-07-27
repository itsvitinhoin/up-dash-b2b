import { describe, expect, it } from "vitest";
import { computeAutomaticReportPeriod } from "../../../scripts/src/portfolio-report-period";

describe("automatic portfolio report period", () => {
  it("uses the preceding Friday through Sunday on Monday in São Paulo", () => {
    const period = computeAutomaticReportPeriod(new Date("2026-07-13T12:00:00.000Z"));
    expect(period).toMatchObject({
      reportDate: "2026-07-13",
      dateFrom: "2026-07-10",
      dateTo: "2026-07-12",
      periodType: "weekend",
      skip: false,
    });
  });

  it("uses yesterday from Tuesday through Friday and skips weekends", () => {
    expect(computeAutomaticReportPeriod(new Date("2026-07-14T12:00:00.000Z"))).toMatchObject({
      dateFrom: "2026-07-13",
      dateTo: "2026-07-13",
      periodType: "daily",
      skip: false,
    });
    expect(computeAutomaticReportPeriod(new Date("2026-07-18T12:00:00.000Z"))).toMatchObject({
      periodType: "skip",
      skip: true,
    });
  });
});
