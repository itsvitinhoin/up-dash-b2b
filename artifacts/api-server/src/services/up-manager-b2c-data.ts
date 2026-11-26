import {
  db,
  ga4DailyMetricsTable,
  ordersTable,
  syncJobsTable,
} from "@workspace/db";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import {
  addDaysToDateOnly,
  saoPauloDateOnlyStart,
} from "../lib/reporting-period";
import { paidOrderStatus } from "./metric-rules";
import type { ManagerPeriod } from "./up-manager";
import { GA4_BQ_DATASET } from "./ga4-bigquery-rules";
import type { CheckoutDiagnosticData } from "./up-manager-funnel-diagnostic";

export const daysIn = ({ dateFrom, dateTo }: ManagerPeriod) =>
  Math.round((Date.parse(dateTo) - Date.parse(dateFrom)) / 86_400_000) + 1;

export function endingOn(dateTo: string, days: number): ManagerPeriod {
  return { dateFrom: addDaysToDateOnly(dateTo, 1 - days), dateTo };
}

function checkoutBounds(period: ManagerPeriod) {
  return [
    saoPauloDateOnlyStart(period.dateFrom),
    saoPauloDateOnlyStart(addDaysToDateOnly(period.dateTo, 1)),
  ] as const;
}

export async function readOrderContext(
  clientId: string,
  period: ManagerPeriod,
  dormantDays: number,
) {
  const [from, end] = checkoutBounds(period);
  const [row] = await db
    .execute<{
      created: number;
      approved: number;
      pending: number;
      rejected: number;
      refunds: number;
      unverifiedRefunds: number;
      discount: number;
      shipping: number;
      newRevenue: number;
      returningRevenue: number;
      reactivatedBuyers: number;
    }>(
      sql`
    WITH placed AS (
      SELECT customer_id, status, fulfilled_amount, refunded_amount, refund_status_unverified_reason,
             discount_amount, shipping_amount
      FROM orders
      WHERE client_id = ${clientId} AND created_at >= ${from} AND created_at < ${end}
    ), paid_buyers AS (
      SELECT customer_id, SUM(fulfilled_amount) AS revenue
      FROM placed WHERE status IN ('APPROVED', 'SHIPPED', 'DELIVERED')
      GROUP BY customer_id
    ), acquisition AS (
      SELECT b.revenue, (
        SELECT MAX(${ordersTable.createdAt})
        FROM ${ordersTable}
        WHERE ${ordersTable.clientId} = ${clientId} AND ${ordersTable.customerId} = b.customer_id
          AND ${ordersTable.createdAt} < ${from} AND ${paidOrderStatus()}
      ) AS last_order
      FROM paid_buyers b
    )
    SELECT
      (SELECT COUNT(*) FROM placed)::int AS created,
      (SELECT COUNT(*) FROM placed WHERE status IN ('APPROVED', 'SHIPPED', 'DELIVERED'))::int AS approved,
      (SELECT COUNT(*) FROM placed WHERE status = 'PENDING')::int AS pending,
      (SELECT COUNT(*) FROM placed WHERE status = 'REJECTED')::int AS rejected,
      (SELECT COALESCE(SUM(refunded_amount), 0) FROM placed)::float AS refunds,
      (SELECT COUNT(*) FROM placed WHERE refund_status_unverified_reason IS NOT NULL)::int AS "unverifiedRefunds",
      (SELECT COALESCE(SUM(discount_amount), 0) FROM placed WHERE status IN ('APPROVED', 'SHIPPED', 'DELIVERED'))::float AS discount,
      (SELECT COALESCE(SUM(shipping_amount), 0) FROM placed WHERE status IN ('APPROVED', 'SHIPPED', 'DELIVERED'))::float AS shipping,
      COALESCE(SUM(revenue) FILTER (WHERE last_order IS NULL), 0)::float AS "newRevenue",
      COALESCE(SUM(revenue) FILTER (WHERE last_order IS NOT NULL), 0)::float AS "returningRevenue",
      COUNT(*) FILTER (WHERE last_order <= ${from}::timestamptz - make_interval(days => ${dormantDays}))::int AS "reactivatedBuyers"
    FROM acquisition
  `,
    )
    .then(({ rows }) => rows);
  return row;
}

