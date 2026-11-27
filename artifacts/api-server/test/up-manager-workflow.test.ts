import { expect, it } from "vitest";
import { compareFollowup, followupWindows, managerWeek, startFollowupSchema } from "../src/services/up-manager-workflow";

it("fecha a semana no domingo e abre a semana seguinte na segunda", () => {
  expect(managerWeek("2026-11-22")).toEqual({ dateFrom: "2026-11-16", dateTo: "2026-11-22" });
  expect(managerWeek("2026-11-23")).toEqual({ dateFrom: "2026-11-23", dateTo: "2026-11-29" });
});

it("mede duas janelas de sete dias sem incluir o dia da execução", () => {
  expect(followupWindows("2026-11-23")).toEqual({
    before: { dateFrom: "2026-11-16", dateTo: "2026-11-22" },
    after: { dateFrom: "2026-11-24", dateTo: "2026-11-30" },
    measureOn: "2026-12-04",
  });
});

it("trata CAC menor como melhora e separa movimento de meta atingida", () => {
  expect(compareFollowup(50, 40, "cac", 45, false)).toEqual({ status: "improved", targetReached: true });
  expect(compareFollowup(2, 2.5, "roas", 3, false)).toEqual({ status: "improved", targetReached: false });
  expect(compareFollowup(2, 3, "roas", 3, true)).toEqual({ status: "mixed", targetReached: true });
  expect(compareFollowup(null, 4, "roas", 3, false)).toEqual({ status: "insufficient", targetReached: null });
  expect(compareFollowup(45, 45.8, "checkout", 44, false)).toEqual({ status: "stable", targetReached: true });
});

it("valida meta de taxa e quantidade de compras", () => {
  const base = { insightId: "funnel-bottleneck", note: "Ajuste aplicado" };
  expect(startFollowupSchema.safeParse({ ...base, metric: "checkout", target: 101 }).success).toBe(false);
  expect(startFollowupSchema.safeParse({ ...base, metric: "purchases", target: 1.7 }).success).toBe(false);
  expect(startFollowupSchema.safeParse({ ...base, metric: "cac", target: 19.7 }).success).toBe(true);
});
