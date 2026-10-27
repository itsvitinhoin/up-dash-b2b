import { describe, expect, it } from "vitest";
import {
  API_TOKEN_DISPLAY_PREFIX_LENGTH,
  API_TOKEN_NAME_MAX,
  LAST_USED_MIN_INTERVAL_MS,
  cleanTokenName,
  generateApiToken,
  hasApiTokenPrefix,
  hashApiToken,
  looksLikeApiToken,
  parseScope,
  scopeAllowsMethod,
  shouldTouchLastUsed,
} from "../src/services/api-token-rules";

describe("generateApiToken", () => {
  it("gera upk_ + 43 caracteres base64url", () => {
    const { token } = generateApiToken();
    expect(token).toMatch(/^upk_[A-Za-z0-9_-]{43}$/);
    expect(token).toHaveLength(47);
  });

  it("nunca repete (256 bits aleatórios)", () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateApiToken().token));
    expect(tokens.size).toBe(500);
  });

  it("o hash é o sha256 do token e não contém o token", () => {
    const { token, hash } = generateApiToken();
    expect(hash).toBe(hashApiToken(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token.slice(4));
  });

  it("o prefixo de exibição é só o começo do token (não dá para usar)", () => {
    const { token, displayPrefix } = generateApiToken();
    expect(displayPrefix).toBe(token.slice(0, API_TOKEN_DISPLAY_PREFIX_LENGTH));
    expect(displayPrefix.length).toBeLessThan(token.length / 3);
  });

  it("hash é determinístico e muda com qualquer caractere", () => {
    const { token } = generateApiToken();
    expect(hashApiToken(token)).toBe(hashApiToken(token));
    expect(hashApiToken(token)).not.toBe(hashApiToken(`${token}x`));
  });
});

describe("looksLikeApiToken / hasApiTokenPrefix", () => {
  it("aceita um token gerado", () => {
    expect(looksLikeApiToken(generateApiToken().token)).toBe(true);
  });

  it.each([
    ["vazio", ""],
    ["só o prefixo", "upk_"],
    ["curto demais", `upk_${"a".repeat(42)}`],
    ["longo demais", `upk_${"a".repeat(44)}`],
    ["caractere inválido", `upk_${"a".repeat(42)}!`],
    ["espaço", `upk_${"a".repeat(42)} `],
    ["sem prefixo", "a".repeat(47)],
    ["prefixo em maiúsculas", `UPK_${"a".repeat(43)}`],
    ["um JWT comum", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.assinatura"],
  ])("recusa o formato: %s", (_name, value) => {
    expect(looksLikeApiToken(value)).toBe(false);
  });

  it("hasApiTokenPrefix: token malformado com o prefixo nunca é tratado como JWT", () => {
    expect(hasApiTokenPrefix("upk_lixo")).toBe(true);
    expect(hasApiTokenPrefix("eyJhbGciOiJIUzI1NiJ9.x.y")).toBe(false);
    expect(hasApiTokenPrefix("local-ui-preview")).toBe(false);
  });
});

describe("scopeAllowsMethod", () => {
  it("READ só deixa consultar", () => {
    for (const method of ["GET", "HEAD", "OPTIONS", "get"]) expect(scopeAllowsMethod("READ", method)).toBe(true);
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "post"]) expect(scopeAllowsMethod("READ", method)).toBe(false);
  });

  it("FULL deixa tudo", () => {
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) expect(scopeAllowsMethod("FULL", method)).toBe(true);
  });
});

describe("parseScope", () => {
  it("só FULL e READ", () => {
    expect(parseScope("FULL")).toBe("FULL");
    expect(parseScope("READ")).toBe("READ");
    expect(parseScope("full")).toBeNull();
    expect(parseScope("ADMIN")).toBeNull();
    expect(parseScope(undefined)).toBeNull();
    expect(parseScope(1)).toBeNull();
  });
});

describe("cleanTokenName", () => {
  it("limpa espaços e junta os repetidos", () => {
    expect(cleanTokenName("  bot   do   Fulano ")).toBe("bot do Fulano");
  });
  it("recusa vazio, só espaços, não-texto e nome grande demais", () => {
    expect(cleanTokenName("")).toBeNull();
    expect(cleanTokenName("   ")).toBeNull();
    expect(cleanTokenName(null)).toBeNull();
    expect(cleanTokenName(42)).toBeNull();
    expect(cleanTokenName("a".repeat(API_TOKEN_NAME_MAX + 1))).toBeNull();
  });
  it("aceita exatamente o limite", () => {
    expect(cleanTokenName("a".repeat(API_TOKEN_NAME_MAX))).toHaveLength(API_TOKEN_NAME_MAX);
  });
});

describe("shouldTouchLastUsed", () => {
  const now = new Date("2026-10-15T12:00:00.000Z");
  it("nunca usado: atualiza", () => {
    expect(shouldTouchLastUsed(null, now)).toBe(true);
  });
  it("usado há menos de 1 minuto: não escreve no banco de novo", () => {
    expect(shouldTouchLastUsed(new Date(now.getTime() - 5_000), now)).toBe(false);
    expect(shouldTouchLastUsed(new Date(now.getTime() - (LAST_USED_MIN_INTERVAL_MS - 1)), now)).toBe(false);
  });
  it("usado há 1 minuto ou mais: atualiza", () => {
    expect(shouldTouchLastUsed(new Date(now.getTime() - LAST_USED_MIN_INTERVAL_MS), now)).toBe(true);
    expect(shouldTouchLastUsed(new Date(now.getTime() - 3_600_000), now)).toBe(true);
  });
});
