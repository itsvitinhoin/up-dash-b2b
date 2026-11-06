import { describe, expect, it } from "vitest";
import {
  aggregateGa4Rows,
  dayRange,
  diffDays,
  earlierDate,
  fillGa4Days,
  isGa4StoreUsable,
  isWideGa4Window,
  shouldRefundBackfillSlot,
  shouldStartGa4Client,
  resolveGa4SyncWindow,
  saoPauloDate,
  shiftDate,
  toStoredProductViews,
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

  describe("retomada depois de job parado (lastStoredDay)", () => {
    const later = new Date("2026-11-06T15:00:00.000Z");

    it("recomeça no último dia guardado (menos o recuo), sem deixar buraco no meio", () => {
      // Caso real: Giah/Jini pararam em 20/10 e o job voltou em 06/11.
      const { from, to } = resolveGa4SyncWindow({ hasHistory: true, now: later, lastStoredDay: "2026-10-20" });
      expect(to).toBe("2026-11-06");
      expect(from).toBe("2026-10-18");
    });

    it("job em dia continua olhando só os últimos 3 dias", () => {
      expect(resolveGa4SyncWindow({ hasHistory: true, now: later, lastStoredDay: "2026-11-06" })).toEqual({
        from: "2026-11-04",
        to: "2026-11-06",
      });
    });

    it("nunca passa do tamanho do backfill", () => {
      const { from, to } = resolveGa4SyncWindow({ hasHistory: true, now: later, lastStoredDay: "2020-01-01" });
      expect(dayRange(from, to)).toHaveLength(400);
    });

    it("sem histórico ignora lastStoredDay e faz o backfill largo", () => {
      const { from, to } = resolveGa4SyncWindow({ hasHistory: false, now: later, lastStoredDay: "2026-10-20" });
      expect(dayRange(from, to)).toHaveLength(400);
    });

    it("LOOKBACK_DAYS explícito vence também aqui", () => {
      expect(
        resolveGa4SyncWindow({ hasHistory: true, now: later, lastStoredDay: "2026-10-20", lookbackDays: 2 }),
      ).toEqual({ from: "2026-11-05", to: "2026-11-06" });
    });
  });
});

describe("backfill em lote com limite", () => {
  it("janela de até 31 dias é curta; acima disso é larga", () => {
    expect(isWideGa4Window("2026-10-07", "2026-11-06")).toBe(false); // 31 dias
    expect(isWideGa4Window("2026-10-06", "2026-11-06")).toBe(true); // 32 dias
    expect(isWideGa4Window("2026-11-04", "2026-11-06")).toBe(false);
    expect(isWideGa4Window("2025-10-03", "2026-11-06")).toBe(true);
  });

  const base = { elapsedMs: 0, budgetMs: 8 * 60_000, wideStarted: 0, maxWide: 3 };

  it("cliente em dia sempre roda, mesmo sem tempo e depois do limite", () => {
    expect(shouldStartGa4Client({ ...base, wide: false, elapsedMs: 99 * 60_000, wideStarted: 99 })).toEqual({ start: true });
  });

  it("backfill largo roda enquanto há tempo e vaga", () => {
    expect(shouldStartGa4Client({ ...base, wide: true })).toEqual({ start: true });
    expect(shouldStartGa4Client({ ...base, wide: true, wideStarted: 2, elapsedMs: 7 * 60_000 })).toEqual({ start: true });
  });

  it("backfill largo é adiado quando o tempo da rodada acabou (protege o limite de 15 min do job)", () => {
    expect(shouldStartGa4Client({ ...base, wide: true, elapsedMs: 8 * 60_000 + 1 })).toEqual({ start: false, reason: "tempo" });
  });

  it("e quando já começaram N backfills nesta rodada", () => {
    expect(shouldStartGa4Client({ ...base, wide: true, wideStarted: 3 })).toEqual({ start: false, reason: "limite" });
  });
});

describe("shouldRefundBackfillSlot (quem falha logo não ocupa vaga)", () => {
  it("backfill largo que falha em poucos segundos (sem acesso) devolve a vaga", () => {
    expect(shouldRefundBackfillSlot({ wide: true, failed: true, elapsedMs: 2_000 })).toBe(true);
  });
  it("falha depois de trabalhar muito (30 s ou mais) NÃO devolve: gastou tempo da rodada", () => {
    expect(shouldRefundBackfillSlot({ wide: true, failed: true, elapsedMs: 30_000 })).toBe(false);
    expect(shouldRefundBackfillSlot({ wide: true, failed: true, elapsedMs: 120_000 })).toBe(false);
  });
  it("cliente em dia (janela curta) não tem vaga para devolver, e sucesso nunca devolve", () => {
    expect(shouldRefundBackfillSlot({ wide: false, failed: true, elapsedMs: 1_000 })).toBe(false);
    expect(shouldRefundBackfillSlot({ wide: true, failed: false, elapsedMs: 1_000 })).toBe(false);
  });
  it("simulação da fila real: com 3 sem acesso à frente, os 3 da frente que funcionam ainda entram", () => {
    const queue = [
      { name: "Aiyu", works: false },
      { name: "Coqueta", works: true },
      { name: "Hot Pink", works: false },
      { name: "Incentive", works: true },
      { name: "Sonmur", works: false },
      { name: "Sooe", works: true },
      { name: "Vn11", works: true },
      { name: "Vogabox", works: true },
    ];
    let wideStarted = 0;
    const done: string[] = [];
    for (const client of queue) {
      if (!shouldStartGa4Client({ wide: true, elapsedMs: 0, budgetMs: 8 * 60_000, wideStarted, maxWide: 3 }).start) continue;
      wideStarted += 1;
      if (client.works) done.push(client.name);
      else if (shouldRefundBackfillSlot({ wide: true, failed: true, elapsedMs: 2_000 })) wideStarted -= 1;
    }
    expect(done).toEqual(["Coqueta", "Incentive", "Sooe"]);
  });
});

describe("diffDays / earlierDate", () => {
  it("conta dias corridos atravessando mês e ano", () => {
    expect(diffDays("2026-10-20", "2026-11-06")).toBe(17);
    expect(diffDays("2025-12-31", "2026-01-01")).toBe(1);
    expect(diffDays("2026-03-01", "2026-03-01")).toBe(0);
  });
  it("escolhe a data mais antiga", () => {
    expect(earlierDate("2026-10-18", "2025-09-16")).toBe("2025-09-16");
    expect(earlierDate("2026-10-18", "2026-10-18")).toBe("2026-10-18");
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

describe("toStoredProductViews", () => {
  it("troca null por '' e soma itens que só diferem por espaço", () => {
    const rows = toStoredProductViews([
      { date: "2026-10-20", itemId: "A1", itemName: "Vestido", itemVariant: null, views: 5 },
      { date: "2026-10-20", itemId: "A1 ", itemName: "Vestido", itemVariant: "", views: 3 },
      { date: "2026-10-20", itemId: null, itemName: null, itemVariant: null, views: 2 },
      { date: "2026-10-19", itemId: "A1", itemName: "Vestido", itemVariant: null, views: 1 },
    ]);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.metricDate === "2026-10-20" && r.itemId === "A1")?.views).toBe(8);
    expect(rows.find((r) => r.itemId === "" && r.itemName === "")?.views).toBe(2);
  });
});
