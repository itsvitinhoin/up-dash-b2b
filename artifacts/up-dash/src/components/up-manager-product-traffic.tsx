import { useState } from "react";
import { GradeProductList, GradeProductRow, type GradeLinkedAd, type GradeVariant } from "./up-manager-grade-layout";
import type { GradePauseRenderer } from "./up-manager-grade-pause";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type ProductTraffic = {
  period: { dateFrom: string; dateTo: string };
  catalogAds: number;
  unlinkedViews: number;
  items: { id: string; rank: number; name: string; imageUrl?: string | null; url?: string | null;
    views: number; fromStorefront?: boolean; matchedByName: boolean; status: "complete" | "broken" | "out_of_stock" | "unknown";
    variants: GradeVariant[]; ads: GradeLinkedAd[] }[];
};
const date = (day: string) => day.slice(-5).split("-").reverse().join("/");
const number = new Intl.NumberFormat("pt-BR");
const labels = { complete: "Grade completa", broken: "Grade quebrada", out_of_stock: "Esgotado", unknown: "Saldo incompleto" };

export function UpManagerProductTraffic({ traffic, gradePause }: { traffic: ProductTraffic | null; gradePause?: GradePauseRenderer }) {
  const [showAll, setShowAll] = useState(false);
  if (!traffic) return <p className="rounded-xl border p-3 text-sm text-muted-foreground">Visualizações de produtos indisponíveis no GA4 para este diagnóstico.</p>;
  const affected = traffic.items.filter(({ status }) => status === "broken" || status === "out_of_stock");
  const items = showAll ? traffic.items : affected;
  return <section className="space-y-2 rounded-xl border p-3 sm:p-4" aria-label="Grade dos produtos mais vistos">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><h3 className="font-semibold">Produtos mais vistos no GA4</h3>
        <p className="text-xs text-muted-foreground">{date(traffic.period.dateFrom)} a {date(traffic.period.dateTo)} · {affected.length} com quebra de grade entre {traffic.items.length} produtos identificados na lista.</p></div>
      <Button size="sm" variant="outline" aria-pressed={showAll} onClick={() => setShowAll(!showAll)}>{showAll ? "Só itens com quebra" : "Ver todos os mais vistos"}</Button>
    </div>
    {traffic.catalogAds > 0 && <p className="text-xs text-muted-foreground">{traffic.catalogAds} anúncios de catálogo ativos. Use a lista para conferir SKUs no conjunto de produtos. O GA4 identifica visitas ao item.</p>}
    {items.length ? <GradeProductList>
      {items.map((item) => <GradeProductRow key={item.id} title={item.name} imageUrl={item.imageUrl} productUrl={item.url}
        variants={item.variants} ads={item.ads}
        renderAdAction={gradePause && (item.status === "broken" || item.status === "out_of_stock")
          ? (ad) => gradePause({ id: item.id, name: item.name }, ad) : undefined}
        summary={<>
          <p className="mt-1 text-xs tabular-nums text-muted-foreground">#{item.rank} · {number.format(item.views)} visualizações{item.matchedByName ? " · Vínculo por nome do produto" : ""}</p>
          <Badge variant="outline" className="mt-1">{labels[item.status]}</Badge>
          {item.fromStorefront && <p className="text-xs text-muted-foreground">Saldo consultado na vitrine</p>}
        </>} />)}
    </GradeProductList> : <p className="text-sm text-muted-foreground">{showAll ? "Nenhum item identificado no catálogo." : "Nenhum dos produtos identificados na lista tem quebra confirmada."}</p>}
    {traffic.unlinkedViews > 0 && <p className="text-xs text-muted-foreground">{number.format(traffic.unlinkedViews)} visualizações sem correspondência única no catálogo.</p>}
  </section>;
}
