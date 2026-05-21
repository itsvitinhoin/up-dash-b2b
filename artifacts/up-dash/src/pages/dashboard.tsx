import { useMemo, useState } from "react";
import { Link } from "wouter";
import { addDays, differenceInDays, format, subDays } from "date-fns";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import {
  customFetch,
  useGetDashboard,
  useGetInsight,
  useRegenerateInsight,
  getGetInsightQueryKey,
  useGetAlerts,
  useGetSellers,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  ChevronRight,
  CircleDot,
  DollarSign,
  Download,
  FileText,
  Info,
  Megaphone,
  MoreHorizontal,
  Package,
  PackageX,
  RefreshCw,
  Store,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatCurrencySmart, formatPercentage, formatNumber } from "@/lib/formatters";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceDot,
} from "recharts";
import { CountUp } from "@/components/count-up";
import { Sparkline } from "@/components/sparkline";
import { DrillDownPanel } from "@/components/drill-down-panel";
import {
  cardEntry,
  fadeInUp,
  staggerContainer,
  useReducedMotion,
  withReducedMotion,
} from "@/lib/motion";
import { exportRowsAsCsv } from "@/lib/csv-export";

function computeChange(current: number | undefined, previous: number | undefined): number | null {
  if (current === undefined || previous === undefined) return null;
  if (previous === 0) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}

interface KpiCardProps {
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  label: string;
  value: number;
  format: (value: number) => string;
  unit?: string;
  change: number | null;
  changeLabel: string;
  sub: { label: string; value: string }[];
  sparkValues: number[];
  sparkColor: string;
  isLoading: boolean;
  testId: string;
  /** Optional: render value text with a primary→accent gradient. */
  valueAccent?: boolean;
  /** Optional: replace sparkline with a small radial ring (0–100). */
  ringValue?: number;
  ringColor?: string;
}

function MiniRing({
  pct,
  color,
  reduced,
}: {
  pct: number;
  color: string;
  reduced: boolean;
}) {
  const size = 52;
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  const dash = (clamped / 100) * c;
  return (
    <svg width={size} height={size} className="-rotate-90 shrink-0" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="hsl(var(--muted))" strokeOpacity={0.5} strokeWidth={stroke} fill="none" />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        fill="none"
        strokeDasharray={c}
        initial={{ strokeDashoffset: reduced ? c - dash : c }}
        animate={{ strokeDashoffset: c - dash }}
        transition={{ duration: reduced ? 0 : 1.1, ease: [0.22, 1, 0.36, 1] }}
      />
    </svg>
  );
}

function ProductMiniature({ imageUrl, name }: { imageUrl?: string | null; name: string }) {
  const [imgError, setImgError] = useState(false);
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();

  if (imageUrl && !imgError) {
    return (
      <img
        src={imageUrl}
        alt={name}
        className="h-9 w-9 shrink-0 rounded-md border border-border object-cover"
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-primary/10 text-[10px] font-semibold text-primary">
      {initials || "PR"}
    </div>
  );
}

function KpiCard({
  icon: Icon,
  iconClass,
  label,
  value,
  format: fmt,
  unit,
  change,
  changeLabel,
  sub,
  sparkValues,
  sparkColor,
  isLoading,
  testId,
  valueAccent,
  ringValue,
  ringColor,
}: KpiCardProps) {
  const reduced = useReducedMotion();
  const isUp = change !== null && change >= 0;
  const variants = withReducedMotion(cardEntry, reduced);
  return (
    <motion.div variants={variants}>
      <Card
        data-testid={testId}
        className="flex flex-col p-5 bg-card border-border hover-elevate transition-shadow"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${iconClass}`}>
              <Icon className="h-4 w-4" />
            </div>
            <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              {label}
            </span>
          </div>
          <button
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="More options"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-end justify-between gap-3 mb-3">
          <div className="flex items-baseline gap-2">
            {isLoading ? (
              <Skeleton className="h-9 w-32" />
            ) : (
              <>
                <span
                  className={`text-2xl font-semibold tracking-tight tabular-nums ${
                    valueAccent
                      ? "bg-gradient-to-br from-foreground via-foreground to-primary bg-clip-text text-transparent"
                      : ""
                  }`}
                >
                  <CountUp value={value} format={fmt} />
                </span>
                {unit && <span className="text-xs text-muted-foreground font-medium">{unit}</span>}
              </>
            )}
          </div>
          {!isLoading && ringValue !== undefined ? (
            <MiniRing pct={ringValue} color={ringColor ?? sparkColor} reduced={reduced} />
          ) : !isLoading && sparkValues.length > 1 ? (
            <Sparkline
              values={sparkValues}
              stroke={sparkColor}
              fill={sparkColor + "22"}
              width={88}
              height={28}
              ariaLabel={`${label} trend sparkline`}
            />
          ) : null}
        </div>

        {!isLoading && change !== null && (
          <div className="mb-4">
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${
                isUp ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
              }`}
            >
              {isUp ? (
                <ArrowUpRight className="h-3 w-3" />
              ) : (
                <ArrowDownRight className="h-3 w-3" />
              )}
              {isUp ? "+" : ""}
              {change.toFixed(1)}%
            </span>
            <span className="text-xs text-muted-foreground ml-2">{changeLabel}</span>
          </div>
        )}

        <div className="mt-auto pt-3 border-t border-border space-y-2">
          {sub.map((row) => (
            <div key={row.label} className="flex justify-between text-sm">
              <span className="text-muted-foreground">{row.label}</span>
              <span className="font-medium tabular-nums">{row.value}</span>
            </div>
          ))}
        </div>
      </Card>
    </motion.div>
  );
}

const CHART_METRICS = [
  { id: "revenue", label: "Revenue", formatter: (v: number) => formatCurrency(v) },
  { id: "orders", label: "Orders", formatter: (v: number) => formatNumber(v) },
  { id: "avgTicket", label: "Avg ticket", formatter: (v: number) => formatCurrency(v) },
] as const;

