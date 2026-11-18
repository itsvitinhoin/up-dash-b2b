import { useEffect, useRef, useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, Pause, Play, Volume2, VolumeX } from "lucide-react";
import {
  customFetch,
  type TvSnapshot,
  type TvSyncStatus,
  type TvTotals,
} from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { GlassMetricCard } from "@/components/glass-metric-card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import { Line, LineChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CountUp } from "@/components/count-up";
import { formatCurrency } from "@/lib/formatters";
import { playMoneySound } from "@/lib/money-sound";
import {
  revenueIncreased,
  readBrandSelection,
  selectPortfolioBrands,
  portfolioInvestment,
  TV_PAGE_MS,
  TV_PAGE_SIZE,
  TV_STATUS_POLL_MS,
} from "@/lib/tv-dashboard";

const money = (value: number, currency: string) =>
  formatCurrency(value, { currency, locale: "pt-BR" });
const mer = (value: number) =>
  `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}x`;
const dateLabel = (value: string) => value.split("-").reverse().join("/");

function Metrics({
  totals,
  loading,
  prefix,
  brands,
}: {
  brands: TvSnapshot["brands"];
  totals: TvTotals[];
  loading: boolean;
  prefix: string;
}) {
  const scoped =
    prefix === "total"
      ? brands
      : brands.filter((brand) => brand.area.toLowerCase() === prefix);
  const missing = scoped.filter((brand) => brand.investment === null).length;
  const valueFor = (total: TvTotals, key: "revenue" | "investment" | "mer") =>
    key === "investment" && total.investment === null
      ? portfolioInvestment(scoped, total.currency).available
      : total[key];
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {(
        [
          {
            key: "revenue",
            label:
              prefix === "total"
                ? "Total de faturamento"
                : prefix === "b2b"
                  ? "Faturamento solicitado B2B"
                  : "Faturamento pago B2C",
          },
          {
            key: "investment",
            label:
              prefix === "total" ? "Total de investimento" : "Investimento",
          },
          { key: "mer", label: "MER" },
        ] as const
      ).map(({ key, label }) => (
        <GlassMetricCard
          key={key}
          label={label}
          loading={loading}
          value={
            totals.length === 1 ? (
              (valueFor(totals[0], key) ?? "—")
            ) : totals.length ? (
              <div className="space-y-1">
                {totals.map((total) => (
                  <div key={total.currency}>
                    {valueFor(total, key) === null
                      ? "—"
                      : key === "mer"
                        ? `${mer(valueFor(total, key)!)} · ${total.currency}`
                        : money(valueFor(total, key)!, total.currency)}
                  </div>
                ))}
              </div>
            ) : key === "mer" ? (
              "—"
            ) : (
              0
            )
          }
          format={
            key === "mer"
              ? mer
              : (value) => money(value, totals[0]?.currency ?? "BRL")
          }
          info={
            key === "mer"
              ? "Faturamento dividido pelo investimento total. Sem investimento, o MER é indisponível."
              : key === "investment"
                ? "Soma do investimento disponível para os 90 dias. Valores ausentes não são tratados como zero."
                : "B2B solicitado e B2C pago nos últimos 90 dias, em horário de Brasília."
          }
          comparisonUnavailable="Este painel não consulta a janela anterior de 90 dias."
          footer={
            <div className="space-y-2 text-xs">
              {missing > 0 && key === "investment" && (
                <>
                  <Badge
                    variant="outline"
                    className="border-amber-500/30 text-amber-500"
                  >
                    Parcial
                  </Badge>
                  <p className="text-muted-foreground">
                    Soma disponível · {missing} marca(s) sem investimento
                    informado.
                  </p>
                </>
              )}
              {missing > 0 && key === "mer" && (
                <p className="text-muted-foreground">
                  Aguardando investimento completo das marcas selecionadas.
                </p>
              )}
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Período</span>
                <span>Últimos 90 dias</span>
              </div>
            </div>
          }
          testId={`${prefix}-${key}`}
        />
      ))}
    </div>
  );
}

