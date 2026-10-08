// Textos do painel "UP Insight" nos 3 idiomas da interface (pt, en, ko).
//
// Antes (08/10/2026) as frases por regras ("heuristic", usadas quando a IA não está configurada ou falha) e os prompts da
// IA eram só em inglês, e o painel mostrava inglês mesmo com a tela em português ou coreano. Aqui ficam:
//  - normalizeInsightLanguage: lê o idioma que a tela envia (?language=pt|en|ko). Sem o parâmetro = inglês (como era).
//  - aiLanguageInstruction: instrução que vai no prompt da IA para ela escrever no idioma escolhido.
//  - uma função pura por tela que monta { headline, body, bullets } no idioma, SEM acessar banco (fácil de testar).
// O inglês de cada função é idêntico ao texto que existia em routes/analytics.ts (há teste para isso).
// Traduções para o coreano ainda precisam de revisão de nativo (pendência já registrada no projeto).

export type InsightLanguage = "pt" | "en" | "ko";
export type InsightText = { headline: string; body: string; bullets: string[] };

export function normalizeInsightLanguage(raw: unknown): InsightLanguage {
  const value = String(Array.isArray(raw) ? raw[0] : raw ?? "").toLowerCase();
  if (value.startsWith("pt")) return "pt";
  if (value.startsWith("ko")) return "ko";
  return "en";
}

const AI_LANGUAGE_NAME: Record<InsightLanguage, string> = { en: "English", pt: "Brazilian Portuguese", ko: "Korean" };

/** Acrescenta ao prompt de sistema da IA a regra de idioma. Em inglês não muda nada (comportamento anterior). */
export function aiLanguageInstruction(language: InsightLanguage): string {
  if (language === "en") return "";
  return ` Write the headline, body and bullets in ${AI_LANGUAGE_NAME[language]}. Keep numbers, currency symbols (R$), brand, product, seller, campaign and platform names exactly as given.`;
}

function tools(language: InsightLanguage) {
  const locale = language === "pt" ? "pt-BR" : language === "ko" ? "ko-KR" : "en-US";
  /** Número com `digits` casas: inglês mantém toFixed (como antes); pt/ko usam o formato do idioma. */
  const n = (value: number, digits = 0): string =>
    language === "en" ? value.toFixed(digits) : value.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const t = <T>(en: T, pt: T, ko: T): T => (language === "pt" ? pt : language === "ko" ? ko : en);
  return { n, t };
}

// ───────── Dashboard ─────────
export function dashboardInsight(
  language: InsightLanguage,
  kpis: { revenue: number; orders: number; conversionRate: number; avgTicket: number; approvalRate: number },
  topCategory: { category: string; revenue: number } | null,
  topSeller: { name: string; revenue: number } | null,
  trend: number,
): InsightText {
  const { n, t } = tools(language);
  const trendPct = (trend * 100).toFixed(1);
  const trendAbs = Math.abs(parseFloat(trendPct));
  const headline =
    trend > 0.05
      ? t(`Revenue trending up ${trendPct}% versus the prior window.`, `Receita em alta de ${n(parseFloat(trendPct), 1)}% em relação ao período anterior.`, `직전 기간 대비 매출이 ${n(parseFloat(trendPct), 1)}% 증가했습니다.`)
      : trend < -0.05
        ? t(`Revenue dipping ${trendAbs.toFixed(1)}% versus the prior window.`, `Receita em queda de ${n(trendAbs, 1)}% em relação ao período anterior.`, `직전 기간 대비 매출이 ${n(trendAbs, 1)}% 감소했습니다.`)
        : t(`Revenue holding steady at ${kpis.revenue.toFixed(0)}.`, `Receita estável em ${n(kpis.revenue)}.`, `매출이 ${n(kpis.revenue)} 수준으로 유지되고 있습니다.`);

  // Sem visitas rastreadas a taxa vira 0,0% e a frase passaria a ideia de "ninguém comprou": nesse caso a frase é omitida.
  const hasConversion = kpis.conversionRate > 0;
  const body = t(
    `Across the period the catalog generated ${kpis.orders} orders at an average ticket of ${kpis.avgTicket.toFixed(2)}${hasConversion ? `, with a ${kpis.conversionRate.toFixed(1)}% visit-to-purchase conversion rate` : ""}.`,
    `No período, a loja gerou ${kpis.orders} pedidos com ticket médio de ${n(kpis.avgTicket, 2)}${hasConversion ? `, e taxa de conversão de visita em compra de ${n(kpis.conversionRate, 1)}%` : ""}.`,
    `해당 기간 주문 ${kpis.orders}건, 평균 객단가 ${n(kpis.avgTicket, 2)}${hasConversion ? `, 방문 대비 구매 전환율 ${n(kpis.conversionRate, 1)}%` : ""}입니다.`,
  );

  const bullets: string[] = [];
  if (topCategory) bullets.push(t(`Top category: ${topCategory.category} (${topCategory.revenue.toFixed(0)}).`, `Categoria líder: ${topCategory.category} (${n(topCategory.revenue)}).`, `최다 매출 카테고리: ${topCategory.category} (${n(topCategory.revenue)})`));
  if (topSeller) bullets.push(t(`Top seller: ${topSeller.name} (${topSeller.revenue.toFixed(0)}).`, `Destaque em vendas: ${topSeller.name} (${n(topSeller.revenue)}).`, `최다 판매 담당자: ${topSeller.name} (${n(topSeller.revenue)})`));
  if (kpis.approvalRate > 0) bullets.push(t(`Lead approval rate ${kpis.approvalRate.toFixed(1)}%.`, `Taxa de aprovação de leads de ${n(kpis.approvalRate, 1)}%.`, `리드 승인율 ${n(kpis.approvalRate, 1)}%`));
  return { headline, body, bullets };
}

