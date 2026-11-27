import { expect, it } from "vitest";
import { auctionReferencePeriods, evaluateAuction } from "../src/services/up-manager-auction";
import { campaignPeriod } from "../src/services/up-manager-campaign-evaluation";
import type { MediaMetrics, PaidMediaReview, PaidMediaRow } from "../src/services/up-manager-paid-media";

it("compara o pré-Black pelo mesmo número de dias antes da data comercial", () => {
  const periods = auctionReferencePeriods("2026-11-23");
  expect(periods).toEqual({ event: { name: "Black Friday", date: "2026-11-27" },
    recentReference: { dateFrom: "2026-11-14", dateTo: "2026-11-16" }, baseline: { dateFrom: "2026-10-20", dateTo: "2026-10-26" },
    previousYear: { dateFrom: "2025-11-18", dateTo: "2025-11-24" } });
  expect(auctionReferencePeriods("2024-11-25").event?.date).toEqual("2024-11-29");
});

it("atribui a maior contribuição da reação do Helena à compra por clique apesar do CPM maior", () => {
  const entity = { id: "1", level: "adset" } as PaidMediaRow;
  const window = (end: string, days: number, spending: MediaMetrics) => ({
    window: campaignPeriod(end, days), rows: [{ ...entity, spending }],
  }) as PaidMediaReview;
  const latest = window("2026-11-23", 3, { spend: 328.37, impressions: 10531, clicks: 391, purchases: 6, revenue: 1334.33, missingValue: 0 });
  const seven = window("2026-11-23", 7, { spend: 761.6, impressions: 23732, clicks: 854, purchases: 6, revenue: 1334.33, missingValue: 0 });
  const prior = window("2026-11-16", 3, { spend: 318.13, impressions: 10958, clicks: 326, purchases: 3, revenue: 577.83, missingValue: 0 });
  const evaluation = evaluateAuction(entity, { 3: latest, 7: seven, 14: seven, 30: seven }, prior)!;
  expect(evaluation.trend).toBe("recovery");
  expect(evaluation.current.cpm).toBeCloseTo(31.18);
  expect(evaluation.before?.cpm).toBeCloseTo(29.03);
  expect(evaluation.preceding?.purchases).toEqual(0);
  expect(evaluation.summary).toContain("maior contribuição veio de compras por clique");
});

it("separa custo de entrega e perda após o clique em janelas comparáveis", async () => {
  const { auctionPoint, leadingRoasDriver } = await import("../src/services/up-manager-auction");
  const base = { spend: 100, impressions: 10000, clicks: 100, purchases: 5, revenue: 1000 };
  const week = campaignPeriod("2026-11-25", 7);
  const before = auctionPoint(base, week);
  expect(leadingRoasDriver(before, auctionPoint({ ...base, spend: 200 }, week), "decline")?.key).toBe("cpm");
  expect(leadingRoasDriver(before, auctionPoint({ ...base, spend: 80, purchases: 0, revenue: 0 }, week), "decline")?.key).toBe("purchaseRate");
  expect(leadingRoasDriver(before, auctionPoint({ ...base, revenue: 300 }, week), "decline")?.key).toBe("ticket");
});
