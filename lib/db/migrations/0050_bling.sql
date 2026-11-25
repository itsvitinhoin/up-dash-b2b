CREATE TABLE IF NOT EXISTS "bling_connections" (
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
