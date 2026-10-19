import { describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({complete: true}));
vi.mock("@workspace/db", () => ({ clientsTable:{},eventsTable:{},db:{execute:async()=>({rows:[{registrations:1,purchases:1}]}),select:()=>({from:()=>({where:async()=>[{commercePlatform:"UPZERO",upZeroApiKey:"test"}]})})} }));
vi.mock("drizzle-orm",()=>({eq:()=>0,sql:()=>0}));
vi.mock("../src/lib/bigquery",()=>({vestiTable:()=>"mx.table",bigquery:{query:async({query}:{query:string})=>[query.includes("historical_orders")?[{date:"2026-10-03",customer_id:"111",document:"111",orders:2,net_revenue:900,is_identified:true,historical_orders:2}]:[]]}}));
vi.mock("../src/services/meta-ads",()=>({fetchMetaMarketingData:vi.fn()}));
vi.mock("../src/services/erpAnalytics",()=>({
 fetchErpDashboard:async()=>({kpis:{netRevenue:900,orders:2,grossRevenue:900,returnAmount:0},dailyRevenue:[{date:"2026-10-03",value:900}],dailyOrders:[{date:"2026-10-03",value:2}]}),
 matchErpDocumentsWithUpzero:async()=>new Map([["111",{attribution:{utmSource:"meta",utmMedium:"cpc",utmCampaign:"stamp antigo",evidenceAt:new Date("2026-10-20")}}]]),
 matchErpDocumentsWithVestiAttribution:vi.fn(),fetchVestiFunnelEventCounts:vi.fn(),
}));
vi.mock("../src/services/erp-attribution",()=>({getErpPaidAttribution:async()=>({
 revenueBasis:"erp_net",complete:state.complete,pendingOrders:state.complete?0:1,fetchErrors:state.complete?[]:[{message:"timeout"}],
 influencedTotal:123.45,customerCohorts:[{cohort:"novo"}],
 allOrders:[{upzeroCustomerId:"c1"},{upzeroCustomerId:"c2"}],
 influencedOrders:[{orderId:"order1",upzeroCustomerId:"c1",dataCriado:"2026-10-03T00:00:00Z",valor:123.45,touchpointSource:"meta",touchpointMedium:"cpc",touchpointCampaign:"Campanha verificada"}],
})}));
import { fetchPerformanceDashboard } from "../src/services/performanceAnalytics";
describe("conciliação e tabela usam a mesma decisão",()=>{
 it("ignora o carimbo de cliente e usa receita, campanha, contagem e coorte por pedido",async()=>{
  state.complete=true;
  const result=await fetchPerformanceDashboard("mx","mx","2026-10-01","2026-10-19");
  expect(result.kpis.attributedRevenue).toBe(result.paidAttribution?.influencedTotal);
  expect(result.kpis.attributedRevenue).toBe(123.45);
  expect(result.kpis.attributedOrders).toBe(1);
  expect(result.daily[0]?.attributedRevenue).toBe(123.45);
  expect(result.campaigns[0]?.name).toBe("Campanha verificada");
  expect(result.kpis.newAttributedBuyers).toBe(1);
 });
 it("sinaliza o total parcial e separa pedidos pendentes de pedidos sem evidência",async()=>{
  state.complete=false;
  const result=await fetchPerformanceDashboard("mx","mx","2026-10-01","2026-10-19");
  expect(result.sources.ecommerce.status).toBe("unavailable");
  expect(result.reconciliation.find((r)=>r.label==="Verificação pendente")?.value).toBe(1);
  expect(result.reconciliation.find((r)=>r.label==="Sem evidência paga")?.value).toBe(0);
 });
});
