import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  PackageOpen,
  RefreshCw,
  Search,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";

type Grade = "complete" | "broken" | "out_of_stock" | "unknown";
interface Ad {
  id: string;
  name: string;
  campaignName: string;
  adsetName: string;
  spend: number | null;
  impressions: number | null;
  imageUrl: string | null;
}
interface ProductRow {
  id: string;
  productId: string;
  name: string;
  color: string | null;
  scope: "selected_color" | "destination_product";
  imageUrl: string | null;
  productUrl: string;
  grade: Grade;
  unavailable: boolean;
  availableVariants: number;
  variantCount: number;
  missingVariants: string[];
  stock: number | null;
  ads: Ad[];
}
type ReviewDecision = "agree" | "dismiss" | "investigate";
interface ReviewStatus {
  recommendationId: string;
  decision: ReviewDecision;
  reviewedAt: string;
}
interface ReviewEvidence {
  adId: string;
  adName: string;
  campaignName: string;
  adsetName: string;
  productName: string;
  productUrl: string;
  observedAt: { ads: string; stock: string };
  window: { since: string; until: string };
  currency: string;
  timeZone: string;
  impressions: number;
  spend: number | null;
}
interface ReviewPilot {
  recommendations: {
    id: string;
    evidence: ReviewEvidence;
    review: ReviewStatus | null;
  }[];
  history: (ReviewStatus & { evidence: ReviewEvidence })[];
}
interface CheckResponse {
  configured: boolean;
  stale: boolean;
  running: boolean;
  error: string | null;
  checkedAt: string | null;
  attemptedAt: string | null;
  reviewPilot?: ReviewPilot;
  snapshot: null | {
    rows: ProductRow[];
    unidentified: { ad: Ad; reason: string }[];
    totalAds: number;
    identifiedAds: number;
    riskSpend: number | null;
    window: { since: string; until: string };
    currency: string;
    timeZone: string;
    adsObservedAt: string;
    stockObservedAt: string;
    warnings: string[];
  };
}
const REVIEW_ACTIONS: {
  decision: ReviewDecision;
  action: string;
  result: string;
}[] = [
  { decision: "agree", action: "Concordar", result: "Recomendação aceita" },
  { decision: "dismiss", action: "Descartar", result: "Descartada" },
  {
    decision: "investigate",
    action: "Investigar",
    result: "Marcada para investigação",
  },
];
const reviewLabel = (decision: ReviewDecision) =>
  REVIEW_ACTIONS.find((action) => action.decision === decision)?.result;
