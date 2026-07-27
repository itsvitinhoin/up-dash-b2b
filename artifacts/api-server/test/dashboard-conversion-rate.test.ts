import { describe, expect, it } from "vitest";
import { calculateDashboardConversionRate } from "../src/services/dashboard-metrics";

describe("Dashboard conversion rate", () => {
  it("uses approved registrations as the B2B denominator", () => {
    expect(
      calculateDashboardConversionRate({
        isB2C: false,
        orders: 12,
        visits: 0,
        approvedLeads: 80,
      }),
    ).toBe(15);
  });

  it("keeps sessions as the B2C denominator", () => {
    expect(
      calculateDashboardConversionRate({
        isB2C: true,
        orders: 12,
        visits: 600,
        approvedLeads: 80,
      }),
    ).toBe(2);
  });

  it("returns zero when the relevant denominator is unavailable", () => {
    expect(
      calculateDashboardConversionRate({
        isB2C: false,
        orders: 4,
        visits: 500,
        approvedLeads: 0,
      }),
    ).toBe(0);
  });
});
