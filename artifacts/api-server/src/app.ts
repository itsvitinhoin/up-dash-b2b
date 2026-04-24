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
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

const apiLimiter = buildApiLimiter();
const authLimiter = buildAuthLimiter();
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/refresh", authLimiter);
app.use("/api", apiLimiter);

app.use("/api", router);

export default app;
