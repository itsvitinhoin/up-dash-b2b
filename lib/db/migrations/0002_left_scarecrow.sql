CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"type" text NOT NULL,
	"severity" text DEFAULT 'INFO' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"signal_key" text NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_client_idx" ON "notifications" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "notifications_client_created_idx" ON "notifications" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_signal_uq" ON "notifications" USING btree ("client_id","signal_key");--> statement-breakpoint
CREATE INDEX "saved_views_user_idx" ON "saved_views" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "saved_views_user_client_idx" ON "saved_views" USING btree ("user_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_views_user_client_name_uq" ON "saved_views" USING btree ("user_id","client_id","name");