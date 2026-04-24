import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers['set-cookie']",
      // Redact any auth-related body the http logger might serialize.
      "req.body.password",
      "req.body.refreshToken",
      "*.password",
      "*.refreshToken",
      "*.accessToken",
    ],
    censor: "[REDACTED]",
    remove: false,
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
