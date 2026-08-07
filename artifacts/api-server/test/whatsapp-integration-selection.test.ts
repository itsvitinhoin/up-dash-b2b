import { describe, expect, it } from "vitest";
import { selectWhatsappIntegrationForPhone } from "../src/services/whatsapp-integration-selection";

const integrations = [
  { id: "integration-mx", wabaId: "waba-mx", phoneNumberId: "phone-mx" },
  { id: "integration-kaka", wabaId: "waba-kaka", phoneNumberId: "phone-kaka" },
];

describe("WhatsApp integration selection", () => {
  it("uses the integration bound to the phone when its WABA matches", () => {
    expect(
      selectWhatsappIntegrationForPhone(integrations, {
        integrationId: "integration-kaka",
        wabaId: "waba-kaka",
        phoneNumberId: "phone-kaka",
      }),
    ).toEqual(integrations[1]);
  });

  it("repairs a stale integration binding by matching the phone WABA", () => {
    expect(
      selectWhatsappIntegrationForPhone(integrations, {
        integrationId: "integration-mx",
        wabaId: "waba-kaka",
        phoneNumberId: "phone-kaka",
      }),
    ).toEqual(integrations[1]);
  });

  it("never borrows a token from a different WABA", () => {
    expect(
      selectWhatsappIntegrationForPhone([integrations[0]], {
        integrationId: "integration-mx",
        wabaId: "waba-kaka",
        phoneNumberId: "phone-kaka",
      }),
    ).toBeNull();
  });

  it("supports legacy rows by matching the exact phone number ID", () => {
    expect(
      selectWhatsappIntegrationForPhone(integrations, {
        integrationId: null,
        wabaId: null,
        phoneNumberId: "phone-kaka",
      }),
    ).toEqual(integrations[1]);
  });
});

