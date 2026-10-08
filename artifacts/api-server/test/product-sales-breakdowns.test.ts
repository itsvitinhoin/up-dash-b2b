import { describe, expect, it } from "vitest";
import { buildProductSalesBreakdowns } from "../src/services/product-sales-breakdowns";

describe("Product sales partitions", () => {
  it("reconciles pieces and sale revenue across all dimensions without duplicating variants", () => {
    const result = buildProductSalesBreakdowns([
      { category: "Vestidos", color: "Preto", size: "P", units: 2, revenue: 199.9 },
      { category: " Vestidos ", color: "preto", size: "M", units: 3, revenue: 330 },
      { category: "Blusas", color: "Branco", size: "P", units: 1, revenue: 50 },
      { category: null, color: " ", size: null, units: 1, revenue: 25.25 },
    ]);
    expect(result.totals.units).toBe(7);
    expect(result.totals.revenue).toBeCloseTo(605.15);
    for (const buckets of [result.categories, result.colors, result.sizes]) {
      expect(buckets.reduce((sum, row) => sum + row.units, 0)).toBe(7);
      expect(buckets.reduce((sum, row) => sum + row.revenue, 0)).toBeCloseTo(605.15);
      expect(buckets.find(row => row.label === "Não informado")).toMatchObject({ units: 1, revenue: 25.25 });
    }
    expect(result.categories[0]).toMatchObject({ label: "Vestidos", units: 5 });
    expect(result.colors[0]).toMatchObject({ label: "Preto", units: 5 });
    expect(result.sizes.find(row => row.label === "P")?.units).toBe(3);
  });

  it("keeps the full catalog tail, zero sales, negative adjustments and empty scopes honest", () => {
    const rows = Array.from({ length: 1205 }, (_, index) => ({ category: `Categoria ${index}`, color: "Azul", size: "M", units: 1, revenue: 10 }));
    rows.push({ category: "Ajuste", color: "Azul", size: "M", units: -2, revenue: -20 });
    rows.push({ category: "Zero", color: "Azul", size: "M", units: 0, revenue: 0 });
    const result = buildProductSalesBreakdowns(rows);
    expect(result.categories).toHaveLength(1207);
    expect(result.totals).toEqual({ units: 1203, revenue: 12030 });
    expect(result.colors).toEqual([{ label: "Azul", units: 1203, revenue: 12030 }]);
    expect(buildProductSalesBreakdowns([])).toEqual({ totals: { units: 0, revenue: 0 }, categories: [], colors: [], sizes: [] });
  });
});
