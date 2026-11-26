import { describe, expect, it, vi } from "vitest";
vi.mock("../src/services/bling-analytics", () => ({
  getBlingAnalytics: vi.fn(),
}));
import {
  blingProductLayout,
  blingOrderLayout,
  blingBuyerLayout,
  blingDashboardLayout,
} from "../src/services/bling-erp-layout";

const product = (
  id: string,
  parentId: string | null,
  available: number | null,
  units = 0,
) => ({
  id,
  parentId,
  name: `Produto ${id}`,
  sku: `SKU-${id}`,
  price: 10,
  units,
  value: units * 10,
  stock: available === null ? null : { available, physical: available },
});
const filters = { page: 1, limit: 20, search: "" };
describe("Bling contract for the shared ERP pages", () => {
  it("groups variants without double-counting their parent inventory and preserves missing balances", () => {
    const result = blingProductLayout(
      [
        product("pai", null, 100),
        product("azul", "pai", 3, 2),
        product("rosa", "pai", 5, 1),
        product("zero", null, 0),
        product("unknown", null, null),
        product("negative", null, -2),
      ],
      filters,
    );
    expect(result.total).toBe(4);
    expect(result.totalStock).toBe(6); // 3 + 5 + 0 - 2, never + parent 100.
    expect(result.totalSkus).toBe(5);
    expect(result.outOfStockCount).toBe(1);
    expect(result.negativeStockCount).toBe(1);
    expect(result.rows.find((r) => r.id === "pai")).toMatchObject({
      stock: 8,
      units: 3,
      revenue: 30,
      variantCount: 2,
      grossMarginPct: null,
      coverageDays: null,
    });
    expect(result.rows.find((r) => r.id === "unknown")?.stock).toBeNull();
    expect(
      blingProductLayout(
        [product("zero", null, 0), product("unknown", null, null)],
        { ...filters, stockStatus: "out_of_stock" },
      ).rows.map((p) => p.id),
    ).toEqual(["zero"]);
  });
  it("keeps direct parent sales while excluding parent stock already represented by children", () => {
    const result = blingProductLayout(
      [product("pai", null, 100, 4), product("child", "pai", 5, 2)],
      filters,
    );
    expect(result.totalUnits).toBe(6);
    expect(result.totalStock).toBe(5);
    expect(
      result.rows[0].variants.find((v) => v.id === "pai")?.stock,
    ).toBeNull();
  });
  it("filters by child SKU, sorts parent groups and paginates without losing variants", () => {
    const catalog = [
      product("pai", null, 8),
      product("child", "pai", 8, 5),
      product("other", null, 1, 1),
    ];
    const result = blingProductLayout(catalog, {
      ...filters,
      search: "SKU-child",
      limit: 1,
    });
    expect(result.filteredTotal).toBe(1);
    expect(result.rows[0].id).toBe("pai");
    expect(
      blingProductLayout(catalog, {
        ...filters,
        layoutSort: "units",
        limit: 1,
        page: 2,
      }).rows[0].id,
    ).toBe("other");
  });
  it("never fabricates financial fields, lifetime classifications, addresses or clock times", () => {
    const order = blingOrderLayout({
      id: "source",
      number: "123",
      day: "2026-11-01",
      customerId: "buyer",
      customerName: "Contato",
      channelName: "Canal 10",
      statusId: "99",
      total: 80,
      items: [{ id: "item", quantity: 2, unitPrice: 35 }],
    });
    expect(order).toMatchObject({
      id: "123",
      externalId: "source",
      createdAt: "2026-11-01",
      grossAmount: null,
      netAmount: null,
      requestedQuantity: 2,
      orderValue: 80,
      status: "ID 99",
      seller: null,
      state: null,
      paymentMethod: null,
    });
    expect(order.items[0]).toMatchObject({
      grossAmount: 70,
      netAmount: null,
      costPrice: null,
      discountAmount: null,
    });
    expect(
      blingBuyerLayout({
        id: "buyer",
        name: "Contato",
        orders: 3,
        value: 100,
        first_day: "2026-11-01",
        last_day: "2026-11-03",
      }),
    ).toMatchObject({
      buyerType: null,
      segment: null,
      historicalOrders: null,
      lifetimeValue: null,
      totalSpent: 100,
      lastOrderAt: "2026-11-03",
    });
    const dashboard = blingDashboardLayout({
      orders: 2,
      orderValue: 100,
      customers: 1,
      units: 3,
      channels: [{ id: "10", name: "Canal 10", orders: 2, value: 100 }],
      daily: [{ day: "2026-11-01", orders: 2, value: 100 }],
      statuses: [{ id: "99", orders: 2, value: 100 }],
      coverage: { from: "2026-11-01", to: "2026-11-03" },
    });
    expect(dashboard.kpis).toMatchObject({
      netRevenue: null,
      grossRevenue: null,
      retentionPct: null,
      newCustomers: null,
      cancelledOrders: null,
      orders: 2,
      totalQuantity: 3,
      avgTicket: 50,
    });
    expect(dashboard.source.statusOptions).toEqual([
      { value: "99", label: "ID 99" },
    ]);
    expect(dashboard.breakdowns.stores[0]).toMatchObject({
      label: "Canal 10",
      orders: 2,
      revenue: 100,
    });
    expect(dashboard.breakdowns.states).toEqual([]);
  });
});
