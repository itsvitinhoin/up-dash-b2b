import { hasBlingSchema } from "./bling-schema";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  blingConnectionsTable as connections,
  blingRecordsTable as records,
} from "@workspace/db";
import { getBlingApp } from "./bling-config";
import { requireBlingClient } from "./bling-sync";

export async function getBlingStatus(clientId: string) {
  const client = await requireBlingClient(clientId);
  const ready = await hasBlingSchema();
  const [row] = ready
    ? await db
        .select({
          companyName: connections.companyName,
          companyId: connections.companyId,
          tokens: connections.tokens,
          historyDays: connections.historyDays,
          nuvemshopChannelId: connections.nuvemshopChannelId,
          completedAt: connections.completedAt,
          cursor: connections.cursor,
          error: connections.error,
          leaseUntil: connections.leaseUntil,
          nextRequestAt: connections.nextRequestAt,
        })
        .from(connections)
        .where(eq(connections.clientId, clientId))
    : [];
  let appConfigured = false;
  let appClientId: string | null = null;
  let credentialsSource: "server" | "client" = "server";
  let selected = client.erpProvider === "BLING";
  let redirectUri = process.env.BLING_REDIRECT_URI ?? "";
  try {
    const app = await getBlingApp(clientId);
    appConfigured = true;
    appClientId = app.config.clientId;
    credentialsSource = app.source;
    selected = app.selected;
    redirectUri = app.config.redirect;
  } catch {
    /* Expose status, never deployment secrets. */
  }
  const channels = ready
    ? await db
        .select({ data: records.data })
        .from(records)
        .where(
          and(eq(records.clientId, clientId), eq(records.kind, "channels")),
        )
    : [];
  const groupedCounts = ready
    ? await db
        .select({ kind: records.kind, count: sql<number>`count(*)::int` })
        .from(records)
        .where(eq(records.clientId, clientId))
        .groupBy(records.kind)
    : [];
  const recordCounts = { channels: 0, products: 0, customers: 0, orders: 0 };
  for (const group of groupedCounts) recordCounts[group.kind] = group.count;
  return {
    channels: channels.map((r) => r.data),
    recordCounts,
    appConfigured,
    appClientId,
    credentialsSource,
    selected,
    redirectUri,
    connected: selected && !!row?.tokens,
    companyName: row?.companyName ?? null,
    companyId: row?.companyId ?? null,
    historyDays: row?.historyDays ?? 30,
    nuvemshopChannelId: row?.nuvemshopChannelId ?? null,
    completedAt: row?.completedAt ?? null,
    cursor: row?.cursor
      ? {
          phase: row.cursor.phase,
          page: row.cursor.page,
          pendingItems: row.cursor.pending.length,
        }
      : null,
    error: row?.error ?? null,
    retryAt:
      row?.error &&
      row.nextRequestAt &&
      row.nextRequestAt.getTime() > Date.now()
        ? row.nextRequestAt.toISOString()
        : null,
    busy: !!row?.leaseUntil && row.leaseUntil.getTime() > Date.now(),
  };
}

