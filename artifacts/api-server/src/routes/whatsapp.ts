import { Router, type IRouter, type Request } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { logger } from "../lib/logger";
import { authenticate, resolveClientId } from "../middlewares/auth";
import {
  clientsTable,
  db,
  whatsappContactsTable,
  whatsappConversationEventsTable,
  whatsappConversationsTable,
  whatsappIntegrationsTable,
  whatsappMessageTemplatesTable,
  whatsappMessagesTable,
  whatsappPhoneNumbersTable,
} from "@workspace/db";

const router: IRouter = Router();

const GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION ?? "v23.0";
const WHATSAPP_CALLBACK_URL = "https://www.grupoup-dash.com.br/api/webhooks/whatsapp";

function getWhatsappEmbeddedSignupAppId(): string | null {
  return (
    process.env.WHATSAPP_EMBEDDED_SIGNUP_APP_ID ??
    process.env.META_APP_ID ??
    process.env.FACEBOOK_APP_ID ??
    null
  );
}

function getWhatsappEmbeddedSignupConfigId(): string | null {
  return (
    process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID ??
    process.env.WHATSAPP_LOGIN_CONFIG_ID ??
    process.env.META_WHATSAPP_CONFIG_ID ??
    null
  );
}

function getMetaAppSecret(): string | null {
  return process.env.META_APP_SECRET ?? process.env.FACEBOOK_APP_SECRET ?? null;
}

function getWhatsappSystemUserAccessToken(): string | null {
  return normalizeMetaAccessToken(
    process.env.WHATSAPP_SYSTEM_USER_ACCESS_TOKEN ??
      process.env.META_SYSTEM_USER_ACCESS_TOKEN ??
      process.env.FACEBOOK_SYSTEM_USER_ACCESS_TOKEN ??
      null,
  );
}

function getWhatsappDiscoveryBusinessIds(): string[] {
  const raw =
    process.env.WHATSAPP_DISCOVERY_BUSINESS_IDS ??
    process.env.WHATSAPP_DISCOVERY_BUSINESS_ID ??
    process.env.WHATSAPP_BUSINESS_MANAGER_IDS ??
    process.env.WHATSAPP_BUSINESS_MANAGER_ID ??
    process.env.META_BUSINESS_IDS ??
    process.env.META_BUSINESS_ID ??
    "";

  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

const WhatsappWebhookQuery = z.object({
  "hub.mode": z.string().optional(),
  "hub.verify_token": z.string().optional(),
  "hub.challenge": z.string().optional(),
});

type WhatsappWebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        messages?: unknown[];
        statuses?: unknown[];
        contacts?: unknown[];
        metadata?: {
          phone_number_id?: string;
          display_phone_number?: string;
        };
      };
    }>;
  }>;
};

type WhatsappWebhookContact = {
  wa_id?: string;
  profile?: {
    name?: string;
  };
};

type WhatsappWebhookMessage = {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: {
    body?: string;
  };
  image?: {
    caption?: string;
  };
  document?: {
    caption?: string;
    filename?: string;
  };
  button?: {
    text?: string;
  };
  interactive?: {
    button_reply?: {
      title?: string;
    };
    list_reply?: {
      title?: string;
    };
  };
};

type WhatsappWebhookStatus = {
  id?: string;
  status?: string;
  timestamp?: string;
  recipient_id?: string;
  conversation?: {
    id?: string;
  };
};

type TokenExchangeResult = {
  accessToken: string | null;
  tokenType: string | null;
  tokenExpiresAt: Date | null;
  error: string | null;
};

type MetaGraphTestResult = {
  permission: "public_profile" | "business_management";
  ok: boolean;
  status: number;
  endpoint: string;
  message: string | null;
};

type MetaGraphError = {
  message?: string;
  type?: string;
  code?: number;
};

type MetaGraphResponse<T> = T & {
  error?: MetaGraphError;
};

type MetaGraphList<T> = {
  data?: T[];
};

type MetaBusinessAccount = {
  id: string;
  name?: string;
};

type MetaWhatsappBusinessAccount = {
  id: string;
  name?: string;
  currency?: string;
  timezone_id?: string | number | null;
};

type MetaWhatsappPhoneNumber = {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
  platform_type?: string;
  code_verification_status?: string;
};

const SaveEmbeddedSignupBody = z.object({
  clientId: z.string().optional(),
  code: z.string().optional().nullable(),
  redirectUri: z.string().url().optional().nullable(),
  businessId: z.string().optional().nullable(),
  wabaId: z.string().optional().nullable(),
  phoneNumberId: z.string().optional().nullable(),
  event: z.string().optional().nullable(),
  rawPayload: z.unknown().optional(),
});

const ResetEmbeddedSignupBody = z.object({
  clientId: z.string().optional(),
});

const MetaTestCallsBody = z.object({
  clientId: z.string().optional(),
});

const DiscoverExistingWhatsappAccountsBody = z.object({
  clientId: z.string().optional(),
  code: z.string().trim().min(1).optional().nullable(),
});

const SendWhatsappMessageBody = z.object({
  clientId: z.string().optional(),
  phoneNumberId: z.string().optional(),
  body: z.string().trim().min(1).max(4096),
});

const TestWhatsappMessageBody = z.object({
  clientId: z.string().optional(),
  phoneNumberId: z.string().min(1),
  to: z.string().trim().min(8),
  body: z.string().trim().min(1).max(4096),
});

const ImportExistingWhatsappNumberBody = z.object({
  clientId: z.string().optional(),
  wabaId: z.string().trim().min(4),
  phoneNumberId: z.string().trim().min(4),
  displayPhoneNumber: z.string().trim().optional().nullable(),
  verifiedName: z.string().trim().optional().nullable(),
  accessToken: z.string().trim().optional().nullable(),
});

const SyncWhatsappTemplatesBody = z.object({
  clientId: z.string().optional(),
  phoneNumberId: z.string().optional().nullable(),
});

const CreateWhatsappTemplateBody = z.object({
  clientId: z.string().optional(),
  phoneNumberId: z.string().optional().nullable(),
  name: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .regex(/^[a-z0-9_]+$/, "Use apenas letras minúsculas, números e underscore no nome do template."),
  language: z.string().trim().min(2).max(16).default("pt_BR"),
  category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]).default("UTILITY"),
  bodyText: z.string().trim().min(1).max(1024),
  footerText: z.string().trim().max(60).optional().nullable(),
});

const SendWhatsappTemplateBody = z.object({
  clientId: z.string().optional(),
  phoneNumberId: z.string().min(1),
  to: z.string().trim().min(8),
  templateName: z.string().trim().min(1),
  languageCode: z.string().trim().min(2),
  bodyParams: z.array(z.string()).optional().default([]),
});

const SubscribeWhatsappWebhookBody = z.object({
  clientId: z.string().optional(),
  phoneNumberId: z.string().optional().nullable(),
});

