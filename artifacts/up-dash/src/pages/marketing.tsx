import { useMemo, useState, useEffect } from "react";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import {
  useGetMarketing,
  useGetInsight,
  useRegenerateInsight,
  getGetInsightQueryKey,
} from "@workspace/api-client-react";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Download,
  Megaphone,
  MoreHorizontal,
  RefreshCw,
  Sparkles,
  Target,
  TrendingUp,
  Wallet,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  Users,
  DollarSign,
  Link2,
  MapPin,
  PersonStanding,
  Play,
  ExternalLink,
  Image as ImageIcon,
} from "lucide-react";
import { formatCurrency, formatNumber, formatPercentage } from "@/lib/formatters";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  ReferenceLine,
} from "recharts";
import { CountUp } from "@/components/count-up";
import { Sparkline } from "@/components/sparkline";
import { EmptyState } from "@/components/empty-state";
import { exportRowsAsCsv } from "@/lib/csv-export";
import {
  cardEntry,
  fadeInUp,
  staggerContainer,
  useReducedMotion,
  withReducedMotion,
} from "@/lib/motion";

// ── Types from API response ──────────────────────────────────────────────────
interface MarketingKpis {
  totalSpend: number;
  attributedRevenue: number;
  roas: number;
  totalLeads: number;
  approvedLeads: number;
  approvalRate: number;
  cpl: number;
  cpa: number;
}

interface CreativeRow {
  id: string;
  name: string;
  platform: string;
  status: string;
  imageUrl: string | null;
  clicks: number;
  impressions: number;
  ctr: number;
  leads: number;
  approvedLeads: number;
  spend: number;
  attributedRevenue: number;
  roas: number;
  cpl: number;
  cpa: number;
}

interface MetaTopCreative {
  id: string;
  name: string;
  status: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  leads: number;
  purchases: number;
  cpl: number;
  cpa: number;
  previewUrl?: string | null;
  thumbnailUrl?: string | null;
  imageUrl?: string | null;
  videoUrl?: string | null;
  mediaType: "video" | "image" | "unknown";
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function computeChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}

function fmtDate(d: string) {
  try { return format(new Date(d + "T12:00:00"), "MMM d"); } catch { return d; }
}

function fmtDateLong(d: string) {
  try { return format(new Date(d + "T12:00:00"), "MMM d, yyyy"); } catch { return d; }
}

/** Join two sparse date-keyed series into a combined array, filling zeros. */
function joinSeries(
  keys: string[],
  seriesA: { date: string; value: number }[],
  seriesB: { date: string; value: number }[],
): { date: string; a: number; b: number }[] {
  const mapA = new Map(seriesA.map((p) => [p.date, p.value]));
  const mapB = new Map(seriesB.map((p) => [p.date, p.value]));
  return keys.map((date) => ({ date, a: mapA.get(date) ?? 0, b: mapB.get(date) ?? 0 }));
}

const PLATFORM_COLORS: Record<string, string> = {
  META: "#1877F2",
  GOOGLE: "#EA4335",
  TIKTOK: "#25F4EE",
};

const PLATFORM_LABELS: Record<string, string> = {
  META: "Meta (Facebook / Instagram)",
  GOOGLE: "Google Ads",
  TIKTOK: "TikTok Ads",
};

const CHART_TOOLTIP_STYLE = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: 12,
};

type SortKey = "spend" | "leads" | "approvedLeads" | "roas" | "cpl" | "cpa" | "ctr" | "clicks" | "impressions" | "attributedRevenue" | "name" | "platform" | "status";
type SortDir = "asc" | "desc";

// ── KPI card ─────────────────────────────────────────────────────────────────
interface KpiCardProps {
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  label: string;
  value: number;
  format: (v: number) => string;
  unit?: string;
  change: number | null;
  sparkValues: number[];
  sparkColor: string;
  isLoading: boolean;
  testId: string;
  invertChange?: boolean;
}

function MktKpiCard({
  icon: Icon,
  iconClass,
  label,
  value,
  format: fmt,
  unit,
  change,
  sparkValues,
  sparkColor,
  isLoading,
  testId,
  invertChange = false,
}: KpiCardProps) {
  const reduced = useReducedMotion();
  const variants = withReducedMotion(cardEntry, reduced);
  const effectiveChange = invertChange && change !== null ? -change : change;
  const isUp = effectiveChange !== null && effectiveChange >= 0;
  return (
    <motion.div variants={variants}>
      <Card data-testid={testId} className="flex flex-col p-5 bg-card border-border hover:shadow-md transition-shadow">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${iconClass}`}>
              <Icon className="h-4 w-4" />
            </div>
            <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              {label}
            </span>
          </div>
          <button className="text-muted-foreground hover:text-foreground" aria-label="More options">
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-end justify-between gap-3 mb-3">
          <div className="flex items-baseline gap-1.5">
            {isLoading ? (
              <Skeleton className="h-9 w-32" />
            ) : (
              <>
                <span className="text-2xl font-semibold tracking-tight tabular-nums">
                  <CountUp value={value} format={fmt} />
                </span>
                {unit && <span className="text-xs text-muted-foreground font-medium">{unit}</span>}
              </>
            )}
          </div>
          {!isLoading && sparkValues.length > 1 && (
            <Sparkline values={sparkValues} stroke={sparkColor} fill={sparkColor + "22"} width={88} height={28} ariaLabel={`${label} sparkline`} />
          )}
        </div>

        {!isLoading && effectiveChange !== null && (
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium w-fit ${
              isUp ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
            }`}
          >
            {isUp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {isUp ? "+" : ""}{effectiveChange.toFixed(1)}%
            <span className="ml-1 text-muted-foreground font-normal">vs prev</span>
          </span>
        )}
      </Card>
    </motion.div>
  );
}

