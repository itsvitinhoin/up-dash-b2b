CREATE TABLE "paid_touchpoints_sync" (
	"client_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"synced_from" timestamp with time zone NOT NULL,
	"synced_to" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "paid_touchpoints_sync_client_id_customer_id_pk" PRIMARY KEY("client_id","customer_id")
);
--> statement-breakpoint
ALTER TABLE "paid_touchpoints_sync" ADD CONSTRAINT "paid_touchpoints_sync_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "paid_touchpoints_sync" ADD CONSTRAINT "paid_touchpoints_sync_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
