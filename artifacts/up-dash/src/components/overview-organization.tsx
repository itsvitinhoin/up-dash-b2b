import type { ReactNode } from "react";
import { MetricSection, Metrics } from "@/components/metric-section";
import { useI18n } from "@/lib/i18n";
import { useOrganizationData } from "@/lib/organization-data";

// Cada seção pede só as fontes que usa (ver useOrganizationData): o resto nem é buscado.
const EXECUTIVE_SOURCES = ["dashboard", "marketing", "recompra"] as const;
const EXECUTIVE_PREVIOUS = ["recompra"] as const;
const ECOMMERCE_SOURCES = ["customers", "orders"] as const;
const ECOMMERCE_PREVIOUS = ["orders"] as const;
const PERFORMANCE_SOURCES = ["recompra", "funnel", "performance", "customers"] as const;
const PERFORMANCE_PREVIOUS = ["recompra", "funnel", "performance"] as const;
const MEDIA_SOURCES = ["marketing"] as const;

/** ROAS dos clientes que vieram de campanhas (o mesmo do painel "Clientes atribuídos às campanhas"). */
export type AttributedRoas = { value: number | null | undefined; previous?: number | null; loading?: boolean };

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
  return (
    <div className="space-y-6">
      <MetricSection title={tx("RESULTADO GERAL")} columns={5} id="executive-result">
        {cards.revenue}
        {cards.orders}
        <Metrics
          metrics={[
            ...pick("spend"),
            attributedRoas
              ? { key: "roas", label: tx("ROAS"), value: attributedRoas.value, format: "ratio" as const, source: tx("Clientes atribuídos às campanhas · atendido / investimento"), previousValue: attributedRoas.previous, loading: attributedRoas.loading }
              : measures.roas,
          ]}
        />
        {cards.ticket}
      </MetricSection>
      <MetricSection title={tx("AQUISIÇÃO")} columns={4} id="executive-acquisition">
        <Metrics
          metrics={pick(
            "newCustomers",
            "acquisitionRevenue",
            "acquisitionOrders",
            "acquisitionTicket",
          )}
        />
      </MetricSection>
      <MetricSection title={tx("RETENÇÃO")} columns={4} id="executive-retention">
        <Metrics
          metrics={pick(
            "repurchasers",
            "retentionRevenue",
            "retentionOrders",
            "retentionTicket",
          )}
        />
      </MetricSection>
      <MetricSection title={tx("INDICADORES OPERACIONAIS")} columns={4}>
        {cards.requested}
        {cards.buyers}
        {cards.retention}
        {cards.conversion}
      </MetricSection>
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
