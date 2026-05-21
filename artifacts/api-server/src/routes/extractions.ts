import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { authenticate, requireAdmin } from "../middlewares/auth";
import {
  listExtractionJobs,
  runHourlyExtractionBundle,
  runUpzeroTransactionalExtraction,
} from "../services/extraction-runner";

const router: IRouter = Router();

function verifyCronRequest(req: Request, res: Response): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    res.status(500).json({
      error: true,
      code: "CRON_SECRET_MISSING",
      message: "CRON_SECRET is not configured.",
      status: 500,
    });
    return false;
  }

  if (req.get("authorization") !== `Bearer ${secret}`) {
    res.status(401).json({
      error: true,
      code: "UNAUTHORIZED",
      message: "Unauthorized cron request.",
      status: 401,
    });
    return false;
  }

  return true;
}

router.get("/cron/extractions/hourly", async (req, res): Promise<void> => {
  if (!verifyCronRequest(req, res)) return;
  const result = await runHourlyExtractionBundle("cron");
  res.json({ ok: true, result });
});

router.get("/cron/extractions/upzero-transactional", async (req, res): Promise<void> => {
  if (!verifyCronRequest(req, res)) return;
  const result = await runUpzeroTransactionalExtraction("cron");
  res.json({ ok: true, result });
});

router.use("/extractions", authenticate);

const ListExtractionsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  status: z.enum(["pending", "running", "done", "failed"]).optional(),
  jobType: z.enum(["upzero_transactional", "upzero_analytics", "meta_ads"]).optional(),
  trigger: z.enum(["manual", "cron"]).optional(),
  clientId: z.coerce.string().optional(),
});

router.get("/extractions", requireAdmin, async (req, res): Promise<void> => {
  const parsed = ListExtractionsQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: parsed.error.message,
      status: 400,
    });
    return;
  }

  const rows = await listExtractionJobs(parsed.data);
  const data = rows.map((row) => {
    const startedAt = row.startedAt?.toISOString() ?? null;
    const finishedAt = row.finishedAt?.toISOString() ?? null;
    const durationSeconds =
      row.startedAt && row.finishedAt
        ? Math.round((row.finishedAt.getTime() - row.startedAt.getTime()) / 1000)
        : null;

    return {
      ...row,
      startedAt,
      finishedAt,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      durationSeconds,
    };
  });

  res.json({
    data,
    summary: {
      total: data.length,
      running: data.filter((row) => row.status === "running").length,
      done: data.filter((row) => row.status === "done").length,
      failed: data.filter((row) => row.status === "failed").length,
    },
  });
});

export default router;
