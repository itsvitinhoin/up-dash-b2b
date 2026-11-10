import { describe, expect, it } from "vitest";
import {
  BACKFILL_MAX_MINUTES,
  BACKFILL_TIMEOUT_SECONDS,
  braavoBackfillRequest,
} from "../src/services/cloud-run-jobs";

describe("Braavo cloud backfill request", () => {
  const { url, body } = braavoBackfillRequest("loja-123");

  it("calls the run endpoint of the Braavo job", () => {
    expect(url).toBe(
      "https://run.googleapis.com/v2/projects/up-vesti-report/locations/us-central1/jobs/upzero-sync-job-braavo:run",
    );
  });

  it("restricts the run to one store with a long budget and timeout", () => {
    const env = body.overrides.containerOverrides[0].env;
    expect(env).toEqual([
      { name: "CLIENT_ID", value: "loja-123" },
      { name: "BRAAVO_JOB_MAX_MINUTES", value: String(BACKFILL_MAX_MINUTES) },
    ]);
    expect(body.overrides.timeout).toBe(`${BACKFILL_TIMEOUT_SECONDS}s`);
    expect(BACKFILL_MAX_MINUTES).toBeLessThanOrEqual(1440);
  });

  it("never lets the caller change the task or any other variable of the job", () => {
    const names = body.overrides.containerOverrides[0].env.map((e) => e.name);
    expect(names).not.toContain("TASK");
    expect(names.sort()).toEqual(["BRAAVO_JOB_MAX_MINUTES", "CLIENT_ID"]);
  });
});
