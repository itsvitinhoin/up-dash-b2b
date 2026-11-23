import { readFileSync } from "node:fs";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import express from "express";
import request from "supertest";
import { eq, sql } from "drizzle-orm";

vi.mock("../src/lib/auth", () => ({
  verifyAccessToken: (token: string) => {
    if (token === "admin")
      return { role: "ADMIN", sub: "admin", clientId: null };
    if (token === "client")
      return { role: "CLIENT", sub: "client", clientId: "jini" };
    throw new Error("Invalid token");
  },
}));
vi.mock("../src/services/extraction-runner", () => ({
  listExtractionJobs: vi.fn(),
  runBraavoTransactionalExtraction: vi.fn(),
  runDailyMetricsBackfill: vi.fn(),
  runHourlyExtractionBundle: vi.fn(),
  runNuvemshopTransactionalExtraction: vi.fn(),
  runUpzeroAnalyticsExtraction: vi.fn(),
  runUpzeroTransactionalExtraction: vi.fn(),
}));
const connection = process.env.BLING_TEST_DATABASE_URL;
let schema: typeof import("@workspace/db"),
  sync: typeof import("../src/services/bling-sync"),
  api: typeof import("../src/services/bling-api");
let app: express.Express;
let failingOrder = false,
  refreshed = 0;
