import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@workspace/db", async () => ({ ...(await import("@workspace/db/schema")), db: {} }));
import { fetchMetaPeriodBreakdowns } from "../src/services/meta-ads";
afterEach(() => vi.unstubAllGlobals());
describe("Meta period metrics", () => {
  it("reads deduplicated reach and regional investment without daily sums, and shares cached reads", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const data = url.searchParams.get("breakdowns") === "region"
        ? [{ region: "São Paulo", spend: "100", actions: [{ action_type: "purchase", value: "3" }], action_values: [{ action_type: "purchase", value: "500" }] }]
        : [{ reach: "250", frequency: "2.4" }];
      expect(url.searchParams.has("time_increment")).toBe(false);
      if(url.searchParams.get("breakdowns") === "region") expect(url.searchParams.get("fields")).toBe("spend");
      return new Response(JSON.stringify({ data }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);
    const params = { accessToken: "period-test", adAccountId: "act_period_test", since: "2026-11-01", until: "2026-11-17" };
    const [one, two] = await Promise.all([fetchMetaPeriodBreakdowns(params), fetchMetaPeriodBreakdowns(params)]);
    expect(one).toEqual(two);
    expect(one).toEqual({ reach: 250, frequency: 2.4, regions: [{ state: "São Paulo", spend: 100 }] });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
