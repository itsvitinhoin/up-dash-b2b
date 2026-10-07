import { displayLabel } from "@/lib/display-label";
import { useI18n } from "@/lib/i18n";
import { motion } from "framer-motion";
import type { ReactNode, ElementType } from "react";
import { ArrowDownRight, ArrowUpRight, Minus, Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { metricComparison } from "@/lib/metric-comparison";
import { useMetricData } from "@/components/metric-data-context";
import { Skeleton } from "@/components/ui/skeleton";
import { CountUp } from "@/components/count-up";
import { Sparkline } from "@/components/sparkline";
import { cardEntry, useReducedMotion, withReducedMotion } from "@/lib/motion";

export interface DashboardKpiCardProps {
  icon: ElementType;
  iconClass: string;
  label: string;
  value: number;
  format: (value: number) => string;
  unit?: string;
  change: number | null;
  changeLabel: string;
  sub: { label: string; value: string }[];
  sparkValues: number[];
  sparkColor: string;
  isLoading: boolean;
  testId: string;
  valueAccent?: boolean;
  ringValue?: number;
  ringColor?: string;
  displayValue?: ReactNode;
  labelAccessory?: ReactNode;
  footer?: ReactNode;
  deltaContent?: ReactNode;
  changePositive?: boolean;
  className?: string;
  info?: ReactNode;
  source?: string;
  previousValue?: number | null;
  comparisonValue?: number | null;
  comparisonUnavailable?: string;
  hideComparison?: boolean;
}

const METRIC_DESCRIPTIONS: Record<string, string> = {
  "Investimento Meta": "Valor investido em anúncios na Meta durante o período selecionado.",
  "Investimento Google": "Valor investido em anúncios no Google durante o período selecionado.",
  "Impressões": "Número de vezes que os anúncios foram exibidos no período.",
  "Cliques": "Quantidade de cliques registrada pela plataforma no período.",
  "CTR": "Taxa de cliques em relação às impressões dos anúncios.",
  "CPC": "Custo médio por clique registrado pela fonte.",
  "CPL": "Custo médio por lead registrado pela fonte.",
  "CPA": "Custo médio por aquisição registrada pela fonte.",
  "ROAS": "Retorno da receita atribuída em relação ao investimento em mídia, conforme a base desta fonte.",
  "Ticket Médio": "Valor médio dos pedidos considerados na fonte e nos filtros selecionados.",
};

function MiniRing({
  pct,
  color,
  reduced,
}: {
  pct: number;
  color: string;
  reduced: boolean;
}) {
  const size = 52;
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  const dash = (clamped / 100) * c;
  return (
    <svg width={size} height={size} className="-rotate-90 shrink-0" aria-hidden>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke="hsl(var(--muted-foreground))"
        strokeOpacity={0.25}
        strokeWidth={stroke}
        fill="none"
      />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        fill="none"
        strokeDasharray={c}
        initial={{ strokeDashoffset: reduced ? c - dash : c }}
        animate={{ strokeDashoffset: c - dash }}
        transition={{ duration: reduced ? 0 : 1.1, ease: [0.22, 1, 0.36, 1] }}
      />
    </svg>
  );
}

export function DashboardKpiCard({
  icon: Icon,
  iconClass,
  label,
  value,
  format: fmt,
  unit,
  change,
  changeLabel,
  sub,
  sparkValues,
  sparkColor,
  isLoading,
  testId,
  valueAccent,
  ringValue,
  ringColor,
  displayValue,
  labelAccessory,
  footer,
  deltaContent,
  changePositive,
  className, info, source, previousValue, comparisonValue, comparisonUnavailable, hideComparison,
}: DashboardKpiCardProps) {
  const reduced = useReducedMotion();
  const { language, tx } = useI18n();
  const numberLocale = language === "ko" ? "ko-KR" : language === "en" ? "en-US" : "pt-BR";
  const contextual = useMetricData(testId);
  const previous = previousValue !== undefined ? previousValue : contextual.previous;
  const comparison = metricComparison(comparisonValue !== undefined ? comparisonValue : contextual.current !== undefined ? contextual.current : (displayValue === undefined ? value : undefined), previous);
  const effectiveChange = previous !== undefined ? comparison.change : change !== null && Number.isFinite(change) ? change : null;
  const positive = changePositive ?? (effectiveChange !== null && effectiveChange >= 0);
  const rising = effectiveChange !== null && effectiveChange > 0;
  // Linhas de fonte/base/regra vão para o popover de informação, exceto as que trazem número: número nunca sai da vista.
  const metadata = sub.filter(row => /^(fonte|base|cálculo|disponibilidade|regra|período)$/i.test(row.label) && !/\d/.test(row.value));
  const details = sub.filter(row => !metadata.includes(row));
  const metricSource = tx(source ?? metadata.find(row => /^fonte$/i.test(row.label))?.value ?? contextual.source ?? "Dados conectados do relatório");
  const comparisonText = comparison.status === "zero-base" ? tx("O valor anterior é zero; a variação percentual não pode ser calculada.") : tx(comparisonUnavailable ?? "A fonte não disponibilizou um valor anterior comparável para esta métrica.");
  const variants = withReducedMotion(cardEntry, reduced);
  return (
    <motion.div variants={variants} className={`up-metric-wrapper h-full min-w-0 ${className ?? ""}`}>
      <Card
        data-testid={testId}
        className="up-metric flex h-full flex-col p-[18px] border-border transition-shadow"
      >
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="up-metric-icon flex h-8 w-8 items-center justify-center rounded-lg">
              <Icon className="h-4 w-4" />
            </div>
            <span className="up-metric-label min-w-0 text-[13px] text-muted-foreground">
              {tx(label)}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {labelAccessory}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="up-metric-info h-7 w-7 shrink-0 rounded-full" aria-label={`${tx("Informações")}: ${tx(label)}`}>
                  <Info className="h-3.5 w-3.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="up-metric-information w-[min(320px,calc(100vw-24px))] space-y-3 text-xs" aria-label={`${tx("Informações da métrica")} ${tx(label)}`}>
                <p className="font-semibold text-sm">{tx(label)}</p>
                <div className="text-muted-foreground leading-relaxed">{info ?? tx(METRIC_DESCRIPTIONS[label] ?? "Valor da métrica conforme o período e os filtros selecionados.")}</div>
                {metadata.filter(row => !/^fonte$/i.test(row.label)).map(row => <p key={row.label}><span className="text-muted-foreground">{tx(row.label)}: </span>{tx(row.value)}</p>)}
                <p><span className="text-muted-foreground">{tx("Fonte")}: </span>{metricSource}</p>
                {!hideComparison && <p className="text-muted-foreground">{tx("Comparação com a janela imediatamente anterior de mesma duração, mantendo os filtros.")} {effectiveChange === null ? comparisonText : tx("Variação percentual sobre o valor anterior.")}</p>}
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <div className="flex items-end justify-between gap-3 mb-3">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            {isLoading ? (
              <Skeleton className="h-9 w-32" />
            ) : (
              <>
                <span
                  className={`up-metric-value text-[30px] font-medium tracking-tight tabular-nums ${
                    valueAccent
                      ? "bg-gradient-to-br from-foreground via-foreground to-primary bg-clip-text text-transparent"
                      : ""
                  }`}
                >
                  {displayValue !== undefined ? displayValue : <CountUp value={value} format={fmt} />}
                </span>
                {unit && (
                  <span className="text-xs text-muted-foreground font-medium">
                    {unit}
                  </span>
                )}
              </>
            )}
          </div>
          {!isLoading && ringValue !== undefined ? (
            <MiniRing
              pct={ringValue}
              color={ringColor ?? sparkColor}
              reduced={reduced}
            />
          ) : null}
        </div>

        {!isLoading && !hideComparison && <div className="up-metric-comparison mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" data-comparison-state={effectiveChange !== null ? "available" : comparison.status}>
          {effectiveChange !== null && Number.isFinite(effectiveChange) ? <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium ${effectiveChange === 0 ? "up-delta-neutral" : positive ? "up-delta-positive" : "up-delta-negative"}`}>
            {effectiveChange === 0 ? <Minus className="h-3 w-3" /> : rising ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {effectiveChange > 0 ? "+" : ""}{effectiveChange.toLocaleString(numberLocale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
          </span> : <span className="up-delta-neutral rounded-full px-2 py-0.5">{comparison.status === "zero-base" ? tx("Sem base percentual") : tx("Indisponível")}</span>}
          <span className="text-muted-foreground">{tx(changeLabel || "vs. período anterior")}</span>
          {previous != null && Number.isFinite(previous) && <span className="basis-full text-muted-foreground">{tx("Anterior")}: <span className="text-foreground tabular-nums">{(contextual.format ?? fmt)(previous)}</span></span>}
          {deltaContent !== undefined && <div className="basis-full">{deltaContent}</div>}
        </div>}

        {!isLoading && sparkValues.length > 1 && (
          <Sparkline
            values={sparkValues}
            stroke="var(--up-chart-line)"
            fill="var(--up-chart-fill)"
            width={240}
            height={40}
            className="up-metric-spark w-full mb-3"
            ariaLabel={`${tx(label)} · ${tx("evolução no período")}`}
          />
        )}

        {(details.length > 0 || footer) && <div className="up-metric-footer mt-auto pt-3 border-t border-border space-y-2">
          {details.map((row) => (
            <div key={row.label} className="flex justify-between gap-2 text-xs">
              <span className="min-w-0 text-muted-foreground">
                {tx(language === "pt" ? displayLabel(row.label) : row.label)}
              </span>
              <span
                className="min-w-0 text-right font-medium tabular-nums"
                title={tx(row.value)}
              >
                {tx(row.value)}
              </span>
            </div>
          ))}
          {footer}
        </div>}
      </Card>
    </motion.div>
  );
}
