// Histórico de anúncios no painel: junta cadastro do cliente + BigQuery para (1) mostrar o estado e (2) registrar o pedido do botão
// "Buscar histórico". Quem busca de fato é o job ads-onboarding do backend-dash; aqui só se lê o estado e se grava o pedido.
import { eq } from "drizzle-orm";
import { db, clientsTable } from "@workspace/db";
import { saoPauloDateOnly } from "../lib/reporting-period";
import { publishAdsAccountsSafely } from "./ads-accounts-publisher";
import { insertHistoryRequest, readAdsHistory } from "./ads-history-bq";
import {
  adAccountDigits,
  buildHistoryView,
  validateStartDate,
  type HistoryPhase,
  type HistoryView,
} from "./ads-history-rules";
import type { BigQueryLike } from "./excluded-clients-bq";
import { isBigQueryAvailable } from "./excluded-clients-rules";

export type HistoryClient = {
  id: string;
  name: string;
  metaAdAccountId: string | null;
  isActive: boolean;
  archivedAt: Date | null;
};

export class AdsHistoryError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type AdsHistoryDeps = {
  loadClient: (clientId: string) => Promise<HistoryClient | null>;
  bigQuery: () => Promise<BigQueryLike>;
  bigQueryAvailable: () => boolean;
  now: () => Date;
  publishAccounts: () => Promise<void>;
};

const defaultDeps: AdsHistoryDeps = {
  loadClient: async (clientId) => {
    const [client] = await db
      .select({
        id: clientsTable.id,
        name: clientsTable.name,
        metaAdAccountId: clientsTable.metaAdAccountId,
        isActive: clientsTable.isActive,
        archivedAt: clientsTable.archivedAt,
      })
      .from(clientsTable)
      .where(eq(clientsTable.id, clientId));
    return client ?? null;
  },
  bigQuery: async () => (await import("../lib/bigquery")).bigquery as unknown as BigQueryLike,
  bigQueryAvailable: () => isBigQueryAvailable(),
  now: () => new Date(),
  publishAccounts: () => publishAdsAccountsSafely("pedido de histórico"),
};

export type AdsHistoryResponse = {
  /** false = ambiente sem BigQuery (desenvolvimento local): a tela mostra "indisponível". */
  available: boolean;
  /** false = o cliente não tem conta de anúncio válida cadastrada. */
  hasAccount: boolean;
  adAccountId: string | null;
  history: HistoryView | null;
};

async function requireClient(deps: AdsHistoryDeps, clientId: string): Promise<HistoryClient> {
  const client = await deps.loadClient(clientId);
  if (!client) throw new AdsHistoryError(404, "NOT_FOUND", "Cliente não encontrado.");
  return client;
}

export async function getAdsHistory(clientId: string, deps: AdsHistoryDeps = defaultDeps): Promise<AdsHistoryResponse> {
  const client = await requireClient(deps, clientId);
  const digits = adAccountDigits(client.metaAdAccountId);
  if (!digits) return { available: true, hasAccount: false, adAccountId: null, history: null };
  if (!deps.bigQueryAvailable()) return { available: false, hasAccount: true, adAccountId: `act_${digits}`, history: null };
  const read = await readAdsHistory(await deps.bigQuery(), digits);
  return { available: true, hasAccount: true, adAccountId: `act_${digits}`, history: buildHistoryView({ ...read, now: deps.now() }) };
}

const WAIT_MESSAGES: Partial<Record<HistoryPhase, string>> = {
  queued: "Já existe um pedido na fila para esta conta. Aguarde ele ser processado.",
  running: "O histórico desta conta está sendo buscado agora. Aguarde terminar.",
  waiting: "O Facebook limitou as chamadas; o sistema volta a tentar sozinho. Não precisa pedir de novo.",
};

export async function requestAdsHistory(
  clientId: string,
  input: { requestedBy: string | null; startDate: unknown },
  deps: AdsHistoryDeps = defaultDeps,
): Promise<{ requested: true; startDate: string | null }> {
  const client = await requireClient(deps, clientId);
  if (client.archivedAt) throw new AdsHistoryError(409, "CLIENT_ARCHIVED", "Cliente excluído (na lixeira). Recupere o cliente antes de buscar histórico.");
  const digits = adAccountDigits(client.metaAdAccountId);
  if (!digits) throw new AdsHistoryError(400, "NO_AD_ACCOUNT", "Este cliente não tem uma conta de anúncios válida cadastrada.");
  const start = validateStartDate(input.startDate, saoPauloDateOnly(deps.now()));
  if (!start.ok) throw new AdsHistoryError(400, "VALIDATION_ERROR", start.message);
  if (!deps.bigQueryAvailable()) throw new AdsHistoryError(503, "BIGQUERY_UNAVAILABLE", "O BigQuery não está disponível neste ambiente.");

  const bq = await deps.bigQuery();
  // Confere o estado de novo no servidor: o botão pode estar velho na tela de quem clicou.
  const view = buildHistoryView({ ...(await readAdsHistory(bq, digits)), now: deps.now() });
  if (!view.canRequest) throw new AdsHistoryError(409, "ALREADY_IN_PROGRESS", WAIT_MESSAGES[view.phase] ?? "Já há um pedido em andamento para esta conta.");

  await insertHistoryRequest(bq, { adAccountDigits: digits, requestedBy: input.requestedBy, startDate: start.value });
  // Garante que a conta esteja na lista de coleta diária (renovada de hora em hora pelo job; aqui só adianta). Nunca derruba o pedido.
  await deps.publishAccounts();
  return { requested: true, startDate: start.value };
}
