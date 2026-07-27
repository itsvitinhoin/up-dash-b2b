CREATE TABLE IF NOT EXISTS "upzero_integrations" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL,
  "base_url" text DEFAULT 'https://api.upzero.com.br' NOT NULL,
  "auth_type" text DEFAULT 'api_key' NOT NULL,
  "encrypted_api_key" text,
  "encrypted_token" text,
  "store_external_id" text,
  "tenant_id" text,
  "environment" text DEFAULT 'production' NOT NULL,
  "status" text DEFAULT 'not_configured' NOT NULL,
  "last_sync_at" timestamp with time zone,
  "last_error" text,
  "raw_config" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "upzero_integrations_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id")
    ON DELETE cascade
);

CREATE INDEX IF NOT EXISTS "upzero_integrations_client_idx"
  ON "upzero_integrations" ("client_id");

CREATE UNIQUE INDEX IF NOT EXISTS "upzero_integrations_client_unique"
  ON "upzero_integrations" ("client_id");

CREATE TABLE IF NOT EXISTS "ai_commercial_operations" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL,
  "status" text DEFAULT 'paused' NOT NULL,
  "autonomy_mode" text DEFAULT 'assisted' NOT NULL,
  "order_flow_mode" text DEFAULT 'pre_order_stock_confirmation' NOT NULL,
  "price_requires_approved_registration" boolean DEFAULT true NOT NULL,
  "allow_catalog_without_price" boolean DEFAULT true NOT NULL,
  "allow_product_without_price" boolean DEFAULT true NOT NULL,
  "allow_auto_registration" boolean DEFAULT false NOT NULL,
  "require_human_approval_before_registration_post" boolean DEFAULT true NOT NULL,
  "allow_pre_order_creation" boolean DEFAULT false NOT NULL,
  "allow_checkout_link" boolean DEFAULT false NOT NULL,
  "stock_confirmation_required" boolean DEFAULT true NOT NULL,
  "shipping_after_stock_confirmation" boolean DEFAULT true NOT NULL,
  "payment_after_stock_confirmation" boolean DEFAULT true NOT NULL,
  "handoff_high_value_threshold" double precision DEFAULT 0 NOT NULL,
  "daily_cost_limit" double precision DEFAULT 0 NOT NULL,
  "monthly_cost_limit" double precision DEFAULT 0 NOT NULL,
  "pause_on_cost_limit" boolean DEFAULT true NOT NULL,
  "alert_cost_percent" double precision DEFAULT 80 NOT NULL,
  "currency" text DEFAULT 'BRL' NOT NULL,
  "usd_brl_rate" double precision DEFAULT 5 NOT NULL,
  "agency_markup_percent" double precision DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_commercial_operations_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id")
    ON DELETE cascade
);

CREATE INDEX IF NOT EXISTS "ai_commercial_operations_client_idx"
  ON "ai_commercial_operations" ("client_id");

CREATE INDEX IF NOT EXISTS "ai_commercial_operations_status_idx"
  ON "ai_commercial_operations" ("client_id", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "ai_commercial_operations_client_unique"
  ON "ai_commercial_operations" ("client_id");

CREATE TABLE IF NOT EXISTS "ai_agent_configs" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL,
  "operation_id" text,
  "agent_type" text NOT NULL,
  "name" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "model" text DEFAULT 'gpt-4.1-mini' NOT NULL,
  "temperature" double precision DEFAULT 0.2 NOT NULL,
  "max_input_tokens" integer DEFAULT 12000 NOT NULL,
  "max_output_tokens" integer DEFAULT 1200 NOT NULL,
  "system_prompt" text,
  "autonomy_mode" text DEFAULT 'assisted' NOT NULL,
  "can_auto_reply" boolean DEFAULT false NOT NULL,
  "can_create_registration" boolean DEFAULT false NOT NULL,
  "can_create_pre_order" boolean DEFAULT false NOT NULL,
  "can_handoff" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_agent_configs_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id")
    ON DELETE cascade,
  CONSTRAINT "ai_agent_configs_operation_id_ai_commercial_operations_id_fk"
    FOREIGN KEY ("operation_id") REFERENCES "public"."ai_commercial_operations"("id")
    ON DELETE cascade
);

CREATE INDEX IF NOT EXISTS "ai_agent_configs_client_idx"
  ON "ai_agent_configs" ("client_id");

CREATE INDEX IF NOT EXISTS "ai_agent_configs_operation_idx"
  ON "ai_agent_configs" ("operation_id");

CREATE INDEX IF NOT EXISTS "ai_agent_configs_type_idx"
  ON "ai_agent_configs" ("client_id", "agent_type");

CREATE TABLE IF NOT EXISTS "ecommerce_webhook_configs" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL,
  "is_enabled" boolean DEFAULT false NOT NULL,
  "secret_hash" text,
  "source_name" text DEFAULT 'upzero' NOT NULL,
  "allowed_event_types" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ecommerce_webhook_configs_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id")
    ON DELETE cascade
);

CREATE INDEX IF NOT EXISTS "ecommerce_webhook_configs_client_idx"
  ON "ecommerce_webhook_configs" ("client_id");

CREATE UNIQUE INDEX IF NOT EXISTS "ecommerce_webhook_configs_client_unique"
  ON "ecommerce_webhook_configs" ("client_id");
