import { useMemo, useState } from "react";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import { useGetGeography } from "@workspace/api-client-react";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertCircle,
  RefreshCw,
  Download,
  MapPin,
  Globe2,
  Trophy,
  TrendingUp,
  Building2,
  Activity,
  Flame,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import { exportRowsAsCsv } from "@/lib/csv-export";
import { CountUp } from "@/components/count-up";
import { BrazilHeatMap } from "@/components/brazil-heat-map";
import { useReducedMotion, fadeInUp, withReducedMotion } from "@/lib/motion";

export default function GeographyPage() {
  const { selectedClientId, user } = useAuth();
  const { dateRange } = useDashboardFilters();
  const reduced = useReducedMotion();
  const variants = withReducedMotion(fadeInUp, reduced);
  const [view, setView] = useState<"state" | "city">("state");

  const clientId = user?.role === "ADMIN" ? selectedClientId || undefined : undefined;

  const { data, isLoading, isError, refetch } = useGetGeography(
    {
      clientId,
      dateFrom: format(dateRange.from, "yyyy-MM-dd"),
      dateTo: format(dateRange.to, "yyyy-MM-dd"),
    },
    {
      query: queryOpts({
        enabled: user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId),
      }),
    },
  );

  const states = useMemo(() => data?.states ?? [], [data]);
  const cities = useMemo(() => data?.cities ?? [], [data]);

  const sortedStates = useMemo(
    () => [...states].sort((a, b) => b.revenue - a.revenue),
    [states],
  );
  const sortedCities = useMemo(
    () => [...cities].sort((a, b) => b.revenue - a.revenue),
    [cities],
  );

  const totalRevenue = useMemo(
    () => states.reduce((acc, s) => acc + s.revenue, 0),
    [states],
  );
  const totalCustomers = useMemo(
    () => states.reduce((acc, s) => acc + s.customers, 0),
    [states],
  );
  const topState = sortedStates[0];
  const topCity = sortedCities[0];

  const handleExport = () => {
    if (!data) return;
    const rows = [
      ...states.map((s) => ({
        kind: "state",
        name: s.state,
        state: s.state,
        customers: s.customers,
        orders: s.orders,
        revenue: s.revenue,
      })),
      ...cities.map((c) => ({
        kind: "city",
        name: c.city,
        state: c.state,
        customers: 0,
        orders: c.orders,
        revenue: c.revenue,
      })),
    ];
    exportRowsAsCsv(
      `geography-${new Date().toISOString().slice(0, 10)}.csv`,
      rows,
      [
        { header: "kind", accessor: (r) => r.kind },
        { header: "name", accessor: (r) => r.name },
        { header: "state", accessor: (r) => r.state },
        { header: "customers", accessor: (r) => r.customers },
        { header: "orders", accessor: (r) => r.orders },
        { header: "revenue", accessor: (r) => r.revenue },
      ],
    );
  };

  return (
    <div className="space-y-6 pb-8" data-testid="page-geography">
      {/* Live indicator + export */}
      <div className="flex flex-wrap items-center justify-between gap-2">
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
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={!data}
          data-testid="geography-export"
        >
          <Download className="h-4 w-4 mr-1.5" />
          Export CSV
        </Button>
      </div>

      {isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            Failed to load geography data.
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" /> Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {/* ── Hero section ─────────────────────────────────────────────────── */}
          <motion.div initial="hidden" animate="visible" variants={variants}>
            <Card className="relative overflow-hidden border-border/60 bg-gradient-to-br from-primary/[0.08] via-card to-card">
              <div
                aria-hidden
                className="absolute -top-24 -right-24 h-72 w-72 rounded-full blur-3xl opacity-40"
                style={{ background: "radial-gradient(circle, hsl(var(--chart-1) / 0.45), transparent 65%)" }}
              />
              <div
                aria-hidden
                className="absolute -bottom-32 -left-20 h-72 w-72 rounded-full blur-3xl opacity-30"
                style={{ background: "radial-gradient(circle, hsl(var(--chart-3) / 0.45), transparent 65%)" }}
              />
              <div
                aria-hidden
                className="absolute inset-0 opacity-[0.06]"
                style={{
                  backgroundImage:
                    "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
                  backgroundSize: "32px 32px",
                  maskImage:
                    "radial-gradient(ellipse 80% 60% at 50% 50%, black 30%, transparent 100%)",
                  WebkitMaskImage:
                    "radial-gradient(ellipse 80% 60% at 50% 50%, black 30%, transparent 100%)",
                }}
              />
              <CardContent className="relative p-6 sm:p-8">
                <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
                  <div>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/60 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground backdrop-blur">
                      <Globe2 className="h-3 w-3 text-primary" />
                      Geographic intelligence
                    </span>
                    <h2 className="mt-2 text-3xl sm:text-4xl font-bold tracking-tight">
                      Where your customers are{" "}
                      <span className="bg-gradient-to-r from-primary via-chart-1 to-chart-3 bg-clip-text text-transparent">
                        buying
                      </span>
                    </h2>
                    <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                      A live heat map of revenue concentration across Brazil. Bubble size
                      reflects customer count; color shows revenue intensity. Top markets
                      pulse in red.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 lg:max-w-2xl">
                    <HeroStat
                      icon={TrendingUp}
                      label="Total revenue"
                      value={totalRevenue}
                      format={(v) => formatCurrency(v)}
                      color="hsl(var(--chart-1))"
                      delay={0.05}
                      reduced={reduced}
                    />
                    <HeroStat
                      icon={MapPin}
                      label="States covered"
                      value={states.length}
                      color="hsl(var(--chart-3))"
                      delay={0.12}
                      reduced={reduced}
                    />
                    <HeroStat
                      icon={Building2}
                      label="Cities"
                      value={cities.length}
                      color="hsl(var(--chart-4))"
                      delay={0.19}
                      reduced={reduced}
                    />
                    <HeroStat
                      icon={Trophy}
                      label={topState ? `Top · ${topState.state}` : "Top market"}
                      value={topState?.revenue ?? 0}
                      format={(v) => formatCurrency(v)}
                      tone="hot"
                      delay={0.26}
                      reduced={reduced}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* ── Heat map + leaderboard ──────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <motion.div
              className="lg:col-span-2"
              initial="hidden"
              animate="visible"
              variants={variants}
            >
              <Card className="overflow-hidden">
                <CardContent className="p-4 sm:p-6">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground/90 flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                      Brazil revenue heat map
                    </h3>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {states.length} states · {cities.length} cities
                    </span>
                  </div>
                  {isLoading ? (
                    <Skeleton className="h-[480px] w-full rounded-md" />
                  ) : states.length === 0 ? (
                    <EmptyState
                      icon={MapPin}
                      title="No regional sales yet"
                      description="Once orders ship to customers, you'll see a state-by-state heat map here."
                    />
                  ) : (
                    <BrazilHeatMap states={states} cities={cities} reduced={reduced} />
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* Leaderboard */}
            <motion.div initial="hidden" animate="visible" variants={variants}>
              <Card className="overflow-hidden h-full">
                <CardContent className="p-4 sm:p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground/90 flex items-center gap-2">
                      <Flame className="h-4 w-4 text-amber-500" />
                      Hot markets
                    </h3>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Top {Math.min(8, sortedStates.length)}
                    </span>
                  </div>
                  {isLoading ? (
                    <div className="space-y-2.5">
                      {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-11 w-full rounded-md" />
                      ))}
                    </div>
                  ) : sortedStates.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-8 text-center">
                      No data for this period.
                    </p>
                  ) : (
                    <ol className="space-y-2.5" data-testid="geo-leaderboard">
                      {sortedStates.slice(0, 8).map((s, i) => {
                        const pct = totalRevenue > 0 ? (s.revenue / totalRevenue) * 100 : 0;
                        const isTop = i < 3;
                        return (
                          <motion.li
                            key={s.state}
                            initial={{ opacity: 0, x: 10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.4, delay: reduced ? 0 : 0.1 + i * 0.05 }}
                            className="group relative overflow-hidden rounded-md border border-border/50 bg-card/50 p-2.5 hover:border-primary/40 transition"
                          >
                            {/* progress bar background */}
                            <motion.div
                              aria-hidden
                              className={`absolute inset-y-0 left-0 ${
                                isTop
                                  ? "bg-gradient-to-r from-amber-500/20 via-orange-500/15 to-red-500/10"
                                  : "bg-primary/8"
                              }`}
                              initial={{ width: 0 }}
                              animate={{ width: `${pct}%` }}
                              transition={{ duration: reduced ? 0 : 0.9, delay: reduced ? 0 : 0.2 + i * 0.05, ease: [0.22, 1, 0.36, 1] }}
                            />
                            <div className="relative flex items-center gap-2.5">
                              <span
                                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-bold ${
                                  i === 0
                                    ? "bg-red-500 text-white"
                                    : i === 1
                                      ? "bg-orange-500 text-white"
                                      : i === 2
                                        ? "bg-amber-500 text-white"
                                        : "bg-muted text-muted-foreground"
                                }`}
                              >
                                {s.state}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-baseline justify-between gap-2">
                                  <span className="text-sm font-semibold tabular-nums text-foreground">
                                    {formatCurrency(s.revenue)}
                                  </span>
                                  <span className="font-mono text-[10px] text-muted-foreground">
                                    {pct.toFixed(1)}%
                                  </span>
                                </div>
                                <div className="text-[11px] text-muted-foreground">
                                  {formatNumber(s.customers)} customers · {formatNumber(s.orders)} orders
                                </div>
                              </div>
                            </div>
                          </motion.li>
                        );
                      })}
                    </ol>
                  )}

                  {topCity && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: reduced ? 0 : 0.55 }}
                      className="mt-4 rounded-md border border-dashed border-border/60 bg-muted/30 p-3"
                    >
                      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1.5">
                        <Activity className="h-3 w-3" /> Hottest city
                      </p>
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {topCity.city}
                            <span className="ml-1.5 text-[10px] font-mono text-muted-foreground">
                              {topCity.state}
                            </span>
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {formatNumber(topCity.orders)} orders
                          </p>
                        </div>
                        <span className="text-base font-bold tabular-nums text-foreground">
                          {formatCurrency(topCity.revenue)}
                        </span>
                      </div>
                    </motion.div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </div>

          {/* ── Detail table ────────────────────────────────────────────────── */}
          <motion.div initial="hidden" animate="visible" variants={variants}>
            <Card className="overflow-hidden">
              <CardContent className="p-4 sm:p-6">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground/90 flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    {view === "state" ? "All states" : "All cities"}
                  </h3>
                  <div className="inline-flex rounded-md border border-border bg-card/60 p-0.5 text-[11px] font-mono uppercase tracking-wider">
                    <button
                      type="button"
                      onClick={() => setView("state")}
                      data-testid="geo-toggle-state"
                      className={`px-2.5 py-1 rounded-sm transition ${
                        view === "state"
                          ? "bg-primary/15 text-primary"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      State
                    </button>
                    <button
                      type="button"
                      onClick={() => setView("city")}
                      data-testid="geo-toggle-city"
                      className={`px-2.5 py-1 rounded-sm transition ${
                        view === "city"
                          ? "bg-primary/15 text-primary"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      City
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto max-h-[460px]">
                  {view === "state" ? (
                    <Table>
                      <TableHeader className="sticky top-0 bg-card z-10">
                        <TableRow>
                          <TableHead>State</TableHead>
                          <TableHead className="text-right">Customers</TableHead>
                          <TableHead className="text-right">Orders</TableHead>
                          <TableHead className="text-right">Revenue</TableHead>
                          <TableHead className="text-right">Share</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {isLoading ? (
                          Array.from({ length: 5 }).map((_, i) => (
                            <TableRow key={i}>
                              <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                              <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                              <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                              <TableCell><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                              <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                            </TableRow>
                          ))
                        ) : sortedStates.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={5} className="p-0">
                              <EmptyState
                                icon={MapPin}
                                title="No regional sales yet"
                                description="Once orders ship to customers, you'll see a state-by-state breakdown here."
                                className="m-4 border-0 bg-transparent"
                              />
                            </TableCell>
                          </TableRow>
                        ) : (
                          sortedStates.map((state) => {
                            const pct = totalRevenue > 0 ? (state.revenue / totalRevenue) * 100 : 0;
                            return (
                              <TableRow key={state.state}>
                                <TableCell className="font-medium font-mono">{state.state}</TableCell>
                                <TableCell className="text-right tabular-nums">{formatNumber(state.customers)}</TableCell>
                                <TableCell className="text-right tabular-nums">{formatNumber(state.orders)}</TableCell>
                                <TableCell className="text-right font-medium tabular-nums">{formatCurrency(state.revenue)}</TableCell>
                                <TableCell className="text-right font-mono text-xs text-muted-foreground">{pct.toFixed(1)}%</TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  ) : (
                    <Table>
                      <TableHeader className="sticky top-0 bg-card z-10">
                        <TableRow>
                          <TableHead>City</TableHead>
                          <TableHead>State</TableHead>
                          <TableHead className="text-right">Orders</TableHead>
                          <TableHead className="text-right">Revenue</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {isLoading ? (
                          Array.from({ length: 8 }).map((_, i) => (
                            <TableRow key={i}>
                              <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                              <TableCell><Skeleton className="h-4 w-8" /></TableCell>
                              <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                              <TableCell><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                            </TableRow>
                          ))
                        ) : sortedCities.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={4} className="p-0">
                              <EmptyState
                                icon={MapPin}
                                title="No city-level data yet"
                                description="Once orders are placed, your top-performing cities will appear here."
                                className="m-4 border-0 bg-transparent"
                              />
                            </TableCell>
                          </TableRow>
                        ) : (
                          sortedCities.map((city, i) => (
                            <TableRow key={`${city.city}-${city.state}-${i}`}>
                              <TableCell className="font-medium">{city.city}</TableCell>
                              <TableCell className="font-mono text-xs">{city.state}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatNumber(city.orders)}</TableCell>
                              <TableCell className="text-right font-medium tabular-nums">{formatCurrency(city.revenue)}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  )}
                </div>

                {!isLoading && (totalCustomers > 0) && (
                  <p className="mt-3 text-[11px] text-muted-foreground font-mono uppercase tracking-wider">
                    {formatNumber(totalCustomers)} unique customers across {states.length} states
                  </p>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────

function HeroStat({
  icon: Icon,
  label,
  value,
  format,
  color = "hsl(var(--primary))",
  tone,
  delay,
  reduced,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  label: string;
  value: number;
  format?: (v: number) => string;
  color?: string;
  tone?: "hot";
  delay: number;
  reduced: boolean;
}) {
  const accent = tone === "hot" ? "hsl(0 84% 60%)" : color;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: reduced ? 0 : delay, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-lg border border-border/60 bg-card/70 p-3 backdrop-blur"
    >
      <div className="flex items-center gap-2">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-md ring-1 ring-border/40"
          style={{
            background:
              tone === "hot"
                ? "hsl(0 84% 60% / 0.14)"
                : `${color.replace(")", " / 0.15)")}`,
          }}
        >
          <Icon className="h-3.5 w-3.5" style={{ color: accent }} />
        </span>
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium truncate">
          {label}
        </span>
      </div>
      <CountUp
        value={value}
        format={format ?? formatNumber}
        duration={1100}
        className={`mt-1.5 block text-xl font-bold tabular-nums ${
          tone === "hot" ? "text-foreground" : "text-foreground"
        }`}
      />
    </motion.div>
  );
}
