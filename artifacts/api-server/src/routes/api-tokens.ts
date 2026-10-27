// Tokens de API de admin: valem até alguém desligar (não vencem). Só admin logado de verdade (JWT) gerencia; um token de API não cria nem
// desliga tokens. O valor completo do token aparece UMA vez, na criação. Regras: services/api-token-rules.ts.
import { Router, type IRouter } from "express";
import { z } from "zod";
import { authenticate, requireAdmin, requireSessionAuth } from "../middlewares/auth";
import { logger } from "../lib/logger";
import { cleanTokenName } from "../services/api-token-rules";
import { ApiTokenLimitError, createApiToken, listApiTokens, revokeApiToken } from "../services/api-tokens";

const router: IRouter = Router();

router.use("/api-tokens", authenticate, requireAdmin, requireSessionAuth);

const CreateApiTokenBody = z.object({
  name: z.string(),
  scope: z.enum(["FULL", "READ"]).default("FULL"),
});

router.get("/api-tokens", async (_req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ tokens: await listApiTokens() });
});

router.post("/api-tokens", async (req, res): Promise<void> => {
  const parsed = CreateApiTokenBody.safeParse(req.body);
  const name = parsed.success ? cleanTokenName(parsed.data.name) : null;
  if (!parsed.success || !name) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: "Informe um nome de 1 a 60 caracteres e o acesso (FULL ou READ).", status: 400 });
    return;
  }
  try {
    const created = await createApiToken({ userId: req.user!.sub, name, scope: parsed.data.scope });
    logger.info({ apiTokenId: created.record.id, scope: created.record.scope, userId: req.user!.sub }, "token de API criado");
    // O valor do token não pode ficar em cache de navegador nem de proxy.
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json({ token: created.token, record: created.record });
  } catch (err) {
    if (err instanceof ApiTokenLimitError) {
      res.status(409).json({ error: true, code: "TOKEN_LIMIT_REACHED", message: err.message, status: 409 });
      return;
    }
    throw err;
  }
});

router.post("/api-tokens/:tokenId/revoke", async (req, res): Promise<void> => {
  const tokenId = typeof req.params.tokenId === "string" ? req.params.tokenId : "";
  const record = tokenId ? await revokeApiToken(tokenId) : null;
  if (!record) {
    res.status(404).json({ error: true, code: "NOT_FOUND", message: "Token not found", status: 404 });
    return;
  }
  logger.info({ apiTokenId: record.id, byUserId: req.user!.sub }, "token de API desligado");
  res.json({ record });
});

export default router;
