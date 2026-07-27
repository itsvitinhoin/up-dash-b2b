CREATE TABLE IF NOT EXISTS "commercial_automation_jobs" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL,
  "rule_id" text,
  "event_id" text,
  "conversation_id" text,
  "customer_id" text,
  "whatsapp_contact_id" text,
  "order_id" text,
  "status" text DEFAULT 'scheduled' NOT NULL,
  "scheduled_at" timestamp with time zone NOT NULL,
  "processed_at" timestamp with time zone,
  "sent_at" timestamp with time zone,
  "skip_reason" text,
  "error_message" text,
  "rendered_payload" jsonb,
  "whatsapp_message_ids" jsonb,
  "media_sent" jsonb,
  "openai_cost" double precision DEFAULT 0 NOT NULL,
  "whatsapp_cost" double precision DEFAULT 0 NOT NULL,
  "total_cost" double precision DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "commercial_automation_jobs_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id")
    ON DELETE cascade,
  CONSTRAINT "commercial_automation_jobs_rule_id_commercial_automation_rules_id_fk"
    FOREIGN KEY ("rule_id") REFERENCES "public"."commercial_automation_rules"("id")
    ON DELETE cascade,
  CONSTRAINT "commercial_automation_jobs_event_id_ecommerce_webhook_events_id_fk"
    FOREIGN KEY ("event_id") REFERENCES "public"."ecommerce_webhook_events"("id")
    ON DELETE set null,
  CONSTRAINT "commercial_automation_jobs_customer_id_customers_id_fk"
    FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id")
    ON DELETE set null,
  CONSTRAINT "commercial_automation_jobs_whatsapp_contact_id_whatsapp_contacts_id_fk"
    FOREIGN KEY ("whatsapp_contact_id") REFERENCES "public"."whatsapp_contacts"("id")
    ON DELETE set null
);

CREATE INDEX IF NOT EXISTS "commercial_automation_jobs_client_idx"
  ON "commercial_automation_jobs" ("client_id");

CREATE INDEX IF NOT EXISTS "commercial_automation_jobs_rule_idx"
  ON "commercial_automation_jobs" ("rule_id");

CREATE INDEX IF NOT EXISTS "commercial_automation_jobs_status_idx"
  ON "commercial_automation_jobs" ("client_id", "status");

CREATE INDEX IF NOT EXISTS "commercial_automation_jobs_scheduled_idx"
  ON "commercial_automation_jobs" ("client_id", "scheduled_at");
