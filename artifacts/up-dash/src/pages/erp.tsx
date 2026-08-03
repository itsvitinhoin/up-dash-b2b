import { Fragment, useDeferredValue, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertCircle,
  BadgeCheck,
  Boxes,
  CircleDollarSign,
  ChevronDown,
  ChevronRight,
  Package,
  PackageCheck,
  ReceiptText,
  Search,
  ShoppingBag,
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
  Line,
  XAxis,
  YAxis,
} from "recharts";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import { DashboardKpiCard } from "@/components/dashboard-kpi-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatCurrency,
  formatCurrencySmart,
  formatNumber,
  formatPercentage,
} from "@/lib/formatters";

// ─── Tipos (espelham os endpoints /analytics/erp/* — ver
// api-server/src/controllers/erpController.ts) ───────────────────────────────

type ErpDashboardKpis = {
  grossRevenue: number;
  netRevenue: number;
  discountAmount: number;
  orders: number;
  totalQuantity: number;
  returnedQuantity: number;
  uniqueCustomers: number;
  newCustomers: number;
  returningCustomers: number;
  retentionPct: number;
  cancelledOrders: number;
  cancelledAmount: number;
  avgTicket: number;
  returnAmount: number;
};

type ErpSeriesPoint = { date: string; value: number };

type ErpAttributionSummary = {
  attributedCustomers: number;
  unattributedCustomers: number;
  attributedRevenue: number;
  unattributedRevenue: number;
};

type ErpDashboardResponse = {
  kpis: ErpDashboardKpis;
  revenueOverTime: ErpSeriesPoint[];
  ordersOverTime: ErpSeriesPoint[];
  newCustomersOverTime: ErpSeriesPoint[];
  returningCustomersOverTime: ErpSeriesPoint[];
  attribution: ErpAttributionSummary;
};

type ErpOrderRow = {
  id: string;
  createdAt: string;
  customerId: string | null;
  customerName: string | null;
  company: string | null;
  document: string | null;
  seller: string | null;
  status: string | null;
  requestedQuantity: number;
  fulfilledQuantity: number;
  returnedQuantity: number;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  returnAmount: number;
  state: string | null;
  city: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  attributed: boolean;
  attributionEvidenceType: string | null;
  attributionEvidenceAt: string | null;
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
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  attributed: boolean;
};

type ErpCustomersResponse = { rows: ErpCustomerRow[]; total: number };

type ErpProductVariantRow = {
  id: string;
  sku: string;
  color: string | null;
  size: string | null;
  units: number;
  revenue: number;
  averagePrice: number;
  catalogPrice: number;
  stock: number;
  turnoverPct: number;
  salesPower: number;
};

type ErpProductRow = {
  id: string;
  name: string | null;
  category: string | null;
  units: number;
  revenue: number;
  averagePrice: number;
  stock: number;
  turnoverPct: number;
  salesPower: number;
  variantCount: number;
  outOfStockCount: number;
  variants: ErpProductVariantRow[];
};

type ErpProductsResponse = {
  rows: ErpProductRow[];
  total: number;
  totalSkus: number;
  filteredTotal: number;
  totalRevenue: number;
  totalUnits: number;
  totalStock: number;
  outOfStockCount: number;
  turnoverPct: number;
  salesPower: number;
};

function useErpClientId() {
  const { selectedClientId, user } = useAuth();
  const clientId = user?.role === "ADMIN" ? selectedClientId || undefined : undefined;
  const enabled = user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId);
  return { clientId, enabled };
}