function serializeIntegration(row: typeof whatsappIntegrationsTable.$inferSelect | null) {
  if (!row) return null;
  return {
    id: row.id,
    clientId: row.clientId,
    appId: row.appId,
    configId: row.configId,
    businessId: row.businessId,
    wabaId: row.wabaId,
    phoneNumberId: row.phoneNumberId,
    status: row.status,
    hasAccessToken: Boolean(row.accessToken),
    tokenExpiresAt: row.tokenExpiresAt?.toISOString() ?? null,
    tokenError: row.tokenError,
    connectedAt: row.connectedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function exchangeEmbeddedSignupCode(
  code: string,
  appId: string | null,
  appSecret: string | null,
  redirectUri?: string | null,
): Promise<TokenExchangeResult> {
  if (!appId || !appSecret) {
    return {
      accessToken: null,
      tokenType: null,
      tokenExpiresAt: null,
      error: "META_APP_SECRET não configurado para trocar o code por token.",
    };
  }

  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("code", code);
  if (redirectUri) url.searchParams.set("redirect_uri", redirectUri);

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const payload = (await response.json()) as {
      access_token?: string;
      token_type?: string;
      expires_in?: number;
      error?: { message?: string };
    };

    if (!response.ok || !payload.access_token) {
      return {
        accessToken: null,
        tokenType: null,
        tokenExpiresAt: null,
        error: payload.error?.message ?? `Erro Meta ${response.status} ao trocar code por token.`,
      };
    }

    return {
      accessToken: payload.access_token,
      tokenType: payload.token_type ?? null,
      tokenExpiresAt:
        typeof payload.expires_in === "number"
          ? new Date(Date.now() + payload.expires_in * 1000)
          : null,
      error: null,
    };
  } catch (error) {
    return {
      accessToken: null,
      tokenType: null,
      tokenExpiresAt: null,
      error: error instanceof Error ? error.message : "Erro inesperado ao trocar code por token.",
    };
  }
}

async function runMetaGraphTestCall(
  permission: MetaGraphTestResult["permission"],
  endpoint: string,
  accessToken: string,
): Promise<MetaGraphTestResult> {
  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}${endpoint}`);

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const payload = (await response.json()) as {
      error?: { message?: string };
      data?: unknown[];
    };

    return {
      permission,
      ok: response.ok,
      status: response.status,
      endpoint,
      message: response.ok
        ? Array.isArray(payload.data)
          ? `${payload.data.length} registro(s) retornado(s).`
          : "Chamada concluída."
        : payload.error?.message ?? "Chamada rejeitada pela Meta.",
    };
  } catch (error) {
    return {
      permission,
      ok: false,
      status: 0,
      endpoint,
      message: error instanceof Error ? error.message : "Erro inesperado ao chamar a Meta.",
    };
  }
}

function resolveWritableClientId(req: Request, bodyClientId?: string): string | null {
  if (!req.user) return null;
  if (req.user.role === "CLIENT") return req.user.clientId;
  return bodyClientId ?? resolveClientId(req);
}

function summarizePayload(payload: WhatsappWebhookPayload) {
  let messages = 0;
  let statuses = 0;
  let contacts = 0;
  let coexistenceEvents = 0;
  const phoneNumberIds = new Set<string>();
  const fields = new Set<string>();

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field) fields.add(change.field);
      messages += change.value?.messages?.length ?? 0;
      statuses += change.value?.statuses?.length ?? 0;
      contacts += change.value?.contacts?.length ?? 0;
      if (
        change.field &&
        ["history", "smb_app_state_sync", "smb_message_echoes", "message_echoes"].includes(change.field)
      ) {
        coexistenceEvents += 1;
      }
      const phoneNumberId = change.value?.metadata?.phone_number_id;
      if (phoneNumberId) phoneNumberIds.add(phoneNumberId);
    }
  }

  return {
    messages,
    statuses,
    contacts,
    coexistenceEvents,
    fields: Array.from(fields),
    phoneNumberIds: Array.from(phoneNumberIds),
  };
}

function getWhatsappMessageBody(message: WhatsappWebhookMessage): string | null {
  if (message.text?.body) return message.text.body;
  if (message.image?.caption) return message.image.caption;
  if (message.document?.caption) return message.document.caption;
  if (message.document?.filename) return message.document.filename;
  if (message.button?.text) return message.button.text;
  if (message.interactive?.button_reply?.title) return message.interactive.button_reply.title;
  if (message.interactive?.list_reply?.title) return message.interactive.list_reply.title;
  return null;
}

function getWhatsappMessageDate(timestamp?: string): Date {
  const seconds = timestamp ? Number(timestamp) : NaN;
  if (Number.isFinite(seconds) && seconds > 0) return new Date(seconds * 1000);
  return new Date();
}

async function resolveWhatsappClientByPhoneNumber(phoneNumberId?: string | null) {
  if (!phoneNumberId) return null;
  const [phoneNumber] = await db
    .select()
    .from(whatsappPhoneNumbersTable)
    .where(eq(whatsappPhoneNumbersTable.phoneNumberId, phoneNumberId))
    .limit(1);
  if (phoneNumber) {
    const [integration] = await db
      .select()
      .from(whatsappIntegrationsTable)
      .where(eq(whatsappIntegrationsTable.clientId, phoneNumber.clientId))
      .limit(1);
    return integration ?? null;
  }

  const [integration] = await db
    .select()
    .from(whatsappIntegrationsTable)
    .where(eq(whatsappIntegrationsTable.phoneNumberId, phoneNumberId))
    .limit(1);
  return integration ?? null;
}

async function resolveWhatsappClientByWabaId(wabaId?: string | null) {
  if (!wabaId) return null;
  const [integration] = await db
    .select()
    .from(whatsappIntegrationsTable)
    .where(eq(whatsappIntegrationsTable.wabaId, wabaId))
    .limit(1);
  return integration ?? null;
}

function normalizeWhatsappRecipient(value: string): string {
  return value.replace(/\D/g, "");
}

function normalizeMetaAccessToken(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^Bearer\s+/i, "").trim();
}

function getMetaGraphErrorMessage(payload: { error?: MetaGraphError }, fallback: string): string {
  return payload.error?.message ?? fallback;
}

async function fetchMetaGraph<T>(
  endpoint: string,
  accessToken: string,
  params: Record<string, string> = {},
) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const payload = (await response.json()) as MetaGraphResponse<T>;

  return {
    ok: response.ok,
    status: response.status,
    payload,
  };
}

async function persistWhatsappDiscoveryToken(params: {
  clientId: string;
  token: TokenExchangeResult;
  rawPayload: unknown;
}) {
  const [currentIntegration] = await db
    .select()
    .from(whatsappIntegrationsTable)
    .where(eq(whatsappIntegrationsTable.clientId, params.clientId))
    .limit(1);

  const now = new Date();
  const appId = getWhatsappEmbeddedSignupAppId();
  const configId = getWhatsappEmbeddedSignupConfigId();

  if (currentIntegration) {
    const [updated] = await db
      .update(whatsappIntegrationsTable)
      .set({
        appId,
        configId,
        accessToken: params.token.accessToken,
        tokenType: params.token.tokenType,
        tokenExpiresAt: params.token.tokenExpiresAt,
        tokenError: null,
        status: currentIntegration.status === "connected" ? "connected" : "pending",
        rawPayload: params.rawPayload,
        updatedAt: now,
      })
      .where(eq(whatsappIntegrationsTable.id, currentIntegration.id))
      .returning();

    return updated ?? currentIntegration;
  }

  const [created] = await db
    .insert(whatsappIntegrationsTable)
    .values({
      clientId: params.clientId,
      appId,
      configId,
      accessToken: params.token.accessToken,
      tokenType: params.token.tokenType,
      tokenExpiresAt: params.token.tokenExpiresAt,
      tokenError: null,
      status: "pending",
      rawPayload: params.rawPayload,
    })
    .returning();

  return created ?? null;
}

async function upsertWhatsappPhoneNumber(params: {
  clientId: string;
  integrationId: string | null;
  wabaId: string | null;
  phoneNumberId: string;
  displayPhoneNumber?: string | null;
  verifiedName?: string | null;
  qualityRating?: string | null;
  platformType?: string | null;
  codeVerificationStatus?: string | null;
  rawPayload?: unknown;
}) {
  const now = new Date();
  const [phoneNumber] = await db
    .insert(whatsappPhoneNumbersTable)
    .values({
      clientId: params.clientId,
      integrationId: params.integrationId,
      wabaId: params.wabaId,
      phoneNumberId: params.phoneNumberId,
      displayPhoneNumber: params.displayPhoneNumber ?? null,
      verifiedName: params.verifiedName ?? null,
      qualityRating: params.qualityRating ?? null,
      platformType: params.platformType ?? null,
      codeVerificationStatus: params.codeVerificationStatus ?? null,
      status: "active",
      rawPayload: params.rawPayload ?? null,
      lastSyncedAt: now,
    })
    .onConflictDoUpdate({
      target: [whatsappPhoneNumbersTable.clientId, whatsappPhoneNumbersTable.phoneNumberId],
      set: {
        integrationId: params.integrationId,
        wabaId: params.wabaId,
        displayPhoneNumber: params.displayPhoneNumber ?? null,
        verifiedName: params.verifiedName ?? null,
        qualityRating: params.qualityRating ?? null,
        platformType: params.platformType ?? null,
        codeVerificationStatus: params.codeVerificationStatus ?? null,
        status: "active",
        rawPayload: params.rawPayload ?? null,
        lastSyncedAt: now,
        updatedAt: now,
      },
    })
    .returning();

  return phoneNumber;
}

async function getWhatsappIntegrationForPhone(clientId: string, phoneNumberId?: string | null) {
  if (phoneNumberId) {
    const [phoneNumber] = await db
      .select()
      .from(whatsappPhoneNumbersTable)
      .where(
        and(
          eq(whatsappPhoneNumbersTable.clientId, clientId),
          eq(whatsappPhoneNumbersTable.phoneNumberId, phoneNumberId),
        ),
      )
      .limit(1);
    if (phoneNumber?.integrationId) {
      const [integration] = await db
        .select()
        .from(whatsappIntegrationsTable)
        .where(eq(whatsappIntegrationsTable.id, phoneNumber.integrationId))
        .limit(1);
      if (integration) return integration;
    }
  }

  const [integration] = await db
    .select()
    .from(whatsappIntegrationsTable)
    .where(eq(whatsappIntegrationsTable.clientId, clientId))
    .limit(1);
  return integration ?? null;
}

async function upsertWhatsappContact(params: {
  clientId: string;
  waId: string;
  name: string | null;
  rawPayload: unknown;
}) {
  const [contact] = await db
    .insert(whatsappContactsTable)
    .values({
      clientId: params.clientId,
      waId: params.waId,
      phone: params.waId,
      name: params.name,
      rawPayload: params.rawPayload,
    })
    .onConflictDoUpdate({
      target: [whatsappContactsTable.clientId, whatsappContactsTable.waId],
      set: {
        name: params.name,
        phone: params.waId,
        rawPayload: params.rawPayload,
        updatedAt: new Date(),
      },
    })
    .returning();

  return contact;
}

async function findOrCreateWhatsappConversation(params: {
  clientId: string;
  contactId: string;
  phoneNumberId: string | null;
  firstMessageAt: Date;
  rawPayload: unknown;
}) {
  const [existing] = await db
    .select()
    .from(whatsappConversationsTable)
    .where(
      and(
        eq(whatsappConversationsTable.clientId, params.clientId),
        eq(whatsappConversationsTable.contactId, params.contactId),
        params.phoneNumberId
          ? eq(whatsappConversationsTable.phoneNumberId, params.phoneNumberId)
          : sql`${whatsappConversationsTable.phoneNumberId} IS NULL`,
      ),
    )
    .orderBy(desc(whatsappConversationsTable.updatedAt))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(whatsappConversationsTable)
      .set({
        status: existing.status === "closed" || existing.status === "lost" ? "new" : "awaiting_response",
        rawPayload: params.rawPayload,
        updatedAt: new Date(),
      })
      .where(eq(whatsappConversationsTable.id, existing.id))
      .returning();
    return updated ?? existing;
  }

  const [created] = await db
    .insert(whatsappConversationsTable)
    .values({
      clientId: params.clientId,
      contactId: params.contactId,
      phoneNumberId: params.phoneNumberId,
      status: "new",
      funnelStage: "new_lead",
      firstMessageAt: params.firstMessageAt,
      rawPayload: params.rawPayload,
    })
    .returning();

  return created;
}

async function persistInboundWhatsappMessage(params: {
  clientId: string;
  contactId: string;
  conversationId: string;
  phoneNumberId: string | null;
  message: WhatsappWebhookMessage;
}) {
  await db
    .insert(whatsappMessagesTable)
    .values({
      clientId: params.clientId,
      contactId: params.contactId,
      conversationId: params.conversationId,
      phoneNumberId: params.phoneNumberId,
      externalMessageId: params.message.id ?? null,
      direction: "inbound",
      messageType: params.message.type ?? "unknown",
      body: getWhatsappMessageBody(params.message),
      rawPayload: params.message,
      sentAt: getWhatsappMessageDate(params.message.timestamp),
    })
    .onConflictDoNothing({
      target: [whatsappMessagesTable.clientId, whatsappMessagesTable.externalMessageId],
    });
}

async function persistWhatsappStatus(params: {
  clientId: string;
  status: WhatsappWebhookStatus;
}) {
  await db.insert(whatsappConversationEventsTable).values({
    clientId: params.clientId,
    eventType: `message_${params.status.status ?? "status"}`,
    metadata: params.status,
    occurredAt: getWhatsappMessageDate(params.status.timestamp),
  });
}

async function persistWhatsappWebhookEvent(params: {
  clientId: string;
  eventType: string;
  metadata: unknown;
}) {
  await db.insert(whatsappConversationEventsTable).values({
    clientId: params.clientId,
    eventType: params.eventType,
    metadata: params.metadata,
    occurredAt: new Date(),
  });
}

router.get("/webhooks/whatsapp", (req, res): void => {
  const parsed = WhatsappWebhookQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: parsed.error.message,
      status: 400,
    });
    return;
  }

  const mode = parsed.data["hub.mode"];
  const token = parsed.data["hub.verify_token"];
  const challenge = parsed.data["hub.challenge"];
  const expectedToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (mode === "subscribe" && challenge && expectedToken && token === expectedToken) {
    res.status(200).send(challenge);
    return;
  }

  res.status(403).json({
    error: true,
    code: "WHATSAPP_WEBHOOK_VERIFICATION_FAILED",
    message: "Invalid WhatsApp webhook verification token.",
    status: 403,
  });
});

router.post("/webhooks/whatsapp", async (req, res): Promise<void> => {
  const payload = req.body as WhatsappWebhookPayload;
  const summary = summarizePayload(payload);
  let persistedMessages = 0;
  let persistedStatuses = 0;
  let persistedCoexistenceEvents = 0;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      const integration =
        (await resolveWhatsappClientByPhoneNumber(phoneNumberId)) ??
        (await resolveWhatsappClientByWabaId(entry.id));
      if (!integration) {
        logger.warn(
          { field: change.field, phoneNumberId, wabaId: entry.id },
          "whatsapp webhook received for unknown WhatsApp asset",
        );
        continue;
      }

      if (
        change.field &&
        ["history", "smb_app_state_sync", "smb_message_echoes", "message_echoes"].includes(change.field)
      ) {
        await persistWhatsappWebhookEvent({
          clientId: integration.clientId,
          eventType: `whatsapp_${change.field}`,
          metadata: {
            entryId: entry.id ?? null,
            field: change.field,
            value: value ?? null,
          },
        });
        persistedCoexistenceEvents += 1;
      }

      if (phoneNumberId) {
        await upsertWhatsappPhoneNumber({
          clientId: integration.clientId,
          integrationId: integration.id,
          wabaId: integration.wabaId,
          phoneNumberId,
          displayPhoneNumber: value?.metadata?.display_phone_number ?? null,
          rawPayload: value?.metadata ?? null,
        });
      }

      const contactsByWaId = new Map<string, WhatsappWebhookContact>();
      for (const contact of (value?.contacts ?? []) as WhatsappWebhookContact[]) {
        if (contact.wa_id) contactsByWaId.set(contact.wa_id, contact);
      }

      for (const message of (value?.messages ?? []) as WhatsappWebhookMessage[]) {
        if (!message.from) continue;
        const contactPayload = contactsByWaId.get(message.from);
        const contact = await upsertWhatsappContact({
          clientId: integration.clientId,
          waId: message.from,
          name: contactPayload?.profile?.name ?? null,
          rawPayload: contactPayload ?? null,
        });
        if (!contact) continue;

        const sentAt = getWhatsappMessageDate(message.timestamp);
        const conversation = await findOrCreateWhatsappConversation({
          clientId: integration.clientId,
          contactId: contact.id,
          phoneNumberId: phoneNumberId ?? null,
          firstMessageAt: sentAt,
          rawPayload: message,
        });
        if (!conversation) continue;

        await persistInboundWhatsappMessage({
          clientId: integration.clientId,
          contactId: contact.id,
          conversationId: conversation.id,
          phoneNumberId: phoneNumberId ?? null,
          message,
        });
        persistedMessages += 1;
      }

      for (const status of (value?.statuses ?? []) as WhatsappWebhookStatus[]) {
        await persistWhatsappStatus({
          clientId: integration.clientId,
          status,
        });
        persistedStatuses += 1;
      }
    }
  }

  logger.info(
    { summary, persistedMessages, persistedStatuses, persistedCoexistenceEvents },
    "whatsapp webhook received",
  );

  res.status(200).json({
    ok: true,
    receivedAt: new Date().toISOString(),
    summary: {
      ...summary,
      persistedMessages,
      persistedStatuses,
      persistedCoexistenceEvents,
    },
  });
});

router.use("/whatsapp", authenticate);

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function serializePhoneNumber(row: typeof whatsappPhoneNumbersTable.$inferSelect) {
  return {
    id: row.id,
    clientId: row.clientId,
    integrationId: row.integrationId,
    wabaId: row.wabaId,
    phoneNumberId: row.phoneNumberId,
    displayPhoneNumber: row.displayPhoneNumber,
    verifiedName: row.verifiedName,
    qualityRating: row.qualityRating,
    platformType: row.platformType,
    codeVerificationStatus: row.codeVerificationStatus,
    status: row.status,
    lastSyncedAt: iso(row.lastSyncedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeTemplate(row: typeof whatsappMessageTemplatesTable.$inferSelect) {
  return {
    id: row.id,
    clientId: row.clientId,
    integrationId: row.integrationId,
    wabaId: row.wabaId,
    templateId: row.templateId,
    name: row.name,
    language: row.language,
    status: row.status,
    category: row.category,
    components: row.components,
    lastSyncedAt: iso(row.lastSyncedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function upsertWhatsappTemplate(params: {
  clientId: string;
  integrationId: string | null;
  wabaId: string;
  templateId?: string | null;
  name: string;
  language: string;
  status: string;
  category?: string | null;
  components?: unknown;
  rawPayload?: unknown;
}) {
  const now = new Date();
  const [template] = await db
    .insert(whatsappMessageTemplatesTable)
    .values({
      clientId: params.clientId,
      integrationId: params.integrationId,
      wabaId: params.wabaId,
      templateId: params.templateId ?? null,
      name: params.name,
      language: params.language,
      status: params.status,
      category: params.category ?? null,
      components: params.components ?? null,
      rawPayload: params.rawPayload ?? null,
      lastSyncedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        whatsappMessageTemplatesTable.clientId,
        whatsappMessageTemplatesTable.wabaId,
        whatsappMessageTemplatesTable.name,
        whatsappMessageTemplatesTable.language,
      ],
      set: {
        integrationId: params.integrationId,
        templateId: params.templateId ?? null,
        status: params.status,
        category: params.category ?? null,
        components: params.components ?? null,
        rawPayload: params.rawPayload ?? null,
        lastSyncedAt: now,
        updatedAt: now,
      },
    })
    .returning();

  return template;
}

async function syncTemplatesForIntegration(
  clientId: string,
  integration: typeof whatsappIntegrationsTable.$inferSelect,
) {
  if (!integration.wabaId || !integration.accessToken) {
    return {
      templates: [] as Array<ReturnType<typeof serializeTemplate>>,
      error: "Integração sem WABA ID ou token.",
    };
  }

  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${integration.wabaId}/message_templates`);
  url.searchParams.set("fields", "id,name,language,status,category,components");
  url.searchParams.set("limit", "100");
  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${integration.accessToken}`,
    },
  });
  const payload = (await response.json()) as {
    data?: Array<{
      id?: string;
      name?: string;
      language?: string;
      status?: string;
      category?: string;
      components?: unknown;
    }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    return {
      templates: [] as Array<ReturnType<typeof serializeTemplate>>,
      error: payload.error?.message ?? `Erro Meta ${response.status} ao sincronizar templates.`,
    };
  }

  const templates: Array<ReturnType<typeof serializeTemplate>> = [];
  for (const row of payload.data ?? []) {
    if (!row.name || !row.language || !row.status) continue;
    const template = await upsertWhatsappTemplate({
      clientId,
      integrationId: integration.id,
      wabaId: integration.wabaId,
      templateId: row.id ?? null,
      name: row.name,
      language: row.language,
      status: row.status,
      category: row.category ?? null,
      components: row.components ?? null,
      rawPayload: row,
    });
    if (template) templates.push(serializeTemplate(template));
  }

  return { templates, error: null };
}

async function subscribeWebhookForIntegration(integration: typeof whatsappIntegrationsTable.$inferSelect) {
  if (!integration.wabaId || !integration.accessToken) {
    return {
      ok: false,
      error: "Integração sem WABA ID ou token.",
    };
  }

  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${integration.wabaId}/subscribed_apps`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${integration.accessToken}`,
      },
      body: JSON.stringify({
        override_callback_uri: WHATSAPP_CALLBACK_URL,
        verify_token: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
      }),
    },
  );
  const payload = (await response.json()) as {
    success?: boolean;
    error?: { message?: string };
  };

  if (!response.ok || payload.success === false) {
    return {
      ok: false,
      error: payload.error?.message ?? `Erro Meta ${response.status} ao ativar webhook.`,
    };
  }

  return {
    ok: true,
    error: null,
  };
}

router.get("/whatsapp/connections", async (req, res): Promise<void> => {
  const clientId = resolveWritableClientId(req);
  if (!clientId) {
    res.status(400).json({
      error: true,
      code: "CLIENT_REQUIRED",
      message: "Select a client to view WhatsApp connections.",
      status: 400,
    });
    return;
  }

  const integrations = await db
    .select()
    .from(whatsappIntegrationsTable)
    .where(eq(whatsappIntegrationsTable.clientId, clientId))
    .orderBy(desc(whatsappIntegrationsTable.updatedAt));
  const phoneNumbers = await db
    .select()
    .from(whatsappPhoneNumbersTable)
    .where(eq(whatsappPhoneNumbersTable.clientId, clientId))
    .orderBy(desc(whatsappPhoneNumbersTable.updatedAt));

  for (const integration of integrations) {
    if (!integration.phoneNumberId) continue;
    const exists = phoneNumbers.some((row) => row.phoneNumberId === integration.phoneNumberId);
    if (exists) continue;
    const phoneNumber = await upsertWhatsappPhoneNumber({
      clientId,
      integrationId: integration.id,
      wabaId: integration.wabaId,
      phoneNumberId: integration.phoneNumberId,
      rawPayload: { source: "integration_fallback" },
    });
    if (phoneNumber) phoneNumbers.push(phoneNumber);
  }

  res.json({
    callbackUrl: WHATSAPP_CALLBACK_URL,
    webhookVerifyTokenConfigured: Boolean(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN),
    integrations: integrations.map(serializeIntegration),
    phoneNumbers: phoneNumbers.map(serializePhoneNumber),
  });
});

router.post("/whatsapp/connections/discover-existing", async (req, res): Promise<void> => {
  const parsed = DiscoverExistingWhatsappAccountsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: parsed.error.message,
      status: 400,
    });
    return;
  }

  const clientId = resolveWritableClientId(req, parsed.data.clientId);
  if (!clientId) {
    res.status(400).json({
      error: true,
      code: "CLIENT_REQUIRED",
      message: "Select a client before discovering WhatsApp accounts.",
      status: 400,
    });
    return;
  }

  const systemUserAccessToken = getWhatsappSystemUserAccessToken();
  if (!systemUserAccessToken) {
    res.status(409).json({
      error: true,
      code: "WHATSAPP_SYSTEM_USER_TOKEN_REQUIRED",
      message:
        "Para buscar contas WhatsApp existentes da BM, configure WHATSAPP_SYSTEM_USER_ACCESS_TOKEN no Vercel. Esse fluxo não usa code do Facebook Login.",
      status: 409,
    });
    return;
  }

  const token: TokenExchangeResult = {
    accessToken: systemUserAccessToken,
    tokenType: "system_user",
    tokenExpiresAt: null,
    error: null,
  };

  const errors: string[] = [];
  const configuredBusinessIds = getWhatsappDiscoveryBusinessIds();
  const businesses: MetaBusinessAccount[] = [];

  if (configuredBusinessIds.length > 0) {
    for (const businessId of configuredBusinessIds) {
      const businessResponse = await fetchMetaGraph<MetaBusinessAccount>(
        `/${businessId}`,
        token.accessToken,
        { fields: "id,name" },
      );
      if (businessResponse.ok && businessResponse.payload.id) {
        businesses.push({
          id: businessResponse.payload.id,
          name: businessResponse.payload.name,
        });
      } else {
        errors.push(
          `${businessId}: ${getMetaGraphErrorMessage(
            businessResponse.payload,
            `Erro Meta ${businessResponse.status} ao buscar Business Manager.`,
          )}`,
        );
        businesses.push({ id: businessId });
      }
    }
  } else {
    const businessesResponse = await fetchMetaGraph<MetaGraphList<MetaBusinessAccount>>(
      "/me/businesses",
      token.accessToken,
      {
        fields: "id,name",
        limit: "100",
      },
    );

    if (!businessesResponse.ok) {
      res.status(businessesResponse.status).json({
        error: true,
        code: "META_BUSINESSES_DISCOVERY_FAILED",
        message: getMetaGraphErrorMessage(
          businessesResponse.payload,
          "Não foi possível listar os Business Managers. Para System User Token, configure também META_BUSINESS_ID ou WHATSAPP_DISCOVERY_BUSINESS_ID.",
        ),
        status: businessesResponse.status,
      });
      return;
    }

    businesses.push(...(businessesResponse.payload.data ?? []));
  }

  const wabas: Array<{
    id: string;
    name: string | null;
    businessId: string;
    businessName: string | null;
    ownership: "owned" | "client";
    currency: string | null;
    timezoneId: string | null;
    phoneNumbers: Array<{
      id: string;
      displayPhoneNumber: string | null;
      verifiedName: string | null;
      qualityRating: string | null;
      platformType: string | null;
      codeVerificationStatus: string | null;
    }>;
    phoneNumbersError: string | null;
  }> = [];

  for (const business of businesses) {
    const edges = [
      { ownership: "owned" as const, edge: "owned_whatsapp_business_accounts" },
      { ownership: "client" as const, edge: "client_whatsapp_business_accounts" },
    ];

    for (const edge of edges) {
      const wabaResponse = await fetchMetaGraph<MetaGraphList<MetaWhatsappBusinessAccount>>(
        `/${business.id}/${edge.edge}`,
        token.accessToken,
        {
          fields: "id,name,currency,timezone_id",
          limit: "100",
        },
      );

      if (!wabaResponse.ok) {
        errors.push(
          `${business.name ?? business.id} (${edge.edge}): ${getMetaGraphErrorMessage(
            wabaResponse.payload,
            `Erro Meta ${wabaResponse.status}`,
          )}`,
        );
        continue;
      }

      for (const waba of wabaResponse.payload.data ?? []) {
        const phoneResponse = await fetchMetaGraph<MetaGraphList<MetaWhatsappPhoneNumber>>(
          `/${waba.id}/phone_numbers`,
          token.accessToken,
          {
            fields:
              "id,display_phone_number,verified_name,quality_rating,platform_type,code_verification_status",
            limit: "100",
          },
        );

        const phoneNumbersError = phoneResponse.ok
          ? null
          : getMetaGraphErrorMessage(
              phoneResponse.payload,
              `Erro Meta ${phoneResponse.status} ao listar telefones.`,
            );

        if (phoneNumbersError) {
          errors.push(`${waba.name ?? waba.id} / phone_numbers: ${phoneNumbersError}`);
        }

        wabas.push({
          id: waba.id,
          name: waba.name ?? null,
          businessId: business.id,
          businessName: business.name ?? null,
          ownership: edge.ownership,
          currency: waba.currency ?? null,
          timezoneId: waba.timezone_id == null ? null : String(waba.timezone_id),
          phoneNumbers: (phoneResponse.payload.data ?? []).map((phoneNumber) => ({
            id: phoneNumber.id,
            displayPhoneNumber: phoneNumber.display_phone_number ?? null,
            verifiedName: phoneNumber.verified_name ?? null,
            qualityRating: phoneNumber.quality_rating ?? null,
            platformType: phoneNumber.platform_type ?? null,
            codeVerificationStatus: phoneNumber.code_verification_status ?? null,
          })),
          phoneNumbersError,
        });
      }
    }
  }

  const integration = await persistWhatsappDiscoveryToken({
    clientId,
    token,
    rawPayload: {
      source: systemUserAccessToken ? "system_user_existing_bm_discovery" : "existing_bm_discovery",
      discoveredAt: new Date().toISOString(),
      tokenSource: systemUserAccessToken ? "system_user_env" : "facebook_login_code",
      businesses: businesses.map((business) => ({
        id: business.id,
        name: business.name ?? null,
      })),
      wabas: wabas.map((waba) => ({
        id: waba.id,
        name: waba.name,
        businessId: waba.businessId,
        ownership: waba.ownership,
        phoneNumbers: waba.phoneNumbers.map((phoneNumber) => ({
          id: phoneNumber.id,
          displayPhoneNumber: phoneNumber.displayPhoneNumber,
        })),
      })),
      errors,
    },
  });

  res.json({
    ok: true,
    integration: serializeIntegration(integration),
    businesses: businesses.map((business) => ({
      id: business.id,
      name: business.name ?? null,
    })),
    wabas,
    errors,
  });
});

router.post("/whatsapp/connections/sync", async (req, res): Promise<void> => {
  const parsed = z.object({ clientId: z.string().optional() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: parsed.error.message,
      status: 400,
    });
    return;
  }

  const clientId = resolveWritableClientId(req, parsed.data.clientId);
  if (!clientId) {
    res.status(400).json({
      error: true,
      code: "CLIENT_REQUIRED",
      message: "Select a client before syncing WhatsApp phone numbers.",
      status: 400,
    });
    return;
  }

  const integrations = await db
    .select()
    .from(whatsappIntegrationsTable)
    .where(eq(whatsappIntegrationsTable.clientId, clientId));
  const synced: Array<ReturnType<typeof serializePhoneNumber>> = [];
  const errors: string[] = [];
  let webhookSubscriptions = 0;

  for (const integration of integrations) {
    const subscription = await subscribeWebhookForIntegration(integration);
    if (subscription.ok) webhookSubscriptions += 1;
    else if (subscription.error !== "Integração sem WABA ID ou token.") errors.push(subscription.error);

    if (integration.phoneNumberId) {
      const fallback = await upsertWhatsappPhoneNumber({
        clientId,
        integrationId: integration.id,
        wabaId: integration.wabaId,
        phoneNumberId: integration.phoneNumberId,
        rawPayload: { source: "integration_fallback" },
      });
      if (fallback) synced.push(serializePhoneNumber(fallback));
    }

    if (!integration.wabaId || !integration.accessToken) continue;
    const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${integration.wabaId}/phone_numbers`);
    url.searchParams.set(
      "fields",
      "id,display_phone_number,verified_name,quality_rating,platform_type,code_verification_status",
    );
    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${integration.accessToken}`,
      },
    });
    const payload = (await response.json()) as {
      data?: Array<{
        id: string;
        display_phone_number?: string;
        verified_name?: string;
        quality_rating?: string;
        platform_type?: string;
        code_verification_status?: string;
      }>;
      error?: { message?: string };
    };

    if (!response.ok) {
      errors.push(payload.error?.message ?? `Erro Meta ${response.status} ao sincronizar telefones.`);
      continue;
    }

    for (const row of payload.data ?? []) {
      const phoneNumber = await upsertWhatsappPhoneNumber({
        clientId,
        integrationId: integration.id,
        wabaId: integration.wabaId,
        phoneNumberId: row.id,
        displayPhoneNumber: row.display_phone_number ?? null,
        verifiedName: row.verified_name ?? null,
        qualityRating: row.quality_rating ?? null,
        platformType: row.platform_type ?? null,
        codeVerificationStatus: row.code_verification_status ?? null,
        rawPayload: row,
      });
      if (phoneNumber) synced.push(serializePhoneNumber(phoneNumber));
    }
  }

  res.json({
    ok: errors.length === 0,
    synced: synced.length,
    webhookSubscriptions,
    errors,
    phoneNumbers: synced,
  });
});

router.post("/whatsapp/connections/import-existing", async (req, res): Promise<void> => {
  const parsed = ImportExistingWhatsappNumberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: parsed.error.message,
      status: 400,
    });
    return;
  }

  const clientId = resolveWritableClientId(req, parsed.data.clientId);
  if (!clientId) {
    res.status(400).json({
      error: true,
      code: "CLIENT_REQUIRED",
      message: "Select a client before importing a WhatsApp phone number.",
      status: 400,
    });
    return;
  }

  const providedToken = normalizeMetaAccessToken(parsed.data.accessToken);
  const [currentIntegration] = await db
    .select()
    .from(whatsappIntegrationsTable)
    .where(eq(whatsappIntegrationsTable.clientId, clientId))
    .limit(1);
  const accessToken = providedToken ?? currentIntegration?.accessToken ?? null;

  if (!accessToken) {
    res.status(409).json({
      error: true,
      code: "WHATSAPP_TOKEN_REQUIRED",
      message: "Informe um token da Meta ou conecte o WhatsApp antes de importar este número.",
      status: 409,
    });
    return;
  }

  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${parsed.data.phoneNumberId}`);
  url.searchParams.set(
    "fields",
    "id,display_phone_number,verified_name,quality_rating,platform_type,code_verification_status",
  );
  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const payload = (await response.json()) as {
    id?: string;
    display_phone_number?: string;
    verified_name?: string;
    quality_rating?: string;
    platform_type?: string;
    code_verification_status?: string;
    error?: { message?: string };
  };

  if (!response.ok || payload.id !== parsed.data.phoneNumberId) {
    res.status(response.ok ? 422 : response.status).json({
      error: true,
      code: "WHATSAPP_PHONE_NUMBER_NOT_ACCESSIBLE",
      message:
        payload.error?.message ??
        "Não foi possível validar esse Phone Number ID com o token informado.",
      status: response.ok ? 422 : response.status,
    });
    return;
  }

  const [integration] = await db
    .insert(whatsappIntegrationsTable)
    .values({
      clientId,
      appId: getWhatsappEmbeddedSignupAppId(),
      configId: getWhatsappEmbeddedSignupConfigId(),
      wabaId: parsed.data.wabaId,
      phoneNumberId: parsed.data.phoneNumberId,
      accessToken,
      tokenType: currentIntegration?.tokenType ?? null,
      tokenExpiresAt: currentIntegration?.tokenExpiresAt ?? null,
      tokenError: null,
      status: "connected",
      rawPayload: {
        source: "manual_existing_bm_import",
        phoneNumber: payload,
      },
      connectedAt: currentIntegration?.connectedAt ?? new Date(),
    })
    .onConflictDoUpdate({
      target: whatsappIntegrationsTable.clientId,
      set: {
        appId: getWhatsappEmbeddedSignupAppId(),
        configId: getWhatsappEmbeddedSignupConfigId(),
        wabaId: parsed.data.wabaId,
        phoneNumberId: parsed.data.phoneNumberId,
        accessToken,
        tokenError: null,
        status: "connected",
        rawPayload: {
          source: "manual_existing_bm_import",
          phoneNumber: payload,
        },
        connectedAt: currentIntegration?.connectedAt ?? new Date(),
        updatedAt: new Date(),
      },
    })
    .returning();

  const phoneNumber = await upsertWhatsappPhoneNumber({
    clientId,
    integrationId: integration?.id ?? currentIntegration?.id ?? null,
    wabaId: parsed.data.wabaId,
    phoneNumberId: parsed.data.phoneNumberId,
    displayPhoneNumber: payload.display_phone_number ?? parsed.data.displayPhoneNumber ?? null,
    verifiedName: payload.verified_name ?? parsed.data.verifiedName ?? null,
    qualityRating: payload.quality_rating ?? null,
    platformType: payload.platform_type ?? null,
    codeVerificationStatus: payload.code_verification_status ?? null,
    rawPayload: {
      source: "manual_existing_bm_import",
      meta: payload,
      input: {
        wabaId: parsed.data.wabaId,
        displayPhoneNumber: parsed.data.displayPhoneNumber ?? null,
        verifiedName: parsed.data.verifiedName ?? null,
      },
    },
  });

  res.status(201).json({
    ok: true,
    integration: serializeIntegration(integration ?? currentIntegration ?? null),
    phoneNumber: phoneNumber ? serializePhoneNumber(phoneNumber) : null,
  });
});