// ───────── Marketing ─────────
export function marketingInsight(
  language: InsightLanguage,
  kpis: { roas: number; totalSpend: number; attributedRevenue: number; approvedLeads: number; cpa: number; cpl: number; approvalRate: number },
  roasTrend: number,
  topPlatform: string,
): InsightText {
  const { n, t } = tools(language);
  const roasPct = (roasTrend * 100).toFixed(1);
  const up = roasTrend >= 0;
  const pctAbs = Math.abs(Number(roasPct));
  return {
    headline: t(
      `ROAS is ${up ? "up" : "down"} ${pctAbs}% vs last period at ${kpis.roas.toFixed(2)}×`,
      `ROAS em ${up ? "alta" : "queda"} de ${n(pctAbs, 1)}% vs. período anterior, em ${n(kpis.roas, 2)}×`,
      `직전 기간 대비 ROAS ${n(pctAbs, 1)}% ${up ? "상승" : "하락"}, 현재 ${n(kpis.roas, 2)}×`,
    ),
    body: t(
      `You spent R$${kpis.totalSpend.toFixed(0)} on paid channels and generated R$${kpis.attributedRevenue.toFixed(0)} in attributed revenue. ${topPlatform} is your top-performing platform.`,
      `Você investiu R$${n(kpis.totalSpend)} em canais pagos e gerou R$${n(kpis.attributedRevenue)} em receita atribuída. ${topPlatform} é a plataforma com melhor desempenho.`,
      `유료 채널에 R$${n(kpis.totalSpend)}를 투자해 R$${n(kpis.attributedRevenue)}의 귀속 매출을 만들었습니다. ${topPlatform}이(가) 가장 성과가 좋은 플랫폼입니다.`,
    ),
    bullets: [
      t(`${kpis.approvedLeads} approved leads at R$${kpis.cpa.toFixed(0)} CPA`, `${kpis.approvedLeads} leads aprovados com CPA de R$${n(kpis.cpa)}`, `승인 리드 ${kpis.approvedLeads}건, CPA R$${n(kpis.cpa)}`),
      t(`Cost per lead is R$${kpis.cpl.toFixed(0)} — ${kpis.approvalRate.toFixed(0)}% approval rate`, `Custo por lead de R$${n(kpis.cpl)} — ${n(kpis.approvalRate)}% de aprovação`, `리드당 비용 R$${n(kpis.cpl)} — 승인율 ${n(kpis.approvalRate)}%`),
      up
        ? t("Paid channel ROAS is improving — consider scaling top creatives", "O ROAS dos canais pagos está melhorando — considere escalar os melhores criativos", "유료 채널 ROAS가 개선되고 있습니다 — 상위 크리에이티브 확대를 검토하세요")
        : t("ROAS is declining — review underperforming creatives and adjust bids", "O ROAS está caindo — revise os criativos de baixo desempenho e ajuste os lances", "ROAS가 하락 중입니다 — 성과가 낮은 크리에이티브를 점검하고 입찰가를 조정하세요"),
    ],
  };
}

