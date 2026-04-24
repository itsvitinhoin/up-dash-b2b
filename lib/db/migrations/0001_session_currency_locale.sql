-- Hardening delta: opaque-token sessions table + per-client currency/locale.
-- Hand-written so it is idempotent: safe on a freshly-migrated DB (where
-- 0000 just ran and these objects don't exist) AND on a partial-upgrade DB
-- whose schema was previously applied via `db push` and may already contain
-- some/all of these objects.

CREATE TABLE IF NOT EXISTS "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"user_agent" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "sessions_refresh_token_hash_unique" UNIQUE("refresh_token_hash")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
		ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "currency" text DEFAULT 'BRL' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "locale" text DEFAULT 'pt-BR' NOT NULL;
