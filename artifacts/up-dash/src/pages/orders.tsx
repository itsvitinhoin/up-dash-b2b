import { useMemo, useState } from "react";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import { useI18n } from "@/lib/i18n";
import { formatCurrency, formatCurrencySmart, formatNumber, formatPercentage } from "@/lib/formatters";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DashboardKpiCard } from "@/components/dashboard-kpi-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Eye,
  Package,
  ReceiptText,
  Search,
  ShoppingBag,
  TrendingUp,
  UserRoundCheck,
  Users,
  WalletCards,
} from "lucide-react";

type OrderOrigin = {
  source: string;
  medium: string;
  campaign: string;
  label: string;
  attribution: "tracking" | "customer_utm" | "direct";
};

type OrdersPageRow = {
  id: string;
  externalId: string | null;
  status: string;
  amount: number;
  fulfilledAmount: number;
  grossAmount: number;
  discountAmount: number;
  shippingAmount: number;
  requestedQuantity: number;
  fulfilledQuantity: number;
  approvalDate: string | null;
  createdAt: string;
  customerId: string;
  customerExternalId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  documentType: "CPF" | "CNPJ" | null;
  document: string | null;
  state: string | null;
  city: string | null;
  origin: OrderOrigin;
};

type OrdersPageResponse = {
  period: { from: string; to: string };
  kpis: {
    requestedRevenue: number;
    fulfilledRevenue: number;
    requestedQuantity: number;
    fulfilledQuantity: number;
    fulfilledPct: number;
    orders: number;
    newCustomers: number;
    returningCustomers: number;
    retentionPct: number;
    conversionPct: number;
    approvedLeads: number;
    sessions: number;
  };
  rows: OrdersPageRow[];
  page: number;
  limit: number;
  total: number;
};

type OrderDetailsResponse = {
  order: OrdersPageRow & {
    cancelledAmount: number;
    refundedAmount: number;
    customerState: string | null;
    customerCity: string | null;
  };
  customer: {
    id: string | null;
    externalId: string | null;
    name: string | null;
    email: string | null;
    phone: string | null;
    state: string | null;
    city: string | null;
    documentType: "CPF" | "CNPJ" | null;
    document: string | null;
    totalOrders: number | null;
    totalSpent: number | null;
  };
  items: Array<{
    id: string;
    quantity: number;
    fulfilledQuantity: number;
    priceAtSale: number;
    grossPriceAtSale: number;
    discountAmount: number;
    size: string | null;
    color: string | null;
    productId: string;
    sku: string;
    name: string;
    category: string | null;
    imageUrl: string | null;
  }>;
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function ProductMiniature({ imageUrl, name }: { imageUrl?: string | null; name: string }) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={name}
        className="h-11 w-11 shrink-0 rounded-md border border-border object-cover"
      />
    );
  }
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border bg-primary/10 text-[11px] font-semibold text-primary">
      {initials || "P"}
    </div>
  );
}

function statusClass(status: string) {
  if (["APPROVED", "SHIPPED", "DELIVERED"].includes(status)) {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-400";
  }
  if (status === "REJECTED") return "border-red-500/30 bg-red-500/10 text-red-400";
  return "border-amber-500/30 bg-amber-500/10 text-amber-400";
}

function originClass(origin: OrderOrigin) {
  if (origin.attribution === "tracking") return "border-blue-500/30 bg-blue-500/10 text-blue-400";
  if (origin.attribution === "customer_utm") return "border-violet-500/30 bg-violet-500/10 text-violet-400";
  return "border-border bg-muted text-muted-foreground";
}

