import type { AudienceStudy } from "./up-manager-audiences";
import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Minus, Pause, Play, Search, TrendingUp } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { GradeProductList, GradeProductRow, type GradeVariant, type GradeLinkedAd } from "./up-manager-grade-layout";
import type { GradePauseRenderer } from "./up-manager-grade-pause";
import { UpManagerConfirmAction } from "./up-manager-confirm-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { AccountAuctionDetails, CampaignAuctionDetails, type AuctionSeasonality, type CampaignAuction } from "./up-manager-auction";
import type { ReactNode } from "react";

type Level = "campaign" | "adset" | "ad";
type Recommendation = "pause" | "investigate" | "reduce" | "optimize" | "monitor" | "maintain" | "scale" | "reactivate" | "reactivation-blocked" | "unavailable";

type CampaignEvaluation = {
  windows: { days: number; spend: number | null; purchases: number | null; roas: number | null;
    accountRoas: number | null; peerRoas: number | null; cpa: number | null }[];
  inventory: { totalProducts: number; unknownAds: number; coverageDays: number | null; gradeDays: number | null; scaleReady: boolean;
    products: { id: string; name: string; color: string | null; imageUrl?: string | null; grade: "complete" | "broken" | "out_of_stock" | "unknown";
      stock: number | null; units7: number; units14: number; unitsPerDay: number | null; coverageDays: number | null;
      gradeDays: number | null; coverageAtScale: number | null; firstSizeAtRisk: string | null; missing: string[];
      variants?: GradeVariant[]; linkedAds?: GradeLinkedAd[] }[] };
  decision: "maintain" | "investigate" | "scale" | "pause";
  diagnosis?: { factors: { label: string; detail: string }[] };
  breakpoint?: { firstWeakPeriod: string; evidenceThrough: string; before: Dates & { roas: number | null }; after: Dates & { roas: number | null } };
  auction?: CampaignAuction;
  watch?: { kind: "grade" | "recovery" | "decline"; detail: string; action: string };
  destinations?: { host: string; path: string; derived: boolean; source: string }[];
  opportunity: boolean; reason: string; action: string;
};
type MediaRow = {
  id: string;
  level: Level;
  name: string;
  parent: string | null;
  campaignId?: string;
  adsetId?: string;
  recommendation?: Recommendation;
  evaluation?: CampaignEvaluation;
  scaleBudgets?: BudgetAssessment[];
  status: "active" | "inactive" | "unknown";
  spending: MediaMetrics;
  previousSpending?: MediaMetrics | null;
  pauseReason?: "stock" | "performance";
  roas: number | null;
  previousRoas: number | null;
  benchmark: { label: string; roas: number } | null;
  below: boolean;
  signal: "optimize" | "monitor" | "healthy" | "unavailable";
  driver: string;
  action: string;
};

type MediaMetrics = { spend: number; purchases: number };
type Dates = { dateFrom: string; dateTo: string };
type Lesson = {
  id: string; level: Level; name: string; title: string; day: string;
  status: "maturing" | "insufficient" | "improved" | "worsened" | "mixed" | "stable";
  description: string;
  before: { window: Dates; roas: number | null; purchases: number; spend: number } | null;
  after: { window: Dates; roas: number | null; purchases: number; spend: number } | null;
};

export type PaidMediaMonitorData = {
  roasReview?: {
    window: Dates;
    previousWindow: Dates;
    recentWindow?: Dates;
    reference: number | null;
    auctionSeasonality?: AuctionSeasonality;
    agencyBenchmark?: { accounts: number; eligibleAccounts: number; medianRoas: number; window: Dates } | null;
    rows: MediaRow[];
    available: boolean;
    accountPriceComparable: boolean;
    audienceStudy?: AudienceStudy;
    audienceTests?: { name: string; source: string | null; range: string | null; spend: number; purchases: number;
      roas: number; cpa: number; referenceRoas: number; referenceCpa: number; sets: number; action: string }[];
  };
  learning?: { source: "meta" | "partial" | "history" | "unavailable"; lessons: Lesson[] };
};

