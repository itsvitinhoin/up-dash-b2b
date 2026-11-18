import { emptyMetaMarketingData, fetchMetaMarketingData, fetchMetaPeriodBreakdowns, isMetaConnected, type MetaMarketingData } from "./meta-ads";
import { topCreativesFromStored } from "./vesti-ads-stored";
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
  isB2C?: boolean;
  includeReach?: boolean;
}): Promise<MetaMarketingData> {
  // Stored ad purchases have duplicated conversion aliases in the old collector.
  // B2C financial/creative metrics must use one consistent native Meta dataset.
  if (params.isB2C && isMetaConnected(params)) {
    const credentials = { ...params, accessToken: params.accessToken!, adAccountId: params.adAccountId!, includeMedia: false, includeReach: false, summaryOnly: !params.includeMedia && !params.campaignName };
    const [live, stored, period] = await Promise.all([
      fetchMetaMarketingData(credentials),
      params.includeMedia ? fetchStoredMarketingData({ adAccountId: params.adAccountId, since: params.since, until: params.until, includeAds: true, isB2C: true }).catch(() => null) : Promise.resolve(null),
      params.includeReach && !params.campaignName ? fetchMetaPeriodBreakdowns(credentials) : Promise.resolve(null),
    ]);
    const thumbnails = new Map([...(stored?.topCreatives.ctr ?? []), ...(stored?.topCreatives.cpl ?? []), ...(stored?.topCreatives.leads ?? [])].map(row => [row.id, row.thumbnailUrl ?? row.imageUrl ?? null]));
    const ads = live.ads.map(row => ({ ...row, status: row.status ?? null, thumbnailUrl: thumbnails.get(row.id) ?? null }));
    return { ...live, regionalSpend: period?.regions, summary: { ...live.summary, reach: period?.reach ?? live.summary.reach, frequency: period?.frequency ?? live.summary.frequency }, topCreatives: params.includeMedia ? topCreativesFromStored(ads, true) : live.topCreatives };
  }
  if (params.campaignName || params.commercePlatform === "MANUAL") {
    if (!isMetaConnected(params)) return emptyMetaMarketingData();
    const live = await fetchMetaMarketingData({ ...params, accessToken: params.accessToken!, adAccountId: params.adAccountId! });
    if (params.includeReach && params.isB2C && !params.campaignName) {
      const period = await fetchMetaPeriodBreakdowns({ ...params, accessToken: params.accessToken!, adAccountId: params.adAccountId! });
      return { ...live, regionalSpend: period.regions };
    }
    return live;
  }
  if (!params.adAccountId?.trim()) return emptyMetaMarketingData();
  const stored = await fetchStoredMarketingData({
    adAccountId: params.adAccountId,
    since: params.since,
    until: params.until,
    includeAds: params.includeMedia === true,
    isB2C: params.isB2C,
  });
  if (params.includeReach && params.isB2C && isMetaConnected(params)) {
    try {
      const period = await fetchMetaPeriodBreakdowns({ ...params, accessToken: params.accessToken!, adAccountId: params.adAccountId! });
      return { ...stored, regionalSpend: period.regions, summary: { ...stored.summary, reach: period.reach, frequency: period.frequency } };
    } catch (err) {
      console.warn("[marketing] period reach/regions unavailable:", err instanceof Error ? err.message : err);
    }
  }
  return stored;
}
