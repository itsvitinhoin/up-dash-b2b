import type { CorsOptions } from "cors";
import rateLimit, { type RateLimitRequestHandler } from "express-rate-limit";

/**
 * Build a CORS options object from the ALLOWED_ORIGINS env var.
 *
 * - In production, ALLOWED_ORIGINS MUST be set to a non-empty allowlist
 *   (or to the explicit value "*"). Misconfiguration throws at startup
 *   so a deploy can never accidentally ship with permissive CORS.
 * - In non-production, an unset or "*" value is permissive (dev default).
 * - Otherwise it parses a comma-separated allowlist and rejects everything else.
 *
 * Same-origin requests (no Origin header) are always allowed so the browser's
 * preview iframe and tools like curl keep working.
 */
export function buildCorsOptions(): CorsOptions {
  const raw = process.env.ALLOWED_ORIGINS?.trim();
  const isProd = process.env.NODE_ENV === "production";

  if (!raw) {
    if (isProd) {
      throw new Error(
        "ALLOWED_ORIGINS is required in production. Set it to a comma-separated list of allowed origins, or to \"*\" to explicitly opt in to permissive CORS.",
      );
    }
    console.log("[cors] permissive (dev default — no ALLOWED_ORIGINS set)");
    return { origin: true, credentials: true };
  }

  if (raw === "*") {
    console.log("[cors] permissive (ALLOWED_ORIGINS=*)");
    return { origin: true, credentials: true };
  }

  const allowList = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  console.log(`[cors] allowlist: ${allowList.join(", ")}`);

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
