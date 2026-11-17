import { Fragment, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useQueries } from "@tanstack/react-query";
import { endOfMonth, format } from "date-fns";
import {
  getDashboard,
  getMarketing,
  getCustomerSummary,
  getGetDashboardQueryKey,
  getGetMarketingQueryKey,
  getGetCustomerSummaryQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import {
  formatCurrency,
  formatNumber,
  formatPercentage,
} from "@/lib/formatters";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectValue,
  SelectItem,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Download, RefreshCw } from "lucide-react";
import { exportRowsAsCsv } from "@/lib/csv-export";
import { queryOpts } from "@/lib/query-opts";

// Abreviacoes por idioma (nao usam tx: chaves como "Mar" ou "Set" colidiriam com outros textos).
const MONTHS_BY_LANGUAGE = {
  pt: [
    "Jan",
    "Fev",
    "Mar",
    "Abr",
    "Mai",
    "Jun",
    "Jul",
    "Ago",
    "Set",
    "Out",
    "Nov",
    "Dez",
  ],
  en: [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ],
  ko: [
    "1월",
    "2월",
    "3월",
    "4월",
    "5월",
    "6월",
    "7월",
    "8월",
    "9월",
    "10월",
    "11월",
    "12월",
  ],
} as const;
type Row = {
  label: string;
  values: Array<number | null | undefined>;
  format?: "currency" | "percent" | "ratio";
};
export default function MonthlyHistoryPage() {
  const { tx, language } = useI18n();
  const months = MONTHS_BY_LANGUAGE[language] ?? MONTHS_BY_LANGUAGE.pt;
  const { user, selectedClientId, selectedDashboardMode } = useAuth();
  const isB2C = selectedDashboardMode === "B2C";
  const [hiddenMetrics, setHiddenMetrics] = useState<string[]>(() => {
    try {
      const value: unknown = JSON.parse(
        localStorage.getItem("monthly-history-hidden-metrics") ?? "[]",
      );
      return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];
    } catch {
      return [];
    }
  });
  const toggleMetric = (label: string) =>
    setHiddenMetrics((previous) => {
      const next = previous.includes(label)
        ? previous.filter((item) => item !== label)
        : [...previous, label];
      try {
        localStorage.setItem(
          "monthly-history-hidden-metrics",
          JSON.stringify(next),
        );
      } catch {}
      return next;
    });
  const { dateRange, filters } = useDashboardFilters();
  const [year, setYear] = useState(() => dateRange.to.getFullYear());
  const clientId =
    user?.role === "ADMIN" ? selectedClientId || undefined : undefined;
  const enabled =
    user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId);
  const now = new Date();
  const periods = months.map((_, month) => ({
    clientId,
    dateFrom: format(new Date(year, month, 1), "yyyy-MM-dd"),
    dateTo: format(endOfMonth(new Date(year, month, 1)), "yyyy-MM-dd"),
  }));
  const canRead = (index: number) => enabled && new Date(year, index, 1) <= now;
  const sales = useQueries({
    queries: periods.map((period, index) => {
      const params = {
        ...period,
        category: filters.category ?? undefined,
        sellerId: filters.sellerId ?? undefined,
        channel: filters.channel ?? undefined,
        color: filters.color ?? undefined,
        segment: filters.segment ?? undefined,
        utmSource: filters.utmSource || undefined,
        utmMedium: filters.utmMedium || undefined,
        utmCampaign: filters.utmCampaign || undefined,
      };
      return {
        ...queryOpts({ enabled: canRead(index) }),
        queryKey: getGetDashboardQueryKey(params),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          getDashboard(params, { signal }),
      };
    }),
  });
  const media = useQueries({
    queries: periods.map((params, index) => ({
      ...queryOpts({ enabled: canRead(index) }),
      queryKey: getGetMarketingQueryKey(params),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        getMarketing(params, { signal }),
    })),
  });
  const registrations = useQueries({
    queries: periods.map((period, index) => {
      const params = period;
      return {
        ...queryOpts({ enabled: canRead(index) && !isB2C }),
        queryKey: getGetCustomerSummaryQueryKey(params),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          getCustomerSummary(params, { signal }),
      };
    }),
  });
  const groups: Array<{ title: string; rows: Row[] }> = [
    {
      title: "Vendas",
      rows: [
        {
          label: "Faturamento Pago",
          format: "currency",
          values: sales.map(
            (q) => q.data?.kpis.paidRevenue ?? q.data?.kpis.revenue,
          ),
        },
        {
          label: isB2C ? "Faturamento" : "Faturamento Solicitado",
          format: "currency",
          values: sales.map((q) => q.data?.kpis.requestedRevenue),
        },
        { label: "Pedidos", values: sales.map((q) => q.data?.kpis.orders) },
        {
          label: "Ticket Médio",
          format: "currency",
          values: sales.map((q) => q.data?.kpis.avgTicket),
        },
      ],
    },
    {
      title: "Clientes",
      rows: [
        { label: "Clientes", values: sales.map((q) => q.data?.kpis.customers) },
        {
          label: "Novos Clientes",
          values: sales.map((q) => q.data?.kpis.newBuyers),
        },
        {
          label: "Clientes que Recompraram",
          values: sales.map((q) => q.data?.kpis.returningBuyers),
        },
      ],
    },
    {
      title: "Mídia",
      rows: [
        {
          label: "Investimento",
          format: "currency",
          values: media.map((q) => q.data?.kpis.totalSpend),
        },
        {
          label: "ROAS",
          format: "ratio",
          values: media.map((q) =>
            isB2C ? q.data?.metaSummary?.roas : q.data?.kpis.roas,
          ),
        },
        ...(isB2C
          ? [
              {
                label: "MER pago",
                format: "ratio" as const,
                values: sales.map((q, index) => {
                  const paid = q.data?.kpis.paidRevenue ?? q.data?.kpis.revenue;
                  const spend = media[index].data?.kpis.totalSpend;
                  return paid != null && spend != null && spend > 0
                    ? paid / spend
                    : null;
                }),
              },
            ]
          : []),
      ],
    },
    {
      title: "Cadastros",
      rows: [
        {
          label: "Cadastros",
          values: registrations.map((q) => q.data?.kpis.totalRegistrations),
        },
        {
          label: "Cadastros Aprovados",
          values: registrations.map((q) => q.data?.kpis.approvedRegistrations),
        },
        {
          label: "Taxa de Aprovação",
          format: "percent",
          values: registrations.map((q) => q.data?.kpis.approvalRatePct),
        },
      ],
    },
    {
      title: "Funil",
      rows: [
        {
          label: "Conversão",
          format: "percent",
          values: sales.map((q) => q.data?.kpis.conversionRate),
        },
      ],
    },
    {
      title: "Retenção",
      rows: [
        {
          label: "Retenção de compradores",
          format: "percent",
          values: sales.map((q) => q.data?.kpis.retentionPct),
        },
      ],
    },
  ];
  const availableGroups = groups.filter(
    (group) => !isB2C || group.title !== "Cadastros",
  );
  const visibleGroups = availableGroups
    .map((group) => ({
      ...group,
      rows: group.rows.filter((row) => !hiddenMetrics.includes(row.label)),
    }))
    .filter((group) => group.rows.length > 0);
  const allQueries = [...sales, ...media, ...registrations];
  const cell = (row: Row, index: number) => {
    const value = row.values[index];
    if (value == null)
      return canRead(index) &&
        allQueries.some((q, i) => i % 12 === index && q.isLoading)
        ? "…"
        : "—";
    if (row.format === "currency") return formatCurrency(value);
    if (row.format === "percent") return formatPercentage(value);
    if (row.format === "ratio") return `${value.toFixed(2)}x`;
    return formatNumber(value);
  };
  const exportTable = () =>
    exportRowsAsCsv(
      `historico-mensal-${year}.csv`,
      visibleGroups.flatMap((group) =>
        group.rows.map((row) => ({ group: tx(group.title), row })),
      ),
      [
        { header: tx("Grupo"), accessor: (item) => item.group },
        { header: tx("Métrica"), accessor: (item) => tx(item.row.label) },
        ...months.map((month, index) => ({
          header: month,
          accessor: (item: { row: Row }) => cell(item.row, index),
        })),
      ],
    );
  return (
    <Card
      data-testid="monthly-history-page"
      aria-busy={allQueries.some((q) => q.isFetching)}
    >
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-4">
        <CardTitle>{tx("Histórico Mensal")}</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Select
            value={String(year)}
            onValueChange={(value) => setYear(Number(value))}
          >
            <SelectTrigger
              className="w-[100px]"
              aria-label={tx("Ano do histórico")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 5 }, (_, i) => now.getFullYear() - i).map(
                (value) => (
                  <SelectItem key={value} value={String(value)}>
                    {value}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
          {allQueries.some((q) => q.isError) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                allQueries.filter((q) => q.isError).forEach((q) => q.refetch());
              }}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {tx("Tentar novamente")}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={exportTable}
            disabled={allQueries.some((q) => q.isLoading)}
          >
            <Download className="mr-2 h-4 w-4" />
            {tx("Exportar CSV")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <details className="mb-4 rounded-md border p-3">
          <summary className="cursor-pointer font-medium">
            {tx("Selecionar métricas")}
          </summary>
          <div className="mt-3 flex flex-wrap gap-3">
            {availableGroups
              .flatMap((group) => group.rows)
              .map((row) => (
                <label
                  key={row.label}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={!hiddenMetrics.includes(row.label)}
                    onChange={() => toggleMetric(row.label)}
                  />
                  {tx(row.label)}
                </label>
              ))}
          </div>
        </details>
        {visibleGroups.length === 0 && (
          <p className="py-4 text-muted-foreground">
            {tx("Selecione ao menos uma métrica para visualizar o histórico.")}
          </p>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tx("Métrica")}</TableHead>
              {months.map((month) => (
                <TableHead key={month} className="text-right">
                  {month}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleGroups.map((group) => (
              <Fragment key={group.title}>
                <TableRow className="bg-muted/30">
                  <TableCell colSpan={13} className="font-semibold">
                    {tx(group.title)}
                  </TableCell>
                </TableRow>
                {group.rows.map((row) => (
                  <TableRow key={row.label}>
                    <TableCell className="whitespace-nowrap font-medium">
                      {tx(row.label)}
                    </TableCell>
                    {months.map((month, index) => (
                      <TableCell
                        key={month}
                        className="whitespace-nowrap text-right tabular-nums"
                      >
                        {cell(row, index)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
