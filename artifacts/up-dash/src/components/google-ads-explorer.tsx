import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, customFetch } from "@workspace/api-client-react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download, ExternalLink, Search } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { exportRowsAsCsv } from "@/lib/csv-export";

type Value = string | number | null;
type Row = Record<string, Value>;
type Column = { key: string; label: string; type: "text" | "number" | "currency" | "percent" | "ratio" };
type InsightResponse = {
  columns: Column[];
  rows: Row[];
  limited: boolean;
  state: "ready" | "unavailable";
  currency: string;
  fetchedAt: string | null;
  source?: { campaign: string; url: string };
};
type Scope = { workspaceId: string; admin: boolean; dateFrom: string; dateTo: string };
type Sort = { key: string; ascending: boolean };

const groups = [
  {
    label: "Pesquisa", views: [
      { id: "keywords", label: "Palavras-chave", detail: "Confira correspondência, custo e conversões por palavra-chave. O índice de qualidade mostra a avaliação atual do Google." },
      { id: "searchTerms", label: "Termos de pesquisa", detail: "Veja o que as pessoas pesquisaram nas campanhas de Pesquisa e Performance Max. O Google limita a exibição de termos de baixo volume e aplica critérios de privacidade." },
    ],
  },
  {
    label: "Concorrência", views: [
      { id: "auction", label: "Participação no leilão", detail: "Compare a participação das suas campanhas nas impressões elegíveis e as perdas por orçamento ou classificação." },
      { id: "auctionDomains", label: "Domínios concorrentes", detail: "Compare a parcela de impressões, a sobreposição e a posição dos anunciantes nos leilões de Pesquisa." },
      { id: "bidding", label: "Orçamentos e lances", detail: "As estratégias, os status e os orçamentos exibem a configuração atual. As métricas respeitam o período selecionado." },
    ],
  },
  {
    label: "Campanhas e criativos", views: [
      { id: "adGroups", label: "Grupos de anúncios", detail: "Compare volume, custo e retorno entre grupos de anúncios." },
      { id: "ads", label: "Anúncios", detail: "Veja quais anúncios e formatos geram cliques, conversões e valor." },
      { id: "assets", label: "Grupos de recursos", detail: "Acompanhe a qualidade dos recursos e o desempenho dos grupos de Performance Max." },
      { id: "products", label: "Produtos do feed", detail: "Analise impressões, custo e resultados por item do Merchant Center nas campanhas compatíveis." },
    ],
  },
  {
    label: "Público e entrega", views: [
      { id: "devices", label: "Dispositivos", detail: "Compare o desempenho em celulares, computadores, tablets e outros dispositivos." },
      { id: "networks", label: "Redes", detail: "Compare a entrega por rede conforme as classificações do Google Ads." },
      { id: "hours", label: "Dias e horários", detail: "Cruze o dia da semana com o horário no fuso da conta." },
      { id: "geography", label: "Localizações", detail: "Compare regiões e países. O Google distingue a presença física do interesse por uma localização." },
      { id: "audiences", label: "Segmentos de público", detail: "Consulte os segmentos de público associados aos grupos de anúncios elegíveis." },
      { id: "age", label: "Faixa etária", detail: "Veja a distribuição de resultados nas faixas etárias disponibilizadas pelo Google." },
      { id: "gender", label: "Gênero", detail: "Veja a distribuição por gênero, incluindo o tráfego em que o Google não identificou essa dimensão." },
      { id: "placements", label: "Locais de exibição", detail: "Veja as impressões em sites, aplicativos e propriedades do Google que aparecem no relatório de Performance Max." },
    ],
  },
  {
    label: "Conversões e destinos", views: [
      { id: "conversions", label: "Ações de conversão", detail: "Compare eventos e valores atribuídos. A coluna Todas as conversões inclui ações secundárias e outras conversões contabilizadas pelo Google." },
      { id: "landingPages", label: "Páginas de destino", detail: "Compare cliques, investimento e resultados por endereço de destino." },
    ],
  },
] as const;
type View = (typeof groups)[number]["views"][number];
const rowsPerPage = 12;
const all = "all";
const activityViews = new Set(["keywords", "bidding", "adGroups", "ads", "assets", "age", "gender", "audiences"]);
const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 2 });
const auctionHelp = "https://support.google.com/google-ads/answer/2579754?hl=pt-BR";
const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

function getErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.data && typeof error.data === "object" && "message" in error.data &&
      typeof error.data.message === "string") return error.data.message;
  return "Não foi possível carregar este recorte.";
}

