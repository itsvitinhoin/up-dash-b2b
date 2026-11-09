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
import { sampleOrder } from "./fixtures/braavo";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "203.0.113.20" }]),
}));
vi.mock("../src/lib/auth", () => ({
  verifyAccessToken: (token: string) => {
    if (token === "test-admin") return { role: "ADMIN", sub: "test-admin" };
    if (token === "test-client")
      return { role: "CLIENT", sub: "test-user", clientId: "shop-a" };
    throw new Error("Invalid token");
  },
  hashPassword: vi.fn(),
}));

// Keep real HTTP-contract handling and SQL reservations, but do not spend wall
// time waiting for synthetic API responses. Slot spacing/cooldowns are checked
// independently below against the real database.
vi.mock("../src/services/braavo-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/braavo-api")>();
  return {
    ...actual,
    BraavoApi: class extends actual.BraavoApi {
      constructor(...[credentials, options]: ConstructorParameters<typeof actual.BraavoApi>) {
        super(credentials, { ...options, sleep: async () => {}, deadline: Infinity });
      }
    },
  };
});

const connection = process.env.BRAAVO_TEST_DATABASE_URL;
let schema: typeof import("@workspace/db");
let sync: typeof import("../src/services/braavo-sync");
let app: express.Express;
let order: Record<string, unknown>;
let customers: Record<string, unknown>[];
let businessError = false;
let productIds = [100];
let failedProductId: number | null = null;
let fillerItems = 0;
let untouchedSku = false;
let stock = 5;
const calls: {
  path: string;
  body: Record<string, unknown>;
  authorization: string;
}[] = [];
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

