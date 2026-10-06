import { GlassMetricCard } from "@/components/glass-metric-card";
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
import { formatCurrency, formatCurrencySmart, formatNumber } from "@/lib/formatters";
import { exportRowsAsCsv } from "@/lib/csv-export";
import { CountUp } from "@/components/count-up";
import { BrazilHeatMap } from "@/components/brazil-heat-map";
import { useReducedMotion, fadeInUp, withReducedMotion } from "@/lib/motion";

export default function GeographyPage() {
  const { selectedClientId, user } = useAuth();
  const { dateRange, filters } = useDashboardFilters();
  const reduced = useReducedMotion();
  const variants = withReducedMotion(fadeInUp, reduced);
  const [view, setView] = useState<"state" | "city">("state");

  const clientId = user?.role === "ADMIN" ? selectedClientId || undefined : undefined;

  const { data, isLoading, isError, refetch } = useGetGeography(
    {
      clientId,
      dateFrom: format(dateRange.from, "yyyy-MM-dd"),
      dateTo: format(dateRange.to, "yyyy-MM-dd"),
      utmSource: filters.utmSource || undefined,
      utmMedium: filters.utmMedium || undefined,
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
            Atualizado · {format(dateRange.from, "MMM d")} → {format(dateRange.to, "MMM d, yyyy")}
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
          Exportar CSV
        </Button>
      </div>

      {isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Erro</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            Não foi possível carregar os dados geográficos.
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" /> Tentar novamente
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
                      Inteligência geográfica
                    </span>
                    <h2 className="mt-2 text-3xl sm:text-4xl font-bold tracking-tight">
                      Onde estão seus clientes{" "}
                      <span className="bg-gradient-to-r from-primary via-chart-1 to-chart-3 bg-clip-text text-transparent">
                        buying
                      </span>
                    </h2>
                    <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                      Mapa do faturamento no Brasil. O tamanho das bolhas indica o número de clientes e os tons de azul indicam a intensidade do faturamento.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 lg:max-w-2xl">
                    <HeroStat
                      icon={TrendingUp}
                      label="Faturamento total"
                      value={totalRevenue}
                      format={(v) => formatCurrencySmart(v)}
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
                      label="Cidades"
                      value={cities.length}
                      color="hsl(var(--chart-4))"
                      delay={0.19}
                      reduced={reduced}
                    />
                    <HeroStat
                      icon={Trophy}
                      label={topState ? `Top · ${topState.state}` : "Principal mercado"}
                      value={topState?.revenue ?? 0}
                      format={(v) => formatCurrencySmart(v)}
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
                      Mapa de faturamento no Brasil
                    </h3>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {states.length} estados · {cities.length} cities
                    </span>
                  </div>
                  {isLoading ? (
                    <Skeleton className="h-[480px] w-full rounded-md" />
                  ) : states.length === 0 ? (
                    <EmptyState
                      icon={MapPin}
                      title="Sem vendas por região"
                      description="Quando os pedidos forem enviados, o mapa por estado aparecerá aqui."
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
                      Mercados em destaque
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
                      Sem dados neste período.
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
                                  {formatNumber(s.customers)} clientes · {formatNumber(s.orders)} pedidos
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
                        <Activity className="h-3 w-3" /> Cidade em destaque
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
                            {formatNumber(topCity.orders)} pedidos
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
                    {view === "state" ? "Todos os estados" : "Todas as cidades"}
                  </h3>
                  <div className="inline-flex rounded-md border border-border bg-card/60 p-0.5 text-[11px] font-mono uppercase tracking-wider">
                    <Button variant="ghost" size="sm"
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
                    </Button>
                    <Button variant="ghost" size="sm"
                      type="button"
                      onClick={() => setView("city")}
                      data-testid="geo-toggle-city"
                      className={`px-2.5 py-1 rounded-sm transition ${
                        view === "city"
                          ? "bg-primary/15 text-primary"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Cidade
                    </Button>
                  </div>
                </div>

                <div className="overflow-x-auto max-h-[460px]">
                  {view === "state" ? (
                    <Table>
                      <TableHeader className="sticky top-0 bg-card z-10">
                        <TableRow>
                          <TableHead>State</TableHead>
                          <TableHead className="text-right">Clientes</TableHead>
                          <TableHead className="text-right">Pedidos</TableHead>
                          <TableHead className="text-right">Faturamento</TableHead>
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
                                title="Sem vendas por região"
                                description="Quando os pedidos forem enviados, o detalhamento por estado aparecerá aqui."
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
                          <TableHead>Cidade</TableHead>
                          <TableHead>State</TableHead>
                          <TableHead className="text-right">Pedidos</TableHead>
                          <TableHead className="text-right">Faturamento</TableHead>
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
                                title="Sem dados de cidades"
                                description="Quando houver pedidos, as cidades com melhor desempenho aparecerão aqui."
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
                    {formatNumber(totalCustomers)} clientes únicos entre {states.length} states
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
  const accent = tone === "hot" ? "hsl(var(--chart-1))" : color;
  return (<GlassMetricCard label={label} value={value} icon={Icon} format={format ?? formatNumber} />);
}
