import { and, eq, gte, lte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  customersTable,
  dailyClientMetricsTable,
  db,
  eventsTable,
  ordersTable,
} from "@workspace/db";

export type DailyMetricRow = {
  date: string;
  approvedRevenue: number;
  requestedRevenue: number;
  approvedOrders: number;
  requestedOrders: number;
  visits: number;
  registrations: number;
  approvedRegistrations: number;
  purchases: number;
  newBuyers: number;
  returningBuyers: number;
};

export type DailyMetricSummary = {
  rows: DailyMetricRow[];
  complete: boolean;
};

const REVENUE_STATUSES = ["APPROVED", "SHIPPED", "DELIVERED"] as const;

function addDays(value: string, amount: number): string {
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return date.toISOString().slice(0, 10);
}

export function dateOnlyRange(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) {
    dates.push(cursor);
  }
  return dates;
}

function toDateOnly(value: Date): string {
  return new Date(value.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function dateOnlyStart(value: string): Date {
  return new Date(`${value}T03:00:00.000Z`);
}

function dateOnlyEnd(value: string): Date {
  return new Date(`${addDays(value, 1)}T02:59:59.999Z`);
}

function zeroRow(date: string): DailyMetricRow {
  return {
    date,
    approvedRevenue: 0,
    requestedRevenue: 0,
    approvedOrders: 0,
    requestedOrders: 0,
    visits: 0,
    registrations: 0,
    approvedRegistrations: 0,
    purchases: 0,
    newBuyers: 0,
    returningBuyers: 0,
  };
}

type OrderAggRow = {
  date: string;
  approved_revenue: string | number | null;
  requested_revenue: string | number | null;
  approved_orders: string | number | null;
  requested_orders: string | number | null;
};

type EventAggRow = {
  date: string;
  visits: string | number | null;
  purchases: string | number | null;
};

type CustomerAggRow = {
  date: string;
  registrations: string | number | null;
  approved_registrations: string | number | null;
};

type BuyerAggRow = {
  date: string;
  new_buyers: string | number | null;
  returning_buyers: string | number | null;
};

function numberValue(value: string | number | null | undefined): number {
  return Number(value ?? 0) || 0;
}

export async function refreshDailyClientMetrics(params: {
  clientId: string;
  from: Date;
  to: Date;
}): Promise<{ days: number }> {
  const dateFrom = toDateOnly(params.from);
  const dateTo = toDateOnly(params.to);
  const from = dateOnlyStart(dateFrom);
  const to = dateOnlyEnd(dateTo);
  const rowsByDate = new Map(dateOnlyRange(dateFrom, dateTo).map((date) => [date, zeroRow(date)]));

  const orderAggRaw = await db.execute<OrderAggRow>(sql`
    SELECT
      to_char(date(timezone('America/Sao_Paulo', ${ordersTable.createdAt})), 'YYYY-MM-DD') AS date,
      COALESCE(SUM(${ordersTable.amount}) FILTER (WHERE ${ordersTable.status} IN (${sql.join(REVENUE_STATUSES.map((status) => sql`${status}`), sql`, `)})), 0)::float AS approved_revenue,
      COALESCE(SUM(${ordersTable.amount}), 0)::float AS requested_revenue,
      COUNT(*) FILTER (WHERE ${ordersTable.status} IN (${sql.join(REVENUE_STATUSES.map((status) => sql`${status}`), sql`, `)}))::int AS approved_orders,
      COUNT(*)::int AS requested_orders
    FROM ${ordersTable}
    WHERE ${ordersTable.clientId} = ${params.clientId}
      AND ${ordersTable.createdAt} >= ${from}
      AND ${ordersTable.createdAt} <= ${to}
    GROUP BY date(timezone('America/Sao_Paulo', ${ordersTable.createdAt}))
  `);
  const orderAggRows = (orderAggRaw.rows ?? orderAggRaw) as unknown as OrderAggRow[];
  for (const row of orderAggRows) {
    const current = rowsByDate.get(row.date);
    if (!current) continue;
    current.approvedRevenue = numberValue(row.approved_revenue);
    current.requestedRevenue = numberValue(row.requested_revenue);
    current.approvedOrders = numberValue(row.approved_orders);
    current.requestedOrders = numberValue(row.requested_orders);
  }

  const eventAggRaw = await db.execute<EventAggRow>(sql`
    SELECT
      to_char(date(timezone('America/Sao_Paulo', ${eventsTable.createdAt})), 'YYYY-MM-DD') AS date,
      COUNT(*) FILTER (WHERE ${eventsTable.eventType} = 'VISIT')::int AS visits,
      COUNT(*) FILTER (WHERE ${eventsTable.eventType} = 'PURCHASE')::int AS purchases
    FROM ${eventsTable}
    WHERE ${eventsTable.clientId} = ${params.clientId}
      AND ${eventsTable.createdAt} >= ${from}
      AND ${eventsTable.createdAt} <= ${to}
    GROUP BY date(timezone('America/Sao_Paulo', ${eventsTable.createdAt}))
  `);
  const eventAggRows = (eventAggRaw.rows ?? eventAggRaw) as unknown as EventAggRow[];
  for (const row of eventAggRows) {
    const current = rowsByDate.get(row.date);
    if (!current) continue;
    current.visits = numberValue(row.visits);
    current.purchases = numberValue(row.purchases);
  }

  // Customer records are the source of truth for B2B registrations. Event rows
  // can be absent or duplicated when the ecommerce retries a webhook.
  const customerAggRaw = await db.execute<CustomerAggRow>(sql`
    SELECT
      to_char(date(timezone('America/Sao_Paulo', ${customersTable.createdAt})), 'YYYY-MM-DD') AS date,
      COUNT(*)::int AS registrations,
      COUNT(*) FILTER (WHERE ${customersTable.registrationStatus} = 'APPROVED')::int AS approved_registrations
    FROM ${customersTable}
    WHERE ${customersTable.clientId} = ${params.clientId}
      AND ${customersTable.createdAt} >= ${from}
      AND ${customersTable.createdAt} <= ${to}
    GROUP BY date(timezone('America/Sao_Paulo', ${customersTable.createdAt}))
  `);
  const customerAggRows = (customerAggRaw.rows ?? customerAggRaw) as unknown as CustomerAggRow[];
  for (const row of customerAggRows) {
    const current = rowsByDate.get(row.date);
    if (!current) continue;
    current.registrations = numberValue(row.registrations);
    current.approvedRegistrations = numberValue(row.approved_registrations);
  }

  const buyerAggRaw = await db.execute<BuyerAggRow>(sql`
    SELECT
      to_char(date(timezone('America/Sao_Paulo', ${ordersTable.createdAt})), 'YYYY-MM-DD') AS date,
      COUNT(DISTINCT ${ordersTable.customerId}) FILTER (
        WHERE ${customersTable.firstPurchaseAt} IS NOT NULL
          AND date(timezone('America/Sao_Paulo', ${customersTable.firstPurchaseAt})) = date(timezone('America/Sao_Paulo', ${ordersTable.createdAt}))
      )::int AS new_buyers,
      COUNT(DISTINCT ${ordersTable.customerId}) FILTER (
        WHERE ${customersTable.firstPurchaseAt} IS NOT NULL
          AND date(timezone('America/Sao_Paulo', ${customersTable.firstPurchaseAt})) < date(timezone('America/Sao_Paulo', ${ordersTable.createdAt}))
      )::int AS returning_buyers
    FROM ${ordersTable}
    INNER JOIN ${customersTable} ON ${ordersTable.customerId} = ${customersTable.id}
    WHERE ${ordersTable.clientId} = ${params.clientId}
      AND ${ordersTable.createdAt} >= ${from}
      AND ${ordersTable.createdAt} <= ${to}
      AND ${ordersTable.status} IN (${sql.join(REVENUE_STATUSES.map((status) => sql`${status}`), sql`, `)})
    GROUP BY date(timezone('America/Sao_Paulo', ${ordersTable.createdAt}))
  `);
  const buyerAggRows = (buyerAggRaw.rows ?? buyerAggRaw) as unknown as BuyerAggRow[];
  for (const row of buyerAggRows) {
    const current = rowsByDate.get(row.date);
    if (!current) continue;
    current.newBuyers = numberValue(row.new_buyers);
    current.returningBuyers = numberValue(row.returning_buyers);
  }

  const values = [...rowsByDate.values()].map((row) => ({
    id: nanoid(),
    clientId: params.clientId,
    metricDate: row.date,
    approvedRevenue: row.approvedRevenue,
    requestedRevenue: row.requestedRevenue,
    approvedOrders: row.approvedOrders,
    requestedOrders: row.requestedOrders,
    visits: row.visits,
    registrations: row.registrations,
    approvedRegistrations: row.approvedRegistrations,
    purchases: row.purchases,
    newBuyers: row.newBuyers,
    returningBuyers: row.returningBuyers,
  }));

  if (values.length > 0) {
    await db
      .insert(dailyClientMetricsTable)
      .values(values)
      .onConflictDoUpdate({
        target: [dailyClientMetricsTable.clientId, dailyClientMetricsTable.metricDate],
        set: {
          approvedRevenue: sql`excluded.approved_revenue`,
          requestedRevenue: sql`excluded.requested_revenue`,
          approvedOrders: sql`excluded.approved_orders`,
          requestedOrders: sql`excluded.requested_orders`,
          visits: sql`excluded.visits`,
          registrations: sql`excluded.registrations`,
          approvedRegistrations: sql`excluded.approved_registrations`,
          purchases: sql`excluded.purchases`,
          newBuyers: sql`excluded.new_buyers`,
          returningBuyers: sql`excluded.returning_buyers`,
          updatedAt: new Date(),
        },
      });
  }

  return { days: values.length };
}

export async function readDailyClientMetrics(params: {
  clientId: string;
  from: Date;
  to: Date;
}): Promise<DailyMetricSummary> {
  const dateFrom = toDateOnly(params.from);
  const dateTo = toDateOnly(params.to);
  const expectedDates = dateOnlyRange(dateFrom, dateTo);
  const rows = await db
    .select()
    .from(dailyClientMetricsTable)
    .where(
      and(
        eq(dailyClientMetricsTable.clientId, params.clientId),
        gte(dailyClientMetricsTable.metricDate, dateFrom),
        lte(dailyClientMetricsTable.metricDate, dateTo),
      ),
    )
    .orderBy(dailyClientMetricsTable.metricDate);

  const rowMap = new Map(rows.map((row) => [row.metricDate, row]));
  return {
    complete: expectedDates.every((date) => rowMap.has(date)),
    rows: expectedDates.map((date) => {
      const row = rowMap.get(date);
      if (!row) return zeroRow(date);
      return {
        date,
        approvedRevenue: row.approvedRevenue,
        requestedRevenue: row.requestedRevenue,
        approvedOrders: row.approvedOrders,
        requestedOrders: row.requestedOrders,
        visits: row.visits,
        registrations: row.registrations,
        approvedRegistrations: row.approvedRegistrations,
        purchases: row.purchases,
        newBuyers: row.newBuyers,
        returningBuyers: row.returningBuyers,
      };
    }),
  };
}
