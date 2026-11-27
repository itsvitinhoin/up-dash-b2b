import type { B2cFinding } from "./up-manager-b2c";
import type {
  readFunnel,
  readOrderContext,
  readRetentionSegments,
} from "./up-manager-b2c-data";
import type { decideManagerCampaigns } from "./up-manager-campaign-decisions";
import type { readManagerOverview } from "./up-manager";
import type { buildAbc } from "./up-manager-b2c-products";

type Funnel = Awaited<ReturnType<typeof readFunnel>>;
type Orders = Awaited<ReturnType<typeof readOrderContext>>;
type Overview = Awaited<ReturnType<typeof readManagerOverview>>;
type CampaignPlan = ReturnType<typeof decideManagerCampaigns>;

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const formatter = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  maximumFractionDigits: 1,
});

export function evaluateManagerFunnel(
  funnel: Pick<Funnel, "current" | "previous"> & Partial<Funnel>,
  current: Orders,
  previous: Orders,
  confirmed: boolean,
) {
  const payment = confirmed
    ? {
        current: {
          created: current.created,
          approved: current.approved,
          pending: current.pending,
        },
        previous: {
          created: previous.created,
          approved: previous.approved,
          pending: previous.pending,
        },
      }
    : null;
  const rates = [];
  if (funnel.current && funnel.previous) {
    const stages = [
      {
        stage: "Produto → carrinho",
        entry: "productViews",
        exit: "addToCarts",
        action:
          "Testar a página do produto com disponibilidade de tamanhos e preço de entrega visíveis antes do botão de compra.",
      },
      {
        stage: "Carrinho → checkout",
        entry: "addToCarts",
        exit: "checkouts",
        action:
          "Testar a entrada do checkout com frete e subtotal visíveis já no carrinho.",
      },
      {
        stage: "Checkout → compra",
        entry: "checkouts",
        exit: "purchases",
        action:
          "Rodar um teste controlado de checkout com Pix e cartão e corrigir o ponto de falha encontrado no teste.",
      },
    ] as const;
    for (const item of stages) {
      const currentBase = funnel.current[item.entry];
      const previousBase = funnel.previous[item.entry];
      const rate = ratio(funnel.current[item.exit], currentBase);
      const priorRate = ratio(funnel.previous[item.exit], previousBase);
      if (
        rate !== null &&
        priorRate !== null &&
        currentBase >= 30 &&
        previousBase >= 30 &&
        rate <= 1 &&
        priorRate <= 1
      )
        rates.push({
          stage: item.stage,
          rate,
          priorRate,
          currentBase,
          previousBase,
          delta: rate - priorRate,
          action: item.action,
        });
    }
  }
  const weakest = [...rates].sort((a, b) => a.delta - b.delta)[0];
  const finding: B2cFinding | null =
    weakest && weakest.delta <= -0.05 && confirmed
      ? {
          id: "funnel-bottleneck",
          focus: "funnel",
          title: `Priorizar etapa · ${weakest.stage}`,
          priority: "P1",
          section: "analysis",
          evidence: `A taxa de eventos caiu de ${formatter.format(weakest.priorRate)} para ${formatter.format(weakest.rate)}. As bases têm ${weakest.previousBase} e ${weakest.currentBase} eventos de entrada.`,
          hypothesis:
            "Foi a maior queda de taxa entre as etapas com volume comparável no GA4.",
          action: weakest.action,
          owner: "E-commerce",
          followUp:
            "Medir a taxa da etapa em 7 dias, junto de pedidos aprovados e receita.",
        }
      : confirmed && current.pending > 0 && current.created > 0
        ? {
            id: "pending-orders",
            focus: "funnel",
            title: `Recuperar ${current.pending} pedidos em aberto`,
            priority: "P1",
            section: "analysis",
            evidence: `Na loja, ${current.approved} de ${current.created} pedidos gerados foram aprovados e ${current.pending} estão pendentes.`,
            hypothesis:
              "Os pedidos pendentes já foram registrados na loja e podem ser tratados pelo fluxo de pagamento.",
            action: `Acionar o fluxo existente de recuperação para os ${current.pending} pedidos com pagamento pendente e contato elegível.`,
            owner: "Operação e CRM",
            followUp:
              "Medir em 48 h pedidos e receita recuperados. GA4 é necessário para avaliar as etapas anteriores do funil.",
          }
        : null;
  return {
    payment,
    rates,
    weakest: weakest ? { stage: weakest.stage, delta: weakest.delta } : null,
    finding,
  };
}

