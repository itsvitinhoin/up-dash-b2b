import { Router, type IRouter } from "express";
import { z } from "zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

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

export default router;
