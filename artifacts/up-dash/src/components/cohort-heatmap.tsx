import { Card, CardContent } from "@/components/ui/card";
import type { MonthlyCohort } from "@/lib/purchase-insights";
import { formatNumber } from "@/lib/formatters";

const monthLabel = (month: string) => new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" })
  .format(new Date(`${month}-01T12:00:00Z`));
const percent = (value: number) => `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

export function CohortHeatmap({ data, loading, error }: { data?: MonthlyCohort; loading: boolean; error: boolean }) {
  return <section aria-labelledby="cohort-title" data-testid="monthly-cohort">
    <h2 id="cohort-title" className="up-analysis-title">Análise de Cohort</h2>
    <p className="up-analysis-description">Grupos de lojistas pelo mês da primeira compra e quantos voltam nos meses seguintes.</p>
    <Card><CardContent>
      {loading ? <p className="text-sm text-muted-foreground">Carregando cohort…</p>
        : !data ? <p className="text-sm text-muted-foreground">{error ? "Não foi possível carregar esta análise. Tente atualizar a página." : "Análise indisponível nesta fonte."}</p>
        : <>
          <table className="up-cohort-table" aria-label="Retenção mensal por cohort" aria-describedby="cohort-note">
            <thead><tr><th scope="col">Primeira compra</th>{[0,1,2,3].map(month => <th key={month} scope="col">Mês {month}</th>)}</tr></thead>
            <tbody>{data.rows.map(row => <tr key={row.month}>
              <th scope="row"><span className="up-cohort-month">{monthLabel(row.month)} <span>{row.month.slice(0,4)}</span></span><small>{formatNumber(row.customers)} lojistas</small></th>
              {[0,1,2,3].map(offset => {
                const value = row.retention[offset] ?? null;
                return <td key={offset}><span className={`up-cohort-cell ${value == null ? "is-unobserved" : ""}`}
                  style={value == null ? undefined : { background: `hsl(var(--chart-1) / ${offset === 0 ? .45 : .10 + Math.min(100,Math.max(0,value)) / 100 * .65})` }}
                  title={`${monthLabel(row.month)} ${row.month.slice(0,4)}, mês ${offset}: ${value == null ? "sem dados observados" : percent(value)}`}>
                  {value == null ? "—" : percent(value)}
                </span></td>;
              })}
            </tr>)}</tbody>
          </table>
          <div className="up-cohort-legend"><span>Menor retenção</span><span className="up-cohort-scale" aria-hidden="true" /><span>Maior retenção</span></div>
          <p id="cohort-note" className="up-analysis-note">Mês 0 é o mês da primeira compra. Cada célula mostra a fatia do grupo que comprou naquele mês, sem somar meses anteriores. Traço indica mês futuro ou grupo sem compradores. Observado até {data.observedThrough.split("-").reverse().join("/")}; o último mês é parcial até essa data.</p>
        </>}
    </CardContent></Card>
  </section>;
}
