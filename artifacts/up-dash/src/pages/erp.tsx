import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  AlertCircle,
  BadgeCheck,
  Boxes,
  Building2,
  CircleDollarSign,
  Clock3,
  Package,
  PackageCheck,
  ReceiptText,
  RefreshCw,
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
import {
  erpCustomers,
  erpDailySeries,
  erpOrders,
  erpProducts,
  type ErpOrderStatus,
} from "@/mocks/erp-performance";
import {
  formatCurrency,
  formatCurrencySmart,
  formatNumber,
  formatPercentage,
} from "@/lib/formatters";

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

const customerSeries = [
  { day: "01 Jul", newCustomers: 5, returningCustomers: 3 },
  { day: "02 Jul", newCustomers: 6, returningCustomers: 4 },
  { day: "03 Jul", newCustomers: 4, returningCustomers: 3 },
  { day: "04 Jul", newCustomers: 7, returningCustomers: 5 },
  { day: "05 Jul", newCustomers: 5, returningCustomers: 4 },
  { day: "06 Jul", newCustomers: 8, returningCustomers: 5 },
  { day: "07 Jul", newCustomers: 6, returningCustomers: 5 },
];

function PreviewBanner() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-blue-500/20 bg-blue-500/[0.06] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-500/10 text-blue-400">
          <Building2 className="h-4 w-4" />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">Prévia da integração Miré ERP</p>
            <Badge variant="outline" className="border-blue-500/30 text-blue-400">
              Dados simulados
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            A estrutura está pronta para receber os payloads reais sem misturar dados do ERP com UP Zero.
          </p>
        </div>
      </div>
      <Button variant="outline" size="sm" className="shrink-0">
        <RefreshCw className="mr-2 h-3.5 w-3.5" />
        Sincronização: 5 min atrás
      </Button>
    </div>
  );
}

