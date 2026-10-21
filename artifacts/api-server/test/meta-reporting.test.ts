import { describe, expect, it } from "vitest";
import {
  aggregateMetaInsights,
  metaReportingWindow,
  spendCents,
  type AdditiveInsight,
} from "../src/services/meta-reporting";
import { coerceDateQuery, queryDateOnly } from "../src/lib/reporting-period";

const row = (
  date: string,
  spend: string,
  hour?: string,
  campaign = "campaign-a",
  ad = "ad-a",
): AdditiveInsight => ({
  ad_id: ad,
  ad_name: ad,
  campaign_id: campaign,
  campaign_name: campaign,
  date_start: date,
  date_stop: date,
  spend,
  impressions: "10",
  clicks: "2",
  actions: [{ action_type: "purchase", value: "1" }],
  action_values: [{ action_type: "purchase", value: "50" }],
  ...(hour
    ? {
        hourly_stats_aggregated_by_advertiser_time_zone: `${hour}:00:00 - ${hour}:59:59`,
      }
    : {}),
});
describe("reporting window and monetary aggregation", () => {
  it("keeps the selected civil day after UTC conversion and includes the complete Brasília day", () => {
    const query = { dateFrom: "2026-10-20", dateTo: "2026-10-20" };
    const parsed = coerceDateQuery(query) as { dateFrom: Date; dateTo: Date };
    expect(parsed.dateFrom.toISOString()).toBe("2026-10-20T03:00:00.000Z");
    expect(parsed.dateTo.toISOString()).toBe("2026-10-21T02:59:59.999Z");
    expect(queryDateOnly(query, "dateTo", parsed.dateTo)).toBe("2026-10-20");
    expect(
      metaReportingWindow(query.dateFrom, query.dateTo, "America/Sao_Paulo")
        .hourly,
    ).toBe(false);
  });
  it("Kalli UTC−2: excludes midnight on 20/10 and includes midnight on 21/10", () => {
    const window = metaReportingWindow(
      "2026-10-20",
      "2026-10-20",
      "America/Noronha",
    );
    expect(window).toMatchObject({
      since: "2026-10-20",
      until: "2026-10-21",
      hourly: true,
    });
    const result = aggregateMetaInsights(
      [
        row("2026-10-20", "999", "00"),
        row("2026-10-20", "10", "01"),
        row("2026-10-21", "20", "00"),
        row("2026-10-21", "999", "01"),
      ],
      "2026-10-20",
      "2026-10-20",
      "America/Noronha",
    );
    expect(result.daily).toHaveLength(1);
    expect(result.daily[0]).toMatchObject({
      date_start: "2026-10-20",
      spend: "30.00",
    });
    expect(result.ads[0].spend).toBe("30.00");
    expect(result.campaigns[0].spend).toBe("30.00");
  });
  it("day, campaign and ad totals reconcile in cents over multiple days and campaigns", () => {
    const result = aggregateMetaInsights(
      [
        row("2026-10-19", "0.10"),
        row("2026-10-20", "0.20"),
        row("2026-10-20", "100.23", undefined, "campaign-b", "ad-b"),
      ],
      "2026-10-19",
      "2026-10-20",
      "America/Sao_Paulo",
    );
    for (const values of [result.daily, result.ads, result.campaigns])
      expect(values.reduce((sum, r) => sum + spendCents(r.spend), 0)).toBe(
        10053,
      );
    expect(result.campaigns.every((r) => !r.ad_id)).toBe(true);
  });
  it("accepts a confirmed zero but refuses missing, invalid and negative spend", () => {
    expect(
      aggregateMetaInsights(
        [row("2026-10-20", "0")],
        "2026-10-20",
        "2026-10-20",
        "America/Sao_Paulo",
      ).ads[0].spend,
    ).toBe("0.00");
    for (const value of [undefined, "", "NaN", "-1", "1,00"])
      expect(() => spendCents(value)).toThrow();
  });
  it("refuses an unaligned hourly response rather than estimating the shifted account day", () => {
    expect(() =>
      aggregateMetaInsights(
        [row("2026-10-20", "30")],
        "2026-10-20",
        "2026-10-20",
        "America/Noronha",
      ),
    ).toThrow("horária");
    expect(() =>
      metaReportingWindow("2026-10-20", "2026-10-20", "Asia/Kolkata"),
    ).toThrow("menor que uma hora");
  });
});
