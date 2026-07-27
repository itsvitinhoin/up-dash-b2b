ALTER TABLE "whatsapp_phone_numbers"
  ADD COLUMN IF NOT EXISTS "is_default" boolean DEFAULT false NOT NULL;

WITH duplicate_defaults AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "client_id"
      ORDER BY "updated_at" DESC, "created_at" DESC, "id"
    ) AS default_rank
  FROM "whatsapp_phone_numbers"
  WHERE "status" = 'active' AND "is_default" = true
)
UPDATE "whatsapp_phone_numbers" phone
SET "is_default" = false,
    "updated_at" = now()
FROM duplicate_defaults duplicate
WHERE phone."id" = duplicate."id"
  AND duplicate.default_rank > 1;

WITH ranked_numbers AS (
  SELECT
    "id",
    "client_id",
    ROW_NUMBER() OVER (
      PARTITION BY "client_id"
      ORDER BY "updated_at" DESC, "created_at" DESC, "id"
    ) AS row_number
  FROM "whatsapp_phone_numbers"
  WHERE "status" = 'active'
), clients_without_default AS (
  SELECT DISTINCT ranked."client_id"
  FROM "whatsapp_phone_numbers" ranked
  WHERE ranked."status" = 'active'
    AND NOT EXISTS (
      SELECT 1
      FROM "whatsapp_phone_numbers" current_default
      WHERE current_default."client_id" = ranked."client_id"
        AND current_default."status" = 'active'
        AND current_default."is_default" = true
    )
)
UPDATE "whatsapp_phone_numbers" phone
SET "is_default" = true,
    "updated_at" = now()
FROM ranked_numbers ranked
JOIN clients_without_default missing
  ON missing."client_id" = ranked."client_id"
WHERE phone."id" = ranked."id"
  AND ranked.row_number = 1;

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_phone_numbers_client_default_unique"
  ON "whatsapp_phone_numbers" ("client_id")
  WHERE "is_default" = true AND "status" = 'active';
