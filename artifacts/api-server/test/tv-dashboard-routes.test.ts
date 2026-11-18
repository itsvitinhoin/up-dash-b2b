import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
vi.mock("../src/lib/auth", () => ({
  verifyAccessToken: (token: string) => {
    if (token === "admin") return { role: "ADMIN", sub: "admin" };
    if (token === "client") return { role: "CLIENT", sub: "client" };
    throw new Error("invalid");
  },
}));
vi.mock("../src/services/tv-dashboard", () => ({
  getTvSnapshot: vi.fn(),
  getTvSyncStatus: vi.fn(),
}));
import { getTvSnapshot, getTvSyncStatus } from "../src/services/tv-dashboard";
import { tvDashboardRouter } from "../src/routes/tv-dashboard";
const app = express().use(tvDashboardRouter);
beforeEach(() => vi.clearAllMocks());
describe("portfolio monitor routes", () => {
  it("protects both data and extraction status before any database work", async () => {
    for (const path of ["/analytics/admin/tv", "/analytics/admin/tv/status"]) {
      await request(app).get(path).expect(401);
      await request(app)
        .get(path)
        .set("Authorization", "Bearer client")
        .expect(403);
    }
    expect(getTvSnapshot).not.toHaveBeenCalled();
    expect(getTvSyncStatus).not.toHaveBeenCalled();
  });
  it("returns an explicit waiting state when no completed snapshot exists", async () => {
    vi.mocked(getTvSnapshot).mockResolvedValue(null);
    const response = await request(app)
      .get("/analytics/admin/tv")
      .set("Authorization", "Bearer admin")
      .expect(503);
    expect(response.headers["cache-control"]).toBe("private, no-store");
  });
});
