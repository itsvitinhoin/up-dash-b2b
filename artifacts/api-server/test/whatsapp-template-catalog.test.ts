import { describe, expect, it, vi } from "vitest";
import { fetchWhatsappTemplateCatalog } from "../src/services/whatsapp-template-catalog";

describe("WhatsApp template catalog", () => {
  it("loads every template page for one WABA", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{
            id: "tpl-1",
            name: "cadastro_aprovado",
            language: "pt_BR",
            status: "APPROVED",
            category: "MARKETING",
            components: [],
          }],
          paging: {
            next: "https://graph.facebook.com/v25.0/waba-mx/message_templates?after=next&access_token=secret",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{
            id: "tpl-2",
            name: "pedido_realizado",
            language: "pt_BR",
            status: "APPROVED",
          }],
        }),
      });

    const result = await fetchWhatsappTemplateCatalog({
      wabaId: "waba-mx",
      accessToken: "token",
      graphApiVersion: "v25.0",
      request,
    });

    expect(result.error).toBeNull();
    expect(result.templates.map((template) => template.name)).toEqual([
      "cadastro_aprovado",
      "pedido_realizado",
    ]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[0]).not.toContain("access_token");
  });

  it("returns a safe error when Meta rejects the WABA catalog request", async () => {
    const request = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: { message: "WABA access denied" } }),
    });

    const result = await fetchWhatsappTemplateCatalog({
      wabaId: "waba-other",
      accessToken: "token",
      request,
    });

    expect(result.templates).toEqual([]);
    expect(result.error).toBe("WABA access denied");
  });

  it("ignores incomplete rows instead of caching invalid templates", async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { id: "missing-language", name: "invalid", status: "APPROVED" },
          { id: "valid", name: "valid", language: "pt_BR", status: "APPROVED" },
        ],
      }),
    });

    const result = await fetchWhatsappTemplateCatalog({
      wabaId: "waba-mx",
      accessToken: "token",
      request,
    });

    expect(result.templates).toHaveLength(1);
    expect(result.templates[0]?.name).toBe("valid");
  });
});
