import { describe, expect, it } from "vitest";
import {
  aiLanguageInstruction,
  customersInsight,
  dashboardInsight,
  journeyInsight,
  marketingInsight,
  normalizeInsightLanguage,
  productsInsight,
  rfmInsight,
  sellersInsight,
  stockInsight,
  utmInsight,
  type InsightLanguage,
  type InsightText,
} from "../src/services/insight-text";

describe("normalizeInsightLanguage", () => {
  it("aceita pt, pt-BR, ko e en; qualquer outra coisa (ou nada) fica em inglês, como antes", () => {
    expect(normalizeInsightLanguage("pt")).toBe("pt");
    expect(normalizeInsightLanguage("pt-BR")).toBe("pt");
    expect(normalizeInsightLanguage("KO")).toBe("ko");
    expect(normalizeInsightLanguage("en")).toBe("en");
    expect(normalizeInsightLanguage(undefined)).toBe("en");
    expect(normalizeInsightLanguage("fr")).toBe("en");
    expect(normalizeInsightLanguage(["ko", "pt"])).toBe("ko");
  });
  it("só pede idioma à IA quando não é inglês", () => {
    expect(aiLanguageInstruction("en")).toBe("");
    expect(aiLanguageInstruction("pt")).toContain("Brazilian Portuguese");
    expect(aiLanguageInstruction("ko")).toContain("Korean");
  });
});

// Mesmos números/nomes dos textos originais (routes/analytics.ts antes de 08/10/2026): o inglês NÃO pode mudar.
describe("inglês idêntico ao texto anterior", () => {
  it("dashboard", () => {
    const kpis = { revenue: 55067.64, orders: 13, conversionRate: 2.6, avgTicket: 4235.97, approvalRate: 67.9 };
    const r = dashboardInsight("en", kpis, { category: "Vestido", revenue: 19114 }, { name: "Ana", revenue: 9000 }, -0.744);
    expect(r.headline).toBe("Revenue dipping 74.4% versus the prior window.");
    expect(r.body).toBe("Across the period the catalog generated 13 orders at an average ticket of 4235.97, with a 2.6% visit-to-purchase conversion rate.");
    expect(r.bullets).toEqual(["Top category: Vestido (19114).", "Top seller: Ana (9000).", "Lead approval rate 67.9%."]);
    expect(dashboardInsight("en", kpis, null, null, 0.2).headline).toBe("Revenue trending up 20.0% versus the prior window.");
    expect(dashboardInsight("en", kpis, null, null, 0).headline).toBe("Revenue holding steady at 55068.");
  });
  it("dashboard: sem visitas rastreadas, não diz '0.0% de conversão'", () => {
    const r = dashboardInsight("en", { revenue: 10, orders: 2, conversionRate: 0, avgTicket: 5, approvalRate: 0 }, null, null, 0);
    expect(r.body).toBe("Across the period the catalog generated 2 orders at an average ticket of 5.00.");
    expect(r.body).not.toContain("conversion");
  });
  it("marketing", () => {
    const r = marketingInsight("en", { roas: 1.6154, totalSpend: 2918.66, attributedRevenue: 4714.76, approvedLeads: 12, cpa: 40.2, cpl: 8.4, approvalRate: 67.9 }, -0.888, "META");
    expect(r.headline).toBe("ROAS is down 88.8% vs last period at 1.62×");
    expect(r.body).toBe("You spent R$2919 on paid channels and generated R$4715 in attributed revenue. META is your top-performing platform.");
    expect(r.bullets).toEqual(["12 approved leads at R$40 CPA", "Cost per lead is R$8 — 68% approval rate", "ROAS is declining — review underperforming creatives and adjust bids"]);
  });
  it("produtos (com e sem catálogo)", () => {
    const r = productsInsight("en", { top: { name: "Calça", totalRevenue: 1000.4, totalSold: 7 }, highConv: 3, atRisk: 1, total: 10, vesti: false });
    expect(r.headline).toBe('Top product "Calça" has generated 1000 in lifetime revenue');
    expect(r.body).toBe("3 of 10 products are High Conversion (65%+ sell-through). 1 product are At Risk — never sold or very low turnover.");
    expect(r.bullets[1]).toBe("1 At Risk SKU — these have never sold or have very poor turnover; consider markdown or discontinuation");
    const empty = productsInsight("en", { top: null, highConv: 0, atRisk: 0, total: 0, vesti: true });
    expect(empty.body).toBe("0 of 0 products are High Conversion (65%+ sell-through). No catalog data available for this period.");
    expect(empty.bullets[1]).toBe("Add sales data to unlock product performance insights");
  });
  it("estoque", () => {
    const r = stockInsight("en", { stockout: 2, overstock: 0, sellThrough: "41.2", names: ["A", "B"], totalSold: 30, totalSkus: 12 });
    expect(r.headline).toBe("2 SKUs are at critical stockout risk this week");
    expect(r.body).toBe("In the selected period, 30 units were sold across 12 active SKUs. Sell-through rate stands at 41.2%. 2 products need urgent replenishment.");
    expect(r.bullets).toEqual(["Stockout risk: A, B", "No overstock issues detected", "Current sell-through rate: 41.2% — aim for 60–80% for fashion"]);
  });
  it("utm", () => {
    const r = utmInsight("en", { topRow: { key: "meta", revenue: 500, registrations: 10, conversionPct: 12.34, buyers: 3, roas: 1.5 }, totalRegistrations: 40, sources: 4, approvalPct: 70, conversionPct: 9 });
    expect(r.headline).toBe("meta drives R$500 in revenue this period");
    expect(r.bullets[0]).toBe("Top source: meta — 3 buyers, R$500 revenue, ROAS 1.50x");
  });
});

