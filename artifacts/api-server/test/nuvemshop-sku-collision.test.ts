import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@workspace/db/schema";

// Itens de pedido perdidos por SKU repetido (17/11/2026). A tabela de produtos tem DUAS chaves unicas: (cliente, external_id) e (cliente, sku).
// Lojas Nuvemshop usam o mesmo SKU em variantes (ou em anuncios) diferentes; o upsert por external_id batia na chave do SKU, o item era
// descartado e o apagamento previo dos itens do pedido o removia de vez (Lila Rosa: 47% dos pedidos dos ultimos 7 dias sem nenhum item).
// Aqui o banco e um Postgres de verdade em memoria (PGlite) com as duas chaves; so a API da Nuvemshop (fetch) e simulada.

const state = vi.hoisted(() => ({ db: null as any }));
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

import { collisionSku, syncNuvemshopClient } from "../src/services/nuvemshop-sync";

const pg = new PGlite();
const CLIENT = "c1";

beforeAll(async () => {
  await pg.exec(`
    CREATE TABLE products (
      id text PRIMARY KEY, client_id text NOT NULL, external_id text, source_synced_at timestamptz, sku text NOT NULL, name text NOT NULL,
      description text, category text, price double precision NOT NULL, cost double precision, stock integer NOT NULL DEFAULT 0,
      restock_threshold integer NOT NULL DEFAULT 10, image_url text, total_sold integer NOT NULL DEFAULT 0,
      total_revenue double precision NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'ACTIVE',
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX products_client_sku_uq ON products (client_id, sku);
    CREATE UNIQUE INDEX products_client_external_id_uq ON products (client_id, external_id);
    CREATE TABLE customers (
      id text PRIMARY KEY, client_id text NOT NULL, external_id text, email text NOT NULL, phone text, name text, document_type text,
      document_hash text, document_last4 text, state text, city text, utm_source text, utm_medium text, utm_campaign text, utm_content text,
      utm_term text, registration_status text NOT NULL DEFAULT 'PENDING', approval_date timestamptz, rfm_segment text, recency_score integer,
      frequency_score integer, monetary_score integer, total_orders integer NOT NULL DEFAULT 0, total_spent double precision NOT NULL DEFAULT 0,
      first_purchase_at timestamptz, last_purchase_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX customers_client_email_uq ON customers (client_id, email);
    CREATE UNIQUE INDEX customers_client_external_id_uq ON customers (client_id, external_id);
    CREATE TABLE orders (
      id text PRIMARY KEY, client_id text NOT NULL, customer_id text NOT NULL, seller_id text, external_id text, utm_source text, utm_medium text,
      utm_campaign text, utm_content text, utm_term text, source_metadata jsonb, requested_quantity integer NOT NULL DEFAULT 0,
      fulfilled_quantity integer NOT NULL DEFAULT 0, amount double precision NOT NULL, fulfilled_amount double precision NOT NULL DEFAULT 0,
      gross_amount double precision NOT NULL DEFAULT 0, discount_amount double precision NOT NULL DEFAULT 0, shipping_amount double precision NOT NULL DEFAULT 0,
      refunded_amount double precision NOT NULL DEFAULT 0, refund_status_unverified_reason text, cancelled_amount double precision NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'PENDING', approval_date timestamptz, state text, city text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX orders_client_external_id_uq ON orders (client_id, external_id);
    CREATE TABLE order_items (
      id text PRIMARY KEY, order_id text NOT NULL, product_id text NOT NULL, quantity integer NOT NULL, fulfilled_quantity integer NOT NULL DEFAULT 0,
      price_at_sale double precision NOT NULL, gross_price_at_sale double precision NOT NULL DEFAULT 0, discount_amount double precision NOT NULL DEFAULT 0,
      size text, color text
    );
    CREATE TABLE events (
      id text PRIMARY KEY, client_id text NOT NULL, customer_id text, event_type text NOT NULL, product_id text, order_id text,
      external_source_id text, metadata jsonb, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX events_external_source_uniq ON events (client_id, event_type, external_source_id) WHERE external_source_id IS NOT NULL;
  `);
  state.db = drizzle(pg, { schema });
});

afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  await pg.exec("DELETE FROM events; DELETE FROM order_items; DELETE FROM orders; DELETE FROM customers; DELETE FROM products;");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

type Item = { product_id: number; variant_id: number | null; sku: string; name?: string; price?: number; quantity?: number };
const item = (product_id: number, variant_id: number | null, sku: string, over: Partial<Item> = {}) => ({
  id: product_id * 1000 + (variant_id ?? 0), product_id, variant_id, sku, name: `Produto ${product_id} v${variant_id}`, price: 50, quantity: 1, ...over,
});
const order = (id: number, products: ReturnType<typeof item>[], over: Record<string, unknown> = {}) => ({
  id, status: "open", payment_status: "paid", total: 100, subtotal: 100, discount: 0, created_at: "2026-11-10T10:00:00Z", paid_at: "2026-11-10T10:05:00Z",
  customer: { id: 1, email: "cliente@loja.com", name: "Cliente" }, products, ...over,
});