const outcomes = {
  maturing: "Em maturação", insufficient: "Dados insuficientes", improved: "ROAS melhorou", worsened: "ROAS piorou",
  mixed: "Resultado misto", stable: "ROAS estável",
};
const decisions: Record<Recommendation, { label: string; accent: string; badge: string; order: number }> = {
  pause: { label: "Desativar", accent: "#ef4444", badge: "text-red-700 dark:text-red-300", order: 0 },
  investigate: { label: "Investigar hoje", accent: "#f59e0b", badge: "text-amber-800 dark:text-amber-300", order: 1 },
  reduce: { label: "Reduzir verba", accent: "#f59e0b", badge: "text-amber-800 dark:text-amber-300", order: 1 },
  optimize: { label: "Otimizar", accent: "#f59e0b", badge: "text-amber-800 dark:text-amber-300", order: 2 },
  monitor: { label: "Acompanhar", accent: "#f59e0b", badge: "text-amber-800 dark:text-amber-300", order: 4 },
  scale: { label: "Escalar", accent: "#10b981", badge: "text-emerald-700 dark:text-emerald-300", order: 3 },
  maintain: { label: "Manter", accent: "#64748b", badge: "text-muted-foreground", order: 5 },
  reactivate: { label: "Testar reativação", accent: "#38bdf8", badge: "text-sky-700 dark:text-sky-300", order: 2 },
  "reactivation-blocked": { label: "Reativação bloqueada", accent: "#f59e0b", badge: "text-amber-800 dark:text-amber-300", order: 4 },
  unavailable: { label: "Sem recomendação", accent: "var(--border)", badge: "", order: 6 },
};
const levelLabel = { campaign: "Campanha", adset: "Conjunto", ad: "Anúncio" };
const rawRecommendation = (row: MediaRow): Recommendation =>
  row.recommendation ?? (row.signal === "healthy" ? "maintain" : row.signal);
export const isMediaAction = (row: MediaRow) =>
  (row.status === "active" && (row.recommendation === "pause" || row.recommendation === "scale")) ||
  row.recommendation === "reactivate";
export const isMediaDiagnostic = (row: MediaRow) =>
  isMediaAction(row) || (row.status === "active" && row.recommendation === "investigate") || row.recommendation === "reactivation-blocked" || (row.status === "active" && Boolean(row.evaluation) &&
    (row.level === "campaign" || Boolean(row.evaluation?.opportunity)));
const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR");

type Status = "pending" | "paused" | "stale" | "uncertain" | "applied";
export type PaidMediaAction = { level: Level; id: string; kind: "media-pause" | "media-budget" | "media-reactivate"; status: Status };
type BudgetQuote = {
  ownerId: string; ownerLevel: "campaign" | "adset"; ownerName: string;
  field: "daily_budget" | "lifetime_budget"; before: number; currency: string;
};
type BudgetAssessment = BudgetQuote & { blockers: string[] };
type Controls = {
  clientId: string; runId: string; available: boolean; reactivationAvailable?: boolean;
  actions?: PaidMediaAction[]; gradeActions?: { adId: string; status: Status }[];
  gradePause?: GradePauseRenderer;
  blockedBySource?: string | null;
};
const actionStatus: Record<Status, string> = {
  pending: "Alteração em andamento",
  paused: "Veiculação desativada",
  stale: "Os dados mudaram. Atualize o diagnóstico ou consulte o orçamento novamente.",
  uncertain: "Confirmação pendente na Meta",
  applied: "Aumento já registrado para este orçamento",
};

const number = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = (value: string) => value.slice(5, 10).split("-").reverse().join("/");
const interval = ({ dateFrom, dateTo }: Dates) => `${date(dateFrom)} a ${date(dateTo)}`;

function AssessedBudgets({ assessments, currency }: { assessments: BudgetAssessment[]; currency: string }) {
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency });
  const divisor = 10 ** (money.resolvedOptions().maximumFractionDigits ?? 2);
  return <ul aria-label="Orçamentos avaliados" className="mt-2 space-y-1.5">
    {assessments.map((owner) => <li key={owner.ownerId} className="rounded-lg border px-2.5 py-2 text-xs">
      <p className="font-semibold break-words">{levelLabel[owner.ownerLevel]} · {owner.ownerName}</p>
      <p className="text-muted-foreground">{money.format(owner.before / divisor)}
        {owner.field === "daily_budget" ? " por dia" : " no período total"}</p>
      {owner.blockers.length > 0 && <ul className="mt-1 list-disc space-y-0.5 pl-4 text-amber-800 dark:text-amber-300">
        {owner.blockers.map((reason) => <li key={reason}>{reason}</li>)}
      </ul>}
    </li>)}
  </ul>;
}
const roas = (value: number | null) => value === null ? "—" : `${number.format(value)}×`;

