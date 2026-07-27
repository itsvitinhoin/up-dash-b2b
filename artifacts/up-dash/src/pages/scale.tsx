import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  BarChart3,
  Calculator,
  FileText,
  Gauge,
  Layers3,
  Megaphone,
  Package,
  RefreshCw,
  Scale,
  ShoppingCart,
  Sparkles,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import { formatCurrency, formatCurrencySmart, formatNumber, formatPercentage } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DashLoadingCard } from "@/components/ui/dash-loader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DashboardKpiCard } from "@/components/dashboard-kpi-card";
import {
  fadeInUp,
  staggerContainer,
  useReducedMotion,
  withReducedMotion,
} from "@/lib/motion";

type ScaleBreakdownRow = {
  name: string;
  revenue: number;
  units: number;
  orders?: number;
  stockUnits?: number;
  salesPower?: number;
};

type ScaleResponse = {
  client: { id: string; name: string };
  period: { from: string; to: string; days: number };
  kpis: {
    currentSalesPower: number;
    revenue: number;
    orders: number;
    availableStockUnits: number;
    activeProducts: number;
    availableProducts: number;
    periodTurnoverPct: number;
    monthlyRevenue: number;
    monthlyOrders: number;
    avgTicket: number;
    monthlyTurnoverPct: number;
    mediaSpend: number;
    monthlyMediaSpend: number;
    roas: number;
    cpa: number;
    sessions: number;
    conversionRate: number;
    brokenGradePct: number;
    brokenGradeCount: number;
    productGroupCount: number;
  };
  benchmarks: {
    windowDays: number;
    from: string;
    to: string;
    monthlyRevenue: number;
    monthlyOrders: number;
    avgTicket: number;
    monthlyTurnoverPct: number;
    mediaSpend: number;
    monthlyMediaSpend: number;
    roas: number;
    cpa: number;
    sessions: number;
    conversionRate: number;
  };
  projection: {
    targetRevenue: number;
    simulatedSalesPower: number;
    requiredSalesPower: number;
    projectedRevenue: number;
    projectedMediaSpend: number;
    projectedOrders: number;
    projectedCpa: number;
    revenueIncrement: number;
    mediaSpendIncrement: number;
    salesPowerGap: number;
    status: "ready" | "caution" | "blocked";
    scenarios: Array<{
      name: string;
      salesPower: number;
      revenue: number;
      mediaSpend: number;
      orders: number;
    }>;
  };
  breakdowns: {
    categories: ScaleBreakdownRow[];
    colors: ScaleBreakdownRow[];
    sizes: ScaleBreakdownRow[];
    stockByCategory: ScaleBreakdownRow[];
  };
  insights: {
    headline: string;
    summary: string;
    actions: string[];
    risks: string[];
    source: "ai" | "heuristic";
  };
  generatedAt: string;
};

