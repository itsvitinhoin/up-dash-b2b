import { describe, expect, it, vi } from "vitest";
import {
  OnboardingError,
  datasetForStoreName,
  groupSyncStoresByDataset,
  isValidIsoDate,
  planFiliais,
  runVestiOnboarding,
  toDatasetId,
  type OnboardingConflicts,
  type OnboardingStore,
  type OnboardingSync,
} from "../src/services/vesti-onboarding-rules";
import type { VestiSyncStore } from "../src/services/vesti-sync-service";

const noConflicts: OnboardingConflicts = { nameTaken: false, emailTaken: false, datasetOwner: null, loginEmailTaken: false };
const store = (id: number, name: string, extra: Partial<VestiSyncStore> = {}): VestiSyncStore => ({
  id,
  name,
  companyId: "C1",
  filialNum: 1,
  active: true,
  ...extra,
});
const filial = (filialNum = 1, companyId = "C1") => ({ apiKey: `key-${filialNum}`, companyId, filialNum });

function makeSync(existing: VestiSyncStore[] = [], overrides: Partial<OnboardingSync> = {}) {
  let nextId = 100;
  const sync = {
    list: vi.fn(async () => existing),
    create: vi.fn(async (input: { name: string }) => ({ id: nextId++, name: input.name, dataset: toDatasetId(input.name) })),
    setActive: vi.fn(async () => undefined),
    deactivate: vi.fn(async () => undefined),
    ...overrides,
  };
  return sync satisfies OnboardingSync;
}

function makeStore(overrides: Partial<OnboardingStore<{ id: string }>> = {}, conflicts: Partial<OnboardingConflicts> = {}) {
  return {
    findConflicts: vi.fn(async () => ({ ...noConflicts, ...conflicts })),
    persist: vi.fn(async () => ({ id: "client-1" })),
    ...overrides,
  } satisfies OnboardingStore<{ id: string }>;
}

describe("toDatasetId (mesmo cálculo do serviço de sync)", () => {
  it.each([
    ["Le Ricard", "le_ricard"],
    ["Doce Deleite", "doce_deleite"],
    ["Sline", "sline"],
    ["Café & Cia", "cafe_cia"],
    ["  Marca--X  ", "marca_x"],
    ["Ação Já", "acao_ja"],
    ["123 Loja", "_123_loja"],
    ["tuba_plus", "tuba_plus"],
  ])("%s -> %s", (name, expected) => {
    expect(toDatasetId(name)).toBe(expected);
  });

  it("corta em 1024 caracteres", () => {
    expect(toDatasetId("a".repeat(2000))).toHaveLength(1024);
  });
});

describe("datasetForStoreName", () => {
  it("devolve o dataset de um nome normal", () => {
    expect(datasetForStoreName("  Sline ")).toBe("sline");
  });
  it("recusa nome sem letra/número", () => {
    expect(datasetForStoreName("!!!")).toBeNull();
    expect(datasetForStoreName("   ")).toBeNull();
  });
  it("recusa nomes reservados do sistema", () => {
    expect(datasetForStoreName("Up Global")).toBeNull();
    expect(datasetForStoreName("analytics_123")).toBeNull();
  });
});

describe("isValidIsoDate", () => {
  it("aceita data real e recusa o resto", () => {
    expect(isValidIsoDate("2025-01-31")).toBe(true);
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("2026-02-31")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("31/01/2025")).toBe(false);
    expect(isValidIsoDate("")).toBe(false);
  });
});

describe("planFiliais", () => {
  it("cria o que ainda não existe", () => {
    const result = planFiliais("sline", [filial(1), filial(2)], []);
    expect(result).toEqual({ plan: [{ action: "create", filial: filial(1) }, { action: "create", filial: filial(2) }] });
  });

  it("reaproveita a filial ativa que já está no sync com o mesmo dataset", () => {
    const existing = store(7, "Sline");
    expect(planFiliais("sline", [filial(1)], [existing])).toEqual({ plan: [{ action: "reuse", filial: filial(1), store: existing }] });
  });

  it("reativa a filial que estava desligada", () => {
    const existing = store(7, "Sline", { active: false });
    expect(planFiliais("sline", [filial(1)], [existing])).toEqual({ plan: [{ action: "reactivate", filial: filial(1), store: existing }] });
  });

  it("prefere a cópia ativa quando há duas", () => {
    const off = store(7, "Sline", { active: false });
    const on = store(8, "SLINE");
    const result = planFiliais("sline", [filial(1)], [off, on]);
    expect(result).toEqual({ plan: [{ action: "reuse", filial: filial(1), store: on }] });
  });

  it("é conflito quando a mesma empresa+filial já está no sync com outro nome", () => {
    const result = planFiliais("sline", [filial(1)], [store(7, "Sline Outlet")]);
    expect(result).toHaveProperty("conflict");
    expect((result as { conflict: string }).conflict).toContain("Sline Outlet");
  });

  it("mesma loja com outra filial é uma filial nova", () => {
    const result = planFiliais("sline", [filial(2)], [store(7, "Sline")]);
    expect(result).toEqual({ plan: [{ action: "create", filial: filial(2) }] });
  });
});