// ───────── Produtos ─────────
export function productsInsight(
  language: InsightLanguage,
  d: { top: { name: string; totalRevenue: number; totalSold: number } | null; highConv: number; atRisk: number; total: number; vesti: boolean },
): InsightText {
  const { n, t } = tools(language);
  const { top, highConv, atRisk, total, vesti } = d;
  const noRisk = vesti && total === 0;
  return {
    headline: top
      ? t(`Top product "${top.name}" has generated ${top.totalRevenue.toFixed(0)} in lifetime revenue`, `Produto líder "${top.name}" já gerou ${n(top.totalRevenue)} em receita total`, `최고 제품 "${top.name}"의 누적 매출은 ${n(top.totalRevenue)}입니다`)
      : t("No product sales recorded yet", "Nenhuma venda de produto registrada ainda", "아직 기록된 제품 판매가 없습니다"),
    body:
      t(`${highConv} of ${total} products are High Conversion (65%+ sell-through). `, `${highConv} de ${total} produtos têm Alta Conversão (65%+ de giro). `, `${total}개 제품 중 ${highConv}개가 고전환(판매율 65% 이상)입니다. `) +
      (atRisk > 0
        ? t(`${atRisk} product${atRisk > 1 ? "s are" : " are"} At Risk — never sold or very low turnover.`, `${atRisk} produto${atRisk > 1 ? "s" : ""} em Risco — ${atRisk > 1 ? "nunca venderam" : "nunca vendeu"} ou com giro muito baixo.`, `${atRisk}개 제품이 위험 상태입니다 — 판매가 없거나 회전율이 매우 낮습니다.`)
        : noRisk
          ? t("No catalog data available for this period.", "Sem dados de catálogo para este período.", "이 기간의 카탈로그 데이터가 없습니다.")
          : t("No products are At Risk.", "Nenhum produto em Risco.", "위험 상태인 제품이 없습니다.")),
    bullets: [
      t(`High Conversion SKUs: ${highConv} of ${total} — consider re-ordering your bestsellers`, `SKUs de Alta Conversão: ${highConv} de ${total} — considere repor os mais vendidos`, `고전환 SKU: ${total}개 중 ${highConv}개 — 베스트셀러 재발주를 검토하세요`),
      atRisk > 0
        ? t(`${atRisk} At Risk SKU${atRisk > 1 ? "s" : ""} — these have never sold or have very poor turnover; consider markdown or discontinuation`, `${atRisk} SKU${atRisk > 1 ? "s" : ""} em Risco — nunca venderam ou têm giro muito baixo; considere liquidação ou descontinuação`, `위험 SKU ${atRisk}개 — 판매가 없거나 회전율이 매우 낮습니다. 할인 또는 단종을 검토하세요`)
        : noRisk
          ? t("Add sales data to unlock product performance insights", "Adicione dados de vendas para liberar os insights de desempenho de produtos", "제품 성과 인사이트를 보려면 판매 데이터를 추가하세요")
          : t("All SKUs have recorded at least one sale — good catalog health", "Todos os SKUs tiveram ao menos uma venda — catálogo saudável", "모든 SKU에 판매가 1건 이상 있습니다 — 카탈로그 상태가 좋습니다"),
      top
        ? t(`"${top.name}" leads with ${top.totalSold} units sold — study what drives its performance`, `"${top.name}" lidera com ${top.totalSold} unidades vendidas — entenda o que impulsiona o desempenho dele`, `"${top.name}"이(가) ${top.totalSold}개 판매로 1위입니다 — 성과 요인을 분석해 보세요`)
        : t("Add sales data to unlock product performance insights", "Adicione dados de vendas para liberar os insights de desempenho de produtos", "제품 성과 인사이트를 보려면 판매 데이터를 추가하세요"),
    ],
  };
}

