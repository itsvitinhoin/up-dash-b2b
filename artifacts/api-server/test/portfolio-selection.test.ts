import { describe, expect, it } from "vitest";
import {
  readBrandSelection,
  selectPortfolioBrands,
  revenueIncreased,
  portfolioInvestment,
} from "../../up-dash/src/lib/tv-dashboard";
import type { TvSnapshot } from "@workspace/api-zod";
const data: TvSnapshot = {
  cycle: "one",
  dateFrom: "2026-11-17",
  dateTo: "2026-11-18",
  updatedAt: "now",
  brands: [
    {
      id: "ours",
      name: "Managed",
      area: "B2B",
      currency: "BRL",
      revenue: 1000,
      investment: 100,
      mer: 10,
      warning: null,
    },
    {
      id: "external",
      name: "External",
      area: "B2C",
      currency: "BRL",
      revenue: 9000,
      investment: null,
      mer: null,
      warning: "missing",
    },
  ],
  total: [],
  b2b: [],
  b2c: [],
  revenueTrend: [
    { date: "2026-11-17", currency: "BRL", total: 400, b2b: 400, b2c: 0 },
    { date: "2026-11-18", currency: "BRL", total: 9600, b2b: 600, b2c: 9000 },
  ],
  brandRevenueTrend: [
    { clientId: "ours", date: "2026-11-17", revenue: 400 },
    { clientId: "ours", date: "2026-11-18", revenue: 600 },
    { clientId: "external", date: "2026-11-18", revenue: 9000 },
  ],
};
describe("managed brand selection", () => {
  it("recalculates every total, MER and daily line only from selected brands", () => {
    const result = selectPortfolioBrands(data, ["ours"]);
    expect(result.brands.map((b) => b.id)).toEqual(["ours"]);
    expect(result.total).toEqual([
      { currency: "BRL", revenue: 1000, investment: 100, mer: 10 },
    ]);
    expect(result.b2b).toEqual(result.total);
    expect(result.b2c).toEqual([]);
    expect(result.revenueTrend?.map((p) => p.total)).toEqual([400, 600]);
    expect(result.revenueTrend?.every((p) => p.b2c === 0)).toBe(true);
    expect(result.brandRevenueTrend?.every((p) => p.clientId === "ours")).toBe(
      true,
    );
    expect(data.brands).toHaveLength(2);
  });
  it("keeps an explicit empty selection empty and ignores deleted/inactive ids", () => {
    expect(selectPortfolioBrands(data, []).brands).toEqual([]);
    expect(selectPortfolioBrands(data, ["old"]).revenueTrend).toEqual([]);
    expect(selectPortfolioBrands(data, null)).toBe(data);
    expect(selectPortfolioBrands(data, ["ours", "ours"]).brands).toHaveLength(
      1,
    );
  });
  it("does not silently restore all brands for a saved empty selection", () => {
    expect(readBrandSelection("[]")).toEqual([]);
    expect(readBrandSelection('["ours","ours"]')).toEqual(["ours"]);
    for (const raw of [null, "broken", "{}", "[1]"])
      expect(readBrandSelection(raw)).toBeNull();
  });
  it("ignores revenue changes in brands outside the selection", () => {
    const next = {
      ...data,
      cycle: "two",
      brands: data.brands.map((b) =>
        b.id === "external" ? { ...b, revenue: 20000 } : b,
      ),
    };
    expect(
      revenueIncreased(
        selectPortfolioBrands(data, ["ours"]),
        selectPortfolioBrands(next, ["ours"]),
      ),
    ).toBe(false);
  });
});

describe("available investment", () => {
  it("shows known spend without treating missing spend as zero", () => {
    expect(portfolioInvestment(data.brands, "BRL")).toEqual({
      available: 100,
      missing: 1,
    });
    expect(
      portfolioInvestment(selectPortfolioBrands(data, ["ours"]).brands, "BRL"),
    ).toEqual({ available: 100, missing: 0 });
    expect(
      portfolioInvestment(
        selectPortfolioBrands(data, ["external"]).brands,
        "BRL",
      ),
    ).toEqual({ available: null, missing: 1 });
    expect(
      selectPortfolioBrands(data, ["ours", "external"]).total[0].mer,
    ).toBeNull();
  });
  it("keeps reported zero and different currencies distinct", () => {
    const rows = [
      { ...data.brands[0], investment: 0 },
      { ...data.brands[0], id: "usd", currency: "USD", investment: 50 },
    ];
    expect(portfolioInvestment(rows, "BRL")).toEqual({
      available: 0,
      missing: 0,
    });
    expect(portfolioInvestment(rows, "USD")).toEqual({
      available: 50,
      missing: 0,
    });
  });
});
