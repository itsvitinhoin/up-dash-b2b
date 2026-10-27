import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import type { MonthlyCohort } from "@/lib/purchase-insights";
import { formatNumber } from "@/lib/formatters";

const monthLabelWith = (locale: string, month: string) => new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" })
  .format(new Date(`${month}-01T12:00:00Z`));
const percentWith = (locale: string, value: number) => `${value.toLocaleString(locale, { maximumFractionDigits: 1 })}%`;

export function CohortHeatmap({ data, loading, error }: { data?: MonthlyCohort; loading: boolean; error: boolean }) {
  const { tx, language } = useI18n();
  const locale = language === "ko" ? "ko-KR" : language === "en" ? "en-US" : "pt-BR";
  const monthLabel = (month: string) => monthLabelWith(locale, month);
  const percent = (value: number) => percentWith(locale, value);
  return <section aria-labelledby="cohort-title" data-testid="monthly-cohort">
    <h2 id="cohort-title" className="up-analysis-title">{tx("Análise de Cohort")}</h2>
    <p className="up-analysis-description">{tx("Grupos de lojistas pelo mês da primeira compra e quantos voltam nos meses seguintes.")}</p>
    <Card><CardContent>
      {loading ? <p className="text-sm text-muted-foreground">{tx("Carregando cohort…")}</p>
        : !data ? <p className="text-sm text-muted-foreground">{error ? tx("Não foi possível carregar esta análise. Tente atualizar a página.") : tx("Análise indisponível nesta fonte.")}</p>
        : <>
          <table className="up-cohort-table" aria-label={tx("Retenção mensal por cohort")} aria-describedby="cohort-note">
            <thead><tr><th scope="col">{tx("Primeira compra")}</th>{[0,1,2,3].map(month => <th key={month} scope="col">{tx("Mês")} {month}</th>)}</tr></thead>
            <tbody>{data.rows.map(row => <tr key={row.month}>
              <th scope="row"><span className="up-cohort-month">{monthLabel(row.month)} <span>{row.month.slice(0,4)}</span></span><small>{formatNumber(row.customers)} {tx("lojistas")}</small></th>
              {[0,1,2,3].map(offset => {
                const value = row.retention[offset] ?? null;
                return <td key={offset}><span className={`up-cohort-cell ${value == null ? "is-unobserved" : ""}`}
                  style={value == null ? undefined : { background: `hsl(var(--chart-1) / ${offset === 0 ? .45 : .10 + Math.min(100,Math.max(0,value)) / 100 * .65})` }}
                  title={`${monthLabel(row.month)} ${row.month.slice(0,4)}, ${tx("mês")} ${offset}: ${value == null ? tx("sem dados observados") : percent(value)}`}>
                  {value == null ? "—" : percent(value)}
                </span></td>;
              })}
            </tr>)}</tbody>
          </table>
          <div className="up-cohort-legend"><span>{tx("Menor retenção")}</span><span className="up-cohort-scale" aria-hidden="true" /><span>{tx("Maior retenção")}</span></div>
          <p id="cohort-note" className="up-analysis-note">{tx("Mês 0 é o mês da primeira compra. Cada célula mostra a fatia do grupo que comprou naquele mês, sem somar meses anteriores. Traço indica mês futuro ou grupo sem compradores.")} {tx("Observado até")} {data.observedThrough.split("-").reverse().join("/")}; {tx("o último mês é parcial até essa data.")}</p>
        </>}
    </CardContent></Card>
  </section>;
}
