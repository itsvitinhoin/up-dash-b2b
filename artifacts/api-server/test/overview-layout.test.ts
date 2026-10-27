import { describe, expect, it } from "vitest";
import { OVERVIEW_SECTIONS, sanitizeChoice, visibleKeys } from "../../up-dash/src/lib/overview-layout";

// Cards da Visão geral: os padrões vêm do pedido do time (26/10/2026) e qualquer card que saiu do padrão pode voltar pelo botão "Cards".

const section = (id: string) => OVERVIEW_SECTIONS.find((s) => s.id === id)!;

describe("padrão de cada bloco (pedido do time)", () => {
  it("os quatro blocos, na ordem, com os cards pedidos", () => {
    expect(OVERVIEW_SECTIONS.map((s) => s.title)).toEqual(["RESULTADO GERAL", "ANÚNCIOS", "NOVOS CLIENTES", "RECOMPRA"]);
    expect(section("result").defaults).toEqual(["erpRevenue", "erpOrders", "ecomPaidRevenue", "ecomPaidOrders"]);
    expect(section("ads").defaults).toEqual(["adsRevenue", "adsRoas", "adsSpend", "adsShare"]);
    expect(section("newCustomers").defaults).toEqual(["newCustomersTotal", "newCustomersRevenue", "newCustomersOrders", "newCustomersFromAds"]);
    expect(section("repurchase").defaults).toEqual(["repurchaseCustomers", "repurchaseRevenue", "repurchaseSales"]);
  });

  it("os cards que saíram do padrão continuam disponíveis para voltar", () => {
    const extras = OVERVIEW_SECTIONS.flatMap((s) => s.extras.map((e) => e.key));
    for (const old of ["revenue", "orders", "ticket", "spendOld", "roasOld", "newCustomersTicket", "retentionTicket", "requested", "buyers", "retention", "conversion"]) {
      expect(extras).toContain(old);
    }
  });

  it("nenhuma chave se repete entre padrão e disponíveis (nem entre blocos)", () => {
    const all = OVERVIEW_SECTIONS.flatMap((s) => [...s.defaults, ...s.extras.map((e) => e.key)]);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("visibleKeys", () => {
  it("sem escolha: só os padrões", () => {
    expect(visibleKeys(section("repurchase"), {})).toEqual(["repurchaseCustomers", "repurchaseRevenue", "repurchaseSales"]);
  });

  it("com escolha: padrões primeiro e depois os extras escolhidos, na ordem da lista de disponíveis (não na ordem do clique)", () => {
    const keys = visibleKeys(section("repurchase"), { repurchase: ["conversion", "retentionTicket"] });
    expect(keys).toEqual(["repurchaseCustomers", "repurchaseRevenue", "repurchaseSales", "retentionTicket", "conversion"]);
  });

  it("a escolha de um bloco não mexe nos outros", () => {
    expect(visibleKeys(section("ads"), { repurchase: ["conversion"] })).toEqual(section("ads").defaults);
  });
});

describe("sanitizeChoice (o que vem do localStorage nunca é confiado)", () => {
  it("lixo vira vazio", () => {
    for (const bad of [null, undefined, 42, "x", [], true]) expect(sanitizeChoice(bad)).toEqual({});
  });

  it("descarta chave que não existe mais no bloco, valor que não é texto e repetição; ignora bloco desconhecido", () => {
    const result = sanitizeChoice({
      result: ["ticket", "ticket", "cardQueNaoExiste", 7, "erpRevenue"], // erpRevenue é padrão, não "extra": não vale
      ads: "roasOld",
      inventado: ["x"],
      repurchase: ["conversion"],
    });
    expect(result).toEqual({ result: ["ticket"], repurchase: ["conversion"] });
  });

  it("não deixa uma escolha antiga duplicar um card padrão no bloco", () => {
    const keys = visibleKeys(section("result"), sanitizeChoice({ result: ["erpRevenue", "revenue"] }));
    expect(keys).toEqual(["erpRevenue", "erpOrders", "ecomPaidRevenue", "ecomPaidOrders", "revenue"]);
  });
});
