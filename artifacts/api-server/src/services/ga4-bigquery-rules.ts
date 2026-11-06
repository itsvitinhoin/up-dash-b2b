import type { Ga4DailyMetrics } from "./ga4";
import type { StoredProductViewKey } from "./ga4-daily-rules";
import { isBigQueryAvailable } from "./excluded-clients-rules";

// Regras puras do envio do GA4 ao BigQuery (sem rede nem banco), testaveis isoladamente.
//
// Destino: up-vesti-report.up_global (o mesmo lugar de ads_accounts e dos consolidados
// que o up_semantic le). Uma tabela para TODOS os clientes, com client_id, em vez de uma
// tabela por propriedade como no pipeline antigo (up-nuvem-reports.analytics_ga4_traffic):
// cliente novo com propriedade cadastrada entra sozinho, sem criar tabela nem lista fixa.

export const GA4_BQ_DATASET = "up_global";
export const GA4_BQ_DAILY_TABLE = "ga4_daily";
export const GA4_BQ_PRODUCTS_TABLE = "ga4_product_views_daily";

// Linhas por consulta de carga dos produtos. Cada linha vai como parametro da consulta
// (limite de ~10 MB por requisicao); com nome de produto e variante fica em ~250 bytes.
export const GA4_BQ_PRODUCT_BATCH = 4000;

export type Ga4BqClient = { clientId: string; clientName: string; propertyId: string };

export type Ga4DailyBqRow = {
  client_id: string;
  client_name: string;
  property_id: string;
  date: string;
  sessions: number;
  total_users: number;
  page_views: number;
  view_item: number;
  add_to_cart: number;
  begin_checkout: number;
  purchases: number;
  purchase_revenue: number;
};

export type Ga4ProductBqRow = {
  client_id: string;
  client_name: string;
  property_id: string;
  date: string;
  item_id: string;
  item_name: string;
  item_variant: string;
  items_viewed: number;
};

function whole(value: number | undefined): number {
  return Number.isFinite(value) ? Math.round(value as number) : 0;
}

function money(value: number | undefined): number {
  return Number.isFinite(value) ? Math.round((value as number) * 100) / 100 : 0;
}

/** Uma linha por dia (inclusive os dias com zero, ja preenchidos por fillGa4Days). */
export function buildGa4DailyBqRows(client: Ga4BqClient, rows: Ga4DailyMetrics[]): Ga4DailyBqRow[] {
  return rows.map((row) => ({
    client_id: client.clientId,
    client_name: client.clientName,
    property_id: client.propertyId,
    date: row.date,
    sessions: whole(row.sessions),
    total_users: whole(row.totalUsers),
    page_views: whole(row.pageViews),
    view_item: whole(row.productViews),
    add_to_cart: whole(row.addToCarts),
    begin_checkout: whole(row.checkouts),
    purchases: whole(row.purchases),
    purchase_revenue: money(row.purchaseRevenue),
  }));
}

/** Recebe as linhas ja normalizadas e somadas por toStoredProductViews ('' no lugar de null). */
export function buildGa4ProductBqRows(client: Ga4BqClient, rows: StoredProductViewKey[]): Ga4ProductBqRow[] {
  return rows.map((row) => ({
    client_id: client.clientId,
    client_name: client.clientName,
    property_id: client.propertyId,
    date: row.metricDate,
    item_id: row.itemId,
    item_name: row.itemName,
    item_variant: row.itemVariant,
    items_viewed: whole(row.views),
  }));
}

export function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) throw new Error("tamanho de lote invalido");
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

/**
 * Liga o envio ao BigQuery. Desligavel com GA4_BIGQUERY=0 (ou "false"/"off"); fora disso
 * liga sempre que ha credencial (Cloud Run Job, Vercel ou chave local). Em teste e
 * desenvolvimento sem credencial fica desligado, como a lista de contas de anuncio.
 */
export function isGa4BigQueryEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const flag = (env.GA4_BIGQUERY ?? "").trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") return false;
  return isBigQueryAvailable(env);
}