describe("groupSyncStoresByDataset", () => {
  it("junta as filiais da mesma loja e ordena por nome", () => {
    const groups = groupSyncStoresByDataset([
      store(1, "Sline", { filialNum: 1 }),
      store(2, "Sline", { filialNum: 2, active: false }),
      store(3, "Adama"),
      store(4, "Mazarin", { active: false }),
    ]);
    expect(groups).toEqual([
      { dataset: "adama", storeName: "Adama", filiais: 1, active: true },
      { dataset: "mazarin", storeName: "Mazarin", filiais: 1, active: false },
      { dataset: "sline", storeName: "Sline", filiais: 2, active: true },
    ]);
  });
});

const baseInput = { name: "Sline (Vesti)", email: "sline@vesti.test", storeName: "Sline", filiais: [filial(1)] };

describe("runVestiOnboarding — loja nova", () => {
  it("cadastra no sync com o nome da LOJA e grava o cliente com o dataset devolvido", async () => {
    const sync = makeSync();
    const db = makeStore();
    const result = await runVestiOnboarding(baseInput, { sync, store: db });
    expect(sync.create).toHaveBeenCalledWith({ ...filial(1), name: "Sline" });
    expect(db.persist).toHaveBeenCalledWith({ dataset: "sline" });
    expect(result).toEqual({ dataset: "sline", created: { id: "client-1" }, syncStores: [{ id: 100, action: "create" }] });
    expect(sync.deactivate).not.toHaveBeenCalled();
  });

  it("sem nome de loja usa o nome do cliente", async () => {
    const sync = makeSync();
    const db = makeStore();
    await runVestiOnboarding({ ...baseInput, name: "Le Ricard", storeName: "  " }, { sync, store: db });
    expect(sync.create).toHaveBeenCalledWith(expect.objectContaining({ name: "Le Ricard" }));
    expect(db.persist).toHaveBeenCalledWith({ dataset: "le_ricard" });
  });

  it("cadastra todas as filiais, em ordem", async () => {
    const sync = makeSync();
    const result = await runVestiOnboarding({ ...baseInput, filiais: [filial(1), filial(2)] }, { sync, store: makeStore() });
    expect(sync.create).toHaveBeenCalledTimes(2);
    expect(result.syncStores.map((s) => s.id)).toEqual([100, 101]);
  });

  it("reaproveita o que já está no sync, sem criar de novo", async () => {
    const sync = makeSync([store(7, "Sline")]);
    const result = await runVestiOnboarding(baseInput, { sync, store: makeStore() });
    expect(sync.create).not.toHaveBeenCalled();
    expect(result.syncStores).toEqual([{ id: 7, action: "reuse" }]);
  });

  it("recusa nome de loja inválido antes de qualquer coisa", async () => {
    const sync = makeSync();
    const db = makeStore();
    await expect(runVestiOnboarding({ ...baseInput, storeName: "!!!" }, { sync, store: db })).rejects.toMatchObject({ code: "INVALID_STORE_NAME", status: 400 });
    expect(db.findConflicts).not.toHaveBeenCalled();
    expect(sync.list).not.toHaveBeenCalled();
  });

  it.each([
    [{ nameTaken: true }, "CLIENT_NAME_IN_USE"],
    [{ emailTaken: true }, "CLIENT_EMAIL_IN_USE"],
    [{ loginEmailTaken: true }, "EMAIL_ALREADY_IN_USE"],
    [{ datasetOwner: "Sline Spoorte" }, "DATASET_IN_USE"],
  ] as const)("conflito %j no painel: erro %s e NADA é feito no sync", async (conflict, code) => {
    const sync = makeSync();
    const db = makeStore({}, conflict);
    await expect(runVestiOnboarding(baseInput, { sync, store: db })).rejects.toMatchObject({ code, status: 409 });
    expect(sync.list).not.toHaveBeenCalled();
    expect(sync.create).not.toHaveBeenCalled();
    expect(db.persist).not.toHaveBeenCalled();
  });

  it("dataset em uso diz qual cliente já o usa", async () => {
    const db = makeStore({}, { datasetOwner: "Sline Spoorte" });
    await expect(runVestiOnboarding(baseInput, { sync: makeSync(), store: db })).rejects.toThrow('"Sline Spoorte"');
  });

  it("filial já cadastrada com outro nome: conflito, sem mexer em nada", async () => {
    const sync = makeSync([store(7, "Sline Outlet")]);
    const db = makeStore();
    await expect(runVestiOnboarding(baseInput, { sync, store: db })).rejects.toMatchObject({ code: "SYNC_STORE_CONFLICT", status: 409 });
    expect(sync.create).not.toHaveBeenCalled();
    expect(db.persist).not.toHaveBeenCalled();
  });

  it("serviço de sync fora do ar na leitura: 502 e nada é gravado", async () => {
    const sync = makeSync([], { list: vi.fn(async () => { throw Object.assign(new Error("down"), { code: "UNREACHABLE" }); }) });
    const db = makeStore();
    await expect(runVestiOnboarding(baseInput, { sync, store: db })).rejects.toMatchObject({ code: "SYNC_SERVICE_FAILED", status: 502 });
    expect(db.persist).not.toHaveBeenCalled();
  });

  it("serviço de sync sem configuração: 503", async () => {
    const sync = makeSync([], { list: vi.fn(async () => { throw Object.assign(new Error("x"), { code: "NOT_CONFIGURED" }); }) });
    await expect(runVestiOnboarding(baseInput, { sync, store: makeStore() })).rejects.toMatchObject({ code: "SYNC_SERVICE_NOT_CONFIGURED", status: 503 });
  });

  it("segunda filial falha: desliga a primeira (que acabou de criar) e não grava o cliente", async () => {
    let calls = 0;
    const sync = makeSync([], {
      create: vi.fn(async (input: { name: string }) => {
        calls += 1;
        if (calls === 2) throw Object.assign(new Error("boom"), { code: "REJECTED" });
        return { id: 100, name: input.name, dataset: "sline" };
      }),
    });
    const db = makeStore();
    await expect(runVestiOnboarding({ ...baseInput, filiais: [filial(1), filial(2)] }, { sync, store: db })).rejects.toMatchObject({ code: "SYNC_SERVICE_FAILED", status: 502 });
    expect(sync.deactivate).toHaveBeenCalledTimes(1);
    expect(sync.deactivate).toHaveBeenCalledWith(100);
    expect(db.persist).not.toHaveBeenCalled();
  });

  it("falha ao gravar no painel: desfaz a criação e a reativação, e devolve 500", async () => {
    const sync = makeSync([store(7, "Sline", { active: false })]);
    const db = makeStore({ persist: vi.fn(async () => { throw new Error("db down"); }) });
    await expect(runVestiOnboarding({ ...baseInput, filiais: [filial(1), filial(2)] }, { sync, store: db })).rejects.toMatchObject({ code: "ONBOARDING_FAILED", status: 500 });
    expect(sync.setActive).toHaveBeenNthCalledWith(1, 7, true);
    expect(sync.deactivate).toHaveBeenCalledWith(100);
    expect(sync.setActive).toHaveBeenLastCalledWith(7, false);
  });

  it("não desliga o que já estava ativo no sync (reaproveitado)", async () => {
    const sync = makeSync([store(7, "Sline")]);
    const db = makeStore({ persist: vi.fn(async () => { throw new Error("db down"); }) });
    await expect(runVestiOnboarding(baseInput, { sync, store: db })).rejects.toBeInstanceOf(OnboardingError);
    expect(sync.deactivate).not.toHaveBeenCalled();
    expect(sync.setActive).not.toHaveBeenCalled();
  });

  it("erro de negócio vindo da gravação (corrida de nome) mantém o código e também desfaz o sync", async () => {
    const sync = makeSync();
    const db = makeStore({ persist: vi.fn(async () => { throw new OnboardingError("CLIENT_NAME_IN_USE", "Já existe um cliente com esse nome no painel.", 409); }) });
    await expect(runVestiOnboarding(baseInput, { sync, store: db })).rejects.toMatchObject({ code: "CLIENT_NAME_IN_USE", status: 409 });
    expect(sync.deactivate).toHaveBeenCalledWith(100);
  });

  it("se não conseguir desfazer no sync, avisa qual loja ficou ligada", async () => {
    const sync = makeSync([], { deactivate: vi.fn(async () => { throw new Error("sync down"); }) });
    const db = makeStore({ persist: vi.fn(async () => { throw new Error("db down"); }) });
    const error = await runVestiOnboarding(baseInput, { sync, store: db }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(OnboardingError);
    expect((error as OnboardingError).message).toContain("ATENÇÃO");
    expect((error as OnboardingError).message).toContain("100");
  });

  it("serviço devolve datasets diferentes entre filiais: desfaz tudo", async () => {
    let n = 0;
    const sync = makeSync([], {
      create: vi.fn(async () => {
        n += 1;
        return { id: 100 + n, name: "Sline", dataset: n === 1 ? "sline" : "outro" };
      }),
    });
    const db = makeStore();
    await expect(runVestiOnboarding({ ...baseInput, filiais: [filial(1), filial(2)] }, { sync, store: db })).rejects.toMatchObject({ code: "SYNC_SERVICE_FAILED" });
    expect(sync.deactivate).toHaveBeenCalledTimes(2);
    expect(db.persist).not.toHaveBeenCalled();
  });

  it("dataset oficial diferente do esperado e já em uso: desfaz e avisa", async () => {
    const sync = makeSync([], { create: vi.fn(async () => ({ id: 100, name: "Sline", dataset: "sline_2" })) });
    const findConflicts = vi
      .fn<OnboardingStore<{ id: string }>["findConflicts"]>()
      .mockResolvedValueOnce(noConflicts)
      .mockResolvedValueOnce({ ...noConflicts, datasetOwner: "Outro cliente" });
    const db = makeStore({ findConflicts });
    await expect(runVestiOnboarding(baseInput, { sync, store: db })).rejects.toMatchObject({ code: "DATASET_IN_USE", status: 409 });
    expect(sync.deactivate).toHaveBeenCalledWith(100);
    expect(db.persist).not.toHaveBeenCalled();
  });
});

describe("runVestiOnboarding — ligar loja que já está no sync", () => {
  const linkInput = { name: "Sline (Vesti)", email: "sline@vesti.test", filiais: [], linkDataset: "sline" };

  it("só grava no painel; não cria nem liga/desliga nada no sync", async () => {
    const sync = makeSync([store(7, "Sline"), store(8, "Sline", { filialNum: 2 })]);
    const db = makeStore();
    const result = await runVestiOnboarding(linkInput, { sync, store: db });
    expect(db.persist).toHaveBeenCalledWith({ dataset: "sline" });
    expect(sync.create).not.toHaveBeenCalled();
    expect(sync.setActive).not.toHaveBeenCalled();
    expect(sync.deactivate).not.toHaveBeenCalled();
    expect(result.syncStores).toEqual([{ id: 7, action: "reuse" }, { id: 8, action: "reuse" }]);
  });

  it("loja que não está no sync: 404", async () => {
    const db = makeStore();
    await expect(runVestiOnboarding(linkInput, { sync: makeSync([store(1, "Adama")]), store: db })).rejects.toMatchObject({ code: "SYNC_STORE_NOT_FOUND", status: 404 });
    expect(db.persist).not.toHaveBeenCalled();
  });

  it("dataset já ligado a outro cliente: 409", async () => {
    const db = makeStore({}, { datasetOwner: "Sline Spoorte" });
    await expect(runVestiOnboarding(linkInput, { sync: makeSync([store(7, "Sline")]), store: db })).rejects.toMatchObject({ code: "DATASET_IN_USE" });
  });

  it("dataset reservado do sistema é recusado", async () => {
    await expect(runVestiOnboarding({ ...linkInput, linkDataset: "up_global" }, { sync: makeSync(), store: makeStore() })).rejects.toMatchObject({ code: "INVALID_STORE_NAME" });
  });
});
