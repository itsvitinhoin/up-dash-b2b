ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "erp_provider" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "erp_credentials_encrypted" text;
