import { describe, expect, it } from "vitest";
import { GA4_READER_ACCOUNT, parseGa4PropertyInput } from "../../up-dash/src/lib/ga4-property-rules";

describe("parseGa4PropertyInput (campo Propriedade GA4 na edição do cliente)", () => {
  it("aceita o ID numérico e tira espaços", () => {
    expect(parseGa4PropertyInput("387817325")).toEqual({ ok: true, value: "387817325" });
    expect(parseGa4PropertyInput("  422756040  ")).toEqual({ ok: true, value: "422756040" });
  });

  it("aceita o formato 'properties/123' que aparece na API e em links do GA4", () => {
    expect(parseGa4PropertyInput("properties/387817325")).toEqual({ ok: true, value: "387817325" });
    expect(parseGa4PropertyInput("Properties/387817325")).toEqual({ ok: true, value: "387817325" });
  });

  it("vazio significa remover a propriedade (null), não erro", () => {
    expect(parseGa4PropertyInput("")).toEqual({ ok: true, value: null });
    expect(parseGa4PropertyInput("   ")).toEqual({ ok: true, value: null });
  });

  it("barra o ID de medição G-XXXX, o engano mais comum, com uma mensagem que diz onde achar o certo", () => {
    const result = parseGa4PropertyInput("G-ABC123XYZ9");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("ID de medição");
    expect(parseGa4PropertyInput("g-abc123").ok).toBe(false);
  });

  it("barra o ID antigo do Universal Analytics (UA-…)", () => {
    const result = parseGa4PropertyInput("UA-12345-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Universal Analytics");
  });

  it("barra o que não é só número, ou é curto/longo demais", () => {
    expect(parseGa4PropertyInput("38781732x").ok).toBe(false);
    expect(parseGa4PropertyInput("12345").ok).toBe(false);
    expect(parseGa4PropertyInput("1234567890123456").ok).toBe(false);
    expect(parseGa4PropertyInput("https://analytics.google.com/analytics/web/#/p387817325/").ok).toBe(false);
  });

  it("mostra a conta de serviço que precisa ser Leitor (a mesma do job)", () => {
    expect(GA4_READER_ACCOUNT).toBe("928204832932-compute@developer.gserviceaccount.com");
  });
});