export async function readCohorts(clientId: string, asOf: string) {
  const cutoff = checkoutBounds({ dateFrom: asOf, dateTo: asOf })[1];
  const { rows } = await db.execute<{
    month: string;
    horizon: number;
    buyers: number;
    repeatBuyers: number;
    revenuePerBuyer: number;
  }>(sql`
    WITH paid AS (
      SELECT id, customer_id, (created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day, fulfilled_amount,
             row_number() OVER (PARTITION BY customer_id ORDER BY created_at, id) AS purchase
      FROM ${ordersTable}
      WHERE ${ordersTable.clientId} = ${clientId}
        AND ${ordersTable.createdAt} < ${cutoff} AND ${paidOrderStatus()}
    ), starts AS (
      SELECT customer_id, day, date_trunc('month', day)::date AS month
      FROM paid
      WHERE purchase = 1 AND day >= (date_trunc('month', ${asOf}::date) - interval '5 months')
    ), measured AS (
      SELECT s.month, h.horizon, s.customer_id, bool_or(p.purchase > 1) AS repeated,
             SUM(p.fulfilled_amount) AS revenue
      FROM starts s CROSS JOIN (VALUES (30), (60), (90)) AS h(horizon)
      JOIN paid p ON p.customer_id = s.customer_id AND p.day < s.day + h.horizon
      WHERE (s.month + interval '1 month')::date - 1 + h.horizon <= ${asOf}::date + 1
      GROUP BY s.month, h.horizon, s.customer_id
    )
    SELECT month::text, horizon, COUNT(*)::int AS buyers,
           COUNT(*) FILTER (WHERE repeated)::int AS "repeatBuyers",
           AVG(revenue)::float AS "revenuePerBuyer"
    FROM measured GROUP BY month, horizon ORDER BY month DESC, horizon
  `);
  return rows;
}

export async function readCommerceFreshness(clientId: string, platform?: string | null) {
  const braavo = platform === "BRAAVO";
  const [sync] = await db
    .select({
      status: syncJobsTable.status,
      finishedAt: syncJobsTable.finishedAt,
      result: syncJobsTable.result,
    })
    .from(syncJobsTable)
    .where(
      and(
        eq(syncJobsTable.clientId, clientId),
        eq(syncJobsTable.jobType, braavo ? "braavo_transactional" : "nuvemshop_transactional"),
        sql`${syncJobsTable.finishedAt} IS NOT NULL`,
      ),
    )
    .orderBy(desc(syncJobsTable.finishedAt))
    .limit(1);
  const result = sync?.result as
    | {
        partial?: boolean;
        errors?: unknown[];
        since?: string;
        ordersComplete?: boolean;
        orderPaginationComplete?: boolean;
      }
    | null
    | undefined;
  return {
    status: sync?.status ?? null,
    observedAt: sync?.finishedAt?.toISOString() ?? null,
    partial: braavo
      ? result?.partial === true || Boolean(result?.errors?.length)
      : result?.ordersComplete === false || result?.orderPaginationComplete === false ||
        Boolean(result?.errors?.some((error) => typeof error !== "string" || !error.startsWith("Product "))) ||
        (result?.ordersComplete !== true && result?.partial === true),
    since: result?.since ?? null,
  };
}

interface FunnelRow {
  sessions: number;
  productViews: number;
  addToCarts: number;
  checkouts: number;
  purchases: number;
  cells: number;
  observedAt: string | Date | null;
  complete?: boolean;
}

function cleanFunnel(
  raw: FunnelRow | undefined,
  period: ManagerPeriod,
  source: string,
) {
  if (!raw || Number(raw.cells) !== daysIn(period) || raw.complete === false)
    return null;
  const {
    sessions,
    productViews,
    addToCarts,
    checkouts,
    purchases,
    observedAt,
  } = raw;
  return {
    sessions: Number(sessions),
    productViews: Number(productViews),
    addToCarts: Number(addToCarts),
    checkouts: Number(checkouts),
    purchases: Number(purchases),
    observedAt,
    source,
  };
}

