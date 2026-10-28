import { Fragment, type ReactNode } from "react";
import { MetricSection, Metrics } from "@/components/metric-section";
import { OVERVIEW_SECTIONS } from "@/lib/overview-layout";
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
  const { dateRange, filters } = useDashboardFilters();
  // Vendedora e Estado só chegam ao e-commerce/Vesti e à Recompra do site: ERP e anúncios mostram o total do cliente.
  const filterIgnoredNotice = !!(filters.sellerId || filters.state);
  const money =(value: number | null | undefined) => (value != null && Number.isFinite(value) ? formatCurrency(value) : "—");
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
  // ROAS "antigo" (clientes atribuídos às campanhas): fora do padrão, continua pronto (ver lib/overview-layout.ts).
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
      {filterIgnoredNotice && (
        <p className="text-xs text-muted-foreground" data-testid="overview-filter-notice">
          {tx("Com Vendedora ou Estado ativos, os cards de ERP e de anúncios mostram o total do cliente: esses dados não são divididos por vendedora ou estado.")}
        </p>
      )}
      {OVERVIEW_SECTIONS.map((section) => (
        <MetricSection key={section.id} title={tx(section.title)} columns={4} id={section.testId}>
          {section.defaults.map((key) => (
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
