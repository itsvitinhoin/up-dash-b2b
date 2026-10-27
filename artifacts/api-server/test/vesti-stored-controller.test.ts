import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

// Telas Vesti (Relatório diário e Marketing) lendo campanhas, anúncios e gasto SÓ do dado guardado.
// Banco e BigQuery simulados; o que se verifica é a ligação: formato da resposta (validado pelo contrato da API),
// nada de Meta ao vivo, falha de leitura = 503 e cliente sem conta = telas vazias, sem erro.

const state = vi.hoisted(() => ({
  account: "act_111" as string | null,
  failCurrent: false,
  failPrevious: false,
  failCampaigns: false,
  failAds: false,
  dailyCalls: [] as Array<[string, string, string]>,
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => [{ name: "Marca Teste", metaAdAccountId: state.account }],
      }),
    }),
  },
  clientsTable: { id: {}, name: {}, metaAdAccountId: {} },
}));
vi.mock("../src/middlewares/auth", () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  requireAdmin: (_req: any, _res: any, next: any) => next(),
  resolveClientId: (req: any) => req.query.clientId,
}));
vi.mock("../src/lib/queryCache", () => ({ cached: (_key: string, _ttl: number, fn: () => unknown) => fn() }));
vi.mock("../src/services/meta-ads", async (original) => {
  const actual = await original<typeof import("../src/services/meta-ads")>();
  return {
    ...actual,
    fetchMetaMarketingData: vi.fn(async () => {
      throw new Error("Meta ao vivo não deve ser chamado pelas telas Vesti");
    }),
    upsertMetaCreatives: vi.fn(async () => {}),
  };
});
vi.mock("../src/services/vestiAnalytics", async (original) => {
  const actual = await original<typeof import("../src/services/vestiAnalytics")>();
  return {
    ...actual,
    resolveVestiDataset: async () => "marca_teste",
    computeVestiWindow: async () => ({ kpis: { revenue: 1000, orders: 10, avgTicket: 100 } }),
    fetchVestiDailyBreakdown: async () => ({ products: [], categories: [], colors: [], sizes: [] }),
    generateVestiDailyReportText: async () => ({ generalAnalysis: "", reportSummary: [], source: "heuristic" }),
    fetchVestiMarketingData: async () => ({
      totalAttributedRevenue: 2000,
      totalLeads: 20,
      approvedLeads: 10,
      leadsOverTime: [],
      revenueOverTime: [],
      platformBreakdown: [],
    }),
  };
});
vi.mock("../src/services/vesti-ads-stored", async (original) => {
  const actual = await original<typeof import("../src/services/vesti-ads-stored")>();
  const day = (date: string, spend: number) => ({ date, spend, impressions: 0, clicks: 0, leads: 0, purchases: 0, purchaseValue: 0 });
  return {
    ...actual,
    fetchStoredAdsDaily: vi.fn(async (account: string, from: string, to: string) => {
      state.dailyCalls.push([account, from, to]);
      const isPrevious = from < "2026-10-01";
      if (isPrevious ? state.failPrevious : state.failCurrent) throw new Error("bigquery fora do ar");
      return isPrevious ? [day("2026-09-20", 50)] : [day("2026-10-01", 120), day("2026-10-02", 80)];
    }),
    fetchStoredCampaigns: vi.fn(async () => {
      if (state.failCampaigns) throw new Error("bigquery fora do ar");
      return [
        { id: "c1", name: "Campanha Grande", status: "ACTIVE", spend: 150, impressions: 10000, clicks: 300, leads: 5, purchases: 3, revenue: 600 },
        { id: "c2", name: "Campanha Pequena", status: "PAUSED", spend: 50, impressions: 4000, clicks: 80, leads: 0, purchases: 0, revenue: 0 },
      ];
    }),
    fetchStoredAds: vi.fn(async () => {
      if (state.failAds) throw new Error("bigquery fora do ar");
      return [
        { id: "a1", name: "Vídeo verão", status: "ACTIVE", thumbnailUrl: "https://img/a1.jpg", spend: 120, impressions: 8000, clicks: 240, leads: 4, purchases: 2, revenue: 400 },
        { id: "a2", name: "Carrossel inverno", status: "PAUSED", thumbnailUrl: null, spend: 80, impressions: 6000, clicks: 140, leads: 1, purchases: 1, revenue: 200 },
      ];
    }),
  };
});

import { getDailyReport, getMarketing } from "../src/controllers/vestiDashboardController";
import { MediaReadError, fetchMetaMarketingData, upsertMetaCreatives } from "../src/services/meta-ads";

const app = express();
app.get("/marketing", getMarketing);
app.get("/daily-report", getDailyReport);
app.use((error: unknown, _req: any, res: any, _next: any) => {
  if (error instanceof MediaReadError) return res.status(503).json({ code: error.code });
  console.error(error);
  res.status(500).json({ error: String(error) });
});

const query = "clientId=c&dateFrom=2026-10-01&dateTo=2026-10-18&creativesPage=1&creativesPageSize=20";
const get = (path: string, extra = "") => request(app).get(`/${path}?${query}${extra}`);

beforeEach(() => {
  state.account = "act_111";
  state.failCurrent = state.failPrevious = state.failCampaigns = state.failAds = false;
  state.dailyCalls = [];
  vi.mocked(fetchMetaMarketingData).mockClear();
  vi.mocked(upsertMetaCreatives).mockReset();
  vi.mocked(upsertMetaCreatives).mockResolvedValue(undefined);
});

