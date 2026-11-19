import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  results: [] as unknown[],
  bq: vi.fn(),
  ads: vi.fn(),
}));
vi.mock("@workspace/db", async () => {
  const schema = await import("../../../lib/db/src/schema");
  return {
    ...schema,
    db: {
      select: () => {
        const chain: Record<string, unknown> = {};
        for (const method of ["from", "where", "orderBy", "groupBy"])
          chain[method] = () => chain;
        chain.then = (resolve: (v: unknown) => void) =>
          resolve(mocks.results.shift());
        return chain;
      },
    },
  };
});
vi.mock("../src/lib/bigquery", () => ({
  bigquery: { query: mocks.bq },
  vestiTable: (dataset: string, table: string) =>
    `\`project.${dataset}.${table}\``,
}));
vi.mock("../src/services/vesti-ads-stored", () => ({
  fetchStoredAdsDaily: mocks.ads,
  totalSpend: (rows: Array<{ spend: number }>) =>
    rows.reduce((s, r) => s + r.spend, 0),
}));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.results.length = 0;
});
describe("TV production data sources", () => {
  it("reads Vesti requested revenue from the canonical BigQuery view, paid commerce revenue from Postgres, and stored media", async () => {
    const clients = [
      {
        id: "vesti",
        name: "Wholesale",
        currency: "BRL",
        dashboardType: "B2B",
        commercePlatform: "VESTI",
        bigqueryDataset: "loja_vesti",
        metaAdAccountId: "act_1",
      },
      {
        id: "shop",
        name: "Retail",
        currency: "BRL",
        dashboardType: "B2C",
        commercePlatform: "MANUAL",
        metaAdAccountId: "act_2",
      },
    ];
    mocks.results.push(
      clients,
      [],
      clients,
      [
        { clientId: "vesti", date: "2026-11-18", requested: 99999, paid: 1 },
        { clientId: "shop", date: "2026-11-18", requested: 900, paid: 200 },
      ],
      [],
    );
    mocks.bq.mockResolvedValueOnce([
      [{ date: "2026-11-18", requested: 1000, paid: 100 }],
    ]);
    mocks.ads
      .mockResolvedValueOnce([{ spend: 100 }])
      .mockResolvedValueOnce([{ spend: 50 }]);
    const { getTvSnapshot } = await import("../src/services/tv-dashboard");
    const data = await getTvSnapshot(new Date("2026-11-18T04:00:00Z"));
    expect(data?.total).toEqual([
      { currency: "BRL", revenue: 1200, investment: 150, mer: 8 },
    ]);
    expect(data?.revenueTrend?.reduce((sum, day) => sum + day.total, 0)).toBe(
      1200,
    );
    expect(mocks.bq.mock.calls[0][0].query).toContain("dashboard_vendas_view");
    expect(mocks.bq.mock.calls[0][0].query).toContain("valor_solicitado");
    expect(data?.dateFrom).toBe("2026-01-01");
    expect(data?.dateTo).toBe("2026-11-18");
    expect(data?.revenueTrend).toHaveLength(322);
    expect(data?.revenueTrend?.[0].date).toBe("2026-01-01");
    expect(mocks.bq.mock.calls[0][0].params).toEqual({
      dateFrom: "2026-01-01",
      dateTo: "2026-11-18",
    });
    expect(mocks.ads.mock.calls).toEqual([
      ["act_1", "2026-01-01", "2026-11-18"],
      ["act_2", "2026-01-01", "2026-11-18"],
    ]);
  });
});
