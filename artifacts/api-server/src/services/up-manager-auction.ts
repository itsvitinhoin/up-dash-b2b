import { addDaysToDateOnly } from "../lib/reporting-period";
import { campaignPeriod, comparePaidWeeks, type buildCampaignWindows } from "./up-manager-campaign-evaluation";
import type { MetaMarketingData } from "./meta-ads";
import type { MediaMetrics, PaidMediaReview, PaidMediaRow } from "./up-manager-paid-media";
import type { ManagerPeriod } from "./up-manager";

type Metrics = Pick<MediaMetrics, "spend" | "impressions" | "clicks" | "purchases" | "revenue">;
export type AuctionPoint = { period: ManagerPeriod; spend: number; purchases: number; cpm: number | null; ctr: number | null;
  cpc: number | null; purchaseRate: number | null; ticket: number | null; roas: number | null };
export type AuctionEvaluation = { before: AuctionPoint | null; preceding: AuctionPoint | null; current: AuctionPoint;
  trend: "recovery" | "decline" | "stable"; summary: string | null; detail: string | null };
export type AuctionSeasonality = { event: { name: string; date: string } | null; current: AuctionPoint | null; baseline: AuctionPoint | null;
  previousYear: AuctionPoint | null; previousYearPeriod: ManagerPeriod; cpmChange: number | null };

const ratio = (value: number, base: number) => base > 0 ? value / base : null;
export function auctionPoint(value: Metrics, period: ManagerPeriod, missingValue = false): AuctionPoint {
  return { period, spend: value.spend, purchases: value.purchases, cpm: ratio(value.spend * 1000, value.impressions ?? 0),
    ctr: ratio(value.clicks, value.impressions ?? 0), cpc: ratio(value.spend, value.clicks), purchaseRate: ratio(value.purchases, value.clicks),
    ticket: missingValue ? null : ratio(value.revenue, value.purchases), roas: missingValue ? null : ratio(value.revenue, value.spend) };
}

const dateKey = (value: Date) => value.toISOString().slice(0, 10);
const nthWeekday = (year: number, month: number, weekday: number, occurrence: number) => {
  const first = new Date(Date.UTC(year, month, 1));
  return dateKey(new Date(Date.UTC(year, month, 1 + (weekday - first.getUTCDay() + 7) % 7 + (occurrence - 1) * 7)));
};
const calendar = [
  { name: "Dia das Mães", date: (year: number) => nthWeekday(year, 4, 0, 2), lead: 10, after: 2 },
  { name: "Black Friday", date: (year: number) => addDaysToDateOnly(nthWeekday(year, 10, 4, 4), 1), lead: 14, after: 3 },
  { name: "Natal", date: (year: number) => `${year}-12-25`, lead: 14, after: 2 },
];

export function auctionReferencePeriods(end: string) {
  const year = Number(end.slice(0, 4));
  const event = calendar.find((item) => end >= addDaysToDateOnly(item.date(year), -item.lead) && end <= addDaysToDateOnly(item.date(year), item.after));
  const offset = event ? Math.round((Date.parse(end) - Date.parse(event.date(year))) / 86_400_000) : 0;
  return { event: event ? { name: event.name, date: event.date(year) } : null,
    recentReference: campaignPeriod(addDaysToDateOnly(end, -7), 3),
    baseline: campaignPeriod(addDaysToDateOnly(end, -28), 7),
    previousYear: campaignPeriod(event ? addDaysToDateOnly(event.date(year - 1), offset) : addDaysToDateOnly(end, -364), 7) };
}

function accountPoint(data: MetaMarketingData | null, period: ManagerPeriod) {
  if (!data?.daily.length || new Set(data.daily.map(({ date }) => date)).size !== 7 || data.summary.spend <= 0) return null;
  return auctionPoint(data.summary, period, data.daily.some(({ purchases, revenue }) => purchases > 0 && revenue <= 0));
}

