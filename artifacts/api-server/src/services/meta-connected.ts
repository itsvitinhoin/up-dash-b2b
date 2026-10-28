import { emptyMetaMarketingData, fetchMetaMarketingData, isMetaConnected, type MetaMarketingData } from "./meta-ads";
import { fetchStoredMarketingData } from "./stored-marketing";

/**
 * Dado de mídia (Meta) de um cliente. Lê do dado GUARDADO (BigQuery), sem chamar o Meta ao vivo: só a conta de anúncio importa, não o token.
 * Sem conta cadastrada = dado vazio (a tela carrega, como antes); com conta, leitura estrita (falha vira MediaReadError / HTTP 503, nunca zero).
 * Exceção: filtro por nome de campanha (`campaignName`) ainda precisa do ao vivo, porque o dado guardado do nível conta não separa campanha.
 * Fica fora de meta-ads.ts para a leitura ser trocável nos testes.
 */
export async function fetchMetaMarketingDataIfConnected(params: {
  accessToken?: string | null;
  adAccountId?: string | null;
  since: string;
  until: string;
  campaignName?: string;
  includeMedia?: boolean;
}): Promise<MetaMarketingData> {
  if (params.campaignName) {
    if (!isMetaConnected(params)) return emptyMetaMarketingData();
    return fetchMetaMarketingData({ ...params, accessToken: params.accessToken!, adAccountId: params.adAccountId! });
  }
  if (!params.adAccountId?.trim()) return emptyMetaMarketingData();
  return fetchStoredMarketingData({
    adAccountId: params.adAccountId,
    since: params.since,
    until: params.until,
    includeAds: params.includeMedia === true,
  });
}
