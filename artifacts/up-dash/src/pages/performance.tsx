import { PerformanceSummarySections, MediaInvestmentCards } from "@/components/overview-organization";
import { OrganizationHeading } from "@/components/metric-section";
import { useI18n } from "@/lib/i18n";
import { usePreviousPeriodQuery, periodQuery } from "@/lib/previous-period-query";
import { GlassMetricCard } from "@/components/glass-metric-card";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertCircle,
  BadgeDollarSign,
  Boxes,
  CircleDollarSign,
  Gauge,
  Megaphone,
  ReceiptText,
  Target,
  TrendingUp,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import { customFetch } from "@workspace/api-client-react";
import { DashboardKpiCard } from "@/components/dashboard-kpi-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import {
  formatCurrency,
  formatNumber,
  formatPercentage,
} from "@/lib/formatters";

type AttributionState = "ATRIBUIDO" | "SEM_ORIGEM";
type BuyerType = "NEW" | "RETURNING" | "UNKNOWN";

type PerformanceResponse = {
  generatedAt: string;
  sources: {
    erp: { status: "connected"; label: string };
    ecommerce: {
      status: "connected" | "unavailable";
      label: string;
      message: string | null;
    };
    media: {
      status: "connected" | "unavailable" | "not_configured";
      label: string;
      message: string | null;
    };
  };
  kpis: {
    grossRevenue: number;
    netRevenue: number;
    returnAmount: number;
    attributedRevenue: number;
    unattributedRevenue: number;
    mediaSpend: number | null;
    roas: number | null;
    mer: number | null;
    cogs: number;
    grossProfit: number;
    roi: number | null;
    roiStatus: "available" | "partial" | "unavailable";
    costCoveragePct: number;
    orders: number;
    attributedOrders: number;
    attributionCoveragePct: number;
    uniqueBuyers: number;
    newBuyers: number;
    returningBuyers: number;
    retentionPct: number;
    totalQuantity: number;
    returnedQuantity: number;
    discountAmount: number;
    cancelledOrders: number;
    cancelledAmount: number;
    averageTicket: number;
    avgItemsPerOrder: number;
    returnRatePct: number;
    discountRatePct: number;
    grossMarginPct: number;
    attributedBuyers: number;
    newAttributedBuyers: number;
    revenueAttributionCoveragePct: number;
    impressions: number;
    clicks: number;
    leads: number;
    metaPurchases: number;
    ctr: number;
    cpc: number | null;
    cpl: number | null;
    cac: number | null;
  };
  reconciliation: Array<{ label: string; value: number; detail: string }>;
  daily: Array<{
    date: string;
    revenue: number;
    attributedRevenue: number;
    spend: number;
    orders: number;
  }>;
  channels: Array<{
    channel: string;
    spend: number;
    revenue: number;
    orders: number;
    roas: number | null;
  }>;
  breakdowns: {
    colors: Array<{ name: string; value: number }>;
    sizes: Array<{ name: string; value: number }>;
    states: Array<{ name: string; value: number }>;
  };
  funnel: Array<{
    key: string;
    label: string;
    value: number;
    previousRate: number | null;
    overallRate: number | null;
    source: "Meta Ads" | "UP Zero" | "ERP";
  }>;
  quality: Array<{
    key: string;
    label: string;
    value: number;
    status: "good" | "attention" | "critical";
    detail: string;
  }>;
  campaigns: Array<{
    id: string;
    name: string;
    spend: number;
    leads: number;
    purchases: number;
    revenue: number;
    orders: number;
    roas: number | null;
    cpl: number | null;
  }>;
  orders: {
    rows: PerformanceOrder[];
    total: number;
    page: number;
    limit: number;
  };
};

type PerformanceOrder = {
  id: string;
  createdAt: string;
  customerName: string | null;
  company: string | null;
  document: string | null;
  requestedQuantity: number;
  fulfilledQuantity: number;
  netAmount: number;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  attributed: boolean;
  attribution: AttributionState;
  buyerType: BuyerType;
};

type CohortLabel = "novo" | "recorrente" | "reativado";

type CohortSummary = {
  cohort: CohortLabel;
  clientes: number;
  pedidos: number;
  pedidosPagos: number;
  faturamentoGerado: number;
  faturamentoPago: number;
  ticketMedio: number;
};

type CustomerCohort = {
  upzeroCustomerId: string;
  customerName: string | null;
  cohort: CohortLabel;
  firstInfluencedOrderAt: string;
  lastOrderBeforeAt: string | null;
  daysSinceLastOrder: number | null;
};

