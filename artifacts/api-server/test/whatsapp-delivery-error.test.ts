import { describe, expect, it } from "vitest";
import { describeWhatsappDeliveryError } from "../src/services/whatsapp-delivery-error";

describe("WhatsApp delivery errors", () => {
  it("explains Meta error 131026", () => {
    expect(describeWhatsappDeliveryError({
      code: 131026,
      title: "Receiver is incapable of receiving this message",
      error_data: { details: "Message Undeliverable." },
    })).toContain("Meta 131026");
  });

  it("preserves unknown Meta error details and code", () => {
    expect(describeWhatsappDeliveryError({
      code: 131999,
      error_data: { details: "Unknown delivery error" },
    })).toBe("Meta 131999: Unknown delivery error");
  });
});