function display(value: Value, column: Column, money: (value: number) => string) {
  if (typeof value === "string") return value;
  if (typeof value !== "number") return "—";
  if (column.key === "hour") return String(value).padStart(2, "0") + ":00";
  if (column.type === "currency") return money(value);
  if (column.type === "ratio") return number.format(value) + "×";
  if (column.type === "percent") {
    if (["impressionShare", "top", "absoluteTop"].includes(column.key) && value === 0.0999) return "< 10%";
    if (["lostBudget", "lostRank"].includes(column.key) && value === 0.9001) return "> 90%";
    return percent.format(value);
  }
  return number.format(value);
}

function compare(a: Value, b: Value, ascending: boolean) {
  if (a == null) return b == null ? 0 : 1;
  if (b == null) return -1;
  const first = a === "< 10%" ? 0.0999 : a;
  const second = b === "< 10%" ? 0.0999 : b;
  const order = typeof first === "number" && typeof second === "number" ? first - second : collator.compare(String(first), String(second));
  return ascending ? order : -order;
}

function hasActivity(row: Row) {
  return [row.impressions, row.clicks, row.spend, row.conversions].some((value) => typeof value === "number" && value > 0);
}

function withoutConversions(rows: Row[]) {
  return rows.filter((row) => typeof row.spend === "number" && row.spend > 0 && row.conversions === 0);
}

function Opportunity({ rows, money }: { rows: Row[]; money: (value: number) => string }) {
  const spend = rows.reduce((sum, row) => sum + (typeof row.spend === "number" ? row.spend : 0), 0);
  if (!rows.length || spend === 0) return null;
  return (
    <p className="rounded-lg border border-border/70 bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
      <strong className="font-semibold text-foreground">{money(spend)}</strong> investidos em {number.format(rows.length)} {rows.length === 1 ? "linha sem conversão" : "linhas sem conversão"} no recorte consultado.
    </p>
  );
}

