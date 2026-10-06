import type { ReactNode } from "react";
import { DashboardKpiCard } from "@/components/dashboard-kpi-card";
import { BarChart3 } from "lucide-react";
import {
  formatCurrency,
  formatNumber,
  formatPercentage,
} from "@/lib/formatters";

export type OrganizedMetric = {
  key: string;
  label: string;
  value: number | null | undefined;
  format?: "currency" | "number" | "percent" | "ratio" | "days";
  source?: string;
  series?: number[];
  loading?: boolean;
};
export function MetricSection({
  title,
  children,
  columns = 4,
  id,
}: {
  title: string;
  children: ReactNode;
  columns?: 2 | 3 | 4 | 5 | 6 | 8;
  id?: string;
}) {
  const grids = {
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3",
    4: "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4",
    5: "grid-cols-1 sm:grid-cols-2 xl:grid-cols-5",
    6: "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3",
    8: "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4",
  };
  return (
    <section className="space-y-4" aria-label={title} data-testid={id}>
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <div className={`grid gap-4 ${grids[columns]}`}>{children}</div>
    </section>
  );
}
export function OrganizationHeading({ children }: { children: ReactNode }) {
  return <h2 className="text-sm font-semibold text-foreground">{children}</h2>;
}
export function ExistingMetricCard({ metric }: { metric: OrganizedMetric }) {
  const present = metric.value != null && Number.isFinite(metric.value);
  const format = (v: number) => {
    if (!present) return "—";
    switch (metric.format) {
      case "currency":
        return formatCurrency(v);
      case "percent":
        return formatPercentage(v);
      case "ratio":
        return `${v.toFixed(2)}x`;
      case "days":
        return `${v.toFixed(1)} dias`;
      default:
        return formatNumber(Math.round(v));
    }
  };
  return (
    <DashboardKpiCard
      icon={BarChart3}
      iconClass="bg-blue-500/15 text-blue-400"
      label={metric.label}
      value={metric.value ?? 0}
      format={format}
      change={null}
      changeLabel=""
      sparkValues={metric.series ?? []}
      sparkColor="hsl(var(--chart-1))"
      isLoading={metric.loading ?? false}
      testId={`organized-${metric.key}`}
      sub={[
        {
          label: present ? "Fonte" : "Disponibilidade",
          value: present
            ? (metric.source ?? "Dados conectados")
            : "Sem dado nesta fonte",
        },
      ]}
    />
  );
}
export function Metrics({ metrics }: { metrics: OrganizedMetric[] }) {
  return (
    <>
      {metrics.map((metric) => (
        <ExistingMetricCard key={metric.key} metric={metric} />
      ))}
    </>
  );
}
