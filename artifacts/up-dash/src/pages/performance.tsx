import { useMemo, useState } from "react";
import {
  BarChart3,
  BadgeDollarSign,
  CircleDollarSign,
  Gauge,
  Megaphone,
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
import { DashboardKpiCard } from "@/components/dashboard-kpi-card";
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
import {
  erpDailySeries,
  erpOrders,
  performanceBreakdowns,
  performanceChannels,
  sourceReconciliation,
  type AttributionState,
} from "@/mocks/erp-performance";
import {
  formatCurrency,
  formatNumber,
  formatPercentage,
} from "@/lib/formatters";

const trendConfig = {
  revenue: { label: "Faturamento ERP", color: "#3b82f6" },
  attributedRevenue: { label: "Receita atribuída", color: "#8b5cf6" },
  spend: { label: "Investimento", color: "#f59e0b" },
} satisfies ChartConfig;

const breakdownConfig = {
  value: { label: "Participação", color: "#3b82f6" },
} satisfies ChartConfig;

const ORDERS_PAGE_SIZE = 10;

function PreviewBanner() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-violet-500/20 bg-violet-500/[0.06] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">Prévia do dashboard de Performance</p>
          <Badge variant="outline" className="border-violet-500/30 text-violet-400">
            ERP + e-commerce + mídia
          </Badge>
          <Badge variant="outline">Dados simulados</Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          A conciliação separa venda do ERP, origem do cliente e atribuição do pedido.
        </p>
      </div>
      <div className="text-left sm:text-right">
        <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          Última conciliação
        </p>
        <p className="mt-1 text-sm font-medium">Hoje, 09:42</p>
      </div>
    </div>
  );
}

