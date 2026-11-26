CREATE TABLE IF NOT EXISTS "google_ads_insight_snapshots" (
  "client_id" text NOT NULL REFERENCES "google_ads_connections" ("client_id") ON DELETE CASCADE,
  "view" text NOT NULL,
  "date_from" date NOT NULL,
  "date_to" date NOT NULL,
  "data" jsonb NOT NULL,
  "fetched_at" timestamp with time zone NOT NULL,
  PRIMARY KEY ("client_id", "view", "date_from", "date_to")
);