router.post("/whatsapp/connections/subscribe-webhook", async (req, res): Promise<void> => {
  const parsed = SubscribeWhatsappWebhookBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: parsed.error.message,
      status: 400,
    });
    return;
  }

  const clientId = resolveWritableClientId(req, parsed.data.clientId);
  if (!clientId) {
    res.status(400).json({
      error: true,
      code: "CLIENT_REQUIRED",
      message: "Select a client before subscribing the WhatsApp webhook.",
      status: 400,
    });
    return;
  }

  const integration = await getWhatsappIntegrationForPhone(clientId, parsed.data.phoneNumberId ?? null);
  if (!integration?.wabaId || !integration.accessToken) {
    res.status(409).json({
      error: true,
      code: "WHATSAPP_INTEGRATION_REQUIRED",
      message: "Importe/conecte um WABA com token antes de ativar o webhook.",
      status: 409,
    });
    return;
  }

  const subscription = await subscribeWebhookForIntegration(integration);

  if (!subscription.ok) {
    res.status(422).json({
      error: true,
      code: "WHATSAPP_WEBHOOK_SUBSCRIBE_FAILED",
      message: subscription.error ?? "A Meta recusou a assinatura do app no WABA.",
      status: 422,
    });
    return;
  }

  res.json({
    ok: true,
    wabaId: integration.wabaId,
  });
});

