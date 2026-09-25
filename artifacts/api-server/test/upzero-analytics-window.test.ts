import { describe, expect, it } from "vitest";
import { computeIncrementalWindow } from "../src/services/extraction-runner";

// Defaults de produção hoje (UPZERO_ANALYTICS_MAX_LOOKBACK_HOURS=72,
// UPZERO_ANALYTICS_OVERLAP_MINUTES=30) -- nenhum Cloud Run Job sobrescreve
// essas env vars (conferido via `gcloud run jobs describe` em 25/09/2026).
const HOUR_MS = 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

describe("computeIncrementalWindow", () => {
  it("uses the fallback window with no cap on the first sync (null watermark)", () => {
    const to = new Date("2026-09-25T12:00:00Z");
    const fallbackFrom = new Date("2026-05-01T03:00:00Z");
    const result = computeIncrementalWindow(null, to, fallbackFrom);
    expect(result.from).toEqual(fallbackFrom);
    expect(result.watermark).toBeNull();
    expect(result.cappedGapHours).toBeNull();
  });

  it("starts from watermark minus the overlap buffer when the gap is small", () => {
    const to = new Date("2026-09-25T12:00:00Z");
    const watermark = new Date(to.getTime() - HOUR_MS); // synced 1h ago
    const result = computeIncrementalWindow(watermark, to, new Date(0));
    expect(result.from).toEqual(new Date(watermark.getTime() - 30 * MIN_MS));
    expect(result.watermark).toEqual(watermark);
    expect(result.cappedGapHours).toBeNull();
  });

  it("caps the lookback and reports the uncovered gap when the watermark is stale beyond 72h", () => {
    const to = new Date("2026-09-25T12:00:00Z");
    const watermark = new Date(to.getTime() - 5 * 24 * HOUR_MS); // 5 days stale
    const result = computeIncrementalWindow(watermark, to, new Date(0));
    const ceiling = new Date(to.getTime() - 72 * HOUR_MS);
    expect(result.from).toEqual(ceiling);
    expect(result.cappedGapHours).not.toBeNull();
    // desiredFrom = watermark - 30min = 120h30 atrás; ceiling = 72h atrás.
    // Gap descoberto = 120,5h - 72h.
    expect(result.cappedGapHours).toBeCloseTo(120.5 - 72, 5);
  });

  it("does not cap exactly at the 72h boundary", () => {
    const to = new Date("2026-09-25T12:00:00Z");
    // watermark tal que (watermark - 30min) caia exatamente no teto de 72h.
    const watermark = new Date(to.getTime() - 72 * HOUR_MS + 30 * MIN_MS);
    const result = computeIncrementalWindow(watermark, to, new Date(0));
    expect(result.cappedGapHours).toBeNull();
    expect(result.from).toEqual(new Date(to.getTime() - 72 * HOUR_MS));
  });
});
