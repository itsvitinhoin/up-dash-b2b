import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken, type AccessTokenPayload } from "../lib/auth";

declare global {
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
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
