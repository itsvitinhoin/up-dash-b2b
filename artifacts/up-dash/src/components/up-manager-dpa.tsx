import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Package, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GradeVariants, type GradeVariant } from "./up-manager-grade-layout";
import { UpManagerConfirmAction } from "./up-manager-confirm-action";
import { UpManagerCardLoader } from "./up-manager-card-loader";

type Change = { product: string; reason: string; variants: number };
export type DpaCatalog = {
  status: "preview" | "applied" | "unchanged" | "blocked" | "pending";
  checkedAt: string;
  setId?: string;
  eligible?: number;
  unmatched?: number;
  additions?: Change[];
  exclusions?: Change[];
  gradeExcluded?: Change[];
  detail?: string;
};
type CatalogProduct = {
  id: string;
  name: string;
  imageUrl: string | null;
  url: string | null;
  views: number | null;
  outOfStock?: string[];
  variants: (GradeVariant & { inSet: boolean | null })[];
};
type Inventory = {
  setId: string | null;
  setName: string | null;
  membershipAvailable: boolean;
  canRemove?: boolean;
  stockObservedAt: string | null;
  ga4Available: boolean;
  period: { dateFrom: string; dateTo: string };
  products: CatalogProduct[];
};

const statusLabel = {
  preview: "Simulação", applied: "Confirmado na Meta", unchanged: "Sem alterações",
  blocked: "Atualização bloqueada", pending: "Confirmação pendente",
};
const number = new Intl.NumberFormat("pt-BR");
const time = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const date = (day: string) => day.split("-").reverse().join("/");
const term = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();
const pageSize = 30;
const columns = "grid items-start gap-3 lg:grid-cols-[minmax(12rem,1fr)_minmax(16rem,1.65fr)_minmax(8rem,.65fr)]";

function CatalogHistory({ data }: { data: DpaCatalog }) {
  const sections = [
    { label: "Entradas", changes: data.additions },
    { label: "Saídas do conjunto", changes: data.exclusions },
    { label: "Produtos fora por estoque ou publicação", changes: data.gradeExcluded },
  ];
  return <details className="rounded-lg border p-3">
    <summary className="cursor-pointer text-sm font-medium">Movimentações do diagnóstico · {time.format(new Date(data.checkedAt))}</summary>
    <div className="mt-2 space-y-2">
      <Badge variant="outline">{statusLabel[data.status]}</Badge>
      {data.detail && <p className="text-sm text-muted-foreground">{data.detail}</p>}
      {sections.map(({ label, changes }) => changes?.length ? <details key={label} className="rounded-lg border p-2.5">
        <summary className="cursor-pointer text-sm font-medium">{label} · {changes.length}</summary>
        <ul className="mt-2 max-h-72 divide-y overflow-auto">
          {changes.map(({ product, variants, reason }, index) => <li key={`${product}:${index}`} className="flex flex-wrap justify-between gap-1 py-1.5 text-xs">
            <span>{product}</span><span className="text-muted-foreground">{variants} variantes · {reason}</span>
          </li>)}
        </ul>
      </details> : null)}
    </div>
  </details>;
}

