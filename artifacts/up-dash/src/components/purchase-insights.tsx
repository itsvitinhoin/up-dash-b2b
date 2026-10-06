import { displayLabel } from "@/lib/display-label";
import { Card, CardContent } from "@/components/ui/card";
import { GlassMetricCard } from "@/components/glass-metric-card";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import type { PurchaseInsights } from "@/lib/purchase-insights";
const pct = (value: number | null | undefined) => value == null ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const days = (value: number | null | undefined) => value == null ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dias`;
export function PurchaseInsightsPanels({ data, loading, error }: { data?: PurchaseInsights; loading: boolean; error: boolean }) {
  const steps = data?.baseEvolution, velocity = data?.conversionVelocity;
  const unavailable = error ? "Não foi possível carregar esta análise. Tente atualizar a página." : "Análise indisponível nesta fonte.";
  return <div className="space-y-8">
    <section aria-labelledby="base-evolution-title" data-testid="base-evolution">
      <h2 id="base-evolution-title" className="up-analysis-title">Evolução da Base</h2>
      <p className="up-analysis-description">Quantos lojistas chegam a cada novo pedido e quanto cada etapa soma ao faturamento.</p>
      <Card><CardContent className="p-6">
        {loading ? <p className="text-sm text-muted-foreground">Carregando evolução da base…</p> : !steps ? <p className="text-sm text-muted-foreground">{unavailable}</p> : <>
          <div className="up-base-evolution">
            {steps.map((step, i) => <div key={step.label} className="up-base-step">
              <div className="up-base-connector"><span className="up-base-dot" />{i < steps.length-1 && <span className="up-base-follow">{pct(steps[i+1].continuationPct)} seguem</span>}</div>
              <p className="text-xs text-muted-foreground">{displayLabel(step.label)}</p>
              <div className="flex items-baseline gap-2"><strong className="text-[30px] font-semibold tabular-nums">{formatNumber(step.customers)}</strong><span className="text-xs text-muted-foreground">{pct(step.basePct)}</span></div>
              <p className="text-xs mt-2">{formatCurrency(step.revenue)} <span className="text-muted-foreground">em receita</span></p>
              <p className="text-xs mt-1">{formatCurrency(step.accumulatedRevenue)} <span className="text-muted-foreground">acumulado</span></p>
              <div className="up-base-progress" role="meter" aria-label={`${step.label}: proporção da base`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={step.basePct ?? 0}><span style={{ width: `${Math.min(100,step.basePct ?? 0)}%` }} /></div>
            </div>)}
          </div>
          <p className="up-analysis-note">Base: lojistas com a primeira compra no período selecionado. Pedidos pagos até o fim do período, em todas as origens. Compra 4+ reúne a quarta compra e as seguintes.</p>
        </>}
      </CardContent></Card>
    </section>
    <section aria-labelledby="conversion-velocity-title" data-testid="conversion-velocity">
      <h2 id="conversion-velocity-title" className="up-analysis-title">Velocidade de Conversão</h2>
      <p className="up-analysis-description">Em quanto tempo o lojista aprovado faz o primeiro pedido.</p>
      {loading ? <Card><CardContent className="p-6 text-sm text-muted-foreground">Carregando velocidade de conversão…</CardContent></Card> : !velocity ? <Card><CardContent className="p-6 text-sm text-muted-foreground">{unavailable}</CardContent></Card> : <>
        <div className="up-velocity-layout">
          <Card><CardContent className="p-6"><h3 className="text-sm font-semibold">Distribuição de compradores</h3><p className="text-xs text-muted-foreground mt-2">Da aprovação ao primeiro pedido pago. Base: {formatNumber(velocity.sampleSize)} compradores com datas válidas.</p>
            {velocity.sampleSize === 0 ? <div className="flex min-h-[240px] items-center justify-center text-sm text-muted-foreground">Sem datas de aprovação disponíveis para esta base.</div> : <div className="up-velocity-bars" role="img" aria-label={velocity.buckets.map(b=>`${b.label}: ${b.customers} compradores, ${pct(b.pct)}`).join("; ")}>
              {velocity.buckets.map(bucket => <div key={bucket.label} className="up-velocity-column"><div className="up-velocity-track"><div className="up-velocity-bar" style={{ height: `${Math.max(2, (bucket.pct ?? 0)/Math.max(...velocity.buckets.map(b=>b.pct??0),1)*82)}%` }}><span>{pct(bucket.pct)}</span></div></div><p>{displayLabel(bucket.label)}</p></div>)}
            </div>}
          </CardContent></Card>
          <div className="up-velocity-summary">
            <GlassMetricCard label="Compram na primeira semana" value={pct(velocity.firstWeekPct)} footer={`${formatNumber(velocity.firstWeekCount)} lojistas`} />
            <GlassMetricCard label="Compram em até 30 dias" value={pct(velocity.within30Pct)} footer={`${formatNumber(velocity.within30Count)} lojistas`} />
            <GlassMetricCard label="Mediana até o pedido" value={days(velocity.medianDays)} footer={`Média de ${days(velocity.averageDays)}`} />
          </div>
        </div>
        <p className="up-analysis-note">Mesma base de novos compradores do período. {velocity.missingApproval > 0 && `${formatNumber(velocity.missingApproval)} sem data de aprovação foram excluídos. `}{velocity.invalidChronology > 0 && `${formatNumber(velocity.invalidChronology)} com pedido anterior à aprovação foram excluídos. `}O prazo usa a data do pedido pago registrada na origem, que pode diferir da data de pagamento.</p>
      </>}
    </section>
  </div>;
}
