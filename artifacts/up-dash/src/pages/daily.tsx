import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfDay, subDays } from "date-fns";
import { motion } from "framer-motion";
import {
  ArrowDownRight,
  ArrowUpRight,
  FileText,
  Loader2,
  Megaphone,
  MoreHorizontal,
  Package,
  Receipt,
  RefreshCw,
  ShoppingCart,
  Sparkles,
  Tags,
  Wallet,
} from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import { formatCurrency, formatNumber, formatPercentage } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CountUp } from "@/components/count-up";
import { Sparkline } from "@/components/sparkline";
import {
  cardEntry,
  fadeInUp,
  staggerContainer,
  useReducedMotion,
  withReducedMotion,
} from "@/lib/motion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type DailyMetricSet = {
  approvedRevenue: number;
  sales: number;
  avgTicket: number;
  costPerPurchase: number;
  mediaSpend: number;
  roas: number;
};

type DailyReportResponse = {
  client: { id: string; name: string };
  period: { from: string; to: string };
  previousPeriod: { from: string; to: string };
  kpis: DailyMetricSet;
  prevKpis: DailyMetricSet;
  changes: Record<keyof DailyMetricSet, number | null>;
  campaigns: Array<{
    id: string;
    name: string;
    spend: number;
    purchases: number;
    revenue: number;
    roas: number;
    cpa: number;
    clicks: number;
    impressions: number;
  }>;
  products: Array<{ name: string; category: string | null; units: number; revenue: number }>;
  categories: Array<{ name: string; units: number; revenue: number }>;
  colors: Array<{ name: string; units: number; revenue: number }>;
  sizes: Array<{ name: string; units: number; revenue: number }>;
  analysis: {
    generalAnalysis: string;
    reportSummary: string[];
    source: "ai" | "heuristic";
  };
  generatedAt: string;
};

function metricChangeLabel(value: number | null) {
  if (value === null) return "sem base";
  if (value === 0) return "0,0%";
  return `${value > 0 ? "+" : ""}${formatPercentage(value)}`;
}

function TrendPill({ value, inverse = false }: { value: number | null; inverse?: boolean }) {
  const positive = value !== null && value > 0;
  const negative = value !== null && value < 0;
  const good = inverse ? negative : positive;
  const bad = inverse ? positive : negative;
  return (
    <span
      className={
        `inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${
          good
            ? "bg-emerald-500/10 text-emerald-400"
            : bad
              ? "bg-red-500/10 text-red-400"
              : "bg-muted text-muted-foreground"
        }`
      }
    >
      {good ? <ArrowUpRight className="mr-1 h-3 w-3" /> : bad ? <ArrowDownRight className="mr-1 h-3 w-3" /> : null}
      {metricChangeLabel(value)}
    </span>
  );
}

