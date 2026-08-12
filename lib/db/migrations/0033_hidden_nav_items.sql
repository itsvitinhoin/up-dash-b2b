ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "hidden_nav_items" text[];
