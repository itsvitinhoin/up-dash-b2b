import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertCircle,
  BadgeDollarSign,
  BarChart3,
  Boxes,
  CircleDollarSign,
  Download,
  Gauge,
  Megaphone,
  MousePointerClick,
  PackageCheck,
  ReceiptText,
  ShoppingBag,
  Target,
  TrendingUp,
  UserRoundCheck,
  Users,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import { exportRowsAsCsv } from "@/lib/csv-export";
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
    mediaSpend: number;
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

type ErpCustomer = {
  id: string;
  name: string | null;
  company: string | null;
  document: string | null;
  state: string | null;
  seller: string | null;
  orders: number;
  totalSpent: number;
  historicalOrders: number;
  lifetimeValue: number;
  buyerType: Exclude<BuyerType, "UNKNOWN">;
  segment: string;
  lastOrderAt: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
  attributed: boolean;
};

type ErpCustomersResponse = {
  rows: ErpCustomer[];
  total: number;
  page: number;
  limit: number;
};

type ErpProduct = {
  id: string;
  name: string | null;
  category: string | null;
  units: number;
  revenue: number;
  stock: number;
  turnoverPct: number;
  salesPower: number;
  grossProfit: number;
  grossMarginPct: number;
  coverageDays: number | null;
  variantCount: number;
};

type ErpProductsResponse = {
  rows: ErpProduct[];
  total: number;
  page: number;
  limit: number;
};

const trendConfig = {
  revenue: { label: "Faturamento ERP", color: "#3b82f6" },
  attributedRevenue: { label: "Receita atribuída", color: "#8b5cf6" },
  spend: { label: "Investimento", color: "#f59e0b" },
} satisfies ChartConfig;

