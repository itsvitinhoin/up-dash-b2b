import { Fragment, type ReactNode } from "react";
import { LayoutGrid } from "lucide-react";
import { MetricSection, Metrics } from "@/components/metric-section";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { OVERVIEW_SECTIONS, visibleKeys, type OverviewSection } from "@/lib/overview-layout";
import { useOverviewExtraCards } from "@/lib/use-overview-extra-cards";
import { useI18n } from "@/lib/i18n";
import { useOrganizationData } from "@/lib/organization-data";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import { formatCurrency } from "@/lib/formatters";
import { differenceInCalendarDays } from "date-fns";

// Cada seção pede só as fontes que usa (ver useOrganizationData): o resto nem é buscado.
const EXECUTIVE_SOURCES = ["dashboard", "marketing", "recompra", "performance"] as const;
const EXECUTIVE_PREVIOUS = ["recompra", "performance"] as const;
const ECOMMERCE_SOURCES = ["customers", "orders"] as const;
const ECOMMERCE_PREVIOUS = ["orders"] as const;
const PERFORMANCE_SOURCES = ["recompra", "funnel", "performance", "customers"] as const;
const PERFORMANCE_PREVIOUS = ["recompra", "funnel", "performance"] as const;
const MEDIA_SOURCES = ["marketing"] as const;

/** ROAS dos clientes que vieram de campanhas (o mesmo do painel "Clientes atribuídos às campanhas"). */
export type AttributedRoas = {
  value: number | null | undefined;
  previous?: number | null;
  loading?: boolean;
  /** Os dois lados da conta do ROAS (atendido atribuído ÷ investimento), mostrados embaixo do card. */
  revenue?: number | null;
  spend?: number | null;
};

