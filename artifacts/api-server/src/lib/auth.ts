import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db, sessionsTable } from "@workspace/db";

function readSecret(name: string): string {
  const v = process.env[name];
  if (!v || v.length < 32) {
    throw new Error(
      `${name} environment variable must be set to at least 32 characters`,
    );
  }
  return v;
}

const ACCESS_SECRET: string = readSecret("JWT_ACCESS_SECRET");

const ACCESS_EXPIRES_IN = "1h";
const REFRESH_TOKEN_TTL_DAYS = 7;
const REFRESH_TOKEN_TTL_MS = REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: "ADMIN" | "CLIENT";
  clientId: string | null;
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRES_IN });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, ACCESS_SECRET) as AccessTokenPayload;
}

function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function generateRefreshToken(): string {
  return randomBytes(48).toString("base64url");
}

export interface SessionContext {
  userAgent?: string | null;
  ip?: string | null;
}

/**
 * Issue a new opaque refresh token and persist its hash in the sessions table.
 * The plain token is returned once — only the hash is stored.
 */
export async function issueRefreshToken(
  userId: string,
  ctx: SessionContext = {},
): Promise<string> {
  const token = generateRefreshToken();
  await db.insert(sessionsTable).values({
    userId,
    refreshTokenHash: hashRefreshToken(token),
    userAgent: ctx.userAgent ?? null,
    ip: ctx.ip ?? null,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  });
  return token;
}

export interface RotatedSession {
  userId: string;
  refreshToken: string;
}

/**
 * Verify a refresh token, then rotate it: revoke the old session row, create a
 * new one, and return the new opaque refresh token alongside the userId.
 *
 * The revoke step is performed as a single conditional UPDATE that only
 * matches rows that are still active (not revoked, not expired). PostgreSQL
 * serializes concurrent UPDATEs against the same row, so two callers that
 * race with the same token will see exactly one revocation succeed and the
 * other receive zero rows back — preserving strict single-use rotation.
 *
 * Throws when the token is unknown, revoked, or expired.
 */
export async function rotateRefreshToken(
  presented: string,
  ctx: SessionContext = {},
): Promise<RotatedSession> {
  const presentedHash = hashRefreshToken(presented);
  const now = new Date();

  const revoked = await db
    .update(sessionsTable)
    .set({ revokedAt: now, lastUsedAt: now })
    .where(
      and(
        eq(sessionsTable.refreshTokenHash, presentedHash),
        isNull(sessionsTable.revokedAt),
        gt(sessionsTable.expiresAt, sql`now()`),
      ),
    )
    .returning({ userId: sessionsTable.userId });

  if (revoked.length === 0) {
    // Either the token never existed, has already been used, or has expired —
    // we deliberately don't distinguish to avoid leaking session state.
    throw new Error("REFRESH_TOKEN_INVALID");
  }

  const refreshToken = await issueRefreshToken(revoked[0].userId, ctx);
  return { userId: revoked[0].userId, refreshToken };
}

/**
 * Revoke a specific refresh token (e.g. on logout). Silently no-ops when the
 * token is unknown so logout never leaks whether a token existed.
 */
export async function revokeRefreshToken(presented: string): Promise<void> {
  const presentedHash = hashRefreshToken(presented);
  await db
    .update(sessionsTable)
    .set({ revokedAt: new Date() })
    .where(eq(sessionsTable.refreshTokenHash, presentedHash));
}
