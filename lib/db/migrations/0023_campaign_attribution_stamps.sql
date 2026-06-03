CREATE TABLE IF NOT EXISTS "campaign_attribution_stamps" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL REFERENCES "clients"("id") ON DELETE cascade,
  "customer_id" text NOT NULL REFERENCES "customers"("id") ON DELETE cascade,
  "user_id" integer,
  "source" text,
  "medium" text,
  "campaign" text,
  "label" text,
  "evidence_type" text NOT NULL DEFAULT 'tracking',
  "evidence_event_name" text,
  "evidence_event_id" text,
  "evidence_at" timestamp with time zone,
  "first_seen_at" timestamp with time zone,
  "last_seen_at" timestamp with time zone,
  "total_purchase_value_at_stamp" double precision NOT NULL DEFAULT 0,
  "purchase_count_at_stamp" integer NOT NULL DEFAULT 0,
  "raw_evidence" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "campaign_attribution_stamps_client_idx"
  ON "campaign_attribution_stamps" ("client_id");

CREATE INDEX IF NOT EXISTS "campaign_attribution_stamps_customer_idx"
  ON "campaign_attribution_stamps" ("customer_id");

CREATE INDEX IF NOT EXISTS "campaign_attribution_stamps_user_idx"
  ON "campaign_attribution_stamps" ("client_id", "user_id");

CREATE UNIQUE INDEX IF NOT EXISTS "campaign_attribution_stamps_customer_uq"
  ON "campaign_attribution_stamps" ("client_id", "customer_id");
