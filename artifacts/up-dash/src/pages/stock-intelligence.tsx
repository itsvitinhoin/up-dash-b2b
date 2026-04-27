import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Bar,
  BarChart,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts";
import {
  useGetStock,
  useGetInsight,
  useRegenerateInsight,
  getGetInsightQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import { formatNumber, formatPercentage } from "@/lib/formatters";
import { exportRowsAsCsv } from "@/lib/csv-export";
import { cardEntry, staggerContainer, useReducedMotion, withReducedMotion } from "@/lib/motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import {
  Package,
  AlertTriangle,
  TrendingUp,
  Download,
  Sparkles,
  RefreshCw,
  X as XIcon,
  BarChart3,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Boxes,
  PackageCheck,
  Gauge,
} from "lucide-react";

type StockSort =
  | "sku"
  | "name"
  | "category"
  | "stock"
  | "dailyVelocity"
  | "coverageDays"
  | "risk"
  | "unitsSold"
  | "lastRestockDate";

type RiskFilter = "Stockout" | "Overstock" | "Healthy" | "all";

const RISK_STYLES: Record<string, string> = {
  Stockout: "bg-red-500/15 text-red-400 border-red-500/30",
  Overstock: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  Healthy: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
};

const BAR_PALETTE = [
  "hsl(var(--chart-1))",
  "hsl(var(--primary))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

function SortIcon({ col, sort, dir }: { col: StockSort; sort: StockSort; dir: "asc" | "desc" }) {
  if (col !== sort) return <ChevronsUpDown className="h-3 w-3 text-muted-foreground/40" />;
  return dir === "asc" ? <ChevronUp className="h-3 w-3 text-primary" /> : <ChevronDown className="h-3 w-3 text-primary" />;
}

function KpiCard({
  label,
  value,
  prev,
  format: fmt,
  icon: Icon,
  invertDelta,
}: {
  label: string;
  value: number;
  prev: number;
  format: (v: number) => string;
  icon: React.ElementType;
  invertDelta?: boolean;
}) {
  const delta = prev > 0 ? ((value - prev) / prev) * 100 : null;
  const positive = invertDelta ? delta !== null && delta <= 0 : delta !== null && delta >= 0;
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/15 text-primary">
          <Icon className="h-3 w-3" />
        </div>
        <span className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="text-xl font-bold tabular-nums">{fmt(value)}</div>
      {delta !== null && (
        <p className={`text-xs tabular-nums mt-0.5 ${positive ? "text-emerald-400" : "text-red-400"}`}>
          {delta >= 0 ? "+" : ""}
          {delta.toFixed(1)}% vs prev period
        </p>
      )}
    </Card>
  );
}

