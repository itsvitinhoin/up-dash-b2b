// Cards da Visão geral (pedido do time, 26/10/2026). Cada bloco tem os cards PADRÃO e uma lista de cards DISPONÍVEIS: os que saíram do
// padrão, mas continuam prontos. Para mudar o padrão, edite só este arquivo (mova uma chave entre `defaults` e `extras`, ou renomeie o título).
// Cada pessoa também pode trazer de volta um card removido pelo botão "Cards" do bloco; a escolha fica só neste navegador.
//
// As chaves apontam para medidas de `lib/organization-data.ts` (ex.: "erpRevenue") ou para cards da própria página (revenue, orders, ticket,
// requested, buyers, retention, conversion) e dois cards especiais ("spendOld", "roasOld") montados em components/overview-organization.tsx.

export type OverviewSection = {
  id: "result" | "ads" | "newCustomers" | "repurchase";
  testId: string;
  title: string;
  defaults: string[];
  extras: Array<{ key: string; label: string }>;
};

export const OVERVIEW_SECTIONS: OverviewSection[] = [
  {
    id: "result",
    testId: "executive-result",
    title: "RESULTADO GERAL",
    defaults: ["erpRevenue", "erpOrders", "ecomPaidRevenue", "ecomPaidOrders"],
    extras: [
      { key: "revenue", label: "Faturamento total" },
      { key: "orders", label: "Pedidos" },
      { key: "ticket", label: "Ticket médio" },
    ],
  },
  {
    id: "ads",
    testId: "executive-ads",
    title: "ANÚNCIOS",
    defaults: ["adsRevenue", "adsRoas", "adsSpend", "adsShare"],
    extras: [
      { key: "spendOld", label: "Investimento (com média por dia e custo por pedido)" },
      { key: "roasOld", label: "ROAS dos clientes atribuídos às campanhas" },
    ],
  },
  {
    id: "newCustomers",
    testId: "executive-new-customers",
    title: "NOVOS CLIENTES",
    defaults: ["newCustomersTotal", "newCustomersRevenue", "newCustomersOrders", "newCustomersFromAds"],
    extras: [{ key: "newCustomersTicket", label: "Ticket de novos clientes" }],
  },
  {
    id: "repurchase",
    testId: "executive-repurchase",
    title: "RECOMPRA",
    defaults: ["repurchaseCustomers", "repurchaseRevenue", "repurchaseSales"],
    extras: [
      { key: "retentionTicket", label: "Ticket de recompra" },
      { key: "requested", label: "Faturamento solicitado" },
      { key: "buyers", label: "Compradores no período" },
      { key: "retention", label: "Retenção de compradores" },
      { key: "conversion", label: "Taxa de conversão" },
    ],
  },
];

export const OVERVIEW_STORAGE_KEY = "updash.overviewExtraCards.v1";
export type ExtraCardChoice = Record<string, string[]>;

/** Só aceita chaves que existem na lista de disponíveis do bloco (escolha antiga de um card que deixou de existir é ignorada). */
export function sanitizeChoice(raw: unknown, sections: OverviewSection[] = OVERVIEW_SECTIONS): ExtraCardChoice {
  const out: ExtraCardChoice = {};
  if (!raw || typeof raw !== "object") return out;
  for (const section of sections) {
    const value = (raw as Record<string, unknown>)[section.id];
    if (!Array.isArray(value)) continue;
    const allowed = new Set(section.extras.map((extra) => extra.key));
    const kept = value.filter((key): key is string => typeof key === "string" && allowed.has(key));
    if (kept.length > 0) out[section.id] = [...new Set(kept)];
  }
  return out;
}

/** Chaves visíveis do bloco: os padrões e depois os extras escolhidos, na ordem da lista de disponíveis. */
export function visibleKeys(section: OverviewSection, choice: ExtraCardChoice): string[] {
  const picked = new Set(choice[section.id] ?? []);
  return [...section.defaults, ...section.extras.map((extra) => extra.key).filter((key) => picked.has(key))];
}
