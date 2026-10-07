import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import { AlertCircle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatCurrency, formatCurrencySmart, formatNumber } from "@/lib/formatters";
import { queryOpts } from "@/lib/query-opts";
import { useReducedMotion } from "@/lib/motion";

type SalesMeasure = "units" | "revenue";
interface SalesBucket { label: string; units: number; revenue: number }
interface SalesBreakdowns {
  totals: { units: number; revenue: number };
  categories: SalesBucket[];
  colors: SalesBucket[];
  sizes: SalesBucket[];
}

const chartConfig = {
  units: { label: "Peças vendidas", color: "hsl(var(--primary))" },
  revenue: { label: "Faturamento", color: "hsl(var(--primary))" },
};
const SIZE_ORDER: Record<string, number> = { PP: 0, XS: 0, P: 1, S: 1, M: 2, G: 3, L: 3, GG: 4, XL: 4, XG: 5, XGG: 6, XXL: 6, XXG: 7, XXXL: 7, U: 8, UNICO: 8, "ÚNICO": 8 };

const compactUnits = (value: number) => Math.abs(value) >= 10_000
  ? new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(value)
  : formatNumber(value);

function compareSizes(a: SalesBucket, b: SalesBucket) {
  const rank = (label: string) => {
    const key = label.trim().toUpperCase();
    if (/^\d+(?:[.,]\d+)?$/.test(key)) return Number(key.replace(",", "."));
    if (key in SIZE_ORDER) return 1000 + SIZE_ORDER[key];
    return key === "NÃO INFORMADO" ? 3000 : 2000;
  };
  return rank(a.label) - rank(b.label) || a.label.localeCompare(b.label, "pt-BR", { numeric: true });
}

function SalesTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: SalesBucket }> }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="grid max-w-[min(280px,calc(100vw-32px))] gap-2 rounded-lg border border-border bg-background p-3 text-xs shadow-xl">
      <p className="break-words font-semibold">{row.label}</p>
      <div className="flex flex-wrap justify-between gap-x-5 gap-y-1"><span className="text-muted-foreground">Peças vendidas</span><span className="font-medium tabular-nums">{formatNumber(row.units)}</span></div>
      <div className="flex flex-wrap justify-between gap-x-5 gap-y-1"><span className="text-muted-foreground">Faturamento</span><span className="font-medium tabular-nums">{formatCurrency(row.revenue)}</span></div>
    </div>
  );
}

