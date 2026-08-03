import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertCircle,
  BarChart3,
  BadgeDollarSign,
  Boxes,
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
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import { formatCurrency, formatNumber, formatPercentage } from "@/lib/formatters";

type AttributionState = "ATRIBUIDO" | "SEM_ORIGEM";

type PerformanceResponse = {
  generatedAt: string;
  sources: {
    erp: { status: "connected"; label: string };
    ecommerce: { status: "connected"; label: string };
    media: { status: "connected" | "unavailable" | "not_configured"; label: string; message: string | null };
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
  };
  reconciliation: Array<{ label: string; value: number; detail: string }>;
  daily: Array<{ date: string; revenue: number; attributedRevenue: number; spend: number; orders: number }>;
  channels: Array<{ channel: string; spend: number; revenue: number; orders: number; roas: number | null }>;
  breakdowns: {
    colors: Array<{ name: string; value: number }>;
    sizes: Array<{ name: string; value: number }>;
    states: Array<{ name: string; value: number }>;
  };
  orders: {
    rows: Array<{
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
      buyerType: "NEW" | "RETURNING" | "UNKNOWN";
    }>;
    total: number;
    page: number;
    limit: number;
  };
};

const trendConfig = {
  revenue: { label: "Faturamento ERP", color: "#3b82f6" },
  attributedRevenue: { label: "Receita atribuída", color: "#8b5cf6" },
  spend: { label: "Investimento", color: "#f59e0b" },
} satisfies ChartConfig;

const breakdownConfig = {
  value: { label: "Participação", color: "#3b82f6" },
} satisfies ChartConfig;

const ORDERS_PAGE_SIZE = 10;

function buildPerformanceUrl(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  return `/api/analytics/performance?${search.toString()}`;
}

function SourceStatus({ data, generatedAt }: { data: PerformanceResponse["sources"]; generatedAt: string }) {
  const sources = [
    { label: "ERP", value: data.erp.label, ok: true },
    { label: "E-commerce", value: data.ecommerce.label, ok: true },
    {
      label: "Mídia paga",
      value: data.media.status === "connected" ? data.media.label : data.media.message ?? data.media.label,
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
              className={source.ok ? "border-emerald-500/30 text-emerald-400" : "border-amber-500/30 text-amber-400"}
              title={source.value}
            >
              {source.label}: {source.ok ? "conectado" : "atenção"}
            </Badge>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          ERP financeiro + identidade e atribuição do e-commerce + investimento da mídia paga.
        </p>
      </div>
      <div className="text-left sm:text-right">
        <p className="text-[10px] font-mono uppercase text-muted-foreground">Conciliação</p>
        <p className="mt-1 text-sm font-medium">{new Date(generatedAt).toLocaleString("pt-BR")}</p>
      </div>
    </div>
  );
}

function AttributionBadge({ state }: { state: AttributionState }) {
  return state === "ATRIBUIDO" ? (
    <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">Atribuído</Badge>
  ) : (
    <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-400">Sem origem</Badge>
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
          <ChartContainer config={breakdownConfig} className="mt-4 h-[210px] w-full aspect-auto">
            <BarChart accessibilityLayer data={data} layout="vertical" margin={{ left: 4, right: 18 }}>
              <CartesianGrid horizontal={false} />
              <XAxis type="number" domain={[0, "dataMax"]} hide />
              <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} width={82} tick={{ fontSize: 11 }} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent formatter={(value) => `${Number(value).toFixed(1)}%`} />} />
              <Bar dataKey="value" fill="var(--color-value)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ChartContainer>
        ) : (
          <div className="flex h-[210px] items-center justify-center text-xs text-muted-foreground">Sem dados no período.</div>
        )}
      </CardContent>
    </Card>
  );
}

