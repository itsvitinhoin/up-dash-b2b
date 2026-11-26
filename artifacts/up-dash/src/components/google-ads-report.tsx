import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ApiError, customFetch } from "@workspace/api-client-react";
import { ChartNoAxesCombined, ChevronRight, Download, Link2, RefreshCw, ShoppingBag, Target, Wallet } from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { GoogleAdsExplorer } from "@/components/google-ads-explorer";
import { GlassMetricCard } from "@/components/glass-metric-card";
import { OrganizationHeading } from "@/components/metric-section";
import { exportRowsAsCsv } from "@/lib/csv-export";
import { metricComparison } from "@/lib/metric-comparison";

type Metrics = {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  costPerConversion: number | null;
  roas: number | null;
};
type Campaign = Metrics & { campaignId: string; name: string; channel: string };
type Day = Metrics & { day: string };
type Dates = { dateFrom: string; dateTo: string };
type GoogleAdsData = {
  configured?: boolean;
  connection: { accountName: string; currency: string; timeZone: string } | null;
  report: (Dates & {
    daysCovered: number;
    daysRequested: number;
    lastSyncedAt: string | null;
    total: Metrics;
    previous: Dates & { daysCovered: number; total: Metrics | null };
    campaigns: Campaign[];
    series: Day[];
  }) | null;
};
type Scope = Dates & { workspaceId: string; admin: boolean };
type Format = { money: (value: number) => string; compactMoney: (value: number) => string };
type MetricKey = "spend" | "conversions" | "costPerConversion" | "conversionValue" | "roas";
type EfficiencyKey = "roas" | "costPerConversion";

const source = "Google Ads";
const address = "/api/analytics/google-ads";
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });
const formatRatio = (value: number) => number.format(value) + "×";
const formatDay = (day: string) => day.slice(8) + "/" + day.slice(5, 7);

const metricDefinitions = [
  { key: "spend", label: "Investimento", icon: Wallet, info: "Custo dos anúncios no período." },
  { key: "conversions", label: "Conversões", icon: Target, info: "Conversões contabilizadas na coluna Conversões do Google Ads." },
  { key: "costPerConversion", label: "Custo por conversão", icon: Target, info: "Investimento dividido pelo total de conversões." },
  { key: "conversionValue", label: "Valor de conversão", icon: ShoppingBag, info: "Valor atribuído segundo as ações e a janela de conversão da conta Google Ads." },
  { key: "roas", label: "ROAS do Google Ads", icon: ChartNoAxesCombined, info: "Valor de conversão dividido pelo investimento." },
] satisfies Array<{ key: MetricKey; label: string; icon: typeof Wallet; info: string }>;

const chartConfig = {
  spend: { label: "Investimento", color: "hsl(var(--chart-1))" },
  conversionValue: { label: "Valor de conversão", color: "hsl(var(--chart-2))" },
  roas: { label: "ROAS", color: "hsl(var(--chart-1))" },
  costPerConversion: { label: "Custo por conversão", color: "hsl(var(--chart-1))" },
};
const resultKeys = ["spend", "conversions", "costPerConversion", "conversionValue", "roas"] as const;
const resultHeadings = ["Investimento", "Conversões", "Custo por conv.", "Valor de conv.", "ROAS"];

function metricFormat(key: MetricKey, format: Format) {
  if (key === "conversions") return number.format;
  if (key === "roas") return formatRatio;
  return format.money;
}

function queryString({ workspaceId, admin, dateFrom, dateTo }: Scope, campaignId?: string) {
  const params = new URLSearchParams({ dateFrom, dateTo });
  if (admin) params.set("clientId", workspaceId);
  if (campaignId) params.set("campaignId", campaignId);
  return params.toString();
}

function describeError(error: unknown) {
  if (error instanceof ApiError && error.data && typeof error.data === "object" && "message" in error.data) {
    if (typeof error.data.message === "string") return error.data.message;
  }
  return "Não foi possível consultar o Google Ads. Tente novamente.";
}

