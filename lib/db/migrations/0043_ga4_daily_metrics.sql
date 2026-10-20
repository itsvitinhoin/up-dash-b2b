CREATE TABLE "ga4_daily_metrics" (
	"client_id" text NOT NULL,
	"metric_date" date NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"page_views" integer DEFAULT 0 NOT NULL,
	"product_views" integer DEFAULT 0 NOT NULL,
	"add_to_carts" integer DEFAULT 0 NOT NULL,
	"checkouts" integer DEFAULT 0 NOT NULL,
	"purchases" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ga4_daily_metrics_client_id_metric_date_pk" PRIMARY KEY("client_id","metric_date")
);
--> statement-breakpoint
ALTER TABLE "ga4_daily_metrics" ADD CONSTRAINT "ga4_daily_metrics_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ga4_daily_metrics_date_idx" ON "ga4_daily_metrics" USING btree ("metric_date");