const breakdownConfig = {
  value: { label: "Participação", color: "#3b82f6" },
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
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

function AttributionBadge({ state }: { state: AttributionState }) {
  return state === "ATRIBUIDO" ? (
    <Badge
      variant="outline"
      className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
    >
      Atribuído
    </Badge>
  ) : (
    <Badge
      variant="outline"
      className="border-amber-500/30 bg-amber-500/10 text-amber-400"
    >
      Sem origem
    </Badge>
  );
}

function BreakdownCard({
  title,
  description,
  data,
}: {
  title: string;
  description: string;
  data: Array<{ name: string; value: number }>;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        {data.length ? (
          <ChartContainer
            config={breakdownConfig}
            className="mt-4 h-[210px] w-full aspect-auto"
          >
            <BarChart
              accessibilityLayer
              data={data}
              layout="vertical"
              margin={{ left: 4, right: 18 }}
            >
              <CartesianGrid horizontal={false} />
              <XAxis type="number" domain={[0, "dataMax"]} hide />
              <YAxis
                dataKey="name"
                type="category"
                axisLine={false}
                tickLine={false}
                width={82}
                tick={{ fontSize: 11 }}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    formatter={(value) => `${Number(value).toFixed(1)}%`}
                  />
                }
              />
              <Bar
                dataKey="value"
                fill="var(--color-value)"
                radius={[0, 4, 4, 0]}
              />
            </BarChart>
          </ChartContainer>
        ) : (
          <div className="flex h-[210px] items-center justify-center text-xs text-muted-foreground">
            Sem dados no período.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Pagination({
  page,
  total,
  loading,
  onPage,
}: {
  page: number;
  total: number;
  loading: boolean;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div className="flex flex-col gap-3 border-t pt-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <span>
        Página {formatNumber(page)} de {formatNumber(pages)} ·{" "}
        {formatNumber(total)} registro(s)
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1 || loading}
          onClick={() => onPage(page - 1)}
        >
          Anterior
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pages || loading}
          onClick={() => onPage(page + 1)}
        >
          Próxima
        </Button>
      </div>
    </div>
  );
}

export default function PerformancePage() {
  const { selectedClientId, user } = useAuth();
  const { dateRange } = useDashboardFilters();
  const [ordersPage, setOrdersPage] = useState(1);
  const [customersPage, setCustomersPage] = useState(1);
  const [productsPage, setProductsPage] = useState(1);
  const [campaignsPage, setCampaignsPage] = useState(1);
  const [buyerType, setBuyerType] = useState("all");
  const [productSort, setProductSort] = useState("revenue");
  const [exporting, setExporting] = useState<string | null>(null);
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
    setCustomersPage(1);
    setProductsPage(1);
    setCampaignsPage(1);
  }, [clientId, dateFrom, dateTo]);

  useEffect(() => setCustomersPage(1), [buyerType]);
  useEffect(() => setProductsPage(1), [productSort]);

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

  const customersQuery = useQuery<ErpCustomersResponse>({
    queryKey: [
      "performance-customers",
      clientId,
      dateFrom,
      dateTo,
      customersPage,
      buyerType,
    ],
    queryFn: () =>
      customFetch<ErpCustomersResponse>(
        buildUrl("/api/analytics/erp/customers", {
          ...commonParams,
          page: customersPage,
          limit: PAGE_SIZE,
          buyerType: buyerType === "all" ? undefined : buyerType,
        }),
      ),
    enabled,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const productsQuery = useQuery<ErpProductsResponse>({
    queryKey: [
      "performance-products",
      clientId,
      dateFrom,
      dateTo,
      productsPage,
      productSort,
    ],
    queryFn: () =>
      customFetch<ErpProductsResponse>(
        buildUrl("/api/analytics/erp/products", {
          ...commonParams,
          page: productsPage,
          limit: PAGE_SIZE,
          sort: productSort,
        }),
      ),
    enabled,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const k = data?.kpis;
  const financialMetrics = [
    {
      label: "Faturamento ERP",
      value: k?.netRevenue ?? 0,
      format: formatCurrency,
      icon: CircleDollarSign,
      iconClass: "bg-blue-500/10 text-blue-400",
      sparkColor: "#3b82f6",
      sub: [{ label: "Bruto", value: formatCurrency(k?.grossRevenue ?? 0) }],
    },
    {
      label: "Receita atribuída",
      value: k?.attributedRevenue ?? 0,
      format: formatCurrency,
      icon: Target,
      iconClass: "bg-violet-500/10 text-violet-400",
      sparkColor: "#8b5cf6",
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
      format: formatCurrency,
      icon: Megaphone,
      iconClass: "bg-amber-500/10 text-amber-400",
      sparkColor: "#f59e0b",
      sub: [{ label: "Fonte", value: "Meta Ads" }],
    },
    {
      label: "ROAS atribuído",
      value: k?.roas ?? 0,
      format: () => (k?.roas == null ? "—" : `${k.roas.toFixed(2)}x`),
      icon: TrendingUp,
      iconClass: "bg-emerald-500/10 text-emerald-400",
      sparkColor: "#34d399",
      sub: [{ label: "Cálculo", value: "Atribuído / mídia" }],
    },
    {
      label: "MER geral",
      value: k?.mer ?? 0,
      format: () => (k?.mer == null ? "—" : `${k.mer.toFixed(2)}x`),
      icon: Gauge,
      iconClass: "bg-cyan-500/10 text-cyan-400",
      sparkColor: "#22d3ee",
      sub: [{ label: "Cálculo", value: "ERP / mídia" }],
    },
    {
      label: "Lucro bruto",
      value: k?.grossProfit ?? 0,
      format: () =>
        k?.roiStatus === "available" ? formatCurrency(k.grossProfit) : "—",
      icon: Boxes,
      iconClass: "bg-fuchsia-500/10 text-fuchsia-400",
      sparkColor: "#d946ef",
      sub: [
        { label: "Margem", value: formatPercentage(k?.grossMarginPct ?? 0) },
      ],
    },
    {
      label: "ROI final",
      value: k?.roi ?? 0,
      format: () => (k?.roi == null ? "—" : formatPercentage(k.roi)),
      icon: BadgeDollarSign,
      iconClass: "bg-lime-500/10 text-lime-400",
      sparkColor: "#84cc16",
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
      format: formatCurrency,
      icon: ReceiptText,
      iconClass: "bg-blue-500/10 text-blue-400",
      sparkColor: "#60a5fa",
      sub: [
        { label: "Peças/pedido", value: (k?.avgItemsPerOrder ?? 0).toFixed(1) },
      ],
    },
  ];

  const acquisitionMetrics = [
    {
      label: "Pedidos ERP",
      value: k?.orders ?? 0,
      format: formatNumber,
      icon: ReceiptText,
      iconClass: "bg-blue-500/10 text-blue-400",
      sparkColor: "#60a5fa",
      sub: [{ label: "Peças", value: formatNumber(k?.totalQuantity ?? 0) }],
    },
    {
      label: "Pedidos atribuídos",
      value: k?.attributedOrders ?? 0,
      format: formatNumber,
      icon: PackageCheck,
      iconClass: "bg-emerald-500/10 text-emerald-400",
      sparkColor: "#10b981",
      sub: [
        {
          label: "Cobertura",
          value: formatPercentage(k?.attributionCoveragePct ?? 0),
        },
      ],
      ringValue: k?.attributionCoveragePct ?? 0,
    },
    {
      label: "Compradores únicos",
      value: k?.uniqueBuyers ?? 0,
      format: formatNumber,
      icon: Users,
      iconClass: "bg-purple-500/10 text-purple-400",
      sparkColor: "#c084fc",
      sub: [
        { label: "Atribuídos", value: formatNumber(k?.attributedBuyers ?? 0) },
      ],
    },
    {
      label: "Clientes novos",
      value: k?.newBuyers ?? 0,
      format: formatNumber,
      icon: UserRoundCheck,
      iconClass: "bg-lime-500/10 text-lime-400",
      sparkColor: "#84cc16",
      sub: [
        {
          label: "Novos atribuídos",
          value: formatNumber(k?.newAttributedBuyers ?? 0),
        },
      ],
    },
    {
      label: "Clientes recorrentes",
      value: k?.returningBuyers ?? 0,
      format: formatNumber,
      icon: ShoppingBag,
      iconClass: "bg-rose-500/10 text-rose-400",
      sparkColor: "#fb7185",
      sub: [
        { label: "Retenção", value: formatPercentage(k?.retentionPct ?? 0) },
      ],
    },
    {
      label: "CAC",
      value: k?.cac ?? 0,
      format: () => (k?.cac == null ? "—" : formatCurrency(k.cac)),
      icon: BadgeDollarSign,
      iconClass: "bg-orange-500/10 text-orange-400",
      sparkColor: "#fb923c",
      sub: [{ label: "Base", value: "Novos atribuídos" }],
    },
    {
      label: "CTR",
      value: k?.ctr ?? 0,
      format: formatPercentage,
      icon: MousePointerClick,
      iconClass: "bg-sky-500/10 text-sky-400",
      sparkColor: "#38bdf8",
      sub: [{ label: "Cliques", value: formatNumber(k?.clicks ?? 0) }],
    },
    {
      label: "CPL",
      value: k?.cpl ?? 0,
      format: () => (k?.cpl == null ? "—" : formatCurrency(k.cpl)),
      icon: Target,
      iconClass: "bg-violet-500/10 text-violet-400",
      sparkColor: "#a78bfa",
      sub: [{ label: "Leads Meta", value: formatNumber(k?.leads ?? 0) }],
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

  const campaignRows = data?.campaigns ?? [];
  const campaignPageRows = campaignRows.slice(
    (campaignsPage - 1) * PAGE_SIZE,
    campaignsPage * PAGE_SIZE,
  );

  const exportOrders = async () => {
    setExporting("orders");
    try {
      const result = await customFetch<PerformanceResponse>(
        buildUrl("/api/analytics/performance", {
          ...commonParams,
          page: 1,
          limit: 50,
        }),
      );
      exportRowsAsCsv(
        `performance-pedidos-${dateFrom}-${dateTo}.csv`,
        result.orders.rows,
        [
          { header: "Pedido", accessor: (row) => row.id },
          { header: "Data", accessor: (row) => row.createdAt },
          {
            header: "Cliente",
            accessor: (row) => row.customerName ?? row.company,
          },
          { header: "Documento", accessor: (row) => row.document },
          { header: "Tipo", accessor: (row) => row.buyerType },
          { header: "Origem", accessor: (row) => row.utmSource },
          { header: "Mídia", accessor: (row) => row.utmMedium },
          { header: "Campanha", accessor: (row) => row.utmCampaign },
          { header: "Atribuição", accessor: (row) => row.attribution },
          { header: "Peças", accessor: (row) => row.requestedQuantity },
          { header: "Valor", accessor: (row) => row.netAmount },
        ],
      );
    } finally {
      setExporting(null);
    }
  };

  const exportCustomers = async () => {
    setExporting("customers");
    try {
      const result = await customFetch<ErpCustomersResponse>(
        buildUrl("/api/analytics/erp/customers", {
          ...commonParams,
          page: 1,
          limit: 100,
          buyerType: buyerType === "all" ? undefined : buyerType,
        }),
      );
      exportRowsAsCsv(
        `performance-clientes-${dateFrom}-${dateTo}.csv`,
        result.rows,
        [
          { header: "Cliente", accessor: (row) => row.name ?? row.company },
          { header: "Documento", accessor: (row) => row.document },
          { header: "Tipo", accessor: (row) => row.buyerType },
          { header: "Segmento", accessor: (row) => row.segment },
          { header: "Pedidos no período", accessor: (row) => row.orders },
          { header: "Receita no período", accessor: (row) => row.totalSpent },
          {
            header: "Pedidos históricos",
            accessor: (row) => row.historicalOrders,
          },
          { header: "LTV", accessor: (row) => row.lifetimeValue },
          { header: "Origem", accessor: (row) => row.utmSource },
          { header: "Campanha", accessor: (row) => row.utmCampaign },
          { header: "Atribuído", accessor: (row) => row.attributed },
        ],
      );
    } finally {
      setExporting(null);
    }
  };

  const exportProducts = async () => {
    setExporting("products");
    try {
      const result = await customFetch<ErpProductsResponse>(
        buildUrl("/api/analytics/erp/products", {
          ...commonParams,
          page: 1,
          limit: 200,
          sort: productSort,
        }),
      );
      exportRowsAsCsv(
        `performance-produtos-${dateFrom}-${dateTo}.csv`,
        result.rows,
        [
          { header: "Produto", accessor: (row) => row.name },
          { header: "Categoria", accessor: (row) => row.category },
          { header: "Peças", accessor: (row) => row.units },
          { header: "Receita", accessor: (row) => row.revenue },
          { header: "Lucro bruto", accessor: (row) => row.grossProfit },
          { header: "Margem", accessor: (row) => row.grossMarginPct },
          { header: "Estoque", accessor: (row) => row.stock },
          { header: "Giro", accessor: (row) => row.turnoverPct },
          { header: "Poder de venda", accessor: (row) => row.salesPower },
        ],
      );
    } finally {
      setExporting(null);
    }
  };

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
          title="Resumo financeiro"
          description="Resultado oficial do ERP conciliado com mídia e atribuição do e-commerce."
        />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {financialMetrics.map((metric, index) => (
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
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeader
          title="Aquisição e clientes"
          description="Eficiência da mídia até o comprador identificado no ERP."
        />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {acquisitionMetrics.map((metric, index) => (
            <DashboardKpiCard
              key={metric.label}
              {...metric}
              change={null}
              changeLabel=""
              sparkValues={[]}
              ringColor={metric.sparkColor}
              isLoading={isLoading}
              testId={`performance-acquisition-kpi-${index}`}
            />
          ))}
        </div>
      </section>

      <Card>
        <CardContent className="p-5">
          <SectionHeader
            title="Qualidade e conciliação dos dados"
            description="Cobertura real das chaves necessárias para calcular atribuição, margem e ROI."
          />
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {(data?.quality ?? []).map((item) => (
              <div
                key={item.key}
                className="rounded-md border bg-background/30 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">{item.label}</p>
                  <Badge
                    variant="outline"
                    className={
                      item.status === "good"
                        ? "border-emerald-500/30 text-emerald-400"
                        : item.status === "attention"
                          ? "border-amber-500/30 text-amber-400"
                          : "border-red-500/30 text-red-400"
                    }
                  >
                    {formatPercentage(item.value)}
                  </Badge>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={
                      item.status === "good"
                        ? "h-full bg-emerald-500"
                        : item.status === "attention"
                          ? "h-full bg-amber-500"
                          : "h-full bg-red-500"
                    }
                    style={{
                      width: `${Math.min(100, Math.max(0, item.value))}%`,
                    }}
                  />
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  {item.detail}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-2 xl:grid-cols-4">
            {(data?.reconciliation ?? []).map((item) => (
              <div key={item.label} className="bg-card p-4">
                <p className="text-xs text-muted-foreground">{item.label}</p>
                <p className="mt-2 text-2xl font-semibold tabular-nums">
                  {formatNumber(item.value)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.detail}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <SectionHeader
            title="Funil consolidado"
            description="A origem de cada etapa é indicada porque cliques, eventos do site e pedidos do ERP possuem bases diferentes."
          />
          <div className="mt-5 overflow-x-auto">
            <div className="grid min-w-[980px] grid-cols-8 gap-2">
              {(data?.funnel ?? []).map((stage, index) => (
                <div
                  key={stage.key}
                  className="relative rounded-md border bg-background/30 p-3"
                >
                  <Badge variant="outline" className="mb-3 text-[10px]">
                    {stage.source}
                  </Badge>
                  <p className="min-h-10 text-xs font-medium">{stage.label}</p>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">
                    {formatNumber(stage.value)}
                  </p>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {stage.previousRate == null
                      ? "Entrada do funil"
                      : `${formatPercentage(stage.previousRate)} da etapa anterior`}
                  </p>
                  {index < (data?.funnel.length ?? 0) - 1 && (
                    <span className="absolute -right-2.5 top-1/2 z-10 text-muted-foreground">
                      →
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

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

      <Card>
        <CardContent className="p-5">
          <SectionHeader
            title="Campanhas"
            description="Investimento da Meta conciliado pelo nome da campanha com a evidência registrada no e-commerce."
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  exportRowsAsCsv(
                    `performance-campanhas-${dateFrom}-${dateTo}.csv`,
                    campaignRows,
                    [
                      { header: "Campanha", accessor: (row) => row.name },
                      { header: "Investimento", accessor: (row) => row.spend },
                      { header: "Leads", accessor: (row) => row.leads },
                      {
                        header: "Pedidos atribuídos",
                        accessor: (row) => row.orders,
                      },
                      {
                        header: "Receita atribuída",
                        accessor: (row) => row.revenue,
                      },
                      { header: "CPL", accessor: (row) => row.cpl },
                      { header: "ROAS", accessor: (row) => row.roas },
                    ],
                  )
                }
              >
                <Download className="mr-2 h-4 w-4" />
                Exportar CSV
              </Button>
            }
          />
          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campanha</TableHead>
                  <TableHead className="text-right">Investimento</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">Pedidos</TableHead>
                  <TableHead className="text-right">
                    Receita atribuída
                  </TableHead>
                  <TableHead className="text-right">CPL</TableHead>
                  <TableHead className="text-right">ROAS</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaignPageRows.map((campaign) => (
                  <TableRow key={campaign.id}>
                    <TableCell className="max-w-[360px] font-medium">
                      <span className="block truncate" title={campaign.name}>
                        {campaign.name}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(campaign.spend)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(campaign.leads)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(campaign.orders)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(campaign.revenue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {campaign.cpl == null
                        ? "—"
                        : formatCurrency(campaign.cpl)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {campaign.roas == null
                        ? "—"
                        : `${campaign.roas.toFixed(2)}x`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination
            page={campaignsPage}
            total={campaignRows.length}
            loading={isFetching}
            onPage={setCampaignsPage}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <BreakdownCard
          title="Vendas por cor"
          description="Participação nas peças vendidas no ERP."
          data={data?.breakdowns.colors ?? []}
        />
        <BreakdownCard
          title="Vendas por tamanho"
          description="Mix real das variantes vendidas."
          data={data?.breakdowns.sizes ?? []}
        />
        <BreakdownCard
          title="Vendas por estado"
          description="Participação no faturamento por UF."
          data={data?.breakdowns.states ?? []}
        />
      </div>

      <Card>
        <CardContent className="p-5">
          <SectionHeader
            title="Compradores"
            description="Pedidos do período combinados ao histórico completo e à origem conhecida no e-commerce."
            action={
              <div className="flex gap-2">
                <Select value={buyerType} onValueChange={setBuyerType}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="NEW">Novos</SelectItem>
                    <SelectItem value="RETURNING">Recorrentes</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={exporting === "customers"}
                  onClick={exportCustomers}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Exportar CSV
                </Button>
              </div>
            }
          />
          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Campanha</TableHead>
                  <TableHead className="text-right">Pedidos</TableHead>
                  <TableHead className="text-right">Receita</TableHead>
                  <TableHead className="text-right">LTV</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(customersQuery.data?.rows ?? []).map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell>
                      <p className="font-medium">
                        {customer.name ??
                          customer.company ??
                          "Cliente não identificado"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {customer.document ?? "Documento não localizado"}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {customer.buyerType === "RETURNING"
                          ? "Recorrente"
                          : "Novo"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {customer.utmSource ?? "Direto / não identificado"}
                    </TableCell>
                    <TableCell className="max-w-[260px]">
                      <span
                        className="block truncate"
                        title={customer.utmCampaign ?? undefined}
                      >
                        {customer.utmCampaign ?? "Não identificada"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(customer.orders)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(customer.totalSpent)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(customer.lifetimeValue)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination
            page={customersPage}
            total={customersQuery.data?.total ?? 0}
            loading={customersQuery.isFetching}
            onPage={setCustomersPage}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <SectionHeader
            title="Produtos e estoque"
            description="Resultado por produto pai com margem, giro, cobertura e potencial financeiro do estoque."
            action={
              <div className="flex gap-2">
                <Select value={productSort} onValueChange={setProductSort}>
                  <SelectTrigger className="w-[170px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="revenue">Maior receita</SelectItem>
                    <SelectItem value="units">Mais vendidos</SelectItem>
                    <SelectItem value="margin">Maior margem</SelectItem>
                    <SelectItem value="turnover">Maior giro</SelectItem>
                    <SelectItem value="sales_power">Poder de venda</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={exporting === "products"}
                  onClick={exportProducts}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Exportar CSV
                </Button>
              </div>
            }
          />
          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead className="text-right">Peças</TableHead>
                  <TableHead className="text-right">Receita</TableHead>
                  <TableHead className="text-right">Margem</TableHead>
                  <TableHead className="text-right">Estoque</TableHead>
                  <TableHead className="text-right">Giro</TableHead>
                  <TableHead className="text-right">Poder de venda</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(productsQuery.data?.rows ?? []).map((product) => (
                  <TableRow key={product.id}>
                    <TableCell>
                      <p className="font-medium">
                        {product.name ?? `Produto ${product.id}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatNumber(product.variantCount)} SKU(s)
                      </p>
                    </TableCell>
                    <TableCell>
                      {product.category ?? "Não identificada"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(product.units)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(product.revenue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPercentage(product.grossMarginPct)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(product.stock)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPercentage(product.turnoverPct)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(product.salesPower)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination
            page={productsPage}
            total={productsQuery.data?.total ?? 0}
            loading={productsQuery.isFetching}
            onPage={setProductsPage}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <SectionHeader
            title="Pedidos e evidências de campanha"
            description="A origem acompanha o comprador conciliado pelo documento; cada pedido ERP aparece uma única vez."
            action={
              <Button
                variant="outline"
                size="sm"
                disabled={exporting === "orders"}
                onClick={exportOrders}
              >
                <Download className="mr-2 h-4 w-4" />
                Exportar CSV
              </Button>
            }
          />
          <div className="mt-4 grid gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-2 xl:grid-cols-4">
            <div className="bg-card px-4 py-3">
              <p className="text-[10px] font-mono uppercase text-muted-foreground">
                Pedidos no período
              </p>
              <p className="mt-1 text-lg font-semibold">
                {formatNumber(k?.orders ?? 0)}
              </p>
            </div>
            <div className="bg-card px-4 py-3">
              <p className="text-[10px] font-mono uppercase text-muted-foreground">
                Peças vendidas
              </p>
              <p className="mt-1 text-lg font-semibold">
                {formatNumber(k?.totalQuantity ?? 0)}
              </p>
            </div>
            <div className="bg-card px-4 py-3">
              <p className="text-[10px] font-mono uppercase text-muted-foreground">
                Receita atribuída
              </p>
              <p className="mt-1 text-lg font-semibold">
                {formatCurrency(k?.attributedRevenue ?? 0)}
              </p>
            </div>
            <div className="bg-card px-4 py-3">
              <p className="text-[10px] font-mono uppercase text-muted-foreground">
                Faturamento ERP
              </p>
              <p className="mt-1 text-lg font-semibold text-primary">
                {formatCurrency(k?.netRevenue ?? 0)}
              </p>
            </div>
          </div>
          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Campanha</TableHead>
                  <TableHead>Atribuição</TableHead>
                  <TableHead className="text-right">Peças</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.orders.rows ?? []).map((order) => (
                  <TableRow key={order.id}>
                    <TableCell>
                      <p className="font-medium">#{order.id}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(order.createdAt).toLocaleString("pt-BR")}
                      </p>
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">
                        {order.customerName ??
                          order.company ??
                          "Cliente não identificado"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {order.document ?? "Documento não localizado"}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {order.buyerType === "RETURNING"
                          ? "Recorrente"
                          : order.buyerType === "NEW"
                            ? "Novo"
                            : "Não identificado"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm">
                        {order.utmSource ?? "Direto / não identificado"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {order.utmMedium ?? "Sem mídia"}
                      </p>
                    </TableCell>
                    <TableCell className="max-w-[260px]">
                      <p
                        className="truncate text-sm"
                        title={order.utmCampaign ?? undefined}
                      >
                        {order.utmCampaign ?? "Não identificada"}
                      </p>
                    </TableCell>
                    <TableCell>
                      <AttributionBadge state={order.attribution} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(order.requestedQuantity)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatCurrency(order.netAmount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination
            page={ordersPage}
            total={data?.orders.total ?? 0}
            loading={isFetching}
            onPage={setOrdersPage}
          />
        </CardContent>
      </Card>
    </div>
  );
}
