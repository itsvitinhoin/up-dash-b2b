import { Router, type IRouter, type Request } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { logger } from "../lib/logger";
import { authenticate, resolveClientId } from "../middlewares/auth";
import { clientsTable, db, whatsappIntegrationsTable } from "@workspace/db";

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

type TokenExchangeResult = {
  accessToken: string | null;
  tokenType: string | null;
  tokenExpiresAt: Date | null;
  error: string | null;
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

router.post("/webhooks/whatsapp", (req, res): void => {
  const payload = req.body as WhatsappWebhookPayload;
  const summary = summarizePayload(payload);

  // Future persistence point:
  // 1. Resolve the client by phone_number_id.
  // 2. Upsert WhatsappContact records from contacts/messages.
  // 3. Upsert WhatsappConversation + WhatsappMessage rows.
  // 4. Store the complete raw payload in rawPayload for audit/debug.
  logger.info({ summary }, "whatsapp webhook received");

  res.status(200).json({
    ok: true,
    receivedAt: new Date().toISOString(),
    summary,
  });
});

router.use("/whatsapp", authenticate);

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
        parsed.data.redirectUri,
      )
    : {
        accessToken: null,
        tokenType: null,
        tokenExpiresAt: null,
        error: null,
      };
  const hasSignupIdentity = parsed.data.event === "FINISH" || parsed.data.wabaId || parsed.data.phoneNumberId;
  const status = hasSignupIdentity && token.accessToken
    ? "connected"
    : token.error
      ? "failed"
      : "pending";

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
      tokenError: token.error,
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
        tokenError: token.error,
        status,
        rawPayload: parsed.data.rawPayload ?? null,
        connectedAt: status === "connected" ? new Date() : null,
        updatedAt: new Date(),
      },
    })
    .returning();

  // Future server-side completion point:
  // Exchange `signupCode` for a customer-scoped business integration token
  // using the Meta app secret, then store only encrypted credentials.
  res.status(201).json({
    ok: true,
    integration: serializeIntegration(integration ?? null),
  });
});

export default router;
