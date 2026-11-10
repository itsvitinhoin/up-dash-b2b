import type { Ga4DailyMetrics, Ga4ProductFunnelDay, Ga4TrafficDay } from "./ga4";
import type { StoredProductViewKey } from "./ga4-daily-rules";
import { isBigQueryAvailable } from "./excluded-clients-rules";

// Regras puras do envio do GA4 ao BigQuery (sem rede nem banco), testaveis isoladamente.
//
// Destino: up-vesti-report.up_global (o mesmo lugar de ads_accounts e dos consolidados
// que o up_semantic le). Uma tabela para TODOS os clientes, com client_id, em vez de uma
// tabela por propriedade como no pipeline antigo (up-nuvem-reports.analytics_ga4_traffic):
// cliente novo com propriedade cadastrada entra sozinho, sem criar tabela nem lista fixa.

export const GA4_BQ_DEFAULT_DATASET = "up_global";

/**
 * Dataset de destino. Padrao up_global (o que os agentes leem). GA4_BQ_DATASET desvia para outro dataset, usado na
 * primeira rodada de teste (job canario) para nao sujar o dado de producao. O nome entra em SQL, entao so aceita
 * letras, numeros e _; um valor invalido da ERRO em vez de cair no padrao, para que um erro de digitacao no canario
 * nunca acabe gravando em up_global.
 */
export function resolveGa4BigQueryDataset(env: Record<string, string | undefined> = process.env): string {
  const value = (env.GA4_BQ_DATASET ?? "").trim();
  if (!value) return GA4_BQ_DEFAULT_DATASET;
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error(`GA4_BQ_DATASET invalido: "${value}" (use so letras, numeros e _)`);
  return value;
}

export const GA4_BQ_DATASET = resolveGa4BigQueryDataset();
export const GA4_BQ_DAILY_TABLE = "ga4_daily";
export const GA4_BQ_PRODUCTS_TABLE = "ga4_product_views_daily";
// Origem do trafego (canal, origem, midia, campanha) por dia: so no BigQuery, nao ha copia no Postgres.
export const GA4_BQ_TRAFFIC_TABLE = "ga4_traffic_daily";
// Funil por produto (visto, carrinho, checkout, comprado e receita do item) por dia: so no BigQuery, nao ha copia no Postgres.
export const GA4_BQ_PRODUCT_FUNNEL_TABLE = "ga4_product_funnel_daily";

// Linhas por consulta de carga dos produtos. Cada linha vai como parametro da consulta
// (limite de ~10 MB por requisicao); com nome de produto e variante fica em ~250 bytes.
export const GA4_BQ_PRODUCT_BATCH = 4000;
// Idem para a origem do trafego: origem, midia e campanha (ate ~110 caracteres medidos) ficam em ~400 bytes por linha.
export const GA4_BQ_TRAFFIC_BATCH = 3000;
// Funil por produto: mesma conta, com 14 campos por linha.
export const GA4_BQ_PRODUCT_FUNNEL_BATCH = 3000;

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

export type Ga4TrafficBqRow = {
  client_id: string;
  client_name: string;
  property_id: string;
  date: string;
  channel_group: string;
  source: string;
  medium: string;
  campaign: string;
  sessions: number;
  total_users: number;
  engaged_sessions: number;
  add_to_cart: number;
  begin_checkout: number;
  purchases: number;
  purchase_revenue: number;
};