// fetchOrders agora fatia a busca por pedaco de tempo (ver achado 23/11/2026 em
// nuvemshop-sync.ts) -- o mock precisa respeitar updated_at_min/updated_at_max
// de verdade (como a API real), senao toda rodada de pedaco "antigo" tambem
// devolve o mesmo pedido e o loop nunca para de descer no tempo.
function filterOrdersByDate(orders: unknown[], url: URL): unknown[] {
  const min = url.searchParams.get("updated_at_min");
  const max = url.searchParams.get("updated_at_max");
  if (!min && !max) return orders;
  return orders.filter((o) => {
    const createdAt = new Date((o as { created_at: string }).created_at).getTime();
    if (min && createdAt < new Date(min).getTime()) return false;
    if (max && createdAt > new Date(max).getTime()) return false;
    return true;
  });
}

// Simula a API da Nuvemshop: /orders (uma pagina), /orders/{id}/transactions e /products/{id}.
const stubNuvemshop = (orders: unknown[]) => {
  vi.stubGlobal("fetch", async (input: URL | string) => {
    const url = new URL(String(input));
    const path = url.pathname;
    const body = /\/orders$/.test(path) ? filterOrdersByDate(orders, url) : /\/transactions$/.test(path) ? [] : { id: 1, name: "Produto", variants: [], images: [] };
    return { ok: true, status: 200, statusText: "OK", json: async () => body };
  });
};

const sync = () => syncNuvemshopClient({ clientId: CLIENT, storeId: "1", accessToken: "t", skipCatalog: true });
const rows = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => (await pg.query<T>(sql, params)).rows;
const productSkus = async () => (await rows<{ sku: string }>(`SELECT sku FROM products WHERE client_id = $1 ORDER BY sku`, [CLIENT])).map((r) => r.sku);
const itemCount = async () => Number((await rows<{ n: number }>(`SELECT count(*)::int AS n FROM order_items`))[0].n);

describe("collisionSku", () => {
  it("monta um SKU unico a partir do external_id (que e unico por cliente)", () => {
    expect(collisionSku("BL4C7A3", "364035282:1586554879")).toBe("BL4C7A3#nuvemshop-364035282-1586554879");
    expect(collisionSku("X", "100")).toBe("X#nuvemshop-100");
    expect(collisionSku("X", "100:1")).not.toBe(collisionSku("X", "200:1"));
  });
});

describe("itens de pedido com SKU repetido", () => {
  it("duas variantes do MESMO produto com o mesmo SKU: as duas entram (antes a segunda era descartada)", async () => {
    stubNuvemshop([order(1, [item(100, 1, "AAA"), item(100, 2, "AAA")])]);
    const result = await sync();
    expect(result.errors).toEqual([]);
    expect(await itemCount()).toBe(2);
    expect(await productSkus()).toEqual(["AAA", "AAA#nuvemshop-100-2"]);
  });

  it("produtos DIFERENTES com o mesmo SKU (anuncio duplicado, caso Jini): os dois itens entram", async () => {
    stubNuvemshop([order(1, [item(314, 11, "TT-002-023N")]), order(2, [item(370, 22, "TT-002-023N")], { customer: { id: 2, email: "outro@loja.com" } })]);
    const result = await sync();
    expect(result.errors).toEqual([]);
    expect(await itemCount()).toBe(2);
    expect((await productSkus()).length).toBe(2);
  });

  it("produto que ja existia no banco com aquele SKU (como em producao): o item novo entra com SKU proprio", async () => {
    await pg.exec(`INSERT INTO products (id, client_id, external_id, sku, name, price) VALUES ('p1', '${CLIENT}', '100:1', 'AAA', 'Camiseta P', 50)`);
    stubNuvemshop([order(1, [item(100, 2, "AAA")])]);
    const result = await sync();
    expect(result.errors).toEqual([]);
    expect(await itemCount()).toBe(1);
    expect(await productSkus()).toEqual(["AAA", "AAA#nuvemshop-100-2"]);
  });

  it("rodar de novo nao duplica nada, nao devolve o SKU repetido e nao perde item", async () => {
    stubNuvemshop([order(1, [item(100, 1, "AAA"), item(100, 2, "AAA")])]);
    await sync();
    const second = await sync();
    expect(second.errors).toEqual([]);
    expect(await itemCount()).toBe(2);
    expect(await productSkus()).toEqual(["AAA", "AAA#nuvemshop-100-2"]);
    const [{ n }] = await rows<{ n: number }>(`SELECT count(*)::int AS n FROM products WHERE client_id = $1`, [CLIENT]);
    expect(Number(n)).toBe(2);
  });

  it("o item ligado a cada variante aponta para o produto certo", async () => {
    stubNuvemshop([order(1, [item(100, 1, "AAA"), item(100, 2, "AAA")])]);
    await sync();
    const linked = await rows<{ external_id: string }>(
      `SELECT p.external_id FROM order_items oi JOIN products p ON p.id = oi.product_id ORDER BY p.external_id`,
    );
    expect(linked.map((r) => r.external_id)).toEqual(["100:1", "100:2"]);
  });
});