type ChartMetric = (typeof CHART_METRICS)[number]["id"];

type CampaignCustomerRow = {
  customerId: string;
  userId: number;
  name: string | null;
  email: string;
  documentType: "CPF" | "CNPJ" | null;
  registrationStatus: string;
  registeredAt: string;
  firstCampaign: string | null;
  firstSource: string | null;
  firstMedium: string | null;
  lastCampaign: string | null;
  lastSource: string | null;
  lastMedium: string | null;
  lastCampaignAt: string | null;
  campaignImpacted: boolean;
  isRepurchase: boolean;
  madePurchase: boolean;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  orderCount: number;
  orderValue: number;
  itemQuantity: number;
  registrationEvents: number;
  addToCartEvents: number;
  checkoutEvents: number;
  purchaseEvents: number;
  eventCount: number;
};

type CampaignCustomerSortKey =
  | "orderValue"
  | "orderCount"
  | "itemQuantity"
  | "eventCount"
  | "registeredAt"
  | "lastOrderAt"
  | "name";

type CampaignCustomersResponse = {
  rows: CampaignCustomerRow[];
  total: number;
  summary: {
    impactedCustomers: number;
    attributedRevenue: number;
    orders: number;
    itemQuantity: number;
    registrations: number;
  };
};

function detectAnomalies(series: { date: string; value: number }[]): { date: string; value: number }[] {
  // ±2σ from the series mean — flag any point whose value is more than two
  // standard deviations away from the average for the visible date range.
  if (series.length < 4) return [];
  const mean = series.reduce((s, p) => s + p.value, 0) / series.length;
  const variance =
    series.reduce((s, p) => s + Math.pow(p.value - mean, 2), 0) / series.length;
  const std = Math.sqrt(variance);
  if (std === 0) return [];
  return series.filter((p) => Math.abs(p.value - mean) >= 2 * std);
}

function formatCampaignDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function CampaignCustomersPanel({
  data,
  isLoading,
  isError,
}: {
  data?: CampaignCustomersResponse;
  isLoading: boolean;
  isError: boolean;
}) {
  const [documentFilter, setDocumentFilter] = useState("all");
  const [purchaseFilter, setPurchaseFilter] = useState("all");
  const [repurchaseFilter, setRepurchaseFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortKey, setSortKey] = useState<CampaignCustomerSortKey>("orderValue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const visibleRows = useMemo(() => {
    const rows = [...(data?.rows ?? [])].filter((row) => {
      if (documentFilter !== "all" && row.documentType !== documentFilter) return false;
      if (statusFilter !== "all" && row.registrationStatus !== statusFilter) return false;
      if (purchaseFilter === "buyers" && !row.madePurchase) return false;
      if (purchaseFilter === "non_buyers" && row.madePurchase) return false;
      if (repurchaseFilter === "yes" && !row.isRepurchase) return false;
      if (repurchaseFilter === "no" && row.isRepurchase) return false;
      return true;
    });

    rows.sort((a, b) => {
      const direction = sortDir === "asc" ? 1 : -1;
      if (sortKey === "name") {
        return direction * (a.name || a.email).localeCompare(b.name || b.email);
      }
      if (sortKey === "registeredAt" || sortKey === "lastOrderAt") {
        const aTime = a[sortKey] ? new Date(a[sortKey] as string).getTime() : 0;
        const bTime = b[sortKey] ? new Date(b[sortKey] as string).getTime() : 0;
        return direction * (aTime - bTime);
      }
      return direction * ((a[sortKey] as number) - (b[sortKey] as number));
    });

    return rows;
  }, [data?.rows, documentFilter, purchaseFilter, repurchaseFilter, sortDir, sortKey, statusFilter]);

  const setSort = (key: CampaignCustomerSortKey) => {
    if (sortKey === key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(key === "name" ? "asc" : "desc");
  };

  const SortHeader = ({
    children,
    sort,
    align = "left",
  }: {
    children: React.ReactNode;
    sort: CampaignCustomerSortKey;
    align?: "left" | "right";
  }) => (
    <button
      type="button"
      onClick={() => setSort(sort)}
      className={`inline-flex w-full items-center gap-1 font-medium hover:text-foreground ${
        align === "right" ? "justify-end text-right" : "justify-start"
      }`}
    >
      {children}
      <span className="text-[9px] text-muted-foreground">
        {sortKey === sort ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
      </span>
    </button>
  );

  return (
    <Card className="p-5 bg-card border-border" data-testid="campaign-customers-panel">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold leading-tight flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-primary" />
            Clientes atribuídos às campanhas
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Clientes e cadastros com UTM de campanhas pagas: fb, ig, gc, up e derivados. Linktree fica fora desta lista.
          </p>
        </div>
        {data && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-right">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Clientes</p>
              <p className="text-sm font-semibold tabular-nums">{formatNumber(data.summary.impactedCustomers)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Receita</p>
              <p className="text-sm font-semibold tabular-nums">{formatCurrency(data.summary.attributedRevenue)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Pedidos</p>
              <p className="text-sm font-semibold tabular-nums">{formatNumber(data.summary.orders)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Cadastros</p>
              <p className="text-sm font-semibold tabular-nums">{formatNumber(data.summary.registrations)}</p>
            </div>
          </div>
        )}
      </div>

      {data && data.rows.length > 0 && (
        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <select
            value={documentFilter}
            onChange={(event) => setDocumentFilter(event.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3 text-xs"
            aria-label="Filtrar por documento"
          >
            <option value="all">CPF e CNPJ</option>
            <option value="CPF">CPF</option>
            <option value="CNPJ">CNPJ</option>
          </select>
          <select
            value={purchaseFilter}
            onChange={(event) => setPurchaseFilter(event.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3 text-xs"
            aria-label="Filtrar por compra"
          >
            <option value="all">Compra: todos</option>
            <option value="buyers">Fez compra</option>
            <option value="non_buyers">Não comprou</option>
          </select>
          <select
            value={repurchaseFilter}
            onChange={(event) => setRepurchaseFilter(event.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3 text-xs"
            aria-label="Filtrar por recompra"
          >
            <option value="all">Recompra: todos</option>
            <option value="yes">É recompra</option>
            <option value="no">Primeira compra/cadastro</option>
          </select>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3 text-xs"
            aria-label="Filtrar por status"
          >
            <option value="all">Status: todos</option>
            <option value="APPROVED">Aprovado</option>
            <option value="PENDING">Pendente</option>
            <option value="REJECTED">Recusado</option>
          </select>
          <select
            value={`${sortKey}:${sortDir}`}
            onChange={(event) => {
              const [key, dir] = event.target.value.split(":") as [CampaignCustomerSortKey, "asc" | "desc"];
              setSortKey(key);
              setSortDir(dir);
            }}
            className="h-9 rounded-md border border-border bg-background px-3 text-xs"
            aria-label="Ordenar clientes atribuídos"
          >
            <option value="orderValue:desc">Maior valor</option>
            <option value="orderCount:desc">Mais pedidos</option>
            <option value="itemQuantity:desc">Mais produtos</option>
            <option value="eventCount:desc">Mais eventos</option>
            <option value="registeredAt:desc">Cadastro mais recente</option>
            <option value="lastOrderAt:desc">Pedido mais recente</option>
            <option value="name:asc">Nome A-Z</option>
          </select>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Não foi possível carregar os clientes atribuídos às campanhas.</AlertDescription>
        </Alert>
      ) : !data || data.rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary mb-3">
            <Megaphone className="h-5 w-5" />
          </div>
          <p className="text-sm font-medium">Nenhum cliente atribuído no período</p>
          <p className="text-xs text-muted-foreground mt-1">
            A lista aparece quando a UP Zero retorna eventos com user_id e UTM compatível.
          </p>
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <p className="text-sm font-medium">Nenhum cliente com esses filtros</p>
          <p className="text-xs text-muted-foreground mt-1">
            Ajuste CPF/CNPJ, compra, recompra ou status para voltar a visualizar os cadastros atribuídos.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pr-4"><SortHeader sort="name">Cliente</SortHeader></th>
                <th className="py-2 px-3 font-medium">Tags</th>
                <th className="py-2 px-3 font-medium">Cadastro / Pedido</th>
                <th className="py-2 px-3 font-medium">Última campanha</th>
                <th className="py-2 px-3"><SortHeader sort="orderCount" align="right">Pedidos</SortHeader></th>
                <th className="py-2 px-3"><SortHeader sort="itemQuantity" align="right">Produtos</SortHeader></th>
                <th className="py-2 px-3"><SortHeader sort="orderValue" align="right">Valor</SortHeader></th>
                <th className="py-2 pl-3"><SortHeader sort="eventCount" align="right">Eventos</SortHeader></th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.customerId} className="border-b border-border/60 last:border-0 hover-elevate">
                  <td className="py-3 pr-4 min-w-[220px]">
                    <Link href={`/customers/${row.customerId}`} className="block">
                      <div className="font-medium hover:text-primary truncate">
                        {row.name || row.email}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {row.email} · UP Zero {row.userId}
                      </div>
                    </Link>
                  </td>
                  <td className="py-3 px-3 min-w-[210px]">
                    <div className="flex flex-wrap gap-1.5">
                      {row.documentType && (
                        <span className="inline-flex rounded-md bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-400">
                          {row.documentType}
                        </span>
                      )}
                      <span className="inline-flex rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {row.registrationStatus}
                      </span>
                      <span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-medium ${
                        row.madePurchase ? "bg-emerald-500/10 text-emerald-400" : "bg-muted/50 text-muted-foreground"
                      }`}>
                        Compra: {row.madePurchase ? "Sim" : "Não"}
                      </span>
                      <span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-medium ${
                        row.isRepurchase ? "bg-blue-500/10 text-blue-400" : "bg-muted/50 text-muted-foreground"
                      }`}>
                        Recompra: {row.isRepurchase ? "Sim" : "Não"}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-3 min-w-[170px]">
                    <div className="text-xs text-muted-foreground">
                      Cadastro: <span className="text-foreground">{formatCampaignDate(row.registeredAt)}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Pedido: <span className="text-foreground">{formatCampaignDate(row.lastOrderAt)}</span>
                    </div>
                  </td>
                  <td className="py-3 px-3 min-w-[260px]">
                    <div className="font-medium truncate" title={row.lastCampaign ?? row.firstCampaign ?? "—"}>
                      {row.lastCampaign ?? row.firstCampaign ?? "—"}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {[row.lastSource ?? row.firstSource, row.lastMedium ?? row.firstMedium]
                        .filter(Boolean)
                        .join(" / ") || "Origem não identificada"} · {formatCampaignDate(row.lastCampaignAt)}
                    </div>
                  </td>
                  <td className="py-3 px-3 text-right tabular-nums">{formatNumber(row.orderCount)}</td>
                  <td className="py-3 px-3 text-right tabular-nums">{formatNumber(row.itemQuantity)}</td>
                  <td className="py-3 px-3 text-right font-semibold tabular-nums">{formatCurrency(row.orderValue)}</td>
                  <td className="py-3 pl-3 text-right tabular-nums">{formatNumber(row.eventCount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default function DashboardPage() {
  const { selectedClientId, user } = useAuth();
  const { dateRange, filters } = useDashboardFilters();
  const queryClient = useQueryClient();
  const [chartMetric, setChartMetric] = useState<ChartMetric>("revenue");
  const [drillDate, setDrillDate] = useState<string | null>(null);
  const [insightDismissed, setInsightDismissed] = useState(false);
  const reduced = useReducedMotion();

  const clientId = user?.role === "ADMIN" ? selectedClientId || undefined : undefined;
  const enabled =
    user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId);

  const { data, isLoading, isError, refetch } = useGetDashboard(
    {
      clientId,
      dateFrom: format(dateRange.from, "yyyy-MM-dd"),
      dateTo: format(dateRange.to, "yyyy-MM-dd"),
      category: filters.category ?? undefined,
      sellerId: filters.sellerId ?? undefined,
      channel: filters.channel ?? undefined,
      segment: filters.segment ?? undefined,
      utmSource: filters.utmSource || undefined,
      utmMedium: filters.utmMedium || undefined,
      utmCampaign: filters.utmCampaign || undefined,
      compare: true,
    },
    { query: queryOpts({ enabled }) },
  );

  const inclusiveDays = Math.max(1, differenceInDays(dateRange.to, dateRange.from) + 1);
  const prevPeriodTo = useMemo(() => subDays(dateRange.from, 1), [dateRange.from]);
  const prevPeriodFrom = useMemo(
    () => addDays(prevPeriodTo, -(inclusiveDays - 1)),
    [prevPeriodTo, inclusiveDays],
  );

  // ── AI insight (real LLM) ──────────────────────────────────────────────
  const insightParams = {
    clientId,
    dateFrom: format(dateRange.from, "yyyy-MM-dd"),
    dateTo: format(dateRange.to, "yyyy-MM-dd"),
  };
  const { data: insight, isLoading: insightLoading } = useGetInsight(insightParams, {
    query: queryOpts({ enabled }),
  });
  const regenerateInsight = useRegenerateInsight({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getGetInsightQueryKey(insightParams),
        });
      },
    },
  });

  // ── Inventory alerts ──────────────────────────────────────────────────
  const {
    data: alertsData,
    isLoading: alertsLoading,
  } = useGetAlerts(
    { clientId, horizonDays: 14, lookbackDays: 30, limit: 8 },
    { query: queryOpts({ enabled }) },
  );

  // Top sellers (mini leaderboard on the dashboard)
  const { data: topSellersData, isLoading: topSellersLoading } = useGetSellers(
    { clientId, limit: 5 },
    { query: queryOpts({ enabled }) },
  );
  const {
    data: campaignCustomers,
    isLoading: campaignCustomersLoading,
    isError: campaignCustomersError,
  } = useQuery({
    queryKey: [
      "campaign-customers",
      clientId,
      format(dateRange.from, "yyyy-MM-dd"),
      format(dateRange.to, "yyyy-MM-dd"),
    ],
    queryFn: () => {
      const params = new URLSearchParams({
        dateFrom: format(dateRange.from, "yyyy-MM-dd"),
        dateTo: format(dateRange.to, "yyyy-MM-dd"),
        limit: "50",
      });
      if (clientId) params.set("clientId", clientId);
      return customFetch<CampaignCustomersResponse>(
        `/api/analytics/campaign-customers?${params.toString()}`,
      );
    },
    enabled,
  });

  // Compute changes from API-provided prior-period KPIs
  const revenueChange = useMemo(
    () => computeChange(data?.kpis.revenue, data?.prevKpis?.revenue),
    [data],
  );
  const ordersChange = useMemo(
    () => computeChange(data?.kpis.orders, data?.prevKpis?.orders),
    [data],
  );
  const avgTicketChange = useMemo(
    () => computeChange(data?.kpis.avgTicket, data?.prevKpis?.avgTicket),
    [data],
  );
  const conversionChange = useMemo(
    () => computeChange(data?.kpis.conversionRate, data?.prevKpis?.conversionRate),
    [data],
  );
  const retentionChange = useMemo(
    () => computeChange(data?.kpis.retentionPct, data?.prevKpis?.retentionPct),
    [data],
  );

  // Build chart data (uses prev time series from the same response)
  const chartData = useMemo(() => {
    if (!data) return [];
    const current =
      chartMetric === "revenue"
        ? data.revenueOverTime
        : chartMetric === "orders"
          ? data.ordersOverTime
          : data.revenueOverTime.map((r, i) => {
              const o = data.ordersOverTime[i]?.value || 0;
              return { date: r.date, value: o > 0 ? r.value / o : 0 };
            });
    const prevRevenue = data.prevRevenueOverTime;
    const prevOrders = data.prevOrdersOverTime;
    const previous =
      prevRevenue && prevOrders
        ? chartMetric === "revenue"
          ? prevRevenue
          : chartMetric === "orders"
            ? prevOrders
            : prevRevenue.map((r, i) => {
                const o = prevOrders[i]?.value || 0;
                return { date: r.date, value: o > 0 ? r.value / o : 0 };
              })
        : undefined;
    return current.map((p, i) => ({
      date: p.date,
      current: p.value,
      previous: previous?.[i]?.value ?? null,
    }));
  }, [data, chartMetric]);

  const currentSeries = useMemo(() => {
    if (!data) return [];
    return chartMetric === "revenue"
      ? data.revenueOverTime
      : chartMetric === "orders"
        ? data.ordersOverTime
        : data.revenueOverTime.map((r, i) => {
            const o = data.ordersOverTime[i]?.value || 0;
            return { date: r.date, value: o > 0 ? r.value / o : 0 };
          });
  }, [data, chartMetric]);

  const anomalies = useMemo(() => detectAnomalies(currentSeries), [currentSeries]);
  const chartFormatter = CHART_METRICS.find((m) => m.id === chartMetric)!.formatter;

  // Top categories
  const topCategories = useMemo(() => {
    if (!data?.revenueByCategory) return [];
    return [...data.revenueByCategory].sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  }, [data]);

  const totalCategoryRevenue = topCategories.reduce((sum, c) => sum + c.revenue, 0);

  const handlePrint = () => {
    document.body.classList.add("print-dashboard");
    window.setTimeout(() => {
      window.print();
      document.body.classList.remove("print-dashboard");
    }, 50);
  };

  const handleExportSummary = () => {
    if (!data) return;
    exportRowsAsCsv(
      `dashboard-summary-${format(dateRange.from, "yyyyMMdd")}-${format(dateRange.to, "yyyyMMdd")}.csv`,
      data.revenueOverTime.map((r, i) => ({
        date: r.date,
        revenue: r.value,
        orders: data.ordersOverTime[i]?.value ?? 0,
        leads: data.leadsOverTime[i]?.value ?? 0,
      })),
      [
        { header: "date", accessor: (r) => r.date },
        { header: "revenue", accessor: (r) => r.revenue },
        { header: "orders", accessor: (r) => r.orders },
        { header: "leads", accessor: (r) => r.leads },
      ],
    );
  };

  if (isError) {
    return (
      <Alert variant="destructive" data-testid="page-dashboard">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription className="flex items-center justify-between">
          Failed to load dashboard data.
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const sparkRevenue = data?.revenueOverTime.map((p) => p.value) ?? [];
  const sparkOrders = data?.ordersOverTime.map((p) => p.value) ?? [];
  const sparkLeads = data?.leadsOverTime.map((p) => p.value) ?? [];
  const sparkConv = (data?.leadsOverTime ?? []).map((leadPoint, i) => {
    const orderVal = data?.ordersOverTime[i]?.value ?? 0;
    return leadPoint.value > 0 ? (orderVal / leadPoint.value) * 100 : 0;
  });
  const sparkNewBuyers = data?.newBuyersOverTime?.map((p) => p.value) ?? [];
  const sparkReturning = data?.returningBuyersOverTime?.map((p) => p.value) ?? [];

  const containerVariants = withReducedMotion(staggerContainer, reduced);
  const fadeVariants = withReducedMotion(fadeInUp, reduced);

  return (
    <div className="space-y-6 dashboard-printable" data-testid="page-dashboard">
      {/* Live indicator + export toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 no-print">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={fadeVariants}
          className="flex items-center gap-2 text-xs text-muted-foreground"
        >
          <span className="relative flex h-1.5 w-1.5">
            {!reduced && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/60" />
            )}
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          <span className="font-mono uppercase tracking-wider">
            Live · {format(dateRange.from, "MMM d")} → {format(dateRange.to, "MMM d, yyyy")}
            <span className="ml-2 text-muted-foreground/70">
              vs. {format(prevPeriodFrom, "MMM d")} → {format(prevPeriodTo, "MMM d")}
            </span>
          </span>
        </motion.div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExportSummary} data-testid="dashboard-export-csv">
            <Download className="h-4 w-4 mr-1.5" />
            Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrint} data-testid="dashboard-export-pdf">
            <FileText className="h-4 w-4 mr-1.5" />
            Print / PDF
          </Button>
        </div>
      </div>

      <motion.div
        initial="hidden"
        animate="visible"
        variants={containerVariants}
        className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4"
      >
        <KpiCard
          testId="kpi-revenue"
          icon={DollarSign}
          iconClass="bg-blue-500/15 text-blue-400"
          label="Total revenue"
          value={data?.kpis.revenue ?? 0}
          format={(v) => formatCurrencySmart(v)}
          unit="BRL"
          change={revenueChange}
          changeLabel="vs. previous period"
          sparkValues={sparkRevenue}
          sparkColor="#60a5fa"
          sub={[
            { label: "Avg ticket", value: data ? formatCurrency(data.kpis.avgTicket) : "—" },
            { label: "Customers", value: data ? formatNumber(data.kpis.customers) : "—" },
          ]}
          isLoading={isLoading}
          valueAccent
        />
        <KpiCard
          testId="kpi-orders"
          icon={Package}
          iconClass="bg-violet-500/15 text-violet-400"
          label="Orders"
          value={data?.kpis.orders ?? 0}
          format={(v) => formatNumber(v)}
          unit={inclusiveDays + "d"}
          change={ordersChange}
          changeLabel="vs. previous period"
          sparkValues={sparkOrders}
          sparkColor="#a78bfa"
          sub={[
            { label: "Leads", value: data ? formatNumber(data.kpis.leads) : "—" },
            { label: "Approved leads", value: data ? formatNumber(data.kpis.approvedLeads) : "—" },
          ]}
          isLoading={isLoading}
        />
        <KpiCard
          testId="kpi-avgTicket"
          icon={Wallet}
          iconClass="bg-emerald-500/15 text-emerald-400"
          label="Avg ticket"
          value={data?.kpis.avgTicket ?? 0}
          format={(v) => formatCurrencySmart(v)}
          unit="BRL"
          change={avgTicketChange}
          changeLabel="vs. previous period"
          sparkValues={sparkLeads}
          sparkColor="#34d399"
          sub={[
            { label: "Repeat customers", value: data ? formatNumber(data.kpis.repeatCustomers) : "—" },
            { label: "Approval rate", value: data ? formatPercentage(data.kpis.approvalRate) : "—" },
          ]}
          isLoading={isLoading}
        />
        <KpiCard
          testId="kpi-conversionRate"
          icon={Target}
          iconClass="bg-sky-500/15 text-sky-400"
          label="Conversion rate"
          value={data?.kpis.conversionRate ?? 0}
          format={(v) => formatPercentage(v)}
          change={conversionChange}
          changeLabel="vs. previous period"
          sparkValues={sparkConv}
          sparkColor="#38bdf8"
          sub={[
            { label: "Leads", value: data ? formatNumber(data.kpis.leads) : "—" },
            { label: "Orders", value: data ? formatNumber(data.kpis.orders) : "—" },
          ]}
          isLoading={isLoading}
          ringValue={data?.kpis.conversionRate ?? 0}
          ringColor="hsl(var(--chart-1))"
        />
      </motion.div>

      {/* Marketing & buyer KPIs row */}
      <motion.div
        initial="hidden"
        animate="visible"
        variants={containerVariants}
        className="grid grid-cols-1 sm:grid-cols-3 gap-4"
      >
        {/* Requested vs Approved Revenue */}
        <Card className="p-5 bg-card border-border" data-testid="kpi-requested-revenue">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/15 shrink-0">
              <DollarSign className="h-4 w-4 text-blue-400" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground leading-none">Requested revenue</p>
              {isLoading ? (
                <Skeleton className="h-6 w-24 mt-1" />
              ) : (
                <p className="text-xl font-bold tabular-nums mt-0.5">
                  <CountUp value={data?.kpis.requestedRevenue ?? 0} format={(v) => formatCurrencySmart(v)} />
                </p>
              )}
            </div>
          </div>
          {isLoading ? (
            <Skeleton className="h-3 w-full mb-2" />
          ) : (
            <>
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                <span>Approved</span>
                <span className="font-medium text-foreground tabular-nums">
                  {formatCurrency(data?.kpis.revenue ?? 0)}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-blue-400 transition-all"
                  style={{
                    width: `${Math.min(100, (data?.kpis.requestedRevenue ?? 0) > 0
                      ? ((data?.kpis.revenue ?? 0) / (data?.kpis.requestedRevenue ?? 1)) * 100
                      : 0)}%`,
                  }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                {(data?.kpis.requestedRevenue ?? 0) > 0
                  ? `${(((data?.kpis.revenue ?? 0) / (data?.kpis.requestedRevenue ?? 1)) * 100).toFixed(1)}% fulfillment rate`
                  : "No requested revenue"}
              </p>
            </>
          )}
        </Card>

        {/* New vs Returning Buyers */}
        <Card className="p-5 bg-card border-border" data-testid="kpi-buyers">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 shrink-0">
              <Users className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground leading-none">Buyers this period</p>
              {isLoading ? (
                <Skeleton className="h-6 w-24 mt-1" />
              ) : (
                <p className="text-xl font-bold tabular-nums mt-0.5">
                  <CountUp
                    value={(data?.kpis.newBuyers ?? 0) + (data?.kpis.returningBuyers ?? 0)}
                    format={(v) => formatNumber(v)}
                  />
                </p>
              )}
            </div>
          </div>
          {isLoading ? (
            <div className="space-y-1.5">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-3 w-full mt-1" />
            </div>
          ) : (
            <>
              {/* Stacked sparkline: new (emerald) over returning (blue) */}
              {sparkNewBuyers.length > 0 && (
                <div className="h-10 w-full mb-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={sparkNewBuyers.map((v, i) => ({
                        new: v,
                        returning: sparkReturning[i] ?? 0,
                      }))}
                      margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
                    >
                      <Area
                        type="monotone"
                        dataKey="returning"
                        stackId="buyers"
                        stroke="#60a5fa"
                        fill="#60a5fa"
                        fillOpacity={0.35}
                        strokeWidth={1}
                        dot={false}
                        isAnimationActive={false}
                      />
                      <Area
                        type="monotone"
                        dataKey="new"
                        stackId="buyers"
                        stroke="#34d399"
                        fill="#34d399"
                        fillOpacity={0.35}
                        strokeWidth={1}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className="flex gap-3 text-xs">
                <div className="flex-1 flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                  <span className="text-muted-foreground">New</span>
                  <span className="ml-auto font-semibold tabular-nums">
                    {formatNumber(data?.kpis.newBuyers ?? 0)}
                  </span>
                </div>
                <div className="flex-1 flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-blue-400 shrink-0" />
                  <span className="text-muted-foreground">Returning</span>
                  <span className="ml-auto font-semibold tabular-nums">
                    {formatNumber(data?.kpis.returningBuyers ?? 0)}
                  </span>
                </div>
              </div>
            </>
          )}
        </Card>

        {/* Retention % */}
        <KpiCard
          testId="kpi-retention"
          icon={TrendingUp}
          iconClass="bg-violet-500/15 text-violet-400"
          label="Buyer retention"
          value={data?.kpis.retentionPct ?? 0}
          format={(v) => formatPercentage(v)}
          change={retentionChange}
          changeLabel="vs. previous period"
          sparkValues={sparkReturning}
          sparkColor="#a78bfa"
          sub={[
            { label: "New buyers", value: data ? formatNumber(data.kpis.newBuyers) : "—" },
            { label: "Returning", value: data ? formatNumber(data.kpis.returningBuyers) : "—" },
          ]}
          isLoading={isLoading}
        />
      </motion.div>

      <motion.div initial="hidden" animate="visible" variants={fadeVariants}>
        <CampaignCustomersPanel
          data={campaignCustomers}
          isLoading={campaignCustomersLoading}
          isError={campaignCustomersError}
        />
      </motion.div>

      {/* Chart + insight */}
      <motion.div
        initial="hidden"
        animate="visible"
        variants={fadeVariants}
        className="grid grid-cols-1 lg:grid-cols-3 gap-4"
      >
        <Card className="lg:col-span-2 p-5 bg-card border-border">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
            <div>
              <h2 className="text-base font-semibold leading-tight">Daily performance</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Last {inclusiveDays} days vs. previous period · click any anomaly to drill in
              </p>
            </div>
            <div className="inline-flex items-center bg-muted/40 border border-border rounded-md p-0.5">
              {CHART_METRICS.map((metric) => (
                <button
                  key={metric.id}
                  data-testid={`chart-toggle-${metric.id}`}
                  onClick={() => setChartMetric(metric.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                    chartMetric === metric.id
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {metric.label}
                </button>
              ))}
            </div>
          </div>

          <div className="h-[280px]">
            {isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={chartData}
                  margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                  onClick={(e: { activeLabel?: string }) => {
                    if (e?.activeLabel) setDrillDate(e.activeLabel);
                  }}
                >
                  <defs>
                    <linearGradient id="colorCurrent" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(val) => format(new Date(val), "MMM d")}
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    dy={6}
                  />
                  <YAxis
                    tickFormatter={(val) =>
                      chartMetric === "orders"
                        ? formatNumber(val)
                        : `R$${(val / 1000).toFixed(0)}k`
                    }
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    width={55}
                  />
                  <Tooltip
                    formatter={(value: number, name) => [
                      chartFormatter(value),
                      name === "current" ? "Current" : "Previous",
                    ]}
                    labelFormatter={(label) => format(new Date(label), "MMM d, yyyy")}
                    contentStyle={{
                      backgroundColor: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="previous"
                    stroke="hsl(var(--muted-foreground))"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    fill="transparent"
                    dot={false}
                    isAnimationActive={!reduced}
                  />
                  <Area
                    type="monotone"
                    dataKey="current"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    fill="url(#colorCurrent)"
                    dot={false}
                    activeDot={{ r: 5, style: { cursor: "pointer" } }}
                    isAnimationActive={!reduced}
                  />
                  {anomalies.map((a) => (
                    <ReferenceDot
                      key={a.date}
                      x={a.date}
                      y={a.value}
                      r={5}
                      stroke="#fbbf24"
                      strokeWidth={2}
                      fill="hsl(var(--background))"
                      ifOverflow="extendDomain"
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1.5">
              <CircleDot className="h-3 w-3 text-primary" />
              Current
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 border-t border-dashed border-muted-foreground" />
              Previous
            </span>
            {anomalies.length > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full ring-2 ring-amber-400/80 bg-background" />
                {anomalies.length} anomaly{anomalies.length === 1 ? "" : "ies"} detected
              </span>
            )}
          </div>
        </Card>

        {/* AI insight card */}
        {!insightDismissed && (
          <Card
            className="p-5 bg-gradient-to-br from-primary/[0.04] via-card to-card border-border relative overflow-hidden flex flex-col"
            data-testid="ai-insight-card"
          >
            <div
              aria-hidden
              className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-primary via-chart-3 to-chart-1 opacity-80"
            />
            <div className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-primary/10 blur-2xl pointer-events-none" />
            <div className="relative z-10 flex flex-col h-full">
              <div className="flex items-center justify-between mb-3">
                <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/15 text-primary text-[10px] font-semibold uppercase tracking-wider">
                  <Sparkles className="h-3 w-3" />
                  UP Insight · {insight?.source === "ai" ? "AI" : "Auto"}
                </span>
                <button
                  type="button"
                  onClick={() => setInsightDismissed(true)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Dismiss insight"
                  data-testid="insight-dismiss"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {insightLoading || !insight ? (
                <>
                  <Skeleton className="h-6 w-3/4 mb-2" />
                  <Skeleton className="h-4 w-full mb-1" />
                  <Skeleton className="h-4 w-5/6 mb-4" />
                </>
              ) : (
                <>
                  <h3 className="text-lg font-semibold leading-snug mb-2">{insight.headline}</h3>
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
              <div className="mt-auto pt-5 flex items-center gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => regenerateInsight.mutate({ params: insightParams })}
                  disabled={regenerateInsight.isPending || insightLoading}
                  data-testid="insight-regenerate"
                >
                  <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${regenerateInsight.isPending ? "animate-spin" : ""}`} />
                  {regenerateInsight.isPending ? "Regenerating" : "Regenerate"}
                </Button>
                {insight?.cached && (
                  <span className="text-[11px] text-muted-foreground">Cached · refreshes hourly</span>
                )}
              </div>
            </div>
          </Card>
        )}
      </motion.div>

      {/* Business signals */}
      {(data?.signals?.length ?? 0) > 0 && (
        <motion.div
          initial="hidden"
          animate="visible"
          variants={fadeVariants}
        >
          <Card className="p-5 bg-card border-border" data-testid="signals-panel">
            <div className="flex items-center gap-2 mb-4">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-sky-500/15">
                <BarChart3 className="h-4 w-4 text-sky-400" />
              </div>
              <div>
                <h2 className="text-base font-semibold leading-tight">Business signals</h2>
                <p className="text-xs text-muted-foreground">Computed insights for this period</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {data?.signals?.map((signal) => {
                const isWarning = signal.severity === "warning";
                const isCritical = signal.severity === "critical";
                const colorCls = isCritical
                  ? "bg-red-500/10 border-red-500/20 text-red-400"
                  : isWarning
                    ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
                    : "bg-sky-500/10 border-sky-500/20 text-sky-400";
                const Icon =
                  signal.type === "high_traffic_low_sales"
                    ? TrendingDown
                    : signal.type === "high_performing_regions"
                      ? BarChart3
                      : Info;
                return (
                  <div
                    key={signal.type}
                    className={`flex gap-3 p-3.5 rounded-lg border ${colorCls}`}
                    data-testid={`signal-${signal.type}`}
                  >
                    <Icon className="h-4 w-4 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold leading-snug">{signal.title}</p>
                      <p className="text-xs opacity-80 mt-0.5 leading-relaxed">{signal.body}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </motion.div>
      )}

      {/* Inventory alerts */}
      <Card className="p-5 bg-card border-border" data-testid="alerts-panel">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold leading-tight flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              Alerts
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              SKUs below restock threshold and predicted stockouts in the next 14 days
            </p>
          </div>
          {alertsData && alertsData.counts.total > 0 && (
            <div className="flex items-center gap-2">
              {alertsData.counts.critical > 0 && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wider bg-red-500/15 text-red-400"
                  data-testid="alerts-count-critical"
                >
                  {alertsData.counts.critical} critical
                </span>
              )}
              {alertsData.counts.warning > 0 && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wider bg-amber-500/15 text-amber-400"
                  data-testid="alerts-count-warning"
                >
                  {alertsData.counts.warning} warning
                </span>
              )}
            </div>
          )}
        </div>

        {alertsLoading ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : !alertsData || alertsData.alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 mb-3">
              <Package className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium">All inventory is healthy</p>
            <p className="text-xs text-muted-foreground mt-1">
              No SKUs below restock threshold or projected to stock out soon.
            </p>
          </div>
        ) : (
          <div>
            <div className="grid grid-cols-12 gap-4 px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">
              <div className="col-span-5">Product</div>
              <div className="col-span-2 text-right">Stock</div>
              <div className="col-span-2 text-right">Threshold</div>
              <div className="col-span-2 text-right">Days of cover</div>
              <div className="col-span-1" />
            </div>
            <div className="divide-y divide-border">
              {alertsData.alerts.map((alert) => {
                const isCritical = alert.severity === "critical";
                const Icon =
                  alert.type === "OUT_OF_STOCK"
                    ? PackageX
                    : alert.type === "PREDICTED_STOCKOUT"
                      ? AlertTriangle
                      : AlertCircle;
                const iconWrap = isCritical
                  ? "bg-red-500/15 text-red-400"
                  : "bg-amber-500/15 text-amber-400";
                const typeLabel =
                  alert.type === "OUT_OF_STOCK"
                    ? "Out of stock"
                    : alert.type === "PREDICTED_STOCKOUT"
                      ? "Predicted stockout"
                      : "Low stock";
                const productHref = `/products?sku=${encodeURIComponent(alert.sku)}${
                  alert.category ? `&category=${encodeURIComponent(alert.category)}` : ""
                }`;
                const daysCover =
                  alert.daysOfCover === null || alert.daysOfCover === undefined
                    ? "—"
                    : `${Math.max(0, Math.round(alert.daysOfCover))}d`;
                return (
                  <div
                    key={alert.productId}
                    className="grid grid-cols-12 gap-4 items-center px-2 py-3"
                    data-testid={`alert-row-${alert.sku}`}
                  >
                    <div className="col-span-5 flex items-center gap-3 min-w-0">
                      <div className="relative shrink-0">
                        <ProductMiniature imageUrl={alert.imageUrl} name={alert.name} />
                        <span className={`absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border border-background ${iconWrap}`}>
                          <Icon className="h-2.5 w-2.5" />
                        </span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{alert.name}</span>
                          <span
                            className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                              isCritical
                                ? "bg-red-500/15 text-red-400"
                                : "bg-amber-500/15 text-amber-400"
                            }`}
                            data-testid={`alert-type-${alert.sku}`}
                          >
                            {typeLabel}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {alert.sku}
                          {alert.category ? ` · ${alert.category}` : ""} · {alert.message}
                        </p>
                      </div>
                    </div>
                    <div className="col-span-2 text-right tabular-nums text-sm">
                      {formatNumber(alert.stock)}
                    </div>
                    <div className="col-span-2 text-right tabular-nums text-sm text-muted-foreground">
                      {formatNumber(alert.restockThreshold)}
                    </div>
                    <div className="col-span-2 text-right tabular-nums text-sm text-muted-foreground">
                      {daysCover}
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <Link
                        href={productHref}
                        className="inline-flex items-center text-xs font-medium text-primary hover:underline"
                        data-testid={`alert-link-${alert.sku}`}
                        aria-label={`View ${alert.sku} in products`}
                      >
                        View <ChevronRight className="h-3 w-3" />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      {/* Top categories */}
      <Card className="p-5 bg-card border-border">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold leading-tight">Top categories</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Share of revenue across the catalog
            </p>
          </div>
          <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
            See all <ChevronRight className="h-3 w-3" />
          </button>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : topCategories.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No category data for this period.
          </p>
        ) : (
          <div>
            <div className="grid grid-cols-12 gap-4 px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">
              <div className="col-span-5">Category</div>
              <div className="col-span-3 text-right">Revenue</div>
              <div className="col-span-2 text-right">Orders</div>
              <div className="col-span-2 text-right">Share</div>
            </div>
            <div className="divide-y divide-border">
              {topCategories.map((cat) => {
                const share =
                  totalCategoryRevenue > 0 ? (cat.revenue / totalCategoryRevenue) * 100 : 0;
                return (
                  <div
                    key={cat.category}
                    className="grid grid-cols-12 gap-4 items-center px-2 py-3"
                    data-testid={`category-row-${cat.category}`}
                  >
                    <div className="col-span-5 flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/15 text-primary">
                        <Package className="h-4 w-4" />
                      </div>
                      <span className="font-medium text-sm">{cat.category}</span>
                    </div>
                    <div className="col-span-3 text-right tabular-nums text-sm">
                      {formatCurrency(cat.revenue)}
                    </div>
                    <div className="col-span-2 text-right tabular-nums text-sm text-muted-foreground">
                      {formatNumber(cat.orders)}
                    </div>
                    <div className="col-span-2 text-right">
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                        <TrendingUp className="h-3 w-3" />
                        {share.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      {/* Top sellers mini-leaderboard */}
      {(topSellersLoading || (topSellersData && topSellersData.length > 0)) && (
        <Card className="p-5 bg-card border-border">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold leading-tight">Top sellers</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Ranked by lifetime revenue
              </p>
            </div>
            <Link
              href="/sellers"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              See all <ChevronRight className="h-3 w-3" />
            </Link>
          </div>

          {topSellersLoading ? (
            <div className="space-y-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <div>
              <div className="grid grid-cols-12 gap-4 px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">
                <div className="col-span-5">Seller</div>
                <div className="col-span-3 text-right">Revenue</div>
                <div className="col-span-2 text-right">Orders</div>
                <div className="col-span-2 text-right"></div>
              </div>
              <div className="divide-y divide-border">
                {topSellersData?.map((seller, idx) => (
                  <Link
                    key={seller.id}
                    href={`/sellers/${seller.id}`}
                    className="grid grid-cols-12 gap-4 items-center px-2 py-3 hover:bg-muted/30 transition-colors rounded-sm cursor-pointer"
                    data-testid={`dashboard-top-seller-${seller.id}`}
                  >
                    <div className="col-span-5 flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/15 text-primary shrink-0">
                        <Store className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          {idx === 0 && <span className="text-[10px] text-amber-400 font-bold">#1</span>}
                          <span className="font-medium text-sm truncate">{seller.name}</span>
                        </div>
                      </div>
                    </div>
                    <div className="col-span-3 text-right tabular-nums text-sm">
                      {formatCurrency(seller.totalRevenue)}
                    </div>
                    <div className="col-span-2 text-right tabular-nums text-sm text-muted-foreground">
                      {formatNumber(seller.totalOrders)}
                    </div>
                    <div className="col-span-2 text-right">
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                        View <ChevronRight className="h-3 w-3" />
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      <DrillDownPanel date={drillDate} onClose={() => setDrillDate(null)} />
    </div>
  );
}
