import { useMemo, useState } from "react";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetUtm,
  useGetInsight,
  useRegenerateInsight,
  getGetInsightQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import { CountUp } from "@/components/count-up";
import { cardEntry, staggerContainer, useReducedMotion, withReducedMotion } from "@/lib/motion";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Download,
  Globe,
  Link2,
  Sparkles,
  RefreshCw,
  TrendingUp,
  Users,
  UserCheck,
  BarChart2,
  X as XIcon,
  ArrowUpDown,
} from "lucide-react";
import { exportRowsAsCsv } from "@/lib/csv-export";

type GroupBy = "source" | "campaign";
type SortKey = "registrations" | "approvals" | "approvalPct" | "buyers" | "revenue" | "conversionPct" | "roas";
type SortDir = "asc" | "desc";

const SOURCE_PALETTE = [
  "#6366f1", "#22d3ee", "#f59e0b", "#10b981",
  "#f43f5e", "#8b5cf6", "#ec4899", "#14b8a6",
];

function KpiCard({
  label,
  value,
  icon: Icon,
  loading,
  accent,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  loading: boolean;
  accent?: string;
}) {
  return (
    <div className="flex items-start gap-3 p-4 bg-card border border-border rounded-xl">
      <div className={`p-2 rounded-lg mt-0.5 ${accent ?? "bg-primary/10"}`}>
        <Icon className={`h-4 w-4 ${accent ? "text-foreground" : "text-primary"}`} />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground truncate">{label}</p>
        {loading ? (
          <Skeleton className="h-6 w-20 mt-1" />
        ) : (
          <p className="text-xl font-bold tabular-nums leading-tight">{value}</p>
        )}
      </div>
    </div>
  );
}

function SortableHeader({
  label,
  sortKey,
  currentKey,
  dir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
}) {
  const active = sortKey === currentKey;
  return (
    <button
      type="button"
      className={`flex items-center gap-1 text-left font-medium hover:text-foreground transition-colors ${active ? "text-foreground" : "text-muted-foreground"}`}
      onClick={() => onSort(sortKey)}
    >
      {label}
      <ArrowUpDown className={`h-3 w-3 ${active ? "text-primary" : "opacity-40"}`} />
      {active && (
        <span className="text-[9px] font-mono opacity-60">{dir === "asc" ? "↑" : "↓"}</span>
      )}
    </button>
  );
}

type UtmRowType = {
  key: string;
  medium?: string | null;
  registrations: number;
  approvals: number;
  approvalPct: number;
  buyers: number;
  revenue: number;
  conversionPct: number;
  roas?: number | null;
  subRows: {
    key: string;
    registrations: number;
    approvals: number;
    approvalPct: number;
    buyers: number;
    revenue: number;
    conversionPct: number;
    roas?: number | null;
  }[];
};

