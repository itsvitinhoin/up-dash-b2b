import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface AbcRow {
  id: string;
  name: string;
  abc: string | null;
  grade: string;
  revenue: number;
  units: number;
  priorUnits: number;
  stock: number | null;
  coverageDays: number | null;
  demandAtRiskShare: number | null;
  outOfStockVariants: { id: string; label: string; units: number }[];
}
interface Abc {
  days: number;
  limits: { a: number; b: number };
  products: AbcRow[];
}
interface Funnel {
  sessions: number;
  productViews: number;
  addToCarts: number;
  checkouts: number;
  purchases: number;
  purchasesPerSession: number | null;
}
interface Breakdown {
  name: string;
  traffic: number;
  carts: number;
  checkouts: number;
  purchases: number;
}
interface ReportDetail {
  payload: {
    trigger: "scheduled" | "manual";
    b2c: {
      version: string;
      currency: string;
      summary: string;
      scope: {
        comparison: string;
        reference: { dateFrom: string; dateTo: string };
      };
      changes: Record<
        string,
        { absolute: number; percent: number | null } | null
      > | null;
      revenueDrivers: {
        orderVolume: number;
        ticket: number;
        traffic: number | null;
        ordersPerSession: number | null;
      } | null;
      product: {
        abc7: Abc;
        abc14: Abc;
        inventory: {
          pricedValue: number;
          countedUnits: number;
          unknownVariants: number;
        } | null;
        realization: number;
        scenarios: {
          name: string;
          rate: number;
          revenue: number;
          mediaBudget: number | null;
        }[];
      };
      commercial: {
        previousObservedAt: string | null;
        currentObservedAt: string | null;
        catalog:
          | { key: string; name: string; options: string; changed: string[] }[]
          | null;
        coupons: { id: string; freeShipping: boolean; status: string }[] | null;
      };
      cro: {
        current: Funnel | null;
        previous: Funnel | null;
        channels: Breakdown[] | null;
        products: Breakdown[] | null;
        evaluation?: {
          payment: {
            current: { created: number; approved: number; pending: number };
            previous: { created: number; approved: number; pending: number };
          } | null;
        };
      };
      media: {
        operatingPlan?: {
          window: { dateFrom: string; dateTo: string };
          targetCpa: number | null;
          decisions: {
            id: string;
            name: string;
            decision: "pause" | "scale" | "reduce" | "hold" | "insufficient";
            reason: string;
            spend: number | null;
            purchases: number | null;
            cpa: number | null;
            priorCpa: number | null;
          }[];
        };
        current: {
          ctr: number | null;
          cpc: number | null;
          cpm: number | null;
          frequency: number | null;
        } | null;
      };
      acquisition: {
        current: {
          newRevenue: number;
          returningRevenue: number;
          reactivatedBuyers: number;
        };
        retentionSegments?: { firstOnly: number; dormant: number };
        frequency: number | null;
        recurringRevenueShare: number | null;
        reactivationDays: number;
        cohorts: {
          month: string;
          horizon: number;
          buyers: number;
          repeatRate: number | null;
          revenuePerBuyer: number;
        }[];
      };
      month: { approvedRevenue: number; inventoryRealization: number | null };
      coverage: {
        commerce: { observedAt: string | null };
        stockObservedAt: string | null;
        monitorObservedAt: string | null;
        unmatchedActiveAds?: number | null;
      };
      followThrough?: {
        id: string;
        title: string;
        previousDay: string;
        status: "persistent" | "verify";
      }[];
      limitations: string[];
    };
  };
}

const gradeNames: Record<string, string> = {
  complete: "Completa",
  broken: "Quebrada",
  out_of_stock: "Esgotada",
  hidden: "Fora da vitrine",
  unknown: "Sem confirmação",
};
const metricNames: Record<string, string> = {
  approvedRevenue: "Faturamento aprovado",
  orders: "Pedidos aprovados",
  averageOrder: "Ticket médio",
  costPerPurchase: "CPA da loja",
  spend: "Investimento Meta",
  roas: "ROAS atribuído",
  mer: "MER Meta",
  cac: "CAC blended",
  returningBuyers: "Recorrentes",
  newBuyers: "Novos compradores",
  repeatRate: "Taxa de recompra",
};
const reportDate = (date: string) => date.split("-").reverse().join("/");
const time = (date: string | null) =>
  date
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "America/Sao_Paulo",
      }).format(new Date(date))
    : "Sem leitura";
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const showNumber = (value: number | null) =>
  value === null ? "—" : number.format(value);
