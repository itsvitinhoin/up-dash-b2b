import { useMemo, useState } from "react";
import { addDays, differenceInDays, format, subDays } from "date-fns";
import { motion } from "framer-motion";
import { Link } from "wouter";
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  Award,
  Building2,
  ChevronRight,
  CircleDollarSign,
  Globe2,
  Minus,
  Package,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import { useGetAdminOverview } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CountUp } from "@/components/count-up";
import { EmptyState } from "@/components/empty-state";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import {
  cardEntry,
  fadeInUp,
  staggerContainer,
  useReducedMotion,
  withReducedMotion,
} from "@/lib/motion";

type SeriesMetric = "revenue" | "orders";

function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}

function DeltaChip({
  change,
  label,
}: {
  change: number | null;
  label: string;
}) {
  if (change === null) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-muted/40 text-muted-foreground">
        <Minus className="h-3 w-3" />
        no prior data
        <span className="text-muted-foreground/70 ml-1">{label}</span>
      </span>
    );
  }
  const isUp = change >= 0;
  return (
    <div>
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${
          isUp ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
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
      <span className="text-xs text-muted-foreground ml-2">{label}</span>
    </div>
  );
}

interface KpiTileProps {
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  label: string;
  value: number;
  format: (value: number) => string;
  unit?: string;
  change: number | null;
  changeLabel: string;
  isLoading: boolean;
  testId: string;
}

