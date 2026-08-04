import { describe, expect, it } from "vitest";
import {
  getCartAutomationDedupeKey,
  getCartAutomationIdentity,
  getWebhookCustomerIdentity,
  getWebhookOrderIdentity,
  getWebhookPayloadLayers,
  selectWebhookCustomerContact,
} from "../src/services/orchestrator-webhook";

describe("orchestrator webhook payload", () => {
  const payload = {
    event: "cart_abandoned",
    timestamp: "2026-07-30T00:00:01.029Z",
    data: {
      id: 57081,
      cart_id: 57081,
      phone: "(11) 94225-7099",
      customer: {
        id: 2782,
        name: "Grupo Up Teste",
      },
    },
  };

  it("unwraps the UP Zero data envelope without losing envelope metadata", () => {
    const layers = getWebhookPayloadLayers(payload);

    expect(layers.root.cart_id).toBe(57081);
    expect(layers.root.event).toBe("cart_abandoned");
    expect(layers.root.timestamp).toBe("2026-07-30T00:00:01.029Z");
  });

  it("uses the nested cart id as the stable automation identity", () => {
    expect(getCartAutomationIdentity("cart_abandoned", payload)).toBe("57081");
    expect(getCartAutomationIdentity("cart_created", payload)).toBe("57081");
  });

  it("does not apply cart identity to unrelated events", () => {
    expect(getCartAutomationIdentity("customer.approved", payload)).toBeNull();
  });

  it("keeps the same dedupe key across repeated updates of the same cart", () => {
    const first = getCartAutomationDedupeKey({
      eventType: "cart_abandoned",
      payload,
      recipient: "5511942257099",
    });
    const repeated = getCartAutomationDedupeKey({
      eventType: "cart_abandoned",
      payload: {
        ...payload,
        timestamp: "2026-07-31T12:00:00Z",
      },
      recipient: "5511942257099",
    });

    expect(first).toBe("cart:57081");
    expect(repeated).toBe(first);
  });

  it("allows a new automation for a different cart", () => {
    const first = getCartAutomationDedupeKey({
      eventType: "cart_abandoned",
      payload,
      recipient: "5511942257099",
    });
    const nextCart = getCartAutomationDedupeKey({
      eventType: "cart_abandoned",
      payload: { ...payload, data: { ...payload.data, id: 57082, cart_id: 57082 } },
      recipient: "5511942257099",
    });

    expect(first).toBe("cart:57081");
    expect(nextCart).toBe("cart:57082");
  });

  it("uses a stable recipient lock when the platform omits the cart id", () => {
    const withoutCartId = { event: "cart_abandoned", data: { phone: "(11) 94225-7099" } };
    const first = getCartAutomationDedupeKey({
      eventType: "cart_abandoned",
      payload: withoutCartId,
      recipient: "5511942257099",
    });
    const repeated = getCartAutomationDedupeKey({
      eventType: "cart_abandoned",
      payload: withoutCartId,
      recipient: "5511942257099",
    });

    expect(first).toBe("recipient:5511942257099");
    expect(repeated).toBe(first);
  });

  it("uses data.id as the external customer id for customer events", () => {
    const customerPayload = {
      event: "customer.approved",
      data: {
        id: 3717,
        email: "teste@teste.com",
        phone: "(11) 93022-6613",
      },
    };

    expect(getWebhookCustomerIdentity("customer.approved", customerPayload)).toBe("3717");
    expect(getWebhookOrderIdentity("customer.approved", customerPayload)).toBeNull();
  });

  it("uses data.id as the external order id only for order events", () => {
    const orderPayload = {
      event: "order.created",
      data: {
        id: 1763,
        phone: "(11) 93022-6613",
      },
    };

    expect(getWebhookOrderIdentity("order.created", orderPayload)).toBe("1763");
    expect(getWebhookCustomerIdentity("order.created", orderPayload)).toBeNull();
  });

  it("keeps the explicit webhook contact ahead of stale stored data", () => {
    expect(
      selectWebhookCustomerContact("(11) 93022-6613", "(11) 94225-7099"),
    ).toBe("(11) 93022-6613");
    expect(selectWebhookCustomerContact(null, "(11) 94225-7099")).toBe("(11) 94225-7099");
  });
});
