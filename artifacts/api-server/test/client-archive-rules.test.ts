import { describe, expect, it } from "vitest";
import {
  ARCHIVE_RETENTION_DAYS,
  archiveInfo,
  archivePurgeCutoff,
  canDeleteClient,
  parseArchivedMode,
} from "../src/services/client-archive-rules";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-10-13T12:00:00.000Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY);

describe("parseArchivedMode", () => {
  it("por padrão esconde os arquivados", () => {
    expect(parseArchivedMode(undefined)).toBe("exclude");
    expect(parseArchivedMode("")).toBe("exclude");
    expect(parseArchivedMode("qualquer coisa")).toBe("exclude");
  });
  it("aceita only e include (inclusive vindo como lista da query string)", () => {
    expect(parseArchivedMode("only")).toBe("only");
    expect(parseArchivedMode("include")).toBe("include");
    expect(parseArchivedMode(["only", "include"])).toBe("only");
  });
});

describe("archiveInfo", () => {
  it("cliente em uso não é arquivado e não pode ser excluído", () => {
    expect(archiveInfo(null, now)).toEqual({ archived: false, archivedAt: null, deletableFrom: null, daysLeft: null, canDelete: false });
    expect(archiveInfo(undefined, now).archived).toBe(false);
    expect(archiveInfo("data inválida", now).archived).toBe(false);
  });

  it("recém-arquivado: faltam 90 dias", () => {
    const info = archiveInfo(now, now);
    expect(info.archived).toBe(true);
    expect(info.daysLeft).toBe(ARCHIVE_RETENTION_DAYS);
    expect(info.canDelete).toBe(false);
    expect(info.deletableFrom?.getTime()).toBe(now.getTime() + 90 * DAY);
  });

  it("conta os dias que faltam arredondando para cima", () => {
    expect(archiveInfo(daysAgo(30), now).daysLeft).toBe(60);
    expect(archiveInfo(new Date(daysAgo(30).getTime() - 3_600_000), now).daysLeft).toBe(60); // 30 dias e 1 h: ainda falta 59,96 -> 60
    expect(archiveInfo(daysAgo(89), now).daysLeft).toBe(1);
  });

  it("aos 90 dias a exclusão é liberada e nunca fica negativo", () => {
    const exact = archiveInfo(daysAgo(90), now);
    expect(exact.daysLeft).toBe(0);
    expect(exact.canDelete).toBe(true);
    expect(archiveInfo(daysAgo(400), now).daysLeft).toBe(0);
  });

  it("aceita a data como texto ISO (vinda da API)", () => {
    expect(archiveInfo(daysAgo(10).toISOString(), now).daysLeft).toBe(80);
  });
});

describe("archivePurgeCutoff", () => {
  it("é agora menos 90 dias", () => {
    expect(archivePurgeCutoff(now).getTime()).toBe(now.getTime() - 90 * DAY);
  });

  it("bate com archiveInfo: arquivado até o corte já pode ser apagado, depois dele ainda não", () => {
    const cutoff = archivePurgeCutoff(now);
    expect(archiveInfo(cutoff, now).canDelete).toBe(true);
    expect(archiveInfo(new Date(cutoff.getTime() - 1), now).canDelete).toBe(true);
    expect(archiveInfo(new Date(cutoff.getTime() + 1), now).canDelete).toBe(false);
  });
});

describe("canDeleteClient", () => {
  const base = { clientName: "Marca X", confirmName: "Marca X", now };

  it("cliente em uso nunca é excluído", () => {
    expect(canDeleteClient({ ...base, archivedAt: null })).toEqual({ ok: false, code: "NOT_ARCHIVED" });
    expect(canDeleteClient({ ...base, archivedAt: null, force: true })).toEqual({ ok: false, code: "NOT_ARCHIVED" });
  });

  it("exige o nome digitado igual ao do cliente (ignora espaços nas pontas)", () => {
    expect(canDeleteClient({ ...base, archivedAt: daysAgo(120), confirmName: "marca x" })).toEqual({ ok: false, code: "NAME_MISMATCH" });
    expect(canDeleteClient({ ...base, archivedAt: daysAgo(120), confirmName: "" })).toEqual({ ok: false, code: "NAME_MISMATCH" });
    expect(canDeleteClient({ ...base, archivedAt: daysAgo(120), confirmName: undefined })).toEqual({ ok: false, code: "NAME_MISMATCH" });
    expect(canDeleteClient({ ...base, archivedAt: daysAgo(120), confirmName: "  Marca X  " })).toEqual({ ok: true, early: false });
  });

  it("antes dos 90 dias bloqueia e diz quantos dias faltam", () => {
    expect(canDeleteClient({ ...base, archivedAt: daysAgo(10) })).toEqual({ ok: false, code: "RETENTION_NOT_ELAPSED", daysLeft: 80 });
  });

  it("antes dos 90 dias só com force, e marca como exclusão antecipada", () => {
    expect(canDeleteClient({ ...base, archivedAt: daysAgo(10), force: true })).toEqual({ ok: true, early: true });
  });

  it("depois dos 90 dias libera sem force", () => {
    expect(canDeleteClient({ ...base, archivedAt: daysAgo(91) })).toEqual({ ok: true, early: false });
  });

  it("force não dispensa a confirmação do nome", () => {
    expect(canDeleteClient({ ...base, archivedAt: daysAgo(10), force: true, confirmName: "outro" })).toEqual({ ok: false, code: "NAME_MISMATCH" });
  });
});
