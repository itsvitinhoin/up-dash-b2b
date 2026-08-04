import { describe, expect, it } from "vitest";
import {
  calculateErpFulfilledQuantity,
  calculateErpRetentionPct,
  calculateErpSalesPower,
  calculateErpStockCoverageDays,
  calculateErpStockTurnoverPct,
  hasPaidErpCampaignSignal,
} from "../src/services/erpMetrics";

describe("ERP metric rules", () => {
  it("classifies paid media evidence and rejects Linktree-only traffic", () => {
    expect(
      hasPaidErpCampaignSignal({
        utmSource: "instagram",
        utmMedium: "linktree",
        utmCampaign: "linktree",
      }),
    ).toBe(false);

    expect(
      hasPaidErpCampaignSignal({
        utmSource: "ig",
        utmMedium: "instagram_stories",
        utmCampaign: "UP.LA [CADASTRO]",
      }),
    ).toBe(true);

    expect(
      hasPaidErpCampaignSignal({
        utmSource: "google",
        utmMedium: "cpc",
        utmCampaign: "atacado",
      }),
    ).toBe(true);

    expect(
      hasPaidErpCampaignSignal({
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
      }),
    ).toBe(false);
  });

  it("calculates retention from unique buyers in the period", () => {
    expect(calculateErpRetentionPct(23, 33)).toBeCloseTo(69.6969, 3);
    expect(calculateErpRetentionPct(0, 0)).toBe(0);
  });

  it("subtracts returned units without producing negative fulfillment", () => {
    expect(calculateErpFulfilledQuantity(12, 2)).toBe(10);
    expect(calculateErpFulfilledQuantity(1, 3)).toBe(0);
  });

  it("calculates stock turnover from sold units and the current stock snapshot", () => {
    expect(calculateErpStockTurnoverPct(20, 80)).toBe(20);
    expect(calculateErpStockTurnoverPct(10, 0)).toBe(100);
    expect(calculateErpStockTurnoverPct(0, 50)).toBe(0);
    expect(calculateErpStockTurnoverPct(0, 0)).toBe(0);
    expect(calculateErpStockTurnoverPct(10, -2)).toBe(100);
  });

  it("calculates sales power without treating negative stock as available inventory", () => {
    expect(calculateErpSalesPower(8, 129)).toBe(1032);
    expect(calculateErpSalesPower(-2, 129)).toBe(0);
    expect(calculateErpSalesPower(8, -10)).toBe(0);
  });

  it("calculates remaining stock days from the selected period sales pace", () => {
    expect(calculateErpStockCoverageDays(30, 60, 30)).toBe(60);
    expect(calculateErpStockCoverageDays(15, 10, 30)).toBe(20);
    expect(calculateErpStockCoverageDays(10, -2, 30)).toBe(0);
    expect(calculateErpStockCoverageDays(0, 50, 30)).toBeNull();
  });
});
