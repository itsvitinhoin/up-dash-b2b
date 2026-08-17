DROP INDEX IF EXISTS "whatsapp_integrations_client_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_integrations_client_waba_unique"
  ON "whatsapp_integrations" USING btree ("client_id", "waba_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_integrations_client_phone_idx"
  ON "whatsapp_integrations" USING btree ("client_id", "phone_number_id");
