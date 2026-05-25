CREATE TABLE IF NOT EXISTS "whatsapp_integrations" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL REFERENCES "clients"("id") ON DELETE cascade,
  "app_id" text,
  "config_id" text,
  "business_id" text,
  "waba_id" text,
  "phone_number_id" text,
  "signup_code" text,
  "status" text DEFAULT 'not_started' NOT NULL,
  "raw_payload" jsonb,
  "connected_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "whatsapp_integrations_client_idx" ON "whatsapp_integrations" ("client_id");
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_integrations_client_unique" ON "whatsapp_integrations" ("client_id");
