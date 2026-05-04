ALTER TABLE "clients" ADD COLUMN "meta_ads_api_key" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "up_zero_api_key" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "external_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_client_external_id_uq" ON "customers" USING btree ("client_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_client_external_id_uq" ON "orders" USING btree ("client_id","external_id");