// ───────── Clientes ─────────
export function customersInsight(
  language: InsightLanguage,
  k: { totalRegistrations: number; approvedRegistrations: number; approvalRatePct: number; totalBuyers: number; customersWithoutPurchase: number; avgTimeToFirstPurchaseDays: number | null },
): InsightText {
  const { n, t } = tools(language);
  const low = k.approvalRatePct < 40;
  const days = k.avgTimeToFirstPurchaseDays;
  return {
    headline:
      k.totalRegistrations > 0
        ? t(`${k.approvedRegistrations} of ${k.totalRegistrations} registrations approved (${k.approvalRatePct.toFixed(1)}%)`, `${k.approvedRegistrations} de ${k.totalRegistrations} cadastros aprovados (${n(k.approvalRatePct, 1)}%)`, `가입 ${k.totalRegistrations}건 중 ${k.approvedRegistrations}건 승인 (${n(k.approvalRatePct, 1)}%)`)
        : t("No registrations in this period", "Nenhum cadastro neste período", "이 기간에 가입이 없습니다"),
    body:
      k.totalBuyers > 0
        ? t(
            `${k.totalBuyers} customers made purchases, while ${k.customersWithoutPurchase} registered but never bought.${days != null ? ` Average time to first purchase: ${days}d.` : ""}`,
            `${k.totalBuyers} clientes compraram, enquanto ${k.customersWithoutPurchase} se cadastraram mas nunca compraram.${days != null ? ` Tempo médio até a primeira compra: ${days} dias.` : ""}`,
            `고객 ${k.totalBuyers}명이 구매했고, ${k.customersWithoutPurchase}명은 가입 후 구매하지 않았습니다.${days != null ? ` 첫 구매까지 평균 ${days}일.` : ""}`,
          )
        : t("No purchases recorded in this period.", "Nenhuma compra registrada neste período.", "이 기간에 기록된 구매가 없습니다."),
    bullets: [
      t(
        `Approval rate: ${k.approvalRatePct.toFixed(1)}% — ${low ? "below 40%, consider improving your approval process" : "healthy conversion from registration to approval"}`,
        `Taxa de aprovação: ${n(k.approvalRatePct, 1)}% — ${low ? "abaixo de 40%, considere melhorar o processo de aprovação" : "boa conversão de cadastro em aprovação"}`,
        `승인율: ${n(k.approvalRatePct, 1)}% — ${low ? "40% 미만입니다. 승인 절차 개선을 검토하세요" : "가입에서 승인까지 전환이 양호합니다"}`,
      ),
      days != null
        ? t(`Avg ${days}d to first purchase — optimize post-approval activation flows to reduce this`, `Média de ${days} dias até a primeira compra — otimize os fluxos de ativação pós-aprovação para reduzir esse prazo`, `첫 구매까지 평균 ${days}일 — 승인 후 활성화 흐름을 최적화해 이 기간을 줄이세요`)
        : t("Track time to first purchase by enabling first-purchase attribution", "Acompanhe o tempo até a primeira compra ativando a atribuição de primeira compra", "첫 구매 어트리뷰션을 활성화해 첫 구매까지의 시간을 추적하세요"),
      k.customersWithoutPurchase > k.totalBuyers
        ? t(`${k.customersWithoutPurchase} registered customers never purchased — consider targeted re-engagement campaigns`, `${k.customersWithoutPurchase} clientes cadastrados nunca compraram — considere campanhas de reengajamento direcionadas`, `가입 고객 ${k.customersWithoutPurchase}명이 구매한 적이 없습니다 — 맞춤 리인게이지먼트 캠페인을 검토하세요`)
        : t("Majority of registered customers have made at least one purchase — strong activation rate", "A maioria dos clientes cadastrados já fez ao menos uma compra — ótima taxa de ativação", "가입 고객 대부분이 1회 이상 구매했습니다 — 활성화율이 높습니다"),
    ],
  };
}

