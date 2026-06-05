import { motion } from "framer-motion";
import {
  ArrowDownRight,
  ArrowUpRight,
  MoreHorizontal,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CountUp } from "@/components/count-up";
import { Sparkline } from "@/components/sparkline";
import { cardEntry, useReducedMotion, withReducedMotion } from "@/lib/motion";

export interface DashboardKpiCardProps {
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
  valueAccent?: boolean;
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

export function DashboardKpiCard({
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
}: DashboardKpiCardProps) {
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
