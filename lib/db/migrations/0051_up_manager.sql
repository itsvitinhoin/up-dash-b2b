CREATE TABLE IF NOT EXISTS "product_campaign_checks" (
  "client_id" text PRIMARY KEY REFERENCES "clients"("id") ON DELETE CASCADE,
  "payload" jsonb,
  "checked_at" timestamptz,
  "attempted_at" timestamptz,
  "error" text,
  "lease_until" timestamptz,
  "lease_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_campaign_reviews" (
  "client_id" text NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "recommendation_id" text NOT NULL,
  "decision" text NOT NULL,
  "reviewer_user_id" text NOT NULL,
  "reviewed_at" timestamptz NOT NULL DEFAULT now(),
  "evidence" jsonb NOT NULL,
  PRIMARY KEY ("client_id", "recommendation_id"),
  CONSTRAINT "product_campaign_reviews_decision_check" CHECK ("decision" IN ('agree', 'dismiss', 'investigate'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_campaign_reviews_client_time_idx"
  ON "product_campaign_reviews" ("client_id", "reviewed_at" DESC);
--> statement-breakpoint
ALTER TABLE "product_campaign_reviews" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "product_campaign_reviews" FROM PUBLIC;
--> statement-breakpoint
ALTER TABLE "product_campaign_checks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "product_campaign_checks" FROM PUBLIC;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "up_manager_reports" (
  "client_id" text NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "analysis_day" text NOT NULL,
  "date_from" text NOT NULL,
  "date_to" text NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("client_id", "analysis_day", "date_from", "date_to")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "up_manager_reports_recent_idx" ON "up_manager_reports" ("client_id", "created_at" DESC);
--> statement-breakpoint
ALTER TABLE "up_manager_reports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "up_manager_reports" FROM PUBLIC;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "up_manager_ad_actions" (
  "client_id" text NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "recommendation_id" text NOT NULL,
  "actor_user_id" text NOT NULL,
  "account_id" text NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('pending', 'paused', 'stale', 'uncertain')),
  "evidence" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("client_id", "recommendation_id")
);
--> statement-breakpoint
ALTER TABLE "up_manager_ad_actions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "up_manager_ad_actions" FROM PUBLIC;
