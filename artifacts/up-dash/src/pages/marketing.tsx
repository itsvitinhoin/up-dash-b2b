import { usePreviousPeriodQuery } from "@/lib/previous-period-query";
import { getGetMarketingUrl } from "@workspace/api-client-react";
import { useDisplayLabel } from "@/lib/display-label";
import { GlassMetricCard } from "@/components/glass-metric-card";
import { useMemo, useState, useEffect } from "react";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
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
  if (previous === 0) return current === 0 ? 0 : null;
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
  META: "#5b8dff",
  GOOGLE: "#0458fe",
  TIKTOK: "#afc4ff",
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
  previousValue?: number;
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
  invertChange = false, previousValue,
}: KpiCardProps) {
  const reduced = useReducedMotion();
  const variants = withReducedMotion(cardEntry, reduced);
  return (<GlassMetricCard label={label} value={value} icon={Icon} format={fmt} unit={unit} change={change} previousValue={previousValue} changePositive={change !== null ? (invertChange ? change <= 0 : change >= 0) : undefined} source="Meta Ads · Google Ads · UP Zero" sparkValues={sparkValues} loading={isLoading} testId={testId} />);
}

// ── Platform bar ─────────────────────────────────────────────────────────────
function PlatformRow({ platform, spend, roas, leads, clicks, maxSpend }: {
  platform: string; spend: number; roas: number; leads: number; clicks: number; maxSpend: number;
}) {
  const pct = maxSpend > 0 ? (spend / maxSpend) * 100 : 0;
  const color = PLATFORM_COLORS[platform] ?? "#5b8dff";
  const label = PLATFORM_LABELS[platform] ?? platform;
  return (
    <div className="space-y-1.5">
      <div className="up-channel-row space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
          <span className="font-medium">{label}</span>
        </div>
        <div className="up-channel-summary text-muted-foreground text-xs tabular-nums">
          <span>{formatCurrency(spend)}</span>
          <span>ROAS {roas.toFixed(2)}×</span>
          <span>{formatNumber(leads)} leads</span>
          <span>{formatNumber(clicks)} cliques</span>
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
      <div className="up-channel-row space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <MapPin className="h-3 w-3 text-muted-foreground" />
          <span className="font-medium">{state}</span>
        </div>
        <div className="up-channel-summary text-muted-foreground text-xs tabular-nums">
          <span>{formatNumber(leads)} leads</span>
          <span>{formatCurrency(attributedRevenue)}</span>
          <span>ROAS {roas.toFixed(2)}×</span>
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
  const displayLabel = useDisplayLabel();
  const isActive = status === "ACTIVE";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium font-mono uppercase tracking-wide ${isActive ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${isActive ? "bg-emerald-500" : "bg-amber-500"}`} />
      {displayLabel(status)}
    </span>
  );
}

// ── Platform chip ─────────────────────────────────────────────────────────────
function PlatformChip({ platform }: { platform: string }) {
  const color = PLATFORM_COLORS[platform] ?? "#5b8dff";
  const short = platform === "GOOGLE" ? "G" : platform === "TIKTOK" ? "TT" : "META";
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold font-mono" style={{ color, backgroundColor: color + "20" }}>
      {short}
    </span>
  );
}

// ── Creative thumbnail ────────────────────────────────────────────────────────
function CreativeThumbnail({ imageUrl, platform, name }: { imageUrl: string | null; platform: string; name: string }) {
  const color = PLATFORM_COLORS[platform] ?? "#5b8dff";
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
          aria-label={`Abrir ${creative.name} preview`}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
}

function TopCreativeCard({
  creative,
  previous,
  metricLabel,
  metricValue,
  costLabel = "CPL",
}: {
  creative: MetaTopCreative;
  previous?: Pick<MetaTopCreative, "id" | "ctr" | "cpa" | "cpl" | "leads" | "spend">;
  metricLabel: string;
  metricValue: string;
  costLabel?: string;
}) {
  return (
    <Card className="up-creative-card" data-testid="top-creative-card">
      <div className="up-creative-head">
        <CreativeMediaPreview creative={creative} />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground" title={creative.name}>{creative.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">{metricLabel} · {metricValue}</p>
        </div>
      </div>
      <div className="up-metric-grid up-creative-metrics">
        <GlassMetricCard label="CTR" value={creative.ctr} format={formatPercentage} previousValue={previous?.ctr} source="Meta Ads · criativo" />
        <GlassMetricCard lowerIsBetter label={costLabel} value={costLabel === "Custo/Compra" ? creative.cpa : creative.cpl} format={formatCurrency} previousValue={costLabel === "Custo/Compra" ? previous?.cpa : previous?.cpl} source="Meta Ads · criativo" />
        <GlassMetricCard label="Leads" value={creative.leads} format={formatNumber} previousValue={previous?.leads} source="Meta Ads · criativo" />
        <GlassMetricCard label="Investimento" value={creative.spend} format={formatCurrency} previousValue={previous?.spend} source="Meta Ads · criativo" />
      </div>
    </Card>
  );
}

function TopCreativesColumn({
  title,
  items,
  previousItems,
  metric,
  costLabel,
}: {
  title: string;
  items: MetaTopCreative[];
  previousItems?: Array<Pick<MetaTopCreative, "id" | "ctr" | "cpa" | "cpl" | "leads" | "spend">>;
  metric: "ctr" | "cpl" | "cpa" | "leads" | "purchases";
  costLabel?: string;
}) {
  const { tx } = useI18n();
  const metricLabel = metric === "ctr" ? "CTR" : metric === "cpl" ? "CPL" : metric === "cpa" ? "Custo/Compra" : metric === "purchases" ? tx("Compras") : "Leads";
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
          <EmptyState icon={ImageIcon} title={tx("Nenhum criativo")} description={tx("Sem dados de criativos da Meta neste período.")} className="h-36" />
        ) : (
          items.slice(0, 3).map((creative) => (
            <TopCreativeCard
              key={`${metric}-${creative.id}`}
              creative={creative}
              previous={previousItems?.find(item => item.id === creative.id)}
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
  const { tx } = useI18n();
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
              <span className="text-[11px] font-mono uppercase tracking-wider text-violet-400">{tx("Análise de anúncios com IA")}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={onRegenerate}
                disabled={isRegenerating}
                data-testid="insight-regenerate"
              >
                <RefreshCw className={`h-3 w-3 mr-1.5 ${isRegenerating ? "animate-spin" : ""}`} />
                {tx("Atualizar")}
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
  const { tx } = useI18n();
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

  const { language: insightLanguage } = useI18n();
  const insightParams = { clientId, ...dateParams, screen: "marketing" as const, language: insightLanguage };

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
  const previousMarketing = usePreviousPeriodQuery<NonNullable<typeof data>>(getGetMarketingUrl({ clientId, ...dateParams, creativesPage, creativesPageSize: CREATIVES_PAGE_SIZE, utmSource: filters.utmSource || undefined, utmMedium: filters.utmMedium || undefined, creative: filters.creative || undefined }), enabled);
  const previousCreatives = [ ...(previousMarketing.data?.creatives ?? []), ...(previousMarketing.data?.topCreatives.ctr ?? []), ...(previousMarketing.data?.topCreatives.cpl ?? []), ...(previousMarketing.data?.topCreatives.leads ?? []) ];
  const spendChange = useMemo(() => data ? computeChange(data.kpis.totalSpend, data.prevKpis.totalSpend) : null, [data]);
  const revenueChange = useMemo(() => data ? computeChange(data.kpis.attributedRevenue, data.prevKpis.attributedRevenue) : null, [data]);
  const roasChange = useMemo(() => data ? computeChange(data.kpis.roas, data.prevKpis.roas) : null, [data]);
  const approvalRateChange = useMemo(() => data ? computeChange(data.kpis.approvalRate, data.prevKpis.approvalRate) : null, [data]);
  const leadsChange = useMemo(() => data ? computeChange(data.kpis.totalLeads, data.prevKpis.totalLeads) : null, [data]);
  const approvedLeadsChange = useMemo(() => data ? computeChange(data.kpis.approvedLeads, data.prevKpis.approvedLeads) : null, [data]);
  const cplChange = useMemo(() => data ? computeChange(data.kpis.cpl, data.prevKpis.cpl) : null, [data]);
  const cpaChange = useMemo(() => data ? computeChange(data.kpis.cpa, data.prevKpis.cpa) : null, [data]);

  // "Top Meta Creatives" (Best CTR/Lowest CPL/Most Leads) sempre mostrava
  // "No creatives" pra QUALQUER client (B2C ou Vesti) — não é bug de dado,
  // é que `data.topCreatives` nunca existiu no contrato da API
  // (GetMarketingResponse não declara esse campo), então sempre lia
  // `undefined`. `data.creatives` (a lista paginada de anúncios) sempre
  // teve dado real. Deriva os 3 rankings aqui em vez de depender de um
  // campo que o backend nunca manda.
  const topCreatives = useMemo(() => {
    const creatives = data?.creatives ?? [];
    const toTopCreative = (c: CreativeRow): MetaTopCreative => ({
      id: c.id,
      name: c.name,
      status: c.status,
      spend: c.spend,
      impressions: c.impressions,
      clicks: c.clicks,
      ctr: c.ctr,
      leads: c.leads,
      purchases: c.approvedLeads,
      cpl: c.cpl,
      cpa: c.cpa,
      imageUrl: c.imageUrl,
      mediaType: "unknown",
    });
    const byCtr = [...creatives].sort((a, b) => b.ctr - a.ctr).slice(0, 3).map(toTopCreative);
    // CPL só faz sentido comparando quem teve lead — senão um anúncio com
    // gasto mínimo e 0 lead "ganha" por CPL zerado, o que é enganoso.
    const byCpl = [...creatives].filter((c) => c.leads > 0).sort((a, b) => a.cpl - b.cpl).slice(0, 3).map(toTopCreative);
    const byLeads = [...creatives].sort((a, b) => b.leads - a.leads).slice(0, 3).map(toTopCreative);
    return { ctr: byCtr, cpl: byCpl, leads: byLeads };
  }, [data]);

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
        { header: tx("Nome"), accessor: (r) => r.name },
        { header: tx("Plataforma"), accessor: (r) => r.platform },
        { header: "Status", accessor: (r) => r.status },
        { header: "Investimento", accessor: (r) => r.spend },
        { header: tx("Compras"), accessor: (r) => r.approvedLeads },
        { header: "Custo por Compra", accessor: (r) => r.cpa.toFixed(2) },
        { header: tx("Faturamento atribuído"), accessor: (r) => r.attributedRevenue.toFixed(2) },
        { header: "ROAS", accessor: (r) => r.roas.toFixed(2) },
        { header: tx("Cliques"), accessor: (r) => r.clicks },
        { header: tx("Impressões"), accessor: (r) => r.impressions },
        { header: "CTR %", accessor: (r) => r.ctr.toFixed(2) },
      ] : [
        { header: tx("Nome"), accessor: (r) => r.name },
        { header: tx("Plataforma"), accessor: (r) => r.platform },
        { header: "Status", accessor: (r) => r.status },
        { header: "Investimento", accessor: (r) => r.spend },
        { header: "Leads", accessor: (r) => r.leads },
        { header: tx("Leads aprovados"), accessor: (r) => r.approvedLeads },
        { header: "CPL", accessor: (r) => r.cpl.toFixed(2) },
        { header: "CPA", accessor: (r) => r.cpa.toFixed(2) },
        { header: tx("Faturamento atribuído"), accessor: (r) => r.attributedRevenue.toFixed(2) },
        { header: "ROAS", accessor: (r) => r.roas.toFixed(2) },
        { header: tx("Cliques"), accessor: (r) => r.clicks },
        { header: tx("Impressões"), accessor: (r) => r.impressions },
        { header: "CTR %", accessor: (r) => r.ctr.toFixed(2) },
      ],
    );
  }

  const containerVariants = withReducedMotion(staggerContainer, reduced);
  const fadeVariants = withReducedMotion(fadeInUp, reduced);

  // "Sem dado" só quando NENHUMA fonte tem algo: nem mídia paga (spend/
  // creatives, o caso B2C normal) nem atribuição por canal (platformBreakdown
  // — é o que o Vesti mostra, mesmo sem Meta Ads configurado). Antes checava
  // só spend/creatives, o que escondia o Marketing inteiro de clientes Vesti
  // com atribuição real mas sem mídia paga cadastrada.
  const hasNoData =
    !isLoading &&
    data &&
    data.kpis.totalSpend === 0 &&
    data.creatives.length === 0 &&
    data.platformBreakdown.length === 0;

  if (isError) {
    return (
      <Alert variant="destructive" data-testid="page-marketing">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>{tx("Erro")}</AlertTitle>
        <AlertDescription className="flex items-center justify-between">
          {tx("Não foi possível carregar os anúncios.")}
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" /> {tx("Tentar novamente")}
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
            {tx("Canais pagos")} · {format(dateRange.from, "MMM d")} → {format(dateRange.to, "MMM d, yyyy")}
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={!data} data-testid="marketing-export-csv">
          <Download className="h-4 w-4 mr-1.5" />
          {tx("Exportar CSV")}
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
              <h3 className="text-base font-semibold mb-1">{tx("Sem dados de canais pagos")}</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                {tx("Conecte suas contas de anúncios (Meta, Google, TikTok) para acompanhar investimento, ROAS e desempenho das campanhas neste período.")}
              </p>
            </div>
            <Button variant="outline" size="sm" className="gap-2">
              <Link2 className="h-4 w-4" />
              {tx("Conectar contas de anúncios")}
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
            label="Investimento em anúncios"
            value={data?.kpis.totalSpend ?? 0}
            format={formatCurrency}
            change={spendChange}
            sparkValues={sparkSpend}
            sparkColor="#5b8dff"
            isLoading={isLoading}
          />
          <MktKpiCard
            testId="kpi-revenue" previousValue={data?.prevKpis.attributedRevenue}
            icon={DollarSign}
            iconClass="bg-teal-500/15 text-teal-400"
            label="Faturamento"
            value={data?.kpis.attributedRevenue ?? 0}
            format={formatCurrency}
            change={revenueChange}
            sparkValues={sparkRevenue}
            sparkColor="#87adff"
            isLoading={isLoading}
          />
          <MktKpiCard
            testId="kpi-roas" previousValue={data?.prevKpis.roas}
            icon={TrendingUp}
            iconClass="bg-emerald-500/15 text-emerald-400"
            label="ROA"
            value={data?.kpis.roas ?? 0}
            format={(v) => `${v.toFixed(2)}×`}
            change={roasChange}
            sparkValues={sparkRevenue}
            sparkColor="#87adff"
            isLoading={isLoading}
          />
          <MktKpiCard
            testId="kpi-approval-rate" previousValue={data?.prevKpis.approvalRate}
            icon={CheckCircle2}
            iconClass="bg-indigo-500/15 text-indigo-400"
            label="Taxa de aprovação"
            value={data?.kpis.approvalRate ?? 0}
            format={formatPercentage}
            change={approvalRateChange}
            sparkValues={sparkLeads}
            sparkColor="#5b8dff"
            isLoading={isLoading}
          />
          <MktKpiCard
            testId="kpi-leads" previousValue={data?.prevKpis.totalLeads}
            icon={Users}
            iconClass="bg-sky-500/15 text-sky-400"
            label="Total de leads"
            value={data?.kpis.totalLeads ?? 0}
            format={formatNumber}
            change={leadsChange}
            sparkValues={sparkLeads}
            sparkColor="#afc4ff"
            isLoading={isLoading}
          />
          <MktKpiCard
            testId="kpi-approved-leads" previousValue={data?.prevKpis.approvedLeads}
            icon={CheckCircle2}
            iconClass="bg-green-500/15 text-green-400"
            label={isB2C ? tx("Compras") : tx("Leads aprovados")}
            value={data?.kpis.approvedLeads ?? 0}
            format={formatNumber}
            change={approvedLeadsChange}
            sparkValues={sparkLeads}
            sparkColor="#87adff"
            isLoading={isLoading}
          />
          <MktKpiCard
            testId="kpi-cpl" previousValue={isB2C ? data?.prevKpis.cpa : data?.prevKpis.cpl}
            icon={Target}
            iconClass="bg-orange-500/15 text-orange-400"
            label={isB2C ? "Custo por Compra" : "CPL"}
            value={isB2C ? data?.kpis.cpa ?? 0 : data?.kpis.cpl ?? 0}
            format={formatCurrency}
            change={isB2C ? cpaChange : cplChange}
            sparkValues={sparkSpend}
            sparkColor="#0458fe"
            isLoading={isLoading}
            invertChange
          />
          {!isB2C && (
            <MktKpiCard
              testId="kpi-cpa" previousValue={data?.prevKpis.cpa}
              icon={Sparkles}
              iconClass="bg-amber-500/15 text-amber-400"
              label="CPA"
              value={data?.kpis.cpa ?? 0}
              format={formatCurrency}
              change={cpaChange}
              sparkValues={sparkSpend}
              sparkColor="#0458fe"
              isLoading={isLoading}
              invertChange
            />
          )}
        </motion.div>
      )}

      {!hasNoData && (
        <motion.div initial="hidden" animate="visible" variants={fadeVariants}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">{tx("Principais criativos da Meta")}</h2>
            <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              {isB2C ? "CTR · Custo por Compra · Compras" : "CTR · CPL · Leads"}
            </span>
          </div>
          {isLoading ? (
            <div className="grid grid-cols-1 2xl:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, idx) => (
                <Card key={idx} className="p-4">
                  <Skeleton className="h-4 w-32 mb-3" />
                  <Skeleton className="h-32 w-full" />
                </Card>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 2xl:grid-cols-3 gap-4">
              <TopCreativesColumn previousItems={previousCreatives} title={tx("Melhor CTR")} items={topCreatives.ctr} metric="ctr" costLabel={isB2C ? "Custo/Compra" : "CPL"} />
              <TopCreativesColumn previousItems={previousCreatives} title={isB2C ? tx("Menor custo por compra") : tx("Menor CPL")} items={topCreatives.cpl} metric={isB2C ? "cpa" : "cpl"} costLabel={isB2C ? "Custo/Compra" : "CPL"} />
              <TopCreativesColumn previousItems={previousCreatives} title={isB2C ? tx("Mais compras") : tx("Mais leads")} items={topCreatives.leads} metric={isB2C ? "purchases" : "leads"} costLabel={isB2C ? "Custo/Compra" : "CPL"} />
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
              {tx("Investimento e leads")}
            </h2>
            {isLoading ? (
              <Skeleton className="h-52 w-full" />
            ) : spendLeadsData.length === 0 ? (
              <EmptyState icon={BarChart3} title={tx("Sem dados")} description={tx("Sem atividade de canais pagos neste período.")} className="h-52" />
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
                  <Bar yAxisId="left" dataKey="spend" fill="#5b8dff" opacity={0.8} radius={[2, 2, 0, 0]} name={tx("Investimento")} />
                  <Line yAxisId="right" type="monotone" dataKey="leads" stroke="#afc4ff" strokeWidth={2} dot={false} activeDot={{ r: 4 }} name="Leads" />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </Card>

          {/* Chart 2: ROAS over time */}
          <Card className="p-5 bg-card border-border">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-4">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              {tx("Evolução do ROAS")}
            </h2>
            {isLoading ? (
              <Skeleton className="h-52 w-full" />
            ) : roasData.length === 0 ? (
              <EmptyState icon={TrendingUp} title={tx("Sem dados")} description={tx("Sem dados de ROAS neste período.")} className="h-52" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={roasData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="roasGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#87adff" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#87adff" stopOpacity={0} />
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
                  <ReferenceLine y={2} stroke="#0458fe" strokeDasharray="4 4" strokeOpacity={0.6} label={{ value: "Meta 2×", position: "insideTopRight", fontSize: 9, fill: "#0458fe" }} />
                  <Area type="monotone" dataKey="roas" stroke="#87adff" strokeWidth={2} fill="url(#roasGrad)" dot={false} activeDot={{ r: 4, fill: "#87adff" }}  name="ROAS" />
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
                {tx("Investimento e faturamento")}
              </h2>
              <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-6 rounded bg-violet-500/60" /> {tx("Investimento")}</span>
                <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-6 rounded bg-teal-400" /> {tx("Faturamento")}</span>
              </div>
            </div>
            {isLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : spendVsRevenueData.length === 0 ? (
              <EmptyState icon={DollarSign} title={tx("Sem dados")} description={tx("Sem atividade de canais pagos neste período.")} className="h-48" />
            ) : (
              <ResponsiveContainer width="100%" height={192}>
                <ComposedChart data={spendVsRevenueData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="spendGrad2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#5b8dff" stopOpacity={0.7} />
                      <stop offset="95%" stopColor="#5b8dff" stopOpacity={0.15} />
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
                  <Bar yAxisId="left" dataKey="spend" fill="url(#spendGrad2)" radius={[3, 3, 0, 0]} maxBarSize={32}  name={tx("Investimento")} />
                  <Line yAxisId="right" type="monotone" dataKey="revenue" stroke="#87adff" strokeWidth={2} dot={false} activeDot={{ r: 4 }}  name={tx("Faturamento")} />
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
              {tx("Por plataforma")}
            </h2>
            {isLoading ? (
              <div className="space-y-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : platformRows.length === 0 ? (
              <EmptyState icon={Megaphone} title={tx("Nenhuma campanha")} description={tx("Nenhuma campanha ativa encontrada para esta marca.")} />
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
              {tx("Principais estados por ROAS")}
            </h2>
            {isLoading ? (
              <div className="space-y-4">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : stateRows.length === 0 ? (
              <EmptyState icon={MapPin} title={tx("Sem dados geográficos")} description={tx("Sem leads de canais pagos com estado informado neste período.")} />
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
              Faixa etária dos clientes (leads pagos)
            </h2>
            <div className="space-y-5">
              {(data!.ageBreakdown).map((row, i) => {
                const maxLeads = Math.max(...data!.ageBreakdown.map((r) => r.leads));
                const pct = maxLeads > 0 ? (row.leads / maxLeads) * 100 : 0;
                const colors = ["#5b8dff", "#afc4ff", "#87adff", "#0458fe", "#0458fe"];
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
              <h2 className="text-sm font-semibold text-foreground">{tx("Desempenho de campanhas")}</h2>
              <p className="text-xs text-muted-foreground">
                {data ? `${Math.min((creativesPage - 1) * CREATIVES_PAGE_SIZE + 1, data.creativesTotal)}–${Math.min(creativesPage * CREATIVES_PAGE_SIZE, data.creativesTotal)} ${tx("de")} ${data.creativesTotal}` : "—"} · {tx("clique nos títulos para ordenar")}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {(
                      [
                        { key: "name" as SortKey, label: tx("Campanha"), align: "left", wide: true },
                        { key: "platform" as SortKey, label: tx("Plataforma"), align: "left", wide: false },
                        { key: "status" as SortKey, label: "Status", align: "left", wide: false },
                        { key: "spend" as SortKey, label: tx("Investimento"), align: "right", wide: false },
                        { key: "attributedRevenue" as SortKey, label: tx("Faturamento"), align: "right", wide: false },
                        { key: "roas" as SortKey, label: "ROA", align: "right", wide: false },
                        { key: "leads" as SortKey, label: "Leads", align: "right", wide: false },
                        { key: "approvedLeads" as SortKey, label: isB2C ? tx("Compras") : tx("Compras"), align: "right", wide: false },
                        ...(isB2C
                          ? [{ key: "cpa" as SortKey, label: "Custo/Compra", align: "right" as const, wide: false }]
                          : [
                              { key: "cpl" as SortKey, label: "CPL", align: "right" as const, wide: false },
                              { key: "cpa" as SortKey, label: "CPA", align: "right" as const, wide: false },
                            ]),
                        { key: "clicks" as SortKey, label: tx("Cliques"), align: "right", wide: false },
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
                        {tx("Nenhuma campanha encontrada para esta marca.")}
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
                  Página {creativesPage} de {Math.ceil(data.creativesTotal / CREATIVES_PAGE_SIZE)}
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm"
                    onClick={() => setCreativesPage((p) => Math.max(1, p - 1))}
                    disabled={creativesPage === 1}
                    className="px-3 py-1.5 text-xs rounded-md border border-border bg-background hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {tx("Anterior")}
                  </Button>
                  <Button variant="outline" size="sm"
                    onClick={() => setCreativesPage((p) => Math.min(Math.ceil(data.creativesTotal / CREATIVES_PAGE_SIZE), p + 1))}
                    disabled={creativesPage * CREATIVES_PAGE_SIZE >= data.creativesTotal}
                    className="px-3 py-1.5 text-xs rounded-md border border-border bg-background hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {tx("Próximo")}
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </motion.div>
      )}
    </div>
  );
}
