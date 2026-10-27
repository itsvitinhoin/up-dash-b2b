// Cards da Visão geral (pedido do time, 26/10/2026).
//
// Cada bloco tem os cards PADRÃO (os que aparecem) e a lista de cards REMOVIDOS: os que saíram do padrão mas continuam prontos no código.
// Para trazer um card de volta (ou tirar outro), basta mover a chave entre `defaults` e `removed` AQUI e republicar; não há tela para o time
// trocar cards. Para renomear um bloco, troque o `title`.
//
// As chaves apontam para medidas de `lib/organization-data.ts` (ex.: "erpRevenue") ou para cards da própria página (revenue, orders, ticket,
// requested, buyers, retention, conversion) e dois cards especiais ("spendOld", "roasOld") montados em components/overview-organization.tsx.

export type OverviewSection = {
  id: "result" | "ads" | "newCustomers" | "repurchase";
  testId: string;
  title: string;
  /** Cards que aparecem, na ordem. */
  defaults: string[];
  /** Cards que saíram do padrão e continuam disponíveis (chave e o que eram). */
  removed: Array<{ key: string; label: string }>;
};

export const OVERVIEW_SECTIONS: OverviewSection[] = [
  {
    id: "result",
    testId: "executive-result",
    title: "RESULTADO GERAL",
    defaults: ["erpRevenue", "erpOrders", "ecomPaidRevenue", "ecomPaidOrders"],
    removed: [
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
    removed: [
      { key: "spendOld", label: "Investimento (com média por dia e custo por pedido)" },
      { key: "roasOld", label: "ROAS dos clientes atribuídos às campanhas" },
    ],
  },
  {
    id: "newCustomers",
    testId: "executive-new-customers",
    title: "NOVOS CLIENTES",
    defaults: ["newCustomersTotal", "newCustomersRevenue", "newCustomersOrders", "newCustomersFromAds"],
    removed: [{ key: "newCustomersTicket", label: "Ticket de novos clientes" }],
  },
  {
    id: "repurchase",
    testId: "executive-repurchase",
    title: "RECOMPRA",
    defaults: ["repurchaseCustomers", "repurchaseRevenue", "repurchaseSales"],
    removed: [
      { key: "retentionTicket", label: "Ticket de recompra" },
      { key: "requested", label: "Faturamento solicitado" },
      { key: "buyers", label: "Compradores no período" },
      { key: "retention", label: "Retenção de compradores" },
      { key: "conversion", label: "Taxa de conversão" },
    ],
  },
];
