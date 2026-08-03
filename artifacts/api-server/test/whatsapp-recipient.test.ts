import { describe, expect, it } from "vitest";
import {
  maskWhatsappRecipient,
  normalizeWhatsappRecipient,
  validateWhatsappRecipient,
} from "../src/services/whatsapp-recipient";

describe("WhatsApp recipient validation", () => {
  it("normalizes a Brazilian mobile number to E.164", () => {
    expect(normalizeWhatsappRecipient("(14) 99696-8775")).toBe("5514996968775");
    expect(validateWhatsappRecipient("(14) 99696-8775")).toEqual({
      normalized: "5514996968775",
      isValid: true,
      reason: null,
    });
  });

  it("keeps an already normalized Brazilian number", () => {
    expect(normalizeWhatsappRecipient("+55 14 99696-8775")).toBe("5514996968775");
  });

  it("rejects a nine-digit Brazilian subscriber that does not start with 9", () => {
    expect(validateWhatsappRecipient("(11) 29840-1291")).toEqual({
      normalized: "5511298401291",
      isValid: false,
      reason: "celular brasileiro com 9 dígitos deve começar por 9",
    });
  });

  it("accepts a Brazilian landline with eight subscriber digits", () => {
    expect(validateWhatsappRecipient("(11) 2984-0129").isValid).toBe(true);
  });

  it("masks all but the final four digits", () => {
    expect(maskWhatsappRecipient("5514996968775")).toBe("*********8775");
  });
});
