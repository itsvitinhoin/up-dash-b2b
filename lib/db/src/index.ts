import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const isServerless = process.env.VERCEL === "1" || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
const configuredPoolMax = Number.parseInt(process.env.DATABASE_POOL_MAX ?? "", 10);
const configuredQueryRetries = Number.parseInt(
  process.env.DATABASE_QUERY_RETRIES ?? "",
  10,
);
const databaseQueryRetries =
  Number.isFinite(configuredQueryRetries) && configuredQueryRetries >= 0
    ? configuredQueryRetries
    : isServerless
      ? 3
      : 1;

const TRANSIENT_DATABASE_CODES = new Set([
  "40001",
  "40P01",
  "53300",
  "57P01",
  "57P02",
  "57P03",
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "08P01",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETDOWN",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
]);

function getDatabaseErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function isTransientDatabaseError(error: unknown): boolean {
  const code = getDatabaseErrorCode(error);
  if (code && (code.startsWith("08") || TRANSIENT_DATABASE_CODES.has(code))) {
    return true;
  }

  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return [
    "connection terminated",
    "connection timeout",
    "connection closed",
    "connect timeout",
    "remaining connection slots",
    "too many clients",
    "tenant or user not found",
    "server closed the connection",
    "socket hang up",
  ].some((fragment) => message.includes(fragment));
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

class ResilientPool extends Pool {
  query(...args: any[]): any {
    const callbackStyle = typeof args.at(-1) === "function";
    const execute = () =>
      (Pool.prototype.query as (...queryArgs: any[]) => any).apply(this, args);

    // Drizzle uses the Promise API. Preserve node-postgres callback and stream
    // semantics unchanged for any external callers.
    if (callbackStyle) return execute();

    const firstResult = execute();
    if (!firstResult || typeof firstResult.then !== "function") return firstResult;

    return (async () => {
      let attempt = 0;
      let pending = firstResult as Promise<unknown>;

      while (true) {
        try {
          return await pending;
        } catch (error) {
          if (attempt >= databaseQueryRetries || !isTransientDatabaseError(error)) {
            console.error("[database] PostgreSQL query failed", {
              attempts: attempt + 1,
              name: error instanceof Error ? error.name : "UnknownError",
              message: error instanceof Error ? error.message : String(error),
              code: getDatabaseErrorCode(error),
              transient: isTransientDatabaseError(error),
            });
            throw error;
          }

          const delayMs = Math.min(1_500, 150 * 2 ** attempt);
          console.warn("[database] Retrying transient PostgreSQL query failure", {
            attempt: attempt + 1,
            delayMs,
            code: getDatabaseErrorCode(error),
          });
          attempt += 1;
          await wait(delayMs);
          pending = execute() as Promise<unknown>;
        }
      }
    })();
  }
}

export const pool = new ResilientPool({
  connectionString: process.env.DATABASE_URL,
  // Each serverless instance owns its own pg Pool. Keeping the default of ten
  // connections per instance can exhaust Supavisor during traffic bursts.
  max: Number.isFinite(configuredPoolMax) && configuredPoolMax > 0
    ? configuredPoolMax
    : isServerless
      ? 1
      : 10,
  idleTimeoutMillis: isServerless ? 5_000 : 30_000,
  connectionTimeoutMillis: 10_000,
  allowExitOnIdle: isServerless,
  keepAlive: true,
});

pool.on("error", (error) => {
  console.error("[database] Idle PostgreSQL connection failed", {
    name: error.name,
    message: error.message,
    code: "code" in error ? error.code : undefined,
  });
});

export const db = drizzle(pool, { schema });

export * from "./schema";
