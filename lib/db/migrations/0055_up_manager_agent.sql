CREATE TABLE IF NOT EXISTS "up_manager_insight_reviews" (
  "client_id" text NOT NULL REFERENCES "clients" ("id") ON DELETE CASCADE,
  "run_id" text NOT NULL REFERENCES "up_manager_archive" ("run_id") ON DELETE CASCADE,
  "insight_id" text NOT NULL,
  "actor_user_id" text NOT NULL,
  "reviewed_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("run_id", "insight_id")
);
--> statement-breakpoint
ALTER TABLE "up_manager_insight_reviews" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "up_manager_insight_reviews" FROM PUBLIC;
