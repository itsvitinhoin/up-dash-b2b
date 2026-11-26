import { PerformanceSummarySections, MediaInvestmentCards } from "@/components/overview-organization";
import { OrganizationHeading } from "@/components/metric-section";
import { FilterBar } from "@/components/filter-bar";
import { useI18n } from "@/lib/i18n";
import { usePreviousPeriodQuery, periodQuery } from "@/lib/previous-period-query";
import { GlassMetricCard } from "@/components/glass-metric-card";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfWeek, startOfMonth } from "date-fns";
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
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import { customFetch, useGetClient } from "@workspace/api-client-react";
import { useOrganizationData } from "@/lib/organization-data";
import { queryOpts } from "@/lib/query-opts";
import { DashboardKpiCard } from "@/components/dashboard-kpi-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

// Só os campos usados pelo card Faturamento quando Tipo=Ecommerce (ver dashboardQuery acima).
type EcommerceDashboardResponse = {
  kpis: { revenue: number; paidRevenue?: number };
  prevKpis?: { revenue: number; paidRevenue?: number } | null;
};

type PerformanceResponse = {
  generatedAt: string;
  sources: {
    erp: { status: "connected" | "not_configured"; label: string };
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
    attributedRevenueEcommerce: number;
    attributedRevenueErp: number;
    combinedNetRevenue: number;
    combinedGrossRevenue: number;
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

// Mesmo formato de RecompraMonthlyBucket (recompra-analytics.ts), repetido
// aqui porque este pacote não importa tipos do api-server.
type RecompraMonthlyBucketRow = {
  month: string;
  aquisicao: { clientes: number; vendas: number; faturamento: number };
  recorrentes: { clientes: number; vendas: number; faturamento: number };
  reativados: { clientes: number; vendas: number; faturamento: number };
};
// Mesmo formato de RecompraBlocks[segmento] (recompra-analytics.ts).
type CohortBlockTotals = { faturamento: number; faturamentoBruto: number; vendas: number; clientes: number; ticketMedio: number | null };

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
  attributedRevenue: { label: "Faturamento de anúncios", color: "#22c55e" },
  spend: { label: "Investimento total em anúncios", color: "#0458fe" },
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

type DailyPoint = { date: string; revenue: number; attributedRevenue: number; spend: number; orders: number };

/** Agrupa o diário em semana/mês (pedido do time, 18/11/2026) -- soma cada série, a data do ponto vira o início do balde. */
function aggregateDaily(daily: DailyPoint[], granularity: "diaria" | "semanal" | "mensal"): DailyPoint[] {
  if (granularity === "diaria") return daily;
  const bucketStart = (date: Date) =>
    granularity === "mensal" ? startOfMonth(date) : startOfWeek(date, { weekStartsOn: 1 });
  const buckets = new Map<string, DailyPoint>();
  for (const point of daily) {
    const key = format(bucketStart(new Date(`${point.date}T00:00:00`)), "yyyy-MM-dd");
    const bucket = buckets.get(key) ?? { date: key, revenue: 0, attributedRevenue: 0, spend: 0, orders: 0 };
    bucket.revenue += point.revenue;
    bucket.attributedRevenue += point.attributedRevenue;
    bucket.spend += point.spend;
    bucket.orders += point.orders;
    buckets.set(key, bucket);
  }
  return Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
}

const cohortChartConfig = {
  novo: { label: "Novo", color: "#3b82f6" },
  recorrente: { label: "Recorrente", color: "#22c55e" },
  reativado: { label: "Reativado", color: "#f59e0b" },
} satisfies ChartConfig;

/** Barras mes a mes de Novo/Recorrente/Reativado (pedido do time, 18/11/2026) --
 * calculado no front a partir do allOrders que a tela ja busca, sem request novo. */
// Achado 26/11/2026: trocado de erp-attribution.ts (allOrders calculado no
// front) pro mesmo motor recompra-analytics.ts dos cards/tabela acima --
// ver RecompraMonthlyBucket.aquisicao (api-server), acrescentado hoje.
function monthlyCohortTotals(months: RecompraMonthlyBucketRow[]): Array<{ month: string; novo: number; recorrente: number; reativado: number; novoPct: number; recorrentePct: number; reativadoPct: number }> {
  return months
    .map((m) => {
      const novo = m.aquisicao.faturamento;
      const recorrente = m.recorrentes.faturamento;
      const reativado = m.reativados.faturamento;
      const total = novo + recorrente + reativado;
      return {
        month: m.month,
        novo,
        recorrente,
        reativado,
        novoPct: total > 0 ? (novo / total) * 100 : 0,
        recorrentePct: total > 0 ? (recorrente / total) * 100 : 0,
        reativadoPct: total > 0 ? (reativado / total) * 100 : 0,
      };
    })
    .sort((a, b) => a.month.localeCompare(b.month));
}

function SourceStatus({
  data,
  generatedAt,
}: {
  data: PerformanceResponse["sources"];
  generatedAt: string;
}) {
  const sources = [
    { label: "ERP", value: data.erp.label, ok: data.erp.status === "connected" },
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
  const { dateRange, filters } = useDashboardFilters();
  const [ordersPage, setOrdersPage] = useState(1);
  // Achado 26/11/2026: a spec original (slides) só tem 3 valores de Tipo --
  // E-commerce/ERP/Anúncios. "Todos" só existe DENTRO de Anúncios (ver
  // anunciosSubFilter abaixo), nunca como um 4º item no mesmo nível. Um
  // "Todos" solto tinha sido acrescentado depois (19/11/2026) e causava
  // Aquisição/Retenção (que nunca soube filtrar por Tipo=Todos) parecer
  // inconsistente com o card de Faturamento -- removido.
  const [tipoFilter, setTipoFilter] = useState<"erp" | "ecommerce" | "anuncios">("erp");
  // Sub-filtro dentro de Tipo=Anúncios (slides, 19/11/2026): Todos = gerado+pago por anúncio
  // (e-commerce + ERP direto, sem duplicar); E-commerce = só a parte com pedido real na Vesti/UP
  // Zero; ERP = só a parte fechada direto no ERP, sem contrapartida no e-commerce.
  const [anunciosSubFilter, setAnunciosSubFilter] = useState<"todos" | "ecommerce" | "erp">("todos");
  const [statusFilter, setStatusFilter] = useState<"pago" | "cancelado" | "outro">("pago");
  const [chartGranularity, setChartGranularity] = useState<"diaria" | "semanal" | "mensal">("diaria");
  const clientId =
    user?.role === "ADMIN" ? selectedClientId || undefined : undefined;
  const enabled =
    user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId);
  const dateFrom = format(dateRange.from, "yyyy-MM-dd");
  const dateTo = format(dateRange.to, "yyyy-MM-dd");
  const sellerId = filters.sellerId || undefined;
  const state = filters.state || undefined;
  const commonParams = useMemo(
    () => ({ clientId, dateFrom, dateTo, sellerId, state, statusBucket: statusFilter }),
    [clientId, dateFrom, dateTo, sellerId, state, statusFilter],
  );

  useEffect(() => {
    setOrdersPage(1);
  }, [clientId, dateFrom, dateTo]);

  const { data, isLoading, isFetching, error, refetch } =
    useQuery<PerformanceResponse>({
      queryKey: ["performance", clientId, dateFrom, dateTo, ordersPage, sellerId, state, statusFilter],
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

  // Tipo=Ecommerce (pedido do time, 19/11/2026): Faturamento passa a mostrar o nativo do
  // e-commerce (Vesti/site), não o ERP -- mesma fonte que Aquisição/Retenção usam pra esse
  // Tipo. Só busca quando esse Tipo está selecionado (dado pesado, ninguém mais precisa dele).
  const dashboardQuery = useQuery<EcommerceDashboardResponse>({
    queryKey: ["performance-dashboard-ecommerce", clientId, dateFrom, dateTo, sellerId, state],
    queryFn: () =>
      customFetch<EcommerceDashboardResponse>(
        buildUrl("/api/analytics/dashboard", { clientId, dateFrom, dateTo, sellerId, state, compare: "true" }),
      ),
    enabled: enabled && tipoFilter === "ecommerce",
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  // Achado 26/11/2026: "Novos, recorrentes e reativados" trocado de
  // erp-attribution.ts (so CNPJ, nao reage a Tipo/Status/Estado/Vendedora,
  // conta visita de site como "influenciada") pro mesmo motor dos cards
  // Aquisicao/Retencao (recompra-analytics.ts, via useOrganizationData) --
  // e o oficial (bate com a spec das 3 etapas) e ja reage aos filtros do
  // topo (slide: "serao influenciados pelos filtros do topo de visao geral").
  const { recompra: recompraForCohort } = useOrganizationData(["recompra"], [], tipoFilter);
  const cohortBlocks = recompraForCohort.data?.blocks as
    | { aquisicao: CohortBlockTotals; recorrentes: CohortBlockTotals; reativados: CohortBlockTotals; attributionUnavailable: boolean }
    | undefined;

  const { data: clientDetailForCohort } = useGetClient(selectedClientId ?? "", {
    query: queryOpts({ enabled: !!selectedClientId }),
  });
  // Mesmo mapeamento Tipo->RecompraTipoFilter de organization-data.ts --
  // duplicado aqui porque o hook não expõe os filtros já computados pra
  // reaproveitar numa query própria (monthly-trend não é servido por ele).
  const recompraTipoForMonthly: "vesti" | "site" | "anuncios-todos" | "erp" =
    tipoFilter === "ecommerce"
      ? clientDetailForCohort?.commercePlatform === "VESTI"
        ? "vesti"
        : "site"
      : tipoFilter === "anuncios"
        ? "anuncios-todos"
        : "erp";
  const monthlyTrendQuery = useQuery<{ months: RecompraMonthlyBucketRow[]; attributionUnavailable: boolean }>({
    queryKey: ["performance-recompra-monthly", clientId, recompraTipoForMonthly, sellerId, state],
    queryFn: () =>
      customFetch(
        buildUrl("/api/analytics/recompra/monthly-trend", {
          clientId,
          status: "pago",
          tipo: recompraTipoForMonthly,
          estado: state,
          vendedoraId: sellerId,
        }),
      ),
    enabled,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const previous = usePreviousPeriodQuery<PerformanceResponse>(periodQuery("/api/analytics/performance", { ...commonParams, page: 1, limit: PAGE_SIZE }), enabled);
  const pk = previous.data?.kpis;
  const k = data?.kpis;
  // Tipo=Anuncios (pedido do time, 18/11/2026): mostra o recorte atribuido a midia paga
  // (k.attributedRevenue, ja filtrado por Status/Vendedora/Estado igual ao ERP) em vez do
  // faturamento total do ERP. Tipo=Ecommerce (19/11/2026): mostra o nativo do e-commerce
  // (Vesti/site, via dashboardQuery) -- mesma fonte que Aquisicao/Retencao usam pra esse
  // Tipo. Tipo=ERP mostra k.netRevenue (ERP puro, independente da origem -- slide: "ERP:
  // apresenta todos os pedidos registrados no ERP do cliente, independentemente da origem").
  const dk = dashboardQuery.data?.kpis;
  const dpk = dashboardQuery.data?.prevKpis;
  // Sub-filtro dentro de Anúncios (slides): Todos = attributedRevenue (e-commerce + ERP direto,
  // sem duplicar); E-commerce/ERP leem a metade correspondente já separada no backend.
  const attributedFor = (kpis?: { attributedRevenue: number; attributedRevenueEcommerce: number; attributedRevenueErp: number }) => {
    if (!kpis) return undefined;
    if (anunciosSubFilter === "ecommerce") return kpis.attributedRevenueEcommerce;
    if (anunciosSubFilter === "erp") return kpis.attributedRevenueErp;
    return kpis.attributedRevenue;
  };
  const faturamentoValue =
    tipoFilter === "anuncios"
      ? (attributedFor(k) ?? 0)
      : tipoFilter === "ecommerce"
        ? (dk?.paidRevenue ?? dk?.revenue ?? 0)
        : (k?.netRevenue ?? 0);
  const faturamentoPrevious =
    tipoFilter === "anuncios"
      ? attributedFor(pk)
      : tipoFilter === "ecommerce"
        ? (dpk?.paidRevenue ?? dpk?.revenue)
        : pk?.netRevenue;
  const financialMetrics = [
    {
      label: "Faturamento",
      value: faturamentoValue,
      comparisonValue: faturamentoValue,
      previousValue: faturamentoPrevious,
      source: "ERP · Ecommerce · Meta Ads",
      format: formatCurrency,
      icon: CircleDollarSign,
      iconClass: "bg-blue-500/10 text-blue-400",
      sparkColor: "#5b8dff",
      sub:
        tipoFilter === "anuncios"
          ? [{ label: "Cobertura", value: formatPercentage(k?.revenueAttributionCoveragePct ?? 0) }]
          : [{ label: "Bruto", value: formatCurrency(k?.grossRevenue ?? 0) }],
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
      label: "ROAS",
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
          Escolha um cliente para abrir a Performance.
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

  const chartData = aggregateDaily(data?.daily ?? [], chartGranularity);

  return (
    <div
      className="space-y-8"
      data-testid="performance-page"
      aria-busy={isFetching}
    >
      {data && (
        <SourceStatus data={data.sources} generatedAt={data.generatedAt} />
      )}

      <div className="up-filter-bar up-glass-panel p-3 flex flex-wrap items-center gap-2">
        <Select value={tipoFilter} onValueChange={(v) => setTipoFilter(v as typeof tipoFilter)}>
          <SelectTrigger className="h-8 w-[160px] text-xs focus:ring-0 focus:ring-offset-0" style={{ outline: "none" }} data-testid="performance-filter-tipo">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="erp">Tipo: ERP</SelectItem>
            <SelectItem value="ecommerce">Tipo: Ecommerce</SelectItem>
            <SelectItem value="anuncios">Tipo: Anúncios</SelectItem>
          </SelectContent>
        </Select>
        {tipoFilter === "anuncios" && (
          <Select value={anunciosSubFilter} onValueChange={(v) => setAnunciosSubFilter(v as typeof anunciosSubFilter)}>
            <SelectTrigger className="h-8 w-[160px] text-xs focus:ring-0 focus:ring-offset-0" style={{ outline: "none" }} data-testid="performance-filter-anuncios-sub">
              <SelectValue placeholder="Anúncios" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Anúncios: Todos</SelectItem>
              <SelectItem value="ecommerce">Anúncios: E-commerce</SelectItem>
              <SelectItem value="erp">Anúncios: ERP</SelectItem>
            </SelectContent>
          </Select>
        )}
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
          <SelectTrigger className="h-8 w-[160px] text-xs focus:ring-0 focus:ring-offset-0" style={{ outline: "none" }} data-testid="performance-filter-status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pago">Status: Pago</SelectItem>
            <SelectItem value="cancelado">Status: Cancelado</SelectItem>
            <SelectItem value="outro">Status: Outro</SelectItem>
          </SelectContent>
        </Select>
        <FilterBar variant="overview" bare />
      </div>

      {k?.roiStatus !== "available" && !isLoading && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>
            {data?.sources.erp.status === "not_configured" ? "ROI indisponível" : "ROI aguardando cobertura de custo"}
          </AlertTitle>
          <AlertDescription>
            {data?.sources.erp.status === "not_configured"
              ? "O ROAS e o MER estão válidos. O ROI final e o lucro bruto dependem do custo da mercadoria, hoje só disponível pelo ERP, que este cliente não tem configurado."
              : <>O ROAS e o MER estão válidos. O ROI final será exibido quando ao
              menos 95% das peças vendidas tiverem custo no ERP; cobertura atual:{" "}
              {formatPercentage(k?.costCoveragePct ?? 0)}.</>}
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

      <PerformanceSummarySections tipoFilter={tipoFilter} />

      <OrganizationHeading>{tx("FATURAMENTO × INVESTIMENTO")}</OrganizationHeading>

      <div className="grid gap-4">
        <Card>
          <CardContent className="p-5">
            <SectionHeader
              title="Faturamento, atribuição e mídia"
              description="A receita atribuída é um recorte do faturamento oficial do ERP."
              action={
                <div className="flex gap-1">
                  {(["diaria", "semanal", "mensal"] as const).map((g) => (
                    <Button
                      key={g}
                      size="sm"
                      variant={chartGranularity === g ? "secondary" : "ghost"}
                      className="h-7 px-2 text-xs"
                      onClick={() => setChartGranularity(g)}
                      data-testid={`performance-chart-granularity-${g}`}
                    >
                      {g === "diaria" ? "Diária" : g === "semanal" ? "Semanal" : "Mensal"}
                    </Button>
                  ))}
                </div>
              }
            />
            <ChartContainer
              config={trendConfig}
              className="mt-5 h-[320px] w-full aspect-auto"
            >
              <AreaChart accessibilityLayer data={chartData}>
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
      </div>

      <OrganizationHeading>{tx("AQUISIÇÃO × RETENÇÃO")}</OrganizationHeading>

      <Card>
        <CardContent className="p-5">
          <SectionHeader
            title="Novos, recorrentes e reativados"
            description="Coorte pela última compra concluída antes da 1ª compra que a mídia influenciou. Sem compra anterior = novo · até 90 dias = recorrente · acima = reativado."
          />
          {recompraForCohort.isLoading ? (
            <p className="mt-4 text-sm text-muted-foreground">Carregando…</p>
          ) : cohortBlocks?.attributionUnavailable ? (
            <Alert className="mt-4">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Não disponível para este Tipo</AlertTitle>
              <AlertDescription>
                Tipo=Anúncios foi pedido, mas este cliente não tem chave da UpZero configurada.
              </AlertDescription>
            </Alert>
          ) : recompraForCohort.isError ? (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Não foi possível carregar a atribuição</AlertTitle>
              <AlertDescription>
                Tente novamente em alguns instantes.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              {(() => {
                // Mesma simplificação combinada: Status já vem fixo em "pago"
                // pra essa consulta (igual tela inteira sempre usa hoje), então
                // "Pedidos" e "Pedidos pagos" viram o mesmo número (sem pedido
                // extra ao backend só pra separar os dois).
                const cohortRows: Record<CohortLabel, CohortBlockTotals | undefined> = {
                  novo: cohortBlocks?.aquisicao,
                  recorrente: cohortBlocks?.recorrentes,
                  reativado: cohortBlocks?.reativados,
                };
                const totalClientes = (["novo", "recorrente", "reativado"] as const).reduce(
                  (s, c) => s + (cohortRows[c]?.clientes ?? 0),
                  0,
                );
                return (
                  <>
                    <div className="mt-4 up-metric-grid">
                      {(["novo", "recorrente", "reativado"] as const).map((cohort) => {
                        const row = cohortRows[cohort];
                        const pct = totalClientes > 0 && row ? (row.clientes / totalClientes) * 100 : 0;
                        return (
                          <GlassMetricCard key={cohort} label={COHORT_LABEL[cohort]} value={<>{formatNumber(row?.clientes ?? 0)}</>} sub={[{ label: "% dos clientes atribuídos", value: formatPercentage(pct) }]} hideComparison />
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
                            const row = cohortRows[cohort];
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
                                  {formatNumber(row?.clientes ?? 0)}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {formatNumber(row?.vendas ?? 0)}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {formatNumber(row?.vendas ?? 0)}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {formatCurrency(row?.faturamentoBruto ?? 0)}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {formatCurrency(row?.faturamento ?? 0)}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {formatCurrency(row?.ticketMedio ?? 0)}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                          {(() => {
                            const rows = (["novo", "recorrente", "reativado"] as const).map((c) => cohortRows[c]).filter((r): r is CohortBlockTotals => Boolean(r));
                            const totalPedidos = rows.reduce((s, r) => s + r.vendas, 0);
                            const totalFatGerado = rows.reduce((s, r) => s + r.faturamentoBruto, 0);
                            const totalFatPago = rows.reduce((s, r) => s + r.faturamento, 0);
                            return (
                              <TableRow className="bg-muted/30 font-semibold">
                                <TableCell>Total</TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {formatNumber(totalClientes)}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {formatNumber(totalPedidos)}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {formatNumber(totalPedidos)}
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
                );
              })()}
              {(() => {
                const monthly = monthlyCohortTotals(monthlyTrendQuery.data?.months ?? []);
                if (monthly.length === 0) return null;
                return (
                  <div className="mt-6">
                    <p className="text-xs font-medium text-muted-foreground">
                      Faturamento gerado por coorte, mês a mês
                    </p>
                    <ChartContainer config={cohortChartConfig} className="mt-3 h-[260px] w-full aspect-auto">
                      <BarChart accessibilityLayer data={monthly}>
                        <CartesianGrid vertical={false} />
                        <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={10} />
                        <YAxis
                          tickLine={false}
                          axisLine={false}
                          width={62}
                          tickFormatter={(value) => `R$ ${Math.round(Number(value) / 1000)}k`}
                        />
                        <ChartTooltip
                          cursor={false}
                          content={
                            <ChartTooltipContent
                              formatter={(value, name, item) => {
                                const pctKey = `${String(name)}Pct` as "novoPct" | "recorrentePct" | "reativadoPct";
                                const pct = (item.payload as { novoPct: number; recorrentePct: number; reativadoPct: number })[pctKey];
                                return `${formatCurrency(Number(value))} (${pct.toFixed(1)}%)`;
                              }}
                            />
                          }
                        />
                        <Bar dataKey="novo" fill="var(--color-novo)" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="recorrente" fill="var(--color-recorrente)" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="reativado" fill="var(--color-reativado)" radius={[4, 4, 0, 0]} />
                        <ChartLegend content={<ChartLegendContent />} />
                      </BarChart>
                    </ChartContainer>
                  </div>
                );
              })()}
            </>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