function parseCurrencyInput(value: string): number | undefined {
  const cleaned = value.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function statusLabel(status: ScaleResponse["projection"]["status"]) {
  if (status === "ready") return "Pronto para escalar";
  if (status === "blocked") return "Corrigir estoque antes";
  return "Escalar com cautela";
}

function statusClass(status: ScaleResponse["projection"]["status"]) {
  if (status === "ready") return "bg-emerald-500/10 text-emerald-400 border-emerald-500/25";
  if (status === "blocked") return "bg-red-500/10 text-red-400 border-red-500/25";
  return "bg-amber-500/10 text-amber-400 border-amber-500/25";
}

function BreakdownCard({
  title,
  subtitle,
  rows,
  valueMode = "revenue",
}: {
  title: string;
  subtitle: string;
  rows: ScaleBreakdownRow[];
  valueMode?: "revenue" | "salesPower";
}) {
  const maxValue = Math.max(...rows.map((row) => valueMode === "salesPower" ? row.salesPower ?? 0 : row.revenue), 0);
  return (
    <Card className="p-5 bg-card border-border">
      <div className="mb-4">
        <h2 className="text-base font-semibold leading-tight">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Sem dados para o período.</p>
      ) : (
        <div className="space-y-4">
          {rows.slice(0, 6).map((row) => {
            const value = valueMode === "salesPower" ? row.salesPower ?? 0 : row.revenue;
            const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;
            return (
              <div key={row.name} className="space-y-1.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{row.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {valueMode === "salesPower"
                        ? `${formatNumber(row.stockUnits ?? 0)} un. em estoque`
                        : `${formatNumber(row.units)} un. · ${formatNumber(row.orders ?? 0)} pedidos`}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {formatCurrencySmart(value)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, pct)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function ScenarioCard({ scenario }: { scenario: ScaleResponse["projection"]["scenarios"][number] }) {
  return (
    <Card className="p-4 bg-card border-border">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{scenario.name}</p>
          <p className="text-xs text-muted-foreground">Poder {formatCurrencySmart(scenario.salesPower)}</p>
        </div>
        <TrendingUp className="h-4 w-4 text-primary" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Receita</p>
          <p className="font-semibold tabular-nums">{formatCurrencySmart(scenario.revenue)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Mídia</p>
          <p className="font-semibold tabular-nums">{formatCurrencySmart(scenario.mediaSpend)}</p>
        </div>
        <div className="col-span-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Pedidos estimados</p>
          <p className="font-semibold tabular-nums">{formatNumber(Math.round(scenario.orders))}</p>
        </div>
      </div>
    </Card>
  );
}

function ScaleLoadingState() {
  return (
    <DashLoadingCard
      className="min-h-[420px]"
      label="Carregando Escala"
      description="Calculando poder de venda, estoque disponível, mídia, conversão e projeções."
    />
  );
}

export default function ScalePage() {
  const { selectedClientId, user, selectedDashboardMode } = useAuth();
  const { dateRange } = useDashboardFilters();
  const reduced = useReducedMotion();
  const containerVariants = withReducedMotion(staggerContainer, reduced);
  const fadeVariants = withReducedMotion(fadeInUp, reduced);
  const clientId = user?.role === "ADMIN" ? selectedClientId || undefined : undefined;
  const enabled = selectedDashboardMode === "B2C" && (user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId));
  const dateFrom = format(dateRange.from, "yyyy-MM-dd");
  const dateTo = format(dateRange.to, "yyyy-MM-dd");
  const [targetRevenueInput, setTargetRevenueInput] = useState("");
  const targetRevenue = parseCurrencyInput(targetRevenueInput);

  const { data, isLoading, isError, refetch, isFetching } = useQuery<ScaleResponse>({
    queryKey: ["b2c-scale", clientId, dateFrom, dateTo, targetRevenue, selectedDashboardMode],
    queryFn: () => {
      const params = new URLSearchParams({ dateFrom, dateTo });
      if (clientId) params.set("clientId", clientId);
      if (targetRevenue) params.set("targetRevenue", String(targetRevenue));
      return customFetch<ScaleResponse>(`/api/analytics/scale?${params.toString()}`);
    },
    enabled,
    placeholderData: (previous) => previous,
  });

  useEffect(() => {
    if (!data || targetRevenueInput) return;
    setTargetRevenueInput(Math.round(data.projection.targetRevenue).toLocaleString("pt-BR"));
  }, [data, targetRevenueInput]);

  const periodLabel = data ? `${data.period.from} a ${data.period.to}` : `${dateFrom} a ${dateTo}`;
  const kpis = data?.kpis;
  const benchmarks = data?.benchmarks;
  const projection = data?.projection;
  const generatedLabel = data?.generatedAt ? format(new Date(data.generatedAt), "dd/MM/yyyy HH:mm") : "";
  const avgStockUnitValue = kpis && kpis.availableStockUnits > 0 ? kpis.currentSalesPower / kpis.availableStockUnits : 0;
  const additionalUnitsNeeded = projection && avgStockUnitValue > 0 ? Math.ceil(projection.salesPowerGap / avgStockUnitValue) : 0;

  const handlePrint = () => {
    const cleanup = () => {
      document.body.classList.remove("print-dashboard");
      window.removeEventListener("afterprint", cleanup);
    };
    document.body.classList.add("print-dashboard");
    window.addEventListener("afterprint", cleanup);
    requestAnimationFrame(() => {
      window.print();
      window.setTimeout(cleanup, 1000);
    });
  };

  if (selectedDashboardMode !== "B2C") {
    return (
      <Alert data-testid="page-scale-b2b-warning">
        <Scale className="h-4 w-4" />
        <AlertTitle>Escala é exclusivo do B2C</AlertTitle>
        <AlertDescription>Selecione o dashboard B2C para analisar poder de venda, estoque e mídia.</AlertDescription>
      </Alert>
    );
  }

  if (isError) {
    return (
      <Alert variant="destructive" data-testid="page-scale-error">
        <AlertTitle>Não foi possível carregar a análise de escala.</AlertTitle>
        <AlertDescription>Verifique se o cliente B2C está selecionado e se as integrações de Nuvemshop, Meta e GA4 estão configuradas.</AlertDescription>
        <Button className="mt-4" variant="outline" onClick={() => refetch()}>
          Tentar novamente
        </Button>
      </Alert>
    );
  }

  return (
    <div className="space-y-6 dashboard-printable" data-testid="page-scale">
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <motion.div initial="hidden" animate="visible" variants={fadeVariants} className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="relative flex h-1.5 w-1.5">
            {!reduced && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-500/60" />}
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue-500" />
          </span>
          <span className="font-mono uppercase tracking-wider">
            Escala · {periodLabel}
            {data?.client.name && <span className="ml-2 text-muted-foreground/70">{data.client.name}</span>}
          </span>
        </motion.div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrint} disabled={!data}>
            <FileText className="mr-1.5 h-4 w-4" />
            Exportar PDF
          </Button>
        </div>
      </div>

      {isLoading || !data || !kpis || !benchmarks || !projection ? (
        <ScaleLoadingState />
      ) : (
        <>
          <motion.div initial="hidden" animate="visible" variants={containerVariants} className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <DashboardKpiCard
              icon={Package}
              iconClass="bg-blue-500/15 text-blue-400"
              label="Poder de venda"
              value={kpis.currentSalesPower}
              format={formatCurrencySmart}
              change={null}
              changeLabel="fixo"
              sub={[
                { label: "Estoque disponível", value: `${formatNumber(kpis.availableStockUnits)} un.` },
                { label: "Produtos ativos", value: formatNumber(kpis.activeProducts) },
              ]}
              sparkValues={[kpis.currentSalesPower, projection.requiredSalesPower]}
              sparkColor="#60a5fa"
              isLoading={false}
              testId="scale-kpi-sales-power"
              valueAccent
            />
            <DashboardKpiCard
              icon={Wallet}
              iconClass="bg-emerald-500/15 text-emerald-400"
              label="Faturamento"
              value={kpis.revenue}
              format={formatCurrencySmart}
              change={null}
              changeLabel="período"
              sub={[
                { label: "Média 90d/mês", value: formatCurrencySmart(benchmarks.monthlyRevenue) },
                { label: "Ritmo mensal", value: formatCurrencySmart(kpis.monthlyRevenue) },
              ]}
              sparkValues={[benchmarks.monthlyRevenue, kpis.monthlyRevenue]}
              sparkColor="#34d399"
              isLoading={false}
              testId="scale-kpi-revenue"
            />
            <DashboardKpiCard
              icon={ShoppingCart}
              iconClass="bg-violet-500/15 text-violet-400"
              label="Qtd. vendas"
              value={kpis.orders}
              format={(value) => formatNumber(Math.round(value))}
              change={null}
              changeLabel="período"
              sub={[
                { label: "Média 90d/mês", value: formatNumber(Math.round(benchmarks.monthlyOrders)) },
                { label: "Ritmo mensal", value: formatNumber(Math.round(kpis.monthlyOrders)) },
              ]}
              sparkValues={[benchmarks.monthlyOrders, kpis.monthlyOrders]}
              sparkColor="#a78bfa"
              isLoading={false}
              testId="scale-kpi-orders"
            />
            <DashboardKpiCard
              icon={Target}
              iconClass="bg-pink-500/15 text-pink-400"
              label="Ticket médio"
              value={kpis.avgTicket}
              format={formatCurrencySmart}
              change={null}
              changeLabel="período"
              sub={[
                { label: "Média 90d", value: formatCurrencySmart(benchmarks.avgTicket) },
                { label: "Pedidos", value: formatNumber(kpis.orders) },
              ]}
              sparkValues={[benchmarks.avgTicket, kpis.avgTicket]}
              sparkColor="#f472b6"
              isLoading={false}
              testId="scale-kpi-ticket"
            />
            <DashboardKpiCard
              icon={Gauge}
              iconClass="bg-amber-500/15 text-amber-400"
              label="Giro"
              value={kpis.periodTurnoverPct}
              format={formatPercentage}
              change={null}
              changeLabel="período"
              sub={[
                { label: "Média 90d/mês", value: formatPercentage(benchmarks.monthlyTurnoverPct) },
                { label: "Ritmo mensal", value: formatPercentage(kpis.monthlyTurnoverPct) },
              ]}
              sparkValues={[benchmarks.monthlyTurnoverPct, kpis.monthlyTurnoverPct]}
              sparkColor="#f59e0b"
              isLoading={false}
              testId="scale-kpi-turnover"
              ringValue={Math.min(100, kpis.periodTurnoverPct)}
              ringColor="#f59e0b"
            />
            <DashboardKpiCard
              icon={Megaphone}
              iconClass="bg-sky-500/15 text-sky-400"
              label="Invest. mídia"
              value={kpis.mediaSpend}
              format={formatCurrencySmart}
              change={null}
              changeLabel="período"
              sub={[
                { label: "Média 90d/mês", value: formatCurrencySmart(benchmarks.monthlyMediaSpend) },
                { label: "Ritmo mensal", value: formatCurrencySmart(kpis.monthlyMediaSpend) },
              ]}
              sparkValues={[benchmarks.monthlyMediaSpend, kpis.monthlyMediaSpend]}
              sparkColor="#38bdf8"
              isLoading={false}
              testId="scale-kpi-media"
            />
            <DashboardKpiCard
              icon={TrendingUp}
              iconClass="bg-lime-500/15 text-lime-400"
              label="ROAS"
              value={kpis.roas}
              format={(value) => `${value.toFixed(2)}x`}
              change={null}
              changeLabel="período"
              sub={[
                { label: "Média 90d", value: `${benchmarks.roas.toFixed(2)}x` },
                { label: "Investimento", value: formatCurrencySmart(kpis.mediaSpend) },
              ]}
              sparkValues={[benchmarks.roas, kpis.roas]}
              sparkColor="#84cc16"
              isLoading={false}
              testId="scale-kpi-roas"
            />
            <DashboardKpiCard
              icon={Calculator}
              iconClass="bg-orange-500/15 text-orange-400"
              label="Custo por compra"
              value={kpis.cpa}
              format={formatCurrencySmart}
              change={null}
              changeLabel="período"
              sub={[
                { label: "Média 90d", value: formatCurrencySmart(benchmarks.cpa) },
                { label: "Conversão", value: formatPercentage(kpis.conversionRate) },
              ]}
              sparkValues={[benchmarks.cpa, kpis.cpa]}
              sparkColor="#fb923c"
              isLoading={false}
              testId="scale-kpi-cpa"
            />
          </motion.div>

          <div className="space-y-4">
            <Card className="p-5 bg-card border-border">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Calculator className="h-4 w-4 text-primary" />
                    <h2 className="text-base font-semibold">Calculadora de projeção</h2>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Insira o faturamento mensal que a marca quer atingir para estimar estoque, mídia, pedidos e CPA necessários.</p>
                </div>
                <div className="w-full max-w-xs">
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Faturamento alvo mensal
                  </label>
                  <Input
                    value={targetRevenueInput}
                    onChange={(event) => setTargetRevenueInput(event.target.value)}
                    placeholder="Ex: 150.000"
                    inputMode="decimal"
                    className="bg-background"
                    data-testid="scale-target-revenue-input"
                  />
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
                {[
                  {
                    label: "Faturamento",
                    current: formatCurrencySmart(kpis.monthlyRevenue),
                    target: formatCurrencySmart(projection.targetRevenue),
                    gap: formatCurrencySmart(Math.max(0, projection.targetRevenue - kpis.monthlyRevenue)),
                    helper: "ritmo mensal atual",
                    icon: Wallet,
                  },
                  {
                    label: "Poder de venda",
                    current: formatCurrencySmart(kpis.currentSalesPower),
                    target: formatCurrencySmart(projection.requiredSalesPower),
                    gap: `${formatNumber(additionalUnitsNeeded)} peças`,
                    helper: `preço médio ${formatCurrencySmart(avgStockUnitValue)}`,
                    icon: Package,
                  },
                  {
                    label: "Invest. mídia",
                    current: formatCurrencySmart(kpis.monthlyMediaSpend),
                    target: formatCurrencySmart(projection.projectedMediaSpend),
                    gap: formatCurrencySmart(Math.max(0, projection.projectedMediaSpend - kpis.monthlyMediaSpend)),
                    helper: "baseado no ROAS 90d",
                    icon: Megaphone,
                  },
                  {
                    label: "Qtd. vendas",
                    current: formatNumber(Math.round(kpis.monthlyOrders)),
                    target: formatNumber(Math.round(projection.projectedOrders)),
                    gap: `${formatNumber(Math.max(0, Math.ceil(projection.projectedOrders - kpis.monthlyOrders)))} pedidos`,
                    helper: "baseado no ticket 90d",
                    icon: ShoppingCart,
                  },
                  {
                    label: "Grade quebrada",
                    current: formatPercentage(kpis.brokenGradePct),
                    target: `${formatNumber(kpis.brokenGradeCount)} de ${formatNumber(kpis.productGroupCount)}`,
                    gap: "corrigir para escalar",
                    helper: "saúde da grade atual",
                    icon: Layers3,
                  },
                ].map((item) => (
                  <div key={item.label} className="rounded-md border border-border bg-background/40 p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{item.label}</p>
                      <item.icon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="mt-3 space-y-2">
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Atual</p>
                        <p className="text-lg font-semibold tabular-nums">{item.current}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Meta</p>
                          <p className="truncate text-sm font-semibold tabular-nums">{item.target}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Gap</p>
                          <p className="truncate text-sm font-semibold tabular-nums text-amber-400">{item.gap}</p>
                        </div>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">{item.helper}</p>
                  </div>
                ))}
              </div>

              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-4">
                <div className="rounded-md border border-border bg-muted/20 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Incremento de receita</p>
                  <p className="mt-1 text-lg font-semibold text-emerald-400">{formatCurrencySmart(projection.revenueIncrement)}</p>
                </div>
                <div className="rounded-md border border-border bg-muted/20 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Incremento de mídia</p>
                  <p className="mt-1 text-lg font-semibold text-sky-400">{formatCurrencySmart(projection.mediaSpendIncrement)}</p>
                </div>
                <div className="rounded-md border border-border bg-muted/20 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Gap de estoque</p>
                  <p className="mt-1 text-lg font-semibold text-amber-400">{formatCurrencySmart(projection.salesPowerGap)}</p>
                </div>
                <div className="rounded-md border border-border bg-muted/20 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Peças adicionais</p>
                  <p className="mt-1 text-lg font-semibold text-blue-400">{formatNumber(additionalUnitsNeeded)}</p>
                </div>
              </div>
            </Card>

            <Card className="p-5 bg-card border-border">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <h2 className="text-base font-semibold">Insights de escala</h2>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {data.insights.source === "ai" ? "Gerado por IA" : "Gerado por regras"} · {generatedLabel}
                  </p>
                </div>
                <span className={`rounded-md border px-2 py-1 text-[11px] font-medium ${statusClass(projection.status)}`}>
                  {statusLabel(projection.status)}
                </span>
              </div>
              <h3 className="text-lg font-semibold leading-snug">{data.insights.headline}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{data.insights.summary}</p>
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ações recomendadas</p>
                  <ul className="space-y-2">
                    {data.insights.actions.map((item, index) => (
                      <li key={index} className="flex gap-2 text-sm text-muted-foreground">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/15 text-[11px] font-semibold text-primary">{index + 1}</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Riscos para acompanhar</p>
                  <ul className="space-y-2">
                    {data.insights.risks.map((item, index) => (
                      <li key={index} className="flex gap-2 text-sm text-muted-foreground">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {projection.scenarios.map((scenario) => (
              <ScenarioCard key={scenario.name} scenario={scenario} />
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
            <BreakdownCard title="Categorias mais vendidas" subtitle="Tipos de peça que sustentam a escala" rows={data.breakdowns.categories} />
            <BreakdownCard title="Tamanhos mais vendidos" subtitle="Base para proporção de grade" rows={data.breakdowns.sizes} />
            <BreakdownCard title="Cores mais vendidas" subtitle="Cores que devem receber profundidade" rows={data.breakdowns.colors} />
            <BreakdownCard title="Poder por categoria" subtitle="Estoque disponível em preço final" rows={data.breakdowns.stockByCategory} valueMode="salesPower" />
          </div>

          <Card className="p-5 bg-card border-border">
            <div className="mb-4 flex items-center gap-2">
              <Layers3 className="h-4 w-4 text-primary" />
              <h2 className="text-base font-semibold">Como a projeção foi calculada</h2>
            </div>
            <div className="grid grid-cols-1 gap-3 text-sm text-muted-foreground md:grid-cols-3">
              <div className="rounded-md border border-border bg-background/40 p-3">
                <p className="font-medium text-foreground">Poder de venda</p>
                <p className="mt-1">Soma do estoque disponível multiplicado pelo preço final de cada SKU.</p>
              </div>
              <div className="rounded-md border border-border bg-background/40 p-3">
                <p className="font-medium text-foreground">Média 90d</p>
                <p className="mt-1">Os textos dos cards usam a média mensal dos últimos 90 dias como referência da marca.</p>
              </div>
              <div className="rounded-md border border-border bg-background/40 p-3">
                <p className="font-medium text-foreground">Calculadora</p>
                <p className="mt-1">O faturamento alvo é dividido pelo giro, ROAS e ticket médio dos últimos 90 dias.</p>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
