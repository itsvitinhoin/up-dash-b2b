import { readManagerDpaInventory, removeManagerDpaProduct } from "../services/up-manager-dpa";
import { isUpManagerPilot, managerClientIds } from "../services/up-manager-config";
import { managerActionReadiness } from "../services/up-manager-source-readiness";
import { answerBrainChat, brainChatSchema } from "../services/up-manager-brain-chat";
import { logger } from "../lib/logger";
import rateLimit from "express-rate-limit";
import { readBrainIndex, readBrainRun } from "../services/up-manager-memory";
import { audienceWindowCanCreate, createManagerAudience, managerAudienceStatuses } from "../services/up-manager-audience-actions";
import { listManagerFollowups, managerWeeklyGoalsSchema, readManagerWeeklyGoals,
  setManagerWeeklyGoals, startFollowupSchema, startManagerFollowup } from "../services/up-manager-workflow";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  authenticate,
  requireAdmin,
  requireSessionAuth,
  resolveClientId,
} from "../middlewares/auth";
import {
  managerInsightReviews,
  reviewManagerInsight,
} from "../services/up-manager-reviews";
import {
  approvedCreativeWindow,
  type buildCreativeReview,
} from "../services/up-manager-creatives";
import { campaignClient } from "../services/product-campaign-monitor";
import {
  executeCreativePause,
  executeManagerGradePause,
  managerGradePauseActions,
  executeManagerPause,
  managerActions,
} from "../services/up-manager-actions";
import {
  managerHistory,
  managerReportDetails,
  saveManagerReport,
} from "../services/up-manager-insights";
import {
  managerCommerceSupported,
  readManagerOverview,
  readManagerProducts,
} from "../services/up-manager";

import {
  checkoutTestForReport,
  checkoutTestsEnabled,
  runManagerCheckoutTest,
} from "../services/up-manager-checkout-test";

import {
  executeManagerBudget, executeManagerReactivation, executeManagerRoasPause, ManagerMediaActionError, managerMediaActionStatuses, quoteManagerBudget,
} from "../services/up-manager-media-actions";
import type { PaidMediaReview } from "../services/up-manager-paid-media";

const periodSchema = z
  .object({ dateFrom: z.string().date(), dateTo: z.string().date() })
  .refine(
    ({ dateFrom, dateTo }) =>
      dateFrom <= dateTo &&
      Date.parse(dateTo) - Date.parse(dateFrom) < 366 * 86_400_000,
  );
const reviewSchema = z.object({
  insightId: z.string().regex(/^[a-zA-Z0-9:_-]{1,160}$/),
});
const mediaActionsEnabled = () => process.env.UP_MANAGER_MEDIA_ACTIONS_ENABLED === "1";
const pauseAndScaleEnabled = () => mediaActionsEnabled() || process.env.UP_MANAGER_PAUSE_SCALE_ENABLED === "1";
const entityId = z.string().regex(/^\d{1,32}$/);
const mediaSelection = z.object({ level: z.enum(["campaign", "adset", "ad"]), id: entityId });

const canPause = () => process.env.UP_MANAGER_PAUSE_ENABLED === "1";
const gradePauseEnabled = () => process.env.UP_MANAGER_GRADE_PAUSE_ENABLED === "1";
const creativePauseEnabled = () =>
  process.env.UP_MANAGER_CREATIVE_PAUSE_ENABLED === "1";
const pauseSchema = z.object({
  recommendationId: z.string().regex(/^[a-f0-9]{64}$/),
  confirm: z.literal(true),
});

async function activeBrand(req: Request, res: Response) {
  const clientId = resolveClientId(req);
  if (!clientId || !isUpManagerPilot(clientId)) {
    res
      .status(404)
      .json({ message: "O Up Manager ainda está indisponível para esta marca." });
    return null;
  }
  const client = await campaignClient(clientId);
  if (!managerCommerceSupported(client)) {
    res.status(409).json({ message: "Selecione uma loja B2C ativa com Nuvemshop ou Braavo." });
    return null;
  }
  res.setHeader("Cache-Control", "private, no-store");
  return client;
}

function selectedPeriod(req: Request, res: Response) {
  const parsed = periodSchema.safeParse(req.query);
  if (parsed.success) return parsed.data;
  res
    .status(400)
    .json({ message: "Selecione um período válido de até 366 dias." });
  return null;
}

export const upManagerRouter = Router();
upManagerRouter.use("/up-manager", authenticate);