function channelLabel(channel: string) {
  const labels: Record<string, string> = {
    SEARCH: "Pesquisa", PERFORMANCE_MAX: "Performance Max", SHOPPING: "Shopping",
    DISPLAY: "Display", VIDEO: "Vídeo", DEMAND_GEN: "Geração de demanda",
    SMART: "Inteligente", MULTI_CHANNEL: "Aplicativo", LOCAL: "Local",
  };
  return labels[channel] ?? (channel === "UNKNOWN" || channel === "UNSPECIFIED" ? "—" : channel);
}

function MetricCards({ report, format }: { report: NonNullable<GoogleAdsData["report"]>; format: Format }) {
  const comparable = report.daysCovered === report.daysRequested && report.previous.total !== null;
  return (
    <section className="space-y-3" aria-label="Visão geral">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <OrganizationHeading>Visão geral</OrganizationHeading>
        {comparable && <p className="text-xs text-muted-foreground">Comparação com {formatDay(report.previous.dateFrom)}–{formatDay(report.previous.dateTo)}</p>}
      </div>
      <div className="grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5 [display:grid]">
        {metricDefinitions.map(({ key, label, icon, info }) => {
          const value = report.total[key];
          const previousValue = comparable ? report.previous.total?.[key] : null;
          return (
            <GlassMetricCard
              key={key}
              label={label}
              icon={icon}
              info={info}
              source={source}
              value={value ?? "—"}
              format={metricFormat(key, format)}
              previousValue={previousValue}
              comparisonValue={value}
              change={metricComparison(value, previousValue).change}
              lowerIsBetter={key === "costPerConversion"}
              neutralComparison={key === "spend"}
              hideComparison={!comparable}
              sparkValues={report.series.flatMap((day) => day[key] == null ? [] : [day[key]])}
              testId={"google-ads-kpi-" + key}
            />
          );
        })}
      </div>
    </section>
  );
}

function TrendChart({
  title, series, metrics, format, controls,
}: {
  title: string;
  series: Day[];
  metrics: Array<keyof typeof chartConfig>;
  format: Format;
  controls?: React.ReactNode;
}) {
  const moneyChart = metrics[0] !== "roas";
  const hasValues = series.some((day) => metrics.some((key) => day[key] != null));
  return (
    <Card className="min-w-0">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0 pb-1">
        <div className="space-y-2">
          <CardTitle className="text-sm">{title}</CardTitle>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {metrics.map((key) => (
              <span className="inline-flex items-center gap-1.5" key={key}>
                <span className="size-2 rounded-full" style={{ background: chartConfig[key].color }} />
                {chartConfig[key].label}
              </span>
            ))}
          </div>
        </div>
        {controls}
      </CardHeader>
      <CardContent className="pt-3">
        {hasValues ? (
          <ChartContainer config={chartConfig} className="aspect-auto h-[210px] w-full" aria-label={title}>
            <LineChart data={series} margin={{ left: 1, right: 9, top: 10 }} accessibilityLayer>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="day" tickFormatter={formatDay} minTickGap={23} tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis tickFormatter={moneyChart ? format.compactMoney : formatRatio} width={62} tickLine={false} axisLine={false} />
              <ChartTooltip content={<ChartTooltipContent
                labelFormatter={(label) => typeof label === "string" ? formatDay(label) : label}
                formatter={(value, name) => (
                  <span className="min-w-44">
                    {chartConfig[name as keyof typeof chartConfig]?.label}{" "}
                    <strong className="float-right tabular-nums">{typeof value === "number" ? (moneyChart ? format.money(value) : formatRatio(value)) : "—"}</strong>
                  </span>
                )}
              />} />
              {metrics.map((key) => (
                <Line key={key} dataKey={key} type="linear" stroke={"var(--color-" + key + ")"} strokeWidth={2.25} dot={false} isAnimationActive={false} />
              ))}
            </LineChart>
          </ChartContainer>
        ) : <p className="flex h-[210px] items-center justify-center text-sm text-muted-foreground">Sem valores para esta métrica no período.</p>}
      </CardContent>
    </Card>
  );
}

