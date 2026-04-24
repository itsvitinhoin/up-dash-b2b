CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"role" text DEFAULT 'CLIENT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"api_key" text NOT NULL,
	"admin_id" text,
	"user_id" text,
	"revenue_ytd" double precision DEFAULT 0 NOT NULL,
	"orders_ytd" integer DEFAULT 0 NOT NULL,
	"leads_ytd" integer DEFAULT 0 NOT NULL,
	"approved_leads" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_name_unique" UNIQUE("name"),
	CONSTRAINT "clients_email_unique" UNIQUE("email"),
	CONSTRAINT "clients_api_key_unique" UNIQUE("api_key")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"name" text,
	"state" text,
	"city" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_content" text,
	"utm_term" text,
	"registration_status" text DEFAULT 'PENDING' NOT NULL,
	"approval_date" timestamp with time zone,
	"rfm_segment" text,
	"recency_score" integer,
	"frequency_score" integer,
	"monetary_score" integer,
	"total_orders" integer DEFAULT 0 NOT NULL,
	"total_spent" double precision DEFAULT 0 NOT NULL,
	"first_purchase_at" timestamp with time zone,
	"last_purchase_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"price" double precision NOT NULL,
	"cost" double precision,
	"stock" integer DEFAULT 0 NOT NULL,
	"image_url" text,
	"total_sold" integer DEFAULT 0 NOT NULL,
	"total_revenue" double precision DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sellers" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"total_orders" integer DEFAULT 0 NOT NULL,
	"total_revenue" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"product_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"price_at_sale" double precision NOT NULL,
	"size" text,
	"color" text
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"seller_id" text,
	"amount" double precision NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"approval_date" timestamp with time zone,
	"state" text,
	"city" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"customer_id" text,
	"event_type" text NOT NULL,
	"product_id" text,
	"order_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creatives" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"platform" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"image_url" text,
	"clicks" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"spend" double precision DEFAULT 0 NOT NULL,
	"leads" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sellers" ADD CONSTRAINT "sellers_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "clients_admin_idx" ON "clients" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "clients_user_idx" ON "clients" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_client_email_uq" ON "customers" USING btree ("client_id","email");--> statement-breakpoint
CREATE INDEX "customers_client_idx" ON "customers" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "customers_rfm_idx" ON "customers" USING btree ("client_id","rfm_segment");--> statement-breakpoint
CREATE INDEX "customers_status_idx" ON "customers" USING btree ("client_id","registration_status");--> statement-breakpoint
CREATE INDEX "customers_client_created_idx" ON "customers" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "products_client_sku_uq" ON "products" USING btree ("client_id","sku");--> statement-breakpoint
CREATE INDEX "products_client_idx" ON "products" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category");--> statement-breakpoint
CREATE INDEX "products_client_created_idx" ON "products" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sellers_client_email_uq" ON "sellers" USING btree ("client_id","email");--> statement-breakpoint
CREATE INDEX "sellers_client_idx" ON "sellers" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "sellers_client_created_idx" ON "sellers" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_product_idx" ON "order_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "orders_client_idx" ON "orders" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "orders_seller_idx" ON "orders" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orders_client_created_idx" ON "orders" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE INDEX "events_client_idx" ON "events" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "events_customer_idx" ON "events" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "events_type_idx" ON "events" USING btree ("client_id","event_type");--> statement-breakpoint
CREATE INDEX "events_created_idx" ON "events" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE INDEX "creatives_client_idx" ON "creatives" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "creatives_client_created_idx" ON "creatives" USING btree ("client_id","created_at");
