import { describe, expect, it } from "vitest";
import { braavoFullRefreshDays, initialBraavoCursor } from "../src/services/braavo-sync";

const now = new Date("2026-11-10T15:00:00-03:00");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

describe("Braavo cycle: full load versus small incremental window", () => {
  it("starts with a full load when the shop was never completed", () => {
    expect(initialBraavoCursor(now)).toMatchObject({ full: true, fromDay: null, phase: "categories", untilDay: "2026-11-10" });
  });

  it("after a full load the next cycles only look at a small window up to today", () => {
    const completedAt = new Date("2026-11-10T09:10:00-03:00");
    expect(initialBraavoCursor(now, completedAt, daysAgo(2))).toMatchObject({
      full: false,
      fromDay: "2026-11-09",
      untilDay: "2026-11-10",
    });
  });

  it("repeats the full load after 7 days by default", () => {
    expect(initialBraavoCursor(now, daysAgo(0.2), daysAgo(6.9))).toMatchObject({ full: false });
    expect(initialBraavoCursor(now, daysAgo(0.2), daysAgo(7))).toMatchObject({ full: true, fromDay: null });
    expect(initialBraavoCursor(now, daysAgo(0.2), daysAgo(8))).toMatchObject({ full: true });
  });

  it("keeps small windows for a huge shop when the full-refresh interval is raised", () => {
    expect(initialBraavoCursor(now, daysAgo(0.2), daysAgo(8), 90)).toMatchObject({ full: false });
    expect(initialBraavoCursor(now, daysAgo(0.2), daysAgo(91), 90)).toMatchObject({ full: true });
  });

  it("reads BRAAVO_FULL_REFRESH_DAYS and fails loudly on a typo", () => {
    expect(braavoFullRefreshDays(undefined)).toBe(7);
    expect(braavoFullRefreshDays("")).toBe(7);
    expect(braavoFullRefreshDays("90")).toBe(90);
    for (const bad of ["abc", "0", "-1", "1.5", "3651"])
      expect(() => braavoFullRefreshDays(bad)).toThrow(/BRAAVO_FULL_REFRESH_DAYS inválido/);
  });
});
