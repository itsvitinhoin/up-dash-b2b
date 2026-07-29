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

export const pool = new Pool({
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
