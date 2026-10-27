import { Router, type IRouter, type Request, type Response } from "express";
import { eq, sql } from "drizzle-orm";
import { db, usersTable, clientsTable, clientUserAccessesTable } from "@workspace/db";
import {
  LoginBody,
  LogoutBody,
  RefreshTokenBody,
  LoginResponse,
  RefreshTokenResponse,
  GetMeResponse,
  LogoutResponse,
} from "@workspace/api-zod";
import {
  verifyPassword,
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  REFRESH_TOKEN_TTL_SECONDS,
  type SessionContext,
} from "../lib/auth";
import { clearSessionCookieHeaders, parseCookies, pickRefreshToken, REFRESH_COOKIE, sessionCookieHeaders } from "../lib/session-cookie";
import { authenticate } from "../middlewares/auth";

const router: IRouter = Router();

// Cookie "Secure" em HTTPS (produção); em http local (desenvolvimento/teste) o navegador descartaria um cookie Secure.
function cookiesAreSecure(req: Request): boolean {
  return req.secure || process.env.NODE_ENV === "production";
}

function setSessionCookies(req: Request, res: Response, refreshToken: string): void {
  res.setHeader("Set-Cookie", sessionCookieHeaders({ refreshToken, maxAgeSeconds: REFRESH_TOKEN_TTL_SECONDS, secure: cookiesAreSecure(req) }));
  // Resposta com token novo não pode ficar em cache de navegador nem de proxy.
  res.setHeader("Cache-Control", "no-store");
}

function sessionContextFrom(req: Request): SessionContext {
  return {
    userAgent: req.get("user-agent") ?? null,
    ip: req.ip ?? null,
  };
}

async function resolveClientIdForUser(
  userId: string,
  role: "ADMIN" | "CLIENT",
): Promise<string | null> {
  if (role !== "CLIENT") return null;
  // Marca ativa primeiro (false < true na ordenacao): quem tem acesso a varias marcas nao perde a entrada porque uma foi arquivada.
  const archivedLast = sql`(${clientsTable.archivedAt} IS NOT NULL)`;
  const [access] = await db
    .select({ id: clientUserAccessesTable.clientId })
    .from(clientUserAccessesTable)
    .innerJoin(clientsTable, eq(clientsTable.id, clientUserAccessesTable.clientId))
    .where(eq(clientUserAccessesTable.userId, userId))
    .orderBy(archivedLast);
  if (access?.id) return access.id;

  const [client] = await db
    .select({ id: clientsTable.id })
    .from(clientsTable)
    .where(eq(clientsTable.userId, userId))
    .orderBy(archivedLast);
  return client?.id ?? null;
}

// Usuario CLIENT cujo cliente foi arquivado perde o acesso (admin nao e afetado). O acesso volta se o cliente for restaurado.
async function isClientArchived(clientId: string | null): Promise<boolean> {
  if (!clientId) return false;
  const [client] = await db
    .select({ archivedAt: clientsTable.archivedAt })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));
  return Boolean(client?.archivedAt);
}

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

  const clientId = await resolveClientIdForUser(user.id, user.role);
  if (await isClientArchived(clientId)) {
    res.status(403).json({
      error: true,
      code: "CLIENT_ARCHIVED",
      message: "Este acesso foi desativado. Fale com a equipe da Agência Up.",
      status: 403,
    });
    return;
  }

  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    clientId,
  });
  const refreshToken = await issueRefreshToken(user.id, sessionContextFrom(req));
  setSessionCookies(req, res, refreshToken);

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

router.post("/auth/logout", async (req, res): Promise<void> => {
  const parsed = LogoutBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: parsed.error.message,
      status: 400,
    });
    return;
  }
  // Revoga o refresh token do corpo (tela) E o do cookie (sessão restaurada por cookie), se forem diferentes; depois apaga os cookies.
  const cookieToken = parseCookies(req.get("cookie"))[REFRESH_COOKIE];
  for (const token of new Set([parsed.data.refreshToken, cookieToken])) {
    if (!token || token.length === 0) continue;
    try {
      await revokeRefreshToken(token);
    } catch {
      /* best-effort */
    }
  }
  res.setHeader("Set-Cookie", clearSessionCookieHeaders({ secure: cookiesAreSecure(req) }));
  res.json(LogoutResponse.parse({ message: "Logged out successfully" }));
});

router.post("/auth/refresh", async (req, res): Promise<void> => {
  // O refresh token vem do corpo (tela e clientes antigos) ou, sem corpo, do cookie de sessão (tela que perdeu o localStorage).
  const picked = pickRefreshToken({ body: req.body, cookieHeader: req.get("cookie") });
  if (!picked) {
    const parsed = RefreshTokenBody.safeParse(req.body);
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: parsed.success ? "refreshToken is required (body or session cookie)" : parsed.error.message,
      status: 400,
    });
    return;
  }
  try {
    const { userId, refreshToken } = await rotateRefreshToken(
      picked.token,
      sessionContextFrom(req),
    );
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    if (!user) {
      res.status(401).json({
        error: true,
        code: "UNAUTHORIZED",
        message: "Invalid refresh token",
        status: 401,
      });
      return;
    }
    const clientId = await resolveClientIdForUser(user.id, user.role);
    if (await isClientArchived(clientId)) {
      res.status(401).json({
        error: true,
        code: "CLIENT_ARCHIVED",
        message: "Este acesso foi desativado.",
        status: 401,
      });
      return;
    }
    const accessToken = signAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      clientId,
    });
    // O token girou: o cookie leva o novo (senão o cookie ficaria com um token já morto).
    setSessionCookies(req, res, refreshToken);
    res.json(RefreshTokenResponse.parse({ accessToken, refreshToken }));
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
