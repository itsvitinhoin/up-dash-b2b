CREATE TABLE IF NOT EXISTS "ga4_product_views_daily" (
	"client_id" text NOT NULL,
	"metric_date" date NOT NULL,
	"item_id" text DEFAULT '' NOT NULL,
	"item_name" text DEFAULT '' NOT NULL,
	"item_variant" text DEFAULT '' NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ga4_product_views_daily_pk" PRIMARY KEY("client_id","metric_date","item_id","item_name","item_variant")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ga4_product_views_daily" ADD CONSTRAINT "ga4_product_views_daily_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ga4_product_views_daily_client_date_idx" ON "ga4_product_views_daily" USING btree ("client_id","metric_date");
