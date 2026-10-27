import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@workspace/db", async () => ({
  ...(await import("@workspace/db/schema")),
  db: {},
}));
import {
  fetchMetaMarketingData,
  MediaReadError,
} from "../src/services/meta-ads";

function metaFetch(
  options: {
    fail?: boolean;
    missingData?: boolean;
    empty?: boolean;
    timezone?: string;
    hourly?: boolean;
  } = {},
) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    let data: unknown;
    if (url.searchParams.get("fields") === "timezone_name")
      data = { timezone_name: options.timezone ?? "America/Sao_Paulo" };
    else if (url.pathname.endsWith("/insights")) {
      if (options.fail)
        return new Response(
          JSON.stringify({ error: { message: "upstream private failure" } }),
          { status: 500 },
        );
      if (options.missingData) data = {};
      else
        data = {
          data: options.empty
            ? []
            : [
                {
                  ad_id: "ad",
                  ad_name: "Ad",
                  campaign_id: "campaign",
                  campaign_name: "Campaign",
                  date_start: "2026-10-20",
                  date_stop: "2026-10-20",
                  spend: "123.45",
                  impressions: "100",
                  clicks: "10",
                  ...(options.hourly
                    ? {
                        hourly_stats_aggregated_by_advertiser_time_zone:
                          "01:00:00 - 01:59:59",
                      }
                    : {}),
                },
              ],
        };
    } else data = { data: [] };
    return new Response(JSON.stringify(data), { status: 200 });
  });
}
afterEach(() => vi.unstubAllGlobals());
describe("authoritative Meta reads", () => {
  it("deduplicates current reads across screens and derives card/campaign/day from one dataset", async () => {
    const fetchMock = metaFetch();
    vi.stubGlobal("fetch", fetchMock);
    const params = {
      accessToken: "test-token",
      adAccountId: "dedupe",
      since: "2026-10-20",
      until: "2026-10-20",
    };
    const [a, b] = await Promise.all([
      fetchMetaMarketingData(params),
      fetchMetaMarketingData(params),
    ]);
    expect(a).toBe(b);
    expect(a.summary.spend).toBe(123.45);
    expect(a.campaigns[0].spend).toBe(a.summary.spend);
    expect(a.daily[0].spend).toBe(a.summary.spend);
    const insightsCalls = fetchMock.mock.calls.filter(([url]) =>
      new URL(String(url)).pathname.endsWith("/insights"),
    );
    expect(insightsCalls).toHaveLength(1);
    expect(
      JSON.parse(
        new URL(String(insightsCalls[0][0])).searchParams.get("time_range")!,
      ),
    ).toEqual({ since: "2026-10-20", until: "2026-10-20" });
  });
  it("failed reads are explicit and are not cached; a retry can return a real zero", async () => {
    vi.stubGlobal("fetch", metaFetch({ fail: true }));
    const params = {
      accessToken: "test-token",
      adAccountId: "retry",
      since: "2026-10-20",
      until: "2026-10-20",
    };
    await expect(fetchMetaMarketingData(params)).rejects.toBeInstanceOf(
      MediaReadError,
    );
    vi.stubGlobal("fetch", metaFetch({ empty: true }));
    const result = await fetchMetaMarketingData(params);
    expect(result.summary.spend).toBe(0);
    expect(result.campaigns).toEqual([]);
  });
  it("missing integrations and incomplete successful HTTP responses never mean zero", async () => {
    await expect(
      fetchMetaMarketingData({
        accessToken: "",
        adAccountId: "missing",
        since: "2026-10-20",
        until: "2026-10-20",
      }),
    ).rejects.toMatchObject({ code: "MEDIA_UNAVAILABLE" });
    vi.stubGlobal("fetch", metaFetch({ missingData: true }));
    await expect(
      fetchMetaMarketingData({
        accessToken: "test-token",
        adAccountId: "malformed",
        since: "2026-10-20",
        until: "2026-10-20",
      }),
    ).rejects.toMatchObject({ code: "MEDIA_UNAVAILABLE" });
  });
  it("requests hourly data over the two account dates needed for Kalli and regroups into Brasília", async () => {
    const fetchMock = metaFetch({ timezone: "America/Noronha", hourly: true });
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchMetaMarketingData({
      accessToken: "test-token",
      adAccountId: "kalli",
      since: "2026-10-20",
      until: "2026-10-20",
    });
    const [url] = fetchMock.mock.calls.find(([u]) =>
      new URL(String(u)).pathname.endsWith("/insights"),
    )!;
    const query = new URL(String(url)).searchParams;
    expect(query.get("breakdowns")).toBe(
      "hourly_stats_aggregated_by_advertiser_time_zone",
    );
    expect(JSON.parse(query.get("time_range")!)).toEqual({
      since: "2026-10-20",
      until: "2026-10-21",
    });
    expect(result.summary.spend).toBe(123.45);
    expect(result.daily[0].date).toBe("2026-10-20");
  });
});