router.delete("/whatsapp/connections/phone-numbers/:phoneNumberId", async (req, res): Promise<void> => {
  const phoneNumberId = req.params.phoneNumberId?.trim();
  const clientIdFromQuery = typeof req.query.clientId === "string" ? req.query.clientId : undefined;
  const clientId = resolveWritableClientId(req, clientIdFromQuery);

  if (!clientId) {
    res.status(400).json({
      error: true,
      code: "CLIENT_REQUIRED",
      message: "Select a client before removing a WhatsApp number.",
      status: 400,
    });
    return;
  }

  if (!phoneNumberId) {
    res.status(400).json({
      error: true,
      code: "PHONE_NUMBER_REQUIRED",
      message: "Phone Number ID is required.",
      status: 400,
    });
    return;
  }

  const [removed] = await db
    .delete(whatsappPhoneNumbersTable)
    .where(
      and(
        eq(whatsappPhoneNumbersTable.clientId, clientId),
        eq(whatsappPhoneNumbersTable.phoneNumberId, phoneNumberId),
      ),
    )
    .returning();

  await db
    .update(whatsappIntegrationsTable)
    .set({
      phoneNumberId: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(whatsappIntegrationsTable.clientId, clientId),
        eq(whatsappIntegrationsTable.phoneNumberId, phoneNumberId),
      ),
    );

  res.json({
    ok: true,
    removed: removed ? serializePhoneNumber(removed) : null,
  });
});

