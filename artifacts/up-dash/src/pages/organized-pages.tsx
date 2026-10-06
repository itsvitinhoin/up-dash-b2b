import { displayLabel } from "@/lib/display-label";
import { GlassMetricCard } from "@/components/glass-metric-card";
import { BarChart3 } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import RecompraPage from "@/pages/performance-recompra";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  MetricSection,
  Metrics,
  OrganizationHeading,
} from "@/components/metric-section";
import { useOrganizationData } from "@/lib/organization-data";
import { AcquisitionFunnel } from "@/components/acquisition-funnel";
import { usePurchaseInsights } from "@/lib/purchase-insights";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import DashboardPage from "@/pages/dashboard";
import FunnelPage from "@/pages/funnel";
import CustomersPage from "@/pages/customers";
import OrdersPage from "@/pages/orders";
import ProductsPage from "@/pages/products";
import SellersPage from "@/pages/sellers";
import StockPage from "@/pages/stock-intelligence";
import GeographyPage from "@/pages/geography";
import RfmPage from "@/pages/rfm";
import JourneyPage from "@/pages/journey";
import UtmPage from "@/pages/utm";
import MarketingPage from "@/pages/marketing";
import MonthlyHistoryPage from "@/pages/monthly-history";
import { ErpGeographyView } from "@/pages/erp";
import type { ArchitecturePage } from "@/lib/dashboard-architecture";

