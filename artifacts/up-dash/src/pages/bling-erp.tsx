import { Fragment, useDeferredValue, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format } from "date-fns";
import {
  Boxes,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Download,
  Link2,
  Package,
  ReceiptText,
  Search,
  Settings2,
  ShoppingBag,
  Store,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import {
  customFetch,
  type BlingDashboard,
  type BlingOrder,
  type BlingProduct,
  type BlingCustomer,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import {
  formatCurrency,
  formatCurrencySmart,
  formatNumber,
} from "@/lib/formatters";
import { exportRowsAsCsv } from "@/lib/csv-export";
import { BlingIntegration } from "@/components/bling-integration";
import { DashboardKpiCard } from "@/components/dashboard-kpi-card";
import {
  SectionTitle,
  Pagination,
  EmptyRow,
  BreakdownCard,
} from "@/components/erp/erp-ui";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { DashLoader } from "@/components/ui/dash-loader";

type View = "overview" | "orders" | "customers" | "products" | "stock";
type Metric = {
  label: string;
  value: number;
  currency?: boolean;
  icon: typeof Users;
  subLabel: string;
  subValue: string;
};
const MATCH = {
  matched: "Encontrado na Nuvemshop",
  unmatched: "Pendente de vínculo",
  ambiguous: "Mais de uma correspondência",
  other_channel: "Outro canal",
};
const TITLES: Record<View, string> = {
  overview: "Visão geral do ERP",
  orders: "Pedidos Bling",
  customers: "Compradores",
  products: "Produtos",
  stock: "Estoque",
};
const chartConfig = {
  value: { label: "Valor em pedidos", color: "hsl(var(--chart-1))" },
  orders: { label: "Pedidos", color: "hsl(var(--chart-2))" },
};
const date = (day: string | null) =>
  day ? day.split("-").reverse().join("/") : "—";
const ratio = (value: number, total: number) =>
  total ? `${formatNumber((value / total) * 100)}%` : "—";

function Kpis({ metrics }: { metrics: Metric[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map((m, i) => (
        <DashboardKpiCard
          key={m.label}
          icon={m.icon}
          iconClass={
            i % 2
              ? "bg-violet-500/10 text-violet-500"
              : "bg-primary/10 text-primary"
          }
          label={m.label}
          value={m.value}
          format={m.currency ? formatCurrency : formatNumber}
          source="ERP · Bling"
          change={null}
          changeLabel=""
          hideComparison
          sub={[{ label: m.subLabel, value: m.subValue }]}
          sparkValues={[]}
          sparkColor="hsl(var(--primary))"
          isLoading={false}
          testId={`bling-kpi-${i}`}
        />
      ))}
    </div>
  );
}

function OrderRows({ rows }: { rows: BlingOrder[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {[
            "Pedido",
            "Data",
            "Cliente",
            "Canal",
            "Itens",
            "Valor do pedido",
            "Situação",
            "Conciliação",
          ].map((h) => (
            <TableHead key={h}>{h}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <Fragment key={row.id}>
            <TableRow>
              <TableCell>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 px-1"
                  aria-expanded={expanded === row.id}
                  aria-label={`Detalhes do pedido ${row.number}`}
                  onClick={() =>
                    setExpanded(expanded === row.id ? null : row.id)
                  }
                >
                  {expanded === row.id ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  #{row.number}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Loja: {row.storeNumber || "—"}
                </p>
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {date(row.day)}
              </TableCell>
              <TableCell className="min-w-40">
                {row.customerName || "Não informado"}
              </TableCell>
              <TableCell className="min-w-36">{row.channelName}</TableCell>
              <TableCell>
                {formatNumber(
                  row.items.reduce((sum, item) => sum + item.quantity, 0),
                )}
              </TableCell>
              <TableCell className="whitespace-nowrap font-medium tabular-nums">
                {formatCurrency(row.total)}
              </TableCell>
              <TableCell>
                <Badge variant="outline">ID {row.statusId || "—"}</Badge>
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    row.reconciliation === "matched" ? "default" : "secondary"
                  }
                >
                  {MATCH[row.reconciliation]}
                </Badge>
              </TableCell>
            </TableRow>
            {expanded === row.id && (
              <TableRow>
                <TableCell colSpan={8} className="bg-muted/20 p-5">
                  <p className="mb-3 text-sm font-medium">
                    Itens do pedido #{row.number}
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {[
                          "Produto",
                          "SKU",
                          "Quantidade",
                          "Preço unitário",
                          "Valor dos itens",
                        ].map((h) => (
                          <TableHead key={h}>{h}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {row.items.map((item, index) => (
                        <TableRow key={`${item.id}:${index}`}>
                          <TableCell>{item.name}</TableCell>
                          <TableCell>{item.sku || "—"}</TableCell>
                          <TableCell>{formatNumber(item.quantity)}</TableCell>
                          <TableCell>
                            {formatCurrency(item.unitPrice)}
                          </TableCell>
                          <TableCell>
                            {formatCurrency(item.quantity * item.unitPrice)}
                          </TableCell>
                        </TableRow>
                      ))}
                      {!row.items.length && <EmptyRow colSpan={5} />}
                    </TableBody>
                  </Table>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Situação: ID {row.statusId || "—"} · Código{" "}
                    {row.statusValue || "—"}. O valor dos itens pode diferir do
                    total do pedido.
                  </p>
                </TableCell>
              </TableRow>
            )}
          </Fragment>
        ))}
        {!rows.length && <EmptyRow colSpan={8} />}
      </TableBody>
    </Table>
  );
}

function ProductRows({
  rows,
  stock,
}: {
  rows: BlingProduct[];
  stock: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {[
            "Produto / SKU",
            "Situação",
            ...(stock
              ? ["Físico", "Disponível", "Depósitos", "Unidades em pedidos"]
              : [
                  "Preço de cadastro",
                  "Unidades em pedidos",
                  "Valor dos itens",
                  "Disponível",
                ]),
          ].map((h) => (
            <TableHead key={h}>{h}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <Fragment key={row.id}>
            <TableRow>
              <TableCell>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto max-w-md gap-2 whitespace-normal px-0 text-left"
                  aria-expanded={expanded === row.id}
                  aria-label={`Detalhes de ${row.name}`}
                  onClick={() =>
                    setExpanded(expanded === row.id ? null : row.id)
                  }
                >
                  {expanded === row.id ? (
                    <ChevronDown className="h-4 w-4 shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0" />
                  )}
                  {row.name}
                </Button>
                <p className="mt-1 text-xs text-muted-foreground">
                  {row.sku || "Sem SKU"}
                  {row.parentId ? " · Variação" : ""}
                </p>
              </TableCell>
              <TableCell>
                <Badge variant="outline">
                  {row.status === "A"
                    ? "Ativo"
                    : row.status === "I"
                      ? "Inativo"
                      : row.status || "Não informado"}
                </Badge>
              </TableCell>
              {stock ? (
                <>
                  <TableCell>
                    {row.stock
                      ? formatNumber(row.stock.physical)
                      : "Não informado"}
                  </TableCell>
                  <TableCell>
                    {row.stock
                      ? formatNumber(row.stock.available)
                      : "Não informado"}
                  </TableCell>
                  <TableCell>{row.stock?.warehouses.length ?? "—"}</TableCell>
                  <TableCell>{formatNumber(row.units)}</TableCell>
                </>
              ) : (
                <>
                  <TableCell>{formatCurrency(row.price)}</TableCell>
                  <TableCell>{formatNumber(row.units)}</TableCell>
                  <TableCell>{formatCurrency(row.value)}</TableCell>
                  <TableCell>
                    {row.stock
                      ? formatNumber(row.stock.available)
                      : "Não informado"}
                  </TableCell>
                </>
              )}
            </TableRow>
            {expanded === row.id && (
              <TableRow>
                <TableCell colSpan={6} className="bg-muted/20 p-5">
                  <p className="mb-3 text-sm font-medium">
                    Estoque por depósito · {row.sku || row.id}
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Depósito no Bling</TableHead>
                        <TableHead>Físico</TableHead>
                        <TableHead>Disponível</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {row.stock?.warehouses.map((depot) => (
                        <TableRow key={depot.id}>
                          <TableCell>ID {depot.id}</TableCell>
                          <TableCell>{formatNumber(depot.physical)}</TableCell>
                          <TableCell>{formatNumber(depot.available)}</TableCell>
                        </TableRow>
                      ))}
                      {!row.stock?.warehouses.length && (
                        <TableRow>
                          <TableCell colSpan={3}>
                            Saldo por depósito não informado.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableCell>
              </TableRow>
            )}
          </Fragment>
        ))}
        {!rows.length && <EmptyRow colSpan={6} />}
      </TableBody>
    </Table>
  );
}

function CustomerOrders({
  clientId,
  customer,
  from,
  to,
  channel,
}: {
  clientId: string;
  customer: BlingCustomer;
  from: string;
  to: string;
  channel: string;
}) {
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({
    clientId,
    from,
    to,
    view: "orders",
    customerId: customer.id,
    page: String(page),
  });
  if (channel !== "all") params.set("channel", channel);
  const query = useQuery({
    queryKey: ["bling-customer-orders", params.toString()],
    queryFn: () =>
      customFetch<BlingDashboard>(`/api/analytics/erp/bling?${params}`),
    placeholderData: keepPreviousData,
    staleTime: 120000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  return query.isPending ? (
    <DashLoader label="Carregando pedidos do comprador" />
  ) : query.isError ? (
    <Alert variant="destructive">
      <AlertDescription>
        Não foi possível consultar os pedidos.{" "}
        <Button
          variant="outline"
          size="sm"
          onClick={() => void query.refetch()}
        >
          Tentar novamente
        </Button>
      </AlertDescription>
    </Alert>
  ) : (
    <>
      <div className="overflow-x-auto">
        <OrderRows rows={query.data.rows as BlingOrder[]} />
      </div>
      <Pagination
        page={query.data.page}
        disabled={query.isFetching}
        total={query.data.total}
        size={25}
        onChange={setPage}
      />
    </>
  );
}

function Overview({ data }: { data: BlingDashboard }) {
  const s = data.summary;
  return (
    <>
      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardContent className="p-5">
            <SectionTitle
              icon={TrendingUp}
              title="Evolução dos pedidos"
              description="Valor registrado no Bling por dia, em todas as situações selecionadas."
            />
            <ChartContainer
              config={chartConfig}
              className="mt-4 h-[300px] w-full aspect-auto"
            >
              <AreaChart data={s.daily}>
                <defs>
                  <linearGradient
                    id="bling-order-value"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="5%"
                      stopColor="var(--color-value)"
                      stopOpacity={0.3}
                    />
                    <stop
                      offset="95%"
                      stopColor="var(--color-value)"
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="day"
                  tickFormatter={(d) => date(d).slice(0, 5)}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tickFormatter={(v) => formatCurrencySmart(Number(v))}
                  tickLine={false}
                  axisLine={false}
                  width={75}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(v) => date(String(v))}
                      formatter={(v) => formatCurrency(Number(v))}
                    />
                  }
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="var(--color-value)"
                  fill="url(#bling-order-value)"
                />
              </AreaChart>
            </ChartContainer>
            {!s.daily.length && (
              <p className="text-center text-sm text-muted-foreground">
                Nenhum pedido no período.
              </p>
            )}
          </CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardContent className="p-5">
            <SectionTitle
              icon={ShoppingBag}
              title="Pedidos por dia"
              description="Quantidade de pedidos nos dias com vendas importadas."
            />
            <ChartContainer
              config={chartConfig}
              className="mt-4 h-[300px] w-full aspect-auto"
            >
              <BarChart data={s.daily}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="day"
                  tickFormatter={(d) => date(d).slice(0, 5)}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  width={45}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(v) => date(String(v))}
                    />
                  }
                />
                <Bar
                  dataKey="orders"
                  fill="var(--color-orders)"
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <BreakdownCard
          title="Canais de venda"
          description="Valor em pedidos · 8 maiores canais."
          icon={Store}
          valueKey="value"
          data={s.channels
            .slice(0, 8)
            .map((c) => ({ label: c.name, value: c.value }))}
        />
        <BreakdownCard
          title="Situações no Bling"
          description="Quantidade por ID de situação · 8 maiores."
          icon={ReceiptText}
          valueKey="orders"
          currency={false}
          data={s.statuses.slice(0, 8).map((v) => ({
            label: v.id ? `Situação ${v.id}` : "Não informada",
            orders: v.orders,
          }))}
        />
        <BreakdownCard
          title="Conferência Nuvemshop"
          description="Correspondências pelo número do pedido no canal vinculado."
          icon={Link2}
          currency={false}
          valueKey="orders"
          data={[
            { label: "Encontrados", orders: s.matched },
            { label: "Pendentes", orders: s.unmatched },
            { label: "Ambíguos", orders: s.ambiguous },
          ]}
        />
      </div>
      <Card>
        <CardContent className="p-5">
          <SectionTitle
            icon={Package}
            title="Produtos com maior valor em pedidos"
            description="10 maiores itens · quantidade × preço unitário, em todas as situações selecionadas."
          />
          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {["Produto", "SKU", "Unidades", "Valor dos itens"].map(
                    (h) => (
                      <TableHead key={h}>{h}</TableHead>
                    ),
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.topProducts.map((p, i) => (
                  <TableRow key={`${p.productId}:${p.sku}:${i}`}>
                    <TableCell className="font-medium">
                      {p.name || p.productId || "Não informado"}
                    </TableCell>
                    <TableCell>{p.sku || "—"}</TableCell>
                    <TableCell>{formatNumber(p.units)}</TableCell>
                    <TableCell>{formatCurrency(p.value)}</TableCell>
                  </TableRow>
                ))}
                {!s.topProducts.length && <EmptyRow colSpan={4} />}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5">
          <SectionTitle
            icon={Store}
            title="Todos os canais"
            description="Pedidos separados por origem, sem somar novamente as vendas da Nuvemshop."
          />
          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {[
                    "Canal",
                    "Pedidos",
                    "Valor dos pedidos",
                    "Ticket médio",
                    "Participação no valor",
                  ].map((h) => (
                    <TableHead key={h}>{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.channels.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>{c.name}</TableCell>
                    <TableCell>{formatNumber(c.orders)}</TableCell>
                    <TableCell>{formatCurrency(c.value)}</TableCell>
                    <TableCell>
                      {formatCurrency(c.orders ? c.value / c.orders : 0)}
                    </TableCell>
                    <TableCell>{ratio(c.value, s.orderValue)}</TableCell>
                  </TableRow>
                ))}
                {!s.channels.length && <EmptyRow colSpan={5} />}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function metricsFor(data: BlingDashboard, view: View): Metric[] {
  const s = data.summary,
    c = s.catalog;
  const orderValue: Metric = {
    label: "Valor em pedidos",
    value: s.orderValue,
    currency: true,
    icon: CircleDollarSign,
    subLabel: "Situações",
    subValue: "Todas as selecionadas",
  };
  const orders: Metric = {
    label: "Pedidos",
    value: s.orders,
    icon: ShoppingBag,
    subLabel: "Ticket médio",
    subValue: formatCurrency(s.orders ? s.orderValue / s.orders : 0),
  };
  const buyers: Metric = {
    label: "Compradores",
    value: s.customers,
    icon: Users,
    subLabel: "Com mais de um pedido",
    subValue: formatNumber(s.repeatCustomers),
  };
  const units: Metric = {
    label: "Unidades em pedidos",
    value: s.units,
    icon: Package,
    subLabel: "Unidades por pedido",
    subValue: formatNumber(s.orders ? s.units / s.orders : 0),
  };
  if (view === "stock")
    return [
      {
        label: "Estoque físico",
        value: c.physical,
        icon: Boxes,
        subLabel: "Produtos com saldo informado",
        subValue: formatNumber(c.knownStock),
      },
      {
        label: "Disponível",
        value: c.available,
        icon: Package,
        subLabel: "Produtos com saldo positivo",
        subValue: formatNumber(c.positive),
      },
      {
        label: "Saldo zerado",
        value: c.zero,
        icon: Package,
        subLabel: "Com saldo negativo",
        subValue: formatNumber(c.negative),
      },
      {
        label: "Sem saldo informado",
        value: c.unknown,
        icon: Boxes,
        subLabel: "Produtos no filtro",
        subValue: formatNumber(c.products),
      },
    ];
  if (view === "products")
    return [
      {
        label: "Produtos no catálogo",
        value: c.products,
        icon: Package,
        subLabel: "Ativos",
        subValue: formatNumber(c.active),
      },
      {
        label: "Unidades em pedidos",
        value: c.units,
        icon: ShoppingBag,
        subLabel: "Período e canal selecionados",
        subValue: "Produtos do filtro",
      },
      {
        label: "Valor dos itens",
        value: c.value,
        currency: true,
        icon: CircleDollarSign,
        subLabel: "Quantidade × preço unitário",
        subValue: "Produtos do filtro",
      },
      {
        label: "Disponível",
        value: c.available,
        icon: Boxes,
        subLabel: "Produtos sem saldo informado",
        subValue: formatNumber(c.unknown),
      },
    ];
  if (view === "customers")
    return [
      buyers,
      orderValue,
      orders,
      {
        label: "Compradores recorrentes",
        value: s.repeatCustomers,
        icon: Users,
        subLabel: "Mais de um pedido no período",
        subValue: ratio(s.repeatCustomers, s.customers),
      },
    ];
  if (view === "orders") return [orderValue, orders, buyers, units];
  return [
    orderValue,
    orders,
    buyers,
    units,
    {
      label: "Compradores recorrentes",
      value: s.repeatCustomers,
      icon: Users,
      subLabel: "Mais de um pedido no período",
      subValue: ratio(s.repeatCustomers, s.customers),
    },
    {
      label: "Canais com pedidos",
      value: s.channels.length,
      icon: Store,
      subLabel: "Origem",
      subValue: "Bling · todos os canais",
    },
    {
      label: "Encontrados na Nuvemshop",
      value: s.matched,
      icon: CheckCheck,
      subLabel: "Conferência por número",
      subValue: "Canal vinculado",
    },
    {
      label: "Pendentes de vínculo",
      value: s.unmatched + s.ambiguous,
      icon: Link2,
      subLabel: "Mais de uma correspondência",
      subValue: formatNumber(s.ambiguous),
    },
  ];
}

// Spreadsheet cells coming from the ERP remain text even when they start with
// formula characters. Numeric columns keep their numeric representation.
const csvText = (value: string | null | undefined) =>
  /^[=+\-@\t\r]/.test(value ?? "") ? `'${value}` : (value ?? "");
function exportData(data: BlingDashboard, view: View) {
  const name = `bling-${view}.csv`;
  if (view === "orders")
    return exportRowsAsCsv(name, data.rows as BlingOrder[], [
      { header: "Pedido", accessor: (r) => csvText(r.number) },
      { header: "Data", accessor: (r) => r.day },
      { header: "Cliente", accessor: (r) => csvText(r.customerName) },
      { header: "Canal", accessor: (r) => csvText(r.channelName) },
      { header: "Valor do pedido", accessor: (r) => r.total },
      { header: "Situação ID", accessor: (r) => csvText(r.statusId) },
      { header: "Conciliação", accessor: (r) => MATCH[r.reconciliation] },
    ]);
  if (view === "customers")
    return exportRowsAsCsv(name, data.rows as BlingCustomer[], [
      { header: "Cliente", accessor: (r) => csvText(r.name) },
      { header: "Pedidos", accessor: (r) => r.orders },
      { header: "Valor dos pedidos", accessor: (r) => r.value },
      { header: "Primeiro pedido no período", accessor: (r) => r.first_day },
      { header: "Último pedido no período", accessor: (r) => r.last_day },
      { header: "Canais", accessor: (r) => r.channels },
    ]);
  return exportRowsAsCsv(name, data.rows as BlingProduct[], [
    { header: "Produto", accessor: (r) => csvText(r.name) },
    { header: "SKU", accessor: (r) => csvText(r.sku) },
    { header: "Situação", accessor: (r) => csvText(r.status) },
    { header: "Preço de cadastro", accessor: (r) => r.price },
    { header: "Unidades em pedidos", accessor: (r) => r.units },
    { header: "Valor dos itens", accessor: (r) => r.value },
    { header: "Estoque físico", accessor: (r) => r.stock?.physical ?? null },
    { header: "Disponível", accessor: (r) => r.stock?.available ?? null },
  ]);
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="w-full sm:w-56">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function BlingData({ clientId, view }: { clientId: string; view: View }) {
  const { dateRange } = useDashboardFilters();
  const { user } = useAuth();
  const [channel, setChannel] = useState("all"),
    [search, setSearch] = useState("");
  const [page, setPage] = useState(1),
    [status, setStatus] = useState("all"),
    [buyerType, setBuyerType] = useState("all"),
    [stock, setStock] = useState("all"),
    [sort, setSort] = useState(view === "stock" ? "stock" : "name");
  const [integrationOpen, setIntegrationOpen] = useState(false),
    [customer, setCustomer] = useState<BlingCustomer | null>(null);
  const [exporting, setExporting] = useState(false),
    [exportError, setExportError] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);
  const from = format(dateRange.from, "yyyy-MM-dd"),
    to = format(dateRange.to, "yyyy-MM-dd");
  const params = new URLSearchParams({
    clientId,
    from,
    to,
    view,
    search: deferredSearch,
    page: String(page),
    buyerType,
    stock,
    sort,
  });
  if (channel !== "all") params.set("channel", channel);
  if (status !== "all") params.set("statusId", status);
  const query = useQuery({
    queryKey: ["bling", clientId, "data", params.toString()],
    queryFn: () =>
      customFetch<BlingDashboard>(`/api/analytics/erp/bling?${params}`),
    retry: 1,
    placeholderData: keepPreviousData,
    staleTime: 120000,
    refetchOnWindowFocus: false,
  });
  const data = query.data;
  const isCatalog = view === "products" || view === "stock";
  const select = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setPage(1);
  };
  async function download() {
    setExporting(true);
    setExportError(null);
    try {
      const exportParams = new URLSearchParams(params);
      exportParams.set("export", "1");
      exportParams.set("page", "1");
      const result = await customFetch<BlingDashboard>(
        `/api/analytics/erp/bling?${exportParams}`,
      );
      if (result.total > 10000)
        throw new Error(
          "A exportação aceita até 10.000 registros. Refine os filtros para exportar todos os resultados.",
        );
      if (!result.rows.length)
        throw new Error("Nenhum registro para exportar com estes filtros.");
      exportData(result, view);
    } catch (error) {
      setExportError(
        error instanceof Error
          ? error.message
          : "Não foi possível exportar os dados.",
      );
    } finally {
      setExporting(false);
    }
  }
  return (
    <div className="space-y-6" data-testid={`bling-erp-${view}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Bling</Badge>
          <span className="text-sm text-muted-foreground">
            {data?.status.companyName ?? "ERP da marca"}
          </span>
        </div>
        {user?.role === "ADMIN" && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIntegrationOpen(true)}
          >
            <Settings2 className="mr-2 h-4 w-4" />
            Integração Bling
          </Button>
        )}
      </div>
      <Dialog open={integrationOpen} onOpenChange={setIntegrationOpen}>
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Integração Bling</DialogTitle>
            <DialogDescription>
              Conexão, importação e vínculo com a Nuvemshop desta marca.
            </DialogDescription>
          </DialogHeader>
          {integrationOpen && <BlingIntegration clientId={clientId} />}
        </DialogContent>
      </Dialog>
      {query.isPending ? (
        <DashLoader label="Carregando ERP Bling" />
      ) : query.isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {query.error instanceof Error
              ? query.error.message
              : "Não foi possível carregar o ERP."}{" "}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void query.refetch()}
            >
              Tentar novamente
            </Button>
          </AlertDescription>
        </Alert>
      ) : data ? (
        <>
          {!data.status.connected && (
            <Alert>
              <AlertDescription>
                O Bling desta marca ainda não foi conectado.{" "}
                {user?.role === "ADMIN"
                  ? "Abra Integração Bling para configurar a conexão."
                  : "Solicite a conexão ao administrador da marca."}
              </AlertDescription>
            </Alert>
          )}
          {(data.status.cursor || data.status.error) && (
            <Alert>
              <AlertDescription>
                A carga está parcial. Confira o status em Integração Bling antes
                de usar os totais.
              </AlertDescription>
            </Alert>
          )}
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 p-4">
              <FilterSelect
                label="Filtrar canal de venda"
                value={channel}
                onChange={select(setChannel)}
                options={[
                  { value: "all", label: "Todos os canais" },
                  ...data.channels
                    .filter((c) => c.id !== "unassigned")
                    .map((c) => ({ value: c.id, label: c.name })),
                  { value: "unassigned", label: "Sem canal identificado" },
                ]}
              />
              <div className="relative min-w-52 flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  aria-label="Buscar no ERP"
                  className="pl-9"
                  maxLength={100}
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder={
                    isCatalog
                      ? "Produto ou SKU"
                      : view === "customers"
                        ? "Nome do comprador"
                        : "Pedido ou cliente"
                  }
                />
              </div>
              {view === "orders" && (
                <FilterSelect
                  label="Filtrar situação do pedido"
                  value={status}
                  onChange={select(setStatus)}
                  options={[
                    { value: "all", label: "Todas as situações" },
                    ...data.summary.statuses
                      .filter((s) => s.id)
                      .map((s) => ({ value: s.id, label: `Situação ${s.id}` })),
                  ]}
                />
              )}
              {view === "customers" && (
                <FilterSelect
                  label="Filtrar frequência de compra"
                  value={buyerType}
                  onChange={select(setBuyerType)}
                  options={[
                    { value: "all", label: "Todos os compradores" },
                    { value: "single", label: "Um pedido no período" },
                    { value: "repeat", label: "Mais de um pedido" },
                  ]}
                />
              )}
              {isCatalog && (
                <>
                  <FilterSelect
                    label="Filtrar saldo de estoque"
                    value={stock}
                    onChange={select(setStock)}
                    options={[
                      { value: "all", label: "Todos os saldos" },
                      { value: "positive", label: "Disponível positivo" },
                      { value: "zero", label: "Disponível zerado" },
                      { value: "negative", label: "Disponível negativo" },
                      { value: "unknown", label: "Sem saldo informado" },
                    ]}
                  />
                  <FilterSelect
                    label="Ordenar produtos"
                    value={sort}
                    onChange={select(setSort)}
                    options={[
                      { value: "name", label: "Nome do produto" },
                      { value: "units", label: "Mais unidades em pedidos" },
                      { value: "value", label: "Maior valor dos itens" },
                      { value: "stock", label: "Maior saldo disponível" },
                    ]}
                  />
                </>
              )}
              {(search ||
                channel !== "all" ||
                status !== "all" ||
                buyerType !== "all" ||
                stock !== "all") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearch("");
                    setChannel("all");
                    setStatus("all");
                    setBuyerType("all");
                    setStock("all");
                    setPage(1);
                  }}
                >
                  Limpar filtros
                </Button>
              )}
            </CardContent>
          </Card>
          {query.isPlaceholderData && (
            <p role="status" className="text-xs text-muted-foreground">
              Atualizando filtros… Os resultados anteriores permanecem visíveis.
            </p>
          )}
          <Kpis metrics={metricsFor(data, view)} />
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>
              {isCatalog
                ? "Catálogo e estoque da última importação. As unidades e os valores em pedidos respeitam o período e o canal selecionados."
                : "Valores de pedidos em todas as situações selecionadas; não representam receita paga ou líquida. Recorrência considera apenas os pedidos deste período."}
            </p>
            <p>
              Pedidos importados: {date(data.summary.coverage.from)} a{" "}
              {date(data.summary.coverage.to)}.
              {data.status.completedAt
                ? ` Última carga concluída: ${new Date(data.status.completedAt).toLocaleString("pt-BR")}.`
                : ""}
            </p>
          </div>
          {data.summary.coverage.from &&
            data.summary.coverage.to &&
            (from < data.summary.coverage.from ||
              to > data.summary.coverage.to) && (
              <Alert>
                <AlertDescription>
                  O período selecionado inclui datas fora dos pedidos
                  importados. Os totais refletem somente a base disponível.
                </AlertDescription>
              </Alert>
            )}
          {exportError && (
            <Alert variant="destructive">
              <AlertDescription>{exportError}</AlertDescription>
            </Alert>
          )}
          {view === "overview" ? (
            <Overview data={data} />
          ) : (
            <Card>
              <CardContent className="space-y-4 p-5">
                <SectionTitle
                  icon={
                    view === "orders"
                      ? ReceiptText
                      : view === "customers"
                        ? Users
                        : view === "stock"
                          ? Boxes
                          : Package
                  }
                  title={TITLES[view]}
                  description={
                    view === "customers"
                      ? "Compradores com pedidos no período. Clique para consultar os pedidos."
                      : isCatalog
                        ? "Expanda o produto para consultar os saldos por depósito."
                        : "Expanda o pedido para consultar os itens e o número na loja."
                  }
                  action={
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={
                        exporting ||
                        query.isFetching ||
                        search !== deferredSearch ||
                        !data.total
                      }
                      onClick={() => void download()}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      {exporting ? "Exportando..." : "Exportar CSV"}
                    </Button>
                  }
                />
                <div className="overflow-x-auto">
                  {view === "orders" ? (
                    <OrderRows rows={data.rows as BlingOrder[]} />
                  ) : isCatalog ? (
                    <ProductRows
                      rows={data.rows as BlingProduct[]}
                      stock={view === "stock"}
                    />
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {[
                            "Comprador",
                            "Pedidos",
                            "Valor dos pedidos",
                            "Ticket médio",
                            "Canais",
                            "Primeiro no período",
                            "Último no período",
                          ].map((h) => (
                            <TableHead key={h}>{h}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(data.rows as BlingCustomer[]).map((row) => (
                          <TableRow key={row.id}>
                            <TableCell>
                              <Button
                                variant="link"
                                className="h-auto p-0 text-left"
                                onClick={() => setCustomer(row)}
                              >
                                {row.name || `Contato ${row.id}`}
                              </Button>
                              <p className="text-xs text-muted-foreground">
                                {row.orders > 1
                                  ? "Mais de um pedido no período"
                                  : "Um pedido no período"}
                              </p>
                            </TableCell>
                            <TableCell>{formatNumber(row.orders)}</TableCell>
                            <TableCell>{formatCurrency(row.value)}</TableCell>
                            <TableCell>
                              {formatCurrency(
                                row.orders ? row.value / row.orders : 0,
                              )}
                            </TableCell>
                            <TableCell>{row.channels}</TableCell>
                            <TableCell>{date(row.first_day)}</TableCell>
                            <TableCell>{date(row.last_day)}</TableCell>
                          </TableRow>
                        ))}
                        {!data.rows.length && <EmptyRow colSpan={7} />}
                      </TableBody>
                    </Table>
                  )}
                </div>
                <Pagination
                  page={data.page}
                  disabled={query.isFetching}
                  total={data.total}
                  size={25}
                  onChange={setPage}
                />
              </CardContent>
            </Card>
          )}
          <Dialog
            open={!!customer}
            onOpenChange={(open) => {
              if (!open) setCustomer(null);
            }}
          >
            <DialogContent className="max-h-[85vh] max-w-6xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  Pedidos de {customer?.name || "comprador"}
                </DialogTitle>
                <DialogDescription>
                  Pedidos do Bling no período e canal selecionados. O histórico
                  completo da pessoa pode ser maior.
                </DialogDescription>
              </DialogHeader>
              {customer && (
                <CustomerOrders
                  key={customer.id}
                  clientId={clientId}
                  customer={customer}
                  from={from}
                  to={to}
                  channel={channel}
                />
              )}
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </div>
  );
}

export default function BlingErpPage() {
  const { user, selectedClientId } = useAuth();
  const { dateRange } = useDashboardFilters();
  const [location] = useLocation();
  const clientId = user?.role === "CLIENT" ? user.clientId : selectedClientId;
  const view: View = location.endsWith("/pedidos")
    ? "orders"
    : location.endsWith("/clientes")
      ? "customers"
      : location.endsWith("/produtos")
        ? "products"
        : location.endsWith("/estoque")
          ? "stock"
          : "overview";
  if (!clientId)
    return (
      <Alert>
        <AlertDescription>
          Selecione uma marca B2C para consultar o ERP Bling.
        </AlertDescription>
      </Alert>
    );
  return (
    <BlingData
      key={`${clientId}:${view}:${format(dateRange.from, "yyyy-MM-dd")}:${format(dateRange.to, "yyyy-MM-dd")}`}
      clientId={clientId}
      view={view}
    />
  );
}
