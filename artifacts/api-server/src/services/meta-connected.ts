import { emptyMetaMarketingData, fetchMetaMarketingData, isMetaConnected, type MetaMarketingData } from "./meta-ads";
import { fetchStoredMarketingData } from "./stored-marketing";

/**
 * Dado de mídia (Meta) de um cliente. Lê do dado GUARDADO (BigQuery), sem chamar o Meta ao vivo: só a conta de anúncio importa, não o token.
 * Sem conta cadastrada = dado vazio (a tela carrega, como antes); com conta, leitura estrita (falha vira MediaReadError / HTTP 503, nunca zero).
 * Exceções (ainda ao vivo): filtro por nome de campanha (`campaignName`), porque o dado guardado do nível conta não separa campanha; e cliente MANUAL,
 * que mostra alcance/frequência do período (pessoas únicas não se somam dia a dia, então não dá para montar do dado guardado).
 * Fica fora de meta-ads.ts para a leitura ser trocável nos testes.
 */
export async function fetchMetaMarketingDataIfConnected(params: {
  accessToken?: string | null;
  adAccountId?: string | null;
  since: string;
  until: string;
  campaignName?: string;
  includeMedia?: boolean;
  /** `MANUAL` mantém a leitura ao vivo do Meta (ver acima). */
  commercePlatform?: string | null;
}): Promise<MetaMarketingData> {
  if (params.campaignName || params.commercePlatform === "MANUAL") {
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
