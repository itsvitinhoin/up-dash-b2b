CREATE TABLE IF NOT EXISTS "whatsapp_phone_numbers" (
  "id" text PRIMARY KEY,
  "client_id" text NOT NULL REFERENCES "clients" ("id") ON DELETE cascade,
  "integration_id" text REFERENCES "whatsapp_integrations" ("id") ON DELETE set null,
  "waba_id" text,
  "phone_number_id" text NOT NULL,
  "display_phone_number" text,
  "verified_name" text,
  "quality_rating" text,
  "platform_type" text,
  "code_verification_status" text,
  "status" text NOT NULL DEFAULT 'active',
  "raw_payload" jsonb,
  "last_synced_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "whatsapp_phone_numbers_client_idx"
  ON "whatsapp_phone_numbers" ("client_id");

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_phone_numbers_client_phone_unique"
  ON "whatsapp_phone_numbers" ("client_id", "phone_number_id");

ALTER TABLE "whatsapp_conversations"
  ADD COLUMN IF NOT EXISTS "phone_number_id" text;

ALTER TABLE "whatsapp_messages"
  ADD COLUMN IF NOT EXISTS "phone_number_id" text;

CREATE INDEX IF NOT EXISTS "whatsapp_conversations_phone_idx"
  ON "whatsapp_conversations" ("client_id", "phone_number_id");

CREATE INDEX IF NOT EXISTS "whatsapp_messages_phone_idx"
  ON "whatsapp_messages" ("client_id", "phone_number_id");

INSERT INTO "whatsapp_phone_numbers" (
  "id",
  "client_id",
  "integration_id",
  "waba_id",
  "phone_number_id",
  "status",
  "raw_payload",
  "last_synced_at",
  "created_at",
  "updated_at"
)
SELECT
  'wpn_' || md5("client_id" || ':' || coalesce("phone_number_id", '')),
  "client_id",
  "id",
  "waba_id",
  "phone_number_id",
  'active',
  jsonb_build_object('source', 'backfill_from_integration'),
  now(),
  now(),
  now()
FROM "whatsapp_integrations"
WHERE "phone_number_id" IS NOT NULL
ON CONFLICT ("client_id", "phone_number_id") DO UPDATE SET
  "integration_id" = excluded."integration_id",
  "waba_id" = excluded."waba_id",
  "updated_at" = now();

UPDATE "whatsapp_conversations" c
SET "phone_number_id" = i."phone_number_id"
FROM "whatsapp_integrations" i
WHERE c."client_id" = i."client_id"
  AND c."phone_number_id" IS NULL
  AND i."phone_number_id" IS NOT NULL;

UPDATE "whatsapp_messages" m
SET "phone_number_id" = i."phone_number_id"
FROM "whatsapp_integrations" i
WHERE m."client_id" = i."client_id"
  AND m."phone_number_id" IS NULL
  AND i."phone_number_id" IS NOT NULL;
