import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import { is, SQL, Table } from "drizzle-orm";
import * as schema from "@workspace/db/schema";

const state = vi.hoisted(() => {
  // Cache de resposta do servidor desligado: estes testes mudam o banco e a mídia no meio e precisam ler sempre o dado atual.
  process.env.ANALYTICS_RESPONSE_CACHE_TTL_MS = "0";
  process.env.JWT_ACCESS_SECRET =
    "test-only-access-secret-at-least-32-characters";
  process.env.JWT_REFRESH_SECRET =
    "test-only-refresh-secret-at-least-32-characters";
  return { db: null as any, mediaFails: false, previousFails: false };
});
vi.mock("@workspace/db", async () => ({
  ...(await import("@workspace/db/schema")),
  db: new Proxy(
    {},
    {
      get: (_, key) => {
        const member = state.db[key];
        return typeof member === "function" ? member.bind(state.db) : member;
      },
    },
  ),
}));
vi.mock("../src/middlewares/auth", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { role: "ADMIN", sub: "test-admin" };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
  resolveClientId: (req: any) => req.query.clientId,
}));
vi.mock("../src/lib/openai", () => ({
  getOpenAIClient: () => null,
  getInsightAI: () => null,
  isAIConfigured: () => false,
}));
vi.mock("../src/services/ga4", () => ({
  fetchGa4FunnelMetrics: async () => null,
  fetchGa4DailyMetrics: async () => null,
  fetchGa4ProductViewMetrics: async () => null,
}));
vi.mock("../src/services/meta-ads", async (original) => {
  const actual = await original<typeof import("../src/services/meta-ads")>();
  return {
    ...actual,
    upsertMetaCreatives: vi.fn(async () => {}),
    fetchMetaMarketingData: vi.fn(
      async ({ since, until }: { since: string; until: string }) => {
        if (state.mediaFails || (state.previousFails && since !== "2026-10-20"))
          throw new actual.MediaReadError();
        // Reject the original next-day regression at the API boundary.
        if (since === "2026-10-20") expect(until).toBe("2026-10-20");
        return {
          summary: {
            spend: 123.45,
            leads: 0,
            purchases: 0,
            revenue: 0,
            clicks: 0,
            impressions: 0,
            reach: null,
            frequency: null,
            ctr: null,
            cpc: null,
            cpm: null,
            roas: null,
            cpa: null,
            cpl: null,
          },
          daily: [
            {
              date: since,
              spend: 123.45,
              leads: 0,
              purchases: 0,
              revenue: 0,
              clicks: 0,
              impressions: 0,
              cpl: null,
            },
          ],
          ads: [],
          campaigns: [
            {
              id: "campaign",
              name: "Campaign",
              spend: 123.45,
              impressions: 0,
              clicks: 0,
              leads: 0,
              purchases: 0,
              revenue: 0,
              roas: 0,
              cpl: null,
              cpa: null,
              dateStart: since,
              dateStop: until,
            },
          ],
          topCreatives: { ctr: [], cpl: [], leads: [] },
        };
      },
    ),
  };
});
// Gasto de UpZero/Nuvemshop agora vem do dado guardado (stored-marketing): a mesma simulação de antes responde pelos dois caminhos.
vi.mock("../src/services/stored-marketing", async () => {
  const meta = await import("../src/services/meta-ads");
  return { fetchStoredMarketingData: (params: unknown) => (meta.fetchMetaMarketingData as unknown as (p: unknown) => Promise<unknown>)(params) };
});
vi.mock("../src/services/upzero/analytics-facts", () => ({
  getUpzeroAnalyticsFactsAsMetrics: async () => [],
  getUpzeroAnalyticsFactsByEvent: async () => ({
    rows: Array.from({ length: 8 }, (_, i) => ({
      event_name: "register_submitted",
      period_type: "event",
      total_events: 1,
      user_id: i + 100,
      user: { id: i + 100 },
      event_id: `tracked-${i}`,
      period_start: "2026-10-20T14:00:00Z",
    })),
    truncatedEvents: [],
    failedEvents: [],
  }),
  getUpzeroFactActorsByDay: async () => ({ rows: [], complete: true }),
}));

import analytics from "../src/routes/analytics";
import clients from "../src/routes/clients";
import { MediaReadError, fetchMetaMarketingData } from "../src/services/meta-ads";

