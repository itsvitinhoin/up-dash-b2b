import { useMemo, useState } from "react";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import { useGetMarketing } from "@workspace/api-client-react";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Download,
  Megaphone,
  MoreHorizontal,
  RefreshCw,
  Sparkles,
  Target,
  TrendingUp,
  Wallet,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { formatCurrency, formatNumber, formatPercentage } from "@/lib/formatters";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  LabelList,
} from "recharts";
import { CountUp } from "@/components/count-up";
import { Sparkline } from "@/components/sparkline";
import { EmptyState } from "@/components/empty-state";
import { exportRowsAsCsv } from "@/lib/csv-export";
import {
  cardEntry,
  fadeInUp,
  staggerContainer,
  useReducedMotion,
  withReducedMotion,
} from "@/lib/motion";

// ── Types from API response ──────────────────────────────────────────────────
interface MarketingKpis {
  totalSpend: number;
  attributedRevenue: number;
  roas: number;
  totalLeads: number;
  approvedLeads: number;
  approvalRate: number;
  cpl: number;
  cpa: number;
}

interface CreativeRow {
  id: string;
  name: string;
  platform: string;
  status: string;
  imageUrl: string | null;
  clicks: number;
  impressions: number;
  ctr: number;
  leads: number;
  approvedLeads: number;
  spend: number;
  attributedRevenue: number;
  roas: number;
  cpl: number;
  cpa: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function computeChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}

const PLATFORM_COLORS: Record<string, string> = {
  META: "#1877F2",
  GOOGLE: "#EA4335",
  TIKTOK: "#25F4EE",
};

const PLATFORM_LABELS: Record<string, string> = {
  META: "Meta (Facebook / Instagram)",
  GOOGLE: "Google Ads",
  TIKTOK: "TikTok Ads",
};

const CHART_TABS = [
  { id: "leads", label: "Paid Leads", color: "#a78bfa", formatter: (v: number) => formatNumber(v) },
  { id: "revenue", label: "Attr. Revenue", color: "#34d399", formatter: (v: number) => formatCurrency(v) },
] as const;

type ChartTab = (typeof CHART_TABS)[number]["id"];

type SortKey = keyof Pick<CreativeRow, "spend" | "leads" | "approvedLeads" | "roas" | "cpl" | "cpa" | "ctr" | "clicks" | "impressions">;
type SortDir = "asc" | "desc";

// ── KPI card ─────────────────────────────────────────────────────────────────
interface KpiCardProps {
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  label: string;
  value: number;
  format: (v: number) => string;
  unit?: string;
  change: number | null;
  sparkValues: number[];
  sparkColor: string;
  isLoading: boolean;
  testId: string;
  tooltip?: string;
}

function MktKpiCard({
  icon: Icon,
  iconClass,
  label,
  value,
  format: fmt,
  unit,
  change,
  sparkValues,
  sparkColor,
  isLoading,
  testId,
}: KpiCardProps) {
  const reduced = useReducedMotion();
  const variants = withReducedMotion(cardEntry, reduced);
  const isUp = change !== null && change >= 0;
  return (
    <motion.div variants={variants}>
      <Card data-testid={testId} className="flex flex-col p-5 bg-card border-border hover-elevate transition-shadow">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${iconClass}`}>
              <Icon className="h-4 w-4" />
            </div>
            <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              {label}
            </span>
          </div>
          <button className="text-muted-foreground hover:text-foreground" aria-label="More options">
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-end justify-between gap-3 mb-3">
          <div className="flex items-baseline gap-1.5">
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
          {!isLoading && sparkValues.length > 1 && (
            <Sparkline values={sparkValues} stroke={sparkColor} fill={sparkColor + "22"} width={88} height={28} ariaLabel={`${label} sparkline`} />
          )}
        </div>

        {!isLoading && change !== null && (
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium w-fit ${
              isUp ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
            }`}
          >
            {isUp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {isUp ? "+" : ""}{change.toFixed(1)}%
            <span className="ml-1 text-muted-foreground font-normal">vs prev</span>
          </span>
        )}
      </Card>
    </motion.div>
  );
}

// ── Platform bar ─────────────────────────────────────────────────────────────
function PlatformRow({ platform, spend, roas, leads, clicks, maxSpend }: {
  platform: string;
  spend: number;
  roas: number;
  leads: number;
  clicks: number;
  maxSpend: number;
}) {
  const pct = maxSpend > 0 ? (spend / maxSpend) * 100 : 0;
  const color = PLATFORM_COLORS[platform] ?? "#6366f1";
  const label = PLATFORM_LABELS[platform] ?? platform;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
          <span className="font-medium">{label}</span>
        </div>
        <div className="flex items-center gap-4 text-muted-foreground text-xs tabular-nums">
          <span>{formatCurrency(spend)}</span>
          <span className="w-14 text-right">ROAS {roas.toFixed(2)}×</span>
          <span className="w-16 text-right">{formatNumber(leads)} leads</span>
          <span className="w-18 text-right">{formatNumber(clicks)} clicks</span>
        </div>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  );
}

