import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken, type AccessTokenPayload } from "../lib/auth";
import { logger } from "../lib/logger";
import {
  hasApiTokenPrefix,
  looksLikeApiToken,
  scopeAllowsMethod,
  shouldTouchLastUsed,
  type ApiTokenScope,
} from "../services/api-token-rules";
import { resolveApiToken, touchApiTokenLastUsed } from "../services/api-tokens";

declare global {
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
      // Preenchido quando a requisição entrou com um token de API (upk_...) em vez do JWT de login.
      apiToken?: { id: string; scope: ApiTokenScope };
      // Bytes exatos do corpo da requisição, capturados antes do JSON.parse
      // (ver app.ts) — necessário pra validar assinatura HMAC de webhook
      // (ex: X-Hub-Signature-256 da Meta), que não sobrevive a re-serializar
      // o JSON já parseado.
      rawBody?: Buffer;
    }
  }
}

export function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({
      error: true,
      code: "UNAUTHORIZED",
      message: "Missing or invalid authorization header",
      status: 401,
    });
    return;
  }
  const token = header.slice(7);

  // Achado 21/09/2026: bypass só-dev pro token fake que o front usa em
  // LOCAL_UI_PREVIEW (auth.tsx) -- sem isso, todo preview local com login
  // "fingido" no front toma 401 aqui, e a tela sempre mostra dado vazio/
  // R$0,00 mesmo apontando pro banco real. Só ativa com
  // NODE_ENV=development E o token literal exato -- nunca entra em
  // produção (lá NODE_ENV=production).
  if (process.env.NODE_ENV === "development" && token === "local-ui-preview") {
    req.user = { sub: "local-preview-admin", email: "admin@updash.com", role: "ADMIN", clientId: null };
    next();
    return;
  }

  // Token de API (upk_...): não é JWT, vale até alguém desligar. Nunca cai no caminho do JWT.
  if (hasApiTokenPrefix(token)) {
    void authenticateWithApiToken(token, req, res, next);
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = payload;
    next();
  } catch {
    res.status(401).json({
      error: true,
      code: "UNAUTHORIZED",
      message: "Invalid or expired token",
      status: 401,
    });
  }
}

async function authenticateWithApiToken(token: string, req: Request, res: Response, next: NextFunction): Promise<void> {
  let resolved: Awaited<ReturnType<typeof resolveApiToken>> = null;
  try {
    resolved = looksLikeApiToken(token) ? await resolveApiToken(token) : null;
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "falha ao conferir token de API");
    res.status(500).json({ error: true, code: "INTERNAL_ERROR", message: "Não foi possível conferir o token agora", status: 500 });
    return;
  }
  if (!resolved) {
    res.status(401).json({ error: true, code: "UNAUTHORIZED", message: "Invalid or revoked token", status: 401 });
    return;
  }
  if (!scopeAllowsMethod(resolved.scope, req.method)) {
    res.status(403).json({
      error: true,
      code: "API_TOKEN_READ_ONLY",
      message: "Este token é somente leitura: só aceita consultas (GET).",
      status: 403,
    });
    return;
  }
  if (shouldTouchLastUsed(resolved.lastUsedAt)) {
    try {
      await touchApiTokenLastUsed(resolved.tokenId);
    } catch {
      // "último uso" é só informativo: não derruba a requisição.
    }
  }
  req.user = { sub: resolved.user.id, email: resolved.user.email, role: "ADMIN", clientId: null };
  req.apiToken = { id: resolved.tokenId, scope: resolved.scope };
  next();
}

/** Rotas sensíveis (ex.: gerenciar tokens) só aceitam login de verdade: um token de API não cria nem desliga outros tokens. */
export function requireSessionAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.apiToken) {
    res.status(403).json({
      error: true,
      code: "API_TOKEN_NOT_ALLOWED",
      message: "Tokens de API não podem gerenciar tokens. Entre no painel com seu login.",
      status: 403,
    });
    return;
  }
  next();
}

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user || req.user.role !== "ADMIN") {
    res.status(403).json({
      error: true,
      code: "FORBIDDEN",
      message: "Admin role required",
      status: 403,
    });
    return;
  }
  next();
}

export function resolveClientId(req: Request): string | null {
  if (!req.user) return null;
  if (req.user.role === "ADMIN") {
    const q = req.query.clientId;
    if (typeof q === "string" && q.length > 0) return q;
    return null;
  }
  return req.user.clientId;
}
