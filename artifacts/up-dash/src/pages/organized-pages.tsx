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
import { LazySection } from "@/components/lazy-section";
import { useI18n } from "@/lib/i18n";
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

// Cada página pede só as fontes que usa (ver useOrganizationData).
const ACQUISITION_SOURCES = ["dashboard", "marketing", "performance", "customers", "funnel"] as const;
const ACQUISITION_PREVIOUS = ["performance", "funnel"] as const;
const FUNNEL_SOURCES = ["dashboard", "marketing", "customers", "funnel", "performance"] as const;
const FUNNEL_PREVIOUS = ["dashboard", "marketing", "funnel", "performance"] as const;
const ADS_SOURCES = ["marketing", "performance"] as const;

function AcquisitionPage() {
  const { tx } = useI18n();
  const { pick } = useOrganizationData(ACQUISITION_SOURCES, ACQUISITION_PREVIOUS);
  return (
    <div className="space-y-6" data-testid="acquisition-page">
      <MetricSection title={tx("AQUISIÇÃO")} columns={4}>
        <Metrics
          metrics={pick(
            "acquisitionRevenue",
            "acquisitionTicket",
            "acquisitionOrders",
            "newCustomers",
          )}
        />
      </MetricSection>
      <MetricSection title={tx("INVESTIMENTO E CUSTOS")} columns={4}>
        <Metrics
          metrics={pick("cac", "costRegistration", "costApproved", "spend")}
        />
      </MetricSection>
      <MetricSection title={tx("ATIVAÇÃO DOS APROVADOS")} columns={3}>
        <Metrics
          metrics={pick("approved", "approvedConverted", "approvedConversion")}
        />
      </MetricSection>
      <MetricSection title={tx("CADASTRO → PRIMEIRA COMPRA")} columns={2}>
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
              <CardTitle className="text-sm">{tx(title)}</CardTitle>
            </CardHeader>
            <CardContent>
              <EmptyState
                icon={BarChart3}
                title={tx("Análise indisponível")}
                description={tx("Os dados desta análise ainda não estão disponíveis nesta fonte.")}
              />
            </CardContent>
          </Card>
        ))}
      </div>
      <OrganizationHeading>
        {tx("COHORT DE ATIVAÇÃO E DIAGNÓSTICOS")}
      </OrganizationHeading>
      <LazySection>
        <FunnelPage organization="acquisition" />
      </LazySection>
    </div>
  );
}
function PerformanceFunnelPage() {
  const { tx, language } = useI18n();
  const { pick, measures, funnel, previousFunnel, dashboard, previousDashboard } = useOrganizationData(FUNNEL_SOURCES, FUNNEL_PREVIOUS);
  const insights = usePurchaseInsights();
  const numberLocale = language === "ko" ? "ko-KR" : language === "en" ? "en-US" : "pt-BR";
  const pct = (value: number, digits: number) => value.toLocaleString(numberLocale, { maximumFractionDigits: digits });
  const acquisitionLeads = measures.registrations.value;
  const acquisitionApproved = measures.approved.value;
  const steps = funnel.data?.steps ?? [];
  const count = (...keys: string[]) =>
    steps.find((step) => keys.includes(step.step))?.count;
  const previousCount = (...keys: string[]) => previousFunnel.data?.steps.find(step => keys.includes(step.step))?.count;
  const stages = [
    { label: tx("Impressões"), value: measures.impressions.value, previous: measures.impressions.previousValue },
    { label: tx("Alcance"), value: measures.reach.value, previous: measures.reach.previousValue },
    { label: tx("Cliques no Link"), value: null, previous: undefined },
    {
      label: tx("Visitas / Sessões"),
      value: dashboard.data?.traffic?.sessions ?? count("VISIT", "SESSIONS"),
      previous: dashboard.data?.traffic?.sessions != null ? previousDashboard.data?.traffic?.sessions : previousCount("VISIT", "SESSIONS"),
    },
    { label: tx("Cadastros"), previous: previousCount("REGISTRATION"), value: count("REGISTRATION") },
    {
      label: tx("Cadastros Aprovados"),
      previous: previousCount("APPROVED_REGISTRATION", "APPROVAL"), value: count("APPROVED_REGISTRATION", "APPROVAL"),
    },
    { label: tx("Adições ao Carrinho"), previous: previousCount("ADD_TO_CART"), value: count("ADD_TO_CART") },
    {
      label: tx("Checkout"),
      previous: previousCount("CHECKOUT_STARTED", "CHECKOUT", "ORDER_SUBMITTED"), value: count("CHECKOUT_STARTED", "CHECKOUT", "ORDER_SUBMITTED"),
    },
    {
      label: tx("Faturamento Solicitado"),
      value: measures.requestedRevenue.value, previous: measures.requestedRevenue.previousValue,
      currency: true,
    },
    {
      label: tx("Faturamento Pago"),
      value: measures.paidRevenue.value, previous: measures.paidRevenue.previousValue,
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
      <MetricSection title={tx("RESULTADO DO FUNIL")} columns={4}>
        <Metrics
          metrics={pick(
            "spend",
            "requestedRoas",
            "paidRoas",
            "approvedConversion",
          )}
        />
      </MetricSection>
      <AcquisitionFunnel description={tx("Visão geral do período, em todas as origens. Recorrentes contam apenas os clientes novos do período; as taxas comparam os totais de cada etapa.")} stages={[
        { label: tx("Investimento"), value: measures.spend.value, currency: true, connector: acquisitionLeads && measures.spend.value != null ? tx("{v} por lead").replace("{v}", formatCurrency(measures.spend.value / acquisitionLeads)) : tx("Sem custo por lead disponível") },
        { label: tx("Leads"), value: acquisitionLeads, connector: acquisitionLeads && acquisitionApproved != null ? tx("{v}% aprovados").replace("{v}", pct(acquisitionApproved / acquisitionLeads * 100, 1)) : tx("Sem taxa de aprovação disponível") },
        { label: tx("Leads aprovados"), value: acquisitionApproved, connector: acquisitionApproved && insights.data?.baseEvolution ? tx("{v}% novos / aprovados").replace("{v}", pct(insights.data.baseEvolution[0].customers / acquisitionApproved * 100, 2)) : tx("Sem taxa de primeiro pedido disponível") },
        { label: tx("Clientes novos"), value: insights.data?.baseEvolution?.[0]?.customers, connector: insights.data?.baseEvolution?.[1]?.continuationPct == null ? tx("Sem taxa de recompra disponível") : tx("{v}% voltaram a comprar").replace("{v}", pct(insights.data.baseEvolution[1].continuationPct, 1)) },
        { label: tx("Clientes recorrentes"), value: insights.data?.baseEvolution?.[1]?.customers },
      ]} />
      <Card><CardHeader><CardTitle>{tx("Etapas operacionais")}</CardTitle></CardHeader><CardContent>
          <div className="up-funnel-stages">
            {stages.map((stage, index) => {
              const indicator = measures[indicators[index]];
              return <GlassMetricCard key={stage.label} label={stage.label}
                value={stage.value == null ? "—" : stage.currency ? formatCurrency(stage.value) : formatNumber(stage.value)}
                comparisonValue={stage.value ?? null}
                previousValue={stage.previous}
                format={stage.currency ? formatCurrency : formatNumber} source={index < 3 ? "Meta Ads" : tx("Ecommerce · funil")}
                testId={`performance-stage-${index}`}
                footer={indicator ? <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">{indicator.label}</span>
                  <span className="font-medium tabular-nums">{indicator.value == null ? "—" : indicator.format === "currency" ? formatCurrency(indicator.value) : `${indicator.value.toFixed(1)}%`}</span>
                </div> : undefined} />;
            })}
          </div>
        </CardContent>
      </Card>
      <OrganizationHeading>{tx("Funil e diagnósticos existentes")}</OrganizationHeading>
      <LazySection>
        <FunnelPage />
      </LazySection>
    </div>
  );
}
function RegistrationPage() {
  return <CustomersPage organization="registrations" />;
}
function AdsPage() {
  const { tx } = useI18n();
  const { pick } = useOrganizationData(ADS_SOURCES);
  return (
    <div className="space-y-6" data-testid="ads-page">
      <MetricSection title={tx("VISÃO GERAL")} columns={4}>
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
        {tx("DESEMPENHO · Campanhas, Ad Sets, Ads e Criativos")}
      </OrganizationHeading>
      <LazySection eager>
        <MarketingPage />
      </LazySection>
    </div>
  );
}
function AttributionPage() {
  const { tx } = useI18n();
  return (
    <div className="space-y-6" data-testid="attribution-page">
      <OrganizationHeading>{tx("JORNADA · Eventos e Touchpoints")}</OrganizationHeading>
      <JourneyPage />
      <OrganizationHeading>
        {tx("UTMs · Campanhas · Ad Sets · Ads")}
      </OrganizationHeading>
      <LazySection>
        <UtmPage />
      </LazySection>
      <OrganizationHeading>
        {tx("CONVERSÃO · Carrinho · Checkout · Pedido · Compra · Recompra")}
      </OrganizationHeading>
      <LazySection>
        <FunnelPage />
      </LazySection>
    </div>
  );
}
function CustomerIntelligencePage() {
  const { tx } = useI18n();
  return (
    <div className="space-y-6" data-testid="customer-intelligence-page">
      <OrganizationHeading>
        {tx("VISÃO DO CLIENTE · Clientes · Recorrência · Frequência · Ticket")}
      </OrganizationHeading>
      <CustomersPage />
      <OrganizationHeading>
        {tx("RETENÇÃO · LTV · Cohorts · Progressão de Compra")}
      </OrganizationHeading>
      <LazySection>
        <RfmPage />
      </LazySection>
      <LazySection>
        <RecompraPage />
      </LazySection>
      <OrganizationHeading>
        {tx("COMPORTAMENTO · Jornada · Produtos · Pedidos")}
      </OrganizationHeading>
      <LazySection>
        <JourneyPage />
      </LazySection>
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