const percent = (value: number | null) =>
  value === null ? "—" : `${number.format(value * 100)}%`;
const detailsClass =
  "rounded-lg border p-3 [&>summary]:cursor-pointer [&>summary]:font-medium";

function AbcTable({
  abc,
  money,
}: {
  abc: Abc;
  money: (amount: number) => string;
}) {
  return (
    <details className={detailsClass}>
      <summary>Curva ABC · {abc.days} dias</summary>
      <p className="mt-2 text-muted-foreground">
        Receita de itens de pedidos aprovados. A até cruzar{" "}
        {percent(abc.limits.a)} e B até cruzar {percent(abc.limits.b)} da
        receita acumulada. Em empate, maior quantidade vendida e ID do produto.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            {[
              "Produto",
              "Curva e grade",
              "Receita",
              "Unidades / anterior",
              "Estoque",
              "Cobertura",
              "Demanda em falta",
            ].map((name) => (
              <TableHead key={name}>{name}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {abc.products.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="min-w-44 font-medium">
                {row.name}
                {row.outOfStockVariants.length > 0 && (
                  <details className="mt-1 text-xs font-normal">
                    <summary className="cursor-pointer">
                      Variantes esgotadas
                    </summary>
                    {row.outOfStockVariants.map((item) => (
                      <div key={item.id}>
                        {item.label} · {item.units} vendas
                      </div>
                    ))}
                  </details>
                )}
              </TableCell>
              <TableCell>
                {row.abc ?? "—"} · {gradeNames[row.grade]}
              </TableCell>
              <TableCell>{money(row.revenue)}</TableCell>
              <TableCell>
                {row.units} / {row.priorUnits}
              </TableCell>
              <TableCell>{showNumber(row.stock)}</TableCell>
              <TableCell>
                {row.coverageDays === null
                  ? "—"
                  : `${showNumber(row.coverageDays)} d`}
              </TableCell>
              <TableCell>{percent(row.demandAtRiskShare)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {abc.products.length === 0 && (
        <p className="mt-2 text-muted-foreground">
          Nenhum item de pedido aprovado na janela.
        </p>
      )}
    </details>
  );
}

function BreakdownTable({
  group,
  rows,
  firstColumn,
}: {
  group: string;
  rows: Breakdown[] | null;
  firstColumn: string;
}) {
  if (!rows) return null;
  return (
    <details className={detailsClass}>
      <summary>{group}</summary>
      <Table>
        <TableHeader>
          <TableRow>
            {[group, firstColumn, "Carrinho", "Checkout", "Compras"].map(
              (label) => (
                <TableHead key={label}>{label}</TableHead>
              ),
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.name}>
              <TableCell>{row.name}</TableCell>
              <TableCell>{row.traffic}</TableCell>
              <TableCell>{row.carts}</TableCell>
              <TableCell>{row.checkouts}</TableCell>
              <TableCell>{row.purchases}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </details>
  );
}

export function ManagerB2cReport({
  clientId,
  runId,
}: {
  clientId: string;
  runId: string;
}) {
  const report = useQuery({
    queryKey: ["up-manager", "report", clientId, runId],
    queryFn: () =>
      customFetch<ReportDetail>(
        `/api/up-manager/report/${runId}?clientId=${encodeURIComponent(clientId)}`,
      ),
    staleTime: Infinity,
  });
  if (report.isPending)
    return (
      <p role="status" className="text-sm">
        Carregando análise B2C…
      </p>
    );
  if (report.isError)
    return (
      <p role="alert" className="text-sm">
        Não foi possível abrir esta revisão.
      </p>
    );
  const b2c = report.data.payload.b2c;
  const {
    product,
    scope,
    commercial,
    acquisition,
    cro,
    media,
    revenueDrivers,
  } = b2c;
  const money = (amount: number) =>
    new Intl.NumberFormat("pt-BR", {
      currency: b2c.currency,
      style: "currency",
    }).format(amount);
  return (
    <section
      id="up-manager-analysis"
      aria-label="Análise B2C"
      className="space-y-3 rounded-lg border p-3 text-sm"
    >
      <div>
        <h3 className="font-semibold">{b2c.summary}</h3>
        <p className="text-muted-foreground">
          {scope.comparison} · {reportDate(scope.reference.dateFrom)} a{" "}
          {reportDate(scope.reference.dateTo)}
        </p>
      </div>
      <details className={detailsClass} open>
        <summary>Indicadores e variação de receita</summary>
        {b2c.changes && (
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
            {Object.entries(metricNames).map(([key, label]) => (
              <div key={key}>
                {label}{" "}
                <strong>{percent(b2c.changes?.[key]?.percent ?? null)}</strong>
              </div>
            ))}
          </div>
        )}
        {revenueDrivers && (
          <p className="mt-2 text-muted-foreground">
            Contribuições aritméticas · volume{" "}
            {money(revenueDrivers.orderVolume)} · ticket{" "}
            {money(revenueDrivers.ticket)}
            {revenueDrivers.traffic !== null &&
              revenueDrivers.ordersPerSession !== null &&
              ` · volume detalhado em sessões (${money(revenueDrivers.traffic)}) e pedidos por sessão (${money(revenueDrivers.ordersPerSession)})`}
          </p>
        )}
        {media.current && (
          <p className="mt-2 text-muted-foreground">
            Meta · CTR{" "}
            {media.current.ctr === null
              ? "—"
              : `${showNumber(media.current.ctr)}%`}{" "}
            · CPC {media.current.cpc === null ? "—" : money(media.current.cpc)}{" "}
            · CPM {media.current.cpm === null ? "—" : money(media.current.cpm)}{" "}
            · frequência {showNumber(media.current.frequency)}
          </p>
        )}
      </details>
      {media.operatingPlan && (
        <details className={detailsClass}>
          <summary>Decisão por campanha</summary>
          <p className="mt-2 text-muted-foreground">
            Desempenho de {reportDate(media.operatingPlan.window.dateFrom)} a{" "}
            {reportDate(media.operatingPlan.window.dateTo)}.
            {media.operatingPlan.targetCpa !== null &&
              ` CPA anterior da conta ${money(media.operatingPlan.targetCpa)}.`}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                {[
                  "Campanha",
                  "Decisão e evidência",
                  "Gasto",
                  "Compras Meta",
                  "CPA atual / anterior",
                ].map((title) => (
                  <TableHead key={title}>{title}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {media.operatingPlan.decisions.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="min-w-36 font-medium">
                    {row.name}
                  </TableCell>
                  <TableCell className="min-w-52">
                    <strong>
                      {
                        {
                          pause: "Pausar",
                          scale: "Escalar com teste",
                          reduce: "Reduzir",
                          hold: "Manter",
                          insufficient: "Cobertura insuficiente",
                        }[row.decision]
                      }
                    </strong>
                    <div className="text-muted-foreground">{row.reason}</div>
                  </TableCell>
                  <TableCell>
                    {row.spend === null ? "—" : money(row.spend)}
                  </TableCell>
                  <TableCell>{showNumber(row.purchases)}</TableCell>
                  <TableCell>
                    {row.cpa === null ? "—" : money(row.cpa)} /{" "}
                    {row.priorCpa === null ? "—" : money(row.priorCpa)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </details>
      )}
      <details className={detailsClass}>
        <summary>Poder de venda, mês e cenários</summary>
        <p className="mt-2">
          Faturamento aprovado no mês até o fechamento ·{" "}
          {money(b2c.month.approvedRevenue)}
        </p>
        {product.inventory && (
          <p>
            Estoque vendável precificado ·{" "}
            {money(product.inventory.pricedValue)} em{" "}
            {product.inventory.countedUnits} peças ·{" "}
            {product.inventory.unknownVariants} variantes com lacunas
          </p>
        )}
        <p className="text-muted-foreground">
          Referência mensal inicial de {percent(product.realization)} do valor
          precificado. Estoque observado em {time(b2c.coverage.stockObservedAt)}
          .
        </p>
        {product.scenarios.length > 0 && (
          <ul className="mt-2 space-y-1">
            {product.scenarios.map((item) => (
              <li key={item.name}>
                {item.name} · {percent(item.rate)} de realização ·{" "}
                {money(item.revenue)} de receita · verba indicativa{" "}
                {item.mediaBudget === null ? "—" : money(item.mediaBudget)}
              </li>
            ))}
          </ul>
        )}
      </details>
      <AbcTable abc={product.abc7} money={money} />
      <AbcTable abc={product.abc14} money={money} />
      <details className={detailsClass}>
        <summary>Condições comerciais</summary>
        <p className="mt-2 text-muted-foreground">
          Observações · {time(commercial.previousObservedAt)} e{" "}
          {time(commercial.currentObservedAt)}
        </p>
        <p>
          Catálogo ·{" "}
          {commercial.catalog === null
            ? "Sem base comparável"
            : `${commercial.catalog.length} variantes com alterações`}
        </p>
        <p>
          Cupons ·{" "}
          {commercial.coupons === null
            ? "Sem base comparável"
            : `${commercial.coupons.length} alterações, ${commercial.coupons.filter((item) => item.freeShipping).length} ligadas ao frete`}
        </p>
        {commercial.catalog?.length ? (
          <ul className="mt-2 space-y-1">
            {commercial.catalog.map((item) => (
              <li key={item.key}>
                <strong>
                  {item.name} {item.options}
                </strong>{" "}
                · {item.changed.join(", ")}
              </li>
            ))}
          </ul>
        ) : null}
      </details>
      <details className={detailsClass}>
        <summary>Funil e aprovação de pedidos</summary>
        {cro.evaluation?.payment?.current && (
          <p className="mt-2 text-muted-foreground">
            Loja · {cro.evaluation.payment.current.created} pedidos gerados
            · {cro.evaluation.payment.current.approved} aprovados ·{" "}
            {cro.evaluation.payment.current.pending} pendentes.
          </p>
        )}
        {(
          [
            ["Atual", cro.current],
            ["Referência", cro.previous],
          ] as const
        ).map(([label, funnel]) => (
          <p key={label} className="mt-2">
            <strong>{label}</strong> ·{" "}
            {funnel
              ? `${funnel.sessions} sessões, ${funnel.productViews} visualizações de produto, ${funnel.addToCarts} carrinhos, ${funnel.checkouts} checkouts, ${funnel.purchases} compras · compras por sessão ${percent(funnel.purchasesPerSession)}`
              : "Cobertura indisponível"}
          </p>
        ))}
        <div className="mt-2 space-y-2">
          <BreakdownTable
            group="Canais"
            rows={cro.channels}
            firstColumn="Sessões"
          />
          <BreakdownTable
            group="Produtos"
            rows={cro.products}
            firstColumn="Visualizações"
          />
        </div>
      </details>
      <details className={detailsClass}>
        <summary>Aquisição, recompra e coortes</summary>
        {acquisition.retentionSegments && (
          <p className="mt-2 text-muted-foreground">
            {acquisition.retentionSegments.firstOnly} clientes na janela de
            segunda compra · {acquisition.retentionSegments.dormant} recorrentes
            na janela de reativação.
          </p>
        )}
        <p className="mt-2">
          Receita de novos · {money(acquisition.current.newRevenue)}. Receita de
          recorrentes · {money(acquisition.current.returningRevenue)} (
          {percent(acquisition.recurringRevenueShare)}).
        </p>
        <p>
          {acquisition.current.reactivatedBuyers} reativados após{" "}
          {acquisition.reactivationDays} dias.{" "}
          {showNumber(acquisition.frequency)} compras por comprador.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              {[
                "Coorte",
                "Janela",
                "Compradores",
                "Recompra",
                "Receita por comprador",
              ].map((name) => (
                <TableHead key={name}>{name}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {acquisition.cohorts.map((row) => (
              <TableRow key={`${row.month}:${row.horizon}`}>
                <TableCell>{reportDate(row.month).slice(3)}</TableCell>
                <TableCell>D{row.horizon}</TableCell>
                <TableCell>{row.buyers}</TableCell>
                <TableCell>{percent(row.repeatRate)}</TableCell>
                <TableCell>{money(row.revenuePerBuyer)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </details>
      {Boolean(b2c.followThrough?.length) && (
        <details className={detailsClass}>
          <summary>Acompanhamento dos achados anteriores</summary>
          <ul className="mt-2 space-y-1">
            {b2c.followThrough?.map((item) => (
              <li key={item.id}>
                <strong>{item.title}</strong> · {reportDate(item.previousDay)} ·{" "}
                {item.status === "persistent"
                  ? "Sinal observado novamente"
                  : "Aguardando verificação"}
              </li>
            ))}
          </ul>
        </details>
      )}
      <details className={detailsClass}>
        <summary>Fontes e limites da leitura</summary>
        {b2c.coverage.unmatchedActiveAds ? (
          <p className="mt-2 text-muted-foreground">
            {b2c.coverage.unmatchedActiveAds} anúncios ativos sem vínculo de
            destino confirmado.
          </p>
        ) : null}
        <p className="mt-2">
          Pedidos · {time(b2c.coverage.commerce.observedAt)}. Vínculo campanha e
          catálogo · {time(b2c.coverage.monitorObservedAt)}. Versão ·{" "}
          {b2c.version}.
        </p>
        <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
          {b2c.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