// ───────── Vendedores ─────────
export function sellersInsight(
  language: InsightLanguage,
  topSellers: Array<{ name: string; totalRevenue: number; totalOrders: number }>,
  totalRevenue: number,
  topRevShare: number,
): InsightText {
  const { n, t } = tools(language);
  const first = topSellers[0];
  const second = topSellers[1];
  const secondShare = second ? (totalRevenue > 0 ? (second.totalRevenue / totalRevenue) * 100 : 0) : 0;
  return {
    headline: first
      ? t(`${first.name} leads with ${first.totalOrders} orders and ${first.totalRevenue.toFixed(0)} in lifetime revenue`, `${first.name} lidera com ${first.totalOrders} pedidos e ${n(first.totalRevenue)} em receita total`, `${first.name}이(가) 주문 ${first.totalOrders}건, 누적 매출 ${n(first.totalRevenue)}로 1위입니다`)
      : t("No seller activity recorded yet", "Nenhuma atividade de vendedor registrada ainda", "아직 기록된 판매 담당자 활동이 없습니다"),
    body:
      topSellers.length > 0
        ? t(
            `Top seller ${first?.name} accounts for ${topRevShare.toFixed(1)}% of total seller revenue. ${topSellers.length > 1 ? `The next ${topSellers.length - 1} sellers share the remaining ${(100 - topRevShare).toFixed(1)}%.` : ""}`,
            `${first?.name}, a mais vendedora, responde por ${n(topRevShare, 1)}% da receita total dos vendedores. ${topSellers.length > 1 ? `Os outros ${topSellers.length - 1} dividem os ${n(100 - topRevShare, 1)}% restantes.` : ""}`,
            `상위 판매 담당자 ${first?.name}이(가) 전체 판매 담당자 매출의 ${n(topRevShare, 1)}%를 차지합니다. ${topSellers.length > 1 ? `나머지 ${topSellers.length - 1}명이 남은 ${n(100 - topRevShare, 1)}%를 나눕니다.` : ""}`,
          )
        : t("Add seller attribution to unlock performance insights.", "Adicione a atribuição de vendedores para liberar os insights de desempenho.", "성과 인사이트를 보려면 판매 담당자 귀속을 추가하세요."),
    bullets: [
      first
        ? t(`${first.name} — ${first.totalOrders} orders · ${topRevShare.toFixed(1)}% revenue share`, `${first.name} — ${first.totalOrders} pedidos · ${n(topRevShare, 1)}% da receita`, `${first.name} — 주문 ${first.totalOrders}건 · 매출 비중 ${n(topRevShare, 1)}%`)
        : t("No seller data available", "Sem dados de vendedores", "판매 담당자 데이터가 없습니다"),
      second
        ? t(`${second.name} — ${second.totalOrders} orders · ${totalRevenue > 0 ? secondShare.toFixed(1) : 0}% revenue share`, `${second.name} — ${second.totalOrders} pedidos · ${totalRevenue > 0 ? n(secondShare, 1) : 0}% da receita`, `${second.name} — 주문 ${second.totalOrders}건 · 매출 비중 ${totalRevenue > 0 ? n(secondShare, 1) : 0}%`)
        : t("Only one seller on record", "Apenas um vendedor registrado", "등록된 판매 담당자가 1명뿐입니다"),
      topSellers.length > 2
        ? t(`${topSellers.length} sellers active — compare their avg ticket to identify coaching opportunities`, `${topSellers.length} vendedores ativos — compare o ticket médio de cada um para achar oportunidades de coaching`, `활성 판매 담당자 ${topSellers.length}명 — 평균 객단가를 비교해 코칭 기회를 찾으세요`)
        : t("Add more sellers to enable benchmarking", "Adicione mais vendedores para permitir comparações", "비교 분석을 하려면 판매 담당자를 더 추가하세요"),
    ],
  };
}

