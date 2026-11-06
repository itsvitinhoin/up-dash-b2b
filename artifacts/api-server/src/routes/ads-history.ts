import { Router, type IRouter } from "express";
import { authenticate, requireAdmin } from "../middlewares/auth";
import { logger } from "../lib/logger";
import { AdsHistoryError, getAdsHistory, requestAdsHistory } from "../services/ads-history";

// Histórico de anúncios no painel: estado da conta e botão "Buscar histórico" (o job ads-onboarding do backend-dash faz a busca).
const router: IRouter = Router();

function fail(res: import("express").Response, err: unknown, context: string): void {
  if (err instanceof AdsHistoryError) {
    res.status(err.status).json({ error: true, code: err.code, message: err.message, status: err.status });
    return;
  }
  logger.error({ err: err instanceof Error ? err.message : String(err), context }, "histórico de anúncios falhou");
  res.status(502).json({ error: true, code: "ADS_HISTORY_FAILED", message: "Não consegui consultar o histórico de anúncios. Tente de novo em instantes.", status: 502 });
}

router.get("/clients/:clientId/ads-history", authenticate, requireAdmin, async (req, res): Promise<void> => {
  try {
    res.json(await getAdsHistory(String(req.params.clientId)));
  } catch (err) {
    fail(res, err, "leitura");
  }
});

router.post("/clients/:clientId/ads-history/request", authenticate, requireAdmin, async (req, res): Promise<void> => {
  try {
    const body = (req.body ?? {}) as { startDate?: unknown };
    const result = await requestAdsHistory(String(req.params.clientId), {
      requestedBy: req.user?.email ?? null,
      startDate: body.startDate,
    });
    logger.info({ clientId: req.params.clientId, startDate: result.startDate, requestedBy: req.user?.email }, "pedido de histórico de anúncios registrado");
    res.status(202).json(result);
  } catch (err) {
    fail(res, err, "pedido");
  }
});

export default router;
