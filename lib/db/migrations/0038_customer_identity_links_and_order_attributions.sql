CREATE TABLE "customer_identity_links" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"erp_document_hash" text NOT NULL,
	"customer_id" text NOT NULL,
	"match_method" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_attributions" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"channel" text NOT NULL,
	"order_id" text NOT NULL,
	"customer_id" text,
	"attribution_state" text,
	"touchpoint_at" timestamp with time zone,
	"touchpoint_source" text,
	"touchpoint_medium" text,
	"touchpoint_campaign" text,
	"cohort" text,
	"rule_version" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_identity_links" ADD CONSTRAINT "customer_identity_links_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_identity_links" ADD CONSTRAINT "customer_identity_links_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_attributions" ADD CONSTRAINT "order_attributions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_attributions" ADD CONSTRAINT "order_attributions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_identity_links_client_document_uq" ON "customer_identity_links" USING btree ("client_id","erp_document_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "order_attributions_client_channel_order_uq" ON "order_attributions" USING btree ("client_id","channel","order_id");