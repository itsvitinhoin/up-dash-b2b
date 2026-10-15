// Cadastro completo de um cliente Vesti pelo painel novo ("Novo cliente Vesti"). Regras puras + o roteiro, sem Postgres nem rede:
// quem fala com o serviço de sync e com o banco é injetado (ver vesti-onboarding.ts e routes/clients.ts), então dá para testar tudo.
//
// O roteiro, em ordem (nada é gravado antes de passar nas checagens):
//  1) valida o nome da loja e calcula o dataset que o serviço de sync vai usar;
//  2) confere conflitos no painel (nome, e-mail, dataset já em uso, e-mail do login);
//  3) lê as lojas já cadastradas no sync e decide, por filial: criar, reaproveitar ou reativar;
//  4) cadastra no sync; 5) grava cliente (+ login) no painel numa transação;
//  se o passo 4 ou 5 falhar, DESFAZ o que mexeu no sync (cadastro novo é desligado, reativação é revertida).
import { logger } from "../lib/logger";
import { isProtectedDataset } from "./excluded-clients-rules";
import type { VestiSyncFilialInput, VestiSyncStore } from "./vesti-sync-service";

export type OnboardingErrorCode =
  | "INVALID_STORE_NAME"
  | "CLIENT_NAME_IN_USE"
  | "CLIENT_EMAIL_IN_USE"
  | "EMAIL_ALREADY_IN_USE"
  | "DATASET_IN_USE"
  | "SYNC_STORE_CONFLICT"
  | "SYNC_STORE_NOT_FOUND"
  | "SYNC_SERVICE_NOT_CONFIGURED"
  | "SYNC_SERVICE_FAILED"
  | "ONBOARDING_FAILED";

export class OnboardingError extends Error {
  constructor(
    readonly code: OnboardingErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "OnboardingError";
  }
}

/**
 * Mesmo cálculo do serviço de sync (script-vesti-nuvem, helpers/helpers_dataset.py → to_dataset_id): é o NOME DA LOJA que define o
 * dataset do BigQuery. "Le Ricard" → "le_ricard". Aqui serve para checar conflitos ANTES de cadastrar; o valor oficial é o que o
 * serviço devolve ao criar.
 */
export function toDatasetId(name: string): string {
  let s = name.normalize("NFKD").replace(/\p{M}/gu, "");
  s = s.replace(/[^A-Za-z0-9_]+/g, "_");
  s = s.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  if (!s || /^[0-9]/.test(s)) s = `_${s}`;
  return s.toLowerCase().slice(0, 1024);
}

/** Dataset utilizável a partir do nome da loja, ou `null` (sem letra/número ou reservado do sistema). */
export function datasetForStoreName(storeName: string): string | null {
  const dataset = toDatasetId(storeName.trim());
  if (!/[a-z0-9]/.test(dataset)) return null;
  if (isProtectedDataset(dataset)) return null;
  return dataset;
}

export type FilialPlan =
  | { action: "create"; filial: VestiSyncFilialInput }
  | { action: "reuse"; filial: VestiSyncFilialInput; store: VestiSyncStore }
  | { action: "reactivate"; filial: VestiSyncFilialInput; store: VestiSyncStore };

/**
 * Para cada filial informada: se a mesma empresa+filial já está no sync com o MESMO dataset, reaproveita (ou reativa, se estava
 * desligada); se está com outro nome, é conflito (criaria uma duplicata que o sync puxaria em dobro); senão, cria.
 */
export function planFiliais(
  dataset: string,
  filiais: VestiSyncFilialInput[],
  existing: VestiSyncStore[],
): { plan: FilialPlan[] } | { conflict: string } {
  const plan: FilialPlan[] = [];
  for (const filial of filiais) {
    const matches = existing.filter((store) => store.companyId === filial.companyId && store.filialNum === filial.filialNum);
    if (matches.length === 0) {
      plan.push({ action: "create", filial });
      continue;
    }
    const sameDataset = matches.filter((store) => toDatasetId(store.name) === dataset);
    if (sameDataset.length === 0) {
      const other = matches[0];
      return {
        conflict: `A filial ${filial.filialNum} da empresa ${filial.companyId} já está cadastrada no sync com outro nome ("${other.name}"). Use o mesmo nome da loja ou ajuste o cadastro lá antes.`,
      };
    }
    const chosen = sameDataset.find((store) => store.active) ?? sameDataset[0];
    plan.push(chosen.active ? { action: "reuse", filial, store: chosen } : { action: "reactivate", filial, store: chosen });
  }
  return { plan };
}

