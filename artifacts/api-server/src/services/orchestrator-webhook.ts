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

export function getCartAutomationDedupeKey(params: {
  eventType: string | null | undefined;
  payload: unknown;
  recipient: string | null | undefined;
}): string | null {
  const normalizedEventType = params.eventType?.trim().toLowerCase();
  if (!["cart_created", "cart_abandoned"].includes(normalizedEventType ?? "")) {
    return null;
  }

  const cartId = getCartAutomationIdentity(normalizedEventType, params.payload);
  if (cartId) return `cart:${cartId}`;

  const recipient = params.recipient?.replace(/\D/g, "") ?? "";
  if (!recipient) return null;
  return `recipient:${recipient}`;
}

export function getWebhookCustomerIdentity(
  eventType: string | null | undefined,
  payload: unknown,
): string | null {
  const normalizedEventType = eventType?.trim().toLowerCase() ?? "";
  const { root } = getWebhookPayloadLayers(payload);
  const customer = asRecord(root.customer) ?? asRecord(root.user) ?? asRecord(root.lead) ?? {};

  return firstText(
    root.customer_id,
    root.customerId,
    root.user_id,
    root.userId,
    customer.id,
    customer.external_id,
    normalizedEventType.startsWith("customer.") ? root.id : null,
  );
}

export function getWebhookOrderIdentity(
  eventType: string | null | undefined,
  payload: unknown,
): string | null {
  const normalizedEventType = eventType?.trim().toLowerCase() ?? "";
  const { root } = getWebhookPayloadLayers(payload);
  const order = asRecord(root.order) ?? {};

  return firstText(
    root.order_number,
    root.order_id,
    root.orderId,
    order.id,
    order.external_id,
    order.code,
    order.number,
    normalizedEventType.startsWith("order.") ? root.id : null,
  );
}

export function selectWebhookCustomerContact(
  webhookValue: string | null | undefined,
  storedValue: string | null | undefined,
): string | null {
  return firstText(webhookValue, storedValue);
}
