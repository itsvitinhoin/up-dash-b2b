import { describe, expect, it } from "vitest";
import { deriveWhatsappConnectionHealth } from "../src/services/whatsapp-connection-health";

const connected = {
  phoneWabaId: "waba-1",
  integrationStatus: "connected",
  hasAccessToken: true,
  tokenError: null,
  lastSuccessfulDispatchAt: null,
  lastFailureAt: null,
  lastFailureMessage: null,
};

describe("WhatsApp connection health", () => {
  it("marks a connected WABA with a token as healthy", () => {
    expect(deriveWhatsappConnectionHealth(connected).status).toBe("healthy");
  });

  it("requires reconnection only when that WABA has no token", () => {
    const result = deriveWhatsappConnectionHealth({
      ...connected,
      hasAccessToken: false,
    });
    expect(result.status).toBe("error");
    expect(result.message).toContain("Reconecte somente esta conta");
  });

  it("keeps the connection red when the latest dispatch failed", () => {
    const result = deriveWhatsappConnectionHealth({
      ...connected,
      lastSuccessfulDispatchAt: new Date("2026-08-07T10:00:00Z"),
      lastFailureAt: new Date("2026-08-07T10:01:00Z"),
      lastFailureMessage: "Meta 131042",
    });
    expect(result).toMatchObject({ status: "error", message: "Meta 131042" });
  });

  it("clears an older failure after a newer accepted dispatch", () => {
    const result = deriveWhatsappConnectionHealth({
      ...connected,
      lastSuccessfulDispatchAt: new Date("2026-08-07T10:02:00Z"),
      lastFailureAt: new Date("2026-08-07T10:01:00Z"),
      lastFailureMessage: "Falha antiga",
    });
    expect(result.status).toBe("healthy");
  });
});