export default function OrdersPage() {
  const { t } = useI18n();
  const { selectedClientId, selectedDashboardMode, user } = useAuth();
  const { dateRange } = useDashboardFilters();
  const clientId = user?.role === "ADMIN" ? selectedClientId || undefined : undefined;
  const enabled = user?.role === "CLIENT" || (user?.role === "ADMIN" && !!selectedClientId);
  const isB2C = selectedDashboardMode === "B2C";
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<OrdersPageRow | null>(null);
  const limit = 10;

  const dateFrom = format(dateRange.from, "yyyy-MM-dd");
  const dateTo = format(dateRange.to, "yyyy-MM-dd");

  const queryString = useMemo(() => {
    const params = new URLSearchParams({
      dateFrom,
      dateTo,
      page: String(page),
      limit: String(limit),
    });
    if (clientId) params.set("clientId", clientId);
    if (search.trim()) params.set("search", search.trim());
    return params.toString();
  }, [clientId, dateFrom, dateTo, page, search]);

  const { data, isLoading, isError } = useQuery<OrdersPageResponse>({
    queryKey: ["orders-page", queryString],
    queryFn: () => customFetch<OrdersPageResponse>(`/api/analytics/orders-page?${queryString}`),
    enabled,
  });

  const detailsParams = useMemo(() => {
    const params = new URLSearchParams();
    if (clientId) params.set("clientId", clientId);
    return params.toString();
  }, [clientId]);

  const { data: details, isLoading: detailsLoading, isError: detailsError } = useQuery<OrderDetailsResponse>({
    queryKey: ["orders-page-details", clientId, selectedOrder?.id],
    queryFn: () => {
      if (!selectedOrder) throw new Error("Pedido não selecionado.");
      return customFetch<OrderDetailsResponse>(
        `/api/analytics/orders-page/${selectedOrder.id}${detailsParams ? `?${detailsParams}` : ""}`,
      );
    },
    enabled: enabled && !!selectedOrder,
  });

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / limit));

  if (!enabled) {
    return (
      <Card className="border-border bg-card">
        <CardContent className="flex min-h-[360px] flex-col items-center justify-center p-8 text-center">
          <ShoppingBag className="mb-3 h-10 w-10 text-muted-foreground" />
          <h2 className="text-lg font-semibold">{t("orders.selectBrand.title", "Selecione uma marca")}</h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            {t("orders.selectBrand.body", "A página de pedidos precisa de uma marca ativa para calcular faturamento, clientes e origem dos pedidos.")}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6" data-testid="orders-page">
      {isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{t("orders.loadError", "Não foi possível carregar os pedidos do período.")}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        {isLoading ? (
          Array.from({ length: 10 }).map((_, index) => <Skeleton key={index} className="h-[164px] rounded-xl" />)
        ) : (
          <>
            <DashboardKpiCard
              label={isB2C ? "Faturamento faturado" : t("orders.kpi.requestedRevenue", "Faturamento solicitado")}
              value={data?.kpis.requestedRevenue ?? 0}
              format={formatCurrencySmart}
              icon={WalletCards}
              iconClass="bg-blue-500/10 text-blue-400"
              change={null}
              changeLabel=""
              sub={[{ label: "Base", value: isB2C ? "Não cancelados" : "Valor solicitado" }]}
              sparkValues={[]}
              sparkColor="#60a5fa"
              isLoading={false}
              testId="orders-kpi-requested-revenue"
              valueAccent
            />
            <DashboardKpiCard
              label={isB2C ? "Faturamento pago" : t("orders.kpi.fulfilledRevenue", "Faturamento atendido")}
              value={data?.kpis.fulfilledRevenue ?? 0}
              format={formatCurrencySmart}
              icon={BadgeCheck}
              iconClass="bg-emerald-500/10 text-emerald-400"
              change={null}
              changeLabel=""
              sub={[{ label: "Base", value: isB2C ? "Pedidos pagos" : "Valor atendido" }]}
              sparkValues={[]}
              sparkColor="#34d399"
              isLoading={false}
              testId="orders-kpi-fulfilled-revenue"
            />
            <DashboardKpiCard
              label={isB2C ? "Peças faturadas" : t("orders.kpi.requestedQuantity", "Peças solicitadas")}
              value={data?.kpis.requestedQuantity ?? 0}
              format={formatNumber}
              icon={Package}
              iconClass="bg-violet-500/10 text-violet-400"
              change={null}
              changeLabel=""
              sub={[{ label: "Base", value: isB2C ? "Qtd faturada" : "Qtd solicitada" }]}
              sparkValues={[]}
              sparkColor="#a78bfa"
              isLoading={false}
              testId="orders-kpi-requested-quantity"
            />
            <DashboardKpiCard
              label={isB2C ? "Peças pagas" : t("orders.kpi.fulfilledQuantity", "Peças atendidas")}
              value={data?.kpis.fulfilledQuantity ?? 0}
              format={formatNumber}
              icon={ShoppingBag}
              iconClass="bg-amber-500/10 text-amber-400"
              change={null}
              changeLabel=""
              sub={[{ label: "Base", value: isB2C ? "Qtd paga" : "Qtd atendida" }]}
              sparkValues={[]}
              sparkColor="#f59e0b"
              isLoading={false}
              testId="orders-kpi-fulfilled-quantity"
            />
            <DashboardKpiCard
              label={isB2C ? "% Pago" : t("orders.kpi.fulfilledPct", "% de atendido")}
              value={data?.kpis.fulfilledPct ?? 0}
              format={formatPercentage}
              icon={TrendingUp}
              iconClass="bg-cyan-500/10 text-cyan-400"
              change={null}
              changeLabel=""
              sub={[{ label: "Cálculo", value: isB2C ? "Pago / faturado" : "Atendido / solicitado" }]}
              sparkValues={[]}
              sparkColor="#22d3ee"
              ringValue={data?.kpis.fulfilledPct ?? 0}
              isLoading={false}
              testId="orders-kpi-fulfilled-pct"
            />
            <DashboardKpiCard
              label={t("orders.kpi.orders", "Qtd de pedidos")}
              value={data?.kpis.orders ?? 0}
              format={formatNumber}
              icon={ReceiptText}
              iconClass="bg-sky-500/10 text-sky-400"
              change={null}
              changeLabel=""
              sub={[{ label: "Período", value: "Pedidos criados" }]}
              sparkValues={[]}
              sparkColor="#38bdf8"
              isLoading={false}
              testId="orders-kpi-orders"
            />
            <DashboardKpiCard
              label={isB2C ? "Novos compradores" : t("orders.kpi.newCustomers", "Clientes novos")}
              value={data?.kpis.newCustomers ?? 0}
              format={formatNumber}
              icon={UserRoundCheck}
              iconClass="bg-lime-500/10 text-lime-400"
              change={null}
              changeLabel=""
              sub={[{ label: "Regra", value: "1ª compra no período" }]}
              sparkValues={[]}
              sparkColor="#84cc16"
              isLoading={false}
              testId="orders-kpi-new-customers"
            />
            <DashboardKpiCard
              label={isB2C ? "Recompradores" : t("orders.kpi.returningCustomers", "Clientes recorrentes")}
              value={data?.kpis.returningCustomers ?? 0}
              format={formatNumber}
              icon={Users}
              iconClass="bg-purple-500/10 text-purple-400"
              change={null}
              changeLabel=""
              sub={[{ label: "Regra", value: "Já compraram antes" }]}
              sparkValues={[]}
              sparkColor="#c084fc"
              isLoading={false}
              testId="orders-kpi-returning-customers"
            />
            <DashboardKpiCard
              label={t("orders.kpi.retentionPct", "% de retenção")}
              value={data?.kpis.retentionPct ?? 0}
              format={formatPercentage}
              icon={Users}
              iconClass="bg-rose-500/10 text-rose-400"
              change={null}
              changeLabel=""
              sub={[{ label: "Cálculo", value: "Recorrentes / compradores" }]}
              sparkValues={[]}
              sparkColor="#fb7185"
              ringValue={data?.kpis.retentionPct ?? 0}
              isLoading={false}
              testId="orders-kpi-retention-pct"
            />
            <DashboardKpiCard
              label={t("orders.kpi.conversionPct", "% de conversão")}
              value={data?.kpis.conversionPct ?? 0}
              format={formatPercentage}
              icon={ShoppingBag}
              iconClass="bg-orange-500/10 text-orange-400"
              change={null}
              changeLabel=""
              sub={[{ label: "Base", value: isB2C ? `${formatNumber(data?.kpis.sessions ?? 0)} sessões` : `${formatNumber(data?.kpis.approvedLeads ?? 0)} aprovados` }]}
              sparkValues={[]}
              sparkColor="#fb923c"
              ringValue={data?.kpis.conversionPct ?? 0}
              isLoading={false}
              testId="orders-kpi-conversion-pct"
            />
          </>
        )}
      </div>

      <Card className="border-border bg-card">
        <CardContent className="p-5">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <ShoppingBag className="h-4 w-4 text-primary" />
                {t("orders.list.title", "Lista de pedidos")}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("orders.list.description", "Pedidos do período com quantidades, valores, documento e origem de aquisição.")}
              </p>
            </div>
            <div className="relative w-full lg:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => {
                  setPage(1);
                  setSearch(event.target.value);
                }}
                placeholder={t("orders.search.placeholder", "Buscar pedido, cliente ou documento")}
                className="pl-9"
              />
            </div>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 7 }).map((_, index) => <Skeleton key={index} className="h-16 w-full" />)}
            </div>
          ) : !data || data.rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Package className="mb-3 h-10 w-10 text-muted-foreground" />
              <p className="font-medium">{t("orders.empty.title", "Nenhum pedido encontrado")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("orders.empty.body", "Ajuste o período ou remova a busca para ver mais pedidos.")}</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[170px]">{t("orders.table.order", "Pedido")}</TableHead>
                      <TableHead className="min-w-[230px]">{t("orders.table.customer", "Cliente")}</TableHead>
                      <TableHead>{t("orders.table.document", "Documento")}</TableHead>
                      <TableHead className="text-right">{isB2C ? "Qtd faturada" : t("orders.table.requestedQty", "Qtd solicitada")}</TableHead>
                      <TableHead className="text-right">{isB2C ? "Qtd paga" : t("orders.table.fulfilledQty", "Qtd atendida")}</TableHead>
                      <TableHead className="text-right">{isB2C ? "Valor faturado" : t("orders.table.requestedValue", "Valor solicitado")}</TableHead>
                      <TableHead className="text-right">{isB2C ? "Valor pago" : t("orders.table.fulfilledValue", "Valor atendido")}</TableHead>
                      <TableHead className="min-w-[220px]">{t("orders.table.origin", "Origem")}</TableHead>
                      <TableHead>{t("orders.table.status", "Status")}</TableHead>
                      <TableHead className="text-right">{t("orders.table.details", "Detalhes")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((order) => (
                      <TableRow key={order.id} className="hover:bg-muted/30">
                        <TableCell>
                          <div className="font-medium">#{order.externalId ?? order.id.slice(0, 8)}</div>
                          <div className="text-xs text-muted-foreground">{formatDateTime(order.createdAt)}</div>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{order.customerName ?? "Cliente sem nome"}</div>
                          <div className="text-xs text-muted-foreground">{order.customerEmail ?? order.customerPhone ?? "—"}</div>
                        </TableCell>
                        <TableCell>
                          {order.documentType ? (
                            <Badge variant="outline" className="gap-1 border-sky-500/30 bg-sky-500/10 text-sky-400">
                              {order.documentType}
                              {order.document ? <span className="font-mono">{order.document}</span> : null}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(order.requestedQuantity)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(order.fulfilledQuantity)}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{formatCurrency(order.amount)}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{formatCurrency(order.fulfilledAmount)}</TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Badge variant="outline" className={`w-fit max-w-[260px] justify-start truncate ${originClass(order.origin)}`}>
                              {order.origin.label}
                            </Badge>
                            <span className="truncate text-xs text-muted-foreground">
                              {order.origin.medium} · {order.origin.campaign}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={statusClass(order.status)}>
                            {order.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" onClick={() => setSelectedOrder(order)}>
                            <Eye className="mr-2 h-4 w-4" />
                            {t("orders.details.button", "Ver")}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Página {formatNumber(page)} de {formatNumber(totalPages)} · {formatNumber(data.total)} pedidos
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    {t("orders.pagination.previous", "Anterior")}
                  </Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>
                    {t("orders.pagination.next", "Próxima")}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedOrder} onOpenChange={(open) => !open && setSelectedOrder(null)}>
        <DialogContent className="max-h-[86vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Pedido #{selectedOrder?.externalId ?? selectedOrder?.id.slice(0, 8)}</DialogTitle>
            <DialogDescription>Produtos vendidos, variações, quantidades e valores do pedido.</DialogDescription>
          </DialogHeader>

          {detailsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-20 w-full" />)}
            </div>
          ) : detailsError || !details ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>Não foi possível carregar os detalhes deste pedido.</AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-border p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{isB2C ? "Valor faturado" : "Valor solicitado"}</p>
                  <p className="text-lg font-semibold">{formatCurrency(details.order.amount)}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{isB2C ? "Valor pago" : "Valor atendido"}</p>
                  <p className="text-lg font-semibold">{formatCurrency(details.order.fulfilledAmount)}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{isB2C ? "Peças faturadas" : "Peças solicitadas"}</p>
                  <p className="text-lg font-semibold">{formatNumber(details.order.requestedQuantity)}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{isB2C ? "Peças pagas" : "Peças atendidas"}</p>
                  <p className="text-lg font-semibold">{formatNumber(details.order.fulfilledQuantity)}</p>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg border border-border p-4">
                  <h3 className="mb-2 text-sm font-semibold">Cliente</h3>
                  <div className="space-y-1 text-sm">
                    <p>{details.customer.name ?? "Sem nome"}</p>
                    <p className="text-muted-foreground">{details.customer.email ?? "Sem email"}</p>
                    <p className="text-muted-foreground">{details.customer.phone ?? "Sem telefone"}</p>
                    <p className="text-muted-foreground">
                      {[details.customer.city, details.customer.state].filter(Boolean).join(" / ") || "Sem localização"}
                    </p>
                    <p className="text-muted-foreground">
                      {details.customer.documentType ? `${details.customer.documentType}: ${details.customer.document ?? "mascarado"}` : "Sem documento"}
                    </p>
                  </div>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <h3 className="mb-2 text-sm font-semibold">Pedido</h3>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <span className="text-muted-foreground">Status</span><span>{details.order.status}</span>
                    <span className="text-muted-foreground">Criado em</span><span>{formatDateTime(details.order.createdAt)}</span>
                    <span className="text-muted-foreground">Aprovado em</span><span>{formatDateTime(details.order.approvalDate)}</span>
                    <span className="text-muted-foreground">Frete</span><span>{formatCurrency(details.order.shippingAmount)}</span>
                    <span className="text-muted-foreground">Desconto</span><span>{formatCurrency(details.order.discountAmount)}</span>
                    <span className="text-muted-foreground">Cancelado</span><span>{formatCurrency(details.order.cancelledAmount)}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border">
                <div className="border-b border-border p-3">
                  <h3 className="text-sm font-semibold">Peças vendidas</h3>
                </div>
                <div className="divide-y divide-border">
                  {details.items.map((item) => (
                    <div key={item.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
                      <ProductMiniature imageUrl={item.imageUrl} name={item.name} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{item.name}</p>
                        <p className="text-xs text-muted-foreground">
                          SKU {item.sku}{item.category ? ` · ${item.category}` : ""}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Badge variant="outline">Cor: {item.color ?? "—"}</Badge>
                          <Badge variant="outline">Tamanho: {item.size ?? "—"}</Badge>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-4 text-right text-sm sm:min-w-[280px]">
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{isB2C ? "Faturada" : "Solicitada"}</p>
                          <p className="font-semibold tabular-nums">{formatNumber(item.quantity)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{isB2C ? "Paga" : "Atendida"}</p>
                          <p className="font-semibold tabular-nums">{formatNumber(item.fulfilledQuantity)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Valor</p>
                          <p className="font-semibold tabular-nums">{formatCurrency(item.priceAtSale)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
