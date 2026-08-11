import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { Connector, AuthTypes, IpAddressTypes } from "@google-cloud/cloud-sql-connector";
import { GoogleAuth } from "google-auth-library";
import * as schema from "./schema";

const { Pool } = pg;

// Duas formas de apontar o banco: `DATABASE_URL` direta (Supabase hoje, ou
// qualquer Postgres com IP acessível) ou, se `CLOUD_SQL_CONNECTION_NAME`
// estiver definida, via Cloud SQL Connector (migração pra Cloud SQL,
// 07/08/2026 — ver docs/migracao-supabase-cloud-sql.md). O connector
// autentica pela Cloud SQL Admin API usando uma service account e conecta
// com mTLS efêmero — não precisa liberar IP em "redes autorizadas" do
// Cloud SQL, o que seria necessário com uma DATABASE_URL comum apontando
// pro IP público (rejeitado de propósito: exporia a porta 5432 pra
// internet inteira só por causa da Vercel não ter IP fixo).
const cloudSqlConnectionName = process.env.CLOUD_SQL_CONNECTION_NAME;

if (!cloudSqlConnectionName && !process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL (ou CLOUD_SQL_CONNECTION_NAME) must be set. Did you forget to provision a database?",
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

const poolBaseConfig = {
  // Each serverless instance owns its own pg Pool. Keeping the default of ten
  // connections per instance can exhaust the pooler during traffic bursts.
  max: Number.isFinite(configuredPoolMax) && configuredPoolMax > 0
    ? configuredPoolMax
    : isServerless
      ? 1
      : 10,
  idleTimeoutMillis: isServerless ? 5_000 : 30_000,
  connectionTimeoutMillis: 10_000,
  allowExitOnIdle: isServerless,
  keepAlive: true,
};

// Mesmo padrão de `GOOGLE_APPLICATION_CREDENTIALS_JSON` já usado pro
// BigQuery em artifacts/api-server/src/lib/bigquery.ts — service account
// colada inteira numa env var (aceita JSON direto ou em base64), já que a
// Vercel não tem filesystem persistente pra apontar um arquivo de
// credencial. `null` faz o Connector cair pro Application Default
// Credentials (ok em dev local com `gcloud auth application-default login`
// ou `GOOGLE_APPLICATION_CREDENTIALS` apontando um arquivo).
function parseServiceAccountCredentials(): { client_email: string; private_key: string } | null {
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ?? process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  const tryParse = (text: string) => {
    try {
      return JSON.parse(text) as { client_email?: string; private_key?: string };
    } catch {
      return null;
    }
  };
  const parsed = tryParse(raw) ?? tryParse(Buffer.from(raw, "base64").toString("utf-8"));
  if (!parsed?.client_email || !parsed?.private_key) return null;
  return { client_email: parsed.client_email, private_key: parsed.private_key.replace(/\\n/g, "\n") };
}

async function buildPool(): Promise<InstanceType<typeof ResilientPool>> {
  if (!cloudSqlConnectionName) {
    return new ResilientPool({ connectionString: process.env.DATABASE_URL, ...poolBaseConfig });
  }

  if (!process.env.DB_USER || !process.env.DB_PASSWORD || !process.env.DB_NAME) {
    throw new Error(
      "DB_USER, DB_PASSWORD e DB_NAME devem estar definidos quando CLOUD_SQL_CONNECTION_NAME é usado.",
    );
  }

  const credentials = parseServiceAccountCredentials();
  const connector = new Connector(credentials ? { auth: new GoogleAuth({ credentials }) } : undefined);
  const clientOpts = await connector.getOptions({
    instanceConnectionName: cloudSqlConnectionName,
    ipType: IpAddressTypes.PUBLIC,
    authType: AuthTypes.PASSWORD,
  });

  return new ResilientPool({
    ...clientOpts,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ...poolBaseConfig,
  });
}

export const pool = await buildPool();

pool.on("error", (error) => {
  console.error("[database] Idle PostgreSQL connection failed", {
    name: error.name,
    message: error.message,
    code: "code" in error ? error.code : undefined,
  });
});

export const db = drizzle(pool, { schema });

export * from "./schema";
