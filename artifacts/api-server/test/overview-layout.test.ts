import { describe, expect, it } from "vitest";
import { OVERVIEW_SECTIONS } from "../../up-dash/src/lib/overview-layout";

// Cards da Visão geral: os padrões vêm do pedido do time (26/10/2026); os que saíram continuam listados em `removed` para voltar com uma troca de chave.

const section = (id: string) => OVERVIEW_SECTIONS.find((s) => s.id === id)!;

describe("padrão de cada bloco (pedido do time)", () => {
  it("os quatro blocos, na ordem, com os cards pedidos", () => {
    expect(OVERVIEW_SECTIONS.map((s) => s.title)).toEqual(["RESULTADO GERAL", "ANÚNCIOS", "NOVOS CLIENTES", "RECOMPRA"]);
    expect(section("result").defaults).toEqual(["erpRevenue", "erpOrders", "ecomPaidRevenue", "ecomPaidOrders"]);
    expect(section("ads").defaults).toEqual(["adsRevenue", "adsRoas", "adsSpend", "adsShare"]);
    expect(section("newCustomers").defaults).toEqual(["newCustomersTotal", "newCustomersRevenue", "newCustomersOrders", "newCustomersFromAds"]);
    expect(section("repurchase").defaults).toEqual(["repurchaseCustomers", "repurchaseRevenue", "repurchaseSales"]);
  });

  it("os cards que saíram do padrão continuam listados, prontos para voltar", () => {
    const removed = OVERVIEW_SECTIONS.flatMap((s) => s.removed.map((e) => e.key));
    for (const old of ["revenue", "orders", "ticket", "spendOld", "roasOld", "newCustomersTicket", "retentionTicket", "requested", "buyers", "retention", "conversion"]) {
      expect(removed).toContain(old);
    }
  });

  it("nenhuma chave se repete entre padrão e removidos (nem entre blocos)", () => {
    const all = OVERVIEW_SECTIONS.flatMap((s) => [...s.defaults, ...s.removed.map((e) => e.key)]);
    expect(new Set(all).size).toBe(all.length);
  });

  it("não há tela para o time trocar cards: o componente só renderiza os padrões", async () => {
    // guarda contra a volta do botão/armazenamento local (decisão do Marcelo em 27/10/2026: o ajuste é entre ele e o Claude, pelo código)
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../../up-dash/src/components/overview-organization.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/localStorage|Popover|Checkbox/);
    expect(source).toContain("section.defaults.map");
  });
});
