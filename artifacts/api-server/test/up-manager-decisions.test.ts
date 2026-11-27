import { describe, expect, it } from "vitest";
import { decideManagerCampaigns } from "../src/services/up-manager-campaign-decisions";
import type { CampaignSnapshot } from "../src/services/product-campaign-monitor";
import type { MetaAdMetric, MetaMarketingData } from "../src/services/meta-ads";
import type { CampaignAd } from "../src/services/product-campaign-analysis";

const ad: CampaignAd = {
  id: "777",
  name: "Anúncio",
  campaignId: "123",
  campaignName: "Campanha",
  adsetName: "Conjunto",
  effectiveStatus: "ACTIVE",
  urls: [],
  catalog: false,
  reviewableDestination: true,
  imageUrl: null,
  spend: 10,
  impressions: 500,
};

function media(
  spend: number,
  purchases: number,
  previous = false,
): MetaMarketingData {
  const row: MetaAdMetric = {
    id: "123",
    name: "Campanha",
    status: "ACTIVE",
    spend,
    purchases,
    revenue: 900,
    impressions: 500,
    clicks: 30,
    leads: 0,
    roas: 3,
    cpl: null,
    cpa: null,
    dateStart: "2026-11-14",
    dateStop: "2026-11-20",
  };
  return {
    daily: [],
    ads: [],
    campaigns: [row],
    topCreatives: { ctr: [], cpl: [], leads: [] },
    summary: {
      spend: previous ? 1000 : spend,
      purchases: previous ? 20 : purchases,
      revenue: 900,
      impressions: 500,
      clicks: 30,
      leads: 0,
      reach: null,
      frequency: null,
      ctr: null,
      cpc: null,
      cpm: null,
      roas: 3,
      cpa: null,
      cpl: null,
    },
  };
}

function snapshot(): CampaignSnapshot {
  return {
    version: 1,
    accountId: "88",
    storeId: "99",
    adsObservedAt: "2026-11-23T12:00:00Z",
    stockObservedAt: "2026-11-23T12:00:00Z",
    currency: "BRL",
    timeZone: "America/Sao_Paulo",
    window: { since: "2026-11-16", until: "2026-11-22" },
    warnings: [],
    unidentified: [],
    totalAds: 1,
    identifiedAds: 1,
    spend: 10,
    riskSpend: 0,
    rows: [
      {
        id: "12",
        productId: "12",
        name: "Vestido",
        color: "Azul",
        scope: "selected_color",
        imageUrl: null,
        productUrl: "https://loja.example/produto/vestido",
        grade: "complete",
        unavailable: false,
        publicationConfirmed: true,
        availableVariants: 2,
        variantCount: 2,
        missingVariants: [],
        stock: 10,
        ads: [ad],
      },
    ],
  };
}

const window = { dateFrom: "2026-11-14", dateTo: "2026-11-20" };
const plan = (
  observed: CampaignSnapshot,
  present = media(300, 10),
  prior = media(280, 8, true),
) =>
  decideManagerCampaigns({
    media: present,
    previousMedia: prior,
    currency: "BRL",
    window,
    monitor: { snapshot: observed, stale: false },
  });

describe("decisão de mídia baseada em duas janelas", () => {
  it("só libera teste de escala quando CPA, volume e todos os destinos sustentam o aumento", () => {
    expect(plan(snapshot()).decisions[0]).toMatchObject({
      decision: "scale",
      cpa: 30,
      priorCpa: 35,
    });
    const unknownPublication = snapshot();
    unknownPublication.rows[0].publicationConfirmed = undefined;
    expect(plan(unknownPublication).decisions[0].decision).toBe("hold");
    const partial = snapshot();
    partial.unidentified.push({ ad, reason: "Segundo destino não confirmado" });
    expect(plan(partial).decisions[0]).toMatchObject({
      decision: "hold",
      unverifiedAds: 1,
    });
  });

  it("sugere pausa por falta de conversões em ambas as janelas, usando referência da conta", () => {
    expect(
      plan(snapshot(), media(600, 0), media(200, 0, true)).decisions[0]
        .decision,
    ).toBe("pause");
    expect(
      plan(snapshot(), media(600, 0), media(200, 8, true)).decisions[0]
        .decision,
    ).toBe("hold");
  });

  it("separa a pausa de anúncio esgotado da campanha que tem outro anúncio com grade completa", () => {
    const mixed = snapshot();
    mixed.rows.push({
      ...mixed.rows[0],
      id: "13",
      productId: "13",
      grade: "out_of_stock",
      availableVariants: 0,
      stock: 0,
      missingVariants: ["M"],
      ads: [{ ...ad, id: "888" }],
    });
    const result = plan(mixed);
    expect(result.decisions[0].decision).toBe("hold");
    expect(result.findings.some((item) => item.id === "ad-decision:888")).toBe(
      true,
    );
  });
});

it("transforma pedido pendente confirmado em tarefa sem inventar etapas quando o GA4 falta", async () => {
  const { evaluateManagerFunnel } =
    await import("../src/services/up-manager-growth-decisions");
  const orders = {
    created: 19,
    approved: 17,
    pending: 2,
    rejected: 0,
    refunds: 0,
    unverifiedRefunds: 0,
    discount: 0,
    shipping: 0,
    newRevenue: 100,
    returningRevenue: 100,
    reactivatedBuyers: 0,
  };
  const report = evaluateManagerFunnel(
    { current: null, previous: null, channels: null, products: null },
    orders,
    orders,
    true,
  );
  expect(report.rates).toHaveLength(0);
  expect(report.finding).toMatchObject({
    focus: "funnel",
    title: "Recuperar 2 pedidos em aberto",
  });
});