function InventoryList({ clientId, inventory }: { clientId: string; inventory: Inventory }) {
  const [scope, setScope] = useState<"set" | "catalog">("set");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(pageSize);
  const [onlyBroken, setOnlyBroken] = useState(false);
  const [selected, setSelected] = useState<CatalogProduct | null>(null);
  const [notice, setNotice] = useState("");
  const queryClient = useQueryClient();
  const removal = useMutation({
    mutationFn: ({ productId, setId }: { productId: string; setId: string }) => customFetch<{ message: string }>(
      `/api/up-manager/dpa-catalog/remove?clientId=${encodeURIComponent(clientId)}`,
      { method: "POST", body: JSON.stringify({ productId, setId, confirm: true }) },
    ),
    onSuccess: ({ message }) => {
      setNotice(message);
      setSelected(null);
      void queryClient.invalidateQueries({ queryKey: ["up-manager", "dpa-catalog", clientId] });
    },
  });
  const hasSet = Boolean(inventory.setId);
  const showingSet = scope === "set" && hasSet;
  const inSet = inventory.products.filter(({ variants }) => variants.some(v => v.inSet === true));
  const list = showingSet ? inSet : inventory.products;
  const broken = list.filter(product => Boolean(product.outOfStock?.length));
  const selectedList = onlyBroken ? broken : list;
  const search = term(query);
  const filtered = search ? selectedList.filter(({ name, variants }) => term(name).includes(search) ||
    variants.some(({ size, color, id }) => [size, color, id].some(value => value && term(value).includes(search)))) : selectedList;

  return <>
    <header>
      <h3 className="text-sm font-semibold">{inventory.setName ?? "Catálogo Meta"}</h3>
      <p className="text-xs text-muted-foreground">
        GA4 · Visualizações de produto de {date(inventory.period.dateFrom)} a {date(inventory.period.dateTo)}
        {inventory.stockObservedAt && ` · Estoque consultado em ${time.format(new Date(inventory.stockObservedAt))}`}
      </p>
    </header>
    {!inventory.membershipAvailable && <p role="status" className="text-xs text-muted-foreground">Vínculo com o conjunto DPA indisponível nesta leitura.</p>}
    {notice && <p role="status" className="rounded-md border px-3 py-2 text-sm">{notice}</p>}
    {!inventory.ga4Available && <p role="status" className="text-xs text-muted-foreground">Visualizações do GA4 indisponíveis para o período.</p>}
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap gap-1.5" aria-label="Filtrar produtos do catálogo">
        {hasSet && <Button variant={showingSet ? "secondary" : "outline"} size="sm" aria-pressed={showingSet}
          onClick={() => { setScope("set"); setLimit(pageSize); }}>No conjunto DPA · {number.format(inSet.length)}</Button>}
        <Button variant={showingSet ? "outline" : "secondary"} size="sm" aria-pressed={!showingSet}
          onClick={() => { setScope("catalog"); setLimit(pageSize); }}>Catálogo Meta completo · {number.format(inventory.products.length)}</Button>
        <Button variant={onlyBroken ? "secondary" : "outline"} size="sm" aria-pressed={onlyBroken}
          onClick={() => { setOnlyBroken(!onlyBroken); setLimit(pageSize); }}>Com quebra de grade · {number.format(broken.length)}</Button>
      </div>
      <div className="relative w-full sm:max-w-64">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
        <Input className="pl-9" aria-label="Buscar produto, tamanho, cor ou ID" placeholder="Buscar produto, tamanho, cor ou ID"
          value={query} onChange={event => { setQuery(event.target.value); setLimit(pageSize); }} />
      </div>
    </div>
    {filtered.length ? <div className="overflow-hidden rounded-lg border">
      <div aria-hidden className={`${columns} hidden bg-muted/45 px-3 py-2 text-xs font-medium text-muted-foreground lg:grid`}>
        <span>Produto</span><span>Grade e estoque</span><span>Visualizações GA4</span>
      </div>
      <ul aria-label="Produtos e tamanhos do catálogo" className="divide-y">
        {filtered.slice(0, limit).map(product => <li key={product.id} className={`${columns} border-t px-3 py-3 text-sm`}>
          <div className="flex min-w-0 items-start gap-2.5">
            {product.imageUrl
              ? <img src={product.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-10 shrink-0 rounded-md border object-cover" />
              : <span className="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"><Package aria-hidden className="size-4" /></span>}
            <div className="min-w-0">
              {product.url
                ? <a href={product.url} target="_blank" rel="noreferrer" className="break-words font-semibold underline decoration-primary/50 underline-offset-2">{product.name}</a>
                : <strong className="break-words">{product.name}</strong>}
              {inventory.membershipAvailable && hasSet && !showingSet && product.variants.some(v => v.inSet) &&
                <p className="mt-1 text-xs text-muted-foreground">No conjunto DPA</p>}
              {Boolean(product.outOfStock?.length) && <Badge variant="outline" className="mt-1 text-destructive">Grade quebrada</Badge>}
              {inventory.canRemove && product.outOfStock?.length && product.variants.some(v => v.inSet) ? (
                <Button type="button" size="sm" variant="outline" className="mt-2 h-7 text-destructive" aria-label={`Retirar do DPA: ${product.name}`}
                  onClick={() => { removal.reset(); setNotice(""); setSelected(product); }}>
                  <X className="size-3.5" aria-hidden /> Retirar do DPA
                </Button>
              ) : null}
            </div>
          </div>
          <GradeVariants variants={product.variants} />
          <div className="flex items-baseline gap-2 lg:block">
            <span className="text-xs text-muted-foreground lg:sr-only">Visualizações GA4</span>
            {product.views === null ? <span className="text-xs text-muted-foreground">{inventory.ga4Available ? "Sem registro vinculado" : "Indisponível"}</span>
              : <strong className="tabular-nums">{number.format(product.views)}</strong>}
          </div>
        </li>)}
      </ul>
    </div> : <p className="rounded-lg border p-3 text-sm text-muted-foreground">{search ? "Nenhum produto encontrado." : "Nenhum produto nesta seleção."}</p>}
    {filtered.length > 0 && <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs tabular-nums text-muted-foreground">{number.format(Math.min(limit, filtered.length))} de {number.format(filtered.length)} produtos</p>
      {limit < filtered.length && <Button size="sm" variant="outline" onClick={() => setLimit(limit + pageSize)}>Mostrar mais</Button>}
    </div>}
    <UpManagerConfirmAction open={Boolean(selected)} title="Retirar produto do conjunto DPA" confirm="Confirmar retirada"
      description={selected ? `${selected.name} · Sem saldo em ${selected.outOfStock?.join(", ")}. Todas as variantes deste produto serão retiradas do conjunto.` : ""}
      pending={removal.isPending} error={removal.error?.message} destructive onClose={() => setSelected(null)}
      onConfirm={() => { if (inventory.setId && selected) removal.mutate({ setId: inventory.setId, productId: selected.id }); }} />
  </>;
}

export function UpManagerDpa({ clientId, data }: { clientId: string; data?: DpaCatalog | null }) {
  const inventory = useQuery({
    queryKey: ["up-manager", "dpa-catalog", clientId],
    queryFn: ({ signal }) => customFetch<Inventory | null>(`/api/up-manager/dpa-catalog?clientId=${encodeURIComponent(clientId)}`, { signal }),
    staleTime: 120_000,
    retry: false,
  });
  return <section aria-label="Catálogo DPA" className="space-y-3 rounded-xl border bg-card p-4">
    {inventory.isPending && <UpManagerCardLoader label="Carregando catálogo DPA" cards={3} />}
    {inventory.isError && <div className="flex flex-wrap items-center justify-between gap-2 text-sm" role="alert">
      Catálogo da Meta indisponível agora.
      <Button variant="outline" size="sm" onClick={() => inventory.refetch()}>Tentar novamente</Button>
    </div>}
    {inventory.data === null && <p className="text-sm text-muted-foreground">Esta marca ainda não tem um catálogo DPA conectado.</p>}
    {inventory.data && <InventoryList clientId={clientId} inventory={inventory.data} />}
    {data && <CatalogHistory data={data} />}
  </section>;
}
