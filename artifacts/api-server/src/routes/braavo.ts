import { Router, type IRouter, type Request, type Response } from "express";
import { authenticate, requireAdmin } from "../middlewares/auth";
import { BraavoError } from "../services/braavo-api";
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