function CampaignTable({ campaigns, total, format, onSelect }: {
  campaigns: Campaign[];
  total: Metrics;
  format: Format;
  onSelect: (campaign: Campaign) => void;
}) {
  const renderCells = (metrics: Metrics) => resultKeys.map((key) => (
    <TableCell key={key} className="whitespace-nowrap py-3 text-right tabular-nums">
      {metrics[key] == null ? "—" : metricFormat(key, format)(metrics[key])}
    </TableCell>
  ));
  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader>
        <CardTitle className="text-sm">Desempenho por campanha</CardTitle>
        <CardDescription>Selecione uma campanha para ver os resultados diários.</CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 px-3 sm:px-6">
        <Table className="min-w-[670px]">
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className="w-[40%]">Campanha</TableHead>
              {resultHeadings.map((label) => <TableHead key={label} scope="col" className="whitespace-nowrap text-right">{label}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {campaigns.map((campaign) => (
              <TableRow key={campaign.campaignId}>
                <TableCell className="py-3">
                  <button type="button" className="inline-flex items-start gap-1.5 text-left font-medium hover:underline focus-visible:outline-ring" onClick={() => onSelect(campaign)}>
                    {campaign.name}<ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                  <p className="mt-1 text-xs text-muted-foreground">{channelLabel(campaign.channel)}</p>
                </TableCell>
                {renderCells(campaign)}
              </TableRow>
            ))}
          </TableBody>
          {campaigns.length > 0 && (
            <TableFooter>
              <TableRow><TableCell>Total da conta</TableCell>{renderCells(total)}</TableRow>
            </TableFooter>
          )}
        </Table>
        {!campaigns.length && <p className="p-3 text-sm text-muted-foreground">Nenhuma atividade de campanha no período.</p>}
      </CardContent>
    </Card>
  );
}

function CampaignDetail({ campaign, scope, format, onClose }: {
  campaign: Campaign | null;
  scope: Scope;
  format: Format;
  onClose: () => void;
}) {
  const campaignId = campaign?.campaignId;
  const query = useQuery({
    queryKey: ["google-ads", scope.workspaceId, scope.dateFrom, scope.dateTo, campaignId],
    queryFn: ({ signal }) => customFetch<GoogleAdsData>(address + "?" + queryString(scope, campaignId), { signal }),
    enabled: Boolean(campaignId),
  });

  return (
    <Sheet open={Boolean(campaign)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-[calc(100%-1rem)] overflow-y-auto sm:max-w-lg">
        {campaign && <>
          <SheetHeader className="mb-5 pr-5">
            <SheetTitle>{campaign.name}</SheetTitle>
            <SheetDescription>{channelLabel(campaign.channel)} · {formatDay(scope.dateFrom)}–{formatDay(scope.dateTo)}</SheetDescription>
          </SheetHeader>
          <dl className="mb-5 grid grid-cols-2 gap-4">
            {([
              ["Impressões", number.format(campaign.impressions)],
              ["Cliques", number.format(campaign.clicks)],
              ["CTR", campaign.impressions > 0 ? percent.format(campaign.clicks / campaign.impressions) : "—"],
              ["CPC", campaign.clicks > 0 ? format.money(campaign.spend / campaign.clicks) : "—"],
            ] as const).map(([label, value]) => (
              <div key={label} className="rounded-xl border bg-card/70 p-3">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          {query.isPending && <p role="status" className="text-sm text-muted-foreground">Carregando evolução diária…</p>}
          {query.isError && <Alert variant="destructive"><AlertDescription>{describeError(query.error)}</AlertDescription></Alert>}
          {query.data?.report && <TrendChart title="Evolução diária da campanha" series={query.data.report.series} metrics={["spend", "conversionValue"]} format={format} />}
        </>}
      </SheetContent>
    </Sheet>
  );
}

export function GoogleAdsReport(scope: Scope) {
  const { workspaceId, admin, dateFrom, dateTo } = scope;
  const [efficiency, setEfficiency] = useState<EfficiencyKey>("roas");
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const detailTrigger = useRef<HTMLElement | null>(null);
  const mutationPath = admin ? "?clientId=" + encodeURIComponent(workspaceId) : "";
  const query = useQuery({
    queryKey: ["google-ads", workspaceId, dateFrom, dateTo],
    queryFn: ({ signal }) => customFetch<GoogleAdsData>(address + "?" + queryString(scope), { signal }),
  });
  const connect = useMutation({
    mutationFn: (ids: { customerId: string; managerId: string | null }) => customFetch<Dates>(address + "/connect" + mutationPath, {
      method: "POST",
      body: JSON.stringify(ids),
    }),
    onSuccess: () => query.refetch(),
  });
  const sync = useMutation({
    mutationFn: () => customFetch<Dates>(address + "/sync" + mutationPath, {
      method: "POST",
      body: JSON.stringify({ dateFrom, dateTo }),
    }),
    onSuccess: () => query.refetch(),
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    connect.mutate({
      customerId: String(fields.get("customerId")).trim(),
      managerId: String(fields.get("managerId")).trim() || null,
    });
  };

  if (query.isPending) {
    return <Card className="p-5"><p role="status" className="text-sm text-muted-foreground">Carregando o relatório do Google Ads…</p></Card>;
  }
  if (query.isError || !query.data) {
    return <Alert variant="destructive">
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        {describeError(query.error)}<Button variant="outline" size="sm" onClick={() => query.refetch()}>Tentar novamente</Button>
      </AlertDescription>
    </Alert>;
  }
  const { connection, report, configured } = query.data;
  if (!connection || !report) {
    if (!admin || !configured) {
      return <EmptyState icon={Link2} title="Google Ads sem conexão"
        description={admin ? "A credencial do Google Ads precisa ser configurada no servidor." : "A conta de anúncios deste cliente ainda precisa ser conectada."} />;
    }
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Conectar Google Ads</CardTitle><CardDescription>Vincule a conta anunciante à marca selecionada.</CardDescription></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
            <div className="space-y-1"><Label htmlFor="ads-customer">ID da conta anunciante</Label><Input id="ads-customer" name="customerId" required inputMode="numeric" placeholder="000-000-0000" /></div>
            <div className="space-y-1"><Label htmlFor="ads-manager">ID do MCC (opcional)</Label><Input id="ads-manager" name="managerId" inputMode="numeric" placeholder="000-000-0000" /></div>
            <Button type="submit" disabled={connect.isPending}>{connect.isPending ? "Conectando…" : "Conectar e importar 30 dias"}</Button>
          </form>
          {connect.isError && <p role="alert" className="mt-3 text-sm text-destructive">{describeError(connect.error)}</p>}
        </CardContent>
      </Card>
    );
  }

  const currency = { style: "currency" as const, currency: connection.currency };
  const format = {
    money: new Intl.NumberFormat("pt-BR", currency).format,
    compactMoney: new Intl.NumberFormat("pt-BR", { ...currency, notation: "compact", maximumFractionDigits: 1 }).format,
  };
  const lastUpdated = report.lastSyncedAt && new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short", timeStyle: "short", timeZone: connection.timeZone,
  }).format(new Date(report.lastSyncedAt));

  const exportReport = () => exportRowsAsCsv(
    "google-ads-" + dateFrom + "-" + dateTo + ".csv", report.campaigns,
    [
      { header: "Campanha", accessor: (row) => /^[\s]*[=+@-]|^[\t\r\n]/.test(row.name) ? "'" + row.name : row.name },
      { header: "ID", accessor: (row) => row.campaignId },
      { header: "Tipo", accessor: (row) => channelLabel(row.channel) },
      { header: "Moeda", accessor: () => connection.currency },
      { header: "Investimento", accessor: (row) => row.spend },
      { header: "Impressões", accessor: (row) => row.impressions },
      { header: "Cliques", accessor: (row) => row.clicks },
      { header: "Conversões", accessor: (row) => row.conversions },
      { header: "Custo por conversão", accessor: (row) => row.costPerConversion },
      { header: "Valor de conversão", accessor: (row) => row.conversionValue },
      { header: "ROAS", accessor: (row) => row.roas },
    ],
  );

  return (
    <div className="space-y-6" data-testid="google-ads-report">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{connection.accountName}</p>
            <Badge variant="outline">{connection.currency}</Badge>
          </div>
          {lastUpdated && <p className="mt-1 text-xs text-muted-foreground">Sincronizado em {lastUpdated} · {connection.timeZone}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {report.daysCovered > 0 && <Button asChild variant="secondary" size="sm"><a href="#google-ads-explorer">Explorar dados</a></Button>}
          {admin && <Button variant="outline" size="sm" disabled={!configured || sync.isPending} onClick={() => sync.mutate()}><RefreshCw className="size-4" /> {sync.isPending ? "Sincronizando…" : "Sincronizar período"}</Button>}
          <Button variant="outline" size="sm" onClick={exportReport} disabled={!report.campaigns.length}><Download className="size-4" /> Exportar CSV</Button>
        </div>
      </div>
      {sync.isError && <Alert variant="destructive"><AlertDescription>{describeError(sync.error)}</AlertDescription></Alert>}
      {report.daysCovered === 0 ? (
        <EmptyState icon={ChartNoAxesCombined} title="Período sem dados sincronizados"
          description="Escolha outro período ou sincronize as datas selecionadas." />
      ) : (
        <>
          {report.daysCovered < report.daysRequested && <Alert>
            <AlertDescription>Relatório parcial. {report.daysCovered} de {report.daysRequested} dias sincronizados.</AlertDescription>
          </Alert>}
          <MetricCards report={report} format={format} />
          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
            <TrendChart title="Investimento e valor de conversão" series={report.series} metrics={["spend", "conversionValue"]} format={format} />
            <TrendChart title="Eficiência diária" series={report.series} metrics={[efficiency]} format={format}
              controls={<div role="group" aria-label="Métrica de eficiência" className="inline-flex gap-1 rounded-lg bg-muted p-1">
                {(["roas", "costPerConversion"] as const).map((key) => (
                  <Button key={key} variant={efficiency === key ? "secondary" : "ghost"} className="h-7 px-2 text-xs"
                    aria-pressed={efficiency === key} onClick={() => setEfficiency(key)}>
                    {key === "roas" ? "ROAS" : "Custo por conv."}
                  </Button>
                ))}
              </div>} />
          </div>
          <CampaignTable campaigns={report.campaigns} total={report.total} format={format} onSelect={(row) => {
            detailTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            setCampaign(row);
          }} />
          <GoogleAdsExplorer scope={scope} />
          <ReportDiagnosis campaigns={report.campaigns} total={report.total} />
          <CampaignDetail campaign={campaign} scope={scope} format={format} onClose={() => {
            setCampaign(null);
            requestAnimationFrame(() => detailTrigger.current?.focus());
          }} />
        </>
      )}
    </div>
  );
}

function ReportDiagnosis({ campaigns, total }: { campaigns: Campaign[]; total: Metrics }) {
  if (campaigns.length < 2 || total.conversions <= 0 || total.spend <= 0) return null;
  const leader = campaigns.reduce((best, row) => row.conversions > best.conversions ? row : best);
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Diagnóstico do período</CardTitle></CardHeader>
      <CardContent className="space-y-1 text-sm">
        <p><strong>{leader.name}</strong> respondeu por <strong>{percent.format(leader.conversions / total.conversions)}</strong> das conversões e <strong>{percent.format(leader.spend / total.spend)}</strong> do investimento.</p>
        <p className="text-xs text-muted-foreground">Conversões e valores seguem a atribuição do Google Ads.</p>
      </CardContent>
    </Card>
  );
}
