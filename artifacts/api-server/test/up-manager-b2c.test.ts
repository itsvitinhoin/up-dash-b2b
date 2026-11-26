import { describe, expect, it } from "vitest";
import {
  buildAbc,
  catalogSnapshot,
  compareCatalog,
  sellableInventory,
} from "../src/services/up-manager-b2c-products";

const catalog = [
  {
    id: 12,
    name: "Vestido",
    published: true,
    attributes: ["Tamanho"],
    variants: [
      { id: 1, stock: 2, price: "100", promotional_price: "75", values: ["M"] },
      { id: 2, stock: 0, price: "100", values: ["P"] },
      {
        id: 3,
        stock: 10,
        stock_management: false,
        price: "100",
        values: ["G"],
      },
    ],
  },
  {
    id: 13,
    name: "Saia fora da vitrine",
    published: false,
    variants: [{ id: 4, stock: 20, price: "100" }],
  },
];

describe("B2C para moda", () => {
  it("usa preço promocional vigente, exclui estoque inativo e registra cobertura parcial", () => {
    expect(sellableInventory(catalogSnapshot(catalog))).toEqual({
      pricedValue: 150,
      countedUnits: 2,
      sellableVariants: 1,
      unknownVariants: 1,
    });
    expect(sellableInventory(null)).toBeNull();
  });

  it("mede ruptura de grade pela venda do SKU esgotado e mantém demanda desconhecida", () => {
    const sales = (
      id: string,
      externalId: string,
      units: number,
      revenue: number,
    ) => ({
      id,
      externalId,
      units,
      revenue,
      sku: id,
      name: id,
      color: null,
      size: null,
    });
    const windows = buildAbc(
      14,
      [
        sales("a", "12:2", 7, 700),
        sales("b", "12:1", 2, 200),
        sales("c", "12:3", 1, 100),
        sales("d", "13:4", 1, 100),
      ],
      [],
      catalog,
      { a: 0.8, b: 0.95 },
    );
    expect(windows.products[0]).toMatchObject({
      abc: "A",
      grade: "broken",
      demandAtRiskShare: 0.7,
      unmatchedDemandUnits: 1,
      outOfStockVariants: [{ label: "P", units: 7 }],
    });
    expect(windows.products[1]).toMatchObject({
      abc: "B",
      grade: "hidden",
      demandAtRiskShare: null,
    });
  });

  it("compara preço e reposição sem converter observação ausente em alteração", () => {
    const base = catalogSnapshot(catalog);
    const after = base.map((item) =>
      item.key === "12:2" ? { ...item, stock: 5, promotion: 80 } : item,
    );
    expect(compareCatalog(after, null)).toBeNull();
    expect(compareCatalog(after, base)).toMatchObject([
      {
        key: "12:2",
        changed: ["Preço promocional alterado", "Variante reabastecida"],
      },
    ]);
  });
});

describe("alertas de grade do UP Agent", () => {
  it("inclui todo produto publicado com uma opção esgotada, mesmo com estoque desconhecido em outra opção", async () => {
    const { buildGradeFindings } =
      await import("../src/services/up-manager-grade");
    const observations = catalogSnapshot(catalog);
    const alerts = buildGradeFindings(
      observations,
      buildAbc(14, [], [], catalog, { a: 0.8, b: 0.95 }),
      {
        snapshot: null,
        stale: true,
      },
      "2026-11-23T14:00:00Z",
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      id: "grade:12",
      priority: "P2",
      grade: {
        missing: [{ id: "12:2", label: "P" }],
        unknownVariants: 1,
        confirmedOutOfStock: false,
        campaignCount: 0,
      },
    });
  });
});
