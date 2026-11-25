import { getBlingApp } from "../services/bling-config";
import { Router, type IRouter, type Response } from "express";
import { randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  blingConnectionsTable as connections,
  blingOauthStatesTable as states,
  blingRecordsTable as records,
} from "@workspace/db";
import {
  authenticate,
  requireAdmin,
  resolveClientId,
} from "../middlewares/auth";
import {
  BlingApi,
  BlingError,
  BlingRateLimitError,
  exchangeBlingToken,
  hashState,
  record,
  sealTokens,
  text,
} from "../services/bling-api";
import {
  claimBlingLease,
  releaseBlingLease,
  requireBlingClient,
  reserveBlingSlot,
  runBlingBatch,
  testBlingConnection,
} from "../services/bling-sync";
import { getBlingErpLayout } from "../services/bling-erp-layout";
import { getBlingAnalytics, getBlingStatus } from "../services/bling-analytics";

export const blingRouter: IRouter = Router();
function sendError(res: Response, error: unknown) {
  const cause =
    error instanceof Error && "cause" in error ? error.cause : error;
  if (
    cause &&
    typeof cause === "object" &&
    "code" in cause &&
    cause.code === "23505" &&
    "constraint" in cause &&
    cause.constraint === "bling_company_uq"
  ) {
    error = new BlingError(
      "Esta empresa Bling já está conectada a outra marca. Verifique a conta autorizada.",
      "BLING_COMPANY_ALREADY_CONNECTED",
      409,
    );
  }
  const status = error instanceof BlingError ? error.status : 500;
  if (error instanceof BlingRateLimitError)
    res.set(
      "Retry-After",
      String(
        Math.max(1, Math.ceil((error.retryAt.getTime() - Date.now()) / 1000)),
      ),
    );
  res.status(status).json({
    ...(error instanceof BlingRateLimitError
      ? { retryAt: error.retryAt.toISOString(), rateLimitPeriod: error.period }
      : {}),
    error: true,
    code: error instanceof BlingError ? error.code : "BLING_ERROR",
    message:
      error instanceof BlingError
        ? error.message
        : "Não foi possível processar a integração Bling.",
    status,
  });
}
const clientPath = "/clients/:clientId/bling";
blingRouter.use(
  clientPath,
  (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  },
  authenticate,
  requireAdmin,
);
blingRouter.get(clientPath, async (req, res) => {
  try {
    res.json(await getBlingStatus(String(req.params.clientId)));
  } catch (error) {
    sendError(res, error);
  }
});
blingRouter.post(`${clientPath}/authorize`, async (req, res) => {
  try {
    const clientId = String(req.params.clientId);
    await requireBlingClient(clientId);
    const app = await getBlingApp(clientId);
    if (!app.selected)
      throw new BlingError(
        "Salve Bling como ERP da marca primeiro.",
        "BLING_NOT_SELECTED",
        409,
      );
    const config = app.config,
      state = randomBytes(32).toString("hex");
    await db.delete(states).where(lt(states.expiresAt, new Date()));
    await db.insert(states).values({
      hash: hashState(state),
      clientId,
      expiresAt: new Date(Date.now() + 600_000),
    });
    res.cookie("bling_oauth", state, {
      httpOnly: true,
      secure: new URL(config.redirect).protocol === "https:",
      sameSite: "lax",
      path: "/api/bling",
      maxAge: 600_000,
    });
    const url = new URL("https://www.bling.com.br/Api/v3/oauth/authorize");
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: config.clientId,
      state,
    }).toString();
    res.json({ url: url.href });
  } catch (error) {
    sendError(res, error);
  }
});
blingRouter.get("/bling/callback", async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.set("Referrer-Policy", "no-referrer");
  let locked: { clientId: string; leaseId: string } | null = null;
  try {
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const cookie = req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("bling_oauth="))
      ?.slice("bling_oauth=".length);
    if (!/^[a-f0-9]{64}$/.test(state) || cookie !== state)
      throw new BlingError(
        "Autorização inválida. Inicie a conexão novamente pelo Dash.",
        "INVALID_OAUTH_STATE",
        400,
      );
    res.clearCookie("bling_oauth", { path: "/api/bling" });
    const [saved] = await db
      .delete(states)
      .where(
        and(
          eq(states.hash, hashState(state)),
          gt(states.expiresAt, new Date()),
        ),
      )
      .returning();
    if (!saved)
      throw new BlingError(
        "A autorização expirou ou já foi usada. Inicie novamente.",
        "INVALID_OAUTH_STATE",
        400,
      );
    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (req.query.error || !code || code.length > 2048)
      throw new BlingError(
        "A conexão Bling não foi autorizada.",
        "BLING_ACCESS_DENIED",
        400,
      );
    const lease = await claimBlingLease(saved.clientId);
    locked = { clientId: saved.clientId, leaseId: lease.leaseId };
    const app = await getBlingApp(saved.clientId);
    if (!app.selected)
      throw new BlingError(
        "Bling deixou de ser o ERP da marca. Salve a configuração e tente novamente.",
        "BLING_NOT_SELECTED",
        409,
      );
    const tokens = await exchangeBlingToken({ code }, fetch, app.credentials);
    const api = new BlingApi(tokens.accessToken, () =>
      reserveBlingSlot(saved.clientId),
    );
    const company = record(await api.get("/empresas/me/dados-basicos"));
    const companyId = text(company.id);
    if (!companyId)
      throw new BlingError("O Bling não identificou a empresa da conexão.");
    if (lease.connection.companyId && lease.connection.companyId !== companyId)
      throw new BlingError(
        "Esta marca já está vinculada a outra empresa Bling. Verifique a conta autorizada.",
        "BLING_COMPANY_MISMATCH",
        409,
      );
    await db
      .update(connections)
      .set({
        companyId,
        companyName: text(company.nome),
        tokens: sealTokens(tokens),
        expiresAt: tokens.expiresAt,
        error: null,
      })
      .where(
        and(
          eq(connections.clientId, saved.clientId),
          eq(connections.leaseId, lease.leaseId),
        ),
      );
    const redirect = new URL("/clients", app.config.redirect);
    redirect.search = new URLSearchParams({
      clientId: saved.clientId,
      mode: "B2C",
      bling: "connected",
    }).toString();
    res.redirect(303, redirect.href);
  } catch (error) {
    sendError(res, error);
  } finally {
    if (locked) await releaseBlingLease(locked.clientId, locked.leaseId);
  }
});
blingRouter.post(`${clientPath}/settings`, async (req, res) => {
  let leaseId: string | null = null;
  const clientId = String(req.params.clientId);
  try {
    const parsed = z
      .object({
        nuvemshopChannelId: z
          .string()
          .regex(/^[1-9]\d*$/)
          .nullable(),
        historyDays: z.number().int().min(1).max(365),
      })
      .strict()
      .safeParse(req.body);
    if (!parsed.success)
      throw new BlingError(
        "Informe o canal e um histórico entre 1 e 365 dias.",
        "VALIDATION_ERROR",
        400,
      );
    const lease = await claimBlingLease(clientId);
    leaseId = lease.leaseId;
    if (parsed.data.nuvemshopChannelId) {
      const [channel] = await db
        .select({ id: records.externalId })
        .from(records)
        .where(
          and(
            eq(records.clientId, clientId),
            eq(records.kind, "channels"),
            eq(records.externalId, parsed.data.nuvemshopChannelId),
          ),
        );
      if (!channel)
        throw new BlingError(
          "Sincronize os canais antes de selecionar a loja Nuvemshop.",
          "INVALID_CHANNEL",
          400,
        );
      const client = await requireBlingClient(clientId);
      if (client.commercePlatform !== "NUVEMSHOP")
        throw new BlingError(
          "A marca precisa utilizar Nuvemshop para este vínculo.",
          "INVALID_CHANNEL",
          400,
        );
    }
    const changed = parsed.data.historyDays !== lease.connection.historyDays;
    await db
      .update(connections)
      .set({
        ...parsed.data,
        ...(changed
          ? { cursor: null, watermark: null, completedAt: null }
          : {}),
      })
      .where(
        and(
          eq(connections.clientId, clientId),
          eq(connections.leaseId, leaseId),
        ),
      );
    res.json({ ok: true });
  } catch (error) {
    sendError(res, error);
  } finally {
    if (leaseId) await releaseBlingLease(clientId, leaseId);
  }
});
blingRouter.post(`${clientPath}/sync`, async (req, res) => {
  try {
    const result = await runBlingBatch(String(req.params.clientId));
    res.status(result.complete ? 200 : 202).json(result);
  } catch (error) {
    sendError(res, error);
  }
});