// ── Platform bar ─────────────────────────────────────────────────────────────
function PlatformRow({ platform, spend, roas, leads, clicks, maxSpend }: {
  platform: string; spend: number; roas: number; leads: number; clicks: number; maxSpend: number;
}) {
  const pct = maxSpend > 0 ? (spend / maxSpend) * 100 : 0;
  const color = PLATFORM_COLORS[platform] ?? "#6366f1";
  const label = PLATFORM_LABELS[platform] ?? platform;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
          <span className="font-medium">{label}</span>
        </div>
        <div className="flex items-center gap-4 text-muted-foreground text-xs tabular-nums">
          <span>{formatCurrency(spend)}</span>
          <span className="w-14 text-right">ROAS {roas.toFixed(2)}×</span>
          <span className="w-16 text-right">{formatNumber(leads)} leads</span>
          <span className="w-18 text-right">{formatNumber(clicks)} clicks</span>
        </div>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  );
}

// ── State row ─────────────────────────────────────────────────────────────────
function StateRow({ state, leads, attributedRevenue, roas, maxLeads }: {
  state: string; leads: number; attributedRevenue: number; roas: number; maxLeads: number;
}) {
  const pct = maxLeads > 0 ? (leads / maxLeads) * 100 : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <MapPin className="h-3 w-3 text-muted-foreground" />
          <span className="font-medium">{state}</span>
        </div>
        <div className="flex items-center gap-4 text-muted-foreground text-xs tabular-nums">
          <span>{formatNumber(leads)} leads</span>
          <span className="w-24 text-right">{formatCurrency(attributedRevenue)}</span>
          <span className="w-20 text-right">ROAS {roas.toFixed(2)}×</span>
        </div>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-violet-500"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  );
}

// ── Sort icon ────────────────────────────────────────────────────────────────
function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
  return sortDir === "desc" ? <ArrowDown className="h-3 w-3 text-primary" /> : <ArrowUp className="h-3 w-3 text-primary" />;
}

// ── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const isActive = status === "ACTIVE";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium font-mono uppercase tracking-wide ${isActive ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${isActive ? "bg-emerald-500" : "bg-amber-500"}`} />
      {status.toLowerCase()}
    </span>
  );
}

// ── Platform chip ─────────────────────────────────────────────────────────────
function PlatformChip({ platform }: { platform: string }) {
  const color = PLATFORM_COLORS[platform] ?? "#6366f1";
  const short = platform === "GOOGLE" ? "G" : platform === "TIKTOK" ? "TT" : "META";
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold font-mono" style={{ color, backgroundColor: color + "20" }}>
      {short}
    </span>
  );
}

