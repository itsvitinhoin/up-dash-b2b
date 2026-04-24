import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

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
const REFRESH_SECRET: string = readSecret("JWT_REFRESH_SECRET");

const ACCESS_EXPIRES_IN = "1h";
const REFRESH_EXPIRES_IN = "7d";

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: "ADMIN" | "CLIENT";
  clientId: string | null;
}

export interface RefreshTokenPayload {
  sub: string;
  type: "refresh";
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

export function signRefreshToken(userId: string): string {
  const payload: RefreshTokenPayload = { sub: userId, type: "refresh" };
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES_IN });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, ACCESS_SECRET) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, REFRESH_SECRET) as RefreshTokenPayload;
}