router.get("/whatsapp/templates", async (req, res): Promise<void> => {
  const clientId = resolveWritableClientId(req);
  if (!clientId) {
    res.status(400).json({
      error: true,
      code: "CLIENT_REQUIRED",
      message: "Select a client to view WhatsApp templates.",
      status: 400,
    });
    return;
  }

  const phoneNumberId = typeof req.query.phoneNumberId === "string" ? req.query.phoneNumberId : null;
  const integration = await getWhatsappIntegrationForPhone(clientId, phoneNumberId);
  const conditions = [eq(whatsappMessageTemplatesTable.clientId, clientId)];
  if (integration?.wabaId) conditions.push(eq(whatsappMessageTemplatesTable.wabaId, integration.wabaId));

  const templates = await db
    .select()
    .from(whatsappMessageTemplatesTable)
    .where(and(...conditions))
    .orderBy(whatsappMessageTemplatesTable.name);

  res.json({
    total: templates.length,
    data: templates.map(serializeTemplate),
  });
});

router.post("/whatsapp/templates", async (req, res): Promise<void> => {
  const parsed = CreateWhatsappTemplateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: parsed.error.message,
      status: 400,
    });
    return;
  }

  const clientId = resolveWritableClientId(req, parsed.data.clientId);
  if (!clientId) {
    res.status(400).json({
      error: true,
      code: "CLIENT_REQUIRED",
      message: "Select a client before creating WhatsApp templates.",
      status: 400,
    });
    return;
  }

  const integration = await getWhatsappIntegrationForPhone(clientId, parsed.data.phoneNumberId ?? null);
  if (!integration?.wabaId || !integration.accessToken) {
    res.status(409).json({
      error: true,
      code: "WHATSAPP_INTEGRATION_REQUIRED",
      message: "Conecte ou importe um WABA com token antes de criar templates.",
      status: 409,
    });
    return;
  }

  const components: Array<Record<string, string>> = [
    {
      type: "BODY",
      text: parsed.data.bodyText,
    },
  ];
  if (parsed.data.footerText) {
    components.push({
      type: "FOOTER",
      text: parsed.data.footerText,
    });
  }

  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${integration.wabaId}/message_templates`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${integration.accessToken}`,
      },
      body: JSON.stringify({
        name: parsed.data.name,
        language: parsed.data.language,
        category: parsed.data.category,
        components,
      }),
    },
  );
  const payload = (await response.json()) as {
    id?: string;
    status?: string;
    category?: string;
    error?: { message?: string };
  };

  if (!response.ok) {
    res.status(response.status).json({
      error: true,
      code: "META_WHATSAPP_TEMPLATE_CREATE_FAILED",
      message: payload.error?.message ?? "A Meta recusou a criação do template.",
      status: response.status,
    });
    return;
  }

  const template = await upsertWhatsappTemplate({
    clientId,
    integrationId: integration.id,
    wabaId: integration.wabaId,
    templateId: payload.id ?? null,
    name: parsed.data.name,
    language: parsed.data.language,
    status: payload.status ?? "PENDING",
    category: payload.category ?? parsed.data.category,
    components,
    rawPayload: payload,
  });

  res.status(201).json({
    ok: true,
    template: template ? serializeTemplate(template) : null,
  });
});

