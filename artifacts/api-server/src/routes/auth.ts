import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, clientsTable } from "@workspace/db";
import {
  LoginBody,
  RefreshTokenBody,
  LoginResponse,
  RefreshTokenResponse,
  GetMeResponse,
  LogoutResponse,
} from "@workspace/api-zod";
import {
  verifyPassword,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../lib/auth";
import { authenticate } from "../middlewares/auth";

const router: IRouter = Router();

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: parsed.error.message,
      status: 400,
    });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, parsed.data.email));

  if (!user) {
    res.status(401).json({
      error: true,
      code: "INVALID_CREDENTIALS",
      message: "Invalid email or password",
      status: 401,
    });
    return;
  }

  const ok = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!ok) {
    res.status(401).json({
      error: true,
      code: "INVALID_CREDENTIALS",
      message: "Invalid email or password",
      status: 401,
    });
    return;
  }

  let clientId: string | null = null;
  if (user.role === "CLIENT") {
    const [client] = await db
      .select({ id: clientsTable.id })
      .from(clientsTable)
      .where(eq(clientsTable.userId, user.id));
    clientId = client?.id ?? null;
  }

  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    clientId,
  });
  const refreshToken = signRefreshToken(user.id);

  res.json(
    LoginResponse.parse({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        clientId,
      },
    }),
  );
});

router.post("/auth/logout", async (_req, res): Promise<void> => {
  res.json(LogoutResponse.parse({ message: "Logged out successfully" }));
});

router.post("/auth/refresh", async (req, res): Promise<void> => {
  const parsed = RefreshTokenBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: parsed.error.message,
      status: 400,
    });
    return;
  }
  try {
    const payload = verifyRefreshToken(parsed.data.refreshToken);
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, payload.sub));
    if (!user) {
      res.status(401).json({
        error: true,
        code: "UNAUTHORIZED",
        message: "Invalid refresh token",
        status: 401,
      });
      return;
    }
    let clientId: string | null = null;
    if (user.role === "CLIENT") {
      const [client] = await db
        .select({ id: clientsTable.id })
        .from(clientsTable)
        .where(eq(clientsTable.userId, user.id));
      clientId = client?.id ?? null;
    }
    const accessToken = signAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      clientId,
    });
    res.json(RefreshTokenResponse.parse({ accessToken }));
  } catch {
    res.status(401).json({
      error: true,
      code: "UNAUTHORIZED",
      message: "Invalid or expired refresh token",
      status: 401,
    });
  }
});

router.get("/auth/me", authenticate, async (req, res): Promise<void> => {
  if (!req.user) {
    res.status(401).json({
      error: true,
      code: "UNAUTHORIZED",
      message: "Unauthorized",
      status: 401,
    });
    return;
  }
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.user.sub));
  if (!user) {
    res.status(404).json({
      error: true,
      code: "NOT_FOUND",
      message: "User not found",
      status: 404,
    });
    return;
  }
  res.json(
    GetMeResponse.parse({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      clientId: req.user.clientId,
    }),
  );
});

export default router;
