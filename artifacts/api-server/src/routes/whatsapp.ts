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
  whatsappMessagesTable,
  whatsappPhoneNumbersTable,
} from "@workspace/db";

const router: IRouter = Router();

const GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION ?? "v23.0";

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
  const phoneNumberIds = new Set<string>();

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      messages += change.value?.messages?.length ?? 0;
      statuses += change.value?.statuses?.length ?? 0;
      contacts += change.value?.contacts?.length ?? 0;
      const phoneNumberId = change.value?.metadata?.phone_number_id;
      if (phoneNumberId) phoneNumberIds.add(phoneNumberId);
    }
  }

  return {
    messages,
    statuses,
    contacts,
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

function normalizeWhatsappRecipient(value: string): string {
  return value.replace(/\D/g, "");
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

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      const integration = await resolveWhatsappClientByPhoneNumber(phoneNumberId);
      if (!integration) {
        logger.warn({ phoneNumberId }, "whatsapp webhook received for unknown phone number");
        continue;
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

  logger.info({ summary, persistedMessages, persistedStatuses }, "whatsapp webhook received");

  res.status(200).json({
    ok: true,
    receivedAt: new Date().toISOString(),
    summary: {
      ...summary,
      persistedMessages,
      persistedStatuses,
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
    callbackUrl: "https://www.grupoup-dash.com.br/api/webhooks/whatsapp",
    webhookVerifyTokenConfigured: Boolean(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN),
    integrations: integrations.map(serializeIntegration),
    phoneNumbers: phoneNumbers.map(serializePhoneNumber),
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

  for (const integration of integrations) {
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
    errors,
    phoneNumbers: synced,
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

  if (integration?.phoneNumberId) {
    await upsertWhatsappPhoneNumber({
      clientId,
      integrationId: integration.id,
      wabaId: integration.wabaId,
      phoneNumberId: integration.phoneNumberId,
      rawPayload: { source: "embedded_signup" },
    });
  }

  // Future server-side completion point:
  // Exchange `signupCode` for a customer-scoped business integration token
  // using the Meta app secret, then store only encrypted credentials.
  res.status(201).json({
    ok: true,
    integration: serializeIntegration(integration ?? null),
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