upManagerRouter.get("/up-manager/brands", async (req, res) => {
  const ids = managerClientIds().filter((id) => req.user?.role === "ADMIN" || req.user?.clientId === id);
  const brands = await Promise.all(ids.map(campaignClient));
  res.setHeader("Cache-Control", "private, no-store");
  res.json(brands.filter(managerCommerceSupported).map(({ id, name, commercePlatform }) => ({ id, name, commercePlatform })));
});

upManagerRouter.get("/up-manager", async (req, res) => {
  const period = selectedPeriod(req, res);
  if (!period) return;
  const client = await activeBrand(req, res);
  if (client)
    res.json({
      ...(await readManagerOverview(client, period)),
      clientName: client.name,
      currency: client.currency,
    });
});

upManagerRouter.get("/up-manager/products", async (req, res) => {
  const period = selectedPeriod(req, res);
  if (!period) return;
  const client = await activeBrand(req, res);
  if (client) res.json(await readManagerProducts(client, period));
});

upManagerRouter.get("/up-manager/dpa-catalog", async (req, res) => {
  const client = await activeBrand(req, res);
  if (!client) return;
  try {
    res.json(await readManagerDpaInventory(client, req.user?.role === "ADMIN"));
  } catch {
    res.status(503).json({ message: "O catálogo da Meta está indisponível agora. Tente novamente." });
  }
});

upManagerRouter.post("/up-manager/dpa-catalog/remove", requireSessionAuth, requireAdmin, async (req, res) => {
  const input = z.object({ setId: entityId, productId: z.string().trim().min(1).max(160), confirm: z.literal(true) }).safeParse(req.body);
  if (!input.success) { res.status(400).json({ message: "Confirme o produto e o conjunto DPA." }); return; }
  const client = await activeBrand(req, res);
  if (!client || !req.user?.sub) return;
  try {
    const removal = await removeManagerDpaProduct(client, input.data, req.user.sub);
    res.status(removal.status === "blocked" ? 409 : removal.status === "pending" ? 202 : 200).json(removal);
  } catch {
    res.status(503).json({ message: "Não foi possível concluir a consulta à Meta. Atualize o conjunto e tente novamente." });
  }
});

upManagerRouter.get("/up-manager/decisions", async (req, res) => {
  const client = await activeBrand(req, res);
  if (!client) return;
  const [history, actions] = await Promise.all([
    managerHistory(client.id),
    managerActions(client.id),
  ]);
  res.json({ history, actions, pauseAvailable: canPause() });
});

upManagerRouter.get("/up-manager/workflow", async (req, res) => {
  const client = await activeBrand(req, res);
  if (!client) return;
  const [followups, weekly] = await Promise.all([
    listManagerFollowups(client.id), readManagerWeeklyGoals(client.id),
  ]);
  res.json({ followups, weekly, canEditGoals: req.user?.role === "ADMIN" });
});

upManagerRouter.put("/up-manager/workflow/goals", requireSessionAuth, requireAdmin, async (req, res) => {
  const body = z.object({ weekStart: z.string().date(), goals: managerWeeklyGoalsSchema }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ message: "Confira o teto e as metas informadas." }); return; }
  const client = await activeBrand(req, res);
  if (!client || !req.user?.sub) return;
  const saved = await setManagerWeeklyGoals(client.id, req.user.sub, body.data.weekStart, body.data.goals);
  if (!saved) { res.status(409).json({ message: "A semana mudou. Atualize a página para editar a meta atual." }); return; }
  res.json(saved);
});

upManagerRouter.post("/up-manager/report/:runId/followup", requireSessionAuth, async (req, res) => {
  const run = z.string().uuid().safeParse(req.params.runId);
  const body = startFollowupSchema.safeParse(req.body);
  if (!run.success || !body.success) { res.status(400).json({ message: "Preencha a ação executada, o indicador e a meta." }); return; }
  const client = await activeBrand(req, res);
  if (!client || !req.user?.sub) return;
  const saved = await startManagerFollowup(client.id, run.data, req.user.sub, body.data);
  if (!saved) { res.status(404).json({ message: "Decisão indisponível neste diagnóstico." }); return; }
  res.json(saved);
});

upManagerRouter.get("/up-manager/brain", async (req, res) => {
  const offset = z.coerce.number().int().min(0).max(100000).default(0).safeParse(req.query.offset);
  if (!offset.success) { res.status(400).json({ message: "Página de histórico inválida." }); return; }
  const client = await activeBrand(req, res);
  if (!client) return;
  res.json({ brand: client.name, currency: client.currency, ...await readBrainIndex(client.id, offset.data) });
});