export type Ga4ProductFunnelBqRow = {
  client_id: string;
  client_name: string;
  property_id: string;
  date: string;
  item_id: string;
  item_name: string;
  item_variant: string;
  items_viewed: number;
  items_added_to_cart: number;
  items_checked_out: number;
  items_purchased: number;
  item_revenue: number;
  gross_item_revenue: number;
  item_refund_amount: number;
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

function label(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  return text || "(not set)";
}

/**
 * Uma linha por (dia, canal, origem, midia, campanha). Texto vazio vira "(not set)", o mesmo nome que o GA4 usa, e linhas que
 * caem na mesma chave depois de normalizar sao SOMADAS (a tabela do BigQuery nao tem chave primaria: duplicar aqui contaria
 * a venda duas vezes).
 */
export function buildGa4TrafficBqRows(client: Ga4BqClient, rows: Ga4TrafficDay[]): Ga4TrafficBqRow[] {
  const byKey = new Map<string, Ga4TrafficBqRow>();
  for (const row of rows) {
    const channelGroup = label(row.channelGroup);
    const source = label(row.source);
    const medium = label(row.medium);
    const campaign = label(row.campaign);
    const key = [row.date, channelGroup, source, medium, campaign].join("\u0000");
    const current = byKey.get(key);
    if (current) {
      current.sessions += whole(row.sessions);
      current.total_users += whole(row.totalUsers);
      current.engaged_sessions += whole(row.engagedSessions);
      current.add_to_cart += whole(row.addToCarts);
      current.begin_checkout += whole(row.checkouts);
      current.purchases += whole(row.purchases);
      current.purchase_revenue = money(current.purchase_revenue + money(row.purchaseRevenue));
      continue;
    }
    byKey.set(key, {
      client_id: client.clientId,
      client_name: client.clientName,
      property_id: client.propertyId,
      date: row.date,
      channel_group: channelGroup,
      source,
      medium,
      campaign,
      sessions: whole(row.sessions),
      total_users: whole(row.totalUsers),
      engaged_sessions: whole(row.engagedSessions),
      add_to_cart: whole(row.addToCarts),
      begin_checkout: whole(row.checkouts),
      purchases: whole(row.purchases),
      purchase_revenue: money(row.purchaseRevenue),
    });
  }
  return [...byKey.values()];
}

/**
 * Uma linha por (dia, produto, nome, variante). Item sem id, nome ou variante vira texto vazio (o BigQuery guarda NULL, como na tabela
 * de visualizacoes de produto, entao as duas se juntam pelas mesmas chaves) e linhas que caem na mesma chave depois de normalizar sao
 * SOMADAS: a tabela nao tem chave primaria e duplicar contaria a venda duas vezes. Receita negativa (estorno) e dado real e fica.
 */
export function buildGa4ProductFunnelBqRows(client: Ga4BqClient, rows: Ga4ProductFunnelDay[]): Ga4ProductFunnelBqRow[] {
  const byKey = new Map<string, Ga4ProductFunnelBqRow>();
  for (const row of rows) {
    const itemId = (row.itemId ?? "").trim();
    const itemName = (row.itemName ?? "").trim();
    const itemVariant = (row.itemVariant ?? "").trim();
    const key = [row.date, itemId, itemName, itemVariant].join("\u0000");
    const current = byKey.get(key);
    if (current) {
      current.items_viewed += whole(row.itemsViewed);
      current.items_added_to_cart += whole(row.itemsAddedToCart);
      current.items_checked_out += whole(row.itemsCheckedOut);
      current.items_purchased += whole(row.itemsPurchased);
      current.item_revenue = money(current.item_revenue + money(row.itemRevenue));
      current.gross_item_revenue = money(current.gross_item_revenue + money(row.grossItemRevenue));
      current.item_refund_amount = money(current.item_refund_amount + money(row.itemRefundAmount));
      continue;
    }
    byKey.set(key, {
      client_id: client.clientId,
      client_name: client.clientName,
      property_id: client.propertyId,
      date: row.date,
      item_id: itemId,
      item_name: itemName,
      item_variant: itemVariant,
      items_viewed: whole(row.itemsViewed),
      items_added_to_cart: whole(row.itemsAddedToCart),
      items_checked_out: whole(row.itemsCheckedOut),
      items_purchased: whole(row.itemsPurchased),
      item_revenue: money(row.itemRevenue),
      gross_item_revenue: money(row.grossItemRevenue),
      item_refund_amount: money(row.itemRefundAmount),
    });
  }
  return [...byKey.values()];
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
