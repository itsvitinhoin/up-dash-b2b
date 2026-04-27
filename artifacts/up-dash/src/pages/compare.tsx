import { useMemo, useState } from "react";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { queryOpts } from "@/lib/query-opts";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import {
  useListClients,
  useGetDashboard,
} from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertCircle,
  GitCompareArrows,
  X,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { CountUp } from "@/components/count-up";
import { Sparkline } from "@/components/sparkline";
import { fadeInUp, useReducedMotion, withReducedMotion } from "@/lib/motion";
import { formatCurrency, formatCurrencySmart, formatNumber, formatPercentage } from "@/lib/formatters";
import { exportRowsAsCsv } from "@/lib/csv-export";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const PALETTE = ["#7c5cff", "#22c55e", "#fb7185", "#38bdf8"];
const MAX_BRANDS = 4;

interface BrandResult {
  id: string;
  name: string;
  revenue: number;
  orders: number;
  avgTicket: number;
  conversionRate: number;
  customers: number;
  series: { date: string; value: number }[];
}

function BrandCardLoading() {
  return <Skeleton className="h-44 w-full" />;
}

export default function ComparePage() {
  const { user } = useAuth();
  const { dateRange } = useDashboardFilters();
  const reduced = useReducedMotion();

  const { data: clientsData, isLoading: loadingClients } = useListClients(
    { limit: 100 },
    { query: queryOpts({ enabled: user?.role === "ADMIN" }) },
  );

  const [selected, setSelected] = useState<string[]>([]);

  const variants = useMemo(() => withReducedMotion(fadeInUp, reduced), [reduced]);

  if (user?.role !== "ADMIN") {
    return (
      <Alert variant="destructive" data-testid="page-compare">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Restricted</AlertTitle>
        <AlertDescription>
          This view is available to platform administrators only.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6" data-testid="page-compare">
      <Card className="p-5 bg-card border-border">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold leading-tight">Pick brands to compare</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Choose up to {MAX_BRANDS} client brands. The KPIs and chart below update live.
            </p>
          </div>
          {selected.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected([])}
              className="text-xs"
              data-testid="compare-clear"
            >
              Clear selection
            </Button>
          )}
        </div>
        {loadingClients ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {clientsData?.data.map((client, i) => {
              const isOn = selected.includes(client.id);
              const reachedMax = !isOn && selected.length >= MAX_BRANDS;
              return (
                <button
                  key={client.id}
                  type="button"
                  disabled={reachedMax}
                  onClick={() =>
                    setSelected((prev) =>
                      prev.includes(client.id)
                        ? prev.filter((x) => x !== client.id)
                        : [...prev, client.id],
                    )
                  }
                  data-testid={`compare-pick-${client.id}`}
                  className={`px-3 py-1.5 rounded-md border text-sm transition-colors ${
                    isOn
                      ? "border-primary bg-primary/15 text-primary"
                      : reachedMax
                        ? "border-border text-muted-foreground/50 cursor-not-allowed"
                        : "border-border text-foreground hover:bg-accent/40"
                  }`}
                >
                  <span
                    className="inline-block h-2 w-2 rounded-full mr-2 align-middle"
                    style={{ backgroundColor: isOn ? PALETTE[selected.indexOf(client.id) % PALETTE.length] : "transparent", border: isOn ? "" : "1px solid hsl(var(--border))" }}
                  />
                  {client.name}
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {selected.length < 2 ? (
        <EmptyState
          icon={GitCompareArrows}
          title={selected.length === 0 ? "Pick 2–4 brands to start comparing" : "Pick one more brand to compare"}
          description="Side-by-side KPIs and revenue trends will appear here once at least two brands are selected."
        />
      ) : (
        <CompareGrid
          selectedIds={selected}
          dateRange={dateRange}
          allClients={clientsData?.data ?? []}
          variants={variants}
          onRemove={(id) => setSelected((prev) => prev.filter((x) => x !== id))}
        />
      )}
    </div>
  );
}

interface CompareGridProps {
  selectedIds: string[];
  dateRange: { from: Date; to: Date };
  allClients: { id: string; name: string }[];
  variants: ReturnType<typeof withReducedMotion>;
  onRemove: (id: string) => void;
}

function CompareGrid({ selectedIds, dateRange, allClients, variants, onRemove }: CompareGridProps) {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {selectedIds.map((id, idx) => (
          <BrandKpiCard
            key={id}
            clientId={id}
            color={PALETTE[idx % PALETTE.length]}
            name={allClients.find((c) => c.id === id)?.name ?? "Brand"}
            dateRange={dateRange}
            variants={variants}
            onRemove={() => onRemove(id)}
          />
        ))}
      </div>

      <CompareChart
        selectedIds={selectedIds}
        dateRange={dateRange}
        allClients={allClients}
      />
    </>
  );
}

interface BrandKpiCardProps {
  clientId: string;
  name: string;
  color: string;
  dateRange: { from: Date; to: Date };
  variants: ReturnType<typeof withReducedMotion>;
  onRemove: () => void;
}

function BrandKpiCard({ clientId, name, color, dateRange, variants, onRemove }: BrandKpiCardProps) {
  const { data, isLoading } = useGetDashboard(
    {
      clientId,
      dateFrom: format(dateRange.from, "yyyy-MM-dd"),
      dateTo: format(dateRange.to, "yyyy-MM-dd"),
    },
    { query: queryOpts({ enabled: true }) },
  );

  if (isLoading) return <BrandCardLoading />;

  const series = data?.revenueOverTime?.map((p) => p.value) ?? [];

  return (
    <motion.div initial="hidden" animate="visible" variants={variants}>
      <Card className="p-5 bg-card border-border" data-testid={`compare-card-${clientId}`}>
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: color }}
            />
            <p className="text-sm font-semibold truncate" title={name}>{name}</p>
          </div>
          <button
            type="button"
            onClick={onRemove}
            className="text-muted-foreground hover:text-foreground"
            aria-label={`Remove ${name}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="text-2xl font-semibold tabular-nums">
          <CountUp value={data?.kpis.revenue ?? 0} format={(v) => formatCurrencySmart(v)} />
        </p>
        <p className="text-[11px] text-muted-foreground uppercase tracking-wider mt-0.5">
          Revenue
        </p>
        <div className="mt-3">
          <Sparkline values={series} stroke={color} fill={color + "33"} width={200} height={36} />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <Stat label="Orders" value={formatNumber(data?.kpis.orders ?? 0)} />
          <Stat label="Avg ticket" value={formatCurrency(data?.kpis.avgTicket ?? 0)} />
          <Stat label="Conv." value={formatPercentage(data?.kpis.conversionRate ?? 0)} />
        </div>
      </Card>
    </motion.div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="font-medium tabular-nums">{value}</p>
    </div>
  );
}

interface CompareChartProps {
  selectedIds: string[];
  dateRange: { from: Date; to: Date };
  allClients: { id: string; name: string }[];
}

function CompareChart({ selectedIds, dateRange, allClients }: CompareChartProps) {
  // Fetch each brand's series in parallel via separate hooks. We use a stable
  // limit of 4 so React's hook order is preserved.
  const slot0 = useBrandSeries(selectedIds[0], dateRange);
  const slot1 = useBrandSeries(selectedIds[1], dateRange);
  const slot2 = useBrandSeries(selectedIds[2], dateRange);
  const slot3 = useBrandSeries(selectedIds[3], dateRange);
  const slots = [slot0, slot1, slot2, slot3];

  const combined = useMemo(() => {
    const dateMap = new Map<string, Record<string, string | number>>();
    selectedIds.forEach((id, idx) => {
      const series = slots[idx]?.data?.revenueOverTime ?? [];
      const name = allClients.find((c) => c.id === id)?.name ?? id;
      series.forEach((p) => {
        const entry: Record<string, string | number> =
          dateMap.get(p.date) ?? { date: p.date };
        entry[name] = p.value;
        dateMap.set(p.date, entry);
      });
    });
    return Array.from(dateMap.values()).sort((a, b) =>
      String(a.date).localeCompare(String(b.date)),
    );
  }, [selectedIds, slots, allClients]);

  const handleExport = () => {
    if (combined.length === 0) return;
    exportRowsAsCsv(
      `compare-revenue-${format(dateRange.from, "yyyyMMdd")}-${format(dateRange.to, "yyyyMMdd")}.csv`,
      combined,
      [
        { header: "date", accessor: (r) => String(r.date) },
        ...selectedIds.map((id) => {
          const name = allClients.find((c) => c.id === id)?.name ?? id;
          return {
            header: name,
            accessor: (r: Record<string, unknown>) => Number(r[name] ?? 0),
          };
        }),
      ],
    );
  };

  return (
    <Card className="p-5 bg-card border-border" data-testid="compare-chart">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold leading-tight">Daily revenue side-by-side</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Stacked bars per brand for the selected window.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.map((id, idx) => (
            <Badge key={id} variant="outline" className="text-xs">
              <span
                className="inline-block h-2 w-2 rounded-full mr-1.5"
                style={{ backgroundColor: PALETTE[idx % PALETTE.length] }}
              />
              {allClients.find((c) => c.id === id)?.name ?? id}
            </Badge>
          ))}
          <Button size="sm" variant="outline" onClick={handleExport} className="h-7 text-xs">
            Export CSV
          </Button>
        </div>
      </div>
      <div className="h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={combined} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis
              dataKey="date"
              tickFormatter={(v) => format(new Date(v), "MMM d")}
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              dy={6}
            />
            <YAxis
              tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              width={55}
            />
            <Tooltip
              formatter={(value: number) => formatCurrency(value)}
              labelFormatter={(label) => format(new Date(label), "MMM d, yyyy")}
              contentStyle={{
                backgroundColor: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
                fontSize: "12px",
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {selectedIds.map((id, idx) => {
              const name = allClients.find((c) => c.id === id)?.name ?? id;
              return (
                <Bar
                  key={id}
                  dataKey={name}
                  fill={PALETTE[idx % PALETTE.length]}
                  radius={[4, 4, 0, 0]}
                />
              );
            })}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function useBrandSeries(clientId: string | undefined, dateRange: { from: Date; to: Date }) {
  return useGetDashboard(
    clientId
      ? {
          clientId,
          dateFrom: format(dateRange.from, "yyyy-MM-dd"),
          dateTo: format(dateRange.to, "yyyy-MM-dd"),
        }
      : { dateFrom: format(dateRange.from, "yyyy-MM-dd"), dateTo: format(dateRange.to, "yyyy-MM-dd") },
    { query: queryOpts({ enabled: !!clientId }) },
  );
}
