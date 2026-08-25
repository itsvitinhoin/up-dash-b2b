import { describe, expect, it } from "vitest";
import {
  buildWhatsappTemplateSummaries,
  emptyWhatsappTemplateSummary,
  type WhatsappTemplateSummaryRow,
} from "../src/services/whatsapp-template-summary";

const row = (
  patch: Partial<WhatsappTemplateSummaryRow>,
): WhatsappTemplateSummaryRow => ({
  wabaId: "waba-a",
  status: "PENDING",
  lastSyncedAt: null,
  rawPayload: {},
  ...patch,
});

describe("WhatsApp template summaries", () => {
  it("keeps template counts isolated by WABA", () => {
    const summaries = buildWhatsappTemplateSummaries([
      row({ status: "APPROVED" }),
      row({ status: "REJECTED" }),
      row({ wabaId: "waba-b", status: "APPROVED" }),
    ]);

    expect(summaries.get("waba-a")).toMatchObject({
      approved: 1,
      pending: 0,
      rejected: 1,
      total: 2,
    });
    expect(summaries.get("waba-b")).toMatchObject({
      approved: 1,
      pending: 0,
      rejected: 0,
      total: 1,
    });
  });

  it("treats non-final Meta statuses as pending and keeps the latest sync", () => {
    const summaries = buildWhatsappTemplateSummaries([
      row({
        status: "IN_APPEAL",
        lastSyncedAt: new Date("2026-08-05T12:00:00.000Z"),
      }),
      row({
        status: "PAUSED",
        lastSyncedAt: new Date("2026-08-06T12:00:00.000Z"),
      }),
    ]);

    expect(summaries.get("waba-a")).toEqual({
      approved: 0,
      pending: 2,
      rejected: 0,
      total: 2,
      lastSyncedAt: "2026-08-06T12:00:00.000Z",
    });
  });

  it("does not include agency report templates in customer automation counts", () => {
    const summaries = buildWhatsappTemplateSummaries([
      row({ status: "APPROVED" }),
      row({
        status: "APPROVED",
        rawPayload: { upDashTemplateScope: "agency_report" },
      }),
    ]);

    expect(summaries.get("waba-a")?.total).toBe(1);
    expect(emptyWhatsappTemplateSummary()).toEqual({
      approved: 0,
      pending: 0,
      rejected: 0,
      total: 0,
      lastSyncedAt: null,
    });
  });
});
