import type { ElementType, ReactNode } from "react";
import { BarChart3 } from "lucide-react";
import { DashboardKpiCard } from "@/components/dashboard-kpi-card";
import { formatNumber } from "@/lib/formatters";

/** One metric template for every page. Formatting and values stay with the source. */
export function GlassMetricCard({
  label, value, icon = BarChart3, format = formatNumber, unit, loading = false,
  change = null, changeLabel = "vs. período anterior", changePositive,
  sub = [], sparkValues = [], info, source, previousValue, comparisonValue, comparisonUnavailable, footer, deltaContent, className, testId,
}: {
  label: string;
  value: ReactNode;
  icon?: ElementType;
  format?: (value: number) => string;
  unit?: string;
  loading?: boolean;
  change?: number | null;
  changeLabel?: string;
  changePositive?: boolean;
  sub?: Array<{ label: string; value: string }>;
  sparkValues?: number[];
  info?: ReactNode;
  source?: string;
  previousValue?: number | null;
  comparisonValue?: number | null;
  comparisonUnavailable?: string;
  footer?: ReactNode;
  deltaContent?: ReactNode;
  className?: string;
  testId?: string;
}) {
  return <DashboardKpiCard
    icon={icon} iconClass="up-metric-icon" label={label}
    value={typeof value === "number" ? value : 0} format={format}
    displayValue={typeof value === "number" ? undefined : value}
    unit={unit} change={change} changeLabel={changeLabel}
    changePositive={changePositive} sub={sub} sparkValues={sparkValues}
    sparkColor="var(--up-chart-line)" isLoading={loading}
    testId={testId ?? `metric-${label.toLowerCase().replace(/\s+/g, "-")}`}
    className={className} footer={footer} deltaContent={deltaContent}
    info={info} source={source} previousValue={previousValue} comparisonValue={comparisonValue} comparisonUnavailable={comparisonUnavailable}
  />;
}
