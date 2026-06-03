ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "document_hash" text;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "document_last4" text;
CREATE INDEX IF NOT EXISTS "customers_client_document_hash_idx" ON "customers" ("client_id", "document_hash");
