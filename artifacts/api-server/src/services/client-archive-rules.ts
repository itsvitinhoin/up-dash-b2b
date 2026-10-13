// Regras do arquivamento de clientes (puras, sem banco).
//
// Combinado com o time (13/10/2026): cliente que saiu NÃO é apagado na hora. Primeiro é ARQUIVADO: some do painel, sai das
// atualizações diárias e perde o acesso, mas os dados ficam guardados e dá para restaurar. Só depois de ARCHIVE_RETENTION_DAYS
// (90) a exclusão definitiva é liberada.

export const ARCHIVE_RETENTION_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

export type ArchivedListMode = "exclude" | "only" | "include";

/** `?archived=only|include` na listagem de clientes; qualquer outro valor (ou nenhum) esconde os arquivados. */
export function parseArchivedMode(value: unknown): ArchivedListMode {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "only" || raw === "include" ? raw : "exclude";
}

export type ArchiveInfo = {
  archived: boolean;
  archivedAt: Date | null;
  /** Dia a partir do qual a exclusão definitiva é liberada (arquivamento + retenção). */
  deletableFrom: Date | null;
  /** Dias que faltam para liberar a exclusão (0 = já liberada); null quando o cliente não está arquivado. */
  daysLeft: number | null;
  canDelete: boolean;
};

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function archiveInfo(
  archivedAtValue: Date | string | null | undefined,
  now: Date = new Date(),
  retentionDays: number = ARCHIVE_RETENTION_DAYS,
): ArchiveInfo {
  const archivedAt = toDate(archivedAtValue);
  if (!archivedAt) {
    return { archived: false, archivedAt: null, deletableFrom: null, daysLeft: null, canDelete: false };
  }
  const deletableFrom = new Date(archivedAt.getTime() + retentionDays * DAY_MS);
  const msLeft = deletableFrom.getTime() - now.getTime();
  const daysLeft = msLeft <= 0 ? 0 : Math.ceil(msLeft / DAY_MS);
  return { archived: true, archivedAt, deletableFrom, daysLeft, canDelete: daysLeft === 0 };
}

export type DeleteDecision =
  | { ok: true; early: boolean }
  | { ok: false; code: "NOT_ARCHIVED" | "NAME_MISMATCH" | "RETENTION_NOT_ELAPSED"; daysLeft?: number };

/**
 * Pode excluir de vez?
 * - só cliente arquivado;
 * - o nome digitado tem que ser igual ao do cliente (confirmação);
 * - antes dos 90 dias só com `force` (ex.: cliente de teste criado por engano) — e a resposta marca `early`.
 */
export function canDeleteClient(params: {
  archivedAt: Date | string | null | undefined;
  clientName: string;
  confirmName: string | null | undefined;
  force?: boolean;
  now?: Date;
}): DeleteDecision {
  const info = archiveInfo(params.archivedAt, params.now);
  if (!info.archived) return { ok: false, code: "NOT_ARCHIVED" };
  if ((params.confirmName ?? "").trim() !== params.clientName.trim() || !params.clientName.trim()) {
    return { ok: false, code: "NAME_MISMATCH" };
  }
  if (info.canDelete) return { ok: true, early: false };
  if (params.force) return { ok: true, early: true };
  return { ok: false, code: "RETENTION_NOT_ELAPSED", daysLeft: info.daysLeft ?? undefined };
}