function DailyKpiCard({
  label,
  value,
  format: formatValue,
  unit,
  change,
  icon: Icon,
  iconClass,
  sparkValues,
  sparkColor,
  inverse,
  valueAccent,
}: {
  label: string;
  value: number;
  format: (value: number) => string;
  unit?: string;
  change: number | null;
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  sparkValues: number[];
  sparkColor: string;
  inverse?: boolean;
  valueAccent?: boolean;
}) {
  const reduced = useReducedMotion();
  const variants = withReducedMotion(cardEntry, reduced);

  return (
    <motion.div variants={variants}>
      <Card className="flex flex-col p-5 bg-card border-border hover-elevate transition-shadow">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${iconClass}`}>
              <Icon className="h-4 w-4" />
            </div>
            <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              {label}
            </span>
          </div>
          <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
        </div>

        <div className="mb-3 flex items-end justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <span
              className={`text-2xl font-semibold tracking-tight tabular-nums ${
                valueAccent
                  ? "bg-gradient-to-br from-foreground via-foreground to-primary bg-clip-text text-transparent"
                  : ""
              }`}
            >
              <CountUp value={value} format={formatValue} />
            </span>
            {unit && <span className="text-xs font-medium text-muted-foreground">{unit}</span>}
          </div>
          {sparkValues.length > 1 && (
            <Sparkline
              values={sparkValues}
              stroke={sparkColor}
              fill={`${sparkColor}22`}
              width={88}
              height={28}
              ariaLabel={`${label} trend`}
            />
          )}
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/60 pt-3 text-xs text-muted-foreground">
          <span>vs período anterior</span>
          <TrendPill value={change} inverse={inverse} />
        </div>
      </Card>
    </motion.div>
  );
}

function DailyLoadingState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
      data-testid="daily-loading"
    >
      <Card className="relative overflow-hidden border-border bg-card p-6">
        <div className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-primary via-chart-3 to-chart-1 opacity-80" />
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-md bg-primary/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Carregando Daily
            </div>
            <Skeleton className="h-7 w-64" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <div className="grid w-full gap-2 sm:w-64">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <Card key={index} className="p-5 bg-card border-border">
            <div className="mb-4 flex items-center justify-between">
              <Skeleton className="h-8 w-32" />
              <Skeleton className="h-8 w-8 rounded-lg" />
            </div>
            <Skeleton className="mb-4 h-9 w-36" />
            <Skeleton className="h-3 w-full" />
          </Card>
        ))}
      </div>
    </motion.div>
  );
}

function EmptyRow({ label, colSpan }: { label: string; colSpan: number }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-8 text-center text-sm text-muted-foreground">
        {label}
      </TableCell>
    </TableRow>
  );
}

export default function DailyPage() {
  const { selectedClientId, user, selectedDashboardMode } = useAuth();
  const { dateRange, setDateRange } = useDashboardFilters();
  const clientId = user?.role === "ADMIN" ? selectedClientId || undefined : undefined;
  const enabled = selectedDashboardMode === "B2C" && (user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId));

  useEffect(() => {
    const today = startOfDay(new Date());
    const defaultFrom = subDays(today, 29).getTime();
    const defaultTo = today.getTime();
    if (dateRange.from.getTime() === defaultFrom && dateRange.to.getTime() === defaultTo) {
      const yesterday = subDays(today, 1);
      setDateRange({ from: yesterday, to: yesterday });
    }
  }, [dateRange.from, dateRange.to, setDateRange]);

  const dateFrom = format(dateRange.from, "yyyy-MM-dd");
  const dateTo = format(dateRange.to, "yyyy-MM-dd");

  const { data, isLoading, isError, refetch } = useQuery<DailyReportResponse>({
    queryKey: ["b2c-daily-report", clientId, dateFrom, dateTo, selectedDashboardMode],
    queryFn: () => {
      const params = new URLSearchParams({ dateFrom, dateTo });
      if (clientId) params.set("clientId", clientId);
      return customFetch<DailyReportResponse>(`/api/analytics/daily-report?${params.toString()}`);
    },
    enabled,
  });

  const kpis = data?.kpis;
  const periodLabel = data ? `${data.period.from} a ${data.period.to}` : `${dateFrom} a ${dateTo}`;

  const handlePrint = () => {
    const cleanup = () => {
      document.body.classList.remove("print-dashboard");
      document.body.classList.remove("print-daily");
      window.removeEventListener("afterprint", cleanup);
    };
    document.body.classList.add("print-dashboard");
    document.body.classList.add("print-daily");
    window.addEventListener("afterprint", cleanup);
    requestAnimationFrame(() => {
      window.print();
      window.setTimeout(cleanup, 1000);
    });
  };

  const hasVariants = (data?.colors.length ?? 0) > 0 || (data?.sizes.length ?? 0) > 0;
  const generatedLabel = useMemo(() => {
    if (!data?.generatedAt) return "";
    return format(new Date(data.generatedAt), "dd/MM/yyyy HH:mm");
  }, [data?.generatedAt]);
  const reduced = useReducedMotion();
  const containerVariants = withReducedMotion(staggerContainer, reduced);
  const fadeVariants = withReducedMotion(fadeInUp, reduced);
  const sparkValues = useMemo(() => {
    const previous = data?.prevKpis;
    const current = data?.kpis;
    return {
      approvedRevenue: [previous?.approvedRevenue ?? 0, current?.approvedRevenue ?? 0],
      sales: [previous?.sales ?? 0, current?.sales ?? 0],
      avgTicket: [previous?.avgTicket ?? 0, current?.avgTicket ?? 0],
      costPerPurchase: [previous?.costPerPurchase ?? 0, current?.costPerPurchase ?? 0],
      mediaSpend: [previous?.mediaSpend ?? 0, current?.mediaSpend ?? 0],
      roas: [previous?.roas ?? 0, current?.roas ?? 0],
    };
  }, [data?.kpis, data?.prevKpis]);

  if (selectedDashboardMode !== "B2C") {
    return (
      <Alert data-testid="page-daily-b2b-warning">
        <FileText className="h-4 w-4" />
        <AlertTitle>Daily é exclusivo do B2C</AlertTitle>
        <AlertDescription>Selecione o dashboard B2C para emitir relatórios diários de e-commerce.</AlertDescription>
      </Alert>
    );
  }

  if (isError) {
    return (
      <Alert variant="destructive" data-testid="page-daily-error">
        <AlertTitle>Não foi possível carregar o Daily.</AlertTitle>
        <AlertDescription>
          Verifique se o cliente B2C está selecionado e se as integrações de Nuvemshop e Meta estão configuradas.
        </AlertDescription>
        <Button className="mt-4" variant="outline" onClick={() => refetch()}>
          Tentar novamente
        </Button>
      </Alert>
    );
  }

  return (
    <div className="space-y-6 dashboard-printable daily-printable" data-testid="page-daily">
      <div className="flex flex-wrap items-center justify-between gap-2 no-print">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={fadeVariants}
          className="flex items-center gap-2 text-xs text-muted-foreground"
        >
          <span className="relative flex h-1.5 w-1.5">
            {!reduced && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/60" />}
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          <span className="font-mono uppercase tracking-wider">
            Daily · {periodLabel}
            {data?.client.name && <span className="ml-2 text-muted-foreground/70">{data.client.name}</span>}
          </span>
        </motion.div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrint} disabled={!data} data-testid="daily-export-pdf">
            <FileText className="mr-1.5 h-4 w-4" />
            Exportar PDF
          </Button>
        </div>
      </div>

      <Card className="hidden p-5 bg-card border-border print:block">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">UP Dash · Relatório Daily</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal">{data?.client.name ?? "B2C"}</h1>
            <p className="mt-1 text-sm text-muted-foreground">Período {periodLabel}</p>
          </div>
          <img src="/up-dash-logo.png" alt="UP Dash" className="h-9 w-auto" />
        </div>
      </Card>

      {isLoading || !kpis ? (
        <DailyLoadingState />
      ) : (
        <>
          <motion.div
            initial="hidden"
            animate="visible"
            variants={containerVariants}
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
          >
            <DailyKpiCard
              label="Faturamento aprovado"
              value={kpis.approvedRevenue}
              format={formatCurrency}
              unit="BRL"
              change={data.changes.approvedRevenue}
              icon={Wallet}
              iconClass="bg-blue-500/15 text-blue-400"
              sparkValues={sparkValues.approvedRevenue}
              sparkColor="#60a5fa"
              valueAccent
            />
            <DailyKpiCard
              label="Quantidade de vendas"
              value={kpis.sales}
              format={formatNumber}
              unit="pedidos"
              change={data.changes.sales}
              icon={ShoppingCart}
              iconClass="bg-violet-500/15 text-violet-400"
              sparkValues={sparkValues.sales}
              sparkColor="#a78bfa"
            />
            <DailyKpiCard
              label="Ticket médio"
              value={kpis.avgTicket}
              format={formatCurrency}
              unit="BRL"
              change={data.changes.avgTicket}
              icon={Receipt}
              iconClass="bg-emerald-500/15 text-emerald-400"
              sparkValues={sparkValues.avgTicket}
              sparkColor="#34d399"
            />
            <DailyKpiCard
              label="Custo por compra"
              value={kpis.costPerPurchase}
              format={formatCurrency}
              unit="BRL"
              change={data.changes.costPerPurchase}
              icon={Tags}
              iconClass="bg-amber-500/15 text-amber-400"
              sparkValues={sparkValues.costPerPurchase}
              sparkColor="#f59e0b"
              inverse
            />
            <DailyKpiCard
              label="Investimento em mídia"
              value={kpis.mediaSpend}
              format={formatCurrency}
              unit="BRL"
              change={data.changes.mediaSpend}
              icon={Megaphone}
              iconClass="bg-sky-500/15 text-sky-400"
              sparkValues={sparkValues.mediaSpend}
              sparkColor="#38bdf8"
            />
            <DailyKpiCard
              label="ROAS"
              value={kpis.roas}
              format={(value) => `${value.toFixed(2)}x`}
              change={data.changes.roas}
              icon={Sparkles}
              iconClass="bg-primary/15 text-primary"
              sparkValues={sparkValues.roas}
              sparkColor="hsl(var(--primary))"
            />
          </motion.div>

          <motion.div
            initial="hidden"
            animate="visible"
            variants={fadeVariants}
            className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]"
          >
            <Card
              className="relative overflow-hidden p-5 bg-gradient-to-br from-primary/[0.04] via-card to-card border-border"
              data-testid="daily-general-insight"
            >
              <div
                aria-hidden
                className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-primary via-chart-3 to-chart-1 opacity-80"
              />
              <div className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-primary/10 blur-2xl pointer-events-none" />
              <div className="relative z-10">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase text-muted-foreground">Análise geral</p>
                  <h3 className="mt-1 text-lg font-semibold tracking-normal">Leitura do período</h3>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
                  <Sparkles className="h-3 w-3" />
                  Insights
                </span>
              </div>
              <p className="text-sm leading-relaxed text-foreground/85">{data.analysis.generalAnalysis}</p>
              {generatedLabel && <p className="mt-4 text-xs text-muted-foreground">Gerado em {generatedLabel}</p>}
              </div>
            </Card>

            <Card className="p-5 bg-card border-border" data-testid="daily-summary-insights">
              <div className="mb-4">
                <p className="text-xs font-medium uppercase text-muted-foreground">Resumo do relatório</p>
                <h3 className="mt-1 text-lg font-semibold tracking-normal">Insights para envio</h3>
              </div>
              <ol className="space-y-3">
                {data.analysis.reportSummary.map((item, index) => (
                  <li key={`${item}-${index}`} className="flex gap-3 text-sm leading-relaxed">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs font-semibold text-primary">
                      {index + 1}
                    </span>
                    <span className="text-foreground/85">{item}</span>
                  </li>
                ))}
              </ol>
            </Card>
          </motion.div>

          <motion.div
            initial="hidden"
            animate="visible"
            variants={fadeVariants}
            className="grid gap-4 xl:grid-cols-2"
          >
            <Card className="p-5 bg-card border-border">
              <div className="mb-4 flex items-center gap-2">
                <Megaphone className="h-4 w-4 text-primary" />
                <h3 className="text-base font-semibold tracking-normal">Campanhas</h3>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campanha</TableHead>
                    <TableHead className="text-right">Invest.</TableHead>
                    <TableHead className="text-right">Compras</TableHead>
                    <TableHead className="text-right">ROAS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.campaigns.length === 0 ? (
                    <EmptyRow label="Sem dados de campanhas no período." colSpan={4} />
                  ) : (
                    data.campaigns.slice(0, 8).map((campaign) => (
                      <TableRow key={campaign.id}>
                        <TableCell className="max-w-[260px] truncate font-medium">{campaign.name}</TableCell>
                        <TableCell className="text-right">{formatCurrency(campaign.spend)}</TableCell>
                        <TableCell className="text-right">{formatNumber(campaign.purchases)}</TableCell>
                        <TableCell className="text-right">{campaign.roas.toFixed(2)}x</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </Card>

            <Card className="p-5 bg-card border-border">
              <div className="mb-4 flex items-center gap-2">
                <Package className="h-4 w-4 text-primary" />
                <h3 className="text-base font-semibold tracking-normal">Produtos mais vendidos</h3>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead className="text-right">Un.</TableHead>
                    <TableHead className="text-right">Receita</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.products.length === 0 ? (
                    <EmptyRow label="Sem produtos vendidos no período." colSpan={4} />
                  ) : (
                    data.products.slice(0, 8).map((product) => (
                      <TableRow key={product.name}>
                        <TableCell className="max-w-[220px] truncate font-medium">{product.name}</TableCell>
                        <TableCell className="text-muted-foreground">{product.category ?? "Sem categoria"}</TableCell>
                        <TableCell className="text-right">{formatNumber(product.units)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(product.revenue)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </Card>
          </motion.div>

          <motion.div
            initial="hidden"
            animate="visible"
            variants={containerVariants}
            className="grid gap-4 xl:grid-cols-3"
          >
            <RankingCard title="Categorias" rows={data.categories} />
            <RankingCard title="Cores" rows={data.colors} emptyLabel={hasVariants ? "Sem cores no período." : "Cores ainda não vieram da Nuvemshop."} />
            <RankingCard title="Tamanhos" rows={data.sizes} emptyLabel={hasVariants ? "Sem tamanhos no período." : "Tamanhos ainda não vieram da Nuvemshop."} />
          </motion.div>
        </>
      )}
    </div>
  );
}

function RankingCard({
  title,
  rows,
  emptyLabel = "Sem dados no período.",
}: {
  title: string;
  rows: Array<{ name: string; units: number; revenue: number }>;
  emptyLabel?: string;
}) {
  return (
    <Card className="p-5">
      <h3 className="mb-4 text-base font-semibold tracking-normal">{title}</h3>
      <div className="space-y-3">
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          rows.slice(0, 6).map((row, index) => (
            <div key={row.name} className="flex items-center justify-between gap-3 border-b border-border/70 pb-3 last:border-0 last:pb-0">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{index + 1}. {row.name}</p>
                <p className="text-xs text-muted-foreground">{formatNumber(row.units)} unidades</p>
              </div>
              <p className="shrink-0 text-sm font-semibold">{formatCurrency(row.revenue)}</p>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
