import { afterEach, describe, expect, it, vi } from "vitest";
import {
  creativeDestinations,
  fetchCampaignAds,
  fetchCampaignCatalog,
  fetchGraphRows,
  isActiveAd,
  recentWindow,
} from "../src/services/product-campaign-sources";

afterEach(() => vi.unstubAllGlobals());
const response = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
describe("campaign source collection", () => {
  it("extracts carousel, video CTA and flexible creative URLs, ignoring thumbnails", () => {
    const result = creativeDestinations({
      thumbnail_url: "https://cdn.com/image.jpg",
      object_story_spec: {
        link_data: {
          child_attachments: [
            { link: "https://loja.com/p1" },
            { link: "https://loja.com/p2" },
          ],
        },
        video_data: {
          call_to_action: { value: { link: "https://loja.com/p3" } },
        },
      },
      asset_feed_spec: { link_urls: [{ website_url: "https://loja.com/p4" }] },
    });
    expect(result.urls).toHaveLength(4);
    expect(result.urls).not.toContain("https://cdn.com/image.jpg");
  });
  it("checks effective status, parent status and schedule, never just ad status", () => {
    const active = {
      effective_status: "ACTIVE",
      campaign: { effective_status: "ACTIVE" },
      adset: { effective_status: "ACTIVE" },
    };
    const now = new Date("2026-09-15T12:00:00Z");
    expect(isActiveAd(active, now)).toBe(true);
    expect(
      isActiveAd({ ...active, campaign: { effective_status: "PAUSED" } }, now),
    ).toBe(false);
    expect(
      isActiveAd(
        {
          ...active,
          adset: {
            effective_status: "ACTIVE",
            end_time: "2026-09-14T00:00:00Z",
          },
        },
        now,
      ),
    ).toBe(false);
    expect(
      isActiveAd(
        {
          ...active,
          adset: {
            effective_status: "ACTIVE",
            start_time: "2026-09-16T00:00:00Z",
          },
        },
        now,
      ),
    ).toBe(false);
    expect(
      isActiveAd(
        { status: "ACTIVE", effective_status: "CAMPAIGN_PAUSED" },
        now,
      ),
    ).toBe(false);
    expect(isActiveAd({ effective_status: "ACTIVE" }, now)).toBe(false);
  });
  it("uses seven completed days in the account timezone", () => {
    expect(
      recentWindow(new Date("2026-09-15T01:00:00Z"), "America/Sao_Paulo"),
    ).toEqual({ since: "2026-09-07", until: "2026-09-13" });
  });
  it("paginates all ads and sends credentials only to the Meta origin", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          data: [{ id: 1 }],
          paging: {
            next: "https://graph.facebook.com/v24.0/act_1/ads?after=2&access_token=remote-token",
          },
        }),
      )
      .mockResolvedValueOnce(response({ data: [{ id: 2 }] }));
    vi.stubGlobal("fetch", fetch);
    expect(
      await fetchGraphRows(
        "act_1/ads",
        "secret",
        {},
        AbortSignal.timeout(1000),
      ),
    ).toHaveLength(2);
    expect(fetch.mock.calls[1][0]).not.toContain("access_token");
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe("Bearer secret");
  });
  it("rejects malicious pagination and malformed responses rather than silently returning zero", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        response({ data: [], paging: { next: "https://evil.com/" } }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      fetchGraphRows("act_1/ads", "secret", {}, AbortSignal.timeout(1000)),
    ).rejects.toThrow("Paginação");
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValue(response({ unexpected: [] }));
    await expect(
      fetchGraphRows("act_1/ads", "secret", {}, AbortSignal.timeout(1000)),
    ).rejects.toThrow("incompleta");
  });
  it("gets active ads independently of insights, including ads without spend", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/ads?"))
          return response({
            data: [
              {
                id: "42",
                name: "Novo",
                effective_status: "ACTIVE",
                campaign: { effective_status: "ACTIVE" },
                adset: { effective_status: "ACTIVE" },
                creative: {},
              },
            ],
          });
        if (url.includes("/insights?")) return response({ data: [] });
        return response({
          timezone_name: "America/Sao_Paulo",
          currency: "BRL",
        });
      }),
    );
    const result = await fetchCampaignAds(
      "act_1",
      "secret",
      AbortSignal.timeout(2000),
    );
    expect(result.ads).toHaveLength(1);
    expect(result.ads[0]).toMatchObject({ spend: 0, impressions: 0 });
  });
  it("does not persist an invalid or partial catalog as empty stock", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        response(
          url.includes("/store?")
            ? { domains: ["loja.com"] }
            : { error: "bad" },
        ),
      ),
    );
    await expect(
      fetchCampaignCatalog("1", "secret", AbortSignal.timeout(1000)),
    ).rejects.toThrow();
  });
});
