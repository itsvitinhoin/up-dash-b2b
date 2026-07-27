CREATE TABLE IF NOT EXISTS "ecommerce_webhook_events" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL,
  "event_id" text,
  "event_type" text NOT NULL,
  "external_customer_id" text,
  "external_order_id" text,
  "external_cart_id" text,
  "external_checkout_id" text,
  "payload" jsonb,
  "normalized_payload" jsonb,
  "status" text DEFAULT 'received' NOT NULL,
  "error_message" text,
  "occurred_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ecommerce_webhook_events_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id")
    ON DELETE cascade
);

CREATE INDEX IF NOT EXISTS "ecommerce_webhook_events_client_idx"
  ON "ecommerce_webhook_events" ("client_id");

CREATE INDEX IF NOT EXISTS "ecommerce_webhook_events_type_idx"
  ON "ecommerce_webhook_events" ("client_id", "event_type");

CREATE INDEX IF NOT EXISTS "ecommerce_webhook_events_status_idx"
  ON "ecommerce_webhook_events" ("client_id", "status");

CREATE INDEX IF NOT EXISTS "ecommerce_webhook_events_occurred_idx"
  ON "ecommerce_webhook_events" ("client_id", "occurred_at");

CREATE UNIQUE INDEX IF NOT EXISTS "ecommerce_webhook_events_client_event_unique"
  ON "ecommerce_webhook_events" ("client_id", "event_id")
  WHERE "event_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "ai_crm_cards" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL,
  "conversation_id" text,
  "customer_id" text,
  "whatsapp_contact_id" text,
  "lead_profile_id" text,
  "stage" text DEFAULT 'new_contact' NOT NULL,
  "previous_stage" text,
  "intent" text,
  "priority" text DEFAULT 'medium' NOT NULL,
  "estimated_value" double precision DEFAULT 0 NOT NULL,
  "assigned_to_type" text DEFAULT 'ai' NOT NULL,
  "assigned_to_user_id" text,
  "handoff_required" boolean DEFAULT false NOT NULL,
  "handoff_reason" text,
  "last_interaction_at" timestamp with time zone,
  "next_action_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_crm_cards_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id")
    ON DELETE cascade,
  CONSTRAINT "ai_crm_cards_customer_id_customers_id_fk"
    FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id")
    ON DELETE set null
);

CREATE INDEX IF NOT EXISTS "ai_crm_cards_client_idx"
  ON "ai_crm_cards" ("client_id");

CREATE INDEX IF NOT EXISTS "ai_crm_cards_customer_idx"
  ON "ai_crm_cards" ("customer_id");

CREATE INDEX IF NOT EXISTS "ai_crm_cards_stage_idx"
  ON "ai_crm_cards" ("client_id", "stage");

CREATE INDEX IF NOT EXISTS "ai_crm_cards_handoff_idx"
  ON "ai_crm_cards" ("client_id", "handoff_required");

CREATE INDEX IF NOT EXISTS "ai_crm_cards_last_interaction_idx"
  ON "ai_crm_cards" ("client_id", "last_interaction_at");

CREATE TABLE IF NOT EXISTS "commercial_automation_rules" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL,
  "operation_id" text,
  "event_type" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "is_enabled" boolean DEFAULT false NOT NULL,
  "template_id" text,
  "template_name" text,
  "template_language" text,
  "template_category" text,
  "delay_minutes" integer DEFAULT 0 NOT NULL,
  "send_window_start" text,
  "send_window_end" text,
  "cooldown_hours" integer DEFAULT 24 NOT NULL,
  "max_sends_per_customer_month" integer DEFAULT 4 NOT NULL,
  "conditions" jsonb,
  "variable_mapping" jsonb,
  "media_settings" jsonb,
  "cost_settings" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "commercial_automation_rules_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id")
    ON DELETE cascade
);

CREATE INDEX IF NOT EXISTS "commercial_automation_rules_client_idx"
  ON "commercial_automation_rules" ("client_id");

CREATE INDEX IF NOT EXISTS "commercial_automation_rules_event_idx"
  ON "commercial_automation_rules" ("client_id", "event_type");

CREATE INDEX IF NOT EXISTS "commercial_automation_rules_enabled_idx"
  ON "commercial_automation_rules" ("client_id", "is_enabled");

CREATE UNIQUE INDEX IF NOT EXISTS "commercial_automation_rules_client_event_unique"
  ON "commercial_automation_rules" ("client_id", "event_type");

CREATE TABLE IF NOT EXISTS "commercial_automation_logs" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL,
  "rule_id" text,
  "job_id" text,
  "event_type" text NOT NULL,
  "action" text NOT NULL,
  "status" text NOT NULL,
  "message" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "commercial_automation_logs_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id")
    ON DELETE cascade,
  CONSTRAINT "commercial_automation_logs_rule_id_commercial_automation_rules_id_fk"
    FOREIGN KEY ("rule_id") REFERENCES "public"."commercial_automation_rules"("id")
    ON DELETE set null
);

CREATE INDEX IF NOT EXISTS "commercial_automation_logs_client_idx"
  ON "commercial_automation_logs" ("client_id");

CREATE INDEX IF NOT EXISTS "commercial_automation_logs_status_idx"
  ON "commercial_automation_logs" ("client_id", "status");

CREATE INDEX IF NOT EXISTS "commercial_automation_logs_event_idx"
  ON "commercial_automation_logs" ("client_id", "event_type");

CREATE INDEX IF NOT EXISTS "commercial_automation_logs_created_idx"
  ON "commercial_automation_logs" ("client_id", "created_at");
