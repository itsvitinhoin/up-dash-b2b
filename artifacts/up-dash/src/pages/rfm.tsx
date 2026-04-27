import { useState } from "react";
import { format } from "date-fns";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import { useGetRfm, useGetInsight, useRegenerateInsight, getGetInsightQueryKey } from "@workspace/api-client-react";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertCircle, RefreshCw, ChevronRight, Sparkles, X as XIcon, ChevronLeft, Lightbulb,
  BarChart3, Users,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import { CountUp } from "@/components/count-up";
import { useReducedMotion, fadeInUp, withReducedMotion } from "@/lib/motion";

const SEGMENT_META: Record<string, {
  label: string;
  color: string;
  bg: string;
  ring: string;
  description: string;
}> = {
  Champions: {
    label: "Champions",
    color: "#10b981",
    bg: "bg-emerald-500/10",
    ring: "ring-emerald-500/30",
    description: "Bought recently, buy often, spent the most",
  },
  Loyal: {
    label: "Loyal",
    color: "#6366f1",
    bg: "bg-indigo-500/10",
    ring: "ring-indigo-500/30",
    description: "Buy regularly and respond well to offers",
  },
  Potential: {
    label: "Potential",
    color: "#8b5cf6",
    bg: "bg-violet-500/10",
    ring: "ring-violet-500/30",
    description: "Recent buyers with average frequency",
  },
  "At Risk": {
    label: "At Risk",
    color: "#f59e0b",
    bg: "bg-amber-500/10",
    ring: "ring-amber-500/30",
    description: "Good customers who are becoming inactive",
  },
  Lost: {
    label: "Lost",
    color: "#6b7280",
    bg: "bg-zinc-500/10",
    ring: "ring-zinc-500/30",
    description: "Purchased long ago and haven't returned",
  },
};

const AREA_COLORS: Record<string, string> = {
  Champions: "#10b981",
  Loyal: "#6366f1",
  Potential: "#8b5cf6",
  AtRisk: "#f59e0b",
  Lost: "#6b7280",
};

