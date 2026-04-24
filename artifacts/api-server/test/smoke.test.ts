import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { buildCorsOptions } from "../src/lib/security";

const ADMIN_EMAIL = "admin@updash.com";
const ADMIN_PASSWORD = "Admin123!";
const CLIENT_EMAIL = "owner@aurora.com";
const CLIENT_PASSWORD = "Client123!";

interface LoginPayload {
  accessToken: string;
  refreshToken: string;
  user: { id: string; role: "ADMIN" | "CLIENT"; clientId: string | null };
}

async function login(email: string, password: string): Promise<LoginPayload> {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email, password });
  expect(res.status).toBe(200);
  return res.body as LoginPayload;
}

describe("API smoke tests", () => {
  let admin: LoginPayload;
  let client: LoginPayload;
  let secondClientId: string;

  beforeAll(async () => {
    admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    client = await login(CLIENT_EMAIL, CLIENT_PASSWORD);

    const list = await request(app)
      .get("/api/clients?limit=10")
      .set("authorization", `Bearer ${admin.accessToken}`);
    expect(list.status).toBe(200);
    const otherClient = list.body.data.find(
      (c: { id: string }) => c.id !== client.user.clientId,
    );
    expect(otherClient).toBeTruthy();
    secondClientId = otherClient.id;
  });

  describe("/healthz", () => {
    it("returns ok with db status", async () => {
      const res = await request(app).get("/api/healthz");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.db).toBe("ok");
      expect(typeof res.body.uptime).toBe("number");
    });
  });

  describe("/auth/login", () => {
    it("rejects bad credentials with 401", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: ADMIN_EMAIL, password: "wrong-password-x" });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("INVALID_CREDENTIALS");
    });

    it("returns access + refresh tokens on success", () => {
      expect(admin.accessToken).toBeTruthy();
      expect(admin.refreshToken).toBeTruthy();
      expect(admin.user.role).toBe("ADMIN");
    });
  });

  describe("/auth/refresh", () => {
    it("rotates the refresh token (old one no longer works)", async () => {
      const fresh = await login(CLIENT_EMAIL, CLIENT_PASSWORD);

      const first = await request(app)
        .post("/api/auth/refresh")
        .send({ refreshToken: fresh.refreshToken });
      expect(first.status).toBe(200);
      expect(first.body.accessToken).toBeTruthy();
      expect(first.body.refreshToken).toBeTruthy();
      expect(first.body.refreshToken).not.toBe(fresh.refreshToken);

      // Reusing the original token must now fail (single-use rotation).
      const replay = await request(app)
        .post("/api/auth/refresh")
        .send({ refreshToken: fresh.refreshToken });
      expect(replay.status).toBe(401);
    });

    it("rejects unknown refresh tokens with 401", async () => {
      const res = await request(app)
        .post("/api/auth/refresh")
        .send({ refreshToken: "this-is-not-a-real-token" });
      expect(res.status).toBe(401);
    });

    it("rejects refresh after logout (revocation)", async () => {
      const fresh = await login(CLIENT_EMAIL, CLIENT_PASSWORD);

      const logout = await request(app)
        .post("/api/auth/logout")
        .send({ refreshToken: fresh.refreshToken });
      expect(logout.status).toBe(200);

      const replay = await request(app)
        .post("/api/auth/refresh")
        .send({ refreshToken: fresh.refreshToken });
      expect(replay.status).toBe(401);
    });

    it("serializes concurrent rotations of the same token (single winner)", async () => {
      // Race two refreshes against the same token. Atomic conditional UPDATE
      // must let exactly one win — otherwise the second caller would also mint
      // a fresh token and we'd have two live sessions from one rotation.
      const fresh = await login(CLIENT_EMAIL, CLIENT_PASSWORD);

      const [a, b] = await Promise.all([
        request(app)
          .post("/api/auth/refresh")
          .send({ refreshToken: fresh.refreshToken }),
        request(app)
          .post("/api/auth/refresh")
          .send({ refreshToken: fresh.refreshToken }),
      ]);

      const successes = [a, b].filter((r) => r.status === 200);
      const failures = [a, b].filter((r) => r.status === 401);
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
    });
  });

  describe("tenant isolation", () => {
    it("CLIENT cannot read another client's record", async () => {
      const res = await request(app)
        .get(`/api/clients/${secondClientId}`)
        .set("authorization", `Bearer ${client.accessToken}`);
      expect(res.status).toBe(403);
    });

    it("CLIENT requesting another client's dashboard is silently scoped to its own", async () => {
      // The tenant resolver hard-pins CLIENT users to their own clientId,
      // ignoring any ?clientId override. The response must reflect their own
      // data, not the queried client's.
      const ownRes = await request(app)
        .get(`/api/analytics/dashboard?clientId=${client.user.clientId}`)
        .set("authorization", `Bearer ${client.accessToken}`);
      expect(ownRes.status).toBe(200);

      const overrideRes = await request(app)
        .get(`/api/analytics/dashboard?clientId=${secondClientId}`)
        .set("authorization", `Bearer ${client.accessToken}`);
      expect(overrideRes.status).toBe(200);
      // Same payload regardless of the override — proves the server ignored it.
      expect(overrideRes.body.kpis.revenue).toBe(ownRes.body.kpis.revenue);
      expect(overrideRes.body.kpis.orders).toBe(ownRes.body.kpis.orders);
    });

    it("CLIENT can fetch its own dashboard", async () => {
      const res = await request(app)
        .get(`/api/analytics/dashboard?clientId=${client.user.clientId}`)
        .set("authorization", `Bearer ${client.accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.kpis).toBeTruthy();
      expect(typeof res.body.kpis.revenue).toBe("number");
    });
  });

  describe("authorization", () => {
    it("requires a bearer token on protected endpoints", async () => {
      const res = await request(app).get("/api/clients");
      expect(res.status).toBe(401);
    });

    it("CLIENT cannot list all clients", async () => {
      const res = await request(app)
        .get("/api/clients")
        .set("authorization", `Bearer ${client.accessToken}`);
      expect(res.status).toBe(403);
    });
  });

  describe("clients currency/locale", () => {
    it("persists currency and locale through create-client and read-by-id", async () => {
      const unique = Math.random().toString(36).slice(2, 10);
      const created = await request(app)
        .post("/api/clients")
        .set("authorization", `Bearer ${admin.accessToken}`)
        .send({
          name: `Test Client ${unique}`,
          email: `test-${unique}@example.com`,
          apiKey: `key-${unique}`,
          currency: "USD",
          locale: "en-US",
        });
      expect(created.status).toBe(201);
      expect(created.body.currency).toBe("USD");
      expect(created.body.locale).toBe("en-US");

      const fetched = await request(app)
        .get(`/api/clients/${created.body.id}`)
        .set("authorization", `Bearer ${admin.accessToken}`);
      expect(fetched.status).toBe(200);
      expect(fetched.body.currency).toBe("USD");
      expect(fetched.body.locale).toBe("en-US");
    });
  });

  describe("CORS", () => {
    it("rejects disallowed Origin when allowlist is configured", async () => {
      const prev = process.env.ALLOWED_ORIGINS;
      process.env.ALLOWED_ORIGINS = "https://allowed.example.com";
      try {
        const opts = buildCorsOptions();
        const originFn = opts.origin as (
          origin: string | undefined,
          cb: (err: Error | null, allow?: boolean) => void,
        ) => void;

        const allowedResult = await new Promise<{ err: Error | null; allow?: boolean }>(
          (resolve) => originFn("https://allowed.example.com", (err, allow) => resolve({ err, allow })),
        );
        expect(allowedResult.err).toBeNull();
        expect(allowedResult.allow).toBe(true);

        const blockedResult = await new Promise<{ err: Error | null; allow?: boolean }>(
          (resolve) => originFn("https://evil.example.com", (err, allow) => resolve({ err, allow })),
        );
        expect(blockedResult.err).toBeInstanceOf(Error);
        expect(blockedResult.err?.message).toMatch(/not allowed by CORS/);
      } finally {
        if (prev === undefined) delete process.env.ALLOWED_ORIGINS;
        else process.env.ALLOWED_ORIGINS = prev;
      }
    });

    it("throws at startup in production when ALLOWED_ORIGINS is unset or '*'", () => {
      const prevEnv = process.env.NODE_ENV;
      const prevAllow = process.env.ALLOWED_ORIGINS;
      process.env.NODE_ENV = "production";
      try {
        delete process.env.ALLOWED_ORIGINS;
        expect(() => buildCorsOptions()).toThrow(/concrete comma-separated allowlist/);
        process.env.ALLOWED_ORIGINS = "*";
        expect(() => buildCorsOptions()).toThrow(/concrete comma-separated allowlist/);
      } finally {
        process.env.NODE_ENV = prevEnv;
        if (prevAllow !== undefined) process.env.ALLOWED_ORIGINS = prevAllow;
        else delete process.env.ALLOWED_ORIGINS;
      }
    });
  });
});
