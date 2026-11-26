import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { clientsTable, db } from "@workspace/db";
import type { PaidMediaReview } from "./up-manager-paid-media";
import type { ManagerClient, ManagerPeriod } from "./up-manager";

export async function readAgencyMediaBenchmark(client: ManagerClient, window: ManagerPeriod): Promise<NonNullable<PaidMediaReview["agencyBenchmark"]> | null> {
  const configured = await db.select({ id: clientsTable.metaAdAccountId }).from(clientsTable).where(and(
    eq(clientsTable.dashboardType, "B2C"), eq(clientsTable.isActive, true), isNull(clientsTable.archivedAt),
    eq(clientsTable.currency, client.currency), isNotNull(clientsTable.metaAdAccountId),
  ));
  const normalize = (id: string | null | undefined) => id?.trim().replace(/^act_/i, "") ?? "";
  const own = normalize(client.accountId);
  const accounts = [...new Set(configured.map(({ id }) => normalize(id)).filter((id) => id !== own && /^\d+$/.test(id)))];
  if (accounts.length < 5) return null;
  const { bigquery, vestiTable } = await import("../lib/bigquery");
  const [rows] = await bigquery.query({
    location: "US", jobTimeoutMs: 15_000, params: { accounts, dateFrom: window.dateFrom, dateTo: window.dateTo },
    query: `WITH insights AS (
      SELECT REGEXP_EXTRACT(ad_account_id, r'[0-9]+') AS account, ad_id, campaign_id, date_start, spend, purchases_qty, purchase_value
      FROM ${vestiTable("data_ads_global", "ads_insights")}
      WHERE date_start BETWEEN DATE(@dateFrom) AND DATE(@dateTo) AND IFNULL(date_stop, date_start) = date_start
        AND REGEXP_EXTRACT(ad_account_id, r'[0-9]+') IN UNNEST(@accounts)
        AND COALESCE(region, age, gender, placement, device_platform) IS NULL
      QUALIFY ROW_NUMBER() OVER (PARTITION BY account, ad_id, date_start ORDER BY last_updated DESC, ingestion_timestamp DESC) = 1
    ), objectives AS (
      SELECT REGEXP_EXTRACT(ad_account_id, r'[0-9]+') AS account, campaign_id, objective
      FROM ${vestiTable("data_ads_global", "ads_campaigns")}
      WHERE REGEXP_EXTRACT(ad_account_id, r'[0-9]+') IN UNNEST(@accounts)
      QUALIFY ROW_NUMBER() OVER (PARTITION BY account, campaign_id ORDER BY COALESCE(is_current, FALSE) DESC, last_updated DESC, ingestion_timestamp DESC) = 1
    ), eligible AS (
      SELECT account, SAFE_DIVIDE(SUM(COALESCE(purchase_value, 0)), SUM(spend)) AS roas
      FROM insights JOIN objectives USING (account, campaign_id)
      WHERE objective IN ('OUTCOME_SALES', 'CONVERSIONS', 'WEBSITE_CONVERSIONS', 'PRODUCT_CATALOG_SALES')
      GROUP BY account
      HAVING COUNT(DISTINCT date_start) = DATE_DIFF(DATE(@dateTo), DATE(@dateFrom), DAY) + 1
        AND COUNTIF(purchases_qty > 0 AND COALESCE(purchase_value, 0) <= 0) = 0
        AND SUM(spend) > 0 AND SUM(COALESCE(purchases_qty, 0)) >= 5
    )
    SELECT COUNT(*) OVER () AS accounts, PERCENTILE_CONT(CAST(roas AS FLOAT64), 0.5) OVER () AS medianRoas
    FROM eligible LIMIT 1`,
  });
  const size = Number(rows[0]?.accounts ?? 0);
  const medianRoas = Number(rows[0]?.medianRoas);
  return size >= 5 && Number.isFinite(medianRoas) ? { accounts: size, eligibleAccounts: accounts.length, medianRoas, window } : null;
}
