import { useEffect, useMemo, useRef, useState } from "react";
import { useSearch, useLocation } from "wouter";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import {
  useGetCustomers,
  useGetCustomerSummary,
  useGetInsight,
  useRegenerateInsight,
  getGetInsightQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertCircle, Search, Inbox, Download, ChevronRight,
  UserCheck, Users, UserX, Clock, TrendingUp, BarChart2, Globe,
  Sparkles, RefreshCw, X as XIcon,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { BrazilHeatMap } from "@/components/brazil-heat-map";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { exportRowsAsCsv } from "@/lib/csv-export";
import { CountUp } from "@/components/count-up";
import { cardEntry, staggerContainer, useReducedMotion, withReducedMotion } from "@/lib/motion";
import {
  AreaChart, Area, BarChart, Bar, Cell, PieChart, Pie,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

const SEGMENT_DOT: Record<string, string> = {
  Champions: "bg-emerald-500",
  Loyal: "bg-blue-500",
  Potential: "bg-violet-500",
  "At Risk": "bg-amber-500",
  Lost: "bg-zinc-500",
};

const OPPORTUNITY_COLOR: Record<string, string> = {
  CHAMPION: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  HIGH: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  MEDIUM: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  LOW: "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-400",
};

const STATUS_DOT: Record<string, string> = {
  APPROVED: "bg-emerald-500",
  PENDING: "bg-amber-400",
  REJECTED: "bg-red-500",
};

const SOURCE_COLORS = ["#6366f1", "#22d3ee", "#f59e0b", "#10b981", "#f43f5e", "#8b5cf6", "#ec4899", "#14b8a6"];

function readQueryParam(search: string, key: string): string {
  const trimmed = search.startsWith("?") ? search.slice(1) : search;
  if (!trimmed) return "";
  const params = new URLSearchParams(trimmed);
  return params.get(key) ?? "";
}

function delta(curr: number | null | undefined, prev: number | null | undefined): number | null {
  if (curr == null || prev == null || prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct == null) return null;
  const positive = pct >= 0;
  return (
    <span className={`text-[10px] font-mono flex items-center gap-0.5 ${positive ? "text-emerald-500" : "text-red-500"}`}>
      {positive ? "↑" : "↓"} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function SummaryKpiCard({
  label, value, prevValue, deltaRaw, icon: Icon, loading,
}: {
  label: string;
  value: string;
  prevValue?: string;
  deltaRaw?: number | null;
  icon: React.ElementType;
  loading: boolean;
}) {
  return (
    <div className="flex items-start gap-3 p-4 bg-card border border-border rounded-xl">
      <div className="p-2 bg-primary/10 rounded-lg mt-0.5">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground truncate">{label}</p>
        {loading ? (
          <Skeleton className="h-6 w-20 mt-1" />
        ) : (
          <p className="text-xl font-bold tabular-nums leading-tight">{value}</p>
        )}
        {!loading && (deltaRaw != null || prevValue) && (
          <div className="flex items-center gap-1.5 mt-0.5">
            <DeltaBadge pct={deltaRaw ?? null} />
            {prevValue && (
              <span className="text-[10px] text-muted-foreground">prev {prevValue}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

type ChartTab = "timeline" | "state" | "source";
type CustomerSortKey = "totalSpent" | "totalOrders" | "createdAt" | "firstPurchaseAt" | "lastPurchaseAt" | "name";

export default function CustomersPage() {
  const { selectedClientId, user } = useAuth();
  const { dateRange, filters } = useDashboardFilters();
  const locationSearch = useSearch();
  const [, navigate] = useLocation();
  const urlSearch = readQueryParam(locationSearch, "search");
  const [search, setSearch] = useState(urlSearch);
  const debouncedSearch = useDebounce(search, 300);
  const [rfmSegment, setRfmSegment] = useState<string>("");
  const [state, setState] = useState<string>("");
  const [documentFilter, setDocumentFilter] = useState<string>("all");
  const [purchaseFilter, setPurchaseFilter] = useState<string>("all");
  const [registrationStatusFilter, setRegistrationStatusFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<CustomerSortKey>("totalSpent");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [chartTab, setChartTab] = useState<ChartTab>("timeline");
  const [highlightTarget, setHighlightTarget] = useState<string | null>(
    urlSearch ? urlSearch.toLowerCase() : null,
  );
  const [insightDismissed, setInsightDismissed] = useState(false);
  const queryClient = useQueryClient();
  useEffect(() => {
    setSearch((prev) => (prev === urlSearch ? prev : urlSearch));
    setPage(1);
    if (urlSearch) {
      setHighlightTarget(urlSearch.toLowerCase());
    }
  }, [urlSearch]);

  const limit = 20;
  const reduced = useReducedMotion();
  const containerVariants = withReducedMotion(staggerContainer, reduced);
  const cardVariants = withReducedMotion(cardEntry, reduced);

  const clientId = user?.role === "ADMIN" ? selectedClientId || undefined : undefined;
  const enabled = user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId);
  const highlightedRowRef = useRef<HTMLTableRowElement | null>(null);

  const { data, isLoading, isError, refetch } = useGetCustomers(
    {
      clientId,
      dateFrom: dateRange ? format(dateRange.from, "yyyy-MM-dd") : undefined,
      dateTo: dateRange ? format(dateRange.to, "yyyy-MM-dd") : undefined,
      search: debouncedSearch || undefined,
      rfmSegment: rfmSegment && rfmSegment !== "all" ? rfmSegment : undefined,
      state: filters.state || (state && state !== "all" ? state : undefined),
      utmSource: filters.utmSource || undefined,
      utmMedium: filters.utmMedium || undefined,
      documentType: documentFilter !== "all" ? (documentFilter as "CPF" | "CNPJ") : undefined,
      registrationStatus: registrationStatusFilter !== "all"
        ? (registrationStatusFilter as "PENDING" | "APPROVED" | "REJECTED")
        : undefined,
      purchaseStatus: purchaseFilter !== "all" ? (purchaseFilter as "buyers" | "non_buyers") : undefined,
      sortBy: sortKey,
      sortDir,
      page,
      limit,
    },
    {
      query: queryOpts({
        enabled,
        placeholderData: (prev) => prev,
      }),
    }
  );

  const summaryParams = {
    clientId,
    dateFrom: format(dateRange.from, "yyyy-MM-dd"),
    dateTo: format(dateRange.to, "yyyy-MM-dd"),
    compare: true,
  };
  const { data: summary, isLoading: summaryLoading } = useGetCustomerSummary(
    summaryParams,
    { query: queryOpts({ enabled }) },
  );

  const insightParams = {
    clientId,
    dateFrom: dateRange ? format(dateRange.from, "yyyy-MM-dd") : undefined,
    dateTo: dateRange ? format(dateRange.to, "yyyy-MM-dd") : undefined,
    screen: "customers" as const,
  };
  const { data: insight, isLoading: insightLoading } = useGetInsight(
    insightParams,
    { query: queryOpts({ enabled }) },
  );
  const regenerate = useRegenerateInsight({
    mutation: {
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: getGetInsightQueryKey(insightParams) }),
    },
  });

  const getRfmColor = (segment: string) => {
    switch (segment) {
      case "Champions": return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
      case "Loyal": return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400";
      case "Potential": return "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400";
      case "At Risk": return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400";
      case "Lost": return "bg-zinc-100 text-zinc-800 dark:bg-zinc-900/30 dark:text-zinc-400";
      default: return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300";
    }
  };

  const brazilStates = Array.from(new Set([
    "SP","RJ","MG","ES","PR","BA","RS","SC","GO","PE","CE","PB","MT","RN","AL","SE","PI","MA","PA","AM","TO","RO","AC","RR","AP","DF","MS"
  ])).sort();

  const matchedCustomerId = (() => {
    if (!highlightTarget || !data?.data) return null;
    const found = data.data.find(
      (c) =>
        (c.email && c.email.toLowerCase() === highlightTarget) ||
        (c.name && c.name.toLowerCase() === highlightTarget),
    );
    return found?.id ?? null;
  })();

  useEffect(() => {
    if (!matchedCustomerId) return;
    highlightedRowRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    const timer = setTimeout(() => setHighlightTarget(null), 2000);
    return () => clearTimeout(timer);
  }, [matchedCustomerId]);

  const handleExport = () => {
    if (!filteredCustomers.length) return;
    exportRowsAsCsv(
      `customers-${new Date().toISOString().slice(0, 10)}.csv`,
      filteredCustomers,
      [
        { header: "id", accessor: (r) => r.id },
        { header: "name", accessor: (r) => r.name ?? "" },
        { header: "email", accessor: (r) => r.email ?? "" },
        { header: "documentType", accessor: (r) => r.documentType ?? "" },
        { header: "city", accessor: (r) => r.city ?? "" },
        { header: "state", accessor: (r) => r.state ?? "" },
        { header: "utmSource", accessor: (r) => r.utmSource ?? "" },
        { header: "rfmSegment", accessor: (r) => r.rfmSegment ?? "" },
        { header: "totalOrders", accessor: (r) => r.totalOrders },
        { header: "totalSpent", accessor: (r) => r.totalSpent },
        { header: "firstPurchaseAt", accessor: (r) => r.firstPurchaseAt ?? "" },
        { header: "lastPurchaseAt", accessor: (r) => r.lastPurchaseAt ?? "" },
      ],
    );
  };

  const filteredCustomers = useMemo(() => {
    const rows = [...(data?.data ?? [])].filter((customer) => {
      if (documentFilter !== "all" && customer.documentType !== documentFilter) return false;
      if (registrationStatusFilter !== "all" && customer.registrationStatus !== registrationStatusFilter) return false;
      if (purchaseFilter === "buyers" && customer.totalOrders <= 0) return false;
      if (purchaseFilter === "non_buyers" && customer.totalOrders > 0) return false;
      return true;
    });

    rows.sort((a, b) => {
      const direction = sortDir === "asc" ? 1 : -1;
      if (sortKey === "name") {
        return direction * (a.name || a.email || "").localeCompare(b.name || b.email || "");
      }
      if (sortKey === "createdAt" || sortKey === "firstPurchaseAt" || sortKey === "lastPurchaseAt") {
        const aTime = a[sortKey] ? new Date(a[sortKey] as string).getTime() : 0;
        const bTime = b[sortKey] ? new Date(b[sortKey] as string).getTime() : 0;
        return direction * (aTime - bTime);
      }
      return direction * ((a[sortKey] ?? 0) - (b[sortKey] ?? 0));
    });

    return rows;
  }, [data?.data, documentFilter, purchaseFilter, registrationStatusFilter, sortDir, sortKey]);

  const totalCount = data?.total ?? 0;
  const segmentCount = data?.segmentCounts?.length ?? 0;
  const kpis = summary?.kpis;
  const prevKpis = (summary as Record<string, unknown> | undefined)?.prevKpis as typeof kpis | undefined;
  const registrationStates = useMemo(
    () =>
      (summary?.registrationsByState ?? [])
        .filter((row) => row.state && row.state !== "Unknown")
        .map((row) => ({
          state: row.state,
          orders: 0,
          customers: row.count,
          revenue: row.count,
        })),
    [summary?.registrationsByState],
  );
  const topRegistrationStates = useMemo(
    () => [...registrationStates].sort((a, b) => b.customers - a.customers).slice(0, 8),
    [registrationStates],
  );
  const totalRegistrationStates = registrationStates.reduce((acc, row) => acc + row.customers, 0);

  const CHART_TABS: { key: ChartTab; label: string; icon: React.ElementType }[] = [
    { key: "timeline", label: "Registrations", icon: TrendingUp },
    { key: "state", label: "By State", icon: BarChart2 },
    { key: "source", label: "By Source", icon: Globe },
  ];

  return (
    <motion.div
      className="space-y-6"
      data-testid="page-customers"
      initial="hidden"
      animate="visible"
      variants={containerVariants}
    >
      {/* Header row */}
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
              <CountUp value={totalCount} format={(v) => formatNumber(Math.round(v))} />
            </span>{" "}
            Customers
            <span className="ml-2 text-muted-foreground/70">
              · {format(dateRange.from, "MMM d")} → {format(dateRange.to, "MMM d, yyyy")}
            </span>
            {segmentCount > 0 && (
              <span className="ml-2 text-muted-foreground/70">· {segmentCount} Segments</span>
            )}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={!filteredCustomers.length}
          data-testid="customers-export"
        >
          <Download className="h-4 w-4 mr-1.5" />
          Export CSV
        </Button>
      </div>

      {/* KPI strip */}
      <motion.div variants={cardVariants}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
          <SummaryKpiCard
            label="Registrations"
            value={kpis ? formatNumber(kpis.totalRegistrations) : "—"}
            prevValue={prevKpis ? formatNumber(prevKpis.totalRegistrations) : undefined}
            deltaRaw={delta(kpis?.totalRegistrations, prevKpis?.totalRegistrations)}
            icon={Users}
            loading={summaryLoading}
          />
          <SummaryKpiCard
            label="Approved"
            value={kpis ? formatNumber(kpis.approvedRegistrations) : "—"}
            prevValue={prevKpis ? formatNumber(prevKpis.approvedRegistrations) : undefined}
            deltaRaw={delta(kpis?.approvedRegistrations, prevKpis?.approvedRegistrations)}
            icon={UserCheck}
            loading={summaryLoading}
          />
          <SummaryKpiCard
            label="Approval Rate"
            value={kpis ? `${kpis.approvalRatePct.toFixed(1)}%` : "—"}
            prevValue={prevKpis ? `${prevKpis.approvalRatePct.toFixed(1)}%` : undefined}
            deltaRaw={delta(kpis?.approvalRatePct, prevKpis?.approvalRatePct)}
            icon={TrendingUp}
            loading={summaryLoading}
          />
          <SummaryKpiCard
            label="Total Buyers"
            value={kpis ? formatNumber(kpis.totalBuyers) : "—"}
            prevValue={prevKpis ? formatNumber(prevKpis.totalBuyers) : undefined}
            deltaRaw={delta(kpis?.totalBuyers, prevKpis?.totalBuyers)}
            icon={Users}
            loading={summaryLoading}
          />
          <SummaryKpiCard
            label="Without Purchase"
            value={kpis ? formatNumber(kpis.customersWithoutPurchase) : "—"}
            prevValue={prevKpis ? formatNumber(prevKpis.customersWithoutPurchase) : undefined}
            deltaRaw={delta(kpis?.customersWithoutPurchase, prevKpis?.customersWithoutPurchase)}
            icon={UserX}
            loading={summaryLoading}
          />
          <SummaryKpiCard
            label="Avg Days to 1st"
            value={kpis?.avgTimeToFirstPurchaseDays != null ? `${kpis.avgTimeToFirstPurchaseDays}d` : "—"}
            prevValue={prevKpis?.avgTimeToFirstPurchaseDays != null ? `${prevKpis.avgTimeToFirstPurchaseDays}d` : undefined}
            deltaRaw={delta(kpis?.avgTimeToFirstPurchaseDays ?? null, prevKpis?.avgTimeToFirstPurchaseDays ?? null)}
            icon={Clock}
            loading={summaryLoading}
          />
          <SummaryKpiCard
            label="Avg Days Between"
            value={kpis?.avgTimeBetweenPurchasesDays != null ? `${kpis.avgTimeBetweenPurchasesDays}d` : "—"}
            prevValue={prevKpis?.avgTimeBetweenPurchasesDays != null ? `${prevKpis.avgTimeBetweenPurchasesDays}d` : undefined}
            deltaRaw={delta(kpis?.avgTimeBetweenPurchasesDays ?? null, prevKpis?.avgTimeBetweenPurchasesDays ?? null)}
            icon={Clock}
            loading={summaryLoading}
          />
        </div>
      </motion.div>

      {/* Chart card with tabs */}
      <motion.div variants={cardVariants}>
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">Registration Analytics</CardTitle>
              <div className="flex gap-1 bg-muted/60 p-1 rounded-lg">
                {CHART_TABS.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setChartTab(t.key)}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                      chartTab === t.key
                        ? "bg-background shadow-sm text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <t.icon className="h-3.5 w-3.5" />
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-48">
              {summaryLoading ? (
                <Skeleton className="h-full w-full" />
              ) : chartTab === "timeline" ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={summary?.registrationsOverTime ?? []}>
                    <defs>
                      <linearGradient id="regGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="appGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v) => v.slice(5)}
                      className="text-muted-foreground"
                    />
                    <YAxis tick={{ fontSize: 10 }} width={32} />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Area
                      type="monotone"
                      dataKey="registrations"
                      name="Registrations"
                      stroke="#6366f1"
                      fill="url(#regGrad)"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="approved"
                      name="Approved"
                      stroke="#10b981"
                      fill="url(#appGrad)"
                      strokeWidth={2}
                      dot={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : chartTab === "state" ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={summary?.registrationsByState ?? []}
                    layout="vertical"
                    margin={{ left: 8, right: 24 }}
                  >
                    <XAxis type="number" tick={{ fontSize: 10 }} />
                    <YAxis dataKey="state" type="category" tick={{ fontSize: 10 }} width={28} />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                    />
                    <Bar dataKey="count" name="Customers" fill="#6366f1" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex gap-4 h-full items-center">
                  <ResponsiveContainer width="40%" height="100%">
                    <PieChart>
                      <Pie
                        data={summary?.registrationsBySource ?? []}
                        dataKey="count"
                        nameKey="source"
                        cx="50%"
                        cy="50%"
                        innerRadius="55%"
                        outerRadius="80%"
                      >
                        {(summary?.registrationsBySource ?? []).map((_, i) => (
                          <Cell key={i} fill={SOURCE_COLORS[i % SOURCE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 overflow-y-auto space-y-1.5 max-h-full py-2">
                    {(summary?.registrationsBySource ?? []).map((row, i) => (
                      <div key={row.source} className="flex items-center gap-2 text-xs">
                        <span
                          className="h-2 w-2 rounded-full flex-shrink-0"
                          style={{ background: SOURCE_COLORS[i % SOURCE_COLORS.length] }}
                        />
                        <span className="flex-1 truncate text-muted-foreground">{row.source}</span>
                        <span className="font-semibold tabular-nums">{formatNumber(row.count)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Registration geography */}
      <motion.div variants={cardVariants}>
        <Card className="overflow-hidden">
          <CardContent className="p-4 sm:p-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-foreground/90 flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  Concentração por estado
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Cadastros agrupados por UF, incluindo estados preenchidos por DDD quando disponíveis.
                </p>
              </div>
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {registrationStates.length} states · {formatNumber(totalRegistrationStates)} registrations
              </span>
            </div>
            {summaryLoading ? (
              <Skeleton className="h-[420px] w-full rounded-md" />
            ) : registrationStates.length === 0 ? (
              <EmptyState
                icon={Globe}
                title="No state data yet"
                description="Once customer states are available, you'll see registration concentration here."
                className="border-0 bg-transparent"
              />
            ) : (
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.6fr)]">
                <BrazilHeatMap
                  states={registrationStates}
                  cities={[]}
                  reduced={reduced}
                  ariaLabel="Brazil customer registration heat map"
                  valueFormatter={(value) => formatNumber(value)}
                  stateExtraFormatter={(stateRow) => `${formatNumber(stateRow.customers)} cadastros`}
                  lowLabel="Menos"
                  highLabel="Mais"
                />
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Top estados
                    </h4>
                    <Badge variant="outline" className="text-[10px]">
                      Top {Math.min(8, topRegistrationStates.length)}
                    </Badge>
                  </div>
                  <ol className="space-y-2.5" data-testid="customers-state-leaderboard">
                    {topRegistrationStates.map((stateRow, index) => {
                      const pct = totalRegistrationStates > 0
                        ? (stateRow.customers / totalRegistrationStates) * 100
                        : 0;
                      return (
                        <li
                          key={stateRow.state}
                          className="relative overflow-hidden rounded-md border border-border/60 bg-card/50 p-2.5"
                        >
                          <div
                            aria-hidden
                            className="absolute inset-y-0 left-0 bg-primary/10"
                            style={{ width: `${pct}%` }}
                          />
                          <div className="relative flex items-center gap-2.5">
                            <span
                              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-bold ${
                                index === 0
                                  ? "bg-red-500 text-white"
                                  : index === 1
                                    ? "bg-orange-500 text-white"
                                    : index === 2
                                      ? "bg-amber-500 text-white"
                                      : "bg-muted text-muted-foreground"
                              }`}
                            >
                              {stateRow.state}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="text-sm font-semibold tabular-nums">
                                  {formatNumber(stateRow.customers)}
                                </span>
                                <span className="font-mono text-[10px] text-muted-foreground">
                                  {pct.toFixed(1)}%
                                </span>
                              </div>
                              <div className="text-[11px] text-muted-foreground">cadastros</div>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* AI Insight card */}
      {!insightDismissed && (
        <motion.div variants={cardVariants}>
          <Card className="p-5 bg-gradient-to-br from-primary/[0.04] via-card to-card border-border relative overflow-hidden" data-testid="customers-insight-card">
            <div aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-primary via-chart-3 to-chart-1 opacity-80" />
            <div className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-primary/10 blur-2xl pointer-events-none" />
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-3">
                <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/15 text-primary text-[10px] font-semibold uppercase tracking-wider">
                  <Sparkles className="h-3 w-3" />
                  UP Insight · CRM · {insight?.source === "ai" ? "AI" : "Auto"}
                </span>
                <button
                  type="button"
                  onClick={() => setInsightDismissed(true)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Dismiss insight"
                  data-testid="customers-insight-dismiss"
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
                  data-testid="customers-insight-regenerate"
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

      {/* Filters */}
      <motion.div variants={cardVariants}>
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col md:flex-row md:flex-wrap gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search customers..."
                  className="pl-9"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  data-testid="customer-search-input"
                />
              </div>
              <div className="w-full md:w-48">
                <Select value={rfmSegment || "all"} onValueChange={(v) => { setRfmSegment(v); setPage(1); }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Segment" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Segments</SelectItem>
                    <SelectItem value="Champions">Champions</SelectItem>
                    <SelectItem value="Loyal">Loyal</SelectItem>
                    <SelectItem value="Potential">Potential</SelectItem>
                    <SelectItem value="At Risk">At Risk</SelectItem>
                    <SelectItem value="Lost">Lost</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="w-full md:w-32">
                <Select value={state || "all"} onValueChange={(v) => { setState(v); setPage(1); }}>
                  <SelectTrigger>
                    <SelectValue placeholder="State" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All States</SelectItem>
                    {brazilStates.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-full md:w-36">
                <Select value={documentFilter} onValueChange={(v) => { setDocumentFilter(v); setPage(1); }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Doc" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">CPF e CNPJ</SelectItem>
                    <SelectItem value="CPF">CPF</SelectItem>
                    <SelectItem value="CNPJ">CNPJ</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="w-full md:w-40">
                <Select value={purchaseFilter} onValueChange={(v) => { setPurchaseFilter(v); setPage(1); }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Compra" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Compra: todos</SelectItem>
                    <SelectItem value="buyers">Fez compra</SelectItem>
                    <SelectItem value="non_buyers">Não comprou</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="w-full md:w-40">
                <Select value={registrationStatusFilter} onValueChange={(v) => { setRegistrationStatusFilter(v); setPage(1); }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Status: todos</SelectItem>
                    <SelectItem value="APPROVED">Aprovado</SelectItem>
                    <SelectItem value="PENDING">Pendente</SelectItem>
                    <SelectItem value="REJECTED">Recusado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="w-full md:w-48">
                <Select
                  value={`${sortKey}:${sortDir}`}
                  onValueChange={(value) => {
                    const [nextSort, nextDir] = value.split(":") as [CustomerSortKey, "asc" | "desc"];
                    setSortKey(nextSort);
                    setSortDir(nextDir);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Ordenar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="totalSpent:desc">Maior valor</SelectItem>
                    <SelectItem value="totalOrders:desc">Mais pedidos</SelectItem>
                    <SelectItem value="createdAt:desc">Cadastro recente</SelectItem>
                    <SelectItem value="firstPurchaseAt:desc">1ª compra recente</SelectItem>
                    <SelectItem value="lastPurchaseAt:desc">Última compra recente</SelectItem>
                    <SelectItem value="name:asc">Nome A-Z</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {data?.segmentCounts && data.segmentCounts.length > 0 && (
              <div className="mt-4 flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
                {data.segmentCounts.map((seg) => (
                  <div
                    key={seg.segment}
                    className="flex-shrink-0 bg-muted/60 border border-border px-3 py-1.5 rounded-full text-xs flex items-center gap-2"
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${SEGMENT_DOT[seg.segment] ?? "bg-gray-400"}`}
                      aria-hidden
                    />
                    <span className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">
                      {seg.segment}
                    </span>
                    <span className="font-semibold tabular-nums">{formatNumber(seg.count)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Table */}
      {isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Failed to load customers.{" "}
            <Button variant="link" className="p-0 h-auto text-destructive-foreground font-semibold" onClick={() => refetch()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <motion.div variants={cardVariants}>
          <Card>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-mono uppercase tracking-wider text-[10px]">Customer</TableHead>
                    <TableHead className="font-mono uppercase tracking-wider text-[10px]">Doc</TableHead>
                    <TableHead className="font-mono uppercase tracking-wider text-[10px]">Location</TableHead>
                    <TableHead className="font-mono uppercase tracking-wider text-[10px]">Source</TableHead>
                    <TableHead className="font-mono uppercase tracking-wider text-[10px]">Campaign</TableHead>
                    <TableHead className="font-mono uppercase tracking-wider text-[10px]">Segment</TableHead>
                    <TableHead className="font-mono uppercase tracking-wider text-[10px]">Opportunity</TableHead>
                    <TableHead className="font-mono uppercase tracking-wider text-[10px] text-right">Orders</TableHead>
                    <TableHead className="font-mono uppercase tracking-wider text-[10px] text-right">Spent</TableHead>
                    <TableHead className="font-mono uppercase tracking-wider text-[10px] text-right">First Purchase</TableHead>
                    <TableHead className="font-mono uppercase tracking-wider text-[10px] text-right">Last Purchase</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && !data ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-24 mt-1" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-12 rounded-full" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-12 rounded-full" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-8 ml-auto" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                        <TableCell />
                      </TableRow>
                    ))
                  ) : filteredCustomers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={12} className="p-0">
                        <EmptyState
                          icon={Inbox}
                          title="No customers match these filters"
                          description="Try widening the date range or clearing search and segment filters."
                          className="m-4 border-0 bg-transparent"
                        />
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredCustomers.map((customer) => {
                      const isMatched = customer.id === matchedCustomerId;
                      const opportunityLevel = customer.opportunityLevel ?? "LOW";

                      return (
                        <TableRow
                          key={customer.id}
                          ref={isMatched ? highlightedRowRef : undefined}
                          className={`cursor-pointer hover:bg-muted/40 transition-colors ${
                            isMatched
                              ? "bg-primary/10 ring-2 ring-primary/40 transition-colors duration-500"
                              : ""
                          }`}
                          onClick={() => navigate(`/customers/${customer.id}`)}
                          data-testid={isMatched ? "customer-row-highlighted" : `customer-row-${customer.id}`}
                        >
                          <TableCell>
                            <div className="flex items-start gap-2">
                              <span
                                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[customer.registrationStatus] ?? "bg-zinc-400"}`}
                                title={customer.registrationStatus}
                                aria-label={customer.registrationStatus}
                              />
                              <div className="min-w-0">
                                <div className="font-medium">{customer.name || "Unknown"}</div>
                                <div className="text-xs text-muted-foreground">{customer.email}</div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            {customer.documentType ? (
                              <Badge
                                variant="outline"
                                className="border-transparent bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300 text-[10px]"
                              >
                                {customer.documentType}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">
                            {[customer.city, customer.state].filter(Boolean).join(", ") || "—"}
                          </TableCell>
                          <TableCell>
                            {customer.utmSource ? (
                              <Badge variant="outline" className="text-xs border-border">
                                {customer.utmSource}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-xs">Direct</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {(customer.utmSource || customer.utmCampaign) ? (
                              <Badge
                                variant="outline"
                                className="text-[10px] border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                                title={customer.utmCampaign ?? customer.utmSource ?? undefined}
                              >
                                Yes
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="text-[10px] border-transparent bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                              >
                                No
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {customer.rfmSegment ? (
                              <Badge variant="outline" className={`border-transparent ${getRfmColor(customer.rfmSegment)}`}>
                                {customer.rfmSegment}
                              </Badge>
                            ) : "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`border-transparent text-xs ${OPPORTUNITY_COLOR[opportunityLevel]}`}>
                              {opportunityLevel}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">{formatNumber(customer.totalOrders)}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(customer.totalSpent)}</TableCell>
                          <TableCell className="text-right text-muted-foreground text-sm">
                            {customer.firstPurchaseAt ? format(new Date(customer.firstPurchaseAt), "MMM d, yyyy") : "—"}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground text-sm">
                            {customer.lastPurchaseAt ? format(new Date(customer.lastPurchaseAt), "MMM d, yyyy") : "—"}
                          </TableCell>
                          <TableCell>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
            {data && data.pages > 1 && (
              <div className="p-4 border-t flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  Showing page {data.page} of {data.pages} ({formatNumber(data.total)} total)
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === data.pages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </motion.div>
      )}
    </motion.div>
  );
}
