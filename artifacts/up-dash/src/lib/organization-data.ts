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
import { queryOpts } from "@/lib/query-opts";
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

/** Reuses existing read endpoints. Missing measures remain null, never guessed. */
export function useOrganizationData() {
  const { user, selectedClientId, selectedDashboardMode } = useAuth();
  const { dateRange, filters } = useDashboardFilters();
  const clientId =
    user?.role === "ADMIN" ? selectedClientId || undefined : undefined;
  const enabled =
    user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId);
  const period = {
    clientId,
    dateFrom: format(dateRange.from, "yyyy-MM-dd"),
    dateTo: format(dateRange.to, "yyyy-MM-dd"),
  };
  const dashboard = useGetDashboard(
    {
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
    },
    { query: queryOpts({ enabled, placeholderData: (previous) => previous }) },
  );
  const marketing = useGetMarketing(period, {
    query: queryOpts({ enabled, placeholderData: (previous) => previous }),
  });
  const customers = useGetCustomerSummary(
    { ...period, compare: true },
    { query: queryOpts({ enabled, placeholderData: (previous) => previous }) },
  );
  const funnel = useGetFunnel(
    {
      ...period,
      utmSource: filters.utmSource || undefined,
      utmMedium: filters.utmMedium || undefined,
      utmCampaign: filters.utmCampaign || undefined,
    },
    { query: queryOpts({ enabled, placeholderData: (previous) => previous }) },
  );
  const recompraParams = new URLSearchParams({
    ...period,
    status: "pago",
    tipo: "ecommerce",
    estado: filters.state || "todos",
  } as Record<string, string>);
  if (!clientId) recompraParams.delete("clientId");
  const recompra = useQuery<RecompraResponse>({
    queryKey: ["organization-recompra", period, filters.state],
    queryFn: () =>
      customFetch(`/api/analytics/recompra/dashboard?${recompraParams}`),
    enabled,
    staleTime: 120000,
    refetchOnWindowFocus: false,
  });
  const performanceParams = new URLSearchParams(
    period as Record<string, string>,
  );
  if (!clientId) performanceParams.delete("clientId");
  const performance = useQuery<PerformanceMetrics>({
    queryKey: ["organization-performance", period],
    queryFn: () =>
      customFetch(`/api/analytics/performance?${performanceParams}`),
    enabled: enabled && selectedDashboardMode !== "B2C",
    staleTime: 120000,
    refetchOnWindowFocus: false,
  });
  const orders = useQuery<OrderTotals>({
    queryKey: ["organization-order-totals", period],
    queryFn: () =>
      customFetch(
        `/api/analytics/orders-page?${performanceParams}&page=1&limit=1`,
      ),
    enabled,
    staleTime: 120000,
    refetchOnWindowFocus: false,
  });
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
    measures[key] = { key, label, value, format, source, loading, series };
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
    "Recompra · Ecommerce pago",
    recompra.isLoading,
  );
  put(
    "retentionRevenue",
    "Faturamento de Recompra",
    r?.recompra.faturamento,
    "currency",
    "Recompra · Ecommerce pago",
    recompra.isLoading,
  );
  put(
    "retentionOrders",
    "Pedidos de Recompra",
    r?.recompra.vendas,
    "number",
    "Recompra · Ecommerce pago",
    recompra.isLoading,
  );
  put(
    "retentionTicket",
    "Ticket de Recompra",
    r?.recompra.ticketMedio,
    "currency",
    "Recompra · Ecommerce pago",
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
  function pick(...keys: string[]) {
    return keys.map((key) => measures[key]);
  }
  return { measures, pick, dashboard, marketing, customers, funnel, recompra };
}
