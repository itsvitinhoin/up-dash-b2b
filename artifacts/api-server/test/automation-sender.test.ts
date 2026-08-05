import { describe, expect, it } from "vitest";
import {
  buildAutomationSenderWabaCandidates,
  buildAutomationWabaCandidates,
  selectAutomationTemplateByWaba,
  selectAutomationSenderPhone,
  type AutomationSenderPhoneCandidate,
} from "../src/services/automation-sender";

const defaultPhone: AutomationSenderPhoneCandidate = {
  phoneNumberId: "phone-default",
  displayPhoneNumber: "+55 11 90000-0000",
  verifiedName: "Loja",
  integrationId: "integration-default",
  wabaId: "waba-default",
  isDefault: true,
};

const sellerPhone: AutomationSenderPhoneCandidate = {
  phoneNumberId: "phone-seller",
  displayPhoneNumber: "+55 11 98888-7777",
  verifiedName: "Vendedora Ana",
  integrationId: "integration-seller",
  wabaId: "waba-seller",
  isDefault: false,
};

describe("WhatsApp automation sender selection", () => {
  it("uses the connected seller number when seller_phone matches", () => {
    const result = selectAutomationSenderPhone(
      [defaultPhone, sellerPhone],
      "(11) 98888-7777",
    );

    expect(result.phone?.phoneNumberId).toBe("phone-seller");
    expect(result.source).toBe("seller_phone");
    expect(result.blockedReason).toBeNull();
  });

  it("reuses one shared WABA for the seller and default integration", () => {
    expect(
      buildAutomationWabaCandidates("waba-mx", "waba-mx", null),
    ).toEqual(["waba-mx"]);
  });

  it("keeps both local WABA references while stale phone data is repaired", () => {
    expect(
      buildAutomationWabaCandidates("waba-mx", "waba-phone-stale"),
    ).toEqual(["waba-mx", "waba-phone-stale"]);
  });

  it("includes the approved catalog WABA when integration metadata is stale", () => {
    expect(
      buildAutomationSenderWabaCandidates({
        phoneWabaId: "waba-stale",
        integrationWabaId: "waba-stale",
        storedWabaIds: ["waba-stale"],
        approvedTemplateWabaIds: ["waba-template-approved"],
      }),
    ).toEqual(["waba-stale", "waba-template-approved"]);
  });

  it("falls back to the approved client template when the preferred WABA is stale", () => {
    const templates = [
      { id: "template-approved", wabaId: "waba-template-approved" },
    ];

    expect(
      selectAutomationTemplateByWaba(templates, ["waba-stale"]),
    ).toEqual(templates[0]);
  });

  it("prefers the template from the sender WABA when it is available", () => {
    const templates = [
      { id: "template-fallback", wabaId: "waba-fallback" },
      { id: "template-sender", wabaId: "waba-sender" },
    ];

    expect(
      selectAutomationTemplateByWaba(templates, ["waba-sender"]),
    ).toEqual(templates[1]);
  });

  it("blocks instead of falling back when seller_phone does not match", () => {
    const result = selectAutomationSenderPhone(
      [defaultPhone],
      "+55 11 97777-6666",
    );

    expect(result.phone).toBeNull();
    expect(result.source).toBe("seller_phone_not_matched");
    expect(result.blockedReason).toBe("seller_phone_not_matched");
  });

  it("uses only the explicit default number when seller_phone is absent", () => {
    const result = selectAutomationSenderPhone(
      [sellerPhone, defaultPhone],
      null,
    );

    expect(result.phone?.phoneNumberId).toBe("phone-default");
    expect(result.source).toBe("default_phone");
  });

  it("blocks when there is no seller_phone and no default number", () => {
    const result = selectAutomationSenderPhone([sellerPhone], null);

    expect(result.phone).toBeNull();
    expect(result.blockedReason).toBe("default_phone_not_configured");
  });
});
