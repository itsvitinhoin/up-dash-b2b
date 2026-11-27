import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CirclePause, Image, Trophy } from "lucide-react";

interface Metrics {
  spend: number;
  cpa: number | null;
  purchases: number;
  roas: number | null;
  ctr: number | null;
}
interface Recommendation {
  adId: string;
  adName: string;
  adsetName: string;
  current: Metrics;
  previous: Metrics;
  peerCpa: number;
  reason: string;
}
interface Creative {
  key: string;
  name: string;
  campaignName: string;
  current: Metrics | null;
  recommendations: Recommendation[];
  best: boolean;
  imageUrl: string | null;
  activeAds: number;
  dynamic: boolean;
}
export interface CreativeReview {
  available: boolean;
  window: { dateFrom: string; dateTo: string };
  previous: { dateFrom: string; dateTo: string };
  creatives: Creative[];
}
type PauseStatus = "paused" | "stale" | "pending" | "uncertain";
export type CreativeAction = { adId: string; status: PauseStatus };

const statusText: Record<PauseStatus, string> = {
  paused: "Anúncio desativado",
  stale: "A evidência mudou. Gere uma nova análise.",
  pending: "Desativação pendente",
  uncertain: "A Meta ainda não confirmou a desativação.",
};
const formatDay = (day: string) => day.split("-").reverse().join("/");

export function UpManagerCreativeCards({
  review,
  clientId,
  runId,
  currency,
  canPause,
  actions,
}: {
  review: CreativeReview;
  clientId: string;
  runId: string;
  currency: string;
  canPause: boolean;
  actions: CreativeAction[];
}) {
  const [selected, setSelected] = useState<Recommendation | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [limit, setLimit] = useState(6);
  const queryClient = useQueryClient();
  const endpoint = `/api/up-manager/report/${runId}/creative-pause?clientId=${encodeURIComponent(clientId)}`;
  const pause = useMutation({
    mutationFn: (adId: string) =>
      customFetch<{ status: PauseStatus }>(endpoint, {
        method: "POST",
        body: JSON.stringify({ adId, confirm: true }),
      }),
    onSuccess: async () => {
      setSelected(null);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["up-manager", "report", clientId, runId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["up-manager", "decisions", clientId],
        }),
        queryClient.invalidateQueries({ queryKey: ["up-manager", "overview"] }),
      ]);
    },
  });
  const outcomes = new Map(actions.map((item) => [item.adId, item.status]));
  if (pause.variables && pause.data)
    outcomes.set(pause.variables, pause.data.status);
  const winners = review.creatives.filter(
    (item) => item.best || item.recommendations.length,
  );
  const showing = showAll || !winners.length ? review.creatives : winners;
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency });
  const pct = new Intl.NumberFormat("pt-BR", {
    style: "percent",
    maximumFractionDigits: 2,
  });
  const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
  if (!review.available || !review.creatives.length)
    return (
      <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
        Sem leitura comparável dos criativos ativos da Meta neste diagnóstico.
      </p>
    );

  return (
    <section aria-label="Desempenho dos criativos" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold">Desempenho dos criativos</h4>
          <p className="text-sm text-muted-foreground">
            {formatDay(review.window.dateFrom)} a{" "}
            {formatDay(review.window.dateTo)} · {review.creatives.length}{" "}
            criativos ativos avaliados
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            O destaque usa CPA e pelo menos cinco compras atribuídas na
            campanha. A recomendação de pausa compara anúncios do mesmo conjunto
            em duas janelas.
          </p>
        </div>
        {!!winners.length && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setShowAll(!showAll);
              setLimit(6);
            }}
          >
            {showAll ? "Ver destaques" : "Ver todos os criativos"}
          </Button>
        )}
      </div>
      {!review.creatives.some((item) => item.recommendations.length) && (
        <p className="text-sm text-muted-foreground">
          Nenhum anúncio atingiu o critério de desativação nesta leitura.
        </p>
      )}
      <div className="grid gap-3 xl:grid-cols-2">
        {showing.slice(0, limit).map((item) => (
          <article key={item.key} className="rounded-2xl border bg-card p-4">
            <div className="flex gap-3">
              {item.imageUrl ? (
                <img
                  src={item.imageUrl}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="size-14 shrink-0 rounded-lg bg-muted object-cover"
                />
              ) : (
                <span className="grid size-14 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                  <Image className="size-5" />
                </span>
              )}
              <div className="min-w-0">
                <h5 className="break-words font-semibold">{item.name}</h5>
                <p className="text-xs text-muted-foreground">
                  {item.campaignName} · {item.activeAds} anúncio(s)
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {item.best && (
                    <Badge variant="secondary" className="gap-1">
                      <Trophy className="size-3" /> Destaque por CPA
                    </Badge>
                  )}
                  {item.dynamic && (
                    <Badge variant="outline">Criativo dinâmico</Badge>
                  )}
                </div>
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-muted/45 p-2.5 text-sm">
              {[
                [
                  "Gasto",
                  item.current ? money.format(item.current.spend) : "—",
                ],
                [
                  "Compras Meta",
                  item.current ? number.format(item.current.purchases) : "—",
                ],
                [
                  "CPA",
                  item.current?.cpa == null
                    ? "—"
                    : money.format(item.current.cpa),
                ],
                [
                  "ROAS",
                  item.current?.roas == null
                    ? "—"
                    : `${number.format(item.current.roas)}×`,
                ],
                [
                  "CTR",
                  item.current?.ctr == null
                    ? "—"
                    : pct.format(item.current.ctr),
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            {item.recommendations.map((candidate) => {
              const status = outcomes.get(candidate.adId);
              return (
                <div
                  key={candidate.adId}
                  className="mt-3 space-y-2 rounded-xl border border-amber-400/40 bg-amber-500/5 p-3"
                >
                  <p className="text-sm font-semibold">
                    Desativar anúncio · {candidate.adName}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {candidate.reason}
                  </p>
                  {status && (
                    <Badge variant="outline" role="status">
                      {statusText[status]}
                    </Badge>
                  )}
                  {canPause && (!status || status === "stale") && (
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      aria-label={`Desativar anúncio: ${candidate.adName}`}
                      onClick={() => {
                        pause.reset();
                        setSelected(candidate);
                      }}
                    >
                      <CirclePause className="mr-1.5 size-4" /> Desativar
                      anúncio
                    </Button>
                  )}
                </div>
              );
            })}
          </article>
        ))}
      </div>
      {showing.length > limit && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setLimit((value) => value + 6)}
        >
          Ver mais · {showing.length - limit}
        </Button>
      )}
      <AlertDialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open && !pause.isPending) setSelected(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desativar este anúncio?</AlertDialogTitle>
            <AlertDialogDescription>
              {selected?.adName} · {selected?.adsetName}. O Updash reconfirma a
              veiculação e o desempenho antes de pausar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pause.isError && (
            <p role="alert" className="text-sm text-destructive">
              {pause.error.message}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pause.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!selected || pause.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (selected) pause.mutate(selected.adId);
              }}
            >
              {pause.isPending ? "Verificando…" : "Confirmar desativação"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
