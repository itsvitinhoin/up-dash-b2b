// Sessão por cookie: além do localStorage da tela, o refresh token também vai num cookie, para o login sobreviver em navegadores que
// guardam cookies mas não o localStorage (ex.: o navegador na nuvem de agentes de IA, que começava do zero a cada execução agendada).
//
//  - `updash_rt`: o refresh token. HttpOnly (JS não lê), Secure em HTTPS, SameSite=Lax e Path=/api/auth: só viaja para as rotas de login.
//  - `updash_has_session`: marcador SEM segredo (valor "1"), legível pela tela, só para ela saber se vale a pena tentar restaurar a sessão
//    pelo cookie (assim visitante deslogado não gasta chamada nem limite de tentativas).
// Cada login/renovação grava os dois de novo (o refresh token é de uso único e gira a cada uso); sair apaga os dois. Falha de renovação
// NÃO apaga o cookie: duas abas renovando ao mesmo tempo apagariam o cookie novo da outra.
export const REFRESH_COOKIE = "updash_rt";
export const SESSION_MARKER_COOKIE = "updash_has_session";
export const REFRESH_COOKIE_PATH = "/api/auth";

/** Lê o cabeçalho `Cookie` (nome=valor; nome=valor). Ignora pedaços malformados; valor com `=` dentro é preservado. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    if (!name || name in out) continue; // vale o primeiro, como nos navegadores
    let value = part.slice(index + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1);
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

// Refresh token = base64url (A-Z a-z 0-9 - _): seguro como valor de cookie. Qualquer outra coisa é recusada em vez de montar um cabeçalho inválido.
const COOKIE_VALUE_RE = /^[A-Za-z0-9_-]{16,256}$/;

export function isCookieSafeToken(value: string): boolean {
  return COOKIE_VALUE_RE.test(value);
}

function attributes(params: { path: string; maxAgeSeconds: number; secure: boolean; httpOnly: boolean }): string {
  return [
    `Path=${params.path}`,
    `Max-Age=${Math.max(0, Math.floor(params.maxAgeSeconds))}`,
    "SameSite=Lax",
    params.httpOnly ? "HttpOnly" : null,
    params.secure ? "Secure" : null,
  ]
    .filter(Boolean)
    .join("; ");
}

/** Cabeçalhos `Set-Cookie` de uma sessão ativa. */
export function sessionCookieHeaders(params: { refreshToken: string; maxAgeSeconds: number; secure: boolean }): string[] {
  if (!isCookieSafeToken(params.refreshToken)) throw new Error("refresh token com formato inesperado para cookie");
  return [
    `${REFRESH_COOKIE}=${params.refreshToken}; ${attributes({ path: REFRESH_COOKIE_PATH, maxAgeSeconds: params.maxAgeSeconds, secure: params.secure, httpOnly: true })}`,
    `${SESSION_MARKER_COOKIE}=1; ${attributes({ path: "/", maxAgeSeconds: params.maxAgeSeconds, secure: params.secure, httpOnly: false })}`,
  ];
}

/** Cabeçalhos `Set-Cookie` que apagam a sessão (sair). */
export function clearSessionCookieHeaders(params: { secure: boolean }): string[] {
  return [
    `${REFRESH_COOKIE}=; ${attributes({ path: REFRESH_COOKIE_PATH, maxAgeSeconds: 0, secure: params.secure, httpOnly: true })}`,
    `${SESSION_MARKER_COOKIE}=; ${attributes({ path: "/", maxAgeSeconds: 0, secure: params.secure, httpOnly: false })}`,
  ];
}

/** O refresh token que o navegador mandou: o do corpo (clientes antigos) ou, na falta dele, o do cookie. */
export function pickRefreshToken(params: { body: unknown; cookieHeader: string | undefined }): { token: string; source: "body" | "cookie" } | null {
  const fromBody = (params.body as { refreshToken?: unknown } | null | undefined)?.refreshToken;
  if (typeof fromBody === "string" && fromBody.length > 0) return { token: fromBody, source: "body" };
  const fromCookie = parseCookies(params.cookieHeader)[REFRESH_COOKIE];
  if (typeof fromCookie === "string" && fromCookie.length > 0) return { token: fromCookie, source: "cookie" };
  return null;
}