function MediaArea({ label, children }: { label: string; children: ReactNode }) {
  return <details className="min-w-0 rounded-lg border px-3 py-2">
    <summary className="cursor-pointer font-medium">{label}</summary>
    <div className="mt-2 space-y-2">{children}</div>
  </details>;
}

function factorArea(label: string) {
  if (label === "Produtos e estoque") return "stock";
  if (label === "Condições comerciais da loja") return "commerce";
  if (/GA4|página de destino/i.test(label)) return "site";
  if (/^Anúncio|^Alterações/i.test(label)) return "ads";
  return "media";
}

function Factors({ values }: { values: NonNullable<CampaignEvaluation["diagnosis"]>["factors"] }) {
  if (!values.length) return null;
  return <dl className="space-y-2">{values.map(({ label, detail }) => <div key={`${label}:${detail}`}>
    <dt className="font-medium">{label}</dt><dd className="break-words text-muted-foreground">{detail}</dd>
  </div>)}</dl>;
}

function LearningHistory({ learning }: { learning?: PaidMediaMonitorData["learning"] }) {
  if (!learning) return null;
  return (
    <details className="group mt-4 border-t pt-3">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        <ChevronDown className="size-4 -rotate-90 group-open:rotate-0" aria-hidden />
        Ajustes e resultados · {learning.lessons.length}
      </summary>
      <p className="mt-2 text-xs text-muted-foreground">
        Alterações registradas no Meta. Os resultados comparam janelas maduras de sete dias antes e depois.
      </p>
      {(learning.source === "history" || learning.source === "partial") && (
        <p className="mt-2 text-xs text-muted-foreground">
          {learning.source === "history" ? "Alterações preservadas da última leitura disponível." : "Leitura parcial do Meta, com o histórico confirmado preservado."}
        </p>
      )}
      {learning.source === "unavailable" ? (
        <p className="mt-2 text-sm text-muted-foreground">Histórico de alterações do Meta indisponível nesta leitura.</p>
      ) : learning.lessons.length ? (
        <ul className="mt-2 max-h-80 divide-y overflow-y-auto rounded-lg border px-3">
          {learning.lessons.map((lesson) => (
            <li key={`${lesson.level}:${lesson.id}:${lesson.day}:${lesson.title}`} className="py-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <strong className="break-words">{lesson.name}</strong>
                <Badge variant="outline">{outcomes[lesson.status]}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{lesson.title} · {date(lesson.day)}</p>
              {lesson.before && lesson.after && (
                <p className="mt-1 text-xs">
                  {interval(lesson.before.window)} → {interval(lesson.after.window)} · ROAS {roas(lesson.before.roas)} → {roas(lesson.after.roas)} ·
                  {" "}{lesson.before.purchases} → {lesson.after.purchases} compras
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">{lesson.description}</p>
            </li>
          ))}
        </ul>
      ) : <p className="mt-2 text-sm text-muted-foreground">Nenhum ajuste registrado para os itens analisados.</p>}
    </details>
  );
}

function MediaMetric({ label, value, previous, format, higher }: {
  label: string; value: number | null; previous: number | null; format: (value: number | null) => string;
  higher?: boolean;
}) {
  const delta = value === null || previous === null || Math.abs(value - previous) < 0.005
    ? 0 : Math.sign(value - previous);
  const good = higher === undefined ? null : delta > 0 === higher;
  const direction = delta === 0 ? "Estável" : delta > 0 ? "Subiu" : "Caiu";
  const Icon = delta > 0 ? ArrowUp : delta < 0 ? ArrowDown : Minus;
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular-nums">{format(value)}</p>
      <div className={cn("flex items-center gap-0.5 text-[11px] tabular-nums text-muted-foreground",
        delta !== 0 && good === true && "text-emerald-700 dark:text-emerald-300",
        delta !== 0 && good === false && "text-red-700 dark:text-red-300")}>
        {previous !== null && value !== null && <Icon aria-label={direction} className="size-3 shrink-0" />}
        <span aria-label={previous === null ? "Sem dado anterior" : `Anterior ${format(previous)}`}>{format(previous)}</span>
      </div>
    </div>
  );
}

export function UpManagerPaidMedia({ review, learning, currency = "BRL", controls }: {
  review: NonNullable<PaidMediaMonitorData["roasReview"]>;
  learning?: PaidMediaMonitorData["learning"];
  currency?: string;
  controls?: Controls;
}) {
  const [query, setQuery] = useState("");
  const [tone, setTone] = useState<"all" | "red" | "investigate" | "green" | "reactivate" | "maintain">("all");
  const [selected, setSelected] = useState<{ row: MediaRow; kind: PaidMediaAction["kind"] } | null>(null);
  const [percent, setPercent] = useState(15);
  const [ownerId, setOwnerId] = useState("");
  const [results, setResults] = useState<PaidMediaAction[]>([]);
  const queryClient = useQueryClient();
  const call = <T,>(action: string, body: object) =>
    customFetch<T>(`/api/up-manager/report/${controls?.runId}/${action}?clientId=${encodeURIComponent(controls?.clientId ?? "")}`,
      { method: "POST", body: JSON.stringify(body) });
  const quote = useMutation({
    mutationFn: (row: MediaRow) => call<{ options: BudgetQuote[]; blocked?: BudgetAssessment[] }>("media-budget-quote", { level: row.level, id: row.id }),
  });
  const change = useMutation({
    mutationFn: ({ row, kind }: NonNullable<typeof selected>) => {
      if (kind === "media-pause") return call<{ status: Status }>("media-pause", { id: row.id, level: row.level, confirm: true });
      if (kind === "media-reactivate") return call<{ status: Status }>("media-reactivate", { id: row.id, confirm: true });
      if (!budget) throw new Error("Selecione o orçamento da Meta.");
      return call<{ status: Status }>("media-budget", { level: row.level, id: row.id, ownerId: budget.ownerId,
        field: budget.field, before: budget.before, percent, confirm: true });
    },
    onSuccess: ({ status }, { row, kind }) => {
      setResults((previous) => [{ level: row.level, id: row.id, kind, status },
        ...previous.filter((item) => item.level !== row.level || item.id !== row.id)]);
      setSelected(null);
      if (controls) void queryClient.invalidateQueries({ queryKey: ["up-manager", "report", controls.clientId, controls.runId] });
    },
  });
  const money = review.accountPriceComparable ? new Intl.NumberFormat("pt-BR", { style: "currency", currency }) : undefined;
  const price = (value: number | null) => value === null ? "—" : money!.format(value);
  const count = (value: number | null) => value === null ? "—" : new Intl.NumberFormat("pt-BR").format(value);
  const names = new Map(review.rows.map((row) => [`${row.level}:${row.id}`, row.name]));
  const classified = review.rows.filter(isMediaDiagnostic).map((row) => {
    const trail = row.level === "campaign" ? "" : [
      names.get(`campaign:${row.campaignId}`),
      row.level === "ad" ? names.get(`adset:${row.adsetId}`) ?? row.parent : null,
    ].filter(Boolean).join(" / ");
    const recommendation = rawRecommendation(row);
    const rowTone = recommendation === "pause" ? "red" : recommendation === "investigate" ? "investigate" : recommendation === "scale" ? "green" : recommendation === "reactivate" || recommendation === "reactivation-blocked" ? "reactivate" : "maintain";
    return { row, trail, decision: decisions[recommendation], tone: rowTone };
  });
  const filters = [
    { id: "all", label: "Visão geral", count: classified.length },
    { id: "red", label: "Desativar", count: classified.filter((item) => item.tone === "red").length },
    { id: "investigate", label: "Investigar hoje", count: classified.filter((item) => item.tone === "investigate").length },
    { id: "green", label: "Escalar", count: classified.filter((item) => item.tone === "green").length },
    { id: "reactivate", label: "Reativação", count: classified.filter((item) => item.tone === "reactivate").length },
    { id: "maintain", label: "Manter", count: classified.filter((item) => item.tone === "maintain").length },
  ] as const;
  const rows = classified.filter((item) => tone === "all" || item.tone === tone);
  const normalized = normalize(query.trim());
  const visible = rows.filter(({ row, trail }) => normalize(`${row.name} ${trail}`).includes(normalized))
    .sort((a, b) => a.decision.order - b.decision.order || b.row.spending.spend - a.row.spending.spend);
  const thirtyDayRoas = classified.find(({ row }) => row.evaluation)?.row.evaluation?.windows.find(({ days }) => days === 30)?.accountRoas;
  const options = selected?.kind === "media-budget" ? quote.data?.options ?? [] : [];
  const budget = options.length === 1 ? options[0] : options.find((option) => option.ownerId === ownerId);
  const budgetMoney = budget && new Intl.NumberFormat("pt-BR", { style: "currency", currency: budget.currency });
  const divisor = budgetMoney ? 10 ** (budgetMoney.resolvedOptions().maximumFractionDigits ?? 2) : 1;
  const budgetBase = budget ? BigInt(budget.before) : 0n;
  const min = (budgetBase * 115n + 99n) / 100n;
  const max = budgetBase * 120n / 100n;
  const rounded = (budgetBase * BigInt(100 + percent) + 50n) / 100n;
  const after = min <= max && max <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(rounded < min ? min : rounded > max ? max : rounded) : null;
  return (
    <section aria-label="Estrutura de mídia paga" className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1 text-xs text-muted-foreground"><p>
          ROAS médio da conta <strong className="text-foreground">{roas(thirtyDayRoas ?? review.reference)}</strong>
          {thirtyDayRoas != null ? " · últimos 30 dias fechados" : ` · ${interval(review.window)}`}
          {review.recentWindow && ` · Checagem recente ${interval(review.recentWindow)}`}
        </p>{review.agencyBenchmark && <p>
          Mediana B2C da agência <strong className="text-foreground">{roas(review.agencyBenchmark.medianRoas)}</strong> · {review.agencyBenchmark.accounts} contas comparáveis · {interval(review.agencyBenchmark.window)}
        </p>}</div>
        {rows.length > 0 && <label className="relative w-full sm:max-w-60">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input className="h-9 pl-9" aria-label="Buscar campanha, conjunto ou anúncio" placeholder="Buscar na lista"
            value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>}
      </div>
      {review.auctionSeasonality && <AccountAuctionDetails data={review.auctionSeasonality} currency={currency} />}
      {review.available && <div className="flex flex-wrap gap-1.5" aria-label="Filtrar status da mídia">
        {filters.filter(({ id, count }) => id !== "reactivate" || count > 0).map(({ id, label, count }) => (
          <Button key={id} size="sm" variant={tone === id ? "secondary" : "outline"} aria-pressed={tone === id} onClick={() => setTone(id)}
            className={cn("h-8", id === "red" && "text-red-700 dark:text-red-300",
              id === "investigate" && "text-amber-800 dark:text-amber-300",
              id === "green" && "text-emerald-700 dark:text-emerald-300")}>
            {label}<span className="text-[11px] opacity-75">{count}</span>
          </Button>
        ))}
      </div>}
      {review.available && visible.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-xl border" aria-label="Campanhas, conjuntos e anúncios">
          {visible.map(({ row, trail, decision, tone: rowTone }) => {
            const recommendation = rawRecommendation(row);
            const status = [...results, ...controls?.actions ?? []].find((item) => item.id === row.id && item.level === row.level)?.status ??
              (recommendation === "pause" && row.level === "ad" ? controls?.gradeActions?.find(({ adId }) => adId === row.id)?.status : undefined);
            const kind = recommendation === "scale" ? "media-budget"
              : recommendation === "pause" ? "media-pause" : recommendation === "reactivate" ? "media-reactivate" : null;
            const blocked = row.pauseReason === "stock" ? null : controls?.blockedBySource;
            const canAct = !blocked && (kind === "media-reactivate"
              ? controls?.reactivationAvailable ?? controls?.available : controls?.available);
            const evaluation = row.evaluation;
            const recovering = recommendation === "investigate" && evaluation?.auction?.trend === "recovery";
            const evidence = evaluation?.diagnosis?.factors ?? [];
            const factors = (area: ReturnType<typeof factorArea>) => evidence.filter(({ label }) => factorArea(label) === area);
            const prior = row.previousSpending;
            const cpa = row.spending.purchases > 0 ? row.spending.spend / row.spending.purchases : null;
            const previousCpa = prior && prior.purchases > 0 ? prior.spend / prior.purchases : null;
            return (
              <li key={`${row.level}:${row.id}`} data-media-recommendation={recommendation}
                aria-label={`${levelLabel[row.level]} ${row.name}`}
                className="min-w-0 border-s-[3px] px-3 py-3" style={{ borderInlineStartColor: rowTone === "green" ? "#10b981" : decision.accent }}>
                <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                  <div className="min-w-0">
                    <p className="break-words text-[11px] text-muted-foreground">{levelLabel[row.level]}{trail && ` · ${trail}`}</p>
                    <p className="break-words text-sm font-semibold">{row.name}</p>
                    <Badge variant="outline" className={cn("mt-1", decision.badge, rowTone === "green" && "text-emerald-700 dark:text-emerald-300")}>{recommendation === "investigate" && evaluation?.watch?.kind === "grade" ? "Acompanhar grade" : recovering ? "Recuperação em validação" : decision.label}</Badge>
                  </div>
                  {evaluation ? <div className="grid grid-cols-4 gap-1.5" aria-label="ROAS em quatro janelas">
                    {evaluation.windows.map((window) => <div key={window.days} className="min-w-0 rounded-md bg-muted/45 px-1.5 py-1">
                      <p className="text-[11px] text-muted-foreground">{window.days} dias</p>
                      <strong className={cn("text-sm tabular-nums", window.roas !== null && window.accountRoas !== null &&
                        (window.roas < window.accountRoas ? "text-red-700 dark:text-red-300" : window.roas > window.accountRoas ? "text-emerald-700 dark:text-emerald-300" : ""))}>{roas(window.roas)}</strong>
                      <p className="text-[10px] text-muted-foreground tabular-nums">Média {roas(window.accountRoas)}</p>
                      <p className="text-[10px] text-muted-foreground tabular-nums">{count(window.purchases)} compras</p>
                    </div>)}
                  </div> : (
                  <div className={cn("grid gap-2", money ? "grid-cols-4" : "grid-cols-2")}>
                    <MediaMetric label="ROAS" value={row.roas} previous={row.previousRoas} format={roas} higher />
                    <MediaMetric label="Compras" value={row.spending.purchases} previous={prior?.purchases ?? null} format={count} higher />
                    {money && <MediaMetric label="CPA" value={cpa} previous={previousCpa} format={price} higher={false} />}
                    {money && <MediaMetric label="Invest." value={row.spending.spend} previous={prior?.spend ?? null} format={price} />}
                  </div>
                  )}
                </div>
                {evaluation && <p className="mt-2 text-xs">
                  {recommendation === "pause" ? evaluation.reason : evaluation.auction?.summary ?? evaluation.reason}
                </p>}
                {evaluation?.watch && <p className="mt-1 text-xs text-muted-foreground">{evaluation.watch.detail}</p>}
                <p className="mt-2 text-xs font-medium">{row.action}</p>
                {recommendation === "scale" && row.scaleBudgets?.some(({ blockers }) => !blockers.length) &&
                  <p className="mt-1 text-xs text-muted-foreground">Verba em {row.scaleBudgets.filter(({ blockers }) => !blockers.length)
                    .map(({ ownerLevel, ownerName }) => `${levelLabel[ownerLevel].toLowerCase()} · ${ownerName}`).join(" / ")}</p>}
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <details className={cn("min-w-0 text-xs", evaluation && "open:basis-full")}>
                    <summary className="cursor-pointer font-medium text-primary">Ver detalhes por área</summary>
                    <div className="mt-2 space-y-2">
                      <MediaArea label="Mídia e leilão">
                        <p className="max-w-prose text-muted-foreground">{evaluation?.reason ?? row.driver}{!evaluation && row.benchmark && ` Referência de ROAS ${roas(row.benchmark.roas)}.`}</p>
                        {evaluation?.breakpoint && <p className="text-muted-foreground">
                          Primeiro recuo sustentado observado no item em {date(evaluation.breakpoint.firstWeakPeriod)}.
                          ROAS {roas(evaluation.breakpoint.before.roas)} em {interval(evaluation.breakpoint.before)} → {roas(evaluation.breakpoint.after.roas)} em {interval(evaluation.breakpoint.after)}.
                        </p>}
                        {evaluation?.auction && <CampaignAuctionDetails data={evaluation.auction} currency={currency} />}
                        <Factors values={factors("media")} />
                      </MediaArea>
                      {factors("commerce").length > 0 && <MediaArea label="Oferta e frete"><Factors values={factors("commerce")} /></MediaArea>}
                      {factors("ads").length > 0 && <MediaArea label="Anúncios e alterações na Meta"><Factors values={factors("ads")} /></MediaArea>}
                      {(factors("site").length > 0 || !!evaluation?.destinations?.length) && <MediaArea label="Destino e GA4">
                        <Factors values={factors("site")} />
                        <ul className="space-y-1">{evaluation?.destinations?.map(({ host, path, derived, source }) =>
                          /^[a-z0-9.-]+$/i.test(host) && path.startsWith("/") && !path.startsWith("//") &&
                          <li key={`${host}${path}`}><a className="break-all text-primary underline" href={`https://${host}${path}`} target="_blank" rel="noreferrer">
                            {derived ? "Página observada no GA4" : `Abrir ${source} do anúncio`} · {path}
                          </a></li>)}</ul>
                      </MediaArea>}
                      {row.scaleBudgets?.length ? <MediaArea label="Orçamento"><AssessedBudgets assessments={row.scaleBudgets} currency={currency} /></MediaArea> : null}
                      {evaluation && <MediaArea label="Produtos e estoque">
                      <Factors values={factors("stock")} />
                      {evaluation.inventory.unknownAds > 0 && <p className="text-muted-foreground">{evaluation.inventory.unknownAds} anúncio(s) com produto sem vínculo confirmado.</p>}
                      {evaluation.inventory.products.length ? <GradeProductList>
                        {evaluation.inventory.products.map((product) => <GradeProductRow key={product.id}
                          title={product.name} imageUrl={product.imageUrl} variants={product.variants ?? []} ads={product.linkedAds}
                          renderAdAction={product.grade === "broken" || product.grade === "out_of_stock"
                            ? (ad) => controls?.gradePause?.({ id: product.id, name: product.name, variants: product.variants }, ad) : undefined}
                          summary={<>
                            <p className="mt-0.5 text-xs text-muted-foreground">Saldo {count(product.stock)} · Vendas 7d {product.units7} · Vendas 14d {product.units14}
                              {product.unitsPerDay != null && ` · ${number.format(product.unitsPerDay)} un./dia`}</p>
                            <p className="mt-0.5 text-xs">Cobertura estimada {product.coverageDays === null ? "—" : `${number.format(product.coverageDays)} dias`}
                              {product.coverageAtScale !== null && ` · ${number.format(product.coverageAtScale)} dias com giro 20% maior`}</p>
                            {product.gradeDays === 0 && <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300">
                              Grade já incompleta{!product.variants?.length && product.missing.length > 0 && ` · ${product.missing.join(", ")}`}
                            </p>}
                            {product.gradeDays !== null && product.gradeDays > 0 && <p className="mt-0.5 text-xs text-muted-foreground">
                              Próxima quebra estimada em {number.format(product.gradeDays)} dias{product.firstSizeAtRisk && ` · ${product.firstSizeAtRisk}`}
                            </p>}
                          </>}
                        />)}
                      </GradeProductList> : <p className="text-muted-foreground">Estoque sem destino confirmado para este item.</p>}
                      <p className="text-muted-foreground">Projeção pelo maior giro diário entre 7 e 14 dias de vendas da loja.</p>
                    </MediaArea>}
                    </div>
                  </details>
                  {kind && (
                    <Button type="button" size="sm" variant="outline"
                      disabled={!canAct || Boolean(status && status !== "stale")}
                      title={!canAct ? blocked ?? "A ação exige relatório atual, habilitação e permissão do gestor." : undefined}
                      className={cn("h-8", evaluation && "ml-auto", kind === "media-pause" && "border-destructive/40 text-destructive")}
                      onClick={() => {
                        change.reset(); quote.reset(); setPercent(15); setOwnerId("");
                        setSelected({ row, kind });
                        if (kind === "media-budget") quote.mutate(row);
                      }}>
                      {kind === "media-pause" ? <><Pause className="size-3" aria-hidden />{row.level === "campaign" ? "Desativar campanha" : row.level === "adset" ? "Desativar conjunto" : "Desativar anúncio"}</>
                        : kind === "media-reactivate" ? <><Play className="size-3" aria-hidden />Reativar anúncio</>
                          : <><TrendingUp className="size-3" aria-hidden />Escalar verba</>}
                    </Button>
                  )}
                  {kind && blocked && <p className="text-xs text-muted-foreground">{blocked}</p>}
                  {status && <p role="status" className="text-xs text-muted-foreground">{status === "applied" && kind === "media-reactivate" ? "Reativação registrada na Meta" : status === "paused" ? ({ campaign: "Campanha desativada", adset: "Conjunto desativado", ad: "Anúncio desativado" })[row.level] : actionStatus[status]}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {(!review.available || !visible.length) && <p className="text-sm text-muted-foreground">{!review.available
        ? "A leitura das campanhas de venda está indisponível nesta janela."
        : rows.length ? "Nenhuma ação nesta busca." : tone === "all" ? "Nenhum item de mídia com leitura suficiente nesta análise." : "Nenhum item neste filtro."}</p>}
      {Boolean(review.audienceTests?.length) && <section aria-label="Testes de público" className="space-y-2 rounded-xl border p-3">
        <h3 className="text-sm font-semibold">Testes de público</h3>
        {review.audienceTests?.map((test) => <div key={test.name} className="space-y-1 border-t pt-2 text-xs">
          <p className="font-semibold">{test.name}{test.range && ` · ${test.range}`}</p>
          {test.source && <p className="text-muted-foreground">Base {test.source}</p>}
          <p>ROAS {roas(test.roas)} × referência {roas(test.referenceRoas)} · CPA {price(test.cpa)} × referência {price(test.referenceCpa)}</p>
          <p className="text-muted-foreground">{test.purchases} compras · {price(test.spend)} investidos · {test.sets} conjunto(s) · 30 dias fechados</p>
          <p>{test.action}</p>
        </div>)}
      </section>}
      <LearningHistory learning={learning} />
      <UpManagerConfirmAction open={Boolean(selected)} onClose={() => setSelected(null)}
        title={selected?.kind === "media-pause" ? `Desativar ${levelLabel[selected.row.level].toLowerCase()} na Meta` : selected?.kind === "media-reactivate" ? "Reativar anúncio na Meta" : "Aumentar orçamento na Meta"}
        description={selected?.kind === "media-pause"
          ? `${selected.row.name}. A pausa afeta toda a veiculação deste item. O Updash vai revalidar a recomendação na Meta antes de aplicar a mudança.`
          : selected?.kind === "media-reactivate"
            ? `${selected.row.name} voltará a disputar entrega com os outros anúncios do conjunto, com a mesma verba. A grade e o status serão conferidos antes de reativar.`
            : selected ? `A Meta aplica o aumento na campanha ou no conjunto que controla a verba de ${selected.row.name}.` : ""}
        error={change.error?.message ?? quote.error?.message ?? (budget && after === null ? "Este orçamento não permite um aumento entre 15% e 20% na unidade da conta." : undefined)}
        pending={change.isPending}
        disabled={selected?.kind === "media-budget" && (!budget || after === null)}
        destructive={selected?.kind === "media-pause"}
        confirm={selected?.kind === "media-pause" ? "Confirmar desativação" : selected?.kind === "media-reactivate" ? "Confirmar reativação" : "Confirmar aumento"}
        onConfirm={() => { if (selected) change.mutate(selected); }}>
        {selected?.kind === "media-budget" && quote.isPending && <p role="status" className="text-sm">Consultando o orçamento atual na Meta…</p>}
        {selected?.kind === "media-budget" && Boolean(quote.data?.blocked?.length) &&
          <AssessedBudgets assessments={quote.data?.blocked ?? []} currency={currency} />}
        {options.length > 1 && (
          <label className="flex flex-col gap-1 text-sm">Conjunto que recebe o aumento
            <select className="min-w-0 rounded-md border bg-background px-2 py-2" value={ownerId}
              disabled={change.isPending} onChange={(event) => setOwnerId(event.target.value)}>
              <option value="" disabled>Selecione o conjunto</option>
              {options.map((option) => <option key={option.ownerId} value={option.ownerId}>{option.ownerName}</option>)}
            </select>
          </label>
        )}
        {budget && <div className="space-y-3 rounded-lg border p-3 text-sm">
          <p><strong>{levelLabel[budget.ownerLevel]} · {budget.ownerName}</strong></p>
          {budget.ownerId !== selected?.row.id && <p className="text-muted-foreground">O novo orçamento vale para toda a estrutura indicada acima.</p>}
          <label className="flex items-center justify-between gap-3">Aumento
            <select className="rounded-md border bg-background px-2 py-1" value={percent} disabled={change.isPending}
              onChange={(event) => setPercent(Number(event.target.value))}>
              {[15, 16, 17, 18, 19, 20].map((option) => <option key={option} value={option}>{option}%</option>)}
            </select>
          </label>
          <p className="font-semibold tabular-nums">{budgetMoney?.format(budget.before / divisor)} → {after === null ? "—" : budgetMoney?.format(after / divisor)}
            {budget.field === "daily_budget" ? " por dia" : " no período total"}</p>
        </div>}
      </UpManagerConfirmAction>
    </section>
  );
}
