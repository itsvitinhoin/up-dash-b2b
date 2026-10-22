// Gasto de anúncios do cliente Vesti lido SÓ do dado guardado (BigQuery `data_ads_global.ads_insights_account`), nunca da API do Meta ao vivo.
//
// Princípio (Marcelo, 19/10/2026): a tela não depende de API de terceiro para mostrar dado; quem coleta é o sync (hoje o backend-dash,
// `ingestFacebookInsightsAccount`, uma linha por conta e por dia, nível conta = sem sobreposição de conversões). Antes o painel chamava o
// Graph ao vivo e só caía neste dado quando o ao vivo vinha zerado (quebra-galho de 05/08).
//
// Atenção para quem lê os números: o dado guardado é de coletas diárias, então o DIA DE HOJE só aparece depois da próxima coleta.
import { bigquery, vestiTable } from "../lib/bigquery";
import type { MetaAdMetric, MetaCreativeMetric, MetaTopCreatives } from "./meta-ads";

export type StoredAdsDay = {
  /** YYYY-MM-DD */
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  purchases: number;
  purchaseValue: number;
};

export type StoredAdsQuery = (sql: string, params: Record<string, string>) => Promise<Array<Record<string, unknown>>>;

const defaultQuery: StoredAdsQuery = async (sql, params) => {
  const [rows] = await bigquery.query({ query: sql, params });
  return rows as Array<Record<string, unknown>>;
};

/** O BigQuery devolve NUMERIC como objeto (Big) e INTEGER como número ou texto: tudo vira número finito (ou 0). */
export function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(typeof value === "object" ? (value as { toString(): string }).toString() : value);
  return Number.isFinite(n) ? n : 0;
}

/** "act_123", "act=123" e "123" viram "act_123" (formato gravado pela coleta). Vazio = null. */
export function storedAccountId(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("act_")) return trimmed;
  if (trimmed.startsWith("act=")) return `act_${trimmed.slice(4)}`;
  return `act_${trimmed}`;
}

/** Um dia por linha, em ordem crescente, para a conta e o período (datas YYYY-MM-DD, inclusive nas duas pontas). */
export async function fetchStoredAdsDaily(
  adAccountId: string,
  dateFrom: string,
  dateTo: string,
  query: StoredAdsQuery = defaultQuery,
): Promise<StoredAdsDay[]> {
  const account = storedAccountId(adAccountId);
  if (!account) return [];
  // O dado guardado tem DIAS REPETIDOS no histórico antigo (cópias idênticas; ex.: Venoro e Milalai até 25/05/2026, medido em 22/10/2026). Soma-se
  // UMA linha por dia (a mais recente), senão o período antigo sairia em dobro. Quando não há repetição, o resultado é o mesmo de antes.
  const sql = `
    WITH unique_days AS (
      SELECT *
      FROM ${vestiTable("data_ads_global", "ads_insights_account")}
      WHERE ad_account_id = @adAccountId
        AND date_start BETWEEN @dateFrom AND @dateTo
      QUALIFY ROW_NUMBER() OVER (PARTITION BY date_start ORDER BY ingestion_timestamp DESC, last_updated DESC) = 1
    )
    SELECT
      FORMAT_DATE('%Y-%m-%d', date_start) AS day,
      COUNTIF(spend IS NULL) AS null_spend_rows,
      CAST(COALESCE(SUM(spend), 0) AS FLOAT64) AS spend,
      CAST(COALESCE(SUM(impressions), 0) AS INT64) AS impressions,
      CAST(COALESCE(SUM(clicks), 0) AS INT64) AS clicks,
      CAST(COALESCE(SUM(leads_qty), 0) AS INT64) AS leads,
      CAST(COALESCE(SUM(purchases_qty), 0) AS INT64) AS purchases,
      CAST(COALESCE(SUM(purchase_value), 0) AS FLOAT64) AS purchase_value
    FROM unique_days
    GROUP BY day
    ORDER BY day
  `;
  const rows = await query(sql, { adAccountId: account, dateFrom, dateTo });
  // Linha guardada sem valor de gasto = leitura incompleta: não vale como zero (regra "indisponível não é zero", 21/10/2026).
  if (rows.some((row) => toNumber(row.null_spend_rows) > 0)) throw new Error("Leitura de gasto incompleta no dado guardado.");
  return rows
    .map((row) => ({
      date: String(row.day ?? ""),
      spend: toNumber(row.spend),
      impressions: toNumber(row.impressions),
      clicks: toNumber(row.clicks),
      leads: toNumber(row.leads),
      purchases: toNumber(row.purchases),
      purchaseValue: toNumber(row.purchase_value),
    }))
    .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.date));
}

export function totalSpend(days: StoredAdsDay[]): number {
  return days.reduce((sum, day) => sum + day.spend, 0);
}

/** Série para os gráficos: gasto por dia (só dias com dado coletado). */
export function spendSeries(days: StoredAdsDay[]): Array<{ date: string; value: number }> {
  return days.map((day) => ({ date: day.date, value: day.spend }));
}

