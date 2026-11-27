export function managerClientIds() {
  const configured = process.env.UP_MANAGER_CLIENT_IDS?.trim() || process.env.PRODUCT_CAMPAIGN_REVIEW_CLIENT_ID?.trim() || "";
  return [...new Set(configured.split(",").map((id) => id.trim()).filter(Boolean))];
}

export function isUpManagerPilot(clientId: string) {
  return managerClientIds().includes(clientId);
}

const saoPauloHour = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Sao_Paulo", hour: "2-digit", hourCycle: "h23",
});

export function managerScheduledAnalysisMode(now: Date, configuredHour = process.env.UP_MANAGER_SCHEDULED_ANALYSIS_HOUR) {
  const hour = configuredHour?.trim();
  if (!hour || !/^(?:[01]?\d|2[0-3])$/.test(hour)) return "on_evidence_change";
  return Number(saoPauloHour.format(now)) < Number(hour) ? "rules_only" : "once_daily";
}