async function readPostgresFunnel(clientId: string, period: ManagerPeriod) {
  const ga = ga4DailyMetricsTable;
  const [row] = await db
    .select({
      sessions: sql<number>`COALESCE(SUM(${ga.sessions}), 0)::float`,
      productViews: sql<number>`COALESCE(SUM(${ga.productViews}), 0)::float`,
      addToCarts: sql<number>`COALESCE(SUM(${ga.addToCarts}), 0)::float`,
      checkouts: sql<number>`COALESCE(SUM(${ga.checkouts}), 0)::float`,
      purchases: sql<number>`COALESCE(SUM(${ga.purchases}), 0)::float`,
      cells: sql<number>`COUNT(*)::int`,
      observedAt: sql<string | null>`MAX(${ga.syncedAt})::text`,
    })
    .from(ga)
    .where(
      and(
        eq(ga.clientId, clientId),
        gte(ga.metricDate, period.dateFrom),
        lte(ga.metricDate, period.dateTo),
      ),
    );
  return cleanFunnel(row, period, "ga4_daily_metrics");
}

interface FunnelBreakdown {
  name: string;
  traffic: number;
  carts: number;
  checkouts: number;
  purchases: number;
}

async function readBigQueryFunnel(
  clientId: string,
  current: ManagerPeriod,
  previous: ManagerPeriod,
  includeBreakdown: boolean,
) {
  const { bigquery, vestiTable } = await import("../lib/bigquery");
  const table = vestiTable(GA4_BQ_DATASET, "ga4_daily");
  const [rows] = await bigquery.query({
    location: "US",
    jobTimeoutMs: 10_000,
    params: {
      clientId,
      currentFrom: current.dateFrom,
      currentTo: current.dateTo,
      priorFrom: previous.dateFrom,
      priorTo: previous.dateTo,
    },
    query: `
      SELECT IF(date >= DATE(@currentFrom), 'current', 'previous') AS period_key,
             SUM(sessions) AS sessions, SUM(view_item) AS productViews,
             SUM(add_to_cart) AS addToCarts, SUM(begin_checkout) AS checkouts, SUM(purchases) AS purchases,
             COUNT(DISTINCT date) AS cells, CAST(MAX(synced_at) AS STRING) AS observedAt,
             COUNT(*) = COUNT(DISTINCT date) AND COUNT(DISTINCT property_id) = 1 AND
               COUNTIF(sessions IS NULL OR view_item IS NULL OR add_to_cart IS NULL OR begin_checkout IS NULL OR purchases IS NULL) = 0 AS complete,
             ANY_VALUE(property_id) AS propertyId
      FROM ${table}
      WHERE client_id = @clientId AND (date BETWEEN DATE(@currentFrom) AND DATE(@currentTo)
        OR date BETWEEN DATE(@priorFrom) AND DATE(@priorTo))
      GROUP BY period_key`,
  });
  const currentRow = rows.find((row) => row.period_key === "current");
  const previousRow = rows.find((row) => row.period_key === "previous");
  const currentFunnel = cleanFunnel(
    currentRow,
    current,
    `${GA4_BQ_DATASET}.ga4_daily`,
  );
  const previousFunnel = cleanFunnel(
    previousRow,
    previous,
    `${GA4_BQ_DATASET}.ga4_daily`,
  );
  if (!currentFunnel || !currentRow?.propertyId) return null;
  const sameProperty = currentRow.propertyId === previousRow?.propertyId;

  const breakdown = async (
    scope: "channel" | "product",
  ): Promise<FunnelBreakdown[] | null> => {
    const byChannel = scope === "channel";
    const table = vestiTable(
      GA4_BQ_DATASET,
      byChannel ? "ga4_traffic_daily" : "ga4_product_funnel_daily",
    );
    const name = byChannel
      ? "channel_group"
      : "COALESCE(NULLIF(item_name, ''), item_id)";
    const columns = byChannel
      ? ["sessions", "add_to_cart", "begin_checkout", "purchases"]
      : [
          "items_viewed",
          "items_added_to_cart",
          "items_checked_out",
          "items_purchased",
        ];
    const [rows] = await bigquery.query({
      location: "US",
      jobTimeoutMs: 10_000,
      params: {
        clientId,
        from: current.dateFrom,
        to: current.dateTo,
        propertyId: String(currentRow.propertyId),
      },
      query: `SELECT ${name} AS name, SUM(${columns[0]}) AS traffic, SUM(${columns[1]}) AS carts,
        SUM(${columns[2]}) AS checkouts, SUM(${columns[3]}) AS purchases
        FROM ${table} WHERE client_id = @clientId AND property_id = @propertyId
          AND date BETWEEN DATE(@from) AND DATE(@to)
          AND (SELECT COUNT(DISTINCT date) FROM ${table} WHERE client_id = @clientId AND property_id = @propertyId
            AND date BETWEEN DATE(@from) AND DATE(@to)) = DATE_DIFF(DATE(@to), DATE(@from), DAY) + 1
        GROUP BY name ORDER BY traffic DESC, name LIMIT 12`,
    });
    return rows.length
      ? rows.map((row) => ({
          name: row.name || "Sem identificação",
          traffic: Number(row.traffic),
          carts: Number(row.carts),
          checkouts: Number(row.checkouts),
          purchases: Number(row.purchases),
        }))
      : null;
  };
  const [channels, products] = includeBreakdown ? await Promise.all([
    breakdown("channel").catch(() => null),
    breakdown("product").catch(() => null),
  ]) : [null, null];
  return {
    current: currentFunnel,
    previous: sameProperty ? previousFunnel : null,
    propertyId: sameProperty && previousFunnel ? String(currentRow.propertyId) : null,
    channels,
    products,
  };
}

