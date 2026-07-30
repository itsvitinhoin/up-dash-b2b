export type WebhookPayloadLayers = {
  envelope: Record<string, unknown>;
  data: Record<string, unknown>;
  root: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null;
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

export function getWebhookPayloadLayers(payload: unknown): WebhookPayloadLayers {
  const envelope = asRecord(payload) ?? {};
  const data = asRecord(envelope.data) ?? {};

  return {
    envelope,
    data,
    root: {
      ...data,
      ...envelope,
    },
  };
}

export function getCartAutomationIdentity(
  eventType: string | null | undefined,
  payload: unknown,
): string | null {
  const normalizedEventType = eventType?.trim().toLowerCase();
  if (!["cart_created", "cart_abandoned"].includes(normalizedEventType ?? "")) {
    return null;
  }

  const { root, data } = getWebhookPayloadLayers(payload);
  const cart = asRecord(root.cart) ?? {};

  return firstText(
    root.cart_id,
    root.cartId,
    cart.id,
    cart.external_id,
    data.cart_id,
    data.cartId,
    data.id,
  );
}
