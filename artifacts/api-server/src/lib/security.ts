import type { CorsOptions } from "cors";
import rateLimit, { type RateLimitRequestHandler } from "express-rate-limit";

export function buildCorsOptions(): CorsOptions {
  const raw = process.env.ALLOWED_ORIGINS?.trim();
  const isProd = process.env.NODE_ENV === "production";

  if (isProd) {
    if (!raw || raw === "*") {
      throw new Error(
        "ALLOWED_ORIGINS must be a concrete comma-separated allowlist in production",
      );
    }
    const allowList = raw.split(",").map((s) => s.trim()).filter(Boolean);
    return {
      credentials: true,
      origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (allowList.includes(origin)) return callback(null, true);
        callback(new Error(`Origin not allowed by CORS: ${origin}`));
      },
    };
  }

  if (!raw || raw === "*") {
    return { origin: true, credentials: true };
  }
  const allowList = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return {
    credentials: true,
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowList.includes(origin)) return callback(null, true);
      callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
  };
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Stricter limiter for credential-handling endpoints (login, refresh).
 * Defaults: 20 requests per IP per minute.
 */
export function buildAuthLimiter(): RateLimitRequestHandler {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: intFromEnv("RATE_LIMIT_AUTH_PER_MIN", 20),
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
      error: true,
      code: "RATE_LIMITED",
      message: "Too many authentication attempts. Please try again shortly.",
      status: 429,
    },
  });
}

/**
 * General API limiter applied to all `/api/*` routes.
 * Defaults: 300 requests per IP per minute.
 */
export function buildApiLimiter(): RateLimitRequestHandler {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: intFromEnv("RATE_LIMIT_API_PER_MIN", 300),
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
      error: true,
      code: "RATE_LIMITED",
      message: "Too many requests. Please slow down.",
      status: 429,
    },
  });
}
