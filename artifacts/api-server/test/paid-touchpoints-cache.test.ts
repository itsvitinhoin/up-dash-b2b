import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Banco e UpZero simulados: o que se testa aqui é a DECISÃO do cache
// (ler do Postgres, atualizar só o trecho novo, ou buscar tudo), não as queries.
type SyncRow = { syncedFrom: Date; syncedTo: Date; syncedAt: Date };
const state = vi.hoisted(() => ({
  sync: null as null | { syncedFrom: Date; syncedTo: Date; syncedAt: Date },
  cachedRows: [] as unknown[],
  syncWrites: [] as Array<{ syncedFrom: Date; syncedTo: Date }>,
  touchpointWrites: 0,
}));

vi.mock("@workspace/db", () => {
  const paidTouchpointsTable = { __t: "touchpoints", occurredAt: "occurredAt", clientId: "c", customerId: "u", evidenceKey: "k", id: "id" };
  const paidTouchpointsSyncTable = { __t: "sync", syncedFrom: "f", syncedTo: "t", clientId: "c", customerId: "u" };
  const db = {
    select: () => ({
      from: (table: { __t: string }) => ({
        where: async () => (table.__t === "sync" ? (state.sync ? [state.sync] : []) : state.cachedRows),
      }),
    }),
    insert: (table: { __t: string }) => ({
      values: (v: Record<string, unknown> | Array<unknown>) => {
        if (table.__t === "sync") {
          const row = v as { syncedFrom: Date; syncedTo: Date };
          return {
            onConflictDoUpdate: async () => {
              state.syncWrites.push({ syncedFrom: row.syncedFrom, syncedTo: row.syncedTo });
            },
          };
        }
        return {
          onConflictDoNothing: () => ({
            returning: async () => {
              state.touchpointWrites += (v as unknown[]).length;
              return (v as unknown[]).map((_, i) => ({ id: i }));
            },
          }),
        };
      },
    }),
  };
  return { db, paidTouchpointsTable, paidTouchpointsSyncTable };
});
vi.mock("drizzle-orm", () => ({ and: () => 0, eq: () => 0, gte: () => 0, lte: () => 0, sql: () => 0 }));

import { getTouchpointsForCustomerCached } from "../src/services/paid-touchpoints";

const NOW = new Date("2026-10-08T15:00:00Z");
const BLOCK = "2026-10-08T12:00:00.000Z"; // início do bloco de 6h
const FROM = "2016-10-10T12:00:00.000Z"; // 10 anos antes
const hoursAgo = (h: number, base = NOW) => new Date(base.getTime() - h * 3_600_000);

function paidFact(id: number, occurredAt: string) {
  return { id, event_name: "PageView", occurred_at: occurredAt, utm_source: "facebook", utm_medium: "cpc", utm_campaign: "x", fbclid: `fbclid-${id}`, fbc: null, gclid: null, source: null, channel: null };
}

let fetchedWindows: Array<{ from: string; to: string }> = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  state.sync = null;
  state.cachedRows = [];
  state.syncWrites = [];
  state.touchpointWrites = 0;
  fetchedWindows = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      fetchedWindows.push({ from: url.searchParams.get("from") ?? "", to: url.searchParams.get("to") ?? "" });
      return { ok: true, status: 200, json: async () => ({ data: [paidFact(1, "2026-10-08T10:00:00Z")], next_cursor: null }), text: async () => "" };
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const base = { apiKey: "k", clientId: "c1", customerId: "u1", externalUserId: 7, from: FROM, to: BLOCK };

describe("getTouchpointsForCustomerCached", () => {
  it("sem sincronização anterior busca a janela inteira (comportamento antigo)", async () => {
    await getTouchpointsForCustomerCached(base);
    expect(fetchedWindows).toHaveLength(1);
    expect(fetchedWindows[0]!.from).toBe(FROM);
    expect(state.syncWrites).toHaveLength(1);
  });

  it("sync de 13h atrás NÃO vai à UpZero quando o último pedido do cliente já está coberto e fechado há mais de 24h", async () => {
    // O caso que causava 58-77s: sync "velho", cliente fora do lote de 90 dias.
    const sync: SyncRow = { syncedFrom: new Date("2016-10-10T00:00:00Z"), syncedTo: new Date("2026-10-07T18:00:00Z"), syncedAt: hoursAgo(13) };
    state.sync = sync;
    await getTouchpointsForCustomerCached({ ...base, needUntil: "2026-09-20T10:00:00Z" });
    expect(fetchedWindows).toHaveLength(0);
  });

  it("sem needUntil o mesmo sync velho exige atualização (regra antiga preservada)", async () => {
    state.sync = { syncedFrom: new Date("2016-10-10T00:00:00Z"), syncedTo: new Date("2026-10-07T18:00:00Z"), syncedAt: hoursAgo(13) };
    await getTouchpointsForCustomerCached(base);
    expect(fetchedWindows).toHaveLength(1);
  });

  it("pedido recente (menos de 24h) com sync de mais de 6h atualiza só o trecho novo, não os 10 anos", async () => {
    const syncedTo = new Date("2026-10-07T18:00:00Z");
    state.sync = { syncedFrom: new Date("2016-10-10T00:00:00Z"), syncedTo, syncedAt: hoursAgo(13) };
    await getTouchpointsForCustomerCached({ ...base, needUntil: "2026-10-08T09:00:00Z" });
    expect(fetchedWindows).toHaveLength(1);
    // 24h de folga antes do fim do que já estava sincronizado
    expect(fetchedWindows[0]!.from).toBe(new Date(syncedTo.getTime() - 24 * 3_600_000).toISOString());
    expect(fetchedWindows[0]!.to).toBe(BLOCK);
    // a cobertura gravada nunca encolhe: união com o que já existia
    expect(state.syncWrites[0]!.syncedTo.toISOString()).toBe(BLOCK);
  });

  it("sync recente (menos de 6h) cobrindo o pedido recente lê do Postgres", async () => {
    state.sync = { syncedFrom: new Date("2016-10-10T00:00:00Z"), syncedTo: new Date(BLOCK), syncedAt: hoursAgo(1) };
    await getTouchpointsForCustomerCached({ ...base, needUntil: "2026-10-08T09:00:00Z" });
    expect(fetchedWindows).toHaveLength(0);
  });

  it("cobertura que não alcança o início da janela cai na busca completa", async () => {
    state.sync = { syncedFrom: new Date("2026-01-01T00:00:00Z"), syncedTo: new Date(BLOCK), syncedAt: hoursAgo(1) };
    await getTouchpointsForCustomerCached({ ...base, needUntil: "2026-09-20T10:00:00Z" });
    expect(fetchedWindows).toHaveLength(1);
    expect(fetchedWindows[0]!.from).toBe(FROM);
  });

  it("needUntil depois do fim da janela não exige cobertura além dela", async () => {
    state.sync = { syncedFrom: new Date("2016-10-10T00:00:00Z"), syncedTo: new Date(BLOCK), syncedAt: hoursAgo(1) };
    await getTouchpointsForCustomerCached({ ...base, needUntil: "2026-10-08T14:00:00Z" });
    expect(fetchedWindows).toHaveLength(0);
  });

  it("falha da UpZero propaga o erro (o chamador conta a falha, não esconde)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 504, json: async () => ({}), text: async () => "timeout" })));
    await expect(getTouchpointsForCustomerCached(base)).rejects.toThrow();
  });
});
