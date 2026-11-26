import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import {
  CalendarClock,
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  Check,
  ChevronDown,
  PackageX,
  Package,
  Film,
  Sparkles,
  TriangleAlert,
  FlaskConical,
  Users,
} from "lucide-react";
import { UpManagerCardLoader } from "./up-manager-card-loader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UpManagerGradeCard, type GradeLine } from "./up-manager-grade-card";
import { useUpManagerGradePause, type GradeAdAction, type GradePauseRenderer } from "./up-manager-grade-pause";
import {
  UpManagerCreativeCards,
  type CreativeReview,
  type CreativeAction,
} from "./up-manager-creative-cards";
import { UpManagerPaidMedia, isMediaDiagnostic, type PaidMediaMonitorData, type PaidMediaAction } from "./up-manager-paid-media";
import { UpManagerDpa, type DpaCatalog } from "./up-manager-dpa";
import { UpManagerAudiences, type AudienceAction } from "./up-manager-audiences";
import { UpManagerProductTraffic, type ProductTraffic } from "./up-manager-product-traffic";
import { UpManagerFreight, type FreightReport } from "./up-manager-freight";
import { UpManagerFunnelView, type FunnelStage, type FunnelPayment } from "./up-manager-funnel-view";
import { UpManagerPipeline } from "./up-manager-pipeline";
import { UpManagerSectorHistory, type SectorMemory } from "./up-manager-sector-history";
import { ManagerFollowupsView, ManagerWeeklyView, RegisterManagerFollowup, useManagerWorkflow,
  type DecisionToFollow, type WeeklyPlan } from "./up-manager-workflow";
import { cn } from "@/lib/utils";

const topics = [
  { id: "campaigns", label: "Campanhas" },
  { id: "stock", label: "Estoque" },
  { id: "funnel", label: "Funil" },
  { id: "freight", label: "Frete" },
  { id: "acquisition", label: "CAC" },
  { id: "retention", label: "Retenção" },
] as const;
type Focus = (typeof topics)[number]["id"];

type Evidence = { id: string; label: string; value: string };
type Grade = NonNullable<GradeLine["grade"]> & { unknownVariants: number; observedAt: string | null };
type CheckoutDiagnosis = {
  factors: { label: string; detail: string }[];
  unresolved: string;
};
export interface UpManagerFinding {
  id: string;
  title: string;
  evidence: string;
  action: string;
  clientDraft?: string;
  section: "analysis" | "campaigns" | "products";
  hypothesis?: string;
  owner?: string;
  followUp?: string;
  priority?: "P0" | "P1" | "P2";
  grade?: Grade;
  diagnosis?: CheckoutDiagnosis;
  focus?: Focus;
}
type AgentInsight = {
  focus?: Focus;
  grade?: Grade;
  diagnosis?: CheckoutDiagnosis;
  id: string;
  title: string;
  problem: string;
  action: string;
  clientDraft?: string;
  verification: string;
  owner: string;
  urgency: "now" | "next";
  evidence: Evidence[];
};
type AgentAnalysis = {
  status: "ready" | "unconfigured" | "unavailable";
  model?: string;
  summary?: string;
  insights?: AgentInsight[];
};
type CheckoutResult = {
  status: "passed" | "failed" | "inconclusive";
  testedAt: string;
  product: string;
  shipping?: {
    routes: {
      label: string;
      zip: string;
      options: { code: string; name: string; priceCents: number; minDays: number | null; maxDays: number | null }[] | null;
    }[];
  };
  steps: {
    label: string;
    status: "passed" | "failed" | "inconclusive" | "not-run";
    detail?: string;
  }[];
};
type Review = { insightId: string; reviewedAt: string };
interface InboxReport {
  dateFrom: string;
  dateTo: string;
  createdAt: string;
  archivedAt?: string | null;
  payload: {
    runId: string;
    previousPeriod?: { dateFrom: string; dateTo: string };
    trigger?: "scheduled" | "manual";
    findings: UpManagerFinding[];
    agent?: AgentAnalysis;
    b2c?: {
      summary: string;
      currency?: string;
      scope?: { commerceConfirmed?: boolean };
      coverage: { stock?: { known: number; total: number } | null; monitorFresh?: boolean; stockObservedAt: string | null; mediaAvailable?: boolean; commerce?: { status: string | null; partial: boolean }; unmatchedActiveAds?: number | null };
      media?: PaidMediaMonitorData & { creativeReview?: CreativeReview };
      product?: { traffic?: ProductTraffic | null; dpa?: DpaCatalog | null };
      cro?: { shipping?: FreightReport | null; current?: { sessions: number } | null; evaluation?: { stages?: FunnelStage[]; payment?: FunnelPayment | null;
        stagesWindow?: { dateFrom: string; dateTo: string }; stagesPreviousWindow?: { dateFrom: string; dateTo: string } } };
      weeklyPlan?: WeeklyPlan | null;
      sectorMemory?: SectorMemory;
    };
  };
  reviews?: Review[];
  checkoutTestAvailable?: boolean;
  checkoutTest?: CheckoutResult | null;
  gradePauseAvailable?: boolean;
  gradeActions?: GradeAdAction[];
  mediaActionsAvailable?: boolean;
  mediaActionBlock?: string | null;
  mediaReactivationAvailable?: boolean;
  mediaActions?: PaidMediaAction[];
  audienceCreationAvailable?: boolean;
  audienceActions?: AudienceAction[];
  creativePauseAvailable?: boolean;
  creativeActions?: CreativeAction[];
}
type InboxItem = {
  id: string;
  title: string;
  problem: string;
  action: string;
  clientDraft?: string;
  verification?: string;
  owner?: string;
  urgency: "now" | "next";
  evidence: Evidence[];
  grade?: Grade;
  diagnosis?: CheckoutDiagnosis;
  focus?: Focus;
};
type Filter = "insights" | "grade" | "creatives" | "reviewed";
const stamp = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});
const showTime = (value: string) => stamp.format(new Date(value));
const showDay = (value: string) => value.split("-").reverse().join("/");
const pageSize = 6;

