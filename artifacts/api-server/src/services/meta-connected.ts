import { emptyMetaMarketingData, fetchMetaMarketingData, isMetaConnected, type MetaMarketingData } from "./meta-ads";

/**
 * Cliente sem Meta conectado = dado vazio (a tela carrega, como antes); conectado = leitura estrita
 * (falha vira MediaReadError / HTTP 503, nunca zero). Fica fora de meta-ads.ts para a leitura ser trocável nos testes.
 */
export async function fetchMetaMarketingDataIfConnected(params: {
  accessToken?: string | null;
  adAccountId?: string | null;
  since: string;
  until: string;
  campaignName?: string;
}): Promise<MetaMarketingData> {
  if (!isMetaConnected(params)) return emptyMetaMarketingData();
  return fetchMetaMarketingData({ ...params, accessToken: params.accessToken!, adAccountId: params.adAccountId! });
}