function buildErpUrl(path: string, params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

function useErpDashboard(dateFrom: string, dateTo: string) {
  const { clientId, enabled } = useErpClientId();
  return useQuery<ErpDashboardResponse>({
    queryKey: ["erp-dashboard", clientId, dateFrom, dateTo],
    queryFn: () =>
      customFetch<ErpDashboardResponse>(
        buildErpUrl("/api/analytics/erp/dashboard", { clientId, dateFrom, dateTo }),
      ),
    enabled,
    staleTime: 2 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

type Metric = {
  label: string;
  value: number;
  format: (value: number) => string;
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  sparkColor: string;
  subLabel: string;
  subValue: string;
  ringValue?: number;
};

const revenueChartConfig = {
  revenue: { label: "Faturamento", color: "#3b82f6" },
  orders: { label: "Pedidos", color: "#34d399" },
} satisfies ChartConfig;

const customerChartConfig = {
  newCustomers: { label: "Novos", color: "#84cc16" },
  returningCustomers: { label: "Recorrentes", color: "#a78bfa" },
} satisfies ChartConfig;

function KpiGrid({ metrics, isLoading }: { metrics: Metric[]; isLoading: boolean }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
      {metrics.map((metric, index) => (
        <DashboardKpiCard
          key={metric.label}
          label={metric.label}
          value={metric.value}
          format={metric.format}
          icon={metric.icon}
          iconClass={metric.iconClass}
          change={null}
          changeLabel=""
          sub={[{ label: metric.subLabel, value: metric.subValue }]}
          sparkValues={[]}
          sparkColor={metric.sparkColor}
          ringValue={metric.ringValue}
          ringColor={metric.sparkColor}
          isLoading={isLoading}
          testId={`erp-kpi-${index}`}
          valueAccent={index === 0}
        />
      ))}
    </div>
  );
}

function SectionTitle({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div>
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Icon className="h-4 w-4 text-primary" />
        {title}
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  const value = status ?? "—";
  const classes: Record<string, string> = {
    FATURADO: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    FINALIZADO: "border-blue-500/30 bg-blue-500/10 text-blue-400",
    ESPERA: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    CANCELADO: "border-red-500/30 bg-red-500/10 text-red-400",
    EXCLUIDO: "border-red-500/30 bg-red-500/10 text-red-400",
  };
  return (
    <Badge variant="outline" className={classes[value] ?? "border-slate-500/30 bg-slate-500/10 text-slate-300"}>
      {value}
    </Badge>
  );
}

function AttributionBadge({
  source,
  medium,
  attributed = false,
}: {
  source: string | null;
  medium: string | null;
  attributed?: boolean;
}) {
  if (!source && !attributed) {
    return <span className="text-xs text-muted-foreground">Sem correspondência</span>;
  }
  return (
    <div>
      <p className="text-sm font-medium">{source ?? "Mídia paga identificada"}</p>
      {medium && <p className="text-xs text-muted-foreground">{medium}</p>}
    </div>
  );
}

function ErpOverview() {
  const { dateRange } = useDashboardFilters();
  const dateFrom = format(dateRange.from, "yyyy-MM-dd");
  const dateTo = format(dateRange.to, "yyyy-MM-dd");
  const { data, isLoading } = useErpDashboard(dateFrom, dateTo);
  const { clientId, enabled } = useErpClientId();
  const { data: products, isLoading: productsLoading } = useQuery({
    queryKey: ["erp-products-top", clientId, dateFrom, dateTo],
    queryFn: () => customFetch<ErpProductsResponse>(buildErpUrl("/api/analytics/erp/products", { clientId, dateFrom, dateTo, limit: 4 })),
    enabled,
    staleTime: 2 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const k = data?.kpis;
  const cancellationPct = k && k.orders + k.cancelledOrders > 0 ? (k.cancelledOrders / (k.orders + k.cancelledOrders)) * 100 : 0;

  const metrics: Metric[] = [
    { label: "Faturamento bruto", value: k?.grossRevenue ?? 0, format: formatCurrencySmart, icon: WalletCards, iconClass: "bg-blue-500/10 text-blue-400", sparkColor: "#60a5fa", subLabel: "Base", subValue: "Não cancelados" },
    { label: "Faturamento líquido", value: k?.netRevenue ?? 0, format: formatCurrencySmart, icon: BadgeCheck, iconClass: "bg-emerald-500/10 text-emerald-400", sparkColor: "#34d399", subLabel: "Devoluções", subValue: formatCurrency(k?.returnAmount ?? 0) },
    { label: "Pedidos", value: k?.orders ?? 0, format: formatNumber, icon: ReceiptText, iconClass: "bg-violet-500/10 text-violet-400", sparkColor: "#a78bfa", subLabel: "Ticket médio", subValue: formatCurrency(k?.avgTicket ?? 0) },
    { label: "Peças vendidas", value: k?.totalQuantity ?? 0, format: formatNumber, icon: PackageCheck, iconClass: "bg-amber-500/10 text-amber-400", sparkColor: "#f59e0b", subLabel: "Devolvidas", subValue: formatNumber(k?.returnedQuantity ?? 0) },
    { label: "Compradores", value: k?.uniqueCustomers ?? 0, format: formatNumber, icon: Users, iconClass: "bg-cyan-500/10 text-cyan-400", sparkColor: "#22d3ee", subLabel: "Base", subValue: "Clientes únicos" },
    { label: "Clientes novos", value: k?.newCustomers ?? 0, format: formatNumber, icon: UserRoundCheck, iconClass: "bg-lime-500/10 text-lime-400", sparkColor: "#84cc16", subLabel: "Regra", subValue: "1ª compra histórica" },
    { label: "Clientes recorrentes", value: k?.returningCustomers ?? 0, format: formatNumber, icon: Users, iconClass: "bg-purple-500/10 text-purple-400", sparkColor: "#c084fc", subLabel: "Regra", subValue: "Compra anterior" },
    { label: "Retenção", value: k?.retentionPct ?? 0, format: formatPercentage, icon: TrendingUp, iconClass: "bg-rose-500/10 text-rose-400", sparkColor: "#fb7185", subLabel: "Cálculo", subValue: "Recorrentes / compradores", ringValue: k?.retentionPct ?? 0 },
    { label: "Cancelamentos", value: cancellationPct, format: formatPercentage, icon: AlertCircle, iconClass: "bg-red-500/10 text-red-400", sparkColor: "#f87171", subLabel: "Pedidos", subValue: `${k?.cancelledOrders ?? 0} cancelado(s)`, ringValue: cancellationPct },
  ];

  return (
    <>
      <KpiGrid metrics={metrics} isLoading={isLoading} />
      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="border-border bg-card xl:col-span-3">
          <CardContent className="p-5">
            <SectionTitle
              icon={TrendingUp}
              title="Faturamento e pedidos"
              description="Evolução operacional registrada no ERP."
            />
            <ChartContainer config={revenueChartConfig} className="mt-5 h-[280px] w-full aspect-auto">
              <AreaChart data={data?.revenueOverTime ?? []} margin={{ left: 4, right: 12, top: 8 }}>
                <defs>
                  <linearGradient id="erpRevenueFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-revenue)" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="var(--color-revenue)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} />
                <YAxis
                  yAxisId="revenue"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `R$ ${Math.round(value / 1000)}k`}
                />
                <YAxis yAxisId="orders" orientation="right" hide />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area
                  yAxisId="revenue"
                  dataKey="value"
                  type="monotone"
                  stroke="var(--color-revenue)"
                  fill="url(#erpRevenueFill)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className="border-border bg-card xl:col-span-2">
          <CardContent className="p-5">
            <SectionTitle
              icon={Users}
              title="Novos versus recorrentes"
              description="Classificação baseada no histórico completo do ERP."
            />
            <ChartContainer config={customerChartConfig} className="mt-5 h-[280px] w-full aspect-auto">
              <BarChart
                data={(data?.newCustomersOverTime ?? []).map((point, i) => ({
                  date: point.date,
                  newCustomers: point.value,
                  returningCustomers: data?.returningCustomersOverTime[i]?.value ?? 0,
                }))}
                margin={{ left: -20, right: 4, top: 8 }}
              >
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="newCustomers" fill="var(--color-newCustomers)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="returningCustomers" fill="var(--color-returningCustomers)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border bg-card">
        <CardContent className="p-5">
          <SectionTitle
            icon={Users}
            title="Conciliação com rastreamento UP Zero"
            description="Quantos clientes do ERP também foram rastreados como visitantes do site (mesmo documento)."
          />
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-border bg-muted/20 p-4">
              <p className="text-xs text-muted-foreground">Clientes atribuídos</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{formatNumber(data?.attribution.attributedCustomers ?? 0)}</p>
            </div>
            <div className="rounded-lg border border-border bg-muted/20 p-4">
              <p className="text-xs text-muted-foreground">Sem correspondência</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{formatNumber(data?.attribution.unattributedCustomers ?? 0)}</p>
            </div>
            <div className="rounded-lg border border-border bg-muted/20 p-4">
              <p className="text-xs text-muted-foreground">Receita atribuída</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{formatCurrency(data?.attribution.attributedRevenue ?? 0)}</p>
            </div>
            <div className="rounded-lg border border-border bg-muted/20 p-4">
              <p className="text-xs text-muted-foreground">Receita sem correspondência</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{formatCurrency(data?.attribution.unattributedRevenue ?? 0)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardContent className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <SectionTitle
              icon={Package}
              title="Produtos com maior faturamento"
              description="Visão rápida do mix vendido no período."
            />
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead className="text-right">Variantes</TableHead>
                  <TableHead className="text-right">Peças</TableHead>
                  <TableHead className="text-right">Faturamento</TableHead>
                  <TableHead className="text-right">% giro</TableHead>
                  <TableHead className="text-right">Estoque</TableHead>
                  <TableHead className="text-right">Poder de venda</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {productsLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">Carregando...</TableCell>
                  </TableRow>
                ) : (
                  (products?.rows ?? []).map((product) => (
                    <TableRow key={product.id}>
                      <TableCell>
                        <div className="min-w-[240px]">
                          <p className="font-medium">{product.name ?? product.id}</p>
                          <p className="text-xs text-muted-foreground">Produto {product.id}</p>
                        </div>
                      </TableCell>
                      <TableCell>{product.category ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(product.variantCount)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(product.units)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatCurrency(product.revenue)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatPercentage(product.turnoverPct)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(product.stock)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatCurrency(product.salesPower)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

const ERP_PAGE_SIZE = 20;

function ErpOrdersView() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const deferredSearch = useDeferredValue(search.trim());
  const { dateRange } = useDashboardFilters();
  const dateFrom = format(dateRange.from, "yyyy-MM-dd");
  const dateTo = format(dateRange.to, "yyyy-MM-dd");
  const { data: dashboard } = useErpDashboard(dateFrom, dateTo);
  const { clientId, enabled } = useErpClientId();

  const { data, isLoading } = useQuery({
    queryKey: ["erp-orders", clientId, dateFrom, dateTo, deferredSearch, status, page],
    queryFn: () =>
      customFetch<ErpOrdersResponse>(
        buildErpUrl("/api/analytics/erp/orders", {
          clientId,
          dateFrom,
          dateTo,
          search: deferredSearch || undefined,
          status: status === "all" ? undefined : status,
          page,
          limit: ERP_PAGE_SIZE,
        }),
      ),
    enabled,
    staleTime: 2 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / ERP_PAGE_SIZE));

  const rows = data?.rows ?? [];

  const k = dashboard?.kpis;
  const metrics: Metric[] = [
    { label: "Faturamento bruto", value: k?.grossRevenue ?? 0, format: formatCurrencySmart, icon: WalletCards, iconClass: "bg-blue-500/10 text-blue-400", sparkColor: "#60a5fa", subLabel: "Base", subValue: "Não cancelados" },
    { label: "Faturamento líquido", value: k?.netRevenue ?? 0, format: formatCurrencySmart, icon: BadgeCheck, iconClass: "bg-emerald-500/10 text-emerald-400", sparkColor: "#34d399", subLabel: "Devoluções", subValue: formatCurrency(k?.returnAmount ?? 0) },
    { label: "Pedidos únicos", value: k?.orders ?? 0, format: formatNumber, icon: ReceiptText, iconClass: "bg-violet-500/10 text-violet-400", sparkColor: "#a78bfa", subLabel: "Ticket médio", subValue: formatCurrency(k?.avgTicket ?? 0) },
    { label: "Peças vendidas", value: k?.totalQuantity ?? 0, format: formatNumber, icon: Boxes, iconClass: "bg-amber-500/10 text-amber-400", sparkColor: "#f59e0b", subLabel: "Devolvidas", subValue: formatNumber(k?.returnedQuantity ?? 0) },
    { label: "Descontos", value: k?.discountAmount ?? 0, format: formatCurrencySmart, icon: CircleDollarSign, iconClass: "bg-pink-500/10 text-pink-400", sparkColor: "#f472b6", subLabel: "% do bruto", subValue: k && k.grossRevenue > 0 ? formatPercentage((k.discountAmount / k.grossRevenue) * 100) : "0%" },
    { label: "Cancelamentos", value: k?.cancelledOrders ?? 0, format: formatNumber, icon: AlertCircle, iconClass: "bg-red-500/10 text-red-400", sparkColor: "#f87171", subLabel: "Valor", subValue: formatCurrency(k?.cancelledAmount ?? 0) },
  ];

  return (
    <>
      <KpiGrid metrics={metrics} isLoading={isLoading} />
      <Card className="border-border bg-card">
        <CardContent className="p-5">
          <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <SectionTitle
              icon={ShoppingBag}
              title="Pedidos do ERP"
              description="Valores, quantidades e status operacionais registrados no Miré."
            />
            <div className="flex w-full flex-col gap-2 sm:flex-row xl:w-auto">
              <div className="relative min-w-0 sm:w-80">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                  placeholder="Buscar pedido, cliente ou documento"
                  className="pl-9"
                />
              </div>
              <select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(1);
                }}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm sm:w-44"
              >
                <option value="all">Todos os status</option>
                <option value="FATURADO">Faturado</option>
                <option value="FINALIZADO">Finalizado</option>
                <option value="ESPERA">Em espera</option>
                <option value="CANCELADO">Cancelado</option>
                <option value="EXCLUIDO">Excluído</option>
              </select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pedido</TableHead>
                  <TableHead className="min-w-[220px]">Cliente</TableHead>
                  <TableHead>Documento</TableHead>
                  <TableHead>Vendedor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead className="text-right">Qtd. vend./líq.</TableHead>
                  <TableHead className="text-right">Valor líquido</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">Carregando...</TableCell>
                  </TableRow>
                ) : (
                  rows.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell>
                        <p className="font-medium">#{order.id}</p>
                        <p className="text-xs text-muted-foreground">{format(new Date(order.createdAt), "dd/MM/yyyy HH:mm")}</p>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{order.customerName ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">{order.city ?? "—"} · {order.state ?? "—"}</p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{order.document ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{order.seller ?? "—"}</TableCell>
                      <TableCell><StatusBadge status={order.status} /></TableCell>
                      <TableCell>
                        <AttributionBadge
                          source={order.utmSource}
                          medium={order.utmMedium}
                          attributed={order.attributed}
                        />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(order.requestedQuantity)} / {formatNumber(order.fulfilledQuantity)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatCurrency(order.netAmount)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {data && data.total > 0 && (
            <div className="flex items-center justify-between border-t px-1 pt-4">
              <p className="text-sm text-muted-foreground">
                Página {page} de {totalPages} ({formatNumber(data.total)} no total)
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                  Anterior
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  Próxima
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function ErpCustomersView() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const deferredSearch = useDeferredValue(search.trim());
  const { dateRange } = useDashboardFilters();
  const dateFrom = format(dateRange.from, "yyyy-MM-dd");
  const dateTo = format(dateRange.to, "yyyy-MM-dd");
  const { data: dashboard } = useErpDashboard(dateFrom, dateTo);
  const { clientId, enabled } = useErpClientId();

  const { data, isLoading } = useQuery({
    queryKey: ["erp-customers", clientId, deferredSearch, page],
    queryFn: () =>
      customFetch<ErpCustomersResponse>(
        buildErpUrl("/api/analytics/erp/customers", { clientId, search: deferredSearch || undefined, page, limit: ERP_PAGE_SIZE }),
      ),
    enabled,
    staleTime: 2 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / ERP_PAGE_SIZE));

  const k = dashboard?.kpis;
  const metrics: Metric[] = [
    { label: "Compradores", value: k?.uniqueCustomers ?? 0, format: formatNumber, icon: Users, iconClass: "bg-blue-500/10 text-blue-400", sparkColor: "#60a5fa", subLabel: "Base", subValue: "No período selecionado" },
    { label: "Novos compradores", value: k?.newCustomers ?? 0, format: formatNumber, icon: UserRoundCheck, iconClass: "bg-emerald-500/10 text-emerald-400", sparkColor: "#34d399", subLabel: "Regra", subValue: "1ª compra no período" },
    { label: "Recorrentes", value: k?.returningCustomers ?? 0, format: formatNumber, icon: Users, iconClass: "bg-purple-500/10 text-purple-400", sparkColor: "#c084fc", subLabel: "Regra", subValue: "Já compraram antes" },
    { label: "Retenção", value: k?.retentionPct ?? 0, format: formatPercentage, icon: TrendingUp, iconClass: "bg-rose-500/10 text-rose-400", sparkColor: "#fb7185", subLabel: "Cálculo", subValue: "Recorrentes / compradores", ringValue: k?.retentionPct ?? 0 },
  ];

  return (
    <>
      <KpiGrid metrics={metrics} isLoading={isLoading} />
      <Card className="border-border bg-card">
        <CardContent className="p-5">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <SectionTitle
              icon={Users}
              title="Base de compradores"
              description="Histórico comercial e relacionamento de cada cliente no ERP."
            />
            <div className="relative w-full lg:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Buscar cliente ou documento"
                className="pl-9"
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[230px]">Cliente</TableHead>
                  <TableHead>Documento</TableHead>
                  <TableHead>Localização</TableHead>
                  <TableHead>Primeiro pedido</TableHead>
                  <TableHead>Último pedido</TableHead>
                  <TableHead className="text-right">Pedidos</TableHead>
                  <TableHead className="text-right">Total comprado</TableHead>
                  <TableHead className="text-right">Ticket médio</TableHead>
                  <TableHead>Vendedor</TableHead>
                  <TableHead>Origem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-sm text-muted-foreground">Carregando...</TableCell>
                  </TableRow>
                ) : (
                  (data?.rows ?? []).map((customer) => (
                    <TableRow key={customer.id}>
                      <TableCell>
                        <p className="font-medium">{customer.name ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">{customer.company ?? "—"} · {customer.email ?? "—"}</p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{customer.document ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{customer.city ?? "—"} · {customer.state ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{customer.firstOrderAt ? format(new Date(customer.firstOrderAt), "dd/MM/yyyy") : "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{customer.lastOrderAt ? format(new Date(customer.lastOrderAt), "dd/MM/yyyy") : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{customer.orders}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatCurrency(customer.totalSpent)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(customer.averageTicket)}</TableCell>
                      <TableCell className="whitespace-nowrap">{customer.seller ?? "—"}</TableCell>
                      <TableCell>
                        <AttributionBadge
                          source={customer.utmSource}
                          medium={customer.utmMedium}
                          attributed={customer.attributed}
                        />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {data && data.total > 0 && (
            <div className="flex items-center justify-between border-t px-1 pt-4">
              <p className="text-sm text-muted-foreground">
                Página {page} de {totalPages} ({formatNumber(data.total)} no total)
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                  Anterior
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  Próxima
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function ErpProductsView() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
  const deferredSearch = useDeferredValue(search.trim());
  const { dateRange } = useDashboardFilters();
  const dateFrom = format(dateRange.from, "yyyy-MM-dd");
  const dateTo = format(dateRange.to, "yyyy-MM-dd");
  const { clientId, enabled } = useErpClientId();

  const { data, isLoading } = useQuery({
    queryKey: ["erp-products", clientId, dateFrom, dateTo, deferredSearch, page],
    queryFn: () =>
      customFetch<ErpProductsResponse>(
        buildErpUrl("/api/analytics/erp/products", {
          clientId,
          dateFrom,
          dateTo,
          search: deferredSearch || undefined,
          page,
          limit: ERP_PAGE_SIZE,
        }),
      ),
    enabled,
    staleTime: 2 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const totalPages = Math.max(1, Math.ceil((data?.filteredTotal ?? 0) / ERP_PAGE_SIZE));

  const toggleProduct = (productId: string) => {
    setExpandedProducts((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const metrics: Metric[] = [
    { label: "Faturamento produtos", value: data?.totalRevenue ?? 0, format: formatCurrencySmart, icon: WalletCards, iconClass: "bg-blue-500/10 text-blue-400", sparkColor: "#60a5fa", subLabel: "Base", subValue: "Itens vendidos" },
    { label: "Peças vendidas", value: data?.totalUnits ?? 0, format: formatNumber, icon: ShoppingBag, iconClass: "bg-emerald-500/10 text-emerald-400", sparkColor: "#34d399", subLabel: "Preço médio", subValue: data && data.totalUnits > 0 ? formatCurrency(data.totalRevenue / data.totalUnits) : "—" },
    { label: "% de giro", value: data?.turnoverPct ?? 0, format: formatPercentage, icon: TrendingUp, iconClass: "bg-cyan-500/10 text-cyan-400", sparkColor: "#22d3ee", subLabel: "Cálculo", subValue: "Vendido / vendido + estoque", ringValue: data?.turnoverPct ?? 0 },
    { label: "Poder de venda", value: data?.salesPower ?? 0, format: formatCurrencySmart, icon: CircleDollarSign, iconClass: "bg-lime-500/10 text-lime-400", sparkColor: "#84cc16", subLabel: "Cálculo", subValue: "Estoque × preço atual" },
    { label: "Produtos pai", value: data?.total ?? 0, format: formatNumber, icon: Package, iconClass: "bg-violet-500/10 text-violet-400", sparkColor: "#a78bfa", subLabel: "Base", subValue: "Modelos cadastrados" },
    { label: "SKUs no catálogo", value: data?.totalSkus ?? 0, format: formatNumber, icon: PackageCheck, iconClass: "bg-fuchsia-500/10 text-fuchsia-400", sparkColor: "#d946ef", subLabel: "Base", subValue: "Cor e tamanho" },
    { label: "Estoque atual", value: data?.totalStock ?? 0, format: formatNumber, icon: Boxes, iconClass: "bg-amber-500/10 text-amber-400", sparkColor: "#f59e0b", subLabel: "Unidade", subValue: "Peças em estoque" },
    { label: "SKUs sem estoque", value: data?.outOfStockCount ?? 0, format: formatNumber, icon: AlertCircle, iconClass: "bg-red-500/10 text-red-400", sparkColor: "#f87171", subLabel: "Participação", subValue: data && data.totalSkus > 0 ? formatPercentage((data.outOfStockCount / data.totalSkus) * 100) : "0%" },
  ];

  return (
    <>
      <KpiGrid metrics={metrics} isLoading={isLoading} />
      <Card className="border-border bg-card">
        <CardContent className="p-5">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <SectionTitle
              icon={Package}
              title="Desempenho do catálogo"
              description="Produtos agrupados por modelo. Expanda para analisar cor, tamanho, giro e estoque por SKU."
            />
            <div className="relative w-full lg:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Buscar produto, SKU ou categoria"
                className="pl-9"
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[260px]">Produto</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead className="text-right">Variantes</TableHead>
                  <TableHead className="text-right">Peças</TableHead>
                  <TableHead className="text-right">Faturamento</TableHead>
                  <TableHead className="text-right">% giro</TableHead>
                  <TableHead className="text-right">Estoque</TableHead>
                  <TableHead className="text-right">Poder de venda</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">Carregando...</TableCell>
                  </TableRow>
                ) : (
                  (data?.rows ?? []).map((product) => {
                    const expanded = expandedProducts.has(product.id);
                    return (
                      <Fragment key={product.id}>
                        <TableRow className="cursor-pointer" onClick={() => toggleProduct(product.id)} aria-expanded={expanded}>
                          <TableCell>
                            <div className="flex min-w-[260px] items-center gap-2">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 shrink-0"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleProduct(product.id);
                                }}
                                title={expanded ? "Recolher variantes" : "Ver variantes"}
                              >
                                {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </Button>
                              <div>
                                <p className="font-medium">{product.name ?? product.id}</p>
                                <p className="text-xs text-muted-foreground">Produto {product.id}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>{product.category ?? "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatNumber(product.variantCount)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatNumber(product.units)}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{formatCurrency(product.revenue)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatPercentage(product.turnoverPct)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatNumber(product.stock)}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{formatCurrency(product.salesPower)}</TableCell>
                        </TableRow>
                        {expanded && (
                          <TableRow className="bg-muted/20 hover:bg-muted/20">
                            <TableCell colSpan={8} className="p-0">
                              <div className="overflow-x-auto border-l-2 border-primary/50 px-5 py-3">
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>SKU</TableHead>
                                      <TableHead>Cor</TableHead>
                                      <TableHead>Tamanho</TableHead>
                                      <TableHead className="text-right">Vendidas</TableHead>
                                      <TableHead className="text-right">Faturamento</TableHead>
                                      <TableHead className="text-right">Preço atual</TableHead>
                                      <TableHead className="text-right">% giro</TableHead>
                                      <TableHead className="text-right">Estoque</TableHead>
                                      <TableHead className="text-right">Poder de venda</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {product.variants.map((variant) => (
                                      <TableRow key={variant.id}>
                                        <TableCell className="font-mono text-xs">{variant.sku}</TableCell>
                                        <TableCell>{variant.color ?? "—"}</TableCell>
                                        <TableCell>{variant.size ?? "—"}</TableCell>
                                        <TableCell className="text-right tabular-nums">{formatNumber(variant.units)}</TableCell>
                                        <TableCell className="text-right tabular-nums">{formatCurrency(variant.revenue)}</TableCell>
                                        <TableCell className="text-right tabular-nums">{formatCurrency(variant.catalogPrice)}</TableCell>
                                        <TableCell className="text-right tabular-nums">{formatPercentage(variant.turnoverPct)}</TableCell>
                                        <TableCell className="text-right tabular-nums">
                                          <Badge variant="outline" className={variant.stock <= 0 ? "border-red-500/30 bg-red-500/10 text-red-400" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"}>
                                            {formatNumber(variant.stock)}
                                          </Badge>
                                        </TableCell>
                                        <TableCell className="text-right font-medium tabular-nums">{formatCurrency(variant.salesPower)}</TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
          {data && data.filteredTotal > 0 && (
            <div className="flex items-center justify-between border-t px-1 pt-4">
              <p className="text-sm text-muted-foreground">
                Página {page} de {totalPages} ({formatNumber(data.filteredTotal)} no total)
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                  Anterior
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  Próxima
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

export default function ErpPage() {
  const [location] = useLocation();
  const view = location.endsWith("/pedidos")
    ? "orders"
    : location.endsWith("/clientes")
      ? "customers"
      : location.endsWith("/produtos")
        ? "products"
        : "overview";

  return (
    <div className="space-y-6" data-testid={`erp-${view}-page`}>
      {view === "overview" && <ErpOverview />}
      {view === "orders" && <ErpOrdersView />}
      {view === "customers" && <ErpCustomersView />}
      {view === "products" && <ErpProductsView />}
    </div>
  );
}
