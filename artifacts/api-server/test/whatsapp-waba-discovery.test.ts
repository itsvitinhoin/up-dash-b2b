import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addWhatsappWabaVerification,
  collectWhatsappWabaIds,
  discoverWhatsappWabaForPhone,
  getVerifiedWhatsappWabaId,
} from "../src/services/whatsapp-waba-discovery";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WhatsApp WABA discovery", () => {
  it("reuses only a verification that matches the current phone WABA", () => {
    const payload = addWhatsappWabaVerification(
      { verified_name: "Cássia" },
      { wabaId: "waba-cassia", verifiedAt: "2026-08-05T12:00:00.000Z" },
    );

    expect(getVerifiedWhatsappWabaId(payload, "waba-cassia")).toBe("waba-cassia");
    expect(getVerifiedWhatsappWabaId(payload, "waba-mx")).toBeNull();
  });

  it("collects nested WABA IDs without duplicates", () => {
    expect(
      collectWhatsappWabaIds({
        wabaId: "waba-primary",
        session: {
          wabas: [{ id: "waba-seller" }, { id: "waba-primary" }],
        },
      }),
    ).toEqual(["waba-primary", "waba-seller"]);
  });

  it("confirms the phone against its explicit WABA before listing businesses", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      expect(url).toContain("/waba-cassia/phone_numbers");
      return jsonResponse({ data: [{ id: "phone-cassia" }] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await discoverWhatsappWabaForPhone({
      integration: {
        accessToken: "token",
        businessId: "business-mx",
        wabaId: "waba-mx",
        rawPayload: null,
      },
      phoneNumberId: "phone-cassia",
      graphApiVersion: "v25.0",
      candidateWabaIds: ["waba-cassia"],
    });

    expect(result).toMatchObject({
      wabaId: "waba-cassia",
      matchedPhone: true,
      checkedWabaIds: ["waba-cassia"],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("discovers the seller WABA when the stored WABA is stale", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/waba-stale/phone_numbers")) {
          return jsonResponse({ data: [{ id: "another-phone" }] });
        }
        if (url.pathname.endsWith("/business-mx/owned_whatsapp_business_accounts")) {
          return jsonResponse({ data: [{ id: "waba-mx" }, { id: "waba-cassia" }] });
        }
        if (url.pathname.endsWith("/business-mx/client_whatsapp_business_accounts")) {
          return jsonResponse({ data: [] });
        }
        if (url.pathname.endsWith("/waba-mx/phone_numbers")) {
          return jsonResponse({ data: [{ id: "phone-mx" }] });
        }
        if (url.pathname.endsWith("/waba-cassia/phone_numbers")) {
          return jsonResponse({ data: [{ id: "phone-cassia" }] });
        }
        return jsonResponse({ error: { message: `Unexpected URL: ${url}` } }, 404);
      }),
    );

    const result = await discoverWhatsappWabaForPhone({
      integration: {
        accessToken: "token",
        businessId: "business-mx",
        wabaId: "waba-stale",
        rawPayload: null,
      },
      phoneNumberId: "phone-cassia",
      graphApiVersion: "v25.0",
    });

    expect(result.wabaId).toBe("waba-cassia");
    expect(result.matchedPhone).toBe(true);
    expect(result.checkedWabaIds).toContain("waba-cassia");
  });

  it("returns no WABA when the phone cannot be confirmed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.pathname.includes("whatsapp_business_accounts")) {
          return jsonResponse({ data: [] });
        }
        return jsonResponse({ data: [{ id: "another-phone" }] });
      }),
    );

    const result = await discoverWhatsappWabaForPhone({
      integration: {
        accessToken: "token",
        businessId: "business-mx",
        wabaId: "waba-mx",
        rawPayload: null,
      },
      phoneNumberId: "missing-phone",
      graphApiVersion: "v25.0",
    });

    expect(result).toMatchObject({
      wabaId: null,
      matchedPhone: false,
    });
  });
});
