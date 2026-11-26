CREATE TABLE IF NOT EXISTS "up_manager_followups" (
  "client_id" text NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "run_id" text NOT NULL REFERENCES "up_manager_archive"("run_id") ON DELETE CASCADE,
  "insight_id" text NOT NULL,
  "actor_user_id" text NOT NULL,
  "started_at" timestamptz NOT NULL,
  "measure_on" text NOT NULL,
  "plan" jsonb NOT NULL,
  "result" jsonb,
  PRIMARY KEY ("client_id", "run_id", "insight_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "up_manager_followups_due_idx" ON "up_manager_followups" ("client_id", "measure_on");
--> statement-breakpoint
ALTER TABLE "up_manager_followups" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "up_manager_followups" FROM PUBLIC;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "up_manager_weekly_goals" (
  "client_id" text NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "week_start" text NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "updated_by" text NOT NULL,
  "goals" jsonb NOT NULL,
  PRIMARY KEY ("client_id", "week_start")
);
--> statement-breakpoint
ALTER TABLE "up_manager_weekly_goals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "up_manager_weekly_goals" FROM PUBLIC;
