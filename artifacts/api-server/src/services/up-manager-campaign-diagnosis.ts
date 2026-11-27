import { auctionPoint, leadingRoasDriver } from "./up-manager-auction";
import { campaignWeeklyComparison, type buildCampaignWindows } from "./up-manager-campaign-evaluation";
import type { FreightReport } from "./up-manager-shipping-insights";
import type { CommercialSnapshot } from "./up-manager-b2c";
import type { compareCatalog } from "./up-manager-b2c-products";
import type { CheckoutDiagnosticData } from "./up-manager-funnel-diagnostic";
import type { landingEvidenceFor } from "./up-manager-landing";
import type { PaidMediaReview, PaidMediaRow } from "./up-manager-paid-media";
import { mediaRoas } from "./up-manager-paid-media";

type Reviews = ReturnType<typeof buildCampaignWindows>;
type Evidence = {
  currency: string;
  stockObservedAt: CommercialSnapshot["stockObservedAt"];
  coupons?: { status: string; freeShipping?: boolean }[] | null;
  shipping?: FreightReport | null;
  changes: ReturnType<typeof compareCatalog>;
  destinations: ReturnType<typeof landingEvidenceFor>;
  campaignFunnel: CheckoutDiagnosticData | null;
  mediaEvents: { id: string; day: string; title: string }[];
  maturePeriods: Pick<PaidMediaReview, "window" | "previousWindow">;
};

const pct = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 2 });
const whole = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const stockDate = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" });
const normalization = (value: string) => value.replace(/\+/g, " ").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const showPeriod = ({ dateFrom, dateTo }: PaidMediaReview["window"]) => `${dateFrom.slice(8, 10)}/${dateFrom.slice(5, 7)} a ${dateTo.slice(8, 10)}/${dateTo.slice(5, 7)}`;

function campaignFunnelEvidence(row: PaidMediaRow, source: CheckoutDiagnosticData | null) {
  const campaign = row.level === "campaign" ? row.id : row.campaignId;
  const matching = source?.events.filter((item) => item.campaign === campaign ||
    (row.level === "campaign" && normalization(item.campaign) === normalization(row.name))) ?? [];
  if (!matching.some(({ period }) => period === "previous") || !matching.some(({ period }) => period === "current")) {
    return "O GA4 ainda não oferece um vínculo comparável desta campanha nas duas semanas.";
  }
  const totals = (period: "previous" | "current") => {
    const observations = matching.filter((item) => item.period === period);
    const sum = (event: string) => observations.filter((item) => item.event === event).reduce((total, { count }) => total + count, 0);
    return { carts: sum("add_to_cart"), checkouts: sum("begin_checkout"), purchases: sum("purchase"),
      days: Math.max(...observations.map(({ days }) => days ?? 0)) };
  };
  const before = totals("previous");
  const after = totals("current");
  const counts = `${before.carts} → ${after.carts} carrinhos, ${before.checkouts} → ${after.checkouts} checkouts e ${before.purchases} → ${after.purchases} compras com identificação da campanha.`;
  if (before.days < 7 || after.days < 7) return `${counts} O recorte tem registros em ${before.days} e ${after.days} dias, respectivamente.`;
  return counts;
}

function adLosses(row: PaidMediaRow, reviews: Reviews) {
  const recent = new Map(reviews[7].rows.filter(({ level }) => level === "ad").map((ad) => [ad.id, ad]));
  return reviews[14].rows.filter((ad) => ad.level === "ad" && (row.level === "ad" ? ad.id === row.id :
    row.level === "adset" ? ad.adsetId === row.id : ad.campaignId === row.id)).flatMap((ad) => {
    const now = recent.get(ad.id);
    const previous = ad.spending.purchases - (now?.spending.purchases ?? 0);
    const previousSpend = ad.spending.spend - (now?.spending.spend ?? 0);
    const loss = previous - (now?.spending.purchases ?? 0);
    if (previous <= 0 || previousSpend <= 0 || ad.spending.missingValue || now?.spending.missingValue) return [];
    const expectedAtSameCpa = (now?.spending.spend ?? 0) * previous / previousSpend;
    const lostAgainstCpa = expectedAtSameCpa - (now?.spending.purchases ?? 0);
    return [{ ad, now, previous, previousSpend, loss, expectedAtSameCpa, lostAgainstCpa }];
  });
}

