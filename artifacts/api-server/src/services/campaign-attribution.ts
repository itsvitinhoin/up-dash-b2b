// Extraído de routes/analytics.ts em 03/09/2026 — lógica que decide se um
// evento de tracking da UpZero é evidência de mídia PAGA (Meta/Google Ads)
// vs. tráfego orgânico/próprio (link na bio, WhatsApp, etc). Extraído pra
// um serviço compartilhado (em vez de ficar perdida dentro do arquivo
// gigante de rotas) pra ficar testável e reutilizável — recomendação do
// PDF de atribuição da MX Fashion ("REUSO DE CODIGO").
import type { UpzeroAnalyticsMetric } from "./upzero/analytics-metrics";

export function normalizeCampaignText(value: string | null | undefined): string {
  return value?.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() ?? "";
}

// Campos m\u00ednimos pra decidir se um evento \u00e9 evid\u00eancia paga. `/analytics/metrics`
// (agregado por hora) e `/analytics/facts` (log bruto por evento) da UpZero t\u00eam
// nomes de campo id\u00eanticos pra tudo isso, s\u00f3 divergem no envelope ao redor
// (period_start vs occurred_at, presen\u00e7a de contadores agregados, etc) --
// aceitar s\u00f3 o subconjunto necess\u00e1rio deixa a fun\u00e7\u00e3o utiliz\u00e1vel nos dois casos.
export type PaidSignalFields = {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  source: string | null;
  channel: string | null;
  fbc?: string | null;
  fbclid?: string | null;
  gclid?: string | null;
};

export function isPaidCampaignSignal(row: PaidSignalFields): boolean {
  const source = normalizeCampaignText(row.utm_source);
  const medium = normalizeCampaignText(row.utm_medium);
  const campaign = normalizeCampaignText(row.utm_campaign);
  const channel = normalizeCampaignText(row.channel);
  const rawSource = normalizeCampaignText(row.source);

  const isLinktreeOnly =
    source === "instagram" &&
    medium === "linktree" &&
    campaign === "linktree";

  if (isLinktreeOnly) return false;

  const hasClickIdentifier = Boolean(row.fbc || row.fbclid || row.gclid);
  const hasMetaSource = ["fb", "facebook", "ig", "instagram", "meta"].includes(source);
  const hasGoogleSource = ["google", "google_ads", "googleads", "gads", "gc"].includes(source);
  const hasPaidMedium =
    medium.includes("paid") ||
    medium.includes("cpc") ||
    medium.includes("ppc") ||
    medium.includes("pmax");
  const hasMetaPlacement =
    medium.includes("facebook_mobile_feed") ||
    medium.includes("facebook_desktop_feed") ||
    medium.includes("facebook_stories") ||
    medium.includes("instagram_feed") ||
    medium.includes("instagram_stories") ||
    medium.includes("instagram_reels");
  const hasUpCampaign =
    campaign.includes("up.") ||
    campaign.includes("upzero") ||
    campaign.includes("up zero") ||
    campaign.includes("rmkt") ||
    campaign.includes("remarketing") ||
    campaign.includes("frio") ||
    campaign.includes("cadastro");
  const hasNumericMetaCampaign = hasMetaSource && /^[0-9]{8,}$/.test(campaign);
  const hasPaidChannel = channel.includes("paid") || channel.includes("ads") || rawSource.includes("ads");

  // Achado 03/09/2026 (PDF de atribuição MX Fashion, "Cenário 4"): uma
  // campanha nomeada sozinha (sem checar source/medium) contava como
  // sinal pago mesmo com medium claramente orgânico -- ex.:
  // utm_source=instagram&utm_medium=bio&utm_campaign=organico (link da
  // bio taggeado manualmente pra organização interna). Corrigido em duas
  // partes: (1) removida a condição solta "toda campanha nomeada conta
  // como paga"; (2) `medium === "bio"` é sempre link próprio taggeado
  // manualmente, nunca clique de anúncio -- mesmo com utm_source de rede
  // social e uma campanha nomeada, não conta como paga sozinho.
  return (
    hasClickIdentifier ||
    hasPaidMedium ||
    hasMetaPlacement ||
    hasUpCampaign ||
    hasNumericMetaCampaign ||
    hasPaidChannel ||
    (hasMetaSource && medium !== "bio" && campaign.length > 0 && campaign !== "linktree") ||
    (hasGoogleSource && medium !== "bio" && campaign.length > 0)
  );
}

export function latestCampaignEvidenceBefore(
  rows: UpzeroAnalyticsMetric[],
  date: Date,
): UpzeroAnalyticsMetric | null {
  const limit = date.getTime();
  let selected: UpzeroAnalyticsMetric | null = null;
  let selectedAt = -Infinity;
  for (const row of rows) {
    if (!isPaidCampaignSignal(row)) continue;
    const occurredAt = new Date(row.period_start).getTime();
    if (!Number.isFinite(occurredAt) || occurredAt > limit || occurredAt < selectedAt) continue;
    selected = row;
    selectedAt = occurredAt;
  }
  return selected;
}
