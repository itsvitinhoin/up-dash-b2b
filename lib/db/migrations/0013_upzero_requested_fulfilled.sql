ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "requested_quantity" integer DEFAULT 0 NOT NULL;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "fulfilled_quantity" integer DEFAULT 0 NOT NULL;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "fulfilled_amount" double precision DEFAULT 0 NOT NULL;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "fulfilled_quantity" integer DEFAULT 0 NOT NULL;

UPDATE "order_items"
SET "fulfilled_quantity" = "quantity"
WHERE "fulfilled_quantity" = 0
  AND "quantity" > 0;

UPDATE "orders" o
SET
  "requested_quantity" = COALESCE(agg.requested_quantity, 0),
  "fulfilled_quantity" = COALESCE(NULLIF(o."fulfilled_quantity", 0), COALESCE(agg.fulfilled_quantity, 0)),
  "fulfilled_amount" = CASE
    WHEN o."fulfilled_amount" = 0 AND o."status" IN ('APPROVED', 'SHIPPED', 'DELIVERED') THEN o."amount"
    ELSE o."fulfilled_amount"
  END
FROM (
  SELECT
    "order_id",
    COALESCE(SUM("quantity"), 0)::int AS requested_quantity,
    COALESCE(SUM("fulfilled_quantity"), 0)::int AS fulfilled_quantity
  FROM "order_items"
  GROUP BY "order_id"
) agg
WHERE o."id" = agg."order_id";