// ── Sort icon ────────────────────────────────────────────────────────────────
function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
  return sortDir === "desc" ? <ArrowDown className="h-3 w-3 text-primary" /> : <ArrowUp className="h-3 w-3 text-primary" />;
}

// ── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const isActive = status === "ACTIVE";
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium font-mono uppercase tracking-wide ${
        isActive ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isActive ? "bg-emerald-500" : "bg-amber-500"}`} />
      {status.toLowerCase()}
    </span>
  );
}

// ── Platform chip ─────────────────────────────────────────────────────────────
function PlatformChip({ platform }: { platform: string }) {
  const color = PLATFORM_COLORS[platform] ?? "#6366f1";
  const short = platform === "GOOGLE" ? "G" : platform === "TIKTOK" ? "TT" : "META";
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold font-mono"
      style={{ color, backgroundColor: color + "20" }}
    >
      {short}
    </span>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function MarketingPage() {
  const { selectedClientId, user } = useAuth();
  const { dateRange } = useDashboardFilters();
  const reduced = useReducedMotion();

  const clientId = user?.role === "ADMIN" ? selectedClientId || undefined : undefined;
  const enabled = user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId);

  const [chartTab, setChartTab] = useState<ChartTab>("leads");
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { data, isLoading, isError, refetch } = useGetMarketing(
    {
      clientId,
      dateFrom: format(dateRange.from, "yyyy-MM-dd"),
      dateTo: format(dateRange.to, "yyyy-MM-dd"),
    },
    { query: queryOpts({ enabled }) },
  );

  // Derived KPI changes
  const spendChange = useMemo(
    () => data ? computeChange(data.kpis.totalSpend, data.prevKpis.totalSpend) : null,
    [data],
  );
  const roasChange = useMemo(
    () => data ? computeChange(data.kpis.roas, data.prevKpis.roas) : null,
    [data],
  );
  const cplChange = useMemo(
    () => data ? computeChange(data.kpis.cpl, data.prevKpis.cpl) : null,
    [data],
  );
  const cpaChange = useMemo(
    () => data ? computeChange(data.kpis.cpa, data.prevKpis.cpa) : null,
    [data],
  );

  // Chart data
  const chartConfig = CHART_TABS.find((t) => t.id === chartTab)!;
  const chartData = useMemo(() => {
    if (!data) return [];
    const series = chartTab === "leads" ? data.leadsOverTime : data.revenueOverTime;
    return series.map((p) => ({ date: p.date, value: p.value }));
  }, [data, chartTab]);

  // Sparklines for KPI cards (use chart data as proxy)
  const sparkLeads = data?.leadsOverTime.map((p) => p.value) ?? [];
  const sparkRevenue = data?.revenueOverTime.map((p) => p.value) ?? [];

  // Platform breakdown sorted by spend desc
  const platformRows = useMemo(
    () => [...(data?.platformBreakdown ?? [])].sort((a, b) => b.spend - a.spend),
    [data],
  );
  const maxPlatformSpend = platformRows[0]?.spend ?? 0;

  // Sorted creatives
  const sortedCreatives = useMemo(() => {
    if (!data?.creatives) return [];
    return [...data.creatives].sort((a, b) => {
      const va = a[sortKey as keyof typeof a] as number;
      const vb = b[sortKey as keyof typeof b] as number;
      return sortDir === "desc" ? vb - va : va - vb;
    });
  }, [data?.creatives, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  function handleExport() {
    if (!data?.creatives) return;
    exportRowsAsCsv(
      `marketing-creatives-${format(dateRange.from, "yyyyMMdd")}-${format(dateRange.to, "yyyyMMdd")}.csv`,
      sortedCreatives,
      [
        { header: "Name", accessor: (r) => r.name },
        { header: "Platform", accessor: (r) => r.platform },
        { header: "Status", accessor: (r) => r.status },
        { header: "Spend", accessor: (r) => r.spend },
        { header: "Leads", accessor: (r) => r.leads },
        { header: "Approved Leads", accessor: (r) => r.approvedLeads },
        { header: "CPL", accessor: (r) => r.cpl.toFixed(2) },
        { header: "CPA", accessor: (r) => r.cpa.toFixed(2) },
        { header: "Attributed Revenue", accessor: (r) => r.attributedRevenue.toFixed(2) },
        { header: "ROAS", accessor: (r) => r.roas.toFixed(2) },
        { header: "Clicks", accessor: (r) => r.clicks },
        { header: "Impressions", accessor: (r) => r.impressions },
        { header: "CTR %", accessor: (r) => r.ctr.toFixed(2) },
      ],
    );
  }

  const containerVariants = withReducedMotion(staggerContainer, reduced);
  const fadeVariants = withReducedMotion(fadeInUp, reduced);

  if (isError) {
    return (
      <Alert variant="destructive" data-testid="page-marketing">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription className="flex items-center justify-between">
          Failed to load marketing data.
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6" data-testid="page-marketing">
      {/* Toolbar */}
      <motion.div
        initial="hidden"
        animate="visible"
        variants={fadeVariants}
        className="flex flex-wrap items-center justify-between gap-2"
      >
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="relative flex h-1.5 w-1.5">
            {!reduced && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-500/60" />
            )}
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-violet-500" />
          </span>
          <span className="font-mono uppercase tracking-wider">
            Paid channels · {format(dateRange.from, "MMM d")} → {format(dateRange.to, "MMM d, yyyy")}
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={!data} data-testid="marketing-export-csv">
          <Download className="h-4 w-4 mr-1.5" />
          Export CSV
        </Button>
      </motion.div>

      {/* KPI grid */}
      <motion.div
        initial="hidden"
        animate="visible"
        variants={containerVariants}
        className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4"
      >
        <MktKpiCard
          testId="kpi-ad-spend"
          icon={Wallet}
          iconClass="bg-violet-500/15 text-violet-400"
          label="Ad Spend (all-time)"
          value={data?.kpis.totalSpend ?? 0}
          format={(v) => formatCurrency(v)}
          unit="BRL"
          change={spendChange}
          sparkValues={sparkRevenue}
          sparkColor="#a78bfa"
          isLoading={isLoading}
        />
        <MktKpiCard
          testId="kpi-roas"
          icon={TrendingUp}
          iconClass="bg-emerald-500/15 text-emerald-400"
          label="ROAS"
          value={data?.kpis.roas ?? 0}
          format={(v) => `${v.toFixed(2)}×`}
          change={roasChange}
          sparkValues={sparkRevenue}
          sparkColor="#34d399"
          isLoading={isLoading}
        />
        <MktKpiCard
          testId="kpi-cpl"
          icon={Target}
          iconClass="bg-sky-500/15 text-sky-400"
          label="CPL (cost / lead)"
          value={data?.kpis.cpl ?? 0}
          format={(v) => formatCurrency(v)}
          unit="BRL"
          change={cplChange !== null ? -cplChange : null}
          sparkValues={sparkLeads}
          sparkColor="#38bdf8"
          isLoading={isLoading}
        />
        <MktKpiCard
          testId="kpi-cpa"
          icon={Sparkles}
          iconClass="bg-amber-500/15 text-amber-400"
          label="CPA (cost / aprov.)"
          value={data?.kpis.cpa ?? 0}
          format={(v) => formatCurrency(v)}
          unit="BRL"
          change={cpaChange !== null ? -cpaChange : null}
          sparkValues={sparkLeads}
          sparkColor="#fbbf24"
          isLoading={isLoading}
        />
      </motion.div>

      {/* Summary row: approval rate + leads + revenue */}
      <motion.div
        initial="hidden"
        animate="visible"
        variants={fadeVariants}
        className="grid grid-cols-2 sm:grid-cols-4 gap-3"
      >
        {[
          { label: "Paid Leads (period)", value: data?.kpis.totalLeads ?? 0, format: formatNumber, color: "text-violet-400" },
          { label: "Approved Leads", value: data?.kpis.approvedLeads ?? 0, format: formatNumber, color: "text-emerald-400" },
          { label: "Approval Rate", value: data?.kpis.approvalRate ?? 0, format: formatPercentage, color: "text-sky-400" },
          { label: "Attributed Revenue", value: data?.kpis.attributedRevenue ?? 0, format: formatCurrency, color: "text-amber-400" },
        ].map(({ label, value, format: fmt, color }) => (
          <Card key={label} className="p-4 bg-card/60 border-border">
            <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
            {isLoading ? (
              <Skeleton className="h-7 w-24" />
            ) : (
              <p className={`text-xl font-semibold tabular-nums ${color}`}>
                <CountUp value={value} format={fmt} />
              </p>
            )}
          </Card>
        ))}
      </motion.div>

      {/* Chart + platform breakdown */}
      <motion.div
        initial="hidden"
        animate="visible"
        variants={fadeVariants}
        className="grid grid-cols-1 xl:grid-cols-3 gap-4"
      >
        {/* Time-series chart */}
        <Card className="xl:col-span-2 p-5 bg-card border-border">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              Performance Over Time
            </h2>
            <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5">
              {CHART_TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setChartTab(tab.id)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    chartTab === tab.id
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {isLoading ? (
            <Skeleton className="h-52 w-full" />
          ) : chartData.length === 0 ? (
            <EmptyState
              icon={BarChart3}
              title="No data for this period"
              description="No paid-channel activity was recorded in the selected date range."
              className="h-52"
            />
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={chartTab}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="mktGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={chartConfig.color} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={chartConfig.color} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(d: string) => {
                        try { return format(new Date(d + "T12:00:00"), "MMM d"); } catch { return d; }
                      }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v: number) => chartConfig.formatter(v)}
                      width={58}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                        fontSize: 12,
                      }}
                      formatter={(v: number) => [chartConfig.formatter(v), chartConfig.label]}
                      labelFormatter={(label: string) => {
                        try { return format(new Date(label + "T12:00:00"), "MMM d, yyyy"); } catch { return label; }
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke={chartConfig.color}
                      strokeWidth={2}
                      fill="url(#mktGrad)"
                      dot={false}
                      activeDot={{ r: 4, fill: chartConfig.color, strokeWidth: 0 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </motion.div>
            </AnimatePresence>
          )}
        </Card>

        {/* Platform breakdown */}
        <Card className="p-5 bg-card border-border">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-5">
            <Megaphone className="h-4 w-4 text-muted-foreground" />
            By Platform
          </h2>
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : platformRows.length === 0 ? (
            <EmptyState icon={Megaphone} title="No creatives" description="No active creatives found for this brand." />
          ) : (
            <div className="space-y-5">
              {platformRows.map((row) => (
                <PlatformRow
                  key={row.platform}
                  platform={row.platform}
                  spend={row.spend}
                  roas={row.roas}
                  leads={row.leads}
                  clicks={row.clicks}
                  maxSpend={maxPlatformSpend}
                />
              ))}
            </div>
          )}
        </Card>
      </motion.div>

      {/* Creatives table */}
      <motion.div initial="hidden" animate="visible" variants={fadeVariants}>
        <Card className="bg-card border-border overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Creative Performance</h2>
            <p className="text-xs text-muted-foreground">
              {sortedCreatives.length} creatives · click headers to sort
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-5 py-3 text-[11px] font-mono uppercase tracking-wider text-muted-foreground w-64">
                    Creative
                  </th>
                  {(
                    [
                      { key: "spend" as SortKey, label: "Spend" },
                      { key: "leads" as SortKey, label: "Leads" },
                      { key: "approvedLeads" as SortKey, label: "Aprov." },
                      { key: "cpl" as SortKey, label: "CPL" },
                      { key: "cpa" as SortKey, label: "CPA" },
                      { key: "roas" as SortKey, label: "ROAS" },
                      { key: "clicks" as SortKey, label: "Clicks" },
                      { key: "ctr" as SortKey, label: "CTR %" },
                    ] as { key: SortKey; label: string }[]
                  ).map(({ key, label }) => (
                    <th
                      key={key}
                      className="px-4 py-3 text-right cursor-pointer select-none"
                      onClick={() => handleSort(key)}
                    >
                      <span className="flex items-center justify-end gap-1 text-[11px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors">
                        {label}
                        <SortIcon col={key} sortKey={sortKey} sortDir={sortDir} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="px-5 py-3"><Skeleton className="h-4 w-48" /></td>
                      {Array.from({ length: 8 }).map((_, j) => (
                        <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-14 ml-auto" /></td>
                      ))}
                    </tr>
                  ))
                ) : sortedCreatives.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-5 py-10 text-center text-muted-foreground text-sm">
                      No creatives found for this brand.
                    </td>
                  </tr>
                ) : (
                  sortedCreatives.map((creative, idx) => (
                    <tr
                      key={creative.id}
                      className={`border-b border-border/50 hover:bg-accent/20 transition-colors ${
                        idx % 2 === 0 ? "" : "bg-muted/10"
                      }`}
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="flex flex-col gap-1 min-w-0">
                            <span className="font-medium text-sm truncate max-w-[220px]" title={creative.name}>
                              {creative.name}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <PlatformChip platform={creative.platform} />
                              <StatusBadge status={creative.status} />
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">
                        {formatCurrency(creative.spend)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {formatNumber(creative.leads)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-emerald-400">
                        {formatNumber(creative.approvedLeads)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {formatCurrency(creative.cpl)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {formatCurrency(creative.cpa)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span
                          className={`font-semibold ${
                            creative.roas >= 3
                              ? "text-emerald-400"
                              : creative.roas >= 1.5
                                ? "text-amber-400"
                                : "text-red-400"
                          }`}
                        >
                          {creative.roas.toFixed(2)}×
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {formatNumber(creative.clicks)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {formatPercentage(creative.ctr)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}
