import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { format } from "date-fns";
import {
  ArrowUpRight,
  ChevronRight,
  Megaphone,
  Package,
  ScanText,
  BarChart3,
} from "lucide-react";
import { GlassMetricCard } from "@/components/glass-metric-card";
import {
  ProductCampaignMonitor,
  type AgreedPause,
} from "@/components/product-campaign-monitor";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UpManagerCardLoader } from "@/components/up-manager-card-loader";
import { UpManagerInbox } from "@/components/up-manager-inbox";
import { ManagerB2cReport } from "@/components/up-manager-b2c-report";
import { useAuth } from "@/lib/auth";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import { useUpManagerBrands } from "@/lib/up-manager-pilot";

type MetricKey =
  | "approvedRevenue"
  | "orders"
  | "averageOrder"
  | "costPerPurchase"
  | "spend"
  | "roas"
  | "cac"
  | "returningBuyers"
  | "newBuyers"
  | "repeatRate";
interface Campaign {
  id: string;
  name: string;
  status?: string;
  spend: number;
  impressions: number;
  purchases: number;
  revenue: number;
  roas: number | null;
}
interface Overview {
  clientName: string;
  currency: string;
  metrics: Record<MetricKey, number | null>;
  previous: Record<MetricKey, number | null>;
  mediaAvailable: boolean;
  campaigns: Campaign[] | null;
}
interface Variant {
  id: string;
  sku: string | null;
  options: string[];
  size: string | null;
  color: string | null;
  stock: number | null;
  units: number;
  current: boolean;
}
interface Product {
  id: string;
  name: string;
  imageUrl: string | null;
  stock: number | null;
  revenue: number;
  units: number;
  variants: Variant[];
}
interface ProductReport {
  products: Product[];
  stockObservedAt: string | null;
}
interface Finding {
  id: string;
  title: string;
  evidence: string;
  action: string;
  section: "campaigns" | "products" | "analysis";
  priority?: "P0" | "P1" | "P2";
  hypothesis?: string;
  owner?: string;
  followUp?: string;
}
interface Report {
  analysisDay: string;
  dateFrom: string;
  dateTo: string;
  createdAt: string;
  payload: {
    findings: Finding[];
    runId?: string;
    trigger?: "manual" | "scheduled";
    summary?: string;
  };
}
const ACTION_LABELS = {
  pending: "Pausa em verificação",
  paused: "Anúncio pausado",
  stale: "Evidência mudou. Atualize a análise.",
  uncertain: "Status pendente. Confira na Meta.",
};
type ActionStatus = keyof typeof ACTION_LABELS;
interface DecisionReport {
  pauseAvailable?: boolean;
  history: Report[];
  actions: {
    recommendationId: string;
    status: ActionStatus;
    evidence: { adName: string; productName: string };
    updatedAt: string;
  }[];
}

const metrics: {
  key: MetricKey;
  label: string;
  unit: "money" | "integer" | "ratio" | "pct";
  info: string;
  lowerIsBetter?: boolean;
}[] = [
  {
    key: "approvedRevenue",
    label: "Faturamento aprovado",
    unit: "money",
    info: "Valor pago dos pedidos da loja criados no período.",
  },
  {
    key: "orders",
    label: "Quantidade de vendas",
    unit: "integer",
    info: "Número de pedidos aprovados no período.",
  },
  {
    key: "averageOrder",
    label: "Ticket médio",
    unit: "money",
    info: "Faturamento aprovado dividido pelos pedidos aprovados.",
  },
  {
    key: "costPerPurchase",
    label: "Custo por compra",
    unit: "money",
    info: "Investimento Meta dividido pelo número de pedidos aprovados da loja.",
    lowerIsBetter: true,
  },
  {
    key: "spend",
    label: "Investimento em mídia",
    unit: "money",
    info: "Investimento registrado pela conta Meta no período.",
  },
  {
    key: "roas",
    label: "ROAS",
    unit: "ratio",
    info: "Receita atribuída pela Meta dividida pelo gasto na Meta.",
  },
  {
    key: "cac",
    label: "CAC blended",
    unit: "money",
    info: "Investimento Meta dividido pelos compradores de primeira compra na loja.",
    lowerIsBetter: true,
  },
  {
    key: "returningBuyers",
    label: "Recompradores",
    unit: "integer",
    info: "Compradores no período com uma compra aprovada anterior à janela, no histórico integrado.",
  },
  {
    key: "newBuyers",
    label: "Novos compradores",
    unit: "integer",
    info: "Compradores cuja primeira compra aprovada no histórico integrado ocorreu no período.",
  },
  {
    key: "repeatRate",
    label: "Porcentagem de recompra",
    unit: "pct",
    info: "Recompradores divididos pelo total de compradores únicos do período.",
  },
];

