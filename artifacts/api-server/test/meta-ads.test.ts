import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, creativesTable: {} }));

const params = {
  accessToken: "test-token",
  adAccountId: "123",
  since: "2026-10-01",
  until: "2026-10-27",
};

const insight = {
  ad_id: "ad-1",
  ad_name: "Video ad",
  campaign_id: "campaign-1",
  spend: "20",
  impressions: "100",
  clicks: "10",
  actions: [{ action_type: "lead", value: "2" }],
  date_start: params.since,
  date_stop: params.until,
};

function mockGraph(options: { failVideo?: boolean; failCreative?: boolean; spend?: string } = {}) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    let body: unknown;
    if (url.pathname.endsWith("/insights")) {
      body = { data: [{ ...insight, spend: options.spend ?? insight.spend }] };
    } else if (url.pathname.endsWith("/campaigns")) {
      body = { data: [{ id: "campaign-1", effective_status: "ACTIVE" }] };
    } else if (url.pathname.endsWith("/ad-1")) {
      body = options.failCreative
        ? { error: { message: "Application request limit reached" } }
        : { id: "ad-1", creative: { video_id: "video-1", thumbnail_url: "https://cdn.test/thumb.jpg" } };
    } else if (url.pathname.endsWith("/video-1")) {
      body = options.failVideo
        ? { error: { message: "Application request limit reached" } }
        : { id: "video-1", source: "https://cdn.test/video.mp4" };
    } else {
      throw new Error(`Unexpected Graph path: ${url.pathname}`);
    }
    // Graph errors may be delivered in a JSON body even with HTTP 200.
    return new Response(JSON.stringify(body));
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    count: (id: string) => fetchMock.mock.calls.filter(([input]) => new URL(String(input)).pathname.endsWith(`/${id}`)).length,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Meta creative media requests", () => {
  it("keeps metrics and previous-period requests free of media calls", async () => {
    const graph = mockGraph();
    const { fetchMetaMarketingData } = await import("../src/services/meta-ads");
    const current = await fetchMetaMarketingData(params);
    const previous = await fetchMetaMarketingData({ ...params, since: "2026-09-01", until: "2026-09-27", includeMedia: false });

    expect(current.summary.spend).toBe(20);
    expect(previous.ads[0].id).toBe("ad-1");
    expect(current.topCreatives).toEqual({ ctr: [], cpl: [], leads: [] });
    expect(graph.count("ad-1")).toBe(0);
    expect(graph.count("video-1")).toBe(0);
  });

  it("reuses media across date ranges while fetching fresh metrics", async () => {
    const graph = mockGraph();
    const { fetchMetaMarketingData } = await import("../src/services/meta-ads");
    const current = await fetchMetaMarketingData({ ...params, includeMedia: true });
    const otherRange = await fetchMetaMarketingData({ ...params, since: "2026-10-02", includeMedia: true });

    expect(current.topCreatives.ctr[0].videoUrl).toBe("https://cdn.test/video.mp4");
    expect(otherRange.topCreatives.leads[0].videoUrl).toBe("https://cdn.test/video.mp4");
    expect(graph.count("ad-1")).toBe(1);
    expect(graph.count("video-1")).toBe(1);
    expect(graph.count("insights")).toBe(6);
    expect(graph.count("campaigns")).toBe(1);
  });

  it("loads only current-period media during a period comparison", async () => {
    const graph = mockGraph();
    const { fetchMetaMarketingData } = await import("../src/services/meta-ads");
    const [current, previous] = await Promise.all([
      fetchMetaMarketingData({ ...params, includeMedia: true }),
      fetchMetaMarketingData({ ...params, since: "2026-09-01", until: "2026-09-27" }),
    ]);

    expect(current.topCreatives.ctr[0].videoUrl).toBe("https://cdn.test/video.mp4");
    expect(previous.topCreatives).toEqual({ ctr: [], cpl: [], leads: [] });
    expect(previous.summary).toEqual(current.summary);
    expect(graph.count("ad-1")).toBe(1);
    expect(graph.count("video-1")).toBe(1);
  });

  it("shares cached metrics between metrics-only consumers and the marketing screen", async () => {
    const options = { spend: "20" };
    const graph = mockGraph(options);
    const { fetchMetaMarketingData } = await import("../src/services/meta-ads");
    await fetchMetaMarketingData(params);
    options.spend = "40";
    const cached = await fetchMetaMarketingData({ ...params, includeMedia: true });
    expect(cached.summary.spend).toBe(20);
    expect(cached.topCreatives.ctr[0].videoUrl).toBe("https://cdn.test/video.mp4");
    expect(graph.count("insights")).toBe(3);
    vi.advanceTimersByTime(5 * 60 * 1000);
    const refreshed = await fetchMetaMarketingData(params);
    expect(refreshed.summary.spend).toBe(40);
    expect(graph.count("insights")).toBe(6);
    expect(graph.count("campaigns")).toBe(1);
    vi.advanceTimersByTime(10 * 60 * 1000);
    await fetchMetaMarketingData(params);
    expect(graph.count("campaigns")).toBe(2);
  });

  it("keeps every insights page when caching a paginated result", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const isAccountInsights = url.pathname.endsWith("/insights") && url.searchParams.get("level") === "account";
      const next = new URL(url);
      next.searchParams.set("after", "next-page");
      const body = isAccountInsights
        ? url.searchParams.has("after")
          ? { data: [{ ...insight, spend: "30", date_start: "2026-10-02" }] }
          : { data: [insight], paging: { next: next.toString() } }
        : { data: [] };
      return new Response(JSON.stringify(body));
    });
    vi.stubGlobal("fetch", fetchMock);
    const { fetchMetaMarketingData } = await import("../src/services/meta-ads");
    const first = await fetchMetaMarketingData(params);
    const cached = await fetchMetaMarketingData(params);
    expect(first.summary.spend).toBe(50);
    expect(cached.daily).toHaveLength(2);
    expect(cached.summary.spend).toBe(50);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("coalesces concurrent media requests", async () => {
    const graph = mockGraph();
    const { fetchMetaMarketingData } = await import("../src/services/meta-ads");
    const results = await Promise.all(Array.from({ length: 5 }, () => fetchMetaMarketingData({ ...params, includeMedia: true })));

    expect(results.every((result) => result.topCreatives.ctr[0].videoUrl === "https://cdn.test/video.mp4")).toBe(true);
    expect(graph.count("ad-1")).toBe(1);
    expect(graph.count("video-1")).toBe(1);
    expect(graph.count("insights")).toBe(3);
    expect(graph.count("campaigns")).toBe(1);
  });

  it("refreshes creative details and media URLs after one hour", async () => {
    const graph = mockGraph();
    const { fetchMetaMarketingData } = await import("../src/services/meta-ads");
    const request = () => fetchMetaMarketingData({ ...params, includeMedia: true });
    await request();
    vi.advanceTimersByTime(60 * 60 * 1000 - 1);
    await request();
    expect(graph.count("video-1")).toBe(1);
    vi.advanceTimersByTime(1);
    await request();
    expect(graph.count("ad-1")).toBe(2);
    expect(graph.count("video-1")).toBe(2);
  });

  it.each(["failVideo", "failCreative"] as const)("briefly caches %s errors and recovers after one minute", async (failure) => {
    const options = { [failure]: true };
    const graph = mockGraph(options);
    const { fetchMetaMarketingData } = await import("../src/services/meta-ads");
    const request = () => fetchMetaMarketingData({ ...params, includeMedia: true });
    const failed = await request();
    await request();
    const failedId = failure === "failVideo" ? "video-1" : "ad-1";
    expect(failed.summary.spend).toBe(20);
    expect(failed.topCreatives.ctr[0].videoUrl).toBeNull();
    expect(graph.count(failedId)).toBe(1);
    options[failure] = false;
    vi.advanceTimersByTime(60 * 1000);
    const recovered = await request();
    expect(recovered.topCreatives.ctr[0].videoUrl).toBe("https://cdn.test/video.mp4");
    expect(graph.count(failedId)).toBe(2);
  });

  it("isolates cached media by access token and Graph version", async () => {
    const graph = mockGraph();
    const { fetchMetaMarketingData } = await import("../src/services/meta-ads");
    await fetchMetaMarketingData({ ...params, includeMedia: true });
    await fetchMetaMarketingData({ ...params, accessToken: "different-token", includeMedia: true });
    vi.stubEnv("META_GRAPH_VERSION", "v25.0");
    await fetchMetaMarketingData({ ...params, includeMedia: true });
    expect(graph.count("ad-1")).toBe(3);
    expect(graph.count("video-1")).toBe(3);
  });
});
