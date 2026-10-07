import { GlassMetricCard } from "@/components/glass-metric-card";
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfDay, subDays } from "date-fns";
import { motion } from "framer-motion";
import {
  FileText,
  Megaphone,
  Package,
  Receipt,
  RefreshCw,
  ShoppingCart,
  Sparkles,
  Tags,
  Wallet,
} from "lucide-react";
import { customFetch, useGetClient } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import { queryOpts } from "@/lib/query-opts";
import { formatCurrency, formatNumber, formatPercentage } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DashLoadingCard } from "@/components/ui/dash-loader";
import {
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

function DailyKpiCard({
  label,
  value,
  format: formatValue,
  unit,
  change,
  previousValue,
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
  previousValue?: number;
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  sparkValues: number[];
  sparkColor: string;
  inverse?: boolean;
  valueAccent?: boolean;
}) {
  return (<GlassMetricCard label={label} value={value} icon={Icon} format={formatValue} unit={unit} previousValue={previousValue} source="Ecommerce · pedidos pagos; Meta Ads · investimento e compras atribuídas" info={label === "Custo por compra" ? "Investimento em mídia dividido pela quantidade de pedidos pagos no período." : label === "Ticket médio" ? "Faturamento aprovado dividido pela quantidade de pedidos pagos." : label === "ROAS" ? "Faturamento aprovado dividido pelo investimento em mídia no período." : undefined} change={change} changePositive={change !== null ? (inverse ? change <= 0 : change >= 0) : undefined} sparkValues={sparkValues} />);
}

function DailyLoadingState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
      data-testid="daily-loading"
    >
      <DashLoadingCard
        label="Carregando relatório diário"
        description="Buscando vendas, mídia, produtos e insights do período selecionado."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
  const targetClientId = user?.role === "CLIENT" ? user?.clientId : clientId;
  // Daily é B2C-only por padrão, mas clientes Vesti (dashboardType=B2B,
  // commercePlatform=VESTI) também têm relatório diário via BigQuery
  // (vestiDashboardController.getDailyReport). Precisamos saber a
  // commercePlatform do cliente selecionado pra liberar a página pra eles
  // sem abrir pra B2B genérico (que não é suportado pelo endpoint).
  const { data: targetClient, isLoading: isTargetClientLoading } = useGetClient(targetClientId || "", {
    query: queryOpts({ enabled: !!targetClientId }),
  });
  const isVestiClient = targetClient?.commercePlatform === "VESTI";
  const isSupportedClient = selectedDashboardMode === "B2C" || isVestiClient;
  const hasClientSelected = user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId);
  const enabled = hasClientSelected && isSupportedClient;

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
    ...queryOpts<DailyReportResponse>({ enabled }),
    queryKey: ["b2c-daily-report", clientId, dateFrom, dateTo, selectedDashboardMode],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ dateFrom, dateTo });
      if (clientId) params.set("clientId", clientId);
      return customFetch<DailyReportResponse>(`/api/analytics/daily-report?${params.toString()}`, { signal });
    },
  });

  const kpis = data?.kpis;
  const periodLabel = `${format(dateRange.from, "dd/MM/yyyy")} a ${format(dateRange.to, "dd/MM/yyyy")}`;

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

  if (!hasClientSelected) {
    return (
      <Alert data-testid="page-daily-b2b-warning">
        <FileText className="h-4 w-4" />
        <AlertTitle>Selecione um cliente</AlertTitle>
        <AlertDescription>Escolha uma marca para emitir o relatório diário.</AlertDescription>
      </Alert>
    );
  }

  if (!isSupportedClient) {
    if (isTargetClientLoading) return <DailyLoadingState />;
    return (
      <Alert data-testid="page-daily-b2b-warning">
        <FileText className="h-4 w-4" />
        <AlertTitle>Relatório diário não disponível para este cliente</AlertTitle>
        <AlertDescription>Relatório diário disponível para clientes B2C (Nuvemshop) ou Vesti.</AlertDescription>
      </Alert>
    );
  }

  if (isError) {
    return (
      <Alert variant="destructive" data-testid="page-daily-error">
        <AlertTitle>Não foi possível carregar o relatório diário.</AlertTitle>
        <AlertDescription>
          Verifique se o cliente é B2C ou Vesti e se as integrações necessárias estão configuradas.
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
            Diário · {periodLabel}
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

      <Card className="p-5 up-report-intro"><div className="up-section-heading"><div><p className="text-xs text-primary mb-1">Relatório diário</p><h2 className="text-lg font-semibold">{data?.client.name ?? targetClient?.name ?? "Sua marca"}</h2><p className="mt-1 text-sm text-muted-foreground">Vendas, mídia e produtos de {periodLabel}.</p></div><FileText className="h-5 w-5 text-primary shrink-0" /></div></Card>

      {isLoading || !kpis ? (
        <DailyLoadingState />
      ) : (
        <>
          <motion.div
            initial="hidden"
            animate="visible"
            variants={containerVariants}
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
          >
            <DailyKpiCard
              label="Faturamento aprovado"
              value={kpis.approvedRevenue}
              format={formatCurrency}
              unit="BRL"
              change={data.changes.approvedRevenue}
              previousValue={data.prevKpis?.approvedRevenue}
              icon={Wallet}
              iconClass="bg-blue-500/15 text-blue-400"
              sparkValues={sparkValues.approvedRevenue}
              sparkColor="#afc4ff"
              valueAccent
            />
            <DailyKpiCard
              label="Quantidade de vendas"
              value={kpis.sales}
              format={formatNumber}
              unit="pedidos"
              change={data.changes.sales}
              previousValue={data.prevKpis?.sales}
              icon={ShoppingCart}
              iconClass="bg-violet-500/15 text-violet-400"
              sparkValues={sparkValues.sales}
              sparkColor="#5b8dff"
            />
            <DailyKpiCard
              label="Ticket médio"
              value={kpis.avgTicket}
              format={formatCurrency}
              unit="BRL"
              change={data.changes.avgTicket}
              previousValue={data.prevKpis?.avgTicket}
              icon={Receipt}
              iconClass="bg-emerald-500/15 text-emerald-400"
              sparkValues={sparkValues.avgTicket}
              sparkColor="#87adff"
            />
            <DailyKpiCard
              label="Custo por compra"
              value={kpis.costPerPurchase}
              format={formatCurrency}
              unit="BRL"
              change={data.changes.costPerPurchase}
              previousValue={data.prevKpis?.costPerPurchase}
              icon={Tags}
              iconClass="bg-amber-500/15 text-amber-400"
              sparkValues={sparkValues.costPerPurchase}
              sparkColor="#0458fe"
              inverse
            />
            <DailyKpiCard
              label="Investimento em mídia"
              value={kpis.mediaSpend}
              format={formatCurrency}
              unit="BRL"
              change={data.changes.mediaSpend}
              previousValue={data.prevKpis?.mediaSpend}
              icon={Megaphone}
              iconClass="bg-sky-500/15 text-sky-400"
              sparkValues={sparkValues.mediaSpend}
              sparkColor="#afc4ff"
            />
            <DailyKpiCard
              label="ROAS"
              value={kpis.roas}
              format={(value) => `${value.toFixed(2)}x`}
              change={data.changes.roas}
              previousValue={data.prevKpis?.roas}
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
                <div><h2 className="text-base font-semibold">Análise geral</h2><p className="mt-1 text-xs text-muted-foreground">Leitura do período</p></div>
                <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
                  <Sparkles className="h-3 w-3" />
                  Análises
                </span>
              </div>
              <p className="text-sm leading-relaxed text-foreground/85">{data.analysis.generalAnalysis}</p>
              {generatedLabel && <p className="mt-4 text-xs text-muted-foreground">Gerado em {generatedLabel}</p>}
              </div>
            </Card>

            <Card className="p-5 bg-card border-border" data-testid="daily-summary-insights">
              <div className="mb-4"><h2 className="text-base font-semibold">Resumo do relatório</h2><p className="mt-1 text-xs text-muted-foreground">Insights para envio</p></div>
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
            <RankingCard title="Cores" rows={data.colors} emptyLabel={hasVariants ? "Sem cores no período." : "Cores ainda não disponíveis para esse cliente."} />
            <RankingCard title="Tamanhos" rows={data.sizes} emptyLabel={hasVariants ? "Sem tamanhos no período." : "Tamanhos ainda não disponíveis para esse cliente."} />
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
            <div key={row.name} className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-3 last:border-0 last:pb-0">
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
