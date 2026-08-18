import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getUpzeroAnalyticsMetrics,
  summarizeUpzeroSellerPurchases,
} from "../src/services/upzero/analytics-metrics";

function metric(id: number, sellerId: number, orderId: number | null) {
  return {
    id,
    period_start: "2026-08-17T12:00:00Z",
    period_type: "hour",
    event_name: "order_paid",
    product: null,
    product_variant: null,
    category: null,
    user: null,
    seller: {
      id: sellerId,
      name: "Ana",
      seller_slug: "ana",
    },
    order_id: orderId,
    total_events: 1,
    unique_users: 1,
    unique_sessions: 1,
    total_quantity: 2,
    total_value: 399.9,
    updated_at: "2026-08-17T12:05:00Z",
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UP Zero analytics metrics", () => {
  it("preserves seller attribution and follows next_cursor", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [metric(1, 64, 201)],
            total: 2,
            next_cursor: "cursor-2",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [metric(2, 65, 202)],
            total: 2,
            next_cursor: null,
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await getUpzeroAnalyticsMetrics({
      from: "2026-08-17T00:00:00Z",
      to: "2026-08-18T00:00:00Z",
      apiKey: "test-key",
      eventName: "order_paid",
      sellerId: 64,
      orderId: 201,
    });

    expect(response.data).toHaveLength(2);
    expect(response.data[0]?.seller).toEqual({
      id: 64,
      name: "Ana",
      seller_slug: "ana",
    });
    expect(response.data[0]?.order_id).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    const secondUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(firstUrl.searchParams.get("event_name")).toBe("order_paid");
    expect(firstUrl.searchParams.get("seller_id")).toBe("64");
    expect(firstUrl.searchParams.get("order_id")).toBe("201");
    expect(firstUrl.searchParams.get("limit")).toBe("1000");
    expect(secondUrl.searchParams.get("cursor")).toBe("cursor-2");
  });

  it("aggregates purchase totals by seller without requiring order_id", () => {
    const first = metric(1, 64, 201);
    first.event_name = "purchase";
    first.order_id = null;
    first.total_events = 2;
    first.total_value = 599.9;
    const second = metric(2, 64, 202);
    second.event_name = "purchase";
    second.order_id = null;
    second.total_events = 1;
    second.total_value = 250;

    const totals = summarizeUpzeroSellerPurchases([first, second]);

    expect(totals.get(64)).toMatchObject({
      sellerName: "Ana",
      totalOrders: 3,
      totalRevenue: 849.9,
    });
  });
});
