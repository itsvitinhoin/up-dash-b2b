import { describe, expect, it } from "vitest";
import {
  calculateErpFulfilledQuantity,
  calculateErpRetentionPct,
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
});
