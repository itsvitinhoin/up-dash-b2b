import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const state = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; name: string; commercePlatform: string | null; metaAdAccountId: string | null; isActive: boolean; archivedAt: Date | null }>,
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
  commercePlatform: "VESTI" as string | null,
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

  it("filtro por plataforma: só os clientes dessa plataforma entram", () => {
    const rows = [
      client({ id: "v", name: "Vesti", commercePlatform: "VESTI", metaAdAccountId: "act_1000000000000001" }),
      client({ id: "u", name: "UpZero", commercePlatform: "UPZERO", metaAdAccountId: "act_2000000000000002" }),
      client({ id: "n", name: "Sem plataforma", commercePlatform: null, metaAdAccountId: "act_3000000000000003" }),
    ];
    expect(buildAdsAccountsList(rows, { commercePlatform: "VESTI" }).accounts.map((a) => a.adAccountId)).toEqual(["act_1000000000000001"]);
    expect(buildAdsAccountsList(rows).accounts.map((a) => a.adAccountId)).toEqual(["act_1000000000000001", "act_2000000000000002", "act_3000000000000003"]);
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

  it("?commercePlatform=VESTI devolve só Vesti (aceita minúsculas); sem o parâmetro, todos", async () => {
    state.authenticated = true;
    state.rows = [
      client({ id: "v", name: "Vesti", commercePlatform: "VESTI", metaAdAccountId: "act_1000000000000001" }),
      client({ id: "u", name: "UpZero", commercePlatform: "UPZERO", metaAdAccountId: "act_2000000000000002" }),
    ];
    const vesti = await request(app).get("/api/ads-accounts?commercePlatform=vesti");
    expect(vesti.status).toBe(200);
    expect(vesti.body.accounts.map((a: any) => a.adAccountId)).toEqual(["act_1000000000000001"]);
    const all = await request(app).get("/api/ads-accounts");
    expect(all.body.accounts).toHaveLength(2);
  });

  it("plataforma desconhecida: 400", async () => {
    state.authenticated = true;
    const res = await request(app).get("/api/ads-accounts?commercePlatform=XYZ");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("sem login válido: 401", async () => {
    state.authenticated = false;
    const res = await request(app).get("/api/ads-accounts");
    expect(res.status).toBe(401);
  });
});
