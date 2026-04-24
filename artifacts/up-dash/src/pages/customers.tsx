import { useEffect, useRef, useState } from "react";
import { useSearch, useLocation } from "wouter";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import { useGetCustomers, useGetCustomerSummary } from "@workspace/api-client-react";
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
  UserCheck, Users, UserX, Clock, TrendingUp, BarChart2, Globe
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
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

const SOURCE_COLORS = ["#6366f1", "#22d3ee", "#f59e0b", "#10b981", "#f43f5e", "#8b5cf6", "#ec4899", "#14b8a6"];

function readQueryParam(search: string, key: string): string {
  const trimmed = search.startsWith("?") ? search.slice(1) : search;
  if (!trimmed) return "";
  const params = new URLSearchParams(trimmed);
  return params.get(key) ?? "";
}

function SummaryKpiCard({
  label, value, sub, icon: Icon, loading,
}: {
  label: string;
  value: string;
  sub?: string;
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
        {sub && !loading && (
          <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
        )}
      </div>
    </div>
  );
}

type ChartTab = "timeline" | "state" | "source";

export default function CustomersPage() {
  const { selectedClientId, user } = useAuth();
  const { dateRange } = useDashboardFilters();
  const locationSearch = useSearch();
  const [, navigate] = useLocation();
  const urlSearch = readQueryParam(locationSearch, "search");
  const [search, setSearch] = useState(urlSearch);
  const debouncedSearch = useDebounce(search, 300);
  const [rfmSegment, setRfmSegment] = useState<string>("");
  const [state, setState] = useState<string>("");
  const [page, setPage] = useState(1);
  const [chartTab, setChartTab] = useState<ChartTab>("timeline");
  const [highlightTarget, setHighlightTarget] = useState<string | null>(
    urlSearch ? urlSearch.toLowerCase() : null,
  );
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
      search: debouncedSearch || undefined,
      rfmSegment: rfmSegment && rfmSegment !== "all" ? rfmSegment : undefined,
      state: state && state !== "all" ? state : undefined,
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
    dateFrom: dateRange?.from ?? undefined,
    dateTo: dateRange?.to ?? undefined,
    compare: true,
  };
  const { data: summary, isLoading: summaryLoading } = useGetCustomerSummary(
    summaryParams,
    { query: queryOpts({ enabled }) },
  );

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
    if (!data?.data) return;
    exportRowsAsCsv(
      `customers-${new Date().toISOString().slice(0, 10)}.csv`,
      data.data,
      [
        { header: "id", accessor: (r) => r.id },
        { header: "name", accessor: (r) => r.name ?? "" },
        { header: "email", accessor: (r) => r.email ?? "" },
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

  const totalCount = data?.total ?? 0;
  const segmentCount = data?.segmentCounts?.length ?? 0;
  const kpis = summary?.kpis;

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
            {segmentCount > 0 && (
              <span className="ml-2 text-muted-foreground/70">· {segmentCount} Segments</span>
            )}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={!data?.data?.length}
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
            sub={kpis?.approvalRatePct != null ? `${kpis.approvalRatePct.toFixed(1)}% approval rate` : undefined}
            icon={Users}
            loading={summaryLoading}
          />
          <SummaryKpiCard
            label="Approved"
            value={kpis ? formatNumber(kpis.approvedRegistrations) : "—"}
            icon={UserCheck}
            loading={summaryLoading}
          />
          <SummaryKpiCard
            label="Approval Rate"
            value={kpis ? `${kpis.approvalRatePct.toFixed(1)}%` : "—"}
            icon={TrendingUp}
            loading={summaryLoading}
          />
          <SummaryKpiCard
            label="Total Buyers"
            value={kpis ? formatNumber(kpis.totalBuyers) : "—"}
            icon={Users}
            loading={summaryLoading}
          />
          <SummaryKpiCard
            label="Without Purchase"
            value={kpis ? formatNumber(kpis.customersWithoutPurchase) : "—"}
            icon={UserX}
            loading={summaryLoading}
          />
          <SummaryKpiCard
            label="Avg Days to 1st Purchase"
            value={kpis?.avgTimeToFirstPurchaseDays != null ? `${kpis.avgTimeToFirstPurchaseDays}d` : "—"}
            icon={Clock}
            loading={summaryLoading}
          />
          <SummaryKpiCard
            label="Avg Days Between"
            value={kpis?.avgTimeBetweenPurchasesDays != null ? `${kpis.avgTimeBetweenPurchasesDays}d` : "—"}
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

      {/* Filters */}
      <motion.div variants={cardVariants}>
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col md:flex-row gap-4">
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
                    <TableHead className="font-mono uppercase tracking-wider text-[10px]">Location</TableHead>
                    <TableHead className="font-mono uppercase tracking-wider text-[10px]">Source</TableHead>
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
                        <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-8 ml-auto" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                        <TableCell />
                      </TableRow>
                    ))
                  ) : data?.data.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="p-0">
                        <EmptyState
                          icon={Inbox}
                          title="No customers match these filters"
                          description="Try widening the date range or clearing search and segment filters."
                          className="m-4 border-0 bg-transparent"
                        />
                      </TableCell>
                    </TableRow>
                  ) : (
                    data?.data.map((customer) => {
                      const isMatched = customer.id === matchedCustomerId;
                      const opportunityLevel = customer.rfmSegment === "Champions"
                        ? "CHAMPION"
                        : customer.rfmSegment === "Loyal"
                        ? "HIGH"
                        : customer.rfmSegment === "Potential"
                        ? "MEDIUM"
                        : customer.rfmSegment === "At Risk" || customer.rfmSegment === "Lost"
                        ? "LOW"
                        : customer.totalOrders > 5
                        ? "HIGH"
                        : customer.totalOrders > 0
                        ? "MEDIUM"
                        : "LOW";

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
                            <div className="font-medium">{customer.name || "Unknown"}</div>
                            <div className="text-xs text-muted-foreground">{customer.email}</div>
                          </TableCell>
                          <TableCell className="text-sm">
                            {customer.city && customer.state ? `${customer.city}, ${customer.state}` : "—"}
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
