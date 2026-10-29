import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", async () => ({
  ...(await import("@workspace/db/schema")),
  db: {},
}));
vi.mock("../src/services/vesti-ads-stored", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/services/vesti-ads-stored")>()),
  fetchStoredAdsDaily: vi.fn(),
  fetchStoredCampaigns: vi.fn(),
  fetchStoredAds: vi.fn(),
}));

import { MediaReadError } from "../src/services/meta-ads";
import { fetchStoredAds, fetchStoredAdsDaily, fetchStoredCampaigns } from "../src/services/vesti-ads-stored";
import { fetchStoredMarketingData } from "../src/services/stored-marketing";
import { fetchMetaMarketingDataIfConnected } from "../src/services/meta-connected";

// UpZero e Nuvemshop leem anúncios do dado guardado (BigQuery), não do Meta ao vivo (27/10/2026: app bloqueado no limite do Meta).
// Manual continua ao vivo, por causa de alcance/frequência do período (branch codex/fix-b2c-meta-manual do Victor).

const daily = vi.mocked(fetchStoredAdsDaily);
const campaigns = vi.mocked(fetchStoredCampaigns);
const ads = vi.mocked(fetchStoredAds);

const day = (date: string, spend: number, leads = 0, purchases = 0) => ({ date, spend, impressions: 1000, clicks: 50, leads, purchases, purchaseValue: 0 });
const campaign = { id: "c1", name: "Campanha", status: "ACTIVE", spend: 30, impressions: 2000, clicks: 100, leads: 3, purchases: 1, revenue: 90 };
const ad = { ...campaign, id: "a1", name: "Anúncio", thumbnailUrl: "https://img/1.jpg" };

let n = 0;
let range: { since: string; until: string };
beforeEach(() => {
  vi.clearAllMocks();
  n += 1; // a leitura tem cache: cada teste usa um período diferente
  range = { since: `2026-01-${String(n).padStart(2, "0")}`, until: `2026-02-${String(n).padStart(2, "0")}` };
});

describe("leitura guardada de anúncios (UpZero, Nuvemshop, Manual)", () => {
  it("sem conta de anúncio devolve dado vazio e nem consulta o BigQuery", async () => {
    const data = await fetchStoredMarketingData({ adAccountId: "", ...range });
    expect(data.summary.spend).toBe(0);
    expect(data.daily).toEqual([]);
    expect(daily).not.toHaveBeenCalled();
    expect(campaigns).not.toHaveBeenCalled();
  });

  it("devolve o mesmo formato do Meta: dias, resumo, custo por lead e campanhas", async () => {
    daily.mockResolvedValue([day("2026-01-10", 10, 2, 1), day("2026-01-11", 20, 0, 0)]);
    campaigns.mockResolvedValue([campaign]);
    const data = await fetchStoredMarketingData({ adAccountId: "act_1", ...range });
    expect(data.daily.map((d) => d.date)).toEqual(["2026-01-10", "2026-01-11"]);
    expect(data.daily[0].cpl).toBe(5);
    expect(data.daily[1].cpl).toBeNull();
    expect(data.summary).toMatchObject({ spend: 30, impressions: 2000, clicks: 100, leads: 2, purchases: 1, cpl: 15 });
    expect(data.campaigns).toHaveLength(1);
    expect(data.campaigns[0]).toMatchObject({ id: "c1", spend: 30, roas: 3, cpa: 30 });
  });

  it("anúncios e melhores criativos só vêm quando pedidos (tela de Marketing, Escala, rotina de criativos)", async () => {
    daily.mockResolvedValue([day("2026-01-10", 10)]);
    campaigns.mockResolvedValue([]);
    ads.mockResolvedValue([ad]);
    const base = await fetchStoredMarketingData({ adAccountId: "act_1", ...range });
    expect(base.ads).toEqual([]);
    expect(ads).not.toHaveBeenCalled();
    const full = await fetchStoredMarketingData({ adAccountId: "act_1", ...range, includeAds: true });
    expect(full.ads).toHaveLength(1);
    expect(full.topCreatives.ctr[0]).toMatchObject({ id: "a1", thumbnailUrl: "https://img/1.jpg" });
  });

  it("falha do BigQuery vira erro 503 (MediaReadError), nunca gasto zero", async () => {
    daily.mockRejectedValue(new Error("boom"));
    campaigns.mockResolvedValue([]);
    await expect(fetchStoredMarketingData({ adAccountId: "act_1", ...range })).rejects.toBeInstanceOf(MediaReadError);
  });

  it("a função central lê do guardado só com a conta, sem token do Meta", async () => {
    daily.mockResolvedValue([day("2026-01-10", 12)]);
    campaigns.mockResolvedValue([]);
    const data = await fetchMetaMarketingDataIfConnected({ accessToken: null, adAccountId: "act_1", ...range });
    expect(data.summary.spend).toBe(12);
  });

  it("sem conta cadastrada a função central devolve vazio; filtro por campanha sem token do Meta também", async () => {
    expect((await fetchMetaMarketingDataIfConnected({ accessToken: "t", adAccountId: null, ...range })).summary.spend).toBe(0);
    const filtered = await fetchMetaMarketingDataIfConnected({ accessToken: null, adAccountId: "act_1", ...range, campaignName: "x" });
    expect(filtered.summary.spend).toBe(0);
    expect(daily).not.toHaveBeenCalled();
  });

  it("cliente MANUAL continua no Meta ao vivo (alcance/frequência do período): sem token vem vazio e o dado guardado nem é lido", async () => {
    const manual = await fetchMetaMarketingDataIfConnected({ accessToken: null, adAccountId: "act_1", commercePlatform: "MANUAL", ...range });
    expect(manual.summary.spend).toBe(0);
    expect(daily).not.toHaveBeenCalled();
    expect(campaigns).not.toHaveBeenCalled();
  });

  it("UpZero e Nuvemshop seguem lendo do dado guardado", async () => {
    daily.mockResolvedValue([day("2026-01-10", 12)]);
    campaigns.mockResolvedValue([]);
    for (const commercePlatform of ["UPZERO", "NUVEMSHOP", null]) {
      const data = await fetchMetaMarketingDataIfConnected({ accessToken: null, adAccountId: "act_1", commercePlatform, ...range });
      expect(data.summary.spend).toBe(12);
    }
  });
});