// ───────── Estoque ─────────
export function stockInsight(
  language: InsightLanguage,
  d: { stockout: number; overstock: number; sellThrough: string; names: string[]; totalSold: number; totalSkus: number },
): InsightText {
  const { n, t } = tools(language);
  const { stockout, overstock, names, totalSold, totalSkus } = d;
  const st = d.sellThrough;
  const stLocal = language === "en" ? st : n(Number(st), 1);
  return {
    headline:
      stockout > 0
        ? t(`${stockout} SKU${stockout > 1 ? "s are" : " is"} at critical stockout risk this week`, `${stockout} SKU${stockout > 1 ? "s" : ""} em risco crítico de ruptura esta semana`, `이번 주 SKU ${stockout}개가 심각한 품절 위험입니다`)
        : overstock > 0
          ? t(`${overstock} SKU${overstock > 1 ? "s have" : " has"} excess inventory — review pricing or promotions`, `${overstock} SKU${overstock > 1 ? "s" : ""} com estoque em excesso — revise preços ou promoções`, `SKU ${overstock}개의 재고가 과다합니다 — 가격 또는 프로모션을 검토하세요`)
          : t(`Inventory is healthy with a ${st}% sell-through rate`, `Estoque saudável, com giro de ${stLocal}%`, `재고 상태가 양호하며 판매율은 ${stLocal}%입니다`),
    body:
      t(`In the selected period, ${totalSold} units were sold across ${totalSkus} active SKUs. Sell-through rate stands at ${st}%. `, `No período selecionado, foram vendidas ${totalSold} unidades em ${totalSkus} SKUs ativos. O giro está em ${stLocal}%. `, `선택한 기간에 활성 SKU ${totalSkus}개에서 ${totalSold}개가 판매되었습니다. 판매율은 ${stLocal}%입니다. `) +
      (stockout > 0
        ? t(`${stockout} product${stockout > 1 ? "s need" : " needs"} urgent replenishment.`, `${stockout} produto${stockout > 1 ? "s precisam" : " precisa"} de reposição urgente.`, `제품 ${stockout}개가 긴급 보충이 필요합니다.`)
        : overstock > 0
          ? t(`${overstock} product${overstock > 1 ? "s are" : " is"} overstocked.`, `${overstock} produto${overstock > 1 ? "s estão" : " está"} com estoque em excesso.`, `제품 ${overstock}개가 과잉 재고입니다.`)
          : t("No critical risk items detected.", "Nenhum item em risco crítico identificado.", "심각한 위험 품목이 없습니다.")),
    bullets: [
      names.length > 0
        ? t(`Stockout risk: ${names.join(", ")}`, `Risco de ruptura: ${names.join(", ")}`, `품절 위험: ${names.join(", ")}`)
        : t("No stockout-risk products in this period", "Nenhum produto com risco de ruptura neste período", "이 기간에 품절 위험 제품이 없습니다"),
      overstock > 0
        ? t(`${overstock} SKU${overstock > 1 ? "s" : ""} with >90 days coverage — consider markdowns`, `${overstock} SKU${overstock > 1 ? "s" : ""} com mais de 90 dias de cobertura — considere liquidação`, `커버리지 90일 초과 SKU ${overstock}개 — 할인을 검토하세요`)
        : t("No overstock issues detected", "Nenhum problema de excesso de estoque identificado", "과잉 재고 문제가 없습니다"),
      t(`Current sell-through rate: ${st}% — aim for 60–80% for fashion`, `Giro atual: ${stLocal}% — para moda, busque entre 60% e 80%`, `현재 판매율: ${stLocal}% — 패션은 60~80%를 목표로 하세요`),
    ],
  };
}

// ───────── Jornada ─────────
export function journeyInsight(language: InsightLanguage, j: { avgEventsBeforePurchase: number; avgTimeToFirstPurchaseDays: number }): InsightText {
  const { n, t } = tools(language);
  const ev = j.avgEventsBeforePurchase;
  const days = j.avgTimeToFirstPurchaseDays;
  return {
    headline:
      ev > 0
        ? t(`Buyers average ${ev.toFixed(1)} events before purchasing`, `Compradores têm em média ${n(ev, 1)} eventos antes de comprar`, `구매자는 구매 전 평균 ${n(ev, 1)}개의 이벤트를 거칩니다`)
        : t("No purchase journey data available for this period", "Sem dados de jornada de compra neste período", "이 기간의 구매 여정 데이터가 없습니다"),
    body: t(
      `Customers who converted touched an average of ${ev.toFixed(1)} events before completing a purchase.${days > 0 ? ` Time from registration to first purchase averages ${days.toFixed(1)} days.` : ""}`,
      `Clientes que converteram passaram por ${n(ev, 1)} eventos, em média, antes de concluir a compra.${days > 0 ? ` O tempo do cadastro até a primeira compra é de ${n(days, 1)} dias, em média.` : ""}`,
      `전환한 고객은 구매 완료 전 평균 ${n(ev, 1)}개의 이벤트를 거쳤습니다.${days > 0 ? ` 가입부터 첫 구매까지 평균 ${n(days, 1)}일이 걸립니다.` : ""}`,
    ),
    bullets: [
      t(`Avg events before purchase: ${ev.toFixed(1)} — consider shortening the path to reduce drop-off`, `Média de eventos antes da compra: ${n(ev, 1)} — considere encurtar o caminho para reduzir abandonos`, `구매 전 평균 이벤트: ${n(ev, 1)}개 — 경로를 줄여 이탈을 낮추세요`),
      days > 0
        ? t(`Avg time to first purchase: ${days.toFixed(1)} days — post-registration nurture can reduce this`, `Tempo médio até a primeira compra: ${n(days, 1)} dias — nutrição pós-cadastro pode reduzir esse prazo`, `첫 구매까지 평균 시간: ${n(days, 1)}일 — 가입 후 육성 활동으로 줄일 수 있습니다`)
        : t("Enable first-purchase attribution to track activation time", "Ative a atribuição de primeira compra para acompanhar o tempo de ativação", "활성화 시간을 추적하려면 첫 구매 어트리뷰션을 켜세요"),
      t("Compare buyers vs non-buyers to identify the key events that differentiate converters", "Compare compradores e não compradores para identificar os eventos-chave que diferenciam quem converte", "구매자와 비구매자를 비교해 전환자를 가르는 핵심 이벤트를 찾으세요"),
    ],
  };
}

