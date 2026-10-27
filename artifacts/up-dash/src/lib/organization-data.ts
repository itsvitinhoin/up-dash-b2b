import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  customFetch,
  useGetDashboard,
  useGetMarketing,
  useGetCustomerSummary,
  useGetFunnel,
  useGetClient,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import { useI18n } from "@/lib/i18n";
import { queryOpts } from "@/lib/query-opts";
import { usePreviousPeriodQuery, periodQuery } from "@/lib/previous-period-query";
import type { OrganizedMetric } from "@/components/metric-section";

type RecompraTotals = {
  faturamento: number;
  faturamentoBruto?: number; // valor do pedido aprovado (servidor novo)
  vendas: number;
  clientes: number;
  ticketMedio: number | null;
};
type RecompraResponse = {
  blocks: {
    recompra: RecompraTotals;
    recorrentes: RecompraTotals;
    reativados: RecompraTotals;
    // pedidos de clientes na 1ª compra (servidor novo; ausente em servidor antigo)
    aquisicao?: RecompraTotals;
    ciclo: { tempoMedioDias: number | null; medianaDias: number | null };
  };
};
type Activation = {
  avgDaysToFirstPurchase: number | null;
  approvedCustomers: number;
  postApproval: { paymentConfirmed: number };
};
type OrderTotals = { kpis: { fulfilledQuantity: number } };
type PerformanceMetrics = {
  kpis: {
    cac: number | null;
    ctr: number;
    cpc: number | null;
    /** Faturamento do ERP (líquido de descontos, pedidos não cancelados): base da % atribuída aos anúncios. */
    netRevenue?: number;
    /** Faturamento bruto do ERP e devoluções do período (bruto − devoluções = líquido). */
    grossRevenue?: number;
    returnAmount?: number;
    /** Pedidos do ERP no período. */
    orders?: number;
    /** Receita atribuída à mídia paga (pedido do ERP + identidade + toque pago). */
    attributedRevenue?: number;
    mediaSpend?: number | null;
    /** Compradores novos no ERP e, entre eles, os atribuídos a anúncios. */
    newBuyers?: number;
    /** Faturamento líquido e pedidos do ERP desses compradores novos, no período. */
    newBuyersRevenue?: number;
    newBuyersOrders?: number;
    newAttributedBuyers?: number;
    /** Receita atribuída ÷ faturamento líquido do ERP, em %. */
    revenueAttributionCoveragePct?: number;
  };
  // Media availability gates all derived costs; unavailable never means a confirmed zero.
  sources?: { media?: { status?: string } };
};
const mediaConnected = (data?: PerformanceMetrics) => data?.sources?.media?.status === "connected";

/** Fontes de dados que uma seção pode precisar. Cada seção pede só as suas: o resto nem é buscado. */
export type OrganizationSource =
  | "dashboard"
  | "marketing"
  | "customers"
  | "funnel"
  | "recompra"
  | "performance"
  | "orders";
export const ALL_ORGANIZATION_SOURCES: readonly OrganizationSource[] = [
  "dashboard",
  "marketing",
  "customers",
  "funnel",
  "recompra",
  "performance",
  "orders",
];

/**
 * Reuses existing read endpoints. Missing measures remain null, never guessed.
 *
 * Custo de carregamento (UP Glass): as buscas pesadas (Recompra, Performance, pedidos) só
 * começam depois que o Dashboard principal chegou, e a comparação com o período anterior de
 * cada fonte é uma busca à parte, em segundo plano (chave "metric-previous-period"), em vez
 * de dobrar o tempo da busca principal.
 */