function SkuTile({
  title,
  icon: Icon,
  color,
  rows,
  emptyText,
}: {
  title: string;
  icon: React.ElementType;
  color: string;
  rows: Array<{
    productId: string;
    sku: string;
    name: string;
    category?: string | null;
    stock: number;
    dailyVelocity: number;
    coverageDays?: number | null;
    risk: string;
    unitsSold: number;
  }>;
  emptyText: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className={`flex h-6 w-6 items-center justify-center rounded-md ${color}`}>
          <Icon className="h-3 w-3" />
        </div>
        <span className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">
          {title}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">{emptyText}</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r, i) => (
            <div key={r.productId} className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground/60 tabular-nums w-4 shrink-0">
                {i + 1}.
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate" title={r.name}>
                  {r.name}
                </p>
                <p className="text-muted-foreground tabular-nums">
                  {r.coverageDays !== null && r.coverageDays !== undefined
                    ? `${r.coverageDays.toFixed(0)}d coverage`
                    : "No velocity"}{" "}
                  · {formatNumber(r.unitsSold)} sold
                </p>
              </div>
              <Badge
                variant="outline"
                className={`text-[10px] px-1.5 py-0 shrink-0 ${RISK_STYLES[r.risk]}`}
              >
                {r.risk}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function StockIntelligencePage() {
  const { user, selectedClientId } = useAuth();
  const queryClient = useQueryClient();
  const { dateRange, filters } = useDashboardFilters();
  const reduced = useReducedMotion();
  const containerVariants = withReducedMotion(staggerContainer, reduced);
  const cardVariants = withReducedMotion(cardEntry, reduced);

  const clientId = user?.role === "ADMIN" ? selectedClientId || undefined : undefined;
  const enabled = user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId);
  const dateFrom = format(dateRange.from, "yyyy-MM-dd");
  const dateTo = format(dateRange.to, "yyyy-MM-dd");

  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<StockSort>("coverageDays");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const [insightDismissed, setInsightDismissed] = useState(false);

  const PAGE_SIZE = 25;

  const stockParams = {
    clientId,
    dateFrom,
    dateTo,
    page,
    limit: PAGE_SIZE,
    sort,
    sortDir,
    search: search || undefined,
    category: categoryFilter !== "all" ? categoryFilter : undefined,
    risk: riskFilter !== "all" ? (riskFilter as "Stockout" | "Overstock" | "Healthy") : undefined,
    utmSource: filters.utmSource || undefined,
    utmMedium: filters.utmMedium || undefined,
    state: filters.state || undefined,
    city: filters.city || undefined,
  };

  const { data, isLoading, isError } = useGetStock(stockParams, {
    query: queryOpts({ enabled }),
  });

  const insightParams = { clientId, dateFrom, dateTo, screen: "stock" as const };
  const { data: insight, isLoading: insightLoading } = useGetInsight(insightParams, {
    query: queryOpts({ enabled, staleTime: 3_600_000 }),
  });
  const regenerate = useRegenerateInsight({
    mutation: {
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: getGetInsightQueryKey(insightParams) }),
    },
  });

  const categories = useMemo(() => {
    if (!data?.categoryBreakdown) return [];
    return data.categoryBreakdown.map((c) => c.category);
  }, [data]);

  function toggleSort(col: StockSort) {
    if (sort === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSort(col);
      setSortDir(col === "coverageDays" ? "asc" : "desc");
    }
    setPage(1);
  }

  function handleSearch(v: string) {
    setSearch(v);
    setPage(1);
  }

  function handleCategoryFilter(v: string) {
    setCategoryFilter(v);
    setPage(1);
  }

  function handleRiskFilter(v: string) {
    setRiskFilter(v as RiskFilter);
    setPage(1);
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  const categoryChartData = useMemo(() => {
    if (!data?.categoryBreakdown) return [];
    return data.categoryBreakdown.slice(0, 12).map((r) => ({
      category: r.category.length > 12 ? r.category.slice(0, 12) + "…" : r.category,
      stockUnits: r.stockUnits,
      unitsSold: r.unitsSold,
      dailyVelocity: r.dailyVelocity,
    }));
  }, [data]);

  const colorChartData = useMemo(() => {
    if (!data?.colorBreakdown) return [];
    return data.colorBreakdown.slice(0, 12).map((r) => ({
      name: r.color,
      stockUnits: r.stockUnits,
      unitsSold: r.unitsSold,
    }));
  }, [data]);

  const sizeChartData = useMemo(() => {
    if (!data?.sizeBreakdown) return [];
    return data.sizeBreakdown.slice(0, 12).map((r) => ({
      name: r.size,
      stockUnits: r.stockUnits,
      unitsSold: r.unitsSold,
    }));
  }, [data]);

  if (isError) {
    return (
      <EmptyState
        icon={Package}
        title="Failed to load stock data"
        description="There was a problem loading the stock intelligence data. Please try again."
      />
    );
  }

  return (
    <motion.div
      className="space-y-6"
      data-testid="page-stock"
      initial="hidden"
      animate="visible"
      variants={containerVariants}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status" aria-live="polite">
          <span className="relative flex h-1.5 w-1.5" aria-hidden>
            {!reduced && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/60" />
            )}
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          <span className="font-mono uppercase tracking-wider">
            Live · Stock Intelligence
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!data?.skus?.length}
          data-testid="stock-export"
          onClick={() => {
            if (!data?.skus) return;
            exportRowsAsCsv(
              `stock-intelligence-${new Date().toISOString().slice(0, 10)}.csv`,
              data.skus,
              [
                { header: "SKU", accessor: (r) => r.sku },
                { header: "Name", accessor: (r) => r.name },
                { header: "Category", accessor: (r) => r.category ?? "" },
                { header: "Stock", accessor: (r) => r.stock },
                { header: "Daily Velocity", accessor: (r) => r.dailyVelocity.toFixed(2) },
                { header: "Coverage Days", accessor: (r) => r.coverageDays?.toFixed(1) ?? "—" },
                { header: "Risk", accessor: (r) => r.risk },
                { header: "Units Sold", accessor: (r) => r.unitsSold },
                { header: "Last Restock Date", accessor: (r) => r.lastRestockDate ?? "" },
              ],
            );
          }}
        >
          <Download className="h-4 w-4 mr-1.5" />
          Export CSV
        </Button>
      </div>

      {/* AI Insight card */}
      {!insightDismissed && (
        <motion.div variants={cardVariants}>
          <Card
            className="p-5 bg-gradient-to-br from-primary/[0.04] via-card to-card border-border relative overflow-hidden"
            data-testid="stock-insight-card"
          >
            <div aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-primary via-chart-3 to-chart-1 opacity-80" />
            <div className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-primary/10 blur-2xl pointer-events-none" />
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-3">
                <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/15 text-primary text-[10px] font-semibold uppercase tracking-wider">
                  <Sparkles className="h-3 w-3" />
                  UP Insight · Stock · {insight?.source === "ai" ? "AI" : "Auto"}
                </span>
                <button
                  type="button"
                  onClick={() => setInsightDismissed(true)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Dismiss insight"
                  data-testid="stock-insight-dismiss"
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
                  {insight.bullets && insight.bullets.length > 0 && (
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
                  data-testid="stock-insight-regenerate"
                >
                  <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${regenerate.isPending ? "animate-spin" : ""}`} />
                  {regenerate.isPending ? "Regenerating…" : "Regenerate"}
                </Button>
                {insight?.cached && (
                  <span className="text-[11px] text-muted-foreground">Cached · refreshes hourly</span>
                )}
              </div>
            </div>
          </Card>
        </motion.div>
      )}

      {/* KPI strip */}
      <motion.div variants={cardVariants}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <Card key={i} className="p-4">
                <Skeleton className="h-3 w-20 mb-3" />
                <Skeleton className="h-7 w-24" />
              </Card>
            ))
          ) : data ? (
            <>
              <KpiCard
                label="Total Stock Units"
                value={data.kpis.totalUnits}
                prev={data.prevKpis.totalUnits}
                format={(v) => formatNumber(v)}
                icon={Boxes}
              />
              <KpiCard
                label="Avg Coverage Days"
                value={data.kpis.avgCoverageDays}
                prev={data.prevKpis.avgCoverageDays}
                format={(v) => `${v.toFixed(1)}d`}
                icon={Gauge}
              />
              <KpiCard
                label="Stockout Risk SKUs"
                value={data.kpis.stockoutRiskCount}
                prev={data.prevKpis.stockoutRiskCount}
                format={(v) => formatNumber(v)}
                icon={AlertTriangle}
                invertDelta
              />
              <KpiCard
                label="Overstock Risk SKUs"
                value={data.kpis.overstockRiskCount}
                prev={data.prevKpis.overstockRiskCount}
                format={(v) => formatNumber(v)}
                icon={Package}
                invertDelta
              />
              <KpiCard
                label="Sell-through Rate"
                value={data.kpis.sellThroughRate}
                prev={data.prevKpis.sellThroughRate}
                format={(v) => `${v.toFixed(1)}%`}
                icon={PackageCheck}
              />
            </>
          ) : null}
        </div>
      </motion.div>

      {/* Ranked SKU tiles */}
      <motion.div variants={cardVariants}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="p-4">
                <Skeleton className="h-3 w-28 mb-3" />
                {Array.from({ length: 5 }).map((_, j) => (
                  <Skeleton key={j} className="h-8 w-full mb-1.5" />
                ))}
              </Card>
            ))
          ) : data ? (
            <>
              <SkuTile
                title="Stockout Risk · Top 10"
                icon={AlertTriangle}
                color="bg-red-500/15 text-red-400"
                rows={data.stockoutRisk}
                emptyText="No stockout-risk products in this period."
              />
              <SkuTile
                title="Overstock Risk · Top 10"
                icon={Package}
                color="bg-amber-500/15 text-amber-400"
                rows={data.overstockRisk}
                emptyText="No overstock-risk products in this period."
              />
              <SkuTile
                title="High Turnover · Top 10"
                icon={TrendingUp}
                color="bg-emerald-500/15 text-emerald-400"
                rows={data.highTurnover}
                emptyText="No sales velocity data for this period."
              />
            </>
          ) : null}
        </div>
      </motion.div>

      {/* Breakdown charts */}
      <motion.div variants={cardVariants}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Category: Stock vs Sales */}
          <Card className="p-5 lg:col-span-1">
            <div className="flex items-center gap-2 mb-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary">
                <BarChart3 className="h-3.5 w-3.5" />
              </div>
              <span className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">
                Stock vs Sales by Category
              </span>
            </div>
            {isLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : categoryChartData.length > 0 ? (
              <div style={{ height: Math.max(200, categoryChartData.length * 36 + 60) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={categoryChartData}
                    margin={{ top: 4, right: 48, left: 0, bottom: 48 }}
                    barCategoryGap={8}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.4)" vertical={false} />
                    <XAxis
                      type="category"
                      dataKey="category"
                      tickLine={false}
                      axisLine={false}
                      interval={0}
                      angle={-30}
                      textAnchor="end"
                      height={52}
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                    />
                    <YAxis
                      yAxisId="units"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                      tickFormatter={(v) => formatNumber(v)}
                    />
                    <YAxis
                      yAxisId="vel"
                      orientation="right"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                      tickFormatter={(v) => `${Number(v).toFixed(1)}/d`}
                    />
                    <Tooltip
                      cursor={{ fill: "hsl(var(--accent)/0.3)" }}
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "6px",
                        fontSize: 11,
                      }}
                      formatter={(v, name) => [
                        name === "Daily Velocity"
                          ? `${Number(v).toFixed(2)}/day`
                          : formatNumber(Number(v)),
                        name,
                      ]}
                    />
                    <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }} />
                    <Bar yAxisId="units" dataKey="stockUnits" name="Stock Units" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} barSize={14} />
                    <Line yAxisId="vel" dataKey="dailyVelocity" name="Daily Velocity" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={{ r: 3, fill: "hsl(var(--chart-3))" }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState
                icon={BarChart3}
                title="No category data"
                description="No category breakdown for this period."
                className="h-40 border-0 bg-transparent"
              />
            )}
          </Card>

          {/* Color: Stock Units by Color */}
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-chart-2/20 text-chart-2">
                <BarChart3 className="h-3.5 w-3.5" />
              </div>
              <span className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">
                Stock by Color
              </span>
            </div>
            {isLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : colorChartData.length > 0 ? (
              <div style={{ height: Math.max(160, colorChartData.length * 30 + 24) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={colorChartData}
                    layout="vertical"
                    margin={{ top: 4, right: 24, left: 0, bottom: 4 }}
                    barCategoryGap={6}
                  >
                    <XAxis type="number" hide domain={[0, "dataMax"]} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={80}
                      tickLine={false}
                      axisLine={false}
                      interval={0}
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                    />
                    <Tooltip
                      cursor={{ fill: "hsl(var(--accent)/0.3)" }}
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "6px",
                        fontSize: 11,
                      }}
                      formatter={(v, name) => [formatNumber(v as number), name === "stockUnits" ? "Stock Units" : "Units Sold"]}
                    />
                    <Bar dataKey="stockUnits" name="Stock Units" stackId="a" radius={[0, 0, 0, 0]} barSize={10}>
                      {colorChartData.map((_, i) => (
                        <Cell key={i} fill={BAR_PALETTE[i % BAR_PALETTE.length]} />
                      ))}
                    </Bar>
                    <Bar dataKey="unitsSold" name="Units Sold" stackId="a" radius={[0, 3, 3, 0]} barSize={10} fill="hsl(var(--muted-foreground)/0.35)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState
                icon={BarChart3}
                title="No color data"
                description="No color breakdown for this period."
                className="h-40 border-0 bg-transparent"
              />
            )}
          </Card>

          {/* Size: Units Sold */}
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-chart-4/20 text-chart-4">
                <BarChart3 className="h-3.5 w-3.5" />
              </div>
              <span className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">
                Stock by Size
              </span>
            </div>
            {isLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : sizeChartData.length > 0 ? (
              <div style={{ height: Math.max(160, sizeChartData.length * 30 + 24) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={sizeChartData}
                    layout="vertical"
                    margin={{ top: 4, right: 24, left: 0, bottom: 4 }}
                    barCategoryGap={6}
                  >
                    <XAxis type="number" hide domain={[0, "dataMax"]} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={60}
                      tickLine={false}
                      axisLine={false}
                      interval={0}
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                    />
                    <Tooltip
                      cursor={{ fill: "hsl(var(--accent)/0.3)" }}
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "6px",
                        fontSize: 11,
                      }}
                      formatter={(v, name) => [formatNumber(v as number), name === "stockUnits" ? "Stock Units" : "Units Sold"]}
                    />
                    <Bar dataKey="stockUnits" name="Stock Units" stackId="a" radius={[0, 0, 0, 0]} barSize={10}>
                      {sizeChartData.map((_, i) => (
                        <Cell key={i} fill={BAR_PALETTE[i % BAR_PALETTE.length]} />
                      ))}
                    </Bar>
                    <Bar dataKey="unitsSold" name="Units Sold" stackId="a" radius={[0, 3, 3, 0]} barSize={10} fill="hsl(var(--muted-foreground)/0.35)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState
                icon={BarChart3}
                title="No size data"
                description="No size breakdown for this period."
                className="h-40 border-0 bg-transparent"
              />
            )}
          </Card>
        </div>
      </motion.div>

      {/* Full SKU table */}
      <motion.div variants={cardVariants}>
        <Card className="overflow-hidden">
          <CardHeader className="px-5 py-4 border-b border-border">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-sm font-semibold">All SKUs</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  placeholder="Search SKU or name…"
                  value={search}
                  onChange={(e) => handleSearch(e.target.value)}
                  className="h-8 w-44 text-xs"
                  data-testid="stock-search"
                />
                {categories.length > 0 && (
                  <Select value={categoryFilter} onValueChange={handleCategoryFilter}>
                    <SelectTrigger className="h-8 w-36 text-xs" data-testid="stock-category-filter">
                      <SelectValue placeholder="Category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All categories</SelectItem>
                      {categories.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Select value={riskFilter} onValueChange={handleRiskFilter}>
                  <SelectTrigger className="h-8 w-32 text-xs" data-testid="stock-risk-filter">
                    <SelectValue placeholder="Risk" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All risks</SelectItem>
                    <SelectItem value="Stockout">Stockout</SelectItem>
                    <SelectItem value="Overstock">Overstock</SelectItem>
                    <SelectItem value="Healthy">Healthy</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {(
                      [
                        { key: "sku", label: "SKU" },
                        { key: "name", label: "Name" },
                        { key: "category", label: "Category" },
                        { key: "stock", label: "Stock" },
                        { key: "dailyVelocity", label: "Daily Velocity" },
                        { key: "coverageDays", label: "Coverage Days" },
                        { key: "risk", label: "Risk" },
                        { key: "unitsSold", label: "Units Sold" },
                        { key: "lastRestockDate", label: "Last Restock" },
                      ] as { key: StockSort; label: string }[]
                    ).map((col) => (
                      <TableHead
                        key={col.key}
                        className="cursor-pointer select-none whitespace-nowrap text-xs"
                        onClick={() => toggleSort(col.key)}
                      >
                        <span className="flex items-center gap-1">
                          {col.label}
                          <SortIcon col={col.key} sort={sort} dir={sortDir} />
                        </span>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 8 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 9 }).map((_, j) => (
                          <TableCell key={j}>
                            <Skeleton className="h-4 w-full" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : data?.skus?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="h-32 text-center">
                        <EmptyState
                          icon={Package}
                          title="No SKUs found"
                          description="Try adjusting your filters."
                          className="border-0 bg-transparent"
                        />
                      </TableCell>
                    </TableRow>
                  ) : (
                    data?.skus?.map((row) => (
                      <TableRow key={row.productId} className="hover:bg-accent/30">
                        <TableCell className="font-mono text-xs">{row.sku}</TableCell>
                        <TableCell className="text-xs font-medium max-w-[180px] truncate" title={row.name}>
                          {row.name}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {row.category ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs tabular-nums">
                          {formatNumber(row.stock)}
                        </TableCell>
                        <TableCell className="text-xs tabular-nums">
                          {row.dailyVelocity.toFixed(2)}/d
                        </TableCell>
                        <TableCell className="text-xs tabular-nums">
                          {row.coverageDays !== null && row.coverageDays !== undefined
                            ? `${row.coverageDays.toFixed(0)}d`
                            : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 ${RISK_STYLES[row.risk]}`}
                          >
                            {row.risk}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs tabular-nums">
                          {formatNumber(row.unitsSold)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {row.lastRestockDate
                            ? format(new Date(row.lastRestockDate), "MMM d, yyyy")
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {data && data.total > PAGE_SIZE && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-border">
                <span className="text-xs text-muted-foreground">
                  {formatNumber(data.total)} SKUs · Page {page} of {totalPages}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    data-testid="stock-prev-page"
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    data-testid="stock-next-page"
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
