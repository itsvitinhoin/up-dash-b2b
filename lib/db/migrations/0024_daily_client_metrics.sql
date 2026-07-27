CREATE TABLE IF NOT EXISTS "daily_client_metrics" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL,
  "metric_date" date NOT NULL,
  "approved_revenue" double precision DEFAULT 0 NOT NULL,
  "requested_revenue" double precision DEFAULT 0 NOT NULL,
  "approved_orders" integer DEFAULT 0 NOT NULL,
  "requested_orders" integer DEFAULT 0 NOT NULL,
  "visits" integer DEFAULT 0 NOT NULL,
  "registrations" integer DEFAULT 0 NOT NULL,
  "approved_registrations" integer DEFAULT 0 NOT NULL,
  "purchases" integer DEFAULT 0 NOT NULL,
  "new_buyers" integer DEFAULT 0 NOT NULL,
  "returning_buyers" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "daily_client_metrics_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id")
    ON DELETE cascade
);

CREATE UNIQUE INDEX IF NOT EXISTS "daily_client_metrics_client_date_uq"
  ON "daily_client_metrics" ("client_id", "metric_date");

CREATE INDEX IF NOT EXISTS "daily_client_metrics_client_date_idx"
  ON "daily_client_metrics" ("client_id", "metric_date");
