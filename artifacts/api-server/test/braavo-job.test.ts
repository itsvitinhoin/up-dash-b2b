import { describe, expect, it, vi } from "vitest";
vi.mock("../src/services/extraction-runner", () => ({ runBraavoTransactionalExtraction: vi.fn() }));
import { braavoJobMaxDurationMs, runBraavoJob } from "../src/services/braavo-job";

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
    const deps = fixture([dns, dns, dns, dns, dns, dns, dns, dns, dns, empty]);
    expect(await runBraavoJob("cron", { maxDurationMs: 24 * 3_600_000 }, deps)).toMatchObject({ failed: 1, pending: 0, batches: 9 });
    // 30 s dobrando até 10 min, 8 esperas (~46 min), depois falha e segue.
    expect(deps.sleep.mock.calls.map(([ms]) => ms)).toEqual([30000, 60000, 120000, 240000, 480000, 600000, 600000, 600000, 5000]);
  });
  it("waits and retries the same point after a network failure instead of dropping a long load", async () => {
    const net = batch({ failed: 1, pending: 0, nextOffset: 1, result: { status: "failed", code: "BRAAVO_NETWORK_UNAVAILABLE" } });
    const deps = fixture([net, net, batch({ done: 1, pending: 0, nextOffset: 1 }), empty]);
    expect(await runBraavoJob("cron", { maxDurationMs: 24 * 3_600_000 }, deps)).toMatchObject({ done: 1, failed: 0 });
    expect(deps.extract.mock.calls.slice(0, 3).map((call) => call[1].offset)).toEqual([0, 0, 0]);
    expect(deps.sleep.mock.calls.slice(0, 2).map(([ms]) => ms)).toEqual([30000, 60000]);
  });
  it("does not wait past the budget of a short scheduled run", async () => {
    const net = batch({ failed: 1, pending: 0, nextOffset: 1, result: { status: "failed", code: "BRAAVO_NETWORK_UNAVAILABLE" } });
    const deps = fixture([net]);
    expect(await runBraavoJob("cron", { maxDurationMs: 80_000 }, deps)).toMatchObject({ pending: 1, batches: 1 });
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  it("lets one long execution carry a historical load when BRAAVO_JOB_MAX_MINUTES is set", async () => {
    expect(braavoJobMaxDurationMs(undefined)).toBeUndefined();
    expect(braavoJobMaxDurationMs("")).toBeUndefined();
    expect(braavoJobMaxDurationMs("20")).toBe(20 * 60_000);
    expect(braavoJobMaxDurationMs("1380")).toBe(1380 * 60_000);
    // Com o orçamento longo a execução segue lote a lote até a carga terminar (não para aos 20 min).
    const longRun = fixture([batch(), batch(), batch(), batch({ pending: 0, done: 1, nextOffset: 1, result: { status: "done" } }), empty]);
    const long = await runBraavoJob("manual", { maxDurationMs: braavoJobMaxDurationMs("1380") }, longRun);
    expect(long).toMatchObject({ pending: 0, done: 1 });
  });

  it("rejects an invalid BRAAVO_JOB_MAX_MINUTES instead of silently using the default", () => {
    for (const bad of ["abc", "0", "-5", "1441", "NaN"])
      expect(() => braavoJobMaxDurationMs(bad)).toThrow(/BRAAVO_JOB_MAX_MINUTES inválido/);
  });
});
