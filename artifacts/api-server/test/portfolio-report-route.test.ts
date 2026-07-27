import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createPortfolioReportRouter } from "../src/routes/portfolio-report";

const SAFE_REPORT = {
  meta: {
    title: "Relatório",
    timezone: "America/Sao_Paulo",
    period_start: "2026-07-10",
    period_end: "2026-07-12",
    period_label: "10/07/2026 a 12/07/2026",
    period: "10/07/2026 a 12/07/2026",
    generated_at: "2026-07-13T12:00:00.000Z",
    source: "UP Dash",
    read_only: true as const,
  },
  excluded_clients: [],
  summary_metrics: [],
  executive_summary: [],
  priorities: [],
  quality_note: "Sem PII",
  clients: [],
  lists: { products: [], orders: [], registrations: [] },
};

function testApp(token: string | undefined) {
  const app = express();
  app.use(
    "/api",
    createPortfolioReportRouter({
      getToken: () => token,
      buildReport: async () => SAFE_REPORT,
    }),
  );
  return app;
}

describe("GET /api/analytics/portfolio-report", () => {
  it("rejects missing and invalid report tokens", async () => {
    const app = testApp("correct-secret");
    expect((await request(app).get("/api/analytics/portfolio-report?dateFrom=2026-07-10&dateTo=2026-07-12")).status).toBe(401);
    expect(
      (
        await request(app)
          .get("/api/analytics/portfolio-report?dateFrom=2026-07-10&dateTo=2026-07-12")
          .set("x-updash-reports-token", "wrong-secret")
      ).status,
    ).toBe(401);
  });

  it("fails closed when the server token is not configured", async () => {
    const response = await request(testApp(undefined))
      .get("/api/analytics/portfolio-report?dateFrom=2026-07-10&dateTo=2026-07-12")
      .set("x-updash-reports-token", "anything");
    expect(response.status).toBe(503);
    expect(response.body.code).toBe("REPORT_TOKEN_NOT_CONFIGURED");
  });

  it("returns a no-store, PII-free report with a valid token", async () => {
    const response = await request(testApp("correct-secret"))
      .get("/api/analytics/portfolio-report?dateFrom=2026-07-10&dateTo=2026-07-12")
      .set("x-updash-reports-token", "correct-secret");
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(JSON.stringify(response.body)).not.toMatch(/customerEmail|customerPhone|cpf|cnpj/i);
    expect(response.body.meta.read_only).toBe(true);
  });

  it("rejects impossible dates before querying the report source", async () => {
    const response = await request(testApp("correct-secret"))
      .get("/api/analytics/portfolio-report?dateFrom=2026-02-30&dateTo=2026-03-01")
      .set("x-updash-reports-token", "correct-secret");
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects every write method", async () => {
    const app = testApp("correct-secret");
    for (const method of ["post", "patch", "delete"] as const) {
      const response = await request(app)[method]("/api/analytics/portfolio-report")
        .set("x-updash-reports-token", "correct-secret");
      expect(response.status).toBe(405);
      expect(response.headers.allow).toBe("GET");
    }
  });
});
