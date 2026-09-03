CREATE TABLE "paid_touchpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"external_user_id" integer,
	"occurred_at" timestamp with time zone NOT NULL,
	"event_name" text,
	"source" text,
	"medium" text,
	"campaign" text,
	"fbc" text,
	"fbclid" text,
	"gclid" text,
	"evidence_key" text NOT NULL,
	"raw_event" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paid_touchpoints" ADD CONSTRAINT "paid_touchpoints_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "paid_touchpoints" ADD CONSTRAINT "paid_touchpoints_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "paid_touchpoints_client_customer_evidence_uq" ON "paid_touchpoints" USING btree ("client_id","customer_id","evidence_key");
--> statement-breakpoint
CREATE INDEX "paid_touchpoints_client_customer_occurred_idx" ON "paid_touchpoints" USING btree ("client_id","customer_id","occurred_at");