blingRouter.post(`${clientPath}/orders/refresh`, async (req, res) => {
  const parsed = z
    .object({
      orderNumber: z
        .string()
        .regex(/^[1-9]\d*$/)
        .max(16)
        .refine((value) => Number.isSafeInteger(Number(value))),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: true,
      message: "Informe um número de pedido válido.",
      status: 400,
    });
    return;
  }
  try {
    const result = await runBlingBatch(String(req.params.clientId), {
      ordersOnly: true,
      orderNumber: parsed.data.orderNumber,
    });
    res.status(200).json(result);
  } catch (error) {
    sendError(res, error);
  }
});

blingRouter.post(`${clientPath}/test`, async (req, res) => {
  try {
    res.json(await testBlingConnection(String(req.params.clientId)));
  } catch (error) {
    sendError(res, error);
  }
});

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
  );
blingRouter.get("/analytics/erp/bling", authenticate, async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const clientId = resolveClientId(req);
    if (!clientId)
      throw new BlingError("Selecione uma marca.", "CLIENT_REQUIRED", 400);
    if (req.query.layout !== undefined) {
      const parsed = z
        .object({
          from: dateOnly,
          to: dateOnly,
          layout: z.enum(["dashboard", "orders", "customers", "products"]),
          search: z.string().max(100).default(""),
          page: z.coerce.number().int().min(1).max(100000).default(1),
          limit: z.coerce.number().int().min(1).max(10000).default(20),
          statusId: z.string().max(100).optional(),
          customerId: z.string().max(100).optional(),
          category: z.string().max(100).optional(),
          stockStatus: z
            .enum(["in_stock", "out_of_stock", "negative"])
            .optional(),
          layoutSort: z
            .enum([
              "revenue",
              "units",
              "stock",
              "turnover",
              "sales_power",
              "margin",
              "coverage",
            ])
            .optional(),
          layoutBuyerType: z.enum(["NEW", "RETURNING"]).optional(),
        })
        .safeParse(req.query);
      if (!parsed.success || parsed.data.from > parsed.data.to)
        throw new BlingError(
          "Filtros de ERP inválidos.",
          "VALIDATION_ERROR",
          400,
        );
      res.json(
        await getBlingErpLayout({ clientId, view: "overview", ...parsed.data }),
      );
      return;
    }
    const parsed = z
      .object({
        from: dateOnly,
        to: dateOnly,
        view: z
          .enum(["overview", "orders", "customers", "products", "stock"])
          .default("overview"),
        channel: z.string().max(100).optional(),
        search: z.string().max(100).default(""),
        page: z.coerce.number().int().min(1).max(100000).default(1),
        statusId: z.string().max(100).optional(),
        customerId: z.string().max(100).optional(),
        buyerType: z.enum(["all", "single", "repeat"]).default("all"),
        stock: z
          .enum(["all", "positive", "zero", "negative", "unknown"])
          .default("all"),
        sort: z.enum(["name", "units", "value", "stock"]).default("name"),
        export: z
          .enum(["1"])
          .optional()
          .transform((v) => v === "1"),
      })
      .safeParse(req.query);
    if (!parsed.success || parsed.data.from > parsed.data.to)
      throw new BlingError(
        "Filtros de ERP inválidos.",
        "VALIDATION_ERROR",
        400,
      );
    res.json(await getBlingAnalytics({ clientId, ...parsed.data }));
  } catch (error) {
    sendError(res, error);
  }
});
