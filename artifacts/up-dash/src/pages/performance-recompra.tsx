// Submenu Performance > Recompra — ver "00 - Especificação técnica.pdf"
// (v1.0, 07/09/2026) pra regras de dados completas.
//
// Começou como FASE VISUAL (achado 11/09/2026, mock estático reconciliando
// com as regras do PDF). Fases 1-4 ligaram Blocos 1-4/Detalhamento/
// Vendedoras/filtros a dado real (ver plano salvo, "greedy-fluttering-
// cupcake"). Fase 5 (23/09/2026) ligou os 3 gráficos mensais, "Intervalo
// entre compras", Coorte e Funil de retenção -- nada mock resta na página.
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import {
  addMonths,
  differenceInDays,
  format,
  isSameDay,
  startOfDay,
  startOfMonth,
  subDays,
  subMonths,
} from "date-fns";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowUpDown,
  Calendar as CalendarIcon,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Download,
  Hourglass,
  Receipt,
  RotateCcw,
  Search,
  ShoppingBag,
  Timer,
  UserCheck,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PeriodCalendarCard } from "@/components/ui/period-calendar-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrencySmart, formatNumber, formatPercentage } from "@/lib/formatters";

// Rótulo curto de mês PARA OS 3 GRÁFICOS MENSAIS reais (Fase 5) -- ao
// contrário do mock antigo (só "Fev"), leva o ano ("Fev/26") de propósito:
// a janela é sempre os últimos 12 meses corridos até hoje, então cruza
// ano-calendário (ex: Out/2025 → Set/2026) -- sem o ano, dois meses de
// anos diferentes ficam ambíguos no eixo X.
const MONTH_ABBREV = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-");
  const idx = Number(month) - 1;
  return `${MONTH_ABBREV[idx] ?? month}/${(year ?? "").slice(2)}`;
}
function formatCohortMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-");
  const idx = Number(month) - 1;
  return `${MONTH_ABBREV[idx] ?? month}/${year}`;
}

type DetailRow = {
  cliente: string;
  dataEvento: string;
  diasDesde: number;
  tipo: "Recorrente" | "Reativação";
  vendedora: string;
  origem: string;
  fechamento: string;
  faturamento: number;
  codigoPedido: string;
  documento: string;
  uf: string;
  cidade: string;
  email: string;
  telefone: string;
  ultimaCompraAnterior: string;
  itens: Array<{ nome: string; variante: string; qtd: number; valorUnitario: number }>;
};

// Achado 11/09/2026: mockups mais recentes usam 2 tons só em TODO gráfico
// (barra escura = série principal, linha/barra clara = secundária) — antes
// cada gráfico tinha uma cor própria (verde/violeta/laranja), inconsistente
// entre si. Padroniza aqui pra reaproveitar em todos os 5 gráficos.
const CHART_PRIMARY = "#3b82f6";
const CHART_SECONDARY = "#93c5fd";

const CHART_TOOLTIP_STYLE = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: 12,
};

const tipoLabel: Record<string, string> = {
  "anuncios-todos": "Anúncios · Todos",
  "anuncios-ecommerce": "Anúncios · E-commerce",
  "anuncios-erp": "Anúncios · ERP direto",
  ecommerce: "E-commerce",
  erp: "ERP",
};

// Achado 11/09/2026: os "Bloco 1-4" dos mockups aprovados têm uma
// estrutura própria (cabeçalho com ícone + divisor; métrica principal
// centralizada + selo de variação + divisor; 3 colunas com ícone próprio
// cada, separadas por linha vertical) — diferente do DashboardKpiCard já
// usado no resto do app (ícone+rótulo no topo, sparkline à direita,
// sub-linhas de texto simples). Componente novo, só pra essa página,
// reproduzindo o layout do PDF em vez de reaproveitar o card padrão.
// Tipo de variação por métrica (regra do PDF: valores em %, percentuais de
// composição em p.p., dias em diferença absoluta) -- usado tanto no selo
// principal quanto nos deltas de sub-stat quando "Comparar período" tá ativo.
type DeltaType = "percent" | "pp" | "days";

function formatDelta(value: number, type: DeltaType) {
  const isUp = value >= 0;
  const suffix = type === "percent" ? "%" : type === "pp" ? " p.p." : " dias";
  return { isUp, text: `${isUp ? "↑" : "↓"} ${Math.abs(value).toFixed(1)}${suffix}` };
}

// Fórmulas de variação P1xP2 do PDF (seção 19.1): valores/contagens/ticket
// usam variação percentual; percentuais de composição (%recorrente/
// %reativado) usam diferença em pontos percentuais; dias usam diferença
// absoluta. Usado agora que os Blocos 1-4 têm P2 real vindo do backend.
function computeDelta(p1: number, p2: number, type: DeltaType, formatter: (n: number) => string): { value: number; type: DeltaType; comparisonValue: string } {
  const value = type === "percent" ? (p2 === 0 ? 0 : ((p1 - p2) / p2) * 100) : p1 - p2;
  return { value, type, comparisonValue: formatter(p2) };
}
function maybeDelta(p1: number | null, p2: number | null, type: DeltaType, formatter: (n: number) => string) {
  if (p1 === null || p2 === null) return undefined;
  return computeDelta(p1, p2, type, formatter);
}

type RecompraStat = {
  icon: LucideIcon;
  label: string;
  value: string;
  delta?: { value: number; type: DeltaType; comparisonValue: string };
};

