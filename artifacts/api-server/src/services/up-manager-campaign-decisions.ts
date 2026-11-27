import type { B2cFinding } from "./up-manager-b2c";
import type { MetaMarketingData, MetaAdMetric } from "./meta-ads";
import type { CampaignSnapshot } from "./product-campaign-monitor";
import type { ManagerPeriod } from "./up-manager";
import { productCampaignRecommendations } from "./product-campaign-recommendations";

export type CampaignDecision =
  | "pause"
  | "scale"
  | "reduce"
  | "hold"
  | "insufficient";

const ratio = (n: number, d: number) => (d > 0 ? n / d : null);

export function decideManagerCampaigns({
  media,
  previousMedia,
  monitor,
  currency,
  window,
}: {
  media: MetaMarketingData | null;
  previousMedia: MetaMarketingData | null;
  monitor: { snapshot: CampaignSnapshot | null; stale: boolean };
  currency: string;
  window: ManagerPeriod;
}) {
  const money = new Intl.NumberFormat("pt-BR", { currency, style: "currency" });
  const snapshot = !monitor.stale ? monitor.snapshot : null;
  const comparable = snapshot?.currency === currency;
  const report = media?.campaigns ?? [];
  const previous = new Map(
    previousMedia?.campaigns.map((row) => [row.id, row]),
  );
  const reference =
    comparable && previousMedia && previousMedia.summary.purchases >= 10
      ? ratio(previousMedia.summary.spend, previousMedia.summary.purchases)
      : null;
  const target = reference !== null && reference > 0 ? reference : null;
  const byCampaign = new Map<
    string,
    {
      name: string;
      ads: Set<string>;
      unverified: Set<string>;
      disrupted: Set<string>;
      products: Set<string>;
    }
  >();
  const rollup = (id: string, name: string) => {
    const existing = byCampaign.get(id);
    if (existing) return existing;
    const row = {
      name,
      ads: new Set<string>(),
      unverified: new Set<string>(),
      disrupted: new Set<string>(),
      products: new Set<string>(),
    };
    byCampaign.set(id, row);
    return row;
  };
  for (const row of snapshot?.rows ?? []) {
    for (const ad of row.ads) {
      if (!ad.campaignId) continue;
      const entry = rollup(ad.campaignId, ad.campaignName);
      entry.ads.add(ad.id);
      entry.products.add(row.name);
      if (
        row.grade !== "complete" ||
        row.unavailable ||
        !row.publicationConfirmed
      )
        entry.disrupted.add(ad.id);
    }
  }
  for (const { ad } of snapshot?.unidentified ?? []) {
    if (!ad.campaignId) continue;
    const entry = rollup(ad.campaignId, ad.campaignName);
    entry.ads.add(ad.id);
    entry.unverified.add(ad.id);
  }
  const exactPauses = snapshot ? productCampaignRecommendations(snapshot) : [];
  const approvedPauseIds = new Set(
    exactPauses.map(({ evidence }) => evidence.adId),
  );
  const coveredByAllPaused = new Set(
    [...byCampaign]
      .filter(
        ([, row]) =>
          row.ads.size > 0 &&
          row.unverified.size === 0 &&
          [...row.ads].every((id) => approvedPauseIds.has(id)),
      )
      .map(([id]) => id),
  );
  const findings: B2cFinding[] = [];
  const rows = new Map<
    string,
    { id: string; name: string; metric: MetaAdMetric | null }
  >();
  for (const [id, row] of byCampaign)
    rows.set(id, { id, name: row.name, metric: null });
  for (const metric of report) {
    if (metric.status === "ACTIVE" || rows.has(metric.id))
      rows.set(metric.id, { id: metric.id, name: metric.name, metric });
  }
  const decisions = [...rows.values()]
    .map(({ id, name, metric }) => {
      const check = byCampaign.get(id);
      const prior = previous.get(id) ?? null;
      const cpa = metric ? ratio(metric.spend, metric.purchases) : null;
      const priorCpa = prior ? ratio(prior.spend, prior.purchases) : null;
      const confirmedStable =
        check &&
        check.ads.size > 0 &&
        !check.unverified.size &&
        !check.disrupted.size;
      const spend = metric?.spend ?? null;
      const purchases = metric?.purchases ?? null;
      const priced = metric && spend !== null && spend > 0 && target !== null;
      const completeStockout = coveredByAllPaused.has(id);
      let decision: CampaignDecision = "hold";
      let reason =
        "Sem sinal suficiente para alterar o orçamento nesta rodada.";
      if (completeStockout) {
        decision = "pause";
        reason = `Todos os ${check!.ads.size} anúncios ativos têm destino específico com saldo zero confirmado.`;
      } else if (!priced) {
        decision = "insufficient";
        reason =
          "Janela da Meta ou referência de CPA sem cobertura suficiente.";
      } else if (
        purchases === 0 &&
        spend >= target * 3 &&
        prior &&
        prior.purchases === 0 &&
        prior.spend >= target
      ) {
        decision = "pause";
        reason = `${money.format(spend)} gastos com zero compras atribuídas na janela madura; a janela anterior também ficou sem compras. CPA de referência da conta: ${money.format(target)}.`;
      } else if (
        purchases !== null &&
        purchases >= 8 &&
        cpa !== null &&
        priorCpa !== null &&
        prior!.purchases >= 5 &&
        cpa <= target * 0.8 &&
        cpa <= priorCpa * 1.1 &&
        confirmedStable
      ) {
        decision = "scale";
        reason = `${purchases} compras atribuídas a ${money.format(cpa)} por compra, abaixo dos ${money.format(target)} da conta. Todos os ${check.ads.size} destinos ativos foram vinculados e estão com grade completa.`;
      } else if (
        cpa !== null &&
        priorCpa !== null &&
        purchases !== null &&
        purchases >= 3 &&
        prior!.purchases >= 5 &&
        cpa >= target * 1.35 &&
        cpa >= priorCpa * 1.25
      ) {
        decision = "reduce";
        reason = `CPA passou de ${money.format(priorCpa)} para ${money.format(cpa)} com ${purchases} compras atribuídas, acima da referência de ${money.format(target)}.`;
      } else if (!confirmedStable) {
        reason = check?.disrupted.size
          ? `${check.disrupted.size} destino(s) ativo(s) com grade, disponibilidade ou estoque sem confirmação suficiente para ampliar.`
          : "Cobertura de destinos insuficiente para recomendar escala.";
      }
      if (
        decision === "pause" ||
        decision === "scale" ||
        decision === "reduce"
      ) {
        const { label, action, followUp } =
          decision === "pause"
            ? {
                label: "Pausar campanha",
                action: completeStockout
                  ? `Aprovar a pausa de ${name}. Retomar quando os destinos voltarem a ter estoque.`
                  : `Aprovar a pausa de ${name} e preservar a verba para campanhas com compras verificadas.`,
                followUp: completeStockout
                  ? "Reativar somente após o estoque confirmado dos destinos."
                  : "Reavaliar com a próxima leitura de atribuição e verificar se houve compras tardias.",
              }
            : decision === "scale"
              ? {
                  label: "Escalar com teste",
                  action: `Aprovar um aumento entre 15% e 20% para ${name}.`,
                  followUp: `Rever em 72 h. Recuar se o CPA ultrapassar ${money.format(target!)} ou a grade deixar de suportar a entrega.`,
                }
              : {
                  label: "Reduzir verba",
                  action: `Aprovar corte de 10% da verba de ${name} e manter a observação.`,
                  followUp:
                    "Reavaliar em 72 h pelo CPA atribuído, compras e efeito no volume da conta.",
                };
        findings.push({
          id: `campaign-decision:${id}`,
          title: `${label} · ${name}`,
          section: "campaigns",
          focus: "campaigns",
          priority: completeStockout
            ? "P0"
            : decision === "scale"
              ? "P2"
              : "P1",
          evidence: reason,
          hypothesis: reason,
          action,
          owner: "Gestão de mídia",
          followUp,
        });
      }
      return {
        id,
        name,
        decision,
        reason,
        spend,
        purchases,
        cpa,
        priorCpa,
        roas: metric?.roas ?? null,
        activeAds: check?.ads.size ?? null,
        unverifiedAds: check?.unverified.size ?? null,
        products: [...(check?.products ?? [])],
      };
    })
    .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0));
  const activeRows = new Set(
    [...byCampaign]
      .filter(([id]) => !coveredByAllPaused.has(id))
      .map(([id]) => id),
  );
  for (const { evidence } of exactPauses) {
    const knownGroup = [...byCampaign].find(([, row]) =>
      row.ads.has(evidence.adId),
    )?.[0];
    if (knownGroup && !activeRows.has(knownGroup)) continue;
    findings.push({
      id: `ad-decision:${evidence.adId}`,
      title: `Pausar anúncio · ${evidence.adName}`,
      section: "campaigns",
      focus: "campaigns",
      priority: "P0",
      owner: "Gestão de mídia",
      evidence: `Destino verificado de ${evidence.productName} sem estoque. Anúncio ativo com ${evidence.impressions} impressões na leitura da Meta.`,
      hypothesis:
        "O destino desse anúncio não tinha variante disponível na checagem.",
      action: `Aprovar a pausa somente do anúncio ${evidence.adName}, na campanha ${evidence.campaignName}.`,
      followUp: "Retomar o anúncio depois que o estoque do destino voltar.",
    });
  }
  if (
    decisions.length &&
    !findings.some((item) => item.id.startsWith("campaign-decision:"))
  ) {
    const missing = decisions.filter(
      (row) => row.unverifiedAds || row.decision === "insufficient",
    ).length;
    findings.push({
      id: "campaign-hold",
      title: "Manter a verba das campanhas nesta rodada",
      section: "campaigns",
      focus: "campaigns",
      priority: "P2",
      evidence: `${decisions.length} campanhas avaliadas. ${missing ? `${missing} com cobertura insuficiente de mídia ou destino.` : "Nenhuma atingiu os critérios de escala, redução ou pausa por campanha."}`,
      hypothesis: "A leitura não sustenta redistribuição no nível de campanha.",
      action:
        "Manter os orçamentos atuais. Tratar separadamente os anúncios com decisão individual confirmada.",
      owner: "Gestão de mídia",
      followUp:
        "Reavaliar na próxima leitura da janela madura com CPA, compras atribuídas e cobertura do destino.",
    });
  }
  return {
    window,
    targetCpa: target,
    observedAt: snapshot?.adsObservedAt ?? null,
    decisions,
    findings,
  };
}