function KpiGrid({ metrics }: { metrics: Metric[] }) {
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
          isLoading={false}
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

function StatusBadge({ status }: { status: ErpOrderStatus }) {
  const classes: Record<ErpOrderStatus, string> = {
    FATURADO: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    PAGO: "border-blue-500/30 bg-blue-500/10 text-blue-400",
    PARCIAL: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    PENDENTE: "border-slate-500/30 bg-slate-500/10 text-slate-300",
    CANCELADO: "border-red-500/30 bg-red-500/10 text-red-400",
  };
  return (
    <Badge variant="outline" className={classes[status]}>
      {status}
    </Badge>
  );
}

function ErpOverview() {
  const metrics: Metric[] = [
    {
      label: "Faturamento bruto",
      value: 123390,
      format: formatCurrencySmart,
      icon: WalletCards,
      iconClass: "bg-blue-500/10 text-blue-400",
      sparkColor: "#60a5fa",
      subLabel: "Base",
      subValue: "Pedidos não cancelados",
    },
    {
      label: "Faturamento líquido",
      value: 118740,
      format: formatCurrencySmart,
      icon: BadgeCheck,
      iconClass: "bg-emerald-500/10 text-emerald-400",
      sparkColor: "#34d399",
      subLabel: "Descontos e devoluções",
      subValue: "R$ 4.650",
    },
    {
      label: "Pedidos",
      value: 81,
      format: formatNumber,
      icon: ReceiptText,
      iconClass: "bg-violet-500/10 text-violet-400",
      sparkColor: "#a78bfa",
      subLabel: "Ticket médio",
      subValue: formatCurrency(1465.93),
    },
    {
      label: "Peças vendidas",
      value: 694,
      format: formatNumber,
      icon: PackageCheck,
      iconClass: "bg-amber-500/10 text-amber-400",
      sparkColor: "#f59e0b",
      subLabel: "Peças por pedido",
      subValue: "8,6",
    },
    {
      label: "Compradores",
      value: 67,
      format: formatNumber,
      icon: Users,
      iconClass: "bg-cyan-500/10 text-cyan-400",
      sparkColor: "#22d3ee",
      subLabel: "Base",
      subValue: "Clientes únicos",
    },
    {
      label: "Clientes novos",
      value: 41,
      format: formatNumber,
      icon: UserRoundCheck,
      iconClass: "bg-lime-500/10 text-lime-400",
      sparkColor: "#84cc16",
      subLabel: "Regra",
      subValue: "1ª compra histórica",
    },
    {
      label: "Clientes recorrentes",
      value: 26,
      format: formatNumber,
      icon: Users,
      iconClass: "bg-purple-500/10 text-purple-400",
      sparkColor: "#c084fc",
      subLabel: "Regra",
      subValue: "Compra anterior ao período",
    },
    {
      label: "Retenção",
      value: 38.8,
      format: formatPercentage,
      icon: TrendingUp,
      iconClass: "bg-rose-500/10 text-rose-400",
      sparkColor: "#fb7185",
      subLabel: "Cálculo",
      subValue: "Recorrentes / compradores",
      ringValue: 38.8,
    },
    {
      label: "% atendido",
      value: 94.6,
      format: formatPercentage,
      icon: ShoppingBag,
      iconClass: "bg-orange-500/10 text-orange-400",
      sparkColor: "#fb923c",
      subLabel: "Quantidade",
      subValue: "Atendida / solicitada",
      ringValue: 94.6,
    },
    {
      label: "Cancelamentos",
      value: 3.7,
      format: formatPercentage,
      icon: AlertCircle,
      iconClass: "bg-red-500/10 text-red-400",
      sparkColor: "#f87171",
      subLabel: "Pedidos",
      subValue: "3 cancelados",
      ringValue: 3.7,
    },
  ];

  return (
    <>
      <KpiGrid metrics={metrics} />
      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="border-border bg-card xl:col-span-3">
          <CardContent className="p-5">
            <SectionTitle
              icon={TrendingUp}
              title="Faturamento e pedidos"
              description="Evolução operacional registrada no ERP."
            />
            <ChartContainer config={revenueChartConfig} className="mt-5 h-[280px] w-full aspect-auto">
              <AreaChart data={erpDailySeries} margin={{ left: 4, right: 12, top: 8 }}>
                <defs>
                  <linearGradient id="erpRevenueFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-revenue)" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="var(--color-revenue)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="day" tickLine={false} axisLine={false} />
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
                  dataKey="revenue"
                  type="monotone"
                  stroke="var(--color-revenue)"
                  fill="url(#erpRevenueFill)"
                  strokeWidth={2}
                />
                <Line
                  yAxisId="orders"
                  dataKey="orders"
                  type="monotone"
                  stroke="var(--color-orders)"
                  strokeWidth={2}
                  dot={false}
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
              <BarChart data={customerSeries} margin={{ left: -20, right: 4, top: 8 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="day" tickLine={false} axisLine={false} />
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
          <div className="mb-4 flex items-center justify-between gap-3">
            <SectionTitle
              icon={Package}
              title="Produtos com maior faturamento"
              description="Visão rápida do mix vendido no período."
            />
            <Button variant="outline" size="sm">Ver produtos</Button>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Cor / Tamanho</TableHead>
                  <TableHead className="text-right">Peças</TableHead>
                  <TableHead className="text-right">Faturamento</TableHead>
                  <TableHead className="text-right">Estoque</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {erpProducts.slice(0, 4).map((product) => (
                  <TableRow key={product.id}>
                    <TableCell>
                      <div className="flex min-w-[240px] items-center gap-3">
                        <img src={product.image} alt="" className="h-10 w-10 rounded-md border object-cover" />
                        <div>
                          <p className="font-medium">{product.name}</p>
                          <p className="text-xs text-muted-foreground">{product.sku}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{product.category}</TableCell>
                    <TableCell>{product.color} · {product.size}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(product.units)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatCurrency(product.revenue)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(product.stock)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function ErpOrdersView() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const rows = useMemo(
    () =>
      erpOrders.filter((order) => {
        const matchesSearch = [order.id, order.customer, order.company, order.document]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase());
        return matchesSearch && (status === "all" || order.status === status);
      }),
    [search, status],
  );

  const metrics: Metric[] = [
    { label: "Faturamento bruto", value: 123390, format: formatCurrencySmart, icon: WalletCards, iconClass: "bg-blue-500/10 text-blue-400", sparkColor: "#60a5fa", subLabel: "Base", subValue: "Pedidos não cancelados" },
    { label: "Faturamento líquido", value: 118740, format: formatCurrencySmart, icon: BadgeCheck, iconClass: "bg-emerald-500/10 text-emerald-400", sparkColor: "#34d399", subLabel: "Após ajustes", subValue: "Descontos e devoluções" },
    { label: "Pedidos únicos", value: 81, format: formatNumber, icon: ReceiptText, iconClass: "bg-violet-500/10 text-violet-400", sparkColor: "#a78bfa", subLabel: "Ticket médio", subValue: formatCurrency(1465.93) },
    { label: "Peças solicitadas", value: 734, format: formatNumber, icon: Boxes, iconClass: "bg-amber-500/10 text-amber-400", sparkColor: "#f59e0b", subLabel: "Atendidas", subValue: "694 peças" },
    { label: "% atendido", value: 94.6, format: formatPercentage, icon: PackageCheck, iconClass: "bg-cyan-500/10 text-cyan-400", sparkColor: "#22d3ee", subLabel: "Quantidade", subValue: "Atendida / solicitada", ringValue: 94.6 },
    { label: "Descontos", value: 3820, format: formatCurrencySmart, icon: CircleDollarSign, iconClass: "bg-pink-500/10 text-pink-400", sparkColor: "#f472b6", subLabel: "Média", subValue: "3,1% do bruto" },
    { label: "Cancelamentos", value: 3, format: formatNumber, icon: AlertCircle, iconClass: "bg-red-500/10 text-red-400", sparkColor: "#f87171", subLabel: "Valor", subValue: formatCurrency(4850) },
    { label: "Prazo de faturamento", value: 1.8, format: (value) => value.toFixed(1), icon: Clock3, iconClass: "bg-orange-500/10 text-orange-400", sparkColor: "#fb923c", subLabel: "Unidade", subValue: "dias em média" },
  ];

  return (
    <>
      <KpiGrid metrics={metrics} />
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
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar pedido, cliente ou documento"
                  className="pl-9"
                />
              </div>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="sm:w-44">
                  <SelectValue placeholder="Todos os status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os status</SelectItem>
                  <SelectItem value="FATURADO">Faturado</SelectItem>
                  <SelectItem value="PAGO">Pago</SelectItem>
                  <SelectItem value="PARCIAL">Parcial</SelectItem>
                  <SelectItem value="PENDENTE">Pendente</SelectItem>
                  <SelectItem value="CANCELADO">Cancelado</SelectItem>
                </SelectContent>
              </Select>
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
                  <TableHead className="text-right">Qtd. sol.</TableHead>
                  <TableHead className="text-right">Qtd. atend.</TableHead>
                  <TableHead className="text-right">Valor líquido</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell>
                      <p className="font-medium">{order.id}</p>
                      <p className="text-xs text-muted-foreground">{order.createdAt}</p>
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{order.customer}</p>
                      <p className="text-xs text-muted-foreground">{order.company}</p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{order.document}</TableCell>
                    <TableCell className="whitespace-nowrap">{order.seller}</TableCell>
                    <TableCell><StatusBadge status={order.status} /></TableCell>
                    <TableCell className="text-right tabular-nums">{order.requestedQuantity}</TableCell>
                    <TableCell className="text-right tabular-nums">{order.fulfilledQuantity}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatCurrency(order.netAmount)}</TableCell>
                    <TableCell className="text-right"><Button variant="outline" size="sm">Ver</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function ErpCustomersView() {
  const [search, setSearch] = useState("");
  const rows = erpCustomers.filter((customer) =>
    [customer.name, customer.company, customer.document, customer.email]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const metrics: Metric[] = [
    { label: "Compradores", value: 1268, format: formatNumber, icon: Users, iconClass: "bg-blue-500/10 text-blue-400", sparkColor: "#60a5fa", subLabel: "Base", subValue: "Histórico do ERP" },
    { label: "Novos compradores", value: 41, format: formatNumber, icon: UserRoundCheck, iconClass: "bg-emerald-500/10 text-emerald-400", sparkColor: "#34d399", subLabel: "Regra", subValue: "1ª compra no período" },
    { label: "Recorrentes", value: 26, format: formatNumber, icon: Users, iconClass: "bg-purple-500/10 text-purple-400", sparkColor: "#c084fc", subLabel: "Regra", subValue: "Já compraram antes" },
    { label: "Retenção", value: 38.8, format: formatPercentage, icon: TrendingUp, iconClass: "bg-rose-500/10 text-rose-400", sparkColor: "#fb7185", subLabel: "Cálculo", subValue: "Recorrentes / compradores", ringValue: 38.8 },
    { label: "LTV médio", value: 8640, format: formatCurrencySmart, icon: WalletCards, iconClass: "bg-amber-500/10 text-amber-400", sparkColor: "#f59e0b", subLabel: "Base", subValue: "Histórico por cliente" },
    { label: "Frequência média", value: 3.4, format: (value) => value.toFixed(1), icon: ReceiptText, iconClass: "bg-cyan-500/10 text-cyan-400", sparkColor: "#22d3ee", subLabel: "Unidade", subValue: "pedidos por cliente" },
    { label: "2ª compra", value: 52, format: (value) => `${value.toFixed(0)} dias`, icon: Clock3, iconClass: "bg-orange-500/10 text-orange-400", sparkColor: "#fb923c", subLabel: "Média", subValue: "Após a primeira compra" },
    { label: "Em risco", value: 143, format: formatNumber, icon: AlertCircle, iconClass: "bg-red-500/10 text-red-400", sparkColor: "#f87171", subLabel: "Regra", subValue: "90+ dias sem comprar" },
  ];

  return (
    <>
      <KpiGrid metrics={metrics} />
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
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar cliente ou documento" className="pl-9" />
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
                  <TableHead>RFM</TableHead>
                  <TableHead>Vendedor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell>
                      <p className="font-medium">{customer.name}</p>
                      <p className="text-xs text-muted-foreground">{customer.company} · {customer.email}</p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{customer.document}</TableCell>
                    <TableCell className="whitespace-nowrap">{customer.city} · {customer.state}</TableCell>
                    <TableCell className="whitespace-nowrap">{customer.firstOrderAt}</TableCell>
                    <TableCell className="whitespace-nowrap">{customer.lastOrderAt}</TableCell>
                    <TableCell className="text-right tabular-nums">{customer.orders}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatCurrency(customer.totalSpent)}</TableCell>
                    <TableCell><Badge variant="secondary">{customer.segment}</Badge></TableCell>
                    <TableCell className="whitespace-nowrap">{customer.seller}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function ProductStatusBadge({ status }: { status: "Saudável" | "Atenção" | "Sem estoque" }) {
  const classes = status === "Saudável"
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
    : status === "Atenção"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
      : "border-red-500/30 bg-red-500/10 text-red-400";
  return <Badge variant="outline" className={classes}>{status}</Badge>;
}

function ErpProductsView() {
  const [search, setSearch] = useState("");
  const rows = erpProducts.filter((product) =>
    [product.name, product.sku, product.category, product.color]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const metrics: Metric[] = [
    { label: "Faturamento produtos", value: 123390, format: formatCurrencySmart, icon: WalletCards, iconClass: "bg-blue-500/10 text-blue-400", sparkColor: "#60a5fa", subLabel: "Base", subValue: "Itens faturados" },
    { label: "Peças vendidas", value: 694, format: formatNumber, icon: ShoppingBag, iconClass: "bg-emerald-500/10 text-emerald-400", sparkColor: "#34d399", subLabel: "Preço médio", subValue: formatCurrency(177.8) },
    { label: "Produtos ativos", value: 286, format: formatNumber, icon: Package, iconClass: "bg-violet-500/10 text-violet-400", sparkColor: "#a78bfa", subLabel: "SKUs ativos", subValue: "1.842" },
    { label: "Estoque atual", value: 18420, format: formatNumber, icon: Boxes, iconClass: "bg-amber-500/10 text-amber-400", sparkColor: "#f59e0b", subLabel: "Valor estimado", subValue: "R$ 1,2 mi" },
    { label: "Sem estoque", value: 74, format: formatNumber, icon: AlertCircle, iconClass: "bg-red-500/10 text-red-400", sparkColor: "#f87171", subLabel: "Participação", subValue: "4,0% dos SKUs" },
    { label: "Cobertura média", value: 28, format: (value) => `${value.toFixed(0)} dias`, icon: Clock3, iconClass: "bg-cyan-500/10 text-cyan-400", sparkColor: "#22d3ee", subLabel: "Base", subValue: "Ritmo dos últimos 30d" },
    { label: "Sell-through", value: 31.4, format: formatPercentage, icon: TrendingUp, iconClass: "bg-lime-500/10 text-lime-400", sparkColor: "#84cc16", subLabel: "Cálculo", subValue: "Vendido / disponível", ringValue: 31.4 },
    { label: "Desconto médio", value: 4.6, format: formatPercentage, icon: CircleDollarSign, iconClass: "bg-pink-500/10 text-pink-400", sparkColor: "#f472b6", subLabel: "Base", subValue: "Preço realizado" },
  ];

  return (
    <>
      <KpiGrid metrics={metrics} />
      <Card className="border-border bg-card">
        <CardContent className="p-5">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <SectionTitle
              icon={Package}
              title="Desempenho do catálogo"
              description="Venda, preço realizado e cobertura de estoque por SKU."
            />
            <div className="relative w-full lg:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar produto, SKU ou categoria" className="pl-9" />
            </div>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[260px]">Produto</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Cor / Tamanho</TableHead>
                  <TableHead className="text-right">Peças</TableHead>
                  <TableHead className="text-right">Faturamento</TableHead>
                  <TableHead className="text-right">Preço médio</TableHead>
                  <TableHead className="text-right">Estoque</TableHead>
                  <TableHead className="text-right">Cobertura</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <img src={product.image} alt="" className="h-11 w-11 rounded-md border object-cover" />
                        <div>
                          <p className="font-medium">{product.name}</p>
                          <p className="text-xs text-muted-foreground">{product.sku}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{product.category}</TableCell>
                    <TableCell className="whitespace-nowrap">{product.color} · {product.size}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(product.units)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatCurrency(product.revenue)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(product.averagePrice)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(product.stock)}</TableCell>
                    <TableCell className="text-right tabular-nums">{product.stockCoverageDays} dias</TableCell>
                    <TableCell><ProductStatusBadge status={product.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
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
      <PreviewBanner />
      {view === "overview" && <ErpOverview />}
      {view === "orders" && <ErpOrdersView />}
      {view === "customers" && <ErpCustomersView />}
      {view === "products" && <ErpProductsView />}
    </div>
  );
}