// ── Creative thumbnail ────────────────────────────────────────────────────────
function CreativeThumbnail({ imageUrl, platform, name }: { imageUrl: string | null; platform: string; name: string }) {
  const color = PLATFORM_COLORS[platform] ?? "#6366f1";
  if (imageUrl) {
    return (
      <div className="w-10 h-10 rounded-md overflow-hidden border border-border shrink-0">
        <img src={imageUrl} alt={name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
      </div>
    );
  }
  const initial = platform.charAt(0);
  return (
    <div className="w-10 h-10 rounded-md shrink-0 flex items-center justify-center text-sm font-bold" style={{ backgroundColor: color + "22", color }}>
      {initial}
    </div>
  );
}

function CreativeMediaPreview({ creative }: { creative: MetaTopCreative }) {
  const image = creative.imageUrl ?? creative.thumbnailUrl ?? null;
  return (
    <div className="relative aspect-[4/5] w-full overflow-hidden rounded-md bg-muted">
      {creative.videoUrl ? (
        <video
          src={creative.videoUrl}
          poster={image ?? undefined}
          className="h-full w-full object-cover"
          muted
          controls
          playsInline
          preload="metadata"
        />
      ) : image ? (
        <img src={image} alt={creative.name} className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
          <ImageIcon className="h-8 w-8" />
        </div>
      )}
      {creative.mediaType === "video" && !creative.videoUrl && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/15">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white">
            <Play className="h-5 w-5 fill-current" />
          </span>
        </div>
      )}
      <div className="absolute left-2 top-2">
        <StatusBadge status={creative.status} />
      </div>
      {creative.previewUrl && (
        <a
          href={creative.previewUrl}
          target="_blank"
          rel="noreferrer"
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md bg-black/60 text-white hover:bg-black/75"
          aria-label={`Open ${creative.name} preview`}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
}

function TopCreativeCard({
  creative,
  metricLabel,
  metricValue,
  costLabel = "CPL",
}: {
  creative: MetaTopCreative;
  metricLabel: string;
  metricValue: string;
  costLabel?: string;
}) {
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3 rounded-md border border-border bg-background/40 p-3">
      <CreativeMediaPreview creative={creative} />
      <div className="min-w-0 space-y-2">
        <div>
          <p className="truncate text-sm font-medium text-foreground" title={creative.name}>
            {creative.name}
          </p>
          <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            {metricLabel} · {metricValue}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="text-muted-foreground">CTR</p>
            <p className="font-medium tabular-nums">{formatPercentage(creative.ctr)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{costLabel}</p>
            <p className="font-medium tabular-nums">{formatCurrency(costLabel === "Custo/Compra" ? creative.cpa : creative.cpl)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Leads</p>
            <p className="font-medium tabular-nums">{formatNumber(creative.leads)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Spend</p>
            <p className="font-medium tabular-nums">{formatCurrency(creative.spend)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function TopCreativesColumn({
  title,
  items,
  metric,
  costLabel,
}: {
  title: string;
  items: MetaTopCreative[];
  metric: "ctr" | "cpl" | "cpa" | "leads" | "purchases";
  costLabel?: string;
}) {
  const metricLabel = metric === "ctr" ? "CTR" : metric === "cpl" ? "CPL" : metric === "cpa" ? "Custo/Compra" : metric === "purchases" ? "Compras" : "Leads";
  const metricValue = (creative: MetaTopCreative) =>
    metric === "ctr"
      ? formatPercentage(creative.ctr)
      : metric === "cpl"
        ? formatCurrency(creative.cpl)
        : metric === "cpa"
          ? formatCurrency(creative.cpa)
          : metric === "purchases"
            ? formatNumber(creative.purchases)
        : formatNumber(creative.leads);

  return (
    <Card className="p-4 bg-card border-border">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <Sparkles className="h-4 w-4 text-muted-foreground" />
        {title}
      </h3>
      <div className="space-y-3">
        {items.length === 0 ? (
          <EmptyState icon={ImageIcon} title="No creatives" description="No Meta creative data in this period." className="h-36" />
        ) : (
          items.slice(0, 3).map((creative) => (
            <TopCreativeCard
              key={`${metric}-${creative.id}`}
              creative={creative}
              metricLabel={metricLabel}
              metricValue={metricValue(creative)}
              costLabel={costLabel}
            />
          ))
        )}
      </div>
    </Card>
  );
}

// ── AI Insight block ──────────────────────────────────────────────────────────
function InsightBlock({
  insight,
  isLoading,
  isRegenerating,
  onRegenerate,
}: {
  insight: { headline: string; body: string; bullets: string[]; generatedAt: string; cached: boolean; source: string } | null | undefined;
  isLoading: boolean;
  isRegenerating: boolean;
  onRegenerate: () => void;
}) {
  if (!isLoading && !insight) return null;
  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <Card className="p-5 bg-gradient-to-br from-violet-500/5 to-violet-500/0 border-violet-500/20">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15 shrink-0 mt-0.5">
            <Sparkles className="h-4 w-4 text-violet-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-mono uppercase tracking-wider text-violet-400">AI Marketing Insight</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={onRegenerate}
                disabled={isRegenerating}
                data-testid="insight-regenerate"
              >
                <RefreshCw className={`h-3 w-3 mr-1.5 ${isRegenerating ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
            {isLoading ? (
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-4 w-3/5" />
              </div>
            ) : insight ? (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-foreground">{insight.headline}</p>
                <p className="text-sm text-foreground/80 leading-relaxed">{insight.body}</p>
                {insight.bullets.length > 0 && (
                  <ul className="space-y-1 mt-2">
                    {insight.bullets.map((b, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                        <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-violet-400 shrink-0" />
                        {b}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

// ── Chart helper: X/Y axes + tooltip styles ─────────────────────────────────
const AXIS_TICK = { fontSize: 10, fill: "hsl(var(--muted-foreground))" };

// ── Page ─────────────────────────────────────────────────────────────────────
export default function MarketingPage() {
  const { selectedClientId, selectedDashboardMode, user } = useAuth();
  const { dateRange, filters } = useDashboardFilters();
  const reduced = useReducedMotion();
  const queryClient = useQueryClient();

  const clientId = user?.role === "ADMIN" ? selectedClientId || undefined : undefined;
  const enabled = user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId);
  const isB2C = selectedDashboardMode === "B2C";

  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const dateParams = {
    dateFrom: format(dateRange.from, "yyyy-MM-dd"),
    dateTo: format(dateRange.to, "yyyy-MM-dd"),
  };
  const [creativesPage, setCreativesPage] = useState(1);
  const CREATIVES_PAGE_SIZE = 20;

  // Reset page to 1 whenever the client or date window changes to avoid stale empty-table states
  const dateFrom = dateParams.dateFrom;
  const dateTo = dateParams.dateTo;
  useEffect(() => { setCreativesPage(1); }, [clientId, dateFrom, dateTo]);

  const insightParams = { clientId, ...dateParams, screen: "marketing" as const };

  const { data, isLoading, isError, refetch } = useGetMarketing(
    {
      clientId,
      ...dateParams,
      creativesPage,
      creativesPageSize: CREATIVES_PAGE_SIZE,
      utmSource: filters.utmSource || undefined,
      utmMedium: filters.utmMedium || undefined,
      creative: filters.creative || undefined,
    },
    { query: queryOpts({ enabled }) },
  );

  const { data: insight, isLoading: insightLoading } = useGetInsight(insightParams, {
    query: queryOpts({ enabled }),
  });
  const regenerateInsight = useRegenerateInsight({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetInsightQueryKey(insightParams) });
      },
    },
  });

  // ── KPI changes ──────────────────────────────────────────────────────────
  const spendChange = useMemo(() => data ? computeChange(data.kpis.totalSpend, data.prevKpis.totalSpend) : null, [data]);
  const revenueChange = useMemo(() => data ? computeChange(data.kpis.attributedRevenue, data.prevKpis.attributedRevenue) : null, [data]);
  const roasChange = useMemo(() => data ? computeChange(data.kpis.roas, data.prevKpis.roas) : null, [data]);
  const approvalRateChange = useMemo(() => data ? computeChange(data.kpis.approvalRate, data.prevKpis.approvalRate) : null, [data]);
  const leadsChange = useMemo(() => data ? computeChange(data.kpis.totalLeads, data.prevKpis.totalLeads) : null, [data]);
  const approvedLeadsChange = useMemo(() => data ? computeChange(data.kpis.approvedLeads, data.prevKpis.approvedLeads) : null, [data]);
  const cplChange = useMemo(() => data ? computeChange(data.kpis.cpl, data.prevKpis.cpl) : null, [data]);
  const cpaChange = useMemo(() => data ? computeChange(data.kpis.cpa, data.prevKpis.cpa) : null, [data]);

  // ── Sparklines (reuse time-series data) ──────────────────────────────────
  const sparkLeads = data?.leadsOverTime.map((p) => p.value) ?? [];
  const sparkRevenue = data?.revenueOverTime.map((p) => p.value) ?? [];
  const sparkSpend = data?.spendOverTime.map((p) => p.value) ?? [];

  // ── Chart 1: Spend vs Leads dual-axis ────────────────────────────────────
  const spendLeadsData = useMemo(() => {
    if (!data) return [];
    const spendDates = data.spendOverTime.map((p) => p.date);
    return joinSeries(spendDates, data.spendOverTime, data.leadsOverTime).map((p) => ({
      date: p.date,
      spend: p.a,
      leads: p.b,
    }));
  }, [data]);

  // ── Chart 2: Spend vs Revenue dual-axis ──────────────────────────────────
  const spendVsRevenueData = useMemo(() => {
    if (!data) return [];
    return joinSeries(
      data.spendOverTime.map((p) => p.date),
      data.spendOverTime,
      data.revenueOverTime,
    ).map((p) => ({ date: p.date, spend: p.a, revenue: p.b }));
  }, [data]);

  // ── Chart 3: ROAS over time ───────────────────────────────────────────────
  const roasData = useMemo(() => {
    if (!data) return [];
    const spendMap = new Map(data.spendOverTime.map((p) => [p.date, p.value]));
    const revMap = new Map(data.revenueOverTime.map((p) => [p.date, p.value]));
    return data.spendOverTime.map((p) => {
      const sp = spendMap.get(p.date) ?? 0;
      const rev = revMap.get(p.date) ?? 0;
      return { date: p.date, roas: sp > 0 ? Math.round((rev / sp) * 100) / 100 : 0 };
    });
  }, [data]);

  // ── Platform breakdown ────────────────────────────────────────────────────
  const platformRows = useMemo(() => [...(data?.platformBreakdown ?? [])].sort((a, b) => b.spend - a.spend), [data]);
  const maxPlatformSpend = platformRows[0]?.spend ?? 0;

  // ── State breakdown ───────────────────────────────────────────────────────
  const stateRows = data?.stateBreakdown ?? [];
  const maxStateLeads = stateRows[0]?.leads ?? 0;

  // ── Sorted campaigns ──────────────────────────────────────────────────────
  const sortedCreatives = useMemo(() => {
    if (!data?.creatives) return [];
    return [...data.creatives].sort((a, b) => {
      const va = a[sortKey as keyof typeof a];
      const vb = b[sortKey as keyof typeof b];
      if (typeof va === "string" && typeof vb === "string") {
        const cmp = va.localeCompare(vb);
        return sortDir === "asc" ? cmp : -cmp;
      }
      return sortDir === "desc" ? (vb as number) - (va as number) : (va as number) - (vb as number);
    });
  }, [data?.creatives, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  function handleExport() {
    if (!data?.creatives) return;
    exportRowsAsCsv(
      `marketing-campaigns-${format(dateRange.from, "yyyyMMdd")}-${format(dateRange.to, "yyyyMMdd")}.csv`,
      sortedCreatives,
      isB2C ? [
        { header: "Name", accessor: (r) => r.name },
        { header: "Platform", accessor: (r) => r.platform },
        { header: "Status", accessor: (r) => r.status },
        { header: "Spend", accessor: (r) => r.spend },
        { header: "Purchases", accessor: (r) => r.approvedLeads },
        { header: "Custo por Compra", accessor: (r) => r.cpa.toFixed(2) },
        { header: "Attributed Revenue", accessor: (r) => r.attributedRevenue.toFixed(2) },
        { header: "ROAS", accessor: (r) => r.roas.toFixed(2) },
        { header: "Clicks", accessor: (r) => r.clicks },
        { header: "Impressions", accessor: (r) => r.impressions },
        { header: "CTR %", accessor: (r) => r.ctr.toFixed(2) },
      ] : [
        { header: "Name", accessor: (r) => r.name },
        { header: "Platform", accessor: (r) => r.platform },
        { header: "Status", accessor: (r) => r.status },
        { header: "Spend", accessor: (r) => r.spend },
        { header: "Leads", accessor: (r) => r.leads },
        { header: "Approved Leads", accessor: (r) => r.approvedLeads },
        { header: "CPL", accessor: (r) => r.cpl.toFixed(2) },
        { header: "CPA", accessor: (r) => r.cpa.toFixed(2) },
        { header: "Attributed Revenue", accessor: (r) => r.attributedRevenue.toFixed(2) },
        { header: "ROAS", accessor: (r) => r.roas.toFixed(2) },
        { header: "Clicks", accessor: (r) => r.clicks },
        { header: "Impressions", accessor: (r) => r.impressions },
        { header: "CTR %", accessor: (r) => r.ctr.toFixed(2) },
      ],
    );
  }

  const containerVariants = withReducedMotion(staggerContainer, reduced);
  const fadeVariants = withReducedMotion(fadeInUp, reduced);

  const hasNoData = !isLoading && data && (data.kpis.totalSpend === 0 || data.creatives.length === 0);

  if (isError) {
    return (
      <Alert variant="destructive" data-testid="page-marketing">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription className="flex items-center justify-between">
          Failed to load marketing data.
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6" data-testid="page-marketing">
      {/* Toolbar */}
      <motion.div initial="hidden" animate="visible" variants={fadeVariants} className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="relative flex h-1.5 w-1.5">
            {!reduced && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-500/60" />
            )}
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-violet-500" />
          </span>
          <span className="font-mono uppercase tracking-wider">
            Paid channels · {format(dateRange.from, "MMM d")} → {format(dateRange.to, "MMM d, yyyy")}
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={!data} data-testid="marketing-export-csv">
          <Download className="h-4 w-4 mr-1.5" />
          Export CSV
        </Button>
      </motion.div>

      {/* Empty state: no ad account data */}
      {hasNoData && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="p-12 border-dashed border-2 border-border/60 bg-card/30 flex flex-col items-center text-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-500/10">
              <Link2 className="h-7 w-7 text-violet-400" />
            </div>
            <div>
              <h3 className="text-base font-semibold mb-1">No paid channel data yet</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                Connect your ad accounts (Meta, Google, TikTok) to start tracking spend, ROA, and campaign performance in this period.
              </p>
            </div>
            <Button variant="outline" size="sm" className="gap-2">
              <Link2 className="h-4 w-4" />
              Connect ad accounts
            </Button>
          </Card>
        </motion.div>
      )}

      {/* AI Insight block */}
      {!hasNoData && (
        <InsightBlock
          insight={insight}
          isLoading={insightLoading}
          isRegenerating={regenerateInsight.isPending}
          onRegenerate={() => regenerateInsight.mutate({ params: insightParams })}
        />
      )}

      {/* KPI grid — 8 tiles */}
      {!hasNoData && (
        <motion.div
          initial="hidden"
          animate="visible"
          variants={containerVariants}
          className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4"
        >
          <MktKpiCard
            testId="kpi-ad-spend"
            icon={Wallet}
            iconClass="bg-violet-500/15 text-violet-400"
            label="Ad Spend"
            value={data?.kpis.totalSpend ?? 0}
            format={formatCurrency}
            change={spendChange}
            sparkValues={sparkSpend}
            sparkColor="#a78bfa"
            isLoading={isLoading}
          />
          <MktKpiCard
            testId="kpi-revenue"
            icon={DollarSign}
            iconClass="bg-teal-500/15 text-teal-400"
            label="Revenue"
            value={data?.kpis.attributedRevenue ?? 0}
            format={formatCurrency}
            change={revenueChange}
            sparkValues={sparkRevenue}
            sparkColor="#2dd4bf"
            isLoading={isLoading}
          />
          <MktKpiCard
            testId="kpi-roas"
            icon={TrendingUp}
            iconClass="bg-emerald-500/15 text-emerald-400"
            label="ROA"
            value={data?.kpis.roas ?? 0}
            format={(v) => `${v.toFixed(2)}×`}
            change={roasChange}
            sparkValues={sparkRevenue}
            sparkColor="#34d399"
            isLoading={isLoading}
          />
          <MktKpiCard
            testId="kpi-approval-rate"
            icon={CheckCircle2}
            iconClass="bg-indigo-500/15 text-indigo-400"
            label="Approval Rate"
            value={data?.kpis.approvalRate ?? 0}
            format={formatPercentage}
            change={approvalRateChange}
            sparkValues={sparkLeads}
            sparkColor="#818cf8"
            isLoading={isLoading}
          />
          <MktKpiCard
            testId="kpi-leads"
            icon={Users}
            iconClass="bg-sky-500/15 text-sky-400"
            label="Total Leads"
            value={data?.kpis.totalLeads ?? 0}
            format={formatNumber}
            change={leadsChange}
            sparkValues={sparkLeads}
            sparkColor="#38bdf8"
            isLoading={isLoading}
          />
          <MktKpiCard
            testId="kpi-approved-leads"
            icon={CheckCircle2}
            iconClass="bg-green-500/15 text-green-400"
            label={isB2C ? "Compras" : "Approved Leads"}
            value={data?.kpis.approvedLeads ?? 0}
            format={formatNumber}
            change={approvedLeadsChange}
            sparkValues={sparkLeads}
            sparkColor="#4ade80"
            isLoading={isLoading}
          />
          <MktKpiCard
            testId="kpi-cpl"
            icon={Target}
            iconClass="bg-orange-500/15 text-orange-400"
            label={isB2C ? "Custo por Compra" : "CPL"}
            value={isB2C ? data?.kpis.cpa ?? 0 : data?.kpis.cpl ?? 0}
            format={formatCurrency}
            change={isB2C ? cpaChange : cplChange}
            sparkValues={sparkSpend}
            sparkColor="#fb923c"
            isLoading={isLoading}
            invertChange
          />
          {!isB2C && (
            <MktKpiCard
              testId="kpi-cpa"
              icon={Sparkles}
              iconClass="bg-amber-500/15 text-amber-400"
              label="CPA"
              value={data?.kpis.cpa ?? 0}
              format={formatCurrency}
              change={cpaChange}
              sparkValues={sparkSpend}
              sparkColor="#fbbf24"
              isLoading={isLoading}
              invertChange
            />
          )}
        </motion.div>
      )}

      {!hasNoData && (
        <motion.div initial="hidden" animate="visible" variants={fadeVariants}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Top Meta Creatives</h2>
            <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              {isB2C ? "CTR · Custo por Compra · Compras" : "CTR · CPL · Leads"}
            </span>
          </div>
          {isLoading ? (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, idx) => (
                <Card key={idx} className="p-4">
                  <Skeleton className="h-4 w-32 mb-3" />
                  <Skeleton className="h-32 w-full" />
                </Card>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <TopCreativesColumn title="Best CTR" items={data?.topCreatives?.ctr ?? []} metric="ctr" costLabel={isB2C ? "Custo/Compra" : "CPL"} />
              <TopCreativesColumn title={isB2C ? "Menor custo por compra" : "Lowest CPL"} items={data?.topCreatives?.cpl ?? []} metric={isB2C ? "cpa" : "cpl"} costLabel={isB2C ? "Custo/Compra" : "CPL"} />
              <TopCreativesColumn title={isB2C ? "Mais compras" : "Most Leads"} items={data?.topCreatives?.leads ?? []} metric={isB2C ? "purchases" : "leads"} costLabel={isB2C ? "Custo/Compra" : "CPL"} />
            </div>
          )}
        </motion.div>
      )}

      {/* Charts row */}
      {!hasNoData && (
        <motion.div initial="hidden" animate="visible" variants={fadeVariants} className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {/* Chart 1: Spend vs Leads dual-axis */}
          <Card className="xl:col-span-2 p-5 bg-card border-border">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-4">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              Spend vs Leads
            </h2>
            {isLoading ? (
              <Skeleton className="h-52 w-full" />
            ) : spendLeadsData.length === 0 ? (
              <EmptyState icon={BarChart3} title="No data" description="No paid-channel activity in this period." className="h-52" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={spendLeadsData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
                  <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={fmtDate} interval="preserveStartEnd" />
                  <YAxis yAxisId="left" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatCurrency(v)} width={60} />
                  <YAxis yAxisId="right" orientation="right" tick={AXIS_TICK} tickLine={false} axisLine={false} width={36} />
                  <Tooltip
                    contentStyle={CHART_TOOLTIP_STYLE}
                    labelFormatter={fmtDateLong}
                    formatter={(value: number, name: string) => [
                      name === "spend" ? formatCurrency(value) : formatNumber(value),
                      name === "spend" ? "Ad Spend" : "Leads",
                    ]}
                  />
                  <Bar yAxisId="left" dataKey="spend" fill="#a78bfa" opacity={0.8} radius={[2, 2, 0, 0]} name="spend" />
                  <Line yAxisId="right" type="monotone" dataKey="leads" stroke="#38bdf8" strokeWidth={2} dot={false} activeDot={{ r: 4 }} name="leads" />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </Card>

          {/* Chart 2: ROAS over time */}
          <Card className="p-5 bg-card border-border">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-4">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              ROAS Over Time
            </h2>
            {isLoading ? (
              <Skeleton className="h-52 w-full" />
            ) : roasData.length === 0 ? (
              <EmptyState icon={TrendingUp} title="No data" description="No ROAS data in this period." className="h-52" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={roasData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="roasGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#34d399" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
                  <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={fmtDate} interval="preserveStartEnd" />
                  <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={36} tickFormatter={(v: number) => `${v}×`} />
                  <Tooltip
                    contentStyle={CHART_TOOLTIP_STYLE}
                    labelFormatter={fmtDateLong}
                    formatter={(v: number) => [`${v.toFixed(2)}×`, "ROAS"]}
                  />
                  <ReferenceLine y={2} stroke="#f97316" strokeDasharray="4 4" strokeOpacity={0.6} label={{ value: "Target 2×", position: "insideTopRight", fontSize: 9, fill: "#f97316" }} />
                  <Area type="monotone" dataKey="roas" stroke="#34d399" strokeWidth={2} fill="url(#roasGrad)" dot={false} activeDot={{ r: 4, fill: "#34d399" }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </Card>
        </motion.div>
      )}

      {/* Spend vs Revenue chart */}
      {!hasNoData && (
        <motion.div initial="hidden" animate="visible" variants={fadeVariants}>
          <Card className="p-5 bg-card border-border">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                Spend vs Revenue
              </h2>
              <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-6 rounded bg-violet-500/60" /> Spend</span>
                <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-6 rounded bg-teal-400" /> Revenue</span>
              </div>
            </div>
            {isLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : spendVsRevenueData.length === 0 ? (
              <EmptyState icon={DollarSign} title="No data" description="No paid-channel activity in this period." className="h-48" />
            ) : (
              <ResponsiveContainer width="100%" height={192}>
                <ComposedChart data={spendVsRevenueData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="spendGrad2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.7} />
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.15} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
                  <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={fmtDate} interval="preserveStartEnd" />
                  <YAxis yAxisId="left" tick={AXIS_TICK} tickLine={false} axisLine={false} width={62} tickFormatter={(v: number) => formatCurrency(v)} />
                  <YAxis yAxisId="right" orientation="right" tick={AXIS_TICK} tickLine={false} axisLine={false} width={62} tickFormatter={(v: number) => formatCurrency(v)} />
                  <Tooltip
                    contentStyle={CHART_TOOLTIP_STYLE}
                    labelFormatter={fmtDateLong}
                    formatter={(v: number, name: string) => [formatCurrency(v), name === "spend" ? "Spend" : "Revenue"]}
                  />
                  <Bar yAxisId="left" dataKey="spend" fill="url(#spendGrad2)" radius={[3, 3, 0, 0]} maxBarSize={32} />
                  <Line yAxisId="right" type="monotone" dataKey="revenue" stroke="#2dd4bf" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </Card>
        </motion.div>
      )}

      {/* Platform + State breakdowns */}
      {!hasNoData && (
        <motion.div initial="hidden" animate="visible" variants={fadeVariants} className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* Platform breakdown */}
          <Card className="p-5 bg-card border-border">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-5">
              <Megaphone className="h-4 w-4 text-muted-foreground" />
              By Platform
            </h2>
            {isLoading ? (
              <div className="space-y-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : platformRows.length === 0 ? (
              <EmptyState icon={Megaphone} title="No campaigns" description="No active campaigns found for this brand." />
            ) : (
              <div className="space-y-5">
                {platformRows.map((row) => (
                  <PlatformRow key={row.platform} platform={row.platform} spend={row.spend} roas={row.roas} leads={row.leads} clicks={row.clicks} maxSpend={maxPlatformSpend} />
                ))}
              </div>
            )}
          </Card>

          {/* State breakdown */}
          <Card className="p-5 bg-card border-border">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-5">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              Top States by ROAS
            </h2>
            {isLoading ? (
              <div className="space-y-4">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : stateRows.length === 0 ? (
              <EmptyState icon={MapPin} title="No geographic data" description="No paid-channel leads with state data in this period." />
            ) : (
              <div className="space-y-5">
                {stateRows.map((row) => (
                  <StateRow key={row.state} state={row.state} leads={row.leads} attributedRevenue={row.attributedRevenue} roas={row.roas} maxLeads={maxStateLeads} />
                ))}
              </div>
            )}
          </Card>
        </motion.div>
      )}

      {/* Age-group breakdown — shown only when demographic data is available */}
      {!hasNoData && (data?.ageBreakdown ?? []).length > 0 && (
        <motion.div initial="hidden" animate="visible" variants={fadeVariants}>
          <Card className="p-5 bg-card border-border">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-5">
              <PersonStanding className="h-4 w-4 text-muted-foreground" />
              Customer Age Groups (Paid Leads)
            </h2>
            <div className="space-y-5">
              {(data!.ageBreakdown).map((row, i) => {
                const maxLeads = Math.max(...data!.ageBreakdown.map((r) => r.leads));
                const pct = maxLeads > 0 ? (row.leads / maxLeads) * 100 : 0;
                const colors = ["#a78bfa", "#38bdf8", "#34d399", "#fbbf24", "#f97316"];
                const color = colors[i % colors.length];
                return (
                  <div key={row.ageGroup} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{row.ageGroup}</span>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground tabular-nums">
                        <span>{formatNumber(row.leads)} leads</span>
                        <span className="w-24 text-right">{formatCurrency(row.attributedRevenue)}</span>
                        <span className="w-14 text-right">ROAS {row.roas.toFixed(2)}×</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ backgroundColor: color }}
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </motion.div>
      )}

      {/* Campaigns table */}
      {!hasNoData && (
        <motion.div initial="hidden" animate="visible" variants={fadeVariants}>
          <Card className="bg-card border-border overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">Campaign Performance</h2>
              <p className="text-xs text-muted-foreground">
                {data ? `${Math.min((creativesPage - 1) * CREATIVES_PAGE_SIZE + 1, data.creativesTotal)}–${Math.min(creativesPage * CREATIVES_PAGE_SIZE, data.creativesTotal)} of ${data.creativesTotal}` : "—"} · click headers to sort
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {(
                      [
                        { key: "name" as SortKey, label: "Campaign", align: "left", wide: true },
                        { key: "platform" as SortKey, label: "Platform", align: "left", wide: false },
                        { key: "status" as SortKey, label: "Status", align: "left", wide: false },
                        { key: "spend" as SortKey, label: "Spend", align: "right", wide: false },
                        { key: "attributedRevenue" as SortKey, label: "Revenue", align: "right", wide: false },
                        { key: "roas" as SortKey, label: "ROA", align: "right", wide: false },
                        { key: "leads" as SortKey, label: "Leads", align: "right", wide: false },
                        { key: "approvedLeads" as SortKey, label: isB2C ? "Compras" : "Purchases", align: "right", wide: false },
                        ...(isB2C
                          ? [{ key: "cpa" as SortKey, label: "Custo/Compra", align: "right" as const, wide: false }]
                          : [
                              { key: "cpl" as SortKey, label: "CPL", align: "right" as const, wide: false },
                              { key: "cpa" as SortKey, label: "CPA", align: "right" as const, wide: false },
                            ]),
                        { key: "clicks" as SortKey, label: "Clicks", align: "right", wide: false },
                        { key: "ctr" as SortKey, label: "CTR %", align: "right", wide: false },
                      ] as { key: SortKey; label: string; align: "left" | "right"; wide: boolean }[]
                    ).map(({ key, label, align, wide }) => (
                      <th key={key} className={`${wide ? "px-5 w-52" : "px-4"} py-3 text-${align} cursor-pointer select-none`} onClick={() => handleSort(key)}>
                        <span className={`flex items-center gap-1 text-[11px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors ${align === "right" ? "justify-end" : "justify-start"}`}>
                          {label}
                          <SortIcon col={key} sortKey={sortKey} sortDir={sortDir} />
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i} className="border-b border-border/50">
                        <td className="px-5 py-3"><Skeleton className="h-4 w-40" /></td>
                        {Array.from({ length: isB2C ? 10 : 11 }).map((_, j) => (
                          <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-14 ml-auto" /></td>
                        ))}
                      </tr>
                    ))
                  ) : sortedCreatives.length === 0 ? (
                    <tr>
                      <td colSpan={isB2C ? 11 : 12} className="px-5 py-10 text-center text-muted-foreground text-sm">
                        No campaigns found for this brand.
                      </td>
                    </tr>
                  ) : (
                    sortedCreatives.map((creative, idx) => (
                      <tr key={creative.id} className={`border-b border-border/50 hover:bg-accent/20 transition-colors ${idx % 2 === 0 ? "" : "bg-muted/10"}`}>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <CreativeThumbnail imageUrl={creative.imageUrl ?? null} platform={creative.platform} name={creative.name} />
                            <span className="font-medium text-sm truncate max-w-[180px]" title={creative.name}>{creative.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3"><PlatformChip platform={creative.platform} /></td>
                        <td className="px-4 py-3"><StatusBadge status={creative.status} /></td>
                        <td className="px-4 py-3 text-right tabular-nums font-medium">{formatCurrency(creative.spend)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-teal-400">{formatCurrency(creative.attributedRevenue)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          <span className={`font-semibold ${creative.roas >= 3 ? "text-emerald-400" : creative.roas >= 1.5 ? "text-amber-400" : "text-red-400"}`}>
                            {creative.roas.toFixed(2)}×
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{formatNumber(creative.leads)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-emerald-400">{formatNumber(creative.approvedLeads)}</td>
                        {!isB2C && <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{formatCurrency(creative.cpl)}</td>}
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{formatCurrency(creative.cpa)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{formatNumber(creative.clicks)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{formatPercentage(creative.ctr)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {/* Pagination footer */}
            {data && data.creativesTotal > CREATIVES_PAGE_SIZE && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-muted/10">
                <p className="text-xs text-muted-foreground">
                  Page {creativesPage} of {Math.ceil(data.creativesTotal / CREATIVES_PAGE_SIZE)}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCreativesPage((p) => Math.max(1, p - 1))}
                    disabled={creativesPage === 1}
                    className="px-3 py-1.5 text-xs rounded-md border border-border bg-background hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setCreativesPage((p) => Math.min(Math.ceil(data.creativesTotal / CREATIVES_PAGE_SIZE), p + 1))}
                    disabled={creativesPage * CREATIVES_PAGE_SIZE >= data.creativesTotal}
                    className="px-3 py-1.5 text-xs rounded-md border border-border bg-background hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </Card>
        </motion.div>
      )}
    </div>
  );
}
