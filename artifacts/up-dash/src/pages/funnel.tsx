import { useMemo } from "react";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import { useGetFunnel } from "@workspace/api-client-react";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertCircle,
  RefreshCw,
  Lightbulb,
  ArrowDownRight,
  Download,
  TrendingUp,
  Users,
  ShoppingCart,
  Sparkles,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPercentage, formatNumber } from "@/lib/formatters";
import { exportRowsAsCsv } from "@/lib/csv-export";
import { CountUp } from "@/components/count-up";
import { useReducedMotion, fadeInUp, withReducedMotion } from "@/lib/motion";

interface FunnelStep {
  step: string;
  label: string;
  count: number;
  conversionRate: number;
  dropOffRate: number;
}

const STAGE_PALETTE = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

export default function FunnelPage() {
  const { selectedClientId, user } = useAuth();
  const { dateRange } = useDashboardFilters();
  const reduced = useReducedMotion();
  const variants = withReducedMotion(fadeInUp, reduced);

  const clientId = user?.role === "ADMIN" ? selectedClientId || undefined : undefined;

  const { data, isLoading, isError, refetch } = useGetFunnel(
    {
      clientId,
      dateFrom: format(dateRange.from, "yyyy-MM-dd"),
      dateTo: format(dateRange.to, "yyyy-MM-dd"),
    },
    {
      query: queryOpts({
        enabled: user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId),
      }),
    }
  );

  const handleExport = () => {
    if (!data) return;
    exportRowsAsCsv(
      `funnel-${new Date().toISOString().slice(0, 10)}.csv`,
      data.steps,
      [
        { header: "step", accessor: (r) => r.step },
        { header: "label", accessor: (r) => r.label },
        { header: "count", accessor: (r) => r.count },
        { header: "conversionRate", accessor: (r) => r.conversionRate },
        { header: "dropOffRate", accessor: (r) => r.dropOffRate },
      ],
    );
  };

  // Find biggest drop stage (skip step 0)
  const biggestDrop = useMemo(() => {
    if (!data?.steps?.length) return null;
    let maxIdx = 1;
    let maxDrop = -1;
    for (let i = 1; i < data.steps.length; i++) {
      if (data.steps[i].dropOffRate > maxDrop) {
        maxDrop = data.steps[i].dropOffRate;
        maxIdx = i;
      }
    }
    return { from: data.steps[maxIdx - 1], to: data.steps[maxIdx], dropPct: maxDrop };
  }, [data]);

  return (
    <div className="space-y-6 pb-8" data-testid="page-funnel">
      <div className="flex items-center justify-between">
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
          disabled={!data?.steps?.length}
          data-testid="funnel-export"
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
            Failed to load funnel data.
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" /> Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : isLoading ? (
        <div className="space-y-6">
          <Skeleton className="h-56 w-full rounded-xl" />
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      ) : data ? (
        <>
          {/* ── Hero row: Conversion ring + 3 mini-KPIs ──────────────────────────── */}
          <motion.div initial="hidden" animate="visible" variants={variants}>
            <Card className="relative overflow-hidden border-border/60 bg-gradient-to-br from-primary/[0.08] via-card to-card">
              {/* decorative blobs */}
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
                  maskImage: "radial-gradient(ellipse 80% 60% at 50% 50%, black 30%, transparent 100%)",
                  WebkitMaskImage: "radial-gradient(ellipse 80% 60% at 50% 50%, black 30%, transparent 100%)",
                }}
              />

              <CardContent className="relative grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-8 p-6 sm:p-8" data-testid="funnel-hero">
                <ConversionRing pct={data.overallConversion} reduced={reduced} />
                <div className="flex flex-col justify-center">
                  <span className="inline-flex items-center gap-1.5 self-start rounded-full border border-border/60 bg-card/60 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground backdrop-blur">
                    <Activity className="h-3 w-3 text-primary" />
                    Conversion funnel
                  </span>
                  <h2 className="mt-2 text-3xl sm:text-4xl font-bold tracking-tight">
                    Visitors → Purchases
                  </h2>
                  <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                    From total leads to approved purchases over the selected period.
                    Hover any stage below to see counts, conversion, and drop-off.
                  </p>

                  <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <MiniStat
                      icon={Users}
                      label="Total visits"
                      value={data.steps[0]?.count ?? 0}
                      color="hsl(var(--chart-1))"
                      delay={0.05}
                      reduced={reduced}
                    />
                    <MiniStat
                      icon={ShoppingCart}
                      label="Purchases"
                      value={data.steps[data.steps.length - 1]?.count ?? 0}
                      color="hsl(var(--chart-3))"
                      delay={0.12}
                      reduced={reduced}
                    />
                    <MiniStat
                      icon={TrendingUp}
                      label={biggestDrop ? `Drop @ ${biggestDrop.to.label}` : "Biggest drop"}
                      value={biggestDrop?.dropPct ?? 0}
                      format={(v) => `${v.toFixed(1)}%`}
                      tone="warn"
                      delay={0.19}
                      reduced={reduced}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* ── Funnel viz + Insights ──────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <motion.div
              className="lg:col-span-2"
              initial="hidden"
              animate="visible"
              variants={variants}
            >
              <Card className="overflow-hidden">
                <CardContent className="p-4 sm:p-6">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground/90 flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                      Stage-by-stage flow
                    </h3>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {data.steps.length} stages
                    </span>
                  </div>
                  <FunnelDiagram steps={data.steps} reduced={reduced} />
                </CardContent>
              </Card>
            </motion.div>

            <div className="lg:col-span-1 space-y-4">
              <motion.div initial="hidden" animate="visible" variants={variants}>
                <h3 className="font-semibold text-base flex items-center gap-2 mb-3">
                  <span className="relative">
                    <Lightbulb className="h-4 w-4 text-amber-500" />
                    <span aria-hidden className="absolute inset-0 rounded-full bg-amber-400/30 blur-md -z-10" />
                  </span>
                  Key insights
                </h3>
              </motion.div>
              {data.insights.length > 0 ? (
                data.insights.map((insight, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.4, delay: reduced ? 0 : 0.1 + i * 0.08 }}
                  >
                    <Card className="group relative overflow-hidden border-border/60 transition hover:border-primary/40 hover:shadow-md">
                      <div
                        aria-hidden
                        className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-amber-400 via-primary to-chart-3 opacity-70"
                      />
                      <CardContent className="p-4 pl-5">
                        <div className="flex items-start gap-2.5">
                          <Sparkles className="h-3.5 w-3.5 text-amber-500 mt-0.5 flex-shrink-0" />
                          <p className="text-sm leading-relaxed text-foreground/85">
                            {insight}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))
              ) : (
                <Card>
                  <CardContent className="p-6 text-center text-muted-foreground text-sm">
                    Not enough data to generate insights for this period.
                  </CardContent>
                </Card>
              )}

              {/* "How to read" helper */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: reduced ? 0 : 0.4 }}
                className="rounded-lg border border-dashed border-border/60 bg-muted/30 p-4 text-xs text-muted-foreground"
              >
                <p className="font-semibold text-foreground/80 mb-1.5 flex items-center gap-1.5">
                  <Activity className="h-3 w-3" /> How to read
                </p>
                <p className="leading-relaxed">
                  Each stage shows the count entering it, the conversion vs. the
                  prior stage, and where users drop off. Optimize the largest red
                  drop first — that's where you'll move the needle fastest.
                </p>
              </motion.div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Conversion ring
