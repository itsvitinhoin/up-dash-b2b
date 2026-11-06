import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const base = "https://graph.facebook.com/v24.0/act_123/insights";
const url = `${base}?access_token=test-secret&level=account`;
const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init);

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Meta Graph request budget", () => {
  it("canonicalizes cache keys, protects cached values from mutation and expires reads", async () => {
    const fetchMock = vi.fn(async () => json({ data: [{ spend: "20" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchMetaGraph } = await import("../src/services/meta-graph");
    const first = await fetchMetaGraph<{ data: { spend: string }[] }>(url, 300_000);
    first.data[0].spend = "999";
    const cached = await fetchMetaGraph(`${base}?level=account&access_token=test-secret`, 300_000);
    expect(cached).toEqual({ data: [{ spend: "20" }] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(300_000);
    await fetchMetaGraph(url, 300_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("isolates cache by account, credentials, Graph version and fields", async () => {
    const fetchMock = vi.fn(async () => json({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchMetaGraph } = await import("../src/services/meta-graph");
    for (const requestUrl of [url, url.replace("act_123", "act_456"), url.replace("test-secret", "other-secret"), url.replace("v24.0", "v25.0"), `${url}&fields=spend`]) {
      await fetchMetaGraph(requestUrl, 300_000);
    }
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("does not cache authorization failures or expose credentials in errors", async () => {
    const fetchMock = vi.fn(async () => json({ error: { code: 190, message: url } }, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchMetaGraph } = await import("../src/services/meta-graph");
    await expect(fetchMetaGraph(url, 300_000)).rejects.toThrow("code 190");
    await expect(fetchMetaGraph(url, 300_000)).rejects.not.toThrow("test-secret");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("limits traffic to four concurrent requests and releases the queue", async () => {
    let running = 0;
    let maxRunning = 0;
    const finish: (() => void)[] = [];
    const fetchMock = vi.fn(() => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      return new Promise<Response>((resolve) => finish.push(() => {
        running--;
        resolve(json({ data: [] }));
      }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const { fetchMetaGraph } = await import("../src/services/meta-graph");
    const work = Array.from({ length: 12 }, (_, i) => fetchMetaGraph(`${url}&id=${i}`));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    while (finish.length) {
      finish.shift()!();
      await vi.advanceTimersByTimeAsync(0);
    }
    await Promise.all(work);
    expect(maxRunning).toBe(4);
    expect(fetchMock).toHaveBeenCalledTimes(12);
  });

  it("coalesces identical pending reads even when persistent caching is disabled", async () => {
    const fetchMock = vi.fn(async () => json({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchMetaGraph } = await import("../src/services/meta-graph");
    await Promise.all(Array.from({ length: 10 }, () => fetchMetaGraph(url)));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await fetchMetaGraph(url);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("releases concurrency slots after network failures without caching failures", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error(`Network error: ${url}`))
      .mockImplementation(async () => json({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchMetaGraph } = await import("../src/services/meta-graph");
    await expect(fetchMetaGraph(url, 300_000)).rejects.toThrow("Meta Graph API request failed or timed out.");
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => fetchMetaGraph(`${url}&id=${i}`)));
    expect(results).toHaveLength(8);
    await fetchMetaGraph(url, 300_000);
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it("removes timed-out queued requests so they never reach Meta later", async () => {
    const finish: (() => void)[] = [];
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => finish.push(() => resolve(json({ data: [] })))));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchMetaGraph } = await import("../src/services/meta-graph");
    const active = Array.from({ length: 4 }, (_, i) => fetchMetaGraph(`${url}&id=${i}`));
    const queuedResult = fetchMetaGraph(`${url}&queued=1`).catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await queuedResult).toMatchObject({ message: "Meta API request queue timed out." });
    finish.forEach((resolve) => resolve());
    await Promise.all(active);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const afterTimeout = fetchMetaGraph(`${url}&afterTimeout=1`);
    await vi.advanceTimersByTimeAsync(0);
    finish.at(-1)!();
    await afterTimeout;
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it.each(["120", "Tue, 27 Oct 2026 12:02:00 GMT"])("honors Retry-After %s without retrying automatically", async (retryAfter) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ error: { code: 4 } }, { status: 429, headers: { "retry-after": retryAfter } }))
      .mockImplementation(async () => json({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchMetaGraph } = await import("../src/services/meta-graph");
    await expect(fetchMetaGraph(url)).rejects.toMatchObject({ code: 4, retryAfterMs: 120_000 });
    await expect(fetchMetaGraph(`${url}&another=1`)).rejects.toMatchObject({ status: 429 });
    vi.advanceTimersByTime(119_999);
    await expect(fetchMetaGraph(url)).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await fetchMetaGraph(url);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("detects Graph throttle codes delivered with HTTP 200 and stops already queued requests", async () => {
    const fetchMock = vi.fn(async () => json({ error: { code: 4 } }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchMetaGraph } = await import("../src/services/meta-graph");
    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => fetchMetaGraph(`${url}&id=${i}`)));
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("continues serving fresh cached reads when the API is blocked", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ data: [{ spend: "20" }] }))
      .mockResolvedValueOnce(json({ error: { code: 4 } }, { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchMetaGraph } = await import("../src/services/meta-graph");
    await fetchMetaGraph(url, 300_000);
    await expect(fetchMetaGraph(`${url}&uncached=1`)).rejects.toMatchObject({ status: 429 });
    await expect(fetchMetaGraph(url, 300_000)).resolves.toEqual({ data: [{ spend: "20" }] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("pauses after reported app usage reaches 100% without discarding the successful response", async () => {
    const fetchMock = vi.fn(async () => json({ data: [] }, { headers: { "x-app-usage": JSON.stringify({ call_count: 100 }) } }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchMetaGraph } = await import("../src/services/meta-graph");
    await expect(fetchMetaGraph(url)).resolves.toEqual({ data: [] });
    await expect(fetchMetaGraph(`${url}&another=1`)).rejects.toMatchObject({ retryAfterMs: 60_000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
