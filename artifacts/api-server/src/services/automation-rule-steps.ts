export function normalizeAutomationRuleSteps<T extends { eventType: string }>(
  rules: T[],
  normalizeEventType: (eventType: string) => string | null,
): Array<T & { eventType: string; sequence: number }> {
  const eventCounts = new Map<string, number>();
  return rules.map((rule) => {
    const eventType = normalizeEventType(rule.eventType) ?? rule.eventType;
    const key = eventType.toLowerCase();
    const sequence = (eventCounts.get(key) ?? 0) + 1;
    eventCounts.set(key, sequence);
    return { ...rule, eventType, sequence };
  });
}