// ─────────────────────────────────────────────────────────────────────────

function ConversionRing({ pct, reduced }: { pct: number; reduced: boolean }) {
  const size = 200;
  const stroke = 14;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, pct));
  const dash = (clamped / 100) * circumference;

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id="ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="hsl(var(--chart-1))" />
            <stop offset="50%" stopColor="hsl(var(--primary))" />
            <stop offset="100%" stopColor="hsl(var(--chart-3))" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="hsl(var(--muted))"
          strokeWidth={stroke}
          fill="none"
          opacity={0.5}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="url(#ring-grad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: reduced ? circumference - dash : circumference }}
          animate={{ strokeDashoffset: circumference - dash }}
          transition={{ duration: reduced ? 0 : 1.4, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          Overall
        </span>
        <CountUp
          value={clamped}
          format={(v) => `${v.toFixed(1)}%`}
          duration={1200}
          className="text-4xl font-bold tracking-tight tabular-nums bg-gradient-to-br from-foreground to-primary bg-clip-text text-transparent"
        />
        <span className="mt-0.5 text-[11px] text-muted-foreground">conversion</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Mini stat chip used in the hero
// ─────────────────────────────────────────────────────────────────────────

function MiniStat({
  icon: Icon,
  label,
  value,
  color = "hsl(var(--primary))",
  format,
  tone,
  delay,
  reduced,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  color?: string;
  format?: (v: number) => string;
  tone?: "warn";
  delay: number;
  reduced: boolean;
}) {
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
          style={{ background: tone === "warn" ? "hsl(var(--destructive) / 0.12)" : `${color.replace(")", " / 0.15)")}` }}
        >
          <IconWrap Icon={Icon} tone={tone} color={color} />
        </span>
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium truncate">
          {label}
        </span>
      </div>
      <CountUp
        value={value}
        format={format ?? formatNumber}
        duration={1000}
        className={`mt-1.5 block text-xl font-bold tabular-nums ${tone === "warn" ? "text-destructive" : "text-foreground"}`}
      />
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Funnel diagram (SVG trapezoids, animated)
// ─────────────────────────────────────────────────────────────────────────

function FunnelDiagram({ steps, reduced }: { steps: FunnelStep[]; reduced: boolean }) {
  const VIEW_W = 800;
  const ROW_H = 78;
  const GAP = 14;
  const PAD_X = 12;

  const top = steps[0]?.count ?? 1;

  // For each step, compute relative width (clamped min 8%)
  const widths = steps.map((s) => {
    const w = top > 0 ? Math.max(0.08, s.count / top) : 0.08;
    return w * (VIEW_W - PAD_X * 2);
  });

  const totalH = steps.length * ROW_H + (steps.length - 1) * GAP;

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${VIEW_W} ${totalH}`}
        className="w-full h-auto"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Conversion funnel diagram"
      >
        <defs>
          {steps.map((_, i) => {
            const c1 = STAGE_PALETTE[i % STAGE_PALETTE.length];
            const c2 = STAGE_PALETTE[(i + 1) % STAGE_PALETTE.length];
            return (
              <linearGradient key={i} id={`fseg-${i}`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={c1} stopOpacity={0.85} />
                <stop offset="100%" stopColor={c2} stopOpacity={0.85} />
              </linearGradient>
            );
          })}
        </defs>

        {steps.map((step, i) => {
          const next = steps[i + 1];
          const wTop = widths[i];
          const wBot = next ? widths[i + 1] : wTop;
          const yTop = i * (ROW_H + GAP);
          const yBot = yTop + ROW_H;
          const cx = VIEW_W / 2;

          const x1 = cx - wTop / 2;
          const x2 = cx + wTop / 2;
          const x3 = cx + wBot / 2;
          const x4 = cx - wBot / 2;

          const path = `M ${x1} ${yTop} L ${x2} ${yTop} L ${x3} ${yBot} L ${x4} ${yBot} Z`;

          // Drop badge between this row and the next
          const dropBadge = next ? (
            <DropBadge
              x={cx}
              y={yBot + GAP / 2}
              percent={next.dropOffRate}
              delay={reduced ? 0 : 0.25 + i * 0.12}
            />
          ) : null;

          return (
            <g key={step.step}>
              <motion.path
                d={path}
                fill={`url(#fseg-${i})`}
                stroke={STAGE_PALETTE[i % STAGE_PALETTE.length]}
                strokeOpacity={0.4}
                strokeWidth={1}
                initial={{ opacity: 0, scaleY: reduced ? 1 : 0.6 }}
                animate={{ opacity: 1, scaleY: 1 }}
                style={{ transformOrigin: `${cx}px ${yTop}px` }}
                transition={{ duration: reduced ? 0 : 0.55, delay: reduced ? 0 : i * 0.12, ease: [0.22, 1, 0.36, 1] }}
              />

              {/* Stage label (left) */}
              <motion.g
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, delay: reduced ? 0 : 0.15 + i * 0.12 }}
              >
                <text
                  x={PAD_X}
                  y={yTop + ROW_H / 2 - 6}
                  className="fill-foreground"
                  fontSize="14"
                  fontWeight="600"
                >
                  {step.label}
                </text>
                <text
                  x={PAD_X}
                  y={yTop + ROW_H / 2 + 12}
                  className="fill-muted-foreground"
                  fontSize="11"
                  fontFamily="ui-monospace, SFMono-Regular, monospace"
                >
                  {formatNumber(step.count)} · {formatPercentage(step.conversionRate)} cvr
                </text>
              </motion.g>

              {/* Stage count overlay (center, on the trapezoid) */}
              {wTop > 100 && (
                <motion.text
                  x={cx}
                  y={yTop + ROW_H / 2 + 5}
                  textAnchor="middle"
                  fontSize="22"
                  fontWeight="700"
                  className="fill-white"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: reduced ? 0 : 0.4 + i * 0.12, duration: 0.4 }}
                  style={{ textShadow: "0 1px 2px rgba(0,0,0,0.45)" }}
                >
                  {formatNumber(step.count)}
                </motion.text>
              )}

              {dropBadge}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function DropBadge({
  x,
  y,
  percent,
  delay,
}: {
  x: number;
  y: number;
  percent: number;
  delay: number;
}) {
  const text = `${formatPercentage(percent)} drop`;
  const w = 92;
  const h = 22;
  const isBig = percent >= 30;
  return (
    <motion.g
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
      transform={`translate(${x - w / 2}, ${y - h / 2})`}
    >
      <rect
        width={w}
        height={h}
        rx={11}
        ry={11}
        className={isBig ? "fill-destructive" : "fill-amber-500"}
        opacity={0.95}
      />
      <text
        x={w / 2}
        y={h / 2 + 4}
        textAnchor="middle"
        fontSize="11"
        fontWeight="600"
        className="fill-white"
        style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
      >
        ↓ {text}
      </text>
    </motion.g>
  );
}

function IconWrap({
  Icon,
  tone,
  color,
}: {
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  tone?: "warn";
  color: string;
}) {
  if (tone === "warn") {
    return <Icon className="h-3.5 w-3.5 text-destructive" />;
  }
  return <Icon className="h-3.5 w-3.5" style={{ color }} />;
}

// Re-export for any consumer
export { ArrowDownRight };
