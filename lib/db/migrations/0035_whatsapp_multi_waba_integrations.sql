DROP INDEX IF EXISTS "whatsapp_integrations_client_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_integrations_client_waba_unique"
  ON "whatsapp_integrations" USING btree ("client_id", "waba_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_integrations_client_phone_idx"
  ON "whatsapp_integrations" USING btree ("client_id", "phone_number_id");
--> statement-breakpoint
WITH missing_wabas AS (
  SELECT DISTINCT ON (phone."client_id", phone."waba_id")
    phone."client_id",
    phone."waba_id",
    phone."phone_number_id"
  FROM "whatsapp_phone_numbers" AS phone
  WHERE phone."waba_id" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "whatsapp_integrations" AS existing
      WHERE existing."client_id" = phone."client_id"
        AND existing."waba_id" = phone."waba_id"
    )
  ORDER BY
    phone."client_id",
    phone."waba_id",
    phone."is_default" DESC,
    phone."updated_at" DESC
)
INSERT INTO "whatsapp_integrations" (
  "id",
  "client_id",
  "app_id",
  "config_id",
  "business_id",
  "waba_id",
  "phone_number_id",
  "signup_code",
  "access_token",
  "token_type",
  "token_expires_at",
  "token_error",
  "status",
  "raw_payload",
  "connected_at",
  "created_at",
  "updated_at"
)
SELECT
  'waba_' || substring(md5(missing."client_id" || ':' || missing."waba_id") from 1 for 24),
  missing."client_id",
  source."app_id",
  source."config_id",
  source."business_id",
  missing."waba_id",
  missing."phone_number_id",
  source."signup_code",
  source."access_token",
  source."token_type",
  source."token_expires_at",
  source."token_error",
  source."status",
  source."raw_payload",
  source."connected_at",
  now(),
  now()
FROM missing_wabas AS missing
JOIN LATERAL (
  SELECT integration.*
  FROM "whatsapp_integrations" AS integration
  WHERE integration."client_id" = missing."client_id"
  ORDER BY
    (integration."access_token" IS NOT NULL) DESC,
    integration."updated_at" DESC
  LIMIT 1
) AS source ON true
ON CONFLICT ("client_id", "waba_id") DO NOTHING;
--> statement-breakpoint
UPDATE "whatsapp_phone_numbers" AS phone
SET
  "integration_id" = integration."id",
  "updated_at" = now()
FROM "whatsapp_integrations" AS integration
WHERE phone."client_id" = integration."client_id"
  AND (
    (phone."waba_id" IS NOT NULL AND phone."waba_id" = integration."waba_id")
    OR phone."phone_number_id" = integration."phone_number_id"
  )
  AND phone."integration_id" IS DISTINCT FROM integration."id";
--> statement-breakpoint
UPDATE "whatsapp_phone_numbers" AS phone
SET
  "integration_id" = NULL,
  "updated_at" = now()
FROM "whatsapp_integrations" AS integration
WHERE phone."integration_id" = integration."id"
  AND phone."waba_id" IS NOT NULL
  AND integration."waba_id" IS DISTINCT FROM phone."waba_id"
  AND NOT EXISTS (
    SELECT 1
    FROM "whatsapp_integrations" AS exact_integration
    WHERE exact_integration."client_id" = phone."client_id"
      AND exact_integration."waba_id" = phone."waba_id"
  );