router.post("/whatsapp/templates/sync", async (req, res): Promise<void> => {
  const parsed = SyncWhatsappTemplatesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: parsed.error.message,
      status: 400,
    });
    return;
  }

  const clientId = resolveWritableClientId(req, parsed.data.clientId);
  if (!clientId) {
    res.status(400).json({
      error: true,
      code: "CLIENT_REQUIRED",
      message: "Select a client before syncing WhatsApp templates.",
      status: 400,
    });
    return;
  }

  const selectedIntegration = parsed.data.phoneNumberId
    ? await getWhatsappIntegrationForPhone(clientId, parsed.data.phoneNumberId)
    : null;
  const integrations = selectedIntegration
    ? [selectedIntegration]
    : await db
        .select()
        .from(whatsappIntegrationsTable)
        .where(eq(whatsappIntegrationsTable.clientId, clientId));

  const templates: Array<ReturnType<typeof serializeTemplate>> = [];
  const errors: string[] = [];
  for (const integration of integrations) {
    const result = await syncTemplatesForIntegration(clientId, integration);
    templates.push(...result.templates);
    if (result.error) errors.push(result.error);
  }

  res.json({
    ok: errors.length === 0,
    synced: templates.length,
    errors,
    templates,
  });
});

router.post("/whatsapp/template-messages", async (req, res): Promise<void> => {
  const parsed = SendWhatsappTemplateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: parsed.error.message,
      status: 400,
    });
    return;
  }

  const clientId = resolveWritableClientId(req, parsed.data.clientId);
  if (!clientId) {
    res.status(400).json({
      error: true,
      code: "CLIENT_REQUIRED",
      message: "Select a client before sending WhatsApp templates.",
      status: 400,
    });
    return;
  }

  const integration = await getWhatsappIntegrationForPhone(clientId, parsed.data.phoneNumberId);
  if (!integration?.accessToken) {
    res.status(409).json({
      error: true,
      code: "WHATSAPP_INTEGRATION_REQUIRED",
      message: "Conecte ou importe o WhatsApp antes de enviar templates.",
      status: 409,
    });
    return;
  }

  const bodyParams = parsed.data.bodyParams
    .map((value) => value.trim())
    .filter(Boolean)
    .map((text) => ({ type: "text", text }));
  const components = bodyParams.length
    ? [
        {
          type: "body",
          parameters: bodyParams,
        },
      ]
    : undefined;

  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${parsed.data.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${integration.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: normalizeWhatsappRecipient(parsed.data.to),
        type: "template",
        template: {
          name: parsed.data.templateName,
          language: {
            code: parsed.data.languageCode,
          },
          ...(components ? { components } : {}),
        },
      }),
    },
  );
  const payload = (await response.json()) as {
    messages?: Array<{ id?: string }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    res.status(response.status).json({
      error: true,
      code: "META_WHATSAPP_TEMPLATE_SEND_FAILED",
      message: payload.error?.message ?? "A Meta recusou o envio do template.",
      status: response.status,
    });
    return;
  }

  const to = normalizeWhatsappRecipient(parsed.data.to);
  const contact = await upsertWhatsappContact({
    clientId,
    waId: to,
    name: null,
    rawPayload: { source: "template_message" },
  });
  const sentAt = new Date();
  const conversation = contact
    ? await findOrCreateWhatsappConversation({
        clientId,
        contactId: contact.id,
        phoneNumberId: parsed.data.phoneNumberId,
        firstMessageAt: sentAt,
        rawPayload: {
          source: "template_message",
          templateName: parsed.data.templateName,
          languageCode: parsed.data.languageCode,
        },
      })
    : null;
  const [message] = conversation && contact
    ? await db
        .insert(whatsappMessagesTable)
        .values({
          clientId,
          conversationId: conversation.id,
          contactId: contact.id,
          phoneNumberId: parsed.data.phoneNumberId,
          externalMessageId: payload.messages?.[0]?.id ?? null,
          direction: "outbound",
          messageType: "template",
          body: `Template: ${parsed.data.templateName}`,
          rawPayload: {
            meta: payload,
            template: {
              name: parsed.data.templateName,
              languageCode: parsed.data.languageCode,
              bodyParams: parsed.data.bodyParams,
            },
          },
          sentAt,
        })
        .returning()
    : [];

  res.status(201).json({
    ok: true,
    conversationId: conversation?.id ?? null,
    message: {
      id: message?.id ?? "",
      externalMessageId: message?.externalMessageId ?? payload.messages?.[0]?.id ?? null,
      sentAt: message?.sentAt.toISOString() ?? sentAt.toISOString(),
    } satisfies { id: string; externalMessageId: string | null; sentAt: string },
  });
});