const pg = new PGlite();
const app = express();
app.use("/api", analytics, clients);
app.use((error: unknown, _req: any, res: any, _next: any) => {
  if (error instanceof MediaReadError)
    return res.status(503).json({ code: error.code });
  console.error(error);
  res.status(500).json({ error: String(error) });
});
const period = "dateFrom=2026-10-20&dateTo=2026-10-20";
const get = (path: string, clientId = "b2c") =>
  request(app).get(`/api/${path}?clientId=${clientId}&${period}`);

beforeAll(async () => {
  const dialect = new PgDialect();
  const tables = Object.values(schema).filter((value) => is(value, Table));
  // Real PostgreSQL tables from the production Drizzle definitions; no data/source credentials.
  for (const table of tables) {
    const config = getTableConfig(table as any);
    const columns = config.columns.map((column) => {
      let defaultClause = "";
      if (column.default !== undefined) {
        const d = column.default;
        defaultClause =
          " DEFAULT " +
          (is(d, SQL)
            ? dialect.sqlToQuery(d).sql
            : typeof d === "object"
              ? column.getSQLType().endsWith("[]")
                ? "'{}'"
                : "'" + JSON.stringify(d).replaceAll("'", "''") + "'"
              : typeof d === "string"
                ? `'${d.replaceAll("'", "''")}'`
                : JSON.stringify(d));
      }
      return `"${column.name}" ${column.getSQLType()}${defaultClause}`;
    });
    await pg.exec(`CREATE TABLE "${config.name}" (${columns.join(",")})`);
    for (const index of config.indexes) {
      const c = index.config;
      if (c.unique && c.columns.every((column: any) => column.name))
        await pg.exec(
          `CREATE UNIQUE INDEX "${c.name}" ON "${config.name}" (${c.columns.map((column: any) => `"${column.name}"`).join(",")})`,
        );
    }
  }
  state.db = drizzle(pg, { schema });
  await state.db.insert(schema.clientsTable).values([
    {
      id: "b2c",
      name: "Test B2C",
      email: "b2c@example.test",
      apiKey: "b2c-test",
      dashboardType: "B2C",
      metaAdAccountId: "test",
      metaAdsApiKey: "test",
    },
    {
      id: "b2b",
      name: "Test B2B",
      email: "b2b@example.test",
      apiKey: "b2b-test",
      dashboardType: "B2B",
      metaAdAccountId: "test",
      metaAdsApiKey: "test",
    },
  ]);
  await state.db.insert(schema.customersTable).values([
    {
      id: "before",
      clientId: "b2b",
      name: "Before",
      email: "before@example.test",
      registrationStatus: "APPROVED",
      createdAt: new Date("2026-10-20T02:59:59.999Z"),
      approvalDate: new Date("2026-10-20T15:00:00Z"),
    },
    {
      id: "at-start",
      clientId: "b2b",
      name: "Start",
      email: "start@example.test",
      registrationStatus: "APPROVED",
      createdAt: new Date("2026-10-20T03:00:00Z"),
    },
    {
      id: "late",
      clientId: "b2b",
      name: "Late",
      email: "late@example.test",
      registrationStatus: "APPROVED",
      createdAt: new Date("2026-10-21T02:59:59.999Z"),
    },
    {
      id: "pending",
      clientId: "b2b",
      name: "Pending",
      email: "pending@example.test",
      registrationStatus: "PENDING",
      createdAt: new Date("2026-10-20T12:00:00Z"),
    },
    {
      id: "after",
      clientId: "b2b",
      name: "After",
      email: "after@example.test",
      registrationStatus: "APPROVED",
      createdAt: new Date("2026-10-21T03:00:00Z"),
    },
  ]);
  await state.db.insert(schema.ordersTable).values([
    {
      id: "o-before",
      clientId: "b2c",
      customerId: "x",
      status: "APPROVED",
      amount: 1000,
      fulfilledAmount: 1000,
      createdAt: new Date("2026-10-20T02:59:59.999Z"),
    },
    {
      id: "o-start",
      clientId: "b2c",
      customerId: "x",
      status: "APPROVED",
      amount: 100,
      fulfilledAmount: 90,
      createdAt: new Date("2026-10-20T03:00:00Z"),
    },
    {
      id: "o-late",
      clientId: "b2c",
      customerId: "x",
      status: "SHIPPED",
      amount: 200,
      fulfilledAmount: 180,
      createdAt: new Date("2026-10-21T02:59:59.999Z"),
    },
    {
      id: "o-pending",
      clientId: "b2c",
      customerId: "x",
      status: "PENDING",
      amount: 400,
      fulfilledAmount: 0,
      createdAt: new Date("2026-10-20T12:00:00Z"),
    },
    {
      id: "o-rejected",
      clientId: "b2c",
      customerId: "x",
      status: "REJECTED",
      amount: 500,
      fulfilledAmount: 500,
      createdAt: new Date("2026-10-20T12:00:00Z"),
    },
    {
      id: "o-after",
      clientId: "b2c",
      customerId: "x",
      status: "DELIVERED",
      amount: 2000,
      fulfilledAmount: 2000,
      createdAt: new Date("2026-10-21T03:00:00Z"),
    },
  ]);
  await state.db.insert(schema.dailyClientMetricsTable).values({
    id: "stale-summary",
    clientId: "b2b",
    metricDate: "2026-10-20",
    approvedRevenue: 999,
    approvedOrders: 99,
    registrations: 99,
    approvedRegistrations: 99,
  });
  // More events than registrations: the funnel must not choose the larger tracking count.
  await state.db.insert(schema.eventsTable).values(
    Array.from({ length: 8 }, (_, i) => ({
      id: `event-${i}`,
      clientId: "b2b",
      customerId: "pending",
      eventType: "REGISTRATION",
      createdAt: new Date("2026-10-20T14:00:00Z"),
    })),
  );
}, 60_000);
afterAll(async () => {
  await pg.close();
});

