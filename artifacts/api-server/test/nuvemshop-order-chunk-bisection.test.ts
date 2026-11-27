import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@workspace/db/schema";

// Achado 27/11/2026 (backfill da Lila Rosa): um pedaco de 30 dias pode quebrar
// com Internal Server Error da Nuvemshop so num trecho pequeno dele (nao e so
// profundidade de paginacao). fetchOrders agora bisecciona o pedaco que falha
// em janelas menores em vez de descartar os 30 dias inteiros -- este teste
// simula uma janela "envenenada" de poucas horas e confirma que (1) pedidos
// fora dela sao sincronizados normalmente e (2) o erro reportado cobre so a
// janela minima que realmente quebra, nao o pedaco inteiro.

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

import { syncNuvemshopClient } from "../src/services/nuvemshop-sync";

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
const order = (id: number, createdAt: string, products: ReturnType<typeof item>[]) => ({
  id, status: "open", payment_status: "paid", total: 100, subtotal: 100, discount: 0, created_at: createdAt, paid_at: createdAt,
  customer: { id: 1, email: "cliente@loja.com", name: "Cliente" }, products,
});

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

// Simula a API da Nuvemshop, mas devolve 500 pra qualquer janela que contenha
// o instante "envenenado" -- igual ao caso real (um trecho pontual quebrado).
const stubNuvemshopWithPoisonedWindow = (orders: unknown[], poisonedAt: string) => {
  const poisonMs = new Date(poisonedAt).getTime();
  vi.stubGlobal("fetch", async (input: URL | string) => {
    const url = new URL(String(input));
    const path = url.pathname;
    if (/\/orders$/.test(path)) {
      const min = url.searchParams.get("updated_at_min");
      const max = url.searchParams.get("updated_at_max");
      if (min && max) {
        const minMs = new Date(min).getTime();
        const maxMs = new Date(max).getTime();
        if (minMs <= poisonMs && poisonMs <= maxMs) {
          return { ok: false, status: 500, statusText: "Internal Server Error", json: async () => ({}) };
        }
      }
      return { ok: true, status: 200, statusText: "OK", json: async () => filterOrdersByDate(orders, url) };
    }
    const body = /\/transactions$/.test(path) ? [] : { id: 1, name: "Produto", variants: [], images: [] };
    return { ok: true, status: 200, statusText: "OK", json: async () => body };
  });
};

const sync = (since: Date) => syncNuvemshopClient({ clientId: CLIENT, storeId: "1", accessToken: "t", skipCatalog: true, since });
const rows = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => (await pg.query<T>(sql, params)).rows;
const orderExternalIds = async () => (await rows<{ external_id: string }>(`SELECT external_id FROM orders WHERE client_id = $1 ORDER BY external_id`, [CLIENT])).map((r) => r.external_id);

describe("fetchOrders bisection on a narrow poisoned window", () => {
  it("still syncs orders outside the poisoned window and reports only the minimal failing span", async () => {
    const poisonedAt = "2026-03-15T12:00:00Z";
    const orders = [
      order(1, "2026-11-01T10:00:00Z", [item(1, null, "SKU-A")]),
      order(2, "2026-03-20T10:00:00Z", [item(2, null, "SKU-B")]),
      order(3, "2026-02-10T10:00:00Z", [item(3, null, "SKU-C")]),
    ];
    stubNuvemshopWithPoisonedWindow(orders, poisonedAt);

    const result = await sync(new Date("2026-01-01T00:00:00Z"));

    expect(await orderExternalIds()).toEqual(["1", "2", "3"]);

    expect(result.errors.length).toBe(1);
    const match = result.errors[0].match(/pedaco (\d{4}-\d{2}-\d{2}) a (\d{4}-\d{2}-\d{2})/);
    expect(match).not.toBeNull();
    const [, spanStart, spanEnd] = match!;
    const spanDays = (new Date(spanEnd).getTime() - new Date(spanStart).getTime()) / (24 * 60 * 60 * 1000);
    expect(spanDays).toBeLessThanOrEqual(1);
    // a janela isolada deve cair no mesmo dia (ou no dia seguinte, por conta
    // do truncamento pra data no texto do erro) do instante envenenado --
    // nunca no pedaco de 30 dias inteiro.
    expect(["2026-03-14", "2026-03-15"]).toContain(spanStart.slice(0, 10));
  });
});