describe.skipIf(!connection)("Braavo with isolated PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(connection!);
    if (
      url.pathname !== "/braavo_integration_test" ||
      !["localhost", "127.0.0.1"].includes(url.hostname)
    )
      throw new Error(
        "Braavo integration tests require an isolated local braavo_integration_test database.",
      );
    process.env.DATABASE_URL = connection;
    delete process.env.CLOUD_SQL_CONNECTION_NAME;
    process.env.CRON_SECRET = "braavo-test-cron";
    schema = await import("@workspace/db");
    sync = await import("../src/services/braavo-sync");
    const clients = await import("../src/routes/clients");
    const braavo = await import("../src/routes/braavo");
    const extractions = await import("../src/routes/extractions");
    app = express()
      .use(express.json())
      .use(clients.default)
      .use(braavo.braavoRouter)
      .use(extractions.default);
  });
  beforeEach(async () => {
    calls.length = 0;
    businessError = false;
    productIds = [100];
    failedProductId = null;
    fillerItems = 0;
    untouchedSku = false;
    stock = 5;
    order = {
      ...structuredClone(sampleOrder),
      data_alterado: `${today()} 10:00:00`,
    };
    customers = [
      {
        id: 12,
        nome: "Ana",
        email: "ana@example.invalid",
        pessoa: "1",
        cpf: "11122233344",
        data_criado: "2026-01-01 10:00:00",
        data_alterado: `${today()} 10:00:00`,
      },
    ];
    await schema.db.execute(
      sql`TRUNCATE clients, braavo_request_slots CASCADE`,
    );
    await schema.db
      .insert(schema.usersTable)
      .values({
        id: "test-admin",
        email: "admin@example.invalid",
        passwordHash: "unused",
        firstName: "Test",
        lastName: "Admin",
        role: "ADMIN",
      })
      .onConflictDoNothing();
    await schema.db.insert(schema.clientsTable).values({
      id: "shop-a",
      name: "Loja Braavo de teste",
      email: "shop@example.invalid",
      apiKey: "internal-test-key",
      dashboardType: "B2C",
      commercePlatform: "BRAAVO",
      braavoDomain: "https://www.lacleo.com.br",
      braavoApiToken: "test-token",
      braavoApiKey: "test-key",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options: RequestInit) => {
        const path = new URL(url).pathname;
        const body = JSON.parse(String(options.body)) as Record<
          string,
          unknown
        >;
        calls.push({
          path,
          body,
          authorization:
            new Headers(options.headers).get("authorization") ?? "",
        });
        if (businessError) return Response.json({ erro: "invalid credential" });
        const product = {
          id: 100,
          nome: "Vestido",
          categoria_id: 1,
          ativo: "1",
          fotos: [{ foto_1: "https://images.example.invalid/100.webp" }],
        };
        if (path === "/api/clientes/buscar/id")
          return Response.json({
            ok: customers
              .filter((c) => c.id === body.id)
              .map((c) => ({
                ...c,
                enderecos: [{ ativo: "1", cidade: "São Paulo", estado: "SP" }],
              })),
          });
        if (path === "/api/produtos/buscar/id") {
          if (body.id === failedProductId)
            return Response.json({ erro: { mensagem: "Falha temporária" } });
          return Response.json({ ok: [{ ...product, id: body.id }] });
        }
        if (path === "/api/pedidos/buscar/id") {
          expect(body).toEqual({
            id: 7,
            gravar_status_erp: 0,
            gravar_separando: 0,
          });
          return Response.json({ ok: [order] });
        }
        const sources: Record<string, Record<string, unknown>[]> = {
          categorias: [{ id: 1, nome: "Vestidos" }],
          variacoes: [
            { id: 10, nome: "Cor", pai_id: 0 },
            { id: 11, nome: "Preto", pai_id: 10 },
            { id: 20, nome: "Tamanho", pai_id: 0 },
            { id: 22, nome: "M", pai_id: 20 },
          ],
          produtos: productIds.map((id) => ({ ...product, id })),
          skus: [
            ...(untouchedSku
              ? [{ id: 502, produto_id: 100, ref: "REF-G", ativo: "1", estoque: 3, preco_venda: 50, preco_custo: 20, var1_id: 11, var2_id: 22, data_alterado: "2020-01-01 10:00:00" }]
              : []),
            {
              id: 501,
              produto_id: 100,
              ref: "REF-M",
              ativo: "1",
              estoque: stock,
              preco_venda: 50,
              preco_custo: 20,
              var1_id: 11,
              var2_id: 22,
            },
          ],
          clientes: customers,
          pedidos: [order],
          // Itens em lote: os mesmos itens que o detalhe do pedido traz, sem os calculado_*.
          pedidos_produtos: (
            (order.produtos as Record<string, unknown>[] | undefined) ?? []
          )
            .map(({ calculado_preco_total: _t, calculado_preco_venda: _v, ...item }) => ({
              ...item,
              pedido_id: order.id,
            }))
            // Itens de outros pedidos, só para ocupar várias páginas de 100.
            .concat(
              Array.from({ length: fillerItems }, (_, i) => ({
                id: 9000 + i,
                pedido_id: 999,
                produto_id: 100,
                sku_id: 501,
                quantidade: 1,
                total: 10,
              })) as never,
            ),
        };
        const source = sources[path.split("/")[2]];
        if (!source) throw new Error(`Unexpected external request: ${path}`);
        const rows = source.filter(
          (row) =>
            !body.data_alterado ||
            !row.data_alterado ||
            String(row.data_alterado).startsWith(String(body.data_alterado)),
        );
        const limit = Number(body.limite),
          page = Number(body.atual);
        // Como a Braavo real: listagem sem resultado é "erro" com HTTP 200, não lista vazia.
        if (rows.length === 0)
          return Response.json({ erro: { mensagem: "Nenhum registro encontrado." } });
        return Response.json({
          ok: rows.slice((page - 1) * limit, page * limit),
          pag: {
            atual: page,
            paginas: Math.ceil(rows.length / limit),
            encontrados: rows.length,
          },
        });
      }),
    );
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    if (schema) await schema.pool.end();
  });

  async function cycle(clientId = "shop-a") {
    for (let i = 0; i < 40; i++) {
      const result = await sync.runBraavoBatch(clientId, "manual");
      if (result.status === "failed") throw new Error(result.message);
      if (result.complete) return;
      expect(result.status).toBe("pending");
    }
    throw new Error(
      "Braavo cycle did not complete within the expected test batches.",
    );
  }
  async function snapshot() {
    return {
      orders: await schema.db.select().from(schema.ordersTable),
      items: await schema.db.select().from(schema.orderItemsTable),
      customers: await schema.db.select().from(schema.customersTable),
      products: await schema.db.select().from(schema.productsTable),
      events: await schema.db.select().from(schema.eventsTable),
    };
  }

  it("full load takes the order items in bulk, never asks the detail of each order, and clears the copy", async () => {
    await cycle();
    expect(calls.filter((c) => c.path === "/api/pedidos/buscar/id")).toHaveLength(0);
    const bulk = calls.filter((c) => c.path === "/api/pedidos_produtos/buscar/todos");
    expect(bulk.length).toBeGreaterThan(0);
    expect(bulk[0].body.limite).toBe(100);
    const first = await snapshot();
    expect(first.orders).toHaveLength(1);
    expect(first.items).toHaveLength(1);
    // O valor do item vem do cálculo de reserva (total - vale): 100 - 10 = 90 por 2 unidades.
    expect(Number(first.items[0].priceAtSale)).toBe(45);
    const staged = await schema.db.execute(sql`SELECT count(*)::int AS n FROM braavo_catalog WHERE kind = 'order_items'`);
    expect(Number((staged.rows[0] as { n: number }).n)).toBe(0);
  });

  it("copies several pages of order items in one cycle and still ends with a clean catalog", async () => {
    fillerItems = 250; // 251 itens = 3 páginas de 100
    let itemsCallsInFirstItemsBatch: number | null = null;
    for (let i = 0; i < 40; i++) {
      calls.length = 0;
      const r = await sync.runBraavoBatch("shop-a", "manual");
      if (r.status === "failed") throw new Error(r.message);
      const n = calls.filter((c) => c.path === "/api/pedidos_produtos/buscar/todos").length;
      if (n > 0 && itemsCallsInFirstItemsBatch === null) itemsCallsInFirstItemsBatch = n;
      if (r.complete) break;
    }
    // As 3 páginas foram lidas no MESMO ciclo, não uma por ciclo.
    expect(itemsCallsInFirstItemsBatch).toBe(3);
    const snap = await snapshot();
    expect(snap.items).toHaveLength(1);
    const staged = await schema.db.execute(sql`SELECT count(*)::int AS n FROM braavo_catalog WHERE kind = 'order_items'`);
    expect(Number((staged.rows[0] as { n: number }).n)).toBe(0);
  });

  it("imports the full cycle and reimports without duplicating orders, items or purchases", async () => {
    await cycle();
    const first = await snapshot();
    expect(first.orders).toHaveLength(1);
    expect(first.items).toHaveLength(1);
    expect(first.events).toHaveLength(1);
    expect(first.orders[0]).toMatchObject({
      amount: 100,
      fulfilledAmount: 100,
      utmSource: "google",
      utmCampaign: "verao",
    });
    expect(first.products[0]).toMatchObject({
      stock: 5,
      category: "Vestidos",
      name: "Vestido (Preto, M)",
      totalSold: 2,
      totalRevenue: 90,
    });
    expect(first.customers[0]).toMatchObject({
      state: "SP",
      city: "São Paulo",
      totalOrders: 1,
      totalSpent: 100,
      createdAt: new Date("2026-01-01T13:00:00Z"),
    });
    await request(app)
      .patch("/clients/shop-a")
      .set("Authorization", "Bearer test-admin")
      .send({ braavoDomain: "https://another-shop.example.com" })
      .expect(409);
    await cycle();
    const second = await snapshot();
    expect(second.orders.map((row) => row.id)).toEqual(
      first.orders.map((row) => row.id),
    );
    expect(second.items).toHaveLength(1);
    expect(second.events).toHaveLength(1);
    expect(second.customers).toHaveLength(1);
    const [state] = await schema.db.select().from(schema.braavoSyncStatesTable);
    expect(state.cursor?.phase).toBe("done");
    expect(state.completedAt).toBeInstanceOf(Date);
    expect(
      calls.every(
        (call) =>
          call.authorization ===
          `Basic ${Buffer.from("test-token:test-key").toString("base64")}`,
      ),
    ).toBe(true);
  }, 30000);

  it("updates an old pending order after payment, and resets aggregates on cancellation", async () => {
    order.status_pagamento = "1";
    order.data_aprovado = "";
    await cycle();
    expect((await snapshot()).events).toHaveLength(0);
    order.status_pagamento = "3";
    order.data_aprovado = `${today()} 12:00:00`;
    await cycle();
    expect((await snapshot()).customers[0]).toMatchObject({
      totalOrders: 1,
      totalSpent: 100,
    });
    order.status_pagamento = "6";
    stock = 0;
    await cycle();
    const data = await snapshot();
    expect(data.orders[0]).toMatchObject({
      status: "REJECTED",
      fulfilledAmount: 0,
      cancelledAmount: 100,
    });
    expect(data.events).toHaveLength(0);
    expect(data.customers[0]).toMatchObject({
      totalOrders: 0,
      totalSpent: 0,
      firstPurchaseAt: null,
      lastPurchaseAt: null,
    });
    expect(data.products[0]).toMatchObject({
      stock: 0,
      totalSold: 0,
      totalRevenue: 0,
    });
    const day = await schema.db
      .select()
      .from(schema.dailyClientMetricsTable)
      .where(eq(schema.dailyClientMetricsTable.metricDate, "2026-01-10"));
    expect(day[0].approvedRevenue).toBe(0);
  }, 30000);

  it("preserves negative inventory and continues through customers and orders", async () => {
    stock = -1;
    await cycle();
    const data = await snapshot();
    expect(data.products).toHaveLength(1);
    expect(data.products[0].stock).toBe(-1);
    expect(data.customers).toHaveLength(1);
    expect(data.orders).toHaveLength(1);
    expect(data.items[0].quantity).toBe(2);
  });

  it("resumes a partial page at the failed record without refetching saved details", async () => {
    productIds = [100, 101, 102];
    failedProductId = 102;
    const client = await sync.getBraavoClient("shop-a");
    await schema.db.insert(schema.braavoSyncStatesTable).values({
      clientId: "shop-a",
      fingerprint: sync.braavoFingerprint(sync.braavoCredentials(client)),
      cursor: { ...sync.initialBraavoCursor(new Date()), phase: "products" },
    });
    expect((await sync.runBraavoBatch("shop-a", "manual")).status).toBe("failed");
    const [partial] = await schema.db.select().from(schema.braavoSyncStatesTable);
    expect(partial.cursor).toMatchObject({ phase: "products", page: 1, processedIds: ["100", "101"] });
    const saved = await schema.db.select().from(schema.braavoCatalogTable);
    expect(saved).toHaveLength(2);
    failedProductId = null;
    calls.length = 0;
    const resumed = await sync.runBraavoBatch("shop-a", "cron");
    expect(resumed).toMatchObject({ status: "pending", phase: "skus", page: 1, processed: 1 });
    expect(calls.filter((c) => c.path === "/api/produtos/buscar/id").map((c) => c.body.id)).toEqual([102]);
    expect(await schema.db.select().from(schema.braavoCatalogTable)).toHaveLength(3);
    const [advanced] = await schema.db.select().from(schema.braavoSyncStatesTable);
    expect(advanced.cursor?.processedIds).toBeUndefined();
  });

  it("keeps the checkpoint after an HTTP 200 business error and resumes successfully", async () => {
    businessError = true;
    const failed = await sync.runBraavoBatch("shop-a", "manual");
    expect(failed.status).toBe("failed");
    const [state] = await schema.db.select().from(schema.braavoSyncStatesTable);
    expect(state.cursor).toMatchObject({ phase: "categories", page: 1 });
    expect(state.leaseId).toBeNull();
    businessError = false;
    await cycle();
    expect((await snapshot()).orders).toHaveLength(1);
  }, 15000);

  it("quarantines an invalid order, finishes the cycle and heals when the shop fixes it", async () => {
    order.status_pagamento = "99";
    await cycle();
    let data = await snapshot();
    expect(data.orders).toHaveLength(0);
    const [issue] = await schema.db.select().from(schema.braavoRecordIssuesTable);
    expect(issue).toMatchObject({ clientId: "shop-a", phase: "orders", externalId: "7", attempts: 1 });
    expect(issue.reason).toContain("pagamento");
    const status = await sync.getBraavoSyncStatus("shop-a");
    expect(status.skippedRecords.total).toBe(1);
    expect(status.skippedRecords.recent[0]).toMatchObject({ phase: "orders", externalId: "7" });
    expect(status.cursor).toMatchObject({ phase: "done", skipped: 1 });
    // The shop corrects the order: the next cycle imports it and clears the issue.
    order.status_pagamento = "3";
    await cycle();
    data = await snapshot();
    expect(data.orders).toHaveLength(1);
    expect(await schema.db.select().from(schema.braavoRecordIssuesTable)).toHaveLength(0);
    expect((await sync.getBraavoSyncStatus("shop-a")).skippedRecords.total).toBe(0);
  }, 30000);

  it("still stops on infrastructure errors and past the invalid-record ceiling", async () => {
    // Network/credential errors are never quarantined (covered above by the HTTP 200 test).
    // Past the ceiling the cause is a changed format, not dirty data: fail with the checkpoint kept.
    await sync.runBraavoBatch("shop-a", "manual");
    await schema.db
      .update(schema.braavoSyncStatesTable)
      .set({
        cursor: sql`jsonb_set(cursor, '{skipped}', to_jsonb(${sync.MAX_SKIPPED_PER_CYCLE}::int))`,
      });
    order.status_pagamento = "99";
    let failed;
    for (let i = 0; i < 40 && !failed; i++) {
      const result = await sync.runBraavoBatch("shop-a", "manual");
      if (result.status === "failed") failed = result;
      else if (result.complete) break;
    }
    expect(failed).toMatchObject({ status: "failed", code: "BRAAVO_TOO_MANY_INVALID" });
    const [state] = await schema.db.select().from(schema.braavoSyncStatesTable);
    expect(state.cursor).toMatchObject({ phase: "orders" });
    expect(state.leaseId).toBeNull();
  }, 40000);

  it("rolls back the order and its items if an item cannot be persisted", async () => {
    await cycle();
    const before = await snapshot();
    await schema.db.insert(schema.productsTable).values({
      clientId: "shop-a",
      externalId: "other-source",
      sku: "braavo-archive-999",
      name: "Collision fixture",
      price: 1,
    });
    order.produtos = [{ ...sampleOrder.produtos[0], sku_id: 999 }];
    let failed = false;
    for (let i = 0; i < 20; i++) {
      const result = await sync.runBraavoBatch("shop-a", "manual");
      if (result.status === "failed") {
        failed = true;
        break;
      }
    }
    expect(failed).toBe(true);
    const after = await snapshot();
    expect(after.items).toEqual(before.items);
    expect(after.orders[0]).toEqual(before.orders[0]);
    expect(after.events).toEqual(before.events);
  }, 25000);

  it("enforces the lease and shares request slots by shop across concurrent calls", async () => {
    await sync.runBraavoBatch("shop-a", "manual");
    await schema.db
      .update(schema.braavoSyncStatesTable)
      .set({ leaseId: "other", leaseUntil: new Date(Date.now() + 60000) });
    expect((await sync.runBraavoBatch("shop-a", "cron")).status).toBe("busy");
    const { runBraavoTransactionalExtraction } = await import("../src/services/extraction-runner");
    expect(await runBraavoTransactionalExtraction("cron", { clientId: "shop-a" }))
      .toMatchObject({ clients: 1, pending: 1, nextOffset: 0 });
    const slots = await Promise.all(
      Array.from({ length: 4 }, () =>
        sync.reserveBraavoSlot("https://another-shop.example.com"),
      ),
    );
    slots.sort((a, b) => a - b);
    expect(slots[1] - slots[0]).toBeGreaterThanOrEqual(999);
    expect(slots[3] - slots[0]).toBeGreaterThanOrEqual(2999);
    await request(app)
      .patch("/clients/shop-a")
      .set("Authorization", "Bearer test-admin")
      .send({ braavoApiKey: "replacement" })
      .expect(409);
  });

  it("filters the Cloud Run extraction to CLIENT_ID", async () => {
    const { runBraavoTransactionalExtraction } = await import("../src/services/extraction-runner");
    expect(await runBraavoTransactionalExtraction("cron", { clientId: "another-client" }))
      .toMatchObject({ clients: 0, failed: 0 });
    expect(calls).toHaveLength(0);
  });

  it("holds the next batch for five seconds without shortening queued shop requests", async () => {
    const domain = "https://cooldown-shop.example.com";
    await sync.deferBraavoBatch(domain);
    expect(await sync.reserveBraavoSlot(domain) - Date.now()).toBeGreaterThan(4500);
    const queuedUntil = Date.now() + 30000;
    await schema.db.update(schema.braavoRequestSlotsTable)
      .set({ nextAt: new Date(queuedUntil) })
      .where(eq(schema.braavoRequestSlotsTable.domain, domain));
    await sync.deferBraavoBatch(domain);
    expect(await sync.reserveBraavoSlot(domain)).toBeGreaterThanOrEqual(queuedUntil);
    // Finishing even a failed batch sets the same shared cooldown before release.
    businessError = true;
    await sync.runBraavoBatch("shop-a", "cron");
    expect(await sync.reserveBraavoSlot("https://www.lacleo.com.br") - Date.now()).toBeGreaterThan(4500);
    const [state] = await schema.db.select().from(schema.braavoSyncStatesTable);
    expect(state.leaseId).toBeNull();
  });

  it("isolates shops with the same external customer, SKU and order IDs", async () => {
    await schema.db.insert(schema.clientsTable).values({
      id: "shop-b",
      name: "Second test shop",
      email: "shop-b@example.invalid",
      apiKey: "second-key",
      dashboardType: "B2C",
      commercePlatform: "BRAAVO",
      braavoDomain: "https://www.lacleo.com.br",
      braavoApiToken: "test-token",
      braavoApiKey: "test-key",
    });
    await cycle();
    await cycle("shop-b");
    const data = await snapshot();
    expect(data.orders).toHaveLength(2);
    expect(data.customers).toHaveLength(2);
    expect(data.products).toHaveLength(2);
    expect(data.events).toHaveLength(2);
    expect(new Set(data.orders.map((row) => row.clientId)).size).toBe(2);
  }, 20000);

  it("updates customer emails by external identity and refuses merging distinct people", async () => {
    await cycle();
    const first = (await snapshot()).customers[0];
    customers[0].email = "changed@example.invalid";
    await cycle();
    const changed = (await snapshot()).customers;
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({
      id: first.id,
      email: "changed@example.invalid",
    });
    customers.push({ ...customers[0], id: 13 });
    // O conflito é de dado de UM cliente: o ciclo termina, as contas não se fundem e o
    // caso fica registrado para revisão (antes derrubava a sincronização da loja toda).
    await cycle();
    expect((await snapshot()).customers).toHaveLength(1);
    const status = await sync.getBraavoSyncStatus("shop-a");
    expect(status.skippedRecords.total).toBe(1);
    expect(status.skippedRecords.recent[0]).toMatchObject({ phase: "customers", externalId: "13" });
    expect(status.skippedRecords.recent[0].reason).toContain("Conflito de e-mail");
  }, 30000);

  it("incremental cycle reads only SKUs changed in the window and keeps the untouched ones active", async () => {
    untouchedSku = true; // SKU 502 só aparece no catálogo completo (data_alterado de 2020)
    await cycle(); // carga completa: vê os dois SKUs
    let skus = await schema.db.select().from(schema.productsTable);
    expect(skus.filter((p) => p.status === "ACTIVE")).toHaveLength(2);
    calls.length = 0;
    await cycle(); // incremental
    const skuCalls = calls.filter((c) => c.path === "/api/skus/buscar/todos");
    expect(skuCalls.length).toBeGreaterThan(0);
    expect(skuCalls.every((c) => typeof c.body.data_alterado === "string")).toBe(true);
    skus = await schema.db.select().from(schema.productsTable);
    // O SKU que não mudou continua ativo e com estoque (não é "visto" no incremental).
    expect(skus.filter((p) => p.status === "ACTIVE")).toHaveLength(2);
    expect(skus.find((p) => p.sku === "REF-G")?.stock).toBe(3);
  }, 40000);

  it("finishes a cycle when a listing comes back empty, as the real Braavo answers it", async () => {
    productIds = []; // /produtos/buscar/todos -> erro "Nenhum registro encontrado." com HTTP 200
    await cycle();
    const state = await sync.getBraavoSyncStatus("shop-a");
    expect(state.error).toBeNull();
    expect(state.cursor?.phase).toBe("done");
  }, 30000);

  it("keeps an old order whose account is gone and whose email now belongs to another customer", async () => {
    // Conta 99 não está na lista de clientes e usa o e-mail que hoje é do cliente 12.
    order = { ...order, usuario_id: 99, usuario_email: "ana@example.invalid", usuario_nome: "Ana (conta antiga)" };
    await cycle();
    const snap = await snapshot();
    expect(snap.orders).toHaveLength(1);
    expect(snap.customers).toHaveLength(2);
    const emails = snap.customers.map((c) => c.email).sort();
    expect(emails).toEqual(["ana@example.invalid", "braavo-99@unknown.local"]);
  }, 30000);

  it("resumes from the cycle observation day when the previous import spanned several days", async () => {
    const fingerprint = sync.braavoFingerprint({
      domain: "https://www.lacleo.com.br",
      apiToken: "test-token",
      apiKey: "test-key",
    });
    const observed = new Date(Date.now() - 5 * 86400000);
    const cursor = {
      ...sync.initialBraavoCursor(observed),
      phase: "done" as const,
    };
    await schema.db.insert(schema.braavoSyncStatesTable).values({
      clientId: "shop-a",
      fingerprint,
      cursor,
      completedAt: new Date(),
      fullCompletedAt: new Date(),
    });
    const result = await sync.runBraavoBatch("shop-a", "manual");
    expect(result.status).toBe("pending");
    const [state] = await schema.db.select().from(schema.braavoSyncStatesTable);
    expect(state.cursor?.full).toBe(false);
    const expected = new Date(observed.getTime() - 86400000);
    expect(state.cursor?.fromDay).toBe(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(expected),
    );
  });

  it("allows configuring keys later, never returns them, and restricts connection actions to admins", async () => {
    const create = await request(app)
      .post("/clients")
      .set("Authorization", "Bearer test-admin")
      .send({
        name: "La Cleo cadastro teste",
        email: "new@example.invalid",
        apiKey: "new-internal-key",
        dashboardType: "B2C",
        commercePlatform: "BRAAVO",
        braavoDomain: "http://lacleo.com.br/",
      })
      .expect(201);
    expect(create.body).toMatchObject({
      dashboardType: "B2C",
      commercePlatform: "BRAAVO",
      braavoDomain: "https://www.lacleo.com.br",
      hasBraavoIntegration: false,
    });
    const id = create.body.id;
    const duplicate = await request(app)
      .post("/clients")
      .set("Authorization", "Bearer test-admin")
      .send({
        name: "La Cleo cadastro teste",
        email: "duplicate@example.invalid",
        apiKey: "duplicate-key",
        commercePlatform: "BRAAVO",
        braavoApiToken: "should-not-leak-token",
        braavoApiKey: "should-not-leak-key",
      })
      .expect(409);
    expect(JSON.stringify(duplicate.body)).not.toContain("should-not-leak");

    await request(app)
      .patch(`/clients/${id}`)
      .set("Authorization", "Bearer test-admin")
      .send({ braavoApiToken: "test-token", braavoApiKey: "test-key" })
      .expect(200)
      .then((res) => {
        expect(res.body.hasBraavoIntegration).toBe(true);
        expect(JSON.stringify(res.body)).not.toContain("test-token");
        expect(JSON.stringify(res.body)).not.toContain("test-key");
      });
    await request(app)
      .patch(`/clients/${id}`)
      .set("Authorization", "Bearer test-admin")
      .send({ dashboardType: "B2C" })
      .expect(200)
      .then((res) => expect(res.body.commercePlatform).toBe("BRAAVO"));
    await request(app)
      .post(`/clients/${id}/braavo/test`)
      .set("Authorization", "Bearer test-admin")
      .expect(200);
    await request(app).post(`/clients/${id}/braavo/sync`).expect(401);
    await request(app)
      .post(`/clients/${id}/braavo/sync`)
      .set("Authorization", "Bearer test-client")
      .expect(403);
    await request(app)
      .get(`/clients/${id}/braavo`)
      .set("Authorization", "Bearer test-client")
      .expect(403);
    await request(app)
      .post("/clients")
      .set("Authorization", "Bearer test-admin")
      .send({
        name: "Wrong B2B",
        email: "wrong@example.invalid",
        apiKey: "wrong-key",
        dashboardType: "B2B",
        commercePlatform: "BRAAVO",
      })
      .expect(400);
    await request(app).get("/cron/extractions/braavo").expect(401);
  });
});