export default function UtmPage() {
  const { selectedClientId, user } = useAuth();
  const { dateRange, filters } = useDashboardFilters();
  const queryClient = useQueryClient();
  const reduced = useReducedMotion();
  const containerVariants = withReducedMotion(staggerContainer, reduced);
  const cardVariants = withReducedMotion(cardEntry, reduced);

  const [groupBy, setGroupBy] = useState<GroupBy>("source");
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [insightDismissed, setInsightDismissed] = useState(false);

  const clientId = user?.role === "ADMIN" ? selectedClientId || undefined : undefined;
  const enabled = user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId);

  const dateFrom = format(dateRange.from, "yyyy-MM-dd");
  const dateTo = format(dateRange.to, "yyyy-MM-dd");

  const utmParams = {
    clientId,
    dateFrom: format(dateRange.from, "yyyy-MM-dd"),
    dateTo: format(dateRange.to, "yyyy-MM-dd"),
    groupBy,
    utmSource: filters.utmSource || undefined,
    utmMedium: filters.utmMedium || undefined,
    utmCampaign: filters.utmCampaign || undefined,
  };

  const { data, isLoading, isError, refetch } = useGetUtm(utmParams, {
    query: queryOpts({ enabled, placeholderData: (prev) => prev }),
  });

  const insightParams = { clientId, dateFrom, dateTo, screen: "utm" as const };
  const { data: insight, isLoading: insightLoading } = useGetInsight(insightParams, {
    query: queryOpts({ enabled }),
  });
  const regenerate = useRegenerateInsight({
    mutation: {
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: getGetInsightQueryKey(insightParams) }),
    },
  });

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const toggleRow = (key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const sortedRows = useMemo(() => {
    if (!data?.rows) return [];
    return [...data.rows].sort((a, b) => {
      const aVal = a[sortKey] ?? 0;
      const bVal = b[sortKey] ?? 0;
      const mult = sortDir === "asc" ? 1 : -1;
      return (Number(aVal) - Number(bVal)) * mult;
    });
  }, [data?.rows, sortKey, sortDir]);

  const barDataRevenue = useMemo(
    () =>
      (data?.rows ?? [])
        .filter((r) => r.revenue > 0)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10)
        .map((r) => ({ name: r.key, value: r.revenue })),
    [data],
  );

  const barDataConv = useMemo(
    () =>
      (data?.rows ?? [])
        .filter((r) => r.registrations > 0)
        .sort((a, b) => b.conversionPct - a.conversionPct)
        .slice(0, 10)
        .map((r) => ({ name: r.key, value: parseFloat(r.conversionPct.toFixed(1)) })),
    [data],
  );

  const kpis = data?.kpis;
  const totalRows = data?.rows.length ?? 0;

  const handleExport = () => {
    if (!data?.rows) return;
    exportRowsAsCsv(
      `utm-${groupBy}-${new Date().toISOString().slice(0, 10)}.csv`,
      data.rows,
      [
        { header: "key", accessor: (r: UtmRowType) => r.key },
        { header: "registrations", accessor: (r: UtmRowType) => r.registrations },
        { header: "approvals", accessor: (r: UtmRowType) => r.approvals },
        { header: "approvalPct", accessor: (r: UtmRowType) => r.approvalPct.toFixed(1) },
        { header: "buyers", accessor: (r: UtmRowType) => r.buyers },
        { header: "revenue", accessor: (r: UtmRowType) => r.revenue },
        { header: "conversionPct", accessor: (r: UtmRowType) => r.conversionPct.toFixed(1) },
        { header: "roas", accessor: (r: UtmRowType) => r.roas != null ? r.roas.toFixed(2) : "" },
      ],
    );
  };

  return (
    <motion.div
      className="space-y-6"
      data-testid="page-utm"
      initial="hidden"
      animate="visible"
      variants={containerVariants}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          className="flex items-center gap-2 text-xs text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <span className="relative flex h-1.5 w-1.5" aria-hidden>
            {!reduced && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/60" />
            )}
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          <span className="font-mono uppercase tracking-wider">
            Live ·{" "}
            <span className="text-foreground font-semibold tabular-nums">
              <CountUp value={totalRows} format={(v) => formatNumber(Math.round(v))} />
            </span>{" "}
            {groupBy === "source" ? "Sources" : "Campaigns"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Tab switcher */}
          <div className="flex gap-1 bg-muted/60 p-1 rounded-lg">
            {(["source", "campaign"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setGroupBy(mode)}
                data-testid={`utm-tab-${mode}`}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  groupBy === mode
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {mode === "source" ? (
                  <Globe className="h-3.5 w-3.5" />
                ) : (
                  <Link2 className="h-3.5 w-3.5" />
                )}
                By {mode === "source" ? "Source" : "Campaign"}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={!data?.rows?.length}
            data-testid="utm-export"
          >
            <Download className="h-4 w-4 mr-1.5" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* KPI Strip */}
      <motion.div variants={cardVariants}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard
            label="Registrations"
            value={kpis ? formatNumber(kpis.totalRegistrations) : "—"}
            icon={Users}
            loading={isLoading}
          />
          <KpiCard
            label="Approvals"
            value={kpis ? formatNumber(kpis.totalApprovals) : "—"}
            icon={UserCheck}
            loading={isLoading}
          />
          <KpiCard
            label="Approval %"
            value={kpis ? `${kpis.approvalPct.toFixed(1)}%` : "—"}
            icon={TrendingUp}
            loading={isLoading}
            accent="bg-emerald-500/10"
          />
          <KpiCard
            label="Buyers"
            value={kpis ? formatNumber(kpis.totalBuyers) : "—"}
            icon={Users}
            loading={isLoading}
          />
          <KpiCard
            label="Revenue"
            value={kpis ? formatCurrency(kpis.totalRevenue) : "—"}
            icon={BarChart2}
            loading={isLoading}
            accent="bg-violet-500/10"
          />
          <KpiCard
            label="Conversion %"
            value={kpis ? `${kpis.conversionPct.toFixed(1)}%` : "—"}
            icon={TrendingUp}
            loading={isLoading}
            accent="bg-blue-500/10"
          />
        </div>
      </motion.div>

      {/* AI Insight */}
      {!insightDismissed && (
        <motion.div variants={cardVariants}>
          <Card
            className="p-5 bg-gradient-to-br from-primary/[0.04] via-card to-card border-border relative overflow-hidden"
            data-testid="utm-insight-card"
          >
            <div
              aria-hidden
              className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-primary via-chart-3 to-chart-1 opacity-80"
            />
            <div className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-primary/10 blur-2xl pointer-events-none" />
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-3">
                <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/15 text-primary text-[10px] font-semibold uppercase tracking-wider">
                  <Sparkles className="h-3 w-3" />
                  UP Insight · Attribution · {insight?.source === "ai" ? "AI" : "Auto"}
                </span>
                <button
                  type="button"
                  onClick={() => setInsightDismissed(true)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Dismiss insight"
                  data-testid="utm-insight-dismiss"
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              </div>
              {insightLoading || !insight ? (
                <>
                  <Skeleton className="h-5 w-3/4 mb-2" />
                  <Skeleton className="h-4 w-full mb-1" />
                  <Skeleton className="h-4 w-5/6 mb-3" />
                </>
              ) : (
                <>
                  <h3 className="text-base font-semibold leading-snug mb-2">{insight.headline}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{insight.body}</p>
                  {insight.bullets?.length > 0 && (
                    <ul className="mt-3 space-y-1.5">
                      {insight.bullets.map((b, i) => (
                        <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                          <span className="text-primary mt-1 leading-none">•</span>
                          <span className="leading-relaxed">{b}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
              <div className="mt-4 flex items-center gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => regenerate.mutate({ params: insightParams })}
                  disabled={regenerate.isPending || insightLoading}
                  data-testid="utm-insight-regenerate"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 mr-1.5 ${regenerate.isPending ? "animate-spin" : ""}`}
                  />
                  {regenerate.isPending ? "Regenerating…" : "Regenerate"}
                </Button>
                {insight?.cached && (
                  <span className="text-[11px] text-muted-foreground">
                    Cached · refreshes hourly
                  </span>
                )}
              </div>
            </div>
          </Card>
        </motion.div>
      )}

      {/* Charts row */}
      <motion.div variants={cardVariants}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">
                Revenue by {groupBy === "source" ? "Source" : "Campaign"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-48 w-full" />
              ) : barDataRevenue.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
                  No revenue data
                </div>
              ) : (
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={barDataRevenue}
                      layout="vertical"
                      margin={{ left: 4, right: 24, top: 4, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-border/30" />
                      <XAxis
                        type="number"
                        tick={{ fontSize: 10 }}
                        tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        tick={{ fontSize: 10 }}
                        width={80}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                        formatter={(v: number) => [formatCurrency(v), "Revenue"]}
                      />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive={!reduced}>
                        {barDataRevenue.map((_, i) => (
                          <Cell key={i} fill={SOURCE_PALETTE[i % SOURCE_PALETTE.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">
                Conversion % by {groupBy === "source" ? "Source" : "Campaign"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-48 w-full" />
              ) : barDataConv.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
                  No conversion data
                </div>
              ) : (
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={barDataConv}
                      layout="vertical"
                      margin={{ left: 4, right: 24, top: 4, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-border/30" />
                      <XAxis
                        type="number"
                        tick={{ fontSize: 10 }}
                        tickFormatter={(v) => `${v}%`}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        tick={{ fontSize: 10 }}
                        width={80}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                        formatter={(v: number) => [`${v}%`, "Conversion"]}
                      />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive={!reduced}>
                        {barDataConv.map((_, i) => (
                          <Cell
                            key={i}
                            fill={SOURCE_PALETTE[(i + 3) % SOURCE_PALETTE.length]}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </motion.div>

      {/* Table */}
      <motion.div variants={cardVariants}>
        <Card>
          <CardContent className="p-0">
            {isError ? (
              <Alert variant="destructive" className="m-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="flex items-center justify-between">
                  Failed to load UTM data.
                  <Button variant="outline" size="sm" onClick={() => refetch()}>
                    Retry
                  </Button>
                </AlertDescription>
              </Alert>
            ) : isLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex gap-4">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 flex-1" />
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                ))}
              </div>
            ) : sortedRows.length === 0 ? (
              <EmptyState
                icon={Globe}
                title="No UTM data for this period"
                description="When customers register with UTM parameters, their attribution will appear here."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      {groupBy === "source" && (
                        <th className="w-8 py-3 pl-4" />
                      )}
                      <th className="py-3 pl-4 text-left text-xs font-mono uppercase tracking-wider text-muted-foreground min-w-[140px]">
                        {groupBy === "source" ? "Source" : "Campaign"}
                      </th>
                      <th className="py-3 px-3 text-right min-w-[100px]">
                        <SortableHeader
                          label="Registrations"
                          sortKey="registrations"
                          currentKey={sortKey}
                          dir={sortDir}
                          onSort={handleSort}
                        />
                      </th>
                      <th className="py-3 px-3 text-right min-w-[90px]">
                        <SortableHeader
                          label="Approved"
                          sortKey="approvals"
                          currentKey={sortKey}
                          dir={sortDir}
                          onSort={handleSort}
                        />
                      </th>
                      <th className="py-3 px-3 text-right min-w-[90px]">
                        <SortableHeader
                          label="Appr %"
                          sortKey="approvalPct"
                          currentKey={sortKey}
                          dir={sortDir}
                          onSort={handleSort}
                        />
                      </th>
                      <th className="py-3 px-3 text-right min-w-[80px]">
                        <SortableHeader
                          label="Buyers"
                          sortKey="buyers"
                          currentKey={sortKey}
                          dir={sortDir}
                          onSort={handleSort}
                        />
                      </th>
                      <th className="py-3 px-3 text-right min-w-[110px]">
                        <SortableHeader
                          label="Revenue"
                          sortKey="revenue"
                          currentKey={sortKey}
                          dir={sortDir}
                          onSort={handleSort}
                        />
                      </th>
                      <th className="py-3 px-3 text-right min-w-[90px]">
                        <SortableHeader
                          label="Conv %"
                          sortKey="conversionPct"
                          currentKey={sortKey}
                          dir={sortDir}
                          onSort={handleSort}
                        />
                      </th>
                      <th className="py-3 pr-4 pl-3 text-right min-w-[70px]">
                        <SortableHeader
                          label="ROAS"
                          sortKey="roas"
                          currentKey={sortKey}
                          dir={sortDir}
                          onSort={handleSort}
                        />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((row, idx) => {
                      const isExpanded = expandedRows.has(row.key);
                      const hasSubRows = groupBy === "source" && row.subRows.length > 1;
                      const color = SOURCE_PALETTE[idx % SOURCE_PALETTE.length];
                      return (
                        <>
                          <tr
                            key={row.key}
                            className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${hasSubRows ? "cursor-pointer" : ""}`}
                            onClick={() => hasSubRows && toggleRow(row.key)}
                            data-testid={`utm-row-${row.key}`}
                          >
                            {groupBy === "source" && (
                              <td className="pl-4 py-3">
                                {hasSubRows ? (
                                  isExpanded ? (
                                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                  ) : (
                                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                  )
                                ) : (
                                  <span className="inline-block h-3.5 w-3.5" />
                                )}
                              </td>
                            )}
                            <td className="pl-4 pr-3 py-3">
                              <div className="flex items-center gap-2">
                                <span
                                  className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0"
                                  style={{ background: color }}
                                  aria-hidden
                                />
                                <span className="font-medium truncate max-w-[160px]" title={row.key}>
                                  {row.key}
                                </span>
                                {hasSubRows && (
                                  <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                                    {row.subRows.length} mediums
                                  </Badge>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums">
                              {formatNumber(row.registrations)}
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums">
                              {formatNumber(row.approvals)}
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums">
                              <span
                                className={
                                  row.approvalPct >= 70
                                    ? "text-emerald-500"
                                    : row.approvalPct >= 50
                                      ? "text-amber-500"
                                      : "text-red-500"
                                }
                              >
                                {row.approvalPct.toFixed(1)}%
                              </span>
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums">
                              {formatNumber(row.buyers)}
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums font-medium">
                              {formatCurrency(row.revenue)}
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums">
                              <span
                                className={
                                  row.conversionPct >= 30
                                    ? "text-emerald-500"
                                    : row.conversionPct >= 15
                                      ? "text-amber-500"
                                      : "text-muted-foreground"
                                }
                              >
                                {row.conversionPct.toFixed(1)}%
                              </span>
                            </td>
                            <td className="pr-4 pl-3 py-3 text-right tabular-nums">
                              {row.roas != null ? (
                                <span
                                  className={row.roas >= 3 ? "text-emerald-500 font-medium" : row.roas >= 1 ? "text-foreground" : "text-red-500"}
                                >
                                  {row.roas.toFixed(2)}x
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          </tr>

                          {/* Sub-rows (medium breakdown) */}
                          {isExpanded &&
                            hasSubRows &&
                            row.subRows.map((sub) => (
                              <tr
                                key={`${row.key}__${sub.key}`}
                                className="border-b border-border/30 bg-muted/10"
                                data-testid={`utm-subrow-${row.key}-${sub.key}`}
                              >
                                {groupBy === "source" && <td className="pl-4 py-2" />}
                                <td className="pl-8 pr-3 py-2">
                                  <div className="flex items-center gap-2 text-muted-foreground">
                                    <span className="text-[10px] font-mono">↳</span>
                                    <span className="text-xs">{sub.key}</span>
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">
                                  {formatNumber(sub.registrations)}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">
                                  {formatNumber(sub.approvals)}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">
                                  {sub.approvalPct.toFixed(1)}%
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">
                                  —
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">
                                  —
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">
                                  —
                                </td>
                                <td className="pr-4 pl-3 py-2 text-right text-xs text-muted-foreground">
                                  —
                                </td>
                              </tr>
                            ))}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