export default function PerformancePage() {
  const { selectedClientId, user } = useAuth();
  const { dateRange } = useDashboardFilters();
  const [ordersPage, setOrdersPage] = useState(1);
  const clientId = user?.role === "ADMIN" ? selectedClientId || undefined : undefined;
  const enabled = user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId);
  const dateFrom = format(dateRange.from, "yyyy-MM-dd");
  const dateTo = format(dateRange.to, "yyyy-MM-dd");

  useEffect(() => setOrdersPage(1), [clientId, dateFrom, dateTo]);

  const { data, isLoading, isFetching, error, refetch } = useQuery<PerformanceResponse>({
    queryKey: ["performance", clientId, dateFrom, dateTo, ordersPage],
    queryFn: () => customFetch<PerformanceResponse>(buildPerformanceUrl({
      clientId,
      dateFrom,
      dateTo,
      page: ordersPage,
      limit: ORDERS_PAGE_SIZE,
    })),
    enabled,
    staleTime: 2 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const k = data?.kpis;
  const metrics = [
    { label: "Faturamento ERP", value: k?.netRevenue ?? 0, format: formatCurrency, icon: CircleDollarSign, iconClass: "bg-blue-500/10 text-blue-400", sparkColor: "#3b82f6", sub: [{ label: "Devoluções", value: formatCurrency(k?.returnAmount ?? 0) }] },
    { label: "Receita atribuída", value: k?.attributedRevenue ?? 0, format: formatCurrency, icon: Target, iconClass: "bg-violet-500/10 text-violet-400", sparkColor: "#8b5cf6", sub: [{ label: "Regra", value: "Documento + mídia" }] },
    { label: "Investimento", value: k?.mediaSpend ?? 0, format: formatCurrency, icon: Megaphone, iconClass: "bg-amber-500/10 text-amber-400", sparkColor: "#f59e0b", sub: [{ label: "Fonte", value: "Meta Ads" }] },
    { label: "ROAS final", value: k?.roas ?? 0, format: () => k?.roas == null ? "—" : `${k.roas.toFixed(2)}x`, icon: TrendingUp, iconClass: "bg-emerald-500/10 text-emerald-400", sparkColor: "#34d399", sub: [{ label: "Cálculo", value: "Atribuído / mídia" }] },
    { label: "MER", value: k?.mer ?? 0, format: () => k?.mer == null ? "—" : `${k.mer.toFixed(2)}x`, icon: Gauge, iconClass: "bg-cyan-500/10 text-cyan-400", sparkColor: "#22d3ee", sub: [{ label: "Cálculo", value: "ERP / mídia" }] },
    { label: "ROI final", value: k?.roi ?? 0, format: () => k?.roi == null ? "—" : formatPercentage(k.roi), icon: BadgeDollarSign, iconClass: "bg-lime-500/10 text-lime-400", sparkColor: "#84cc16", sub: [{ label: "Cobertura de custo", value: formatPercentage(k?.costCoveragePct ?? 0) }] },
    { label: "Lucro bruto", value: k?.grossProfit ?? 0, format: () => k?.roiStatus === "available" ? formatCurrency(k.grossProfit) : "—", icon: Boxes, iconClass: "bg-fuchsia-500/10 text-fuchsia-400", sparkColor: "#d946ef", sub: [{ label: "CMV conhecido", value: formatCurrency(k?.cogs ?? 0) }] },
    { label: "Pedidos ERP", value: k?.orders ?? 0, format: formatNumber, icon: ReceiptText, iconClass: "bg-blue-500/10 text-blue-400", sparkColor: "#60a5fa", sub: [{ label: "Peças", value: formatNumber(k?.totalQuantity ?? 0) }] },
    { label: "Pedidos atribuídos", value: k?.attributedOrders ?? 0, format: formatNumber, icon: PackageCheck, iconClass: "bg-emerald-500/10 text-emerald-400", sparkColor: "#10b981", sub: [{ label: "Cobertura", value: formatPercentage(k?.attributionCoveragePct ?? 0) }], ringValue: k?.attributionCoveragePct ?? 0 },
    { label: "Compradores únicos", value: k?.uniqueBuyers ?? 0, format: formatNumber, icon: Users, iconClass: "bg-purple-500/10 text-purple-400", sparkColor: "#c084fc", sub: [{ label: "Base", value: "Documento Miré" }] },
    { label: "Clientes novos", value: k?.newBuyers ?? 0, format: formatNumber, icon: UserRoundCheck, iconClass: "bg-lime-500/10 text-lime-400", sparkColor: "#84cc16", sub: [{ label: "Regra", value: "Sem compra anterior" }] },
    { label: "Clientes recorrentes", value: k?.returningBuyers ?? 0, format: formatNumber, icon: ShoppingBag, iconClass: "bg-rose-500/10 text-rose-400", sparkColor: "#fb7185", sub: [{ label: "Retenção", value: formatPercentage(k?.retentionPct ?? 0) }] },
  ];

  if (!enabled) {
    return <Alert><AlertCircle className="h-4 w-4" /><AlertTitle>Selecione uma marca</AlertTitle><AlertDescription>Escolha um cliente B2B com ERP configurado para abrir a Performance.</AlertDescription></Alert>;
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Não foi possível carregar a Performance</AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-4">
          <span>{error instanceof Error ? error.message : "Falha ao conciliar as fontes."}</span>
          <Button variant="outline" size="sm" onClick={() => refetch()}>Tentar novamente</Button>
        </AlertDescription>
      </Alert>
    );
  }

  const ordersTotalPages = Math.max(1, Math.ceil((data?.orders.total ?? 0) / ORDERS_PAGE_SIZE));

  return (
    <div className="space-y-6" data-testid="performance-page" aria-busy={isFetching}>
      {data && <SourceStatus data={data.sources} generatedAt={data.generatedAt} />}

      {k?.roiStatus !== "available" && !isLoading && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>ROI aguardando cobertura de custo</AlertTitle>
          <AlertDescription>
            O ROAS e o MER estão válidos. O ROI final será exibido quando ao menos 95% das peças vendidas tiverem custo no Miré; cobertura atual: {formatPercentage(k?.costCoveragePct ?? 0)}.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        {metrics.map((metric, index) => (
          <DashboardKpiCard
            key={metric.label}
            {...metric}
            change={null}
            changeLabel=""
            sparkValues={[]}
            ringColor={metric.sparkColor}
            isLoading={isLoading}
            testId={`performance-kpi-${index}`}
            valueAccent={index === 0}
          />
        ))}
      </div>

      <Card>
        <CardContent className="p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold"><BarChart3 className="h-4 w-4 text-primary" />Conciliação das fontes</h2>
              <p className="mt-1 text-xs text-muted-foreground">Pedidos do Miré localizados na UP Zero e validados por evidência paga persistente.</p>
            </div>
            <Badge variant="outline">Chave: CPF/CNPJ hasheado</Badge>
          </div>
          <div className="mt-5 grid gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-2 xl:grid-cols-4">
            {(data?.reconciliation ?? []).map((item) => (
              <div key={item.label} className="bg-card p-4">
                <p className="text-xs text-muted-foreground">{item.label}</p>
                <p className="mt-2 text-2xl font-semibold tabular-nums">{formatNumber(item.value)}</p>
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
            <p className="mt-1 text-xs text-muted-foreground">A receita atribuída é um recorte do faturamento oficial do ERP.</p>
            <ChartContainer config={trendConfig} className="mt-5 h-[320px] w-full aspect-auto">
              <AreaChart accessibilityLayer data={data?.daily ?? []}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={10} />
                <YAxis tickLine={false} axisLine={false} width={62} tickFormatter={(value) => `R$ ${Math.round(Number(value) / 1000)}k`} />
                <ChartTooltip cursor={false} content={<ChartTooltipContent formatter={(value) => formatCurrency(Number(value))} />} />
                <Area dataKey="revenue" type="monotone" fill="var(--color-revenue)" fillOpacity={0.16} stroke="var(--color-revenue)" strokeWidth={2} />
                <Area dataKey="attributedRevenue" type="monotone" fill="var(--color-attributedRevenue)" fillOpacity={0.12} stroke="var(--color-attributedRevenue)" strokeWidth={2} />
                <Area dataKey="spend" type="monotone" fill="var(--color-spend)" fillOpacity={0.08} stroke="var(--color-spend)" strokeWidth={2} />
                <ChartLegend content={<ChartLegendContent />} />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <h2 className="text-base font-semibold">Performance por canal</h2>
            <p className="mt-1 text-xs text-muted-foreground">ROAS aparece quando o canal possui investimento conectado.</p>
            <Table className="mt-4">
              <TableHeader><TableRow><TableHead>Canal</TableHead><TableHead className="text-right">Invest.</TableHead><TableHead className="text-right">Receita</TableHead><TableHead className="text-right">ROAS</TableHead></TableRow></TableHeader>
              <TableBody>
                {(data?.channels ?? []).map((channel) => (
                  <TableRow key={channel.channel}>
                    <TableCell className="font-medium">{channel.channel}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(channel.spend)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(channel.revenue)}</TableCell>
                    <TableCell className="text-right tabular-nums">{channel.roas == null ? "—" : `${channel.roas.toFixed(2)}x`}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <BreakdownCard title="Vendas por cor" description="Participação nas peças vendidas no ERP." data={data?.breakdowns.colors ?? []} />
        <BreakdownCard title="Vendas por tamanho" description="Mix real das variantes vendidas." data={data?.breakdowns.sizes ?? []} />
        <BreakdownCard title="Vendas por estado" description="Participação no faturamento por UF." data={data?.breakdowns.states ?? []} />
      </div>

      <Card>
        <CardContent className="p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold"><BadgeDollarSign className="h-4 w-4 text-primary" />Pedidos e evidências de campanha</h2>
              <p className="mt-1 text-xs text-muted-foreground">A origem acompanha o comprador conciliado pelo documento.</p>
            </div>
            <Badge variant="outline">{formatNumber(k?.attributedOrders ?? 0)} pedidos atribuídos</Badge>
          </div>
          <div className="mt-4 grid gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-2 xl:grid-cols-4">
            <div className="bg-card px-4 py-3"><p className="text-[10px] font-mono uppercase text-muted-foreground">Pedidos no período</p><p className="mt-1 text-lg font-semibold">{formatNumber(k?.orders ?? 0)}</p></div>
            <div className="bg-card px-4 py-3"><p className="text-[10px] font-mono uppercase text-muted-foreground">Peças vendidas</p><p className="mt-1 text-lg font-semibold">{formatNumber(k?.totalQuantity ?? 0)}</p></div>
            <div className="bg-card px-4 py-3"><p className="text-[10px] font-mono uppercase text-muted-foreground">Receita atribuída</p><p className="mt-1 text-lg font-semibold">{formatCurrency(k?.attributedRevenue ?? 0)}</p></div>
            <div className="bg-card px-4 py-3"><p className="text-[10px] font-mono uppercase text-muted-foreground">Faturamento líquido</p><p className="mt-1 text-lg font-semibold text-primary">{formatCurrency(k?.netRevenue ?? 0)}</p></div>
          </div>
          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Pedido</TableHead><TableHead>Cliente</TableHead><TableHead>Tipo</TableHead><TableHead>Origem</TableHead><TableHead>Campanha</TableHead><TableHead>Atribuição</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
              <TableBody>
                {(data?.orders.rows ?? []).map((order) => (
                  <TableRow key={order.id}>
                    <TableCell><p className="font-medium">#{order.id}</p><p className="text-xs text-muted-foreground">{new Date(order.createdAt).toLocaleString("pt-BR")}</p></TableCell>
                    <TableCell><p className="font-medium">{order.customerName ?? order.company ?? "Cliente não identificado"}</p><p className="text-xs text-muted-foreground">{order.document ?? "Documento não localizado"}</p></TableCell>
                    <TableCell><Badge variant="outline">{order.buyerType === "RETURNING" ? "Recorrente" : order.buyerType === "NEW" ? "Novo" : "Não identificado"}</Badge></TableCell>
                    <TableCell><p className="text-sm">{order.utmSource ?? "Direto / não identificado"}</p><p className="text-xs text-muted-foreground">{order.utmMedium ?? "Sem mídia"}</p></TableCell>
                    <TableCell className="max-w-[260px]"><p className="truncate text-sm" title={order.utmCampaign ?? undefined}>{order.utmCampaign ?? "Não identificada"}</p></TableCell>
                    <TableCell><AttributionBadge state={order.attribution} /></TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatCurrency(order.netAmount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="mt-4 flex flex-col gap-3 border-t pt-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>Página {formatNumber(ordersPage)} de {formatNumber(ordersTotalPages)} · {formatNumber(data?.orders.total ?? 0)} pedido(s) · {ORDERS_PAGE_SIZE} por página</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={ordersPage <= 1 || isFetching} onClick={() => setOrdersPage((page) => Math.max(1, page - 1))}>Anterior</Button>
              <Button variant="outline" size="sm" disabled={ordersPage >= ordersTotalPages || isFetching} onClick={() => setOrdersPage((page) => Math.min(ordersTotalPages, page + 1))}>Próxima</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
