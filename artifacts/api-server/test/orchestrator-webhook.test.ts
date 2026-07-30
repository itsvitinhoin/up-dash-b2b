import { describe, expect, it } from "vitest";
import {
  getCartAutomationIdentity,
  getWebhookPayloadLayers,
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
});
