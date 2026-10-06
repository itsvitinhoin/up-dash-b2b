import type { ElementType, ReactNode } from "react";
import { BarChart3, Info } from "lucide-react";
import { DashboardKpiCard } from "@/components/dashboard-kpi-card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatNumber } from "@/lib/formatters";

/** One metric template for every page. Formatting and values stay with the source. */
export function GlassMetricCard({
  label, value, icon = BarChart3, format = formatNumber, unit, loading = false,
  change = null, changeLabel = "vs. período anterior", changePositive,
  sub = [], sparkValues = [], info, footer, deltaContent, className, testId,
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
  info?: string;
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
    labelAccessory={info ? <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="up-metric-info h-6 w-6 shrink-0" aria-label={`Explicação: ${label}`}>
          <Info className="h-3.5 w-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{info}</TooltipContent>
    </Tooltip> : undefined}
  />;
}
