import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  buildApiLimiter,
  buildAuthLimiter,
  buildCorsOptions,
} from "./lib/security";

const app: Express = express();

const trustProxyEnv = process.env.TRUST_PROXY;
if (trustProxyEnv === undefined) {
  app.set("trust proxy", 1);
} else if (trustProxyEnv === "false" || trustProxyEnv === "0") {
  app.set("trust proxy", false);
} else if (/^\d+$/.test(trustProxyEnv)) {
  app.set("trust proxy", Number(trustProxyEnv));
} else {
  app.set("trust proxy", trustProxyEnv);
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(
  helmet({
    // Vite/SPA preview is served separately; the API only returns JSON, so
    // a strict default is fine.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);
app.use(compression());
app.use(cors(buildCorsOptions()));
app.use(
  express.json({
    limit: "1mb",
    // Guarda o corpo bruto (bytes exatos recebidos, antes do parse) pra
    // rotas que precisam validar assinatura HMAC sobre o payload original
    // (ex: webhook do WhatsApp/Meta) — depois do JSON.parse não dá mais
    // pra recalcular o hash de forma confiável (espaçamento/ordem de
    // chave pode mudar na re-serialização).
    verify: (req, _res, buf) => {
      (req as express.Request).rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

const apiLimiter = buildApiLimiter();
const authLimiter = buildAuthLimiter();
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/refresh", authLimiter);
app.use("/api", apiLimiter);

app.use("/api", router);

app.get("/", (_req, res) => {
  res.redirect(301, "/up-dash");
});

// Error handler global (achado em 07/08/2026: sem isso, qualquer exceção não
// tratada numa rota async cai no handler padrão do Express, que em produção
// (NODE_ENV=production) esconde a mensagem e devolve só um HTML genérico
// "Internal Server Error" — quebra o formato {error,code,message,status} que
// o resto da API usa e não deixa nem log nem cliente saberem o que houve.
// A stack completa vai só pro log (pino); o cliente recebe a mensagem, que já
// costuma bastar pra diagnosticar (e nunca inclui segredo — nossas exceções
// não carregam dado sensível na message).
app.use(
  (
    err: unknown,
    req: express.Request,
    res: express.Response,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _next: express.NextFunction,
  ): void => {
    logger.error(
      {
        err,
        method: req.method,
        url: req.url?.split("?")[0],
      },
      "[app] unhandled error",
    );
    if (res.headersSent) return;
    res.status(500).json({
      error: true,
      code: "INTERNAL_ERROR",
      message: err instanceof Error ? err.message : "Internal server error",
      status: 500,
    });
  },
);

export default app;
