import { useState } from "react";
import { Check, PackageX, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { GradePauseRenderer } from "./up-manager-grade-pause";
import { GradeProductList, GradeProductRow, type GradeVariant, type GradeLinkedAd } from "./up-manager-grade-layout";

export interface GradeLine {
  id: string;
  title: string;
  grade?: {
    productId?: string;
    imageUrl?: string | null;
    productUrl?: string | null;
    ads?: GradeLinkedAd[];
    missing: { id: string; label: string; sold14Days?: number }[];
    variants?: GradeVariant[];
    stockAvailable?: number;
    confirmedOutOfStock: boolean;
    campaignCount: number;
    leadingProduct: boolean;
  };
}

function priorityDemand(item: GradeLine) {
  const grade = item.grade;
  return grade && (grade.leadingProduct || grade.campaignCount)
    ? grade.missing.reduce((total, variant) => total + (variant.sold14Days ?? 0), 0)
    : 0;
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

export function UpManagerGradeCard({
  items, reviewed, pending, review, gradePause,
}: {
  items: GradeLine[];
  reviewed: boolean;
  pending: boolean;
  review: () => void;
  gradePause: GradePauseRenderer;
}) {
  const [filter, setFilter] = useState<"priority" | "all">("priority");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(12);
  const ordered = [...items].sort((a, b) =>
    priorityDemand(b) - priorityDemand(a) || a.title.localeCompare(b.title),
  );
  const priority = ordered.filter((row) => priorityDemand(row) > 0 || (
    row.grade?.confirmedOutOfStock && row.grade.campaignCount > 0
  ));
  const showingPriority = filter === "priority" && priority.length > 0;
  const visible = showingPriority ? priority : ordered;
  const needle = normalize(query.trim());
  const filtered = needle ? visible.filter((item) =>
    normalize([
      item.title, ...(item.grade?.variants ?? item.grade?.missing ?? []).map(({ label }) => label),
      ...(item.grade?.ads ?? []).map(({ adName, campaignName }) => `${adName} ${campaignName}`),
    ].join(" ")).includes(needle),
  ) : visible;


  return (
    <article aria-label="Quebras de grade e reposição" className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="flex items-center gap-2 text-lg font-semibold">
            <PackageX className="size-5 text-amber-700 dark:text-amber-300" aria-hidden />
            Quebras de grade e reposição
          </h4>
          <p className="mt-1 text-sm text-muted-foreground">{ordered.length} produtos com quebra · {priority.length} prioritários</p>
        </div>
        {reviewed ? <Badge variant="outline" className="gap-1 text-emerald-700 dark:text-emerald-300"><Check className="size-4" aria-hidden /> Revisado</Badge> : (
          <Button variant="outline" size="sm" disabled={pending} onClick={review}><Check className="mr-1 size-4" aria-hidden /> Marcar quebras como revisadas</Button>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1" aria-label="Filtrar quebras de grade">
          {priority.length > 0 && <Button variant={showingPriority ? "secondary" : "ghost"} size="sm"
            aria-pressed={showingPriority} onClick={() => { setFilter("priority"); setLimit(12); }}>Prioritários ({priority.length})</Button>}
          <Button variant={showingPriority ? "ghost" : "secondary"} size="sm" aria-pressed={!showingPriority}
            onClick={() => { setFilter("all"); setLimit(12); }}>Todas as quebras ({ordered.length})</Button>
        </div>
        <label className="relative w-full sm:max-w-64">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input className="pl-9" aria-label="Buscar produto, tamanho ou anúncio" placeholder="Buscar produto, tamanho ou anúncio"
            value={query} onChange={(event) => { setQuery(event.target.value); setLimit(12); }} />
        </label>
      </div>
      {filtered.length ? <GradeProductList>
        {filtered.slice(0, limit).map((item) => {
          const { grade } = item;
          if (!grade) return null;
          const { productId } = grade;
          return <GradeProductRow key={item.id} title={item.title} imageUrl={grade.imageUrl} productUrl={grade.productUrl}
            summary={<>
              <p className="text-xs text-muted-foreground">{grade.missing.length} {grade.missing.length === 1 ? "opção zerada" : "opções zeradas"}{grade.stockAvailable != null ? ` · ${grade.stockAvailable} un. disponíveis` : ""}</p>
              {(grade.leadingProduct || grade.confirmedOutOfStock) && <div className="mt-1 flex flex-wrap gap-1">
                {grade.leadingProduct && <Badge variant="secondary">Curva A</Badge>}
                {grade.confirmedOutOfStock && <Badge variant="outline">Esgotado</Badge>}
              </div>}
            </>}
            variants={grade.variants ?? grade.missing.map((option) => ({ ...option, stock: 0, color: null, size: null }))}
            ads={grade.ads}
            renderAdAction={grade.missing.length ? (ad) => gradePause({ id: productId, name: item.title }, ad) : undefined}
          />;
        })}
      </GradeProductList> : <p className="mt-3 text-sm text-muted-foreground">Nenhum produto nessa busca.</p>}
      {filtered.length > limit && <Button className="mt-3" variant="outline" size="sm" onClick={() => setLimit((value) => value + 12)}>Ver mais · {filtered.length - limit}</Button>}
    </article>
  );
}
