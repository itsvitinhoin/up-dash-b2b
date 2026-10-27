import { useDisplayLabel } from "@/lib/display-label";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { GlassMetricCard } from "@/components/glass-metric-card";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import type { PurchaseInsights } from "@/lib/purchase-insights";
const pctWith = (locale: string, value: number | null | undefined) => value == null ? "—" : `${value.toLocaleString(locale, { maximumFractionDigits: 1 })}%`;
const daysWith = (locale: string, unit: string, value: number | null | undefined) => value == null ? "—" : `${value.toLocaleString(locale, { maximumFractionDigits: 1 })} ${unit}`;
export function PurchaseInsightsPanels({ data, previousData, loading, error }: { data?: PurchaseInsights; previousData?: PurchaseInsights; loading: boolean; error: boolean }) {
  const { tx, language } = useI18n();
  const displayLabel = useDisplayLabel();
  const locale = language === "ko" ? "ko-KR" : language === "en" ? "en-US" : "pt-BR";
  const pct = (value: number | null | undefined) => pctWith(locale, value);
  const days = (value: number | null | undefined) => daysWith(locale, tx("dias"), value);
  const steps = data?.baseEvolution, velocity = data?.conversionVelocity;
  const unavailable = error ? tx("Não foi possível carregar esta análise. Tente atualizar a página.") : tx("Análise indisponível nesta fonte.");
  return <div className="space-y-8">
    <section aria-labelledby="base-evolution-title" data-testid="base-evolution">
      <h2 id="base-evolution-title" className="up-analysis-title">{tx("Evolução da Base")}</h2>
      <p className="up-analysis-description">{tx("Quantos lojistas chegam a cada novo pedido e quanto cada etapa soma ao faturamento.")}</p>
      <Card><CardContent className="p-6">
        {loading ? <p className="text-sm text-muted-foreground">{tx("Carregando evolução da base…")}</p> : !steps ? <p className="text-sm text-muted-foreground">{unavailable}</p> : <>
          <div className="up-base-evolution">
            {steps.map((step, i) => <div key={step.label} className="up-base-step">
              <div className="up-base-connector"><span className="up-base-dot" />{i < steps.length-1 && <span className="up-base-follow">{pct(steps[i+1].continuationPct)} {tx("seguem")}</span>}</div>
              <p className="text-xs text-muted-foreground">{tx(displayLabel(step.label))}</p>
              <div className="flex items-baseline gap-2"><strong className="text-[30px] font-semibold tabular-nums">{formatNumber(step.customers)}</strong><span className="text-xs text-muted-foreground">{pct(step.basePct)}</span></div>
              <p className="text-xs mt-2">{formatCurrency(step.revenue)} <span className="text-muted-foreground">{tx("em receita")}</span></p>
              <p className="text-xs mt-1">{formatCurrency(step.accumulatedRevenue)} <span className="text-muted-foreground">{tx("acumulado")}</span></p>
              <div className="up-base-progress" role="meter" aria-label={`${displayLabel(step.label)}: ${tx("proporção da base")}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={step.basePct ?? 0}><span style={{ width: `${Math.min(100,step.basePct ?? 0)}%` }} /></div>
            </div>)}
          </div>
          <p className="up-analysis-note">{tx("Base: lojistas com a primeira compra no período selecionado. Pedidos pagos até o fim do período, em todas as origens. Compra 4+ reúne a quarta compra e as seguintes.")}</p>
        </>}
      </CardContent></Card>
    </section>
    <section aria-labelledby="conversion-velocity-title" data-testid="conversion-velocity">
      <h2 id="conversion-velocity-title" className="up-analysis-title">{tx("Velocidade de Conversão")}</h2>
      <p className="up-analysis-description">{tx("Em quanto tempo o lojista aprovado faz o primeiro pedido.")}</p>
      {loading ? <Card><CardContent className="p-6 text-sm text-muted-foreground">{tx("Carregando velocidade de conversão…")}</CardContent></Card> : !velocity ? <Card><CardContent className="p-6 text-sm text-muted-foreground">{unavailable}</CardContent></Card> : <>
        <div className="up-velocity-layout">
          <Card><CardContent className="p-6"><h3 className="text-sm font-semibold">{tx("Distribuição de compradores")}</h3><p className="text-xs text-muted-foreground mt-2">{tx("Da aprovação ao primeiro pedido pago. Base:")} {formatNumber(velocity.sampleSize)} {tx("compradores com datas válidas.")}</p>
            {velocity.sampleSize === 0 ? <div className="flex min-h-[240px] items-center justify-center text-sm text-muted-foreground">{tx("Sem datas de aprovação disponíveis para esta base.")}</div> : <div className="up-velocity-bars" role="img" aria-label={velocity.buckets.map(b=>`${displayLabel(b.label)}: ${b.customers} ${tx("compradores")}, ${pct(b.pct)}`).join("; ")}>
              {velocity.buckets.map(bucket => <div key={bucket.label} className="up-velocity-column"><div className="up-velocity-track"><div className="up-velocity-bar" style={{ height: `${Math.max(2, (bucket.pct ?? 0)/Math.max(...velocity.buckets.map(b=>b.pct??0),1)*82)}%` }}><span>{pct(bucket.pct)}</span></div></div><p>{tx(displayLabel(bucket.label))}</p></div>)}
            </div>}
          </CardContent></Card>
          <div className="up-velocity-summary">
            <GlassMetricCard label={tx("Compram na primeira semana")} value={pct(velocity.firstWeekPct)} comparisonValue={velocity.firstWeekPct} previousValue={previousData?.conversionVelocity?.firstWeekPct} format={pct} source={tx("Ecommerce · primeira compra e data de aprovação")} footer={`${formatNumber(velocity.firstWeekCount)} ${tx("lojistas")}`} />
            <GlassMetricCard label={tx("Compram em até 30 dias")} value={pct(velocity.within30Pct)} comparisonValue={velocity.within30Pct} previousValue={previousData?.conversionVelocity?.within30Pct} format={pct} source={tx("Ecommerce · primeira compra e data de aprovação")} footer={`${formatNumber(velocity.within30Count)} ${tx("lojistas")}`} />
            <GlassMetricCard label={tx("Mediana até o pedido")} value={days(velocity.medianDays)} comparisonValue={velocity.medianDays} previousValue={previousData?.conversionVelocity?.medianDays} format={days} source={tx("Ecommerce · primeira compra e data de aprovação")} footer={`${tx("Média de")} ${days(velocity.averageDays)}`} />
          </div>
        </div>
        <p className="up-analysis-note">{tx("Mesma base de novos compradores do período.")} {velocity.missingApproval > 0 && `${formatNumber(velocity.missingApproval)} ${tx("sem data de aprovação foram excluídos.")} `}{velocity.invalidChronology > 0 && `${formatNumber(velocity.invalidChronology)} ${tx("com pedido anterior à aprovação foram excluídos.")} `}{tx("O prazo usa a data do pedido pago registrada na origem, que pode diferir da data de pagamento.")}</p>
      </>}
    </section>
  </div>;
}
