import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { CalendarDays, Check, ChevronRight, ClipboardCheck, FlaskConical, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { UpManagerConfirmAction } from "./up-manager-confirm-action";

type Period = { dateFrom: string; dateTo: string };
type Metric = "revenue" | "purchases" | "roas" | "cac" | "checkout" | "repeat";
type Goals = { spendCap: number | null; targetCpa: number | null; targetRoas: number | null; context: string };
type Weekly = { week: Period; goals: Goals };
type Result = { status: "improved" | "worsened" | "stable" | "mixed" | "insufficient"; before: number | null; after: number | null; targetReached: boolean | null };
type Followup = {
  runId: string; insightId: string; startedAt: string; measureOn: string;
  plan: { title: string; action: string; expectation: string; note: string; metric: Metric; target: number };
  result: Result | null;
};
export type WeeklyPlan = Weekly & {
  spendToDate: number | null; spendThrough: string | null; comparison: Period; historicalCpa: number | null;
  campaignItems: {
    id: string; name: string; level: "campaign" | "adset" | "ad"; decision: "pause" | "reduce" | "optimize" | "scale" | "hold";
    reason: string; action: string; cpa: number | null; roas: number | null; spend: number | null; purchases: number | null;
  }[];
  creative: { name: string; campaign: string; hypothesis: string; action: string; cpa: number | null; purchases: number; weaker: string | null } | null;
};
export type Workflow = { followups: Followup[]; weekly: Weekly; canEditGoals: boolean };
type MediaLesson = {
  id: string; level: string; name: string; title: string; day: string; status: string; description: string;
  before: { roas: number | null; purchases: number } | null; after: { roas: number | null; purchases: number } | null;
};
export type DecisionToFollow = { id: string; title: string; action: string; focus?: string };

const metricNames: Record<Metric, string> = {
  revenue: "Faturamento aprovado", purchases: "Pedidos aprovados", roas: "ROAS Meta",
  cac: "CAC combinado", checkout: "Carrinho → checkout", repeat: "Taxa de recompra",
};
const states: Record<string, string> = {
  improved: "Melhorou", worsened: "Piorou", stable: "Estável", mixed: "Teste sobreposto ou resultado misto",
  insufficient: "Amostra insuficiente", maturing: "Em medição",
};
const labels = { pause: "Pausar", reduce: "Reduzir", optimize: "Otimizar", scale: "Escalar", hold: "Aguardar" };
const tones = {
  pause: "border-red-500/40 text-red-700 dark:text-red-300",
  reduce: "border-amber-500/40 text-amber-800 dark:text-amber-300",
  optimize: "border-amber-500/40 text-amber-800 dark:text-amber-300",
  scale: "border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
  hold: "text-muted-foreground",
};
const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const date = (day: string) => day.slice(5, 10).split("-").reverse().join("/");
const asDate = (value: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date(value));
const range = (period: Period) => `${date(period.dateFrom)} a ${date(period.dateTo)}`;
const numeric = (value: string) => value.trim() === "" ? null : Number(value.trim().replace(",", "."));
const validGoal = (value: string) => {
  const parsed = numeric(value);
  return parsed === null || (Number.isFinite(parsed) && parsed > 0);
};
const money = (value: number | null, currency: string) => value === null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
const metricValue = (metric: Metric, value: number | null, currency: string) => value === null ? "—"
  : metric === "revenue" || metric === "cac" ? money(value, currency)
    : `${decimal.format(value)}${metric === "roas" ? "×" : metric === "checkout" || metric === "repeat" ? "%" : ""}`;
const endpoint = (clientId: string, path = "") => `/api/up-manager/workflow${path}?clientId=${encodeURIComponent(clientId)}`;

export function useManagerWorkflow(clientId: string) {
  return useQuery({ queryKey: ["up-manager", "workflow", clientId], queryFn: () => customFetch<Workflow>(endpoint(clientId)) });
}

function GoalsEditor({ clientId, weekly }: { clientId: string; weekly: Weekly }) {
  const client = useQueryClient();
  const [cap, setCap] = useState(String(weekly.goals.spendCap ?? ""));
  const [cpa, setCpa] = useState(String(weekly.goals.targetCpa ?? ""));
  const [roas, setRoas] = useState(String(weekly.goals.targetRoas ?? ""));
  const [context, setContext] = useState(weekly.goals.context);
  const valid = [cap, cpa, roas].every(validGoal);
  const save = useMutation({
    mutationFn: () => customFetch<Weekly>(endpoint(clientId, "/goals"), {
      method: "PUT", body: JSON.stringify({ weekStart: weekly.week.dateFrom,
        goals: { spendCap: numeric(cap), targetCpa: numeric(cpa), targetRoas: numeric(roas), context } }),
    }),
    onSuccess: (weekly) => client.setQueryData<Workflow>(["up-manager", "workflow", clientId],
      (current) => current ? { ...current, weekly } : current),
  });
  return (
    <details className="rounded-xl border p-3 text-sm">
      <summary className="cursor-pointer font-medium">Editar metas e calendário</summary>
      <form className="mt-3 space-y-3" onSubmit={(event) => { event.preventDefault(); if (valid) save.mutate(); }}>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="space-y-1 text-xs">Teto semanal<Input inputMode="decimal" value={cap} onChange={(event) => setCap(event.target.value)} /></label>
          <label className="space-y-1 text-xs">CPA máximo<Input inputMode="decimal" value={cpa} onChange={(event) => setCpa(event.target.value)} /></label>
          <label className="space-y-1 text-xs">ROAS mínimo<Input inputMode="decimal" value={roas} onChange={(event) => setRoas(event.target.value)} /></label>
        </div>
        <label className="block space-y-1 text-xs">Calendário e restrições da marca
          <Textarea value={context} maxLength={700} onChange={(event) => setContext(event.target.value)}
            placeholder="Ex. lançamento, promoção ou limite de estoque previsto para a semana" />
        </label>
        <Button size="sm" type="submit" disabled={save.isPending || !valid}>{save.isPending ? "Salvando…" : "Salvar metas"}</Button>
        {!valid && <p role="alert" className="text-xs text-destructive">Informe metas positivas ou deixe o campo vazio.</p>}
        {save.isError && <p role="alert" className="text-xs text-destructive">{save.error.message}</p>}
        {save.isSuccess && <p role="status" className="text-xs text-muted-foreground">Metas salvas para esta semana.</p>}
      </form>
    </details>
  );
}

export function ManagerWeeklyView({ plan, data, clientId, currency }: {
  plan?: WeeklyPlan | null; data?: Workflow; clientId: string; currency: string;
}) {
  const currentWeek = data?.weekly ?? plan;
  const weekly = plan && currentWeek?.week.dateFrom === plan.week.dateFrom ? plan : null;
  const goals = currentWeek?.goals;
  const cap = goals?.spendCap;
  const spend = weekly?.spendToDate;
  const actions = weekly?.campaignItems.filter(({ decision }) => decision === "pause" || decision === "scale") ?? [];
  return (
    <section aria-label="Plano semanal de performance" className="space-y-4">
      <div className="rounded-xl border bg-muted/25 p-4">
        <h3 className="flex items-center gap-2 font-semibold"><CalendarDays className="size-4" aria-hidden /> Plano semanal{currentWeek ? ` · ${range(currentWeek.week)}` : ""}</h3>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <div><p className="text-xs text-muted-foreground">Investido na semana</p><strong>{money(spend ?? null, currency)}</strong>
            {weekly?.spendThrough && <p className="text-xs text-muted-foreground">Até {date(weekly.spendThrough)}</p>}</div>
          <div><p className="text-xs text-muted-foreground">Teto semanal</p><strong>{cap == null ? "A definir" : money(cap, currency)}</strong>
            {cap != null && spend != null && <p className="text-xs text-muted-foreground">{spend > cap ? "Acima do teto" : `${money(cap - spend, currency)} disponíveis no teto`}</p>}</div>
          <div><p className="text-xs text-muted-foreground">{goals?.targetCpa == null ? "CPA de referência" : "CPA máximo"}</p>
            <strong>{money(goals?.targetCpa ?? weekly?.historicalCpa ?? null, currency)}</strong></div>
          <div><p className="text-xs text-muted-foreground">ROAS mínimo</p><strong>{goals?.targetRoas == null ? "A definir" : `${decimal.format(goals.targetRoas)}×`}</strong></div>
        </div>
        {goals?.context && <p className="mt-3 whitespace-pre-wrap break-words border-t pt-3 text-sm">{goals.context}</p>}
      </div>
      {data?.canEditGoals && currentWeek && <GoalsEditor clientId={clientId} weekly={currentWeek} key={currentWeek.week.dateFrom} />}
      {!weekly ? <p className="text-sm text-muted-foreground">O plano desta semana será calculado no próximo diagnóstico.</p> : <>
        <section className="space-y-2">
          <h4 className="font-semibold">Verba, campanhas e testes</h4>
          <p className="text-xs text-muted-foreground">Desempenho de {range(weekly.comparison)}. A escala depende da cobertura de estoque e das metas da marca.</p>
          {actions.length ? <ul className="divide-y rounded-xl border">
            {actions.map((item) => {
              const blocked = item.decision === "scale" && ((cap != null && (spend == null || spend >= cap)) ||
                (goals?.targetCpa != null && (item.cpa == null || item.cpa > goals.targetCpa)) ||
                (goals?.targetRoas != null && (item.roas == null || item.roas < goals.targetRoas)));
              const decision = blocked ? "hold" : item.decision;
              return <li key={item.id} className="space-y-1 px-3 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={tones[decision]}>{labels[decision]}</Badge>
                  <strong className="break-words">{item.name}</strong>
                  <span className="text-xs text-muted-foreground">{{ campaign: "Campanha", adset: "Conjunto", ad: "Anúncio" }[item.level]}</span>
                </div>
                <p className="text-xs text-muted-foreground">CPA {money(item.cpa, currency)} · ROAS {metricValue("roas", item.roas, currency)}
                  {item.purchases !== null && ` · ${item.purchases} compras`}</p>
                <p>{blocked ? "Aguardar até atender às metas ou ao teto da semana." : item.action}</p>
                <p className="text-xs text-muted-foreground">{item.reason}</p>
              </li>;
            })}
          </ul> : <p className="rounded-xl border p-3 text-sm text-muted-foreground">Nenhuma mudança de verba recomendada para as campanhas analisadas.</p>}
        </section>
        <section className="rounded-xl border p-4">
          <h4 className="flex items-center gap-2 font-semibold"><FlaskConical className="size-4" aria-hidden /> Próximo teste de criativo</h4>
          {weekly.creative ? <>
            <p className="mt-2 text-sm font-medium">{weekly.creative.name} <span className="text-xs text-muted-foreground">· {weekly.creative.campaign}</span></p>
            {weekly.creative.weaker && <p className="text-xs text-muted-foreground">Variante priorizada para revisão · {weekly.creative.weaker}</p>}
            <p className="mt-2 text-sm">{weekly.creative.hypothesis}</p><p className="mt-1 text-xs text-muted-foreground">{weekly.creative.action}</p>
          </> : <p className="mt-2 text-sm text-muted-foreground">A leitura atual não oferece um criativo de referência com evidência suficiente.</p>}
        </section>
      </>}
    </section>
  );
}

const defaultMetric = (focus?: string): Metric =>
  focus === "campaigns" ? "roas" : focus === "funnel" ? "checkout" : focus === "acquisition" ? "cac" : focus === "retention" ? "repeat" : "purchases";

export function RegisterManagerFollowup({ item, clientId, runId, onClose }: {
  item: DecisionToFollow; clientId: string; runId: string; onClose: () => void;
}) {
  const client = useQueryClient();
  const [metric, setMetric] = useState<Metric>(() => defaultMetric(item.focus));
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () => customFetch<Followup>(`/api/up-manager/report/${runId}/followup?clientId=${encodeURIComponent(clientId)}`,
      { method: "POST", body: JSON.stringify({ insightId: item.id, metric, target: numeric(target), note }) }),
    onSuccess: async (row) => {
      client.setQueryData<Workflow>(["up-manager", "workflow", clientId], (current) => current
        ? { ...current, followups: [row, ...current.followups.filter((saved) => saved.runId !== row.runId || saved.insightId !== row.insightId)] }
        : current);
      onClose();
      await client.invalidateQueries({ queryKey: ["up-manager", "workflow", clientId] });
    },
  });
  return (
    <UpManagerConfirmAction open onClose={onClose} title="Registrar execução"
      description={item.title} error={save.error?.message} pending={save.isPending}
      disabled={note.trim().length < 3 || !((numeric(target) ?? 0) > 0)}
      confirm="Registrar e acompanhar" onConfirm={() => save.mutate()}>
      <div className="space-y-3 text-sm">
        <label className="block space-y-1">O que foi executado
          <Textarea maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">Indicador da marca
            <select className="block h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={metric} onChange={(event) => setMetric(event.target.value as Metric)}>
              {Object.entries(metricNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <label className="space-y-1">Meta em 7 dias
            <Input value={target} inputMode="decimal" onChange={(event) => setTarget(event.target.value)} />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">O Manager compara os 7 dias anteriores e posteriores, exclui o dia da execução e aguarda a maturação da atribuição.</p>
      </div>
    </UpManagerConfirmAction>
  );
}

export function ManagerFollowupsView({ data, lessons, currency }: {
  data?: Workflow; lessons?: MediaLesson[]; currency: string;
}) {
  return (
    <section aria-label="Acompanhamento de ações" className="space-y-4">
      <div>
        <h3 className="flex items-center gap-2 font-semibold"><ClipboardCheck className="size-4" aria-hidden /> Ações em acompanhamento</h3>
        <p className="mt-1 text-sm text-muted-foreground">Compare o antes e o depois da execução. Mudanças próximas no mesmo indicador podem afetar a leitura.</p>
      </div>
      {data?.followups.length ? <ul className="divide-y rounded-xl border">
        {data.followups.map(({ runId, insightId, startedAt, measureOn, plan, result }) => (
          <li key={`${runId}:${insightId}`} className="space-y-1 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2"><strong>{plan.title}</strong><Badge variant="outline">{result ? states[result.status] : "Em medição"}</Badge></div>
            <p className="whitespace-pre-wrap">{plan.note}</p>
            <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground"><Target className="size-3" aria-hidden />
              {metricNames[plan.metric]} · Meta {plan.metric === "cac" ? "≤" : "≥"} {metricValue(plan.metric, plan.target, currency)} · Executada em {asDate(startedAt)} · Medição a partir de {date(measureOn)}</p>
            {result && <p className="text-sm tabular-nums">{metricValue(plan.metric, result.before, currency)} → {metricValue(plan.metric, result.after, currency)}
              {result.targetReached && <span className="ml-2 inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300"><Check className="size-3" aria-hidden /> Meta atingida</span>}
              {result.targetReached === false && <span className="ml-2 text-muted-foreground">Meta não atingida</span>}</p>}
            {result && <p className="text-xs font-medium">
              {result.status === "worsened" ? "Próxima decisão · revisar a reversão do ajuste."
                : result.status === "mixed" ? "Próximo teste · isolar a mudança antes de repetir."
                : result.status === "insufficient" ? "Aguardar uma janela com cobertura suficiente."
                : result.targetReached ? "Próxima decisão · manter e acompanhar."
                : "Próximo teste · ajustar a execução e medir novamente."}
            </p>}
            <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Decisão registrada</summary><p className="mt-1">{plan.action}</p><p className="mt-1">{plan.expectation}</p></details>
          </li>
        ))}
      </ul> : <p className="rounded-xl border p-3 text-sm text-muted-foreground">Use “Registrar execução” no detalhe de uma decisão para acompanhar o resultado.</p>}
      <details className="rounded-xl border p-3">
        <summary className="cursor-pointer text-sm font-medium">Mudanças detectadas na Meta {lessons?.length ? `· ${lessons.length}` : ""}</summary>
        {lessons?.length ? <ul className="mt-2 divide-y">
          {lessons.map((lesson) => <li key={`${lesson.id}:${lesson.level}:${lesson.day}:${lesson.title}`} className="py-2.5 text-sm">
            <div className="flex flex-wrap gap-2"><strong>{lesson.name}</strong><Badge variant="outline">{states[lesson.status] ?? lesson.status}</Badge></div>
            <p className="text-xs text-muted-foreground">{date(lesson.day)} · {lesson.title}</p>
            <p className="mt-1 text-xs">{lesson.description}</p>
            {lesson.before && lesson.after && <p className="flex flex-wrap items-center gap-1 text-xs">
              ROAS {metricValue("roas", lesson.before.roas, currency)} <ChevronRight className="size-3" aria-hidden /> {metricValue("roas", lesson.after.roas, currency)}
              · Compras {lesson.before.purchases} → {lesson.after.purchases}
            </p>}
          </li>)}
        </ul> : <p className="mt-2 text-sm text-muted-foreground">Sem alterações observadas na leitura deste diagnóstico.</p>}
      </details>
    </section>
  );
}
