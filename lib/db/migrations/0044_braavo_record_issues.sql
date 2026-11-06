CREATE TABLE IF NOT EXISTS "braavo_record_issues" (
  "client_id" text NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "phase" text NOT NULL,
  "external_id" text NOT NULL,
  "reason" text NOT NULL,
  "attempts" integer NOT NULL DEFAULT 1,
  "first_seen_at" timestamptz NOT NULL DEFAULT now(),
  "last_seen_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("client_id", "phase", "external_id")
);