// ── Campanhas, anúncios e criativos ────────────────────────────────────────────────────────────
// Mesma fonte guardada (`data_ads_global`), agora no nível anúncio por dia (`ads_insights`). Conferido em 21/10/2026: não há linhas
// por região/idade/gênero/posicionamento (todas essas colunas vêm vazias) e a soma por conta bate com `ads_insights_account` (razão 1,000
// nas maiores contas), então somar por campanha e por anúncio não conta nada em dobro.
// Nome e imagem do anúncio vêm de `ads_details`; status da campanha vem de `ads_campaigns` (ambas guardam várias versões: vale a última por
// `last_updated`). ATENÇÃO: em `ads_details` o id da conta é gravado SEM o prefixo "act_", nas outras tabelas vem com ele.
// Diferença conhecida para o ao vivo: aqui "cliques" são todos os cliques (campo `clicks` da coleta); o ao vivo usava cliques no link.
// O CTR guardado fica um pouco maior. É a mesma base que o dash legado usa.

export type StoredCampaign = {
  id: string;
  name: string;
  status: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  purchases: number;
  revenue: number;
};

export type StoredAd = StoredCampaign & { thumbnailUrl: string | null };

/** Teto de segurança por consulta (uma conta grande tem ~100 anúncios com gasto por mês). */
const MAX_STORED_ROWS = 2000;

const AGGREGATES = `
      COUNTIF(spend IS NULL) AS null_spend_rows,
      CAST(COALESCE(SUM(spend), 0) AS FLOAT64) AS spend,
      CAST(COALESCE(SUM(impressions), 0) AS INT64) AS impressions,
      CAST(COALESCE(SUM(clicks), 0) AS INT64) AS clicks,
      CAST(COALESCE(SUM(leads_qty), 0) AS INT64) AS leads,
      CAST(COALESCE(SUM(purchases_qty), 0) AS INT64) AS purchases,
      CAST(COALESCE(SUM(purchase_value), 0) AS FLOAT64) AS revenue`;

// Nível anúncio: o histórico antigo também tem linhas repetidas (cópias idênticas, sem quebra por região/idade: Venoro, Milalai, e dias de dez/2025 em
// várias contas). Vale uma linha por (campanha, conjunto, anúncio, dia e quebras), a mais recente. As quebras entram na chave para nunca juntar linhas
// que sejam fatias diferentes do mesmo anúncio.
const DEDUPE_AD_ROWS =
  "QUALIFY ROW_NUMBER() OVER (PARTITION BY campaign_id, adset_id, ad_id, date_start, region, age, gender, placement, device_platform " +
  "ORDER BY ingestion_timestamp DESC, last_updated DESC) = 1";

function assertComplete(rows: Array<Record<string, unknown>>): void {
  if (rows.some((row) => toNumber(row.null_spend_rows) > 0)) throw new Error("Leitura de gasto incompleta no dado guardado.");
}

function metricsOf(row: Record<string, unknown>) {
  return {
    spend: toNumber(row.spend),
    impressions: toNumber(row.impressions),
    clicks: toNumber(row.clicks),
    leads: toNumber(row.leads),
    purchases: toNumber(row.purchases),
    revenue: toNumber(row.revenue),
  };
}

const textOrNull = (value: unknown): string | null => {
  const text = value === null || value === undefined ? "" : String(value).trim();
  return text === "" ? null : text;
};

/** Campanhas com gasto no período, da maior para a menor, com o status atual da campanha. */
export async function fetchStoredCampaigns(
  adAccountId: string,
  dateFrom: string,
  dateTo: string,
  query: StoredAdsQuery = defaultQuery,
): Promise<StoredCampaign[]> {
  const account = storedAccountId(adAccountId);
  if (!account) return [];
  const sql = `
    WITH unique_rows AS (
      SELECT *
      FROM ${vestiTable("data_ads_global", "ads_insights")}
      WHERE ad_account_id = @adAccountId
        AND date_start BETWEEN @dateFrom AND @dateTo
        AND campaign_id IS NOT NULL
      ${DEDUPE_AD_ROWS}
    ), period AS (
      SELECT
        campaign_id,
        ARRAY_AGG(campaign_name IGNORE NULLS ORDER BY date_start DESC LIMIT 1)[SAFE_OFFSET(0)] AS name,${AGGREGATES}
      FROM unique_rows
      GROUP BY campaign_id
    ), latest_status AS (
      SELECT campaign_id, status
      FROM ${vestiTable("data_ads_global", "ads_campaigns")}
      WHERE ad_account_id = @adAccountId
      QUALIFY ROW_NUMBER() OVER (PARTITION BY campaign_id ORDER BY last_updated DESC) = 1
    )
    SELECT p.campaign_id AS id, p.name, s.status, p.null_spend_rows, p.spend, p.impressions, p.clicks, p.leads, p.purchases, p.revenue
    FROM period p
    LEFT JOIN latest_status s ON s.campaign_id = p.campaign_id
    ORDER BY p.spend DESC
    LIMIT ${MAX_STORED_ROWS}
  `;
  const rows = await query(sql, { adAccountId: account, dateFrom, dateTo });
  assertComplete(rows);
  return rows
    .map((row) => {
      const id = textOrNull(row.id);
      return id ? { id, name: textOrNull(row.name) ?? `Campanha ${id}`, status: textOrNull(row.status), ...metricsOf(row) } : null;
    })
    .filter((campaign): campaign is StoredCampaign => campaign !== null);
}