const GRADES: Record<Grade, { label: string; style: string }> = {
  complete: {
    label: "Grade completa",
    style:
      "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  },
  broken: {
    label: "Grade quebrada",
    style:
      "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  },
  out_of_stock: {
    label: "Esgotado",
    style: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
  },
  unknown: {
    label: "Não verificado",
    style: "bg-muted text-muted-foreground border-border",
  },
};
function timestamp(value: string | null | undefined) {
  return value
    ? new Date(value).toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";
}
function day(value: string) {
  return value.split("-").reverse().join("/");
}
function Thumbnail({ src, name }: { src: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  return src && !failed ? (
    <img
      src={src}
      alt={name}
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-10 w-10 shrink-0 rounded border border-border object-cover"
    />
  ) : (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-border bg-primary/10">
      <PackageOpen className="h-4 w-4 text-primary" />
    </div>
  );
}

export type AgreedPause = { id: string; adName: string; productName: string };

function PauseReviews({
  pilot,
  renderAgreed,
  status,
  suffix,
  clientId,
}: {
  pilot: ReviewPilot;
  renderAgreed?: (item: AgreedPause) => ReactNode;
  status: "ready" | "stale" | "running";
  suffix: string;
  clientId: string | null;
}) {
  const cache = useQueryClient();
  const review = useMutation({
    mutationFn: (input: {
      recommendationId: string;
      decision: ReviewDecision;
    }) =>
      customFetch(`/api/product-campaigns/review${suffix}`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSettled: () =>
      cache.invalidateQueries({ queryKey: ["product-campaigns", clientId] }),
  });

  return (
    <section
      className="space-y-3 rounded-lg border p-4"
      aria-label="Revisão de pausas"
    >
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Revisão de pausas</h3>
        <p className="text-xs text-muted-foreground">
          {renderAgreed
            ? "Revise a evidência e confirme a pausa do anúncio quando fizer sentido."
            : "As decisões são registradas no Updash e ficam disponíveis no Up Manager."}
        </p>
      </div>
      {review.error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{review.error.message}</AlertDescription>
        </Alert>
      )}
      {status === "running" && (
        <p className="text-sm text-muted-foreground">Atualizando evidências.</p>
      )}
      {status === "stale" && (
        <p className="text-sm text-muted-foreground">
          Aguardando evidências atualizadas de estoque e anúncios.
        </p>
      )}
      {status === "ready" && pilot.recommendations.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nenhum anúncio atende aos critérios de revisão nesta análise.
        </p>
      )}
      {status === "ready" &&
        pilot.recommendations.map(({ id, evidence, review: recorded }) => (
          <div key={id} className="space-y-2 rounded-md border bg-muted/20 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">
                {evidence.adName || `Anúncio ${evidence.adId}`}
              </p>
              <Badge variant="outline">
                {recorded ? reviewLabel(recorded.decision) : "Revisar pausa"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {[evidence.campaignName, evidence.adsetName]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <p className="text-sm">
              <a
                className="font-medium underline underline-offset-2"
                href={evidence.productUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {evidence.productName}
              </a>
              {" · Estoque esgotado no destino verificado"}
            </p>
            <p className="text-xs text-muted-foreground">
              {evidence.impressions.toLocaleString("pt-BR")} impressões
              {evidence.spend !== null &&
                ` · ${evidence.spend.toLocaleString("pt-BR", { style: "currency", currency: evidence.currency })} de gasto do anúncio`}
              {` · ${day(evidence.window.since)} a ${day(evidence.window.until)} (${evidence.timeZone})`}
            </p>
            <p className="text-xs text-muted-foreground">
              Estoque consultado em {timestamp(evidence.observedAt.stock)} ·
              Anúncio consultado em {timestamp(evidence.observedAt.ads)}
            </p>
            {recorded ? (
              <>
                <p className="text-xs text-muted-foreground">
                  Decisão registrada em {timestamp(recorded.reviewedAt)}.
                </p>
                {recorded.decision === "agree" &&
                  renderAgreed?.({
                    id,
                    adName: evidence.adName,
                    productName: evidence.productName,
                  })}
              </>
            ) : (
              <div className="flex flex-wrap gap-2">
                {REVIEW_ACTIONS.map(({ decision, action }) => (
                  <Button
                    key={decision}
                    variant="outline"
                    size="sm"
                    disabled={review.isPending}
                    onClick={() =>
                      review.mutate({ recommendationId: id, decision })
                    }
                  >
                    {action}
                  </Button>
                ))}
              </div>
            )}
          </div>
        ))}
      {pilot.history.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">
            Histórico de revisões
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {pilot.history.map(
              ({ recommendationId, evidence, decision, reviewedAt }) => (
                <li key={recommendationId}>
                  {timestamp(reviewedAt)} · {evidence.adName || evidence.adId} ·{" "}
                  {evidence.productName} · {reviewLabel(decision)}
                </li>
              ),
            )}
          </ul>
        </details>
      )}
    </section>
  );
}

export function ProductCampaignMonitor({
  reviewOnly = false,
  renderAgreed,
}: {
  reviewOnly?: boolean;
  renderAgreed?: (item: AgreedPause) => ReactNode;
}) {
  const { selectedClientId, user } = useAuth();
  const clientId = user?.role === "ADMIN" ? selectedClientId : user?.clientId;
  // Remount state when changing clients, so an open dialog never shows another store.
  return (
    <Monitor
      key={clientId ?? "none"}
      clientId={clientId ?? null}
      reviewOnly={reviewOnly}
      renderAgreed={renderAgreed}
    />
  );
}
function Monitor({
  clientId,
  reviewOnly,
  renderAgreed,
}: {
  clientId: string | null;
  reviewOnly: boolean;
  renderAgreed?: (item: AgreedPause) => ReactNode;
}) {
  const cache = useQueryClient();
  const queryKey = ["product-campaigns", clientId];
  const suffix = clientId ? `?clientId=${encodeURIComponent(clientId)}` : "";
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey,
    queryFn: () =>
      customFetch<CheckResponse>(`/api/product-campaigns${suffix}`),
    enabled: Boolean(clientId),
    staleTime: 30_000,
    retry: 1,
    refetchInterval: (query) => (query.state.data?.running ? 3_000 : 60_000),
  });
  const check = useMutation({
    mutationFn: () =>
      customFetch(`/api/product-campaigns/check${suffix}`, { method: "POST" }),
    onSettled: () => cache.invalidateQueries({ queryKey }),
  });
  const snapshot = data?.snapshot;
  const stale = data?.stale ?? true;
  const money = (value: number | null) =>
    value === null
      ? "—"
      : new Intl.NumberFormat("pt-BR", {
          style: "currency",
          currency: snapshot?.currency ?? "BRL",
        }).format(value);
  const rows = snapshot?.rows ?? [];
  const selected = rows.find((row) => row.id === selectedId);
  const visibleRows = rows.filter(
    (row) =>
      `${row.name} ${row.color ?? ""}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()) &&
      (filter === "all" ||
        (filter === "risk"
          ? row.unavailable ||
            row.grade === "broken" ||
            row.grade === "out_of_stock"
          : row.grade === filter)),
  );
  const working = check.isPending || data?.running;
  const summary = [
    { label: "Produtos / cores", value: rows.length },
    {
      label: "Esgotados",
      value: stale
        ? "—"
        : rows.filter((row) => row.grade === "out_of_stock").length,
    },
    {
      label: "Grades quebradas",
      value: stale ? "—" : rows.filter((row) => row.grade === "broken").length,
    },
    {
      label: "Anúncios com produto identificado",
      value: `${snapshot?.identifiedAds ?? 0}/${snapshot?.totalAds ?? 0}`,
    },
  ];

  if (reviewOnly && clientId && data?.reviewPilot) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Estoque e anúncios verificados em {timestamp(data.checkedAt)}.
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={!data.configured || Boolean(working)}
            onClick={() => check.mutate()}
          >
            <RefreshCw
              className={`mr-1.5 size-4 ${working ? "animate-spin" : ""}`}
            />
            {working ? "Analisando…" : "Atualizar estoque e anúncios"}
          </Button>
        </div>
        {(data.error || check.isError) && (
          <p className="text-sm text-destructive" role="alert">
            {data.error ?? "Não foi possível atualizar a análise."}
          </p>
        )}
        <PauseReviews
          pilot={data.reviewPilot}
          clientId={clientId}
          suffix={suffix}
          status={working ? "running" : stale ? "stale" : "ready"}
          renderAgreed={renderAgreed}
        />
      </div>
    );
  }

  if (!clientId || isLoading || (data && !data.reviewPilot)) return null;

  return (
    <Card data-testid="product-campaign-monitor" className="overflow-hidden">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-semibold">
              Produtos em campanha
            </CardTitle>
            <Badge variant="outline" className="text-[10px]">
              Sob demanda
            </Badge>
          </div>
          <CardDescription>
            Disponibilidade dos produtos nos links de anúncios ativos. A cor
            mostrada no criativo ainda não é reconhecida.
          </CardDescription>
          <p className="text-xs text-muted-foreground">
            Última análise: {timestamp(data?.checkedAt)} · Estoque atual,
            independente do filtro de datas acima.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!clientId || !data?.configured || Boolean(working)}
          onClick={() => check.mutate()}
        >
          <RefreshCw
            className={`mr-1.5 h-4 w-4 ${working ? "animate-spin" : ""}`}
          />
          {working ? "Analisando…" : "Analisar agora"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[0, 1, 2, 3].map((key) => (
              <Skeleton key={key} className="h-20" />
            ))}
          </div>
        ) : isError ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              Não foi possível carregar a análise.
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Tentar novamente
              </Button>
            </AlertDescription>
          </Alert>
        ) : !clientId ? (
          <p className="text-sm text-muted-foreground">
            Selecione um cliente B2C.
          </p>
        ) : data && !data.configured ? (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              O monitor precisa de um cliente B2C ativo com Meta Ads e Nuvemshop
              conectados.
            </AlertDescription>
          </Alert>
        ) : null}
        {(data?.error || check.isError) && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {data?.error ??
                "A análise não pôde ser concluída. Tente novamente em instantes."}
            </AlertDescription>
          </Alert>
        )}
        {data?.reviewPilot && (
          <PauseReviews
            pilot={data.reviewPilot}
            status={working ? "running" : stale ? "stale" : "ready"}
            suffix={suffix}
            clientId={clientId}
          />
        )}
        {snapshot && (
          <>
            {stale && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Dados anteriores: a disponibilidade atual não foi verificada.
                  A última análise falhou ou os dados estão desatualizados.
                </AlertDescription>
              </Alert>
            )}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {summary.map((item) => (
                <div
                  key={item.label}
                  className="rounded-lg border border-border bg-muted/20 p-3"
                >
                  <p className="text-[11px] text-muted-foreground">
                    {item.label}
                  </p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
              <p>
                Gasto recente dos anúncios com ruptura:{" "}
                <span className="font-medium text-foreground">
                  {stale ? "—" : money(snapshot.riskSpend)}
                </span>
              </p>
              <p>
                {day(snapshot.window.since)} a {day(snapshot.window.until)} ·{" "}
                {snapshot.timeZone}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              O gasto é do anúncio inteiro, contado uma vez no total. Não
              representa gasto perdido ou atribuição ao produto.
            </p>
            {snapshot.warnings.map((warning) => (
              <Alert key={warning}>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{warning}</AlertDescription>
              </Alert>
            ))}
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  aria-label="Buscar produto em campanha"
                  placeholder="Buscar produto ou cor…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger
                  className="sm:w-48"
                  aria-label="Filtrar disponibilidade"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os produtos</SelectItem>
                  <SelectItem value="risk">Precisam de atenção</SelectItem>
                  <SelectItem value="complete">Grade completa</SelectItem>
                  <SelectItem value="unknown">Não verificados</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {visibleRows.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead>Disponibilidade</TableHead>
                    <TableHead className="text-right">Estoque</TableHead>
                    <TableHead className="text-right">Anúncios</TableHead>
                    <TableHead className="text-right">Detalhes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((row) => {
                    const grade = GRADES[stale ? "unknown" : row.grade];
                    return (
                      <TableRow key={row.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Thumbnail
                              key={row.imageUrl}
                              src={row.imageUrl}
                              name={row.name}
                            />
                            <div>
                              <p className="font-medium">{row.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {row.color ?? "Sem atributo de cor"}
                                {row.scope === "destination_product"
                                  ? " · produto de destino"
                                  : " · cor selecionada no link"}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <Badge variant="outline" className={grade.style}>
                              {grade.label}
                            </Badge>
                            {!stale && row.unavailable && (
                              <p className="text-xs text-red-600 dark:text-red-400">
                                Produto oculto na loja
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground">
                              {stale || row.grade === "unknown"
                                ? "Disponibilidade não confirmada"
                                : `${row.availableVariants}/${row.variantCount} variantes disponíveis`}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {stale ? "—" : (row.stock ?? "—")}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.ads.length}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedId(row.id)}
                            aria-label={`Ver anúncios de ${row.name}${row.color ? ` ${row.color}` : ""}`}
                          >
                            Ver anúncios
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <EmptyState
                icon={snapshot.totalAds ? PackageOpen : CheckCircle2}
                title={
                  snapshot.totalAds
                    ? "Nenhum produto neste filtro"
                    : "Nenhum anúncio ativo confirmado"
                }
                description={
                  snapshot.totalAds
                    ? "Os anúncios sem correspondência ficam listados abaixo."
                    : "A próxima análise diária verificará novos anúncios automaticamente."
                }
              />
            )}
            {snapshot.unidentified.length > 0 && (
              <details className="rounded-lg border border-border p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  Sem correspondência completa{" "}
                  <span className="text-muted-foreground">
                    ({snapshot.unidentified.length}{" "}
                    {snapshot.unidentified.length === 1
                      ? "anúncio"
                      : "anúncios"}
                    )
                  </span>
                </summary>
                <div className="mt-3 space-y-3">
                  {snapshot.unidentified.map(({ ad, reason }) => (
                    <div key={ad.id} className="border-t border-border pt-3">
                      <p className="text-sm font-medium">{ad.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {ad.campaignName}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {reason}
                      </p>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
        {!isLoading && !isError && data?.configured && !snapshot && (
          <EmptyState
            icon={PackageOpen}
            title={
              working
                ? "Primeira análise em andamento"
                : "Aguardando a primeira análise"
            }
            description="Use Analisar agora para verificar anúncios e estoque."
          />
        )}
      </CardContent>
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{selected?.name}</DialogTitle>
            <DialogDescription>
              {selected?.color ?? "Produto de destino"} · Anúncios vinculados
              automaticamente pelo link.
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <p className="text-sm">
                {stale
                  ? "Estoque atual não verificado."
                  : selected.grade === "unknown"
                    ? "Estoque sem controle ou informação suficiente."
                    : selected.missingVariants.length
                      ? `Sem estoque: ${selected.missingVariants.join(", ")}.`
                      : "Todas as variantes cadastradas deste grupo estão disponíveis."}
              </p>
              <p className="text-xs text-muted-foreground">
                Estoque consultado: {timestamp(snapshot?.stockObservedAt)}.
                Anúncios consultados: {timestamp(snapshot?.adsObservedAt)}.
              </p>
              {selected.scope === "destination_product" && (
                <p className="text-xs text-muted-foreground">
                  O link aponta para este produto. A cor exibida na imagem ou no
                  vídeo não foi confirmada.
                </p>
              )}
              <Button variant="outline" size="sm" asChild>
                <a
                  href={selected.productUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Abrir produto
                  <ExternalLink className="ml-2 h-3.5 w-3.5" />
                </a>
              </Button>
              {selected.ads.map((ad) => (
                <div
                  key={ad.id}
                  className="rounded-lg border border-border p-3"
                >
                  <div className="flex gap-3">
                    <Thumbnail
                      key={ad.imageUrl}
                      src={ad.imageUrl}
                      name={ad.name}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{ad.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {ad.campaignName} · {ad.adsetName}
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Gasto do anúncio: {money(ad.spend)} ·{" "}
                    {ad.impressions === null
                      ? "Entrega não verificada"
                      : ad.impressions > 0
                        ? "Teve entrega no período"
                        : "Sem entrega no período"}
                  </p>
                  <a
                    className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    href={`https://adsmanager.facebook.com/adsmanager/manage/ads?selected_ad_ids=${encodeURIComponent(ad.id)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Abrir no Meta
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