export function buildGrowthDecisions({
  trend,
  campaigns,
  segments,
  cohorts,
  abc,
  currency,
  confirmed,
  dormantDays,
}: {
  trend: Overview;
  campaigns: CampaignPlan;
  segments: Awaited<ReturnType<typeof readRetentionSegments>>;
  cohorts: {
    month: string;
    horizon: number;
    buyers: number;
    repeatRate: number | null;
  }[];
  abc: ReturnType<typeof buildAbc>;
  currency: string;
  confirmed: boolean;
  dormantDays: number;
}) {
  if (!confirmed) return [];
  const money = new Intl.NumberFormat("pt-BR", { currency, style: "currency" });
  const { metrics, previous } = trend;
  const findings: B2cFinding[] = [];
  const scalables = campaigns.decisions.filter(
    (item) => item.decision === "scale",
  );
  const lowEfficiency = campaigns.decisions.filter(
    (item) => item.decision === "reduce" || item.decision === "pause",
  );
  const testProduct = abc.products.find(
    (item) =>
      item.abc === "A" &&
      item.grade === "complete" &&
      (item.coverageDays ?? 0) >= 7,
  );
  if (
    metrics.cac !== null &&
    previous.cac !== null &&
    metrics.newBuyers >= 5 &&
    previous.newBuyers >= 5 &&
    metrics.spend !== null &&
    previous.spend !== null
  ) {
    const evidence = `CAC blended de ${money.format(previous.cac)} para ${money.format(metrics.cac)}. Meta ${money.format(previous.spend)} → ${money.format(metrics.spend)}. Novos compradores ${previous.newBuyers} → ${metrics.newBuyers}.`;
    const shift = scalables[0] && lowEfficiency[0];
    const action = shift
      ? `Destinar parte da verba liberada de ${lowEfficiency[0].name} a um teste controlado de aquisição em ${scalables[0].name}, dentro do limite de escala recomendado.`
      : testProduct
        ? `Testar um criativo de primeira compra com ${testProduct.name}, que tem grade completa e cobertura de estoque, mantendo a verba total.`
        : "Manter o orçamento total e reservar a próxima rodada para um teste de aquisição separado da retenção.";
    findings.push({
      id: "cac-acquisition",
      focus: "acquisition",
      title:
        metrics.cac > previous.cac
          ? "Reduzir CAC de primeira compra"
          : "Preservar CAC no teste de aquisição",
      priority: "P2",
      section: "analysis",
      evidence,
      hypothesis:
        metrics.newBuyers < previous.newBuyers &&
        metrics.spend >= previous.spend
          ? "Na janela comparada, o gasto aumentou ou se manteve enquanto a aquisição caiu."
          : "A decisão usa CAC blended. A origem da primeira compra por campanha não tem cobertura verificada.",
      action,
      owner: "Gestão de mídia",
      followUp: `Medir em uma janela completa de 7 dias. Usar ${money.format(metrics.cac)} como referência e preservar o volume de compradores novos.`,
    });
  }
  const firstCohorts = cohorts
    .filter(
      (row) =>
        row.horizon === 30 && row.buyers >= 20 && row.repeatRate !== null,
    )
    .slice(0, 2);
  const cohortEvidence =
    firstCohorts.length === 2
      ? ` Recompra D30 de ${formatter.format(firstCohorts[1].repeatRate!)} para ${formatter.format(firstCohorts[0].repeatRate!)} nas duas coortes maduras mais recentes.`
      : "";
  if (segments.firstOnly >= 10)
    findings.push({
      id: "retention-second-purchase",
      focus: "retention",
      title: "Gerar a segunda compra",
      priority: "P2",
      section: "analysis",
      owner: "CRM",
      evidence: `${segments.firstOnly} clientes com uma única compra aprovada há 14 a 29 dias.${cohortEvidence}`,
      hypothesis:
        "Este segmento ainda está na primeira janela de recompra observável.",
      action: `Ativar uma jornada de segunda compra para esse segmento com contatos elegíveis e grupo de controle.${testProduct ? ` Usar ${testProduct.name} como opção disponível no teste, conforme a compra anterior.` : ""}`,
      followUp:
        "Medir recompra e receita incremental contra o controle nos 14 dias após o início.",
    });
  if (segments.dormant >= 10)
    findings.push({
      id: "retention-reactivation",
      focus: "retention",
      title: "Reativar compradores recorrentes",
      priority: "P2",
      section: "analysis",
      owner: "CRM",
      evidence: `${segments.dormant} clientes com pelo menos duas compras e última compra entre ${dormantDays} e ${dormantDays + 29} dias.`,
      hypothesis:
        "O segmento já teve recompra e atingiu a janela definida de inatividade.",
      action:
        "Ativar uma régua de reativação para o segmento elegível em duas etapas, começando por novidades disponíveis e mantendo um grupo de controle.",
      followUp:
        "Medir compradores reativados, receita incremental e margem da oferta em 14 dias.",
    });
  return findings;
}

export function explainProductRevenue(
  now: ReadonlyArray<{
    id: string;
    name: string;
    revenue: number;
    units: number;
  }>,
  previous: ReadonlyArray<{
    id: string;
    name: string;
    revenue: number;
    units: number;
  }>,
) {
  const current = new Map(now.map((row) => [row.id, row]));
  const prior = new Map(previous.map((row) => [row.id, row]));
  const changes = [...new Set([...current.keys(), ...prior.keys()])].map(
    (id) => {
      const a = current.get(id),
        b = prior.get(id);
      return {
        id,
        name: (a ?? b)!.name,
        previousRevenue: b?.revenue ?? 0,
        revenue: a?.revenue ?? 0,
        deltaRevenue: (a?.revenue ?? 0) - (b?.revenue ?? 0),
        priorUnits: b?.units ?? 0,
        units: a?.units ?? 0,
      };
    },
  );
  return {
    declining: changes
      .filter((row) => row.deltaRevenue < 0)
      .sort((a, b) => a.deltaRevenue - b.deltaRevenue)
      .slice(0, 5),
    improving: changes
      .filter((row) => row.deltaRevenue > 0)
      .sort((a, b) => b.deltaRevenue - a.deltaRevenue)
      .slice(0, 5),
  };
}
