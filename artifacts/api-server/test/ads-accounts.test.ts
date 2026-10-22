import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const state = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; name: string; metaAdAccountId: string | null; isActive: boolean; archivedAt: Date | null }>,
  authenticated: true,
}));

vi.mock("@workspace/db", () => ({
  db: { select: () => ({ from: () => ({ where: async () => state.rows }) }) },
  clientsTable: { id: {}, name: {}, metaAdAccountId: {}, isActive: {}, archivedAt: {} },
}));
vi.mock("../src/middlewares/auth", () => ({
  authenticate: (_req: any, res: any, next: any) => {
    if (!state.authenticated) return res.status(401).json({ code: "UNAUTHORIZED" });
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

import adsAccountsRouter from "../src/routes/ads-accounts";
import { buildAdsAccountsList, normalizeAdAccountId } from "../src/services/ads-accounts-list";

const client = (over: Partial<(typeof state.rows)[number]> & { id: string }) => ({
  name: `Marca ${over.id}`,
  metaAdAccountId: "act_1447102162403037",
  isActive: true,
  archivedAt: null,
  ...over,
});

describe("normalizeAdAccountId", () => {
  it("padroniza para act_ + dígitos", () => {
    expect(normalizeAdAccountId("act_1447102162403037")).toBe("act_1447102162403037");
    expect(normalizeAdAccountId("act=1447102162403037")).toBe("act_1447102162403037");
    expect(normalizeAdAccountId(" 1447102162403037 ")).toBe("act_1447102162403037");
  });
  it("texto, vazio, letras e número curto demais viram nulo", () => {
    for (const bad of ["", "   ", null, undefined, "test", "act_abc", "act_", "123", "act_12 34"]) {
      expect(normalizeAdAccountId(bad as string | null | undefined)).toBeNull();
    }
  });
});

describe("buildAdsAccountsList", () => {
  it("a mesma conta em dois clientes aparece uma vez, com os dois clientes (ex.: Aurami e Cocci)", () => {
    const { accounts } = buildAdsAccountsList([
      client({ id: "c2", name: "Cocci", metaAdAccountId: "act_1483477112868321" }),
      client({ id: "c1", name: "Aurami", metaAdAccountId: "1483477112868321" }),
    ]);
    expect(accounts).toEqual([
      { adAccountId: "act_1483477112868321", clients: [{ id: "c1", name: "Aurami" }, { id: "c2", name: "Cocci" }] },
    ]);
  });

  it("ordena as contas pelo id e não repete", () => {
    const { accounts } = buildAdsAccountsList([
      client({ id: "a", metaAdAccountId: "act_9000000000000002" }),
      client({ id: "b", metaAdAccountId: "act_1000000000000001" }),
    ]);
    expect(accounts.map((a) => a.adAccountId)).toEqual(["act_1000000000000001", "act_9000000000000002"]);
  });

  it("arquivado, inativo e conta inválida ficam de fora e são explicados; sem conta nem entra na lista de ignorados", () => {
    const { accounts, ignored } = buildAdsAccountsList([
      client({ id: "ok", name: "Ok", metaAdAccountId: "act_1000000000000001" }),
      client({ id: "arq", name: "Arquivado", archivedAt: new Date("2026-10-01") }),
      client({ id: "ina", name: "Inativo", isActive: false }),
      client({ id: "inv", name: "Inválido", metaAdAccountId: "test" }),
      client({ id: "sem", name: "Sem conta", metaAdAccountId: null }),
      client({ id: "vaz", name: "Vazio", metaAdAccountId: "  " }),
    ]);
    expect(accounts.map((a) => a.adAccountId)).toEqual(["act_1000000000000001"]);
    expect(ignored).toEqual([
      { clientId: "arq", clientName: "Arquivado", reason: "archived" },
      { clientId: "ina", clientName: "Inativo", reason: "inactive" },
      { clientId: "inv", clientName: "Inválido", reason: "invalid_account" },
    ]);
  });

  it("conta compartilhada: se um cliente está arquivado e o outro ativo, a conta continua", () => {
    const { accounts } = buildAdsAccountsList([
      client({ id: "a", name: "A", archivedAt: new Date() }),
      client({ id: "b", name: "B" }),
    ]);
    expect(accounts).toEqual([{ adAccountId: "act_1447102162403037", clients: [{ id: "b", name: "B" }] }]);
  });
});

describe("GET /ads-accounts", () => {
  const app = express();
  app.use("/api", adsAccountsRouter);

  it("devolve a lista sem cache e sem dado sensível", async () => {
    state.authenticated = true;
    state.rows = [client({ id: "c1", name: "Adama" })];
    const res = await request(app).get("/api/ads-accounts");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toContain("no-store");
    expect(res.body.accounts).toEqual([{ adAccountId: "act_1447102162403037", clients: [{ id: "c1", name: "Adama" }] }]);
    expect(res.body.ignored).toEqual([]);
    expect(typeof res.body.generatedAt).toBe("string");
    expect(JSON.stringify(res.body)).not.toMatch(/token|secret|apiKey/i);
  });

  it("sem login válido: 401", async () => {
    state.authenticated = false;
    const res = await request(app).get("/api/ads-accounts");
    expect(res.status).toBe(401);
  });
});