/** Lojas do sync agrupadas por dataset (para o modo "ligar uma loja que já está no sync"). */
export type SyncDatasetGroup = { dataset: string; storeName: string; filiais: number; active: boolean };

export function groupSyncStoresByDataset(stores: VestiSyncStore[]): SyncDatasetGroup[] {
  const groups = new Map<string, SyncDatasetGroup>();
  for (const store of stores) {
    const dataset = toDatasetId(store.name);
    const current = groups.get(dataset);
    if (!current) {
      groups.set(dataset, { dataset, storeName: store.name, filiais: 1, active: store.active });
    } else {
      current.filiais += 1;
      current.active = current.active || store.active;
    }
  }
  return [...groups.values()].sort((a, b) => a.storeName.localeCompare(b.storeName, "pt-BR"));
}

export type OnboardingInput = {
  /** Nome do cliente no painel (único). */
  name: string;
  email: string;
  /** Nome da loja na Vesti — define o dataset. Se vazio, usa `name`. */
  storeName?: string | null;
  /** Loja nova: filiais a cadastrar no sync. Vazio quando `linkDataset` é usado. */
  filiais: VestiSyncFilialInput[];
  /** Loja que já está no sync: só liga ao painel, sem mexer no sync. */
  linkDataset?: string | null;
  loginEmail?: string | null;
};

export type OnboardingSync = {
  list(): Promise<VestiSyncStore[]>;
  create(input: VestiSyncFilialInput & { name: string }): Promise<{ id: number; name: string; dataset: string }>;
  setActive(id: number, active: boolean): Promise<void>;
  deactivate(id: number): Promise<void>;
};

export type OnboardingConflicts = {
  nameTaken: boolean;
  emailTaken: boolean;
  /** Nome do cliente do painel que já usa o dataset, se houver. */
  datasetOwner: string | null;
  loginEmailTaken: boolean;
};

export type OnboardingStore<T> = {
  findConflicts(args: { name: string; email: string; dataset: string | null; loginEmail: string | null }): Promise<OnboardingConflicts>;
  persist(args: { dataset: string }): Promise<T>;
};

export type OnboardingResult<T> = {
  dataset: string;
  created: T;
  syncStores: Array<{ id: number; action: FilialPlan["action"] }>;
};

function failure(code: OnboardingErrorCode, message: string, status: number): never {
  throw new OnboardingError(code, message, status);
}

function conflictError(c: OnboardingConflicts): OnboardingError | null {
  if (c.nameTaken) return new OnboardingError("CLIENT_NAME_IN_USE", "Já existe um cliente com esse nome no painel.", 409);
  if (c.emailTaken) return new OnboardingError("CLIENT_EMAIL_IN_USE", "Já existe um cliente com esse e-mail no painel.", 409);
  if (c.loginEmailTaken) return new OnboardingError("EMAIL_ALREADY_IN_USE", "Já existe um usuário com o e-mail de login informado.", 409);
  if (c.datasetOwner) {
    return new OnboardingError(
      "DATASET_IN_USE",
      `Essa loja já está ligada ao cliente "${c.datasetOwner}" no painel (pode estar em Excluídos).`,
      409,
    );
  }
  return null;
}

async function undoSyncChanges(sync: OnboardingSync, done: Array<{ id: number; action: FilialPlan["action"] }>): Promise<number[]> {
  const stuck: number[] = [];
  for (const entry of [...done].reverse()) {
    try {
      if (entry.action === "create") await sync.deactivate(entry.id);
      else if (entry.action === "reactivate") await sync.setActive(entry.id, false);
    } catch (err) {
      stuck.push(entry.id);
      logger.error({ syncStoreId: entry.id, err: err instanceof Error ? err.message : String(err) }, "não foi possível desfazer o cadastro no sync Vesti");
    }
  }
  return stuck;
}

