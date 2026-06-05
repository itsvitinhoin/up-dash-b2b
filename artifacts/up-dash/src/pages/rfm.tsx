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
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertCircle, RefreshCw, ChevronRight, Sparkles, X as XIcon, ChevronLeft, Lightbulb,
  BarChart3, Users, Info, MessageCircle, ClipboardList, CalendarDays, ShoppingBag,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend,
} from "recharts";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import { CountUp } from "@/components/count-up";
import { useReducedMotion, fadeInUp, withReducedMotion } from "@/lib/motion";
import type { RfmCustomerRow } from "@workspace/api-client-react";

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
    label: "Promising",
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

function whatsappDirectUrl(phone: string | null | undefined): string | null {
  const digits = phone?.replace(/\D/g, "") ?? "";
  if (!digits) return null;
  const normalized = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${normalized}`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function InfoHint({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Explicação da métrica"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs leading-relaxed">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

function RfmLogicCard({
  title,
  value,
  description,
  info,
  icon: Icon,
}: {
  title: string;
  value: string;
  description: string;
  info: string;
  icon: typeof CalendarDays;
}) {
  return (
    <Card className="border-border/70 bg-card">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
              <InfoHint text={info} />
            </div>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          </div>
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function RfmPage() {
  const { selectedClientId, user } = useAuth();
  const { dateRange, filters } = useDashboardFilters();
  const reduced = useReducedMotion();
  const variants = withReducedMotion(fadeInUp, reduced);
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [insightDismissed, setInsightDismissed] = useState(false);
  const [segmentFilter, setSegmentFilter] = useState<string>("");
  const [orderStatusFilter, setOrderStatusFilter] = useState<"all" | "approved" | "pending" | "rejected">("all");
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<"name" | "segment" | "recencyDays" | "frequency" | "monetary">("monetary");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [ordersCustomer, setOrdersCustomer] = useState<RfmCustomerRow | null>(null);
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
      orderStatus: orderStatusFilter,
      utmSource: filters.utmSource || undefined,
      utmMedium: filters.utmMedium || undefined,
      state: filters.state || undefined,
      city: filters.city || undefined,
      product: filters.product || undefined,
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
  const avgRecency = customers.length > 0
    ? customers.reduce((sum, customer) => sum + (customer.recencyDays ?? 0), 0) / customers.length
    : 0;
  const avgFrequency = customers.length > 0
    ? customers.reduce((sum, customer) => sum + customer.frequency, 0) / customers.length
    : 0;
  const avgMonetary = customers.length > 0
    ? customers.reduce((sum, customer) => sum + customer.monetary, 0) / customers.length
    : 0;

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

          {/* RFM Logic */}
          <motion.div initial="hidden" animate="visible" variants={variants}>
            <div className="grid gap-3 md:grid-cols-3">
              <RfmLogicCard
                title="Recência"
                value={isLoading ? "—" : `${Math.round(avgRecency)}d`}
                description="Média de dias desde a última compra"
                info="Recência mede há quantos dias a cliente comprou pela última vez. Quanto menor o número, mais quente está a relação comercial."
                icon={CalendarDays}
              />
              <RfmLogicCard
                title="Frequência"
                value={isLoading ? "—" : formatNumber(Math.round(avgFrequency))}
                description="Média de pedidos por compradora"
                info="Frequência considera quantas compras a cliente já realizou. Clientes com mais compras tendem a responder melhor a relacionamento e reposição."
                icon={ShoppingBag}
              />
              <RfmLogicCard
                title="Monetário"
                value={isLoading ? "—" : formatCurrency(avgMonetary)}
                description="Valor médio acumulado por compradora"
                info="Monetário soma o valor comprado pela cliente. Esse pilar ajuda a priorizar clientes de maior valor para ações comerciais."
                icon={BarChart3}
              />
            </div>
          </motion.div>

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
                      <div className="flex items-center gap-1">
                        {isLoading ? (
                          <Skeleton className="h-3 w-8" />
                        ) : (
                          <span className="text-[10px] font-mono text-muted-foreground">
                            {segData ? segData.pct.toFixed(1) : 0}%
                          </span>
                        )}
                        <InfoHint text={`Segmento ${meta.label}: ${meta.description}. A classificação usa recência, frequência e valor comprado para priorizar a ação comercial.`} />
                      </div>
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
                      <RechartsTooltip
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
                    Compradoras RFM
                    <span className="text-muted-foreground font-normal">({formatNumber(total)})</span>
                    <InfoHint text="A lista mostra clientes que solicitaram pedidos no período filtrado. Por padrão entram todos os pedidos; use o filtro de status para analisar somente aprovados, pendentes ou recusados." />
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Select
                      value={orderStatusFilter}
                      onValueChange={(v) => {
                        setOrderStatusFilter(v as "all" | "approved" | "pending" | "rejected");
                        setPage(1);
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs w-44">
                        <SelectValue placeholder="Status dos pedidos" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos os pedidos</SelectItem>
                        <SelectItem value="approved">Aprovados/atendidos</SelectItem>
                        <SelectItem value="pending">Pendentes</SelectItem>
                        <SelectItem value="rejected">Recusados</SelectItem>
                      </SelectContent>
                    </Select>
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
                          Compradora <SortIndicator col="name" />
                        </TableHead>
                        <TableHead className="text-xs">Contato</TableHead>
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
                        <TableHead className="text-xs text-right">Última compra</TableHead>
                        <TableHead className="text-xs text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isLoading ? (
                        Array.from({ length: 8 }).map((_, i) => (
                          <TableRow key={i}>
                            <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                            <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                            <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                            <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                            <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                            <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                            <TableCell><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                            <TableCell><Skeleton className="h-8 w-28 ml-auto" /></TableCell>
                          </TableRow>
                        ))
                      ) : customers.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} className="py-0">
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
                                <p className="text-[11px] text-muted-foreground">
                                  {[c.city, c.state].filter(Boolean).join(" / ") || "Sem localização"}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="space-y-1">
                                <p className="font-mono text-xs text-muted-foreground">{c.phone ?? "Sem telefone"}</p>
                                {c.documentType && (
                                  <Badge variant="outline" className="text-[10px]">{c.documentType}</Badge>
                                )}
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
                              <div className="text-sm tabular-nums">{formatDateTime(c.lastPurchaseAt).split(",")[0]}</div>
                              <div className="text-[11px] text-muted-foreground">{c.latestOrders.length} pedido(s)</div>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1.5">
                                {whatsappDirectUrl(c.phone) ? (
                                  <Button
                                    size="icon"
                                    variant="outline"
                                    className="h-8 w-8"
                                    asChild
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    <a href={whatsappDirectUrl(c.phone) ?? "#"} target="_blank" rel="noreferrer" aria-label="Chamar no WhatsApp">
                                      <MessageCircle className="h-4 w-4" />
                                    </a>
                                  </Button>
                                ) : (
                                  <Button size="icon" variant="outline" className="h-8 w-8" disabled aria-label="Sem telefone">
                                    <MessageCircle className="h-4 w-4" />
                                  </Button>
                                )}
                                <Button
                                  size="icon"
                                  variant="outline"
                                  className="h-8 w-8"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setOrdersCustomer(c);
                                  }}
                                  aria-label="Ver últimos pedidos"
                                >
                                  <ClipboardList className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    navigate(`/customers/${c.id}`);
                                  }}
                                  aria-label="Ver detalhe da cliente"
                                >
                                  <ChevronRight className="h-4 w-4" />
                                </Button>
                              </div>
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

          <Dialog open={!!ordersCustomer} onOpenChange={(open) => !open && setOrdersCustomer(null)}>
            <DialogContent className="max-w-3xl">
              <DialogHeader>
                <DialogTitle>Últimos pedidos</DialogTitle>
                <DialogDescription>
                  {ordersCustomer?.name ?? "Cliente"} · {ordersCustomer?.email}
                </DialogDescription>
              </DialogHeader>
              {!ordersCustomer || ordersCustomer.latestOrders.length === 0 ? (
                <EmptyState
                  icon={ClipboardList}
                  title="Sem pedidos recentes"
                  description="Quando houver histórico de pedidos, ele aparecerá aqui."
                  className="border-0"
                />
              ) : (
                <div className="space-y-3">
                  {ordersCustomer.latestOrders.map((order) => (
                    <div key={order.id} className="rounded-lg border border-border p-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-medium">Pedido #{order.externalId ?? order.id.slice(0, 8)}</p>
                          <p className="text-xs text-muted-foreground">{formatDateTime(order.createdAt)}</p>
                        </div>
                        <Badge variant="outline">{order.status}</Badge>
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-4">
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Solicitado</p>
                          <p className="text-sm font-semibold tabular-nums">{formatCurrency(order.amount)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Atendido</p>
                          <p className="text-sm font-semibold tabular-nums">{formatCurrency(order.fulfilledAmount)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Peças solicitadas</p>
                          <p className="text-sm font-semibold tabular-nums">{formatNumber(order.requestedQuantity)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Peças atendidas</p>
                          <p className="text-sm font-semibold tabular-nums">{formatNumber(order.fulfilledQuantity)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="flex justify-end gap-2">
                    {whatsappDirectUrl(ordersCustomer.phone) && (
                      <Button asChild variant="outline">
                        <a href={whatsappDirectUrl(ordersCustomer.phone) ?? "#"} target="_blank" rel="noreferrer">
                          <MessageCircle className="mr-2 h-4 w-4" />
                          Chamar no WhatsApp
                        </a>
                      </Button>
                    )}
                    <Button onClick={() => navigate(`/customers/${ordersCustomer.id}`)}>
                      Ver detalhe da cliente
                      <ChevronRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
