import type { ReactNode } from "react";
import { Users } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TableRow, TableCell } from "@/components/ui/table";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  formatCurrency,
  formatCurrencySmart,
  formatNumber,
} from "@/lib/formatters";
const chartConfig = {
  revenue: { label: "Faturamento", color: "hsl(var(--chart-1))" },
  orders: { label: "Pedidos", color: "hsl(var(--chart-2))" },
  secondary: { label: "Comparativo", color: "hsl(var(--chart-2))" },
  primary: { label: "Valor", color: "hsl(var(--chart-1))" },
};

export function SectionTitle({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof Users;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="rounded-md bg-primary/10 p-2 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {action}
    </div>
  );
}
export function EmptyRow({
  colSpan,
  loading,
}: {
  colSpan: number;
  loading?: boolean;
}) {
  return (
    <TableRow>
      <TableCell
        colSpan={colSpan}
        className="h-24 text-center text-sm text-muted-foreground"
      >
        {loading ? "Carregando dados do ERP..." : "Nenhum registro encontrado."}
      </TableCell>
    </TableRow>
  );
}
export function Pagination({
  page,
  total,
  size,
  onChange,
}: {
  page: number;
  total: number;
  size: number;
  onChange: (page: number) => void;
}) {
  if (!total) return null;
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="flex items-center justify-between border-t pt-4">
      <p className="text-sm text-muted-foreground">
        Página {page} de {pages} · {formatNumber(total)} registros
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          Anterior
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
        >
          Próxima
        </Button>
      </div>
    </div>
  );
}
export function BreakdownCard({
  title,
  description,
  icon,
  data,
  valueKey = "revenue",
  currency = true,
}: {
  title: string;
  description: string;
  icon: typeof Users;
  data: Array<Record<string, unknown>>;
  valueKey?: string;
  currency?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <SectionTitle title={title} description={description} icon={icon} />
        <ChartContainer
          config={chartConfig}
          className="mt-4 h-[270px] w-full aspect-auto"
        >
          <BarChart
            data={data}
            layout="vertical"
            margin={{ left: 8, right: currency ? 82 : 56 }}
          >
            <CartesianGrid horizontal={false} strokeDasharray="3 3" />
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="label"
              width={108}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11 }}
              interval={0}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value) =>
                    currency
                      ? formatCurrency(Number(value))
                      : formatNumber(Number(value))
                  }
                />
              }
            />
            <Bar
              dataKey={valueKey}
              fill="var(--color-primary)"
              radius={[0, 4, 4, 0]}
            >
              <LabelList
                dataKey={valueKey}
                position="right"
                className="fill-foreground"
                fontSize={11}
                formatter={(value: number) =>
                  currency
                    ? formatCurrencySmart(Number(value))
                    : formatNumber(Number(value))
                }
              />
            </Bar>
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
