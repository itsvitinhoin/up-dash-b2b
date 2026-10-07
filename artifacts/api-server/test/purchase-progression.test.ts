import { describe, expect, it } from "vitest";
import { buildPurchaseProgression } from "../src/services/purchase-progression";
const event = (day: string, grossValue = 100) => ({ requestedAt: new Date(`${day}T12:00:00-03:00`), grossValue });
describe("Evolução da Base e Velocidade de Conversão", () => {
  it("usa a primeira compra histórica e inclui todos os pedidos 4+ uma única vez na receita", () => {
    const result = buildPurchaseProgression(new Map([
      ["novo", [event("2026-09-10",100),event("2026-09-11",80),event("2026-09-12",60),event("2026-09-13",40),event("2026-09-14",20),event("2026-10-01",999)]],
      ["antigo", [event("2026-08-01"),event("2026-09-10")]],
      ["novo2", [event("2026-09-20",50)]],
    ]), new Map(), "2026-09-01", "2026-09-30");
    expect(result.baseEvolution.map(s=>s.customers)).toEqual([2,1,1,1]);
    expect(result.baseEvolution.map(s=>s.revenue)).toEqual([150,80,60,60]);
    expect(result.baseEvolution[3].accumulatedRevenue).toBe(350);
    expect(result.baseEvolution[1].continuationPct).toBe(50);
  });
  it("distribui faixas sem dupla contagem, exclui aprovações ausentes e datas invertidas", () => {
    const first = "2026-09-20";
    const history = new Map(Array.from({length:9}, (_,i)=>[String(i),[event(first)]]));
    const approvals = new Map<string, Date | null>([0,2,5,10,20,40,80].map((days,i)=>[String(i),new Date(event(first).requestedAt.getTime()-days*86400000)]));
    approvals.set("8", new Date("2026-09-21T12:00:00-03:00"));
    const { conversionVelocity: v } = buildPurchaseProgression(history, approvals, "2026-09-01", "2026-09-30");
    expect(v.buckets.map(b=>b.customers)).toEqual([1,1,1,1,1,1,1]);
    expect(v.sampleSize).toBe(7); expect(v.missingApproval).toBe(1); expect(v.invalidChronology).toBe(1);
    expect(v.firstWeekCount).toBe(3); expect(v.within30Count).toBe(5); expect(v.medianDays).toBe(10);
    expect(v.buckets.reduce((sum,b)=>sum+(b.pct??0),0)).toBeCloseTo(100);
  });
  it("retorna ausência explícita quando não há amostra e respeita o dia local brasileiro", () => {
    const { conversionVelocity: empty } = buildPurchaseProgression(new Map(),new Map(),"2026-09-01","2026-09-30");
    expect(empty.firstWeekPct).toBeNull(); expect(empty.averageDays).toBeNull();
    const h = new Map([["a", [{requestedAt:new Date("2026-10-01T02:59:00Z"),grossValue:10}]], ["b", [{requestedAt:new Date("2026-10-01T03:00:00Z"),grossValue:20}]]]);
    const r = buildPurchaseProgression(h,new Map([["a",new Date("2026-09-30T22:00:00-03:00")]]),"2026-09-30","2026-09-30");
    expect(r.baseEvolution[0].customers).toBe(1); expect(r.conversionVelocity.buckets[0].customers).toBe(1);
  });
});
