CREATE TABLE IF NOT EXISTS "whatsapp_agents" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL REFERENCES "clients"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "phone_number_id" text,
  "external_agent_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "whatsapp_contacts" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL REFERENCES "clients"("id") ON DELETE cascade,
  "wa_id" text NOT NULL,
  "name" text,
  "phone" text NOT NULL,
  "raw_payload" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "whatsapp_conversations" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL REFERENCES "clients"("id") ON DELETE cascade,
  "contact_id" text REFERENCES "whatsapp_contacts"("id") ON DELETE cascade,
  "agent_id" text REFERENCES "whatsapp_agents"("id") ON DELETE set null,
  "external_conversation_id" text,
  "status" text DEFAULT 'new' NOT NULL,
  "funnel_stage" text DEFAULT 'new_lead' NOT NULL,
  "first_message_at" timestamp with time zone,
  "first_response_at" timestamp with time zone,
  "closed_at" timestamp with time zone,
  "lost_reason" text,
  "raw_payload" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "whatsapp_messages" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL REFERENCES "clients"("id") ON DELETE cascade,
  "conversation_id" text REFERENCES "whatsapp_conversations"("id") ON DELETE cascade,
  "contact_id" text REFERENCES "whatsapp_contacts"("id") ON DELETE set null,
  "external_message_id" text,
  "direction" text NOT NULL,
  "message_type" text,
  "body" text,
  "raw_payload" jsonb,
  "sent_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "whatsapp_conversation_events" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL REFERENCES "clients"("id") ON DELETE cascade,
  "conversation_id" text REFERENCES "whatsapp_conversations"("id") ON DELETE cascade,
  "event_type" text NOT NULL,
  "from_stage" text,
  "to_stage" text,
  "metadata" jsonb,
  "occurred_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "whatsapp_agents_client_idx" ON "whatsapp_agents" ("client_id");
CREATE INDEX IF NOT EXISTS "whatsapp_contacts_client_idx" ON "whatsapp_contacts" ("client_id");
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_contacts_client_wa_id_unique" ON "whatsapp_contacts" ("client_id", "wa_id");
CREATE INDEX IF NOT EXISTS "whatsapp_conversations_client_idx" ON "whatsapp_conversations" ("client_id");
CREATE INDEX IF NOT EXISTS "whatsapp_conversations_status_idx" ON "whatsapp_conversations" ("client_id", "status");
CREATE INDEX IF NOT EXISTS "whatsapp_conversations_stage_idx" ON "whatsapp_conversations" ("client_id", "funnel_stage");
CREATE INDEX IF NOT EXISTS "whatsapp_messages_conversation_idx" ON "whatsapp_messages" ("conversation_id");
CREATE INDEX IF NOT EXISTS "whatsapp_messages_sent_at_idx" ON "whatsapp_messages" ("client_id", "sent_at");
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_messages_external_unique" ON "whatsapp_messages" ("client_id", "external_message_id");
CREATE INDEX IF NOT EXISTS "whatsapp_conversation_events_conversation_idx" ON "whatsapp_conversation_events" ("conversation_id");
CREATE INDEX IF NOT EXISTS "whatsapp_conversation_events_occurred_at_idx" ON "whatsapp_conversation_events" ("client_id", "occurred_at");
