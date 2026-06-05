import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { authenticate, requireAdmin } from "../middlewares/auth";
import {
  listExtractionJobs,
  runHourlyExtractionBundle,
  runNuvemshopTransactionalExtraction,
  runUpzeroTransactionalExtraction,
} from "../services/extraction-runner";

const router: IRouter = Router();
const DEFAULT_CRON_GITHUB_REPOSITORY = "itsvitinhoin/up-dash-b2b";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

async function verifyGitHubActionsRequest(req: Request): Promise<boolean> {
  const authHeader = req.get("authorization");
  const repository = req.get("x-github-repository");
  const expectedRepository =
    process.env.CRON_GITHUB_REPOSITORY ?? DEFAULT_CRON_GITHUB_REPOSITORY;

  if (!authHeader?.startsWith("Bearer ") || repository !== expectedRepository) {
    return false;
  }

  try {
    const response = await fetch(`https://api.github.com/repos/${expectedRepository}`, {
      headers: {
        Authorization: authHeader,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) return false;
    const payload = asRecord(await response.json());
    return String(payload?.full_name ?? "").toLowerCase() === expectedRepository.toLowerCase();
  } catch {
    return false;
  }
}

async function verifyCronRequest(req: Request, res: Response): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret && req.get("authorization") === `Bearer ${secret}`) {
    return true;
  }

  if (await verifyGitHubActionsRequest(req)) {
    return true;
  }

  res.status(401).json({
    error: true,
    code: "UNAUTHORIZED",
    message: "Unauthorized cron request.",
    status: 401,
  });
  return false;
}

router.get("/cron/extractions/hourly", async (req, res): Promise<void> => {
  if (!(await verifyCronRequest(req, res))) return;
  const result = await runHourlyExtractionBundle("cron");
  res.json({ ok: true, result });
});

router.get("/cron/extractions/upzero-transactional", async (req, res): Promise<void> => {
  if (!(await verifyCronRequest(req, res))) return;
  const result = await runUpzeroTransactionalExtraction("cron");
  res.json({ ok: true, result });
});

const CronNuvemshopQuery = z.object({
  clientId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(10).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

router.get("/cron/extractions/nuvemshop", async (req, res): Promise<void> => {
  if (!(await verifyCronRequest(req, res))) return;
  const parsed = CronNuvemshopQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: parsed.error.message,
      status: 400,
    });
    return;
  }
  const result = await runNuvemshopTransactionalExtraction("cron", parsed.data);
  res.json({ ok: true, result });
});

router.use("/extractions", authenticate);

const ListExtractionsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  status: z.enum(["pending", "running", "done", "failed"]).optional(),
  jobType: z.enum(["upzero_transactional", "upzero_analytics", "meta_ads", "nuvemshop_transactional"]).optional(),
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