function ProductSalesCard({ title, dimension, data, measure, loading, domain }: {
  title: string; dimension: string; data: SalesBucket[]; measure: SalesMeasure; loading: boolean; domain: [number, number];
}) {
  const [showData, setShowData] = useState(false);
  const reduced = useReducedMotion();
  const sorted = useMemo(() => [...data].sort(dimension === "size" ? compareSizes : (a, b) => b[measure] - a[measure] || a.label.localeCompare(b.label, "pt-BR")), [data, dimension, measure]);
  const fmt = measure === "revenue" ? formatCurrencySmart : compactUnits;
  const dimensionLabel = dimension === "category" ? "Categoria" : dimension === "color" ? "Cor" : "Tamanho";

  return (
    <Card className="min-w-0" data-testid={`sales-by-${dimension}`}>
      <CardContent className="min-w-0 p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{title}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{measure === "units" ? "Peças vendidas no período" : "Faturamento no período"}</p>
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 rounded-full" aria-label={`Informações: ${title}`}><Info className="h-3.5 w-3.5" /></Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[min(320px,calc(100vw-24px))] space-y-3 text-xs">
              <p className="font-semibold text-sm">{title}</p>
              <p className="text-muted-foreground leading-relaxed">Peças vendidas: soma das quantidades dos itens de pedidos. Faturamento: quantidade × preço registrado na venda, sem frete. Os dois valores usam o período e os filtros selecionados.</p>
              <p className="text-muted-foreground leading-relaxed">Cada item entra uma única vez em cada gráfico. Atributos ausentes aparecem em “Não informado”. Os totais incluem todos os itens, independentemente do limite de produtos da tabela.</p>
              <p><span className="text-muted-foreground">Fonte: </span>Pedidos e itens do ecommerce conectado.</p>
            </PopoverContent>
          </Popover>
        </div>
        {loading ? (
          <div className="mt-5 space-y-4" aria-label={`Carregando ${title}`}>
            {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-7 w-full" />)}
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex min-h-[240px] items-center justify-center text-center text-sm text-muted-foreground">Sem vendas para os filtros selecionados.</div>
        ) : (
          <div className="mt-4 max-h-[320px] overflow-y-auto overflow-x-hidden">
            <ChartContainer config={chartConfig} className="w-full min-w-0 aspect-auto" style={{ height: Math.max(240, sorted.length * 42 + 32) }} aria-label={`${title} — ${measure === "units" ? "peças vendidas" : "faturamento"}`}>
              <BarChart accessibilityLayer data={sorted} layout="vertical" margin={{ top: 4, right: measure === "revenue" ? 82 : 50, bottom: 4, left: 0 }}>
                <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                <XAxis type="number" domain={domain} tickLine={false} axisLine={false} allowDecimals={measure === "revenue"} tick={{ fontSize: 12 }} tickFormatter={value => fmt(Number(value))} tickCount={3} minTickGap={24} />
                <YAxis type="category" dataKey="label" width={86} tickLine={false} axisLine={false} tick={{ fontSize: 12 }} interval={0} tickFormatter={label => String(label).length > 13 ? `${String(label).slice(0, 12)}…` : String(label)} />
                <ChartTooltip cursor={{ fill: "hsl(var(--primary) / 0.06)" }} content={<SalesTooltip />} />
                <Bar dataKey={measure} fill={`var(--color-${measure})`} radius={[0, 4, 4, 0]} maxBarSize={24} isAnimationActive={!reduced}>
                  <LabelList dataKey={measure} position="right" className="fill-foreground" fontSize={12} formatter={(value: number) => fmt(Number(value))} />
                </Bar>
              </BarChart>
            </ChartContainer>
          </div>
        )}
        <Button variant="ghost" size="sm" className="mt-3 w-full" disabled={loading || sorted.length === 0} onClick={() => setShowData(true)} aria-label={`Ver dados: ${title}`}>Ver dados</Button>
        <Dialog open={showData} onOpenChange={setShowData}>
          <DialogContent className="max-w-xl">
            <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>Peças vendidas e faturamento no período e nos filtros selecionados.</DialogDescription></DialogHeader>
            <div className="max-h-[60vh] overflow-auto">
              <Table>
                <TableHeader><TableRow><TableHead>{dimensionLabel}</TableHead><TableHead className="text-right">Peças</TableHead><TableHead className="text-right">Faturamento</TableHead></TableRow></TableHeader>
                <TableBody>{sorted.map(row => <TableRow key={row.label}><TableCell className="break-words">{row.label}</TableCell><TableCell className="text-right tabular-nums">{formatNumber(row.units)}</TableCell><TableCell className="text-right tabular-nums whitespace-nowrap">{formatCurrency(row.revenue)}</TableCell></TableRow>)}</TableBody>
              </Table>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

export function ProductSalesCharts({ url, enabled }: { url: string; enabled: boolean }) {
  const [measure, setMeasure] = useState<SalesMeasure>("units");
  const query = useQuery<SalesBreakdowns>({
    ...queryOpts<SalesBreakdowns>({ enabled }),
    queryKey: ["product-sales-breakdowns", url],
    queryFn: ({ signal }) => customFetch<SalesBreakdowns>(url, { signal }),
  });

  // The three partitions use the same scale for the selected measure.
  const values = query.data ? [...query.data.categories, ...query.data.colors, ...query.data.sizes].map(row => row[measure]) : [];
  const domain: [number, number] = [values.reduce((min, value) => Math.min(min, value), 0), values.reduce((max, value) => Math.max(max, value), 1)];

  return (
    <section className="min-w-0 space-y-4" data-testid="product-sales-charts" aria-label="Vendas de produtos">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Vendas de produtos</h2>
        <ToggleGroup type="single" value={measure} onValueChange={value => { if (value === "units" || value === "revenue") setMeasure(value); }} variant="outline" size="sm" className="min-w-0 flex-wrap" aria-label="Medida dos gráficos de vendas">
          <ToggleGroupItem value="units" aria-label="Peças vendidas">Peças vendidas</ToggleGroupItem>
          <ToggleGroupItem value="revenue" aria-label="Faturamento">Faturamento</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {query.isError ? (
        <Card><CardContent className="flex flex-wrap items-center gap-3 p-5 text-sm"><AlertCircle className="h-4 w-4 shrink-0 text-muted-foreground" /><p className="min-w-0 flex-1">Não foi possível carregar as vendas de produtos.</p><Button variant="outline" size="sm" onClick={() => void query.refetch()}>Tentar novamente</Button></CardContent></Card>
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-3">
          <ProductSalesCard title="Vendas por Categoria" dimension="category" data={query.data?.categories ?? []} measure={measure} loading={query.isLoading} domain={domain} />
          <ProductSalesCard title="Vendas por Cor" dimension="color" data={query.data?.colors ?? []} measure={measure} loading={query.isLoading} domain={domain} />
          <ProductSalesCard title="Vendas por Tamanho" dimension="size" data={query.data?.sizes ?? []} measure={measure} loading={query.isLoading} domain={domain} />
        </div>
      )}
    </section>
  );
}