// Todo pedido do período (não só os influenciados) -- `attributed`/`cohort`
// vêm null/false quando o pedido não foi conciliado com nenhuma evidência
// de mídia paga antes dele.
type PaidAttributionState = "PAID_ORIGIN" | "PAID_ASSISTED";

type ErpOrderRow = {
  orderId: string;
  channel: "erp" | "site";
  customerName: string | null;
  document: string | null;
  upzeroCustomerId: string | null;
  valor: number;
  valorPago: number;
  dataCriado: string;
  attributed: boolean;
  attributionState: PaidAttributionState | null;
  cohort: CohortLabel | null;
  touchpointAt: string | null;
  touchpointSource: string | null;
};

type ErpAttributionResponse = {
  allOrders: ErpOrderRow[];
  influencedTotal: number;
  influencedCustomers: number;
  cohortSummary: CohortSummary[];
  customerCohorts: CustomerCohort[];
  fetchErrors: Array<{ upzeroCustomerId: string; message: string }>;
};

const COHORT_LABEL: Record<CohortLabel, string> = {
  novo: "Novo",
  recorrente: "Recorrente",
  reativado: "Reativado",
};

const COHORT_BADGE_CLASS: Record<CohortLabel, string> = {
  novo: "border-blue-500/30 bg-blue-500/10 text-blue-400",
  recorrente: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  reativado: "border-amber-500/30 bg-amber-500/10 text-amber-400",
};

const trendConfig = {
  revenue: { label: "Faturamento ERP", color: "#5b8dff" },
  attributedRevenue: { label: "Receita atribuída", color: "#5b8dff" },
  spend: { label: "Investimento", color: "#0458fe" },
} satisfies ChartConfig;

const PAGE_SIZE = 10;

function buildUrl(
  path: string,
  params: Record<string, string | number | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  return `${path}?${search.toString()}`;
}

