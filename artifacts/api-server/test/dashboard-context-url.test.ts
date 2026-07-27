import { describe, expect, it } from "vitest";
import {
  mergeDashboardUrlContext,
  parseDashboardUrlContext,
} from "../../up-dash/src/lib/dashboard-context-url";

describe("dashboard URL context", () => {
  it("parses the complete global context and accepts dashboardMode as a legacy alias", () => {
    expect(
      parseDashboardUrlContext(
        "?clientId=brand-1&dashboardMode=B2C&dateFrom=2026-07-10&dateTo=2026-07-12",
      ),
    ).toEqual({
      clientId: "brand-1",
      dashboardMode: "B2C",
      dateFrom: "2026-07-10",
      dateTo: "2026-07-12",
    });
  });

  it("rejects invalid or inverted periods", () => {
    const parsed = parseDashboardUrlContext(
      "?clientId=brand-1&mode=B2B&dateFrom=2026-07-30&dateTo=2026-07-01",
    );
    expect(parsed.dateFrom).toBeNull();
    expect(parsed.dateTo).toBeNull();
  });

  it("updates context without removing page-specific filters", () => {
    const params = mergeDashboardUrlContext("?search=vestido&category=SALE", {
      clientId: "brand-2",
      dashboardMode: "B2B",
      dateFrom: "2026-07-01",
      dateTo: "2026-07-10",
    });
    expect(params.get("search")).toBe("vestido");
    expect(params.get("category")).toBe("SALE");
    expect(params.get("clientId")).toBe("brand-2");
    expect(params.get("mode")).toBe("B2B");
  });
});
