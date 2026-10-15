import { describe, expect, it, vi } from "vitest";
import {
  SyncServiceError,
  createVestiSyncStore,
  deactivateVestiSyncStore,
  isSyncServiceConfigured,
  listVestiSyncStores,
  setVestiSyncStoreActive,
  syncServiceConfig,
} from "../src/services/vesti-sync-service";

const env = { SYNC_SERVICE_URL: "https://sync.example.test/", SYNC_SERVICE_TOKEN: "tok-123" };

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };

function fakeFetch(respond: (call: Call) => { status?: number; body?: unknown; raw?: string }) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    const call: Call = { url, method: init.method, headers: init.headers, body: init.body };
    calls.push(call);
    const out = respond(call);
    const status = out.status ?? 200;
    return { ok: status >= 200 && status < 300, status, text: async () => out.raw ?? (out.body === undefined ? "" : JSON.stringify(out.body)) };
  });
  return { fn, calls };
}

describe("configuração", () => {
  it("precisa de URL e token", () => {
    expect(isSyncServiceConfigured(env)).toBe(true);
    expect(isSyncServiceConfigured({ SYNC_SERVICE_URL: "https://x.test" })).toBe(false);
    expect(isSyncServiceConfigured({ SYNC_SERVICE_TOKEN: "t" })).toBe(false);
    expect(isSyncServiceConfigured({ SYNC_SERVICE_URL: "  ", SYNC_SERVICE_TOKEN: "t" })).toBe(false);
  });
  it("tira a barra final da URL", () => {
    expect(syncServiceConfig(env)?.url).toBe("https://sync.example.test");
  });
});

describe("listVestiSyncStores", () => {
  it("chama a lista com o token e devolve só campos não secretos", async () => {
    const { fn, calls } = fakeFetch(() => ({
      body: [
        { id: 1, name: "Sline", platform: "vesti", api_key: "SECRET-KEY", token: "SECRET-TOKEN", company_id: "55", store_id: null, filial_num: 2, active: true },
        { id: 2, name: "Adama", platform: "vesti", api_key: "SECRET-2", company_id: 9, filial_num: 1, active: false },
        { nome: "sem id" },
      ],
    }));
    const stores = await listVestiSyncStores({ env, fetch: fn });
    expect(calls[0].url).toBe("https://sync.example.test/api/clients?platform=vesti&include_inactive=true");
    expect(calls[0].method).toBe("GET");
    expect(calls[0].headers.Authorization).toBe("Bearer tok-123");
    expect(stores).toEqual([
      { id: 1, name: "Sline", companyId: "55", filialNum: 2, active: true },
      { id: 2, name: "Adama", companyId: "9", filialNum: 1, active: false },
    ]);
    expect(JSON.stringify(stores)).not.toContain("SECRET");
  });

  it("resposta que não é lista é rejeitada", async () => {
    const { fn } = fakeFetch(() => ({ body: { error: "x" } }));
    await expect(listVestiSyncStores({ env, fetch: fn })).rejects.toMatchObject({ code: "REJECTED" });
  });
});

describe("createVestiSyncStore", () => {
  it("manda os campos do serviço e devolve o dataset calculado lá", async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 201, body: { id: 12, name: "Sline", dataset: "sline", api_key: "SECRET" } }));
    const created = await createVestiSyncStore({ name: "Sline", apiKey: "k", companyId: "55", filialNum: 1 }, { env, fetch: fn });
    expect(created).toEqual({ id: 12, name: "Sline", dataset: "sline" });
    expect(calls[0].method).toBe("POST");
    expect(JSON.parse(calls[0].body as string)).toEqual({ name: "Sline", platform: "vesti", api_key: "k", company_id: "55", filial_num: 1 });
  });

  it("sem dataset na resposta é erro", async () => {
    const { fn } = fakeFetch(() => ({ status: 201, body: { id: 12, name: "Sline" } }));
    await expect(createVestiSyncStore({ name: "Sline", apiKey: "k", companyId: "55", filialNum: 1 }, { env, fetch: fn })).rejects.toMatchObject({ code: "REJECTED" });
  });
});

describe("desligar / religar", () => {
  it("DELETE desliga (soft) e PATCH liga/desliga", async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { ok: true } }));
    await deactivateVestiSyncStore(12, { env, fetch: fn });
    await setVestiSyncStoreActive(12, true, { env, fetch: fn });
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["DELETE", "https://sync.example.test/api/clients/12"],
      ["PATCH", "https://sync.example.test/api/clients/12"],
    ]);
    expect(JSON.parse(calls[1].body as string)).toEqual({ active: true });
  });
});

describe("erros", () => {
  it("sem configuração nem chama a rede", async () => {
    const { fn } = fakeFetch(() => ({ body: [] }));
    await expect(listVestiSyncStores({ env: {}, fetch: fn })).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(fn).not.toHaveBeenCalled();
  });

  it("resposta de erro do serviço: guarda só o status, nunca o texto (pode ter dados do cadastro)", async () => {
    const { fn } = fakeFetch(() => ({ status: 500, raw: "traceback com api_key=SECRET-KEY" }));
    const error = await createVestiSyncStore({ name: "S", apiKey: "k", companyId: "1", filialNum: 1 }, { env, fetch: fn }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SyncServiceError);
    expect((error as SyncServiceError).code).toBe("REJECTED");
    expect((error as SyncServiceError).status).toBe(500);
    expect((error as SyncServiceError).message).not.toContain("SECRET");
  });

  it("falha de rede vira UNREACHABLE", async () => {
    const fn = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    await expect(listVestiSyncStores({ env, fetch: fn as never })).rejects.toMatchObject({ code: "UNREACHABLE" });
  });

  it("estoura o tempo: aborta e vira UNREACHABLE", async () => {
    const fn = vi.fn(
      (_url: string, init: { signal?: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    await expect(listVestiSyncStores({ env, fetch: fn as never, timeoutMs: 20 })).rejects.toMatchObject({ code: "UNREACHABLE" });
  });

  it("resposta que não é JSON é rejeitada", async () => {
    const { fn } = fakeFetch(() => ({ raw: "<html>" }));
    await expect(listVestiSyncStores({ env, fetch: fn })).rejects.toMatchObject({ code: "REJECTED" });
  });
});