function AcquisitionPage() {
  const { pick } = useOrganizationData();
  return (
    <div className="space-y-6" data-testid="acquisition-page">
      <MetricSection title="AQUISIÇÃO" columns={4}>
        <Metrics
          metrics={pick(
            "acquisitionRevenue",
            "acquisitionTicket",
            "acquisitionOrders",
            "newCustomers",
          )}
        />
      </MetricSection>
      <MetricSection title="INVESTIMENTO E CUSTOS" columns={4}>
        <Metrics
          metrics={pick("cac", "costRegistration", "costApproved", "spend")}
        />
      </MetricSection>
      <MetricSection title="ATIVAÇÃO DOS APROVADOS" columns={3}>
        <Metrics
          metrics={pick("approved", "approvedConverted", "approvedConversion")}
        />
      </MetricSection>
      <MetricSection title="CADASTRO → PRIMEIRA COMPRA" columns={2}>
        <Metrics
          metrics={pick("firstPurchaseAverage", "firstPurchaseMedian")}
        />
      </MetricSection>
      <div className="grid gap-4 lg:grid-cols-2">
        {[
          "Faturamento × Ticket",
          "Pedidos × Clientes",
          "Investimento × CAC",
          "Cadastros Aprovados × Conversão",
        ].map((title) => (
          <Card key={title}>
            <CardHeader>
              <CardTitle className="text-sm">{title}</CardTitle>
            </CardHeader>
            <CardContent>
              <EmptyState
                icon={BarChart3}
                title="Análise indisponível"
                description="Os dados desta análise ainda não estão disponíveis nesta fonte."
              />
            </CardContent>
          </Card>
        ))}
      </div>
      <OrganizationHeading>
        COHORT DE ATIVAÇÃO E DIAGNÓSTICOS
      </OrganizationHeading>
      <FunnelPage organization="acquisition" />
    </div>
  );
}
function PerformanceFunnelPage() {
  const { pick, measures, funnel, dashboard } = useOrganizationData();
  const insights = usePurchaseInsights();
  const acquisitionLeads = measures.registrations.value;
  const acquisitionApproved = measures.approved.value;
  const steps = funnel.data?.steps ?? [];
  const count = (...keys: string[]) =>
    steps.find((step) => keys.includes(step.step))?.count;
  const stages = [
    { label: "Impressões", value: measures.impressions.value },
    { label: "Alcance", value: measures.reach.value },
    { label: "Cliques no Link", value: null },
    {
      label: "Visitas / Sessões",
      value: dashboard.data?.traffic?.sessions ?? count("VISIT", "SESSIONS"),
    },
    { label: "Cadastros", value: count("REGISTRATION") },
    {
      label: "Cadastros Aprovados",
      value: count("APPROVED_REGISTRATION", "APPROVAL"),
    },
    { label: "Adições ao Carrinho", value: count("ADD_TO_CART") },
    {
      label: "Checkout",
      value: count("CHECKOUT_STARTED", "CHECKOUT", "ORDER_SUBMITTED"),
    },
    {
      label: "Faturamento Solicitado",
      value: measures.requestedRevenue.value,
      currency: true,
    },
    {
      label: "Faturamento Pago",
      value: measures.paidRevenue.value,
      currency: true,
    },
  ];
  const indicators = [
    "frequency",
    "ctr",
    "cpc",
    "connectRate",
    "registrationRate",
    "approvalRate",
    "cartRate",
    "checkoutRate",
    "paymentRate",
  ];
  return (
    <div className="space-y-6" data-testid="performance-funnel-page">
      <MetricSection title="RESULTADO DO FUNIL" columns={4}>
        <Metrics
          metrics={pick(
            "spend",
            "requestedRoas",
            "paidRoas",
            "approvedConversion",
          )}
        />
      </MetricSection>
      <AcquisitionFunnel description="Visão geral do período, em todas as origens. Recorrentes contam apenas os clientes novos do período; as taxas comparam os totais de cada etapa." stages={[
        { label: "Investimento", value: measures.spend.value, currency: true, connector: acquisitionLeads && measures.spend.value != null ? `${formatCurrency(measures.spend.value / acquisitionLeads)} por lead` : "Sem custo por lead disponível" },
        { label: "Leads", value: acquisitionLeads, connector: acquisitionLeads && acquisitionApproved != null ? `${(acquisitionApproved / acquisitionLeads * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% aprovados` : "Sem taxa de aprovação disponível" },
        { label: "Leads aprovados", value: acquisitionApproved, connector: acquisitionApproved && insights.data?.baseEvolution ? `${(insights.data.baseEvolution[0].customers / acquisitionApproved * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}% novos / aprovados` : "Sem taxa de primeiro pedido disponível" },
        { label: "Clientes novos", value: insights.data?.baseEvolution?.[0]?.customers, connector: insights.data?.baseEvolution?.[1]?.continuationPct == null ? "Sem taxa de recompra disponível" : `${insights.data.baseEvolution[1].continuationPct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% voltaram a comprar` },
        { label: "Clientes recorrentes", value: insights.data?.baseEvolution?.[1]?.customers },
      ]} />
      <Card><CardHeader><CardTitle>Etapas operacionais</CardTitle></CardHeader><CardContent>
          <div className="up-funnel-stages">
            {stages.map((stage, index) => {
              const indicator = measures[indicators[index]];
              return <GlassMetricCard key={stage.label} label={stage.label}
                value={stage.value == null ? "—" : stage.currency ? formatCurrency(stage.value) : formatNumber(stage.value)}
                testId={`performance-stage-${index}`}
                footer={indicator ? <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">{displayLabel(indicator.label)}</span>
                  <span className="font-medium tabular-nums">{indicator.value == null ? "—" : indicator.format === "currency" ? formatCurrency(indicator.value) : `${indicator.value.toFixed(1)}%`}</span>
                </div> : undefined} />;
            })}
          </div>
        </CardContent>
      </Card>
      <OrganizationHeading>Funil e diagnósticos existentes</OrganizationHeading>
      <FunnelPage />
    </div>
  );
}
function RegistrationPage() {
  return <CustomersPage organization="registrations" />;
}
function AdsPage() {
  const { pick } = useOrganizationData();
  return (
    <div className="space-y-6" data-testid="ads-page">
      <MetricSection title="VISÃO GERAL" columns={4}>
        <Metrics
          metrics={pick(
            "metaSpend",
            "impressions",
            "reach",
            "frequency",
            "clicks",
            "ctr",
            "cpc",
            "cpm",
            "metaPurchases",
            "metaCpa",
            "metaRoas",
          )}
        />
      </MetricSection>
      <OrganizationHeading>
        DESEMPENHO · Campanhas, Ad Sets, Ads e Criativos
      </OrganizationHeading>
      <MarketingPage />
    </div>
  );
}
function AttributionPage() {
  return (
    <div className="space-y-6" data-testid="attribution-page">
      <OrganizationHeading>JORNADA · Eventos e Touchpoints</OrganizationHeading>
      <JourneyPage />
      <OrganizationHeading>
        UTMs · Campanhas · Ad Sets · Ads
      </OrganizationHeading>
      <UtmPage />
      <OrganizationHeading>
        CONVERSÃO · Carrinho · Checkout · Pedido · Compra · Recompra
      </OrganizationHeading>
      <FunnelPage />
    </div>
  );
}
function CustomerIntelligencePage() {
  return (
    <div className="space-y-6" data-testid="customer-intelligence-page">
      <OrganizationHeading>
        VISÃO DO CLIENTE · Clientes · Recorrência · Frequência · Ticket
      </OrganizationHeading>
      <CustomersPage />
      <OrganizationHeading>
        RETENÇÃO · LTV · Cohorts · Progressão de Compra
      </OrganizationHeading>
      <RfmPage />
      <RecompraPage />
      <OrganizationHeading>
        COMPORTAMENTO · Jornada · Produtos · Pedidos
      </OrganizationHeading>
      <JourneyPage />
    </div>
  );
}
export default function OrganizedPage({ page }: { page: ArchitecturePage }) {
  switch (page) {
    case "ecommerce":
      return <DashboardPage organization="ecommerce" />;
    case "orders":
      return <OrdersPage />;
    case "products":
      return <ProductsPage />;
    case "stock":
      return <StockPage />;
    case "sellers":
      return <SellersPage />;
    case "geography":
      return <GeographyPage />;
    case "erp-geography":
      return <ErpGeographyView />;
    case "performance-funnel":
      return <PerformanceFunnelPage />;
    case "acquisition":
      return <AcquisitionPage />;
    case "registrations":
      return <RegistrationPage />;
    case "ads":
      return <AdsPage />;
    case "attribution":
      return <AttributionPage />;
    case "customer-intelligence":
      return <CustomerIntelligencePage />;
    case "monthly-history":
      return <MonthlyHistoryPage />;
  }
}