export async function readFunnel(
  clientId: string,
  current: ManagerPeriod,
  previous: ManagerPeriod,
  includeBreakdown = true,
) {
  const [live, prior] = await Promise.all([
    readPostgresFunnel(clientId, current),
    readPostgresFunnel(clientId, previous),
  ]);
  const warehouse =
    process.env.UP_MANAGER_GA4_BIGQUERY === "1"
      ? await readBigQueryFunnel(clientId, current, previous, includeBreakdown).catch(() => null)
      : null;
  if (warehouse?.previous || (!live && warehouse?.current)) return warehouse;
  return {
    current: live,
    previous: prior,
    propertyId: null,
    channels: warehouse?.channels ?? null,
    products: warehouse?.products ?? null,
  };
}

export async function readWarehouseCheckoutDiagnostic(
  clientId: string,
  propertyId: string,
  current: ManagerPeriod,
  previous: ManagerPeriod,
): Promise<CheckoutDiagnosticData> {
  const { bigquery, vestiTable } = await import("../lib/bigquery");
  const traffic = vestiTable(GA4_BQ_DATASET, "ga4_traffic_daily");
  const products = vestiTable(GA4_BQ_DATASET, "ga4_product_funnel_daily");
  const [rows] = await bigquery.query({
    location: "US",
    jobTimeoutMs: 10_000,
    params: {
      clientId, propertyId,
      currentFrom: current.dateFrom,
      currentTo: current.dateTo,
      priorFrom: previous.dateFrom,
      priorTo: previous.dateTo,
    },
    query: `
      WITH periods AS (
        SELECT 'previous' AS period, DATE(@priorFrom) AS start_date, DATE(@priorTo) AS end_date
        UNION ALL SELECT 'current', DATE(@currentFrom), DATE(@currentTo)
      ), complete_products AS (
        SELECT period
        FROM ${products} JOIN periods ON date BETWEEN start_date AND end_date
        WHERE client_id = @clientId AND property_id = @propertyId
        GROUP BY period, start_date, end_date
        HAVING COUNT(DISTINCT date) = DATE_DIFF(end_date, start_date, DAY) + 1
      )
      SELECT 'traffic' AS kind, period, COALESCE(channel_group, '') AS channel,
             COALESCE(campaign, '') AS campaign, '' AS id, '' AS name,
             SUM(add_to_cart) AS carts, SUM(begin_checkout) AS checkouts, SUM(purchases) AS purchases, COUNT(DISTINCT date) AS days
      FROM ${traffic} JOIN periods ON date BETWEEN start_date AND end_date
      WHERE client_id = @clientId AND property_id = @propertyId
      GROUP BY 1,2,3,4
      UNION ALL
      SELECT 'item', period, '', '', COALESCE(item_id, ''),
             COALESCE(NULLIF(item_name, ''), item_id, ''), SUM(items_added_to_cart), SUM(items_checked_out), NULL, NULL
      FROM ${products} JOIN periods ON date BETWEEN start_date AND end_date
      WHERE client_id = @clientId AND property_id = @propertyId
        AND (SELECT COUNT(*) FROM complete_products) = 2
      GROUP BY 1,2,5,6`,
  });
  return {
    source: "bigquery",
    events: rows.filter((row) => row.kind === "traffic").flatMap((row) => {
      const segment = { period: row.period, channel: row.channel, campaign: row.campaign, device: "", days: Number(row.days) };
      return [
        { ...segment, event: "add_to_cart", count: Number(row.carts) },
        { ...segment, event: "begin_checkout", count: Number(row.checkouts) },
        ...(row.purchases == null ? [] : [{ ...segment, event: "purchase", count: Number(row.purchases) }]),
      ];
    }),
    items: rows.filter((row) => row.kind === "item").map((row) => ({
      period: row.period, channel: "", campaign: "", id: row.id, name: row.name,
      carts: Number(row.carts), checkouts: Number(row.checkouts),
    })),
  };
}