describe("cross-screen reconciliation using real PostgreSQL queries", () => {
  it("Clientes, Diário and Dashboard agree on paid money, statuses and Brasília boundaries", async () => {
    const list = await request(app).get(
      `/api/clients?dashboardType=B2C&${period}`,
    );
    const daily = await get("analytics/daily-report");
    const dashboard = await get("analytics/dashboard");
    expect(list.status, list.text).toBe(200);
    expect(daily.status, daily.text).toBe(200);
    expect(dashboard.status, dashboard.text).toBe(200);
    expect(list.body.data[0].revenueYtd).toBe(270);
    expect(list.body.data[0].ordersYtd).toBe(2);
    expect(daily.body.kpis.approvedRevenue).toBe(270);
    expect(daily.body.kpis.sales).toBe(2);
    expect(dashboard.body.kpis.revenue).toBe(270);
    expect(dashboard.body.kpis.orders).toBe(2);
    expect(dashboard.body.revenueOverTime).toEqual([
      { date: "2026-10-20", value: 270 },
    ]);
    expect(
      dashboard.body.revenueOverTime.reduce(
        (sum: number, day: any) => sum + day.value,
        0,
      ),
    ).toBe(270);
  });
  it("Dashboard, Cadastros and Funil agree; repeated tracking cannot inflate registrations", async () => {
    const dashboard = await get("analytics/dashboard", "b2b");
    const summary = await get("analytics/customers/summary", "b2b");
    const funnel = await get("analytics/funnel", "b2b");
    expect(dashboard.status, dashboard.text).toBe(200);
    expect(summary.status, summary.text).toBe(200);
    expect(funnel.status, funnel.text).toBe(200);
    expect(dashboard.body.leadsOverTime).toEqual([
      { date: "2026-10-20", value: 3 },
    ]);
    expect(dashboard.body.kpis.leads).toBe(3);
    expect(dashboard.body.kpis.approvedLeads).toBe(2);
    expect(summary.body.kpis.totalRegistrations).toBe(3);
    expect(summary.body.kpis.approvedRegistrations).toBe(2);
    expect(
      funnel.body.steps.find((s: any) => s.step === "REGISTRATION").count,
    ).toBe(3);
    expect(
      funnel.body.steps.find((s: any) => s.step === "APPROVED_REGISTRATION")
        .count,
    ).toBe(2);
  });
  it("re-reads approval changes and never substitutes an existing stale daily aggregate", async () => {
    await pg.exec(
      "UPDATE customers SET registration_status = 'APPROVED' WHERE id = 'pending'",
    );
    try {
      const dashboard = await get("analytics/dashboard", "b2b");
      const summary = await get("analytics/customers/summary", "b2b");
      const funnel = await get("analytics/funnel", "b2b");
      expect(dashboard.status, dashboard.text).toBe(200);
      expect(dashboard.body.kpis.revenue).toBe(0);
      expect(dashboard.body.kpis.orders).toBe(0);
      expect(dashboard.body.kpis.approvedLeads).toBe(3);
      expect(summary.body.kpis.approvedRegistrations).toBe(3);
      expect(
        funnel.body.steps.find(
          (step: any) => step.step === "APPROVED_REGISTRATION",
        ).count,
      ).toBe(3);
    } finally {
      await pg.exec(
        "UPDATE customers SET registration_status = 'PENDING' WHERE id = 'pending'",
      );
    }
  });
  it("Diário and Anúncios query the same civil date and return the same investment", async () => {
    const daily = await get("analytics/daily-report");
    const marketing = await get("analytics/marketing");
    expect(marketing.status, marketing.text).toBe(200);
    expect(marketing.body.kpis.totalSpend).toBe(123.45);
    expect(marketing.body.platformBreakdown[0].spend).toBe(123.45);
    expect(
      marketing.body.creatives.reduce(
        (total: number, c: any) => total + c.spend,
        0,
      ),
    ).toBe(123.45);
    expect(marketing.body.kpis.attributedRevenue).toBe(270);
    expect(marketing.body.revenueOverTime).toEqual([
      { date: "2026-10-20", value: 270 },
    ]);
    expect(daily.body.kpis.mediaSpend).toBe(123.45);
    expect(marketing.headers["cache-control"]).toContain("no-store");
  });
  it("keeps current data and null comparisons when only the prior period fails", async () => {
    state.previousFails = true;
    try {
      const daily = await get("analytics/daily-report");
      const marketing = await get("analytics/marketing");
      expect(daily.status, daily.text).toBe(200);
      expect(marketing.status, marketing.text).toBe(200);
      expect(daily.body.kpis.mediaSpend).toBe(123.45);
      expect(daily.body.prevKpis).toBeNull();
      expect(daily.body.changes.mediaSpend).toBeNull();
      expect(marketing.body.prevKpis).toBeNull();
    } finally {
      state.previousFails = false;
    }
  });
  it("returns an explicit failure, never a zero-spend response", async () => {
    state.mediaFails = true;
    try {
      for (const path of ["analytics/marketing", "analytics/daily-report"]) {
        const response = await get(path);
        expect(response.status, response.text).toBe(503);
        expect(response.body.code).toBe("MEDIA_UNAVAILABLE");
        expect(response.body.kpis).toBeUndefined();
      }
    } finally {
      state.mediaFails = false;
    }
  });
  it("cliente sem Meta conectado: a tela carrega com mídia vazia, sem chamar o Meta e sem erro 503", async () => {
    await state.db.insert(schema.clientsTable).values({ id: "nometa", name: "Sem Meta", email: "nometa@example.test", apiKey: "nometa-test", dashboardType: "B2C" });
    const calls = vi.mocked(fetchMetaMarketingData);
    calls.mockClear();
    state.mediaFails = true; // se alguém tentar ler o Meta, falharia
    try {
      for (const path of ["analytics/marketing", "analytics/daily-report"]) {
        const response = await get(path, "nometa");
        expect(response.status, response.text).toBe(200);
      }
      const marketing = await get("analytics/marketing", "nometa");
      expect(marketing.body.kpis.totalSpend).toBe(0);
      expect(marketing.body.creativesTotal).toBe(0);
      expect(calls).not.toHaveBeenCalled();
    } finally {
      state.mediaFails = false;
    }
  });
  it("filtro por fonte que não é Meta: recorte vazio, não é falha de leitura", async () => {
    const calls = vi.mocked(fetchMetaMarketingData);
    calls.mockClear();
    const response = await request(app).get(`/api/analytics/marketing?clientId=b2c&${period}&utmSource=google`);
    expect(response.status, response.text).toBe(200);
    expect(response.body.kpis.totalSpend).toBe(0);
    expect(calls).not.toHaveBeenCalled();
  });
});
