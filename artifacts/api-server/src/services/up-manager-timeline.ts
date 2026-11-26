import { addDaysToDateOnly } from "../lib/reporting-period";
import { emptyMetaMarketingData, type MetaAdMetric } from "./meta-ads";
import { buildPaidMediaReview, type MediaLevel } from "./up-manager-paid-media";
import type { ManagerPeriod } from "./up-manager";

export type EntityDay = {
  date: string;
  level: MediaLevel;
  id: string;
  name: string;
  spend: number;
  purchases: number;
  revenue: number;
  clicks: number;
  impressions: number | null;
  roas: number | null;
};

export function entityDays(ads: MetaAdMetric[], currency: string): EntityDay[] {
  const days = new Map<string, MetaAdMetric[]>();
  for (const ad of ads) {
    if (ad.dateStart !== ad.dateStop || !/^\d{4}-\d{2}-\d{2}$/.test(ad.dateStart)) continue;
    const values = days.get(ad.dateStart) ?? [];
    values.push(ad);
    days.set(ad.dateStart, values);
  }
  return [...days].sort(([a], [b]) => a.localeCompare(b)).flatMap(([date, rows]) => {
    const window: ManagerPeriod = { dateFrom: date, dateTo: date };
    const source = { ...emptyMetaMarketingData(), ads: rows };
    return buildPaidMediaReview({ current: source, previous: null, snapshot: null, currency, window, previousWindow: window })
      .rows.filter(({ id }) => /^\d+$/.test(id))
      .map(({ id, name, roas, level, spending }) => ({
        date, id, name, roas, level, spend: spending.spend, purchases: spending.purchases,
        revenue: spending.revenue, clicks: spending.clicks, impressions: spending.impressions ?? null,
      }));
  });
}

const point = (days: EntityDay[]) => {
  const spend = days.reduce((total, row) => total + row.spend, 0);
  const purchases = days.reduce((total, row) => total + row.purchases, 0);
  const roas = spend > 0 && days.every(({ roas }) => roas !== null) ? days.reduce((total, row) => total + row.revenue, 0) / spend : null;
  return { dateFrom: days[0].date, dateTo: days.at(-1)!.date, spend, purchases, roas };
};

export function firstMediaBreak(days: EntityDay[]) {
  if (new Set(days.map(({ level, id }) => `${level}:${id}`)).size > 1) return null;
  const ordered = [...new Map(days.map((row) => [row.date, row])).values()].sort((a, b) => a.date.localeCompare(b.date));
  for (let index = 7; index <= ordered.length - 3; index++) {
    const before = point(ordered.slice(index - 7, index));
    const after = point(ordered.slice(index, index + 3));
    if (after.dateTo !== addDaysToDateOnly(before.dateFrom, 9) || before.purchases < 5 ||
      before.roas === null || after.roas === null || before.roas <= 0 || before.spend <= 0 ||
      after.spend < before.spend * 0.2 || after.roas > before.roas * 0.75) continue;
    return { firstWeakPeriod: after.dateFrom, evidenceThrough: after.dateTo, before, after };
  }
  return null;
}
