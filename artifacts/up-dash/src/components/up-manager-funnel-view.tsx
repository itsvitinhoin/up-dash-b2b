import { useId, useState, type ReactNode } from "react";
import { ArrowDown, ArrowRight, ArrowUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type FunnelStage = {
  id: string; label: string; current: number | null; previous: number | null;
  rate: number | null; previousRate: number | null;
  movement: "entry" | "improved" | "worsened" | "stable" | "insufficient";
  reason: string; action: string; factors?: { label: string; detail: string }[]; unresolved?: string;
};
export type FunnelPayment = {
  current: { created: number; approved: number; pending: number };
  previous: { created: number; approved: number; pending: number };
};
type Dates = { dateFrom: string; dateTo: string };
const integer = new Intl.NumberFormat("pt-BR");
const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const pct = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });
const count = (value: number | null) => value === null ? "—" : integer.format(value);
const dateLabel = (date: string) => date.slice(5, 10).split("-").reverse().join("/");
const range = ({ dateFrom, dateTo }: Dates) => dateFrom === dateTo ? dateLabel(dateTo) : `${dateLabel(dateFrom)} a ${dateLabel(dateTo)}`;
const accent = ["#38bdf8", "#6366f1", "#818cf8", "#a78bfa", "#c084fc"];
const movements = {
  entry: { label: "Entrada", tone: "text-muted-foreground" },
  improved: { label: "Melhorou", tone: "text-emerald-700 dark:text-emerald-300" },
  worsened: { label: "Piorou", tone: "text-red-700 dark:text-red-300" },
  stable: { label: "Estável", tone: "text-muted-foreground" },
  insufficient: { label: "Pouca evidência", tone: "text-muted-foreground" },
};

function FunnelRibbon({ stages, selected }: { stages: FunnelStage[]; selected: string }) {
  const id = useId();
  const max = Math.max(1, ...stages.map(({ current }) => current ?? 0));
  const width = 180;
  const halfHeights = stages.map(({ current }) => current === null ? 2 : 3 + 34 * current / max);
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${width * stages.length} 82`} className="block w-full">
      <defs>{stages.map(({ id: key }, i) => (
        <linearGradient key={key} id={`${id}-${i}`} x1="0%" x2="100%">
          <stop stopColor={accent[i]} /><stop offset="100%" stopColor={accent[i + 1] ?? accent[i]} />
        </linearGradient>
      ))}</defs>
      {stages.map(({ id: key, current }, i) => {
        const x = i * width;
        const end = x + width - 4;
        const first = halfHeights[i];
        const last = halfHeights[i + 1] ?? first;
        const d = `M ${x} ${41 - first} C ${x + 78} ${41 - first} ${end - 78} ${41 - last} ${end} ${41 - last}
          L ${end} ${41 + last} C ${end - 78} ${41 + last} ${x + 78} ${41 + first} ${x} ${41 + first} Z`;
        return <path key={key} d={d} fill={`url(#${id}-${i})`} opacity={current === null ? 0.2 : key === selected ? 0.92 : 0.58} />;
      })}
    </svg>
  );
}

export function UpManagerFunnelView({ stages, period, previous, checkoutTest, payment }: {
  stages: FunnelStage[]; period: Dates; previous?: Dates; checkoutTest?: ReactNode; payment?: FunnelPayment | null;
}) {
  const [selected, setSelected] = useState<string>();
  if (!stages.length) return null;
  const active = stages.find(({ id }) => id === selected) ??
    [...stages].filter(({ movement }) => movement === "worsened")
      .sort((a, b) => ((a.rate ?? 0) - (a.previousRate ?? 0)) - ((b.rate ?? 0) - (b.previousRate ?? 0)))[0] ?? stages[0];
  const status = movements[active.movement];
  return (
    <section aria-label="Funil de conversão do Up Manager" className="min-w-0 space-y-3 rounded-xl border bg-card p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-semibold">Funil de conversão</h4>
        <p className="text-xs text-muted-foreground">GA4 · {previous ? `${range(previous)} → ` : ""}{range(period)}</p>
      </div>
      <div className="overflow-x-auto pb-1.5">
        <div className="min-w-[43rem]">
          <FunnelRibbon stages={stages} selected={active.id} />
          <div className="grid grid-cols-5 gap-1.5" aria-label="Etapas do funil">
            {stages.map((stage, index) => {
              const state = movements[stage.movement];
              const Icon = stage.movement === "worsened" ? ArrowDown : stage.movement === "improved" ? ArrowUp : null;
              return (
                <button key={stage.id} type="button" aria-pressed={active.id === stage.id}
                  onClick={() => setSelected(stage.id)}
                  style={{ borderTopColor: accent[index] }}
                  className={cn("min-w-0 rounded-lg border border-t-2 px-2.5 py-2.5 text-left hover:bg-muted/50 focus-visible:outline focus-visible:outline-primary",
                    stage.id === active.id && "bg-primary/10 ring-1 ring-primary/40")}>
                  <span className="block text-xs font-medium text-muted-foreground">{stage.label}</span>
                  <span className="mt-1 block text-lg font-semibold tabular-nums">{count(stage.current)}</span>
                  <span className="block text-xs text-muted-foreground tabular-nums">Anterior {count(stage.previous)}</span>
                  {stage.rate !== null && (
                    <span className="mt-1.5 block text-[11px] tabular-nums">
                      {stage.id === "productViews"
                        ? `${stage.previousRate === null ? "—" : decimal.format(stage.previousRate)} → ${decimal.format(stage.rate)} por sessão`
                        : `${stage.previousRate === null ? "—" : pct.format(stage.previousRate)} → ${pct.format(stage.rate)}`}
                    </span>
                  )}
                  <span className={cn("mt-1 flex items-center gap-1 text-[11px] font-medium", state.tone)}>
                    {Icon && <Icon className="size-3" aria-hidden />}{state.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="space-y-3 rounded-lg border bg-muted/25 p-3" aria-live="polite">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold">{active.label}</p><span className={cn("text-xs", status.tone)}>{status.label}</span>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div><p className="text-xs font-medium text-muted-foreground">O que os dados mostram</p><p className="mt-1 text-sm">{active.reason}</p></div>
          <div><p className="text-xs font-medium text-muted-foreground">Ação recomendada</p><p className="mt-1 text-sm">{active.action}</p></div>
        </div>
        {active.factors && active.factors.length > 0 && <details>
          <summary className="flex cursor-pointer items-center gap-1 text-xs font-medium text-primary"><ChevronDown className="size-3" aria-hidden /> Ver evidências da etapa</summary>
          <ul className="mt-2 space-y-2 text-xs text-muted-foreground">
            {active.factors.map(({ label, detail }) => <li key={label}><strong className="text-foreground">{label}</strong> · {detail}</li>)}
          </ul>
          {active.unresolved && <p className="mt-2 text-xs text-muted-foreground">{active.unresolved}</p>}
        </details>}
        {active.id === "checkouts" && checkoutTest}
      </div>
      {payment && <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        <strong className="text-foreground">Aprovação na loja</strong>
        · {count(payment.previous.approved)} de {count(payment.previous.created)}
        <ArrowRight className="size-3" aria-hidden />
        {count(payment.current.approved)} de {count(payment.current.created)} · {count(payment.current.pending)} pendentes no período atual
      </p>}
    </section>
  );
}