/** Botão "Cards" do bloco: traz de volta os cards que saíram do padrão (a escolha fica só neste navegador). */
function ExtraCardsMenu({ section, selected, onToggle, onReset }: { section: OverviewSection; selected: string[]; onToggle: (key: string) => void; onReset: () => void }) {
  const { tx } = useI18n();
  if (section.extras.length === 0) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
          aria-label={tx("Escolher cards deste bloco")}
          data-testid={`${section.testId}-cards-menu`}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          {tx("Cards")}
          {selected.length > 0 ? ` (+${selected.length})` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3" data-testid={`${section.testId}-cards-popover`}>
        <p className="mb-1 text-xs font-medium">{tx("Cards disponíveis")}</p>
        <p className="mb-3 text-[11px] text-muted-foreground">{tx("Marque para trazer de volta um card que saiu do padrão deste bloco. Vale só neste navegador.")}</p>
        <div className="space-y-2">
          {section.extras.map((extra) => (
            <label key={extra.key} className="flex cursor-pointer items-center gap-2 text-xs">
              <Checkbox checked={selected.includes(extra.key)} onCheckedChange={() => onToggle(extra.key)} data-testid={`${section.testId}-extra-${extra.key}`} />
              <span>{tx(extra.label)}</span>
            </label>
          ))}
        </div>
        {selected.length > 0 && (
          <Button type="button" variant="ghost" size="sm" className="mt-3 h-7 w-full text-xs" onClick={onReset}>
            {tx("Restaurar padrão")}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function OverviewOrganization({
  cards,
  ecommerce,
  attributedRoas,
}: {
  cards: Record<string, ReactNode>;
  ecommerce: boolean;
  attributedRoas?: AttributedRoas;
}) {
  const { tx } = useI18n();
  const { pick, measures } = useOrganizationData(
    ecommerce ? ECOMMERCE_SOURCES : EXECUTIVE_SOURCES,
    ecommerce ? ECOMMERCE_PREVIOUS : EXECUTIVE_PREVIOUS,
  );
  const { dateRange } = useDashboardFilters();
  const { choice, toggle, reset } = useOverviewExtraCards();
  const money = (value: number | null | undefined) => (value != null && Number.isFinite(value) ? formatCurrency(value) : "—");
  // Investimento: as duas linhas usam só números que já estão na tela (investimento, dias do período e pedidos pagos).
  const days = Math.max(1, differenceInCalendarDays(dateRange.to, dateRange.from) + 1);
  const paidOrders = measures.orders?.value;
  const spendMetrics = pick("spend").map((metric) => ({
    ...metric,
    sub: [
      { label: tx("Média por dia"), value: money(metric.value != null ? metric.value / days : null) },
      { label: tx("Custo por pedido pago"), value: money(metric.value != null && paidOrders ? metric.value / paidOrders : null) },
    ],
  }));
  if (ecommerce)
    return (
      <div className="space-y-6">
        <MetricSection
          title={tx("RESULTADO DO ECOMMERCE")}
          columns={8}
          id="ecommerce-summary"
        >
          {cards.requested}
          {cards.revenue}
          {cards.orders}
          {cards.ticket}
          <Metrics metrics={pick("pieces", "registrations", "approved")} />
          {cards.conversion}
        </MetricSection>
        <MetricSection title={tx("CLIENTES E RETENÇÃO")} columns={3}>
          {cards.buyers}
          {cards.retention}
        </MetricSection>
      </div>
    );
  // ROAS "antigo" (clientes atribuídos às campanhas): fica disponível no bloco Anúncios, fora do padrão.
  const roasMetric = attributedRoas
    ? {
        key: "roas",
        label: tx("ROAS"),
        value: attributedRoas.value,
        format: "ratio" as const,
        source: tx("Clientes atribuídos às campanhas · atendido / investimento"),
        previousValue: attributedRoas.previous,
        loading: attributedRoas.loading,
        sub: [
          { label: tx("Atendido atribuído"), value: money(attributedRoas.revenue) },
          { label: tx("Investimento"), value: money(attributedRoas.spend) },
        ],
      }
    : measures.roas;
  const renderCard = (key: string): ReactNode => {
    if (key === "spendOld") return <Metrics metrics={spendMetrics} />;
    if (key === "roasOld") return roasMetric ? <Metrics metrics={[roasMetric]} /> : null;
    if (key in cards) return cards[key];
    return measures[key] ? <Metrics metrics={[measures[key]]} /> : null;
  };
  return (
    <div className="space-y-6">
      {OVERVIEW_SECTIONS.map((section) => (
        <MetricSection
          key={section.id}
          title={tx(section.title)}
          columns={4}
          id={section.testId}
          action={<ExtraCardsMenu section={section} selected={choice[section.id] ?? []} onToggle={(key) => toggle(section.id, key)} onReset={() => reset(section.id)} />}
        >
          {visibleKeys(section, choice).map((key) => (
            <Fragment key={key}>{renderCard(key)}</Fragment>
          ))}
        </MetricSection>
      ))}
    </div>
  );
}
export function PerformanceSummarySections() {
  const { tx } = useI18n();
  const { pick } = useOrganizationData(PERFORMANCE_SOURCES, PERFORMANCE_PREVIOUS);
  return (
    <div className="space-y-6">
      <MetricSection title={tx("AQUISIÇÃO")} columns={3}>
        <Metrics
          metrics={pick(
            "acquisitionRevenue",
            "acquisitionTicket",
            "acquisitionOrders",
          )}
        />
      </MetricSection>
      <MetricSection title={tx("RETENÇÃO")} columns={3}>
        <Metrics
          metrics={pick(
            "retentionRevenue",
            "retentionTicket",
            "retentionOrders",
          )}
        />
      </MetricSection>
      <MetricSection title={tx("FUNIL / EFICIÊNCIA")} columns={6}>
        <Metrics
          metrics={pick(
            "approvedConversion",
            "cac",
            "approved",
            "registrations",
            "costApproved",
            "approvalRate",
          )}
        />
      </MetricSection>
    </div>
  );
}
export function MediaInvestmentCards() {
  const { pick } = useOrganizationData(MEDIA_SOURCES);
  return <Metrics metrics={pick("totalSpend", "metaSpend", "googleSpend")} />;
}
