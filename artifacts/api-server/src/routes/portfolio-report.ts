import { Router, type IRouter, type RequestHandler } from "express";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { PortfolioReport, PortfolioReportParams } from "../services/portfolio-report";
import { hasApiTokenPrefix, looksLikeApiToken, shouldTouchLastUsed } from "../services/api-token-rules";

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
  /** Confere um token de API de admin (upk_...) ligado. Padrão: banco (carregado só quando aparece um upk_, para não exigir banco nos testes). */
  verifyApiToken?: (token: string) => Promise<boolean>;
}

/**
 * Além do segredo fixo `UPDASH_REPORTS_READ_TOKEN`, o mesmo cabeçalho aceita um token de API de admin (`upk_...`, criado em Clientes →
 * Tokens de API). Assim a rotina de relatórios funciona mesmo sem a variável configurada na Vercel, e o token pode ser desligado pela tela.
 * O endpoint continua só de leitura (GET), sem dados pessoais e sem sync. Atualiza o "último uso" do token (no máx. 1x por minuto).
 */
async function verifyApiTokenInDb(token: string): Promise<boolean> {
  if (!looksLikeApiToken(token)) return false;
  const { resolveApiToken, touchApiTokenLastUsed } = await import("../services/api-tokens");
  const resolved = await resolveApiToken(token);
  if (!resolved) return false;
  if (shouldTouchLastUsed(resolved.lastUsedAt)) {
    try {
      await touchApiTokenLastUsed(resolved.tokenId);
    } catch {
      // "último uso" é só informativo: não derruba o relatório.
    }
  }
  return true;
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

  const verifyApiToken = options.verifyApiToken ?? verifyApiTokenInDb;

  const authenticateReportToken: RequestHandler = async (req, res, next) => {
    const header = req.get("x-updash-reports-token")?.trim() ?? "";

    // Token de API de admin (upk_...): vale mesmo sem o segredo fixo configurado.
    if (hasApiTokenPrefix(header)) {
      let accepted = false;
      try {
        accepted = await verifyApiToken(header);
      } catch {
        res.status(500).json({ error: true, code: "INTERNAL_ERROR", status: 500 });
        return;
      }
      if (!accepted) {
        res.status(401).json({ error: true, code: "UNAUTHORIZED", status: 401 });
        return;
      }
      next();
      return;
    }

    const expected = getToken()?.trim();
    if (!expected) {
      res.status(503).json({ error: true, code: "REPORT_TOKEN_NOT_CONFIGURED", status: 503 });
      return;
    }
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