router.get("/whatsapp/conversations", async (req, res): Promise<void> => {
  const clientId = resolveWritableClientId(req);
  if (!clientId) {
    res.status(400).json({
      error: true,
      code: "CLIENT_REQUIRED",
      message: "Select a client to view WhatsApp conversations.",
      status: 400,
    });
    return;
  }

  const limit = Math.min(Number(req.query.limit ?? 60) || 60, 100);
  const phoneNumberId = typeof req.query.phoneNumberId === "string" ? req.query.phoneNumberId : null;
  const conditions = [eq(whatsappConversationsTable.clientId, clientId)];
  if (phoneNumberId) conditions.push(eq(whatsappConversationsTable.phoneNumberId, phoneNumberId));
  const conversations = await db
    .select()
    .from(whatsappConversationsTable)
    .where(and(...conditions))
    .orderBy(desc(whatsappConversationsTable.updatedAt))
    .limit(limit);

  const contactIds = conversations
    .map((conversation) => conversation.contactId)
    .filter((id): id is string => Boolean(id));
  const conversationIds = conversations.map((conversation) => conversation.id);

  const contacts = contactIds.length
    ? await db
        .select()
        .from(whatsappContactsTable)
        .where(inArray(whatsappContactsTable.id, contactIds))
    : [];
  const contactMap = new Map(contacts.map((contact) => [contact.id, contact]));

  const messages = conversationIds.length
    ? await db
        .select()
        .from(whatsappMessagesTable)
        .where(inArray(whatsappMessagesTable.conversationId, conversationIds))
        .orderBy(desc(whatsappMessagesTable.sentAt))
    : [];

  const messagesByConversation = new Map<string, typeof messages>();
  for (const message of messages) {
    if (!message.conversationId) continue;
    const current = messagesByConversation.get(message.conversationId) ?? [];
    current.push(message);
    messagesByConversation.set(message.conversationId, current);
  }

  const data = conversations.map((conversation) => {
    const contact = conversation.contactId ? contactMap.get(conversation.contactId) : null;
    const rows = messagesByConversation.get(conversation.id) ?? [];
    const lastOutboundAt = rows
      .filter((message) => message.direction === "outbound")
      .map((message) => message.sentAt.getTime())
      .sort((a, b) => b - a)[0] ?? 0;
    const unreadCount = rows.filter(
      (message) => message.direction === "inbound" && message.sentAt.getTime() > lastOutboundAt,
    ).length;
    const inboundCount = rows.filter((message) => message.direction === "inbound").length;
    const outboundCount = rows.filter((message) => message.direction === "outbound").length;
    const firstInbound = [...rows]
      .filter((message) => message.direction === "inbound")
      .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())[0];
    const firstOutbound = [...rows]
      .filter((message) => message.direction === "outbound")
      .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())[0];
    const firstResponseMinutes =
      firstInbound && firstOutbound
        ? Math.max(0, Math.round((firstOutbound.sentAt.getTime() - firstInbound.sentAt.getTime()) / 60000))
        : null;

    return {
      id: conversation.id,
      customerName: contact?.name ?? contact?.phone ?? "Contato WhatsApp",
      phone: contact?.phone ?? contact?.waId ?? "-",
      waId: contact?.waId ?? null,
      phoneNumberId: conversation.phoneNumberId,
      status: conversation.status,
      stage: conversation.funnelStage,
      leadType: "new",
      agentId: conversation.agentId ?? "unassigned",
      firstMessageAt: iso(conversation.firstMessageAt ?? conversation.createdAt),
      firstResponseAt: iso(conversation.firstResponseAt),
      firstResponseMinutes,
      messagesReceived: inboundCount,
      messagesSent: outboundCount,
      unreadCount,
      followUpsSent: 0,
      closedAt: iso(conversation.closedAt),
      lostReason: conversation.lostReason,
      lastMessage: rows[0]
        ? {
            id: rows[0].id,
            direction: rows[0].direction,
            body: rows[0].body,
            messageType: rows[0].messageType,
            sentAt: rows[0].sentAt.toISOString(),
          }
        : null,
      updatedAt: conversation.updatedAt.toISOString(),
    };
  });

  const totalUnread = data.reduce((sum, conversation) => sum + conversation.unreadCount, 0);

  res.json({
    total: data.length,
    totalUnread,
    data,
  });
});

router.get("/whatsapp/conversations/:conversationId", async (req, res): Promise<void> => {
  const clientId = resolveWritableClientId(req);
  if (!clientId) {
    res.status(400).json({
      error: true,
      code: "CLIENT_REQUIRED",
      message: "Select a client to view WhatsApp conversations.",
      status: 400,
    });
    return;
  }

  const [conversation] = await db
    .select()
    .from(whatsappConversationsTable)
    .where(
      and(
        eq(whatsappConversationsTable.id, req.params.conversationId),
        eq(whatsappConversationsTable.clientId, clientId),
      ),
    )
    .limit(1);

  if (!conversation) {
    res.status(404).json({
      error: true,
      code: "CONVERSATION_NOT_FOUND",
      message: "WhatsApp conversation not found.",
      status: 404,
    });
    return;
  }

  const [contact] = conversation.contactId
    ? await db
        .select()
        .from(whatsappContactsTable)
        .where(eq(whatsappContactsTable.id, conversation.contactId))
        .limit(1)
    : [];

  const messages = await db
    .select()
    .from(whatsappMessagesTable)
    .where(
      and(
        eq(whatsappMessagesTable.clientId, clientId),
        eq(whatsappMessagesTable.conversationId, conversation.id),
      ),
    )
    .orderBy(whatsappMessagesTable.sentAt);

  res.json({
    conversation: {
      id: conversation.id,
      customerName: contact?.name ?? contact?.phone ?? "Contato WhatsApp",
      phone: contact?.phone ?? contact?.waId ?? "-",
      waId: contact?.waId ?? null,
      phoneNumberId: conversation.phoneNumberId,
      status: conversation.status,
      stage: conversation.funnelStage,
      firstMessageAt: iso(conversation.firstMessageAt ?? conversation.createdAt),
      updatedAt: conversation.updatedAt.toISOString(),
    },
    messages: messages.map((message) => ({
      id: message.id,
      externalMessageId: message.externalMessageId,
      direction: message.direction,
      messageType: message.messageType,
      body: message.body,
      sentAt: message.sentAt.toISOString(),
    })),
  });
});

router.post("/whatsapp/conversations/:conversationId/messages", async (req, res): Promise<void> => {
  const parsed = SendWhatsappMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: parsed.error.message,
      status: 400,
    });
    return;
  }

  const clientId = resolveWritableClientId(req);
  if (!clientId) {
    res.status(400).json({
      error: true,
      code: "CLIENT_REQUIRED",
      message: "Select a client to send WhatsApp messages.",
      status: 400,
    });
    return;
  }

  const [conversation] = await db
    .select()
    .from(whatsappConversationsTable)
    .where(
      and(
        eq(whatsappConversationsTable.id, req.params.conversationId),
        eq(whatsappConversationsTable.clientId, clientId),
      ),
    )
    .limit(1);
  if (!conversation?.contactId) {
    res.status(404).json({
      error: true,
      code: "CONVERSATION_NOT_FOUND",
      message: "WhatsApp conversation not found.",
      status: 404,
    });
    return;
  }

  const [contact] = await db
    .select()
    .from(whatsappContactsTable)
    .where(eq(whatsappContactsTable.id, conversation.contactId))
    .limit(1);
  const [integration] = await db
    .select()
    .from(whatsappIntegrationsTable)
    .where(eq(whatsappIntegrationsTable.clientId, clientId))
    .limit(1);
  const sendIntegration = await getWhatsappIntegrationForPhone(
    clientId,
    parsed.data.phoneNumberId ?? conversation.phoneNumberId ?? integration?.phoneNumberId ?? null,
  );
  const sendPhoneNumberId = parsed.data.phoneNumberId ?? conversation.phoneNumberId ?? sendIntegration?.phoneNumberId ?? null;

  if (!contact || !sendPhoneNumberId || !sendIntegration?.accessToken) {
    res.status(409).json({
      error: true,
      code: "WHATSAPP_INTEGRATION_REQUIRED",
      message: "Conecte o WhatsApp antes de enviar mensagens.",
      status: 409,
    });
    return;
  }

  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${sendPhoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sendIntegration.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: contact.waId,
        type: "text",
        text: {
          preview_url: false,
          body: parsed.data.body,
        },
      }),
    },
  );
  const payload = (await response.json()) as {
    messages?: Array<{ id?: string }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    res.status(response.status).json({
      error: true,
      code: "META_WHATSAPP_SEND_FAILED",
      message: payload.error?.message ?? "A Meta recusou o envio da mensagem.",
      status: response.status,
    });
    return;
  }

  const sentAt = new Date();
  const [message] = await db
    .insert(whatsappMessagesTable)
    .values({
      clientId,
      conversationId: conversation.id,
      contactId: contact.id,
      phoneNumberId: sendPhoneNumberId,
      externalMessageId: payload.messages?.[0]?.id ?? null,
      direction: "outbound",
      messageType: "text",
      body: parsed.data.body,
      rawPayload: payload,
      sentAt,
    })
    .returning();

  await db
    .update(whatsappConversationsTable)
    .set({
      status: "in_progress",
      funnelStage: conversation.funnelStage === "new_lead" ? "in_service" : conversation.funnelStage,
      firstResponseAt: sql`coalesce(${whatsappConversationsTable.firstResponseAt}, ${sentAt})`,
      updatedAt: sentAt,
    })
    .where(eq(whatsappConversationsTable.id, conversation.id));

  res.status(201).json({
    ok: true,
    message: message
      ? {
          id: message.id,
          externalMessageId: message.externalMessageId,
          direction: message.direction,
          messageType: message.messageType,
          body: message.body,
          sentAt: message.sentAt.toISOString(),
        }
      : null,
  });
});

