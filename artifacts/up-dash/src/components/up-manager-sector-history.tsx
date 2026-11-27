import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type SectorMemory = {
  observedOn: string;
  measures: {
    sector: string; subject: string; metric: string; before: number | null; after: number | null;
    unit: "money" | "cents" | "ratio" | "percent" | "days" | "count";
    direction: "improved" | "worsened" | "stable" | "unavailable"; context: string;
  }[];
  events: { id: string; sector: string; subject: string; day: string; source: string; detail: string;
    previousStock?: number | null; result?: { observedOn: string; stock: number } }[];
};
const format = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const date = (value: string) => value.slice(5, 10).split("-").reverse().join("/");
const labels = { improved: "Melhorou", worsened: "Piorou", stable: "Estável", unavailable: "Sem comparativo" };

export function UpManagerSectorHistory({ memory, currency }: { memory: SectorMemory; currency: string }) {
  const [sector, setSector] = useState("");
  const sectors = [...new Set([...memory.measures, ...memory.events].map((item) => item.sector))];
  const active = sector || sectors[0] || "";
  const money = new Intl.NumberFormat("pt-BR", { currency, style: "currency" });
  const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });
  const show = (value: number | null, unit: SectorMemory["measures"][number]["unit"]) =>
    value === null ? "—" : unit === "money" ? money.format(value) : unit === "cents" ? money.format(value / 100)
      : unit === "percent" ? percent.format(value) : `${format.format(value)}${unit === "days" ? " dias" : unit === "ratio" ? "×" : ""}`;
  return (
    <section aria-label="Memória por frente" className="space-y-3 rounded-xl border p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h4 className="font-semibold">Memória por frente</h4>
          <p className="text-xs text-muted-foreground">Leitura de {date(memory.observedOn)} · Indicadores e mudanças confirmadas nas fontes</p></div>
        {sectors.length > 0 && <label className="flex items-center gap-2 text-xs">Frente
          <select value={active} onChange={(event) => setSector(event.target.value)} className="rounded-md border bg-background px-2 py-1.5 text-sm">
            {sectors.map((name) => <option key={name}>{name}</option>)}
          </select>
        </label>}
      </div>
      <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border">
        {memory.measures.filter((item) => item.sector === active).map((item, index) => (
          <li key={`${item.subject}:${item.metric}:${index}`} className="px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-2"><strong>{item.subject}</strong>
              <span className="text-xs text-muted-foreground">{item.metric}</span>
              <Badge variant="outline" className={cn("ml-auto", item.direction === "worsened" && "text-red-700 dark:text-red-300",
                item.direction === "improved" && "text-emerald-700 dark:text-emerald-300")}>{labels[item.direction]}</Badge></div>
            <p className="mt-0.5 tabular-nums">{show(item.before, item.unit)} → {show(item.after, item.unit)}</p>
            <p className="text-xs text-muted-foreground">{item.context}</p>
          </li>
        ))}
      </ul>
      <details className="text-sm">
        <summary className="cursor-pointer font-medium">Alterações observadas · {memory.events.filter((item) => item.sector === active).length}</summary>
        <ul className="mt-2 max-h-60 divide-y overflow-y-auto rounded-lg border">
          {memory.events.filter((item) => item.sector === active).map((event) => (
            <li key={event.id} className="px-3 py-2">
              <strong>{event.subject}</strong>
              <p className="text-xs text-muted-foreground">{date(event.day)} · {event.detail}</p>
              {event.result && <p className="mt-0.5 text-xs">Saldo anterior {event.previousStock ?? "—"} → {event.result.stock} unidades em {date(event.result.observedOn)}</p>}
            </li>
          ))}
          {!memory.events.some((item) => item.sector === active) && <li className="p-3 text-xs text-muted-foreground">Sem alterações operacionais confirmadas nesta frente.</li>}
        </ul>
      </details>
    </section>
  );
}