upManagerRouter.post("/up-manager/brain/chat", requireSessionAuth, rateLimit({
  windowMs: 60_000,
  limit: 12,
  keyGenerator: (req) => req.user!.sub,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Aguarde alguns instantes antes de enviar outra pergunta." },
}), async (req, res) => {
  const input = brainChatSchema.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ message: "Digite uma pergunta de até 1.500 caracteres." });
    return;
  }
  const client = await activeBrand(req, res);
  if (!client) return;
  const controller = new AbortController();
  const abort = () => { if (!res.writableEnded) controller.abort(); };
  res.once("close", abort);
  try {
    const reply = await answerBrainChat(client, input.data, controller.signal);
    if (controller.signal.aborted) return;
    if (reply.status === "unknown_run") res.status(404).json({ message: "Diagnóstico indisponível para esta marca." });
    else if (reply.status === "empty") res.status(404).json({ message: "O Brain ainda não tem diagnósticos para esta marca." });
    else if (reply.status === "unavailable") res.status(503).json({ message: "O chat do Brain está indisponível neste momento." });
    else res.json({ answer: reply.answer, details: reply.details, citations: reply.citations });
  } catch (error) {
    if (controller.signal.aborted) return;
    logger.warn({ errorType: error instanceof Error ? error.name : "unknown" }, "[up-manager] chat do Brain indisponível");
    res.status(503).json({ message: "O Brain não conseguiu responder agora. Tente novamente." });
  } finally {
    res.off("close", abort);
  }
});

upManagerRouter.get("/up-manager/brain/:runId", async (req, res) => {
  const run = z.string().uuid().safeParse(req.params.runId);
  if (!run.success) { res.status(404).json({ message: "Memória indisponível." }); return; }
  const client = await activeBrand(req, res);
  if (!client) return;
  const detail = await readBrainRun(client.id, run.data);
  if (!detail) { res.status(404).json({ message: "Memória indisponível." }); return; }
  res.json(detail);
});

upManagerRouter.get("/up-manager/report/:runId", async (req, res) => {
  const client = await activeBrand(req, res);
  if (!client) return;
  const parsed = z.string().uuid().safeParse(req.params.runId);
  if (!parsed.success) {
    res.status(404).json({ message: "Diagnóstico indisponível." });
    return;
  }
  const report = await managerReportDetails(client.id, parsed.data);
  if (!report) {
    res.status(404).json({ message: "Diagnóstico indisponível." });
    return;
  }
  const b2c = report.payload.b2c as
    | (NonNullable<Parameters<typeof managerActionReadiness>[0]> & { media?: { creativeReview?: ReturnType<typeof buildCreativeReview>; roasReview?: PaidMediaReview } })
    | undefined;
  const creative = b2c?.media?.creativeReview;
  const audienceStudy = b2c?.media?.roasReview?.audienceStudy;
  const [reviews, actions, checkoutTest, gradeActions, mediaActions, audienceActions] = await Promise.all([
    managerInsightReviews(client.id, parsed.data),
    creative ? managerActions(client.id) : [],
    checkoutTestsEnabled() ? checkoutTestForReport(client.id, parsed.data) : null,
    managerGradePauseActions(client.id, parsed.data),
    pauseAndScaleEnabled() ? managerMediaActionStatuses(client.id, parsed.data) : [],
    managerAudienceStatuses(client.id, audienceStudy?.recommendations.map(({ id }) => id) ?? []),
  ]);
  res.json({
    ...report,
    reviews,
    gradeActions,
    mediaActions,
    audienceActions,
    mediaActionBlock: managerActionReadiness(b2c),
    audienceCreationAvailable: Boolean(req.user?.role === "ADMIN" && mediaActionsEnabled() &&
      audienceStudy && audienceWindowCanCreate(audienceStudy)),
    mediaActionsAvailable: Boolean(req.user?.role === "ADMIN" && pauseAndScaleEnabled() &&
      b2c?.media?.roasReview && approvedCreativeWindow(b2c.media.roasReview.window, new Date())),
    mediaReactivationAvailable: Boolean(req.user?.role === "ADMIN" && mediaActionsEnabled() &&
      b2c?.media?.roasReview && approvedCreativeWindow(b2c.media.roasReview.window, new Date())),
    gradePauseAvailable: Boolean(req.user?.role === "ADMIN" && gradePauseEnabled() && client.storeId && client.storeToken),
    checkoutTestAvailable: Boolean(checkoutTest?.variant && client.storeId && client.storeToken && req.user),
    checkoutTest: checkoutTest?.result,
    creativePauseAvailable: Boolean(
      req.user?.role === "ADMIN" &&
      creative &&
      creativePauseEnabled() &&
      approvedCreativeWindow(creative.window, new Date()),
    ),
    creativeActions: actions.flatMap(({ evidence, status }) =>
      "kind" in evidence &&
      evidence.kind === "creative-performance" &&
      evidence.window.until === creative?.window.dateTo
        ? [{ adId: evidence.adId, status }]
        : [],
    ),
  });
});