function InsightTable({ data, view, scope }: { data: InsightResponse; view: View; scope: Scope }) {
  const id = useId();
  const [campaign, setCampaign] = useState(all);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort | null>(null);
  const [unconverted, setUnconverted] = useState(false);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);
  const { columns, currency } = data;
  const rows = view.id === "auction"
    ? data.rows.filter((row) => columns.some(({ key, type }) => type === "percent" && row[key] != null))
    : data.rows;
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format;
  const activeRows = activityViews.has(view.id) ? rows.filter(hasActivity) : rows;
  const activityFilter = activeRows.length > 0 && activeRows.length < rows.length;
  const canShowOnlyActive = activityFilter && !includeInactive;
  const eligibleRows = canShowOnlyActive ? activeRows : rows;
  const campaigns = Array.from(new Map(eligibleRows.flatMap((row) => {
    return typeof row.campaignId === "string" && typeof row.campaign === "string" ? [[row.campaignId, row.campaign] as const] : [];
  }))).sort((a, b) => collator.compare(a[1], b[1]));
  const canFilterConversions = view.id === "keywords" || view.id === "searchTerms";
  const searchTerm = normalize(search.trim());
  const textColumns = columns.filter((column) => column.type === "text");
  const matches = eligibleRows.filter((row) => {
    return (campaign === all || row.campaignId === campaign) &&
      (!searchTerm || textColumns.some(({ key }) => normalize(String(row[key] ?? "")).includes(searchTerm)));
  });
  const opportunities = canFilterConversions ? withoutConversions(matches) : [];
  let filtered = unconverted ? opportunities : matches;
  if (sort) filtered = [...filtered].sort((a, b) => compare(a[sort.key], b[sort.key], sort.ascending));
  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const activePage = Math.min(page, totalPages);
  const first = (activePage - 1) * rowsPerPage;
  const visible = filtered.slice(first, first + rowsPerPage);
  const onExport = () => exportRowsAsCsv(
    "google-ads-" + view.id + "-" + scope.dateFrom + "-" + scope.dateTo + ".csv",
    filtered,
    columns.map((column) => ({
      header: column.type === "currency" ? column.label + " (" + currency + ")" : column.label,
      accessor: (row: Row) => {
        const value = row[column.key];
        if (column.type === "percent" && typeof value === "number") return display(value, column, money);
        return typeof value === "string" && (/^\s*[=+@-]|^[\t\r\n]/.test(value)) ? "'" + value : value;
      },
    })),
  );
  function changeSort(column: Column) {
    setSort({ key: column.key, ascending: sort?.key === column.key ? !sort.ascending : column.type === "text" });
    setPage(1);
  }
  if (data.state === "unavailable") {
    return <p className="py-4 text-sm text-muted-foreground">O Google Ads não disponibilizou este recorte para a consulta da conta.</p>;
  }
  if (rows.length === 0 && view.id === "auctionDomains") {
    return <p className="py-4 text-sm text-muted-foreground">Este período ainda não tem uma coleta por domínio. Consulte o relatório nativo para escolher outras datas ou campanhas.</p>;
  }
  if (rows.length === 0) {
    return <p className="py-4 text-sm text-muted-foreground">Nenhum dado disponível neste recorte e período.</p>;
  }

  return (
    <div className="space-y-3">
      {canFilterConversions && <Opportunity rows={opportunities} money={money} />}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 flex-1 sm:max-w-72">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden />
          <label className="sr-only" htmlFor={id}>Buscar neste recorte</label>
          <Input id={id} className="h-9 pl-9" placeholder="Buscar neste recorte" value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
        </div>
        {campaigns.length > 1 && (
          <Select value={campaign} onValueChange={(value) => { setCampaign(value); setPage(1); }}>
            <SelectTrigger className="h-9 w-full sm:w-[230px] [&>span]:truncate" aria-label="Filtrar por campanha"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={all}>Todas as campanhas</SelectItem>
              {campaigns.map(([value, name]) => <SelectItem key={value} value={value}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {activityFilter && (
          <Button variant={includeInactive ? "secondary" : "outline"} size="sm" aria-pressed={includeInactive}
            onClick={() => { setIncludeInactive(!includeInactive); setCampaign(all); setPage(1); }}>Incluir linhas sem atividade</Button>
        )}
        {canFilterConversions && (
          <Button variant={unconverted ? "secondary" : "outline"} size="sm" aria-pressed={unconverted}
            onClick={() => { setUnconverted(!unconverted); setPage(1); }}>Investimento sem conversão</Button>
        )}
        <Button className="sm:ml-auto" variant="outline" size="sm" onClick={onExport} disabled={!filtered.length}>
          <Download className="size-4" /> Exportar recorte
        </Button>
      </div>
      {activityViews.has(view.id) && activeRows.length === 0 && <p className="text-xs text-muted-foreground">As linhas disponíveis não registraram atividade neste período.</p>}
      {data.limited && <p className="text-xs text-muted-foreground">Consulta limitada a {number.format(rows.length)} linhas, priorizadas pelo investimento. Use um período menor para detalhar os resultados.</p>}
      {visible.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => {
                const sorted = sort?.key === column.key;
                const Icon = sorted ? sort.ascending ? ArrowUp : ArrowDown : ArrowUpDown;
                return (
                  <TableHead scope="col" key={column.key} aria-sort={sorted ? sort.ascending ? "ascending" : "descending" : undefined}
                    className={column.type === "text" ? "" : "text-right"}>
                    <button onClick={() => changeSort(column)} type="button" className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm text-xs hover:text-foreground focus-visible:outline-ring">
                      {column.label}<Icon className={sorted ? "size-3.5" : "size-3 text-muted-foreground/70"} aria-hidden />
                    </button>
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row, index) => (
              <TableRow key={first + index}>
                {columns.map((column, position) => (
                  <TableCell key={column.key} className={column.type === "text"
                    ? "max-w-72 min-w-24 break-words " + (position === 0 ? "font-medium" : "")
                    : "whitespace-nowrap text-right tabular-nums"}>
                    {display(row[column.key], column, money)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : <p className="py-3 text-sm text-muted-foreground">Nenhum resultado para os filtros aplicados.</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {filtered.length ? number.format(first + 1) + "–" + number.format(first + visible.length) + " de " : ""}{number.format(filtered.length)} {filtered.length === 1 ? "linha" : "linhas"}
        </p>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="size-8" aria-label="Página anterior" disabled={activePage === 1} onClick={() => setPage(activePage - 1)}><ChevronLeft className="size-4" /></Button>
            <span className="text-xs tabular-nums text-muted-foreground">{activePage} / {totalPages}</span>
            <Button variant="outline" size="icon" className="size-8" aria-label="Próxima página" disabled={activePage === totalPages} onClick={() => setPage(activePage + 1)}><ChevronRight className="size-4" /></Button>
          </div>
        )}
      </div>
    </div>
  );
}


function AuctionComparison({ rows }: { rows: Row[] }) {
  const visible = rows.filter((row) => typeof row.domain === "string");
  const mostOverlap = visible.reduce<Row | undefined>((leader, row) => {
    if (typeof row.overlap !== "number") return leader;
    return !leader || row.overlap > Number(leader.overlap) ? row : leader;
  }, undefined);

  return (
    <section aria-label="Resumo da concorrência" className="space-y-2 rounded-lg border bg-muted/25 p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">Parcela de impressões por domínio</p>
        {mostOverlap && <p className="text-xs text-muted-foreground">
          Maior sobreposição: <strong className="text-foreground">{mostOverlap.domain} ({percent.format(Number(mostOverlap.overlap))})</strong>
        </p>}
      </div>
      <ul className="space-y-2">
        {visible.map((row) => {
          const share = row.domainShare;
          return (
            <li key={row.domain} className="grid grid-cols-[minmax(0,1fr)_minmax(4rem,1fr)_4rem] items-center gap-2 text-xs sm:grid-cols-[12rem_minmax(0,1fr)_4rem]">
              <span className="truncate" title={String(row.domain)}>{row.domain}</span>
              <span aria-hidden="true" className="relative h-1.5 overflow-hidden rounded-full bg-muted">
                <span className={"absolute inset-y-0 left-0 rounded-full " + (row.overlap == null ? "bg-primary" : typeof share === "number" ? "bg-primary/55" : "bg-primary/25")}
                  style={{ width: (typeof share === "number" ? 100 * share : 10) + "%" }} />
              </span>
              <span className="text-right font-medium tabular-nums">{typeof share === "number" ? percent.format(share) : share}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function GoogleAdsExplorer({ scope }: { scope: Scope }) {
  const [selected, setSelected] = useState<View>(groups[0].views[0]);
  const group = groups.find(({ views }) => views.some((view) => view.id === selected.id)) ?? groups[0];
  const { workspaceId, dateFrom, dateTo, admin } = scope;
  const query = useQuery({
    queryKey: ["google-ads-insights", workspaceId, dateFrom, dateTo, selected.id],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ dateFrom, dateTo, view: selected.id });
      if (admin) params.set("clientId", workspaceId);
      return customFetch<InsightResponse>("/api/analytics/google-ads/insights?" + params, { signal });
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  return (
    <Card id="google-ads-explorer" className="min-w-0 scroll-mt-24 overflow-hidden" data-testid="google-ads-explorer">
      <CardHeader className="gap-1">
        <CardTitle className="text-base">Explorar Google Ads</CardTitle>
        <CardDescription>Palavras-chave, leilão, criativos, públicos e conversões.</CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        <div role="group" aria-label="Categorias de análise" className="flex flex-wrap gap-1.5 border-b pb-3">
          {groups.map((item) => (
            <Button type="button" key={item.label} variant={item.label === group.label ? "secondary" : "ghost"} size="sm"
              aria-pressed={item.label === group.label} onClick={() => {
                if (item.label !== group.label) setSelected(item.views[0]);
              }}>{item.label}</Button>
          ))}
        </div>
        <div role="group" aria-label={"Recortes de " + group.label.toLowerCase()} className="flex flex-wrap gap-1.5">
          {group.views.map((view) => (
            <Button type="button" key={view.id} size="sm" variant={view.id === selected.id ? "default" : "outline"}
              aria-pressed={view.id === selected.id} onClick={() => setSelected(view)}>{view.label}</Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{selected.detail}</p>
        {selected.id === "auctionDomains" && (
          <Alert>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-0.5">
                {query.data?.source && <p><strong>{query.data.source.campaign}</strong> · {dateFrom.split("-").reverse().join("/")} a {dateTo.split("-").reverse().join("/")}</p>}
                <p className="text-xs text-muted-foreground">Coleta do relatório nativo do Google Ads. Os dados por domínio não são publicados pela API.</p>
              </div>
              <Button asChild variant="outline" size="sm">
                <a href={query.data?.source?.url ?? auctionHelp} target="_blank" rel="noreferrer">
                  {query.data?.source ? "Abrir no Google Ads" : "Como abrir no Google Ads"} <ExternalLink className="size-3.5" />
                </a>
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {query.isPending && <p role="status" className="py-4 text-sm text-muted-foreground">Carregando {selected.label.toLowerCase()}…</p>}
        {query.isError && <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{getErrorMessage(query.error)}</span>
            <Button variant="outline" size="sm" onClick={() => query.refetch()}>Tentar novamente</Button>
          </AlertDescription>
        </Alert>}
        {selected.id === "auctionDomains" && !!query.data?.rows.length && <AuctionComparison rows={query.data.rows} />}
        {query.data && <InsightTable key={selected.id + dateFrom + dateTo} data={query.data} view={selected} scope={scope} />}
      </CardContent>
    </Card>
  );
}
