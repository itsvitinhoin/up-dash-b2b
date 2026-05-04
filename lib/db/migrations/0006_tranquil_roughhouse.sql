ALTER TABLE "products" ADD COLUMN "external_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "products_client_external_id_uq" ON "products" USING btree ("client_id","external_id");