export function buildAuctionSeasonality(current: MetaMarketingData | null, baseline: MetaMarketingData | null,
  previousYear: MetaMarketingData | null, end: string): AuctionSeasonality {
  const dates = auctionReferencePeriods(end);
  const recent = accountPoint(current, campaignPeriod(end, 7));
  const prior = accountPoint(baseline, dates.baseline);
  return { event: dates.event, current: recent, baseline: prior,
    previousYear: accountPoint(previousYear, dates.previousYear), previousYearPeriod: dates.previousYear,
    cpmChange: recent?.cpm != null && prior?.cpm != null && prior.cpm > 0 ? recent.cpm / prior.cpm - 1 : null };
}

const pct = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 2 });
const label = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const showRoas = (value: number) => `${label.format(value)}×`;

export function leadingRoasDriver(before: AuctionPoint, current: AuctionPoint, direction: "decline" | "recovery") {
  if (before.purchaseRate !== null && current.purchaseRate !== null &&
    (direction === "decline" ? before.purchaseRate > 0 && current.purchaseRate === 0 :
      before.purchaseRate === 0 && current.purchaseRate > 0)) {
    return { key: "purchaseRate" as const, name: "compras por clique", before: before.purchaseRate, current: current.purchaseRate };
  }
  return ([
    { key: "cpm", name: "custo de entrega (CPM)", sign: -1 },
    { key: "ctr", name: "taxa de clique (CTR)", sign: 1 },
    { key: "purchaseRate", name: "compras por clique", sign: 1 },
    { key: "ticket", name: "valor por compra", sign: 1 },
  ] as const).flatMap(({ key, name, sign }) => {
    const a = before[key];
    const b = current[key];
    if (a === null || b === null || a <= 0 || b <= 0) return [];
    const change = Math.log(b / a) * sign;
    return (direction === "decline" ? change < 0 : change > 0) ? [{ key, name, before: a, current: b, change }] : [];
  }).sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0] ?? null;
}

export function evaluateAuction(row: PaidMediaRow, reviews: ReturnType<typeof buildCampaignWindows>, reference: PaidMediaReview): AuctionEvaluation | undefined {
  const spending = (review: PaidMediaReview) => review.rows.find(({ level, id }) => row.level === level && row.id === id)?.spending;
  const latest = spending(reviews[3]);
  if (!latest || latest.spend <= 0) return undefined;
  const current = auctionPoint(latest, reviews[3].window, Boolean(latest.missingValue));
  const prior = spending(reference);
  const before = prior && prior.spend > 0 ? auctionPoint(prior, reference.window, Boolean(prior.missingValue)) : null;
  const earlier = comparePaidWeeks(spending(reviews[7]), latest)?.previous;
  const preceding = earlier ? auctionPoint(earlier, { dateFrom: reviews[7].window.dateFrom,
    dateTo: addDaysToDateOnly(current.period.dateFrom, -1) }) : null;
  const comparable = before?.roas != null && before.roas > 0 ? before : preceding;
  const recovery = current.roas !== null && current.purchases >= 3 && comparable?.roas != null && current.roas > comparable.roas * 1.25 &&
    (latest.clicks >= 30 || (latest.impressions ?? 0) >= 1_000);
  const decline = current.roas !== null && comparable?.roas != null && comparable.purchases >= 3 && current.roas <= comparable.roas * 0.75 && latest.clicks >= 30;
  if ((!recovery && !decline) || !comparable) return { before, preceding, current, trend: "stable", summary: null, detail: null };
  const improved = Boolean(recovery);
  const effect = leadingRoasDriver(comparable, current, improved ? "recovery" : "decline");
  const source = comparable === before ? "nos mesmos dias da semana anterior" : "no trecho anterior da última semana";
  const summary = `ROAS ${showRoas(comparable.roas!)} → ${showRoas(current.roas!)} ${source}. ${effect ? `A maior contribuição veio de ${effect.name}.` : "A variação precisa de mais volume para ser explicada."}`;
  const detail = comparable.purchaseRate != null && current.purchaseRate != null
    ? `Compras por clique ${pct.format(comparable.purchaseRate)} → ${pct.format(current.purchaseRate)}. A leitura recente reúne ${current.purchases} compras atribuídas.` : null;
  return { before, preceding, current, trend: improved ? "recovery" : "decline", summary, detail };
}
