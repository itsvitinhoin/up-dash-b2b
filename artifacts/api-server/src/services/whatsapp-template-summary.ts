export type WhatsappTemplateSummary = {
  approved: number;
  pending: number;
  rejected: number;
  total: number;
  lastSyncedAt: string | null;
};

export type WhatsappTemplateSummaryRow = {
  wabaId: string;
  status: string;
  lastSyncedAt: Date | null;
  rawPayload: unknown;
};

function templateScope(rawPayload: unknown): string | null {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return null;
  }

  const scope = (rawPayload as Record<string, unknown>).upDashTemplateScope;
  return typeof scope === "string" ? scope : null;
}

export function emptyWhatsappTemplateSummary(): WhatsappTemplateSummary {
  return {
    approved: 0,
    pending: 0,
    rejected: 0,
    total: 0,
    lastSyncedAt: null,
  };
}

export function buildWhatsappTemplateSummaries(
  rows: WhatsappTemplateSummaryRow[],
): Map<string, WhatsappTemplateSummary> {
  const summaries = new Map<string, WhatsappTemplateSummary>();

  for (const row of rows) {
    if (templateScope(row.rawPayload) === "agency_report") continue;

    const current = summaries.get(row.wabaId) ?? emptyWhatsappTemplateSummary();
    const status = row.status.toUpperCase();

    current.total += 1;
    if (status === "APPROVED") current.approved += 1;
    else if (status === "REJECTED") current.rejected += 1;
    else current.pending += 1;

    const lastSyncedAt = row.lastSyncedAt?.toISOString() ?? null;
    if (
      lastSyncedAt &&
      (!current.lastSyncedAt || lastSyncedAt > current.lastSyncedAt)
    ) {
      current.lastSyncedAt = lastSyncedAt;
    }

    summaries.set(row.wabaId, current);
  }

  return summaries;
}
