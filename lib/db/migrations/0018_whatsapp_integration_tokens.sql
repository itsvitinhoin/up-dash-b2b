ALTER TABLE "whatsapp_integrations" ADD COLUMN IF NOT EXISTS "access_token" text;
ALTER TABLE "whatsapp_integrations" ADD COLUMN IF NOT EXISTS "token_type" text;
ALTER TABLE "whatsapp_integrations" ADD COLUMN IF NOT EXISTS "token_expires_at" timestamp with time zone;
ALTER TABLE "whatsapp_integrations" ADD COLUMN IF NOT EXISTS "token_error" text;