function SourceStatus({
  data,
  generatedAt,
}: {
  data: PerformanceResponse["sources"];
  generatedAt: string;
}) {
  const sources = [
    { label: "ERP", value: data.erp.label, ok: true },
    {
      label: "E-commerce",
      value: data.ecommerce.message ?? data.ecommerce.label,
      ok: data.ecommerce.status === "connected",
    },
    {
      label: "Mídia paga",
      value:
        data.media.status === "connected"
          ? data.media.label
          : (data.media.message ?? data.media.label),
      ok: data.media.status === "connected",
    },
  ];
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">Performance consolidada</p>
          {sources.map((source) => (
            <Badge
              key={source.label}
              variant="outline"
              className={
                source.ok
                  ? "border-emerald-500/30 text-emerald-400"
                  : "border-amber-500/30 text-amber-400"
              }
              title={source.value}
            >
              {source.label}: {source.ok ? "conectado" : "atenção"}
            </Badge>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          ERP financeiro + identidade e comportamento do e-commerce +
          investimento da mídia paga.
        </p>
      </div>
      <div className="text-left sm:text-right">
        <p className="text-[10px] font-mono uppercase text-muted-foreground">
          Conciliação
        </p>
        <p className="mt-1 text-sm font-medium">
          {new Date(generatedAt).toLocaleString("pt-BR")}
        </p>
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  const { tx } = useI18n();
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-base font-semibold">{tx(title)}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{tx(description)}</p>
      </div>
      {action}
    </div>
  );
}

export default function PerformancePage() {
  const { tx } = useI18n();
  const { selectedClientId, user } = useAuth();
  const { dateRange } = useDashboardFilters();
  const [ordersPage, setOrdersPage] = useState(1);
  const clientId =
    user?.role === "ADMIN" ? selectedClientId || undefined : undefined;
  const enabled =
    user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId);
  const dateFrom = format(dateRange.from, "yyyy-MM-dd");
  const dateTo = format(dateRange.to, "yyyy-MM-dd");
  const commonParams = useMemo(
    () => ({ clientId, dateFrom, dateTo }),
    [clientId, dateFrom, dateTo],
  );

  useEffect(() => {
    setOrdersPage(1);
  }, [clientId, dateFrom, dateTo]);

  const { data, isLoading, isFetching, error, refetch } =
    useQuery<PerformanceResponse>({
      queryKey: ["performance", clientId, dateFrom, dateTo, ordersPage],
      queryFn: () =>
        customFetch<PerformanceResponse>(
          buildUrl("/api/analytics/performance", {
            ...commonParams,
            page: ordersPage,
            limit: PAGE_SIZE,
          }),
        ),
      enabled,
      staleTime: 2 * 60 * 1000,
      gcTime: 15 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    });

  const attributionQuery = useQuery<ErpAttributionResponse>({
    queryKey: ["performance-attribution", clientId, dateFrom, dateTo],
    queryFn: () =>
      customFetch<ErpAttributionResponse>(
        buildUrl("/api/analytics/erp/attribution", commonParams),
      ),
    enabled,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
    // Achado 09/09/2026: cliente Vesti nativo nunca tem chave da UpZero,
    // então NO_API_KEY é permanente, não vale re-tentar (só gastaria
    // request à toa contra um erro que nunca muda).
    retry: (failureCount, err) =>
      (err as { data?: { code?: string } })?.data?.code !== "NO_API_KEY" && failureCount < 1,
  });
  const attributionErrorCode = (attributionQuery.error as { data?: { code?: string } } | undefined)?.data?.code;
  const isVestiWithoutUpZero = attributionErrorCode === "NO_API_KEY";

  const previous = usePreviousPeriodQuery<PerformanceResponse>(periodQuery("/api/analytics/performance", { ...commonParams, page: 1, limit: PAGE_SIZE }), enabled);
  const pk = previous.data?.kpis;
  const k = data?.kpis;
  const financialMetrics = [
    {
      label: "Faturamento ERP",
      value: k?.netRevenue ?? 0,
      comparisonValue: k?.netRevenue ?? null,
      previousValue: pk?.netRevenue,
      source: "ERP · Ecommerce · Meta Ads",
      format: formatCurrency,
      icon: CircleDollarSign,
      iconClass: "bg-blue-500/10 text-blue-400",
      sparkColor: "#5b8dff",
      sub: [{ label: "Bruto", value: formatCurrency(k?.grossRevenue ?? 0) }],
    },
    {
      label: "Receita atribuída",
      info: tx("Faturamento líquido (já descontadas as devoluções) dos compradores do ERP que a UP Zero reconhece como vindos de mídia paga. Conta pelo cliente, não pelo pedido: por isso pode diferir de “Receita com clique pago”, mais abaixo."),
      value: k?.attributedRevenue ?? 0,
      comparisonValue: k?.attributedRevenue ?? null,
      previousValue: pk?.attributedRevenue,
      source: "ERP · Ecommerce · Meta Ads",
      format: formatCurrency,
      icon: Target,
      iconClass: "bg-violet-500/10 text-violet-400",
      sparkColor: "#5b8dff",
      sub: [
        {
          label: "Cobertura",
          value: formatPercentage(k?.revenueAttributionCoveragePct ?? 0),
        },
      ],
    },
    {
      label: "Investimento",
      value: k?.mediaSpend ?? 0,
      comparisonValue: k?.mediaSpend ?? null,
      previousValue: pk?.mediaSpend,
      source: "ERP · Ecommerce · Meta Ads",
      format: (value: number) => k?.mediaSpend == null ? "—" : formatCurrency(value),
      info: k?.mediaSpend == null ? tx("Investimento indisponível; falha de leitura não significa gasto zero.") : undefined,
      icon: Megaphone,
      iconClass: "bg-amber-500/10 text-amber-400",
      sparkColor: "#0458fe",
      sub: [{ label: "Fonte", value: "Meta Ads" }],
    },
    {
      label: "ROAS atribuído",
      value: k?.roas ?? 0,
      comparisonValue: k?.roas ?? null,
      previousValue: pk?.roas,
      source: "ERP · Ecommerce · Meta Ads",
      format: (v: number) => (k?.roas == null ? "—" : `${v.toFixed(2)}x`),
      icon: TrendingUp,
      iconClass: "bg-emerald-500/10 text-emerald-400",
      sparkColor: "#87adff",
      sub: [{ label: "Cálculo", value: "Atribuído / mídia" }],
    },
    {
      label: "MER geral",
      value: k?.mer ?? 0,
      comparisonValue: k?.mer ?? null,
      previousValue: pk?.mer,
      source: "ERP · Ecommerce · Meta Ads",
      format: (v: number) => (k?.mer == null ? "—" : `${v.toFixed(2)}x`),
      icon: Gauge,
      iconClass: "bg-cyan-500/10 text-cyan-400",
      sparkColor: "#afc4ff",
      sub: [{ label: "Cálculo", value: "ERP / mídia" }],
    },
    {
      label: "Lucro bruto",
      value: k?.grossProfit ?? 0,
      comparisonValue: k?.roiStatus === "available" ? k.grossProfit : null,
      previousValue: pk?.roiStatus === "available" ? pk.grossProfit : null,
      source: "ERP · Ecommerce · Meta Ads",
      format: (v: number) =>
        k?.roiStatus === "available" ? formatCurrency(v) : "—",
      icon: Boxes,
      iconClass: "bg-fuchsia-500/10 text-fuchsia-400",
      sparkColor: "#b3caff",
      sub: [
        { label: "Margem", value: formatPercentage(k?.grossMarginPct ?? 0) },
      ],
    },
    {
      label: "ROI final",
      value: k?.roi ?? 0,
      comparisonValue: k?.roi ?? null,
      previousValue: pk?.roi,
      source: "ERP · Ecommerce · Meta Ads",
      format: (v: number) => (k?.roi == null ? "—" : formatPercentage(v)),
      icon: BadgeDollarSign,
      iconClass: "bg-lime-500/10 text-lime-400",
      sparkColor: "#87adff",
      sub: [
        {
          label: "Custo coberto",
          value: formatPercentage(k?.costCoveragePct ?? 0),
        },
      ],
    },
    {
      label: "Ticket médio",
      value: k?.averageTicket ?? 0,
      comparisonValue: k?.averageTicket ?? null,
      previousValue: pk?.averageTicket,
      source: "ERP · Ecommerce · Meta Ads",
      format: formatCurrency,
      icon: ReceiptText,
      iconClass: "bg-blue-500/10 text-blue-400",
      sparkColor: "#afc4ff",
      sub: [
        { label: "Peças/pedido", value: (k?.avgItemsPerOrder ?? 0).toFixed(1) },
      ],
    },
  ];

  if (!enabled) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Selecione uma marca</AlertTitle>
        <AlertDescription>
          Escolha um cliente B2B com ERP configurado para abrir a Performance.
        </AlertDescription>
      </Alert>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Não foi possível carregar a Performance</AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-4">
          <span>
            {error instanceof Error
              ? error.message
              : "Falha ao conciliar as fontes."}
          </span>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Tentar novamente
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div
      className="space-y-8"
      data-testid="performance-page"
      aria-busy={isFetching}
    >
      {data && (
        <SourceStatus data={data.sources} generatedAt={data.generatedAt} />
      )}

      {k?.roiStatus !== "available" && !isLoading && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>ROI aguardando cobertura de custo</AlertTitle>
          <AlertDescription>
            O ROAS e o MER estão válidos. O ROI final será exibido quando ao
            menos 95% das peças vendidas tiverem custo no ERP; cobertura atual:{" "}
            {formatPercentage(k?.costCoveragePct ?? 0)}.
          </AlertDescription>
        </Alert>
      )}

      <section className="space-y-4">
        <SectionHeader
          title="RESULTADO GERAL"
          description="Resultado oficial do ERP conciliado com mídia e atribuição do e-commerce."
        />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {[0, 3].map((index) => { const metric = financialMetrics[index]; return (
            <DashboardKpiCard
              key={metric.label}
              {...metric}
              change={null}
              changeLabel=""
              sparkValues={[]}
              ringColor={metric.sparkColor}
              isLoading={isLoading}
              testId={`performance-financial-kpi-${index}`}
              valueAccent={index === 0}
            />
          ); })}
          <MediaInvestmentCards />
        </div>
      </section>

      <PerformanceSummarySections />

      <OrganizationHeading>{tx("FATURAMENTO × INVESTIMENTO")}</OrganizationHeading>

      <div className="grid gap-4 xl:grid-cols-[1.65fr_1fr]">
        <Card>
          <CardContent className="p-5">
            <SectionHeader
              title="Faturamento, atribuição e mídia"
              description="A receita atribuída é um recorte do faturamento oficial do ERP."
            />
            <ChartContainer
              config={trendConfig}
              className="mt-5 h-[320px] w-full aspect-auto"
            >
              <AreaChart accessibilityLayer data={data?.daily ?? []}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={10}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={62}
                  tickFormatter={(value) =>
                    `R$ ${Math.round(Number(value) / 1000)}k`
                  }
                />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      formatter={(value) => formatCurrency(Number(value))}
                    />
                  }
                />
                <Area
                  dataKey="revenue"
                  type="monotone"
                  fill="var(--color-revenue)"
                  fillOpacity={0.16}
                  stroke="var(--color-revenue)"
                  strokeWidth={2}
                />
                <Area
                  dataKey="attributedRevenue"
                  type="monotone"
                  fill="var(--color-attributedRevenue)"
                  fillOpacity={0.12}
                  stroke="var(--color-attributedRevenue)"
                  strokeWidth={2}
                />
                <Area
                  dataKey="spend"
                  type="monotone"
                  fill="var(--color-spend)"
                  fillOpacity={0.08}
                  stroke="var(--color-spend)"
                  strokeWidth={2}
                />
                <ChartLegend content={<ChartLegendContent />} />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <SectionHeader
              title="Performance por canal"
              description="ROAS aparece quando o canal possui investimento conectado."
            />
            <Table className="mt-4">
              <TableHeader>
                <TableRow>
                  <TableHead>Canal</TableHead>
                  <TableHead className="text-right">Invest.</TableHead>
                  <TableHead className="text-right">Receita</TableHead>
                  <TableHead className="text-right">ROAS</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.channels ?? []).map((channel) => (
                  <TableRow key={channel.channel}>
                    <TableCell className="font-medium">
                      {channel.channel}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(channel.spend)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(channel.revenue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {channel.roas == null
                        ? "—"
                        : `${channel.roas.toFixed(2)}x`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <OrganizationHeading>{tx("AQUISIÇÃO × RETENÇÃO")}</OrganizationHeading>

      <Card>
        <CardContent className="p-5">
          <SectionHeader
            title="Novos, recorrentes e reativados"
            description="Coorte pela última compra concluída antes da 1ª compra que a mídia influenciou. Sem compra anterior = novo · até 90 dias = recorrente · acima = reativado."
          />
          {attributionQuery.isLoading ? (
            <p className="mt-4 text-sm text-muted-foreground">Carregando…</p>
          ) : isVestiWithoutUpZero ? (
            <Alert className="mt-4">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Não disponível para este cliente</AlertTitle>
              <AlertDescription>
                Essa seção usa dados de clique da UpZero, que este cliente (Vesti nativo) não tem configurado.
              </AlertDescription>
            </Alert>
          ) : attributionQuery.isError ? (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Não foi possível carregar a atribuição</AlertTitle>
              <AlertDescription>
                Tente novamente em alguns instantes.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="mt-4 up-metric-grid">
                {(["novo", "recorrente", "reativado"] as const).map((cohort) => {
                  const summary = attributionQuery.data?.cohortSummary.find(
                    (c) => c.cohort === cohort,
                  );
                  const totalClientes = attributionQuery.data?.influencedCustomers ?? 0;
                  const pct =
                    totalClientes > 0 && summary
                      ? (summary.clientes / totalClientes) * 100
                      : 0;
                  return (
                    <GlassMetricCard key={cohort} label={COHORT_LABEL[cohort]} value={<>{formatNumber(summary?.clientes ?? 0)}</>} sub={[{ label: "% dos clientes atribuídos", value: formatPercentage(pct) }]} hideComparison />
                  );
                })}
              </div>
              <div className="mt-4 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Coorte</TableHead>
                      <TableHead className="text-right">Clientes</TableHead>
                      <TableHead className="text-right">Pedidos</TableHead>
                      <TableHead className="text-right">Pedidos pagos</TableHead>
                      <TableHead className="text-right">Fat. gerado</TableHead>
                      <TableHead className="text-right">Fat. pago</TableHead>
                      <TableHead className="text-right">Ticket médio</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(["novo", "recorrente", "reativado"] as const).map((cohort) => {
                      const summary = attributionQuery.data?.cohortSummary.find(
                        (c) => c.cohort === cohort,
                      );
                      return (
                        <TableRow key={cohort}>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={COHORT_BADGE_CLASS[cohort]}
                            >
                              {COHORT_LABEL[cohort]}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatNumber(summary?.clientes ?? 0)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatNumber(summary?.pedidos ?? 0)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatNumber(summary?.pedidosPagos ?? 0)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(summary?.faturamentoGerado ?? 0)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(summary?.faturamentoPago ?? 0)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(summary?.ticketMedio ?? 0)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {(() => {
                      const rows = attributionQuery.data?.cohortSummary ?? [];
                      const totalPedidos = rows.reduce((s, r) => s + r.pedidos, 0);
                      const totalPedidosPagos = rows.reduce((s, r) => s + r.pedidosPagos, 0);
                      const totalFatPago = rows.reduce((s, r) => s + r.faturamentoPago, 0);
                      const totalFatGerado = attributionQuery.data?.influencedTotal ?? 0;
                      return (
                        <TableRow className="bg-muted/30 font-semibold">
                          <TableCell>Total</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatNumber(attributionQuery.data?.influencedCustomers ?? 0)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatNumber(totalPedidos)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatNumber(totalPedidosPagos)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(totalFatGerado)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(totalFatPago)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(totalPedidos > 0 ? totalFatGerado / totalPedidos : 0)}
                          </TableCell>
                        </TableRow>
                      );
                    })()}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
