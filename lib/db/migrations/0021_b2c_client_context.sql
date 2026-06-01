ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "dashboard_type" text NOT NULL DEFAULT 'B2B',
  ADD COLUMN IF NOT EXISTS "commerce_platform" text NOT NULL DEFAULT 'UPZERO',
  ADD COLUMN IF NOT EXISTS "nuvemshop_store_id" text,
  ADD COLUMN IF NOT EXISTS "nuvemshop_access_token" text,
  ADD COLUMN IF NOT EXISTS "ga4_measurement_id" text,
  ADD COLUMN IF NOT EXISTS "ga4_property_id" text,
  ADD COLUMN IF NOT EXISTS "ga4_api_secret" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'clients_dashboard_type_check'
  ) THEN
    ALTER TABLE "clients"
      ADD CONSTRAINT "clients_dashboard_type_check"
      CHECK ("dashboard_type" IN ('B2B', 'B2C'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'clients_commerce_platform_check'
  ) THEN
    ALTER TABLE "clients"
      ADD CONSTRAINT "clients_commerce_platform_check"
      CHECK ("commerce_platform" IN ('UPZERO', 'NUVEMSHOP', 'MANUAL'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "clients_dashboard_type_idx"
  ON "clients" ("dashboard_type");

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "gross_amount" double precision NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "discount_amount" double precision NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "shipping_amount" double precision NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "refunded_amount" double precision NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "cancelled_amount" double precision NOT NULL DEFAULT 0;

ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "gross_price_at_sale" double precision NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "discount_amount" double precision NOT NULL DEFAULT 0;