let deniedPath: string | null = null;
let limitedPath: string | null = null;
let quotaPeriod = "second";
vi.setConfig({ testTimeout: 25000 });
const calls: string[] = [];
const fixtures = {
  "/canais-venda": [
    { id: 10, descricao: "Jini Nuvemshop", tipo: "Nuvemshop" },
    { id: 20, descricao: "Marketplace", tipo: "Shopee" },
  ],
  "/produtos": [
    {
      id: 101,
      nome: "Camiseta M",
      codigo: "SKU-M",
      preco: 100,
      tipo: "P",
      formato: "S",
      situacao: "A",
    },
  ],
  "/estoques/saldos": [
    {
      produto: { id: 101 },
      saldoFisicoTotal: 12,
      saldoVirtualTotal: 9,
      depositos: [{ id: 1, saldoFisico: 12, saldoVirtual: 9 }],
    },
  ],
  "/contatos": [
    { id: 201, nome: "Ana", situacao: "A", numeroDocumento: "11122233344" },
  ],
  "/pedidos/vendas": [{ id: 301 }, { id: 302 }, { id: 303 }],
};
describe.skipIf(!connection)("Bling with isolated PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(connection!);
    if (
      url.pathname !== "/bling_integration_test" ||
      !["localhost", "127.0.0.1"].includes(url.hostname)
    )
      throw new Error(
        "Requires isolated local bling_integration_test database.",
      );
    vi.stubEnv("DATABASE_URL", connection!);
    vi.stubEnv("CLOUD_SQL_CONNECTION_NAME", "");
    vi.stubEnv(
      "ERP_CREDENTIALS_ENCRYPTION_KEY",
      Buffer.alloc(32, 19).toString("base64"),
    );
    vi.stubEnv("BLING_TOKEN_ENCRYPTION_KEY", "ab".repeat(32));
    vi.stubEnv("BLING_CLIENT_ID", "test-app");
    vi.stubEnv("BLING_CLIENT_SECRET", "test-secret");
    vi.stubEnv("BLING_REDIRECT_URI", "https://dash.example/api/bling/callback");
    vi.stubEnv("CRON_SECRET", "synthetic-cron-secret");
    schema = await import("@workspace/db");
    sync = await import("../src/services/bling-sync");
    api = await import("../src/services/bling-api");
    await schema.db.execute(
      sql.raw(
        `CREATE TABLE IF NOT EXISTS clients (id text PRIMARY KEY, dashboard_type text, commerce_platform text, is_active boolean DEFAULT true, erp_provider text DEFAULT 'BLING', erp_credentials_encrypted text); ALTER TABLE clients ADD COLUMN IF NOT EXISTS erp_provider text DEFAULT 'BLING'; ALTER TABLE clients ADD COLUMN IF NOT EXISTS erp_credentials_encrypted text; ALTER TABLE clients ADD COLUMN IF NOT EXISTS updated_at timestamptz; CREATE TABLE IF NOT EXISTS orders (id text PRIMARY KEY, client_id text REFERENCES clients(id), external_id text, source_metadata jsonb);`,
      ),
    );
    const exists = await schema.db.execute(
      sql`SELECT to_regclass('bling_connections') AS name`,
    );
    if (!exists.rows[0].name)
      await schema.db.execute(
        sql.raw(
          readFileSync(
            new URL(
              "../../../lib/db/migrations/0050_bling.sql",
              import.meta.url,
            ),
            "utf8",
          ),
        ),
      );
    const router = await import("../src/routes/bling");
    const clients = await import("../src/routes/clients");
    const extractions = await import("../src/routes/extractions");
    app = express()
      .use(express.json())
      .use(router.blingRouter)
      .use(clients.default)
      .use(extractions.default);
  });
  beforeEach(async () => {
    calls.length = 0;
    failingOrder = false;
    refreshed = 0;
    deniedPath = null;
    limitedPath = null;
    quotaPeriod = "second";
    await schema.db.execute(sql`TRUNCATE clients CASCADE`);
    await schema.db.execute(
      sql`INSERT INTO clients (id, dashboard_type, commerce_platform) VALUES ('jini','B2C','NUVEMSHOP'), ('other','B2C','NUVEMSHOP'), ('wholesale','B2B','UPZERO')`,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input)),
          path = url.pathname.replace("/Api/v3", "");
        calls.push(`${path}?${url.searchParams}`);
        if (path === limitedPath)
          return Response.json(
            {
              error: {
                period: quotaPeriod,
                description: "private provider info",
              },
            },
            {
              status: 429,
              ...(quotaPeriod === "second"
                ? { headers: { "retry-after": "5" } }
                : {}),
            },
          );
        if (path === deniedPath)
          return new Response("Forbidden", { status: 403 });
        if (path === "/oauth/token") {
          refreshed++;
          return Response.json({
            access_token: `jwt-${refreshed}`,
            refresh_token: `refresh-${refreshed}`,
            expires_in: 21600,
          });
        }
        if (path === "/empresas/me/dados-basicos")
          return Response.json({
            data: { id: "company-jini", nome: "Jini Ltda" },
          });
        if (/^\/pedidos\/vendas\/\d+$/.test(path)) {
          const id = Number(path.split("/").at(-1));
          if (failingOrder && id === 302)
            return new Response("unavailable", { status: 500 });
          return Response.json({
            data: {
              id,
              numero: id,
              numeroLoja: "1001",
              data: "2026-11-18",
              total: id === 301 ? 100 : id === 302 ? 200 : 300,
              totalProdutos: 100,
              loja: id === 303 ? {} : { id: id === 301 ? 10 : 20 },
              contato: { id: 201, nome: "Ana" },
              situacao: { id: 99, valor: 12 },
              itens: [
                {
                  id: id * 10,
                  descricao: "Camiseta",
                  codigo: "SKU-M",
                  quantidade: 1,
                  valor: 100,
                },
              ],
            },
          });
        }
        if (path in fixtures)
          return Response.json({
            data: fixtures[path as keyof typeof fixtures],
          });
        throw new Error(`Unexpected fake endpoint: ${path}`);
      }),
    );
  });
  afterAll(async () => {
    if (schema) await schema.pool.end();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  const admin = { Authorization: "Bearer admin" };
  async function connect() {
    await schema.db.insert(schema.blingConnectionsTable).values({
      clientId: "jini",
      companyId: "company-jini",
      companyName: "Jini Ltda",
      tokens: api.sealTokens({
        accessToken: "access",
        refreshToken: "refresh",
      }),
      expiresAt: new Date(Date.now() + 3600000),
    });
  }
  it("opens before schema provisioning and creates only Bling storage on explicit save", async () => {
    await schema.db.execute(
      sql`DROP TABLE bling_records, bling_oauth_states, bling_connections`,
    );
    await schema.db.execute(
      sql`UPDATE clients SET erp_provider = NULL WHERE id = 'jini'`,
    );
    const before = await request(app)
      .get("/clients/jini/bling")
      .set(admin)
      .expect(200);
    expect(before.body.selected).toBe(false);
    expect(before.body.connected).toBe(false);
    await request(app)
      .put("/clients/jini/erp")
      .set(admin)
      .send({ erpProvider: "BLING", credentials: { useServerApp: true } })
      .expect(200);
    const after = await request(app)
      .get("/clients/jini/bling")
      .set(admin)
      .expect(200);
    expect(after.body.selected).toBe(true);
    expect(after.body.connected).toBe(false);
  });
  it("encrypts brand credentials, preserves an omitted secret, and invalidates tokens only on changes", async () => {
    await connect();
    const save = (credentials: object) =>
      request(app)
        .put("/clients/jini/erp")
        .set(admin)
        .send({ erpProvider: "BLING", credentials });
    await save({
      clientId: "brand-app",
      clientSecret: "brand-private-secret",
    }).expect(200);
    const stored = await schema.db.execute(
      sql`SELECT erp_credentials_encrypted AS value FROM clients WHERE id = 'jini'`,
    );
    expect(stored.rows[0].value).not.toContain("brand-private-secret");
    const status = await request(app)
      .get("/clients/jini/bling")
      .set(admin)
      .expect(200);
    expect(status.body.appClientId).toBe("brand-app");
    expect(status.body.credentialsSource).toBe("client");
    expect(status.body.connected).toBe(false);
    expect(JSON.stringify(status.body)).not.toContain("brand-private-secret");
    await schema.db
      .update(schema.blingConnectionsTable)
      .set({
        tokens: api.sealTokens({
          accessToken: "kept",
          refreshToken: "kept-refresh",
        }),
      })
      .where(eq(schema.blingConnectionsTable.clientId, "jini"));
    await save({ clientId: "brand-app" }).expect(200);
    const [kept] = await schema.db
      .select()
      .from(schema.blingConnectionsTable)
      .where(eq(schema.blingConnectionsTable.clientId, "jini"));
    expect(api.openTokens(kept.tokens!).accessToken).toBe("kept");
    await save({ clientId: "different-app" }).expect(400);
    const authorize = await request(app)
      .post("/clients/jini/bling/authorize")
      .set(admin)
      .expect(200);
    expect(new URL(authorize.body.url).searchParams.get("client_id")).toBe(
      "brand-app",
    );
    await request(app)
      .put("/clients/other/erp")
      .set("Authorization", "Bearer client")
      .send({ erpProvider: "BLING", credentials: { useServerApp: true } })
      .expect(403);
    await request(app)
      .put("/clients/wholesale/erp")
      .set(admin)
      .send({ erpProvider: "BLING", credentials: { useServerApp: true } })
      .expect(400);
  });
  it("tests the authorized account against Bling without importing orders", async () => {
    await request(app).post("/clients/jini/bling/test").set(admin).expect(409);
    await schema.db.delete(schema.blingConnectionsTable);
    await connect();
    const tested = await request(app)
      .post("/clients/jini/bling/test")
      .set(admin)
      .expect(200);
    expect(tested.body.companyName).toBe("Jini Ltda");
    expect(calls).toEqual(["/empresas/me/dados-basicos?"]);
    expect(await schema.db.select().from(schema.blingRecordsTable)).toEqual([]);
  });
  it("blocks anonymous reads, requires admin for connection changes, and isolates client data", async () => {
    await request(app).get("/clients/jini/bling").expect(401);
    await request(app)
      .post("/clients/jini/bling/authorize")
      .set("Authorization", "Bearer client")
      .expect(403);
    await request(app).get("/clients/wholesale/bling").set(admin).expect(400);
    const data = await request(app)
      .get("/analytics/erp/bling?clientId=other&from=2026-11-01&to=2026-11-18")
      .set("Authorization", "Bearer client")
      .expect(200);
    expect(data.body.status.connected).toBe(false);
    await request(app)
      .get("/analytics/erp/bling?from=2026-11-01&to=2026-11-18")
      .set(admin)
      .expect(400);
    await request(app)
      .get("/analytics/erp/bling?clientId=jini&from=2026-02-31&to=2026-11-18")
      .set(admin)
      .expect(400);
  });
  it("commits successful order details before a quota pause and resumes the failed detail", async () => {
    await connect();
    await schema.db
      .update(schema.blingConnectionsTable)
      .set({
        cursor: {
          ...sync.initialBlingCursor(30, null),
          phase: "orders",
          pending: ["301", "302", "303"],
          lastPage: true,
        },
      })
      .where(eq(schema.blingConnectionsTable.clientId, "jini"));
    limitedPath = "/pedidos/vendas/302";
    await request(app).post("/clients/jini/bling/sync").set(admin).expect(429);
    const [paused] = await schema.db
      .select()
      .from(schema.blingConnectionsTable)
      .where(eq(schema.blingConnectionsTable.clientId, "jini"));
    expect(paused.cursor?.pending).toEqual(["302", "303"]);
    expect(paused.nextRequestAt!.getTime()).toBeGreaterThan(Date.now());
    expect(paused.leaseId).toBeNull();
    const saved = await schema.db
      .select()
      .from(schema.blingRecordsTable)
      .where(eq(schema.blingRecordsTable.kind, "orders"));
    expect(saved.map((row) => row.externalId)).toEqual(["301"]);
    limitedPath = null;
    await schema.db
      .update(schema.blingConnectionsTable)
      .set({ nextRequestAt: new Date(0) })
      .where(eq(schema.blingConnectionsTable.clientId, "jini"));
    calls.length = 0;
    expect((await sync.runBlingBatch("jini")).complete).toBe(true);
    expect(calls.some((path) => path.startsWith("/pedidos/vendas/301?"))).toBe(
      false,
    );
    const status = await request(app)
      .get("/clients/jini/bling")
      .set(admin)
      .expect(200);
    expect(status.body.recordCounts.orders).toBe(3);
    expect(status.body.cursor).toBeNull();
  });
  it("binds OAuth state to the initiating browser and consumes it once", async () => {
    const start = await request(app)
      .post("/clients/jini/bling/authorize")
      .set(admin)
      .expect(200);
    const state = new URL(start.body.url).searchParams.get("state");
    const cookie = String(start.headers["set-cookie"][0]).split(";")[0];
    await request(app)
      .get(`/bling/callback?state=${state}&code=code`)
      .expect(400);
    expect(calls).toEqual([]);
    await request(app)
      .get(`/bling/callback?state=${state}&code=code`)
      .set("Cookie", cookie)
      .expect(303);
    await request(app)
      .get(`/bling/callback?state=${state}&code=code`)
      .set("Cookie", cookie)
      .expect(400);
    const result = await request(app)
      .get("/clients/jini/bling")
      .set(admin)
      .expect(200);
    expect(result.body.connected).toBe(true);
    expect(JSON.stringify(result.body)).not.toContain("refresh-1");
    const [row] = await schema.db.select().from(schema.blingConnectionsTable);
    expect(api.openTokens(row.tokens!).refreshToken).toBe("refresh-1");
  });
  it("persists failed-batch progress, rotates refresh tokens, and reconciles only the selected channel", async () => {
    await connect();
    await schema.db
      .update(schema.blingConnectionsTable)
      .set({ expiresAt: new Date(0) })
      .where(eq(schema.blingConnectionsTable.clientId, "jini"));
    failingOrder = true;
    await expect(sync.runBlingBatch("jini")).rejects.toThrow();
    let [state] = await schema.db.select().from(schema.blingConnectionsTable);
    expect(state.cursor?.pending).toEqual(["302", "303"]);
    expect(api.openTokens(state.tokens!).refreshToken).toBe("refresh-1");
    expect(state.leaseId).toBeNull();
    failingOrder = false;
    const finished = await sync.runBlingBatch("jini");
    expect(finished.complete).toBe(true);
    await schema.db.execute(
      sql`INSERT INTO orders VALUES ('ns1', 'jini', '98765', '{"nuvemshop":{"orderNumber":"1001"}}'::jsonb), ('ns2','other','other-id','{"nuvemshop":{"orderNumber":"1001"}}'::jsonb)`,
    );
    await request(app)
      .post("/clients/jini/bling/settings")
      .set(admin)
      .send({ historyDays: 30, nuvemshopChannelId: "10" })
      .expect(200);
    const result = await request(app)
      .get(
        "/analytics/erp/bling?clientId=jini&from=2026-11-01&to=2026-11-18&view=orders",
      )
      .set(admin)
      .expect(200);
    expect(result.body.status.recordCounts).toEqual({
      channels: 2,
      products: 1,
      customers: 1,
      orders: 3,
    });
    expect(result.body.summary).toMatchObject({
      orders: 3,
      orderValue: 600,
      matched: 1,
      unmatched: 0,
      ambiguous: 0,
    });
    expect(result.body.summary.channels).toHaveLength(3);
    expect(
      result.body.rows.find((r: { id: string }) => r.id === "302")
        .reconciliation,
    ).toBe("other_channel");
    const stock = await request(app)
      .get(
        "/analytics/erp/bling?clientId=jini&from=2026-11-01&to=2026-11-18&view=products",
      )
      .set(admin)
      .expect(200);
    expect(stock.body.rows[0].stock.available).toBe(9);
    const buyers = await request(app)
      .get(
        "/analytics/erp/bling?clientId=jini&from=2026-11-01&to=2026-11-18&view=customers&search=Ana",
      )
      .set(admin)
      .expect(200);
    expect(buyers.body.rows[0]).toMatchObject({
      id: "201",
      orders: 3,
      value: 600,
    });
    expect(
      JSON.stringify(await schema.db.select().from(schema.blingRecordsTable)),
    ).not.toContain("11122233344");
    // Replaying updates cannot add duplicate ERP sales or storefront orders.
    expect((await sync.runBlingBatch("jini")).complete).toBe(true);
    const records = await schema.db.execute(
      sql`SELECT count(*)::int AS n FROM bling_records WHERE kind = 'orders'`,
    );
    expect(records.rows[0].n).toBe(3);
    const storefront = await schema.db.execute(
      sql`SELECT count(*)::int AS n FROM orders WHERE client_id = 'jini'`,
    );
    expect(storefront.rows[0].n).toBe(1);
    expect(calls.some((p) => p.includes("dataAlteracaoInicial"))).toBe(true);
  }, 40000);
  it("persists a shared cooldown and resumes product page 17 without losing imported records", async () => {
    await connect();
    const cursor = {
      ...sync.initialBlingCursor(30, null),
      phase: "products" as const,
      page: 17,
    };
    await schema.db
      .update(schema.blingConnectionsTable)
      .set({ cursor })
      .where(eq(schema.blingConnectionsTable.clientId, "jini"));
    await schema.db.insert(schema.blingRecordsTable).values({
      clientId: "jini",
      kind: "products",
      externalId: "99",
      data: { id: "99", name: "Already imported" },
    });
    limitedPath = "/estoques/saldos";
    const paused = await request(app)
      .post("/clients/jini/bling/sync")
      .set(admin)
      .expect(429);
    expect(paused.body.rateLimitPeriod).toBe("second");
    expect(Number(paused.headers["retry-after"])).toBeGreaterThan(0);
    expect(JSON.stringify(paused.body)).not.toContain("private provider");
    const count = calls.length;
    await request(app).post("/clients/jini/bling/sync").set(admin).expect(429);
    expect(calls).toHaveLength(count);
    const state = await request(app)
      .get("/clients/jini/bling")
      .set(admin)
      .expect(200);
    expect(state.body.cursor).toMatchObject({
      phase: "products",
      page: 17,
      pendingItems: 0,
    });
    expect(Date.parse(state.body.retryAt)).toBeGreaterThan(Date.now());
    limitedPath = null;
    await schema.db
      .update(schema.blingConnectionsTable)
      .set({ nextRequestAt: new Date(0) })
      .where(eq(schema.blingConnectionsTable.clientId, "jini"));
    expect((await sync.runBlingBatch("jini")).complete).toBe(true);
    const [saved] = await schema.db
      .select()
      .from(schema.blingConnectionsTable)
      .where(eq(schema.blingConnectionsTable.clientId, "jini"));
    expect(saved.error).toBeNull();
    expect(saved.cursor).toBeNull();
    const products = await schema.db
      .select()
      .from(schema.blingRecordsTable)
      .where(eq(schema.blingRecordsTable.kind, "products"));
    expect(products.map((product) => product.externalId).sort()).toEqual([
      "101",
      "99",
    ]);
  });
  it("pauses daily quotas without refreshing credentials or sending more provider calls", async () => {
    await connect();
    limitedPath = "/produtos";
    quotaPeriod = "day";
    const paused = await request(app)
      .post("/clients/jini/bling/sync")
      .set(admin)
      .expect(429);
    expect(paused.body.rateLimitPeriod).toBe("day");
    expect(Date.parse(paused.body.retryAt) - Date.now()).toBeGreaterThan(
      23 * 3600000,
    );
    const count = calls.length;
    await request(app).post("/clients/jini/bling/test").set(admin).expect(429);
    expect(calls).toHaveLength(count);
    expect(refreshed).toBe(0);
    const status = await request(app)
      .get("/clients/jini/bling")
      .set(admin)
      .expect(200);
    expect(status.body.error).toContain("diário");
    expect(status.body.connected).toBe(true);
  });
  it("runs only the selected cron brand and preserves the target and cooldown on failure", async () => {
    const cron = { Authorization: "Bearer synthetic-cron-secret" };
    await request(app).get("/cron/extractions/bling?clientId=jini").expect(401);
    await connect();
    const other = await request(app)
      .get("/cron/extractions/bling?clientId=other")
      .set(cron)
      .expect(200);
    expect(other.body.result.clients).toBe(0);
    expect(calls).toHaveLength(0);
    const cursor = {
      ...sync.initialBlingCursor(30, null),
      phase: "orders" as const,
      pending: ["301"],
      lastPage: true,
    };
    await schema.db
      .update(schema.blingConnectionsTable)
      .set({ cursor })
      .where(eq(schema.blingConnectionsTable.clientId, "jini"));
    limitedPath = "/pedidos/vendas/301";
    const paused = await request(app)
      .get("/cron/extractions/bling?clientId=jini")
      .set(cron)
      .expect(500);
    expect(paused.body.result).toMatchObject({
      clients: 1,
      failed: 1,
      nextOffset: 0,
      code: "BLING_RATE_LIMIT",
      rateLimitPeriod: "second",
      checkpoint: { phase: "orders", page: 1, pendingItems: 1 },
    });
    expect(Date.parse(paused.body.result.retryAt)).toBeGreaterThan(Date.now());
    limitedPath = null;
    await schema.db
      .update(schema.blingConnectionsTable)
      .set({ nextRequestAt: new Date(0) })
      .where(eq(schema.blingConnectionsTable.clientId, "jini"));
    const finished = await request(app)
      .get("/cron/extractions/bling?clientId=jini")
      .set(cron)
      .expect(200);
    expect(finished.body.result).toMatchObject({
      clients: 1,
      failed: 0,
      complete: true,
    });
    const imported = await schema.db.select().from(schema.blingRecordsTable);
    expect(imported.filter((row) => row.kind === "orders")).toHaveLength(1);
    expect(imported.every((row) => row.clientId === "jini")).toBe(true);
  });
  it("serializes sync and configuration changes and can resume after an expired lease", async () => {
    await connect();
    const lease = await sync.claimBlingLease("jini");
    await expect(sync.claimBlingLease("jini")).rejects.toMatchObject({
      code: "BLING_BUSY",
    });
    await request(app)
      .post("/clients/jini/bling/settings")
      .set(admin)
      .send({ historyDays: 60, nuvemshopChannelId: null })
      .expect(409);
    await schema.db
      .update(schema.blingConnectionsTable)
      .set({ leaseUntil: new Date(0) })
      .where(eq(schema.blingConnectionsTable.clientId, "jini"));
    const replacement = await sync.claimBlingLease("jini");
    await sync.releaseBlingLease("jini", lease.leaseId);
    const [row] = await schema.db.select().from(schema.blingConnectionsTable);
    expect(row.leaseId).toBe(replacement.leaseId);
    await sync.releaseBlingLease("jini", replacement.leaseId);
  });

  it("prevents the same Bling company from being connected to another brand", async () => {
    await connect();
    const start = await request(app)
      .post("/clients/other/bling/authorize")
      .set(admin)
      .expect(200);
    const state = new URL(start.body.url).searchParams.get("state");
    const cookie = String(start.headers["set-cookie"][0]).split(";")[0];
    const result = await request(app)
      .get(`/bling/callback?state=${state}&code=code`)
      .set("Cookie", cookie)
      .expect(409);
    expect(result.body.code).toBe("BLING_COMPANY_ALREADY_CONNECTED");
    const [other] = await schema.db
      .select()
      .from(schema.blingConnectionsTable)
      .where(eq(schema.blingConnectionsTable.clientId, "other"));
    expect(other.tokens).toBeNull();
  });

  it("imports every order channel without permission to configure storefront integrations", async () => {
    await connect();
    deniedPath = "/canais-venda";
    expect((await sync.runBlingBatch("jini")).complete).toBe(true);
    const status = await request(app)
      .get("/clients/jini/bling")
      .set(admin)
      .expect(200);
    expect(status.body.channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "10", name: "Canal 10" }),
        expect.objectContaining({ id: "20", name: "Canal 20" }),
      ]),
    );
    await request(app)
      .post("/clients/jini/bling/settings")
      .set(admin)
      .send({ historyDays: 30, nuvemshopChannelId: "10" })
      .expect(200);
    const result = await request(app)
      .get(
        "/analytics/erp/bling?clientId=jini&from=2026-11-01&to=2026-11-18&view=orders",
      )
      .set(admin)
      .expect(200);
    expect(result.body.summary.orders).toBe(3);
    expect(result.body.summary.channels).toHaveLength(3);
  });

  it("still stops on missing mandatory product permissions", async () => {
    await connect();
    deniedPath = "/produtos";
    await expect(sync.runBlingBatch("jini")).rejects.toMatchObject({
      code: "BLING_SCOPE_REQUIRED",
    });
    const [state] = await schema.db.select().from(schema.blingConnectionsTable);
    expect(state.completedAt).toBeNull();
    expect(state.cursor?.phase).toBe("products");
  });
});