export type BlingQuery = {
  clientId: string;
  from: string;
  to: string;
  channel?: string;
  search: string;
  view: "overview" | "orders" | "customers" | "products";
  page: number;
};
export async function getBlingAnalytics(query: BlingQuery) {
  const status = await getBlingStatus(query.clientId);
  if (!(await hasBlingSchema()))
    return {
      status,
      summary: {
        orders: 0,
        orderValue: 0,
        customers: 0,
        matched: 0,
        unmatched: 0,
        ambiguous: 0,
        channels: [],
      },
      rows: [],
      total: 0,
      page: query.page,
      channels: [],
    };
  const channel = query.channel
    ? sql`AND b.data->>'channelId' = ${query.channel}`
    : sql``;
  const search =
    query.search && query.view !== "customers" && query.view !== "products"
      ? sql`AND (b.data->>'number' ILIKE ${`%${query.search}%`} OR b.data->>'customerName' ILIKE ${`%${query.search}%`} OR b.data->>'storeNumber' ILIKE ${`%${query.search}%`})`
      : sql``;
  const offset = (query.page - 1) * 25;
  // Match only inside the explicitly selected storefront channel. A store
  // number from another marketplace is never evidence of the same order.
  const cte = sql`WITH base AS (
    SELECT b.data, COALESCE(c.data->>'name', CASE WHEN b.data->>'channelId' = 'unassigned' THEN 'Sem canal identificado' ELSE 'Canal ' || (b.data->>'channelId') END) AS channel_name,
      CASE WHEN b.data->>'channelId' = ${status.nuvemshopChannelId} THEN (
        SELECT count(*)::int FROM orders o JOIN clients cl ON cl.id = o.client_id
        WHERE o.client_id = ${query.clientId} AND cl.commerce_platform = 'NUVEMSHOP'
          AND NULLIF(b.data->>'storeNumber', '') IS NOT NULL
          AND o.source_metadata->'nuvemshop'->>'orderNumber' = b.data->>'storeNumber'
      ) ELSE NULL END AS matches
    FROM bling_records b LEFT JOIN bling_records c ON c.client_id = b.client_id AND c.kind = 'channels' AND c.external_id = b.data->>'channelId'
    WHERE b.client_id = ${query.clientId} AND b.kind = 'orders'
      AND b.data->>'day' >= ${query.from} AND b.data->>'day' <= ${query.to} ${channel} ${search}
  )`;
  const [summary, list, channels] = await Promise.all([
    db.execute(sql`${cte} SELECT jsonb_build_object(
      'orders', count(*), 'orderValue', COALESCE(sum((data->>'total')::numeric),0),
      'customers', count(DISTINCT data->>'customerId'),
      'matched', count(*) FILTER (WHERE matches = 1), 'unmatched', count(*) FILTER (WHERE matches = 0), 'ambiguous', count(*) FILTER (WHERE matches > 1),
      'channels', COALESCE((SELECT jsonb_agg(v) FROM (SELECT data->>'channelId' AS id, max(channel_name) AS name, count(*)::int AS orders, sum((data->>'total')::numeric) AS value FROM base GROUP BY data->>'channelId' ORDER BY value DESC) v), '[]'::jsonb)
    ) AS data FROM base`),
    query.view === "customers"
      ? db.execute(sql`${cte}, grouped AS (
      SELECT data->>'customerId' AS id, max(data->>'customerName') AS name, count(*)::int AS orders, sum((data->>'total')::numeric)::float8 AS value, max(data->>'day') AS last_day
      FROM base WHERE data->>'customerId' IS NOT NULL AND data->>'customerName' ILIKE ${`%${query.search}%`} GROUP BY data->>'customerId'
    ) SELECT (SELECT count(*)::int FROM grouped) AS total, COALESCE(jsonb_agg(r), '[]'::jsonb) AS rows FROM (SELECT * FROM grouped WHERE name ILIKE ${`%${query.search}%`} ORDER BY value DESC, id LIMIT 25 OFFSET ${offset}) r`)
      : query.view === "products"
        ? db.execute(
            sql`WITH catalog AS (SELECT data FROM bling_records WHERE client_id = ${query.clientId} AND kind = 'products' AND (data->>'name' ILIKE ${`%${query.search}%`} OR data->>'sku' ILIKE ${`%${query.search}%`})) SELECT (SELECT count(*)::int FROM catalog) AS total, COALESCE(jsonb_agg(r.data), '[]'::jsonb) AS rows FROM (SELECT data FROM catalog ORDER BY data->>'name', data->>'id' LIMIT 25 OFFSET ${offset}) r`,
          )
        : db.execute(
            sql`${cte} SELECT (SELECT count(*)::int FROM base) AS total, COALESCE(jsonb_agg(r.data), '[]'::jsonb) AS rows FROM (SELECT data || jsonb_build_object('channelName', channel_name, 'reconciliation', CASE WHEN matches IS NULL THEN 'other_channel' WHEN matches = 1 THEN 'matched' WHEN matches = 0 THEN 'unmatched' ELSE 'ambiguous' END) AS data FROM base ORDER BY data->>'day' DESC, data->>'id' DESC LIMIT 25 OFFSET ${offset}) r`,
          ),
    db.execute(
      sql`SELECT data FROM bling_records WHERE client_id = ${query.clientId} AND kind = 'channels' ORDER BY data->>'name'`,
    ),
  ]);
  return {
    status,
    summary: summary.rows[0].data,
    rows: list.rows[0].rows,
    total: list.rows[0].total,
    page: query.page,
    channels: channels.rows.map((row) => row.data),
  };
}
