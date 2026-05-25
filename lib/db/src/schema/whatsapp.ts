import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { clientsTable } from "./clients";

export const whatsappIntegrationsTable = pgTable(
  "whatsapp_integrations",
  {
    id: text("id").primaryKey().$defaultFn(() => nanoid()),
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    appId: text("app_id"),
    configId: text("config_id"),
    businessId: text("business_id"),
    wabaId: text("waba_id"),
    phoneNumberId: text("phone_number_id"),
    signupCode: text("signup_code"),
    accessToken: text("access_token"),
    tokenType: text("token_type"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    tokenError: text("token_error"),
    status: text("status", {
      enum: ["not_started", "pending", "connected", "failed"],
    }).notNull().default("not_started"),
    rawPayload: jsonb("raw_payload"),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    clientIdx: index("whatsapp_integrations_client_idx").on(table.clientId),
    clientUnique: uniqueIndex("whatsapp_integrations_client_unique").on(table.clientId),
  }),
);

export const whatsappAgentsTable = pgTable(
  "whatsapp_agents",
  {
    id: text("id").primaryKey().$defaultFn(() => nanoid()),
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phoneNumberId: text("phone_number_id"),
    externalAgentId: text("external_agent_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    clientIdx: index("whatsapp_agents_client_idx").on(table.clientId),
  }),
);

export const whatsappContactsTable = pgTable(
  "whatsapp_contacts",
  {
    id: text("id").primaryKey().$defaultFn(() => nanoid()),
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    waId: text("wa_id").notNull(),
    name: text("name"),
    phone: text("phone").notNull(),
    rawPayload: jsonb("raw_payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    clientIdx: index("whatsapp_contacts_client_idx").on(table.clientId),
    waIdUnique: uniqueIndex("whatsapp_contacts_client_wa_id_unique").on(table.clientId, table.waId),
  }),
);

export const whatsappConversationsTable = pgTable(
  "whatsapp_conversations",
  {
    id: text("id").primaryKey().$defaultFn(() => nanoid()),
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    contactId: text("contact_id").references(() => whatsappContactsTable.id, { onDelete: "cascade" }),
    agentId: text("agent_id").references(() => whatsappAgentsTable.id, { onDelete: "set null" }),
    externalConversationId: text("external_conversation_id"),
    status: text("status", {
      enum: ["new", "in_progress", "awaiting_response", "closed", "lost"],
    }).notNull().default("new"),
    funnelStage: text("funnel_stage", {
      enum: ["new_lead", "in_service", "qualified", "catalog_sent", "negotiation", "closed", "lost"],
    }).notNull().default("new_lead"),
    firstMessageAt: timestamp("first_message_at", { withTimezone: true }),
    firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    lostReason: text("lost_reason"),
    rawPayload: jsonb("raw_payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    clientIdx: index("whatsapp_conversations_client_idx").on(table.clientId),
    statusIdx: index("whatsapp_conversations_status_idx").on(table.clientId, table.status),
    stageIdx: index("whatsapp_conversations_stage_idx").on(table.clientId, table.funnelStage),
  }),
);

export const whatsappMessagesTable = pgTable(
  "whatsapp_messages",
  {
    id: text("id").primaryKey().$defaultFn(() => nanoid()),
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").references(() => whatsappConversationsTable.id, { onDelete: "cascade" }),
    contactId: text("contact_id").references(() => whatsappContactsTable.id, { onDelete: "set null" }),
    externalMessageId: text("external_message_id"),
    direction: text("direction", { enum: ["inbound", "outbound"] }).notNull(),
    messageType: text("message_type"),
    body: text("body"),
    rawPayload: jsonb("raw_payload"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    conversationIdx: index("whatsapp_messages_conversation_idx").on(table.conversationId),
    sentAtIdx: index("whatsapp_messages_sent_at_idx").on(table.clientId, table.sentAt),
    externalMessageUnique: uniqueIndex("whatsapp_messages_external_unique").on(table.clientId, table.externalMessageId),
  }),
);

export const whatsappConversationEventsTable = pgTable(
  "whatsapp_conversation_events",
  {
    id: text("id").primaryKey().$defaultFn(() => nanoid()),
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").references(() => whatsappConversationsTable.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    fromStage: text("from_stage"),
    toStage: text("to_stage"),
    metadata: jsonb("metadata"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    conversationIdx: index("whatsapp_conversation_events_conversation_idx").on(table.conversationId),
    occurredAtIdx: index("whatsapp_conversation_events_occurred_at_idx").on(table.clientId, table.occurredAt),
  }),
);

export type WhatsappIntegration = typeof whatsappIntegrationsTable.$inferSelect;
export type InsertWhatsappIntegration = typeof whatsappIntegrationsTable.$inferInsert;
export type WhatsappAgent = typeof whatsappAgentsTable.$inferSelect;
export type InsertWhatsappAgent = typeof whatsappAgentsTable.$inferInsert;
export type WhatsappContact = typeof whatsappContactsTable.$inferSelect;
export type InsertWhatsappContact = typeof whatsappContactsTable.$inferInsert;
export type WhatsappConversation = typeof whatsappConversationsTable.$inferSelect;
export type InsertWhatsappConversation = typeof whatsappConversationsTable.$inferInsert;
export type WhatsappMessage = typeof whatsappMessagesTable.$inferSelect;
export type InsertWhatsappMessage = typeof whatsappMessagesTable.$inferInsert;
export type WhatsappConversationEvent = typeof whatsappConversationEventsTable.$inferSelect;
export type InsertWhatsappConversationEvent = typeof whatsappConversationEventsTable.$inferInsert;
