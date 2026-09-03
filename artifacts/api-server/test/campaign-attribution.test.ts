import { describe, expect, it } from "vitest";
import { isPaidCampaignSignal, latestCampaignEvidenceBefore } from "../src/services/campaign-attribution";
import type { UpzeroAnalyticsMetric } from "../src/services/upzero/analytics-metrics";

function row(overrides: Partial<UpzeroAnalyticsMetric>): UpzeroAnalyticsMetric {
  return {
    period_start: "2026-08-01T00:00:00Z",
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    channel: null,
    source: null,
    fbc: null,
    fbclid: null,
    gclid: null,
    ...overrides,
  } as UpzeroAnalyticsMetric;
}

describe("isPaidCampaignSignal", () => {
  // Achado 03/09/2026 (PDF de atribuição MX Fashion, "Cenário 4"): link da
  // bio taggeado manualmente pra organização interna não pode virar falso
  // positivo de mídia paga.
  it("does not treat a manually-tagged bio link as paid, even with a named campaign", () => {
    expect(
      isPaidCampaignSignal(
        row({ utm_source: "instagram", utm_medium: "bio", utm_campaign: "organico" }),
      ),
    ).toBe(false);
  });

  it("does not treat any standalone named campaign as paid without a recognized paid source or medium", () => {
    expect(
      isPaidCampaignSignal(row({ utm_source: "newsletter", utm_medium: "email", utm_campaign: "promo_agosto" })),
    ).toBe(false);
  });

  it("still treats a real Meta ad click (paid medium) as paid", () => {
    expect(
      isPaidCampaignSignal(
        row({ utm_source: "instagram", utm_medium: "cpc", utm_campaign: "promo_agosto" }),
      ),
    ).toBe(true);
  });

  it("still treats a Meta placement medium as paid regardless of campaign name", () => {
    expect(
      isPaidCampaignSignal(
        row({ utm_source: "instagram", utm_medium: "instagram_stories", utm_campaign: "123456789" }),
      ),
    ).toBe(true);
  });

  it("still treats a named campaign from a Meta/Google source as paid when medium isn't bio", () => {
    expect(
      isPaidCampaignSignal(row({ utm_source: "facebook", utm_medium: "social", utm_campaign: "camp2026" })),
    ).toBe(true);
    expect(
      isPaidCampaignSignal(row({ utm_source: "google", utm_medium: "organic", utm_campaign: "brand" })),
    ).toBe(true);
  });

  it("still treats a click identifier (fbclid/gclid/fbc) as paid regardless of everything else", () => {
    expect(isPaidCampaignSignal(row({ fbclid: "abc123" }))).toBe(true);
  });

  it("keeps the existing linktree-only exclusion", () => {
    expect(
      isPaidCampaignSignal(
        row({ utm_source: "instagram", utm_medium: "linktree", utm_campaign: "linktree" }),
      ),
    ).toBe(false);
  });
});

describe("latestCampaignEvidenceBefore", () => {
  it("ignores paid evidence that occurred after the order (the Nadia case from the PDF)", () => {
    const rows = [
      row({ period_start: "2026-08-22T00:00:00Z", utm_source: "instagram", utm_medium: "cpc", utm_campaign: "camp" }),
    ];
    const orderCreatedAt = new Date("2026-08-17T00:00:00Z");
    expect(latestCampaignEvidenceBefore(rows, orderCreatedAt)).toBeNull();
  });

  it("picks the most recent paid evidence at or before the order", () => {
    const rows = [
      row({ period_start: "2026-08-11T00:00:00Z", utm_source: "instagram", utm_medium: "cpc", utm_campaign: "camp1" }),
      row({ period_start: "2026-08-15T00:00:00Z", utm_source: "instagram", utm_medium: "cpc", utm_campaign: "camp2" }),
      row({ period_start: "2026-08-20T00:00:00Z", utm_source: "instagram", utm_medium: "cpc", utm_campaign: "camp3" }),
    ];
    const orderCreatedAt = new Date("2026-08-18T00:00:00Z");
    expect(latestCampaignEvidenceBefore(rows, orderCreatedAt)?.utm_campaign).toBe("camp2");
  });
});
