CREATE TABLE IF NOT EXISTS "google_ads_connections" (
  "client_id" text PRIMARY KEY REFERENCES "clients" ("id") ON DELETE CASCADE,
  "customer_id" text NOT NULL UNIQUE,
  "manager_id" text,
  "account_name" text NOT NULL,
  "currency" text NOT NULL,
  "time_zone" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "google_ads_daily" (
  "customer_id" text NOT NULL REFERENCES "google_ads_connections" ("customer_id") ON DELETE CASCADE,
  "day" date NOT NULL,
  "campaigns" jsonb NOT NULL,
  "fetched_at" timestamp with time zone NOT NULL,
  PRIMARY KEY ("customer_id", "day")
);
