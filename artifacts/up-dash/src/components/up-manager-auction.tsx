type Range = { dateFrom: string; dateTo: string };
type AuctionPoint = { period: Range; spend: number; purchases: number; cpm: number | null; ctr: number | null;
  cpc: number | null; purchaseRate: number | null; ticket: number | null; roas: number | null };
export type CampaignAuction = { before: AuctionPoint | null; preceding: AuctionPoint | null; current: AuctionPoint;
  trend: "recovery" | "decline" | "stable"; summary: string | null; detail: string | null };
export type AuctionSeasonality = { event: { name: string; date: string } | null; current: AuctionPoint | null;
  baseline: AuctionPoint | null; previousYear: AuctionPoint | null; previousYearPeriod: Range; cpmChange: number | null };

const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 2 });
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const count = new Intl.NumberFormat("pt-BR");
const day = (value: string) => `${value.slice(8, 10)}/${value.slice(5, 7)}`;
const dates = ({ dateFrom, dateTo }: Range) => `${day(dateFrom)} a ${day(dateTo)}`;
const format = (value: number | null | undefined, show: (number: number) => string) => value == null ? "—" : show(value);

function AuctionTable({ columns, currency }: { columns: { label: string; point: AuctionPoint | null }[]; currency: string }) {
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency });
  const metrics = [
    { key: "cpm", label: "CPM", show: money.format },
    { key: "ctr", label: "CTR de link", show: percent.format },
    { key: "cpc", label: "Custo por clique", show: money.format },
    { key: "purchaseRate", label: "Compras por clique", show: percent.format },
    { key: "purchases", label: "Compras atribuídas", show: count.format },
    { key: "ticket", label: "Valor por compra", show: money.format },
    { key: "spend", label: "Investimento", show: money.format },
    { key: "roas", label: "ROAS", show: (value: number) => `${number.format(value)}×` },
  ] as const;
  return <div className="overflow-x-auto rounded-lg border">
    <table className="w-full whitespace-nowrap text-left text-xs tabular-nums" aria-label="Métricas de leilão e conversão">
      <thead className="bg-muted/45 text-muted-foreground"><tr>
        <th scope="col" className="px-2.5 py-2 font-medium">Métrica</th>
        {columns.map(({ label, point }) => <th key={label} scope="col" className="px-2.5 py-2 text-right font-medium">
          {label}{point && <span className="block text-[10px] font-normal">{dates(point.period)}</span>}
        </th>)}
      </tr></thead>
      <tbody className="divide-y">{metrics.map(({ key, label, show }) => <tr key={key}>
        <th scope="row" className="px-2.5 py-1.5 font-medium">{label}</th>
        {columns.map(({ label, point }) => <td key={label} className="px-2.5 py-1.5 text-right">{format(point?.[key], show)}</td>)}
      </tr>)}</tbody>
    </table>
  </div>;
}

export function CampaignAuctionDetails({ data, currency }: { data: CampaignAuction; currency: string }) {
  return <div className="space-y-2">
    <AuctionTable currency={currency} columns={[{ label: "Mesmos dias da semana anterior", point: data.before },
      { label: "Dias anteriores", point: data.preceding }, { label: "Últimos 3 dias", point: data.current }]} />
    {data.detail && <p className="text-muted-foreground">{data.detail}</p>}
  </div>;
}

export function AccountAuctionDetails({ data, currency }: { data: AuctionSeasonality; currency: string }) {
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency });
  const delta = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" });
  return <details className="rounded-lg border px-3 py-2 text-xs">
    <summary className="cursor-pointer font-medium">
      Leilão e sazonalidade{data.event && ` · ${data.event.name}`}
      {data.current?.cpm != null && ` · CPM ${money.format(data.current.cpm)}`}
      {data.cpmChange != null && ` (${delta.format(data.cpmChange)} ante a semana de referência)`}
    </summary>
    <div className="mt-2 space-y-2">
      <AuctionTable currency={currency} columns={[{ label: "4 semanas atrás", point: data.baseline },
        { label: "Últimos 7 dias", point: data.current }, ...(data.previousYear ? [{ label: "Ano anterior", point: data.previousYear }] : [])]} />
      <p className="text-muted-foreground">CPM calculado sobre a entrega total da conta. Compare com CTR, compras por clique e composição da entrega para interpretar a sazonalidade.</p>
      {!data.previousYear && <p className="text-muted-foreground">Cobertura insuficiente de {dates(data.previousYearPeriod)}/{data.previousYearPeriod.dateTo.slice(0, 4)} para comparar com o ano anterior.</p>}
    </div>
  </details>;
}
