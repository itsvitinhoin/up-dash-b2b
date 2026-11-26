import { describe, expect, it } from "vitest";
import { addDaysToDateOnly } from "../src/lib/reporting-period";
import { funnelFingerprint, hasClosedOrders, managerActionReadiness, reopenedSources } from "../src/services/up-manager-source-readiness";
import { firstMediaBreak, type EntityDay } from "../src/services/up-manager-timeline";
import { brainMediaSeries, conciseBrainAnswer } from "../src/services/up-manager-brain-chat";
import { combinePaidMediaChanges } from "../src/services/up-manager-media-learning";

describe("prontidão do piloto", () => {
  it("aguarda o fechamento depois da meia-noite da loja e marca fontes provisórias", () => {
    expect(hasClosedOrders({status:"done", observedAt:"2026-11-25T02:59:59Z"}, "2026-11-24")).toBe(false);
    expect(hasClosedOrders({status:"done", observedAt:"2026-11-25T03:00:00Z"}, "2026-11-24")).toBe(true);
    expect(managerActionReadiness({scope:{commerceConfirmed:false},coverage:{mediaAvailable:true}})).toMatch(/fechamento/);
    expect(managerActionReadiness({scope:{commerceConfirmed:true},coverage:{mediaAvailable:true,monitorFresh:false}})).toMatch(/Meta/);
  });
  it("reabre a leitura quando o GA4 muda ou uma sincronização válida chega", () => {
    const metrics = { sessions: 18002, productViews: 34880, addToCarts: 997, checkouts: 296, purchases: 137 };
    const before = { commerceAt: "2026-11-25T12:00:00Z", ga4: [funnelFingerprint(metrics), null] };
    expect(reopenedSources(before, before)).toBe(false);
    expect(reopenedSources(before, { ...before, ga4: [null, null] })).toBe(false);
    expect(reopenedSources(before, { ...before, ga4: [funnelFingerprint({...metrics,checkouts:167}), null] })).toBe(true);
    expect(reopenedSources(before, { ...before, commerceAt:"2026-11-25T12:01:00Z" })).toBe(true);
  });
  it("encontra um recuo por ID com janelas fechadas sem sobreposição", () => {
    const days: EntityDay[] = Array.from({length:10}, (_, n) => ({
      date:addDaysToDateOnly("2026-11-10",n), level:"ad", id:"123456",name:"AD Helena Marinho",
      spend:100,purchases:n<7?2:1,revenue:n<7?400:200,roas:n<7?4:2,clicks:100,impressions:1500,
    }));
    expect(firstMediaBreak(days)?.firstWeakPeriod).toBe("2026-11-17");
    expect(firstMediaBreak(days.filter((_,i)=>i!==2))).toBeNull();
    expect(firstMediaBreak(days.map((day,i) => i===8 ? {...day,id:"222"} : day))).toBeNull();
    const data = {id:"run",dateTo:"2026-11-24",perEntity:days};
    expect(brainMediaSeries([data],"Quando caiu o anúncio Helena Marinho?","2026-11-20")[0]?.firstBreak).toBeNull();
    expect(brainMediaSeries([data],"Quando caiu o anúncio Helena Marinho?","2026-11-25")[0]?.entity.id).toBe("123456");
    const named = { ...data, perEntity: [...days, { ...days[0], id: "789012" }] };
    expect(brainMediaSeries([named], "Compare o anúncio Helena Marinho 123456", "2026-11-25")
      .map(({ entity }) => entity.id)).toEqual(["123456"]);
  });
  it("deduplica o evento da Meta quando a mesma ação já foi confirmada no Updash", () => {
    const base={id:"123",level:"ad" as const,day:"2026-11-24",changedAt:"2026-11-24T18:00:00Z",name:"AD Helena"};
    const result=combinePaidMediaChanges({events:[{...base,title:"Alteração de veiculação"}],partial:false},[],"2026-11-25",[
      {...base,source:"updash",family:"status",title:"Pausa confirmada",changedAt:"2026-11-24T18:02:00Z"},
    ]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].source).toBe("updash");
  });
  it("limita a resposta principal a três linhas e 480 caracteres", () => {
    expect(conciseBrainAnswer("Prioridade.\nComo fazer.\nEvidência.\nExplicação longa.")).toBe("Prioridade.\nComo fazer.\nEvidência.");
    expect(conciseBrainAnswer("números relevantes ".repeat(100)).length).toBeLessThanOrEqual(480);
  });
});
