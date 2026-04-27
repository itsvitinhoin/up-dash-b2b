import { useMemo } from "react";
import { format } from "date-fns";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import { useGetJourney, useGetInsight, useRegenerateInsight, getGetInsightQueryKey } from "@workspace/api-client-react";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertCircle, RefreshCw, Activity, Clock, Zap, Users, ArrowRight,
  Lightbulb, Sparkles, X as XIcon, Route,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend,
} from "recharts";
import { formatNumber } from "@/lib/formatters";
import { CountUp } from "@/components/count-up";
import { useReducedMotion, fadeInUp, withReducedMotion } from "@/lib/motion";
import { useState } from "react";

const SEGMENT_COLORS: Record<string, string> = {
  VISIT: "#6366f1",
  REGISTRATION: "#22d3ee",
  APPROVED_REGISTRATION: "#10b981",
  PRODUCT_VIEW: "#f59e0b",
  ADD_TO_CART: "#f97316",
  CHECKOUT_STARTED: "#ec4899",
  PURCHASE: "#8b5cf6",
};

function KpiCard({
  label,
  value,
  icon: Icon,
  color,
  loading,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
  loading: boolean;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 flex items-start gap-3">
      <span
        className="flex h-9 w-9 items-center justify-center rounded-lg ring-1 ring-border/40 shrink-0"
        style={{ background: `${color}18` }}
      >
        <Icon className="h-4 w-4" style={{ color }} />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground truncate">{label}</p>
        {loading ? (
          <Skeleton className="h-6 w-24 mt-1" />
        ) : (
          <p className="text-xl font-bold tabular-nums mt-0.5">{value}</p>
        )}
      </div>
    </div>
  );
}