export function diagnoseCampaignDecline(row: PaidMediaRow, reviews: Reviews, source: Evidence) {
  const evaluation = row.evaluation;
  if (!evaluation) return;
  const factors: { label: string; detail: string }[] = [];
  const weeks = campaignWeeklyComparison(reviews, row);
  const weeklyDriver = weeks && weeks.after < weeks.before && weeks.previous.purchases >= 3 &&
    Math.min(weeks.previous.clicks, weeks.current.clicks) >= 30
    ? leadingRoasDriver(auctionPoint(weeks.previous, reviews[7].previousWindow), auctionPoint(weeks.current, reviews[7].window), "decline")
    : null;
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: source.currency });
  const losses = adLosses(row, reviews);
  const majorLoss = losses.filter(({ loss }) => loss > 0).sort((a, b) => b.loss - a.loss)[0];
  const inefficient = losses.filter(({ previous, now, expectedAtSameCpa, lostAgainstCpa }) =>
    previous >= 4 && now?.status === "active" && expectedAtSameCpa >= 4 && lostAgainstCpa >= 3)
    .sort((a, b) => b.lostAgainstCpa - a.lostAgainstCpa)[0];
  if (weeks) {
    const { previous, current } = weeks;
    factors.push({ label: "Mídia · duas semanas fechadas", detail: `Gasto ${money.format(previous.spend)} → ${money.format(current.spend)}. O recorte teve ${whole.format(previous.purchases)} → ${whole.format(current.purchases)} compras atribuídas e ${whole.format(previous.clicks)} → ${whole.format(current.clicks)} cliques de link.` });
    if (previous.clicks >= 20 && current.clicks >= 20 && previous.purchases > 0) {
      const before = previous.purchases / previous.clicks;
      const after = current.purchases / current.clicks;
      factors.push({ label: "Eficiência após o clique", detail: `Compras por clique de link ${pct.format(before)} → ${pct.format(after)}. CPC ${money.format(previous.spend / previous.clicks)} → ${money.format(current.spend / current.clicks)}.${current.purchases > 0 ? ` Valor atribuído por compra ${money.format(previous.revenue / previous.purchases)} → ${money.format(current.revenue / current.purchases)}.` : ""}` });
    }
  }
  const formatDriver = weeklyDriver?.key === "cpm" || weeklyDriver?.key === "ticket" ? money.format : pct.format;
  const summary = weeklyDriver
    ? `Duas semanas fechadas: ROAS ${mediaRoas(weeks!.before)} → ${mediaRoas(weeks!.after)}. Maior pressão medida em ${weeklyDriver.name} (${formatDriver(weeklyDriver.before)} → ${formatDriver(weeklyDriver.current)}).`
    : undefined;
  if (summary) {
    const previous = auctionPoint(weeks!.previous, reviews[7].previousWindow);
    const current = auctionPoint(weeks!.current, reviews[7].window);
    const show = (value: number | null, format: (n: number) => string) => value === null ? "indisponível" : format(value);
    const pairs = [
      ["CPM", previous.cpm, current.cpm, money.format],
      ["CTR de link", previous.ctr, current.ctr, pct.format],
      ["Compras por clique", previous.purchaseRate, current.purchaseRate, pct.format],
      ["Valor atribuído por compra", previous.ticket, current.ticket, money.format],
    ] as const;
    factors.push({ label: "Decomposição do ROAS", detail: pairs.map(([name, before, after, format]) =>
      `${name} ${show(before, format)} → ${show(after, format)}`).join(" · ") + ". São contribuições de mídia na mesma janela." });
  }
  if (row.previousSpending && !row.previousSpending.missingValue && !row.spending.missingValue && row.previousSpending.spend > 0 && row.spending.spend > 0) {
    const { window, previousWindow } = source.maturePeriods;
    factors.push({ label: "Mídia · semanas maduras", detail: `De ${showPeriod(previousWindow)} para ${showPeriod(window)}, com os dois dias fechados mais recentes fora da comparação. ROAS ${mediaRoas(row.previousRoas)} → ${mediaRoas(row.roas)}, ${row.previousSpending.purchases} → ${row.spending.purchases} compras e ${whole.format(row.previousSpending.clicks)} → ${whole.format(row.spending.clicks)} cliques de link.` });
  }
  if (majorLoss && row.level !== "ad") {
    const { ad, now, previous, previousSpend, loss } = majorLoss;
    const earlierRoas = previousSpend > 0 ? (ad.spending.revenue - (now?.spending.revenue ?? 0)) / previousSpend : null;
    const netLoss = weeks ? weeks.previous.purchases - weeks.current.purchases : 0;
    const lostDelivery = (now?.spending.spend ?? 0) < previousSpend * 0.5;
    factors.push({ label: "Anúncio com maior perda de compras", detail: `${ad.name} passou de ${previous} para ${now?.spending.purchases ?? 0} compras${netLoss > 0 ? `, contribuição de ${loss} compras para a perda líquida de ${netLoss}` : ""}. Gasto ${money.format(previousSpend)} → ${money.format(now?.spending.spend ?? 0)}.${lostDelivery ? " A peça perdeu entrega. O gasto recente limita a avaliação de eficiência." : ` ROAS ${mediaRoas(earlierRoas)} → ${mediaRoas(now?.roas ?? null)}.`}` });
  }
  if (inefficient?.now && row.level !== "ad") {
    const { ad, now, previous, previousSpend, expectedAtSameCpa } = inefficient;
    const result = now.spending.purchases > 0 ? `CPA ${money.format(previousSpend / previous)} → ${money.format(now.spending.spend / now.spending.purchases)}.`
      : "A peça ficou sem compras atribuídas na segunda semana.";
    factors.push({ label: "Anúncio com perda de eficiência", detail: `${ad.name} passou de ${previous} para ${now.spending.purchases} compras, com gasto de ${money.format(previousSpend)} → ${money.format(now.spending.spend)}. ${result} Ao CPA anterior, o gasto recente corresponderia a cerca de ${whole.format(expectedAtSameCpa)} compras.` });
  }
  const involved = new Set([row.id, row.adsetId, row.campaignId, majorLoss?.ad.id, majorLoss?.ad.adsetId, inefficient?.ad.id]);
  const changes = source.mediaEvents.filter(({ id, day }) => involved.has(id) && day >= reviews[14].window.dateFrom && day <= reviews[7].window.dateTo);
  if (changes.length) factors.push({ label: "Alterações registradas na Meta", detail: changes.slice(0, 3).map(({ day, title }) => `${day.slice(8, 10)}/${day.slice(5, 7)} · ${title}`).join(". ") });
  const inventory = evaluation.inventory;
  const grade = inventory.products.filter(({ grade }) => grade === "broken" || grade === "out_of_stock").slice(0, 3);
  const linked = new Set(inventory.products.flatMap((item) => item.variants.map(({ id }) => id)));
  const catalogChanges = source.changes?.filter((item) => linked.has(item.key)).slice(0, 3) ?? [];
  const gradeSummary = grade.map((item) => `${item.name} (${item.stock === 0 ? "esgotado" : `grade incompleta${item.missing.length ? ` em ${item.missing.join(", ")}` : ""}`})`).join(". ");
  factors.push({ label: "Produtos e estoque", detail: [gradeSummary || (inventory.products.length ? `${inventory.products.length} destinos com vínculo; ${inventory.products.filter(({ grade }) => grade === "complete").length} com grade completa na leitura atual.` : "Sem vínculo verificável entre o anúncio e o catálogo para atribuir uma quebra de estoque."),
    inventory.products.length && source.stockObservedAt ? `Saldo lido em ${stockDate.format(new Date(source.stockObservedAt))}.` : "",
    inventory.unknownAds ? `${inventory.unknownAds} anúncios ativos com vínculo pendente. ${inventory.unmatchedReasons?.join(" ") ?? ""}`.trim() : "",
    catalogChanges.length ? `Mudanças desde a última leitura: ${catalogChanges.map((item) => `${item.name} · ${item.changed.join(", ")}`).join(". ")}.` : ""].filter(Boolean).join(" ") });
  factors.push({ label: "Campanha no GA4", detail: campaignFunnelEvidence(row, source.campaignFunnel) });
  for (const destination of source.destinations) {
    const { campaign, all, mobile } = destination;
    const scoped = Boolean(campaign.current && campaign.previous);
    const { previous, current } = scoped ? campaign : all;
    const display = (value: number | null) => value === null ? "—" : pct.format(value);
    const metric = previous && current ? `GA4 · ${scoped ? "tráfego da campanha" : "todos os canais da página"}. Sessões ${previous.sessions} → ${current.sessions}. Rejeição ${display(previous.bounce)} → ${display(current.bounce)}. Compras por sessão ${display(previous.purchaseRate)} → ${display(current.purchaseRate)}. Engajamento médio ${whole.format(previous.secondsPerSession)}s → ${whole.format(current.secondsPerSession)}s.${Math.min(previous.sessions, current.sessions) < 30 ? " Amostra pequena." : ""}`
      : "Cobertura GA4 insuficiente para comparar esta página nos dois períodos.";
    const coverage = destination.publicListing ? "vitrine da página de entrada" : destination.catalogProvider === "Braavo" && destination.source === "categoria" ? "categoria registrada no Braavo" : destination.source;
    const inventory = destination.products ? ` ${destination.products} produtos no recorte ${coverage}. ${destination.broken} com grade incompleta, ${destination.soldOut} esgotados e ${destination.unknown} com grade sem confirmação.${destination.publicStockProducts ? ` Saldo consultado na vitrine para ${destination.publicStockProducts} produtos, nas variantes exibidas.` : ""}` : " Catálogo sem vínculo verificável para esta página.";
    const affected = destination.affected.map((item) => `${item.name} (${item.missing.join(", ")})${item.recentlyBroken ? ` · ${item.recentlyBroken} opções zeraram desde a leitura anterior` : ""}`).join(". ");
    const mobileText = mobile.current && mobile.previous && Math.min(mobile.previous.sessions, mobile.current.sessions) >= 30
      ? ` No celular, ${mobile.previous.sessions} → ${mobile.current.sessions} sessões, rejeição ${display(mobile.previous.bounce)} → ${display(mobile.current.bounce)} e compras por sessão ${display(mobile.previous.purchaseRate)} → ${display(mobile.current.purchaseRate)}.` : "";
    factors.push({ label: `${destination.name ?? destination.path} · página de destino`, detail: `${destination.derived ? "Destino observado no GA4 por campanha. " : ""}${metric}${mobileText}${inventory}${affected ? ` ${affected}.` : ""}` });
  }
  if (row.level === "campaign" && weeks) {
    const pages = source.destinations.filter(({ campaign }) => campaign.previous && campaign.current);
    if (pages.length) {
      const sessions = (period: "previous" | "current") => pages.reduce((total, page) => total + page.campaign[period]!.sessions, 0);
      if (Math.min(weeks.previous.clicks, weeks.current.clicks, sessions("previous"), sessions("current")) >= 30) {
        factors.push({ label: "GA4 · chegada aos destinos medidos", detail:
          `Sessões por clique nos ${pages.length} destinos com vínculo: ${pct.format(sessions("previous") / weeks.previous.clicks)} → ${pct.format(sessions("current") / weeks.current.clicks)}. O comparativo usa sessões GA4 e cliques Meta, com cobertura limitada aos destinos listados.` });
      }
    }
  }
  if (weeklyDriver || evaluation.auction?.trend === "decline") {
    const freight = source.shipping?.states.filter(({ price, delivery }) =>
      (price.material && price.direction === "worsened") || (delivery.material && delivery.direction === "worsened")).slice(0, 4);
    const prices = catalogChanges.filter(({ changed }) => changed.some((change) => change.includes("Preço")));
    const commercialSignals = [
      prices.length ? prices.map(({ name, changed }) => `${name} · ${changed.filter((change) => change.includes("Preço")).join(", ")}`).join(". ") + "." : "",
      source.coupons?.length ? `${source.coupons.length} mudanças de cupom observadas entre as duas leituras da loja.` : "",
      freight?.length ? `Preço ou prazo de frete piorou em ${freight.map(({ state }) => state).join(", ")} nos pedidos pagos. ${showPeriod(source.shipping!.currentWindow)}.` : "",
      "O impacto dessas mudanças na campanha exige vínculo por pedido ou sessão. Alterações nas regras de parcelamento e pagamento dependem do histórico da loja.",
    ];
    factors.push({ label: "Condições comerciais da loja", detail: commercialSignals.filter(Boolean).join(" ") });
  }
  if (!source.destinations.length) factors.push({ label: "Página de destino", detail: "A Meta não informou uma URL direta utilizável para este item. Catálogos dinâmicos podem variar a oferta por sessão." });
  const impaired = source.destinations.find((page) => page.broken + page.soldOut > 0 && page.source !== "itens vistos no GA4");
  const weakPage = source.destinations.find(({ campaign, all }) => {
    const { previous, current } = campaign.previous && campaign.current ? campaign : all;
    return previous && current && Math.min(previous.sessions, current.sessions) >= 30 &&
      ((previous.bounce !== null && current.bounce !== null && current.bounce - previous.bounce >= 0.08 &&
        current.purchaseRate <= previous.purchaseRate) ||
        (previous.purchases >= 4 && current.purchaseRate <= previous.purchaseRate * 0.75));
  });
  const specific = row.level !== "ad" ? inefficient?.ad.name : null;
  let action = evaluation.action;
  let followUp: string | undefined;
  if (evaluation.decision === "investigate") {
    if (impaired) {
      action = `Priorizar o destino ${impaired.name ?? impaired.path}. Destacar os produtos e variantes disponíveis e testar uma URL com grade completa no mesmo público.`;
      followUp = "Comparar compras por sessão e disponibilidade das variantes nos destinos testados.";
    } else if (weakPage) {
      const label = weakPage.name ?? (weakPage.path === "/" ? "página inicial" : weakPage.path);
      action = `Testar uma página com oferta alinhada ao anúncio em vez de ${label}, preservando público, criativo e verba no comparativo.`;
      followUp = "Medir rejeição, adições ao carrinho e compras por sessão na página atual e no novo destino.";
    } else if (evaluation.auction?.trend === "recovery") {
      action = "Validar a reação em três dias comparáveis. Conferir compras por clique e cobertura da grade antes de avaliar escala.";
    } else if (weeklyDriver?.key === "cpm") {
      action = "Comparar a entrega por público e posicionamento antes de subir a verba. Priorizar um teste com menor custo por visita e conservar a oferta e o destino.";
      followUp = "Medir CPM, custo por clique e compras por clique com o mesmo criativo, em dias equivalentes.";
    } else if (weeklyDriver?.key === "ctr") {
      action = `Testar uma variação de criativo${specific ? ` em ${specific}` : ""} mantendo público, URL e oferta no comparativo.`;
      followUp = "Comparar CTR de link e compras por clique com o criativo atual.";
    } else if (weeklyDriver?.key === "ticket") {
      action = "Testar uma oferta que favoreça um pedido de maior valor, com o mesmo público e orçamento.";
      followUp = "Comparar valor atribuído por compra e volume de compras com a oferta atual.";
    } else if (weeklyDriver?.key === "purchaseRate" || specific) {
      action = `Testar uma oferta ou destino de grade confirmada${specific ? ` em ${specific}` : ""}, mantendo público, criativo e verba no comparativo.`;
      followUp = "Comparar compras por clique e compras por sessão, com atenção às adições ao carrinho.";
    }
  }
  row.evaluation = { ...evaluation, diagnosis: { factors, summary, followUp }, destinations: source.destinations, action, comparison: weeks ? {
    previousRoas: weeks.before, currentRoas: weeks.after, previousPurchases: weeks.previous.purchases, currentPurchases: weeks.current.purchases,
  } : undefined };
  row.action = action;
}