function fromFinding(item: UpManagerFinding): InboxItem {
  return {
    id: item.id,
    title: item.title,
    problem: item.hypothesis ?? item.evidence,
    urgency: item.priority === "P2" ? "next" : "now",
    action: item.action,
    clientDraft: item.clientDraft,
    verification: item.followUp,
    owner: item.owner,
    evidence: [
      {
        id: item.id,
        label: item.grade ? "Catálogo e campanhas" : "Evidência",
        value: item.evidence,
      },
    ],
    grade: item.grade,
    diagnosis: item.diagnosis,
    focus: item.id === "shipping-price-and-delivery" ? "freight" : item.focus,
  };
}

const freightCurrency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function freightDuration(min: number | null, max: number | null) {
  if (min === null || max === null) return "Prazo indisponível";
  if (min === max) return `${max} ${max === 1 ? "dia útil" : "dias úteis"}`;
  return `${min} a ${max} dias úteis`;
}

const checkoutStatuses = {
  passed: "Confirmado",
  failed: "Falha observada",
  inconclusive: "Inconclusivo",
  "not-run": "Etapa não executada",
};

function CheckoutTest({
  result,
  pending,
  error,
  onTest,
}: {
  result?: CheckoutResult | null;
  pending: boolean;
  error?: string;
  onTest: () => void;
}) {
  return (
    <div className="mt-3 border-t pt-3">
      <Button size="sm" variant="outline" type="button" onClick={onTest} disabled={pending}>
        <FlaskConical className="mr-1.5 size-4" aria-hidden />
        {pending ? "Testando o carrinho…" : "Fazer o teste"}
      </Button>
      <p className="mt-1 text-xs text-muted-foreground">
        Sessão de teste da variante. Termina na primeira tela do checkout.
      </p>
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
      {result && (
        <div className="mt-3 space-y-2" aria-live="polite">
          <p className="text-sm font-semibold">
            {checkoutStatuses[result.status]} · {showTime(result.testedAt)}
          </p>
          <p className="break-words text-xs text-muted-foreground">{result.product}</p>
          <ul className="space-y-1.5 text-sm">
            {result.steps.map(({ label, status, detail }) => (
              <li key={label}>
                <span className="font-medium">{label} · {checkoutStatuses[status]}</span>
                {detail && <p className="text-muted-foreground">{detail}</p>}
              </li>
            ))}
          </ul>
          {result.shipping && (
            <details className="rounded-lg border p-2 text-sm">
              <summary className="cursor-pointer font-medium">Preço e prazo por CEP</summary>
              <dl className="mt-2 grid gap-3">
                {result.shipping.routes.map(({ label, zip, options }) => (
                  <div key={zip}>
                    <dt className="font-medium">{label} · {zip}</dt>
                    <dd className="text-muted-foreground">
                      {options === null ? "Cotação indisponível" : options.length ? (
                        <ul className="mt-1 space-y-0.5">
                          {options.map(({ code, name, priceCents, minDays, maxDays }) => (
                            <li key={code}>{name} · {freightCurrency.format(priceCents / 100)} · {freightDuration(minDays, maxDays)}</li>
                          ))}
                        </ul>
                      ) : "Sem modalidade de entrega"}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function ClientDraft({ draft }: { draft: string }) {
  const [message, setMessage] = useState(draft);
  const [status, setStatus] = useState("");
  return <details className="mt-3 rounded-lg border p-3 text-sm">
    <summary className="cursor-pointer font-medium">Texto para o cliente</summary>
    <textarea aria-label="Rascunho para o cliente" rows={4} value={message} onChange={(event) => { setMessage(event.target.value); setStatus(""); }}
      className="mt-2 w-full rounded-md border bg-background p-2 text-sm" />
    <Button type="button" variant="outline" size="sm" onClick={() => {
      void navigator.clipboard.writeText(message).then(() => setStatus("Texto copiado."), () => setStatus("Selecione e copie o texto."));
    }}>Copiar texto</Button>
    <span className="ml-2 text-xs text-muted-foreground" role="status">{status}</span>
  </details>;
}

function InsightCard({
  item,
  review,
  onReview,
  pending,
  checkoutTest,
  paidMedia,
  freight,
  traffic,
  gradePause,
  onFollow,
  tracked,
  funnel,
}: {
  item: InboxItem;
  review?: Review;
  onReview: () => void;
  pending: boolean;
  checkoutTest?: React.ComponentProps<typeof CheckoutTest>;
  paidMedia?: React.ComponentProps<typeof UpManagerPaidMedia>;
  freight?: FreightReport;
  traffic?: ProductTraffic | null;
  gradePause?: GradePauseRenderer;
  onFollow?: () => void;
  tracked?: boolean;
  funnel?: React.ComponentProps<typeof UpManagerFunnelView>;
}) {
  const grade = item.grade;
  return (
    <article className="flex min-w-0 flex-col rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center gap-1.5">
        {grade ? (
          <Badge
            variant="outline"
            className="gap-1 border-amber-400/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"
          >
            <PackageX className="size-3.5" />{" "}
            {grade.confirmedOutOfStock
              ? "Produto esgotado"
              : "Grade incompleta"}
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className={cn(
              "gap-1",
              item.urgency === "now" &&
                "border-amber-400/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
            )}
          >
            {item.urgency === "now" ? (
              <TriangleAlert className="size-3.5" />
            ) : (
              <CalendarClock className="size-3.5" />
            )}
            {item.urgency === "now" ? "Agir agora" : "Próxima ação"}
          </Badge>
        )}
        {grade?.campaignCount ? (
          <Badge variant="secondary">
            {grade.campaignCount}{" "}
            {grade.campaignCount === 1 ? "anúncio ativo" : "anúncios ativos"}
          </Badge>
        ) : null}
        {!grade && item.focus && (
          <Badge variant="secondary">
            {topics.find(({ id }) => id === item.focus)?.label}
          </Badge>
        )}
        {grade?.leadingProduct && <Badge variant="secondary">Curva A</Badge>}
      </div>
      <h4 className="mt-3 break-words text-xl font-semibold leading-tight tracking-tight">
        {item.title}
      </h4>
      {grade ? (
        <div
          className="mt-3 flex flex-wrap gap-1.5"
          aria-label="Opções sem estoque"
        >
          {grade.missing.slice(0, 6).map((variant) => (
            <Badge key={variant.id} variant="outline" className="font-normal">
              {variant.label}
            </Badge>
          ))}
          {grade.missing.length > 6 && (
            <span className="self-center text-xs text-muted-foreground">
              +{grade.missing.length - 6} opções
            </span>
          )}
        </div>
      ) : (
        <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
          {item.problem}
        </p>
      )}
      {!paidMedia && !funnel && <div className="mt-4 rounded-xl border-l-2 border-primary bg-primary/6 p-3">
        <p className="text-xs font-semibold text-foreground">Próxima ação</p>
        <p className="mt-1 text-sm leading-relaxed">{item.action}</p>
        {checkoutTest && <CheckoutTest {...checkoutTest} />}
      </div>}
      {funnel && <div className="mt-4"><UpManagerFunnelView {...funnel} /></div>}
      {paidMedia && <div className="mt-4 border-t pt-3"><UpManagerPaidMedia {...paidMedia} /></div>}
      {freight && <div className="mt-4 border-t pt-3"><UpManagerFreight report={freight} /></div>}
      {traffic !== undefined && <div className="mt-4"><UpManagerProductTraffic traffic={traffic} gradePause={gradePause} /></div>}
      <ClientDraft key={item.clientDraft ?? item.id} draft={item.clientDraft ?? `Olá! ${item.problem} Nossa próxima proposta é ${item.action}`} />
      {!paidMedia && !freight && !funnel && item.diagnosis && (
        <details className="mt-4 border-t pt-3">
          <summary className="cursor-pointer text-sm font-medium text-primary">
            {item.id === "shipping-price-and-delivery" ? "Preço e prazo observados"
              : item.id === "paid-media-roas" ? "Campanhas, conjuntos e anúncios"
              : "Ver diagnóstico por área"}
          </summary>
          <ul className="mt-2 space-y-2 text-sm leading-relaxed">
            {item.diagnosis.factors.map(({ label, detail }) => (
              <li key={label} className="break-words">
                <span className="font-medium">{label}</span>
                <p className="text-muted-foreground">{detail}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {item.diagnosis.unresolved}
          </p>
        </details>
      )}
      <details className="group mb-4 mt-3 rounded-lg text-sm">
        <summary className="flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-primary [&::-webkit-details-marker]:hidden">
          <ChevronDown className="size-4 -rotate-90 transition-transform group-open:rotate-0" />{" "}
          Ver evidências e conferência
        </summary>
        <dl className="mt-2 space-y-2 rounded-xl border p-3 text-sm">
          {!grade && item.problem.length > 180 && <div>
            <dt className="font-medium">Leitura completa</dt>
            <dd className="break-words text-muted-foreground">{item.problem}</dd>
          </div>}
          {item.evidence.map((row) => (
            <div key={row.id}>
              <dt className="font-medium">{row.label}</dt>
              <dd className="break-words text-muted-foreground">{row.value}</dd>
            </div>
          ))}
          {grade && (
            <div>
              <dt className="font-medium">Opções sem estoque</dt>
              <dd className="text-muted-foreground">
                {grade.missing.map(({ label }) => label).join(", ")}
                {grade.observedAt
                  ? ` · Conferido em ${showTime(grade.observedAt)}`
                  : ""}
              </dd>
            </div>
          )}
          {item.verification && (
            <div>
              <dt className="font-medium">Como conferir</dt>
              <dd className="text-muted-foreground">{item.verification}</dd>
            </div>
          )}
        </dl>
      </details>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        {item.owner && (
          <span className="text-xs text-muted-foreground">{item.owner}</span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
        {tracked ? <Badge variant="secondary">Em acompanhamento</Badge> : onFollow && (
          <Button type="button" size="sm" onClick={onFollow}>Registrar execução</Button>
        )}
        {review ? (
          <Badge
            variant="outline"
            className="gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
            title={showTime(review.reviewedAt)}
          >
            <Check className="size-3.5" />
            Revisado
          </Badge>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={onReview}
            aria-label={`Marcar como revisado: ${item.title}`}
          >
            <Check className="mr-1 size-4" /> Marcar como revisado
          </Button>
        )}
        </div>
      </div>
    </article>
  );
}

export function UpManagerInbox({
  clientId,
  runId,
  processing,
  initialTopic = "all",
}: {
  clientId: string;
  runId: string;
  processing?: boolean;
  initialTopic?: "all" | "campaigns";
}) {
  const [filter, setFilter] = useState<Filter>("insights");
  const [topic, setTopic] = useState<Focus | "all">(initialTopic);
  const [visible, setVisible] = useState(pageSize);
  const [section, setSection] = useState<"decisions" | "weekly" | "followups" | "audiences" | "dpa">("decisions");
  const [selected, setSelected] = useState<string | null>(null);
  const [tracking, setTracking] = useState<DecisionToFollow | null>(null);
  const workflow = useManagerWorkflow(clientId);
  const queryClient = useQueryClient();
  const key = ["up-manager", "report", clientId, runId];
  const endpoint = `/api/up-manager/report/${runId}`;
  const query = `clientId=${encodeURIComponent(clientId)}`;
  const report = useQuery({
    queryKey: key,
    queryFn: () => customFetch<InboxReport>(`${endpoint}?${query}`),
    staleTime: 60_000,
  });
  const gradePause = useUpManagerGradePause({
    clientId, runId, available: report.data?.gradePauseAvailable === true,
    actions: report.data?.gradeActions, mediaActions: report.data?.mediaActions, findings: report.data?.payload.findings,
  });
  const review = useMutation({
    mutationFn: (insightId: string) =>
      customFetch<Review>(`${endpoint}/review?${query}`, {
        method: "POST",
        body: JSON.stringify({ insightId }),
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData<InboxReport>(key, (current) =>
        !current
          ? current
          : {
              ...current,
              reviews: [
                ...(current.reviews ?? []).filter(
                  ({ insightId }) => insightId !== saved.insightId,
                ),
                saved,
              ],
            },
      );
    },
  });
  const testCheckout = useMutation({
    mutationFn: () =>
      customFetch<CheckoutResult>(`${endpoint}/checkout-test?${query}`, { method: "POST" }),
    onSuccess: (checkoutTest) =>
      queryClient.setQueryData<InboxReport>(key, (current) =>
        current ? { ...current, checkoutTest } : current,
      ),
  });
  if (report.isPending) return <UpManagerCardLoader label="Carregando os insights" />;
  if (report.isError)
    return (
      <div role="alert" className="flex items-center gap-3 text-sm">
        Não foi possível abrir o diagnóstico.{" "}
        <Button variant="outline" size="sm" onClick={() => report.refetch()}>
          Tentar novamente
        </Button>
      </div>
    );

  const { payload } = report.data;
  const hasMediaActions = payload.b2c?.media?.roasReview?.rows.some(isMediaDiagnostic) ?? false;
  const visibleDecision = (item: { id: string; focus?: Focus }) => {
    if (item.id === "paid-media-roas") return hasMediaActions;
    if (item.id.startsWith("agent:proposal:")) return true;
    return item.focus !== "campaigns" && !/^(?:campaign-decision|ad-decision):/.test(item.id);
  };
  const reviewed = new Map(
    (report.data.reviews ?? []).map((row) => [row.insightId, row]),
  );
  const drafts = new Map(payload.findings.map(({ id, clientDraft }) => [id, clientDraft]));
  const generated: InboxItem[] =
    payload.agent?.status === "ready"
      ? (payload.agent.insights ?? []).filter(
          (item) => !item.grade && item.id !== "grade-summary" && visibleDecision(item),
        ).map((item) => ({ ...item, focus: item.id === "shipping-price-and-delivery" ? "freight" as const : item.focus,
          clientDraft: drafts.get(item.id) ?? item.evidence.map(({ id }) => drafts.get(id.replace(/^finding:/, ""))).find(Boolean) }))
      : [];
  const findings = payload.findings.map(fromFinding);
  const stock = findings.filter((item) => item.grade);
  const signals = findings.filter(
    (item) => !item.grade && item.id !== "grade-summary" && visibleDecision(item),
  );
  const references = new Set(
    generated.flatMap(({ evidence }) => evidence.map(({ id }) => id)),
  );
  const insights = [...new Map([
    ...generated,
    ...signals.filter(({ id }) => !references.has(`finding:${id}`) ||
      (id === "shipping-price-and-delivery" && !generated.some((item) => item.id === id))),
  ].map((item) => [item.id, item])).values()].sort((a, b) => Number(b.urgency === "now") - Number(a.urgency === "now"));
  const checked = [
    ...new Map(
      [...signals, ...generated].map((item) => [item.id, item]),
    ).values(),
  ].filter((item) => reviewed.has(item.id));
  const queue = insights.filter((item) => !reviewed.has(item.id));
  const stockReviewed = reviewed.has("grade-summary");
  const creativeReview = payload.b2c?.media?.creativeReview;
  const showing =
    filter === "insights"
      ? queue.filter((item) => topic === "all" || item.focus === topic)
      : checked;
  const paidMedia = payload.b2c?.media;
  const freight = payload.b2c?.cro?.shipping;
  const paidMediaControls = {
    clientId, runId, available: report.data.mediaActionsAvailable === true, reactivationAvailable: report.data.mediaReactivationAvailable,
    blockedBySource: report.data.mediaActionBlock, actions: report.data.mediaActions, gradeActions: report.data.gradeActions, gradePause: gradePause.renderAction,
  };
  const availableTopics = topics.filter(({ id }) =>
    queue.some((item) => item.focus === id) || (id === "campaigns" && Boolean(paidMedia?.roasReview)) ||
      (id === "funnel" && Boolean(payload.b2c?.cro?.evaluation?.stages?.length)),
  );
  const showGrade =
    stock.length > 0 &&
    (filter === "grade" ||
      (filter === "reviewed" && stockReviewed) ||
      (filter === "insights" && !stockReviewed && topic === "stock"));
  const tabs = [
    { key: "insights", label: "Fila", count: queue.length, Icon: Sparkles },
    {
      key: "grade",
      label: "Avisos de grade",
      count: stock.length,
      Icon: PackageX,
    },
    {
      key: "creatives",
      label: "Criativos",
      count: creativeReview?.creatives.length ?? 0,
      Icon: Film,
    },
    {
      key: "reviewed",
      label: "Revisados",
      count: checked.length + Number(stockReviewed),
      Icon: Check,
    },
  ] as const;
  const summary = payload.agent?.summary ?? payload.b2c?.summary;
  const rendered = showing.slice(0, visible);
  const active = rendered.find(({ id }) => id === selected) ?? rendered[0];
  const activeTrack = workflow.data?.followups.some(({ runId: origin, insightId }) => origin === runId && insightId === active?.id);
  const urgent = queue.filter(({ urgency }) => urgency === "now").length;
  const currency = payload.b2c?.currency ?? "BRL";
  const coverage = payload.b2c?.coverage;
  const evaluation = payload.b2c?.cro?.evaluation;
  const checkoutTest = report.data.checkoutTestAvailable ? {
    result: report.data.checkoutTest, pending: testCheckout.isPending, error: testCheckout.error?.message,
    onTest: () => testCheckout.mutate(),
  } : undefined;
  const funnel = evaluation?.stages?.length ? {
    stages: evaluation.stages, payment: evaluation.payment, period: evaluation.stagesWindow ?? { dateFrom: report.data.dateFrom, dateTo: report.data.dateTo },
    previous: evaluation.stagesPreviousWindow ?? payload.previousPeriod, checkoutTest: checkoutTest && <CheckoutTest {...checkoutTest} />,
  } : undefined;
  const sources = [
    { label: "Pedidos, CAC e retenção", ready: payload.b2c?.scope?.commerceConfirmed === true, needsMeta: true },
    { label: "Meta e criativos", ready: coverage?.mediaAvailable === true && coverage.monitorFresh !== false },
    { label: "Funil GA4", ready: Boolean(payload.b2c?.cro?.current) },
    { label: "Estoque e grade", ready: Boolean(coverage?.stock && coverage.stock.total > 0 && coverage.stock.known === coverage.stock.total) },
    { label: "Frete por estado", ready: Boolean(freight?.coverage?.current && freight.coverage.previous) },
  ];

  return (
    <section aria-label="Fila do UP Agent" className="space-y-4">
      <UpManagerPipeline sources={sources} agent={payload.agent?.status} model={payload.agent?.model}
        archivedAt={report.data.archivedAt} processing={processing} />
      {payload.b2c?.scope?.commerceConfirmed === false && <p role="status" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
        Fechamento de pedidos pendente. Os dados comerciais são provisórios.
      </p>}
      <details className="group rounded-xl border border-primary/15 bg-primary/6 px-3 py-2.5">
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <span className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5 font-semibold">
              <ChevronDown className="size-3.5 -rotate-90 text-primary group-open:rotate-0" aria-hidden />
              {payload.trigger === "scheduled" ? "Resumo do dia" : "Resumo do diagnóstico"}
            </span>
            <span className="text-muted-foreground">{showDay(report.data.dateTo)} · Atualizado {showTime(report.data.createdAt)}</span>
          </span>
          {summary && <span className="mt-1.5 line-clamp-2 text-sm leading-relaxed group-open:line-clamp-none">{summary}</span>}
        </summary>
        {payload.agent?.status === "unavailable" && <p className="mt-2 text-xs text-muted-foreground">Leitura da OpenAI indisponível nesta rodada. A fila inclui as decisões verificadas por regras.</p>}
      </details>
      <nav className="flex flex-wrap items-center gap-1 rounded-xl border bg-muted/30 p-1.5" aria-label="Operação do Up Manager">
        {([
          { id: "decisions", label: "Decisões", count: queue.length, icon: Sparkles },
          { id: "weekly", label: "Plano semanal", icon: CalendarDays },
          { id: "audiences", label: "Públicos", icon: Users, count: paidMedia?.roasReview?.audienceStudy?.recommendations.length },
          { id: "dpa", label: "Catálogo DPA", icon: Package },
          { id: "followups", label: "Acompanhamento", count: workflow.data?.followups.filter(({ result }) => !result).length, icon: ClipboardCheck },
        ] as const).map(({ id, label, icon: Icon, ...tab }) => (
          <Button key={id} type="button" size="sm" variant={section === id ? "secondary" : "ghost"}
            className="gap-2" aria-pressed={section === id} onClick={() => setSection(id)}>
            <Icon className="size-4" aria-hidden /> {label}
            {"count" in tab && tab.count != null && <span className="text-xs text-muted-foreground">{tab.count}</span>}
          </Button>
        ))}
      </nav>
      {(section === "followups" || section === "weekly") && workflow.isError && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
        As configurações e ações da marca estão indisponíveis.
        <Button size="sm" variant="outline" onClick={() => workflow.refetch()}>Tentar novamente</Button>
      </div>}
      {section === "audiences" && <UpManagerAudiences key={runId} study={paidMedia?.roasReview?.audienceStudy} clientId={clientId}
        runId={runId} currency={currency} canCreate={report.data.audienceCreationAvailable === true} actions={report.data.audienceActions ?? []} />}
      {section === "dpa" && <UpManagerDpa key={clientId} clientId={clientId} data={payload.b2c?.product?.dpa} />}
      {section === "weekly" && <ManagerWeeklyView plan={payload.b2c?.weeklyPlan} data={workflow.data} clientId={clientId} currency={currency} />}
      {section === "followups" && <>
        <ManagerFollowupsView data={workflow.data} lessons={paidMedia?.learning?.lessons} currency={currency} />
        {payload.b2c?.sectorMemory && <UpManagerSectorHistory memory={payload.b2c.sectorMemory} currency={currency} />}
      </>}
      {section === "decisions" && <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="flex flex-wrap gap-1 rounded-xl border bg-muted/35 p-1"
          aria-label="Filtrar insights"
        >
          {tabs.map(({ key, label, count, Icon }) => (
            <Button
              key={key}
              type="button"
              variant={key === filter ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={key === filter}
              className="gap-1.5 rounded-lg"
              onClick={() => {
                setFilter(key);
                setTopic("all");
                setSelected(null);
                setVisible(pageSize);
              }}
            >
              <Icon className="size-4" aria-hidden />
              {label}
              <span className="text-xs tabular-nums text-muted-foreground">
                {count}
              </span>
            </Button>
          ))}
        </div>
        {filter === "insights" && availableTopics.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">Frente
            <select aria-label="Frente do diagnóstico" value={topic}
              className="h-8 rounded-md border bg-background px-2 text-sm text-foreground"
              onChange={(event) => { setTopic(event.target.value as Focus | "all"); setSelected(null); setVisible(pageSize); }}>
              <option value="all">Todas</option>
              {availableTopics.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
        )}
      </div>
      {review.isError && (
        <p className="text-sm text-destructive" role="alert">
          {review.error.message}
        </p>
      )}
      <p className="sr-only" aria-live="polite">
        {review.isSuccess ? "Revisão registrada." : ""}
      </p>
      {showGrade && (
        <UpManagerGradeCard
          items={stock}
          reviewed={stockReviewed}
          pending={review.isPending}
          review={() => review.mutate("grade-summary")}
          gradePause={gradePause.renderAction}
        />
      )}
      {(filter === "grade" || (filter === "insights" && topic === "stock")) && <UpManagerProductTraffic traffic={payload.b2c?.product?.traffic ?? null} gradePause={gradePause.renderAction} />}
      {filter === "insights" && topic === "funnel" && funnel && active?.id !== "funnel-bottleneck" && <UpManagerFunnelView {...funnel} />}
      {filter === "insights" && topic === "campaigns" && paidMedia?.roasReview && !showing.some(({ id }) => id === "paid-media-roas") && (
        <UpManagerPaidMedia review={paidMedia.roasReview} learning={paidMedia.learning} currency={payload.b2c?.currency} controls={paidMediaControls} />
      )}
      {filter === "creatives" &&
        (creativeReview ? (
          <UpManagerCreativeCards
            review={creativeReview}
            clientId={clientId}
            runId={runId}
            currency={payload.b2c?.currency ?? "BRL"}
            canPause={report.data.creativePauseAvailable === true}
            actions={report.data.creativeActions ?? []}
          />
        ) : (
          <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
            A leitura de criativos fica disponível nos novos diagnósticos.
          </p>
        ))}
      {filter === "grade" && !showGrade && (
        <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
          {payload.b2c?.coverage.stockObservedAt
            ? "Nenhuma quebra de grade nesta leitura."
            : "O estoque da loja está sem leitura neste diagnóstico."}
        </p>
      )}
      {(filter === "insights" || filter === "reviewed") && (
        active ? <div className="grid min-w-0 items-start gap-3 xl:grid-cols-[minmax(15rem,0.65fr)_minmax(0,1.7fr)]">
          <section className="min-w-0 overflow-hidden rounded-xl border" aria-label="Lista de decisões">
            <div className="flex flex-wrap items-center justify-between gap-1 border-b bg-muted/35 px-3 py-2.5">
              <h4 className="text-sm font-semibold">{filter === "reviewed" ? "Revisados" : "Decisões para revisar"}</h4>
              {filter === "insights" && topic === "all" && urgent > 0 && <span className="text-xs text-amber-800 dark:text-amber-300">{urgent} para agir agora</span>}
            </div>
            <ul className="max-h-72 divide-y overflow-y-auto xl:max-h-[38rem]">
              {rendered.map((item) => (
                <li key={item.id}>
                  <button type="button" aria-pressed={active.id === item.id}
                    onClick={() => setSelected(item.id)}
                    className={cn("flex w-full items-center gap-2 border-s-[3px] px-3 py-2.5 text-left text-sm hover:bg-muted/45 focus-visible:outline focus-visible:outline-primary",
                      active.id === item.id ? "border-s-primary bg-primary/10" : "border-s-transparent")}>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] text-muted-foreground">
                        {topics.find(({ id }) => id === item.focus)?.label}
                        {item.urgency === "now" && <span className="text-amber-800 dark:text-amber-300"> · Agir agora</span>}
                      </span>
                      <span className="block break-words font-medium">{item.title}</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
            {showing.length > visible && (
              <Button variant="ghost" size="sm" className="m-1" onClick={() => setVisible((value) => value + pageSize)}>
                Mostrar mais · {showing.length - visible}
              </Button>
            )}
          </section>
          <InsightCard
            key={active.id}
            item={active}
            review={reviewed.get(active.id)}
            pending={review.isPending}
            onReview={() => review.mutate(active.id)}
            tracked={activeTrack}
            onFollow={workflow.isSuccess ? () => setTracking(active) : undefined}
            traffic={active.id === "visited-products-grade" ? payload.b2c?.product?.traffic : undefined}
            gradePause={gradePause.renderAction}
            freight={active.id === "shipping-price-and-delivery" && freight?.currentWindow ? freight : undefined}
            paidMedia={active.id === "paid-media-roas" && paidMedia?.roasReview ? {
              review: paidMedia.roasReview, currency: payload.b2c?.currency, controls: paidMediaControls,
            } : undefined}
            funnel={active.id === "funnel-bottleneck" ? funnel : undefined}
            checkoutTest={active.id === "funnel-bottleneck" && !funnel ? checkoutTest : undefined}
          />
        </div> : !showGrade && <p className="rounded-xl border p-4 text-sm text-muted-foreground">
          {filter === "reviewed" ? "Nenhuma decisão revisada neste diagnóstico." : "Nenhuma decisão pendente nesta frente."}
        </p>
      )}
      </>}
      <details className="rounded-xl border p-3">
        <summary className="cursor-pointer text-sm font-medium">Cobertura das análises</summary>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {sources.map(({ label, ready, needsMeta }) => (
            <li key={label} className="flex flex-wrap items-center justify-between gap-1 text-xs">
              <span>{label}</span><Badge variant="outline">{ready ? needsMeta && !coverage?.mediaAvailable ? "CAC indisponível" : "Fonte disponível" : "Cobertura pendente"}</Badge>
            </li>
          ))}
        </ul>
        {coverage?.stock && <p className="mt-2 text-xs text-muted-foreground">{coverage.stock.known} de {coverage.stock.total} variantes com saldo confirmado.</p>}
        {coverage?.unmatchedActiveAds != null && coverage.unmatchedActiveAds > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">{coverage.unmatchedActiveAds} anúncios ativos com vínculo de produto pendente.</p>
        )}
      </details>
      {gradePause.confirmation}
      {tracking && <RegisterManagerFollowup item={tracking} clientId={clientId} runId={runId} onClose={() => setTracking(null)} />}
    </section>
  );
}
