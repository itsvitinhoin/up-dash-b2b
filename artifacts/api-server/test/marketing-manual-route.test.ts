import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  rows: [] as unknown[][],
  fetchMeta: vi.fn(),
  fetchStored: vi.fn(),
  upsert: vi.fn(),
}));
vi.mock("@workspace/db", async () => {
  const schema = await import("../../../lib/db/src/schema");
  return {
    ...schema,
    db: {
      select: () => {
        const rows = state.rows.shift() ?? [];
        const query: Record<string, unknown> = {
          then: (resolve: (value: unknown[]) => void) =>
            Promise.resolve(rows).then(resolve),
        };
        for (const key of [
          "from",
          "where",
          "innerJoin",
          "leftJoin",
          "groupBy",
          "orderBy",
          "limit",
          "offset",
        ])
          query[key] = () => query;
        return query;
      },
    },
  };
});
vi.mock("../src/middlewares/auth", () => ({
  authenticate: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
  resolveClientId: (req: { query: { clientId: string } }) => req.query.clientId,
}));
vi.mock("../src/services/meta-ads", async () => ({
  ...(await vi.importActual<typeof import("../src/services/meta-ads")>(
    "../src/services/meta-ads",
  )),
  fetchMetaMarketingData: state.fetchMeta,
  upsertMetaCreatives: state.upsert,
}));
vi.mock("../src/services/stored-marketing", () => ({
  fetchStoredMarketingData: state.fetchStored,
}));
import { MediaReadError } from "../src/services/meta-ads";
import router from "../src/routes/analytics";
import { GetMarketingResponse } from "@workspace/api-zod";
const summary = {
  spend: 986.94,
  impressions: 48549,
  clicks: 959,
  leads: 88,
  purchases: 15,
  revenue: 3410.43,
  reach: 30000,
  frequency: 1.6183,
  ctr: 1.975,
  cpc: 1.029,
  cpm: 20.33,
  roas: 3.4555,
  cpa: 65.796,
  cpl: 11.215,
};
const meta = {
  summary,
  daily: [{ date: "2026-10-25", ...summary }],
  ads: [],
  campaigns: [],
  topCreatives: { ctr: [], cpl: [], leads: [] },
};
const previousMeta = {
  ...meta,
  summary: { ...summary, spend: 100, revenue: 200, purchases: 2 },
};
const config = {
  commercePlatform: "MANUAL",
  dashboardType: "B2C",
  metaAdsApiKey: "test-token",
  metaAdAccountId: "123",
};
const app = express();
app.use("/api", router);
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    res
      .status(err instanceof MediaReadError ? 503 : 500)
      .json({
        error: true,
        code: err instanceof MediaReadError ? err.code : "INTERNAL_ERROR",
      });
  },
);
let sequence = 0;
const url = () =>
  `/api/analytics/marketing?clientId=test-${++sequence}&dateFrom=2026-10-25&dateTo=2026-10-25`;
beforeEach(() => {
  state.rows = [];
  state.fetchMeta.mockReset();
  state.fetchStored.mockReset();
  state.upsert.mockReset().mockResolvedValue(undefined);
});

describe("Manual marketing source and response contract", () => {
  it("uses Meta purchases, revenue, daily series and both comparison periods", async () => {
    state.rows = [[{ commercePlatform: "MANUAL" }], [config], [], []];
    state.fetchMeta
      .mockResolvedValueOnce(meta)
      .mockResolvedValueOnce(previousMeta);
    const response = await request(app).get(url());
    expect(response.status).toBe(200);
    const body = GetMarketingResponse.parse(response.body);
    expect(body.revenueSource).toBe("META");
    expect(body.kpis.purchases).toBe(15);
    expect(body.kpis.attributedRevenue).toBe(3410.43);
    expect(body.kpis.roas).toBeCloseTo(3410.43 / 986.94);
    expect(body.kpis.cpa).toBeCloseTo(986.94 / 15);
    expect(body.prevKpis).toMatchObject({
      purchases: 2,
      attributedRevenue: 200,
      roas: 2,
    });
    expect(body.metaSummary?.reach).toBe(30000);
    expect(body.prevMetaSummary?.purchases).toBe(2);
    expect(body.revenueOverTime).toEqual([
      { date: "2026-10-25", value: 3410.43 },
    ]);
    expect(body.purchasesOverTime).toEqual([{ date: "2026-10-25", value: 15 }]);
  });
  it("keeps current results available if the previous Meta period fails", async () => {
    state.rows = [[{ commercePlatform: "MANUAL" }], [config]];
    state.fetchMeta
      .mockResolvedValueOnce(meta)
      .mockRejectedValueOnce(new MediaReadError());
    const response = await request(app).get(url());
    expect(response.status).toBe(200);
    expect(response.body.kpis).toMatchObject({
      purchases: 15,
      attributedRevenue: 3410.43,
    });
    expect(response.body.prevKpis).toBeNull();
    expect(response.body.prevMetaSummary).toBeNull();
    expect(GetMarketingResponse.safeParse(response.body).success).toBe(true);
  });
  it.each([
    { revenue: 800, orders: 4 },
    { revenue: 0, orders: 0 },
  ])(
    "keeps integrated B2C ecommerce metrics, including zero orders: %j",
    async ({ revenue, orders }) => {
      state.rows = [
        [{ commercePlatform: "NUVEMSHOP" }],
        [{ ...config, commercePlatform: "NUVEMSHOP" }],
        [{ revenue, orders }],
        [{ revenue: 300, orders: 1 }],
        [{ totalLeads: 0, approvedLeads: 0 }],
        [{ totalLeads: 0, approvedLeads: 0 }],
        [],
        [],
      ];
      state.fetchStored.mockResolvedValue(meta);
      const response = await request(app).get(url());
      expect(response.status).toBe(200);
      expect(state.fetchMeta).not.toHaveBeenCalled();
      expect(response.body.revenueSource).toBe("ECOMMERCE");
      expect(response.body.kpis).toMatchObject({
        attributedRevenue: revenue,
        purchases: orders,
      });
      expect(response.body.kpis.cpa).toBeCloseTo(
        orders > 0 ? 986.94 / orders : 0,
      );
    },
  );
  it("returns a source error when Meta fails for MANUAL", async () => {
    state.rows = [[{ commercePlatform: "MANUAL" }], [config]];
    state.fetchMeta.mockRejectedValue(new MediaReadError());
    const response = await request(app).get(url());
    expect(response.status).toBe(503);
    expect(response.body.code).toBe("MEDIA_UNAVAILABLE");
    expect(response.body.kpis).toBeUndefined();
  });
  it("does not silently fall back to ecommerce when MANUAL lacks a Meta account", async () => {
    state.rows = [
      [{ commercePlatform: "MANUAL" }],
      [{ ...config, metaAdAccountId: null }],
    ];
    const response = await request(app).get(url());
    expect(response.status).toBe(503);
    expect(state.fetchMeta).not.toHaveBeenCalled();
  });
});
