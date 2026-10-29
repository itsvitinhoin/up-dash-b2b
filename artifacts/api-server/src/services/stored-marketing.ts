// Dado de anúncios (Meta) de clientes UpZero, Nuvemshop e Manual lido SÓ do dado guardado (BigQuery `data_ads_global`), nunca do Graph ao vivo.
//
// Mesmo princípio que já vale para a Vesti (vesti-ads-stored.ts, 19/10/2026): a tela não depende de API de terceiro; quem coleta é o sync diário.
// Este adaptador devolve o MESMO formato que o código dessas telas já esperava do Meta (`MetaMarketingData`), então quem o chama não muda.
// Contexto: em 27/10/2026 o app "UP Dash" foi bloqueado no limite do Meta (milhares de chamadas de mídia por dia), e a coleta de todas as plataformas
// já grava o gasto no BigQuery (backfill de 26/10).
//
// Regras (as mesmas da Vesti): sem conta de anúncio = dado vazio (não há o que ler); falha ou leitura incompleta = MediaReadError (HTTP 503),
// nunca R$ 0,00. O DIA DE HOJE só aparece depois da próxima coleta (diária, 02h).
import { MediaReadError, emptyMetaMarketingData, type MetaAdMetric, type MetaDailyPoint, type MetaMarketingData } from "./meta-ads";
import { cached } from "../lib/queryCache";
import {
  fetchStoredAds,
  fetchStoredAdsDaily,
  fetchStoredCampaigns,
  storedAccountId,
  toMetaAdMetric,
  topCreativesFromStored,
  type StoredAd,
} from "./vesti-ads-stored";

const STORED_CACHE_TTL_MS = 5 * 60 * 1000;

export type StoredMarketingParams = {
  adAccountId: string | null | undefined;
  since: string;
  until: string;
  /** Lista de anúncios (para gravar na tabela `creatives`) e os melhores criativos com miniatura. Só quem usa pede. */
  includeAds?: boolean;
};

function dailyPoint(day: { date: string; spend: number; impressions: number; clicks: number; leads: number; purchases: number; purchaseValue: number }): MetaDailyPoint {
  return {
    date: day.date,
    spend: day.spend,
    impressions: day.impressions,
    clicks: day.clicks,
    leads: day.leads,
    purchases: day.purchases,
    revenue: day.purchaseValue,
    cpl: day.leads > 0 ? day.spend / day.leads : null,
  };
}

function summarize(daily: MetaDailyPoint[]): MetaMarketingData["summary"] {
  const spend = daily.reduce((sum, p) => sum + p.spend, 0);
  const impressions = daily.reduce((sum, p) => sum + p.impressions, 0);
  const clicks = daily.reduce((sum, p) => sum + p.clicks, 0);
  const leads = daily.reduce((sum, p) => sum + p.leads, 0);
  const purchases = daily.reduce((sum, p) => sum + p.purchases, 0);
  const revenue = daily.reduce((sum, p) => sum + p.revenue, 0);
  return {
    spend, impressions, clicks, leads, purchases, revenue,
    // Alcance e frequência do período são pessoas únicas: não se somam dia a dia, então o dado guardado não os tem (só o Meta ao vivo, no cliente Manual).
    reach: null,
    frequency: null,
    ctr: impressions > 0 ? clicks / impressions * 100 : null,
    cpc: clicks > 0 ? spend / clicks : null,
    cpm: impressions > 0 ? spend / impressions * 1000 : null,
    roas: spend > 0 ? revenue / spend : null,
    cpa: purchases > 0 ? spend / purchases : null,
    cpl: leads > 0 ? spend / leads : null,
  };
}

export async function fetchStoredMarketingData(params: StoredMarketingParams): Promise<MetaMarketingData> {
  const account = storedAccountId(params.adAccountId);
  if (!account) return emptyMetaMarketingData();
  const { since, until } = params;
  const key = `stored-marketing:${account}:${since}:${until}:${params.includeAds ? "ads" : "base"}`;
  try {
    return await cached(key, STORED_CACHE_TTL_MS, async () => {
      const [days, campaigns, ads] = await Promise.all([
        fetchStoredAdsDaily(account, since, until),
        fetchStoredCampaigns(account, since, until),
        params.includeAds ? fetchStoredAds(account, since, until) : Promise.resolve<StoredAd[]>([]),
      ]);
      const daily = days.map(dailyPoint);
      const adMetrics: MetaAdMetric[] = ads.map((ad) => toMetaAdMetric(ad, since, until));
      return {
        daily,
        ads: adMetrics,
        campaigns: campaigns.map((campaign) => toMetaAdMetric(campaign, since, until)),
        topCreatives: params.includeAds ? topCreativesFromStored(ads) : { ctr: [], cpl: [], leads: [] },
        summary: summarize(daily),
      };
    });
  } catch (err) {
    console.warn("[marketing] dado guardado de anúncios indisponível:", err instanceof Error ? err.message : err);
    throw new MediaReadError();
  }
}