export function useOrganizationData(
  only: readonly OrganizationSource[] = ALL_ORGANIZATION_SOURCES,
  // Fontes cujo período anterior precisa de busca própria (Dashboard e Marketing já trazem o anterior na resposta).
  previous: readonly OrganizationSource[] = only,
) {
  const { tx } = useI18n();
  const { user, selectedClientId, selectedDashboardMode } = useAuth();
  const { dateRange, filters } = useDashboardFilters();
  const clientId =
    user?.role === "ADMIN" ? selectedClientId || undefined : undefined;
  const enabled =
    user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId);
  const wants = (source: OrganizationSource) => only.includes(source);
  const period = {
    clientId,
    dateFrom: format(dateRange.from, "yyyy-MM-dd"),
    dateTo: format(dateRange.to, "yyyy-MM-dd"),
  };
  const dashboardParams = {
    ...period,
    category: filters.category ?? undefined,
    sellerId: filters.sellerId ?? undefined,
    state: filters.state ?? undefined,
    channel: filters.channel ?? undefined,
    color: filters.color ?? undefined,
    segment: filters.segment ?? undefined,
    utmSource: filters.utmSource || undefined,
    utmMedium: filters.utmMedium || undefined,
    utmCampaign: filters.utmCampaign || undefined,
    compare: true,
  };
  const funnelParams = {
    ...period,
    utmSource: filters.utmSource || undefined,
    utmMedium: filters.utmMedium || undefined,
    utmCampaign: filters.utmCampaign || undefined,
  };
  const dashboard = useGetDashboard(dashboardParams, {
    query: queryOpts({ enabled: enabled && wants("dashboard"), placeholderData: (previous) => previous }),
  });
  const marketing = useGetMarketing(period, {
    query: queryOpts({ enabled: enabled && wants("marketing"), placeholderData: (previous) => previous }),
  });
  const customers = useGetCustomerSummary(
    { ...period, compare: true },
    { query: queryOpts({ enabled: enabled && wants("customers"), placeholderData: (previous) => previous }) },
  );
  const funnel = useGetFunnel(funnelParams, {
    query: queryOpts({ enabled: enabled && wants("funnel"), placeholderData: (previous) => previous }),
  });

  // Universo da Recompra = o MESMO dos cartões do topo do Dashboard (conferido em 10 clientes, 09/set a 08/out):
  // cliente Vesti vende pela Vesti (tipo "vesti" da Recompra: só o canal Vesti, sem o ERP do Vogabox); UpZero e Nuvemshop vendem
  // pelo site (tipo "ecommerce"). Usar "erp" em cliente UpZero com ERP (MX Fashion) misturava o ERP (R$ 434 mil) com
  // o site (R$ 55 mil) e a Retenção ficava maior que o faturamento total. Achado extra no PR: ele mandava
  // estado="todos", que o servidor entendia como um estado chamado "todos" (resultado 0) -- só mandamos estado se houver.
  const { data: clientDetail } = useGetClient(selectedClientId ?? "", { query: queryOpts({ enabled: !!selectedClientId }) });
  const platform = clientDetail?.commercePlatform;
  const platformReady = !selectedClientId || platform !== undefined;
  const recompraTipo = platform ? (platform === "VESTI" ? "vesti" : "site") : selectedDashboardMode === "B2C" ? "ecommerce" : "erp";
  // Valor em R$: o topo do Dashboard soma o valor do pedido aprovado nos clientes de site; na Vesti soma "valor reservado"
  // (a coluna que a Recompra chama de faturamento). Assim Aquisição + Retenção fecham com o Faturamento total.
  const money = (t?: RecompraTotals | null) => (t == null ? undefined : platform === "VESTI" ? t.faturamento : (t.faturamentoBruto ?? t.faturamento));
  const ticketOf = (t?: RecompraTotals | null) => (t == null ? undefined : t.vendas > 0 ? (money(t) ?? 0) / t.vendas : null);
  const recompraSource = platform === "VESTI" ? "Recompra · Vesti pago" : "Recompra · Ecommerce pago";
  const acquisitionSource = platform === "VESTI" ? "Aquisição · Vesti pago" : "Aquisição · Ecommerce pago";

  // Buscas pesadas: esperam o Dashboard principal (quando a seção o usa) e a plataforma do cliente.
  const mainSettled = !wants("dashboard") || dashboard.data !== undefined || dashboard.isError;
  const heavyEnabled = enabled && mainSettled && platformReady;

  const recompraQuery = {
    ...period,
    status: "pago",
    tipo: recompraTipo,
    estado: filters.state || undefined,
  };
  const recompra = useQuery<RecompraResponse>({
    queryKey: ["organization-recompra", period, filters.state, recompraTipo],
    queryFn: () => customFetch(periodQuery("/api/analytics/recompra/dashboard", recompraQuery)),
    enabled: heavyEnabled && wants("recompra"),
    staleTime: 120000,
    refetchOnWindowFocus: false,
  });
  // paidOnly: o ERP da Visao geral conta so venda paga (sem pedido em ESPERA); a pagina Performance continua sem esse filtro.
  const performanceUrl = periodQuery("/api/analytics/performance", { ...period, paidOnly: true });
  const performance = useQuery<PerformanceMetrics>({
    queryKey: ["organization-performance", period, "paid"],
    queryFn: () => customFetch(performanceUrl),
    enabled: heavyEnabled && wants("performance") && selectedDashboardMode !== "B2C",
    staleTime: 120000,
    refetchOnWindowFocus: false,
  });
  const ordersUrl = periodQuery("/api/analytics/orders-page", { ...period, page: 1, limit: 1 });
  const orders = useQuery<OrderTotals>({
    queryKey: ["organization-order-totals", period],
    queryFn: () => customFetch(ordersUrl),
    enabled: heavyEnabled && wants("orders"),
    staleTime: 120000,
    refetchOnWindowFocus: false,
  });

  // Período anterior de cada fonte: segundo plano, uma busca por endpoint/filtro.
  const wantsPrevious = (source: OrganizationSource) => wants(source) && previous.includes(source);
  const previousDashboard = usePreviousPeriodQuery<NonNullable<typeof dashboard.data>>(periodQuery("/api/analytics/dashboard", dashboardParams), enabled && wantsPrevious("dashboard") && dashboard.data !== undefined);
  const previousMarketing = usePreviousPeriodQuery<NonNullable<typeof marketing.data>>(periodQuery("/api/analytics/marketing", period), enabled && wantsPrevious("marketing") && marketing.data !== undefined);
  const previousPerformance = usePreviousPeriodQuery<PerformanceMetrics>(periodQuery("/api/analytics/performance", { ...period, paidOnly: true }), heavyEnabled && wantsPrevious("performance") && selectedDashboardMode !== "B2C" && performance.data !== undefined);
  const previousOrders = usePreviousPeriodQuery<OrderTotals>(periodQuery("/api/analytics/orders-page", { ...period, page: 1, limit: 1 }), heavyEnabled && wantsPrevious("orders") && orders.data !== undefined);
  const previousFunnel = usePreviousPeriodQuery<NonNullable<typeof funnel.data> & { activation?: Activation }>(periodQuery("/api/analytics/funnel", funnelParams), enabled && wantsPrevious("funnel") && funnel.data !== undefined);
  const previousRecompra = usePreviousPeriodQuery<RecompraResponse>(periodQuery("/api/analytics/recompra/dashboard", recompraQuery), heavyEnabled && wantsPrevious("recompra") && recompra.data !== undefined);

  const d = dashboard.data?.kpis,
    m = marketing.isError ? undefined : marketing.data?.kpis,
    c = customers.data?.kpis;
  const r = recompra.data?.blocks;
  const activation = (
    funnel.data as
      | (typeof funnel.data & { activation?: Activation })
      | undefined
  )?.activation;
  const meta = (marketing.isError ? undefined : marketing.data)?.platformBreakdown.find(
    (p) => p.platform === "META",
  );
  const google = (marketing.isError ? undefined : marketing.data)?.platformBreakdown.find(
    (p) => p.platform === "GOOGLE",
  );
  const measures: Record<string, OrganizedMetric> = {};
  function put(
    key: string,
    label: string,
    value: number | null | undefined,
    format: OrganizedMetric["format"],
    source: string,
    loading = false,
    series?: number[],
  ) {
    measures[key] = { info: marketing.isError && ["spend", "totalSpend", "metaSpend", "googleSpend", "roas", "adsSpend", "adsRoas"].includes(key) ? tx("Não foi possível ler o investimento. Tente novamente; indisponível não significa gasto zero.") : undefined, key, label: tx(label), value, format, source: source ? tx(source) : source, loading, series };
  }
  put(
    "revenue",
    "Faturamento",
    d?.revenue,
    "currency",
    "Ecommerce",
    dashboard.isLoading,
    dashboard.data?.revenueOverTime.map((p) => p.value),
  );
  put(
    "requestedRevenue",
    "Faturamento Solicitado",
    d?.requestedRevenue,
    "currency",
    "Ecommerce",
    dashboard.isLoading,
  );
  put(
    "paidRevenue",
    "Faturamento Pago",
    d?.revenue,
    "currency",
    "Ecommerce",
    dashboard.isLoading,
  );
  put(
    "orders",
    "Pedidos",
    d?.orders,
    "number",
    "Ecommerce",
    dashboard.isLoading,
    dashboard.data?.ordersOverTime.map((p) => p.value),
  );
  put(
    "ticket",
    "Ticket Médio",
    d?.avgTicket,
    "currency",
    "Ecommerce",
    dashboard.isLoading,
  );
  // ── Visão geral (pedido do time, 26/10/2026): ERP × e-commerce, anúncios, novos clientes e recompra ──
  // ERP e atribuição vêm da Performance (só cliente com ERP integrado; sem ERP a fonte responde erro e o card fica "—" com explicação).
  const pk = performance.data?.kpis;
  const perfLoading = enabled && selectedDashboardMode !== "B2C" && !performance.data && !performance.isError;
  const noErp = tx("Este cliente não tem ERP integrado, ou o dado do ERP não está disponível agora. Indisponível não significa zero.");
  const erpMeasure = (key: string, label: string, value: number | null | undefined, format: OrganizedMetric["format"], source: string, info?: string) => {
    put(key, label, value, format, source, perfLoading);
    if (value == null) measures[key].info = noErp;
    else if (info) measures[key].info = tx(info);
  };
  erpMeasure("erpRevenue", "Faturamento pago no ERP", pk?.netRevenue, "currency", "ERP · pago", "Faturamento líquido do ERP no período (descontos já abatidos): é a base da % atribuída aos anúncios.");
  // Pedido do time (27/10/2026): líquido em destaque e o bruto embaixo, no mesmo card. Líquido = bruto − (descontos e devoluções):
  // a diferença vira uma linha só porque, no Miredata (Obzee, Vogabox), há desconto além da devolução (bruto − devoluções não fecha o líquido).
  if (pk?.netRevenue != null && measures.erpRevenue) {
    const brl = (v: number | null | undefined) => (v != null && Number.isFinite(v) ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—");
    const gross = pk.grossRevenue;
    measures.erpRevenue.sub = [
      { label: tx("Faturamento bruto"), value: brl(gross) },
      { label: tx("Descontos e devoluções"), value: brl(gross != null ? gross - pk.netRevenue : null) },
    ];
  }
  erpMeasure("erpOrders", "Pedidos totais pagos no ERP", pk?.orders, "number", "ERP · pago");
  put(
    "ecomPaidRevenue",
    "Faturamento pago no E-commerce",
    // Vesti manda o faturamento só dos pagos em `paidRevenue` (o `revenue` dela soma todos os pedidos); nas demais plataformas `revenue` já é só pago.
    d ? (d.paidRevenue ?? d.revenue) : undefined,
    "currency",
    "E-commerce · pago",
    dashboard.isLoading,
  );
  put("ecomPaidOrders", "Pedidos totais pagos no E-commerce", d?.orders, "number", "E-commerce · pago", dashboard.isLoading);
  // Anúncios: receita atribuída (ERP) ÷ investimento total em anúncios. Os três cards fecham entre si na tela.
  erpMeasure("adsRevenue", "Faturamento total de anúncios (pago)", pk?.attributedRevenue, "currency", "ERP × mídia paga", "Faturamento pago do ERP que o sistema consegue ligar a um toque de anúncio pago (documento do cliente + evidência de clique).");
  put("adsSpend", "Investimento total em anúncios", m?.totalSpend, "currency", "Mídia", marketing.isLoading);
  const adsRoasValue = pk?.attributedRevenue != null && m?.totalSpend != null && m.totalSpend > 0 ? pk.attributedRevenue / m.totalSpend : null;
  erpMeasure("adsRoas", "ROAS pagos", adsRoasValue, "ratio", "Receita atribuída pago ÷ investimento", "Faturamento de anúncios (pago) dividido pelo investimento total em anúncios.");
  erpMeasure("adsShare", "% do faturamento da marca atribuído aos anúncios", pk?.revenueAttributionCoveragePct, "percent", "ERP × mídia paga", "Faturamento de anúncios (pago) ÷ faturamento do ERP, que é o total da marca. Mesma conta da tela Performance.");
  erpMeasure("newCustomersTotal", "Total de novos clientes", pk?.newBuyers ?? d?.newBuyers, "number", pk?.newBuyers != null ? "ERP · primeira compra no período" : "E-commerce · primeira compra no período");
  erpMeasure("newCustomersFromAds", "Novos clientes vindos de anúncios", pk?.newAttributedBuyers, "number", "ERP × mídia paga");
  put(
    "spend",
    "Investimento",
    m?.totalSpend,
    "currency",
    "Mídia",
    marketing.isLoading,
    marketing.data?.spendOverTime.map((p) => p.value),
  );
  put(
    "totalSpend",
    "Investimento Total",
    m?.totalSpend,
    "currency",
    "Mídia",
    marketing.isLoading,
  );
  put(
    "metaSpend",
    "Investimento Meta",
    meta?.spend,
    "currency",
    "Meta",
    marketing.isLoading,
  );
  put(
    "googleSpend",
    "Investimento Google",
    google?.spend,
    "currency",
    "Google",
    marketing.isLoading,
  );
  put(
    "roas",
    "ROAS",
    m?.roas,
    "ratio",
    selectedDashboardMode === "B2C"
      ? "Marketing · pago / mídia"
      : "Marketing · solicitado / mídia",
    marketing.isLoading,
  );
  put(
    "requestedRoas",
    "ROAS Solicitado",
    selectedDashboardMode === "B2C" ? null : m?.roas,
    "ratio",
    "Mídia",
    marketing.isLoading,
  );
  put(
    "paidRoas",
    "ROAS Pago",
    selectedDashboardMode === "B2C" ? m?.roas : null,
    "ratio",
    "Marketing · pago",
    marketing.isLoading,
  );
  put(
    "newCustomers",
    "Novos Clientes",
    d?.newBuyers,
    "number",
    "Primeira compra no período",
    dashboard.isLoading,
  );
  // Aquisição = pedidos pagos do período de clientes sem compra anterior (mesma base e filtros da Retenção).
  put("acquisitionRevenue", "Faturamento de Aquisição", money(r?.aquisicao), "currency", acquisitionSource, recompra.isLoading);
  put("acquisitionOrders", "Pedidos de Aquisição", r?.aquisicao?.vendas, "number", acquisitionSource, recompra.isLoading);
  put("acquisitionTicket", "Ticket de Aquisição", ticketOf(r?.aquisicao), "currency", acquisitionSource, recompra.isLoading);
  put(
    "cac",
    "CAC",
    mediaConnected(performance.data) ? performance.data?.kpis.cac : null,
    "currency",
    "Novos atribuídos · Performance",
    performance.isLoading && enabled && selectedDashboardMode !== "B2C",
  );
  put(
    "repurchasers",
    "Clientes que Recompraram",
    r?.recompra.clientes,
    "number",
    recompraSource,
    recompra.isLoading,
  );
  put(
    "retentionRevenue",
    "Faturamento de Recompra",
    money(r?.recompra),
    "currency",
    recompraSource,
    recompra.isLoading,
  );
  put(
    "retentionOrders",
    "Pedidos de Recompra",
    r?.recompra.vendas,
    "number",
    recompraSource,
    recompra.isLoading,
  );
  put(
    "retentionTicket",
    "Ticket de Recompra",
    ticketOf(r?.recompra),
    "currency",
    recompraSource,
    recompra.isLoading,
  );
  // Rótulos pedidos pelo time para a Visão geral (26/10/2026); mesmos números de Aquisição/Recompra, que seguem com o nome antigo nas outras páginas.
  // Base única dos 4 cards de Novos clientes (decisão do time, 27/10/2026): ERP (loja física + site) quando o cliente tem ERP;
  // sem ERP, a mesma conta pelo e-commerce/Vesti (Recompra), como o total de novos já faz.
  const erpNew = pk?.newBuyersRevenue != null;
  const newSource = erpNew ? "ERP · compras dos novos clientes no período" : acquisitionSource;
  const newLoading = recompra.isLoading || perfLoading;
  put("newCustomersRevenue", "Faturamento de novos clientes", erpNew ? pk?.newBuyersRevenue : money(r?.aquisicao), "currency", newSource, newLoading);
  put("newCustomersOrders", "Vendas de novos clientes", erpNew ? pk?.newBuyersOrders : r?.aquisicao?.vendas, "number", newSource, newLoading);
  put("newCustomersTicket", "Ticket de novos clientes", ticketOf(r?.aquisicao), "currency", acquisitionSource, recompra.isLoading);
  put("repurchaseCustomers", "Clientes que recompraram", r?.recompra.clientes, "number", recompraSource, recompra.isLoading);
  put("repurchaseRevenue", "Faturamento de recompra", money(r?.recompra), "currency", recompraSource, recompra.isLoading);
  put("repurchaseSales", "Vendas de recompra", r?.recompra.vendas, "number", recompraSource, recompra.isLoading);
  put(
    "registrations",
    "Cadastros Gerados",
    c?.totalRegistrations,
    "number",
    "Cadastros",
    customers.isLoading,
  );
  put(
    "approved",
    "Cadastros Aprovados",
    c?.approvedRegistrations,
    "number",
    "Cadastros",
    customers.isLoading,
  );
  put(
    "approvalRate",
    "Taxa de Aprovação",
    c?.approvalRatePct,
    "percent",
    "Cadastros",
    customers.isLoading,
  );
  put(
    "approvedConversion",
    "Conversão dos Aprovados",
    selectedDashboardMode === "B2C" ? null : funnel.data?.overallConversion,
    "percent",
    "Funil · base de aprovados",
    funnel.isLoading,
  );
  put(
    "approvedConverted",
    "Aprovados Convertidos",
    activation?.postApproval.paymentConfirmed,
    "number",
    "Ativação dos aprovados",
    funnel.isLoading,
  );
  put(
    "costRegistration",
    "Custo por Cadastro",
    m?.cpl,
    "currency",
    "Marketing · CPL",
    marketing.isLoading,
  );
  put("costApproved", "Custo por Cadastro Aprovado", null, "currency", "");
  put(
    "firstPurchaseAverage",
    "Tempo Médio Cadastro → Primeira Compra",
    c?.avgTimeToFirstPurchaseDays,
    "days",
    "Cadastros",
    customers.isLoading,
  );
  put(
    "firstPurchaseMedian",
    "Mediana Cadastro → Primeira Compra",
    null,
    "days",
    "",
  );
  put(
    "pieces",
    "Peças",
    orders.data?.kpis.fulfilledQuantity,
    "number",
    "Pedidos · peças atendidas/pagas",
    orders.isLoading,
  );
  put(
    "impressions",
    "Impressões",
    meta?.impressions,
    "number",
    "Meta",
    marketing.isLoading,
  );
  put(
    "clicks",
    "Cliques",
    meta?.clicks,
    "number",
    "Meta · cliques da fonte atual",
    marketing.isLoading,
  );
  for (const [key, label, fmt] of [
    ["reach", "Alcance", "number"],
    ["frequency", "Frequência", "number"],
    ["cpm", "CPM", "currency"],
    ["metaPurchases", "Compras Meta", "number"],
    ["metaCpa", "CPA Meta", "currency"],
    ["metaRoas", "ROAS Meta", "ratio"],
    ["connectRate", "Connect Rate", "percent"],
    ["registrationRate", "Taxa de Cadastro", "percent"],
    ["cartRate", "Taxa de Carrinho", "percent"],
    ["checkoutRate", "Taxa de Checkout", "percent"],
    ["paymentRate", "Taxa de Pagamento", "percent"],
  ] as const)
    put(key, label, null, fmt, "");
  put(
    "ctr",
    "CTR",
    mediaConnected(performance.data) ? performance.data?.kpis.ctr : null,
    "percent",
    "Meta · Performance",
  );
  put(
    "cpc",
    "CPC",
    mediaConnected(performance.data) ? performance.data?.kpis.cpc : null,
    "currency",
    "Meta · Performance",
  );
  const pd = dashboard.data?.prevKpis, pm = marketing.isError ? undefined : marketing.data?.prevKpis, pc = customers.data?.prevKpis;
  const pr = previousRecompra.data?.blocks;
  const previousMeta = previousMarketing.data?.platformBreakdown.find(row => row.platform === "META");
  const previousGoogle = previousMarketing.data?.platformBreakdown.find(row => row.platform === "GOOGLE");
  const previousValues: Record<string, number | null | undefined> = {
    revenue: pd?.revenue, paidRevenue: pd?.revenue, requestedRevenue: pd?.requestedRevenue,
    ecomPaidRevenue: pd ? (pd.paidRevenue ?? pd.revenue) : undefined, ecomPaidOrders: pd?.orders,
    erpRevenue: previousPerformance.data?.kpis.netRevenue, erpOrders: previousPerformance.data?.kpis.orders,
    adsRevenue: previousPerformance.data?.kpis.attributedRevenue, adsSpend: pm?.totalSpend,
    adsRoas: previousPerformance.data?.kpis.attributedRevenue != null && pm?.totalSpend ? previousPerformance.data.kpis.attributedRevenue / pm.totalSpend : null,
    adsShare: previousPerformance.data?.kpis.revenueAttributionCoveragePct,
    newCustomersTotal: previousPerformance.data?.kpis.newBuyers ?? pd?.newBuyers, newCustomersFromAds: previousPerformance.data?.kpis.newAttributedBuyers,
    orders: pd?.orders, ticket: pd?.avgTicket, newCustomers: pd?.newBuyers,
    spend: pm?.totalSpend, totalSpend: pm?.totalSpend, metaSpend: previousMeta?.spend, googleSpend: previousGoogle?.spend,
    roas: pm?.roas, requestedRoas: selectedDashboardMode === "B2C" ? null : pm?.roas, paidRoas: selectedDashboardMode === "B2C" ? pm?.roas : null,
    cac: mediaConnected(previousPerformance.data) ? previousPerformance.data?.kpis.cac : null, ctr: mediaConnected(previousPerformance.data) ? previousPerformance.data?.kpis.ctr : null, cpc: mediaConnected(previousPerformance.data) ? previousPerformance.data?.kpis.cpc : null,
    acquisitionRevenue: money(pr?.aquisicao), acquisitionOrders: pr?.aquisicao?.vendas, acquisitionTicket: ticketOf(pr?.aquisicao),
    newCustomersRevenue: previousPerformance.data?.kpis.newBuyersRevenue ?? money(pr?.aquisicao), newCustomersOrders: previousPerformance.data?.kpis.newBuyersOrders ?? pr?.aquisicao?.vendas, newCustomersTicket: ticketOf(pr?.aquisicao),
    repurchaseCustomers: pr?.recompra.clientes, repurchaseRevenue: money(pr?.recompra), repurchaseSales: pr?.recompra.vendas,
    repurchasers: pr?.recompra.clientes, retentionRevenue: money(pr?.recompra), retentionOrders: pr?.recompra.vendas, retentionTicket: ticketOf(pr?.recompra),
    registrations: pc?.totalRegistrations, approved: pc?.approvedRegistrations, approvalRate: pc?.approvalRatePct, firstPurchaseAverage: pc?.avgTimeToFirstPurchaseDays,
    pieces: previousOrders.data?.kpis.fulfilledQuantity, impressions: previousMeta?.impressions, clicks: previousMeta?.clicks,
    approvedConversion: selectedDashboardMode === "B2C" ? null : previousFunnel.data?.overallConversion,
    approvedConverted: previousFunnel.data?.activation?.postApproval.paymentConfirmed, costRegistration: pm?.cpl,
  };
  for (const metric of Object.values(measures)) metric.previousValue = previousValues[metric.key];
  // Custos: subir é ruim (o cartão pinta de verde/vermelho conforme isso).
  for (const key of ["cac", "costRegistration", "costApproved", "cpc", "cpm", "metaCpa"]) if (measures[key]) measures[key].lowerIsBetter = true;
  function pick(...keys: string[]) {
    return keys.map((key) => measures[key]);
  }
  return { measures, pick, dashboard, marketing, customers, funnel, previousFunnel, previousDashboard, recompra, previousRecompra };
}
