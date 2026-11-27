import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

type Sample = { count: number; average: number | null };
type Metric = {
  current: Sample;
  previous: Sample;
  direction: "improved" | "worsened" | "stable" | "small-sample" | "unavailable";
  material: boolean;
  delta: number | null;
  reasons: string[];
};
type Week = { dateFrom: string; dateTo: string };
type Coverage = { orders: number; missingState: number } | null;
export type FreightReport = {
  currentWindow: Week;
  previousWindow: Week;
  currency: string;
  coverage: { current: Coverage; previous: Coverage };
  scenarios?: { state: string; sample: number; comparisonOrders: number; averageOrder: number;
    free: { threshold: number; orders: number; subsidy: number }; fixed: { ceiling: number; orders: number; subsidy: number } }[];
  states: { state: string; currentOrders: number; previousOrders: number; price: Metric; delivery: Metric }[];
};

const day = (value: string) => value.slice(5, 10).split("-").reverse().join("/");
const period = ({ dateFrom, dateTo }: Week) => `${day(dateFrom)} a ${day(dateTo)}`;
const integer = new Intl.NumberFormat("pt-BR");
const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const direction = {
  improved: { label: "Melhorou", tone: "text-emerald-700 dark:text-emerald-300", icon: ArrowDown },
  worsened: { label: "Piorou", tone: "text-red-700 dark:text-red-300", icon: ArrowUp },
  stable: { label: "Estável", tone: "text-muted-foreground", icon: Minus },
  "small-sample": { label: "Poucos dados", tone: "text-muted-foreground", icon: null },
  unavailable: { label: "Sem comparação", tone: "text-muted-foreground", icon: null },
};

function FreightMetric({ metric, format }: { metric: Metric; format: (value: number) => string }) {
  const { current, previous, delta } = metric;
  const state = direction[metric.direction];
  const Icon = state.icon;
  const value = (sample: Sample) => sample.average === null ? "—" : format(sample.average);
  return (
    <div className="min-w-0">
      <p className="flex flex-wrap items-baseline gap-x-1 text-sm tabular-nums">
        <span className="text-muted-foreground" aria-label={`Anterior ${value(previous)}`}>{value(previous)}</span>
        <span className="text-xs text-muted-foreground" aria-hidden>→</span>
        <strong aria-label={`Atual ${value(current)}`}>{value(current)}</strong>
      </p>
      <p className={cn("mt-0.5 flex flex-wrap items-center gap-1 text-[11px] font-medium", state.tone)}>
        {Icon && <Icon className="size-3 shrink-0" aria-hidden />}
        {state.label}
        {delta !== null && (metric.direction === "worsened" || metric.direction === "improved")
          && <span className="tabular-nums">· {delta > 0 ? "+" : "−"}{format(Math.abs(delta))}</span>}
      </p>
      <p className="text-[11px] text-muted-foreground">{integer.format(previous.count)} → {integer.format(current.count)} pedidos</p>
    </div>
  );
}

export function UpManagerFreight({ report }: { report: FreightReport }) {
  const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: report.currency });
  const money = (value: number) => currency.format(value / 100);
  const delivery = (value: number) => `${decimal.format(value)} d úteis`;
  const rank = ({ price, delivery }: FreightReport["states"][number]) => {
    const metrics = [price, delivery];
    if (metrics.some((metric) => metric.material && metric.direction === "worsened")) return 0;
    if (metrics.some((metric) => metric.material && metric.direction === "improved")) return 1;
    if (metrics.some((metric) => metric.direction === "worsened" || metric.direction === "improved")) return 2;
    if (metrics.some((metric) => metric.direction === "stable")) return 3;
    return 4;
  };
  const rows = [...report.states].sort((a, b) => rank(a) - rank(b) || b.currentOrders - a.currentOrders || a.state.localeCompare(b.state));
  const grids = "grid grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1fr)] items-start gap-x-2 sm:grid-cols-[5rem_minmax(0,1fr)_minmax(0,1fr)] sm:gap-x-4";
  const { previous, current } = report.coverage;
  return (
    <section className="space-y-2" aria-label="Comparativo de frete por estado">
      <p className="text-xs text-muted-foreground">{period(report.previousWindow)} → {period(report.currentWindow)} · Pedidos pagos com entrega</p>
      {(!current || !previous) && <p role="status" className="text-xs text-muted-foreground">Uma ou ambas as semanas do histórico da loja estão indisponíveis.</p>}
      {rows.length ? (
        <div className="overflow-hidden rounded-xl border">
          <div className={cn(grids, "border-b bg-muted/45 px-2.5 py-2 text-xs font-medium text-muted-foreground sm:px-4")}>
            <span>UF</span><span>Preço médio cobrado</span><span>Prazo máximo médio prometido</span>
          </div>
          <ul className="divide-y">
            {rows.map(({ state, price, delivery: promise }) => (
              <li key={state} aria-label={state} className={cn(grids, "px-2.5 py-2.5 sm:px-4")}>
                <strong className="text-sm">{state}</strong>
                <FreightMetric metric={price} format={money} />
                <FreightMetric metric={promise} format={delivery} />
                {(price.reasons.length > 0 || promise.reasons.length > 0) && (
                  <details className="col-start-2 col-end-4 mt-1 text-xs text-muted-foreground">
                    <summary className="cursor-pointer font-medium text-foreground">O que pesou</summary>
                    <ul className="mt-1 space-y-1">
                      {price.reasons.map((reason) => <li key={`price:${reason}`}><strong>Preço.</strong> {reason}</li>)}
                      {promise.reasons.map((reason) => <li key={`delivery:${reason}`}><strong>Prazo.</strong> {reason}</li>)}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : <p className="text-sm text-muted-foreground">Nenhum pedido pago com UF disponível nessas semanas.</p>}
      {report.scenarios && (report.scenarios.length > 0 ? <details className="rounded-xl border p-3 text-sm">
        <summary className="cursor-pointer font-semibold">Simular frete grátis e frete com teto</summary>
        <p className="mt-2 text-xs text-muted-foreground">Simulação na semana de {period(report.currentWindow)}. O subsídio adicional é o valor que a loja deixaria de cobrar nos mesmos pedidos. A tarifa da transportadora depende de cotação.</p>
        <ul className="mt-2 divide-y">
          {report.scenarios.map(({ state, sample, comparisonOrders, averageOrder, free, fixed }) => <li className="py-2" key={state}>
            <p className="font-medium">{state} · Ticket de produtos {money(averageOrder)}</p>
            <p className="text-xs text-muted-foreground">Base válida de {sample} em {comparisonOrders} pedidos pagos</p>
            <p className="mt-1">Grátis a partir de {money(free.threshold)} · {free.orders} pedidos · <strong>{money(free.subsidy)}</strong></p>
            <p>Frete de até {money(fixed.ceiling)} · {fixed.orders} pedidos · <strong>{money(fixed.subsidy)}</strong></p>
          </li>)}
        </ul>
      </details> : rows.some((row) => rank(row) === 0) && <p className="text-xs text-muted-foreground">A amostra com valor de pedido e frete cobrado ainda é insuficiente para simular o subsídio por UF.</p>)}
      <p className="text-xs text-muted-foreground">
        Comparação a partir de 10 pedidos com dado válido por semana e métrica.
        {(previous?.missingState || current?.missingState) ? ` Pedidos sem UF ${previous?.missingState ?? "—"} → ${current?.missingState ?? "—"}.` : ""}
      </p>
    </section>
  );
}
