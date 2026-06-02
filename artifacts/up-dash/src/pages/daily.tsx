import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfDay, subDays } from "date-fns";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Download,
  FileText,
  Megaphone,
  Package,
  Receipt,
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
import { Badge } from "@/components/ui/badge";
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

function TrendBadge({ value, inverse = false }: { value: number | null; inverse?: boolean }) {
  const positive = value !== null && value > 0;
  const negative = value !== null && value < 0;
  const good = inverse ? negative : positive;
  const bad = inverse ? positive : negative;
  return (
    <Badge
      variant="secondary"
      className={
        good
          ? "bg-emerald-500/10 text-emerald-500"
          : bad
            ? "bg-red-500/10 text-red-500"
            : "bg-muted text-muted-foreground"
      }
    >
      {good ? <ArrowUpRight className="mr-1 h-3 w-3" /> : bad ? <ArrowDownRight className="mr-1 h-3 w-3" /> : null}
      {metricChangeLabel(value)}
    </Badge>
  );
}

function KpiCard({
  label,
  value,
  change,
  icon: Icon,
  inverse,
}: {
  label: string;
  value: string;
  change: number | null;
  icon: typeof Wallet;
  inverse?: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold tracking-normal">{value}</p>
        </div>
        <div className="rounded-md bg-primary/10 p-2 text-primary">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>vs período anterior</span>
        <TrendBadge value={change} inverse={inverse} />
      </div>
    </Card>
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
    document.body.classList.add("print-dashboard");
    requestAnimationFrame(() => {
      window.print();
      document.body.classList.remove("print-dashboard");
    });
  };

  const hasVariants = (data?.colors.length ?? 0) > 0 || (data?.sizes.length ?? 0) > 0;
  const generatedLabel = useMemo(() => {
    if (!data?.generatedAt) return "";
    return format(new Date(data.generatedAt), "dd/MM/yyyy HH:mm");
  }, [data?.generatedAt]);

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
      <div className="flex flex-wrap items-start justify-between gap-3 no-print">
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">Relatório diário B2C</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-normal">Daily</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Período {periodLabel}{data?.client.name ? ` · ${data.client.name}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => refetch()} disabled={isLoading}>
            Atualizar
          </Button>
          <Button onClick={handlePrint} disabled={!data} data-testid="daily-export-pdf">
            <Download className="mr-2 h-4 w-4" />
            Exportar PDF
          </Button>
        </div>
      </div>

      <Card className="hidden p-5 print:block">
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
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Card key={index} className="h-32 animate-pulse bg-card/70" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <KpiCard label="Faturamento aprovado" value={formatCurrency(kpis.approvedRevenue)} change={data.changes.approvedRevenue} icon={Wallet} />
            <KpiCard label="Quantidade de vendas" value={formatNumber(kpis.sales)} change={data.changes.sales} icon={Receipt} />
            <KpiCard label="Ticket médio" value={formatCurrency(kpis.avgTicket)} change={data.changes.avgTicket} icon={BarChart3} />
            <KpiCard label="Custo por compra" value={formatCurrency(kpis.costPerPurchase)} change={data.changes.costPerPurchase} icon={Tags} inverse />
            <KpiCard label="Investimento em mídia" value={formatCurrency(kpis.mediaSpend)} change={data.changes.mediaSpend} icon={Megaphone} />
            <KpiCard label="ROAS" value={`${kpis.roas.toFixed(2)}x`} change={data.changes.roas} icon={Sparkles} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase text-muted-foreground">Análise geral</p>
                  <h3 className="mt-1 text-lg font-semibold tracking-normal">Leitura do período</h3>
                </div>
                <Badge variant="secondary">{data.analysis.source === "ai" ? "GPT" : "Auto"}</Badge>
              </div>
              <p className="text-sm leading-relaxed text-foreground/85">{data.analysis.generalAnalysis}</p>
              {generatedLabel && <p className="mt-4 text-xs text-muted-foreground">Gerado em {generatedLabel}</p>}
            </Card>

            <Card className="p-5">
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
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="p-5">
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

            <Card className="p-5">
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
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <RankingCard title="Categorias" rows={data.categories} />
            <RankingCard title="Cores" rows={data.colors} emptyLabel={hasVariants ? "Sem cores no período." : "Cores ainda não vieram da Nuvemshop."} />
            <RankingCard title="Tamanhos" rows={data.sizes} emptyLabel={hasVariants ? "Sem tamanhos no período." : "Tamanhos ainda não vieram da Nuvemshop."} />
          </div>
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