function RecompraBlockCard({
  icon: Icon,
  iconClass,
  title,
  mainLabel,
  mainValue,
  change,
  changeType = "percent",
  changeLabel,
  comparisonValue,
  stats,
  comparing,
}: {
  icon: LucideIcon;
  iconClass: string;
  title: string;
  mainLabel: string;
  mainValue: string;
  change: number | null;
  changeType?: DeltaType;
  changeLabel: string;
  comparisonValue?: string;
  stats: RecompraStat[];
  comparing: boolean;
}) {
  const mainDelta = change !== null ? formatDelta(change, changeType) : null;
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 border-b border-border pb-2.5">
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${iconClass}`}>
            <Icon className="h-3.5 w-3.5" />
          </div>
          <span className="text-sm font-semibold leading-tight">{title}</span>
        </div>

        <div className="flex flex-col items-center gap-1 border-b border-border py-3 text-center">
          <span className="text-xs text-muted-foreground">{mainLabel}</span>
          <span className="text-2xl font-bold tabular-nums">{mainValue}</span>
          {mainDelta && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                mainDelta.isUp ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
              }`}
            >
              {mainDelta.text} {changeLabel}
            </span>
          )}
          {/* Pedido explícito (15/09/2026): no modo comparação, mostrar o
              VALOR real do período anterior, não só a variação percentual. */}
          {comparing && comparisonValue && (
            <span className="text-[11px] text-muted-foreground">
              Comparação: {comparisonValue} (período anterior)
            </span>
          )}
        </div>

        {/* Empilhado (label+valor por linha, largura cheia do card) em vez
            de 3 colunas lado a lado -- com 4 blocos por linha o card fica
            estreito, e 3 colunas divididas cortavam o texto dos sub-rótulos.
            Com "Comparar período" ativo, cada linha ganha delta% + valor
            comparativo real na mesma linha embaixo do valor. */}
        <div className="flex flex-col gap-1.5 pt-2.5">
          {stats.map((stat) => {
            const delta = comparing && stat.delta ? formatDelta(stat.delta.value, stat.delta.type) : null;
            return (
              <div key={stat.label} className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-tight text-muted-foreground">
                  <stat.icon className="h-3 w-3 shrink-0" />
                  {stat.label}
                </span>
                <span className="flex shrink-0 flex-col items-end">
                  <span className="text-xs font-semibold tabular-nums">{stat.value}</span>
                  {delta && stat.delta && (
                    <span className={`text-[10px] font-medium tabular-nums ${delta.isUp ? "text-emerald-400" : "text-red-400"}`}>
                      {delta.text} <span className="text-muted-foreground">· Comp.: {stat.delta.comparisonValue}</span>
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// Cabeçalho de coluna ordenável (visual só, por enquanto — sem estado de
// ordenação real ainda, isso entra junto com o dado de verdade).
function SortableHead({ children, align }: { children: ReactNode; align?: "right" }) {
  return (
    <TableHead className={align === "right" ? "text-right" : undefined}>
      <button
        type="button"
        className={`inline-flex items-center gap-1 hover:text-foreground ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        {children}
        <ArrowUpDown className="h-3 w-3 opacity-50" />
      </button>
    </TableHead>
  );
}

// Paginação (visual só — mock, sem mais páginas de verdade ainda).
function TablePagination({ from, to, total }: { from: number; to: number; total: number }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>{from}-{to} de {total}</span>
      <Button variant="outline" size="icon" className="h-6 w-6" disabled>
        <ChevronLeft className="h-3.5 w-3.5" />
      </Button>
      <Button variant="outline" size="icon" className="h-6 w-6" disabled={total <= to}>
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function chartTooltipFormatter(value: number, name: string) {
  if (name.toLowerCase().includes("fatur") || name.toLowerCase().includes("ticket")) {
    return formatCurrencySmart(value);
  }
  return formatNumber(value);
}

function TipoFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="justify-between gap-2">
          <span className="text-muted-foreground">Tipo:</span>
          {tipoLabel[value]}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger onClick={() => onChange("anuncios-todos")}>
            Anúncios
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onClick={() => onChange("anuncios-todos")}>Todos</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onChange("anuncios-ecommerce")}>E-commerce</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onChange("anuncios-erp")}>ERP direto</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onClick={() => onChange("ecommerce")}>E-commerce</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onChange("erp")}>ERP</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface SimpleRange {
  from: Date;
  to: Date;
}

interface DraftRange {
  from?: Date;
  to?: Date;
}

function formatRangeShort(range: SimpleRange) {
  return `${format(range.from, "dd/MM/yyyy")} – ${format(range.to, "dd/MM/yyyy")}`;
}

// Achado 21/09/2026: com os dois períodos no botão ("dd/MM/yyyy – dd/MM/yyyy
// vs dd/MM/yyyy – dd/MM/yyyy") o texto ficava comprido demais e quebrava a
// barra de filtros. Omite o ano quando os dois períodos caem no mesmo ano
// (caso comum) -- mesma ideia já usada em getRangeLabel do DateRangePicker
// do header.
function formatComparisonLabel(range: SimpleRange, comparisonRange: SimpleRange) {
  const sameYear = range.from.getFullYear() === range.to.getFullYear() && range.to.getFullYear() === comparisonRange.from.getFullYear() && comparisonRange.from.getFullYear() === comparisonRange.to.getFullYear();
  const fmt = (r: SimpleRange) => `${format(r.from, "dd/MM")} – ${format(r.to, sameYear ? "dd/MM" : "dd/MM/yyyy")}`;
  return `${fmt(range)} vs ${fmt(comparisonRange)}`;
}

// Seletor de "Período de comparação" (P1 x P2) — pedido explícito de
// referência (15/09/2026): precisa ser um select de verdade escolhendo a
// janela de P2, não só um botão liga/desliga. Reaproveita as mesmas peças
// do DateRangePicker do header (Popover + PeriodCalendarCard + date-fns)
// em vez de reinventar um segundo componente de calendário.
//
// Achado 22/09/2026: até aqui esse popover também deixava editar o P1
// (aba "Período atual"), duplicado com o seletor de período do topo do Up
// Dash -- contra o PDF (seção 4.2: "o filtro de período principal não
// aparece dentro de Recompra"). `range` (P1) agora vem de
// useDashboardFilters() e só é lido aqui pra rotular/calcular "Usar
// período anterior" -- não é mais editável neste popover.
function ComparisonPeriodPicker({
  enabled,
  range,
  comparisonRange,
  onApply,
  onClear,
}: {
  enabled: boolean;
  range: SimpleRange;
  comparisonRange: SimpleRange;
  onApply: (comparisonRange: SimpleRange) => void;
  onClear: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(comparisonRange.from));
  const [draftComparisonRange, setDraftComparisonRange] = useState<DraftRange>({
    from: comparisonRange.from,
    to: comparisonRange.to,
  });

  function handleOpenChange(open: boolean) {
    setIsOpen(open);
    if (open) {
      setVisibleMonth(startOfMonth(comparisonRange.from));
      setDraftComparisonRange({ from: comparisonRange.from, to: comparisonRange.to });
    }
  }

  function pickDay(day: Date) {
    const picked = startOfDay(day);
    if (!draftComparisonRange.from || draftComparisonRange.to) {
      setDraftComparisonRange({ from: picked });
      return;
    }
    const next = picked < draftComparisonRange.from || isSameDay(picked, draftComparisonRange.from)
      ? { from: picked, to: draftComparisonRange.from }
      : { from: draftComparisonRange.from, to: picked };
    setDraftComparisonRange(next);
  }

  function useDaysBefore() {
    const days = differenceInDays(range.to, range.from) + 1;
    const next = { from: subDays(range.from, days), to: subDays(range.to, days) };
    setDraftComparisonRange(next);
    setVisibleMonth(startOfMonth(next.from));
  }

  function apply() {
    if (!draftComparisonRange.from || !draftComparisonRange.to) return;
    onApply({ from: draftComparisonRange.from, to: draftComparisonRange.to });
    setIsOpen(false);
  }

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant={enabled ? "default" : "outline"} size="sm" className="shrink-0 gap-2 whitespace-nowrap">
          <CalendarIcon className="h-3.5 w-3.5 shrink-0" />
          {enabled ? formatComparisonLabel(range, comparisonRange) : "Comparar período"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(calc(100vw-2rem),380px)] p-3" align="end">
        <div className="mb-3 rounded-md border border-border bg-muted/30 px-2.5 py-2 text-xs">
          <span className="block font-medium text-muted-foreground">Período atual (P1)</span>
          <span className="block">{formatRangeShort(range)}</span>
        </div>

        <div className="mb-2 flex items-center justify-between px-1">
          <p className="text-xs text-muted-foreground">
            {draftComparisonRange.from && !draftComparisonRange.to ? "Selecione a data final" : "Escolha o período de comparação"}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setVisibleMonth((m) => subMonths(m, 1))} aria-label="Mês anterior">
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setVisibleMonth((m) => addMonths(m, 1))} aria-label="Próximo mês">
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <PeriodCalendarCard
          className="mx-auto w-full max-w-[290px]"
          month={visibleMonth}
          from={draftComparisonRange.from}
          to={draftComparisonRange.to}
          onDaySelect={pickDay}
        />

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
          <Button type="button" variant="ghost" size="sm" onClick={useDaysBefore}>
            Usar período anterior
          </Button>
          <div className="flex gap-2">
            {enabled && (
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => { onClear(); setIsOpen(false); }}>
                <X className="h-3.5 w-3.5" />
                Remover
              </Button>
            )}
            <Button type="button" size="sm" onClick={apply} disabled={!draftComparisonRange.from || !draftComparisonRange.to}>
              Aplicar
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ───────── Integração de dado real ─────────
// Fase 1-4 (ver plano salvo, "greedy-fluttering-cupcake"): Blocos 1-4,
// Detalhamento, Vendedoras e todos os filtros (Status/Tipo/Origem/Estado/
// Vendedora), incluindo Tipo=Anúncios pra cliente Vesti (onlyAttributed) e
// a comparação P1xP2. Fase 5: os 3 gráficos mensais, "Intervalo entre
// compras", Coorte e Funil de retenção também.

type RecompraBlockTotals = { faturamento: number; vendas: number; clientes: number; ticketMedio: number | null };
type RecompraIntervalBucketApi = { faixa: string; clientes: number; grupo: "recorrente" | "reativado" };
type RecompraBlocksPayload = {
  recompra: RecompraBlockTotals;
  recorrentes: RecompraBlockTotals;
  reativados: RecompraBlockTotals;
  ciclo: { tempoMedioDias: number | null; medianaDias: number | null; pctRecorrente: number | null; pctReativado: number | null };
  intervalBuckets: RecompraIntervalBucketApi[];
  unmatchedErpCount: number;
  // true quando Tipo=Anúncios foi pedido mas o client não tem chave UpZero
  // configurada -- backend degrada pra universo vazio em vez de quebrar.
  attributionUnavailable: boolean;
};
type RecompraDashboardResponse = {
  period: { from: string; to: string };
  comparisonPeriod: { from: string; to: string } | null;
  blocks: RecompraBlocksPayload;
  blocksP2: RecompraBlocksPayload | null;
};
type RecompraDetailRowApi = {
  customerId: string;
  cliente: string | null;
  dataEvento: string;
  diasDesde: number;
  tipo: "recorrente" | "reativado";
  vendedora: string | null;
  origem: string | null;
  faturamentoNoPeriodo: number;
  vendasNoPeriodo: number;
  codigoPedido: string;
  ultimaCompraAnterior: string;
};
type RecompraDetailResponse = { period: { from: string; to: string }; rows: RecompraDetailRowApi[]; total: number; page: number; limit: number; attributionUnavailable: boolean };
type RecompraSellerRowApi = {
  vendedora: string;
  clientesRecompra: number;
  clientesRecorrentes: number;
  clientesReativados: number;
  vendas: number;
  faturamento: number;
  ticketMedio: number | null;
};
type RecompraSellersResponse = { period: { from: string; to: string }; rows: RecompraSellerRowApi[]; total: number; attributionUnavailable: boolean };

function useRecompraClientId() {
  const { selectedClientId, user } = useAuth();
  const clientId = user?.role === "ADMIN" ? selectedClientId || undefined : undefined;
  return { clientId, enabled: user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId) };
}

function buildRecompraUrl(path: string, params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => value !== undefined && value !== "" && query.set(key, String(value)));
  return `${path}${query.size ? `?${query}` : ""}`;
}

// Status/Tipo já usam os mesmos valores literais do <Select>/<TipoFilter>
// (solicitado/pago/espera/cancelado; erp/ecommerce/anuncios-*). Estado/
// Vendedora/Origem usam "todos"/"todas" como valor de "sem filtro" na UI --
// convertido pra undefined (omitido da query) aqui. Origem só tem efeito
// no backend quando tipo começa com "anuncios-" (ignorado silenciosamente
// nos outros universos), então não precisa de lógica condicional aqui.
type RecompraFilterParams = { status: string; tipo: string; estado: string; vendedora: string; origem: string };
function recompraFilterQueryParams(filters: RecompraFilterParams) {
  return {
    status: filters.status,
    tipo: filters.tipo,
    estado: filters.estado === "todos" ? undefined : filters.estado,
    vendedora: filters.vendedora === "todas" ? undefined : filters.vendedora,
    origem: filters.origem === "todos" ? undefined : filters.origem,
  };
}

function useRecompraDashboard(dateFrom: string, dateTo: string, filters: RecompraFilterParams, compareDateFrom?: string, compareDateTo?: string) {
  const { clientId, enabled } = useRecompraClientId();
  const filterParams = recompraFilterQueryParams(filters);
  return useQuery<RecompraDashboardResponse>({
    queryKey: ["recompra-dashboard", clientId, dateFrom, dateTo, filterParams, compareDateFrom, compareDateTo],
    queryFn: () =>
      customFetch(buildRecompraUrl("/api/analytics/recompra/dashboard", { clientId, dateFrom, dateTo, ...filterParams, compareDateFrom, compareDateTo })),
    enabled,
    staleTime: 120_000,
    refetchOnWindowFocus: false,
  });
}

function useRecompraDetail(dateFrom: string, dateTo: string, filters: RecompraFilterParams) {
  const { clientId, enabled } = useRecompraClientId();
  const filterParams = recompraFilterQueryParams(filters);
  return useQuery<RecompraDetailResponse>({
    queryKey: ["recompra-detail", clientId, dateFrom, dateTo, filterParams],
    queryFn: () => customFetch(buildRecompraUrl("/api/analytics/recompra/detail", { clientId, dateFrom, dateTo, ...filterParams, limit: 100 })),
    enabled,
    staleTime: 120_000,
    refetchOnWindowFocus: false,
  });
}

// Vendedora NÃO entra aqui de propósito -- o dropdown de Vendedora precisa
// da lista completa (todas as vendedoras do universo filtrado por Status/
// Tipo/Origem/Estado) pra continuar navegável mesmo com uma vendedora já
// selecionada; o filtro de vendedora é aplicado no cliente (ver useMemo
// mais abaixo).
function useRecompraSellers(dateFrom: string, dateTo: string, status: string, tipo: string, origem: string, estado: string) {
  const { clientId, enabled } = useRecompraClientId();
  const estadoParam = estado === "todos" ? undefined : estado;
  const origemParam = origem === "todos" ? undefined : origem;
  return useQuery<RecompraSellersResponse>({
    queryKey: ["recompra-sellers", clientId, dateFrom, dateTo, status, tipo, origemParam, estadoParam],
    queryFn: () => customFetch(buildRecompraUrl("/api/analytics/recompra/sellers", { clientId, dateFrom, dateTo, status, tipo, origem: origemParam, estado: estadoParam })),
    enabled,
    staleTime: 120_000,
    refetchOnWindowFocus: false,
  });
}

// Fase 5 -- gráficos mensais (Resultado/Volume/Recorrentes×Reativados):
// sempre os últimos 12 meses corridos até hoje, reage aos mesmos filtros
// dos Blocos, mas NÃO recebe dateFrom/dateTo (o backend sempre calcula a
// própria janela fixa) nem P2 (não tem P2 natural pra uma janela fixa).
type RecompraMonthlyBucketApi = {
  month: string; // "YYYY-MM"
  faturamento: number;
  vendas: number;
  clientes: number;
  recorrentes: { clientes: number; vendas: number; faturamento: number };
  reativados: { clientes: number; vendas: number; faturamento: number };
};
type RecompraMonthlyTrendResponse = { months: RecompraMonthlyBucketApi[]; attributionUnavailable: boolean };

function useRecompraMonthlyTrend(filters: RecompraFilterParams) {
  const { clientId, enabled } = useRecompraClientId();
  const filterParams = recompraFilterQueryParams(filters);
  return useQuery<RecompraMonthlyTrendResponse>({
    queryKey: ["recompra-monthly-trend", clientId, filterParams],
    queryFn: () => customFetch(buildRecompraUrl("/api/analytics/recompra/monthly-trend", { clientId, ...filterParams })),
    enabled,
    staleTime: 120_000,
    refetchOnWindowFocus: false,
  });
}

// Fase 5 -- Coorte + Funil de retenção: "visão geral", sem os filtros
// Status/Tipo/Origem/Estado/Vendedora da página (decisão do usuário) --
// por isso o hook não recebe nenhum parâmetro além do clientId.
type RecompraFunnelStepApi = { compra: string; clientes: number; retencao: number };
type RecompraCohortRowApi = { mes: string; clientes: number; d30: number | null; d60: number | null; d90: number | null; d180: number | null; hoje: number | null };
type RecompraHistoryInsightsResponse = { funnel: RecompraFunnelStepApi[]; cohort: RecompraCohortRowApi[] };

function useRecompraHistoryInsights() {
  const { clientId, enabled } = useRecompraClientId();
  return useQuery<RecompraHistoryInsightsResponse>({
    queryKey: ["recompra-history-insights", clientId],
    queryFn: () => customFetch(buildRecompraUrl("/api/analytics/recompra/history-insights", { clientId })),
    enabled,
    staleTime: 120_000,
    refetchOnWindowFocus: false,
  });
}

// N/A explícito (PDF seção 21/23: denominador zero/ausência de base não
// vira 0 silencioso) em vez de formatar null como "R$0,00"/"0".
function formatMaybeCurrency(value: number | null): string {
  return value === null ? "N/A" : formatCurrencySmart(value);
}
function formatMaybeDays(value: number | null): string {
  return value === null ? "N/A" : `${Math.round(value)} dias`;
}
function formatMaybePercentage(value: number | null): string {
  return value === null ? "N/A" : formatPercentage(value);
}

export default function PerformanceRecompraPage() {
  const [tipo, setTipo] = useState("anuncios-todos");
  const [status, setStatus] = useState("pago");
  const [origem, setOrigem] = useState("todos");
  const [estado, setEstado] = useState("todos");
  const [vendedora, setVendedora] = useState("todas");
  // P1 vem do seletor de período do topo do Up Dash (PDF seção 4.2) --
  // não é mais estado local desta página (ver achado 22/09/2026 no
  // ComparisonPeriodPicker).
  const { dateRange } = useDashboardFilters();
  const range: SimpleRange = dateRange;
  const [comparing, setComparing] = useState(false);
  const [comparisonRange, setComparisonRange] = useState<SimpleRange>(() => {
    const days = differenceInDays(range.to, range.from) + 1;
    return { from: subDays(range.from, days), to: subDays(range.to, days) };
  });
  const [search, setSearch] = useState("");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const dateFrom = format(range.from, "yyyy-MM-dd");
  const dateTo = format(range.to, "yyyy-MM-dd");
  const compareDateFrom = comparing ? format(comparisonRange.from, "yyyy-MM-dd") : undefined;
  const compareDateTo = comparing ? format(comparisonRange.to, "yyyy-MM-dd") : undefined;
  const recompraFilters: RecompraFilterParams = { status, tipo, estado, vendedora, origem };
  const { data: recompraData, isLoading: blocksLoading } = useRecompraDashboard(dateFrom, dateTo, recompraFilters, compareDateFrom, compareDateTo);
  const { data: detailData, isLoading: detailLoading } = useRecompraDetail(dateFrom, dateTo, recompraFilters);
  const { data: sellersData, isLoading: sellersLoading } = useRecompraSellers(dateFrom, dateTo, status, tipo, origem, estado);
  const blocksP2 = comparing ? recompraData?.blocksP2 ?? null : null;
  // Fase 5 -- gráficos mensais (janela fixa, reage aos filtros da página) e
  // Coorte/Funil (visão geral, sem filtro nenhum).
  const { data: monthlyTrendData, isLoading: monthlyTrendLoading } = useRecompraMonthlyTrend(recompraFilters);
  const { data: historyInsightsData, isLoading: historyInsightsLoading } = useRecompraHistoryInsights();

  const revenueByMonth = useMemo(
    () => (monthlyTrendData?.months ?? []).map((m) => ({ month: formatMonthLabel(m.month), faturamento: m.faturamento, ticket: m.vendas > 0 ? m.faturamento / m.vendas : 0 })),
    [monthlyTrendData],
  );
  const volumeByMonth = useMemo(
    () => (monthlyTrendData?.months ?? []).map((m) => ({ month: formatMonthLabel(m.month), vendas: m.vendas, clientes: m.clientes })),
    [monthlyTrendData],
  );
  const recorrentesReativadosByMonth = useMemo(
    () =>
      (monthlyTrendData?.months ?? []).map((m) => ({
        month: formatMonthLabel(m.month),
        recorrente: m.recorrentes.clientes,
        reativado: m.reativados.clientes,
        pctReativado: m.clientes > 0 ? Math.round((m.reativados.clientes / m.clientes) * 1000) / 10 : 0,
      })),
    [monthlyTrendData],
  );
  const intervalBuckets = useMemo(
    () =>
      (recompraData?.blocks.intervalBuckets ?? []).map((b) => ({
        ...b,
        clientesP2: comparing ? (blocksP2?.intervalBuckets.find((p2) => p2.faixa === b.faixa)?.clientes ?? 0) : undefined,
      })),
    [recompraData, blocksP2, comparing],
  );
  const retentionSteps = historyInsightsData?.funnel ?? [];
  const cohortRows = historyInsightsData?.cohort ?? [];

  // Vendedora filtra a EXIBIÇÃO da tabela no cliente (não um novo fetch) --
  // o dropdown continua com a lista cheia vinda de useRecompraSellers.
  const visibleSellerRows = useMemo(
    () => (vendedora === "todas" ? (sellersData?.rows ?? []) : (sellersData?.rows ?? []).filter((r) => r.vendedora === vendedora)),
    [sellersData, vendedora],
  );

  // Mapeia o retorno real (menos campos que o mock -- Fechamento/CNPJ/UF/
  // cidade/email/telefone/itens ainda não vêm da API nessa fase, ver plano)
  // pra dentro do mesmo shape DetailRow que a tabela já sabe renderizar,
  // evitando reescrever a tabela inteira. Vendedora desde a Fase 2, Origem
  // desde a Fase 3 (só populada quando Tipo=Anúncios -- fica "—" nos outros
  // universos, já que o evento não tem touchpoint associado).
  const realDetailRows: DetailRow[] = useMemo(
    () =>
      (detailData?.rows ?? []).map((r) => ({
        cliente: r.cliente ?? "—",
        dataEvento: format(new Date(r.dataEvento), "dd/MM/yyyy"),
        diasDesde: r.diasDesde,
        tipo: r.tipo === "recorrente" ? "Recorrente" : "Reativação",
        vendedora: r.vendedora ?? "—",
        origem: r.origem ?? "—",
        fechamento: "—",
        faturamento: r.faturamentoNoPeriodo,
        codigoPedido: r.codigoPedido,
        documento: "—",
        uf: "—",
        cidade: "—",
        email: "—",
        telefone: "—",
        ultimaCompraAnterior: format(new Date(r.ultimaCompraAnterior), "dd/MM/yyyy"),
        itens: [],
      })),
    [detailData],
  );

  const filteredDetailRows = useMemo(() => {
    if (!search.trim()) return realDetailRows;
    const term = search.trim().toLowerCase();
    return realDetailRows.filter(
      (row) => row.cliente.toLowerCase().includes(term) || row.codigoPedido.toLowerCase().includes(term),
    );
  }, [search, realDetailRows]);

  return (
    <div className="space-y-5">

      {/* Filtros locais */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <div className="flex flex-wrap items-center gap-2">
          <TipoFilter value={tipo} onChange={setTipo} />

          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9 w-[150px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="solicitado">Solicitado</SelectItem>
              <SelectItem value="pago">Pago</SelectItem>
              <SelectItem value="espera">Em espera</SelectItem>
              <SelectItem value="cancelado">Cancelado</SelectItem>
            </SelectContent>
          </Select>

          {/* Só tem efeito com Tipo=Anúncios (depende de touchpoint pago) --
              desabilitado nos outros universos em vez de aceitar uma seleção
              que o backend vai ignorar silenciosamente. Valores batem
              exatamente com originLabel() em recompra-analytics.ts; "Link
              de vendedora" (exemplo do PDF) saiu da lista -- não existe
              fonte de dado pra essa origem hoje (confirmado: sem UTM/
              marketplace em pedidos_erp/clientes_erp para esse client). */}
          <Select value={origem} onValueChange={setOrigem} disabled={!tipo.startsWith("anuncios")}>
            <SelectTrigger className="h-9 w-[170px]">
              <SelectValue placeholder="Origem" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas as origens</SelectItem>
              <SelectItem value="Meta Ads">Meta Ads</SelectItem>
              <SelectItem value="Google Ads">Google Ads</SelectItem>
              <SelectItem value="Outros">Outros</SelectItem>
            </SelectContent>
          </Select>

          <Select value={estado} onValueChange={setEstado}>
            <SelectTrigger className="h-9 w-[130px]">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os UFs</SelectItem>
              <SelectItem value="SP">SP</SelectItem>
              <SelectItem value="MG">MG</SelectItem>
              <SelectItem value="RJ">RJ</SelectItem>
              <SelectItem value="PR">PR</SelectItem>
            </SelectContent>
          </Select>

          <Select value={vendedora} onValueChange={setVendedora}>
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue placeholder="Vendedora" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as vendedoras</SelectItem>
              {(sellersData?.rows ?? []).map((s) => (
                <SelectItem key={s.vendedora} value={s.vendedora}>
                  {s.vendedora}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          </div>

          <div className="ml-auto flex w-full justify-end sm:w-auto">
            <ComparisonPeriodPicker
              enabled={comparing}
              range={range}
              comparisonRange={comparisonRange}
              onApply={(c) => {
                setComparisonRange(c);
                setComparing(true);
              }}
              onClear={() => setComparing(false)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Blocos 1-4 — dado real (Fase 1), com P2 real quando "Comparar
          período" está ativo (fórmulas de variação do PDF seção 19.1). */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <RecompraBlockCard
          icon={DollarSign}
          iconClass="bg-blue-500/15 text-blue-400"
          title="Resultado de recompra"
          mainLabel="Faturamento de recompra"
          mainValue={blocksLoading ? "…" : formatMaybeCurrency(recompraData?.blocks.recompra.faturamento ?? null)}
          change={blocksP2 ? computeDelta(recompraData!.blocks.recompra.faturamento, blocksP2.recompra.faturamento, "percent", formatCurrencySmart).value : null}
          comparisonValue={blocksP2 ? formatCurrencySmart(blocksP2.recompra.faturamento) : undefined}
          changeLabel="vs. período anterior"
          comparing={comparing}
          stats={[
            { icon: ShoppingBag, label: "Vendas de recompra", value: blocksLoading ? "…" : formatNumber(recompraData?.blocks.recompra.vendas ?? 0), delta: blocksP2 ? computeDelta(recompraData!.blocks.recompra.vendas, blocksP2.recompra.vendas, "percent", formatNumber) : undefined },
            { icon: Receipt, label: "Ticket médio", value: blocksLoading ? "…" : formatMaybeCurrency(recompraData?.blocks.recompra.ticketMedio ?? null), delta: blocksP2 ? maybeDelta(recompraData!.blocks.recompra.ticketMedio, blocksP2.recompra.ticketMedio, "percent", formatCurrencySmart) : undefined },
            { icon: Users, label: "Clientes em recompra", value: blocksLoading ? "…" : formatNumber(recompraData?.blocks.recompra.clientes ?? 0), delta: blocksP2 ? computeDelta(recompraData!.blocks.recompra.clientes, blocksP2.recompra.clientes, "percent", formatNumber) : undefined },
          ]}
        />
        <RecompraBlockCard
          icon={UserCheck}
          iconClass="bg-emerald-500/15 text-emerald-400"
          title="Clientes recorrentes"
          mainLabel="Clientes recorrentes"
          mainValue={blocksLoading ? "…" : formatNumber(recompraData?.blocks.recorrentes.clientes ?? 0)}
          change={blocksP2 ? computeDelta(recompraData!.blocks.recorrentes.clientes, blocksP2.recorrentes.clientes, "percent", formatNumber).value : null}
          comparisonValue={blocksP2 ? formatNumber(blocksP2.recorrentes.clientes) : undefined}
          changeLabel="vs. período anterior"
          comparing={comparing}
          stats={[
            { icon: ShoppingBag, label: "Vendas recorrentes", value: blocksLoading ? "…" : formatNumber(recompraData?.blocks.recorrentes.vendas ?? 0), delta: blocksP2 ? computeDelta(recompraData!.blocks.recorrentes.vendas, blocksP2.recorrentes.vendas, "percent", formatNumber) : undefined },
            { icon: Wallet, label: "Faturamento recorrente", value: blocksLoading ? "…" : formatMaybeCurrency(recompraData?.blocks.recorrentes.faturamento ?? null), delta: blocksP2 ? computeDelta(recompraData!.blocks.recorrentes.faturamento, blocksP2.recorrentes.faturamento, "percent", formatCurrencySmart) : undefined },
            { icon: Receipt, label: "Ticket médio recorrente", value: blocksLoading ? "…" : formatMaybeCurrency(recompraData?.blocks.recorrentes.ticketMedio ?? null), delta: blocksP2 ? maybeDelta(recompraData!.blocks.recorrentes.ticketMedio, blocksP2.recorrentes.ticketMedio, "percent", formatCurrencySmart) : undefined },
          ]}
        />
        <RecompraBlockCard
          icon={RotateCcw}
          iconClass="bg-violet-500/15 text-violet-400"
          title="Clientes reativados"
          mainLabel="Clientes reativados"
          mainValue={blocksLoading ? "…" : formatNumber(recompraData?.blocks.reativados.clientes ?? 0)}
          change={blocksP2 ? computeDelta(recompraData!.blocks.reativados.clientes, blocksP2.reativados.clientes, "percent", formatNumber).value : null}
          comparisonValue={blocksP2 ? formatNumber(blocksP2.reativados.clientes) : undefined}
          changeLabel="vs. período anterior"
          comparing={comparing}
          stats={[
            { icon: ShoppingBag, label: "Vendas reativadas", value: blocksLoading ? "…" : formatNumber(recompraData?.blocks.reativados.vendas ?? 0), delta: blocksP2 ? computeDelta(recompraData!.blocks.reativados.vendas, blocksP2.reativados.vendas, "percent", formatNumber) : undefined },
            { icon: Wallet, label: "Faturamento reativado", value: blocksLoading ? "…" : formatMaybeCurrency(recompraData?.blocks.reativados.faturamento ?? null), delta: blocksP2 ? computeDelta(recompraData!.blocks.reativados.faturamento, blocksP2.reativados.faturamento, "percent", formatCurrencySmart) : undefined },
            { icon: Receipt, label: "Ticket médio reativado", value: blocksLoading ? "…" : formatMaybeCurrency(recompraData?.blocks.reativados.ticketMedio ?? null), delta: blocksP2 ? maybeDelta(recompraData!.blocks.reativados.ticketMedio, blocksP2.reativados.ticketMedio, "percent", formatCurrencySmart) : undefined },
          ]}
        />
        <RecompraBlockCard
          icon={Timer}
          iconClass="bg-sky-500/15 text-sky-400"
          title="Ciclo de recompra"
          mainLabel="Tempo médio entre compras"
          mainValue={blocksLoading ? "…" : formatMaybeDays(recompraData?.blocks.ciclo.tempoMedioDias ?? null)}
          change={blocksP2 ? maybeDelta(recompraData!.blocks.ciclo.tempoMedioDias, blocksP2.ciclo.tempoMedioDias, "days", formatMaybeDays)?.value ?? null : null}
          changeType="days"
          comparisonValue={blocksP2 ? formatMaybeDays(blocksP2.ciclo.tempoMedioDias) : undefined}
          changeLabel="vs. período anterior"
          comparing={comparing}
          stats={[
            { icon: Hourglass, label: "Mediana entre compras", value: blocksLoading ? "…" : formatMaybeDays(recompraData?.blocks.ciclo.medianaDias ?? null), delta: blocksP2 ? maybeDelta(recompraData!.blocks.ciclo.medianaDias, blocksP2.ciclo.medianaDias, "days", formatMaybeDays) : undefined },
            { icon: UserCheck, label: "% recorrente", value: blocksLoading ? "…" : formatMaybePercentage(recompraData?.blocks.ciclo.pctRecorrente ?? null), delta: blocksP2 ? maybeDelta(recompraData!.blocks.ciclo.pctRecorrente, blocksP2.ciclo.pctRecorrente, "pp", formatMaybePercentage) : undefined },
            { icon: RotateCcw, label: "% reativado", value: blocksLoading ? "…" : formatMaybePercentage(recompraData?.blocks.ciclo.pctReativado ?? null), delta: blocksP2 ? maybeDelta(recompraData!.blocks.ciclo.pctReativado, blocksP2.ciclo.pctReativado, "pp", formatMaybePercentage) : undefined },
          ]}
        />
      </div>
      {recompraData?.blocks.attributionUnavailable && (
        <p className="text-xs text-amber-500">
          Este cliente não tem chave UpZero configurada — Tipo=Anúncios não pode ser calculado (sem touchpoint pago pra atribuir) e os blocos/tabela abaixo estão vazios.
        </p>
      )}
      {recompraData && recompraData.blocks.unmatchedErpCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {recompraData.blocks.unmatchedErpCount} pedido(s) do ERP no período não puderam ser conciliados com um cliente identificado (sem CNPJ/e-mail/telefone batendo) e ficaram de fora dos blocos acima.
        </p>
      )}

      {/* Gráficos 1-3: séries mensais -- sempre os últimos 12 meses corridos
          até hoje (Fase 5), independente do período (P1) escolhido no topo.
          Por isso NÃO têm comparação P1×P2 (não tem um "P2" natural pra uma
          janela já fixa) -- diferente do bloco "Intervalo entre compras"
          logo abaixo, que continua ligado a P1/P2 dos Blocos 1-4. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Resultado de recompra</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {monthlyTrendLoading ? (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Carregando…</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={revenueByMonth} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                  <XAxis dataKey="month" fontSize={12} />
                  <YAxis yAxisId="left" fontSize={12} tickFormatter={(v) => `R$${Math.round(v / 1000)}k`} />
                  <YAxis yAxisId="right" orientation="right" fontSize={12} tickFormatter={(v) => `R$${v}`} />
                  <Tooltip formatter={chartTooltipFormatter} contentStyle={CHART_TOOLTIP_STYLE} labelStyle={{ color: "hsl(var(--foreground))" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="left" dataKey="faturamento" name="Faturamento de recompra (R$)" fill={CHART_PRIMARY} radius={[3, 3, 0, 0]} />
                  <Line yAxisId="right" dataKey="ticket" name="Ticket médio (R$)" stroke={CHART_SECONDARY} strokeWidth={2} dot={{ r: 3, fill: CHART_SECONDARY }} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Volume de recompra</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {monthlyTrendLoading ? (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Carregando…</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={volumeByMonth} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                  <XAxis dataKey="month" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip formatter={chartTooltipFormatter} contentStyle={CHART_TOOLTIP_STYLE} labelStyle={{ color: "hsl(var(--foreground))" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="vendas" name="Vendas de recompra" fill={CHART_PRIMARY} radius={[3, 3, 0, 0]} />
                  <Line dataKey="clientes" name="Clientes em recompra" stroke={CHART_SECONDARY} strokeWidth={2} dot={{ r: 3, fill: CHART_SECONDARY }} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Recorrentes x Reativados</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {/* Achado 11/09/2026: PDF pede barra+linha de %reativados (seção
                13), mas o mockup mais recente só mostra as 2 barras, sem
                linha -- segui o mockup. `pctReativado` já vem calculado em
                cada mês (ver useMemo) caso decidam ligar a linha depois. */}
            {monthlyTrendLoading ? (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Carregando…</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={recorrentesReativadosByMonth} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                  <XAxis dataKey="month" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip formatter={chartTooltipFormatter} contentStyle={CHART_TOOLTIP_STYLE} labelStyle={{ color: "hsl(var(--foreground))" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="recorrente" name="Clientes recorrentes" fill={CHART_PRIMARY} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="reativado" name="Clientes reativados" fill={CHART_SECONDARY} radius={[3, 3, 0, 0]} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Intervalo entre compras</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={intervalBuckets} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                <XAxis dataKey="faixa" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip
                  formatter={chartTooltipFormatter}
                  contentStyle={CHART_TOOLTIP_STYLE}
                  labelStyle={{ color: "hsl(var(--foreground))" }}
                  itemStyle={{ color: "hsl(var(--foreground))" }}
                />
                <Bar dataKey="clientes" name={comparing ? "Clientes (P1)" : "Clientes"} radius={[3, 3, 0, 0]}>
                  {intervalBuckets.map((entry) => (
                    <Cell key={entry.faixa} fill={entry.grupo === "recorrente" ? CHART_PRIMARY : CHART_SECONDARY} />
                  ))}
                </Bar>
                {comparing && (
                  <Bar dataKey="clientesP2" name="Clientes (P2)" radius={[3, 3, 0, 0]}>
                    {intervalBuckets.map((entry) => (
                      <Cell key={entry.faixa} fill={entry.grupo === "recorrente" ? CHART_PRIMARY : CHART_SECONDARY} fillOpacity={0.35} />
                    ))}
                  </Bar>
                )}
              </ComposedChart>
            </ResponsiveContainer>
            <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: CHART_PRIMARY }} /> Recorrente (≤90d){comparing && " · P1"}</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: CHART_SECONDARY }} /> Reativação (&gt;90d){comparing && " · P1"}</span>
              {comparing && (
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full opacity-35" style={{ backgroundColor: CHART_PRIMARY }} /> P2 (mesmo grupo, tom mais claro)</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Gráfico 5: retenção por número de compra -- Coorte e Funil (Fase 5)
          são "visão geral", sem os filtros Status/Tipo/Origem/Estado/
          Vendedora da página (decisão do usuário). */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Retenção por número de compra</CardTitle>
        </CardHeader>
        <CardContent className="h-80">
          {historyInsightsLoading ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Carregando…</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={retentionSteps} margin={{ top: 24, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                <XAxis dataKey="compra" fontSize={12} />
                <YAxis yAxisId="left" fontSize={12} />
                <YAxis yAxisId="right" orientation="right" fontSize={12} tickFormatter={(v) => `${v}%`} />
                <Tooltip formatter={chartTooltipFormatter} contentStyle={CHART_TOOLTIP_STYLE} labelStyle={{ color: "hsl(var(--foreground))" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="left" dataKey="clientes" name="Clientes" fill={CHART_PRIMARY} radius={[3, 3, 0, 0]}>
                  <LabelList dataKey="clientes" position="insideTop" fill="#fff" fontSize={12} formatter={(v: number) => formatNumber(v)} />
                </Bar>
                <Line yAxisId="right" dataKey="retencao" name="Retenção acumulada" stroke={CHART_SECONDARY} strokeWidth={2} dot={{ r: 4, fill: CHART_SECONDARY }}>
                  <LabelList dataKey="retencao" position="top" fill={CHART_SECONDARY} fontSize={12} formatter={(v: number) => `${v}%`} />
                </Line>
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Coorte */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Análise de coorte de recompra</CardTitle>
        </CardHeader>
        <CardContent>
          {historyInsightsLoading ? (
            <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">Carregando…</div>
          ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mês da 1ª compra</TableHead>
                  <TableHead className="text-right">Clientes</TableHead>
                  <TableHead className="text-right">Até 30 dias</TableHead>
                  <TableHead className="text-right">Até 60 dias</TableHead>
                  <TableHead className="text-right">Até 90 dias</TableHead>
                  <TableHead className="text-right">Até 180 dias</TableHead>
                  <TableHead className="text-right">Até hoje</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cohortRows.map((row) => (
                  <TableRow key={row.mes}>
                    <TableCell className="font-medium">{formatCohortMonthLabel(row.mes)}</TableCell>
                    <TableCell className="text-right">{formatNumber(row.clientes)}</TableCell>
                    <TableCell className="text-right">{row.d30 !== null ? formatPercentage(row.d30) : <Badge variant="outline">Em maturação</Badge>}</TableCell>
                    <TableCell className="text-right">{row.d60 !== null ? formatPercentage(row.d60) : <Badge variant="outline">Em maturação</Badge>}</TableCell>
                    <TableCell className="text-right">{row.d90 !== null ? formatPercentage(row.d90) : <Badge variant="outline">Em maturação</Badge>}</TableCell>
                    <TableCell className="text-right">{row.d180 !== null ? formatPercentage(row.d180) : <Badge variant="outline">Em maturação</Badge>}</TableCell>
                    <TableCell className="text-right font-medium">{row.hoje !== null ? formatPercentage(row.hoje) : <Badge variant="outline">Em maturação</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          )}
        </CardContent>
      </Card>

      {/* Desempenho por vendedora — dado real (Fase 2). PDF seção 17: reage
          a Status/Estado/Vendedora, não recebe P2. */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Desempenho por vendedora</CardTitle>
          <TablePagination from={visibleSellerRows.length === 0 ? 0 : 1} to={visibleSellerRows.length} total={visibleSellerRows.length} />
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead>Vendedora</SortableHead>
                  <SortableHead align="right">Clientes recorrentes</SortableHead>
                  <SortableHead align="right">Clientes reativados</SortableHead>
                  <SortableHead align="right">Clientes de recompra</SortableHead>
                  <SortableHead align="right">Vendas de recompra</SortableHead>
                  <SortableHead align="right">Faturamento de recompra</SortableHead>
                  <SortableHead align="right">Ticket médio</SortableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sellersLoading && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">Carregando…</TableCell>
                  </TableRow>
                )}
                {!sellersLoading && visibleSellerRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">Nenhuma vendedora com recompra nesse recorte.</TableCell>
                  </TableRow>
                )}
                {visibleSellerRows.map((row) => (
                  <TableRow key={row.vendedora}>
                    <TableCell className="font-medium">{row.vendedora}</TableCell>
                    <TableCell className="text-right">{formatNumber(row.clientesRecorrentes)}</TableCell>
                    <TableCell className="text-right">{formatNumber(row.clientesReativados)}</TableCell>
                    <TableCell className="text-right">{formatNumber(row.clientesRecompra)}</TableCell>
                    <TableCell className="text-right">{formatNumber(row.vendas)}</TableCell>
                    <TableCell className="text-right">{formatMaybeCurrency(row.faturamento)}</TableCell>
                    <TableCell className="text-right">{formatMaybeCurrency(row.ticketMedio)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Detalhamento + exportação */}
      <Card>
        <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="text-sm">Detalhamento de recompra</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Uma linha por cliente. Pedidos e itens aparecem na expansão.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cliente, CNPJ/CPF ou pedido..."
                className="h-8 w-64 pl-8 text-xs"
              />
            </div>
            <Button variant="outline" size="sm" className="gap-2">
              <Download className="h-3.5 w-3.5" />
              Exportar Excel
            </Button>
            <TablePagination from={1} to={filteredDetailRows.length} total={filteredDetailRows.length} />
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead />
                  <SortableHead>Cliente</SortableHead>
                  <SortableHead>Data do pedido</SortableHead>
                  <SortableHead>Dias desde última compra</SortableHead>
                  <SortableHead>Tipo de recompra</SortableHead>
                  <SortableHead>Vendedora</SortableHead>
                  <SortableHead>Origem</SortableHead>
                  <SortableHead>Fechamento</SortableHead>
                  <SortableHead align="right">Faturamento no período</SortableHead>
                  <SortableHead>Pedido</SortableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDetailRows.map((row) => {
                  const isOpen = expandedRow === row.codigoPedido;
                  return (
                    <>
                      <TableRow
                        key={row.codigoPedido}
                        className="cursor-pointer"
                        onClick={() => setExpandedRow(isOpen ? null : row.codigoPedido)}
                      >
                        <TableCell>
                          <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                        </TableCell>
                        <TableCell className="font-medium">{row.cliente}</TableCell>
                        <TableCell>{row.dataEvento}</TableCell>
                        <TableCell>{row.diasDesde} dias</TableCell>
                        <TableCell>
                          <Badge variant={row.tipo === "Recorrente" ? "default" : "secondary"}>{row.tipo}</Badge>
                        </TableCell>
                        <TableCell>{row.vendedora}</TableCell>
                        <TableCell>{row.origem}</TableCell>
                        <TableCell>
                          {/* Achado 11/09/2026: estilo bolinha+texto pedido no
                              mockup -- mantive o SIGNIFICADO do PDF (seção 6.18:
                              E-commerce ou ERP direto), só troquei o estilo
                              visual de badge pra bolinha, sem virar status de
                              pagamento (isso é campo separado, "Status"). */}
                          <span className="inline-flex items-center gap-1.5">
                            <span className={`h-1.5 w-1.5 rounded-full ${row.fechamento === "E-commerce" ? "bg-blue-400" : "bg-amber-400"}`} />
                            {row.fechamento}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-medium">{formatCurrencySmart(row.faturamento)}</TableCell>
                        <TableCell className="text-muted-foreground">{row.codigoPedido}</TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow key={`${row.codigoPedido}-expand`}>
                          <TableCell colSpan={10} className="bg-muted/30">
                            <div className="grid gap-3 p-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                              <div><span className="text-muted-foreground">CNPJ/CPF</span><div className="font-medium">{row.documento}</div></div>
                              <div><span className="text-muted-foreground">Estado / Cidade</span><div className="font-medium">{row.uf} / {row.cidade}</div></div>
                              <div><span className="text-muted-foreground">E-mail</span><div className="font-medium">{row.email}</div></div>
                              <div><span className="text-muted-foreground">Telefone</span><div className="font-medium">{row.telefone}</div></div>
                              <div className="sm:col-span-2 lg:col-span-4">
                                <span className="text-muted-foreground">Última compra paga anterior</span>
                                <div className="font-medium">{row.ultimaCompraAnterior}</div>
                              </div>
                              <div className="sm:col-span-2 lg:col-span-4 border-t border-border pt-3">
                                <span className="text-muted-foreground">Itens do pedido ({row.itens.length})</span>
                                <ul className="mt-1.5 space-y-1">
                                  {row.itens.map((item) => (
                                    <li key={`${item.nome}-${item.variante}`} className="flex items-center justify-between">
                                      <span>{item.qtd}x {item.nome} ({item.variante})</span>
                                      <span className="font-medium tabular-nums">{formatCurrencySmart(item.qtd * item.valorUnitario)}</span>
                                    </li>
                                  ))}
                                </ul>
                                <div className="mt-2 flex items-center justify-between border-t border-border pt-2 font-medium">
                                  <span>Total do pedido</span>
                                  <span className="tabular-nums">{formatCurrencySmart(row.itens.reduce((sum, i) => sum + i.qtd * i.valorUnitario, 0))}</span>
                                </div>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
                {filteredDetailRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="py-8 text-center text-muted-foreground">
                      Nenhum cliente encontrado pra essa busca.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
