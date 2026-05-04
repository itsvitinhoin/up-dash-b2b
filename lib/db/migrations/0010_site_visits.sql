CREATE TABLE "site_visits" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"visit_date" date NOT NULL,
	"visit_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "site_visits_client_date_uniq" ON "site_visits" USING btree ("client_id","visit_date");--> statement-breakpoint
CREATE INDEX "site_visits_client_idx" ON "site_visits" USING btree ("client_id");
