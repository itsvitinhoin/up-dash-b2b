export function managerClientIds() {
  const configured = process.env.UP_MANAGER_CLIENT_IDS?.trim() || process.env.PRODUCT_CAMPAIGN_REVIEW_CLIENT_ID?.trim() || "";
  return [...new Set(configured.split(",").map((id) => id.trim()).filter(Boolean))];
}

export function isUpManagerPilot(clientId: string) {
  return managerClientIds().includes(clientId);
}
