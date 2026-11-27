import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  claimed: true,
  writes: [] as Record<string, unknown>[],
}));
vi.mock("@workspace/db", async () => {
  const schema = await import("@workspace/db/schema");
  return {
    ...schema,
    db: {
      select: () => ({
        from: () => ({ where: async () => (state.row ? [state.row] : []) }),
      }),
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: () => ({
            returning: async () => (state.claimed ? [{ clientId: "a" }] : []),
          }),
        }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: async () => {
            state.writes.push(values);
            state.row = { ...state.row, ...values };
          },
        }),
      }),
    },
  };
});
vi.mock("../src/services/product-campaign-sources", () => ({
  fetchCampaignAds: vi.fn(),
  fetchCampaignCatalog: vi.fn(),
}));
import {
  fetchCampaignAds,
  fetchCampaignCatalog,
} from "../src/services/product-campaign-sources";
import {
  getProductCampaignCheck,
  runProductCampaignCheck,
} from "../src/services/product-campaign-monitor";
const client = {
  id: "a",
  dashboardType: "B2C",
  commercePlatform: "NUVEMSHOP",
  isActive: true,
  accountId: "1",
  metaToken: "test",
  storeId: "2",
  storeToken: "test",
};
const snapshot = () => ({
  version: 1,
  accountId: "1",
  storeId: "2",
  adsObservedAt: new Date().toISOString(),
  stockObservedAt: new Date().toISOString(),
  rows: [],
});
beforeEach(() => {
  vi.clearAllMocks();
  state.row = null;
  state.claimed = true;
  state.writes = [];
  vi.mocked(fetchCampaignAds).mockResolvedValue({
    ads: [],
    warnings: [],
    window: { since: "2026-09-01", until: "2026-09-07" },
    currency: "BRL",
    timeZone: "America/Sao_Paulo",
    observedAt: new Date().toISOString(),
  });
  vi.mocked(fetchCampaignCatalog).mockResolvedValue({
    products: [],
    domains: ["loja.com"],
    observedAt: new Date().toISOString(),
  });
});
describe("monitor snapshots", () => {
  it("publishes an empty result after a successful full scan, clearing prior active products", async () => {
    state.row = {
      payload: { ...snapshot(), rows: [{ id: "old" }] },
      error: "previous failure",
    };
    expect((await runProductCampaignCheck(client)).status).toBe("done");
    expect(state.writes[0]).toMatchObject({
      payload: { rows: [], totalAds: 0 },
      error: null,
      leaseUntil: null,
    });
  });
  it("keeps the last good snapshot and marks it stale when a source fails", async () => {
    const payload = snapshot();
    state.row = { payload, checkedAt: new Date() };
    vi.mocked(fetchCampaignCatalog).mockRejectedValue(
      new Error("secret must not escape"),
    );
    expect((await runProductCampaignCheck(client)).status).toBe("failed");
    expect(state.row?.payload).toEqual(payload);
    expect(state.writes[0]).not.toHaveProperty("payload");
    expect(JSON.stringify(state.writes)).not.toContain("secret");
    expect((await getProductCampaignCheck(client)).stale).toBe(true);
  });
  it("does not start another scan when the lease cannot be acquired", async () => {
    state.claimed = false;
    expect((await runProductCampaignCheck(client)).status).toBe("busy");
    expect(fetchCampaignAds).not.toHaveBeenCalled();
    expect(fetchCampaignCatalog).not.toHaveBeenCalled();
  });
  it("expires stock independently of the time the snapshot was written", async () => {
    state.row = {
      payload: { ...snapshot(), stockObservedAt: "2000-01-01T00:00:00Z" },
      checkedAt: new Date(),
    };
    expect((await getProductCampaignCheck(client)).stale).toBe(true);
  });
  it("hides snapshots from a previously connected store/account", async () => {
    state.row = {
      payload: { ...snapshot(), accountId: "different" },
      checkedAt: new Date(),
    };
    expect((await getProductCampaignCheck(client)).snapshot).toBeNull();
  });
});
