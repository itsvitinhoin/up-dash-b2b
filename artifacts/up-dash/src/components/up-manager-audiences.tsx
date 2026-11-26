import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { ArrowUpRight, Copy, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UpManagerConfirmAction } from "./up-manager-confirm-action";

type Period = { dateFrom: string; dateTo: string };
type Metrics = { spend: number; purchases: number; roas: number | null; cpa: number | null };
type Segment = { label: string; sets: number; kind: keyof typeof kinds; current: Metrics; previous: Metrics | null };
type Recommendation = { id: string; title: string; evidence: string; test: string; rule:
  { mode: "lookalike"; from: number; to: number; country: string }
  | { mode: "remarketing"; days: number; excludePurchasesDays: number }
  | { mode: "interest"; interests: { id: string; name: string }[]; combination?: "or" | "and"; country: string; age: { min: number; max: number } | null; states: string[] } };
export type AudienceStudy = {
  window: Period; previousWindow: Period | null; accountId?: string; referenceRoas?: number | null;
  segments: Segment[]; products: string[];
  ages: { label: string; spend: number; clicks: number; impressions: number; cpc: number | null }[];
  states: { code: string; orders: number; orderShare: number; spendShare: number; underexposed: boolean }[];
  recommendations: Recommendation[];
};
type Status = "pending" | "stale" | "uncertain" | "applied";
export type AudienceAction = { id: string; status: Status; audienceId?: string };

const kinds = { lookalike: "Lookalike", remarketing: "Remarketing", interests: "Interesses", broad: "Aberto", mixed: "Misto" };
const resultText: Record<Status, string> = {
  applied: "Público criado na Meta",
  pending: "Criação em andamento",
  stale: "A Meta não confirmou a origem, a permissão ou os parâmetros. Atualize o diagnóstico antes de tentar novamente.",
  uncertain: "Confirmação pendente. Consulte a Meta antes de repetir a criação.",
};
const format = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });
const day = (value: string) => value.slice(5).split("-").reverse().join("/");
const period = ({ dateFrom, dateTo }: Period) => `${day(dateFrom)} a ${day(dateTo)}`;