const number = new Intl.NumberFormat("pt-BR");
const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const showDate = (date: string) => date.split("-").reverse().join("/");
const showTime = (date: string) =>
  new Date(date).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });
const campaignStatus = (status?: string) =>
  ({
    ACTIVE: "Ativa",
    PAUSED: "Pausada",
    ARCHIVED: "Arquivada",
    DELETED: "Excluída",
  })[status ?? ""] ??
  status ??
  "Indisponível";

function ProductVariants({
  selected,
  clear,
  money,
}: {
  selected: Product | null;
  clear: () => void;
  money: (value: number) => string;
}) {
  const sizes = new Map<string, number>();
  for (const variant of selected?.variants ?? []) {
    const size = variant.size ?? "Tamanho não identificado";
    sizes.set(size, (sizes.get(size) ?? 0) + variant.units);
  }
  return (
    <Dialog
      open={Boolean(selected)}
      onOpenChange={(open) => {
        if (!open) clear();
      }}
    >
      <DialogContent
        className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl"
        data-testid="up-manager-variants"
      >
        <DialogHeader>
          <DialogTitle>{selected?.name}</DialogTitle>
          <DialogDescription>
            {selected &&
              `${number.format(selected.units)} unidades vendidas · ${money(selected.revenue)} em itens · estoque atual ${selected.stock ?? "indisponível"}`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          {[...sizes].map(([size, units]) => (
            <Badge variant="secondary" key={size}>
              {size} · {number.format(units)} un.
            </Badge>
          ))}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tamanho</TableHead>
              <TableHead>Cor / opções</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead className="text-right">Vendidas</TableHead>
              <TableHead className="text-right">Estoque</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {selected?.variants.map((variant) => (
              <TableRow key={variant.id}>
                <TableCell>{variant.size ?? "—"}</TableCell>
                <TableCell>
                  {variant.color ?? (variant.options.join(" / ") || "—")}
                  {!variant.current && (
                    <span className="block text-xs text-muted-foreground">
                      Vínculo com catálogo atual indisponível
                    </span>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {variant.sku ?? "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {number.format(variant.units)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {variant.stock === null ? "—" : number.format(variant.stock)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}

function UpManager({ clientId, admin }: { clientId: string; admin: boolean }) {
  const { dateRange } = useDashboardFilters();
  const queryClient = useQueryClient();
  const dateFrom = format(dateRange.from, "yyyy-MM-dd");
  const dateTo = format(dateRange.to, "yyyy-MM-dd");
  const query = new URLSearchParams({ clientId, dateFrom, dateTo }).toString();
  const decisionKey = ["up-manager", "decisions", clientId];
  const [selectedProductId, setSelectedProductId] = useState<string | null>(
    null,
  );
  const [selectedPause, setSelectedPause] = useState<AgreedPause | null>(null);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [campaignShortcut, setCampaignShortcut] = useState(0);
  const overview = useQuery({
    queryKey: ["up-manager", "overview", query],
    queryFn: () => customFetch<Overview>(`/api/up-manager?${query}`),
    retry: 1,
  });
  const products = useQuery({
    queryKey: ["up-manager", "products", query],
    queryFn: () =>
      customFetch<ProductReport>(`/api/up-manager/products?${query}`),
    retry: 1,
  });
  const decisions = useQuery({
    queryKey: decisionKey,
    queryFn: () =>
      customFetch<DecisionReport>(`/api/up-manager/decisions?${query}`),
    retry: 1,
  });
  const diagnosis = useMutation({
    mutationFn: () =>
      customFetch<Report>(`/api/up-manager/diagnosis?${query}`, {
        method: "POST",
      }),
    onSuccess: async (report) => {
      setSelectedRun(report.payload.runId ?? null);
      await queryClient.invalidateQueries({ queryKey: decisionKey });
    },
  });
  const pause = useMutation({
    mutationFn: (action: AgreedPause) =>
      customFetch<{ status: ActionStatus }>(`/api/up-manager/pause?${query}`, {
        method: "POST",
        body: JSON.stringify({ recommendationId: action.id, confirm: true }),
      }),
    onSuccess: async () => {
      setSelectedPause(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: decisionKey }),
        queryClient.invalidateQueries({ queryKey: ["up-manager", "overview"] }),
      ]);
    },
  });
  const recent = decisions.data?.history;
  const latestDaily = recent?.find(
    (item) => item.payload.trigger === "scheduled",
  );
  const activeReport =
    (diagnosis.data?.payload.runId === selectedRun
      ? diagnosis.data
      : undefined) ??
    recent?.find((item) => item.payload.runId === selectedRun) ??
    latestDaily ??
    recent?.find(
      (item) => item.dateFrom === dateFrom && item.dateTo === dateTo,
    );
  const selectedProduct =
    products.data?.products.find(({ id }) => id === selectedProductId) ?? null;
  const money = (value: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: overview.data?.currency ?? "BRL",
    }).format(value);
  const formats = {
    money,
    integer: (value: number) => number.format(value),
    ratio: (value: number) => `${decimal.format(value)}×`,
    pct: (value: number) => `${decimal.format(value)}%`,
  };
  const showMoney = (value: number | null) =>
    value === null ? "—" : money(value);

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 pb-5" data-testid="up-manager-page">
      <Card id="up-manager-decisions" className="scroll-mt-24 rounded-2xl">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-lg tracking-tight">
            Operação da marca
          </CardTitle>
          <div className="flex flex-wrap items-center gap-1.5">
            <nav aria-label="Dados do Up Manager" className="flex flex-wrap gap-1">
              <Button variant="ghost" size="sm" asChild><a href="#up-manager-indicators"><BarChart3 className="size-4" aria-hidden /> Indicadores</a></Button>
              <Button variant="ghost" size="sm" onClick={() => setCampaignShortcut((value) => value + 1)}><Megaphone className="size-4" aria-hidden /> Ações de mídia</Button>
              <Button variant="ghost" size="sm" asChild><a href="#up-manager-products"><Package className="size-4" aria-hidden /> Produtos</a></Button>
            </nav>
          <Button
            variant="outline"
            size="sm"
            onClick={() => diagnosis.mutate()}
            disabled={diagnosis.isPending}
          >
            <ScanText className="mr-1.5 size-4" />
            {diagnosis.isPending ? "Gerando diagnóstico…" : "Gerar diagnóstico"}
          </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {(diagnosis.error || decisions.error) && (
            <Alert variant="destructive">
              <AlertDescription>
                {(diagnosis.error ?? decisions.error)?.message}
              </AlertDescription>
            </Alert>
          )}
          {activeReport?.payload.runId ? (
            <UpManagerInbox
              key={`${activeReport.payload.runId}:${campaignShortcut}`}
              initialTopic={campaignShortcut ? "campaigns" : "all"}
              clientId={clientId}
              runId={activeReport.payload.runId}
              processing={diagnosis.isPending}
            />
          ) : decisions.isLoading || diagnosis.isPending ? (
            <UpManagerCardLoader label="Carregando diagnóstico" />
          ) : (
            <p className="text-sm text-muted-foreground">Gere um diagnóstico para começar a revisar os insights.</p>
          )}
          {activeReport?.payload.runId && (
            <details className="rounded-xl border p-3 text-sm">
              <summary className="cursor-pointer font-medium">
                Ver análise completa e fontes
              </summary>
              <div className="mt-3">
                <ManagerB2cReport
                  clientId={clientId}
                  runId={activeReport.payload.runId}
                />
              </div>
            </details>
          )}
          {recent?.length ? (
            <details className="rounded-xl border p-3 text-sm">
              <summary className="cursor-pointer font-medium">
                Histórico de diagnósticos
              </summary>
              <ul className="mt-2 space-y-1">
                {recent
                  .filter((item) => item.payload.runId)
                  .map((item) => (
                    <li
                      key={item.payload.runId}
                      className="flex flex-wrap items-center justify-between gap-1 border-t pt-2"
                    >
                      <span>
                        {showDate(item.dateFrom)}
                        {item.dateFrom === item.dateTo
                          ? ""
                          : ` a ${showDate(item.dateTo)}`}{" "}
                        ·{" "}
                        {item.payload.trigger === "scheduled"
                          ? "Diário"
                          : "Manual"}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-pressed={
                          activeReport?.payload.runId === item.payload.runId
                        }
                        onClick={() =>
                          setSelectedRun(item.payload.runId ?? null)
                        }
                      >
                        {activeReport?.payload.runId === item.payload.runId
                          ? "Em exibição"
                          : "Abrir diagnóstico"}
                      </Button>
                    </li>
                  ))}
              </ul>
            </details>
          ) : null}
        </CardContent>
      </Card>

      {overview.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            {overview.error.message}{" "}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => overview.refetch()}
            >
              Tentar novamente
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <section
        id="up-manager-indicators"
        aria-label="Indicadores principais"
        className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-5"
      >
        {metrics.map(({ key, label, unit, info, lowerIsBetter }) => (
          <GlassMetricCard
            key={key}
            label={label}
            value={overview.data?.metrics[key] ?? "—"}
            format={formats[unit]}
            previousValue={overview.data?.previous[key] ?? null}
            hideComparison={
              overview.data?.metrics[key] == null || key === "repeatRate"
            }
            loading={overview.isLoading}
            info={info}
            lowerIsBetter={lowerIsBetter}
          />
        ))}
      </section>

      <details id="up-manager-campaigns" className="rounded-xl border p-3">
        <summary className="cursor-pointer text-sm font-medium">Dados das campanhas</summary>
      <Card className="mt-3">
        <CardHeader>
          <CardTitle className="text-base">Campanhas Meta</CardTitle>
          <CardDescription>
            Desempenho no período selecionado. Compras e receita atribuídas pela
            Meta.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {overview.isLoading ? (
            <UpManagerCardLoader label="Carregando campanhas" />
          ) : !overview.data?.mediaAvailable ? (
            <p className="text-sm text-muted-foreground">
              Dados da Meta indisponíveis para este período.
            </p>
          ) : !overview.data.campaigns?.length ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma campanha com entrega registrada no período.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campanha</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Investimento</TableHead>
                  <TableHead className="text-right">Impressões</TableHead>
                  <TableHead className="text-right">Compras</TableHead>
                  <TableHead className="text-right">
                    Receita atribuída
                  </TableHead>
                  <TableHead className="text-right">ROAS</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.data.campaigns.map((campaign) => (
                  <TableRow key={campaign.id}>
                    <TableCell>
                      <a
                        className="inline-flex items-center gap-1 font-medium hover:underline"
                        href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?selected_campaign_ids=${encodeURIComponent(campaign.id)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {campaign.name}
                        <ArrowUpRight className="size-3 shrink-0" />
                      </a>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {campaignStatus(campaign.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {money(campaign.spend)}
                    </TableCell>
                    <TableCell className="text-right">
                      {number.format(campaign.impressions)}
                    </TableCell>
                    <TableCell className="text-right">
                      {number.format(campaign.purchases)}
                    </TableCell>
                    <TableCell className="text-right">
                      {money(campaign.revenue)}
                    </TableCell>
                    <TableCell className="text-right">
                      {campaign.roas === null
                        ? "—"
                        : formats.ratio(campaign.roas)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <details className="mt-4 rounded-xl border p-3 text-sm">
            <summary className="cursor-pointer font-medium">
              Vínculo de anúncios com estoque
            </summary>
            <div className="mt-3">
              <ProductCampaignMonitor
                reviewOnly
                renderAgreed={
                  admin && decisions.data?.pauseAvailable
                    ? (item) => {
                        const action = decisions.data.actions.find(
                          ({ recommendationId }) =>
                            recommendationId === item.id,
                        );
                        return action ? (
                          <Badge variant="outline">
                            {ACTION_LABELS[action.status]}
                          </Badge>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              pause.reset();
                              setSelectedPause(item);
                            }}
                          >
                            Pausar anúncio
                          </Button>
                        );
                      }
                    : undefined
                }
              />
              {pause.data && (
                <p role="status" className="text-sm">
                  {ACTION_LABELS[pause.data.status]}
                </p>
              )}
            </div>
          </details>
          {decisions.data?.actions.length ? (
            <details className="rounded-lg border p-3 text-sm">
              <summary className="cursor-pointer font-medium">
                Histórico de ações na Meta
              </summary>
              <ul className="mt-2 space-y-1 text-muted-foreground">
                {decisions.data.actions.map(
                  ({ recommendationId, evidence, status, updatedAt }) => (
                    <li key={recommendationId}>
                      {showTime(updatedAt)} · {evidence.adName} ·{" "}
                      {ACTION_LABELS[status]}
                    </li>
                  ),
                )}
              </ul>
            </details>
          ) : null}
        </CardContent>
      </Card>
      </details>

      <Card id="up-manager-products">
        <CardHeader>
          <CardTitle className="text-base">Produtos mais vendidos</CardTitle>
          <CardDescription>
            Até 20 produtos por unidades vendidas no período.{" "}
            {products.data?.stockObservedAt
              ? `Estoque consultado em ${showTime(products.data.stockObservedAt)}.`
              : "O estoque aparece quando o catálogo está disponível."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {products.isError ? (
            <Alert variant="destructive">
              <AlertDescription>
                {products.error.message}{" "}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => products.refetch()}
                >
                  Tentar novamente
                </Button>
              </AlertDescription>
            </Alert>
          ) : products.isLoading ? (
            <UpManagerCardLoader label="Carregando produtos" />
          ) : !products.data?.products.length ? (
            <p className="text-sm text-muted-foreground">
              Nenhum produto vendido no período.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead className="text-right">
                    Unidades vendidas
                  </TableHead>
                  <TableHead className="text-right">
                    Receita dos itens
                  </TableHead>
                  <TableHead className="text-right">Estoque atual</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.data.products.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell>
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 rounded-sm text-left font-medium hover:underline focus-visible:ring-2 focus-visible:ring-primary"
                        onClick={() => setSelectedProductId(product.id)}
                      >
                        {product.imageUrl && (
                          <img
                            className="size-9 rounded border object-cover"
                            src={product.imageUrl}
                            alt=""
                            loading="lazy"
                          />
                        )}
                        {product.name}
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      </button>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {number.format(product.units)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(product.revenue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {product.stock === null
                        ? "—"
                        : number.format(product.stock)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ProductVariants
        selected={selectedProduct}
        clear={() => setSelectedProductId(null)}
        money={money}
      />
      <AlertDialog
        open={Boolean(selectedPause)}
        onOpenChange={(open) => {
          if (!open && !pause.isPending) setSelectedPause(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar pausa na Meta</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedPause &&
                `Confirme a pausa do anúncio ${selectedPause.adName}, vinculado a ${selectedPause.productName}. O Updash vai conferir o estoque e a veiculação novamente antes de aplicar a mudança.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pause.error && (
            <p role="alert" className="text-sm text-destructive">
              {pause.error.message}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pause.isPending}>
              Voltar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={pause.isPending || !selectedPause}
              onClick={(event) => {
                event.preventDefault();
                if (selectedPause) pause.mutate(selectedPause);
              }}
            >
              {pause.isPending ? "Verificando…" : "Confirmar pausa"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function UpManagerPage() {
  const { user, selectedClientId, setSelectedClientId, setSelectedDashboardMode } = useAuth();
  const brands = useUpManagerBrands();
  const admin = user?.role === "ADMIN";
  const clientId = admin ? selectedClientId : user?.clientId;
  const brand = brands.data?.find(({ id }) => id === clientId);
  if (brands.isPending) return <UpManagerCardLoader label="Carregando as marcas do Up Manager" />;
  if (brand) return <UpManager key={brand.id} clientId={brand.id} admin={admin} />;
  return <Card className="space-y-3 p-5">
    <CardTitle>Up Manager</CardTitle>
    <CardDescription>{brands.isError ? "Não foi possível carregar as marcas." : "Selecione uma marca habilitada."}</CardDescription>
    {brands.isError ? <Button size="sm" variant="outline" onClick={() => brands.refetch()}>Tentar novamente</Button> :
      <div className="flex flex-wrap gap-2">{brands.data?.map(({ id, name }) => <Button key={id} size="sm" variant="outline" onClick={() => {
        setSelectedDashboardMode("B2C");
        setSelectedClientId(id);
      }}>{name}</Button>)}</div>}
  </Card>;
}