// ───────── RFM ─────────
export function rfmInsight(
  language: InsightLanguage,
  d: { champions: { count: number; revenue: number }; atRisk: { count: number; revenue: number }; lost: { count: number; revenue: number }; total: number },
): InsightText {
  const { n, t } = tools(language);
  const { champions, atRisk, lost, total } = d;
  const share = (champions.count / Math.max(1, total)) * 100;
  return {
    headline:
      champions.count > 0
        ? t(`Champions represent ${share.toFixed(1)}% of your customer base`, `Os Campeões representam ${n(share, 1)}% da sua base de clientes`, `챔피언 고객이 전체 고객 기반의 ${n(share, 1)}%를 차지합니다`)
        : t("No RFM segments computed yet for this brand", "Nenhum segmento RFM calculado ainda para esta marca", "이 브랜드는 아직 RFM 세그먼트가 계산되지 않았습니다"),
    body: t(
      `Your customer base is segmented into ${total} customers. Champions (${champions.count}) drive the highest lifetime value. ${atRisk.count > 0 ? `${atRisk.count} customers are At Risk — re-engagement can recover their revenue.` : ""}${lost.count > 0 ? ` ${lost.count} customers are Lost — consider win-back campaigns.` : ""}`,
      `Sua base está segmentada em ${total} clientes. Os Campeões (${champions.count}) geram o maior valor ao longo da vida. ${atRisk.count > 0 ? `${atRisk.count} clientes estão Em Risco — reengajar pode recuperar essa receita.` : ""}${lost.count > 0 ? ` ${lost.count} clientes estão Perdidos — considere campanhas de recuperação.` : ""}`,
      `고객 기반은 ${total}명으로 세분화되어 있습니다. 챔피언(${champions.count}명)이 가장 높은 생애 가치를 만듭니다. ${atRisk.count > 0 ? `${atRisk.count}명이 이탈 위험입니다 — 재참여 유도로 매출을 되찾을 수 있습니다.` : ""}${lost.count > 0 ? ` ${lost.count}명은 이탈 고객입니다 — 윈백 캠페인을 검토하세요.` : ""}`,
    ),
    bullets: [
      t(`Champions: ${champions.count} customers, R$${champions.revenue.toFixed(0)} total revenue`, `Campeões: ${champions.count} clientes, R$${n(champions.revenue)} de receita total`, `챔피언: 고객 ${champions.count}명, 총 매출 R$${n(champions.revenue)}`),
      atRisk.count > 0
        ? t(`At Risk: ${atRisk.count} customers — launch re-engagement campaigns`, `Em Risco: ${atRisk.count} clientes — lance campanhas de reengajamento`, `이탈 위험: 고객 ${atRisk.count}명 — 재참여 캠페인을 진행하세요`)
        : t("No At Risk customers right now — keep up retention efforts", "Nenhum cliente Em Risco agora — mantenha os esforços de retenção", "현재 이탈 위험 고객이 없습니다 — 리텐션 노력을 이어가세요"),
      lost.count > 0
        ? t(`Lost: ${lost.count} customers — consider win-back offers`, `Perdidos: ${lost.count} clientes — considere ofertas de recuperação`, `이탈: 고객 ${lost.count}명 — 윈백 오퍼를 검토하세요`)
        : t("No Lost customers detected", "Nenhum cliente Perdido identificado", "이탈 고객이 없습니다"),
    ],
  };
}

