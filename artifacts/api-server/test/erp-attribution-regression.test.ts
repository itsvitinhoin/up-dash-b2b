import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], touches: [] as Array<{ occurredAt: Date; source: string }>, fail: false, snapshots: [] as unknown[][], selects: 0 }));
vi.mock("@workspace/db", () => ({
  customersTable: {}, ordersTable: {}, orderAttributionsTable: {},
  db: {
    select: () => { state.selects++; throw new Error("Site não deve entrar na base ERP"); },
    insert: () => ({ values: (values: unknown[]) => { state.snapshots.push(values); return { onConflictDoUpdate: async () => undefined }; } }),
  },
}));
vi.mock("drizzle-orm", () => ({ and: () => 0, eq: () => 0, gt: () => 0, gte: () => 0, inArray: () => 0, lt: () => 0, ne: () => 0, sql: () => 0 }));
vi.mock("../src/lib/bigquery", () => ({ vestiTable: (d: string,t: string) => `${d}.${t}`, bigquery: { query: async ({ query }: {query: string}) => [query.includes("WITH orders") ? state.rows : []] } }));
vi.mock("../src/services/erpAnalytics", () => ({ ERP_CANCELLED_STATUSES: ["CANCELADO", "EXCLUIDO"] }));
vi.mock("../src/services/erp-identity", () => ({ resolveErpCustomerIdentities: async () => ({ cnpjToHash: new Map([["111", "hash"]]), hashToCustomer: new Map([["hash", {id:"customer-1",externalId:"123",name:"Comprador",createdAt:new Date("2026-01-01")} ]]) }) }));
vi.mock("../src/services/paid-touchpoints", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/paid-touchpoints")>();
  return { ...actual, getTouchpointsForCustomerCached: async () => { if (state.fail) throw new Error("UpZero indisponível"); return state.touches; } };
});
import { computeErpPaidAttribution } from "../src/services/erp-attribution";
const params = { clientId: "mx", dataset: "erp_mx", upZeroApiKey: "test", dateFrom: "2026-10-01", dateTo: "2026-10-19" };
beforeEach(() => {
  state.rows = [1,2].map((n) => ({ pedido_id: String(n), customer_id:"111", valor:100, data_criado:"2026-10-03T00:00:00Z", customer_name:"Comprador" }));
  state.touches = [{occurredAt:new Date("2026-10-02T00:00:00Z"),source:"meta"}];
  state.fail=false;state.snapshots=[];state.selects=0;
});
describe("atribuição financeira por pedido", () => {
  it("concilia ajustes negativos e mantém pedidos zerados sem lhes atribuir receita", async () => {
    state.rows = [100,-10,0].map((valor,n)=>({pedido_id:String(n),customer_id:"111",valor,data_criado:"2026-10-03T00:00:00Z"}));
    const result=await computeErpPaidAttribution(params);
    expect(result.allOrders).toHaveLength(3);
    expect(result.influencedTotal).toBe(90);
    expect(result.influencedOrders).toHaveLength(2);
  });
  it("usa apenas o ERP e preserva duas vendas legítimas de mesmo valor no mesmo dia", async () => {
    const result=await computeErpPaidAttribution(params);
    expect(result.revenueBasis).toBe("erp_net");
    expect(result.influencedTotal).toBe(200);
    expect(result.influencedOrders).toHaveLength(2);
    expect(result.customerCohorts[0]?.cohort).toBe("novo");
    expect(state.selects).toBe(0);
  });
  it("não atribui compras anteriores à evidência paga", async () => {
    state.touches=[{occurredAt:new Date("2026-10-04T00:00:00Z"),source:"meta"}];
    const result=await computeErpPaidAttribution(params);
    expect(result.influencedTotal).toBe(0);
    expect(result.complete).toBe(true);
  });
  it("falha de consulta é pendência e não sobrescreve a decisão anterior como sem origem", async () => {
    state.fail=true;
    const result=await computeErpPaidAttribution(params);
    expect(result.complete).toBe(false);
    expect(result.pendingOrders).toBe(2);
    expect(result.allOrders.every((row)=>row.verificationStatus==="pending")).toBe(true);
    expect(state.snapshots).toHaveLength(0);
  });
});
