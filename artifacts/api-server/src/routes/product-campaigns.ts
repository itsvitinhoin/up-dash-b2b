import { Router, type IRouter } from "express";
import { z } from "zod";
import { isUpManagerPilot } from "../services/up-manager-config";
import { productCampaignReviewDecisions } from "@workspace/db/schema";
import { authenticate, resolveClientId } from "../middlewares/auth";
import {
  campaignClient,
  getProductCampaignCheck,
  reviewProductCampaignRecommendation,
  runProductCampaignCheck,
} from "../services/product-campaign-monitor";

export const productCampaignsRouter: IRouter = Router();
productCampaignsRouter.use("/product-campaigns", authenticate);

productCampaignsRouter.route("/product-campaigns").get(async (req, res) => {
  const clientId = resolveClientId(req);
  if (!clientId) {
    res.status(400).json({ message: "Selecione um cliente." });
    return;
  }
  if (!isUpManagerPilot(clientId)) {
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ configured: false });
    return;
  }
  const client = await campaignClient(clientId);
  if (!client) {
    res.status(404).json({ message: "Cliente não encontrado." });
    return;
  }
  res.setHeader("Cache-Control", "private, no-store");
  res.json(await getProductCampaignCheck(client));
});

const reviewBody = z.object({
  recommendationId: z.string().regex(/^[a-f0-9]{64}$/),
  decision: z.enum(productCampaignReviewDecisions),
});

productCampaignsRouter.post("/product-campaigns/review", async (req, res) => {
  const clientId = resolveClientId(req);
  if (!clientId || !req.user?.sub) {
    res.status(400).json({ message: "Selecione um cliente." });
    return;
  }
  const parsed = reviewBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Recomendação ou decisão inválida." });
    return;
  }
  const client = await campaignClient(clientId);
  if (!client) {
    res.status(404).json({ message: "Cliente não encontrado." });
    return;
  }
  const { recommendationId, decision } = parsed.data;
  const result = await reviewProductCampaignRecommendation(
    client,
    recommendationId,
    decision,
    req.user.sub,
  );
  res.setHeader("Cache-Control", "private, no-store");
  switch (result.status) {
    case "saved":
      res.json(result);
      return;
    case "not_enabled":
      res
        .status(404)
        .json({ message: "O piloto não está habilitado para este cliente." });
      return;
    case "already_reviewed":
      res
        .status(409)
        .json({
          message:
            "Esta recomendação já foi revisada. Consulte o histórico atualizado.",
        });
      return;
    case "expired":
      res
        .status(409)
        .json({
          message:
            "A evidência mudou ou está desatualizada. Consulte a análise mais recente.",
        });
  }
});

productCampaignsRouter.post("/product-campaigns/check", async (req, res) => {
  const clientId = resolveClientId(req);
  if (!clientId) {
    res.status(400).json({ message: "Selecione um cliente." });
    return;
  }
  if (!isUpManagerPilot(clientId)) {
    res.status(404).json({ message: "O piloto não está habilitado para este cliente." });
    return;
  }
  const client = await campaignClient(clientId);
  if (!client) {
    res.status(404).json({ message: "Cliente não encontrado." });
    return;
  }
  const result = await runProductCampaignCheck(client);
  const status =
    result.status === "failed"
      ? 502
      : result.status === "not_configured"
        ? 409
        : result.status === "busy"
          ? 202
          : 200;
  res.status(status).json(result);
});