function RevenueChart({ data }: { data: TvSnapshot }) {
  const currencies = [
    ...new Set((data.revenueTrend ?? []).map((p) => p.currency)),
  ];
  return (
    <div className="grid gap-4">
      {currencies.map((currency) => (
        <Card key={currency} className="up-portfolio-chart p-5">
          <h2 className="text-base font-medium">
            Evolução do faturamento · {currency}
          </h2>
          <p className="mt-1 mb-5 text-xs text-muted-foreground">
            Valores diários · B2B solicitado e B2C pago · 90 dias
          </p>
          <ChartContainer
            config={{
              total: { label: "Total", color: "#0458fe" },
              b2b: { label: "B2B", color: "#afc4ff" },
              b2c: { label: "B2C", color: "#25d4a2" },
            }}
            className="h-[240px] w-full aspect-auto"
          >
            <LineChart
              data={data.revenueTrend?.filter((p) => p.currency === currency)}
              margin={{ top: 8, right: 12, bottom: 4, left: 8 }}
              accessibilityLayer
            >
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tickFormatter={(value) =>
                  String(value).slice(5).split("-").reverse().join("/")
                }
                minTickGap={40}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tickFormatter={(value) =>
                  new Intl.NumberFormat("pt-BR", {
                    notation: "compact",
                  }).format(value)
                }
                tickLine={false}
                axisLine={false}
                width={65}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => dateLabel(String(value))}
                    formatter={(value, name) => (
                      <span>
                        {name === "total"
                          ? "Total"
                          : String(name).toUpperCase()}
                        : {money(Number(value), currency)}
                      </span>
                    )}
                  />
                }
              />
              <ChartLegend content={<ChartLegendContent />} />
              <Line
                dataKey="total"
                type="linear"
                stroke="var(--color-total)"
                strokeWidth={2.5}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                dataKey="b2b"
                type="linear"
                stroke="var(--color-b2b)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                dataKey="b2c"
                type="linear"
                stroke="var(--color-b2c)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ChartContainer>
        </Card>
      ))}
    </div>
  );
}

function BrandSelection({
  userId,
  onChange,
  brands,
}: {
  userId: string;
  onChange: (ids: string[] | null) => void;
  brands: TvSnapshot["brands"];
}) {
  const key = `updash.portfolio-brands.v1.${userId}`;
  const [ids, setIds] = useState<string[] | null>(() => {
    try {
      return readBrandSelection(localStorage.getItem(key));
    } catch {
      return null;
    }
  });
  const [search, setSearch] = useState("");
  const [storageError, setStorageError] = useState(false);
  useEffect(() => onChange(ids), [ids, onChange]);
  function update(next: string[] | null) {
    setIds(next);
    try {
      if (next === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(next));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }
  const selected = new Set(ids ?? brands.map((b) => b.id));
  const count = brands.filter((b) => selected.has(b.id)).length;
  const filtered = brands
    .filter((b) =>
      b.name
        .toLocaleLowerCase("pt-BR")
        .includes(search.toLocaleLowerCase("pt-BR")),
    )
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" aria-label="Selecionar marcas">
          <Building2 className="mr-2 h-4 w-4" />
          Marcas: {count} de {brands.length}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(380px,calc(100vw-32px))] p-4 space-y-3"
      >
        <div>
          <h3 className="font-medium">Marcas no painel</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Selecione as marcas sob sua gestão. Totais, gráficos e ranking
            seguem esta seleção.
          </p>
        </div>
        <Input
          aria-label="Buscar marca"
          placeholder="Buscar marca…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => update(null)}>
            Selecionar todas
          </Button>
          <Button size="sm" variant="ghost" onClick={() => update([])}>
            Limpar seleção
          </Button>
        </div>
        <div className="max-h-64 overflow-y-auto space-y-1">
          {filtered.length ? (
            filtered.map((brand) => (
              <label
                key={brand.id}
                className="flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted/40 cursor-pointer"
              >
                <Checkbox
                  checked={selected.has(brand.id)}
                  onCheckedChange={(checked) =>
                    update(
                      checked
                        ? [...new Set([...selected, brand.id])]
                        : [...selected].filter((id) => id !== brand.id),
                    )
                  }
                  aria-label={brand.name}
                />
                <span className="min-w-0 flex-1">{brand.name}</span>
                <Badge variant="outline">{brand.area}</Badge>
              </label>
            ))
          ) : (
            <p className="py-3 text-sm text-muted-foreground">
              Nenhuma marca encontrada.
            </p>
          )}
        </div>
        <p className="text-xs text-muted-foreground" role="status">
          {storageError
            ? "Seleção aplicada. O navegador não permitiu salvá-la para a próxima abertura."
            : "A seleção fica salva por usuário neste navegador."}
        </p>
      </PopoverContent>
    </Popover>
  );
}