/** Anúncios com gasto no período, do maior para o menor, com nome, status e imagem (miniatura) do anúncio. */
export async function fetchStoredAds(
  adAccountId: string,
  dateFrom: string,
  dateTo: string,
  query: StoredAdsQuery = defaultQuery,
): Promise<StoredAd[]> {
  const account = storedAccountId(adAccountId);
  if (!account) return [];
  const sql = `
    WITH unique_rows AS (
      SELECT *
      FROM ${vestiTable("data_ads_global", "ads_insights")}
      WHERE ad_account_id = @adAccountId
        AND date_start BETWEEN @dateFrom AND @dateTo
        AND ad_id IS NOT NULL
      ${DEDUPE_AD_ROWS}
    ), period AS (
      SELECT
        ad_id,
        ARRAY_AGG(campaign_name IGNORE NULLS ORDER BY date_start DESC LIMIT 1)[SAFE_OFFSET(0)] AS campaign_name,${AGGREGATES}
      FROM unique_rows
      GROUP BY ad_id
    ), latest_details AS (
      SELECT ad_id, name, status, thumbnail_url
      FROM ${vestiTable("data_ads_global", "ads_details")}
      WHERE REGEXP_REPLACE(ad_account_id, r'^act_', '') = @adAccountIdBare
      QUALIFY ROW_NUMBER() OVER (PARTITION BY ad_id ORDER BY last_updated DESC) = 1
    )
    SELECT p.ad_id AS id, d.name AS name, p.campaign_name, d.status, d.thumbnail_url, p.null_spend_rows, p.spend, p.impressions, p.clicks, p.leads, p.purchases, p.revenue
    FROM period p
    LEFT JOIN latest_details d ON d.ad_id = p.ad_id
    ORDER BY p.spend DESC
    LIMIT ${MAX_STORED_ROWS}
  `;
  const rows = await query(sql, { adAccountId: account, adAccountIdBare: account.replace(/^act_/, ""), dateFrom, dateTo });
  assertComplete(rows);
  return rows
    .map((row) => {
      const id = textOrNull(row.id);
      if (!id) return null;
      return {
        id,
        name: textOrNull(row.name) ?? textOrNull(row.campaign_name) ?? `Anúncio ${id}`,
        status: textOrNull(row.status),
        thumbnailUrl: textOrNull(row.thumbnail_url),
        ...metricsOf(row),
      };
    })
    .filter((ad): ad is StoredAd => ad !== null);
}

export const ctrOf = (item: { clicks: number; impressions: number }): number => (item.impressions > 0 ? (item.clicks / item.impressions) * 100 : 0);

/** Mesmo formato que a tela já consome do Meta ao vivo (MetaAdMetric). */
export function toMetaAdMetric(item: StoredCampaign | StoredAd, dateStart: string, dateStop: string): MetaAdMetric {
  return {
    id: item.id,
    name: item.name,
    status: item.status ?? undefined,
    spend: item.spend,
    impressions: item.impressions,
    clicks: item.clicks,
    leads: item.leads,
    purchases: item.purchases,
    revenue: item.revenue,
    roas: item.spend > 0 ? item.revenue / item.spend : null,
    cpl: item.leads > 0 ? item.spend / item.leads : null,
    cpa: item.purchases > 0 ? item.spend / item.purchases : null,
    dateStart,
    dateStop,
  };
}

function toCreative(ad: StoredAd): MetaCreativeMetric {
  return {
    id: ad.id,
    name: ad.name,
    status: ad.status ?? "UNKNOWN",
    spend: ad.spend,
    impressions: ad.impressions,
    clicks: ad.clicks,
    ctr: ctrOf(ad),
    leads: ad.leads,
    purchases: ad.purchases,
    cpl: ad.leads > 0 ? ad.spend / ad.leads : 0,
    cpa: ad.purchases > 0 ? ad.spend / ad.purchases : 0,
    previewUrl: null,
    thumbnailUrl: ad.thumbnailUrl,
    imageUrl: ad.thumbnailUrl,
    videoUrl: null,
    mediaType: ad.thumbnailUrl ? "image" : "unknown",
  };
}

/** Top 5 por CTR, menor custo por lead e mais leads (mesmas regras que o ao vivo usava). */
export function topCreativesFromStored(ads: StoredAd[]): MetaTopCreatives {
  const base = ads.map(toCreative);
  return {
    ctr: base
      .filter((ad) => ad.impressions > 0 && ad.clicks > 0)
      .sort((a, b) => b.ctr - a.ctr)
      .slice(0, 5),
    cpl: base
      .filter((ad) => ad.leads > 0 && ad.cpl > 0)
      .sort((a, b) => a.cpl - b.cpl)
      .slice(0, 5),
    leads: base
      .filter((ad) => ad.leads > 0)
      .sort((a, b) => b.leads - a.leads)
      .slice(0, 5),
  };
}
