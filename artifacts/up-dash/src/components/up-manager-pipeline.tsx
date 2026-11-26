import { useId } from "react";
import { CheckCircle2, Clock3, Database, Filter, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export function UpManagerPipeline({ sources, agent, model, archivedAt, processing }: {
  sources: { label: string; ready: boolean }[];
  agent?: string; model?: string; archivedAt?: string | null; processing?: boolean;
}) {
  const id = useId();
  const readyCount = sources.filter(({ ready }) => ready).length;
  const ready = agent === "ready";
  const routes = sources.map((item, i) => ({
    ...item, y: 13 + 16 * i, path: `M 8,${13 + 16 * i} C 48,${13 + 16 * i} 58,45 88,45`,
  }));
  const slots = [
    { label: "Fontes de dados", value: `${readyCount} de ${sources.length} com cobertura`, ready: readyCount === sources.length, icon: Filter },
    { label: "Análise com IA", value: processing ? "Novo diagnóstico em análise" : ready ? model?.startsWith("gpt-6.1-sol") ? "GPT‑6.1 Sol · concluída" : "OpenAI · concluída" : "Análise por regras", ready: ready && !processing, icon: Sparkles },
    { label: "Memória da marca", value: archivedAt ? "Gravada no BigQuery" : "Arquivo pendente de confirmação", ready: Boolean(archivedAt), icon: Database },
  ];
  return (
    <section aria-label="Fluxo de dados e análise do Up Manager" className="grid items-center gap-2 rounded-xl border border-primary/15 bg-primary/5 p-3 sm:grid-cols-[minmax(5rem,0.8fr)_minmax(0,2fr)] sm:gap-4">
      <svg aria-hidden="true" viewBox="0 0 220 92" className="mx-auto h-16 w-full max-w-52 sm:h-auto">
        <defs><linearGradient id={id}><stop stopColor="#38bdf8" /><stop offset="100%" stopColor="#a78bfa" /></linearGradient></defs>
        {routes.map(({ label, y, path, ready: available }) => (
          <g key={label}>
            <path d={path} fill="none" stroke={available ? `url(#${id})` : "currentColor"} opacity={available ? 0.6 : 0.22} strokeWidth="1.4" />
            <circle cx="8" cy={y} r="2.4" fill={available ? "#38bdf8" : "currentColor"} opacity={available ? 1 : 0.3} />
            {available && <path d={path} fill="none" stroke="#7dd3fc" strokeDasharray="4 86" strokeWidth="2.4"
              className={cn("opacity-0", processing ? "motion-safe:[animation:manager-flow_2s_linear_infinite]" : "motion-safe:[animation:manager-flow_2.4s_linear_3]")} />}
          </g>
        ))}
        <path d="M88 24 H135 L121 48 V64 L103 70 V48 Z" fill={`url(#${id})`} fillOpacity=".17" stroke={`url(#${id})`} strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M121 55 C149 55 145 45 171 45 H208" stroke={`url(#${id})`} fill="none" strokeWidth="1.5" opacity=".65" />
        {readyCount > 0 && <path d="M121 55 C149 55 145 45 171 45 H208" fill="none" stroke="#c4b5fd" strokeDasharray="4 86" strokeWidth="2.4"
          className={cn("opacity-0", processing ? "motion-safe:[animation:manager-flow_2s_linear_infinite]" : "motion-safe:[animation:manager-flow_2.4s_linear_3]")} />}
        <circle cx="208" cy="45" r="5" fill={archivedAt ? "#a78bfa" : "#64748b"} />
      </svg>
      <dl className="grid grid-cols-3 gap-2">
        {slots.map(({ label, value, ready: available, icon: Icon }) => (
          <div key={label} className="min-w-0 space-y-0.5">
            <dt className="flex flex-wrap items-center gap-1 text-xs font-medium"><Icon className="size-3.5 shrink-0 text-primary" aria-hidden />{label}</dt>
            <dd className="flex items-start gap-1 text-[11px] text-muted-foreground">
              {available ? <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                : <Clock3 className="mt-0.5 size-3 shrink-0" aria-hidden />}
              <span>{value}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