// Entradas de exemplo para todas as telas, nos 3 idiomas.
function everything(language: InsightLanguage): Record<string, InsightText> {
  const kpis = { revenue: 55067.64, orders: 13, conversionRate: 2.6, avgTicket: 4235.97, approvalRate: 67.9 };
  return {
    dashboard: dashboardInsight(language, kpis, { category: "Vestido", revenue: 19114 }, { name: "Ana", revenue: 9000 }, -0.744),
    marketing: marketingInsight(language, { roas: 1.6, totalSpend: 2918.66, attributedRevenue: 4714.76, approvedLeads: 12, cpa: 40.2, cpl: 8.4, approvalRate: 67.9 }, 0.2, "META"),
    products: productsInsight(language, { top: { name: "Calça", totalRevenue: 1000, totalSold: 7 }, highConv: 3, atRisk: 2, total: 10, vesti: false }),
    productsEmpty: productsInsight(language, { top: null, highConv: 0, atRisk: 0, total: 0, vesti: true }),
    customers: customersInsight(language, { totalRegistrations: 100, approvedRegistrations: 30, approvalRatePct: 30, totalBuyers: 10, customersWithoutPurchase: 40, avgTimeToFirstPurchaseDays: 5 }),
    customersEmpty: customersInsight(language, { totalRegistrations: 0, approvedRegistrations: 0, approvalRatePct: 0, totalBuyers: 0, customersWithoutPurchase: 0, avgTimeToFirstPurchaseDays: null }),
    sellers: sellersInsight(language, [{ name: "Ana", totalRevenue: 600, totalOrders: 6 }, { name: "Bia", totalRevenue: 300, totalOrders: 3 }, { name: "Cris", totalRevenue: 100, totalOrders: 1 }], 1000, 60),
    sellersEmpty: sellersInsight(language, [], 0, 0),
    stock: stockInsight(language, { stockout: 1, overstock: 2, sellThrough: "41.2", names: ["Calça"], totalSold: 30, totalSkus: 12 }),
    stockOk: stockInsight(language, { stockout: 0, overstock: 0, sellThrough: "70.0", names: [], totalSold: 30, totalSkus: 12 }),
    journey: journeyInsight(language, { avgEventsBeforePurchase: 6.2, avgTimeToFirstPurchaseDays: 3.5 }),
    rfm: rfmInsight(language, { champions: { count: 5, revenue: 900 }, atRisk: { count: 3, revenue: 0 }, lost: { count: 2, revenue: 0 }, total: 50 }),
    utm: utmInsight(language, { topRow: { key: "meta", revenue: 500, registrations: 10, conversionPct: 12.3, buyers: 3, roas: 1.5 }, totalRegistrations: 40, sources: 4, approvalPct: 70, conversionPct: 9 }),
  };
}
const allText = (r: InsightText) => [r.headline, r.body, ...r.bullets];
const ENGLISH_WORDS = /\b(the|and|with|your|orders|revenue|customers|consider|period|sellers|units|average|rate|campaigns|products)\b/i;

describe("pt e ko: nada sobra em inglês", () => {
  for (const language of ["pt", "ko"] as const) {
    it(`${language}: nenhuma tela devolve frase em inglês`, () => {
      for (const [screen, result] of Object.entries(everything(language))) {
        for (const line of allText(result)) {
          expect(line.trim().length, `${screen}: linha vazia`).toBeGreaterThan(0);
          expect(ENGLISH_WORDS.test(line), `${language}/${screen}: "${line}"`).toBe(false);
        }
      }
    });
  }
  it("ko usa hangul em toda frase", () => {
    for (const [screen, result] of Object.entries(everything("ko"))) {
      for (const line of allText(result)) expect(/[가-힣]/.test(line), `ko/${screen}: "${line}"`).toBe(true);
    }
  });
  it("pt usa vírgula decimal e o inglês continua com ponto", () => {
    expect(dashboardInsight("pt", { revenue: 1, orders: 1, conversionRate: 1, avgTicket: 4235.97, approvalRate: 0 }, null, null, 0).body).toContain("4.235,97");
    expect(dashboardInsight("en", { revenue: 1, orders: 1, conversionRate: 1, avgTicket: 4235.97, approvalRate: 0 }, null, null, 0).body).toContain("4235.97");
  });
});

describe("português correto", () => {
  it("concorda singular e plural em produtos em risco", () => {
    const one = productsInsight("pt", { top: null, highConv: 0, atRisk: 1, total: 5, vesti: false }).body;
    const many = productsInsight("pt", { top: null, highConv: 0, atRisk: 3, total: 5, vesti: false }).body;
    expect(one).toContain("1 produto em Risco — nunca vendeu ou");
    expect(many).toContain("3 produtos em Risco — nunca venderam ou");
  });
});
