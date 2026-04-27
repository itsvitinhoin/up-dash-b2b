import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format } from "date-fns";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import {
  useGetSellers,
  useGetInsight,
  useRegenerateInsight,
  getGetInsightQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertCircle, Trophy, ShoppingBag, DollarSign, Download, Users, Crown, BarChart3,
  Sparkles, RefreshCw, X as XIcon, ChevronRight,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { exportRowsAsCsv } from "@/lib/csv-export";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { CountUp } from "@/components/count-up";
import { cardEntry, staggerContainer, useReducedMotion, withReducedMotion } from "@/lib/motion";

const CHART_MAX = 15;
const BAR_PALETTE = [
  "hsl(var(--chart-1))",
  "hsl(var(--primary))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-4))",
];

export default function SellersPage() {
  const { selectedClientId, user } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [limit, setLimit] = useState(25);
  const [insightDismissed, setInsightDismissed] = useState(false);
  const reduced = useReducedMotion();
  const containerVariants = withReducedMotion(staggerContainer, reduced);
  const cardVariants = withReducedMotion(cardEntry, reduced);

  const clientId = user?.role === "ADMIN" ? selectedClientId || undefined : undefined;
  const enabled = user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId);
  const { dateRange, filters } = useDashboardFilters();
  const dateFrom = format(dateRange.from, "yyyy-MM-dd");
  const dateTo = format(dateRange.to, "yyyy-MM-dd");

  const { data, isLoading, isError, refetch } = useGetSellers(
    { clientId, limit, state: filters.state || undefined },
    { query: queryOpts({ enabled }) },
  );

  const insightParams = { clientId, dateFrom, dateTo, screen: "sellers" as const };
  const { data: insight, isLoading: insightLoading } = useGetInsight(insightParams, {
    query: queryOpts({ enabled, staleTime: 3_600_000 }),
  });
  const regenerate = useRegenerateInsight({
    mutation: {
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: getGetInsightQueryKey(insightParams) }),
    },
  });

  const totalRevenue = useMemo(
    () => (data ?? []).reduce((s, x) => s + (x.totalRevenue || 0), 0),
    [data],
  );
  const activeSellers = data?.length ?? 0;
  const topSeller = data?.[0];
  const topRevenue = topSeller?.totalRevenue ?? 0;

  const chartData = useMemo(
    () =>
      (data ?? []).slice(0, CHART_MAX).map((s, i) => ({
        rank: i + 1,
        name: s.name,
        revenue: s.totalRevenue,
        orders: s.totalOrders,
        share: totalRevenue > 0 ? (s.totalRevenue / totalRevenue) * 100 : 0,
      })),
    [data, totalRevenue],
  );

  return (
    <motion.div
      className="space-y-6"
      data-testid="page-sellers"
      initial="hidden"
      animate="visible"
      variants={containerVariants}
    >
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
              Top {limit}
            </span>{" "}
            Sellers
          </span>
        </div>
        <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (!data) return;
            exportRowsAsCsv(
              `sellers-${new Date().toISOString().slice(0, 10)}.csv`,
              data,
              [
                { header: "id", accessor: (r) => r.id },
                { header: "name", accessor: (r) => r.name },
                { header: "email", accessor: (r) => r.email ?? "" },
                { header: "totalOrders", accessor: (r) => r.totalOrders },
                { header: "totalRevenue", accessor: (r) => r.totalRevenue },
                { header: "avgTicket", accessor: (r) => r.avgTicket },
              ],
            );
          }}
          disabled={!data?.length}
          data-testid="sellers-export"
        >
          <Download className="h-4 w-4 mr-1.5" />
          Export CSV
        </Button>
        <div className="flex items-center gap-2 bg-card p-1 rounded-md border border-border">
          <span className="text-sm font-medium text-muted-foreground px-2">Show top</span>
          <Select value={limit.toString()} onValueChange={(val) => setLimit(Number(val))}>
            <SelectTrigger className="w-[80px] border-none shadow-none h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="25">25</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
        </div>
        </div>
      </div>

      {/* Hero KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <motion.div variants={cardVariants}>
          <Card className="p-5 bg-gradient-to-br from-primary/[0.04] via-card to-card border-border relative overflow-hidden">
            <div
              aria-hidden
              className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-primary via-chart-3 to-chart-1 opacity-80"
            />
            <div className="flex items-center gap-2 mb-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary">
                <DollarSign className="h-3.5 w-3.5" />
              </div>
              <span className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">
                Total Revenue
              </span>
            </div>
            {isLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="text-2xl font-semibold tracking-tight tabular-nums bg-gradient-to-br from-foreground via-foreground to-primary bg-clip-text text-transparent">
                <CountUp value={totalRevenue} format={(v) => formatCurrency(v)} />
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Across top {activeSellers} sellers
            </p>
          </Card>
        </motion.div>

        <motion.div variants={cardVariants}>
          <Card className="p-5 border-border">
            <div className="flex items-center gap-2 mb-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-violet-500/15 text-violet-400">
                <Users className="h-3.5 w-3.5" />
              </div>
              <span className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">
                Active Sellers
              </span>
            </div>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-semibold tracking-tight tabular-nums">
                <CountUp value={activeSellers} format={(v) => formatNumber(Math.round(v))} />
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Ranked by revenue contribution
            </p>
          </Card>
        </motion.div>

        <motion.div variants={cardVariants}>
          <Card className="p-5 border-border">
            <div className="flex items-center gap-2 mb-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-500/15 text-amber-400">
                <Crown className="h-3.5 w-3.5" />
              </div>
              <span className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">
                Top Seller
              </span>
            </div>
            {isLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : topSeller ? (
              <>
                <div className="text-base font-semibold tracking-tight truncate" title={topSeller.name}>
                  {topSeller.name}
                </div>
                <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                  {formatCurrency(topSeller.totalRevenue)} ·{" "}
                  {formatNumber(topSeller.totalOrders)} orders
                </p>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">—</div>
            )}
          </Card>
        </motion.div>
      </div>

      {/* AI Insight card */}
      {!insightDismissed && (
        <motion.div variants={cardVariants}>
          <Card className="p-5 bg-gradient-to-br from-primary/[0.04] via-card to-card border-border relative overflow-hidden" data-testid="sellers-insight-card">
            <div aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-primary via-chart-3 to-chart-1 opacity-80" />
            <div className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-primary/10 blur-2xl pointer-events-none" />
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-3">
                <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/15 text-primary text-[10px] font-semibold uppercase tracking-wider">
                  <Sparkles className="h-3 w-3" />
                  UP Insight · Sellers · {insight?.source === "ai" ? "AI" : "Auto"}
                </span>
                <button
                  type="button"
                  onClick={() => setInsightDismissed(true)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Dismiss insight"
                  data-testid="sellers-insight-dismiss"
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
                  data-testid="sellers-insight-regenerate"
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

      {/* Revenue contribution chart */}
      <motion.div variants={cardVariants}>
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary">
                <BarChart3 className="h-3.5 w-3.5" />
              </div>
              <span className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">
                Revenue Contribution
                {chartData.length > 0 && (
                  <span className="ml-1 text-muted-foreground/60">
                    · Top {chartData.length}
                  </span>
                )}
              </span>
            </div>
            {chartData.length > 0 && (
              <div className="hidden sm:flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                <span
                  className="h-2 w-3 rounded-sm"
                  style={{ background: "hsl(var(--chart-1))" }}
                  aria-hidden
                />
                <span>Higher = more revenue</span>
              </div>
            )}
          </div>

          {isLoading && !data ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton
                    className="h-4"
                    style={{ width: `${100 - i * 12}%` }}
                  />
                </div>
              ))}
            </div>
          ) : chartData.length === 0 ? (
            <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">
              No seller revenue to chart yet
            </div>
          ) : (
            <div
              style={{ height: Math.max(220, chartData.length * 32 + 20) }}
              data-testid="sellers-revenue-chart"
              role="img"
              aria-label={`Horizontal bar chart of revenue contribution for the top ${chartData.length} sellers. Leader ${chartData[0]?.name} with ${formatCurrency(chartData[0]?.revenue ?? 0)} accounts for ${chartData[0]?.share.toFixed(1)}% of total revenue.`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  layout="vertical"
                  margin={{ top: 4, right: 24, left: 0, bottom: 4 }}
                  barCategoryGap={6}
                >
                  <defs>
                    <linearGradient id="sellerBarTop" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.95} />
                      <stop offset="100%" stopColor="hsl(var(--chart-3))" stopOpacity={0.7} />
                    </linearGradient>
                    <linearGradient id="sellerBarRest" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.55} />
                      <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0.25} />
                    </linearGradient>
                  </defs>
                  <XAxis type="number" hide domain={[0, "dataMax"]} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={150}
                    tickLine={false}
                    axisLine={false}
                    interval={0}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const p = payload[0].payload as (typeof chartData)[number];
                      return (
                        <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">
                          <div className="font-medium">
                            #{p.rank} · {p.name}
                          </div>
                          <div className="text-muted-foreground tabular-nums">
                            {formatCurrency(p.revenue)} · {formatNumber(p.orders)} orders
                          </div>
                          <div className="text-muted-foreground/70 tabular-nums">
                            {p.share.toFixed(1)}% of total
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Bar
                    dataKey="revenue"
                    radius={[0, 4, 4, 0]}
                    isAnimationActive={!reduced}
                    animationDuration={700}
                  >
                    {chartData.map((entry) => (
                      <Cell
                        key={entry.rank}
                        fill={
                          entry.rank === 1
                            ? "url(#sellerBarTop)"
                            : entry.rank <= 3
                              ? BAR_PALETTE[entry.rank - 1]
                              : "url(#sellerBarRest)"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              {/* Screen-reader fallback: same info as the visual chart, in
                  table form, since the Recharts tooltip is hover-only. */}
              <table className="sr-only">
                <caption>Revenue contribution by seller, top {chartData.length}</caption>
                <thead>
                  <tr>
                    <th scope="col">Rank</th>
                    <th scope="col">Seller</th>
                    <th scope="col">Revenue</th>
                    <th scope="col">Orders</th>
                    <th scope="col">Share of total</th>
                  </tr>
                </thead>
                <tbody>
                  {chartData.map((row) => (
                    <tr key={row.rank}>
                      <td>{row.rank}</td>
                      <td>{row.name}</td>
                      <td>{formatCurrency(row.revenue)}</td>
                      <td>{formatNumber(row.orders)}</td>
                      <td>{row.share.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </motion.div>

      {isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            Failed to load sellers.
            <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="space-y-4">
          {isLoading && !data ? (
            Array.from({ length: 5 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4 flex items-center gap-4">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                  <div className="hidden sm:block space-y-2 text-right">
                    <Skeleton className="h-4 w-24 ml-auto" />
                    <Skeleton className="h-3 w-16 ml-auto" />
                  </div>
                </CardContent>
              </Card>
            ))
          ) : data?.length === 0 ? (
            <EmptyState
              icon={Trophy}
              title="No seller activity yet"
              description="Once orders are attributed to sellers in the selected window, they'll appear ranked here."
            />
          ) : (
            data?.map((seller, index) => {
              const isTop3 = index < 3;
              const sharePct =
                topRevenue > 0
                  ? Math.max(2, (seller.totalRevenue / topRevenue) * 100)
                  : 0;

              return (
                <motion.div
                  key={seller.id}
                  layout={!reduced}
                  initial={reduced ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: reduced ? 0 : 0.25,
                    delay: reduced ? 0 : Math.min(index * 0.03, 0.3),
                  }}
                >
                <Card
                  className={`overflow-hidden transition-all hover:shadow-md relative cursor-pointer ${isTop3 ? 'border-primary/20 shadow-sm' : ''}`}
                  onClick={() => navigate(`/sellers/${seller.id}`)}
                  data-testid={`seller-row-${seller.id}`}
                >
                  <CardContent className="p-0">
                    <div className="flex items-center p-4 sm:p-6 gap-4 sm:gap-6 relative">
                      {isTop3 && (
                        <div className={`absolute top-0 bottom-0 left-0 w-1 ${
                          index === 0 ? 'bg-amber-400' : 
                          index === 1 ? 'bg-zinc-300' : 
                          'bg-amber-600'
                        }`} />
                      )}
                      
                      <div className={`flex items-center justify-center font-bold ${
                        index === 0 ? 'text-amber-500 h-10 w-10 text-2xl' : 
                        index === 1 ? 'text-zinc-500 h-8 w-8 text-xl' : 
                        index === 2 ? 'text-amber-700 h-8 w-8 text-xl' : 
                        'text-muted-foreground h-8 w-8 text-lg'
                      }`}>
                        #{index + 1}
                      </div>
                      
                      <Avatar className="h-12 w-12 border">
                        <AvatarFallback className="bg-primary/5 text-primary">
                          {seller.name.charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                      
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-lg truncate">{seller.name}</h3>
                        <p className="text-sm text-muted-foreground truncate">{seller.email || 'No email'}</p>
                      </div>
                      
                      <div className="hidden md:flex items-center gap-8 text-right">
                        <div>
                          <p className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground flex items-center justify-end gap-1 mb-1">
                            <ShoppingBag className="h-3 w-3" /> Orders
                          </p>
                          <p className="font-medium tabular-nums">{formatNumber(seller.totalOrders)}</p>
                        </div>
                        <div>
                          <p className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground flex items-center justify-end gap-1 mb-1">
                            <DollarSign className="h-3 w-3" /> Avg Ticket
                          </p>
                          <p className="font-medium tabular-nums">{formatCurrency(seller.avgTicket)}</p>
                        </div>
                        <div className="w-32">
                          <p className="font-mono uppercase tracking-wider text-[10px] text-primary mb-1">Revenue</p>
                          <p className={`text-xl font-bold tabular-nums ${
                            index === 0
                              ? "bg-gradient-to-br from-foreground via-foreground to-primary bg-clip-text text-transparent"
                              : ""
                          }`}>
                            {formatCurrency(seller.totalRevenue)}
                          </p>
                        </div>
                      </div>

                      <ChevronRight className="hidden md:block h-4 w-4 text-muted-foreground/50 shrink-0 ml-1" />

                      {/* Mobile stats */}
                      <div className="md:hidden text-right">
                        <p className="text-sm font-bold text-primary">{formatCurrency(seller.totalRevenue)}</p>
                        <p className="text-xs text-muted-foreground">{formatNumber(seller.totalOrders)} ord</p>
                      </div>
                    </div>

                    {/* Revenue share rail — visualises this seller's revenue
                        as % of the rank-#1 seller, so the list itself reads
                        as a horizontal bar chart, not just text rows. */}
                    <div
                      className="relative h-[3px] w-full bg-muted/40"
                      aria-hidden
                    >
                      <motion.div
                        className={`absolute inset-y-0 left-0 ${
                          index === 0
                            ? "bg-gradient-to-r from-primary via-chart-3 to-chart-1"
                            : index === 1
                              ? "bg-zinc-400/70"
                              : index === 2
                                ? "bg-amber-600/70"
                                : "bg-primary/35"
                        }`}
                        initial={reduced ? false : { width: 0 }}
                        animate={{ width: `${sharePct}%` }}
                        transition={{
                          duration: reduced ? 0 : 0.7,
                          delay: reduced ? 0 : 0.1 + Math.min(index * 0.04, 0.4),
                          ease: "easeOut",
                        }}
                      />
                    </div>
                  </CardContent>
                </Card>
                </motion.div>
              );
            })
          )}
        </div>
      )}
    </motion.div>
  );
}
