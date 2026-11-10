import { Router, type IRouter, type Request, type Response } from "express";
import { authenticate, requireAdmin } from "../middlewares/auth";
import { BraavoError } from "../services/braavo-api";
import { CloudRunJobError, runBraavoBackfillJob } from "../services/cloud-run-jobs";
import {
  getBraavoClient,
  getBraavoSyncStatus,
  runBraavoBatch,
  testBraavoConnection,
} from "../services/braavo-sync";

export const braavoRouter: IRouter = Router();
braavoRouter.use("/clients/:clientId/braavo", authenticate, requireAdmin);
function sendError(res: Response, error: unknown) {
  const status = error instanceof BraavoError ? error.status : 500;
  res
    .status(status)
    .json({
      error: true,
      code: error instanceof BraavoError ? error.code : "BRAAVO_ERROR",
      message:
        error instanceof BraavoError
          ? error.message
          : "Não foi possível processar a integração Braavo.",
      status,
    });
}
function clientId(req: Request) {
  const id = req.params.clientId;
  if (typeof id !== "string" || !id.trim() || id.length > 200)
    throw new BraavoError("Cliente inválido.", "INVALID_CLIENT", 400);
  return id;
}
braavoRouter.get(
  "/clients/:clientId/braavo",
  async (req, res): Promise<void> => {
    try {
      const id = clientId(req),
        client = await getBraavoClient(id);
      if (client.commercePlatform !== "BRAAVO")
        throw new BraavoError(
          "Este cliente não usa a plataforma Braavo.",
          "INVALID_CLIENT",
          400,
        );
      res.json(await getBraavoSyncStatus(id));
    } catch (error) {
      sendError(res, error);
    }
  },
);
braavoRouter.post(
  "/clients/:clientId/braavo/test",
  async (req, res): Promise<void> => {
    try {
      res.json(await testBraavoConnection(clientId(req)));
    } catch (error) {
      sendError(res, error);
    }
  },
);
braavoRouter.post(
  "/clients/:clientId/braavo/sync",
  async (req, res): Promise<void> => {
    try {
      const result = await runBraavoBatch(clientId(req), "manual");
      res
        .status(
          result.status === "failed"
            ? 502
            : result.status === "busy"
              ? 409
              : result.complete
                ? 200
                : 202,
        )
        .json(result);
    } catch (error) {
      sendError(res, error);
    }
  },
);

/** Considera "em andamento" uma loja que o job tocou nos últimos minutos. */
const RECENT_ACTIVITY_MS = 3 * 60_000;

braavoRouter.post(
  "/clients/:clientId/braavo/backfill",
  async (req, res): Promise<void> => {
    try {
      const id = clientId(req);
      const client = await getBraavoClient(id);
      if (client.commercePlatform !== "BRAAVO")
        throw new BraavoError("Este cliente não usa a plataforma Braavo.", "INVALID_CLIENT", 400);
      const status = await getBraavoSyncStatus(id);
      if (!status.configured)
        throw new BraavoError(
          "Informe domínio, API Token e API Key e salve a conexão antes de carregar o histórico.",
          "NOT_CONFIGURED",
          400,
        );
      if (status.fullCompletedAt)
        throw new BraavoError(
          "A carga completa desta loja já foi concluída. Ela se atualiza sozinha todos os dias.",
          "ALREADY_LOADED",
          409,
        );
      const recent =
        status.lastActivityAt && Date.now() - new Date(status.lastActivityAt).getTime() < RECENT_ACTIVITY_MS;
      if (status.busy || recent)
        throw new BraavoError(
          "Já existe uma carga em andamento para esta loja. Acompanhe pelo estado da integração.",
          "ALREADY_RUNNING",
          409,
        );
      const { execution } = await runBraavoBackfillJob(id);
      res.status(202).json({
        started: true,
        execution,
        message:
          "Carga iniciada na nuvem. Pode fechar esta janela: ela continua sozinha e o progresso aparece aqui.",
      });
    } catch (error) {
      if (error instanceof CloudRunJobError) {
        res.status(502).json({ error: true, code: error.code, message: error.message, status: 502 });
        return;
      }
      sendError(res, error);
    }
  },
);
