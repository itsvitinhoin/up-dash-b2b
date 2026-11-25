import {
  SectionTitle,
  EmptyRow,
  Pagination,
  BreakdownCard as SharedBreakdownCard,
} from "@/components/erp/erp-ui";
import {
  ErpSourceContext,
  useErpSource,
  useErpFetch,
} from "@/components/erp/erp-source";
import { useI18n } from "@/lib/i18n";
import {
  usePreviousPeriodQuery,
  periodQuery,
} from "@/lib/previous-period-query";
import { useDisplayLabel } from "@/lib/display-label";
import { GlassMetricCard } from "@/components/glass-metric-card";
import { Fragment, useDeferredValue, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertCircle,
  BadgeCheck,
  Boxes,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  CreditCard,
  Download,
  Eye,
  Layers3,
  MapPin,
  Package,
  PackageCheck,
  Palette,
  Percent,
  ReceiptText,
  Ruler,
  Search,
  ShoppingBag,
  Store,
  TrendingUp,
  UserRoundCheck,
  Users,
  WalletCards,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  XAxis,
  YAxis,
} from "recharts";
import { queryOpts } from "@/lib/query-opts";
import { useGetClient } from "@workspace/api-client-react";

import { useAuth } from "@/lib/auth";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import { DashboardKpiCard } from "@/components/dashboard-kpi-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
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
import { exportRowsAsCsv } from "@/lib/csv-export";
import { exportRowsAsXlsx } from "@/lib/xlsx-export";
import {
  formatCurrency as currencyFormat,
  formatCurrencySmart as smartCurrencyFormat,
  formatErpDate as erpDateFormat,
  formatNumber as numberFormat,
  formatPercentage as percentageFormat,
} from "@/lib/formatters";

const formatCurrency = (value: number | null | undefined) =>
  value == null ? "—" : currencyFormat(value);
const formatCurrencySmart = (value: number | null | undefined) =>
  value == null ? "—" : smartCurrencyFormat(value);
const formatNumber = (value: number | null | undefined) =>
  value == null ? "—" : numberFormat(value);
const formatPercentage = (value: number | null | undefined) =>
  value == null ? "—" : percentageFormat(value);

const formatErpDate = (
  value: string | null | undefined,
  includeTime = false,
) =>
  value && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value.split("-").reverse().join("/")
    : erpDateFormat(value, includeTime);
function BreakdownCard(
  props: React.ComponentProps<typeof SharedBreakdownCard>,
) {
  const { isBling } = useErpSource();
  return (
    <SharedBreakdownCard
      {...props}
      emptyMessage={
        isBling ? "Dados não disponíveis na carga Bling atual." : undefined
      }
    />
  );
}

type SeriesPoint = { date: string; value: number | null };
type Breakdown = {
  label: string;
  orders: number;
  revenue: number;
  customers?: number;
};
type ErpDashboardResponse = {
  source?: {
    provider: "BLING";
    statusOptions: Array<{ value: string; label: string }>;
  };
  kpis: {
    grossRevenue: number | null;
    netRevenue: number | null;
    discountAmount: number | null;
    orders: number;
    totalQuantity: number;
    returnedQuantity: number | null;
    uniqueCustomers: number;
    newCustomers: number | null;
    returningCustomers: number | null;
    retentionPct: number | null;
    cancelledOrders: number | null;
    cancelledAmount: number | null;
    avgTicket: number;
    returnAmount: number | null;
    avgItemsPerOrder: number;
    returnRatePct: number | null;
    discountRatePct: number | null;
  };
  revenueOverTime: SeriesPoint[];
  ordersOverTime: SeriesPoint[];
  newCustomersOverTime: SeriesPoint[];
  returningCustomersOverTime: SeriesPoint[];
  attribution: {
    attributedCustomers: number;
    unattributedCustomers: number;
    attributedRevenue: number;
    unattributedRevenue: number;
  };
  breakdowns: {
    statuses: Breakdown[];
    payments: Breakdown[];
    sellers: Breakdown[];
    stores: Breakdown[];
    states: Breakdown[];
  };
};
type ErpOrderItem = {
  id: string;
  sku: string | null;
  productId: string | null;
  name: string | null;
  category: string | null;
  color: string | null;
  size: string | null;
  quantity: number;
  unitPrice: number;
  costPrice: number | null;
  discountAmount: number | null;
  grossAmount: number | null;
  netAmount: number | null;
};
type ErpOrderRow = {
  id: string;
  orderValue?: number;
  createdAt: string;
  customerId: string | null;
  customerName: string | null;
  company: string | null;
  document: string | null;
  seller: string | null;
  store: string | null;
  paymentMethod: string | null;
  freightAmount: number | null;
  channel: string;
  status: string | null;
  requestedQuantity: number;
  fulfilledQuantity: number | null;
  returnedQuantity: number | null;
  grossAmount: number | null;
  discountAmount: number | null;
  netAmount: number | null;
  returnAmount: number | null;
  state: string | null;
  city: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  attributed: boolean;
  items: ErpOrderItem[];
};
type ErpOrdersResponse = { rows: ErpOrderRow[]; total: number };
type ErpCustomerRow = {
  id: string;
  name: string | null;
  company: string | null;
  document: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  seller: string | null;
  orders: number;
  totalSpent: number;
  averageTicket: number;
  historicalOrders: number | null;
  lifetimeValue: number | null;
  buyerType: "NEW" | "RETURNING" | null;
  daysSinceLastOrder: number | null;
  segment: "CHAMPION" | "LOYAL" | "POTENTIAL" | "AT_RISK" | null;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  attributed: boolean;
};
type ErpCustomersResponse = { rows: ErpCustomerRow[]; total: number };
type ErpProductVariant = {
  id: string;
  sku: string;
  color: string | null;
  size: string | null;
  units: number;
  revenue: number;
  averagePrice: number;
  catalogPrice: number;
  stock: number | null;
  turnoverPct: number | null;
  salesPower: number | null;
  costAmount: number | null;
  grossProfit: number | null;
  grossMarginPct: number | null;
  coverageDays: number | null;
};
type ErpProductRow = {
  id: string;
  name: string | null;
  category: string | null;
  units: number;
  revenue: number;
  averagePrice: number;
  stock: number | null;
  turnoverPct: number | null;
  salesPower: number | null;
  costAmount: number | null;
  grossProfit: number | null;
  grossMarginPct: number | null;
  coverageDays: number | null;
  variantCount: number;
  outOfStockCount: number;
  variants: ErpProductVariant[];
};
type ProductBreakdown = {
  label: string;
  units: number;
  revenue: number;
  stock?: number;
  salesPower?: number;
};
type ErpProductsResponse = {
  rows: ErpProductRow[];
  total: number;
  totalSkus: number;
  filteredTotal: number;
  totalRevenue: number;
  totalUnits: number;
  totalStock: number | null;
  outOfStockCount: number;
  turnoverPct: number | null;
  salesPower: number | null;
  totalCost: number | null;
  grossProfit: number | null;
  grossMarginPct: number | null;
  negativeStockCount: number;
  coverageDays: number | null;
  breakdowns: {
    categories: ProductBreakdown[];
    colors: ProductBreakdown[];
    sizes: ProductBreakdown[];
  };
};
type Metric = {
  previousValue?: number | null;
  comparisonValue?: number | null;
  label: string;
  value: number | null;
  format: (value: number) => string;
  icon: typeof Users;
  iconClass: string;
  sparkColor: string;
  subLabel: string;
  subValue: string;
  ringValue?: number;
};

const PAGE_SIZE = 20;
const chartConfig = {
  revenue: { label: "Faturamento", color: "hsl(var(--chart-1))" },
  orders: { label: "Pedidos", color: "hsl(var(--chart-2))" },
  primary: { label: "Valor", color: "hsl(var(--chart-1))" },
  secondary: { label: "Comparativo", color: "hsl(var(--chart-2))" },
} satisfies ChartConfig;

