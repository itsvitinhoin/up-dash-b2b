import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@workspace/db", () => ({ db: {}, creativesTable: {} }));
import { fetchMetaMarketingData } from "../src/services/meta-ads";
import {
  manualMarketingKpis,
  usesMetaRevenue,
} from "../src/services/marketing-source";

function insight(purchases = 3, leads = 99) {
  return {
    spend: "100",
    impressions: "1000",
    clicks: "80",
    inline_link_clicks: "20",
    date_start: "2026-10-25",
    date_stop: "2026-10-25",
    actions: [
      { action_type: "purchase", value: String(purchases) },
      { action_type: "omni_purchase", value: String(purchases) },
      { action_type: "lead", value: String(leads) },
    ],
    action_values: [
      { action_type: "purchase", value: "350" },
      { action_type: "omni_purchase", value: "350" },
    ],
  };
}
function mockGraph(empty = false, ranking = false) {
  return vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = new URL(url);
      let body: unknown = { data: [] };
      if (u.searchParams.get("fields") === "timezone_name")
        body = { timezone_name: "America/Sao_Paulo" };
      else if (!empty && u.pathname.endsWith("/insights")) {
        if (u.searchParams.get("level") === "account")
          body = { data: [{ reach: "1200", frequency: "1.6666667" }] };
        else
          body = {
            data: ranking
              ? [
                  ...Array.from({ length: 6 }, (_, n) => ({
                    ...insight(0, 1000 - n),
                    ad_id: `lead-${n}`,
                    ad_name: `Lead ${n}`,
                    campaign_id: "campaign",
                  })),
                  {
                    ...insight(9, 0),
                    ad_id: "purchase-winner",
                    ad_name: "Purchase winner",
                    campaign_id: "campaign",
                  },
                ]
              : [
                  { ...insight(), ad_id: "ad", campaign_id: "campaign" },
                  {
                    ...insight(2),
                    ad_id: "ad",
                    campaign_id: "campaign",
                    date_start: "2026-10-26",
                    date_stop: "2026-10-26",
                  },
                ],
          };
      }
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
}
afterEach(() => vi.unstubAllGlobals());
const params = {
  accessToken: "test-token",
  adAccountId: "123",
  since: "2026-10-25",
  until: "2026-10-26",
  includeReach: true,
  includeMedia: true,
};

let caseId = 0;
beforeEach(() => {
  params.adAccountId = `fixture-${++caseId}`;
});

describe("Meta advertising metrics", () => {
  it("preserves attributed revenue and purchases without double-counting action aliases", async () => {
    mockGraph();
    const meta = await fetchMetaMarketingData({ ...params, isB2C: true });
    expect(meta.daily.map((p) => p.revenue)).toEqual([350, 350]);
    expect(meta.summary).toMatchObject({
      spend: 200,
      revenue: 700,
      purchases: 5,
      clicks: 40,
      ctr: 2,
      cpc: 5,
      cpm: 100,
      reach: 1200,
    });
    expect(meta.summary.frequency).toBeCloseTo(2000 / 1200);
    expect(meta.summary.roas).toBe(3.5);
    expect(meta.summary.cpa).toBe(40);
    expect(manualMarketingKpis(meta)).toMatchObject({
      totalSpend: 200,
      attributedRevenue: 700,
      purchases: 5,
      roas: 3.5,
      cpa: 40,
      approvedLeads: 0,
    });
  });
  it("ranks all B2C ads by purchases even when they have no leads", async () => {
    mockGraph(false, true);
    const meta = await fetchMetaMarketingData({ ...params, isB2C: true });
    expect(meta.topCreatives.leads.map((c) => c.id)).toEqual([
      "purchase-winner",
    ]);
    expect(meta.topCreatives.cpl.map((c) => c.id)).toEqual(["purchase-winner"]);
    expect(meta.topCreatives.leads[0]).toMatchObject({
      leads: 0,
      purchases: 9,
    });
  });
  it("keeps B2B rankings based on leads", async () => {
    mockGraph(false, true);
    const meta = await fetchMetaMarketingData(params);
    expect(meta.topCreatives.leads[0].id).toBe("lead-0");
    expect(meta.topCreatives.leads).toHaveLength(5);
  });
  it("handles a successful period with no delivery or conversions", async () => {
    mockGraph(true);
    const meta = await fetchMetaMarketingData({ ...params, isB2C: true });
    expect(meta.summary).toMatchObject({
      spend: 0,
      purchases: 0,
      revenue: 0,
      reach: null,
      frequency: null,
      ctr: null,
      cpc: null,
      cpm: null,
      cpa: null,
    });
    expect(manualMarketingKpis(meta)).toMatchObject({ roas: 0, cpa: 0 });
  });
  it("propagates Meta API failures instead of manufacturing zero metrics", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { code: 190, message: "Token expired" } }),
            { status: 400 },
          ),
      ),
    );
    await expect(fetchMetaMarketingData(params)).rejects.toMatchObject({
      code: "MEDIA_UNAVAILABLE",
    });
  });
  it("selects Meta revenue only for MANUAL, never for an empty integrated store", () => {
    expect(usesMetaRevenue("MANUAL")).toBe(true);
    for (const platform of ["UPZERO", "NUVEMSHOP", "VESTI", null, undefined])
      expect(usesMetaRevenue(platform)).toBe(false);
  });
});
