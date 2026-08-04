import { describe, expect, it } from "vitest";
import {
  calculatePerformanceRatios,
  normalizePerformanceChannel,
  percentage,
} from "../src/services/performanceMetrics";

describe("performance metrics", () => {
  it("calculates ROAS, MER and final ROI from ERP revenue, media and covered COGS", () => {
    expect(calculatePerformanceRatios({
      netRevenue: 10_000,
      attributedRevenue: 6_000,
      mediaSpend: 1_000,
      cogs: 4_000,
      returnAmount: 0,
      costCoveragePct: 100,
    })).toEqual({
      roas: 6,
      mer: 10,
      grossProfit: 6_000,
      roi: 100,
      roiStatus: "available",
    });
  });

  it("does not publish final ROI when product cost coverage is insufficient", () => {
    const result = calculatePerformanceRatios({
      netRevenue: 10_000,
      attributedRevenue: 6_000,
      mediaSpend: 1_000,
      cogs: 2_000,
      returnAmount: 0,
      costCoveragePct: 50,
    });
    expect(result.roas).toBe(6);
    expect(result.mer).toBe(10);
    expect(result.roi).toBeNull();
    expect(result.roiStatus).toBe("partial");
  });

  it("deducts ERP returns from gross profit and ROI", () => {
    const result = calculatePerformanceRatios({
      netRevenue: 10_000,
      attributedRevenue: 6_000,
      mediaSpend: 1_000,
      cogs: 4_000,
      returnAmount: 500,
      costCoveragePct: 100,
    });
    expect(result.grossProfit).toBe(5_500);
    expect(result.roi).toBe(90);
  });

  it("normalizes paid evidence into media channels", () => {
    expect(normalizePerformanceChannel({ utmSource: "ig", utmMedium: "instagram_stories", utmCampaign: "cadastro" })).toBe("Meta");
    expect(normalizePerformanceChannel({ utmSource: "google_ads", utmMedium: "cpc", utmCampaign: "pmax" })).toBe("Google");
    expect(normalizePerformanceChannel({ utmSource: "pinterest", utmMedium: "paid", utmCampaign: "catalog" })).toBe("Pinterest");
  });

  it("returns a safe percentage for empty bases", () => {
    expect(percentage(5, 20)).toBe(25);
    expect(percentage(5, 0)).toBe(0);
  });
});
