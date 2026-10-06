import type { ReactNode } from "react";
import { MetricSection, Metrics } from "@/components/metric-section";
import { useOrganizationData } from "@/lib/organization-data";

export function OverviewOrganization({
  cards,
  ecommerce,
}: {
  cards: Record<string, ReactNode>;
  ecommerce: boolean;
}) {
  const { pick } = useOrganizationData();
  if (ecommerce)
    return (
      <div className="space-y-6">
        <MetricSection
          title="RESULTADO DO ECOMMERCE"
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
        <MetricSection title="CLIENTES E RETENÇÃO" columns={3}>
          {cards.buyers}
          {cards.retention}
        </MetricSection>
      </div>
    );
  return (
    <div className="space-y-6">
      <MetricSection title="RESULTADO GERAL" columns={5} id="executive-result">
        {cards.revenue}
        {cards.orders}
        <Metrics metrics={pick("spend", "roas")} />
        {cards.ticket}
      </MetricSection>
      <MetricSection title="AQUISIÇÃO" columns={5} id="executive-acquisition">
        <Metrics
          metrics={pick(
            "newCustomers",
            "acquisitionRevenue",
            "acquisitionOrders",
            "acquisitionTicket",
            "cac",
          )}
        />
      </MetricSection>
      <MetricSection title="RETENÇÃO" columns={4} id="executive-retention">
        <Metrics
          metrics={pick(
            "repurchasers",
            "retentionRevenue",
            "retentionOrders",
            "retentionTicket",
          )}
        />
      </MetricSection>
      <MetricSection title="INDICADORES OPERACIONAIS" columns={4}>
        {cards.requested}
        {cards.buyers}
        {cards.retention}
        {cards.conversion}
      </MetricSection>
    </div>
  );
}
export function PerformanceSummarySections() {
  const { pick } = useOrganizationData();
  return (
    <div className="space-y-6">
      <MetricSection title="AQUISIÇÃO" columns={3}>
        <Metrics
          metrics={pick(
            "acquisitionRevenue",
            "acquisitionTicket",
            "acquisitionOrders",
          )}
        />
      </MetricSection>
      <MetricSection title="RETENÇÃO" columns={3}>
        <Metrics
          metrics={pick(
            "retentionRevenue",
            "retentionTicket",
            "retentionOrders",
          )}
        />
      </MetricSection>
      <MetricSection title="FUNIL / EFICIÊNCIA" columns={6}>
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
  const { pick } = useOrganizationData();
  return <Metrics metrics={pick("totalSpend", "metaSpend", "googleSpend")} />;
}
