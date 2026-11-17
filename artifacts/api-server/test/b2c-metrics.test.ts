import { describe, expect, it } from "vitest";
import { buildProductSalesBreakdowns } from "../src/services/product-sales-breakdowns";
import { topCreativesFromStored } from "../src/services/vesti-ads-stored";

describe("B2C product dimensions", () => {
  it("repairs inverted legacy variations while preserving units and revenue", () => {
    const result = buildProductSalesBreakdowns([
      { category: "Vestido", color: "M - 40", size: "Azul", units: 2, revenue: 200 },
      { category: "Vestido", color: "Azul", size: "M - 40", units: 3, revenue: 300 },
      { category: null, color: "G1", size: "Rosa", units: 1, revenue: 80 },
    ]);
    expect(result.totals).toEqual({ units: 6, revenue: 580 });
    expect(result.colors).toContainEqual({
      label: "Azul",
      units: 5,
      revenue: 500,
    });
    expect(result.sizes).toContainEqual({ label: "M - 40", units: 5, revenue: 500 });
    expect(result.colors.some((row) => row.label === "G1")).toBe(false);
  });
});
describe("B2C stored Meta creative rankings", () => {
  it("ranks purchase conversions even when the creative has no leads; keeps B2B lead ranking", () => {
    const base = {
      name: "Ad",
      spend: 50,
      impressions: 1000,
      clicks: 20,
      leads: 0,
      purchases: 5,
      revenue: 500,
      thumbnailUrl: null,
      status: "ACTIVE",
    };
    const rows = [
      { ...base, id: "buyer" },
      { ...base, id: "lead", leads: 10, purchases: 0 },
    ];
    expect(topCreativesFromStored(rows, true).cpl.map((row) => row.id)).toEqual(
      ["buyer"],
    );
    expect(topCreativesFromStored(rows, true).leads[0].purchases).toBe(5);
    expect(topCreativesFromStored(rows).leads.map((row) => row.id)).toEqual([
      "lead",
    ]);
  });
});
