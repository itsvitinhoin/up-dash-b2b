// Tokens de API de admin: valem para sempre, até alguém desligar. Regras puras (sem banco, sem rede) para poderem ser testadas a fundo.
//
// Formato: "upk_" + 43 caracteres base64url (32 bytes aleatórios = 256 bits). Impossível de adivinhar; o prefixo fixo serve só para o
// servidor saber que NÃO é um JWT de login (que continua valendo 1 hora) e para o time reconhecer o token em logs e cofres de senha.
// No banco fica só o sha256 do token: quem lê o banco não consegue usar nenhum token.
import { createHash, randomBytes } from "node:crypto";

export const API_TOKEN_PREFIX = "upk_";
export const API_TOKEN_BODY_BYTES = 32;
/** Quantos caracteres do token aparecem na lista (para o admin reconhecer qual é qual). */
export const API_TOKEN_DISPLAY_PREFIX_LENGTH = API_TOKEN_PREFIX.length + 6;
/** Limite de tokens ligados por usuário: segura lixo e limita o estrago se um admin gerar token à toa. */
export const MAX_ACTIVE_API_TOKENS_PER_USER = 20;
export const API_TOKEN_NAME_MAX = 60;

export type ApiTokenScope = "FULL" | "READ";

// 32 bytes em base64url = 43 caracteres, sem padding.
const API_TOKEN_RE = /^upk_[A-Za-z0-9_-]{43}$/;

export function hashApiToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateApiToken(): { token: string; hash: string; displayPrefix: string } {
  const token = `${API_TOKEN_PREFIX}${randomBytes(API_TOKEN_BODY_BYTES).toString("base64url")}`;
  return { token, hash: hashApiToken(token), displayPrefix: token.slice(0, API_TOKEN_DISPLAY_PREFIX_LENGTH) };
}

/** Só o formato (não diz se existe). Evita ir ao banco por causa de lixo ou de um JWT comum. */
export function looksLikeApiToken(value: string): boolean {
  return API_TOKEN_RE.test(value);
}

/** O token começa como token de API (mesmo malformado)? Nesse caso nunca é tratado como JWT. */
export function hasApiTokenPrefix(value: string): boolean {
  return value.startsWith(API_TOKEN_PREFIX);
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** READ só consulta. FULL faz tudo que o admin faz (menos gerenciar tokens, ver `requireSessionAuth`). */
export function scopeAllowsMethod(scope: ApiTokenScope, method: string): boolean {
  return scope === "FULL" || READ_METHODS.has(method.toUpperCase());
}

export function parseScope(value: unknown): ApiTokenScope | null {
  return value === "FULL" || value === "READ" ? value : null;
}

/** Nome do token já limpo, ou `null` se vazio/grande demais. */
export function cleanTokenName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= API_TOKEN_NAME_MAX ? name : null;
}

/** Só atualiza "último uso" se passou mais de 1 minuto: evita uma escrita no banco por requisição. */
export const LAST_USED_MIN_INTERVAL_MS = 60_000;

export function shouldTouchLastUsed(lastUsedAt: Date | null, now: Date = new Date()): boolean {
  return lastUsedAt === null || now.getTime() - lastUsedAt.getTime() >= LAST_USED_MIN_INTERVAL_MS;
}
