import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", async () => ({
  ...(await import("@workspace/db/schema")),
  db: {},
}));

// Cota do app no Meta (achado 27/10/2026: ~7 mil chamadas de vídeo por dia). Mídia só quando a tela pede, com cache.

const insightsRow = (id: string, clicks: number, day: string) => ({
  ad_id: id,
  ad_name: `Anúncio ${id}`,
  campaign_id: "c1",
  campaign_name: "Campanha",
  date_start: day,
  date_stop: day,
  spend: "10",
  impressions: "1000",
  clicks: String(clicks),
});

function graphMock(opts: { videoFails?: boolean } = {}) {
  const calls = { insights: 0, adDetails: 0, video: 0 };
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.searchParams.get("fields") === "timezone_name") return json({ timezone_name: "America/Sao_Paulo" });
    if (url.pathname.endsWith("/insights")) {
      calls.insights += 1;
      const day = JSON.parse(url.searchParams.get("time_range") ?? "{}").since ?? "2026-10-20";
      return json({ data: [insightsRow("ad1", 50, day), insightsRow("ad2", 40, day)] });
    }
    if (url.pathname.endsWith("/campaigns")) return json({ data: [{ id: "c1", effective_status: "ACTIVE" }] });
    if (url.pathname.endsWith("/vid1")) {
      calls.video += 1;
      return opts.videoFails ? json({ error: { message: "boom", code: 1 } }, 500) : json({ id: "vid1", source: "https://v/1.mp4", picture: "https://p/1.jpg" });
    }
    // detalhes de um anúncio: ad1 e ad2 usam o mesmo vídeo
    calls.adDetails += 1;
    return json({ id: url.pathname.split("/").pop(), creative: { video_id: "vid1" } });
  });
  return { fn, calls };
}

let params: { accessToken: string; adAccountId: string; since: string; until: string; includeMedia?: boolean };

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
  params = { accessToken: "tok-" + Math.random(), adAccountId: "act_1", since: "2026-10-20", until: "2026-10-20" };
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("leitura do Meta sem estourar a cota", () => {
  it("sem includeMedia não busca detalhe de anúncio nem vídeo (métricas, comparativo e rotina horária)", async () => {
    const { fn, calls } = graphMock();
    vi.stubGlobal("fetch", fn);
    const { fetchMetaMarketingData } = await import("../src/services/meta-ads");
    const data = await fetchMetaMarketingData(params);
    expect(data.summary.spend).toBe(20);
    expect(data.ads).toHaveLength(2);
    expect(calls.insights).toBeGreaterThan(0);
    expect(calls.adDetails).toBe(0);
    expect(calls.video).toBe(0);
    expect(data.topCreatives).toEqual({ ctr: [], cpl: [], leads: [] });
  });

  it("com includeMedia busca a mídia, e a mesma mídia (mesmo vídeo) vale por 1 hora", async () => {
    const { fn, calls } = graphMock();
    vi.stubGlobal("fetch", fn);
    const { fetchMetaMarketingData } = await import("../src/services/meta-ads");
    await fetchMetaMarketingData({ ...params, includeMedia: true });
    expect(calls.adDetails).toBe(2);
    expect(calls.video).toBe(1); // dois anúncios, um vídeo: uma chamada só
    // outro período (a leitura de métricas não é reaproveitada), mesma mídia: nada de chamada nova de mídia
    await fetchMetaMarketingData({ ...params, since: "2026-10-19", until: "2026-10-19", includeMedia: true });
    expect(calls.adDetails).toBe(2);
    expect(calls.video).toBe(1);
    vi.advanceTimersByTime(60 * 60 * 1000 + 1);
    await fetchMetaMarketingData({ ...params, since: "2026-10-18", until: "2026-10-18", includeMedia: true });
    expect(calls.video).toBe(2); // passou 1 hora: renova
  });

  it("falha ao buscar o vídeo não derruba a tela e só é tentada de novo depois de 1 minuto", async () => {
    const { fn, calls } = graphMock({ videoFails: true });
    vi.stubGlobal("fetch", fn);
    const { fetchMetaMarketingData } = await import("../src/services/meta-ads");
    const first = await fetchMetaMarketingData({ ...params, includeMedia: true });
    expect(first.summary.spend).toBe(20);
    expect(calls.video).toBe(1);
    await fetchMetaMarketingData({ ...params, since: "2026-10-19", until: "2026-10-19", includeMedia: true });
    expect(calls.video).toBe(1); // ainda dentro do minuto
    vi.advanceTimersByTime(61_000);
    await fetchMetaMarketingData({ ...params, since: "2026-10-18", until: "2026-10-18", includeMedia: true });
    expect(calls.video).toBe(2);
  });
});
