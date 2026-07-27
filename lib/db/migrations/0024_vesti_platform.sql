ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "bigquery_dataset" text;

ALTER TABLE "clients"
  DROP CONSTRAINT IF EXISTS "clients_commerce_platform_check";

ALTER TABLE "clients"
  ADD CONSTRAINT "clients_commerce_platform_check"
  CHECK ("commerce_platform" IN ('UPZERO', 'NUVEMSHOP', 'MANUAL', 'VESTI'));