export default function JourneyPage() {
  const { selectedClientId, user } = useAuth();
  const { dateRange, filters } = useDashboardFilters();
  const reduced = useReducedMotion();
  const variants = withReducedMotion(fadeInUp, reduced);
  const queryClient = useQueryClient();
  const [insightDismissed, setInsightDismissed] = useState(false);

  const clientId = user?.role === "ADMIN" ? selectedClientId || undefined : undefined;
  const enabled = user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId);

  const { data, isLoading, isError, refetch } = useGetJourney(
    {
      clientId,
      dateFrom: format(dateRange.from, "yyyy-MM-dd"),
      dateTo: format(dateRange.to, "yyyy-MM-dd"),
      utmSource: filters.utmSource || undefined,
      utmMedium: filters.utmMedium || undefined,
      state: filters.state || undefined,
      city: filters.city || undefined,
      product: filters.product || undefined,
    },
    {
      query: queryOpts({ enabled }),
    }
  );

  const insightParams = {
    clientId,
    dateFrom: format(dateRange.from, "yyyy-MM-dd"),
    dateTo: format(dateRange.to, "yyyy-MM-dd"),
    screen: "journey" as const,
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

  const kpis = data?.kpis;
  const topPaths = data?.topPaths ?? [];
  const eventNodes = data?.eventNodes ?? [];
  const eventEdges = data?.eventEdges ?? [];
  const buyers = data?.buyers;
  const nonBuyers = data?.nonBuyers;

  // Build chart data for buyers vs non-buyers
  const allEventTypes = useMemo(() => {
    const types = new Set<string>();
    buyers?.eventCounts.forEach((e) => types.add(e.eventType));
    nonBuyers?.eventCounts.forEach((e) => types.add(e.eventType));
    return Array.from(types);
  }, [buyers, nonBuyers]);

  const comparisonData = useMemo(() => {
    return allEventTypes.map((et) => {
      const buyerCount = buyers?.eventCounts.find((e) => e.eventType === et)?.count ?? 0;
      const nonBuyerCount = nonBuyers?.eventCounts.find((e) => e.eventType === et)?.count ?? 0;
      return { eventType: et.replace("_", " "), buyers: buyerCount, nonBuyers: nonBuyerCount };
    });
  }, [allEventTypes, buyers, nonBuyers]);

  return (
    <div className="space-y-6 pb-8" data-testid="page-journey">
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
            Failed to load journey data.
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

          {/* KPI Strip */}
          <motion.div initial="hidden" animate="visible" variants={variants}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KpiCard
                label="Avg events before purchase"
                value={isLoading ? "—" : kpis ? kpis.avgEventsBeforePurchase.toFixed(1) : "—"}
                icon={Activity}
                color="#6366f1"
                loading={isLoading}
              />
              <KpiCard
                label="Avg time to 1st purchase"
                value={isLoading ? "—" : kpis?.avgTimeToFirstPurchaseDays != null ? `${kpis.avgTimeToFirstPurchaseDays.toFixed(1)}d` : "—"}
                icon={Clock}
                color="#22d3ee"
                loading={isLoading}
              />
              <KpiCard
                label="Avg time between purchases"
                value={isLoading ? "—" : kpis?.avgTimeBetweenPurchasesDays != null ? `${kpis.avgTimeBetweenPurchasesDays.toFixed(1)}d` : "—"}
                icon={RefreshCw}
                color="#10b981"
                loading={isLoading}
              />
              <KpiCard
                label="Buyers from 1st session"
                value={isLoading ? "—" : kpis ? `${kpis.pctBuyersFromFirstSession.toFixed(1)}%` : "—"}
                icon={Zap}
                color="#f59e0b"
                loading={isLoading}
              />
            </div>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Event Flow Graph */}
            <motion.div className="lg:col-span-2" initial="hidden" animate="visible" variants={variants}>
              <Card className="h-full">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    Event flow graph
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <Skeleton className="h-72 w-full" />
                  ) : (
                    <EventFlowDiagram nodes={eventNodes} edges={eventEdges} />
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* Top Paths */}
            <motion.div initial="hidden" animate="visible" variants={variants}>
              <Card className="h-full">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-chart-3" />
                    Top paths to purchase
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {isLoading ? (
                    Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
                  ) : topPaths.length === 0 ? (
                    <EmptyState icon={Route} title="No purchase paths yet" description="Once customers complete purchases, their event sequences will appear here." />
                  ) : (
                    topPaths.map((path, i) => (
                      <div
                        key={i}
                        className="rounded-lg border border-border/60 bg-muted/20 p-3"
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <Badge variant="outline" className="text-[10px] font-mono">
                            #{i + 1}
                          </Badge>
                          <span className="text-[11px] font-mono text-muted-foreground">
                            {formatNumber(path.visitCount)} buyers · {path.conversionRate.toFixed(1)}%
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          {path.steps.map((step, si) => (
                            <span key={si} className="flex items-center gap-1">
                              <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                                {step}
                              </span>
                              {si < path.steps.length - 1 && (
                                <ArrowRight className="h-2.5 w-2.5 text-muted-foreground" />
                              )}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </div>

          {/* Buyers vs Non-Buyers Comparison */}
          <motion.div initial="hidden" animate="visible" variants={variants}>
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-chart-4" />
                    Buyers vs non-buyers — event comparison
                  </CardTitle>
                  <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-[#6366f1]" />
                      Buyers (avg {isLoading ? "—" : (buyers?.avgSessionDepth ?? 0).toFixed(1)} events/session)
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-[#f59e0b]" />
                      Non-buyers (avg {isLoading ? "—" : (nonBuyers?.avgSessionDepth ?? 0).toFixed(1)} events/session)
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-52 w-full" />
                ) : comparisonData.length === 0 ? (
                  <EmptyState icon={Activity} title="No event data" description="No visitor events were recorded in this date range." />
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={comparisonData} margin={{ left: 0, right: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                      <XAxis dataKey="eventType" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                      <YAxis tick={{ fontSize: 10 }} width={40} />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="buyers" name="Buyers" fill="#6366f1" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="nonBuyers" name="Non-buyers" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}

                {/* UTM / acquisition channel breakdown */}
                {!isLoading && ((buyers?.topUtmSources?.length ?? 0) > 0 || (nonBuyers?.topUtmSources?.length ?? 0) > 0) && (
                  <div className="mt-4 grid grid-cols-2 gap-4 border-t border-border/40 pt-4">
                    <div>
                      <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
                        Buyer UTM sources
                      </p>
                      <div className="space-y-1.5">
                        {(buyers?.topUtmSources ?? []).slice(0, 4).map((u) => (
                          <div key={u.source} className="flex items-center justify-between">
                            <span className="inline-flex items-center rounded-full bg-[#6366f1]/10 px-2 py-0.5 text-[10px] font-medium text-[#6366f1]">
                              {u.source}
                            </span>
                            <span className="text-[11px] font-mono tabular-nums text-muted-foreground">
                              {formatNumber(u.count)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
                        Non-buyer UTM sources
                      </p>
                      <div className="space-y-1.5">
                        {(nonBuyers?.topUtmSources ?? []).slice(0, 4).map((u) => (
                          <div key={u.source} className="flex items-center justify-between">
                            <span className="inline-flex items-center rounded-full bg-[#f59e0b]/10 px-2 py-0.5 text-[10px] font-medium text-[#f59e0b]">
                              {u.source}
                            </span>
                            <span className="text-[11px] font-mono tabular-nums text-muted-foreground">
                              {formatNumber(u.count)}
                            </span>
                          </div>
                        ))}
                      </div>
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

// ─────────────────────────────────────────────────────────────────────────
// Event Flow Diagram — layered SVG node-and-edge graph
// ─────────────────────────────────────────────────────────────────────────

interface FlowNode {
  id: string;
  label: string;
  count: number;
  layer: number;
}

interface FlowEdge {
  source: string;
  target: string;
  count: number;
}

function EventFlowDiagram({ nodes, edges }: { nodes: FlowNode[]; edges: FlowEdge[] }) {
  if (nodes.length === 0) {
    return (
      <EmptyState
        icon={Activity}
        title="No conversion journeys yet"
        description="Purchase-bounded event flows will appear here once buyers are recorded in this period."
        className="my-4"
      />
    );
  }

  const W = 760;
  const H = 300;
  const NODE_W = 90;
  const NODE_H = 36;

  // Group nodes by layer
  const layerMap = new Map<number, FlowNode[]>();
  for (const n of nodes) {
    const arr = layerMap.get(n.layer) ?? [];
    arr.push(n);
    layerMap.set(n.layer, arr);
  }
  const layers = Array.from(layerMap.keys()).sort((a, b) => a - b);
  const totalLayers = layers.length;

  // Position each node
  const nodePos = new Map<string, { x: number; y: number }>();
  for (const layer of layers) {
    const layerNodes = layerMap.get(layer)!;
    const x = (layers.indexOf(layer) / Math.max(totalLayers - 1, 1)) * (W - NODE_W - 20) + 10;
    layerNodes.forEach((n, i) => {
      const y = ((i + 0.5) / layerNodes.length) * H - NODE_H / 2;
      nodePos.set(n.id, { x, y: Math.max(4, y) });
    });
  }

  const maxCount = Math.max(...nodes.map((n) => n.count), 1);
  const maxEdgeCount = Math.max(...edges.map((e) => e.count), 1);

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" style={{ minHeight: 200 }}>
        <defs>
          <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill="hsl(var(--muted-foreground))" opacity={0.5} />
          </marker>
        </defs>

        {/* Edges */}
        {edges.map((edge, i) => {
          const src = nodePos.get(edge.source);
          const tgt = nodePos.get(edge.target);
          if (!src || !tgt) return null;
          const x1 = src.x + NODE_W;
          const y1 = src.y + NODE_H / 2;
          const x2 = tgt.x;
          const y2 = tgt.y + NODE_H / 2;
          const mx = (x1 + x2) / 2;
          const strokeW = 1 + (edge.count / maxEdgeCount) * 5;
          return (
            <path
              key={i}
              d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke="hsl(var(--muted-foreground))"
              strokeWidth={strokeW}
              strokeOpacity={0.35}
              markerEnd="url(#arrow)"
            />
          );
        })}

        {/* Nodes */}
        {nodes.map((node) => {
          const pos = nodePos.get(node.id);
          if (!pos) return null;
          const color = SEGMENT_COLORS[node.id] ?? "#6366f1";
          const intensity = Math.max(0.15, node.count / maxCount);
          return (
            <g key={node.id}>
              <rect
                x={pos.x}
                y={pos.y}
                width={NODE_W}
                height={NODE_H}
                rx={8}
                fill={color}
                fillOpacity={0.15 + intensity * 0.3}
                stroke={color}
                strokeOpacity={0.6}
                strokeWidth={1.5}
              />
              <text
                x={pos.x + NODE_W / 2}
                y={pos.y + NODE_H / 2 - 5}
                textAnchor="middle"
                fontSize={9}
                fontWeight={600}
                fill={color}
              >
                {node.label}
              </text>
              <text
                x={pos.x + NODE_W / 2}
                y={pos.y + NODE_H / 2 + 8}
                textAnchor="middle"
                fontSize={8}
                fill="hsl(var(--muted-foreground))"
              >
                {formatNumber(node.count)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
