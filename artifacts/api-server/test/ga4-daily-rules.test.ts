import { describe, expect, it } from "vitest";
import {
  aggregateGa4Rows,
  dayRange,
  fillGa4Days,
  isGa4StoreUsable,
  resolveGa4SyncWindow,
  saoPauloDate,
  shiftDate,
} from "../src/services/ga4-daily-rules";

const day = (date: string, sessions: number) => ({
  date,
  sessions,
  pageViews: sessions * 2,
  productViews: 0,
  addToCarts: 0,
  checkouts: 0,
  purchases: 0,
});

describe("saoPauloDate", () => {
  it("à noite em SP ainda é o mesmo dia, mesmo já sendo o dia seguinte em UTC", () => {
    expect(saoPauloDate(new Date("2026-10-21T01:30:00.000Z"))).toBe("2026-10-20");
  });
  it("de manhã em SP é o dia UTC", () => {
    expect(saoPauloDate(new Date("2026-10-20T13:00:00.000Z"))).toBe("2026-10-20");
  });
});

describe("shiftDate / dayRange", () => {
  it("atravessa virada de mês e de ano", () => {
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDate("2026-01-01", -1)).toBe("2025-12-31");
  });
  it("lista os dias inclusive nas duas pontas", () => {
    expect(dayRange("2026-10-18", "2026-10-20")).toEqual(["2026-10-18", "2026-10-19", "2026-10-20"]);
    expect(dayRange("2026-10-20", "2026-10-20")).toEqual(["2026-10-20"]);
  });
});

describe("resolveGa4SyncWindow", () => {
  const now = new Date("2026-10-20T15:00:00.000Z");

  it("com histórico guardado busca só os últimos 3 dias (hoje incluso)", () => {
    expect(resolveGa4SyncWindow({ hasHistory: true, now })).toEqual({
      from: "2026-10-18",
      to: "2026-10-20",
    });
  });

  it("sem histórico faz o backfill largo de 400 dias", () => {
    const { from, to } = resolveGa4SyncWindow({ hasHistory: false, now });
    expect(to).toBe("2026-10-20");
    expect(dayRange(from, to)).toHaveLength(400);
  });

  it("LOOKBACK_DAYS explícito vence o padrão, com ou sem histórico", () => {
    expect(resolveGa4SyncWindow({ hasHistory: true, now, lookbackDays: 10 }).from).toBe("2026-10-11");
    expect(resolveGa4SyncWindow({ hasHistory: false, now, lookbackDays: 1 })).toEqual({
      from: "2026-10-20",
      to: "2026-10-20",
    });
  });
});

describe("fillGa4Days", () => {
  it("completa com zero os dias sem tráfego, mantendo os que vieram do GA4", () => {
    const rows = fillGa4Days("2026-10-18", "2026-10-20", [day("2026-10-19", 50)]);
    expect(rows.map((r) => [r.date, r.sessions])).toEqual([
      ["2026-10-18", 0],
      ["2026-10-19", 50],
      ["2026-10-20", 0],
    ]);
    expect(rows[1].pageViews).toBe(100);
  });

  it("ignora dia que o GA4 devolveu fora da janela pedida", () => {
    const rows = fillGa4Days("2026-10-19", "2026-10-20", [day("2026-10-01", 9), day("2026-10-20", 3)]);
    expect(rows.map((r) => r.date)).toEqual(["2026-10-19", "2026-10-20"]);
    expect(rows.reduce((s, r) => s + r.sessions, 0)).toBe(3);
  });

  it("GA4 sem nenhum dia ainda gera uma linha zerada por dia (marca 'já sincronizou')", () => {
    expect(fillGa4Days("2026-10-19", "2026-10-20", [])).toHaveLength(2);
  });
});

describe("aggregateGa4Rows", () => {
  it("soma os dias do período no mesmo formato do funil ao vivo", () => {
    const funnel = aggregateGa4Rows([
      { date: "2026-10-19", sessions: 100, pageViews: 300, productViews: 40, addToCarts: 10, checkouts: 5, purchases: 2 },
      { date: "2026-10-20", sessions: 50, pageViews: 120, productViews: 20, addToCarts: 4, checkouts: 3, purchases: 1 },
    ]);
    expect(funnel).toEqual({
      sessions: 150,
      pageViews: 420,
      productViews: 60,
      addToCarts: 14,
      checkouts: 8,
      purchases: 3,
      source: "ga4",
    });
  });
  it("sem dias devolve tudo zero, ainda marcado como ga4", () => {
    expect(aggregateGa4Rows([])).toMatchObject({ sessions: 0, source: "ga4" });
  });
});

describe("isGa4StoreUsable", () => {
  const now = new Date("2026-10-20T15:00:00.000Z");
  const recent = new Date("2026-10-20T14:00:00.000Z");

  it("serve quando cobre o início do período e foi atualizado há pouco", () => {
    expect(isGa4StoreUsable({ earliestDate: "2025-09-16", latestSyncedAt: recent, dateFrom: "2026-09-21", now })).toBe(true);
  });
  it("não serve se o período começa antes do que foi guardado (somaria só parte)", () => {
    expect(isGa4StoreUsable({ earliestDate: "2025-09-16", latestSyncedAt: recent, dateFrom: "2025-01-01", now })).toBe(false);
  });
  it("não serve se o job parou há mais de 48h (melhor o ao vivo que número velho)", () => {
    const old = new Date("2026-10-17T15:00:00.000Z");
    expect(isGa4StoreUsable({ earliestDate: "2025-09-16", latestSyncedAt: old, dateFrom: "2026-09-21", now })).toBe(false);
  });
  it("sem histórico nenhum não serve", () => {
    expect(isGa4StoreUsable({ earliestDate: null, latestSyncedAt: null, dateFrom: "2026-09-21", now })).toBe(false);
  });
});