describe("outro processo cria o SKU no meio da rodada (leitura desatualizada)", () => {
  it("o banco recusa o SKU, o codigo tenta de novo com SKU proprio e o item entra", async () => {
    const orders = [order(1, [item(100, 1, "AAA")]), order(2, [item(200, 5, "BBB")], { customer: { id: 2, email: "outro@loja.com" } })];
    vi.stubGlobal("fetch", async (input: URL | string) => {
      const url = new URL(String(input));
      const path = url.pathname;
      // Ao buscar os detalhes do produto 200 (depois que o indice de produtos ja foi lido), "outro processo" cria o SKU BBB.
      if (/\/products\/200$/.test(path)) {
        await pg.exec(`INSERT INTO products (id, client_id, external_id, sku, name, price) VALUES ('x1', '${CLIENT}', '999:9', 'BBB', 'Criado por outro', 5)`);
      }
      const body = /\/orders$/.test(path) ? filterOrdersByDate(orders, url) : /\/transactions$/.test(path) ? [] : { id: 1, name: "Produto", variants: [], images: [] };
      return { ok: true, status: 200, statusText: "OK", json: async () => body };
    });
    const result = await sync();
    expect(result.errors).toEqual([]);
    expect(await itemCount()).toBe(2);
    expect(await productSkus()).toEqual(["AAA", "BBB", "BBB#nuvemshop-200-5"]);
  });

  it("erro que NAO e de SKU repetido continua aparecendo em errors (nao e engolido)", async () => {
    await pg.exec(`ALTER TABLE products ADD CONSTRAINT price_positive CHECK (price >= 0)`);
    try {
      stubNuvemshop([order(1, [item(100, 1, "AAA", { price: -10 })])]);
      const result = await sync();
      expect(result.errors.length).toBe(1);
      expect(await itemCount()).toBe(0);
    } finally {
      await pg.exec(`ALTER TABLE products DROP CONSTRAINT price_positive`);
    }
  });
});

describe("comportamento que nao pode mudar", () => {
  it("SKU unico: cria o produto com o proprio SKU e o item entra", async () => {
    stubNuvemshop([order(1, [item(100, 1, "AAA"), item(200, 5, "BBB")])]);
    const result = await sync();
    expect(result.errors).toEqual([]);
    expect(await productSkus()).toEqual(["AAA", "BBB"]);
    expect(await itemCount()).toBe(2);
    expect(result.productsCreated).toBe(2);
  });

  it("produto existente cujo SKU mudou para um SKU livre: o SKU e atualizado, como antes", async () => {
    await pg.exec(`INSERT INTO products (id, client_id, external_id, sku, name, price) VALUES ('p1', '${CLIENT}', '100:1', 'VELHO', 'Camiseta', 10)`);
    stubNuvemshop([order(1, [item(100, 1, "NOVO", { price: 80 })])]);
    const result = await sync();
    expect(result.errors).toEqual([]);
    const [row] = await rows<{ sku: string; price: number }>(`SELECT sku, price FROM products WHERE external_id = '100:1'`);
    expect(row.sku).toBe("NOVO");
    expect(Number(row.price)).toBe(80);
    expect(result.productsUpdated).toBe(1);
  });

  it("produto existente cujo SKU novo pertence a OUTRO produto: mantem o SKU que ja tinha, sem erro e sem perder o item", async () => {
    await pg.exec(`
      INSERT INTO products (id, client_id, external_id, sku, name, price) VALUES ('p1', '${CLIENT}', '100:1', 'AAA', 'Camiseta', 10);
      INSERT INTO products (id, client_id, external_id, sku, name, price) VALUES ('p2', '${CLIENT}', '100:2', 'BBB', 'Camiseta M', 10);
    `);
    stubNuvemshop([order(1, [item(100, 2, "AAA")])]);
    const result = await sync();
    expect(result.errors).toEqual([]);
    expect(await itemCount()).toBe(1);
    expect(await productSkus()).toEqual(["AAA", "BBB"]);
  });

  it("os totais por produto contam o item que antes era descartado", async () => {
    stubNuvemshop([order(1, [item(100, 1, "AAA", { quantity: 2 }), item(100, 2, "AAA", { quantity: 3 })])]);
    await sync();
    const sold = await rows<{ external_id: string; total_sold: number }>(`SELECT external_id, total_sold FROM products WHERE client_id = $1 ORDER BY external_id`, [CLIENT]);
    expect(sold.map((r) => [r.external_id, Number(r.total_sold)])).toEqual([["100:1", 2], ["100:2", 3]]);
  });
});
