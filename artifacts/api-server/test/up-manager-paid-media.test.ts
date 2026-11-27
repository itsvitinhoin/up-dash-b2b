import { expect, it } from "vitest";
import { buildPaidMediaReview, resolveMediaActions, verifiedRecentPause } from "../src/services/up-manager-paid-media";
import { combinePaidMediaChanges, evaluatePaidMediaChanges } from "../src/services/up-manager-media-learning";
import type { MetaAdMetric, MetaMarketingData } from "../src/services/meta-ads";

function ad(id: string, campaignId: string, adsetId: string, spend: number, revenue: number, purchases: number, objective = "OUTCOME_SALES"): MetaAdMetric {
  return {
    id, name: id, campaignId, campaignName: campaignId, adsetId, adsetName: adsetId, objective,
    spend, revenue, purchases, clicks: 50, impressions: 1000, leads: 0, roas: revenue / spend,
    cpl: null, cpa: null, dateStart: "2026-11-14", dateStop: "2026-11-20",
  };
}

function data(ads: MetaAdMetric[]) {
  return { ads, campaigns: [] } as unknown as MetaMarketingData;
}

const args = {
  snapshot: null,
  currency: "BRL",
  window: { dateFrom: "2026-11-14", dateTo: "2026-11-20" },
  previousWindow: { dateFrom: "2026-11-07", dateTo: "2026-11-13" },
};

it("compara anúncio com pares ponderados do seu conjunto e exclui tráfego da referência de vendas", () => {
  const rows = [
    ad("11", "1", "20", 400, 400, 4),
    ad("12", "1", "20", 100, 600, 5),
    ad("13", "1", "20", 300, 600, 7),
    ad("14", "2", "21", 300, 900, 8),
    ad("15", "3", "23", 9900, 0, 0, "LINK_CLICKS"),
  ];
  const review = buildPaidMediaReview({ ...args, current: data(rows), previous: data(rows) });
  expect(review.reference).toBe(2500 / 1100);
  expect(review.rows.find(({ id }) => id === "15")).toBeUndefined();
  expect(review.rows.find(({ id }) => id === "11")).toMatchObject({ below: true, signal: "monitor", benchmark: { label: "Outros anúncios do conjunto", roas: 3 } });
});

it("usa janelas sem sobreposição para apurar uma alteração e mantém mudanças recentes em maturação", () => {
  const base = [ad("11", "1", "20", 200, 400, 5), ad("15", "2", "23", 300, 750, 5)];
  const better = [ad("11", "1", "20", 200, 600, 6), ad("15", "2", "23", 300, 750, 5)];
  const before = buildPaidMediaReview({ ...args, current: data(base), previous: null, window: { dateFrom: "2026-11-05", dateTo: "2026-11-11" } });
  const after = buildPaidMediaReview({ ...args, current: data(better), previous: data(base) });
  const event = { id: "11", level: "ad" as const, changedAt: "2026-11-12T14:30:00Z", day: "2026-11-12", title: "Alteração de criativo", name: "Anúncio" };
  const result = evaluatePaidMediaChanges([event, { ...event, id: "15", day: "2026-11-19" }], after, [before]);
  expect(result.lessons[0]).toMatchObject({ status: "improved", before: { roas: 2 }, after: { roas: 3 } });
  expect(result.lessons[1].status).toBe("maturing");
});

it("preserva alterações confirmadas quando a nova leitura da Meta está indisponível", () => {
  const event = { id: "11", level: "ad" as const, changedAt: "2026-11-20T14:30:00Z", day: "2026-11-20", title: "Alteração de criativo", name: "Anúncio" };
  expect(combinePaidMediaChanges(null, [event], "2026-11-23")).toEqual({ source: "history", events: [event] });
  expect(combinePaidMediaChanges({ partial: true, events: [event] }, [event], "2026-11-23")).toEqual({ source: "partial", events: [event] });
});

it("recomenda pausa em dois dias de gasto sem retorno quando o item já está abaixo das referências", () => {
  const historical = [
    ad("11", "1", "20", 350, 250, 3),
    ad("12", "2", "21", 300, 1500, 10),
  ];
  const recent = [ad("11", "1", "20", 85, 0, 0), ad("12", "2", "21", 200, 1000, 8)];
  const week = buildPaidMediaReview({ ...args, current: data(historical), previous: data(historical) });
  const check = buildPaidMediaReview({ ...args, current: data(recent), previous: null });
  const row = week.rows.find(({ id }) => id === "11");
  const recentRow = check.rows.find(({ id }) => id === "11");
  expect(verifiedRecentPause(row, recentRow, week.reference)).toBe(true);
  expect(verifiedRecentPause(row, { ...recentRow!, spending: { ...recentRow!.spending, spend: 40 } }, week.reference)).toBe(false);
  expect(verifiedRecentPause(row, undefined, week.reference)).toBe(false);
});

it("considera pausa com compras quando o ROAS está materialmente abaixo das referências nos dois recortes", () => {
  const historical = [ad("11", "1", "20", 300, 300, 3), ad("12", "2", "21", 300, 1800, 10)];
  const recent = [ad("11", "1", "20", 90, 90, 1), ad("12", "2", "21", 130, 780, 5)];
  const week = buildPaidMediaReview({ ...args, current: data(historical), previous: data(historical) });
  const check = buildPaidMediaReview({ ...args, current: data(recent), previous: null });
  expect(verifiedRecentPause(week.rows.find(({ id }) => id === "11"), check.rows.find(({ id }) => id === "11"), week.reference)).toBe(true);
});

it("preserva anúncios saudáveis ao avaliar pausa de campanha e evita ações duplicadas", () => {
  const history = [
    ad("11", "1", "20", 300, 200, 2),
    ad("13", "1", "21", 95, 950, 4),
    ad("12", "2", "22", 300, 1200, 10),
  ];
  const week = buildPaidMediaReview({ ...args, current: data(history), previous: data(history) });
  const campaign = week.rows.find(({ id }) => id === "1")!;
  const weak = week.rows.find(({ id }) => id === "11")!;
  const strong = week.rows.find(({ id }) => id === "13")!;
  const paused = resolveMediaActions([
    { ...campaign, status: "active", recommendation: "pause", pauseReason: "performance" },
    { ...weak, status: "active", recommendation: "pause", pauseReason: "performance" },
    { ...strong, status: "active", recommendation: "maintain" },
  ]);
  expect(paused.map(({ recommendation }) => recommendation)).toEqual(["monitor", "pause", "maintain"]);
  expect(resolveMediaActions([
    { ...campaign, status: "active", recommendation: "pause", pauseReason: "stock" },
    { ...weak, status: "active", recommendation: "pause", pauseReason: "performance" },
    { ...strong, status: "active", recommendation: "scale" },
  ]).map(({ recommendation }) => recommendation)).toEqual(["pause", "monitor", "monitor"]);
});
