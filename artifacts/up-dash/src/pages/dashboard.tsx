import { useMemo, useState } from "react";
import { differenceInDays, format, subDays } from "date-fns";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import { useGetDashboard } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  ChevronRight,
  CircleDot,
  DollarSign,
  MoreHorizontal,
  Package,
  RefreshCw,
  Sparkles,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatPercentage, formatNumber } from "@/lib/formatters";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type Series = { date: string; value: number }[];

function computeChange(series: Series | undefined): number | null {
  if (!series || series.length < 4) return null;
  const mid = Math.floor(series.length / 2);
  const a = series.slice(0, mid).reduce((sum, p) => sum + p.value, 0);
  const b = series.slice(mid).reduce((sum, p) => sum + p.value, 0);
  if (a === 0) return b > 0 ? 100 : null;
  return ((b - a) / a) * 100;
}

interface KpiCardProps {
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  label: string;
  value: string;
  unit?: string;
  change: number | null;
  changeLabel: string;
  sub: { label: string; value: string }[];
  isLoading: boolean;
  testId: string;
}

function KpiCard({
  icon: Icon,
  iconClass,
  label,
  value,
  unit,
  change,
  changeLabel,
  sub,
  isLoading,
  testId,
}: KpiCardProps) {
  const isUp = change !== null && change >= 0;
  return (
    <Card
      data-testid={testId}
      className="flex flex-col p-5 bg-card border-border hover-elevate transition-shadow"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${iconClass}`}>
            <Icon className="h-4 w-4" />
          </div>
          <span className="text-sm text-muted-foreground">{label}</span>
        </div>
        <button
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="More options"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-baseline gap-2 mb-3">
        {isLoading ? (
          <Skeleton className="h-9 w-32" />
        ) : (
          <>
            <span className="text-3xl font-semibold tracking-tight tabular-nums">{value}</span>
            {unit && <span className="text-xs text-muted-foreground font-medium">{unit}</span>}
          </>
        )}
      </div>

      {!isLoading && change !== null && (
        <div className="mb-4">
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${
              isUp
                ? "bg-emerald-500/10 text-emerald-400"
                : "bg-red-500/10 text-red-400"
            }`}
          >
            {isUp ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownRight className="h-3 w-3" />
            )}
            {isUp ? "+" : ""}
            {change.toFixed(1)}%
          </span>
          <span className="text-xs text-muted-foreground ml-2">{changeLabel}</span>
        </div>
      )}

      <div className="mt-auto pt-3 border-t border-border space-y-2">
        {sub.map((row) => (
          <div key={row.label} className="flex justify-between text-sm">
            <span className="text-muted-foreground">{row.label}</span>
            <span className="font-medium tabular-nums">{row.value}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

const CHART_METRICS = [
  { id: "revenue", label: "Revenue", formatter: (v: number) => formatCurrency(v) },
  { id: "orders", label: "Orders", formatter: (v: number) => formatNumber(v) },
  { id: "avgTicket", label: "Avg ticket", formatter: (v: number) => formatCurrency(v) },
] as const;

type ChartMetric = (typeof CHART_METRICS)[number]["id"];

export default function DashboardPage() {
  const { selectedClientId, user } = useAuth();
  const { dateRange } = useDashboardFilters();
  const [chartMetric, setChartMetric] = useState<ChartMetric>("revenue");

  const clientId = user?.role === "ADMIN" ? selectedClientId || undefined : undefined;
  const enabled =
    user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId);

  const { data, isLoading, isError, refetch } = useGetDashboard(
    {
      clientId,
      dateFrom: format(dateRange.from, "yyyy-MM-dd"),
      dateTo: format(dateRange.to, "yyyy-MM-dd"),
    },
    { query: queryOpts({ enabled }) },
  );

  // Previous period (same inclusive length, immediately before current range)
  const inclusiveDays = Math.max(
    1,
    differenceInDays(dateRange.to, dateRange.from) + 1,
  );
  const prevTo = subDays(dateRange.from, 1);
  const prevFrom = subDays(prevTo, inclusiveDays - 1);
  const { data: prevData } = useGetDashboard(
    {
      clientId,
      dateFrom: format(prevFrom, "yyyy-MM-dd"),
      dateTo: format(prevTo, "yyyy-MM-dd"),
    },
    { query: queryOpts({ enabled }) },
  );

  // Compute changes from time series
  const revenueChange = useMemo(() => computeChange(data?.revenueOverTime), [data]);
  const ordersChange = useMemo(() => computeChange(data?.ordersOverTime), [data]);
  const leadsChange = useMemo(() => computeChange(data?.leadsOverTime), [data]);
  const avgTicketChange = useMemo(() => {
    if (!data?.kpis.avgTicket || !prevData?.kpis.avgTicket) return null;
    if (prevData.kpis.avgTicket === 0) return null;
    return ((data.kpis.avgTicket - prevData.kpis.avgTicket) / prevData.kpis.avgTicket) * 100;
  }, [data, prevData]);
  const conversionChange = useMemo(() => {
    if (
      data?.kpis.conversionRate === undefined ||
      prevData?.kpis.conversionRate === undefined ||
      prevData.kpis.conversionRate === 0
    )
      return null;
    return (
      ((data.kpis.conversionRate - prevData.kpis.conversionRate) /
        prevData.kpis.conversionRate) *
      100
    );
  }, [data, prevData]);

  // Build dual-line chart data (current vs. previous)
  const chartData = useMemo(() => {
    if (!data) return [];
    const current =
      chartMetric === "revenue"
        ? data.revenueOverTime
        : chartMetric === "orders"
          ? data.ordersOverTime
          : data.revenueOverTime.map((r, i) => {
              const o = data.ordersOverTime[i]?.value || 0;
              return { date: r.date, value: o > 0 ? r.value / o : 0 };
            });
    const previous =
      prevData &&
      (chartMetric === "revenue"
        ? prevData.revenueOverTime
        : chartMetric === "orders"
          ? prevData.ordersOverTime
          : prevData.revenueOverTime.map((r, i) => {
              const o = prevData.ordersOverTime[i]?.value || 0;
              return { date: r.date, value: o > 0 ? r.value / o : 0 };
            }));

    return current.map((p, i) => ({
      date: p.date,
      current: p.value,
      previous: previous?.[i]?.value ?? null,
    }));
  }, [data, prevData, chartMetric]);

  const chartFormatter = CHART_METRICS.find((m) => m.id === chartMetric)!.formatter;

  // Top categories (by revenue)
  const topCategories = useMemo(() => {
    if (!data?.revenueByCategory) return [];
    return [...data.revenueByCategory]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
  }, [data]);

  const totalCategoryRevenue = topCategories.reduce((sum, c) => sum + c.revenue, 0);

  // Build derived "highlights" from real data for the right column panel
  const highlights = useMemo(() => {
    const items: { label: string; sub: string; tone: "primary" | "success" | "warning" }[] = [];
    if (data?.revenueByCategory && data.revenueByCategory.length > 0) {
      const top = [...data.revenueByCategory].sort((a, b) => b.revenue - a.revenue)[0];
      items.push({
        label: `${top.category} leads category revenue`,
        sub: `${formatCurrency(top.revenue)} this period`,
        tone: "primary",
      });
    }
    if (data?.kpis.repeatCustomers && data?.kpis.customers) {
      const ratio = (data.kpis.repeatCustomers / data.kpis.customers) * 100;
      items.push({
        label: `${ratio.toFixed(1)}% repeat customer rate`,
        sub: `${formatNumber(data.kpis.repeatCustomers)} of ${formatNumber(data.kpis.customers)} customers came back`,
        tone: ratio >= 30 ? "success" : "warning",
      });
    }
    if (data?.revenueOverTime && data.revenueOverTime.length > 0) {
      const best = [...data.revenueOverTime].sort((a, b) => b.value - a.value)[0];
      items.push({
        label: `Best day: ${format(new Date(best.date), "MMM d")}`,
        sub: `${formatCurrency(best.value)} in revenue`,
        tone: "primary",
      });
    }
    return items;
  }, [data]);

  // AI insight body, derived from real data
  const insight = useMemo(() => {
    if (!data?.revenueByCategory || data.revenueByCategory.length === 0) return null;
    const sorted = [...data.revenueByCategory].sort((a, b) => b.revenue - a.revenue);
    const top = sorted[0];
    const totalRev = sorted.reduce((sum, c) => sum + c.revenue, 0);
    const share = totalRev > 0 ? (top.revenue / totalRev) * 100 : 0;
    return {
      headline: `${top.category} drove ${share.toFixed(0)}% of category revenue.`,
      body: `Consider doubling down on ${top.category.toLowerCase()} promotions and replenishing inventory before the next campaign window.`,
    };
  }, [data]);

  if (isError) {
    return (
      <Alert variant="destructive" data-testid="page-dashboard">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription className="flex items-center justify-between">
          Failed to load dashboard data.
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6" data-testid="page-dashboard">
      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          testId="kpi-revenue"
          icon={DollarSign}
          iconClass="bg-blue-500/15 text-blue-400"
          label="Total revenue"
          value={data ? formatCurrency(data.kpis.revenue) : "—"}
          unit="BRL"
          change={revenueChange}
          changeLabel="vs. previous half"
          sub={[
            { label: "Avg ticket", value: data ? formatCurrency(data.kpis.avgTicket) : "—" },
            { label: "Customers", value: data ? formatNumber(data.kpis.customers) : "—" },
          ]}
          isLoading={isLoading}
        />
        <KpiCard
          testId="kpi-orders"
          icon={Package}
          iconClass="bg-violet-500/15 text-violet-400"
          label="Orders"
          value={data ? formatNumber(data.kpis.orders) : "—"}
          unit={inclusiveDays + "d"}
          change={ordersChange}
          changeLabel="vs. previous half"
          sub={[
            { label: "Leads", value: data ? formatNumber(data.kpis.leads) : "—" },
            { label: "Approved leads", value: data ? formatNumber(data.kpis.approvedLeads) : "—" },
          ]}
          isLoading={isLoading}
        />
        <KpiCard
          testId="kpi-avgTicket"
          icon={Wallet}
          iconClass="bg-emerald-500/15 text-emerald-400"
          label="Avg ticket"
          value={data ? formatCurrency(data.kpis.avgTicket) : "—"}
          unit="BRL"
          change={avgTicketChange}
          changeLabel="vs. previous period"
          sub={[
            { label: "Repeat customers", value: data ? formatNumber(data.kpis.repeatCustomers) : "—" },
            { label: "Approval rate", value: data ? formatPercentage(data.kpis.approvalRate) : "—" },
          ]}
          isLoading={isLoading}
        />
        <KpiCard
          testId="kpi-conversionRate"
          icon={Target}
          iconClass="bg-sky-500/15 text-sky-400"
          label="Conversion rate"
          value={data ? formatPercentage(data.kpis.conversionRate) : "—"}
          change={conversionChange}
          changeLabel="vs. previous period"
          sub={[
            { label: "Leads", value: data ? formatNumber(data.kpis.leads) : "—" },
            { label: "Orders", value: data ? formatNumber(data.kpis.orders) : "—" },
          ]}
          isLoading={isLoading}
        />
      </div>

      {/* Chart + insight */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 p-5 bg-card border-border">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
            <div>
              <h2 className="text-base font-semibold leading-tight">Daily performance</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Last {inclusiveDays} days vs. previous period
              </p>
            </div>
            <div className="inline-flex items-center bg-muted/40 border border-border rounded-md p-0.5">
              {CHART_METRICS.map((metric) => (
                <button
                  key={metric.id}
                  data-testid={`chart-toggle-${metric.id}`}
                  onClick={() => setChartMetric(metric.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                    chartMetric === metric.id
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {metric.label}
                </button>
              ))}
            </div>
          </div>

          <div className="h-[280px]">
            {isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorCurrent" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="hsl(var(--border))"
                  />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(val) => format(new Date(val), "MMM d")}
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    dy={6}
                  />
                  <YAxis
                    tickFormatter={(val) =>
                      chartMetric === "orders"
                        ? formatNumber(val)
                        : `R$${(val / 1000).toFixed(0)}k`
                    }
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    width={55}
                  />
                  <Tooltip
                    formatter={(value: number, name) => [
                      chartFormatter(value),
                      name === "current" ? "Current" : "Previous",
                    ]}
                    labelFormatter={(label) => format(new Date(label), "MMM d, yyyy")}
                    contentStyle={{
                      backgroundColor: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="previous"
                    stroke="hsl(var(--muted-foreground))"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    fill="transparent"
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="current"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    fill="url(#colorCurrent)"
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <CircleDot className="h-3 w-3 text-primary" />
              Current
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 border-t border-dashed border-muted-foreground" />
              Previous
            </span>
          </div>
        </Card>

        {/* AI insight card */}
        <Card className="p-5 bg-gradient-to-br from-card to-card border-border relative overflow-hidden flex flex-col">
          <div className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-primary/10 blur-2xl pointer-events-none" />
          <div className="relative z-10 flex flex-col h-full">
            <div className="flex items-center gap-2 mb-4">
              <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/15 text-primary text-[10px] font-semibold uppercase tracking-wider">
                <Sparkles className="h-3 w-3" />
                UP Insight · AI
              </span>
            </div>
            {isLoading || !insight ? (
              <>
                <Skeleton className="h-6 w-3/4 mb-2" />
                <Skeleton className="h-4 w-full mb-1" />
                <Skeleton className="h-4 w-5/6 mb-4" />
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold leading-snug mb-2">{insight.headline}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{insight.body}</p>
              </>
            )}
            <div className="mt-auto pt-5 flex items-center gap-3">
              <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground">
                View details
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground hover:text-foreground"
              >
                Dismiss
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {/* Top categories + Highlights */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 p-5 bg-card border-border">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold leading-tight">Top categories</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Share of revenue across the catalog
              </p>
            </div>
            <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
              See all <ChevronRight className="h-3 w-3" />
            </button>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : topCategories.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No category data for this period.
            </p>
          ) : (
            <div>
              <div className="grid grid-cols-12 gap-4 px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">
                <div className="col-span-5">Category</div>
                <div className="col-span-3 text-right">Revenue</div>
                <div className="col-span-2 text-right">Orders</div>
                <div className="col-span-2 text-right">Share</div>
              </div>
              <div className="divide-y divide-border">
                {topCategories.map((cat) => {
                  const share =
                    totalCategoryRevenue > 0 ? (cat.revenue / totalCategoryRevenue) * 100 : 0;
                  return (
                    <div
                      key={cat.category}
                      className="grid grid-cols-12 gap-4 items-center px-2 py-3"
                      data-testid={`category-row-${cat.category}`}
                    >
                      <div className="col-span-5 flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/15 text-primary">
                          <Package className="h-4 w-4" />
                        </div>
                        <span className="font-medium text-sm">{cat.category}</span>
                      </div>
                      <div className="col-span-3 text-right tabular-nums text-sm">
                        {formatCurrency(cat.revenue)}
                      </div>
                      <div className="col-span-2 text-right tabular-nums text-sm text-muted-foreground">
                        {formatNumber(cat.orders)}
                      </div>
                      <div className="col-span-2 text-right">
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                          <TrendingUp className="h-3 w-3" />
                          {share.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>

        <Card className="p-5 bg-card border-border">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold leading-tight">Highlights</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Signals from this period</p>
            </div>
            {!isLoading && highlights.length > 0 && (
              <span className="text-[10px] font-semibold uppercase tracking-wider text-primary bg-primary/15 px-2 py-1 rounded-md">
                {highlights.length} new
              </span>
            )}
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : highlights.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No highlights available.
            </p>
          ) : (
            <div className="space-y-3">
              {highlights.map((h, i) => {
                const dotClass =
                  h.tone === "success"
                    ? "bg-emerald-500"
                    : h.tone === "warning"
                      ? "bg-amber-500"
                      : "bg-primary";
                return (
                  <div
                    key={i}
                    className="flex items-start gap-3 px-3 py-3 rounded-md border border-border bg-background/40"
                  >
                    <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${dotClass}`} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-tight">{h.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{h.sub}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