upManagerRouter.post(
  "/up-manager/report/:runId/review",
  requireSessionAuth,
  async (req, res) => {
    const run = z.string().uuid().safeParse(req.params.runId);
    const input = reviewSchema.safeParse(req.body);
    if (!run.success || !input.success) {
      res
        .status(400)
        .json({ message: "Selecione um insight deste diagnóstico." });
      return;
    }
    const client = await activeBrand(req, res);
    if (!client || !req.user?.sub) return;
    const review = await reviewManagerInsight(
      client.id,
      run.data,
      input.data.insightId,
      req.user.sub,
    );
    if (!review) {
      res.status(404).json({ message: "Insight indisponível." });
      return;
    }
    res.json(review);
  },
);

upManagerRouter.post(
  "/up-manager/report/:runId/checkout-test",
  requireSessionAuth,
  async (req, res) => {
    const run = z.string().uuid().safeParse(req.params.runId);
    if (!checkoutTestsEnabled() || !run.success) {
      res.status(404).json({ message: "Teste de checkout indisponível." });
      return;
    }
    const client = await activeBrand(req, res);
    if (!client) return;
    const test = await runManagerCheckoutTest(client, run.data);
    if (test.status === "unavailable") {
      res.status(404).json({ message: "A variante do diagnóstico está indisponível para teste." });
    } else if (test.status === "recent") {
      res.status(429).json({ message: "Já existe um teste recente neste card. Aguarde dois minutos para testar de novo." });
    } else {
      res.json(test.result);
    }
  },
);

upManagerRouter.post(
  "/up-manager/report/:runId/media-pause", requireSessionAuth, requireAdmin,
  async (req, res) => {
    if (!pauseAndScaleEnabled()) { res.sendStatus(403); return; }
    const run = z.string().uuid().safeParse(req.params.runId);
    const input = z.union([
      mediaSelection.extend({ confirm: z.literal(true) }),
      z.object({ adId: entityId, confirm: z.literal(true) }).transform(({ adId }) => ({ id: adId, level: "ad" as const })),
    ]).safeParse(req.body);
    if (!run.success || !input.success) { res.status(400).json({ message: "Confirme o item deste diagnóstico." }); return; }
    const client = await activeBrand(req, res);
    if (!client || !req.user?.sub) return;
    res.json(await executeManagerRoasPause(client, run.data, input.data, req.user.sub));
  },
);

upManagerRouter.post(
  "/up-manager/report/:runId/audience-create", requireSessionAuth, requireAdmin,
  async (req, res) => {
    if (!mediaActionsEnabled()) { res.sendStatus(403); return; }
    const run = z.string().uuid().safeParse(req.params.runId);
    const input = z.object({ planId: z.string().regex(/^[a-f0-9]{64}$/), confirm: z.literal(true) }).safeParse(req.body);
    if (!run.success || !input.success) { res.status(400).json({ message: "Confirme o público recomendado neste diagnóstico." }); return; }
    const client = await activeBrand(req, res);
    if (!client || !req.user?.sub) return;
    res.json(await createManagerAudience(client, run.data, input.data.planId, req.user.sub));
  },
);

upManagerRouter.post(
  "/up-manager/report/:runId/media-reactivate", requireSessionAuth, requireAdmin,
  async (req, res) => {
    if (!mediaActionsEnabled()) { res.sendStatus(403); return; }
    const run = z.string().uuid().safeParse(req.params.runId);
    const input = z.object({ id: entityId, confirm: z.literal(true) }).safeParse(req.body);
    if (!run.success || !input.success) { res.status(400).json({ message: "Confirme o anúncio deste diagnóstico." }); return; }
    const client = await activeBrand(req, res);
    if (!client || !req.user?.sub) return;
    res.json(await executeManagerReactivation(client, run.data, input.data.id, req.user.sub));
  },
);

