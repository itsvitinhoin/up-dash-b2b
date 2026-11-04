ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "braavo_domain" text,
  ADD COLUMN IF NOT EXISTS "braavo_api_token" text,
  ADD COLUMN IF NOT EXISTS "braavo_api_key" text;
--> statement-breakpoint
ALTER TABLE "clients" DROP CONSTRAINT IF EXISTS "clients_commerce_platform_check";
ALTER TABLE "clients" ADD CONSTRAINT "clients_commerce_platform_check"
  CHECK ("commerce_platform" IN ('UPZERO', 'NUVEMSHOP', 'MANUAL', 'VESTI', 'BRAAVO'));
ALTER TABLE "clients" ADD CONSTRAINT "clients_braavo_b2c_check"
  CHECK ("commerce_platform" <> 'BRAAVO' OR "dashboard_type" = 'B2C');
--> statement-breakpoint
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "utm_source" text,
  ADD COLUMN IF NOT EXISTS "utm_medium" text,
  ADD COLUMN IF NOT EXISTS "utm_campaign" text,
  ADD COLUMN IF NOT EXISTS "utm_content" text,
  ADD COLUMN IF NOT EXISTS "utm_term" text,
  ADD COLUMN IF NOT EXISTS "source_metadata" jsonb;
--> statement-breakpoint
CREATE TABLE "braavo_sync_states" (
  "client_id" text PRIMARY KEY REFERENCES "clients"("id") ON DELETE CASCADE,
  "fingerprint" text NOT NULL,
  "job_id" text,
  "cursor" jsonb,
  "completed_at" timestamptz,
  "full_completed_at" timestamptz,
  "lease_id" text,
  "lease_until" timestamptz,
  "error" text,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE "braavo_catalog" (
  "client_id" text NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "external_id" text NOT NULL,
  "data" jsonb NOT NULL,
  PRIMARY KEY ("client_id", "kind", "external_id")
);
CREATE TABLE "braavo_request_slots" (
  "domain" text PRIMARY KEY,
  "next_at" timestamptz NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "source_synced_at" timestamptz;