function KpiTile({
  icon: Icon,
  iconClass,
  label,
  value,
  format: fmt,
  unit,
  change,
  changeLabel,
  isLoading,
  testId,
}: KpiTileProps) {
  const reduced = useReducedMotion();
  const variants = withReducedMotion(cardEntry, reduced);
  return (
    <motion.div variants={variants}>
      <Card
        data-testid={testId}
        className="flex flex-col p-5 bg-card border-border hover-elevate transition-shadow"
      >
        <div className="flex items-center gap-2.5 mb-3">
          <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${iconClass}`}>
            <Icon className="h-4 w-4" />
          </div>
          <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
        </div>

        <div className="flex items-baseline gap-2 mb-3">
          {isLoading ? (
            <Skeleton className="h-9 w-32" />
          ) : (
            <>
              <span className="text-3xl font-semibold tracking-tight tabular-nums">
                <CountUp value={value} format={fmt} />
              </span>
              {unit && <span className="text-xs text-muted-foreground font-medium">{unit}</span>}
            </>
          )}
        </div>

        {!isLoading && (
          <div className="mt-auto">
            <DeltaChip change={change} label={changeLabel} />
          </div>
        )}
      </Card>
    </motion.div>
  );
}

function GrowthBadge({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <Badge
        variant="secondary"
        className="font-mono text-[11px] gap-1 bg-muted/40 text-muted-foreground"
      >
        <Minus className="h-3 w-3" /> n/a
      </Badge>
    );
  }
  const isUp = value >= 0;
  return (
    <Badge
      variant="secondary"
      className={`font-mono text-[11px] gap-1 ${
        isUp ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
      }`}
    >
      {isUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {isUp ? "+" : ""}
      {value.toFixed(1)}%
    </Badge>
  );
}

interface LeaderboardCardProps {
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  rows: {
    id: string;
    name: string;
    revenue: number;
    growthPct: number | null;
    currency: string;
    locale: string;
  }[];
  emptyTitle: string;
  emptyDescription: string;
  variant: "performance" | "growth-up" | "growth-down";
  onSelect: (id: string) => void;
  testId: string;
}

function LeaderboardCard({
  title,
  subtitle,
  icon: Icon,
  iconClass,
  rows,
  emptyTitle,
  emptyDescription,
  variant,
  onSelect,
  testId,
}: LeaderboardCardProps) {
  return (
    <Card data-testid={testId} className="p-5 bg-card border-border flex flex-col">
      <div className="flex items-center gap-2.5 mb-1">
        <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${iconClass}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <h3 className="text-sm font-semibold leading-tight">{title}</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4 ml-9">{subtitle}</p>
      {rows.length === 0 ? (
        <div className="flex-1 flex items-center justify-center py-6 text-xs text-muted-foreground text-center">
          <div>
            <div className="font-medium text-sm text-foreground/80">{emptyTitle}</div>
            <div className="mt-1">{emptyDescription}</div>
          </div>
        </div>
      ) : (
        <ul className="space-y-1 -mx-2">
          {rows.map((row, i) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => onSelect(row.id)}
                data-testid={`${testId}-row-${i}`}
                className="w-full flex items-center gap-3 px-2 py-2 rounded-md text-left hover-elevate transition-colors"
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-mono font-semibold ${
                    i === 0
                      ? variant === "growth-down"
                        ? "bg-red-500/15 text-red-400"
                        : "bg-emerald-500/15 text-emerald-400"
                      : "bg-muted/50 text-muted-foreground"
                  }`}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{row.name}</div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {formatCurrency(row.revenue, {
                      currency: row.currency,
                      locale: row.locale,
                    })}
                  </div>
                </div>
                {variant === "performance" ? null : (
                  <GrowthBadge value={row.growthPct} />
                )}
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function OverviewPage() {
  const { user, setSelectedClientId } = useAuth();
  const { dateRange } = useDashboardFilters();
  const reduced = useReducedMotion();
  const [seriesMetric, setSeriesMetric] = useState<SeriesMetric>("revenue");

  const enabled = user?.role === "ADMIN";

  const { data, isLoading, isError, refetch } = useGetAdminOverview(
    {
      dateFrom: format(dateRange.from, "yyyy-MM-dd"),
      dateTo: format(dateRange.to, "yyyy-MM-dd"),
    },
    { query: queryOpts({ enabled }) },
  );

  const inclusiveDays = Math.max(1, differenceInDays(dateRange.to, dateRange.from) + 1);
  const prevPeriodTo = useMemo(() => subDays(dateRange.from, 1), [dateRange.from]);
  const prevPeriodFrom = useMemo(
    () => addDays(prevPeriodTo, -(inclusiveDays - 1)),
    [prevPeriodTo, inclusiveDays],
  );

  const chartData = useMemo(() => {
    if (!data) return [];
    const current =
      seriesMetric === "revenue" ? data.revenueOverTime : data.ordersOverTime;
    const previous =
      seriesMetric === "revenue"
        ? data.prevRevenueOverTime
        : data.prevOrdersOverTime;
    return current.map((p, i) => ({
      date: p.date,
      current: p.value,
      previous: previous[i]?.value ?? null,
    }));
  }, [data, seriesMetric]);

  const containerVariants = withReducedMotion(staggerContainer, reduced);
  const fadeVariants = withReducedMotion(fadeInUp, reduced);

  const handleSelectClient = (id: string) => {
    setSelectedClientId(id);
  };

  if (user?.role !== "ADMIN") {
    return (
      <Alert variant="destructive" data-testid="page-overview">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Restricted</AlertTitle>
        <AlertDescription>
          The platform overview is available to platform administrators only.
        </AlertDescription>
      </Alert>
    );
  }

  if (isError) {
    return (
      <Alert variant="destructive" data-testid="page-overview">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription className="flex items-center justify-between">
          Failed to load the platform overview.
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const kpis = data?.kpis;
  const prev = data?.prevKpis;
  const revenueDelta = kpis && prev ? deltaPct(kpis.revenue, prev.revenue) : null;
  const ordersDelta = kpis && prev ? deltaPct(kpis.orders, prev.orders) : null;
  const customersDelta = kpis && prev ? deltaPct(kpis.customers, prev.customers) : null;
  const aovDelta =
    kpis && prev ? deltaPct(kpis.avgOrderValue, prev.avgOrderValue) : null;
  const activeDelta =
    kpis && prev ? deltaPct(kpis.activeClients, prev.activeClients) : null;

  const seriesEmpty =
    data !== undefined && chartData.every((p) => (p.current ?? 0) === 0);

  return (
    <div className="space-y-6" data-testid="page-overview">
      <motion.div
        initial="hidden"
        animate="visible"
        variants={fadeVariants}
        className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"
      >
        <div className="flex items-center gap-2">
          <Globe2 className="h-3.5 w-3.5 text-primary" />
          <span className="font-mono uppercase tracking-wider">
            Platform · {format(dateRange.from, "MMM d")} →{" "}
            {format(dateRange.to, "MMM d, yyyy")}
            <span className="ml-2 text-muted-foreground/70">
              vs. {format(prevPeriodFrom, "MMM d")} →{" "}
              {format(prevPeriodTo, "MMM d")}
            </span>
          </span>
        </div>
        {data && (
          <span className="text-muted-foreground/80">
            {data.kpis.activeClients} of {data.kpis.totalClients} brands generated
            revenue in this window.
          </span>
        )}
      </motion.div>

      <motion.div
        initial="hidden"
        animate="visible"
        variants={containerVariants}
        className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4"
      >
        <KpiTile
          testId="overview-kpi-revenue"
          icon={CircleDollarSign}
          iconClass="bg-blue-500/15 text-blue-400"
          label="Platform revenue"
          value={kpis?.revenue ?? 0}
          format={(v) => formatCurrency(v)}
          change={revenueDelta}
          changeLabel="vs. previous period"
          isLoading={isLoading}
        />
        <KpiTile
          testId="overview-kpi-orders"
          icon={Package}
          iconClass="bg-violet-500/15 text-violet-400"
          label="Platform orders"
          value={kpis?.orders ?? 0}
          format={(v) => formatNumber(v)}
          change={ordersDelta}
          changeLabel="vs. previous period"
          isLoading={isLoading}
        />
        <KpiTile
          testId="overview-kpi-customers"
          icon={Users}
          iconClass="bg-emerald-500/15 text-emerald-400"
          label="Active customers"
          value={kpis?.customers ?? 0}
          format={(v) => formatNumber(v)}
          change={customersDelta}
          changeLabel="vs. previous period"
          isLoading={isLoading}
        />
        <KpiTile
          testId="overview-kpi-active-brands"
          icon={Building2}
          iconClass="bg-sky-500/15 text-sky-400"
          label="Active brands"
          value={kpis?.activeClients ?? 0}
          format={(v) => formatNumber(v)}
          unit={kpis ? `of ${kpis.totalClients}` : undefined}
          change={activeDelta}
          changeLabel="vs. previous period"
          isLoading={isLoading}
        />
        <KpiTile
          testId="overview-kpi-aov"
          icon={Award}
          iconClass="bg-amber-500/15 text-amber-400"
          label="Platform AOV"
          value={kpis?.avgOrderValue ?? 0}
          format={(v) => formatCurrency(v)}
          change={aovDelta}
          changeLabel="vs. previous period"
          isLoading={isLoading}
        />
      </motion.div>

      <Card className="p-5 bg-card border-border">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base font-semibold leading-tight">
              Platform-wide trend
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Daily totals summed across every brand. Dashed line shows the prior
              period.
            </p>
          </div>
          <div
            className="inline-flex rounded-md border border-border bg-card overflow-hidden"
            role="tablist"
            aria-label="Series metric"
          >
            {(["revenue", "orders"] as SeriesMetric[]).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={seriesMetric === m}
                onClick={() => setSeriesMetric(m)}
                data-testid={`overview-series-${m}`}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  seriesMetric === m
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent/40"
                }`}
              >
                {m === "revenue" ? "Revenue" : "Orders"}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <Skeleton className="h-72 w-full" />
        ) : seriesEmpty ? (
          <EmptyState
            icon={Globe2}
            title="No platform activity yet"
            description="No brands had revenue-bearing orders in this window. Try a wider date range."
          />
        ) : (
          <div className="h-72 w-full" data-testid="overview-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="overviewCurrent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v) => format(new Date(v), "MMM d")}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  className="text-xs"
                />
                <YAxis
                  tickFormatter={(v: number) =>
                    seriesMetric === "revenue"
                      ? new Intl.NumberFormat(undefined, {
                          notation: "compact",
                          maximumFractionDigits: 1,
                        }).format(v)
                      : formatNumber(v)
                  }
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  className="text-xs"
                />
                <Tooltip
                  cursor={{ stroke: "hsl(var(--border))", strokeWidth: 1 }}
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(value: number, name) => {
                    const formatted =
                      seriesMetric === "revenue"
                        ? formatCurrency(value)
                        : formatNumber(value);
                    return [
                      formatted,
                      name === "current" ? "This period" : "Previous period",
                    ];
                  }}
                  labelFormatter={(v) => format(new Date(v), "MMM d, yyyy")}
                />
                <Area
                  type="monotone"
                  dataKey="previous"
                  stroke="hsl(var(--muted-foreground))"
                  strokeOpacity={0.55}
                  strokeDasharray="4 4"
                  fill="transparent"
                  dot={false}
                  isAnimationActive={!reduced}
                />
                <Area
                  type="monotone"
                  dataKey="current"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  fill="url(#overviewCurrent)"
                  dot={false}
                  isAnimationActive={!reduced}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <LeaderboardCard
          testId="overview-top-performers"
          title="Top performers"
          subtitle="Highest revenue this period"
          icon={Award}
          iconClass="bg-amber-500/15 text-amber-400"
          rows={data?.topPerformers ?? []}
          emptyTitle="No revenue yet"
          emptyDescription="No brands generated revenue in this window."
          variant="performance"
          onSelect={handleSelectClient}
        />
        <LeaderboardCard
          testId="overview-top-growth"
          title="Top growth"
          subtitle="Biggest gainers vs. previous period"
          icon={TrendingUp}
          iconClass="bg-emerald-500/15 text-emerald-400"
          rows={data?.topGrowth ?? []}
          emptyTitle="No growth signals"
          emptyDescription="Need at least one brand with prior-period revenue to compute growth."
          variant="growth-up"
          onSelect={handleSelectClient}
        />
        <LeaderboardCard
          testId="overview-bottom-growth"
          title="Needs attention"
          subtitle="Biggest declines vs. previous period"
          icon={TrendingDown}
          iconClass="bg-red-500/15 text-red-400"
          rows={data?.bottomGrowth ?? []}
          emptyTitle="No declines"
          emptyDescription="Every brand with prior-period data is holding steady or growing."
          variant="growth-down"
          onSelect={handleSelectClient}
        />
      </div>

      <Card className="p-5 bg-card border-border">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold leading-tight">All brands</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Per-brand revenue, orders and growth for the active window. Open the
              full management table for AOV and conversion details.
            </p>
          </div>
          <Link href="/clients">
            <Button variant="outline" size="sm" data-testid="overview-go-clients">
              Manage brands
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </Link>
        </div>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : data && data.clientStats.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No brands yet"
            description="Create a brand from the Clients page to start seeing platform numbers here."
          />
        ) : (
          <div className="overflow-x-auto" data-testid="overview-clients-table">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground/80 border-b border-border">
                  <th className="py-2 pr-4 font-medium">Brand</th>
                  <th className="py-2 px-4 font-medium text-right">Revenue</th>
                  <th className="py-2 px-4 font-medium text-right">Orders</th>
                  <th className="py-2 pl-4 font-medium text-right">vs. prev.</th>
                </tr>
              </thead>
              <tbody>
                {[...(data?.clientStats ?? [])]
                  .sort((a, b) => b.revenue - a.revenue)
                  .map((c) => (
                    <tr
                      key={c.id}
                      className="border-b border-border/60 last:border-0 hover-elevate"
                    >
                      <td className="py-2 pr-4">
                        <button
                          type="button"
                          onClick={() => handleSelectClient(c.id)}
                          data-testid={`overview-client-${c.id}`}
                          className="font-medium hover:text-primary text-left"
                        >
                          {c.name}
                        </button>
                      </td>
                      <td className="py-2 px-4 text-right tabular-nums">
                        {formatCurrency(c.revenue, {
                          currency: c.currency,
                          locale: c.locale,
                        })}
                      </td>
                      <td className="py-2 px-4 text-right tabular-nums">
                        {formatNumber(c.orders)}
                      </td>
                      <td className="py-2 pl-4 text-right">
                        <GrowthBadge value={c.growthPct} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
