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
    throw new Error("REFRESH_TOKEN_INVALID");
  }

  const refreshToken = await issueRefreshToken(revoked[0].userId, ctx);
  return { userId: revoked[0].userId, refreshToken };
}

export async function revokeRefreshToken(presented: string): Promise<void> {
  const presentedHash = hashRefreshToken(presented);
  await db
    .update(sessionsTable)
    .set({ revokedAt: new Date() })
    .where(eq(sessionsTable.refreshTokenHash, presentedHash));
}