upManagerRouter.post(
  "/up-manager/report/:runId/media-budget-quote", requireSessionAuth, requireAdmin,
  async (req, res) => {
    if (!pauseAndScaleEnabled()) { res.sendStatus(403); return; }
    const run = z.string().uuid().safeParse(req.params.runId);
    const input = mediaSelection.safeParse(req.body);
    if (!run.success || !input.success) { res.status(400).json({ message: "Selecione o item deste diagnóstico." }); return; }
    const client = await activeBrand(req, res);
    if (!client) return;
    let quote;
    try {
      quote = await quoteManagerBudget(client, run.data, input.data);
    } catch (error) {
      res.status(409).json({ message: error instanceof ManagerMediaActionError ? error.message : "Orçamento indisponível na Meta." });
      return;
    }
    res.json(quote);
  },
);

upManagerRouter.post(
  "/up-manager/report/:runId/media-budget", requireSessionAuth, requireAdmin,
  async (req, res) => {
    if (!pauseAndScaleEnabled()) { res.sendStatus(403); return; }
    const run = z.string().uuid().safeParse(req.params.runId);
    const input = mediaSelection.extend({
      ownerId: entityId,
      field: z.enum(["daily_budget", "lifetime_budget"]),
      before: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      percent: z.number().int().min(15).max(20),
      confirm: z.literal(true),
    }).safeParse(req.body);
    if (!run.success || !input.success) { res.status(400).json({ message: "Confirme o orçamento e um aumento de 15% a 20%." }); return; }
    const client = await activeBrand(req, res);
    if (!client || !req.user?.sub) return;
    res.json(await executeManagerBudget(client, run.data, input.data, input.data, input.data.percent, req.user.sub));
  },
);

upManagerRouter.post(
  "/up-manager/report/:runId/grade-pause",
  requireSessionAuth,
  requireAdmin,
  async (req, res) => {
    if (!gradePauseEnabled()) {
      res.status(403).json({ message: "A desativação por quebra de grade está indisponível neste ambiente." });
      return;
    }
    const run = z.string().uuid().safeParse(req.params.runId);
    const input = z.object({
      productId: z.string().regex(/^\d{1,32}$/),
      adId: z.string().regex(/^\d{1,32}$/),
      confirm: z.literal(true),
    }).safeParse(req.body);
    if (!run.success || !input.success) {
      res.status(400).json({ message: "Confirme o produto e o anúncio deste diagnóstico." });
      return;
    }
    const client = await activeBrand(req, res);
    if (!client || !req.user?.sub) return;
    res.json(await executeManagerGradePause(client, run.data, input.data.productId, input.data.adId, req.user.sub));
  },
);

upManagerRouter.post(
  "/up-manager/report/:runId/creative-pause",
  requireSessionAuth,
  requireAdmin,
  async (req, res) => {
    if (!creativePauseEnabled()) {
      res
        .status(403)
        .json({
          message:
            "A desativação de criativos está indisponível neste ambiente.",
        });
      return;
    }
    const run = z.string().uuid().safeParse(req.params.runId);
    const input = z
      .object({
        adId: z.string().regex(/^\d{1,32}$/),
        confirm: z.literal(true),
      })
      .safeParse(req.body);
    if (!run.success || !input.success) {
      res.status(400).json({ message: "Confirme o anúncio e o diagnóstico." });
      return;
    }
    const client = await activeBrand(req, res);
    if (!client || !req.user?.sub) return;
    res.json(
      await executeCreativePause(
        client,
        run.data,
        input.data.adId,
        req.user.sub,
      ),
    );
  },
);

upManagerRouter.post(
  "/up-manager/diagnosis",
  requireSessionAuth,
  async (req, res) => {
    const period = selectedPeriod(req, res);
    if (!period) return;
    const client = await activeBrand(req, res);
    if (client) res.json(await saveManagerReport(client, period));
  },
);

upManagerRouter.post(
  "/up-manager/pause",
  requireSessionAuth,
  requireAdmin,
  async (req, res) => {
    if (!canPause()) {
      res.status(403).json({
        message: "A operação de anúncios está desativada para o piloto.",
      });
      return;
    }
    const parsed = pauseSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ message: "Confirme o anúncio que deve ser pausado." });
      return;
    }
    const client = await activeBrand(req, res);
    if (!client || !req.user?.sub) return;
    const result = await executeManagerPause(
      client,
      parsed.data.recommendationId,
      req.user.sub,
    );
    res.json(result);
  },
);