export async function readRetentionSegments(
  clientId: string,
  dateTo: string,
  dormantDays: number,
) {
  const [, cutoff] = checkoutBounds({ dateFrom: dateTo, dateTo });
  const { rows } = await db.execute<{ firstOnly: number; dormant: number }>(sql`
    WITH history AS (
      SELECT customer_id, COUNT(*) AS purchases, MAX(created_at) AS latest
      FROM ${ordersTable}
      WHERE client_id = ${clientId} AND created_at < ${cutoff} AND ${paidOrderStatus()}
      GROUP BY customer_id
    )
    SELECT COUNT(*) FILTER (WHERE purchases = 1
        AND latest >= ${cutoff}::timestamptz - interval '30 days'
        AND latest < ${cutoff}::timestamptz - interval '14 days')::int AS "firstOnly",
      COUNT(*) FILTER (WHERE purchases >= 2
        AND latest >= ${cutoff}::timestamptz - make_interval(days => ${dormantDays + 30})
        AND latest < ${cutoff}::timestamptz - make_interval(days => ${dormantDays}))::int AS dormant
    FROM history
  `);
  return rows[0];
}

export async function readManagerGa4Connection(clientId: string) {
  const { rows } = await db.execute<{
    configured: boolean;
    lastStatus: string | null;
    issue: string | null;
    lastAttemptAt: string | null;
  }>(sql`
    SELECT nullif(trim(c.ga4_property_id), '') IS NOT NULL AS configured,
      last_job.status AS "lastStatus", last_job.finished_at::text AS "lastAttemptAt",
      CASE WHEN last_job.status = 'failed' AND (last_job.error ILIKE '%permission%' OR last_job.error ILIKE '%403%')
        THEN 'permission' ELSE NULL END AS issue
    FROM clients c
    LEFT JOIN LATERAL (
      SELECT status, error, finished_at FROM sync_jobs
      WHERE client_id = c.id AND job_type = 'ga4_daily' AND finished_at IS NOT NULL
      ORDER BY finished_at DESC LIMIT 1
    ) last_job ON true
    WHERE c.id = ${clientId}
  `);
  return rows[0] ?? null;
}
