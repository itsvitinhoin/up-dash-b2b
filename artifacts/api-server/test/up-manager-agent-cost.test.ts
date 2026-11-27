import { afterEach, describe, expect, it, vi } from "vitest";
import {
  draftManagerClientUpdates,
  managerAnalysisFingerprint,
  reuseManagerAnalysis,
  serializeManagerEvidence,
  type ReadyManagerAnalysis,
} from "../src/services/up-manager-agent";
import type { B2cFinding } from "../src/services/up-manager-b2c";

const { getOpenAIClient } = vi.hoisted(() => ({ getOpenAIClient: vi.fn() }));
vi.mock("../src/lib/openai", () => ({ getOpenAIClient }));

const model = "gpt-6.1-sol";

function fingerprint(evidence: unknown, selectedModel = model) {
  return managerAnalysisFingerprint(selectedModel, serializeManagerEvidence(evidence));
}

describe("UP Manager model usage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("ignores a same-day recheck and changing image URL while retaining new evidence", () => {
    const evidence = {
      variants: [{ size: "P", stock: 2, imageUrl: "https://example.com/original" }],
      observedAt: "2026-11-27T12:00:00.000Z",
      changedAt: "2026-11-27T11:00:00.000Z",
      purchases: 9,
    };
    const sameDay = {
      ...evidence,
      variants: [{ ...evidence.variants[0], imageUrl: "https://example.com/refreshed" }],
      observedAt: "2026-11-27T16:00:00.000Z",
    };

    expect(fingerprint(sameDay)).toBe(fingerprint(evidence));
    expect(fingerprint({ ...sameDay, observedAt: "2026-11-28T03:00:00.000Z" })).not.toBe(fingerprint(evidence));
    expect(fingerprint({ ...sameDay, changedAt: "2026-11-27T15:00:00.000Z" })).not.toBe(fingerprint(evidence));
    expect(fingerprint({ ...sameDay, purchases: 10 })).not.toBe(fingerprint(evidence));
    expect(fingerprint({ ...sameDay, variants: [{ size: "P", stock: 0 }] })).not.toBe(fingerprint(evidence));
    expect(fingerprint(sameDay, "other-model")).not.toBe(fingerprint(evidence));
  });

  it("reuses only matching evidence without copying provider usage into a second run", () => {
    const inputFingerprint = fingerprint({ purchases: 9 });
    const original: ReadyManagerAnalysis = {
      status: "ready",
      model,
      summary: "Receita cresceu com mais compras.",
      insights: [],
      createdAt: "2026-11-27T12:00:00.000Z",
      inputCoverage: { included: 1, total: 1 },
      inputFingerprint,
      usage: { inputTokens: 15_000, cachedInputTokens: 2_000, outputTokens: 700 },
    };

    const reused = reuseManagerAnalysis(original, inputFingerprint);

    expect(reused).toMatchObject({ reused: true, summary: original.summary, createdAt: original.createdAt });
    expect(reused).not.toHaveProperty("usage");
    expect(original).toHaveProperty("usage");
    expect(reuseManagerAnalysis(original, fingerprint({ purchases: 10 }))).toBeNull();
    expect(reuseManagerAnalysis(null, inputFingerprint)).toBeNull();
  });

  it.each([
    { copyModel: "", allowGeneration: true },
    { copyModel: "gpt-4.1-mini", allowGeneration: false },
  ])("drafts the note using the finding without calling a model (%j)", async ({ copyModel, allowGeneration }) => {
    vi.stubEnv("UP_MANAGER_COPY_MODEL", copyModel);
    vi.stubEnv("OPENAI_API_KEY", "");
    const finding: B2cFinding = {
      id: "conversion",
      title: "Queda na conversão",
      evidence: "A conversão caiu de 2% para 1%.",
      action: "revisar a página do produto.",
      section: "analysis",
      priority: "P1",
      hypothesis: "A queda se concentra na página do produto.",
      owner: "E-commerce",
      followUp: "Medir a taxa após o ajuste.",
    };
    const result = {} as Parameters<typeof draftManagerClientUpdates>[0];

    await draftManagerClientUpdates(result, [finding], { allowGeneration });

    expect(finding.clientDraft).toBe("Olá! A conversão caiu de 2% para 1%. Nossa proposta é revisar a página do produto.");
    expect(getOpenAIClient).not.toHaveBeenCalled();
  });
});
