import { describe, expect, it } from "vitest";
import { advanceBraavoCursor, braavoFullRefreshDays, initialBraavoCursor } from "../src/services/braavo-sync";

const now = new Date("2026-11-10T15:00:00-03:00");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

describe("Braavo cycle: full load versus small incremental window", () => {
  it("starts with a full load when the shop was never completed", () => {
    expect(initialBraavoCursor(now)).toMatchObject({ full: true, fromDay: null, phase: "categories", untilDay: "2026-11-10", bulk: true });
  });

  it("after a full load the next cycles only look at a small window up to today", () => {
    const completedAt = new Date("2026-11-10T09:10:00-03:00");
    expect(initialBraavoCursor(now, completedAt, daysAgo(2))).toMatchObject({
      full: false,
      fromDay: "2026-11-09",
      untilDay: "2026-11-10",
    });
  });

  it("repeats the full load only after 90 days by default, so a panel click a week later stays incremental", () => {
    expect(initialBraavoCursor(now, daysAgo(0.2), daysAgo(8))).toMatchObject({ full: false });
    expect(initialBraavoCursor(now, daysAgo(0.2), daysAgo(89.9))).toMatchObject({ full: false });
    expect(initialBraavoCursor(now, daysAgo(0.2), daysAgo(90))).toMatchObject({ full: true, fromDay: null });
    expect(initialBraavoCursor(now, daysAgo(0.2), daysAgo(91))).toMatchObject({ full: true });
  });

  it("lets the full-refresh interval be lowered explicitly", () => {
    expect(initialBraavoCursor(now, daysAgo(0.2), daysAgo(6.9), 7)).toMatchObject({ full: false });
    expect(initialBraavoCursor(now, daysAgo(0.2), daysAgo(8), 7)).toMatchObject({ full: true });
  });

  it("reads BRAAVO_FULL_REFRESH_DAYS and fails loudly on a typo", () => {
    expect(braavoFullRefreshDays(undefined)).toBe(90);
    expect(braavoFullRefreshDays("")).toBe(90);
    expect(braavoFullRefreshDays("30")).toBe(30);
    for (const bad of ["abc", "0", "-1", "1.5", "3651"])
      expect(() => braavoFullRefreshDays(bad)).toThrow(/BRAAVO_FULL_REFRESH_DAYS inválido/);
  });
});

describe("Braavo cycle phases: bulk order items only in the full load", () => {
  const base = { page: 3, day: null, fromDay: null, untilDay: "2026-11-10", startedAt: "2026-11-10T12:00:00Z" } as const;

  it("full load copies the items in bulk between customers and orders, then skips the pending recheck", () => {
    const full = { ...base, full: true };
    // Endereços dos clientes em lote antes de ler os clientes.
    const afterSkus = advanceBraavoCursor({ ...full, phase: "skus" }, true);
    expect(afterSkus).toMatchObject({ phase: "customer_addresses", page: 1 });
    expect(advanceBraavoCursor(afterSkus, true)).toMatchObject({ phase: "customers", page: 1 });
    const afterCustomers = advanceBraavoCursor({ ...full, phase: "customers" }, true);
    expect(afterCustomers).toMatchObject({ phase: "order_items", page: 1 });
    const afterItems = advanceBraavoCursor(afterCustomers, true);
    expect(afterItems).toMatchObject({ phase: "orders", page: 1 });
    expect(advanceBraavoCursor(afterItems, true)).toMatchObject({ phase: "done" });
  });

  it("incremental cycle keeps reading each changed order and still rechecks pending ones", () => {
    const inc = { ...base, full: false, fromDay: "2026-11-09" };
    // No incremental não há cópia de endereços: clientes alterados são poucos e vêm do detalhe.
    expect(advanceBraavoCursor({ ...inc, phase: "skus", day: "2026-11-10" }, true)).toMatchObject({ phase: "customers", day: "2026-11-09" });
    const afterProducts = advanceBraavoCursor({ ...inc, phase: "products", day: "2026-11-10" }, true);
    expect(afterProducts).toMatchObject({ phase: "skus", day: "2026-11-09" }); // SKUs também por dia
    const afterCustomers = advanceBraavoCursor({ ...inc, phase: "customers", day: "2026-11-10" }, true);
    expect(afterCustomers).toMatchObject({ phase: "orders", day: "2026-11-09" });
    expect(advanceBraavoCursor({ ...afterCustomers, day: "2026-11-10" }, true)).toMatchObject({ phase: "pending" });
  });

  it("a page of the items phase advances to the next page until it is complete", () => {
    expect(advanceBraavoCursor({ ...base, full: true, phase: "order_items" }, false)).toMatchObject({ phase: "order_items", page: 4 });
  });
});
