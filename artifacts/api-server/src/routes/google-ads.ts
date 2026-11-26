import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { authenticate, requireAdmin, resolveClientId } from "../middlewares/auth";
import { GoogleAdsError } from "../services/google-ads-api";
import { getGoogleAdsInsight, googleAdsInsightViews, type GoogleAdsInsightView } from "../services/google-ads-insights";
import { connectGoogleAds, getGoogleAdsReport, refreshGoogleAds } from "../services/google-ads-report";

const router: IRouter = Router();
const path = "/analytics/google-ads";
const datesSchema = z.object({ dateFrom: z.string().date(), dateTo: z.string().date() });
const customerIdSchema = z.string().trim().regex(/^(?:\d{10}|\d{3}-\d{3}-\d{4})$/)
  .transform((value) => value.replaceAll("-", ""));
const connectionSchema = z.object({
  customerId: customerIdSchema,
  managerId: customerIdSchema.nullable().default(null),
});

function sendError(res: Response, error: unknown) {
  const status = error instanceof GoogleAdsError ? error.status : 500;
  res.status(status).json({
    error: true,
    message: error instanceof GoogleAdsError ? error.message : "Não foi possível processar o relatório do Google Ads.",
    status,
  });
}

function forClient(handler: (clientId: string, req: Request) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    res.set("Cache-Control", "no-store");
    const clientId = resolveClientId(req);
    if (!clientId) {
      sendError(res, new GoogleAdsError("Selecione um cliente.", 400));
      return;
    }
    try {
      res.json(await handler(clientId, req));
    } catch (error) {
      sendError(res, error);
    }
  };
}

function parseDates(input: unknown) {
  const dates = datesSchema.safeParse(input);
  if (!dates.success) throw new GoogleAdsError("Informe as datas inicial e final do relatório.", 400);
  return dates.data;
}

router.get(path, authenticate, forClient((clientId, req) => {
  const campaignId = z.string().regex(/^\d{1,20}$/).optional().safeParse(req.query.campaignId);
  if (!campaignId.success) throw new GoogleAdsError("Informe um ID de campanha válido.", 400);
  return getGoogleAdsReport(clientId, parseDates(req.query), req.user?.role === "ADMIN", campaignId.data);
}));

router.get(path + "/insights", authenticate, forClient((clientId, req) => {
  const view = typeof req.query.view === "string" ? req.query.view as GoogleAdsInsightView : undefined;
  if (!view || !googleAdsInsightViews.includes(view)) {
    throw new GoogleAdsError("Selecione um relatório de Google Ads válido.", 400);
  }
  return getGoogleAdsInsight(clientId, parseDates(req.query), view);
}));

router.post(`${path}/connect`, authenticate, requireAdmin, forClient(async (clientId, req) => {
  const ids = connectionSchema.safeParse(req.body);
  if (!ids.success || ids.data.customerId === ids.data.managerId) {
    throw new GoogleAdsError("Informe o ID da conta anunciante (10 dígitos) e, se usado, o ID do MCC.", 400);
  }
  return connectGoogleAds(clientId, ids.data);
}));

router.post(`${path}/sync`, authenticate, requireAdmin, forClient((clientId, req) =>
  refreshGoogleAds(clientId, parseDates(req.body))));

export default router;
