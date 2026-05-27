CREATE TABLE IF NOT EXISTS "whatsapp_message_templates" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL,
  "integration_id" text,
  "waba_id" text NOT NULL,
  "template_id" text,
  "name" text NOT NULL,
  "language" text NOT NULL,
  "status" text NOT NULL,
  "category" text,
  "components" jsonb,
  "raw_payload" jsonb,
  "last_synced_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "whatsapp_message_templates"
  ADD CONSTRAINT "whatsapp_message_templates_client_id_clients_id_fk"
  FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "whatsapp_message_templates"
  ADD CONSTRAINT "whatsapp_message_templates_integration_id_whatsapp_integrations_id_fk"
  FOREIGN KEY ("integration_id") REFERENCES "public"."whatsapp_integrations"("id")
  ON DELETE set null ON UPDATE no action;

CREATE INDEX IF NOT EXISTS "whatsapp_message_templates_client_idx"
  ON "whatsapp_message_templates" USING btree ("client_id");

CREATE INDEX IF NOT EXISTS "whatsapp_message_templates_waba_idx"
  ON "whatsapp_message_templates" USING btree ("client_id", "waba_id");

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_message_templates_client_waba_name_lang_unique"
  ON "whatsapp_message_templates" USING btree ("client_id", "waba_id", "name", "language");
