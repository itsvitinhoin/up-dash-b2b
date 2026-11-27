CREATE TABLE IF NOT EXISTS "up_manager_archive" (
  "run_id" text PRIMARY KEY,
  "client_id" text NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "analysis_day" text NOT NULL,
  "date_from" text NOT NULL,
  "date_to" text NOT NULL,
  "trigger" text NOT NULL CHECK ("trigger" IN ('manual', 'scheduled')),
  "version" text NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL,
  "archive_attempt" integer NOT NULL DEFAULT 0,
  "archived_at" timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "up_manager_archive_pending_idx"
  ON "up_manager_archive" ("client_id", "archived_at", "created_at");
--> statement-breakpoint
ALTER TABLE "up_manager_archive" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "up_manager_archive" FROM PUBLIC;