router.post("/whatsapp/test-messages", async (req, res): Promise<void> => {
  const parsed = TestWhatsappMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: parsed.error.message,
      status: 400,
    });
    return;
  }

  const clientId = resolveWritableClientId(req, parsed.data.clientId);
  if (!clientId) {
    res.status(400).json({
      error: true,
      code: "CLIENT_REQUIRED",
      message: "Select a client before sending WhatsApp test messages.",
      status: 400,
    });
    return;
  }

  const integration = await getWhatsappIntegrationForPhone(clientId, parsed.data.phoneNumberId);
  if (!integration?.accessToken) {
    res.status(409).json({
      error: true,
      code: "WHATSAPP_INTEGRATION_REQUIRED",
      message: "Conecte ou sincronize um número de WhatsApp antes de enviar teste.",
      status: 409,
    });
    return;
  }

  const to = normalizeWhatsappRecipient(parsed.data.to);
  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${parsed.data.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${integration.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: {
          preview_url: false,
          body: parsed.data.body,
        },
      }),
    },
  );
  const payload = (await response.json()) as {
    messages?: Array<{ id?: string }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    res.status(response.status).json({
      error: true,
      code: "META_WHATSAPP_TEST_SEND_FAILED",
      message: payload.error?.message ?? "A Meta recusou o envio do teste.",
      status: response.status,
    });
    return;
  }

  const contact = await upsertWhatsappContact({
    clientId,
    waId: to,
    name: null,
    rawPayload: { source: "test_message" },
  });
  const sentAt = new Date();
  const conversation = contact
    ? await findOrCreateWhatsappConversation({
        clientId,
        contactId: contact.id,
        phoneNumberId: parsed.data.phoneNumberId,
        firstMessageAt: sentAt,
        rawPayload: { source: "test_message" },
      })
    : null;

  const [message] = conversation && contact
    ? await db
        .insert(whatsappMessagesTable)
        .values({
          clientId,
          conversationId: conversation.id,
          contactId: contact.id,
          phoneNumberId: parsed.data.phoneNumberId,
          externalMessageId: payload.messages?.[0]?.id ?? null,
          direction: "outbound",
          messageType: "text",
          body: parsed.data.body,
          rawPayload: payload,
          sentAt,
        })
        .returning()
    : [];

  res.status(201).json({
    ok: true,
    conversationId: conversation?.id ?? null,
    message: message
      ? {
          id: message.id,
          externalMessageId: message.externalMessageId,
          direction: message.direction,
          messageType: message.messageType,
          body: message.body,
          sentAt: message.sentAt.toISOString(),
        }
      : null,
  });
});

router.get("/whatsapp/embedded-signup", async (req, res): Promise<void> => {
  const clientId = resolveWritableClientId(req);
  if (!clientId) {
    res.status(400).json({
      error: true,
      code: "CLIENT_REQUIRED",
      message: "Select a client to configure WhatsApp Embedded Signup.",
      status: 400,
    });
    return;
  }

  const [client] = await db
    .select({ id: clientsTable.id, name: clientsTable.name })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId))
    .limit(1);

  if (!client) {
    res.status(404).json({
      error: true,
      code: "CLIENT_NOT_FOUND",
      message: "Client not found.",
      status: 404,
    });
    return;
  }

  const [integration] = await db
    .select()
    .from(whatsappIntegrationsTable)
    .where(eq(whatsappIntegrationsTable.clientId, clientId))
    .limit(1);

  const appId = getWhatsappEmbeddedSignupAppId();
  const configId = getWhatsappEmbeddedSignupConfigId();

  res.json({
    client,
    facebook: {
      appId,
      configId,
      graphApiVersion: GRAPH_API_VERSION,
      isConfigured: Boolean(appId && configId),
      hasSystemUserToken: Boolean(getWhatsappSystemUserAccessToken()),
      hasDiscoveryBusinessId: getWhatsappDiscoveryBusinessIds().length > 0,
    },
    integration: serializeIntegration(integration ?? null),
  });
});

router.post("/whatsapp/embedded-signup", async (req, res): Promise<void> => {
  const parsed = SaveEmbeddedSignupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: parsed.error.message,
      status: 400,
    });
    return;
  }

  const clientId = resolveWritableClientId(req, parsed.data.clientId);
  if (!clientId) {
    res.status(400).json({
      error: true,
      code: "CLIENT_REQUIRED",
      message: "Select a client before saving WhatsApp Embedded Signup.",
      status: 400,
    });
    return;
  }

  const appId = getWhatsappEmbeddedSignupAppId();
  const configId = getWhatsappEmbeddedSignupConfigId();
  const token = parsed.data.code
    ? await exchangeEmbeddedSignupCode(
        parsed.data.code,
        appId,
        getMetaAppSecret(),
        parsed.data.redirectUri,
      )
    : {
        accessToken: null,
        tokenType: null,
        tokenExpiresAt: null,
        error: null,
      };
  const hasSignupIdentity = parsed.data.event === "FINISH" || parsed.data.wabaId || parsed.data.phoneNumberId;
  if (!hasSignupIdentity || !token.accessToken) {
    res.status(422).json({
      error: true,
      code: "WHATSAPP_SIGNUP_INCOMPLETE",
      message:
        token.error ??
        "Embedded Signup ainda não retornou WABA, número e token. Refaca a conexão.",
      status: 422,
    });
    return;
  }

  const status = "connected";

  const [integration] = await db
    .insert(whatsappIntegrationsTable)
    .values({
      clientId,
      appId,
      configId,
      businessId: parsed.data.businessId ?? null,
      wabaId: parsed.data.wabaId ?? null,
      phoneNumberId: parsed.data.phoneNumberId ?? null,
      signupCode: parsed.data.code ?? null,
      accessToken: token.accessToken,
      tokenType: token.tokenType,
      tokenExpiresAt: token.tokenExpiresAt,
      tokenError: null,
      status,
      rawPayload: parsed.data.rawPayload ?? null,
      connectedAt: status === "connected" ? new Date() : null,
    })
    .onConflictDoUpdate({
      target: whatsappIntegrationsTable.clientId,
      set: {
        appId,
        configId,
        businessId: parsed.data.businessId ?? null,
        wabaId: parsed.data.wabaId ?? null,
        phoneNumberId: parsed.data.phoneNumberId ?? null,
        signupCode: parsed.data.code ?? null,
        accessToken: token.accessToken,
        tokenType: token.tokenType,
        tokenExpiresAt: token.tokenExpiresAt,
        tokenError: null,
        status,
        rawPayload: parsed.data.rawPayload ?? null,
        connectedAt: status === "connected" ? new Date() : null,
        updatedAt: new Date(),
      },
    })
    .returning();

  let phoneNumber: ReturnType<typeof serializePhoneNumber> | null = null;
  let webhookSubscription: Awaited<ReturnType<typeof subscribeWebhookForIntegration>> | null = null;
  let templatesSynced = 0;
  let templateSyncError: string | null = null;

  if (integration?.phoneNumberId) {
    const row = await upsertWhatsappPhoneNumber({
      clientId,
      integrationId: integration.id,
      wabaId: integration.wabaId,
      phoneNumberId: integration.phoneNumberId,
      rawPayload: { source: "embedded_signup" },
    });
    phoneNumber = row ? serializePhoneNumber(row) : null;
  }

  if (integration) {
    webhookSubscription = await subscribeWebhookForIntegration(integration);
    const templateSync = await syncTemplatesForIntegration(clientId, integration);
    templatesSynced = templateSync.templates.length;
    templateSyncError = templateSync.error;
  }

  // Future server-side completion point:
  // Exchange `signupCode` for a customer-scoped business integration token
  // using the Meta app secret, then store only encrypted credentials.
  res.status(201).json({
    ok: true,
    integration: serializeIntegration(integration ?? null),
    phoneNumber,
    webhookSubscription,
    templatesSynced,
    templateSyncError,
  });
});

router.post("/whatsapp/embedded-signup/reset", async (req, res): Promise<void> => {
  const parsed = ResetEmbeddedSignupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: parsed.error.message,
      status: 400,
    });
    return;
  }

  const clientId = resolveWritableClientId(req, parsed.data.clientId);
  if (!clientId) {
    res.status(400).json({
      error: true,
      code: "CLIENT_REQUIRED",
      message: "Select a client before resetting WhatsApp Embedded Signup.",
      status: 400,
    });
    return;
  }

  await db
    .delete(whatsappIntegrationsTable)
    .where(eq(whatsappIntegrationsTable.clientId, clientId));

  res.json({ ok: true });
});

router.post("/whatsapp/meta-test-calls", async (req, res): Promise<void> => {
  const parsed = MetaTestCallsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: parsed.error.message,
      status: 400,
    });
    return;
  }

  const clientId = resolveWritableClientId(req, parsed.data.clientId);
  if (!clientId) {
    res.status(400).json({
      error: true,
      code: "CLIENT_REQUIRED",
      message: "Select a client before running Meta test calls.",
      status: 400,
    });
    return;
  }

  const [integration] = await db
    .select()
    .from(whatsappIntegrationsTable)
    .where(eq(whatsappIntegrationsTable.clientId, clientId))
    .limit(1);

  if (!integration?.accessToken) {
    res.status(409).json({
      error: true,
      code: "WHATSAPP_TOKEN_REQUIRED",
      message: "Conclua o Embedded Signup antes de executar os testes de API da Meta.",
      status: 409,
    });
    return;
  }

  const publicProfile = await runMetaGraphTestCall(
    "public_profile",
    "/me?fields=id,name",
    integration.accessToken,
  );

  const businessManagementPrimary = await runMetaGraphTestCall(
    "business_management",
    "/me/businesses?fields=id,name,verification_status",
    integration.accessToken,
  );
  const businessManagement =
    businessManagementPrimary.ok || !integration.businessId
      ? businessManagementPrimary
      : await runMetaGraphTestCall(
          "business_management",
          `/${integration.businessId}?fields=id,name,verification_status`,
          integration.accessToken,
        );

  res.json({
    ok: publicProfile.ok && businessManagement.ok,
    testedAt: new Date().toISOString(),
    results: [publicProfile, businessManagement],
  });
});

export default router;
