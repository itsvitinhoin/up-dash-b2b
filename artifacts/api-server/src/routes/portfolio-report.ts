import { Router, type IRouter, type RequestHandler } from "express";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { PortfolioReport, PortfolioReportParams } from "../services/portfolio-report";

const DateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    );
  }, "Invalid calendar date");

const QuerySchema = z
  .object({
    dateFrom: DateOnlySchema,
    dateTo: DateOnlySchema,
  })
  .refine((value) => value.dateFrom <= value.dateTo, {
    message: "dateFrom must be before or equal to dateTo",
  });

type BuildReport = (params: PortfolioReportParams) => Promise<PortfolioReport>;

interface PortfolioReportRouterOptions {
  buildReport?: BuildReport;
  getToken?: () => string | undefined;
}

function secureEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function createPortfolioReportRouter(
  options: PortfolioReportRouterOptions = {},
): IRouter {
  const router = Router();
  const getToken = options.getToken ?? (() => process.env.UPDASH_REPORTS_READ_TOKEN);
  const buildReport: BuildReport = options.buildReport ?? (async (params) => {
    const service = await import("../services/portfolio-report");
    return service.buildPortfolioReport(params);
  });

  const authenticateReportToken: RequestHandler = (req, res, next) => {
    const expected = getToken()?.trim();
    if (!expected) {
      res.status(503).json({ error: true, code: "REPORT_TOKEN_NOT_CONFIGURED", status: 503 });
      return;
    }
    const header = req.get("x-updash-reports-token")?.trim() ?? "";
    if (!header || !secureEqual(header, expected)) {
      res.status(401).json({ error: true, code: "UNAUTHORIZED", status: 401 });
      return;
    }
    next();
  };

  router.all("/analytics/portfolio-report", (req, res, next) => {
    if (req.method === "GET") {
      next();
      return;
    }
    res.setHeader("allow", "GET");
    res.status(405).json({ error: true, code: "METHOD_NOT_ALLOWED", status: 405 });
  });

  router.get("/analytics/portfolio-report", authenticateReportToken, async (req, res, next) => {
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: true,
        code: "VALIDATION_ERROR",
        message: parsed.error.issues.map((issue) => issue.message).join("; "),
        status: 400,
      });
      return;
    }
    try {
      const report = await buildReport(parsed.data);
      res.setHeader("cache-control", "private, no-store");
      res.json(report);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export default createPortfolioReportRouter();
