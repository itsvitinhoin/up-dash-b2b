// Histórico de anúncios no painel (botão "Buscar histórico" e status no diálogo Meta): regras puras, sem banco nem BigQuery.
//
// O painel e o backend-dash conversam só pelo BigQuery (up_global), sem chave nova:
//   ads_backfill_requests  o DASH escreve o pedido; o backend-dash (job ads-onboarding) lê e atende
//   ads_backfill_status    o BACKEND-DASH escreve o estado de cada conta; o dash só lê
// As regras de "pedido já atendido" e de "execução travada" espelham as de backend-dash/src/lib/adsOnboardingRules.ts: se uma mudar, a outra muda.
import { normalizeAdAccountId } from "./ads-accounts-list";

export const ADS_HISTORY_DATASET = "up_global";
export const ADS_REQUESTS_TABLE = "ads_backfill_requests";
export const ADS_STATUS_TABLE = "ads_backfill_status";
/** As tabelas de insights só aceitam consulta com filtro de data; nada de interesse existe antes disso. */
export const ADS_HISTORY_MIN_DATE = "2023-01-01";
/** "running" sem atualização há mais que isso é execução que travou: o backend retoma sozinho. */
export const RUNNING_STALE_MS = 2 * 60 * 60 * 1000;

export type HistoryState = "pending" | "running" | "done" | "partial" | "failed";
const STATES: HistoryState[] = ["pending", "running", "done", "partial", "failed"];

export type HistoryStatusRow = {
  state: HistoryState;
  attempts: number;
  /** Pedido que gerou este estado (null = conta nova detectada sozinha). */
  requestedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  startDate: string | null;
  endDate: string | null;
  resumeFrom: string | null;
  rowsAd: number | null;
  rowsAccount: number | null;
  error: string | null;
  updatedAt: string | null;
};

export type HistoryRequestRow = { requestedAt: string; startDate: string | null; requestedBy: string | null };
export type HistoryCoverage = { firstDay: string | null; lastDay: string | null; days: number };

export type HistoryPhase = "none" | "queued" | "running" | "waiting" | "done" | "partial" | "failed";
export type HistoryErrorKind = "rate_limit" | "permission" | "other";

export type HistoryView = {
  phase: HistoryPhase;
  /** O botão "Buscar histórico" pode ser usado agora. */
  canRequest: boolean;
  /** O Facebook recusou a leitura por falta de permissão: o cliente precisa compartilhar a conta com a Up. */
  permissionProblem: boolean;
  status: HistoryStatusRow | null;
  request: HistoryRequestRow | null;
  coverage: HistoryCoverage;
};

/** "act_123" -> "123" (a forma que as duas tabelas guardam). Inválida = null. */
export function adAccountDigits(raw: string | null | undefined): string | null {
  const normalized = normalizeAdAccountId(raw);
  return normalized ? normalized.slice(4) : null;
}

export function isHistoryState(value: unknown): value is HistoryState {
  return typeof value === "string" && (STATES as string[]).includes(value);
}

/** O Facebook limita chamadas (17, 4, 32, 613); 200 = o dono da conta não deu permissão ao token. */
export function classifyHistoryError(message: string | null | undefined): HistoryErrorKind {
  const text = String(message ?? "");
  if (/\((?:4|17|32|613)\)|request limit reached|rate limit|too many calls/i.test(text)) return "rate_limit";
  if (/\(200\)|#200|has not grant|ads_management or ads_read|permission/i.test(text)) return "permission";
  return "other";
}

const time = (iso: string | null): number | null => {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? null : parsed;
};

/** Há pedido que o backend ainda não atendeu? O estado guarda o requested_at do pedido que atendeu; pedido mais novo que ele está em aberto. */
export function hasOpenRequest(status: HistoryStatusRow | null, request: HistoryRequestRow | null): boolean {
  if (!request) return false;
  const requestedAt = time(request.requestedAt);
  if (requestedAt === null) return false;
  const served = time(status?.requestedAt ?? null);
  return served === null || served < requestedAt;
}

export function buildHistoryView(input: {
  status: HistoryStatusRow | null;
  request: HistoryRequestRow | null;
  coverage: HistoryCoverage;
  now: Date;
}): HistoryView {
  const { status, request, coverage, now } = input;
  const runningFresh = status?.state === "running" && (() => {
    const updated = time(status.updatedAt);
    return updated !== null && now.getTime() - updated < RUNNING_STALE_MS;
  })();

  let phase: HistoryPhase;
  if (runningFresh) phase = "running";
  else if (hasOpenRequest(status, request)) phase = "queued";
  else if (!status) phase = "none";
  else if (status.state === "running") phase = "queued"; // travou: o backend retoma na próxima execução
  else if (status.state === "pending") phase = "waiting"; // parou pelo limite de chamadas do Facebook: volta sozinho
  else phase = status.state;

  const permissionProblem = Boolean(status && (status.state === "failed" || status.state === "partial") && classifyHistoryError(status.error) === "permission");
  return {
    phase,
    canRequest: phase === "none" || phase === "done" || phase === "partial" || phase === "failed",
    permissionProblem,
    status,
    request,
    coverage,
  };
}

/** Data de início opcional do pedido: AAAA-MM-DD, real, entre 2023-01-01 e hoje. Vazia = o backend usa o padrão (2025-01-01). */
export function validateStartDate(raw: unknown, today: string): { ok: true; value: string | null } | { ok: false; message: string } {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { ok: false, message: "A data de início precisa estar no formato AAAA-MM-DD." };
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) return { ok: false, message: "A data de início não existe no calendário." };
  if (raw < ADS_HISTORY_MIN_DATE) return { ok: false, message: `O histórico só pode começar a partir de ${ADS_HISTORY_MIN_DATE}.` };
  if (raw > today) return { ok: false, message: "A data de início não pode ser no futuro." };
  return { ok: true, value: raw };
}
