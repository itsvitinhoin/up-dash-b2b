import { useDeferredValue, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format } from "date-fns";
import {
  customFetch,
  type BlingDashboard,
  type BlingOrder,
  type BlingProduct,
  type BlingCustomer,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import { BlingIntegration } from "@/components/bling-integration";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { DashLoader } from "@/components/ui/dash-loader";

const MATCH = {
  matched: "Encontrado na Nuvemshop",
  unmatched: "Pendente de vínculo",
  ambiguous: "Mais de uma correspondência",
  other_channel: "Outro canal",
};

function OrderRows({ rows }: { rows: BlingOrder[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {[
            "Pedido / data",
            "Canal",
            "Cliente",
            "Valor do pedido",
            "Situação no Bling",
            "Conciliação",
          ].map((label) => (
            <TableHead key={label}>{label}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              <details>
                <summary className="cursor-pointer">
                  #{row.number} · {row.day.split("-").reverse().join("/")}
                </summary>
                <div className="space-y-1 pt-2 text-xs text-muted-foreground">
                  <p>Pedido na loja: {row.storeNumber || "Não informado"}</p>
                  {row.items.map((item) => (
                    <p key={item.id}>
                      {item.quantity} × {item.name} · {item.sku || "Sem SKU"} ·{" "}
                      {formatCurrency(item.unitPrice)}
                    </p>
                  ))}
                </div>
              </details>
            </TableCell>
            <TableCell>{row.channelName}</TableCell>
            <TableCell>{row.customerName || "Não informado"}</TableCell>
            <TableCell className="tabular-nums">
              {formatCurrency(row.total)}
            </TableCell>
            <TableCell>
              ID {row.statusId || "—"}
              <span className="block text-xs text-muted-foreground">
                Código {row.statusValue || "—"}
              </span>
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
        ))}
      </TableBody>
    </Table>
  );
}
function ProductRows({ rows }: { rows: BlingProduct[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {[
            "Produto / SKU",
            "Situação",
            "Preço",
            "Estoque físico",
            "Disponível",
            "Depósitos",
          ].map((label) => (
            <TableHead key={label}>{label}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              {row.name}
              <span className="block text-xs text-muted-foreground">
                {row.sku || "Sem SKU"}
                {row.parentId ? " · Variação" : ""}
              </span>
            </TableCell>
            <TableCell>{row.status === "A" ? "Ativo" : "Inativo"}</TableCell>
            <TableCell>{formatCurrency(row.price)}</TableCell>
            <TableCell>
              {row.stock ? formatNumber(row.stock.physical) : "Não informado"}
            </TableCell>
            <TableCell>
              {row.stock ? formatNumber(row.stock.available) : "Não informado"}
            </TableCell>
            <TableCell>
              {row.stock ? (
                <details>
                  <summary className="cursor-pointer">
                    {row.stock.warehouses.length} depósito(s)
                  </summary>
                  {row.stock.warehouses.map((depot) => (
                    <p key={depot.id} className="text-xs">
                      {depot.id}: físico {formatNumber(depot.physical)} ·
                      disponível {formatNumber(depot.available)}
                    </p>
                  ))}
                </details>
              ) : (
                "—"
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
function CustomerRows({ rows }: { rows: BlingCustomer[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {["Cliente", "Pedidos", "Valor dos pedidos", "Último pedido"].map(
            (label) => (
              <TableHead key={label}>{label}</TableHead>
            ),
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>{row.name || `Contato ${row.id}`}</TableCell>
            <TableCell>{formatNumber(row.orders)}</TableCell>
            <TableCell>{formatCurrency(row.value)}</TableCell>
            <TableCell>{row.last_day.split("-").reverse().join("/")}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function BlingData({
  clientId,
  view,
}: {
  clientId: string;
  view: "overview" | "orders" | "customers" | "products";
}) {
  const { dateRange } = useDashboardFilters();
  const [channel, setChannel] = useState("all"),
    [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const deferredSearch = useDeferredValue(search);
  const params = new URLSearchParams({
    clientId,
    from: format(dateRange.from, "yyyy-MM-dd"),
    to: format(dateRange.to, "yyyy-MM-dd"),
    view,
    search: deferredSearch,
    page: String(page),
  });
  if (channel !== "all") params.set("channel", channel);
  const query = useQuery({
    queryKey: ["bling", clientId, "data", params.toString()],
    queryFn: () =>
      customFetch<BlingDashboard>(`/api/analytics/erp/bling?${params}`),
    retry: false,
  });
  const { user } = useAuth();
  const data = query.data;
  return (
    <div className="space-y-6" data-testid={`bling-erp-${view}`}>
      {user?.role === "ADMIN" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Integração Bling</CardTitle>
          </CardHeader>
          <CardContent>
            <BlingIntegration key={clientId} clientId={clientId} />
          </CardContent>
        </Card>
      )}
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
                  ? "Use a conexão acima para começar."
                  : "Solicite a conexão ao administrador da marca."}
              </AlertDescription>
            </Alert>
          )}
          {(data.status.cursor || data.status.error) && (
            <Alert>
              <AlertDescription>
                A carga está parcial. Confira o status da integração antes de
                usar os totais.
              </AlertDescription>
            </Alert>
          )}
          <div className="flex flex-wrap gap-3">
            <div className="min-w-52 space-y-2">
              <Label>Canal de venda</Label>
              <Select
                value={channel}
                onValueChange={(value) => {
                  setChannel(value);
                  setPage(1);
                }}
                disabled={view === "products"}
              >
                <SelectTrigger aria-label="Filtrar canal de venda">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os canais</SelectItem>
                  {data.channels.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                  <SelectItem value="unassigned">
                    Sem canal identificado
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-52 flex-1 space-y-2">
              <Label htmlFor="bling-search">Buscar</Label>
              <Input
                id="bling-search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder={
                  view === "products"
                    ? "Produto ou SKU"
                    : view === "customers"
                      ? "Nome do cliente"
                      : "Pedido ou cliente"
                }
              />
            </div>
          </div>
          {view !== "products" && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ["Pedidos no período", formatNumber(data.summary.orders)],
                [
                  "Valor registrado em pedidos",
                  formatCurrency(data.summary.orderValue),
                ],
                [
                  "Compradores no período",
                  formatNumber(data.summary.customers),
                ],
                [
                  "Encontrados na Nuvemshop",
                  formatNumber(data.summary.matched),
                ],
              ].map(([label, value]) => (
                <Card key={label}>
                  <CardContent className="pt-5">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-2 text-2xl font-semibold tabular-nums">
                      {value}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {view === "products"
              ? "Catálogo e estoque da última importação, independentes do período e do canal selecionados."
              : "Os valores incluem todas as situações do Bling e não representam receita paga ou líquida. As vendas da Nuvemshop não são somadas novamente ao ERP."}
          </p>
          {view === "overview" ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Vendas por canal</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Canal</TableHead>
                        <TableHead>Pedidos</TableHead>
                        <TableHead>Valor dos pedidos</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.summary.channels.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>{item.name}</TableCell>
                          <TableCell>{formatNumber(item.orders)}</TableCell>
                          <TableCell>{formatCurrency(item.value)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {!data.summary.orders && (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    Nenhum pedido importado para estes filtros.
                  </p>
                )}
                <p className="mt-4 text-xs text-muted-foreground">
                  Conciliação Nuvemshop: {data.summary.matched} encontrado(s),{" "}
                  {data.summary.unmatched} pendente(s), {data.summary.ambiguous}{" "}
                  ambíguo(s).{" "}
                  {!data.status.nuvemshopChannelId &&
                    "Selecione o canal da Nuvemshop na configuração para iniciar a conferência."}
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {view === "orders"
                    ? "Pedidos Bling"
                    : view === "customers"
                      ? "Compradores com pedidos no período"
                      : "Produtos e estoque Bling"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  {view === "orders" ? (
                    <OrderRows rows={data.rows as BlingOrder[]} />
                  ) : view === "customers" ? (
                    <CustomerRows rows={data.rows as BlingCustomer[]} />
                  ) : (
                    <ProductRows rows={data.rows as BlingProduct[]} />
                  )}
                </div>
                {data.rows.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    Nenhum registro encontrado para estes filtros.
                  </p>
                )}
                <div className="mt-4 flex items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">
                    {data.total} registro(s) · página {page}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1 || query.isFetching}
                      onClick={() => setPage((value) => value - 1)}
                    >
                      Anterior
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page * 25 >= data.total || query.isFetching}
                      onClick={() => setPage((value) => value + 1)}
                    >
                      Próxima
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
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
  const view = location.endsWith("/pedidos")
    ? "orders"
    : location.endsWith("/clientes")
      ? "customers"
      : location.endsWith("/produtos") || location.endsWith("/estoque")
        ? "products"
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