export async function runVestiOnboarding<T>(
  input: OnboardingInput,
  deps: { sync: OnboardingSync; store: OnboardingStore<T> },
): Promise<OnboardingResult<T>> {
  const { sync, store } = deps;
  const storeName = (input.storeName ?? "").trim() || input.name.trim();
  const linking = Boolean(input.linkDataset);

  const expected = linking ? input.linkDataset!.trim().toLowerCase() : datasetForStoreName(storeName);
  if (!expected || !datasetForStoreName(expected)) {
    failure("INVALID_STORE_NAME", "O nome da loja precisa ter letras ou números (e não pode ser um nome reservado do sistema).", 400);
  }

  const conflicts = await store.findConflicts({
    name: input.name.trim(),
    email: input.email.trim(),
    dataset: expected,
    loginEmail: input.loginEmail?.trim() || null,
  });
  const taken = conflictError(conflicts);
  if (taken) throw taken;

  let existing: VestiSyncStore[];
  try {
    existing = await sync.list();
  } catch (err) {
    throw syncFailure(err, "Não consegui falar com o serviço de sync da Vesti. Nada foi cadastrado.");
  }

  if (linking) {
    const stores = existing.filter((s) => toDatasetId(s.name) === expected);
    if (stores.length === 0) {
      failure("SYNC_STORE_NOT_FOUND", `Não achei a loja "${expected}" no serviço de sync da Vesti.`, 404);
    }
    const created = await persistOrFail(store, expected, async () => []);
    return { dataset: expected, created, syncStores: stores.map((s) => ({ id: s.id, action: "reuse" as const })) };
  }

  const planned = planFiliais(expected, input.filiais, existing);
  if ("conflict" in planned) failure("SYNC_STORE_CONFLICT", planned.conflict, 409);

  const done: Array<{ id: number; action: FilialPlan["action"] }> = [];
  const datasets = new Set<string>();
  try {
    for (const step of planned.plan) {
      if (step.action === "create") {
        const made = await sync.create({ ...step.filial, name: storeName });
        done.push({ id: made.id, action: "create" });
        datasets.add(made.dataset);
      } else if (step.action === "reactivate") {
        await sync.setActive(step.store.id, true);
        done.push({ id: step.store.id, action: "reactivate" });
        datasets.add(expected);
      } else {
        done.push({ id: step.store.id, action: "reuse" });
        datasets.add(expected);
      }
    }
  } catch (err) {
    const stuck = await undoSyncChanges(sync, done);
    throw syncFailure(err, undoSuffix("O cadastro no serviço de sync da Vesti falhou. Nada foi criado no painel.", stuck));
  }

  const dataset = [...datasets][0];
  if (datasets.size !== 1 || !dataset) {
    const stuck = await undoSyncChanges(sync, done);
    failure("SYNC_SERVICE_FAILED", undoSuffix("O serviço de sync devolveu datasets diferentes para as filiais. Nada foi criado no painel.", stuck), 502);
  }

  // O dataset oficial é o que o serviço devolveu: se for diferente do esperado, confere de novo se já está em uso.
  if (dataset !== expected) {
    const again = await store.findConflicts({ name: input.name.trim(), email: input.email.trim(), dataset, loginEmail: null });
    const clash = again.datasetOwner ? conflictError({ ...again, nameTaken: false, emailTaken: false, loginEmailTaken: false }) : null;
    if (clash) {
      const stuck = await undoSyncChanges(sync, done);
      throw new OnboardingError(clash.code, undoSuffix(clash.message, stuck), clash.status);
    }
  }

  const created = await persistOrFail(store, dataset, () => undoSyncChanges(sync, done));
  return { dataset, created, syncStores: done };
}

async function persistOrFail<T>(store: OnboardingStore<T>, dataset: string, undo: () => Promise<number[]>): Promise<T> {
  try {
    return await store.persist({ dataset });
  } catch (err) {
    const stuck = await undo();
    if (err instanceof OnboardingError) throw new OnboardingError(err.code, undoSuffix(err.message, stuck), err.status);
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "falha ao gravar cliente Vesti no painel");
    throw new OnboardingError("ONBOARDING_FAILED", undoSuffix("Não consegui salvar o cliente no painel. O que foi feito no sync foi desfeito.", stuck), 500);
  }
}

function undoSuffix(message: string, stuck: number[]): string {
  if (stuck.length === 0) return message;
  return `${message} ATENÇÃO: não consegui desligar no sync a(s) loja(s) de id ${stuck.join(", ")}; desligue-as lá para não puxar dados sem cliente.`;
}

function syncFailure(err: unknown, message: string): OnboardingError {
  const code = (err as { code?: string } | null)?.code;
  if (code === "NOT_CONFIGURED") {
    return new OnboardingError("SYNC_SERVICE_NOT_CONFIGURED", "O serviço de sync da Vesti não está configurado neste ambiente (SYNC_SERVICE_URL / SYNC_SERVICE_TOKEN).", 503);
  }
  return new OnboardingError("SYNC_SERVICE_FAILED", message, 502);
}

/** "YYYY-MM-DD" que existe no calendário (recusa 2026-02-31). */
export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
