import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@workspace/db", () => ({ db: {}, paidTouchpointsTable: {}, paidTouchpointsSyncTable: {} }));
import { decodeFbcClickTimestamp, latestTouchpointBefore } from "../src/services/paid-touchpoints";
import { fetchPaidTouchpointsForUser } from "../src/services/paid-touchpoints";
afterEach(() => vi.unstubAllGlobals());

describe("completude do histórico", () => {
  it("não aceita paginação truncada como busca completa", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: [], next_cursor: "more" }) })));
    await expect(fetchPaidTouchpointsForUser({apiKey:"test",userId:1,from:"2026-10-01T00:00:00Z",to:"2026-10-19T00:00:00Z"})).rejects.toThrow("limite de paginação");
  });
  it("divide uma janela com falha transiente sem reduzir o histórico solicitado", async () => {
    const windows: Array<{from:string|null;to:string|null}> = [];
    vi.stubGlobal("fetch",vi.fn(async (input:string) => {
      const url=new URL(input);windows.push({from:url.searchParams.get("from"),to:url.searchParams.get("to")});
      return windows.length<=3 ? {ok:false,status:504} : {ok:true,json:async()=>({data:[],next_cursor:null})};
    }));
    const from="2020-01-01T00:00:00Z",to="2026-10-19T00:00:00Z";
    await expect(fetchPaidTouchpointsForUser({apiKey:"test",userId:1,from,to})).resolves.toEqual([]);
    expect(windows).toHaveLength(5);
    expect(windows[3]?.from).toBe(from);
    expect(windows[3]?.to).toBe(windows[4]?.from);
    expect(windows[4]?.to).toBe(to);
  });
});

describe("decodeFbcClickTimestamp", () => {
  // fbc real da Nadia (validação ao vivo, 03/09/2026): decodifica pra
  // 22/08/2026 22:12 UTC -- bate exato com o clique tardio (depois do
  // pedido de 17/08) que o PDF de atribuição da MX Fashion cita como
  // exclusão correta.
  it("decodes the real Nadia click timestamp (validated against the MX Fashion PDF)", () => {
    const fbc =
      "fb.2.1787436750312.PAcGRvZgJmZGlkFlDPRWMcerMaS9HEzOLM_c1wAFfAPGxleHRuA2FlbQIxMQBzcnRjBmFwcF9pZA8xMjQwMjQ1NzQyODc0MTQAAaehogqsh6Gfp9uvMkrt4yjI3NTULk2HQCfhmUMt1Hor2P0llDjvtN3C_ecCBA_aem_TI9ICOmCMuFvEPqkiM19Nw";
    const decoded = decodeFbcClickTimestamp(fbc);
    expect(decoded?.toISOString()).toBe("2026-08-22T22:12:30.312Z");
  });

  it("returns null for a missing or malformed fbc", () => {
    expect(decodeFbcClickTimestamp(null)).toBeNull();
    expect(decodeFbcClickTimestamp(undefined)).toBeNull();
    expect(decodeFbcClickTimestamp("")).toBeNull();
    expect(decodeFbcClickTimestamp("not-an-fbc-cookie")).toBeNull();
    expect(decodeFbcClickTimestamp("fb.2.not-a-number.abc")).toBeNull();
  });

  it("requires the fb prefix", () => {
    expect(decodeFbcClickTimestamp("gclid.2.1787545950312.abc")).toBeNull();
  });
});

describe("latestTouchpointBefore", () => {
  it("picks the latest touchpoint at or before the given date, never after", () => {
    const touchpoints = [
      { occurredAt: new Date("2026-08-11T00:00:00Z") },
      { occurredAt: new Date("2026-08-17T21:26:16Z") },
      { occurredAt: new Date("2026-08-22T22:12:30Z") },
    ];
    // Pedido em 18/08 -- só o touchpoint de 17/08 conta, o de 22/08 vem depois.
    const result = latestTouchpointBefore(touchpoints, new Date("2026-08-18T00:26:17Z"));
    expect(result?.occurredAt.toISOString()).toBe("2026-08-17T21:26:16.000Z");
  });

  it("returns null when every touchpoint happened after the order (the Nadia case)", () => {
    const touchpoints = [{ occurredAt: new Date("2026-08-22T22:12:30Z") }];
    const result = latestTouchpointBefore(touchpoints, new Date("2026-08-17T00:00:00Z"));
    expect(result).toBeNull();
  });

  it("returns null with no touchpoints at all", () => {
    expect(latestTouchpointBefore([], new Date())).toBeNull();
  });
});
