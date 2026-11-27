import { expect, it } from "vitest";
import { buildStoreDecline } from "../src/services/up-manager-store-decline";

type Input = Parameters<typeof buildStoreDecline>[0];
type Metrics = Input["overview"]["metrics"];
type Ga4 = NonNullable<Input["funnel"]["current"]>;

const metrics = (approvedRevenue: number, orders: number) =>
  ({ approvedRevenue, orders, averageOrder: approvedRevenue / orders }) as Metrics;
const ga4 = (sessions: number, purchases: number): Ga4 => ({
  sessions, purchases, productViews: sessions, addToCarts: 50, checkouts: 20,
  observedAt: "2026-11-26", source: "bigquery",
});
const orders = {
  created: 20, approved: 10, pending: 0, rejected: 0, refunds: 0, unverifiedRefunds: 0,
  discount: 0, shipping: 0, newRevenue: 600, returningRevenue: 400, reactivatedBuyers: 0,
};
const period = { dateFrom: "2026-11-25", dateTo: "2026-11-25" };
const reference = { dateFrom: "2026-11-18", dateTo: "2026-11-18" };
const input: Input = {
  overview: { period, previousPeriod: reference, metrics: metrics(600, 6), previous: metrics(1000, 10), campaigns: null, mediaAvailable: false },
  bridge: { orderVolume: -400, ticket: 0, traffic: -500, ordersPerSession: 100 },
  funnel: { current: ga4(100, 6), previous: ga4(200, 10), propertyId: "1", channels: null, channelComparison: null, products: null },
  orders: { current: { ...orders, approved: 6 }, previous: orders },
  period, reference, currency: "BRL", revenueContext: null, catalogChanges: null, couponChanges: null,
  shipping: null, basketUnits: { current: 6, previous: 10 },
};

it("prioriza o canal que perdeu tráfego quando a conversão total não puxou a queda", () => {
  const result = buildStoreDecline({
    ...input,
    funnel: { ...input.funnel, channelComparison: {
      previous: [{ name: "Paid Social", traffic: 100, purchases: 5, engaged: 60, carts: 10, checkouts: 6 }],
      current: [{ name: "Direct", traffic: 100, purchases: 6, engaged: 65, carts: 11, checkouts: 8 }],
    } },
  });
  expect(result?.evidence).toContain("Volume de sessões");
  expect(result?.action).toContain("Social Pago");
  expect(result?.followUp).toContain("custo por visita");
  expect(result?.diagnosis?.factors).toContainEqual(expect.objectContaining({
    label: "Social Pago · canal GA4", detail: expect.stringContaining("conversão de 5% → indisponível"),
  }));
});

it("prioriza o ticket com pedidos estáveis e marca uma amostra pequena", () => {
  const result = buildStoreDecline({
    ...input,
    overview: { ...input.overview, metrics: metrics(600, 2), previous: metrics(1000, 2) },
    bridge: { orderVolume: 0, ticket: -400, traffic: null, ordersPerSession: null },
  });
  expect(result?.priority).toBe("P2");
  expect(result?.evidence).toContain("Ticket médio");
  expect(result?.action).toContain("ticket maior");
  expect(result?.followUp).toContain("grupo de controle");
});
