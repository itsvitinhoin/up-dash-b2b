import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken, type AccessTokenPayload } from "../lib/auth";

declare global {
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
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