function SegmentBadge({ segment }: { segment: string | null | undefined }) {
  if (!segment) return <Badge variant="outline" className="text-[10px]">—</Badge>;
  const meta = SEGMENT_META[segment];
  const color = meta?.color ?? "#9ca3af";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium"
      style={{ background: `${color}18`, color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {meta?.label ?? segment}
    </span>
  );
}

export default function RfmPage() {
  const { selectedClientId, user } = useAuth();
  const { dateRange } = useDashboardFilters();
  const reduced = useReducedMotion();
  const variants = withReducedMotion(fadeInUp, reduced);
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [insightDismissed, setInsightDismissed] = useState(false);
  const [segmentFilter, setSegmentFilter] = useState<string>("");
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<"name" | "segment" | "recencyDays" | "frequency" | "monetary">("monetary");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const limit = 20;

  const clientId = user?.role === "ADMIN" ? selectedClientId || undefined : undefined;
  const enabled = user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId);

  const { data, isLoading, isError, refetch } = useGetRfm(
    {
      clientId,
      dateFrom: format(dateRange.from, "yyyy-MM-dd"),
      dateTo: format(dateRange.to, "yyyy-MM-dd"),
      segment: segmentFilter && segmentFilter !== "all" ? segmentFilter : undefined,
      page,
      limit,
      sortBy,
      sortDir,
    },
    {
      query: queryOpts({ enabled, placeholderData: (prev) => prev }),
    }
  );

  const insightParams = {
    clientId,
    dateFrom: format(dateRange.from, "yyyy-MM-dd"),
    dateTo: format(dateRange.to, "yyyy-MM-dd"),
    screen: "rfm" as const,
  };
  const { data: insight, isLoading: insightLoading } = useGetInsight(
    insightParams,
    { query: queryOpts({ enabled }) }
  );
  const regenerate = useRegenerateInsight({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetInsightQueryKey(insightParams) }),
    },
  });

  const segments = data?.segments ?? [];
  const composition = data?.composition ?? [];
  const customers = data?.customers ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const handleSort = (col: typeof sortBy) => {
    if (col === sortBy) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir("desc");
    }
    setPage(1);
  };

  const SortIndicator = ({ col }: { col: string }) => (
    <span className="ml-1 text-[10px] text-muted-foreground">
      {sortBy === col ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
    </span>
  );

  return (
    <div className="space-y-6 pb-8" data-testid="page-rfm">
      <motion.div
        initial="hidden"
        animate="visible"
        variants={variants}
        className="flex items-center gap-2 text-xs text-muted-foreground"
      >
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
        </span>
        <span className="font-mono uppercase tracking-wider">
          Live · {format(dateRange.from, "MMM d")} → {format(dateRange.to, "MMM d, yyyy")}
        </span>
      </motion.div>

      {isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            Failed to load RFM data.
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" /> Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {/* AI Insight banner */}
          {!insightDismissed && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
              <Card className="relative overflow-hidden border-primary/20 bg-gradient-to-r from-primary/5 via-card to-card">
                <div aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-primary via-chart-3 to-chart-1" />
                <CardContent className="p-4 pl-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <Sparkles className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      {insightLoading ? (
                        <div className="space-y-1.5 flex-1">
                          <Skeleton className="h-4 w-48" />
                          <Skeleton className="h-3 w-full" />
                        </div>
                      ) : insight ? (
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground">{insight.headline}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{insight.body}</p>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={regenerate.isPending}
                        onClick={() => regenerate.mutate({ params: insightParams })}
                      >
                        <RefreshCw className={`h-3 w-3 mr-1 ${regenerate.isPending ? "animate-spin" : ""}`} />
                        Refresh
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setInsightDismissed(true)}>
                        <XIcon className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Segment Cards */}
          <motion.div initial="hidden" animate="visible" variants={variants}>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {(["Champions", "Loyal", "Potential", "At Risk", "Lost"] as const).map((seg) => {
                const meta = SEGMENT_META[seg];
                const segData = segments.find((s) => s.segment === seg);
                return (
                  <button
                    key={seg}
                    onClick={() => {
                      setSegmentFilter((prev) => (prev === seg ? "" : seg));
                      setPage(1);
                    }}
                    className={`rounded-xl border p-4 text-left transition-all hover:shadow-md ${
                      segmentFilter === seg
                        ? `ring-2 ${meta.ring} border-transparent`
                        : "border-border/60 hover:border-primary/30"
                    }`}
                    style={{ background: segmentFilter === seg ? `${meta.color}10` : undefined }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: meta.color }}
                      />
                      {isLoading ? (
                        <Skeleton className="h-3 w-8" />
                      ) : (
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {segData ? segData.pct.toFixed(1) : 0}%
                        </span>
                      )}
                    </div>
                    <p className="font-semibold text-sm" style={{ color: meta.color }}>{meta.label}</p>
                    <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">{meta.description}</p>
                    {isLoading ? (
                      <Skeleton className="h-5 w-16 mt-2" />
                    ) : (
                      <div className="mt-2 space-y-0.5">
                        <p className="text-lg font-bold tabular-nums">
                          {formatNumber(segData?.customerCount ?? 0)}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {formatCurrency(segData?.revenue ?? 0)} rev
                        </p>
                        <p className="text-[10px] font-semibold tabular-nums" style={{ color: meta.color }}>
                          avg {formatCurrency(segData?.avgTicket ?? 0)}
                        </p>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>

          {/* Composition Chart */}
          <motion.div initial="hidden" animate="visible" variants={variants}>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  Segment composition over time
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-52 w-full" />
                ) : composition.length === 0 ? (
                  <EmptyState icon={BarChart3} title="No segment history" description="Segment composition data will appear once purchases are recorded in this period." />
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={composition} margin={{ left: 0, right: 8 }}>
                      <defs>
                        {Object.entries(AREA_COLORS).map(([key, color]) => (
                          <linearGradient key={key} id={`rfmGrad-${key}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                            <stop offset="95%" stopColor={color} stopOpacity={0} />
                          </linearGradient>
                        ))}
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                      <XAxis
                        dataKey="month"
                        tick={{ fontSize: 10 }}
                        tickFormatter={(v) => v.slice(5)}
                        className="text-muted-foreground"
                      />
                      <YAxis tick={{ fontSize: 10 }} width={36} />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {Object.entries(AREA_COLORS).map(([key, color]) => (
                        <Area
                          key={key}
                          type="monotone"
                          dataKey={key}
                          name={key === "AtRisk" ? "At Risk" : key}
                          stroke={color}
                          fill={`url(#rfmGrad-${key})`}
                          strokeWidth={2}
                          dot={false}
                          stackId="a"
                        />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Customer Table */}
          <motion.div initial="hidden" animate="visible" variants={variants}>
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-chart-3" />
                    Customers
                    <span className="text-muted-foreground font-normal">({formatNumber(total)})</span>
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Select
                      value={segmentFilter || "all"}
                      onValueChange={(v) => { setSegmentFilter(v === "all" ? "" : v); setPage(1); }}
                    >
                      <SelectTrigger className="h-8 text-xs w-36">
                        <SelectValue placeholder="All segments" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All segments</SelectItem>
                        {(["Champions", "Loyal", "Potential", "At Risk", "Lost"] as const).map((s) => (
                          <SelectItem key={s} value={s}>{SEGMENT_META[s].label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead
                          className="cursor-pointer select-none text-xs"
                          onClick={() => handleSort("name")}
                        >
                          Customer <SortIndicator col="name" />
                        </TableHead>
                        <TableHead
                          className="cursor-pointer select-none text-xs"
                          onClick={() => handleSort("segment")}
                        >
                          Segment <SortIndicator col="segment" />
                        </TableHead>
                        <TableHead
                          className="cursor-pointer select-none text-xs text-right"
                          onClick={() => handleSort("recencyDays")}
                        >
                          Recency <SortIndicator col="recencyDays" />
                        </TableHead>
                        <TableHead
                          className="cursor-pointer select-none text-xs text-right"
                          onClick={() => handleSort("frequency")}
                        >
                          Frequency <SortIndicator col="frequency" />
                        </TableHead>
                        <TableHead
                          className="cursor-pointer select-none text-xs text-right"
                          onClick={() => handleSort("monetary")}
                        >
                          Monetary <SortIndicator col="monetary" />
                        </TableHead>
                        <TableHead className="w-8" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isLoading ? (
                        Array.from({ length: 8 }).map((_, i) => (
                          <TableRow key={i}>
                            <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                            <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                            <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                            <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                            <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                            <TableCell />
                          </TableRow>
                        ))
                      ) : customers.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="py-0">
                            <EmptyState icon={Users} title="No customers found" description="Try clearing the segment filter or selecting a broader date range." className="border-0 rounded-none" />
                          </TableCell>
                        </TableRow>
                      ) : (
                        customers.map((c) => (
                          <TableRow
                            key={c.id}
                            className="hover:bg-muted/30 cursor-pointer"
                            onClick={() => navigate(`/customers/${c.id}`)}
                          >
                            <TableCell>
                              <div>
                                <p className="text-sm font-medium">{c.name ?? "—"}</p>
                                <p className="text-[11px] text-muted-foreground">{c.email}</p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <SegmentBadge segment={c.segment} />
                            </TableCell>
                            <TableCell className="text-right text-sm tabular-nums">
                              {c.recencyDays != null ? `${c.recencyDays}d` : "—"}
                            </TableCell>
                            <TableCell className="text-right text-sm tabular-nums">
                              {formatNumber(c.frequency)}
                            </TableCell>
                            <TableCell className="text-right text-sm tabular-nums font-medium">
                              {formatCurrency(c.monetary)}
                            </TableCell>
                            <TableCell className="text-right">
                              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground ml-auto" />
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-border/40">
                    <span className="text-xs text-muted-foreground">
                      Page {page} of {totalPages} · {formatNumber(total)} customers
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        disabled={page >= totalPages}
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Insight bullets */}
          {insight && !insightLoading && insight.bullets.length > 0 && (
            <motion.div initial="hidden" animate="visible" variants={variants}>
              <div className="flex items-center gap-2 mb-3">
                <Lightbulb className="h-4 w-4 text-amber-500" />
                <h3 className="font-semibold text-sm">Key insights</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {insight.bullets.map((bullet, i) => (
                  <Card key={i} className="relative overflow-hidden border-border/60">
                    <div aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-amber-400 via-primary to-chart-3 opacity-70" />
                    <CardContent className="p-3 pl-5">
                      <div className="flex items-start gap-2">
                        <Sparkles className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                        <p className="text-xs leading-relaxed text-foreground/85">{bullet}</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}
