import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UpManagerConfirmAction } from "./up-manager-confirm-action";
import type { GradeLine } from "./up-manager-grade-card";
import type { GradeLinkedAd } from "./up-manager-grade-layout";
import type { PaidMediaAction } from "./up-manager-paid-media";

type PauseStatus = "paused" | "stale" | "pending" | "uncertain";
export type GradeAdAction = { adId: string; status: PauseStatus };

const statusText: Record<PauseStatus, string> = {
  paused: "Anúncio desativado",
  stale: "O vínculo, a veiculação ou o estoque mudou. Atualize o diagnóstico.",
  pending: "Desativação em andamento",
  uncertain: "A confirmação da Meta está pendente.",
};
type ProductScope = { id?: string; name: string; variants?: { id: string }[] };
export type GradePauseRenderer = (scope: ProductScope, ad: GradeLinkedAd) => ReactNode;
type Selection = { productId: string; productName: string; ad: GradeLinkedAd };

export function useUpManagerGradePause({
  clientId, runId, available, actions, mediaActions, findings,
}: {
  clientId: string;
  runId: string;
  available: boolean;
  actions?: GradeAdAction[];
  mediaActions?: PaidMediaAction[];
  findings?: GradeLine[];
}) {
  const [selected, setSelected] = useState<Selection | null>(null);
  const queryClient = useQueryClient();
  const pause = useMutation({
    mutationFn: (value: Selection) =>
      customFetch<{ status: PauseStatus }>(`/api/up-manager/report/${runId}/grade-pause?clientId=${encodeURIComponent(clientId)}`, {
        method: "POST",
        body: JSON.stringify({ productId: value.productId, adId: value.ad.adId, confirm: true }),
      }),
    onSuccess: ({ status }, { ad }) => {
      queryClient.setQueryData<{ gradeActions?: GradeAdAction[] }>(["up-manager", "report", clientId, runId], (current) =>
        current ? {
          ...current,
          gradeActions: [...(current.gradeActions ?? []).filter(({ adId }) => adId !== ad.adId), { adId: ad.adId, status }],
        } : current,
      );
      setSelected(null);
      void queryClient.invalidateQueries({ queryKey: ["up-manager", "decisions", clientId] });
    },
  });

  const outcomes = new Map(actions?.map(({ adId, status }) => [adId, status]));
  for (const { id, level, kind, status } of mediaActions ?? []) {
    if (level === "ad" && kind === "media-pause" && status === "paused") outcomes.set(id, status);
  }
  const products = new Map<string, { name: string; ads: Map<string, GradeLinkedAd> }>();
  const variantProducts = new Map<string, string | null>();
  for (const { title, grade } of findings ?? []) {
    if (!grade?.productId || !grade.missing.length || !grade.ads?.length) continue;
    products.set(grade.productId, { name: title, ads: new Map(grade.ads.map((ad) => [ad.adId, ad])) });
    for (const { id } of grade.variants ?? grade.missing) {
      const existing = variantProducts.get(id);
      variantProducts.set(id, existing === undefined || existing === grade.productId ? grade.productId : null);
    }
  }

  const renderAction: GradePauseRenderer = (scope, ad) => {
    const status = outcomes.get(ad.adId);
    const scopedProducts = new Set(scope.variants?.flatMap(({ id }) => {
      const productId = variantProducts.get(id);
      return productId ? [productId] : [];
    }));
    const productId = scope.id && products.has(scope.id)
      ? scope.id : scopedProducts.size === 1 ? [...scopedProducts][0] : undefined;
    const target = productId ? products.get(productId) : undefined;
    const linked = target?.ads.get(ad.adId);
    const disabledReason = !linked || linked.pauseEligible === false || ad.pauseEligible === false
      ? "A pausa exige que a integração confirme o vínculo com o produto e o saldo da grade."
      : !available ? "A desativação exige acesso de administrador e ações de mídia habilitadas." : null;
    return <>
      {status && <p role="status" className="mt-1 text-xs">{statusText[status]}</p>}
      {(!status || status === "stale") && <>
        <Button type="button" variant="outline" size="sm" className="mt-1.5 h-auto min-h-7 border-destructive/40 py-1 text-xs text-destructive"
          disabled={Boolean(disabledReason)}
          aria-label={`Desativar anúncio: ${ad.adName}`}
          onClick={() => {
            if (!productId || !target || !linked || disabledReason) return;
            pause.reset();
            setSelected({ productId, productName: target.name || scope.name, ad: linked });
          }}>
          <Pause className="mr-1 size-3" aria-hidden /> Desativar anúncio
        </Button>
        {disabledReason && <p className="mt-1 text-xs text-muted-foreground">{disabledReason}</p>}
      </>}
    </>;
  };

  return {
    renderAction,
    confirmation: <UpManagerConfirmAction open={Boolean(selected)} onClose={() => setSelected(null)}
      title="Desativar anúncio na Meta" destructive pending={pause.isPending}
      description={selected ? `${selected.ad.adName}, vinculado a ${selected.productName}. A pausa afeta toda a veiculação desse anúncio. O Updash vai conferir o vínculo e a grade antes de aplicar a mudança.` : ""}
      error={pause.error?.message} confirm="Confirmar desativação"
      onConfirm={() => { if (selected) pause.mutate(selected); }} />,
  };
}