// ───────── UTM ─────────
export function utmInsight(
  language: InsightLanguage,
  d: {
    topRow: { key: string; revenue: number; registrations: number; conversionPct: number; buyers: number; roas: number | null } | null;
    totalRegistrations: number;
    sources: number;
    approvalPct: number;
    conversionPct: number;
  },
): InsightText {
  const { n, t } = tools(language);
  const { topRow } = d;
  return {
    headline: topRow
      ? t(
          `${topRow.key} drives ${topRow.revenue > 0 ? `R$${topRow.revenue.toFixed(0)} in revenue` : `${topRow.registrations} registrations`} this period`,
          `${topRow.key} gera ${topRow.revenue > 0 ? `R$${n(topRow.revenue)} em receita` : `${topRow.registrations} cadastros`} neste período`,
          `이번 기간 ${topRow.key}이(가) ${topRow.revenue > 0 ? `매출 R$${n(topRow.revenue)}` : `가입 ${topRow.registrations}건`}을(를) 만들었습니다`,
        )
      : t("No UTM attribution data available for this period", "Sem dados de atribuição por UTM neste período", "이 기간의 UTM 어트리뷰션 데이터가 없습니다"),
    body: t(
      `UTM attribution for this period shows ${d.totalRegistrations} registrations across ${d.sources} acquisition sources. ${topRow ? `Top source "${topRow.key}" converts ${topRow.conversionPct.toFixed(1)}% of registrations into buyers.` : ""} Overall approval rate: ${d.approvalPct.toFixed(1)}%.`,
      `A atribuição por UTM neste período mostra ${d.totalRegistrations} cadastros em ${d.sources} fontes de aquisição. ${topRow ? `A principal fonte, "${topRow.key}", converte ${n(topRow.conversionPct, 1)}% dos cadastros em compradores.` : ""} Taxa de aprovação geral: ${n(d.approvalPct, 1)}%.`,
      `이 기간 UTM 어트리뷰션은 ${d.sources}개 유입 소스에서 가입 ${d.totalRegistrations}건을 보여줍니다. ${topRow ? `상위 소스 "${topRow.key}"는 가입의 ${n(topRow.conversionPct, 1)}%를 구매자로 전환합니다.` : ""} 전체 승인율: ${n(d.approvalPct, 1)}%.`,
    ),
    bullets: [
      topRow
        ? t(
            `Top source: ${topRow.key} — ${topRow.buyers} buyers, R$${topRow.revenue.toFixed(0)} revenue${topRow.roas != null ? `, ROAS ${topRow.roas.toFixed(2)}x` : ""}`,
            `Principal fonte: ${topRow.key} — ${topRow.buyers} compradores, R$${n(topRow.revenue)} de receita${topRow.roas != null ? `, ROAS ${n(topRow.roas, 2)}x` : ""}`,
            `상위 소스: ${topRow.key} — 구매자 ${topRow.buyers}명, 매출 R$${n(topRow.revenue)}${topRow.roas != null ? `, ROAS ${n(topRow.roas, 2)}x` : ""}`,
          )
        : t("No source data available for this period", "Sem dados de fonte neste período", "이 기간의 소스 데이터가 없습니다"),
      t(
        `Conversion rate: ${d.conversionPct.toFixed(1)}% of registrations become buyers — compare channels to find your highest-quality traffic`,
        `Taxa de conversão: ${n(d.conversionPct, 1)}% dos cadastros viram compradores — compare os canais para achar o tráfego de maior qualidade`,
        `전환율: 가입의 ${n(d.conversionPct, 1)}%가 구매자가 됩니다 — 채널을 비교해 가장 품질 좋은 트래픽을 찾으세요`,
      ),
      t(
        `Approval rate: ${d.approvalPct.toFixed(1)}% overall — low approval on a high-spend source signals lead quality issues`,
        `Taxa de aprovação: ${n(d.approvalPct, 1)}% no geral — aprovação baixa em uma fonte de alto investimento indica problema de qualidade dos leads`,
        `승인율: 전체 ${n(d.approvalPct, 1)}% — 투자 비중이 큰 소스의 승인율이 낮다면 리드 품질 문제를 의심하세요`,
      ),
    ],
  };
}
