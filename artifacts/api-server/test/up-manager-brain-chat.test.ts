import { describe, expect, it } from "vitest";
import { brainChatSchema, brainDateMatches, pickBrainEntries, resolveBrainChatReply } from "../src/services/up-manager-brain-chat";

describe("chat do Brain", () => {
  it("distingue o ano de datas em português e encontra datas explícitas", () => {
    expect(brainDateMatches("Como foi em 24 de novembro de 2025?", "2026-11-24")).toBe(false);
    expect(brainDateMatches("Compare 24/11 e 17/11/2026", "2026-11-24")).toBe(true);
    expect(brainDateMatches("Quais foram as vendas de 2026-11-24?", "2026-11-24")).toBe(true);
  });

  it("prioriza as evidências ligadas à pergunta", () => {
    const base = { branch: "stock" as const, date: "2026-11-24", source: "Loja", summary: "" };
    const result = pickBrainEntries({ entries: [
      { ...base, id: "1", title: "Saia Rosa" },
      { ...base, id: "2", title: "Conjunto Helena Marinho", summary: "O tamanho P esgotou." },
    ] }, "A grade do Helena Marinho quebrou?", 5);
    expect(result[0].id).toBe("2");
  });

  it("devolve apenas referências fornecidas ao modelo e rejeita evidência sem fonte", () => {
    const reference = { ref: "R1", runId: "run-owned", dateFrom: "2026-11-24", dateTo: "2026-11-24", archived: true };
    const result = resolveBrainChatReply({ answer: "Resultado [R1] [R999]", evidenceAvailable: true, references: ["R1", "R999", "R1"] }, [reference]);
    expect(result.citations).toEqual([reference]);
    expect(result.answer).not.toContain("[R999]");
    expect(() => resolveBrainChatReply({ answer: "Resultado [R999]", evidenceAvailable: true, references: ["R999"] }, [reference])).toThrow();
  });

  it("limita a conversa enviada pelo navegador", () => {
    expect(brainChatSchema.safeParse({ question: " ", history: [] }).success).toBe(false);
    expect(brainChatSchema.safeParse({ question: "O que mudou?", history: Array(5).fill({ question: "Anterior", answer: "Anterior" }) }).success).toBe(false);
  });
});