function useErpClientId() {
  const { isBling } = useErpSource();
  const { selectedClientId, user } = useAuth();
  const clientId =
    user?.role === "ADMIN" ? selectedClientId || undefined : undefined;
  return {
    clientId,
    source: isBling ? "BLING" : "B2B",
    enabled:
      user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId),
  };
}
function buildUrl(
  path: string,
  params: Record<string, string | number | undefined>,
) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(
    ([key, value]) =>
      value !== undefined && value !== "" && query.set(key, String(value)),
  );
  return `${path}${query.size ? `?${query}` : ""}`;
}
function usePeriod() {
  const { dateRange } = useDashboardFilters();
  return {
    dateFrom: format(dateRange.from, "yyyy-MM-dd"),
    dateTo: format(dateRange.to, "yyyy-MM-dd"),
  };
}
function useErpDashboard() {
  const customFetch = useErpFetch();
  const { isBling } = useErpSource();
  const { dateFrom, dateTo } = usePeriod();
  const { clientId, enabled, source } = useErpClientId();
  const previous = usePreviousPeriodQuery<ErpDashboardResponse>(
    periodQuery("/api/analytics/erp/dashboard", { clientId, dateFrom, dateTo }),
    enabled && !isBling,
  );
  const query = useQuery<ErpDashboardResponse>({
    queryKey: ["erp-dashboard", source, clientId, dateFrom, dateTo],
    queryFn: () =>
      customFetch(
        buildUrl("/api/analytics/erp/dashboard", {
          clientId,
          dateFrom,
          dateTo,
        }),
      ),
    enabled,
    staleTime: 120_000,
    gcTime: 900_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  return { ...query, previousData: previous.data };
}
function KpiGrid({
  metrics,
  loading,
}: {
  metrics: Metric[];
  loading: boolean;
}) {
  const { tx } = useI18n();
  const { isBling } = useErpSource();
  const [location] = useLocation();
  const hasPreviousRow = ["/erp", "/erp/pedidos", "/erp/clientes"].includes(
    location,
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric) => (
        <DashboardKpiCard
          key={metric.label}
          icon={metric.icon}
          iconClass={metric.iconClass}
          label={metric.label}
          value={metric.value ?? 0}
          displayValue={metric.value == null && !loading ? "—" : undefined}
          deltaContent={
            isBling && hasPreviousRow && metric.previousValue == null ? (
              <span className="text-muted-foreground">
                Anterior:{" "}
                <span className="text-foreground tabular-nums">—</span>
              </span>
            ) : undefined
          }
          info={
            isBling
              ? "Fonte: carga Bling. Pedidos e peças incluem todas as situações; ticket usa o valor registrado em pedidos. Valores de itens são quantidade × preço unitário. Campos sem informação, histórico completo ou período anterior aparecem como —. Compradores são cadastros, inclusive contatos genéricos."
              : undefined
          }
          comparisonUnavailable={
            isBling
              ? "O período anterior não está coberto pela carga Bling disponível."
              : undefined
          }
          format={metric.format}
          comparisonValue={metric.comparisonValue}
          previousValue={metric.previousValue}
          source={isBling ? "ERP · Bling" : tx("ERP · vendas e clientes")}
          change={null}
          changeLabel=""
          sub={[{ label: metric.subLabel, value: metric.subValue }]}
          sparkValues={[]}
          sparkColor={metric.sparkColor}
          isLoading={loading}
          testId={`erp-kpi-${metric.label.toLowerCase().replace(/\s+/g, "-")}`}
          ringValue={metric.ringValue}
        />
      ))}
    </div>
  );
}
function ExportButton({
  onClick,
  busy,
}: {
  onClick: () => void;
  busy: boolean;
}) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={busy}>
      <Download className="mr-2 h-4 w-4" />
      {busy ? "Exportando..." : "Exportar CSV"}
    </Button>
  );
}
function StatusBadge({ status }: { status: string | null }) {
  const danger = ["CANCELADO", "EXCLUIDO"].includes(status ?? "");
  return (
    <Badge
      variant="outline"
      className={
        status?.startsWith("ID ")
          ? "text-muted-foreground"
          : danger
            ? "border-red-500/30 bg-red-500/10 text-red-500"
            : "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
      }
    >
      {status ?? "Não identificado"}
    </Badge>
  );
}
function CoverageDaysBadge({
  value,
  emptyLabel = "Sem vendas",
}: {
  value: number | null;
  emptyLabel?: string;
}) {
  const { isBling } = useErpSource();
  if (value === null) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        {isBling ? "Indisponível" : emptyLabel}
      </Badge>
    );
  }

  const days = Math.round(value);
  const className =
    days <= 15
      ? "border-red-500/30 bg-red-500/10 text-red-500"
      : days <= 60
        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
        : "border-amber-500/30 bg-amber-500/10 text-amber-500";

  return (
    <Badge variant="outline" className={className}>
      {days} dias
    </Badge>
  );
}
function AttributionBadge({
  row,
}: {
  row: {
    attributed: boolean;
    utmSource: string | null;
    utmMedium: string | null;
  };
}) {
  const { isBling } = useErpSource();
  return row.attributed ? (
    <Badge
      variant="outline"
      className="border-blue-500/30 bg-blue-500/10 text-blue-500"
    >
      {[row.utmSource, row.utmMedium].filter(Boolean).join(" / ") ||
        "Mídia identificada"}
    </Badge>
  ) : (
    <span className="text-xs text-muted-foreground">
      {isBling ? "Não informado pelo ERP" : "Direto / não identificado"}
    </span>
  );
}
function ErpOverview() {
  const customFetch = useErpFetch();
  const { isBling } = useErpSource();
  const { tx } = useI18n();
  const { data, isLoading, previousData } = useErpDashboard();
  const { dateFrom, dateTo } = usePeriod();
  const { clientId, enabled, source } = useErpClientId();
  const { data: products } = useQuery<ErpProductsResponse>({
    queryKey: ["erp-products-overview", source, clientId, dateFrom, dateTo],
    queryFn: () =>
      customFetch(
        buildUrl("/api/analytics/erp/products", {
          clientId,
          dateFrom,
          dateTo,
          page: 1,
          limit: 8,
        }),
      ),
    enabled,
    staleTime: 120_000,
    refetchOnWindowFocus: false,
  });
  const pk = previousData?.kpis;
  const k = data?.kpis;
  const metrics: Metric[] = [
    {
      label: "Faturamento líquido",
      value: k?.netRevenue ?? null,
      comparisonValue: k?.netRevenue ?? null,
      previousValue: pk?.netRevenue,
      format: formatCurrencySmart,
      icon: WalletCards,
      iconClass: "bg-blue-500/10 text-blue-500",
      sparkColor: "#5b8dff",
      subLabel: "Bruto",
      subValue: formatCurrency(k?.grossRevenue),
    },
    {
      label: tx("Pedidos"),
      value: k?.orders ?? null,
      comparisonValue: k?.orders ?? null,
      previousValue: pk?.orders,
      format: formatNumber,
      icon: ReceiptText,
      iconClass: "bg-violet-500/10 text-violet-500",
      sparkColor: "#5b8dff",
      subLabel: "Ticket médio",
      subValue: formatCurrency(k?.avgTicket),
    },
    {
      label: "Compradores",
      value: k?.uniqueCustomers ?? null,
      comparisonValue: k?.uniqueCustomers ?? null,
      previousValue: pk?.uniqueCustomers,
      format: formatNumber,
      icon: Users,
      iconClass: "bg-emerald-500/10 text-emerald-500",
      sparkColor: "#87adff",
      subLabel: "Recorrentes",
      subValue: formatNumber(k?.returningCustomers),
    },
    {
      label: "Retenção",
      value: k?.retentionPct ?? null,
      comparisonValue: k?.retentionPct ?? null,
      previousValue: pk?.retentionPct,
      format: formatPercentage,
      icon: TrendingUp,
      iconClass: "bg-pink-500/10 text-pink-500",
      sparkColor: "#b3caff",
      subLabel: "Novos",
      subValue: formatNumber(k?.newCustomers),
      ringValue: k?.retentionPct ?? 0,
    },
    {
      label: "Peças vendidas",
      value: k?.totalQuantity ?? null,
      comparisonValue: k?.totalQuantity ?? null,
      previousValue: pk?.totalQuantity,
      format: formatNumber,
      icon: Boxes,
      iconClass: "bg-amber-500/10 text-amber-500",
      sparkColor: "#0458fe",
      subLabel: "Média / pedido",
      subValue: (k?.avgItemsPerOrder ?? 0).toFixed(1),
    },
    {
      label: "Descontos",
      value: k?.discountAmount ?? null,
      comparisonValue: k?.discountAmount ?? null,
      previousValue: pk?.discountAmount,
      format: formatCurrencySmart,
      icon: Percent,
      iconClass: "bg-cyan-500/10 text-cyan-500",
      sparkColor: "#afc4ff",
      subLabel: "% do bruto",
      subValue: formatPercentage(k?.discountRatePct),
    },
    {
      label: "Devoluções",
      value: k?.returnAmount ?? null,
      comparisonValue: k?.returnAmount ?? null,
      previousValue: pk?.returnAmount,
      format: formatCurrencySmart,
      icon: AlertCircle,
      iconClass: "bg-orange-500/10 text-orange-500",
      sparkColor: "#0458fe",
      subLabel: "% do bruto",
      subValue: formatPercentage(k?.returnRatePct),
    },
    {
      label: "Cancelamentos",
      value: k?.cancelledOrders ?? null,
      comparisonValue: k?.cancelledOrders ?? null,
      previousValue: pk?.cancelledOrders,
      format: formatNumber,
      icon: AlertCircle,
      iconClass: "bg-red-500/10 text-red-500",
      sparkColor: "#b3caff",
      subLabel: "Valor",
      subValue: formatCurrency(k?.cancelledAmount),
    },
  ];
  const trend = (data?.revenueOverTime ?? []).map((point, index) => ({
    date: point.date,
    revenue: point.value,
    orders: data?.ordersOverTime[index]?.value ?? 0,
  }));
  return (
    <>
      <KpiGrid metrics={metrics} loading={isLoading} />
      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardContent className="p-5">
            <SectionTitle
              icon={TrendingUp}
              title="Faturamento e pedidos"
              description={
                isBling
                  ? "Valor registrado em pedidos por dia, incluindo todas as situações."
                  : "Evolução diária no período selecionado."
              }
            />
            <ChartContainer
              config={chartConfig}
              className="mt-4 h-[300px] w-full aspect-auto"
            >
              <AreaChart data={trend}>
                <defs>
                  <linearGradient id="erp-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor="var(--color-revenue)"
                      stopOpacity={0.35}
                    />
                    <stop
                      offset="95%"
                      stopColor="var(--color-revenue)"
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `R$ ${Math.round(v / 1000)}k`}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area
                  dataKey="revenue"
                  stroke="var(--color-revenue)"
                  fill="url(#erp-fill)"
                  strokeWidth={2}
                  name={tx("Faturamento")}
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardContent className="p-5">
            <SectionTitle
              icon={Users}
              title="Novos vs. recorrentes"
              description={
                isBling
                  ? "Classificação indisponível sem histórico completo de compras."
                  : "Classificação pelo histórico completo de compras."
              }
            />
            <ChartContainer
              config={chartConfig}
              className="mt-4 h-[300px] w-full aspect-auto"
            >
              <BarChart
                data={(data?.newCustomersOverTime ?? []).map((p, i) => ({
                  date: p.date,
                  primary: p.value,
                  secondary: data?.returningCustomersOverTime[i]?.value ?? 0,
                }))}
              >
                <CartesianGrid vertical={false} />
                <XAxis dataKey="date" tickLine={false} axisLine={false} />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar
                  dataKey="primary"
                  fill="var(--color-primary)"
                  radius={[3, 3, 0, 0]}
                >
                  <LabelList
                    dataKey="primary"
                    position="top"
                    className="fill-foreground"
                    fontSize={10}
                    formatter={(value: number) => formatNumber(Number(value))}
                  />
                </Bar>
                <Bar
                  dataKey="secondary"
                  fill="var(--color-secondary)"
                  radius={[3, 3, 0, 0]}
                >
                  <LabelList
                    dataKey="secondary"
                    position="top"
                    className="fill-foreground"
                    fontSize={10}
                    formatter={(value: number) => formatNumber(Number(value))}
                  />
                </Bar>
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <BreakdownCard
          title="Formas de pagamento"
          description="Faturamento por meio de pagamento."
          icon={CreditCard}
          data={data?.breakdowns.payments ?? []}
        />
        <BreakdownCard
          title="Ranking de vendedores"
          description="Receita líquida por vendedor."
          icon={UserRoundCheck}
          data={data?.breakdowns.sellers ?? []}
        />
        <BreakdownCard
          title={tx("Geografia de compradores")}
          description={tx("Receita por estado do cadastro.")}
          icon={MapPin}
          data={data?.breakdowns.states ?? []}
        />
      </div>
      <Card>
        <CardContent className="p-5">
          <SectionTitle
            icon={Package}
            title="Produtos com maior faturamento"
            description="Mix vendido e disponibilidade atual do catálogo."
          />
          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead className="text-right">Variantes</TableHead>
                  <TableHead className="text-right">Peças</TableHead>
                  <TableHead className="text-right">
                    {tx("Faturamento")}
                  </TableHead>
                  <TableHead className="text-right">Margem</TableHead>
                  <TableHead className="text-right">Giro</TableHead>
                  <TableHead className="text-right">Poder de venda</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(products?.rows ?? []).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <p className="font-medium">{p.name ?? p.id}</p>
                      <p className="text-xs text-muted-foreground">
                        Produto {p.id}
                      </p>
                    </TableCell>
                    <TableCell>{p.category ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      {p.variantCount}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatNumber(p.units)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(p.revenue)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatPercentage(p.grossMarginPct)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatPercentage(p.turnoverPct)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(p.salesPower)}
                    </TableCell>
                  </TableRow>
                ))}
                {!products?.rows.length && <EmptyRow colSpan={8} />}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function ErpOrdersView() {
  const customFetch = useErpFetch();
  const { isBling } = useErpSource();
  const { tx } = useI18n();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const deferred = useDeferredValue(search.trim());
  const { dateFrom, dateTo } = usePeriod();
  const { clientId, enabled, source } = useErpClientId();
  const { data: dashboard, previousData } = useErpDashboard();
  const params = {
    clientId,
    dateFrom,
    dateTo,
    search: deferred || undefined,
    status: status === "all" ? undefined : status,
  };
  const { data, isLoading } = useQuery<ErpOrdersResponse>({
    queryKey: ["erp-orders", source, params, page],
    queryFn: () =>
      customFetch(
        buildUrl("/api/analytics/erp/orders", {
          ...params,
          page,
          limit: PAGE_SIZE,
        }),
      ),
    enabled,
    staleTime: 120_000,
    refetchOnWindowFocus: false,
  });
  const pk = previousData?.kpis;
  const k = dashboard?.kpis;
  const exportCsv = async () => {
    setExporting(true);
    try {
      const result = await customFetch<ErpOrdersResponse>(
        buildUrl("/api/analytics/erp/orders", {
          ...params,
          page: 1,
          limit: 5000,
        }),
      );
      exportRowsAsXlsx(
        `pedidos-erp-${dateFrom}-${dateTo}.xlsx`,
        tx("Pedidos"),
        result.rows,
        [
          { header: "Pedido", accessor: (r) => r.id },
          {
            header: "Data",
            accessor: (r) =>
              r.createdAt ? r.createdAt.slice(0, 10) : r.createdAt,
          },
          { header: "Cliente", accessor: (r) => r.customerName },
          { header: "Documento", accessor: (r) => r.document },
          { header: "Loja", accessor: (r) => r.store },
          { header: "Vendedor", accessor: (r) => r.seller },
          { header: "Status", accessor: (r) => r.status },
          { header: "Pagamento", accessor: (r) => r.paymentMethod },
          { header: "Canal", accessor: (r) => r.channel },
          { header: "Quantidade", accessor: (r) => r.requestedQuantity },
          { header: "Bruto", accessor: (r) => r.grossAmount },
          { header: "Desconto", accessor: (r) => r.discountAmount },
          { header: "Devolução", accessor: (r) => r.returnAmount },
          { header: "Líquido", accessor: (r) => r.netAmount },
          ...(isBling
            ? [
                {
                  header: "Valor registrado no Bling",
                  accessor: (r: ErpOrderRow) => r.orderValue,
                },
              ]
            : []),
          { header: "Origem", accessor: (r) => r.utmSource },
          { header: "Campanha", accessor: (r) => r.utmCampaign },
        ],
      );
    } catch (error) {
      if (!isBling) throw error; // Bling transport already presents the failure.
    } finally {
      setExporting(false);
    }
  };
  const metrics: Metric[] = [
    {
      label: "Faturamento bruto",
      value: k?.grossRevenue ?? null,
      comparisonValue: k?.grossRevenue ?? null,
      previousValue: pk?.grossRevenue,
      format: formatCurrencySmart,
      icon: WalletCards,
      iconClass: "bg-blue-500/10 text-blue-500",
      sparkColor: "#5b8dff",
      subLabel: "Líquido",
      subValue: formatCurrency(k?.netRevenue),
    },
    {
      label: "Pedidos únicos",
      value: k?.orders ?? null,
      comparisonValue: k?.orders ?? null,
      previousValue: pk?.orders,
      format: formatNumber,
      icon: ReceiptText,
      iconClass: "bg-violet-500/10 text-violet-500",
      sparkColor: "#5b8dff",
      subLabel: "Ticket médio",
      subValue: formatCurrency(k?.avgTicket),
    },
    {
      label: "Peças vendidas",
      value: k?.totalQuantity ?? null,
      comparisonValue: k?.totalQuantity ?? null,
      previousValue: pk?.totalQuantity,
      format: formatNumber,
      icon: Boxes,
      iconClass: "bg-amber-500/10 text-amber-500",
      sparkColor: "#0458fe",
      subLabel: "Média / pedido",
      subValue: (k?.avgItemsPerOrder ?? 0).toFixed(1),
    },
    {
      label: "Cancelamentos",
      value: k?.cancelledOrders ?? null,
      comparisonValue: k?.cancelledOrders ?? null,
      previousValue: pk?.cancelledOrders,
      format: formatNumber,
      icon: AlertCircle,
      iconClass: "bg-red-500/10 text-red-500",
      sparkColor: "#b3caff",
      subLabel: "Valor",
      subValue: formatCurrency(k?.cancelledAmount),
    },
  ];
  return (
    <>
      <KpiGrid metrics={metrics} loading={isLoading} />
      <Card>
        <CardContent className="p-5">
          <SectionTitle
            icon={ShoppingBag}
            title="Pedidos do ERP"
            description="Pedido pai com detalhamento dos itens, descontos e devoluções."
            action={<ExportButton onClick={exportCsv} busy={exporting} />}
          />
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Buscar pedido, cliente ou documento"
                className="pl-9"
              />
            </div>
            <Select
              value={status}
              onValueChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="sm:w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                {(
                  dashboard?.source?.statusOptions?.map((s) => s.label) ?? [
                    "FATURADO",
                    "FINALIZADO",
                    "ESPERA",
                    "CANCELADO",
                    "EXCLUIDO",
                  ]
                ).map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Loja / vendedor</TableHead>
                  <TableHead>Status / pagamento</TableHead>
                  <TableHead>Canal</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead className="text-right">Peças</TableHead>
                  <TableHead className="text-right">Bruto</TableHead>
                  <TableHead className="text-right">Líquido</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && <EmptyRow colSpan={9} loading />}
                {!isLoading && !data?.rows.length && <EmptyRow colSpan={9} />}
                {(data?.rows ?? []).map((order) => (
                  <Fragment key={order.id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() =>
                        setExpanded((current) => {
                          const next = new Set(current);
                          next.has(order.id)
                            ? next.delete(order.id)
                            : next.add(order.id);
                          return next;
                        })
                      }
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {expanded.has(order.id) ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                          <div>
                            <p className="font-medium">#{order.id}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatErpDate(order.createdAt, true)}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="min-w-48 font-medium">
                          {order.customerName ?? "—"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {order.document ?? order.customerId ?? "—"}
                        </p>
                      </TableCell>
                      <TableCell>
                        <p>{order.store ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">
                          {order.seller ?? "—"}
                        </p>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={order.status} />
                        <p className="mt-1 text-xs text-muted-foreground">
                          {order.paymentMethod ?? "—"}
                        </p>
                      </TableCell>
                      <TableCell>{order.channel}</TableCell>
                      <TableCell>
                        <AttributionBadge row={order} />
                      </TableCell>
                      <TableCell className="text-right">
                        {formatNumber(order.requestedQuantity)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(order.grossAmount)}
                      </TableCell>
                      <TableCell
                        className="text-right font-medium"
                        title={
                          isBling
                            ? `Valor registrado no Bling: ${formatCurrency(order.orderValue)}. Receita líquida não disponível.`
                            : undefined
                        }
                      >
                        {formatCurrency(order.netAmount)}
                      </TableCell>
                    </TableRow>
                    {expanded.has(order.id) && (
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={9} className="p-4">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>SKU / produto</TableHead>
                                <TableHead>Categoria</TableHead>
                                <TableHead>Cor</TableHead>
                                <TableHead>Tamanho</TableHead>
                                <TableHead className="text-right">
                                  Qtd.
                                </TableHead>
                                <TableHead className="text-right">
                                  Preço
                                </TableHead>
                                <TableHead className="text-right">
                                  Custo
                                </TableHead>
                                <TableHead className="text-right">
                                  Desconto
                                </TableHead>
                                <TableHead className="text-right">
                                  Líquido
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {order.items.map((item) => (
                                <TableRow key={item.id}>
                                  <TableCell>
                                    <p className="font-medium">
                                      {item.name ?? "—"}
                                    </p>
                                    <p className="font-mono text-xs text-muted-foreground">
                                      {item.sku ?? "—"}
                                    </p>
                                  </TableCell>
                                  <TableCell>{item.category ?? "—"}</TableCell>
                                  <TableCell>{item.color ?? "—"}</TableCell>
                                  <TableCell>{item.size ?? "—"}</TableCell>
                                  <TableCell className="text-right">
                                    {item.quantity}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {formatCurrency(item.unitPrice)}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {formatCurrency(item.costPrice)}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {formatCurrency(item.discountAmount)}
                                  </TableCell>
                                  <TableCell className="text-right font-medium">
                                    {formatCurrency(item.netAmount)}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination
            page={page}
            total={data?.total ?? 0}
            size={PAGE_SIZE}
            onChange={setPage}
          />
        </CardContent>
      </Card>
    </>
  );
}

function BuyerOrderHistoryDialog({
  customer,
  page,
  onPageChange,
  onOpenChange,
}: {
  customer: ErpCustomerRow | null;
  page: number;
  onPageChange: (page: number) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const customFetch = useErpFetch();
  const { isBling } = useErpSource();
  const { dateFrom, dateTo } = usePeriod();
  const { tx } = useI18n();
  const { clientId, enabled, source } = useErpClientId();
  const document = customer?.document ?? customer?.id;
  const { data, isLoading } = useQuery<ErpOrdersResponse>({
    queryKey: [
      "erp-customer-order-history",
      source,
      clientId,
      document,
      page,
      isBling ? dateFrom : undefined,
      isBling ? dateTo : undefined,
    ],
    queryFn: () =>
      customFetch(
        buildUrl("/api/analytics/erp/orders", {
          clientId,
          customerDocument: document,
          ...(isBling ? { dateFrom, dateTo } : {}),
          allTime: "true",
          page,
          limit: PAGE_SIZE,
        }),
      ),
    enabled: enabled && !!document,
    staleTime: 120_000,
    refetchOnWindowFocus: false,
  });

  return (
    <Dialog open={!!customer} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Histórico de pedidos</DialogTitle>
          <DialogDescription>
            {customer?.name ?? "Comprador"} ·{" "}
            {customer?.document ?? "Sem documento"}
            {isBling
              ? " · Pedidos apenas do período importado selecionado; LTV e histórico completo indisponíveis."
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 border-y py-4 sm:grid-cols-3">
          <GlassMetricCard
            label={tx("Pedidos históricos")}
            value={<>{formatNumber(customer?.historicalOrders)}</>}
            hideComparison
          />
          <GlassMetricCard
            label={tx("Valor total comprado")}
            value={<>{formatCurrency(customer?.lifetimeValue)}</>}
            hideComparison
          />
          <GlassMetricCard
            label={tx("Ticket médio histórico")}
            value={
              <>
                {isBling
                  ? "—"
                  : formatCurrency(
                      (customer?.historicalOrders ?? 0) > 0
                        ? (customer?.lifetimeValue ?? 0) /
                            (customer?.historicalOrders ?? 1)
                        : 0,
                    )}
              </>
            }
          />
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pedido</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Loja / vendedor</TableHead>
                <TableHead className="text-right">Peças</TableHead>
                <TableHead className="text-right">Valor líquido</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <EmptyRow colSpan={6} loading />}
              {!isLoading && !data?.rows.length && <EmptyRow colSpan={6} />}
              {(data?.rows ?? []).map((order) => (
                <TableRow key={order.id}>
                  <TableCell>
                    <p className="font-medium">#{order.id}</p>
                    <p className="text-xs text-muted-foreground">
                      {order.paymentMethod ?? "Pagamento não identificado"}
                    </p>
                  </TableCell>
                  <TableCell>{formatErpDate(order.createdAt)}</TableCell>
                  <TableCell>
                    <StatusBadge status={order.status} />
                  </TableCell>
                  <TableCell>
                    <p>{order.store ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">
                      {order.seller ?? "Sem vendedor"}
                    </p>
                  </TableCell>
                  <TableCell className="text-right">
                    {formatNumber(order.requestedQuantity)}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(order.netAmount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <Pagination
          page={page}
          total={data?.total ?? 0}
          size={PAGE_SIZE}
          onChange={onPageChange}
        />
      </DialogContent>
    </Dialog>
  );
}

function ErpCustomersView() {
  const customFetch = useErpFetch();
  const { isBling } = useErpSource();
  const displayLabel = useDisplayLabel();
  const { tx } = useI18n();
  const [search, setSearch] = useState("");
  const [buyerType, setBuyerType] = useState("all");
  const [page, setPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [selectedCustomer, setSelectedCustomer] =
    useState<ErpCustomerRow | null>(null);
  const [exporting, setExporting] = useState(false);
  const deferred = useDeferredValue(search.trim());
  const { dateFrom, dateTo } = usePeriod();
  const { clientId, enabled, source } = useErpClientId();
  const { data: dashboard, previousData } = useErpDashboard();
  const params = {
    clientId,
    dateFrom,
    dateTo,
    search: deferred || undefined,
    buyerType: buyerType === "all" ? undefined : buyerType,
  };
  const { data, isLoading } = useQuery<ErpCustomersResponse>({
    queryKey: ["erp-customers", source, params, page],
    queryFn: () =>
      customFetch(
        buildUrl("/api/analytics/erp/customers", {
          ...params,
          page,
          limit: PAGE_SIZE,
        }),
      ),
    enabled,
    staleTime: 120_000,
    refetchOnWindowFocus: false,
  });
  const exportCsv = async () => {
    setExporting(true);
    try {
      const result = await customFetch<ErpCustomersResponse>(
        buildUrl("/api/analytics/erp/customers", {
          ...params,
          page: 1,
          limit: 5000,
        }),
      );
      exportRowsAsXlsx(
        `clientes-erp-${dateFrom}-${dateTo}.xlsx`,
        "Clientes",
        result.rows,
        [
          { header: "Cliente", accessor: (r) => r.name },
          { header: "Documento", accessor: (r) => r.document },
          { header: "E-mail", accessor: (r) => r.email },
          { header: "Telefone", accessor: (r) => r.phone },
          { header: "Cidade", accessor: (r) => r.city },
          { header: "UF", accessor: (r) => r.state },
          { header: "Vendedor", accessor: (r) => r.seller },
          { header: "Tipo", accessor: (r) => r.buyerType },
          { header: "Segmento", accessor: (r) => r.segment },
          { header: "Pedidos no período", accessor: (r) => r.orders },
          { header: "Comprado no período", accessor: (r) => r.totalSpent },
          {
            header: tx("Pedidos históricos"),
            accessor: (r) => r.historicalOrders,
          },
          { header: "LTV", accessor: (r) => r.lifetimeValue },
          {
            header: "Último pedido",
            accessor: (r) =>
              r.lastOrderAt ? r.lastOrderAt.slice(0, 10) : r.lastOrderAt,
          },
        ],
      );
    } catch (error) {
      if (!isBling) throw error; // Bling transport already presents the failure.
    } finally {
      setExporting(false);
    }
  };
  const pk = previousData?.kpis;
  const k = dashboard?.kpis;
  const metrics: Metric[] = [
    {
      label: "Compradores",
      value: k?.uniqueCustomers ?? null,
      comparisonValue: k?.uniqueCustomers ?? null,
      previousValue: pk?.uniqueCustomers,
      format: formatNumber,
      icon: Users,
      iconClass: "bg-blue-500/10 text-blue-500",
      sparkColor: "#5b8dff",
      subLabel: "No período",
      subValue: `${dateFrom} a ${dateTo}`,
    },
    {
      label: "Novos compradores",
      value: k?.newCustomers ?? null,
      comparisonValue: k?.newCustomers ?? null,
      previousValue: pk?.newCustomers,
      format: formatNumber,
      icon: UserRoundCheck,
      iconClass: "bg-emerald-500/10 text-emerald-500",
      sparkColor: "#87adff",
      subLabel: "Regra",
      subValue: "Primeira compra histórica",
    },
    {
      label: "Recorrentes",
      value: k?.returningCustomers ?? null,
      comparisonValue: k?.returningCustomers ?? null,
      previousValue: pk?.returningCustomers,
      format: formatNumber,
      icon: Users,
      iconClass: "bg-violet-500/10 text-violet-500",
      sparkColor: "#5b8dff",
      subLabel: "Regra",
      subValue: "Já compraram antes",
    },
    {
      label: "Retenção",
      value: k?.retentionPct ?? null,
      comparisonValue: k?.retentionPct ?? null,
      previousValue: pk?.retentionPct,
      format: formatPercentage,
      icon: TrendingUp,
      iconClass: "bg-pink-500/10 text-pink-500",
      sparkColor: "#b3caff",
      subLabel: "Cálculo",
      subValue: "Recorrentes / compradores",
      ringValue: k?.retentionPct ?? 0,
    },
  ];
  return (
    <>
      <KpiGrid metrics={metrics} loading={isLoading} />
      <Card>
        <CardContent className="p-5">
          <SectionTitle
            icon={Users}
            title="Base de compradores"
            description="Comportamento no período, histórico total, recência e segmentação comercial."
            action={<ExportButton onClick={exportCsv} busy={exporting} />}
          />
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Buscar cliente, documento ou e-mail"
                className="pl-9"
              />
            </div>
            <Select
              value={buyerType}
              onValueChange={(v) => {
                setBuyerType(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="sm:w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os compradores</SelectItem>
                <SelectItem value="NEW" disabled={isBling}>
                  Novos
                </SelectItem>
                <SelectItem value="RETURNING" disabled={isBling}>
                  Recorrentes
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Localização</TableHead>
                  <TableHead>Tipo / segmento</TableHead>
                  <TableHead>Vendedor</TableHead>
                  <TableHead className="text-right">Pedidos período</TableHead>
                  <TableHead className="text-right">Valor período</TableHead>
                  <TableHead className="text-right">
                    {tx("Pedidos históricos")}
                  </TableHead>
                  <TableHead className="text-right">LTV</TableHead>
                  <TableHead>Última compra</TableHead>
                  <TableHead>Origem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && <EmptyRow colSpan={10} loading />}
                {!isLoading && !data?.rows.length && <EmptyRow colSpan={10} />}
                {(data?.rows ?? []).map((c) => (
                  <TableRow
                    key={c.id}
                    role="button"
                    tabIndex={0}
                    className="cursor-pointer hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    onClick={() => {
                      setHistoryPage(1);
                      setSelectedCustomer(c);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setHistoryPage(1);
                        setSelectedCustomer(c);
                      }
                    }}
                  >
                    <TableCell>
                      <div className="flex min-w-52 items-start gap-2">
                        <Eye className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <div>
                          <p className="font-medium">{c.name ?? "—"}</p>
                          <p className="text-xs text-primary">Ver pedidos</p>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {c.document ?? "—"} · {c.email ?? "—"}
                      </p>
                    </TableCell>
                    <TableCell>
                      {c.city ?? "—"} · {c.state ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {c.buyerType == null
                          ? "—"
                          : c.buyerType === "NEW"
                            ? "Novo"
                            : "Recorrente"}
                      </Badge>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {c.segment ? displayLabel(c.segment) : "—"}
                      </p>
                    </TableCell>
                    <TableCell>{c.seller ?? "—"}</TableCell>
                    <TableCell className="text-right">{c.orders}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(c.totalSpent)}
                    </TableCell>
                    <TableCell className="text-right">
                      {c.historicalOrders ?? "—"}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(c.lifetimeValue)}
                    </TableCell>
                    <TableCell>
                      <p>{formatErpDate(c.lastOrderAt)}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.daysSinceLastOrder === null
                          ? "Sem histórico"
                          : `${c.daysSinceLastOrder} dias`}
                      </p>
                    </TableCell>
                    <TableCell>
                      <AttributionBadge row={c} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination
            page={page}
            total={data?.total ?? 0}
            size={PAGE_SIZE}
            onChange={setPage}
          />
        </CardContent>
      </Card>
      <BuyerOrderHistoryDialog
        customer={selectedCustomer}
        page={historyPage}
        onPageChange={setHistoryPage}
        onOpenChange={(open) => {
          if (!open) setSelectedCustomer(null);
        }}
      />
    </>
  );
}

function useProducts(filters: {
  search: string;
  category: string;
  stockStatus: string;
  sort: string;
  page: number;
}) {
  const customFetch = useErpFetch();
  const { isBling } = useErpSource();
  const { dateFrom, dateTo } = usePeriod();
  const { clientId, enabled, source } = useErpClientId();
  const deferred = useDeferredValue(filters.search.trim());
  const params = {
    clientId,
    dateFrom,
    dateTo,
    search: deferred || undefined,
    category: filters.category === "all" ? undefined : filters.category,
    stockStatus:
      filters.stockStatus === "all" ? undefined : filters.stockStatus,
    sort: filters.sort,
    page: filters.page,
    limit: PAGE_SIZE,
  };
  return {
    dateFrom,
    dateTo,
    clientId,
    params,
    query: useQuery<ErpProductsResponse>({
      queryKey: ["erp-products", source, params],
      queryFn: () =>
        customFetch(buildUrl("/api/analytics/erp/products", params)),
      enabled,
      staleTime: 120_000,
      refetchOnWindowFocus: false,
    }),
  };
}
function ProductTable({
  data,
  loading,
  expanded,
  setExpanded,
  stockMode,
}: {
  data?: ErpProductsResponse;
  loading: boolean;
  expanded: Set<string>;
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>;
  stockMode?: boolean;
}) {
  const { tx } = useI18n();
  const columnCount = stockMode ? 10 : 9;

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Produto</TableHead>
            <TableHead>Categoria</TableHead>
            <TableHead className="text-right">SKUs</TableHead>
            <TableHead className="text-right">Vendidas</TableHead>
            <TableHead className="text-right">{tx("Faturamento")}</TableHead>
            <TableHead className="text-right">
              {stockMode ? "Margem" : "Dias restantes"}
            </TableHead>
            <TableHead className="text-right">Giro</TableHead>
            {stockMode && (
              <TableHead className="text-right">Cobertura</TableHead>
            )}
            <TableHead className="text-right">Estoque</TableHead>
            <TableHead className="text-right">Poder de venda</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && <EmptyRow colSpan={columnCount} loading />}
          {!loading && !data?.rows.length && <EmptyRow colSpan={columnCount} />}
          {(data?.rows ?? []).map((p) => (
            <Fragment key={p.id}>
              <TableRow
                className="cursor-pointer"
                onClick={() =>
                  setExpanded((current) => {
                    const next = new Set(current);
                    next.has(p.id) ? next.delete(p.id) : next.add(p.id);
                    return next;
                  })
                }
              >
                <TableCell>
                  <div className="flex min-w-64 items-center gap-2">
                    {expanded.has(p.id) ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    <div>
                      <p className="font-medium">{p.name ?? p.id}</p>
                      <p className="text-xs text-muted-foreground">
                        Produto {p.id}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>{p.category ?? "—"}</TableCell>
                <TableCell className="text-right">{p.variantCount}</TableCell>
                <TableCell className="text-right">{p.units}</TableCell>
                <TableCell className="text-right font-medium">
                  {formatCurrency(p.revenue)}
                </TableCell>
                <TableCell className="text-right">
                  {stockMode ? (
                    formatPercentage(p.grossMarginPct)
                  ) : (
                    <CoverageDaysBadge value={p.coverageDays} />
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {formatPercentage(p.turnoverPct)}
                </TableCell>
                {stockMode && (
                  <TableCell className="text-right">
                    <CoverageDaysBadge
                      value={p.coverageDays}
                      emptyLabel="Sem giro"
                    />
                  </TableCell>
                )}
                <TableCell className="text-right">
                  <Badge
                    variant="outline"
                    className={
                      p.stock == null
                        ? "text-muted-foreground"
                        : p.stock <= 0
                          ? "border-red-500/30 text-red-500"
                          : "border-emerald-500/30 text-emerald-500"
                    }
                  >
                    {formatNumber(p.stock)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-medium">
                  {formatCurrency(p.salesPower)}
                </TableCell>
              </TableRow>
              {expanded.has(p.id) && (
                <TableRow className="bg-muted/20">
                  <TableCell colSpan={columnCount} className="p-4">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>SKU</TableHead>
                          <TableHead>Cor</TableHead>
                          <TableHead>Tamanho</TableHead>
                          <TableHead className="text-right">Vendidas</TableHead>
                          <TableHead className="text-right">Receita</TableHead>
                          <TableHead className="text-right">Preço</TableHead>
                          <TableHead className="text-right">
                            {stockMode ? "Margem" : "Dias restantes"}
                          </TableHead>
                          <TableHead className="text-right">Giro</TableHead>
                          {stockMode && (
                            <TableHead className="text-right">
                              Cobertura
                            </TableHead>
                          )}
                          <TableHead className="text-right">Estoque</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {p.variants.map((v) => (
                          <TableRow key={v.id}>
                            <TableCell className="font-mono text-xs">
                              {v.sku}
                            </TableCell>
                            <TableCell>{v.color ?? "—"}</TableCell>
                            <TableCell>{v.size ?? "—"}</TableCell>
                            <TableCell className="text-right">
                              {v.units}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(v.revenue)}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(v.catalogPrice)}
                            </TableCell>
                            <TableCell className="text-right">
                              {stockMode ? (
                                formatPercentage(v.grossMarginPct)
                              ) : (
                                <CoverageDaysBadge value={v.coverageDays} />
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatPercentage(v.turnoverPct)}
                            </TableCell>
                            {stockMode && (
                              <TableCell className="text-right">
                                <CoverageDaysBadge
                                  value={v.coverageDays}
                                  emptyLabel="Sem giro"
                                />
                              </TableCell>
                            )}
                            <TableCell className="text-right">
                              {formatNumber(v.stock)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
function ProductsAndStockView({ stockMode = false }: { stockMode?: boolean }) {
  const customFetch = useErpFetch();
  const { isBling } = useErpSource();
  const { tx } = useI18n();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [stockStatus, setStockStatus] = useState(
    stockMode ? "in_stock" : "all",
  );
  const [sort, setSort] = useState(stockMode ? "sales_power" : "revenue");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const { dateFrom, dateTo, clientId, params, query } = useProducts({
    search,
    category,
    stockStatus,
    sort,
    page,
  });
  const data = query.data;
  const categories = useMemo(
    () =>
      data?.breakdowns.categories
        .map((v) => v.label)
        .filter((v) => v !== "NAO_IDENTIFICADO") ?? [],
    [data],
  );
  const exportCsv = async () => {
    setExporting(true);
    try {
      const result = await customFetch<ErpProductsResponse>(
        buildUrl("/api/analytics/erp/products", {
          ...params,
          page: 1,
          limit: 5000,
        }),
      );
      const rows = result.rows.flatMap((p) =>
        p.variants.map((v) => ({ p, v })),
      );
      exportRowsAsXlsx(
        `${stockMode ? "estoque" : "produtos"}-erp-${dateFrom}-${dateTo}.xlsx`,
        stockMode ? "Estoque" : "Produtos",
        rows,
        [
          { header: "Produto ID", accessor: (r) => r.p.id },
          { header: "Produto", accessor: (r) => r.p.name },
          { header: "Categoria", accessor: (r) => r.p.category },
          { header: "SKU", accessor: (r) => r.v.sku },
          { header: "Cor", accessor: (r) => r.v.color },
          { header: "Tamanho", accessor: (r) => r.v.size },
          { header: "Vendidas", accessor: (r) => r.v.units },
          { header: "Receita", accessor: (r) => r.v.revenue },
          ...(stockMode
            ? [
                {
                  header: "Margem %",
                  accessor: (r: { v: ErpProductVariant }) => r.v.grossMarginPct,
                },
              ]
            : [
                {
                  header: "Dias restantes",
                  accessor: (r: { v: ErpProductVariant }) => r.v.coverageDays,
                },
              ]),
          { header: "Giro %", accessor: (r) => r.v.turnoverPct },
          ...(stockMode
            ? [
                {
                  header: "Cobertura dias",
                  accessor: (r: { v: ErpProductVariant }) => r.v.coverageDays,
                },
              ]
            : []),
          { header: "Estoque", accessor: (r) => r.v.stock },
          { header: "Poder de venda", accessor: (r) => r.v.salesPower },
        ],
      );
    } catch (error) {
      if (!isBling) throw error; // Bling transport already presents the failure.
    } finally {
      setExporting(false);
    }
  };
  const metrics: Metric[] = stockMode
    ? [
        {
          label: "Estoque atual",
          value: data?.totalStock ?? null,
          format: formatNumber,
          icon: Boxes,
          iconClass: "bg-blue-500/10 text-blue-500",
          sparkColor: "#5b8dff",
          subLabel: "SKUs",
          subValue: formatNumber(data?.totalSkus),
        },
        {
          label: "Poder de venda",
          value: data?.salesPower ?? null,
          format: formatCurrencySmart,
          icon: CircleDollarSign,
          iconClass: "bg-emerald-500/10 text-emerald-500",
          sparkColor: "#87adff",
          subLabel: "Base",
          subValue: "Estoque × preço atual",
        },
        {
          label: "Cobertura",
          value: data?.coverageDays ?? null,
          format: (v) => `${Math.round(v)} dias`,
          icon: Clock3,
          iconClass: "bg-violet-500/10 text-violet-500",
          sparkColor: "#5b8dff",
          subLabel: "Base",
          subValue: "Ritmo do período",
        },
        {
          label: "SKUs sem estoque",
          value: data?.outOfStockCount ?? null,
          format: formatNumber,
          icon: AlertCircle,
          iconClass: "bg-red-500/10 text-red-500",
          sparkColor: "#b3caff",
          subLabel: "Negativos",
          subValue: formatNumber(data?.negativeStockCount),
        },
      ]
    : [
        {
          label: tx("Faturamento"),
          value: data?.totalRevenue ?? null,
          format: formatCurrencySmart,
          icon: WalletCards,
          iconClass: "bg-blue-500/10 text-blue-500",
          sparkColor: "#5b8dff",
          subLabel: "Peças",
          subValue: formatNumber(data?.totalUnits),
        },
        {
          label: "Lucro bruto",
          value: data?.grossProfit ?? null,
          format: formatCurrencySmart,
          icon: CircleDollarSign,
          iconClass: "bg-emerald-500/10 text-emerald-500",
          sparkColor: "#87adff",
          subLabel: "Margem",
          subValue: formatPercentage(data?.grossMarginPct),
        },
        {
          label: "% de giro",
          value: data?.turnoverPct ?? null,
          format: formatPercentage,
          icon: TrendingUp,
          iconClass: "bg-cyan-500/10 text-cyan-500",
          sparkColor: "#afc4ff",
          subLabel: "Cobertura",
          subValue:
            data?.coverageDays == null
              ? isBling
                ? "Indisponível"
                : "Sem giro"
              : `${Math.round(data.coverageDays)} dias`,
          ringValue: data?.turnoverPct ?? 0,
        },
        {
          label: "Poder de venda",
          value: data?.salesPower ?? null,
          format: formatCurrencySmart,
          icon: PackageCheck,
          iconClass: "bg-violet-500/10 text-violet-500",
          sparkColor: "#5b8dff",
          subLabel: "Estoque",
          subValue: formatNumber(data?.totalStock),
        },
      ];
  return (
    <>
      <KpiGrid metrics={metrics} loading={query.isLoading} />
      <div className="grid gap-4 xl:grid-cols-3">
        <BreakdownCard
          title="Categorias"
          description={
            stockMode
              ? "Poder de venda por categoria."
              : "Faturamento por categoria."
          }
          icon={Layers3}
          data={
            (data?.breakdowns.categories ?? []) as unknown as Array<
              Record<string, unknown>
            >
          }
          valueKey={stockMode ? "salesPower" : "revenue"}
        />
        <BreakdownCard
          title="Cores"
          description="Peças vendidas por cor."
          icon={Palette}
          data={
            (data?.breakdowns.colors ?? []) as unknown as Array<
              Record<string, unknown>
            >
          }
          valueKey="units"
          currency={false}
        />
        <BreakdownCard
          title="Tamanhos"
          description="Peças vendidas por tamanho."
          icon={Ruler}
          data={
            (data?.breakdowns.sizes ?? []) as unknown as Array<
              Record<string, unknown>
            >
          }
          valueKey="units"
          currency={false}
        />
      </div>
      <Card>
        <CardContent className="p-5">
          <SectionTitle
            icon={stockMode ? Boxes : Package}
            title={
              stockMode ? "Inteligência de estoque" : "Desempenho do catálogo"
            }
            description={
              stockMode
                ? "Produtos pai expansíveis para análise por SKU, cor e tamanho."
                : "Dias restantes = estoque ÷ média diária. Vermelho: até 15 dias; verde: 16–60; âmbar: acima de 60."
            }
            action={<ExportButton onClick={exportCsv} busy={exporting} />}
          />
          <div className="mt-4 grid gap-2 lg:grid-cols-[minmax(240px,1fr)_200px_190px_190px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Buscar produto, SKU ou categoria"
                className="pl-9"
              />
            </div>
            <Select
              value={category}
              onValueChange={(v) => {
                setCategory(v);
                setPage(1);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Categoria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as categorias</SelectItem>
                {categories.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={stockStatus}
              onValueChange={(v) => {
                setStockStatus(v);
                setPage(1);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todo estoque</SelectItem>
                <SelectItem value="in_stock">Com estoque</SelectItem>
                <SelectItem value="out_of_stock">Sem estoque</SelectItem>
                <SelectItem value="negative">Estoque negativo</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={sort}
              onValueChange={(v) => {
                setSort(v);
                setPage(1);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="revenue">Maior faturamento</SelectItem>
                <SelectItem value="units">Mais vendidos</SelectItem>
                <SelectItem value="stock">Maior estoque</SelectItem>
                <SelectItem value="turnover" disabled={isBling}>
                  Maior giro
                </SelectItem>
                <SelectItem value="sales_power">
                  Maior poder de venda
                </SelectItem>
                {stockMode ? (
                  <SelectItem value="margin" disabled={isBling}>
                    Maior margem
                  </SelectItem>
                ) : (
                  <SelectItem value="coverage" disabled={isBling}>
                    Mais dias restantes
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="mt-4">
            <ProductTable
              data={data}
              loading={query.isLoading}
              expanded={expanded}
              setExpanded={setExpanded}
              stockMode={stockMode}
            />
          </div>
          <Pagination
            page={page}
            total={data?.filteredTotal ?? 0}
            size={PAGE_SIZE}
            onChange={setPage}
          />
        </CardContent>
      </Card>
    </>
  );
}

function ErpSellersView() {
  const displayLabel = useDisplayLabel();
  const { tx } = useI18n();
  const { data, isLoading, previousData } = useErpDashboard();
  const [exporting, setExporting] = useState(false);
  const { isBling } = useErpSource();
  const sellers = data?.breakdowns.sellers ?? [];
  const stores = data?.breakdowns.stores ?? [];
  const exportCsv = () => {
    setExporting(true);
    exportRowsAsCsv("vendedores-erp.csv", sellers, [
      { header: "Vendedor", accessor: (r) => r.label },
      { header: tx("Pedidos"), accessor: (r) => r.orders },
      { header: "Clientes", accessor: (r) => r.customers },
      { header: tx("Faturamento"), accessor: (r) => r.revenue },
      {
        header: "Ticket médio",
        accessor: (r) => (r.orders ? r.revenue / r.orders : 0),
      },
    ]);
    setExporting(false);
  };
  const totalRevenue = sellers.reduce((s, r) => s + r.revenue, 0);
  const totalOrders = sellers.reduce((s, r) => s + r.orders, 0);
  const metrics: Metric[] = [
    {
      label: "Vendedores ativos",
      value: isBling ? null : sellers.length,
      format: formatNumber,
      icon: UserRoundCheck,
      iconClass: "bg-blue-500/10 text-blue-500",
      sparkColor: "#5b8dff",
      subLabel: "Lojas",
      subValue: formatNumber(stores.length),
    },
    {
      label: tx("Faturamento"),
      value: isBling ? null : totalRevenue,
      format: formatCurrencySmart,
      icon: WalletCards,
      iconClass: "bg-emerald-500/10 text-emerald-500",
      sparkColor: "#87adff",
      subLabel: tx("Pedidos"),
      subValue: isBling ? "—" : formatNumber(totalOrders),
    },
    {
      label: "Ticket médio",
      value: isBling ? null : totalOrders ? totalRevenue / totalOrders : 0,
      format: formatCurrencySmart,
      icon: CircleDollarSign,
      iconClass: "bg-violet-500/10 text-violet-500",
      sparkColor: "#5b8dff",
      subLabel: "Base",
      subValue: "Por pedido",
    },
    {
      label: "Clientes atendidos",
      value: isBling
        ? null
        : sellers.reduce((s, r) => s + (r.customers ?? 0), 0),
      format: formatNumber,
      icon: Users,
      iconClass: "bg-amber-500/10 text-amber-500",
      sparkColor: "#0458fe",
      subLabel: "Base",
      subValue: "Soma por vendedor",
    },
  ];
  return (
    <>
      <KpiGrid metrics={metrics} loading={isLoading} />
      <div className="grid gap-4 xl:grid-cols-2">
        <BreakdownCard
          title="Ranking de vendedores"
          description="Faturamento líquido no período."
          icon={UserRoundCheck}
          data={sellers as unknown as Array<Record<string, unknown>>}
        />
        <BreakdownCard
          title="Desempenho por loja"
          description={
            isBling
              ? "Valor em pedidos por loja/canal do Bling."
              : "Receita consolidada por filial."
          }
          icon={Store}
          data={stores as unknown as Array<Record<string, unknown>>}
        />
      </div>
      <Card>
        <CardContent className="p-5">
          <SectionTitle
            icon={UserRoundCheck}
            title="Produtividade comercial"
            description="Pedidos, clientes, faturamento e ticket por vendedor."
            action={<ExportButton onClick={exportCsv} busy={exporting} />}
          />
          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendedor</TableHead>
                  <TableHead className="text-right">{tx("Pedidos")}</TableHead>
                  <TableHead className="text-right">Clientes</TableHead>
                  <TableHead className="text-right">
                    {tx("Faturamento")}
                  </TableHead>
                  <TableHead className="text-right">Ticket médio</TableHead>
                  <TableHead className="text-right">Participação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sellers.map((s) => (
                  <TableRow key={s.label}>
                    <TableCell className="font-medium">
                      {displayLabel(s.label)}
                    </TableCell>
                    <TableCell className="text-right">{s.orders}</TableCell>
                    <TableCell className="text-right">
                      {s.customers ?? 0}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(s.revenue)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(s.orders ? s.revenue / s.orders : 0)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatPercentage(
                        totalRevenue ? (s.revenue / totalRevenue) * 100 : 0,
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {!sellers.length && (
                  <EmptyRow colSpan={6} loading={isLoading} />
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function ExistingErpPage() {
  const [location] = useLocation();
  const view = location.endsWith("/pedidos")
    ? "orders"
    : location.endsWith("/clientes")
      ? "customers"
      : location.endsWith("/produtos")
        ? "products"
        : location.endsWith("/estoque")
          ? "stock"
          : location.endsWith("/vendedores")
            ? "sellers"
            : "overview";
  return (
    <div className="space-y-6" data-testid={`erp-${view}-page`}>
      {view === "overview" && <ErpOverview />}
      {view === "orders" && <ErpOrdersView />}
      {view === "customers" && <ErpCustomersView />}
      {view === "products" && <ProductsAndStockView />}
      {view === "stock" && <ProductsAndStockView stockMode />}
      {view === "sellers" && <ErpSellersView />}
    </div>
  );
}

function ErpGeographyContent() {
  const displayLabel = useDisplayLabel();
  const { tx } = useI18n();
  const { data, isLoading } = useErpDashboard();
  const states = data?.breakdowns.states ?? [];
  return (
    <div className="space-y-6" data-testid="erp-geography-page">
      <BreakdownCard
        title={tx("Geografia de compradores")}
        description={tx("Receita por estado do cadastro.")}
        icon={MapPin}
        data={states}
      />
      <Card>
        <CardContent className="p-5">
          <SectionTitle
            icon={MapPin}
            title={tx("Estados")}
            description={tx("Pedidos e faturamento da fonte ERP.")}
          />
          <div className="mt-5 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tx("Estado")}</TableHead>
                  <TableHead className="text-right">{tx("Pedidos")}</TableHead>
                  <TableHead className="text-right">
                    {tx("Faturamento")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {states.map((state) => (
                  <TableRow key={state.label}>
                    <TableCell>{displayLabel(state.label)}</TableCell>
                    <TableCell className="text-right">
                      {formatNumber(state.orders)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(state.revenue)}
                    </TableCell>
                  </TableRow>
                ))}
                {!states.length && <EmptyRow colSpan={3} loading={isLoading} />}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ErpPage() {
  const { user, selectedClientId } = useAuth();
  const clientId = user?.role === "CLIENT" ? user.clientId : selectedClientId;
  const client = useGetClient(clientId ?? "", {
    query: queryOpts({ enabled: !!clientId }),
  });
  if (clientId && client.isPending) return <p role="status">Carregando ERP…</p>;
  if (clientId && client.isError)
    return <p role="alert">Não foi possível identificar a marca.</p>;
  return (
    <ErpSourceContext.Provider
      value={{ isBling: client.data?.erpProvider === "BLING" }}
    >
      <ExistingErpPage />
    </ErpSourceContext.Provider>
  );
}

export function ErpGeographyView() {
  const { user, selectedClientId } = useAuth();
  const clientId = user?.role === "CLIENT" ? user.clientId : selectedClientId;
  const client = useGetClient(clientId ?? "", {
    query: queryOpts({ enabled: !!clientId }),
  });
  if (clientId && client.isPending) return <p role="status">Carregando ERP…</p>;
  if (clientId && client.isError)
    return <p role="alert">Não foi possível identificar a marca.</p>;
  return (
    <ErpSourceContext.Provider
      value={{ isBling: client.data?.erpProvider === "BLING" }}
    >
      <ErpGeographyContent />
    </ErpSourceContext.Provider>
  );
}
