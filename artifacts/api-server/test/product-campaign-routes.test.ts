import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../src/lib/auth", () => ({
  verifyAccessToken: (token: string) => {
    if (token === "admin")
      return { role: "ADMIN", sub: "admin", clientId: null };
    if (token === "client")
      return { role: "CLIENT", sub: "user", clientId: "own-client" };
    throw new Error("Invalid token");
  },
}));
vi.mock("../src/services/product-campaign-monitor", () => ({
  campaignClient: vi.fn(),
  getProductCampaignCheck: vi.fn(),
  reviewProductCampaignRecommendation: vi.fn(),
  runProductCampaignCheck: vi.fn(),
}));
import {
  campaignClient,
  getProductCampaignCheck,
  reviewProductCampaignRecommendation,
  runProductCampaignCheck,
} from "../src/services/product-campaign-monitor";
import { productCampaignsRouter } from "../src/routes/product-campaigns";
const app = express().use(express.json()).use(productCampaignsRouter);
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PRODUCT_CAMPAIGN_REVIEW_CLIENT_ID", "own-client");
  vi.mocked(campaignClient).mockResolvedValue({ id: "own-client" } as never);
  vi.mocked(getProductCampaignCheck).mockResolvedValue({
    configured: true,
    snapshot: null,
  } as never);
  vi.mocked(runProductCampaignCheck).mockResolvedValue({
    status: "done",
    products: 1,
    ads: 1,
  });
});
afterEach(() => vi.unstubAllEnvs());
describe("product campaign routes", () => {
  it("requires authentication for reading and triggering checks", async () => {
    expect((await request(app).get("/product-campaigns")).status).toBe(401);
    expect((await request(app).post("/product-campaigns/check")).status).toBe(
      401,
    );
    expect(campaignClient).not.toHaveBeenCalled();
  });
  it("forces client users to their own client even with another clientId in the URL", async () => {
    await request(app)
      .get("/product-campaigns?clientId=other")
      .set("Authorization", "Bearer client")
      .expect(200);
    await request(app)
      .post("/product-campaigns/check?clientId=other")
      .set("Authorization", "Bearer client")
      .expect(200);
    expect(vi.mocked(campaignClient).mock.calls).toEqual([
      ["own-client"],
      ["own-client"],
    ]);
  });
  it("keeps the monitor unavailable outside the pilot client", async () => {
    const auth = "Bearer admin";
    await request(app).get("/product-campaigns?clientId=other")
      .set("Authorization", auth).expect(200, { configured: false });
    await request(app).post("/product-campaigns/check?clientId=other")
      .set("Authorization", auth).expect(404);
    expect(campaignClient).not.toHaveBeenCalled();
  });
  it("requires an explicit client for administrators", async () => {
    await request(app)
      .get("/product-campaigns")
      .set("Authorization", "Bearer admin")
      .expect(400);
  });
  it("returns explicit failure and busy status", async () => {
    vi.mocked(runProductCampaignCheck).mockResolvedValueOnce({
      status: "failed",
    });
    await request(app)
      .post("/product-campaigns/check")
      .set("Authorization", "Bearer client")
      .expect(502);
    vi.mocked(runProductCampaignCheck).mockResolvedValueOnce({
      status: "busy",
    });
    await request(app)
      .post("/product-campaigns/check")
      .set("Authorization", "Bearer client")
      .expect(202);
  });

  it("records the decision under the authenticated client and reviewer", async () => {
    vi.mocked(reviewProductCampaignRecommendation).mockResolvedValueOnce({
      status: "expired",
    });
    const recommendationId = "a".repeat(64);
    await request(app)
      .post("/product-campaigns/review?clientId=other")
      .set("Authorization", "Bearer client")
      .send({
        recommendationId,
        decision: "investigate",
        reviewerUserId: "other",
      })
      .expect(409);
    expect(campaignClient).toHaveBeenCalledWith("own-client");
    expect(reviewProductCampaignRecommendation).toHaveBeenCalledWith(
      { id: "own-client" },
      recommendationId,
      "investigate",
      "user",
    );
  });

  it("rejects unauthenticated and invalid review requests before persisting", async () => {
    const route = "/product-campaigns/review";
    await request(app).post(route).send({}).expect(401);
    await request(app)
      .post(route)
      .set("Authorization", "Bearer client")
      .send({ recommendationId: "a".repeat(64), decision: "pause" })
      .expect(400);
    expect(reviewProductCampaignRecommendation).not.toHaveBeenCalled();
  });
});
