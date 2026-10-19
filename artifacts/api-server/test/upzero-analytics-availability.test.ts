import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAnalyticsFetcher } from "../src/services/upzero/analytics-availability";

type Pause = { retryAfter: Date; reason: "disabled" | "unavailable" | "rate_limited" };
const rows = new Map<string, Pause>();
const store = {
  read: async (scope: string, endpoint: string) => rows.get(`${scope}:${endpoint}`) ?? null,
  pause: async (scope: string, endpoint: string, pause: Pause) => { rows.set(`${scope}:${endpoint}`, pause); },
};
beforeEach(() => { rows.clear(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-19T20:00:00Z")); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("disponibilidade de analytics compartilhada", () => {
  it("reconhece o 503 em texto e não repete consultas de outros compradores ou instâncias durante a pausa", async () => {
    const fetch = vi.fn(async () => new Response("Consulta de eventos de analytics temporariamente desativada", { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    const firstInstance = createAnalyticsFetcher(store);
    await expect(firstInstance("facts", "secret", "https://api.example?user_id=1")).rejects.toThrow("desativada pela UP Zero");
    const anotherInstance = createAnalyticsFetcher(store);
    await expect(anotherInstance("facts", "secret", "https://api.example?user_id=2")).rejects.toThrow("2026-10-19T20:30:00.000Z");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect([...rows.keys()][0]).not.toContain("secret");
  });

  it("volta a tentar depois da pausa sem intervenção manual e sem bloquear outra loja ou endpoint", async () => {
    const fetch = vi.fn(async () => new Response("temporariamente desativada", { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    const request = createAnalyticsFetcher(store);
    await expect(request("facts", "mx-key", "https://api.example")).rejects.toThrow();
    fetch.mockImplementation(async () => new Response('{"data":[]}'));
    await expect(request("facts", "another-key", "https://api.example")).resolves.toHaveProperty("status", 200);
    await expect(request("metrics", "mx-key", "https://api.example")).resolves.toHaveProperty("status", 200);
    vi.advanceTimersByTime(30 * 60_000);
    await expect(request("facts", "mx-key", "https://api.example")).resolves.toHaveProperty("status", 200);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("respeita Retry-After e não confunde uma resposta 200 vazia com falha", async () => {
    const fetch = vi.fn(async () => new Response("rate limited", { status: 429, headers: { "Retry-After": "900" } }));
    vi.stubGlobal("fetch", fetch);
    const request = createAnalyticsFetcher(store);
    await expect(request("facts", "mx-key", "https://api.example")).rejects.toThrow("2026-10-19T20:15:00.000Z");
    vi.advanceTimersByTime(15 * 60_000);
    fetch.mockImplementation(async () => new Response('{"data":[]}'));
    expect(await (await request("facts", "mx-key", "https://api.example")).json()).toEqual({ data: [] });
  });

  it("preserva erros de autenticação para o chamador e não os trata como indisponibilidade", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unauthorized", { status: 401 })));
    const response = await createAnalyticsFetcher(store)("facts", "mx-key", "https://api.example");
    expect(response.status).toBe(401);
    expect(rows.size).toBe(0);
  });
});
