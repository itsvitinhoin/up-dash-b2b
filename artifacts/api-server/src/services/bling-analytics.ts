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
  view: "overview" | "orders" | "customers" | "products" | "stock";
  page: number;
  statusId?: string;
  customerId?: string;
  buyerType?: "all" | "single" | "repeat";
  stock?: "all" | "positive" | "zero" | "negative" | "unknown";
  sort?: "name" | "units" | "value" | "stock";
  export?: boolean;
};

export async function getBlingAnalytics(query: BlingQuery) {
  const status = await getBlingStatus(query.clientId);
  const empty = {
    orders: 0,
    orderValue: 0,
    customers: 0,
    matched: 0,
    unmatched: 0,
    ambiguous: 0,
    units: 0,
    repeatCustomers: 0,
    channels: [],
    daily: [],
    statuses: [],
    topProducts: [],
    catalog: {
      products: 0,
      active: 0,
      knownStock: 0,
      physical: 0,
      available: 0,
      positive: 0,
      zero: 0,
      negative: 0,
      unknown: 0,
      units: 0,
      value: 0,
    },
    coverage: { from: null, to: null },
  };
  if (!(await hasBlingSchema()))
    return {
      status,
      summary: empty,
      rows: [],
      total: 0,
      page: query.page,
      channels: [],
    };
  const isCatalog = query.view === "products" || query.view === "stock";
  const pageSize = query.export ? 10000 : 25;
  const offset = query.export ? 0 : (query.page - 1) * pageSize;
  const pattern = `%${query.search}%`;
  const channel = query.channel
    ? sql`AND b.data->>'channelId' = ${query.channel}`
    : sql``;
  const statusFilter = query.statusId
    ? sql`AND b.data->>'statusId' = ${query.statusId}`
    : sql``;
  const customer = query.customerId
    ? sql`AND b.data->>'customerId' = ${query.customerId}`
    : sql``;
  const search =
    query.search && !isCatalog && query.view !== "customers"
      ? sql`AND (b.data->>'number' ILIKE ${pattern} OR b.data->>'customerName' ILIKE ${pattern} OR b.data->>'storeNumber' ILIKE ${pattern})`
      : sql``;
  const buyerFilter =
    query.buyerType === "repeat"
      ? sql`AND orders > 1`
      : query.buyerType === "single"
        ? sql`AND orders = 1`
        : sql``;
  const stockFilter =
    query.stock === "unknown"
      ? sql`AND data->'stock'->>'available' IS NULL`
      : query.stock === "positive"
        ? sql`AND (data->'stock'->>'available')::numeric > 0`
        : query.stock === "zero"
          ? sql`AND (data->'stock'->>'available')::numeric = 0`
          : query.stock === "negative"
            ? sql`AND (data->'stock'->>'available')::numeric < 0`
            : sql``;
  const sort =
    query.sort === "units"
      ? sql`units DESC, data->>'name', data->>'id'`
      : query.sort === "value"
        ? sql`value DESC, data->>'name', data->>'id'`
        : query.sort === "stock"
          ? sql`(data->'stock'->>'available')::numeric DESC NULLS LAST, data->>'name', data->>'id'`
          : sql`data->>'name', data->>'id'`;
  // One cached read model, scoped by brand throughout. Storefront numbers are
  // grouped once so duplicate matches never multiply ERP orders or item sales.
  const cte = sql`WITH storefront_orders AS (
    SELECT o.source_metadata->'nuvemshop'->>'orderNumber' AS number, count(*)::int AS matches
    FROM orders o JOIN clients cl ON cl.id = o.client_id
    WHERE ${status.nuvemshopChannelId}::text IS NOT NULL
      AND o.client_id = ${query.clientId} AND cl.commerce_platform = 'NUVEMSHOP'
      AND NULLIF(o.source_metadata->'nuvemshop'->>'orderNumber', '') IS NOT NULL
    GROUP BY o.source_metadata->'nuvemshop'->>'orderNumber'
  ), scoped AS (
    SELECT b.data, COALESCE(c.data->>'name', CASE WHEN b.data->>'channelId' = 'unassigned' THEN 'Sem canal identificado' ELSE 'Canal ' || (b.data->>'channelId') END) AS channel_name,
      CASE WHEN b.data->>'channelId' = ${status.nuvemshopChannelId} THEN COALESCE(n.matches, 0) ELSE NULL END AS matches
    FROM bling_records b LEFT JOIN bling_records c ON c.client_id = b.client_id AND c.kind = 'channels' AND c.external_id = b.data->>'channelId'
    LEFT JOIN storefront_orders n ON b.data->>'channelId' = ${status.nuvemshopChannelId}
      AND NULLIF(b.data->>'storeNumber', '') = n.number
    WHERE b.client_id = ${query.clientId} AND b.kind = 'orders'
      AND b.data->>'day' >= ${query.from} AND b.data->>'day' <= ${query.to} ${channel} ${statusFilter} ${customer} ${search}
  ), buyer_groups AS (
    SELECT data->>'customerId' AS id, max(data->>'customerName') AS name,
      count(*)::int AS orders, sum((data->>'total')::numeric)::float8 AS value,
      min(data->>'day') AS first_day, max(data->>'day') AS last_day,
      count(DISTINCT data->>'channelId')::int AS channels
    FROM scoped WHERE NULLIF(data->>'customerId', '') IS NOT NULL GROUP BY data->>'customerId'
  ), filtered_buyers AS (
    SELECT * FROM buyer_groups WHERE COALESCE(name, '') ILIKE ${query.view === "customers" ? pattern : "%"} ${buyerFilter}
  ), base AS (
    SELECT * FROM scoped WHERE ${query.view !== "customers"} OR data->>'customerId' IN (SELECT id FROM filtered_buyers)
  ), items AS (
    SELECT item FROM base CROSS JOIN LATERAL jsonb_array_elements(COALESCE(data->'items', '[]'::jsonb)) item
  ), item_sales AS (
    SELECT item->>'productId' AS product_id, item->>'sku' AS sku,
      max(item->>'name') AS name, sum((item->>'quantity')::numeric)::float8 AS units,
      sum((item->>'quantity')::numeric * (item->>'unitPrice')::numeric)::float8 AS value
    FROM items GROUP BY item->>'productId', item->>'sku'
  ), sales_by_id AS (
    SELECT product_id, sum(units)::float8 AS units, sum(value)::float8 AS value FROM item_sales
    WHERE NULLIF(product_id, '') IS NOT NULL GROUP BY product_id
  ), sales_by_sku AS (
    SELECT sku, sum(units)::float8 AS units, sum(value)::float8 AS value FROM item_sales
    WHERE NULLIF(product_id, '') IS NULL AND NULLIF(sku, '') IS NOT NULL GROUP BY sku
  ), catalog_source AS (
    SELECT data, count(*) OVER (PARTITION BY NULLIF(data->>'sku', '')) AS sku_count
    FROM bling_records WHERE client_id = ${query.clientId} AND kind = 'products'
  ), catalog AS (
    SELECT p.data, COALESCE(s.units, 0) + CASE WHEN p.sku_count = 1 THEN COALESCE(k.units, 0) ELSE 0 END AS units,
      COALESCE(s.value, 0) + CASE WHEN p.sku_count = 1 THEN COALESCE(k.value, 0) ELSE 0 END AS value
    FROM catalog_source p LEFT JOIN sales_by_id s ON s.product_id = p.data->>'id'
    LEFT JOIN sales_by_sku k ON k.sku = p.data->>'sku'
    WHERE (p.data->>'name' ILIKE ${isCatalog ? pattern : "%"} OR p.data->>'sku' ILIKE ${isCatalog ? pattern : "%"}) ${stockFilter}
  )`;
  const list =
    query.view === "customers"
      ? sql`SELECT to_jsonb(r) AS data FROM (SELECT * FROM filtered_buyers ORDER BY value DESC, id LIMIT ${pageSize} OFFSET ${offset}) r`
      : isCatalog
        ? sql`SELECT data || jsonb_build_object('units', units, 'value', value) AS data FROM catalog ORDER BY ${sort} LIMIT ${pageSize} OFFSET ${offset}`
        : sql`SELECT data || jsonb_build_object('channelName', channel_name, 'reconciliation', CASE WHEN matches IS NULL THEN 'other_channel' WHEN matches = 1 THEN 'matched' WHEN matches = 0 THEN 'unmatched' ELSE 'ambiguous' END) AS data FROM base ORDER BY data->>'day' DESC, data->>'id' DESC LIMIT ${pageSize} OFFSET ${offset}`;
  const total =
    query.view === "customers"
      ? sql`SELECT count(*)::int FROM filtered_buyers`
      : isCatalog
        ? sql`SELECT count(*)::int FROM catalog`
        : sql`SELECT count(*)::int FROM base`;
  const result = await db.execute(sql`${cte}, paged AS (${list}) SELECT
    jsonb_build_object(
      'orders', count(*), 'orderValue', COALESCE(sum((data->>'total')::numeric),0),
      'customers', count(DISTINCT NULLIF(data->>'customerId', '')),
      'matched', count(*) FILTER (WHERE matches = 1), 'unmatched', count(*) FILTER (WHERE matches = 0), 'ambiguous', count(*) FILTER (WHERE matches > 1),
      'units', COALESCE((SELECT sum(units) FROM item_sales),0),
      'repeatCustomers', (SELECT count(*) FROM filtered_buyers WHERE orders > 1),
      'channels', COALESCE((SELECT jsonb_agg(v) FROM (SELECT data->>'channelId' AS id, max(channel_name) AS name, count(*)::int AS orders, sum((data->>'total')::numeric) AS value FROM base GROUP BY data->>'channelId' ORDER BY value DESC) v), '[]'::jsonb),
      'daily', COALESCE((SELECT jsonb_agg(v) FROM (SELECT data->>'day' AS day, count(*)::int AS orders, sum((data->>'total')::numeric) AS value, count(DISTINCT NULLIF(data->>'customerId',''))::int AS customers FROM base GROUP BY data->>'day' ORDER BY day) v), '[]'::jsonb),
      'statuses', COALESCE((SELECT jsonb_agg(v) FROM (SELECT COALESCE(data->>'statusId','') AS id, count(*)::int AS orders, sum((data->>'total')::numeric) AS value FROM base GROUP BY data->>'statusId' ORDER BY orders DESC) v), '[]'::jsonb),
      'topProducts', COALESCE((SELECT jsonb_agg(v) FROM (SELECT product_id AS "productId", sku, name, units, value FROM item_sales ORDER BY value DESC, product_id, sku LIMIT 10) v), '[]'::jsonb),
      'catalog', (SELECT jsonb_build_object('products',count(*), 'active',count(*) FILTER (WHERE data->>'status' = 'A'),
        'knownStock',count(data->'stock'->>'available'), 'physical',COALESCE(sum((data->'stock'->>'physical')::numeric),0),
        'available',COALESCE(sum((data->'stock'->>'available')::numeric),0),
        'positive',count(*) FILTER (WHERE (data->'stock'->>'available')::numeric > 0),
        'zero',count(*) FILTER (WHERE (data->'stock'->>'available')::numeric = 0),
        'negative',count(*) FILTER (WHERE (data->'stock'->>'available')::numeric < 0),
        'unknown',count(*) FILTER (WHERE data->'stock'->>'available' IS NULL),
        'units',COALESCE(sum(units),0), 'value',COALESCE(sum(value),0)) FROM catalog),
      'coverage', (SELECT jsonb_build_object('from',min(data->>'day'), 'to',max(data->>'day')) FROM bling_records WHERE client_id = ${query.clientId} AND kind = 'orders')
    ) AS summary, (${total}) AS total,
    COALESCE((SELECT jsonb_agg(data) FROM paged), '[]'::jsonb) AS rows FROM base`);
  const row = result.rows[0];
  return {
    status,
    summary: row.summary,
    rows: row.rows,
    total: row.total,
    page: query.export ? 1 : query.page,
    channels: status.channels,
  };
}