export default function OverviewPage() {
  const { user } = useAuth();
  const [selectedBrands, setSelectedBrands] = useState<string[] | null>(null);
  const selectionVersion =
    selectedBrands === null ? "all" : [...selectedBrands].sort().join(",");
  const previousSelection = useRef(selectionVersion);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [soundError, setSoundError] = useState(false);
  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const previous = useRef<TvSnapshot | undefined>(undefined);
  const lastRequestedCycle = useRef<string | undefined>(undefined);
  const status = useQuery({
    queryKey: ["portfolio-monitor-status"],
    queryFn: ({ signal }) =>
      customFetch<TvSyncStatus>("/api/analytics/admin/tv/status", { signal }),
    refetchInterval: TV_STATUS_POLL_MS,
    refetchIntervalInBackground: true,
  });
  const snapshot = useQuery({
    queryKey: ["portfolio-monitor"],
    queryFn: ({ signal }) =>
      customFetch<TvSnapshot>("/api/analytics/admin/tv", { signal }),
    enabled: false,
    staleTime: Infinity,
  });
  const { refetch } = snapshot;
  useEffect(() => {
    const sync = status.data;
    if (!sync || (!sync.ready && snapshot.data)) return;
    // One publication per completed scheduled cycle; retry incomplete media or failed reads.
    if (
      lastRequestedCycle.current === sync.cycle &&
      snapshot.data?.cycle === sync.cycle &&
      !snapshot.data.brands.some((b) => b.warning)
    )
      return;
    if (snapshot.isFetching) return;
    lastRequestedCycle.current = sync.cycle;
    void refetch();
  }, [status.dataUpdatedAt, refetch]);

  useEffect(() => {
    if (!snapshot.data) return;
    const next = selectPortfolioBrands(snapshot.data, selectedBrands);
    if (previousSelection.current !== selectionVersion) {
      previousSelection.current = selectionVersion;
      previous.current = next;
      return;
    }
    if (
      revenueIncreased(previous.current, next) &&
      soundEnabled &&
      audio.current
    ) {
      void playMoneySound(audio.current).catch(() => {
        setSoundEnabled(false);
        setSoundError(true);
      });
    }
    previous.current = next;
  }, [snapshot.data, soundEnabled, selectionVersion]);

  useEffect(
    () => () => {
      const context = audio.current;
      audio.current = null;
      if (context && context.state !== "closed")
        void context.close().catch(() => {});
    },
    [],
  );
  const data = useMemo(
    () =>
      snapshot.data
        ? selectPortfolioBrands(snapshot.data, selectedBrands)
        : undefined,
    [snapshot.data, selectionVersion],
  );
  useEffect(() => setPage(0), [selectionVersion]);
  const pages = Math.max(
    1,
    Math.ceil((data?.brands.length ?? 0) / TV_PAGE_SIZE),
  );
  const currentPage = page % pages;
  useEffect(() => {
    if (paused || pages <= 1) return;
    const timer = window.setInterval(
      () => setPage((p) => (p + 1) % pages),
      TV_PAGE_MS,
    );
    return () => window.clearInterval(timer);
  }, [pages, paused]);

  async function toggleSound() {
    if (soundEnabled) {
      setSoundEnabled(false);
      return;
    }
    try {
      if (!audio.current || audio.current.state === "closed")
        audio.current = new AudioContext();
      await playMoneySound(audio.current);
      setSoundError(false);
      setSoundEnabled(true);
    } catch {
      setSoundError(true);
    }
  }

  const waiting = !status.data?.ready;
  const loading = !data;
  const visible =
    data?.brands.slice(
      currentPage * TV_PAGE_SIZE,
      (currentPage + 1) * TV_PAGE_SIZE,
    ) ?? [];
  return (
    <div className="up-portfolio space-y-6" data-testid="page-overview">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {user && (
            <BrandSelection
              key={user.id}
              userId={user.id}
              brands={snapshot.data?.brands ?? []}
              onChange={setSelectedBrands}
            />
          )}
          <Badge variant="outline">Últimos 90 dias</Badge>
          <span className="text-sm text-muted-foreground">
            {data
              ? `${dateLabel(data.dateFrom)} a ${dateLabel(data.dateTo)}`
              : "Aguardando dados do ciclo"}
          </span>
          <Badge variant="secondary">Atualização 2× ao dia</Badge>
        </div>
        <Button
          variant="outline"
          onClick={() => void toggleSound()}
          aria-pressed={soundEnabled}
        >
          {soundEnabled ? (
            <Volume2 className="mr-2 h-4 w-4" />
          ) : (
            <VolumeX className="mr-2 h-4 w-4" />
          )}
          {soundEnabled ? "Som ativado" : "Ativar som"}
        </Button>
      </div>
      {data && data.brands.length === 0 && (
        <Alert>
          <AlertTitle>Nenhuma marca selecionada</AlertTitle>
          <AlertDescription>
            Abra o seletor de marcas para incluir as marcas sob sua gestão.
          </AlertDescription>
        </Alert>
      )}
      {soundError && (
        <Alert>
          <AlertDescription>
            O navegador bloqueou o áudio. Clique em Ativar som para tentar
            novamente.
          </AlertDescription>
        </Alert>
      )}
      {(status.isError || snapshot.isError) && (
        <Alert variant="destructive">
          <AlertTitle>Não foi possível atualizar o painel</AlertTitle>
          <AlertDescription>
            Os últimos números disponíveis foram preservados. Uma nova tentativa
            será feita automaticamente.
          </AlertDescription>
        </Alert>
      )}
      {waiting && !status.isError && (
        <Alert>
          <AlertTitle>
            {status.data?.failed
              ? "Há falhas na extração"
              : "Aguardando conclusão da atualização"}
          </AlertTitle>
          <AlertDescription>
            {status.data?.failed
              ? `${status.data.failed} marca(s) com falha. Consulte Extrações para corrigir e executar novamente.`
              : "Os números serão publicados após o término das extrações do ciclo, às 00h e 12h (Brasília)."}
            {data
              ? " Exibindo a última atualização concluída."
              : " Preparando os indicadores."}
          </AlertDescription>
        </Alert>
      )}
      {data?.brands.some((b) => b.warning) && (
        <Alert>
          <AlertTitle>Investimento incompleto</AlertTitle>
          <AlertDescription>
            Há marcas com investimento indisponível para os 90 dias. O
            investimento mostra a soma disponível, identificada como parcial. O
            MER dessas áreas aguarda o investimento completo.
          </AlertDescription>
        </Alert>
      )}
      <section aria-label="Total consolidado" className="space-y-3">
        <h2 className="text-lg font-semibold">Total consolidado</h2>
        <Metrics
          totals={data?.total ?? []}
          loading={loading}
          prefix="total"
          brands={data?.brands ?? []}
        />
      </section>
      <section aria-label="Área B2B" className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">B2B</h2>
          <span className="text-xs text-muted-foreground">
            Faturamento solicitado
          </span>
        </div>
        <Metrics
          totals={data?.b2b ?? []}
          loading={loading}
          prefix="b2b"
          brands={data?.brands ?? []}
        />
      </section>
      <section aria-label="Área B2C" className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">B2C</h2>
          <span className="text-xs text-muted-foreground">
            Faturamento pago
          </span>
        </div>
        <Metrics
          totals={data?.b2c ?? []}
          loading={loading}
          prefix="b2c"
          brands={data?.brands ?? []}
        />
      </section>
      {data && <RevenueChart data={data} />}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div>
            <h2 className="font-semibold">Ranking de marcas</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Marcas ativas · maior faturamento primeiro
              {(data?.total.length ?? 0) > 1
                ? " · valores em moedas diferentes não são convertidos"
                : ""}
            </p>
          </div>
          {pages > 1 && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPage((currentPage + pages - 1) % pages)}
                aria-label="Página anterior"
              >
                ←
              </Button>
              <span className="text-xs tabular-nums">
                {currentPage + 1} / {pages}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setPaused((p) => !p)}
                aria-label={paused ? "Retomar rotação" : "Pausar rotação"}
              >
                {paused ? (
                  <Play className="h-4 w-4" />
                ) : (
                  <Pause className="h-4 w-4" />
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPage((currentPage + 1) % pages)}
                aria-label="Próxima página"
              >
                →
              </Button>
            </div>
          )}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">#</TableHead>
              <TableHead>Marca</TableHead>
              <TableHead>Área</TableHead>
              <TableHead className="text-right">Faturamento</TableHead>
              <TableHead className="text-right">Investimento</TableHead>
              <TableHead className="text-right">MER</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <Skeleton className="my-3 h-12 w-full" />
                </TableCell>
              </TableRow>
            ) : visible.length ? (
              visible.map((brand, index) => (
                <TableRow key={brand.id}>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {currentPage * TV_PAGE_SIZE + index + 1}
                  </TableCell>
                  <TableCell className="font-medium">
                    {brand.name}
                    {brand.warning && (
                      <p className="mt-1 text-xs font-normal text-amber-500">
                        {brand.warning}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{brand.area}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <CountUp
                      value={brand.revenue}
                      format={(value) => money(value, brand.currency)}
                    />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {brand.investment === null
                      ? "—"
                      : money(brand.investment, brand.currency)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {brand.mer === null ? "—" : mer(brand.mer)}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-24 text-center text-muted-foreground"
                >
                  Nenhuma marca selecionada para este painel.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
      <p className="text-xs text-muted-foreground" role="status">
        {data
          ? `Última atualização: ${new Date(data.updatedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} (Brasília)`
          : "Aguardando primeira atualização"}
        {snapshot.isFetching ? " · Atualizando indicadores…" : ""} · MER sem
        investimento é exibido como —.
      </p>
    </div>
  );
}
