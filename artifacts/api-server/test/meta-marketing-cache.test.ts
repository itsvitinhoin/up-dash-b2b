import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, creativesTable: {} }));
vi.mock("drizzle-orm", () => ({ and: () => 0, eq: () => 0, sql: () => 0 }));

import { fetchMetaMarketingData } from "../src/services/meta-ads";

const base = { accessToken: "t", adAccountId: "act_1", since: "2026-09-09", until: "2026-10-08" };
let calls = 0;
let failFirst = 0;

function okBody() {
  return { ok: true, status: 200, statusText: "OK", json: async () => ({ data: [] }) };
}
function errBody() {
  return { ok: false, status: 400, statusText: "Bad", json: async () => ({ error: { message: "(#17) User request limit reached", code: 17 } }) };
}

beforeEach(() => {
  vi.useFakeTimers();
  calls = 0;
  failFirst = 0;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      calls++;
      return failFirst > 0 && failFirst-- > 0 ? errBody() : okBody();
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchMetaMarketingData", () => {
  it("telas que pedem a mesma conta e periodo ao mesmo tempo compartilham UMA busca", async () => {
    const p = { ...base, adAccountId: "act_share" };
    const [a, b, c] = await Promise.all([fetchMetaMarketingData(p), fetchMetaMarketingData(p), fetchMetaMarketingData(p)]);
    const callsForOne = calls;
    expect(a).toBe(b);
    expect(b).toBe(c);
    // uma busca completa = 3 consultas de insights + status das campanhas (nao 3x isso)
    const solo = { ...base, adAccountId: "act_solo" };
    calls = 0;
    await fetchMetaMarketingData(solo);
    expect(callsForOne).toBe(calls);
  });

  it("periodos diferentes nao se misturam", async () => {
    const a = await fetchMetaMarketingData({ ...base, adAccountId: "act_p", until: "2026-10-08" });
    const b = await fetchMetaMarketingData({ ...base, adAccountId: "act_p", until: "2026-10-07" });
    expect(a).not.toBe(b);
  });

  it("uma falha passageira da Meta e refeita uma vez, sem derrubar o resultado", async () => {
    failFirst = 1;
    const pending = fetchMetaMarketingData({ ...base, adAccountId: "act_retry" });
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toBeTruthy();
  });

  it("falha nas duas tentativas devolve erro e NAO fica guardada: a proxima chamada tenta de novo", async () => {
    failFirst = 100;
    const first = fetchMetaMarketingData({ ...base, adAccountId: "act_fail" });
    const assertion = expect(first).rejects.toThrow(/Meta Marketing API error/);
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;

    failFirst = 0;
    const second = fetchMetaMarketingData({ ...base, adAccountId: "act_fail" });
    await vi.advanceTimersByTimeAsync(10);
    await expect(second).resolves.toBeTruthy();
  });
});
