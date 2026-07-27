-- Analytics read-path indexes for larger date ranges.
-- These are additive and safe to run multiple times.

CREATE INDEX IF NOT EXISTS "orders_client_created_status_idx"
  ON "orders" ("client_id", "created_at", "status");

CREATE INDEX IF NOT EXISTS "orders_client_customer_created_idx"
  ON "orders" ("client_id", "customer_id", "created_at");

CREATE INDEX IF NOT EXISTS "orders_client_state_created_idx"
  ON "orders" ("client_id", "state", "created_at")
  WHERE "state" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "events_client_created_type_idx"
  ON "events" ("client_id", "created_at", "event_type");

CREATE INDEX IF NOT EXISTS "events_client_customer_created_idx"
  ON "events" ("client_id", "customer_id", "created_at")
  WHERE "customer_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "events_client_product_created_idx"
  ON "events" ("client_id", "product_id", "created_at")
  WHERE "product_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "customers_client_created_status_idx"
  ON "customers" ("client_id", "created_at", "registration_status");

CREATE INDEX IF NOT EXISTS "customers_client_document_type_idx"
  ON "customers" ("client_id", "document_type")
  WHERE "document_type" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "customers_client_state_created_idx"
  ON "customers" ("client_id", "state", "created_at")
  WHERE "state" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "customers_client_utm_idx"
  ON "customers" ("client_id", "utm_source", "utm_medium", "utm_campaign");

CREATE INDEX IF NOT EXISTS "customers_client_total_orders_idx"
  ON "customers" ("client_id", "total_orders");

CREATE INDEX IF NOT EXISTS "products_client_category_status_idx"
  ON "products" ("client_id", "category", "status");

CREATE INDEX IF NOT EXISTS "products_client_stock_idx"
  ON "products" ("client_id", "stock");

CREATE INDEX IF NOT EXISTS "products_client_total_sold_idx"
  ON "products" ("client_id", "total_sold");

CREATE INDEX IF NOT EXISTS "order_items_product_order_idx"
  ON "order_items" ("product_id", "order_id");
