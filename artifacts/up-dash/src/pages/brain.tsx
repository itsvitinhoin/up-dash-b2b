import { useRef, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { BrainCircuit, ChevronLeft, ChevronRight, ClipboardCheck, Database, Filter, Megaphone,
  Package, Search, ShoppingBag, Truck, Users, Waypoints } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { BrainChat, type BrainCitation } from "@/components/brain-chat";
import { UpManagerCardLoader } from "@/components/up-manager-card-loader";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { useUpManagerBrands } from "@/lib/up-manager-pilot";

const branches = [
  { id: "media", name: "Mídia e criativos", icon: Megaphone, x: 22, y: 17 },
  { id: "audiences", name: "Públicos", icon: Users, x: 77, y: 17 },
  { id: "stock", name: "Estoque e grade", icon: Package, x: 16, y: 39 },
  { id: "funnel", name: "Funil", icon: Filter, x: 83, y: 39 },
  { id: "sales", name: "Vendas e retenção", icon: ShoppingBag, x: 17, y: 65 },
  { id: "shipping", name: "Frete", icon: Truck, x: 82, y: 65 },
  { id: "decisions", name: "Decisões e testes", icon: ClipboardCheck, x: 25, y: 86 },
  { id: "knowledge", name: "Skills e memória", icon: Database, x: 75, y: 86 },
] as const;
type Branch = (typeof branches)[number]["id"];

type Entry = { id: string; branch: Branch; title: string; date: string; source: string; summary: string; decision?: string; outcome?: string };
type Run = { id: string; day: string; dateFrom: string; dateTo: string; trigger: "manual" | "scheduled"; createdAt: string; archivedAt: string | null; version: string; summary: string | null };
type Index = { brand: string; runs: Run[]; nextOffset: number | null; history: { total: number; archived: number; oldest: string | null }; audit: Entry[] };
type Detail = { id: string; entries: Entry[]; coverage?: "meta" | "partial" | "history" | "unavailable"; archivedAt?: string | null };

const date = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" });
const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const pretty = (value: string) => (value.includes("T") ? dateTime : date).format(new Date(value.includes("T") ? value : `${value}T12:00:00Z`));
const inBranch = (entry: Entry, branch: Branch) =>
  entry.branch === branch || (branch === "decisions" && entry.source === "UP Dash");
const searchKey = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const coverageText = {
  meta: "Atividades da Meta consultadas", partial: "Leitura parcial das atividades da Meta",
  history: "Atividades recuperadas do histórico", unavailable: "Atividades da Meta indisponíveis nesta leitura",
};

function BrainMap({ active, choose, counts }: {
  active: Branch | "all"; choose: (branch: Branch | "all") => void; counts: Map<Branch, number>;
}) {
  return <section aria-label="Mapa da memória" className="relative isolate mx-auto grid min-h-64 max-w-[700px] grid-cols-2 gap-2 rounded-2xl
    border bg-[radial-gradient(ellipse_at_center,hsl(var(--primary)/.14),transparent_66%)] p-3 sm:block sm:aspect-[3/2] sm:p-0">
    <div className="pointer-events-none absolute inset-0 hidden sm:block" aria-hidden="true">
      {branches.map(({ id, x, y }) => {
        const dx = x - 50;
        const dy = (y - 50) * (2 / 3);
        return <span key={id} className={cn("absolute left-1/2 top-1/2 h-px origin-left transition-colors", active === id ? "bg-primary" : "bg-primary/35")}
          style={{ width: `${Math.hypot(dx, dy)}%`, transform: `rotate(${Math.atan2(dy, dx)}rad)` }} />;
      })}
    </div>
    <button type="button" aria-pressed={active === "all"} onClick={() => choose("all")}
      className="z-10 col-span-2 mx-auto my-2 flex size-24 flex-col items-center justify-center gap-1 rounded-full border border-primary/50
      bg-card text-sm font-semibold shadow-[0_0_35px_hsl(var(--primary)/.24)] transition-colors hover:border-primary
      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:absolute sm:left-1/2 sm:top-1/2 sm:m-0 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:size-28">
      <BrainCircuit className="size-8 text-primary" aria-hidden />Brain
    </button>
    {branches.map(({ id, name, icon: Icon, x, y }) => (
      <button type="button" key={id} onClick={() => choose(id)} aria-pressed={active === id}
        style={{ "--node-x": `${x}%`, "--node-y": `${y}%` } as CSSProperties}
        className={cn("z-10 flex min-h-10 min-w-0 items-center gap-1.5 rounded-xl border bg-card px-2 py-2 text-left text-xs",
          "transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          "sm:absolute sm:left-[var(--node-x)] sm:top-[var(--node-y)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:whitespace-nowrap sm:px-3",
          active === id && "border-primary bg-primary/12")}>
        <Icon className="size-3.5 shrink-0 text-primary" aria-hidden />
        <span className="min-w-0 font-medium">{name}</span>
        <span className="ml-auto tabular-nums text-muted-foreground">{counts.get(id) ?? 0}</span>
      </button>
    ))}
  </section>;
}

function BrainWorkspace({ clientId }: { clientId: string }) {
  const [offset, setOffset] = useState(0);
  const [run, setRun] = useState<string>();
  const [cited, setCited] = useState<BrainCitation>();
  const memorySection = useRef<HTMLDivElement>(null);
  const [branch, setBranch] = useState<Branch | "all">("all");
  const [search, setSearch] = useState("");
  const [visible, setVisible] = useState(12);
  const args = `clientId=${encodeURIComponent(clientId)}`;
  const index = useQuery({
    queryKey: ["up-manager", "brain", clientId, offset],
    queryFn: () => customFetch<Index>(`/api/up-manager/brain?${args}&offset=${offset}`),
    staleTime: 30_000,
    retry: 1,
  });
  const selected = run ?? index.data?.runs[0]?.id;
  const citedOutsidePage = cited && cited.runId === selected && !index.data?.runs.some(({ id }) => id === cited.runId) ? cited : undefined;
  const openSource = (citation: BrainCitation) => {
    setCited(citation);
    setRun(citation.runId);
    setSearch("");
    choose("all");
    memorySection.current?.scrollIntoView({ block: "start" });
  };
  const detail = useQuery({
    queryKey: ["up-manager", "brain", clientId, selected],
    queryFn: () => customFetch<Detail>(`/api/up-manager/brain/${selected!}?${args}`),
    enabled: Boolean(selected),
    staleTime: 60_000,
    retry: 1,
  });

  function choose(value: Branch | "all") {
    setBranch(value);
    setVisible(12);
  }

  if (index.isPending) return <UpManagerCardLoader label="Carregando o histórico do Brain" graph />;
  if (index.isError) return <Card className="p-5">
    <p role="alert" className="text-sm">Não foi possível carregar a memória da marca.</p>
    <Button className="mt-3" variant="outline" size="sm" onClick={() => index.refetch()}>Tentar novamente</Button>
  </Card>;

  const entries = new Map(detail.data?.entries.map((entry) => [entry.id, entry]));
  if (offset === 0 && selected === index.data.runs[0]?.id)
    for (const entry of index.data.audit) entries.set(entry.id, entry);
  const memory = [...entries.values()].sort((a, b) => b.date.localeCompare(a.date));
  const counts = new Map<Branch, number>();
  for (const { id } of branches) counts.set(id, memory.reduce((total, entry) => total + Number(inBranch(entry, id)), 0));
  const sought = searchKey(search.trim());
  const matching = memory.filter((entry) => (branch === "all" || inBranch(entry, branch)) &&
    searchKey([entry.title, entry.summary, entry.source, entry.outcome].filter(Boolean).join(" ")).includes(sought));

  return <div className="mx-auto max-w-[1500px] space-y-4 pb-5" data-testid="up-manager-brain">
    <BrainChat clientId={clientId} brand={index.data.brand} runId={selected} onOpenSource={openSource} />
    <div ref={memorySection} className="scroll-mt-24">
    <Card className="overflow-hidden rounded-2xl">
      <CardHeader className="gap-3 p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="mb-1 text-xs font-medium text-primary">{index.data.brand}</p>
            <CardTitle className="text-xl">Brain</CardTitle>
            <CardDescription>Memória de análises, alterações e resultados da marca.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs">
            <Badge variant="outline">{index.data.history.total} diagnósticos</Badge>
            <Badge variant="outline">{index.data.history.archived} no BigQuery</Badge>
            {index.data.history.oldest && <Badge variant="outline">Desde {pretty(index.data.history.oldest)}</Badge>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
        {selected ? <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
              <span className="shrink-0 text-muted-foreground">Diagnóstico</span>
              <select aria-label="Diagnóstico do Brain" value={selected}
                onChange={(event) => { setRun(event.target.value); setVisible(12); }}
                className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-2 text-xs sm:max-w-sm">
                {citedOutsidePage && <option value={citedOutsidePage.runId}>{pretty(citedOutsidePage.dateTo)} · Citado no chat</option>}
                {index.data.runs.map((item) => <option key={item.id} value={item.id}>
                  {pretty(item.dateTo)} · {item.trigger === "scheduled" ? "Diário" : "Manual"} · {pretty(item.createdAt)}
                </option>)}
              </select>
            </label>
            <div className="flex gap-1" aria-label="Páginas de diagnósticos">
              <Button variant="outline" size="icon" aria-label="Diagnósticos mais recentes" disabled={!offset}
                onClick={() => { setOffset((value) => Math.max(0, value - 20)); setRun(undefined); }}><ChevronLeft className="size-4" /></Button>
              <Button variant="outline" size="icon" aria-label="Diagnósticos mais antigos" disabled={index.data.nextOffset === null}
                onClick={() => { if (index.data.nextOffset !== null) setOffset(index.data.nextOffset); setRun(undefined); }}><ChevronRight className="size-4" /></Button>
            </div>
          </div>
          <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-2">
              <BrainMap active={branch} choose={choose} counts={counts} />
              {detail.data?.coverage && <p className="text-center text-xs text-muted-foreground">{coverageText[detail.data.coverage]}</p>}
            </div>
            <Card className="min-w-0 overflow-hidden rounded-xl">
              <CardHeader className="gap-2 p-3 sm:p-4">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-1.5 text-sm"><Waypoints className="size-4 text-primary" aria-hidden />
                    {branch === "all" ? "Registros da memória" : branches.find(({ id }) => id === branch)?.name}
                  </CardTitle>
                  <Badge variant="outline">{matching.length}</Badge>
                </div>
                <label className="relative block">
                  <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" aria-hidden />
                  <Input aria-label="Buscar na memória" placeholder="Buscar assunto, fonte ou resultado" value={search}
                    onChange={(event) => { setSearch(event.target.value); setVisible(12); }} className="h-9 pl-8 text-xs" />
                </label>
              </CardHeader>
              <CardContent className="space-y-2 p-3 pt-0 sm:p-4 sm:pt-0">
                {detail.isPending ? <UpManagerCardLoader label="Carregando os registros do diagnóstico" cards={2} /> :
                  detail.isError ? <Button variant="outline" size="sm" onClick={() => detail.refetch()}>Tentar carregar registros novamente</Button> :
                  matching.length ? <>
                    <ul className="max-h-[480px] divide-y overflow-y-auto overscroll-contain rounded-lg border xl:max-h-[540px]">
                      {matching.slice(0, visible).map((entry) => <li key={entry.id} className="space-y-1 break-words p-3">
                        <div className="flex flex-wrap items-start justify-between gap-1.5">
                          <strong className="text-xs">{entry.title}</strong>
                          <span className="text-[10px] tabular-nums text-muted-foreground">{pretty(entry.date)}</span>
                        </div>
                        <p className="text-[10px] font-medium text-primary">{entry.source}</p>
                        {entry.summary && <p className="text-xs text-muted-foreground">{entry.summary}</p>}
                        {entry.decision && <p className="text-xs">{entry.decision}</p>}
                        {entry.outcome && <p className="text-xs text-muted-foreground">{entry.outcome}</p>}
                      </li>)}
                    </ul>
                    {matching.length > visible && <Button variant="outline" size="sm" onClick={() => setVisible((value) => value + 12)}>Ver mais registros</Button>}
                  </> : <p className="text-sm text-muted-foreground">Nenhum registro nessa seleção.</p>}
              </CardContent>
            </Card>
          </div>
        </> : <p className="text-sm text-muted-foreground">O Brain recebe os registros da marca após o primeiro diagnóstico.</p>}
      </CardContent>
    </Card>
    </div>
  </div>;
}

export default function BrainPage() {
  const { user, selectedClientId, setSelectedDashboardMode, setSelectedClientId } = useAuth();
  const brands = useUpManagerBrands();
  const clientId = user?.role === "ADMIN" ? selectedClientId : user?.clientId;
  const brand = brands.data?.find(({ id }) => id === clientId);
  if (brands.isPending) return <UpManagerCardLoader label="Carregando as marcas do Brain" graph />;
  if (brand) return <BrainWorkspace key={brand.id} clientId={brand.id} />;
  return <Card className="space-y-3 p-5">
    <CardTitle>Brain</CardTitle>
    <CardDescription>{brands.isError ? "Não foi possível carregar as marcas." : "Selecione a marca para abrir a memória."}</CardDescription>
    {brands.isError ? <Button size="sm" variant="outline" onClick={() => brands.refetch()}>Tentar novamente</Button> :
      <div className="flex flex-wrap gap-2">{brands.data?.map(({ id, name }) => <Button key={id} size="sm" variant="outline" onClick={() => {
        setSelectedDashboardMode("B2C");
        setSelectedClientId(id);
      }}>{name}</Button>)}</div>}
  </Card>;
}