function AttributionBadge({ state }: { state: AttributionState }) {
  const config = {
    ATRIBUIDO: {
      label: "Atribuído",
      className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    },
    ASSISTIDO: {
      label: "Assistido",
      className: "border-blue-500/30 bg-blue-500/10 text-blue-400",
    },
    SEM_ORIGEM: {
      label: "Sem origem",
      className: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    },
  }[state];

  return (
    <Badge variant="outline" className={config.className}>
      {config.label}
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
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <ChartContainer config={breakdownConfig} className="mt-4 h-[190px] w-full">
          <BarChart accessibilityLayer data={data} layout="vertical" margin={{ left: 4, right: 18 }}>
            <CartesianGrid horizontal={false} />
            <XAxis type="number" domain={[0, 40]} hide />
            <YAxis
              dataKey="name"
              type="category"
              axisLine={false}
              tickLine={false}
              width={72}
              tick={{ fontSize: 11 }}
            />
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent formatter={(value) => `${value}%`} />}
            />
            <Bar dataKey="value" fill="var(--color-value)" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

export default function PerformancePage() {
  const [ordersPage, setOrdersPage] = useState(1);
  const erpRevenue = erpDailySeries.reduce((sum, row) => sum + row.revenue, 0);
  const attributedRevenue = erpDailySeries.reduce(
    (sum, row) => sum + row.attributedRevenue,
    0,
  );
  const spend = erpDailySeries.reduce((sum, row) => sum + row.spend, 0);
  const orders = erpDailySeries.reduce((sum, row) => sum + row.orders, 0);
  const attributedOrders = sourceReconciliation[2]?.value ?? 0;
  const paidOrders = erpOrders.filter((order) => order.customerOrigin === "Mídia paga");
  const uniqueBuyers = new Set(erpOrders.map((order) => order.document)).size;
  const newBuyers = erpOrders.filter((order) => order.buyerType === "Novo").length;
  const returningBuyers = erpOrders.filter((order) => order.buyerType === "Recorrente").length;
  const roas = spend > 0 ? attributedRevenue / spend : 0;
  const mer = spend > 0 ? erpRevenue / spend : 0;
  const attributionCoverage = orders > 0 ? (attributedOrders / orders) * 100 : 0;
  const periodOrderTotals = useMemo(
    () =>
      erpOrders.reduce(
        (totals, order) => ({
          orders: totals.orders + 1,
          requestedQuantity: totals.requestedQuantity + order.requestedQuantity,
          fulfilledQuantity: totals.fulfilledQuantity + order.fulfilledQuantity,
          netAmount: totals.netAmount + order.netAmount,
        }),
        { orders: 0, requestedQuantity: 0, fulfilledQuantity: 0, netAmount: 0 },
      ),
    [],
  );
  const ordersTotalPages = Math.max(
    1,
    Math.ceil(erpOrders.length / ORDERS_PAGE_SIZE),
  );
  const paginatedOrders = useMemo(() => {
    const start = (ordersPage - 1) * ORDERS_PAGE_SIZE;
    return erpOrders.slice(start, start + ORDERS_PAGE_SIZE);
  }, [ordersPage]);

  const metrics = [
    {
      label: "Faturamento ERP",
      value: erpRevenue,
      format: formatCurrency,
      icon: CircleDollarSign,
      iconClass: "bg-blue-500/10 text-blue-400",
      sparkColor: "#3b82f6",
      sub: [{ label: "Fonte", value: "Miré ERP" }],
    },
    {
      label: "Receita atribuída",
      value: attributedRevenue,
      format: formatCurrency,
      icon: Target,
      iconClass: "bg-violet-500/10 text-violet-400",
      sparkColor: "#8b5cf6",
      sub: [{ label: "Regra", value: "Pedido com evidência" }],
    },
    {
      label: "Investimento",
      value: spend,
      format: formatCurrency,
      icon: Megaphone,
      iconClass: "bg-amber-500/10 text-amber-400",
      sparkColor: "#f59e0b",
      sub: [{ label: "Canais", value: "Meta + Google" }],
    },
    {
      label: "ROAS atribuído",
      value: roas,
      format: (value: number) => `${value.toFixed(2)}x`,
      icon: TrendingUp,
      iconClass: "bg-emerald-500/10 text-emerald-400",
      sparkColor: "#34d399",
      sub: [{ label: "Cálculo", value: "Atribuído / mídia" }],
    },
    {
      label: "MER",
      value: mer,
      format: (value: number) => `${value.toFixed(2)}x`,
      icon: Gauge,
      iconClass: "bg-cyan-500/10 text-cyan-400",
      sparkColor: "#22d3ee",
      sub: [{ label: "Cálculo", value: "ERP / mídia" }],
    },
    {
      label: "Pedidos ERP",
      value: orders,
      format: formatNumber,
      icon: ReceiptText,
      iconClass: "bg-blue-500/10 text-blue-400",
      sparkColor: "#60a5fa",
      sub: [{ label: "Período", value: "Todos os canais" }],
    },
    {
      label: "Pedidos atribuídos",
      value: attributedOrders,
      format: formatNumber,
      icon: PackageCheck,
      iconClass: "bg-emerald-500/10 text-emerald-400",
      sparkColor: "#10b981",
      sub: [{ label: "Cobertura", value: formatPercentage(attributionCoverage) }],
      ringValue: attributionCoverage,
    },
    {
      label: "Compradores únicos",
      value: uniqueBuyers,
      format: formatNumber,
      icon: Users,
      iconClass: "bg-fuchsia-500/10 text-fuchsia-400",
      sparkColor: "#d946ef",
      sub: [{ label: "Base", value: "Documento conciliado" }],
    },
    {
      label: "Clientes novos",
      value: newBuyers,
      format: formatNumber,
      icon: UserRoundCheck,
      iconClass: "bg-lime-500/10 text-lime-400",
      sparkColor: "#84cc16",
      sub: [{ label: "Regra", value: "Sem compra anterior" }],
    },
    {
      label: "Clientes recorrentes",
      value: returningBuyers,
      format: formatNumber,
      icon: ShoppingBag,
      iconClass: "bg-rose-500/10 text-rose-400",
      sparkColor: "#fb7185",
      sub: [{ label: "Regra", value: "Compra histórica" }],
    },
  ];

  return (
    <div className="space-y-6" data-testid="performance-page">
      <PreviewBanner />

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
            sub={metric.sub}
            sparkValues={[]}
            sparkColor={metric.sparkColor}
            ringValue={metric.ringValue}
            ringColor={metric.sparkColor}
            isLoading={false}
            testId={`performance-kpi-${index}`}
            valueAccent={index === 0}
          />
        ))}
      </div>

      <Card>
        <CardContent className="p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <BarChart3 className="h-4 w-4 text-primary" />
                Conciliação das fontes
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Mostra quanto do ERP foi localizado no e-commerce e quanto possui evidência de mídia.
              </p>
            </div>
            <Badge variant="outline" className="w-fit">
              Chave: documento + pedido
            </Badge>
          </div>
          <div className="mt-5 grid gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-2 xl:grid-cols-4">
            {sourceReconciliation.map((item) => (
              <div key={item.label} className="bg-card p-4">
                <p className="text-xs text-muted-foreground">{item.label}</p>
                <p className={`mt-2 text-2xl font-semibold tabular-nums ${item.tone}`}>
                  {item.value}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.65fr_1fr]">
        <Card>
          <CardContent className="p-5">
            <h2 className="text-base font-semibold">Faturamento, atribuição e mídia</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              A receita atribuída nunca substitui o faturamento oficial do ERP.
            </p>
            <ChartContainer config={trendConfig} className="mt-5 h-[320px] w-full">
              <AreaChart accessibilityLayer data={erpDailySeries}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={10} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={62}
                  tickFormatter={(value) => `R$ ${Math.round(Number(value) / 1000)}k`}
                />
                <ChartTooltip
                  cursor={false}
                  content={<ChartTooltipContent formatter={(value) => formatCurrency(Number(value))} />}
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
            <h2 className="text-base font-semibold">Performance por canal</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              ROAS aparece somente em canais com investimento.
            </p>
            <Table className="mt-4">
              <TableHeader>
                <TableRow>
                  <TableHead>Canal</TableHead>
                  <TableHead className="text-right">Receita</TableHead>
                  <TableHead className="text-right">Pedidos</TableHead>
                  <TableHead className="text-right">ROAS</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {performanceChannels.map((channel) => (
                  <TableRow key={channel.channel}>
                    <TableCell className="font-medium">{channel.channel}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(channel.revenue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{channel.orders}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {channel.spend > 0 ? `${channel.roas.toFixed(2)}x` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <BreakdownCard
          title="Vendas por cor"
          description="Participação em unidades atendidas."
          data={performanceBreakdowns.colors}
        />
        <BreakdownCard
          title="Vendas por tamanho"
          description="Mix de grade efetivamente vendido."
          data={performanceBreakdowns.sizes}
        />
        <BreakdownCard
          title="Vendas por estado"
          description="Distribuição geográfica dos compradores."
          data={performanceBreakdowns.states}
        />
      </div>

      <Card>
        <CardContent className="p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <BadgeDollarSign className="h-4 w-4 text-primary" />
                Pedidos e evidências de campanha
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Um cliente pode ter origem paga histórica sem que todo pedido seja atribuído.
              </p>
            </div>
            <Badge variant="outline">{paidOrders.length} clientes com origem paga</Badge>
          </div>
          <div className="mt-4 grid gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-2 xl:grid-cols-4">
            <div className="bg-card px-4 py-3">
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                Pedidos no período
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums">
                {formatNumber(periodOrderTotals.orders)}
              </p>
            </div>
            <div className="bg-card px-4 py-3">
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                Peças solicitadas
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums">
                {formatNumber(periodOrderTotals.requestedQuantity)}
              </p>
            </div>
            <div className="bg-card px-4 py-3">
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                Peças atendidas
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums">
                {formatNumber(periodOrderTotals.fulfilledQuantity)}
              </p>
            </div>
            <div className="bg-card px-4 py-3">
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                Valor total
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-primary">
                {formatCurrency(periodOrderTotals.netAmount)}
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
                  <TableHead>Origem do cliente</TableHead>
                  <TableHead>Campanha</TableHead>
                  <TableHead>Atribuição do pedido</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedOrders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell>
                      <p className="font-medium">{order.id}</p>
                      <p className="text-xs text-muted-foreground">{order.createdAt}</p>
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{order.customer}</p>
                      <p className="text-xs text-muted-foreground">{order.document}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{order.buyerType}</Badge>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm">{order.customerOrigin}</p>
                      <p className="text-xs text-muted-foreground">
                        {order.source} · {order.medium}
                      </p>
                    </TableCell>
                    <TableCell className="max-w-[260px]">
                      <p className="truncate text-sm" title={order.campaign}>
                        {order.campaign}
                      </p>
                    </TableCell>
                    <TableCell>
                      <AttributionBadge state={order.attribution} />
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatCurrency(order.netAmount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="mt-4 flex flex-col gap-3 border-t pt-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>
              Página {formatNumber(ordersPage)} de {formatNumber(ordersTotalPages)} ·{" "}
              {formatNumber(erpOrders.length)} pedido(s) · {ORDERS_PAGE_SIZE} por página
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={ordersPage <= 1}
                onClick={() => setOrdersPage((current) => Math.max(1, current - 1))}
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={ordersPage >= ordersTotalPages}
                onClick={() =>
                  setOrdersPage((current) => Math.min(ordersTotalPages, current + 1))
                }
              >
                Próxima
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
