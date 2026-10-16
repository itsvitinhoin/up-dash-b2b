import { describe, expect, it } from "vitest";
import {
  REFRESH_COOKIE,
  SESSION_MARKER_COOKIE,
  clearSessionCookieHeaders,
  isCookieSafeToken,
  parseCookies,
  pickRefreshToken,
  sessionCookieHeaders,
} from "../src/lib/session-cookie";

const token = "A".repeat(32) + "-_b9";

describe("parseCookies", () => {
  it("lê nome=valor separados por ;", () => {
    expect(parseCookies("a=1; b=2;c=3")).toEqual({ a: "1", b: "2", c: "3" });
  });
  it("sem cabeçalho ou vazio: nada", () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies("")).toEqual({});
  });
  it("ignora pedaços malformados (sem nome ou sem =)", () => {
    expect(parseCookies("lixo; =sem-nome; ok=1")).toEqual({ ok: "1" });
  });
  it("preserva = dentro do valor e tira aspas", () => {
    expect(parseCookies('x=abc==; y="quoted"')).toEqual({ x: "abc==", y: "quoted" });
  });
  it("decodifica %xx e tolera %xx inválido", () => {
    expect(parseCookies("a=%41%42; b=%E0%A4%A")).toEqual({ a: "AB", b: "%E0%A4%A" });
  });
  it("vale o primeiro quando o nome se repete (como no navegador)", () => {
    expect(parseCookies("a=1; a=2")).toEqual({ a: "1" });
  });
});

describe("isCookieSafeToken", () => {
  it("aceita base64url longo", () => {
    expect(isCookieSafeToken(token)).toBe(true);
  });
  it.each([
    ["curto demais", "abc"],
    ["com espaço", `${"a".repeat(20)} x`],
    ["com ponto e vírgula", `${"a".repeat(20)};x`],
    ["com quebra de linha (injeção de cabeçalho)", `${"a".repeat(20)}\r\nSet-Cookie: x=1`],
    ["com aspas", `${"a".repeat(20)}"x`],
    ["vazio", ""],
    ["grande demais", "a".repeat(257)],
  ])("recusa: %s", (_name, value) => {
    expect(isCookieSafeToken(value)).toBe(false);
  });
});

describe("sessionCookieHeaders", () => {
  it("o cookie do refresh token é HttpOnly, SameSite=Lax e só vale em /api/auth", () => {
    const [rt] = sessionCookieHeaders({ refreshToken: token, maxAgeSeconds: 604800, secure: false });
    expect(rt).toBe(`${REFRESH_COOKIE}=${token}; Path=/api/auth; Max-Age=604800; SameSite=Lax; HttpOnly`);
  });
  it("o marcador não tem segredo, é legível pela tela (sem HttpOnly) e vale no site todo", () => {
    const [, marker] = sessionCookieHeaders({ refreshToken: token, maxAgeSeconds: 604800, secure: false });
    expect(marker).toBe(`${SESSION_MARKER_COOKIE}=1; Path=/; Max-Age=604800; SameSite=Lax`);
    expect(marker).not.toContain(token);
    expect(marker).not.toContain("HttpOnly");
  });
  it("em HTTPS os dois levam Secure", () => {
    const headers = sessionCookieHeaders({ refreshToken: token, maxAgeSeconds: 60, secure: true });
    for (const header of headers) expect(header).toMatch(/; Secure$/);
  });
  it("em HTTP não leva Secure (o navegador descartaria o cookie)", () => {
    for (const header of sessionCookieHeaders({ refreshToken: token, maxAgeSeconds: 60, secure: false })) expect(header).not.toContain("Secure");
  });
  it("o segredo só aparece no cookie HttpOnly", () => {
    const headers = sessionCookieHeaders({ refreshToken: token, maxAgeSeconds: 60, secure: true });
    expect(headers.filter((header) => header.includes(token))).toHaveLength(1);
    expect(headers[0]).toContain("HttpOnly");
  });
  it("token com formato estranho é recusado em vez de montar cabeçalho inválido", () => {
    expect(() => sessionCookieHeaders({ refreshToken: "x;y", maxAgeSeconds: 60, secure: true })).toThrow();
    expect(() => sessionCookieHeaders({ refreshToken: `${"a".repeat(20)}\nX: 1`, maxAgeSeconds: 60, secure: true })).toThrow();
  });
  it("Max-Age nunca fica negativo nem fracionado", () => {
    expect(sessionCookieHeaders({ refreshToken: token, maxAgeSeconds: -5, secure: false })[0]).toContain("Max-Age=0");
    expect(sessionCookieHeaders({ refreshToken: token, maxAgeSeconds: 10.9, secure: false })[0]).toContain("Max-Age=10;");
  });
});

describe("clearSessionCookieHeaders", () => {
  it("apaga os dois cookies, com o mesmo Path de quando foram criados", () => {
    const [rt, marker] = clearSessionCookieHeaders({ secure: false });
    expect(rt).toBe(`${REFRESH_COOKIE}=; Path=/api/auth; Max-Age=0; SameSite=Lax; HttpOnly`);
    expect(marker).toBe(`${SESSION_MARKER_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`);
  });
  it("em HTTPS também leva Secure", () => {
    for (const header of clearSessionCookieHeaders({ secure: true })) expect(header).toMatch(/; Secure$/);
  });
});

describe("pickRefreshToken", () => {
  it("o corpo vale primeiro (tela e clientes antigos)", () => {
    expect(pickRefreshToken({ body: { refreshToken: "do-corpo" }, cookieHeader: `${REFRESH_COOKIE}=${token}` })).toEqual({ token: "do-corpo", source: "body" });
  });
  it("sem corpo, usa o cookie", () => {
    expect(pickRefreshToken({ body: {}, cookieHeader: `x=1; ${REFRESH_COOKIE}=${token}` })).toEqual({ token, source: "cookie" });
    expect(pickRefreshToken({ body: undefined, cookieHeader: `${REFRESH_COOKIE}=${token}` })).toEqual({ token, source: "cookie" });
    expect(pickRefreshToken({ body: null, cookieHeader: `${REFRESH_COOKIE}=${token}` })).toEqual({ token, source: "cookie" });
  });
  it("corpo vazio ou de tipo errado cai no cookie", () => {
    expect(pickRefreshToken({ body: { refreshToken: "" }, cookieHeader: `${REFRESH_COOKIE}=${token}` })?.source).toBe("cookie");
    expect(pickRefreshToken({ body: { refreshToken: 123 }, cookieHeader: `${REFRESH_COOKIE}=${token}` })?.source).toBe("cookie");
  });
  it("sem nenhum dos dois: null", () => {
    expect(pickRefreshToken({ body: {}, cookieHeader: undefined })).toBeNull();
    expect(pickRefreshToken({ body: { refreshToken: "" }, cookieHeader: "outro=1" })).toBeNull();
  });
  it("o marcador sozinho não é um token", () => {
    expect(pickRefreshToken({ body: {}, cookieHeader: `${SESSION_MARKER_COOKIE}=1` })).toBeNull();
  });
});