describe("Marketing Vesti com dado guardado", () => {
  it("gasto, série diária, anúncios, imagens e top criativos vêm do guardado, sem chamar o Meta ao vivo", async () => {
    const res = await get("marketing");
    expect(res.status, res.text).toBe(200);
    expect(res.body.kpis.totalSpend).toBe(200);
    expect(res.body.prevKpis.totalSpend).toBe(50);
    expect(res.body.spendOverTime).toEqual([
      { date: "2026-10-01", value: 120 },
      { date: "2026-10-02", value: 80 },
    ]);
    expect(res.body.creativesTotal).toBe(2);
    expect(res.body.creatives.map((c: any) => [c.id, c.name, c.imageUrl, c.status])).toEqual([
      ["a1", "Vídeo verão", "https://img/a1.jpg", "ACTIVE"],
      ["a2", "Carrossel inverno", null, "PAUSED"],
    ]);
    expect(res.body.topCreatives.ctr[0]).toMatchObject({ id: "a1", imageUrl: "https://img/a1.jpg" });
    expect(res.body.topCreatives.leads.map((c: any) => c.id)).toEqual(["a1", "a2"]);
    expect(fetchMetaMarketingData).not.toHaveBeenCalled();
  });

  it("filtro de nome e paginação continuam valendo", async () => {
    const filtered = await get("marketing", "&utmSource=inverno");
    expect(filtered.status, filtered.text).toBe(200);
    expect(filtered.body.creatives.map((c: any) => c.id)).toEqual(["a2"]);
    expect(filtered.body.creativesTotal).toBe(1);
    const page2 = await request(app).get("/marketing?clientId=c&dateFrom=2026-10-01&dateTo=2026-10-18&creativesPage=2&creativesPageSize=1");
    expect(page2.status, page2.text).toBe(200);
    expect(page2.body.creatives.map((c: any) => c.id)).toEqual(["a2"]);
    expect(page2.body.creativesTotal).toBe(2);
  });

  it("mantém a tabela de criativos do Postgres atualizada a partir do guardado", async () => {
    await get("marketing");
    expect(upsertMetaCreatives).toHaveBeenCalledTimes(1);
    const [clientId, ads] = vi.mocked(upsertMetaCreatives).mock.calls[0];
    expect(clientId).toBe("c");
    expect(ads.map((a) => [a.id, a.spend, a.dateStart, a.dateStop])).toEqual([
      ["a1", 120, "2026-10-01", "2026-10-18"],
      ["a2", 80, "2026-10-01", "2026-10-18"],
    ]);
  });

  it("falha ao gravar o cache de criativos não derruba a tela", async () => {
    vi.mocked(upsertMetaCreatives).mockRejectedValue(new Error("banco indisponível"));
    const res = await get("marketing");
    expect(res.status, res.text).toBe(200);
  });

  it("falha de leitura do período atual: 503, nunca zero", async () => {
    state.failCurrent = true;
    const res = await get("marketing");
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("MEDIA_UNAVAILABLE");
    expect(res.body.kpis).toBeUndefined();
  });

  it("falha de leitura dos anúncios: 503", async () => {
    state.failAds = true;
    const res = await get("marketing");
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("MEDIA_UNAVAILABLE");
  });

  it("falha só do período anterior: dados atuais ficam, comparação vazia", async () => {
    state.failPrevious = true;
    const res = await get("marketing");
    expect(res.status, res.text).toBe(200);
    expect(res.body.kpis.totalSpend).toBe(200);
    expect(res.body.prevKpis).toBeNull();
  });

  it("cliente sem conta de anúncio: tela carrega vazia, sem consultar o BigQuery", async () => {
    state.account = null;
    const res = await get("marketing");
    expect(res.status, res.text).toBe(200);
    expect(res.body.kpis.totalSpend).toBe(0);
    expect(res.body.creatives).toEqual([]);
    expect(res.body.topCreatives).toEqual({ ctr: [], cpl: [], leads: [] });
    expect(res.body.spendOverTime).toEqual([]);
    expect(state.dailyCalls).toEqual([]);
    expect(upsertMetaCreatives).not.toHaveBeenCalled();
  });
});

describe("Relatório diário Vesti com dado guardado", () => {
  it("campanhas e investimento vêm do guardado, com ROAS e custo por compra calculados", async () => {
    const res = await get("daily-report");
    expect(res.status, res.text).toBe(200);
    expect(res.body.kpis.mediaSpend).toBe(200);
    expect(res.body.prevKpis.mediaSpend).toBe(50);
    expect(res.body.campaigns.map((c: any) => [c.id, c.name, c.spend, c.roas, c.cpa])).toEqual([
      ["c1", "Campanha Grande", 150, 4, 50],
      ["c2", "Campanha Pequena", 50, 0, 0],
    ]);
    expect(fetchMetaMarketingData).not.toHaveBeenCalled();
  });

  it("falha de leitura das campanhas ou do gasto atual: 503", async () => {
    state.failCampaigns = true;
    expect((await get("daily-report")).status).toBe(503);
    state.failCampaigns = false;
    state.failCurrent = true;
    const res = await get("daily-report");
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("MEDIA_UNAVAILABLE");
  });

  it("falha só do período anterior: relatório sai com comparação vazia", async () => {
    state.failPrevious = true;
    const res = await get("daily-report");
    expect(res.status, res.text).toBe(200);
    expect(res.body.prevKpis).toBeNull();
    expect(res.body.changes.mediaSpend).toBeNull();
  });

  it("cliente sem conta de anúncio: relatório sai com investimento 0 e sem campanhas", async () => {
    state.account = null;
    const res = await get("daily-report");
    expect(res.status, res.text).toBe(200);
    expect(res.body.kpis.mediaSpend).toBe(0);
    expect(res.body.campaigns).toEqual([]);
  });
});
