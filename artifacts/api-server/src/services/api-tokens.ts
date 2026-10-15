// Parte dos tokens de API de admin que fala com o Postgres (as regras puras estão em api-token-rules.ts).
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, apiTokensTable, usersTable } from "@workspace/db";
import {
  MAX_ACTIVE_API_TOKENS_PER_USER,
  generateApiToken,
  hashApiToken,
  type ApiTokenScope,
} from "./api-token-rules";

export type ApiTokenView = {
  id: string;
  name: string;
  prefix: string;
  scope: ApiTokenScope;
  ownerEmail: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

export class ApiTokenLimitError extends Error {
  constructor() {
    super(`Limite de ${MAX_ACTIVE_API_TOKENS_PER_USER} tokens ligados por usuário. Desligue algum antes de criar outro.`);
    this.name = "ApiTokenLimitError";
  }
}

/** Cria o token. O valor completo só existe neste retorno: no banco vai apenas o hash. */
export async function createApiToken(params: { userId: string; name: string; scope: ApiTokenScope }): Promise<{ token: string; record: ApiTokenView }> {
  const [active] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(apiTokensTable)
    .where(and(eq(apiTokensTable.userId, params.userId), isNull(apiTokensTable.revokedAt)));
  if ((active?.n ?? 0) >= MAX_ACTIVE_API_TOKENS_PER_USER) throw new ApiTokenLimitError();

  const { token, hash, displayPrefix } = generateApiToken();
  const [row] = await db
    .insert(apiTokensTable)
    .values({ userId: params.userId, name: params.name, tokenHash: hash, tokenPrefix: displayPrefix, scope: params.scope })
    .returning();
  const [owner] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, params.userId));
  return { token, record: toView(row, owner?.email ?? "") };
}

function toView(row: typeof apiTokensTable.$inferSelect, ownerEmail: string): ApiTokenView {
  return {
    id: row.id,
    name: row.name,
    prefix: row.tokenPrefix,
    scope: row.scope,
    ownerEmail,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
  };
}

/** Todos os tokens (ligados e desligados), os mais novos primeiro. Nunca devolve o valor nem o hash. */
export async function listApiTokens(): Promise<ApiTokenView[]> {
  const rows = await db
    .select({ token: apiTokensTable, ownerEmail: usersTable.email })
    .from(apiTokensTable)
    .innerJoin(usersTable, eq(usersTable.id, apiTokensTable.userId))
    .orderBy(desc(apiTokensTable.createdAt));
  return rows.map((row) => toView(row.token, row.ownerEmail));
}

/** Desliga o token (vale na hora; o registro fica para histórico). Repetir não faz mal. `null` = não existe. */
export async function revokeApiToken(id: string): Promise<ApiTokenView | null> {
  await db
    .update(apiTokensTable)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokensTable.id, id), isNull(apiTokensTable.revokedAt)));
  const [row] = await db
    .select({ token: apiTokensTable, ownerEmail: usersTable.email })
    .from(apiTokensTable)
    .innerJoin(usersTable, eq(usersTable.id, apiTokensTable.userId))
    .where(eq(apiTokensTable.id, id));
  return row ? toView(row.token, row.ownerEmail) : null;
}

export type ResolvedApiToken = {
  tokenId: string;
  scope: ApiTokenScope;
  lastUsedAt: Date | null;
  user: { id: string; email: string };
};

/** Acha o token LIGADO cujo dono ainda existe e continua sendo ADMIN. Qualquer outra coisa = `null`. */
export async function resolveApiToken(token: string): Promise<ResolvedApiToken | null> {
  const [row] = await db
    .select({
      tokenId: apiTokensTable.id,
      scope: apiTokensTable.scope,
      lastUsedAt: apiTokensTable.lastUsedAt,
      userId: usersTable.id,
      email: usersTable.email,
    })
    .from(apiTokensTable)
    .innerJoin(usersTable, eq(usersTable.id, apiTokensTable.userId))
    .where(and(eq(apiTokensTable.tokenHash, hashApiToken(token)), isNull(apiTokensTable.revokedAt), eq(usersTable.role, "ADMIN")))
    .limit(1);
  if (!row) return null;
  return { tokenId: row.tokenId, scope: row.scope, lastUsedAt: row.lastUsedAt, user: { id: row.userId, email: row.email } };
}

export async function touchApiTokenLastUsed(tokenId: string): Promise<void> {
  await db.update(apiTokensTable).set({ lastUsedAt: new Date() }).where(eq(apiTokensTable.id, tokenId));
}
