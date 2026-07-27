import { describe, expect, it } from "vitest";
import { buildProductsPeriodParams } from "../../up-dash/src/lib/products-period";

describe("Products period context", () => {
  it("uses the same global period for summary, insight and table requests", () => {
    const params = buildProductsPeriodParams({
      clientId: "client-1",
      from: new Date(2026, 6, 10),
      to: new Date(2026, 6, 12),
    });
    expect(params).toEqual({
      clientId: "client-1",
      dateFrom: "2026-07-10",
      dateTo: "2026-07-12",
    });
    expect({ ...params, screen: "products" }).toMatchObject(params);
  });
});
