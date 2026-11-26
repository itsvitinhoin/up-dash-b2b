import { describe, expect, it } from "vitest";
import { combinePaidMediaChanges, managerActivityDetail } from "../src/services/up-manager-media-learning";

describe("atividades externas na memória do Up Manager", () => {
  it("preserva duas mudanças no mesmo dia sem duplicar a mesma atividade reimportada", () => {
    const base = { id: "123", level: "ad" as const, day: "2026-11-23", name: "Ayla Amarelo", title: "Alteração de veiculação" };
    const first = { ...base, changedAt: "2026-11-23T10:00:00Z" };
    const second = { ...base, changedAt: "2026-11-23T18:00:00Z", detail: "Ativo → Inativo" };
    const merged = combinePaidMediaChanges({ events: [first, second], partial: true }, [first, second], "2026-11-23");
    expect(merged.source).toBe("partial");
    expect(merged.events).toEqual([second, first]);
  });

  it("lê o antes e depois do orçamento em centavos e ignora campos sem cobertura", () => {
    const raw = {
      old_value: { currency: "BRL", old_value: "11810" },
      new_value: { currency: "BRL", new_value: 13582 },
      actor_name: "dado que não integra a memória",
    };
    expect(managerActivityDetail("update_ad_set_budget", JSON.stringify(raw), "BRL"))
      .toMatch(/118,10.*135,82/);
    expect(managerActivityDetail("update_ad_set_budget", raw, "USD")).toBeUndefined();
    expect(managerActivityDetail("update_ad_set_target_spec", raw, "BRL")).toBeUndefined();
    expect(managerActivityDetail("update_ad_run_status", { old_value: "Ativo", new_value: "Inativo" }, "BRL"))
      .toBe("Ativo → Inativo");
  });
});
