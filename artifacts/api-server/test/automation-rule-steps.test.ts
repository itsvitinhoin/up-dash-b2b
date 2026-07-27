import { describe, expect, it } from "vitest";
import { normalizeAutomationRuleSteps } from "../src/services/automation-rule-steps";

describe("normalizeAutomationRuleSteps", () => {
  it("preserves multiple steps configured for the same event", () => {
    const rules = [
      { id: "rule-1", eventType: "cart.abandoned", delayMinutes: 60 },
      { id: "rule-2", eventType: "cart_abandoned", delayMinutes: 1440 },
      { id: "rule-3", eventType: "cart-abandoned", delayMinutes: 4320 },
    ];

    const normalized = normalizeAutomationRuleSteps(rules, () => "cart_abandoned");

    expect(normalized).toHaveLength(3);
    expect(normalized.map((rule) => rule.id)).toEqual(["rule-1", "rule-2", "rule-3"]);
    expect(normalized.map((rule) => rule.sequence)).toEqual([1, 2, 3]);
    expect(normalized.every((rule) => rule.eventType === "cart_abandoned")).toBe(true);
  });
});
