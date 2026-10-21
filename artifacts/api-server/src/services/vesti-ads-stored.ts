// Gasto de anúncios do cliente Vesti lido SÓ do dado guardado (BigQuery `data_ads_global.ads_insights_account`), nunca da API do Meta ao vivo.
//
// Princípio (Marcelo, 19/10/2026): a tela não depende de API de terceiro para mostrar dado; quem coleta é o sync (hoje o backend-dash,
// `ingestFacebookInsightsAccount`, uma linha por conta e por dia, nível conta = sem sobreposição de conversões). Antes o painel chamava o
// Graph ao vivo e só caía neste dado quando o ao vivo vinha zerado (quebra-galho de 05/08).
//
// Atenção para quem lê os números: o dado guardado é de coletas diárias, então o DIA DE HOJE só aparece depois da próxima coleta.
import { bigquery, vestiTable } from "../lib/bigquery";

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
  const sql = `
    SELECT
      FORMAT_DATE('%Y-%m-%d', date_start) AS day,
      COUNTIF(spend IS NULL) AS null_spend_rows,
      CAST(COALESCE(SUM(spend), 0) AS FLOAT64) AS spend,
      CAST(COALESCE(SUM(impressions), 0) AS INT64) AS impressions,
      CAST(COALESCE(SUM(clicks), 0) AS INT64) AS clicks,
      CAST(COALESCE(SUM(leads_qty), 0) AS INT64) AS leads,
      CAST(COALESCE(SUM(purchases_qty), 0) AS INT64) AS purchases,
      CAST(COALESCE(SUM(purchase_value), 0) AS FLOAT64) AS purchase_value
    FROM ${vestiTable("data_ads_global", "ads_insights_account")}
    WHERE ad_account_id = @adAccountId
      AND date_start BETWEEN @dateFrom AND @dateTo
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
