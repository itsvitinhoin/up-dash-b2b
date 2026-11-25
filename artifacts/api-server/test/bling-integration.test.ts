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
    vi.stubEnv("DATABASE_POOL_MAX", "1");
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
  function stubOrderLookup({
    found = true,
    outsideWindow = false,
    ambiguous = false,
  } = {}) {
    const fixtureFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        if (
          url.pathname.endsWith("/pedidos/vendas") &&
          url.searchParams.has("numero")
        ) {
          calls.push(`/pedidos/vendas?${url.searchParams}`);
          return Response.json({
            data: found
              ? ambiguous
                ? [
                    { id: 304, numero: 304 },
                    { id: 305, numero: 304 },
                  ]
                : [{ id: 304, numero: 304 }]
              : [],
          });
        }
        const response = await fixtureFetch(input, init);
        if (!url.pathname.endsWith("/pedidos/vendas/304") || !response.ok)
          return response;
        const body = await response.json();
        body.data.data = outsideWindow
          ? "2020-01-01"
          : sync.initialBlingCursor(30, null).until.slice(0, 10);
        return Response.json(body);
      }),
    );
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
  it.each([
    { limited: "302", pending: ["302", "303"], succeeded: "301" },
    { limited: "301", pending: ["301", "303"], succeeded: "302" },
  ])(
    "preserves settled successes when concurrent order $limited is rate limited",
    async ({ limited, pending, succeeded }) => {
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
      limitedPath = `/pedidos/vendas/${limited}`;
      await request(app)
        .post("/clients/jini/bling/sync")
        .set(admin)
        .expect(429);
      const [paused] = await schema.db
        .select()
        .from(schema.blingConnectionsTable)
        .where(eq(schema.blingConnectionsTable.clientId, "jini"));
      expect(paused.cursor?.pending).toEqual(pending);
      expect(paused.nextRequestAt!.getTime()).toBeGreaterThan(Date.now());
      expect(paused.leaseId).toBeNull();
      const saved = await schema.db
        .select()
        .from(schema.blingRecordsTable)
        .where(eq(schema.blingRecordsTable.kind, "orders"));
      expect(saved.map((row) => row.externalId)).toEqual([succeeded]);
      limitedPath = null;
      await schema.db
        .update(schema.blingConnectionsTable)
        .set({ nextRequestAt: new Date(0) })
        .where(eq(schema.blingConnectionsTable.clientId, "jini"));
      calls.length = 0;
      expect((await sync.runBlingBatch("jini")).complete).toBe(true);
      expect(
        calls.some((path) => path.startsWith(`/pedidos/vendas/${succeeded}?`)),
      ).toBe(false);
      const status = await request(app)
        .get("/clients/jini/bling")
        .set(admin)
        .expect(200);
      expect(status.body.recordCounts.orders).toBe(3);
      expect(status.body.cursor).toBeNull();
    },
  );
  it("reserves separate provider slots under concurrent database callers", async () => {
    await connect();
    const slots = (
      await Promise.all(
        Array.from({ length: 4 }, () => sync.reserveBlingSlot("jini")),
      )
    ).sort((a, b) => a - b);
    for (let i = 1; i < slots.length; i++)
      expect(slots[i] - slots[i - 1]).toBeGreaterThanOrEqual(999.9);
  });
  it("recovers after a temporary pool acquisition timeout without losing the waiting query", async () => {
    const held = await schema.pool.connect();
    let released = false;
    const timer = setTimeout(() => {
      released = true;
      held.release();
    }, 10_300);
    try {
      const result = await schema.db.execute(sql`SELECT 1 AS recovered`);
      expect(result.rows[0].recovered).toBe(1);
    } finally {
      clearTimeout(timer);
      if (!released) held.release();
    }
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
  it("builds charts and catalog sales from scoped cached orders without inventing missing stock", async () => {
    await connect();
    const product = (id: string, sku: string, stock: unknown) => ({
      id,
      name: `Produto ${id}`,
      sku,
      status: "A",
      price: 20,
      parentId: null,
      stock,
    });
    const order = (
      id: string,
      day: string,
      customerId: string,
      customerName: string,
      total: number,
      items: unknown[],
      channelId = "10",
    ) => ({
      id,
      number: id,
      day,
      customerId,
      customerName,
      total,
      channelId,
      statusId: id === "2" ? "2" : "1",
      items,
    });
    const item = (
      productId: string,
      sku: string,
      quantity: number,
      unitPrice: number,
    ) => ({ id: sku, productId, sku, quantity, unitPrice, name: sku });
    await schema.db.insert(schema.blingRecordsTable).values([
      ...[
        order("1", "2026-11-01", "a", "Ana", 100, [item("p1", "ONE", 2, 10)]),
        order(
          "2",
          "2026-11-02",
          "a",
          "Ana Silva",
          200,
          [item("p1", "ONE", 1, 15)],
          "20",
        ),
        order("3", "2026-11-02", "b", "Bob", 300, [item("", "DUP", 2, 5)]),
        order("4", "2025-01-01", "b", "Bob", 900, []),
      ].map((data) => ({
        clientId: "jini",
        kind: "orders" as const,
        externalId: data.id,
        data,
      })),
      {
        clientId: "other",
        kind: "orders",
        externalId: "foreign",
        data: order("foreign", "2026-11-02", "a", "Ana", 9999, [
          item("p1", "ONE", 99, 99),
        ]),
      },
      ...[
        product("p1", "ONE", { physical: 12, available: 10, warehouses: [] }),
        product("p2", "DUP", { physical: 0, available: 0, warehouses: [] }),
        product("p3", "DUP", { physical: -1, available: -2, warehouses: [] }),
        product("p4", "MISSING", null),
        { id: "p5", name: "Produto p5", sku: "UNSET", status: "I", price: 0 },
      ].map((data) => ({
        clientId: "jini",
        kind: "products" as const,
        externalId: data.id,
        data,
      })),
    ]);
    const read = async (extra = "") =>
      (
        await request(app)
          .get(
            `/analytics/erp/bling?clientId=jini&from=2026-11-01&to=2026-11-03${extra}`,
          )
          .set(admin)
          .expect(200)
      ).body;
    const result = await read();
    expect(result.summary).toMatchObject({
      orders: 3,
      orderValue: 600,
      customers: 2,
      repeatCustomers: 1,
      units: 5,
      daily: [
        { day: "2026-11-01", orders: 1, value: 100, customers: 1 },
        { day: "2026-11-02", orders: 2, value: 500, customers: 2 },
      ],
      catalog: {
        products: 5,
        active: 4,
        knownStock: 3,
        physical: 11,
        available: 8,
        positive: 1,
        zero: 1,
        negative: 1,
        unknown: 2,
        units: 3,
        value: 35,
      },
      coverage: { from: "2025-01-01", to: "2026-11-02" },
    });
    expect(
      result.summary.topProducts.reduce(
        (n: number, r: { value: number }) => n + r.value,
        0,
      ),
    ).toBe(45);
    const buyers = await read("&view=customers&search=Ana&buyerType=repeat");
    expect(buyers.total).toBe(1);
    expect(buyers.rows[0]).toMatchObject({
      id: "a",
      orders: 2,
      value: 300,
      first_day: "2026-11-01",
      last_day: "2026-11-02",
      channels: 2,
    });
    expect(buyers.summary.orders).toBe(2);
    const buyerOrders = await read("&view=orders&customerId=a");
    expect(buyerOrders.total).toBe(2);
    expect((await read("&view=orders&statusId=2")).summary).toMatchObject({
      orders: 1,
      orderValue: 200,
    });
    expect((await read("&channel=10")).summary.orderValue).toBe(400);
    const stock = await read("&view=stock&stock=unknown");
    expect(stock.total).toBe(2);
    expect(stock.summary.catalog).toMatchObject({
      knownStock: 0,
      unknown: 2,
      zero: 0,
    });
    const products = await read("&view=products&sort=units");
    expect(products.rows[0]).toMatchObject({ id: "p1", units: 3, value: 35 });
    // An ambiguous SKU cannot allocate the same order items to two products.
    expect(
      products.rows
        .filter((p: { sku: string }) => p.sku === "DUP")
        .every((p: { units: number }) => p.units === 0),
    ).toBe(true);
    expect(
      (await read("&view=stock&stock=zero")).rows.map(
        (p: { id: string }) => p.id,
      ),
    ).toEqual(["p2"]);
    expect(
      (await read("&view=products&search=ONE")).summary.catalog.products,
    ).toBe(1);
    expect(calls).toHaveLength(0);
  });
  it.each([false, true])(
    "restores a deselected ERP with private app = %s only after verifying the prior grant and company",
    async (privateApp) => {
      await connect();
      const completedAt = new Date("2026-11-18T12:00:00Z");
      await schema.db
        .update(schema.blingConnectionsTable)
        .set({
          completedAt,
          watermark: "2026-11-18 09:00:00",
          historyDays: 30,
          nuvemshopChannelId: "10",
        })
        .where(eq(schema.blingConnectionsTable.clientId, "jini"));
      await schema.db.execute(
        sql`UPDATE clients SET erp_provider = NULL, erp_credentials_encrypted = NULL WHERE id = 'jini'`,
      );
      if (privateApp) {
        const { encryptErpCredentials } = await import("../src/lib/erp-crypto");
        await schema.db.execute(
          sql`UPDATE clients SET erp_credentials_encrypted = ${encryptErpCredentials({ clientId: "test-app", clientSecret: "test-secret" })} WHERE id = 'jini'`,
        );
      }
      const before = await request(app)
        .get("/clients/jini/bling")
        .set(admin)
        .expect(200);
      expect(before.body.canRestore).toBe(true);
      await request(app)
        .post("/clients/jini/bling/restore")
        .set("Authorization", "Bearer client")
        .expect(403);
      await request(app)
        .post("/clients/jini/bling/restore")
        .set(admin)
        .expect(200);
      const [state] = await schema.db
        .select()
        .from(schema.blingConnectionsTable)
        .where(eq(schema.blingConnectionsTable.clientId, "jini"));
      expect(state).toMatchObject({
        completedAt,
        watermark: "2026-11-18 09:00:00",
        historyDays: 30,
        nuvemshopChannelId: "10",
        cursor: null,
        leaseId: null,
      });
      expect(api.openTokens(state.tokens!).refreshToken).toBe("refresh-1");
      expect(
        (await request(app).get("/clients/jini/bling").set(admin).expect(200))
          .body,
      ).toMatchObject({ selected: true, connected: true, canRestore: false });
      expect(calls.some((p) => p.startsWith("/pedidos/vendas"))).toBe(false);
    },
  );
  it("refuses restoration for another selected ERP or an incomplete old load", async () => {
    await connect();
    await schema.db.execute(
      sql`UPDATE clients SET erp_provider = 'MANSE' WHERE id = 'jini'`,
    );
    await request(app)
      .post("/clients/jini/bling/restore")
      .set(admin)
      .expect(409);
    await schema.db.execute(
      sql`UPDATE clients SET erp_provider = NULL WHERE id = 'jini'`,
    );
    await request(app)
      .post("/clients/jini/bling/restore")
      .set(admin)
      .expect(409);
    expect(calls).toHaveLength(0);
  });
  it("does not select a restored connection when the provider reports another company, while preserving refresh rotation", async () => {
    await connect();
    await schema.db
      .update(schema.blingConnectionsTable)
      .set({ completedAt: new Date(), companyId: "expected-company" })
      .where(eq(schema.blingConnectionsTable.clientId, "jini"));
    await schema.db.execute(
      sql`UPDATE clients SET erp_provider = NULL WHERE id = 'jini'`,
    );
    await request(app)
      .post("/clients/jini/bling/restore")
      .set(admin)
      .expect(409);
    const state = await request(app)
      .get("/clients/jini/bling")
      .set(admin)
      .expect(200);
    expect(state.body.selected).toBe(false);
    const [connection] = await schema.db
      .select()
      .from(schema.blingConnectionsTable)
      .where(eq(schema.blingConnectionsTable.clientId, "jini"));
    expect(api.openTokens(connection.tokens!).refreshToken).toBe("refresh-1");
  });
  it("serves the shared B2B contract through the isolated Bling reader with bounded pages and brand isolation", async () => {
    await schema.db.insert(schema.blingRecordsTable).values(
      Array.from({ length: 23 }, (_, i) => ({
        clientId: "jini",
        kind: "orders" as const,
        externalId: String(i),
        data: {
          id: String(i),
          number: String(i),
          day: "2026-11-02",
          customerId: "buyer",
          customerName: "Contato",
          statusId: "99",
          channelId: "10",
          total: 10,
          items: [{ id: "item", quantity: 2, unitPrice: 5 }],
        },
      })),
    );
    await schema.db.insert(schema.blingRecordsTable).values({
      clientId: "other",
      kind: "orders",
      externalId: "foreign",
      data: {
        id: "foreign",
        number: "foreign",
        day: "2026-11-02",
        total: 99999,
        items: [],
      },
    });
    const base =
      "/analytics/erp/bling?clientId=other&from=2026-11-01&to=2026-11-03";
    const read = async (extra: string) =>
      (
        await request(app)
          .get(base + extra)
          .set("Authorization", "Bearer client")
          .expect(200)
      ).body;
    const first = await read("&layout=orders&limit=20"),
      second = await read("&layout=orders&limit=20&page=2");
    expect(first.rows).toHaveLength(20);
    expect(second.rows).toHaveLength(3);
    expect(first.total).toBe(23);
    expect(
      first.rows.every(
        (r: { externalId: string }) => r.externalId !== "foreign",
      ),
    ).toBe(true);
    expect(first.rows[0]).toMatchObject({
      createdAt: "2026-11-02",
      grossAmount: null,
      netAmount: null,
      status: "ID 99",
    });
    const dashboard = await read("&layout=dashboard");
    expect(dashboard.kpis).toMatchObject({
      orders: 23,
      totalQuantity: 46,
      uniqueCustomers: 1,
      netRevenue: null,
      retentionPct: null,
    });
    const buyers = await read("&layout=customers");
    expect(buyers.rows[0]).toMatchObject({
      id: "buyer",
      orders: 23,
      totalSpent: 230,
      lifetimeValue: null,
      buyerType: null,
    });
    expect((await read("&layout=orders&customerId=other-buyer")).total).toBe(0);
    expect((await read("&layout=orders&statusId=missing")).total).toBe(0);
    await request(app)
      .get(base + "&layout=orders&limit=10001")
      .set(admin)
      .expect(400);
    await request(app)
      .get(base + "&layout=invalid")
      .set(admin)
      .expect(400);
    expect(calls).toHaveLength(0);
  });
  it("paginates and exports all filtered rows while keeping client access isolated", async () => {
    await schema.db.insert(schema.blingRecordsTable).values(
      Array.from({ length: 28 }, (_, i) => ({
        clientId: "jini",
        kind: "orders" as const,
        externalId: String(i),
        data: {
          id: String(i),
          number: String(i),
          day: "2026-11-02",
          customerId: "buyer",
          customerName: "Buyer",
          channelId: "10",
          total: 10,
          items: [],
        },
      })),
    );
    await schema.db.insert(schema.blingRecordsTable).values({
      clientId: "other",
      kind: "orders",
      externalId: "private",
      data: { id: "private", day: "2026-11-02", total: 99999, items: [] },
    });
    const url =
      "/analytics/erp/bling?clientId=other&view=orders&from=2026-11-01&to=2026-11-03";
    const read = async (extra = "") =>
      (
        await request(app)
          .get(url + extra)
          .set("Authorization", "Bearer client")
          .expect(200)
      ).body;
    const first = await read(),
      second = await read("&page=2"),
      exported = await read("&export=1");
    expect(first.rows).toHaveLength(25);
    expect(second.rows).toHaveLength(3);
    expect(
      new Set([...first.rows, ...second.rows].map((r: { id: string }) => r.id))
        .size,
    ).toBe(28);
    expect(exported.rows).toHaveLength(28);
    expect(exported.summary.orderValue).toBe(280);
    expect(exported.rows.every((r: { id: string }) => r.id !== "private")).toBe(
      true,
    );
    await request(app)
      .get(url + "&stock=invalid")
      .set(admin)
      .expect(400);
    await request(app)
      .get(url + "&export=true")
      .set(admin)
      .expect(400);
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
    await schema.db.execute(
      sql`INSERT INTO orders VALUES ('ns-duplicate', 'jini', 'another-id', '{"nuvemshop":{"orderNumber":"1001"}}'::jsonb)`,
    );
    const ambiguous = await request(app)
      .get(
        "/analytics/erp/bling?clientId=jini&from=2026-11-01&to=2026-11-18&view=orders",
      )
      .set(admin)
      .expect(200);
    expect(ambiguous.body.summary).toMatchObject({
      orders: 3,
      orderValue: 600,
      matched: 0,
      unmatched: 0,
      ambiguous: 1,
    });
    expect(
      ambiguous.body.rows.find((row: { id: string }) => row.id === "302")
        .reconciliation,
    ).toBe("other_channel");
    // The other brand still has this number. Missing local numbers must not
    // match it, and duplicate storefront rows must never multiply ERP totals.
    await schema.db.execute(
      sql`UPDATE orders SET source_metadata = '{"nuvemshop":{"orderNumber":""}}'::jsonb WHERE client_id = 'jini'`,
    );
    const missing = await request(app)
      .get(
        "/analytics/erp/bling?clientId=jini&from=2026-11-01&to=2026-11-18&view=orders",
      )
      .set(admin)
      .expect(200);
    expect(missing.body.summary).toMatchObject({
      orders: 3,
      orderValue: 600,
      matched: 0,
      unmatched: 1,
      ambiguous: 0,
    });
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
  it("requires a completed load and explicit brand for an orders-only closing pass, without skipping an active cursor", async () => {
    const cron = { Authorization: "Bearer synthetic-cron-secret" };
    await connect();
    await request(app)
      .get("/cron/extractions/bling?ordersOnly=true")
      .set(cron)
      .expect(400);
    await request(app)
      .get("/cron/extractions/bling?clientId=jini&ordersOnly=yes")
      .set(cron)
      .expect(400);
    await expect(
      sync.runBlingBatch("jini", { ordersOnly: true }),
    ).rejects.toMatchObject({ code: "BLING_HISTORY_REQUIRED" });
    expect(calls).toEqual([]);
    await schema.db
      .update(schema.blingConnectionsTable)
      .set({
        cursor: {
          ...sync.initialBlingCursor(30, null),
          phase: "customers",
          page: 88,
        },
      })
      .where(eq(schema.blingConnectionsTable.clientId, "jini"));
    expect(
      (await sync.runBlingBatch("jini", { ordersOnly: true })).complete,
    ).toBe(true);
    expect(calls[0]).toContain("/contatos?pagina=88");
    expect(calls.some((path) => path.startsWith("/produtos?"))).toBe(false);
  });

  it("updates changed orders only inside the imported date window and preserves catalog and contacts", async () => {
    await connect();
    expect((await sync.runBlingBatch("jini")).complete).toBe(true);
    const before = await schema.db.select().from(schema.blingRecordsTable);
    calls.length = 0;
    const fixtureFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const response = await fixtureFetch(input, init);
        const path = new URL(String(input)).pathname;
        if (!/\/pedidos\/vendas\/\d+$/.test(path)) return response;
        const body = await response.json();
        body.data.data = path.endsWith("/304")
          ? "2025-12-31"
          : sync.initialBlingCursor(30, null).until.slice(0, 10);
        return Response.json(body);
      }),
    );
    fixtures["/pedidos/vendas"].push({ id: 304 }, { id: 305 });
    try {
      const closing = await request(app)
        .get("/cron/extractions/bling?clientId=jini&ordersOnly=true")
        .set({ Authorization: "Bearer synthetic-cron-secret" })
        .expect(200);
      expect(closing.body.result.complete).toBe(true);
      expect(calls.every((path) => path.startsWith("/pedidos/vendas"))).toBe(
        true,
      );
      const listing = new URL(
        `https://provider.example${calls.find((path) => path.startsWith("/pedidos/vendas?"))}`,
      );
      const window = sync.initialBlingCursor(30, null);
      expect(listing.searchParams.get("dataInicial")).toBe(
        window.from.slice(0, 10),
      );
      expect(listing.searchParams.get("dataFinal")).toBe(
        window.until.slice(0, 10),
      );
      expect(listing.searchParams.has("dataAlteracaoInicial")).toBe(true);
      expect(listing.searchParams.has("dataAlteracaoFinal")).toBe(true);
      const after = await schema.db.select().from(schema.blingRecordsTable);
      expect(after.filter((row) => row.kind === "orders")).toHaveLength(4);
      expect(
        after.some((row) => row.kind === "orders" && row.externalId === "304"),
      ).toBe(false);
      expect(
        after.some((row) => row.kind === "orders" && row.externalId === "305"),
      ).toBe(true);
      for (const row of before.filter(
        (row) => row.kind === "products" || row.kind === "customers",
      ))
        expect(
          after.find(
            (saved) =>
              saved.kind === row.kind && saved.externalId === row.externalId,
          ),
        ).toEqual(row);
    } finally {
      fixtures["/pedidos/vendas"].splice(-2);
    }
  });

  it("restricts individual order lookup to administrators and completed imports", async () => {
    await connect();
    await request(app)
      .post("/clients/jini/bling/orders/refresh")
      .send({ orderNumber: "304" })
      .expect(401);
    await request(app)
      .post("/clients/jini/bling/orders/refresh")
      .set({ Authorization: "Bearer client" })
      .send({ orderNumber: "304" })
      .expect(403);
    await request(app)
      .post("/clients/jini/bling/orders/refresh")
      .set(admin)
      .send({ orderNumber: "../304" })
      .expect(400);
    const incomplete = await request(app)
      .post("/clients/jini/bling/orders/refresh")
      .set(admin)
      .send({ orderNumber: "304" })
      .expect(409);
    expect(incomplete.body.code).toBe("BLING_HISTORY_REQUIRED");
    expect(calls).toEqual([]);
    const [state] = await schema.db.select().from(schema.blingConnectionsTable);
    expect(state.error).toBeNull();
    expect(state.leaseId).toBeNull();
  });

  it("recovers one missing order by number without moving the bulk watermark or reloading other resources", async () => {
    await connect();
    await sync.runBlingBatch("jini");
    const [before] = await schema.db
      .select()
      .from(schema.blingConnectionsTable);
    calls.length = 0;
    stubOrderLookup();
    const result = await request(app)
      .post("/clients/jini/bling/orders/refresh")
      .set(admin)
      .send({ orderNumber: "304" })
      .expect(200);
    expect(result.body).toMatchObject({ complete: true, imported: 1 });
    expect(calls).toHaveLength(2);
    expect(calls.every((path) => path.startsWith("/pedidos/vendas"))).toBe(
      true,
    );
    expect(
      new URL(`https://provider.example${calls[0]}`).searchParams.get("numero"),
    ).toBe("304");
    const [after] = await schema.db.select().from(schema.blingConnectionsTable);
    expect(after.watermark).toBe(before.watermark);
    expect(after.completedAt).toEqual(before.completedAt);
    expect(after.cursor).toBeNull();
    const saved = await schema.db.select().from(schema.blingRecordsTable);
    expect(saved.filter((row) => row.kind === "orders")).toHaveLength(4);
    expect(saved.filter((row) => row.kind === "products")).toHaveLength(1);
    expect(saved.filter((row) => row.kind === "customers")).toHaveLength(1);
    stubOrderLookup({ found: false });
    await request(app)
      .post("/clients/jini/bling/orders/refresh")
      .set(admin)
      .send({ orderNumber: "304" })
      .expect(404);
    stubOrderLookup({ ambiguous: true });
    await request(app)
      .post("/clients/jini/bling/orders/refresh")
      .set(admin)
      .send({ orderNumber: "304" })
      .expect(409);
    const [unchanged] = await schema.db
      .select()
      .from(schema.blingConnectionsTable);
    expect(unchanged.error).toBeNull();
    expect(unchanged.completedAt).toEqual(before.completedAt);
  });

  it("rejects an individual order outside the window and preserves an active cursor", async () => {
    await connect();
    await sync.runBlingBatch("jini");
    stubOrderLookup({ outsideWindow: true });
    const outside = await request(app)
      .post("/clients/jini/bling/orders/refresh")
      .set(admin)
      .send({ orderNumber: "304" })
      .expect(409);
    expect(outside.body.code).toBe("BLING_ORDER_OUTSIDE_WINDOW");
    let [state] = await schema.db.select().from(schema.blingConnectionsTable);
    expect(state.error).toBeNull();
    expect(state.cursor).toBeNull();
    limitedPath = "/pedidos/vendas/304";
    const quota = await request(app)
      .post("/clients/jini/bling/orders/refresh")
      .set(admin)
      .send({ orderNumber: "304" })
      .expect(429);
    expect(quota.body.rateLimitPeriod).toBe("second");
    [state] = await schema.db.select().from(schema.blingConnectionsTable);
    expect(state.nextRequestAt!.getTime()).toBeGreaterThan(Date.now());
    limitedPath = null;
    await schema.db
      .update(schema.blingConnectionsTable)
      .set({ error: null, nextRequestAt: new Date(0) })
      .where(eq(schema.blingConnectionsTable.clientId, "jini"));
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
    calls.length = 0;
    const busy = await request(app)
      .post("/clients/jini/bling/orders/refresh")
      .set(admin)
      .send({ orderNumber: "304" })
      .expect(409);
    expect(busy.body.code).toBe("BLING_BUSY");
    expect(calls).toEqual([]);
    [state] = await schema.db.select().from(schema.blingConnectionsTable);
    expect(state.cursor).toEqual(cursor);
    expect(state.error).toBeNull();
    const saved = await schema.db.select().from(schema.blingRecordsTable);
    expect(saved.filter((row) => row.kind === "orders")).toHaveLength(3);
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
