import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

// The first explicit ERP configuration can provision only these additive tables.
// Keep this DDL aligned with 0050_bling.sql; no existing tables are changed.
const DDL = `CREATE TABLE IF NOT EXISTS "bling_connections" (
  "client_id" text PRIMARY KEY REFERENCES "clients"("id") ON DELETE CASCADE,
  "company_id" text,
  "company_name" text,
  "tokens" text,
  "expires_at" timestamptz,
  "nuvemshop_channel_id" text,
  "history_days" integer NOT NULL DEFAULT 30 CHECK ("history_days" BETWEEN 1 AND 365),
  "cursor" jsonb,
  "completed_at" timestamptz,
  "watermark" text,
  "lease_id" text,
  "lease_until" timestamptz,
  "next_request_at" timestamptz,
  "error" text
);
CREATE UNIQUE INDEX IF NOT EXISTS "bling_company_uq" ON "bling_connections" ("company_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bling_oauth_states" (
  "hash" text PRIMARY KEY,
  "client_id" text NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "expires_at" timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS "bling_records" (
  "client_id" text NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "kind" text NOT NULL CHECK ("kind" IN ('channels', 'products', 'customers', 'orders')),
  "external_id" text NOT NULL,
  "data" jsonb NOT NULL,
  "synced_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("client_id", "kind", "external_id")
);
CREATE INDEX IF NOT EXISTS "bling_records_kind_idx" ON "bling_records" ("client_id", "kind");
`;

export async function hasBlingSchema() {
  const result = await db.execute(
    sql`SELECT to_regclass('public.bling_connections') IS NOT NULL AND to_regclass('public.bling_records') IS NOT NULL AND to_regclass('public.bling_oauth_states') IS NOT NULL AS ready`,
  );
  return result.rows[0]?.ready === true;
}
export async function ensureBlingSchema() {
  if (await hasBlingSchema()) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(825165014)`);
    await tx.execute(sql.raw(DDL));
  });
}
