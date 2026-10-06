import { displayLabel } from "@/lib/display-label";
import { motion } from "framer-motion";
import type { ReactNode, ElementType } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CountUp } from "@/components/count-up";
import { Sparkline } from "@/components/sparkline";
import { cardEntry, useReducedMotion, withReducedMotion } from "@/lib/motion";

export interface DashboardKpiCardProps {
  icon: ElementType;
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
  displayValue?: ReactNode;
  labelAccessory?: ReactNode;
  footer?: ReactNode;
  deltaContent?: ReactNode;
  changePositive?: boolean;
  className?: string;
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
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke="hsl(var(--muted-foreground))"
        strokeOpacity={0.25}
        strokeWidth={stroke}
        fill="none"
      />
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
  displayValue,
  labelAccessory,
  footer,
  deltaContent,
  changePositive,
  className,
}: DashboardKpiCardProps) {
  const reduced = useReducedMotion();
  const isUp = changePositive ?? (change !== null && change >= 0);
  const variants = withReducedMotion(cardEntry, reduced);
  return (
    <motion.div variants={variants} className={`up-metric-wrapper h-full min-w-0 ${className ?? ""}`}>
      <Card
        data-testid={testId}
        className="up-metric flex h-full flex-col p-[18px] border-border transition-shadow"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="up-metric-icon flex h-8 w-8 items-center justify-center rounded-lg">
              <Icon className="h-4 w-4" />
            </div>
            <span className="up-metric-label min-w-0 text-[13px] text-muted-foreground">
              {label}
            </span>
            {labelAccessory}
          </div>
        </div>

        <div className="flex items-end justify-between gap-3 mb-3">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            {isLoading ? (
              <Skeleton className="h-9 w-32" />
            ) : (
              <>
                <span
                  className={`up-metric-value text-[30px] font-medium tracking-tight tabular-nums ${
                    valueAccent
                      ? "bg-gradient-to-br from-foreground via-foreground to-primary bg-clip-text text-transparent"
                      : ""
                  }`}
                >
                  {displayValue !== undefined ? displayValue : <CountUp value={value} format={fmt} />}
                </span>
                {unit && (
                  <span className="text-xs text-muted-foreground font-medium">
                    {unit}
                  </span>
                )}
              </>
            )}
          </div>
          {!isLoading && ringValue !== undefined ? (
            <MiniRing
              pct={ringValue}
              color={ringColor ?? sparkColor}
              reduced={reduced}
            />
          ) : null}
        </div>

        {!isLoading && deltaContent !== undefined ? deltaContent : !isLoading && change !== null && (
          <div className="mb-4">
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                isUp ? "up-delta-positive" : "up-delta-negative"
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
            <span className="text-xs text-muted-foreground ml-2">
              {changeLabel}
            </span>
          </div>
        )}

        {!isLoading && sparkValues.length > 1 && (
          <Sparkline
            values={sparkValues}
            stroke="var(--up-chart-line)"
            fill="var(--up-chart-fill)"
            width={240}
            height={40}
            className="up-metric-spark w-full mb-3"
            ariaLabel={`${label} · evolução no período`}
          />
        )}

        {(sub.length > 0 || footer) && <div className="up-metric-footer mt-auto pt-3 border-t border-border space-y-2">
          {sub.map((row) => (
            <div key={row.label} className="flex justify-between gap-2 text-xs">
              <span className="min-w-0 text-muted-foreground">
                {displayLabel(row.label)}
              </span>
              <span
                className="min-w-0 text-right font-medium tabular-nums"
                title={row.value}
              >
                {row.value}
              </span>
            </div>
          ))}
          {footer}
        </div>}
      </Card>
    </motion.div>
  );
}
