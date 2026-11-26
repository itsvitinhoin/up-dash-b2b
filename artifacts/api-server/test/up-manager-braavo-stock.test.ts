import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

const { connection } = vi.hoisted(() => {
  const current: { db?: object } = {};
  return { connection: current };
});
vi.mock("@workspace/db", async () => ({
  ...(await import("@workspace/db/schema")),
  get db() { return connection.db; },
}));

import { readBraavoManagerCatalog } from "../src/services/up-manager-braavo";

const pg = new PGlite();
const now = Date.parse("2026-11-26T15:00:00Z");

beforeAll(async () => {
  connection.db = drizzle(pg);
  await pg.exec(`
    CREATE TABLE products (
      client_id text, external_id text, name text, sku text, stock integer,
      price double precision, image_url text, source_synced_at timestamptz, status text
    );
    CREATE TABLE braavo_catalog (client_id text, kind text, external_id text, data jsonb);
    CREATE TABLE braavo_record_issues (client_id text, phase text, external_id text);
    CREATE TABLE braavo_sync_states (client_id text, full_completed_at timestamptz);
    CREATE TABLE sync_jobs (
      client_id text, job_type text, status text, started_at timestamptz, finished_at timestamptz, result jsonb
    );
    INSERT INTO braavo_catalog VALUES
      ('shop', 'products', '10', '{"nome":"Vestido"}'),
      ('incomplete', 'products', '10', '{"nome":"Vestido"}');
    INSERT INTO products VALUES
      ('shop', 'braavo:10:1', 'Vestido (Azul, P)', 'P', 5, 100, NULL, '2026-11-10', 'ACTIVE'),
      ('shop', 'braavo:10:2', 'Vestido (Azul, M)', 'M', 0, 100, NULL, '2026-11-10', 'ACTIVE'),
      ('shop', 'braavo:10:3', 'Vestido (Azul, G)', 'G', 4, 100, NULL, '2026-11-10', 'ACTIVE'),
      ('incomplete', 'braavo:10:1', 'Vestido (Azul, P)', 'P', 7, 100, NULL, '2026-11-10', 'ACTIVE');
    INSERT INTO braavo_sync_states VALUES ('shop', '2026-11-11'), ('incomplete', NULL);
    INSERT INTO braavo_record_issues VALUES ('shop', 'skus', '3');
    INSERT INTO sync_jobs VALUES
      ('shop', 'braavo_transactional', 'done', '2026-11-26 11:00Z', '2026-11-26 11:15Z', '{"phase":"done"}'),
      ('shop', 'braavo_transactional', 'failed', '2026-11-26 13:00Z', '2026-11-26 13:15Z', NULL),
      ('incomplete', 'braavo_transactional', 'done', '2026-11-26 11:00Z', '2026-11-26 11:15Z', '{"phase":"done"}');
  `);
});
afterAll(async () => {
  await pg.close();
});

describe("estoque Braavo no Manager", () => {
  it("usa o ciclo incremental concluído para os SKUs antigos e mantém o erro de SKU em aberto", async () => {
    const result = await readBraavoManagerCatalog("shop", now);
    expect(result?.observedAt).toBe("2026-11-26T11:00:00.000Z");
    expect(Object.fromEntries(result!.products[0].variants!.map(({ id, stock }) => [id, stock])))
      .toEqual({ "1": 5, "2": 0, "3": null });
  });

  it("não confirma os saldos antigos até existir uma carga completa", async () => {
    const result = await readBraavoManagerCatalog("incomplete", now);
    expect(result?.products[0].variants?.[0].stock).toBeNull();
  });

  it("não atribui saldo confirmado a um ciclo antigo", async () => {
    const result = await readBraavoManagerCatalog("shop", now + 3 * 86_400_000);
    expect(result?.products[0].variants?.map(({ stock }) => stock)).toEqual([null, null, null]);
  });
});
