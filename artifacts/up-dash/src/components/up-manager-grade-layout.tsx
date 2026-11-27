import type { ReactNode } from "react";
import { Megaphone, Package } from "lucide-react";
import { cn } from "@/lib/utils";

export type GradeVariant = {
  id: string;
  label: string;
  color: string | null;
  size: string | null;
  stock: number | null;
  sold14Days?: number;
};

export type GradeLinkedAd = {
  adId: string;
  adName: string;
  campaignName: string;
  adsetName: string;
  affected: boolean;
  pauseEligible?: boolean;
};

const columns = "grid gap-3 lg:grid-cols-[minmax(9rem,1fr)_minmax(13rem,1.25fr)_minmax(11rem,1fr)]";

export function GradeProductList({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 overflow-hidden rounded-xl border">
      <div className={cn(columns, "hidden border-b bg-muted/45 px-3 py-2 text-xs font-medium text-muted-foreground lg:grid")}>
        <span>Produto</span><span>Grade · estoque e vendas em 14 dias</span><span>Anúncios vinculados</span>
      </div>
      <ul className="divide-y">{children}</ul>
    </div>
  );
}

export function GradeVariants({ variants, label = "Tamanhos e estoque" }: { variants: GradeVariant[]; label?: string }) {
  const groups = new Map<string, GradeVariant[]>();
  for (const variant of variants) {
    const color = variant.color || "";
    const group = groups.get(color) ?? [];
    group.push(variant);
    groups.set(color, group);
  }
  return variants.length ? (
    <div className="space-y-2" aria-label={label}>
      {[...groups].map(([color, values]) => (
        <div key={color} className="space-y-1">
          {color && <p className="text-xs font-medium text-muted-foreground">{color}</p>}
          <div className="flex flex-wrap gap-1.5">
            {values.map(({ id, size, label, stock, sold14Days }) => (
              <div key={id} className={cn(
                "min-w-16 rounded-md border px-2 py-1.5 text-center text-xs",
                stock === 0 && "border-destructive/35 bg-destructive/10",
                stock === null && "border-dashed",
              )}>
                <span className={cn("block font-semibold", stock === 0 && "text-destructive line-through decoration-2")}>{size || label}</span>
                <span className="block whitespace-nowrap text-[11px] text-muted-foreground">
                  {stock == null ? "Saldo —" : `Saldo ${stock}`}
                  {sold14Days != null && ` · ${sold14Days} vend.`}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  ) : <p className="text-xs text-muted-foreground">Grade por tamanho indisponível nesta leitura.</p>;
}

export function GradeProductRow({
  title, imageUrl, productUrl, summary, variants, ads, renderAdAction,
}: {
  title: string;
  imageUrl?: string | null;
  productUrl?: string | null;
  summary: ReactNode;
  variants: GradeVariant[];
  ads?: GradeLinkedAd[];
  renderAdAction?: (ad: GradeLinkedAd) => ReactNode;
}) {
  return (
    <li className={cn(columns, "items-start px-3 py-3 text-sm sm:px-4")}>
      <div className="flex min-w-0 items-start gap-2.5">
        {imageUrl
          ? <img className="size-10 shrink-0 rounded-md border object-cover" src={imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
          : <span className="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"><Package className="size-4" aria-hidden /></span>}
        <div className="min-w-0">
          <strong className="break-words">{productUrl && /^https?:\/\//i.test(productUrl)
            ? <a className="underline decoration-primary/50 underline-offset-2 hover:text-primary" href={productUrl} target="_blank" rel="noreferrer">{title}</a>
            : title}</strong>
          {summary}
        </div>
      </div>
      <GradeVariants variants={variants} label="Tamanhos, saldo e vendas por variante" />
      <div aria-label="Anúncios vinculados">
        {ads?.length ? <ul className="space-y-2">
          {ads.map((ad) => (
            <li key={ad.adId} className={cn("rounded-lg border px-2.5 py-2", ad.affected && "border-amber-500/35")}>
              <p className="flex items-start gap-1.5 break-words text-xs font-semibold"><Megaphone className="mt-0.5 size-3.5 shrink-0" aria-hidden />{ad.adName}</p>
              <p className="mt-0.5 break-words text-[11px] text-muted-foreground">{[ad.campaignName, ad.adsetName].filter(Boolean).join(" · ")}</p>
              {renderAdAction?.(ad)}
            </li>
          ))}
        </ul> : <p className="py-1 text-xs text-muted-foreground">{ads ? "Sem anúncio ativo vinculado" : "Vínculos indisponíveis nesta leitura"}</p>}
      </div>
    </li>
  );
}
