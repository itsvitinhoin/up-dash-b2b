import { useAuth } from "@/lib/auth";
import { Fragment, type ReactNode } from "react";
import { MetricSection, Metrics } from "@/components/metric-section";
import { OVERVIEW_SECTIONS } from "@/lib/overview-layout";
import { useI18n } from "@/lib/i18n";
import { useOrganizationData } from "@/lib/organization-data";
import { useDashboardFilters } from "@/lib/dashboard-filters";
import { formatCurrency } from "@/lib/formatters";
import { differenceInCalendarDays } from "date-fns";

// Cada seção pede só as fontes que usa (ver useOrganizationData): o resto nem é buscado.
const EXECUTIVE_SOURCES = [
  "dashboard",
  "marketing",
  "recompra",
  "performance",
] as const;
const EXECUTIVE_PREVIOUS = ["recompra", "performance"] as const;
const ECOMMERCE_SOURCES = ["customers", "orders"] as const;
const ECOMMERCE_PREVIOUS = ["orders"] as const;
const PERFORMANCE_SOURCES = [
  "recompra",
  "funnel",
  "performance",
  "customers",
] as const;
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
  const { selectedDashboardMode } = useAuth();
  const isB2C = selectedDashboardMode === "B2C";
  const { pick, measures } = useOrganizationData(
    ecommerce ? ECOMMERCE_SOURCES : EXECUTIVE_SOURCES,
    ecommerce ? ECOMMERCE_PREVIOUS : EXECUTIVE_PREVIOUS,
  );
  const { dateRange, filters } = useDashboardFilters();
  // Vendedora e Estado só chegam ao e-commerce/Vesti e à Recompra do site: ERP e anúncios mostram o total do cliente.
  const filterIgnoredNotice = !!(filters.sellerId || filters.state);
  const money = (value: number | null | undefined) =>
    value != null && Number.isFinite(value) ? formatCurrency(value) : "—";
  // Investimento: as duas linhas usam só números que já estão na tela (investimento, dias do período e pedidos pagos).
  const days = Math.max(
    1,
    differenceInCalendarDays(dateRange.to, dateRange.from) + 1,
  );
  const paidOrders = measures.orders?.value;
  const spendMetrics = pick("spend").map((metric) => ({
    ...metric,
    sub: [
      {
        label: tx("Média por dia"),
        value: money(metric.value != null ? metric.value / days : null),
      },
      {
        label: tx("Custo por pedido pago"),
        value: money(
          metric.value != null && paidOrders ? metric.value / paidOrders : null,
        ),
      },
    ],
  }));
  if (ecommerce)
    return (
      <div className="space-y-6">
        <MetricSection
          title={tx("RESULTADO DO ECOMMERCE")}
          columns={isB2C ? 6 : 8}
          id="ecommerce-summary"
        >
          {cards.requested}
          {cards.revenue}
          {cards.orders}
          {cards.ticket}
          <Metrics
            metrics={pick(
              ...(isB2C ? ["pieces"] : ["pieces", "registrations", "approved"]),
            )}
          />
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
        source: tx(
          "Clientes atribuídos às campanhas · atendido / investimento",
        ),
        previousValue: attributedRoas.previous,
        loading: attributedRoas.loading,
        sub: [
          {
            label: tx("Atendido atribuído"),
            value: money(attributedRoas.revenue),
          },
          { label: tx("Investimento"), value: money(attributedRoas.spend) },
        ],
      }
    : measures.roas;
  const renderCard = (key: string): ReactNode => {
    if (key === "spendOld") return <Metrics metrics={spendMetrics} />;
    if (key === "roasOld")
      return roasMetric ? <Metrics metrics={[roasMetric]} /> : null;
    if (key in cards) return cards[key];
    return measures[key] ? <Metrics metrics={[measures[key]]} /> : null;
  };
  return (
    <div className="space-y-6">
      {filterIgnoredNotice && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="overview-filter-notice"
        >
          {tx(
            "Com Vendedora ou Estado ativos, os cards de ERP e de anúncios mostram o total do cliente: esses dados não são divididos por vendedora ou estado.",
          )}
        </p>
      )}
      {OVERVIEW_SECTIONS.map((section) => {
        const keys = isB2C
          ? {
              result: [
                "ecomPaidRevenue",
                "ecomPaidOrders",
                "adsSpend",
                "merPaid",
              ],
              ads: ["adsRevenue", "adsRoas", "adsSpend"],
              newCustomers: [
                "newCustomersTotal",
                "newCustomersRevenue",
                "newCustomersOrders",
              ],
              repurchase: section.defaults,
            }[section.id]
          : section.defaults;
        return (
          <MetricSection
            key={section.id}
            title={tx(section.title)}
            columns={isB2C && keys.length === 3 ? 3 : 4}
            id={section.testId}
          >
            {keys.map((key) => (
              <Fragment key={key}>{renderCard(key)}</Fragment>
            ))}
          </MetricSection>
        );
      })}
    </div>
  );
}
export function PerformanceSummarySections({
  tipoFilter,
}: {
  /** Pedido do time, 19/11/2026: Aquisição/Retenção seguem o mesmo Tipo da página Performance.
   * Sem esse prop (ex: Visão Geral "/"), comportamento de sempre (sem mudança). */
  tipoFilter?: "todos" | "erp" | "ecommerce" | "anuncios";
} = {}) {
  const { tx } = useI18n();
  const { pick, recompra } = useOrganizationData(
    PERFORMANCE_SOURCES,
    PERFORMANCE_PREVIOUS,
    tipoFilter,
  );
  const blocks = recompra.data?.blocks;
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
      {/* Achado 19/11/2026 (Marcelo: "faturamento é muito maior que a retenção e
       * aquisição"): Faturamento soma TODO pedido do ERP/e-commerce; Aquisição+Retenção
       * só soma quem tem identidade confiável (nunca adivinha, ver recompra-analytics.ts).
       * Mesmos avisos que performance-recompra.tsx já mostra, só que aqui -- perto da
       * comparação que confunde -- e não só na página de detalhe. */}
      {blocks?.attributionUnavailable && (
        <p className="text-xs text-amber-500">
          {tx(
            "Este cliente não tem chave UpZero configurada — Tipo=Anúncios não pode ser calculado (sem touchpoint pago pra atribuir) e os blocos acima estão vazios.",
          )}
        </p>
      )}
      {blocks && (blocks.touchpointFailures ?? 0) > 0 && (
        <p className="text-xs text-amber-500">
          {tx(
            "Não foi possível verificar a atribuição de {n} cliente(s) agora; eles ficaram de fora de Anúncios nesta leitura. Recarregue em instantes para tentar de novo.",
          ).replace("{n}", String(blocks.touchpointFailures))}
        </p>
      )}
      {blocks && (blocks.unmatchedErpCount ?? 0) > 0 && (
        <p className="text-xs text-muted-foreground">
          {tx(
            "{n} pedido(s) do ERP no período não puderam ser conciliados com um cliente identificado (sem CNPJ/e-mail/telefone batendo) e ficaram de fora de Aquisição e Retenção.",
          ).replace("{n}", String(blocks.unmatchedErpCount))}
        </p>
      )}
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
  // Google Ads escondido por enquanto: não tem integração de custo ainda (só GA4, que é
  // tráfego, não investimento) -- volta quando essa integração existir de verdade.
  return <Metrics metrics={pick("totalSpend", "metaSpend")} />;
}
