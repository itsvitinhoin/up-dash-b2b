// Cliente HTTP do serviço de sync da Vesti (script-vesti-nuvem, `api-vesti-report`): é lá que moram as lojas Vesti que o sync
// noturno puxa. Cadastrar uma loja nova passa por aqui (POST /api/clients) — é ele quem calcula o nome do dataset do BigQuery.
//
// Cuidado: GET /api/clients devolve também api_key/token das lojas. Só usamos id, nome, company_id, filial e ativo; o resto é
// descartado na hora e NUNCA vai para log nem para a resposta da API.
import { logger } from "../lib/logger";

export type VestiSyncStore = {
  id: number;
  name: string;
  companyId: string | null;
  filialNum: number;
  active: boolean;
};

export type VestiSyncCreated = { id: number; name: string; dataset: string };

export type VestiSyncFilialInput = { apiKey: string; companyId: string; filialNum: number };

export class SyncServiceError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_CONFIGURED" | "UNREACHABLE" | "REJECTED",
    readonly status?: number,
  ) {
    super(message);
    this.name = "SyncServiceError";
  }
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export type SyncServiceDeps = {
  env?: Record<string, string | undefined>;
  fetch?: FetchLike;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 20_000;

export function syncServiceConfig(env: Record<string, string | undefined> = process.env): { url: string; token: string } | null {
  const url = env.SYNC_SERVICE_URL?.trim().replace(/\/+$/, "");
  const token = env.SYNC_SERVICE_TOKEN?.trim();
  return url && token ? { url, token } : null;
}

export function isSyncServiceConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return syncServiceConfig(env) !== null;
}

async function call(
  path: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body: unknown,
  deps: SyncServiceDeps,
): Promise<unknown> {
  const config = syncServiceConfig(deps.env);
  if (!config) {
    throw new SyncServiceError("SYNC_SERVICE_URL / SYNC_SERVICE_TOKEN não configurados", "NOT_CONFIGURED");
  }
  const doFetch = deps.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await doFetch(`${config.url}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      // O texto de erro do serviço pode conter dados do cadastro: guardamos só o status.
      logger.warn({ path, method, status: response.status }, "serviço de sync Vesti recusou a chamada");
      throw new SyncServiceError(`O serviço de sync respondeu ${response.status}`, "REJECTED", response.status);
    }
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      throw new SyncServiceError("Resposta inválida do serviço de sync", "REJECTED", response.status);
    }
  } catch (err) {
    if (err instanceof SyncServiceError) throw err;
    logger.warn({ path, method }, "serviço de sync Vesti inacessível");
    throw new SyncServiceError("Não foi possível falar com o serviço de sync da Vesti", "UNREACHABLE");
  } finally {
    clearTimeout(timer);
  }
}

/** Lojas Vesti já cadastradas no sync (ativas e inativas). Só campos não secretos. */
export async function listVestiSyncStores(deps: SyncServiceDeps = {}): Promise<VestiSyncStore[]> {
  const data = await call("/api/clients?platform=vesti&include_inactive=true", "GET", undefined, deps);
  if (!Array.isArray(data)) throw new SyncServiceError("Resposta inesperada do serviço de sync", "REJECTED");
  const stores: VestiSyncStore[] = [];
  for (const row of data as Array<Record<string, unknown>>) {
    if (typeof row?.id !== "number" || typeof row?.name !== "string") continue;
    stores.push({
      id: row.id,
      name: row.name,
      companyId: row.company_id == null ? null : String(row.company_id),
      filialNum: typeof row.filial_num === "number" ? row.filial_num : 1,
      active: row.active !== false,
    });
  }
  return stores;
}

/** Registra uma filial Vesti no sync e devolve o dataset que o serviço calculou. */
export async function createVestiSyncStore(
  input: VestiSyncFilialInput & { name: string },
  deps: SyncServiceDeps = {},
): Promise<VestiSyncCreated> {
  const data = (await call(
    "/api/clients",
    "POST",
    { name: input.name, platform: "vesti", api_key: input.apiKey, company_id: input.companyId, filial_num: input.filialNum },
    deps,
  )) as Record<string, unknown> | null;
  if (!data || typeof data.id !== "number" || typeof data.dataset !== "string" || !data.dataset) {
    throw new SyncServiceError("O serviço de sync não devolveu o dataset da loja", "REJECTED");
  }
  return { id: data.id, name: String(data.name ?? input.name), dataset: data.dataset };
}

/** Liga/desliga uma loja no sync (desligar = `active=FALSE`, o sync deixa de puxar; nada é apagado). */
export async function setVestiSyncStoreActive(id: number, active: boolean, deps: SyncServiceDeps = {}): Promise<void> {
  await call(`/api/clients/${id}`, "PATCH", { active }, deps);
}

/** Desfaz um cadastro recém-criado (soft delete no serviço: `active=FALSE`). */
export async function deactivateVestiSyncStore(id: number, deps: SyncServiceDeps = {}): Promise<void> {
  await call(`/api/clients/${id}`, "DELETE", undefined, deps);
}
