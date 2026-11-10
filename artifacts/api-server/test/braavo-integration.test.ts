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

vi.mock("../src/services/cloud-run-jobs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/cloud-run-jobs")>();
  return { ...actual, runBraavoBackfillJob: vi.fn(async () => ({ execution: "projects/p/locations/l/jobs/j/executions/exec-1" })) };
});

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
          // Endereços em lote (mesmos campos que o detalhe do cliente traz em `enderecos`).
          enderecos: customers.flatMap((c) =>
            [{ id: Number(c.id) * 10, usuario_id: c.id, ativo: "0", cidade: "Campinas", estado: "SP" },
             { id: Number(c.id) * 10 + 1, usuario_id: c.id, ativo: "1", cidade: "São Paulo", estado: "SP" }]),
          pedidos: [order],
          // Itens em lote: os mesmos itens que o detalhe do pedido traz, sem os calculado_*.
          pedidos_produtos: (
            (order.produtos as Record<string, unknown>[] | undefined) ?? []
          )
            .map(({ calculado_preco_total: _t, calculado_preco_venda: _v, ...item }) => ({
              ...item,
              pedido_id: order.id,
              data_criado: order.data_criado,
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
            (!body.data_alterado ||
              !row.data_alterado ||
              String(row.data_alterado).startsWith(String(body.data_alterado))) &&
            (!body.data_criado ||
              !row.data_criado ||
              String(row.data_criado).startsWith(String(body.data_criado))),
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

  it("incremental cycle reads changed orders in bulk, never asks each order's detail, and clears the copy", async () => {
    await cycle(); // carga completa
    const day = String(order.data_criado).slice(0, 10);
    order = { ...order, status_pagamento: "6", data_alterado: `${today()} 11:00:00` }; // pago -> cancelado hoje
    calls.length = 0;
    await cycle(); // incremental
    expect(calls.filter((c) => c.path === "/api/pedidos/buscar/id")).toHaveLength(0);
    const byCreation = calls.filter((c) => c.path === "/api/pedidos_produtos/buscar/todos");
    expect(byCreation.length).toBeGreaterThan(0);
    expect(byCreation.every((c) => c.body.data_criado === day && c.body.limite === 100)).toBe(true);
    const snap = await snapshot();
    expect(snap.orders[0]).toMatchObject({ status: "REJECTED" });
    expect(snap.items).toHaveLength(1); // itens refeitos a partir do lote
    // Cancelado: os totais do cliente e do produto voltam a zero (recalculados no incremental).
    expect(snap.customers[0]).toMatchObject({ totalOrders: 0, totalSpent: 0 });
    const staged = await schema.db.execute(sql`SELECT count(*)::int AS n FROM braavo_catalog WHERE kind IN ('order_items','order_items_day')`);
    expect(Number((staged.rows[0] as { n: number }).n)).toBe(0);
  }, 40000);

  it("incremental bulk write equals one-by-one, including a second pass that changes orders", async () => {
    for (const id of ["shop-i1", "shop-i2"]) {
      await schema.db.insert(schema.clientsTable).values({
        id, name: id, email: id + "@example.invalid", apiKey: "k-" + id, dashboardType: "B2C",
        commercePlatform: "BRAAVO", braavoDomain: `https://www.${id}.com.br`, braavoApiToken: "t", braavoApiKey: "k",
      });
      await schema.db.insert(schema.braavoSyncStatesTable).values({
        clientId: id, fingerprint: "fp-" + id, leaseId: "lease-" + id, leaseUntil: new Date(Date.now() + 600000),
      });
      await schema.db.insert(schema.customersTable).values({
        clientId: id, externalId: "braavo:12", email: "ana@example.invalid", name: "Ana", state: "SP", city: "São Paulo",
      });
      await schema.db.insert(schema.productsTable).values({
        clientId: id, externalId: "braavo:100:501", sku: "REF-M", name: "Vestido", price: 50, status: "ACTIVE",
      });
    }
    const cache = new Map<string, Record<string, unknown>>();
    const mk = (id: number, over: Record<string, unknown>, items?: Record<string, unknown>[]) => ({
      ...structuredClone(sampleOrder), id, data_alterado: "2026-01-10 10:00:00", ...over,
      produtos: (items ?? sampleOrder.produtos).map((it, i) => ({ ...it, id: id * 10 + i })),
    });
    const antigo = { ...sampleOrder.produtos[0], produto_id: 555, sku_id: 556, nome: "Produto antigo", quantidade: 1, preco_venda: 20, total: 20, desconto_vale_total: 0, calculado_preco_total: 20 };
    const first = [
      mk(201, {}),
      mk(202, { data_criado: "2026-02-03 10:00:00", data_aprovado: "2026-02-04 09:00:00" }),
      mk(203, { usuario_id: 77, usuario_email: "novo@example.invalid", usuario_nome: "Novo", data_criado: "2026-03-01 10:00:00", data_aprovado: "2026-03-01 11:00:00" }),
      mk(204, { status_pagamento: "1", data_aprovado: null }),
      mk(205, { status_entrega: "21" }),
      mk(206, {}, [antigo, sampleOrder.produtos[0]]),
    ];
    // Segunda passada: o que acontece num ciclo incremental com pedidos que já existem.
    const second = [
      mk(201, { status_pagamento: "6" }),                                   // pago -> cancelado
      mk(204, { status_pagamento: "3", data_aprovado: "2026-04-05 10:00:00" }), // pendente -> pago, noutro dia
      mk(205, { status_entrega: "23" }),                                    // enviado -> entregue
      mk(206, {}, [sampleOrder.produtos[0]]),                               // um item saiu (produto antigo deixa de contar)
      mk(207, { usuario_id: 12, data_criado: "2026-04-06 08:00:00", data_aprovado: "2026-04-06 09:00:00" }), // novo pedido
    ];
    const counterA = { skipped: 0 };
    for (const pass of [first, second]) {
      await sync.persistOrdersBulk("shop-i1", "lease-shop-i1", pass as never, cache as never, counterA, { refreshAggregates: true });
      for (const line of pass) await sync.persistOrder("shop-i2", "lease-shop-i2", line as never, cache as never, false);
    }
    expect(counterA.skipped).toBe(0);
    const dump = async (cid: string) => ({
      orders: (await schema.db.execute(sql`SELECT external_id, status, amount, fulfilled_amount, gross_amount, discount_amount, shipping_amount, cancelled_amount, requested_quantity, fulfilled_quantity, state, city, approval_date, created_at FROM orders WHERE client_id = ${cid} ORDER BY external_id`)).rows,
      items: (await schema.db.execute(sql`SELECT o.external_id AS pedido, p.external_id AS produto, oi.quantity, oi.fulfilled_quantity, oi.price_at_sale, oi.gross_price_at_sale, oi.discount_amount, oi.size, oi.color FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id WHERE o.client_id = ${cid} ORDER BY o.external_id, p.external_id, oi.quantity`)).rows,
      customers: (await schema.db.execute(sql`SELECT external_id, email, name, total_orders, total_spent, first_purchase_at, last_purchase_at FROM customers WHERE client_id = ${cid} ORDER BY external_id`)).rows,
      events: (await schema.db.execute(sql`SELECT e.external_source_id, e.created_at, c.external_id AS cliente FROM events e LEFT JOIN customers c ON c.id = e.customer_id WHERE e.client_id = ${cid} AND e.event_type = 'PURCHASE' ORDER BY e.external_source_id`)).rows,
      products: (await schema.db.execute(sql`SELECT external_id, status, total_sold, total_revenue FROM products WHERE client_id = ${cid} ORDER BY external_id`)).rows,
      metrics: (await schema.db.execute(sql`SELECT metric_date, approved_orders, requested_orders, approved_revenue, requested_revenue, new_buyers, returning_buyers FROM daily_client_metrics WHERE client_id = ${cid} ORDER BY metric_date`)).rows,
    });
    const [a, b] = [await dump("shop-i1"), await dump("shop-i2")];
    expect(a.orders).toHaveLength(7);
    expect(a.orders.find((o) => o.external_id === "braavo:201")?.status).toBe("REJECTED");
    expect(a.orders.find((o) => o.external_id === "braavo:204")?.status).toBe("APPROVED");
    expect(a.orders.find((o) => o.external_id === "braavo:205")?.status).toBe("DELIVERED");
    expect(a.items.filter((i) => i.pedido === "braavo:206")).toHaveLength(1);
    expect(a.metrics.length).toBeGreaterThan(2); // dias de criação e de aprovação diferentes
    expect(a).toEqual(b);
  }, 60000);

  it("bulk page write produces the same database as writing each order one by one", async () => {
    // Mesma página de pedidos gravada pelos dois caminhos em lojas diferentes.
    await schema.db.insert(schema.clientsTable).values({
      id: "shop-b", name: "Loja B", email: "b@example.invalid", apiKey: "internal-test-key-b",
      dashboardType: "B2C", commercePlatform: "BRAAVO", braavoDomain: "https://www.lojab.com.br",
      braavoApiToken: "tb", braavoApiKey: "kb",
    });
    await schema.db.insert(schema.braavoSyncStatesTable).values({
      clientId: "shop-b", fingerprint: "fp-shop-b", leaseId: "lease-shop-b", leaseUntil: new Date(Date.now() + 600000),
    });
    const mk = (id: number, over: Record<string, unknown>, items: Record<string, unknown>[] = []) => ({
      ...structuredClone(sampleOrder), id, data_alterado: "2026-01-10 10:00:00", ...over,
      produtos: (items.length ? items : sampleOrder.produtos).map((it, i) => ({ ...it, id: id * 10 + i })),
    });
    const lines = [
      mk(101, {}),
      mk(102, { usuario_id: 12 }),                                                   // mesmo cliente
      mk(103, { usuario_id: 77, usuario_email: "novo@example.invalid", usuario_nome: "Novo" }), // cliente só no pedido
      mk(104, { usuario_id: 77, usuario_email: "novo@example.invalid" }),            // mesmo cliente novo, 2º pedido
      mk(105, { usuario_id: 78, usuario_email: "ana@example.invalid" }),             // e-mail de OUTRA conta
      mk(106, { status_pagamento: "6" }),                                            // cancelado
      mk(107, { status_pagamento: "1" }),                                            // pendente
      mk(108, { status_entrega: "23" }),                                             // entregue
      mk(109, { status_entrega: "21" }),                                             // enviado
      mk(110, { status_pagamento: "9" }),                                            // INVÁLIDO (status desconhecido)
      mk(111, {}, [
        { ...sampleOrder.produtos[0], produto_id: 555, sku_id: 556, nome: "Produto antigo", quantidade: 1, preco_venda: 20, total: 20, desconto_vale_total: 0, calculado_preco_total: 20 },
        { ...sampleOrder.produtos[0], produto_id: 100, sku_id: 501 },
      ]),                                                                            // produto que não existe mais
      mk(112, { utm_source: null, utm_medium: null, utm_campaign: null }),
    ];
    // Clientes e catálogo que já existem na loja, iguais nas duas lojas.
    await cycle("shop-a"); // monta cliente 12, produto 100, SKU 501 em shop-a pelo ciclo normal
    // Reinicia as lojas para comparar só a gravação dos pedidos acima.
    const cache = new Map<string, Record<string, unknown>>();
    const counterA = { skipped: 0 }, counterB = { skipped: 0 };
    await schema.db.execute(sql`DELETE FROM events`);
    await schema.db.execute(sql`DELETE FROM order_items`);
    await schema.db.execute(sql`DELETE FROM orders`);
    await schema.db.execute(sql`DELETE FROM customers WHERE external_id <> 'braavo:12'`);
    // Loja B recebe o mesmo cliente 12 e produtos de A.
    await schema.db.execute(sql`INSERT INTO customers (id, client_id, external_id, email, name, state, city, created_at)
      SELECT 'b-' || id, 'shop-b', external_id, email, name, state, city, created_at FROM customers WHERE client_id = 'shop-a'`);
    await schema.db.execute(sql`INSERT INTO products (id, client_id, external_id, sku, name, price, status)
      SELECT 'b-' || id, 'shop-b', external_id, sku, name, price, status FROM products WHERE client_id = 'shop-a'`);
    await schema.db.execute(sql`UPDATE braavo_sync_states SET lease_id = 'lease-shop-a', lease_until = now() + interval '10 minutes' WHERE client_id = 'shop-a'`);

    await sync.persistOrdersBulk("shop-a", "lease-shop-a", lines as never, cache as never, counterA);
    for (const line of lines)
      try { await sync.persistOrder("shop-b", "lease-shop-b", line as never, cache as never, true); }
      catch (e) { if ((e as { code?: string }).code !== "INVALID_RECORD") throw e; counterB.skipped++; }
    await sync.consolidateBraavoAggregates("shop-a", "lease-shop-a");
    await sync.consolidateBraavoAggregates("shop-b", "lease-shop-b");

    expect(counterA.skipped).toBe(1); // só o pedido 110
    expect(counterB.skipped).toBe(1);
    const dump = async (cid: string) => {
      const orders = (await schema.db.execute(sql`SELECT external_id, status, amount, fulfilled_amount, gross_amount, discount_amount, shipping_amount, cancelled_amount, requested_quantity, fulfilled_quantity, utm_source, utm_medium, utm_campaign, state, city, approval_date, created_at, source_metadata FROM orders WHERE client_id = ${cid} ORDER BY external_id`)).rows;
      const items = (await schema.db.execute(sql`SELECT o.external_id AS pedido, p.external_id AS produto, oi.quantity, oi.fulfilled_quantity, oi.price_at_sale, oi.gross_price_at_sale, oi.discount_amount, oi.size, oi.color FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id WHERE o.client_id = ${cid} ORDER BY o.external_id, p.external_id, oi.quantity`)).rows;
      const customers = (await schema.db.execute(sql`SELECT external_id, email, name, state, city, total_orders, total_spent, first_purchase_at, last_purchase_at FROM customers WHERE client_id = ${cid} ORDER BY external_id`)).rows;
      const events = (await schema.db.execute(sql`SELECT e.external_source_id, e.event_type, e.created_at, e.metadata, c.external_id AS cliente FROM events e LEFT JOIN customers c ON c.id = e.customer_id WHERE e.client_id = ${cid} ORDER BY e.external_source_id`)).rows;
      const products = (await schema.db.execute(sql`SELECT external_id, sku, status, total_sold, total_revenue FROM products WHERE client_id = ${cid} ORDER BY external_id`)).rows;
      const metrics = (await schema.db.execute(sql`SELECT metric_date, approved_orders, requested_orders, approved_revenue, requested_revenue, new_buyers, returning_buyers FROM daily_client_metrics WHERE client_id = ${cid} ORDER BY metric_date`)).rows;
      return { orders, items, customers, events, products, metrics };
    };
    const [a, b] = [await dump("shop-a"), await dump("shop-b")];
    expect(a.orders).toHaveLength(11);
    expect(a.customers.map((c) => c.external_id)).toEqual(expect.arrayContaining(["braavo:12", "braavo:77", "braavo:78"]));
    // O cliente 78 repete o e-mail da conta 12: fica com e-mail de reserva, sem fundir.
    expect(a.customers.find((c) => c.external_id === "braavo:78")?.email).toBe("braavo-78@unknown.local");
    expect(a).toEqual(b);
  }, 60000);

  it("bulk SKU page write produces the same products as writing each SKU one by one", async () => {
    for (const id of ["shop-s1", "shop-s2"]) {
      await schema.db.insert(schema.clientsTable).values({
        id, name: id, email: id + "@example.invalid", apiKey: "k-" + id, dashboardType: "B2C",
        commercePlatform: "BRAAVO", braavoDomain: `https://www.${id}.com.br`, braavoApiToken: "t", braavoApiKey: "k",
      });
      await schema.db.insert(schema.braavoSyncStatesTable).values({
        clientId: id, fingerprint: "fp-" + id, leaseId: "lease-" + id, leaseUntil: new Date(Date.now() + 600000),
      });
      // Produto que já existe com a ref "REF-DUP" de OUTRO SKU: a ref nova do mesmo valor precisa de sufixo.
      await schema.db.insert(schema.productsTable).values({
        clientId: id, externalId: "braavo:900:9001", sku: "REF-JA-EXISTE", name: "Antigo", price: 10, status: "ACTIVE",
      });
    }
    const cache = new Map<string, Record<string, unknown>>([
      ["categories:1", { nome: "Vestidos" }],
      ["variations:10", { nome: "Cor", pai_id: 0 }], ["variations:11", { nome: "Preto", pai_id: 10 }],
      ["variations:20", { nome: "Tamanho", pai_id: 0 }], ["variations:22", { nome: "M", pai_id: 20 }],
      ["products:100", { nome: "Vestido", ativo: "1", categoria_id: 1, descricao: "Longo", imageUrl: "https://i.example.invalid/100.webp" }],
      ["products:101", { nome: "Blusa", ativo: "1", categoria_id: 1 }],
      ["products:102", { nome: "Saia inativa", ativo: "0", categoria_id: 1 }],
    ]);
    const sku = (id: number, produto: number, over: Record<string, unknown> = {}) => ({
      id, produto_id: produto, ref: "REF-" + id, ativo: "1", estoque: 5, preco_venda: 50, preco_custo: 20, var1_id: 11, var2_id: 22, ...over,
    });
    const rows = [
      sku(1, 100),                                          // completo, cor e tamanho
      sku(2, 100, { var2_id: null }),                       // só cor
      sku(3, 100, { var1_id: null, var2_id: null }),        // sem variação
      sku(4, 101, { ref: "REF-IGUAL" }),                    // ref repetida (1º fica com ela)
      sku(5, 101, { ref: "REF-IGUAL" }),                    // 2º com a mesma ref: ganha sufixo
      sku(6, 101, { ref: "REF-JA-EXISTE" }),                // ref já usada por produto antigo de outro SKU
      sku(7, 102),                                          // produto inativo
      sku(8, 100, { ativo: "0" }),                          // SKU inativo
      sku(9, 100, { estoque: -3 }),                         // saldo negativo é válido
      sku(10, 100, { preco_custo: null }),                  // sem custo
      sku(11, 999),                                         // produto que não existe: ignorado
      sku(12, 100, { estoque: "abc" }),                     // estoque inválido: ignorado
      sku(13, 100, { ref: null }),                          // sem ref: usa braavo-<id>
    ];
    const bulkCounter = { skipped: 0 }, oneCounter = { skipped: 0 };
    await sync.persistSkusBulk("shop-s1", "lease-shop-s1", rows as never, cache as never, bulkCounter);
    for (const row of rows)
      try {
        await schema.db.transaction((tx) => sync.persistSku(tx, "shop-s2", row as never, cache as never));
      } catch (e) {
        if ((e as { code?: string }).code !== "INVALID_RECORD" && (e as { code?: string }).code !== "SKU_WITHOUT_PRODUCT" && (e as { code?: string }).code !== "INVALID_STOCK") throw e;
        oneCounter.skipped++;
      }
    expect(bulkCounter.skipped).toBe(2); // SKUs 11 e 12
    expect(oneCounter.skipped).toBe(2);
    const dump = async (cid: string) =>
      (await schema.db.execute(sql`SELECT external_id, sku, name, description, category, price, cost, stock, image_url, status FROM products WHERE client_id = ${cid} ORDER BY external_id`)).rows;
    const [a, b] = [await dump("shop-s1"), await dump("shop-s2")];
    expect(a).toHaveLength(12); // 11 SKUs válidos + o produto antigo que já existia
    expect(a.find((p) => p.external_id === "braavo:101:5")?.sku).toBe("REF-IGUAL#braavo-5");
    expect(a.find((p) => p.external_id === "braavo:101:6")?.sku).toBe("REF-JA-EXISTE#braavo-6");
    expect(a.find((p) => p.external_id === "braavo:100:13")?.sku).toBe("braavo-13");
    expect(a.find((p) => p.external_id === "braavo:100:9")?.stock).toBe(-3);
    expect(a).toEqual(b);
  }, 60000);

  describe("backfill na nuvem (botão do painel)", () => {
    const post = (id = "shop-a", token = "test-admin") =>
      request(app).post(`/clients/${id}/braavo/backfill`).set("Authorization", `Bearer ${token}`);
    const runner = async () => (await import("../src/services/cloud-run-jobs")).runBraavoBackfillJob as unknown as ReturnType<typeof vi.fn>;

    it("starts the cloud job for one store and never runs the load in the request", async () => {
      const run = await runner();
      run.mockClear();
      const res = await post();
      expect(res.status).toBe(202);
      expect(res.body).toMatchObject({ started: true });
      expect(run).toHaveBeenCalledTimes(1);
      expect(run).toHaveBeenCalledWith("shop-a");
    });

    it("is restricted to administrators", async () => {
      const run = await runner();
      run.mockClear();
      expect((await post("shop-a", "test-client")).status).toBe(403);
      expect(run).not.toHaveBeenCalled();
    });

    it("refuses a store whose full load is already done", async () => {
      const run = await runner();
      run.mockClear();
      await schema.db.insert(schema.braavoSyncStatesTable).values({
        clientId: "shop-a", fingerprint: "fp", completedAt: new Date(), fullCompletedAt: new Date(),
      });
      const res = await post();
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("ALREADY_LOADED");
      expect(run).not.toHaveBeenCalled();
    });

    it("refuses while a batch holds the lease or the job touched the store a minute ago", async () => {
      const run = await runner();
      run.mockClear();
      await schema.db.insert(schema.braavoSyncStatesTable).values({
        clientId: "shop-a", fingerprint: "fp", leaseId: "x", leaseUntil: new Date(Date.now() + 60_000),
      });
      expect((await post()).body.code).toBe("ALREADY_RUNNING");
      await schema.db.execute(sql`UPDATE braavo_sync_states SET lease_until = now() - interval '1 minute', updated_at = now()`);
      const recent = await post();
      expect(recent.status).toBe(409);
      expect(recent.body.code).toBe("ALREADY_RUNNING");
      expect(run).not.toHaveBeenCalled();
      // Parada há mais de 3 minutos: pode retomar.
      await schema.db.execute(sql`UPDATE braavo_sync_states SET updated_at = now() - interval '10 minutes'`);
      expect((await post()).status).toBe(202);
    });

    it("needs the connection saved first", async () => {
      const run = await runner();
      run.mockClear();
      await schema.db.insert(schema.clientsTable).values({
        id: "shop-n", name: "Sem conexao", email: "n@example.invalid", apiKey: "k-n", dashboardType: "B2C",
        commercePlatform: "BRAAVO",
      });
      const res = await post("shop-n");
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("NOT_CONFIGURED");
      expect(run).not.toHaveBeenCalled();
    });

    it("does not leak Google's error to the browser when the cloud call fails", async () => {
      const run = await runner();
      const { CloudRunJobError } = await import("../src/services/cloud-run-jobs");
      run.mockRejectedValueOnce(new CloudRunJobError("Não foi possível iniciar a carga na nuvem agora. Tente de novo em instantes.", "CLOUD_RUN_UNAVAILABLE"));
      const res = await post();
      expect(res.status).toBe(502);
      expect(res.body.code).toBe("CLOUD_RUN_UNAVAILABLE");
      expect(JSON.stringify(res.body)).not.toMatch(/googleapis|projects\//);
    });
  });

  it("backfill mode picks only stores without a completed full load", async () => {
    const extraction = await import("../src/services/extraction-runner");
    await schema.db.insert(schema.clientsTable).values({
      id: "shop-0", name: "Loja 0", email: "z@example.invalid", apiKey: "internal-test-key-0",
      dashboardType: "B2C", commercePlatform: "BRAAVO", braavoDomain: "https://www.loja0.com.br",
      braavoApiToken: "t0", braavoApiKey: "k0",
    });
    // shop-0 (id menor) já tem carga completa concluída; shop-a ainda não.
    await schema.db.insert(schema.braavoSyncStatesTable).values({
      clientId: "shop-0", fingerprint: "fp0", completedAt: new Date(), fullCompletedAt: new Date(),
    });
    const all = await extraction.runBraavoTransactionalExtraction("cron", { offset: 0, mode: "all" });
    expect(all.clientId).toBe("shop-0"); // modo todas: pela ordem de id
    const backfill = await extraction.runBraavoTransactionalExtraction("cron", { offset: 0, mode: "backfill" });
    expect(backfill.clientId).toBe("shop-a"); // só quem ainda não concluiu a carga
    const next = await extraction.runBraavoTransactionalExtraction("cron", { offset: 1, mode: "backfill" });
    expect(next.clients).toBe(0); // não há outra loja pendente
  }, 40000);

  it("full load reads customers in bulk with their addresses and never asks each customer's detail", async () => {
    await cycle();
    expect(calls.filter((c) => c.path === "/api/clientes/buscar/id")).toHaveLength(0);
    const addr = calls.filter((c) => c.path === "/api/enderecos/buscar/todos");
    expect(addr.length).toBeGreaterThan(0);
    expect(addr[0].body.limite).toBe(100);
    const cust = calls.filter((c) => c.path === "/api/clientes/buscar/todos");
    expect(cust[0].body.limite).toBe(100);
    const snap = await snapshot();
    // Primeiro endereço ATIVO (id maior, vindo depois na lista) define cidade/estado.
    expect(snap.customers[0]).toMatchObject({ city: "São Paulo", state: "SP" });
    const staged = await schema.db.execute(sql`SELECT count(*)::int AS n FROM braavo_catalog WHERE kind = 'customer_addresses'`);
    expect(Number((staged.rows[0] as { n: number }).n)).toBe(0);
  }, 30000);

  it("bulk customer page registers a repeated email instead of merging two accounts", async () => {
    customers.push({ ...customers[0], id: 13, nome: "Outra conta" }); // mesmo e-mail do 12
    await cycle(); // carga completa: clientes em lote
    const snap = await snapshot();
    expect(snap.customers.map((c) => c.externalId)).toEqual(["braavo:12"]);
    const status = await sync.getBraavoSyncStatus("shop-a");
    expect(status.skippedRecords.recent.map((r) => [r.phase, r.externalId])).toContainEqual(["customers", "13"]);
  }, 30000);

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