export function UpManagerAudiences({ study, clientId, runId, currency, canCreate, actions }: {
  study?: AudienceStudy; clientId: string; runId: string; currency: string; canCreate: boolean; actions: AudienceAction[];
}) {
  const [selection, setSelection] = useState<Recommendation | null>(null);
  const [results, setResults] = useState<AudienceAction[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [family, setFamily] = useState<Recommendation["rule"]["mode"] | "all">("all");
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (plan: Recommendation) => customFetch<Omit<AudienceAction, "id">>(
      `/api/up-manager/report/${runId}/audience-create?clientId=${encodeURIComponent(clientId)}`,
      { method: "POST", body: JSON.stringify({ planId: plan.id, confirm: true }) }),
    onSuccess: (result, { id }) => {
      setResults((previous) => [...previous.filter((item) => item.id !== id), { id, ...result }]);
      setSelection(null);
      void queryClient.invalidateQueries({ queryKey: ["up-manager", "report", clientId, runId] });
    },
  });
  if (!study) return <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
    Este diagnóstico ainda está sem o estudo de públicos. Abra uma análise recente.
  </p>;

  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency });
  const roas = (value: number | null) => value === null ? "—" : `${format.format(value)}×`;
  const price = (value: number | null) => value === null ? "—" : money.format(value);
  const ideas = study.recommendations.filter(({ rule }) => family === "all" || family === rule.mode);
  const metaAudiencesUrl = `https://adsmanager.facebook.com/adsmanager/audiences${study.accountId ? `?act=${encodeURIComponent(study.accountId)}` : ""}`;
  const filters = [
    { id: "all", name: "Todos" }, { id: "lookalike", name: "Lookalike" },
    { id: "remarketing", name: "Remarketing" }, { id: "interest", name: "Interesses" },
  ] as const;
  const targetingText = (rule: Extract<Recommendation["rule"], { mode: "interest" }>) => [
    rule.interests.map(({ name }) => name).join(rule.combination === "and" ? " E " : " OU "),
    rule.states.length ? rule.states.join(", ") : "Brasil",
    rule.age ? `${rule.age.min}–${rule.age.max} anos` : "Mesma faixa etária do controle",
  ].join(" · ");
  return <section aria-label="Estudo de públicos" className="min-w-0 space-y-5">
    <div className="space-y-3 rounded-xl border p-4">
      <div>
        <h3 className="text-base font-semibold">Públicos recomendados</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">Meta Ads · {period(study.window)} · 30 dias fechados</p>
      </div>
      <div className="flex flex-wrap gap-1.5" aria-label="Filtrar recomendações de público">
        {filters.map(({ id, name }) => <Button type="button" size="sm" key={id} variant={id === family ? "secondary" : "outline"}
          className="h-8" aria-pressed={id === family} onClick={() => setFamily(id)}>{name}</Button>)}
      </div>
      {ideas.length ? <ul className="divide-y rounded-lg border">
        {ideas.map((plan) => {
          const rule = plan.rule;
          const status = [...results, ...actions].find(({ id }) => id === plan.id);
          const kind = rule.mode === "interest" ? kinds.interests : kinds[rule.mode];
          return <li key={plan.id} className="min-w-0 space-y-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="text-sm">{plan.title}</strong>
              <Badge variant="outline">{kind}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">{plan.evidence}</p>
            <p className="text-sm">{plan.test}</p>
            {rule.mode === "interest" ? <div className="flex flex-wrap items-center gap-2">
              <p className="break-words text-xs text-muted-foreground">{targetingText(rule)}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => {
                void navigator.clipboard.writeText(targetingText(rule)).then(() => setCopied(plan.id), () => setCopied("error"));
              }}><Copy className="size-3.5" aria-hidden />{copied === plan.id ? "Segmentação copiada" : "Copiar segmentação"}</Button>
              <Button size="sm" variant="ghost" asChild><a href={metaAudiencesUrl} target="_blank" rel="noreferrer">
                Abrir Públicos na Meta <ArrowUpRight className="size-3.5" aria-hidden /></a></Button>
            </div> : canCreate && (!status || status.status === "stale" || status.status === "uncertain" || status.status === "pending") && (
              <Button type="button" variant="outline" size="sm" onClick={() => { create.reset(); setSelection(plan); }}>
                <Plus className="size-3.5" aria-hidden />
                {status?.status === "uncertain" || status?.status === "pending" ? "Consultar criação" : "Criar público na Meta"}
              </Button>
            )}
            {status && <p role="status" className="text-xs text-muted-foreground">
              {resultText[status.status]}{status.audienceId && ` · ID ${status.audienceId}`}
            </p>}
          </li>;
        })}
      </ul> : <p className="text-sm text-muted-foreground">Nenhuma recomendação com evidência suficiente neste filtro.</p>}
      {copied === "error" && <p role="status" className="text-xs text-muted-foreground">A cópia falhou. Selecione o texto da segmentação para copiar.</p>}
    </div>

    <div className="space-y-3 rounded-xl border p-4">
      <div>
        <h3 className="text-base font-semibold">Desempenho dos públicos</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Resultados atribuídos pela Meta, agrupados pela segmentação dos conjuntos. {study.previousWindow ? `Comparação com ${period(study.previousWindow)}.` : ""}
        </p>
      </div>
      {study.segments.length ? <ul className="divide-y rounded-lg border">
        {study.segments.map((segment, index) => <li key={`${segment.kind}:${segment.label}:${index}`} className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,0.6fr))]">
          <div className="min-w-0">
            <p className="break-words text-sm font-medium">{segment.label}</p>
            {study.referenceRoas != null && segment.current.roas != null && segment.current.roas > study.referenceRoas && segment.current.purchases >= 8 &&
              <Badge variant="outline" className="mb-1 text-emerald-700 dark:text-emerald-300">ROAS acima da conta</Badge>}
            <p className="text-xs text-muted-foreground">{kinds[segment.kind]} · {segment.sets} conjunto(s) · {price(segment.current.spend)} investidos</p>
          </div>
          {([
            ["ROAS", roas(segment.current.roas), segment.previous ? roas(segment.previous.roas) : null],
            ["CPA", price(segment.current.cpa), segment.previous ? price(segment.previous.cpa) : null],
            ["Compras", format.format(segment.current.purchases), segment.previous ? format.format(segment.previous.purchases) : null],
          ] as const).map(([label, value, before]) => <div key={label} className="text-xs">
            <p className="text-muted-foreground">{label}</p>
            <p className="font-semibold tabular-nums">{value}</p>
            {before && <p className="text-muted-foreground">Anterior {before}</p>}
          </div>)}
        </li>)}
      </ul> : <p className="text-sm text-muted-foreground">Segmentação dos conjuntos indisponível nesta leitura.</p>}
    </div>

    <div className="grid gap-3 lg:grid-cols-2">
      <section className="min-w-0 rounded-xl border p-4">
        <h3 className="text-sm font-semibold">Entrega por faixa etária</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">Cliques de link e custo por clique na Meta.</p>
        {study.ages.length ? <ul className="mt-2 divide-y">
          {study.ages.map(({ label, clicks, cpc }) => <li key={label} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
            <strong>{label} anos</strong><span className="text-muted-foreground">{format.format(clicks)} cliques · CPC {price(cpc)}</span>
          </li>)}
        </ul> : <p className="mt-2 text-xs text-muted-foreground">Recorte indisponível nesta leitura.</p>}
      </section>
      <section className="min-w-0 rounded-xl border p-4">
        <h3 className="text-sm font-semibold">Pedidos e investimento por UF</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">Pedidos aprovados da loja e gasto da Meta, entre registros com UF.</p>
        {study.states.length ? <ul className="mt-2 divide-y">
          {study.states.map((state) => <li key={state.code} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
            <strong>{state.code}</strong>
            <span className={state.underexposed ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground"}>
              {format.format(state.orders)} pedidos · {percent.format(state.orderShare)} dos pedidos · {percent.format(state.spendShare)} do gasto
            </span>
          </li>)}
        </ul> : <p className="mt-2 text-xs text-muted-foreground">Recorte indisponível nesta leitura.</p>}
      </section>
    </div>

    <UpManagerConfirmAction open={Boolean(selection)} onClose={() => setSelection(null)}
      title="Criar público na Meta" description={selection?.title ?? ""}
      confirm="Confirmar na Meta" pending={create.isPending} error={create.error?.message}
      onConfirm={() => { if (selection) create.mutate(selection); }}>
      <p className="text-sm text-muted-foreground">O público ficará disponível na conta de anúncios conectada para uso em um teste posterior.</p>
    </UpManagerConfirmAction>
  </section>;
}
