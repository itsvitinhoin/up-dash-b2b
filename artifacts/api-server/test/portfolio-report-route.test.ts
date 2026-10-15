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

  describe("token de API de admin (upk_...) no mesmo cabeçalho", () => {
    const VALID = `upk_${"A".repeat(43)}`;
    const calls: string[] = [];

    function appWithApiTokens(secret: string | undefined, accept: (token: string) => boolean | Error) {
      const app = express();
      app.use(
        "/api",
        createPortfolioReportRouter({
          getToken: () => secret,
          buildReport: async () => SAFE_REPORT,
          verifyApiToken: async (token) => {
            calls.push(token);
            const result = accept(token);
            if (result instanceof Error) throw result;
            return result;
          },
        }),
      );
      return app;
    }

    const url = "/api/analytics/portfolio-report?dateFrom=2026-07-10&dateTo=2026-07-12";

    it("aceita token de API ligado mesmo SEM o segredo fixo configurado (era 503)", async () => {
      const response = await request(appWithApiTokens(undefined, (t) => t === VALID)).get(url).set("x-updash-reports-token", VALID);
      expect(response.status).toBe(200);
      expect(response.headers["cache-control"]).toContain("no-store");
      expect(response.body.meta.read_only).toBe(true);
    });

    it("aceita token de API ligado também com o segredo fixo configurado", async () => {
      const response = await request(appWithApiTokens("correct-secret", (t) => t === VALID)).get(url).set("x-updash-reports-token", VALID);
      expect(response.status).toBe(200);
    });

    it("token de API desligado ou inexistente: 401", async () => {
      expect((await request(appWithApiTokens("correct-secret", () => false)).get(url).set("x-updash-reports-token", VALID)).status).toBe(401);
      expect((await request(appWithApiTokens(undefined, () => false)).get(url).set("x-updash-reports-token", VALID)).status).toBe(401);
    });

    it("falha ao conferir o token (banco fora): 500, nunca libera", async () => {
      const response = await request(appWithApiTokens("correct-secret", () => new Error("db down"))).get(url).set("x-updash-reports-token", VALID);
      expect(response.status).toBe(500);
      expect(JSON.stringify(response.body)).not.toContain("db down");
    });

    it("o segredo fixo continua funcionando e NÃO passa pela conferência de token de API", async () => {
      calls.length = 0;
      const response = await request(appWithApiTokens("correct-secret", () => false)).get(url).set("x-updash-reports-token", "correct-secret");
      expect(response.status).toBe(200);
      expect(calls).toHaveLength(0);
    });

    it("cabeçalho errado sem prefixo upk_ segue como antes: 401 com segredo, 503 sem segredo", async () => {
      calls.length = 0;
      expect((await request(appWithApiTokens("correct-secret", () => true)).get(url).set("x-updash-reports-token", "wrong")).status).toBe(401);
      expect((await request(appWithApiTokens(undefined, () => true)).get(url).set("x-updash-reports-token", "wrong")).status).toBe(503);
      expect(calls).toHaveLength(0);
    });

    it("continua só GET: escrita com token de API é 405", async () => {
      const response = await request(appWithApiTokens(undefined, () => true)).post("/api/analytics/portfolio-report").set("x-updash-reports-token", VALID);
      expect(response.status).toBe(405);
    });
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
