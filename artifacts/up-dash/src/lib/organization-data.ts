import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  customFetch,
  useGetDashboard,
  useGetMarketing,
  useGetCustomerSummary,
  useGetFunnel,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import { useI18n } from "@/lib/i18n";
import { queryOpts } from "@/lib/query-opts";
import { usePreviousPeriodQuery, periodQuery } from "@/lib/previous-period-query";
import type { OrganizedMetric } from "@/components/metric-section";

type RecompraTotals = {
  faturamento: number;
  vendas: number;
  clientes: number;
  ticketMedio: number | null;
};
type RecompraResponse = {
  blocks: {
    recompra: RecompraTotals;
    recorrentes: RecompraTotals;
    reativados: RecompraTotals;
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
  kpis: { cac: number | null; ctr: number; cpc: number | null };
};

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

  // Buscas pesadas: esperam o Dashboard principal (quando a seção o usa) para não competir com ele.
  const mainSettled = !wants("dashboard") || dashboard.data !== undefined || dashboard.isError;
  const heavyEnabled = enabled && mainSettled;

  // Achado 08/10/2026 (banco real): o PR fixava tipo="ecommerce" e estado="todos". "todos" não é um
  // estado -- o servidor entendia como um estado chamado "todos" e devolvia 0 para qualquer cliente
  // (a página de Recompra simplesmente não manda o parâmetro). E tipo="ecommerce" é só o canal site:
  // dá 0 em TODOS os clientes Vesti (e em ERP puro); a recompra deles está em tipo="erp". Então:
  // B2B (ERP/Vesti) usa "erp", B2C (Nuvemshop) usa "ecommerce" (nos dois casos é o total do cliente).
  const recompraTipo = selectedDashboardMode === "B2C" ? "ecommerce" : "erp";
  const recompraSource = recompraTipo === "erp" ? "Recompra · ERP pago" : "Recompra · Ecommerce pago";
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
  const performanceUrl = periodQuery("/api/analytics/performance", period);
  const performance = useQuery<PerformanceMetrics>({
    queryKey: ["organization-performance", period],
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
  const previousPerformance = usePreviousPeriodQuery<PerformanceMetrics>(periodQuery("/api/analytics/performance", period), heavyEnabled && wantsPrevious("performance") && selectedDashboardMode !== "B2C" && performance.data !== undefined);
  const previousOrders = usePreviousPeriodQuery<OrderTotals>(periodQuery("/api/analytics/orders-page", { ...period, page: 1, limit: 1 }), heavyEnabled && wantsPrevious("orders") && orders.data !== undefined);
  const previousFunnel = usePreviousPeriodQuery<NonNullable<typeof funnel.data> & { activation?: Activation }>(periodQuery("/api/analytics/funnel", funnelParams), enabled && wantsPrevious("funnel") && funnel.data !== undefined);
  const previousRecompra = usePreviousPeriodQuery<RecompraResponse>(periodQuery("/api/analytics/recompra/dashboard", recompraQuery), heavyEnabled && wantsPrevious("recompra") && recompra.data !== undefined);

  const d = dashboard.data?.kpis,
    m = marketing.data?.kpis,
    c = customers.data?.kpis;
  const r = recompra.data?.blocks;
  const activation = (
    funnel.data as
      | (typeof funnel.data & { activation?: Activation })
      | undefined
  )?.activation;
  const meta = marketing.data?.platformBreakdown.find(
    (p) => p.platform === "META",
  );
  const google = marketing.data?.platformBreakdown.find(
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
    measures[key] = { key, label: tx(label), value, format, source: source ? tx(source) : source, loading, series };
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
    dashboard.data?.newBuyersOverTime.map((p) => p.value),
  );
  put("acquisitionRevenue", "Faturamento de Aquisição", null, "currency", "");
  put("acquisitionOrders", "Pedidos de Aquisição", null, "number", "");
  put("acquisitionTicket", "Ticket de Aquisição", null, "currency", "");
  put(
    "cac",
    "CAC",
    performance.data?.kpis.cac,
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
    r?.recompra.faturamento,
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
    r?.recompra.ticketMedio,
    "currency",
    recompraSource,
    recompra.isLoading,
  );
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
    performance.data?.kpis.ctr,
    "percent",
    "Meta · Performance",
  );
  put(
    "cpc",
    "CPC",
    performance.data?.kpis.cpc,
    "currency",
    "Meta · Performance",
  );
  const pd = dashboard.data?.prevKpis, pm = marketing.data?.prevKpis, pc = customers.data?.prevKpis;
  const pr = previousRecompra.data?.blocks;
  const previousMeta = previousMarketing.data?.platformBreakdown.find(row => row.platform === "META");
  const previousGoogle = previousMarketing.data?.platformBreakdown.find(row => row.platform === "GOOGLE");
  const previousValues: Record<string, number | null | undefined> = {
    revenue: pd?.revenue, paidRevenue: pd?.revenue, requestedRevenue: pd?.requestedRevenue,
    orders: pd?.orders, ticket: pd?.avgTicket, newCustomers: pd?.newBuyers,
    spend: pm?.totalSpend, totalSpend: pm?.totalSpend, metaSpend: previousMeta?.spend, googleSpend: previousGoogle?.spend,
    roas: pm?.roas, requestedRoas: selectedDashboardMode === "B2C" ? null : pm?.roas, paidRoas: selectedDashboardMode === "B2C" ? pm?.roas : null,
    cac: previousPerformance.data?.kpis.cac, ctr: previousPerformance.data?.kpis.ctr, cpc: previousPerformance.data?.kpis.cpc,
    repurchasers: pr?.recompra.clientes, retentionRevenue: pr?.recompra.faturamento, retentionOrders: pr?.recompra.vendas, retentionTicket: pr?.recompra.ticketMedio,
    registrations: pc?.totalRegistrations, approved: pc?.approvedRegistrations, approvalRate: pc?.approvalRatePct, firstPurchaseAverage: pc?.avgTimeToFirstPurchaseDays,
    pieces: previousOrders.data?.kpis.fulfilledQuantity, impressions: previousMeta?.impressions, clicks: previousMeta?.clicks,
    approvedConversion: selectedDashboardMode === "B2C" ? null : previousFunnel.data?.overallConversion,
    approvedConverted: previousFunnel.data?.activation?.postApproval.paymentConfirmed, costRegistration: pm?.cpl,
  };
  for (const metric of Object.values(measures)) metric.previousValue = previousValues[metric.key];
  function pick(...keys: string[]) {
    return keys.map((key) => measures[key]);
  }
  return { measures, pick, dashboard, marketing, customers, funnel, previousFunnel, previousDashboard, recompra, previousRecompra };
}
