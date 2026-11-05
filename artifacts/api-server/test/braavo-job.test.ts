import { describe, expect, it, vi } from "vitest";
vi.mock("../src/services/extraction-runner", () => ({ runBraavoTransactionalExtraction: vi.fn() }));
import { runBraavoJob } from "../src/services/braavo-job";

const empty = { clients: 0, done: 0, failed: 0, pending: 0, nextOffset: 1 };
const batch = (overrides = {}) => ({ clients: 1, done: 0, failed: 0, pending: 1, nextOffset: 0, result: { status: "pending" }, ...overrides });
function fixture(responses: unknown[]) {
  let time = 0;
  const extract = vi.fn();
  responses.forEach((response) => extract.mockResolvedValueOnce(response));
  const sleep = vi.fn(async (ms: number) => { time += ms; });
  return { extract, sleep, now: () => time };
}

describe("Braavo Cloud Run job", () => {
  it("continues durable pages, passes CLIENT_ID and advances only after completion", async () => {
    const deps = fixture([batch(), batch(), batch({ done: 1, pending: 0, nextOffset: 1, result: { status: "done" } }), empty]);
    expect(await runBraavoJob("cron", { clientId: "la-cleo" }, deps)).toMatchObject({ done: 1, failed: 0, pending: 0, batches: 3 });
    expect(deps.extract.mock.calls.map((call) => call[1])).toEqual([
      { clientId: "la-cleo", offset: 0 }, { clientId: "la-cleo", offset: 0 },
      { clientId: "la-cleo", offset: 0 }, { clientId: "la-cleo", offset: 1 },
    ]);
    expect(deps.sleep).toHaveBeenCalledWith(5000);
  });
  it("retries a DNS failure at the same offset before continuing", async () => {
    const deps = fixture([
      batch({ failed: 1, pending: 0, nextOffset: 1, result: { status: "failed", code: "BRAAVO_DNS_UNAVAILABLE" } }),
      batch({ done: 1, pending: 0, nextOffset: 1 }), empty,
    ]);
    expect(await runBraavoJob("cron", {}, deps)).toMatchObject({ done: 1, failed: 0 });
    expect(deps.extract.mock.calls.slice(0, 2).map((call) => call[1].offset)).toEqual([0, 0]);
    expect(deps.sleep).toHaveBeenCalledWith(30000);
  });
  it("does not retry permanent failures or anti-bot challenges", async () => {
    const deps = fixture([batch({ failed: 1, pending: 0, nextOffset: 1, result: { status: "failed", code: "BRAAVO_ACCESS_BLOCKED" } }), empty]);
    expect(await runBraavoJob("cron", {}, deps)).toMatchObject({ failed: 1, pending: 0 });
    expect(deps.extract.mock.calls.map((call) => call[1].offset)).toEqual([0, 1]);
  });
  it("keeps a busy client's offset instead of skipping it", async () => {
    const deps = fixture([batch({ result: { status: "busy" } }), batch({ done: 1, pending: 0, nextOffset: 1 }), empty]);
    await runBraavoJob("cron", {}, deps);
    expect(deps.extract.mock.calls.map((call) => call[1].offset)).toEqual([0, 0, 1]);
  });
  it("returns pending when the job budget cannot fit another batch", async () => {
    const deps = fixture([batch()]);
    expect(await runBraavoJob("cron", { maxDurationMs: 55000 }, deps)).toMatchObject({ done: 0, pending: 1, nextOffset: 0, batches: 1 });
    expect(deps.extract).toHaveBeenCalledTimes(1);
  });
  it("bounds retries when DNS remains unavailable", async () => {
    const dns = batch({ failed: 1, pending: 0, nextOffset: 1, result: { status: "failed", code: "BRAAVO_DNS_UNAVAILABLE" } });
    const deps = fixture([dns, dns, dns, dns, empty]);
    expect(await runBraavoJob("cron", {}, deps)).toMatchObject({ failed: 1, pending: 0, batches: 4 });
    expect(deps.sleep.mock.calls.map(([ms]) => ms)).toEqual([30000, 60000, 120000, 5000]);
  });
});
