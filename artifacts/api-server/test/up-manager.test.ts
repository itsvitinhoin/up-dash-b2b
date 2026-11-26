import { afterEach, describe, expect, it, vi } from "vitest";
import { managerClientIds, isUpManagerPilot } from "../src/services/up-manager-config";
import { rankManagerProducts } from "../src/services/up-manager";
import { pauseManagerAd } from "../src/services/up-manager-actions";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Up Manager catalog", () => {
  it("agrega SKUs Braavo pelo produto de origem mantendo vendas e estoque por variante", () => {
    const products = rankManagerProducts([
      { id: "row-1", externalId: "braavo:302:401", name: "Vestido", sku: "a", color: "Preto", size: "P", units: 5, revenue: 100 },
      { id: "row-2", externalId: "braavo:302:402", name: "Vestido", sku: "b", color: "Preto", size: "M", units: 2, revenue: 40 },
    ], [{ id: "braavo:302", name: "Vestido", attributes: ["Cor", "Tamanho"], variants: [
      { id: "401", stock: 3, values: ["Preto", "P"] }, { id: "402", stock: 0, values: ["Preto", "M"] },
    ] }]);
    expect(products).toMatchObject([{ id: "braavo:302", units: 7, stock: 3, variants: [
      { size: "P", stock: 3, units: 5 }, { size: "M", stock: 0, units: 2 },
    ] }]);
  });

  it("limita as marcas à configuração e mantém o piloto original como padrão", () => {
    vi.stubEnv("PRODUCT_CAMPAIGN_REVIEW_CLIENT_ID", "aiyu");
    vi.stubEnv("UP_MANAGER_CLIENT_IDS", "");
    expect(managerClientIds()).toEqual(["aiyu"]);
    vi.stubEnv("UP_MANAGER_CLIENT_IDS", " aiyu, peo, viva,peo ");
    expect(managerClientIds()).toEqual(["aiyu", "peo", "viva"]);
    expect(isUpManagerPilot("another")).toBe(false);
  });

  it("uses variant IDs, keeps the size and color from the catalog, and distinguishes unknown stock", () => {
    const products = rankManagerProducts(
      [
        {
          id: "variant-1",
          externalId: "105:12",
          sku: "sku-1",
          name: "Vestido",
          color: "P",
          size: "Azul",
          units: 7,
          revenue: 70,
        },
        {
          id: "orphan",
          externalId: "105",
          sku: "shared",
          name: "Vestido",
          color: null,
          size: null,
          units: 2,
          revenue: 20,
        },
      ],
      [
        {
          id: 105,
          name: "Vestido",
          attributes: [{ pt: "Tamanhos" }, { pt: "Cores" }],
          variants: [
            { id: 12, stock: 0, values: ["P", "Azul"] },
            {
              id: 13,
              stock: 12,
              stock_management: false,
              values: ["M", "Azul"],
            },
          ],
        },
      ],
    );
    expect(products[0]).toMatchObject({
      id: "105",
      units: 9,
      stock: null,
      variants: [
        {
          id: "12",
          size: "P",
          color: "Azul",
          current: true,
          units: 7,
          stock: 0,
        },
        {
          id: "13",
          size: "M",
          color: "Azul",
          current: true,
          units: 0,
          stock: null,
        },
        { id: "historical:orphan", current: false, units: 2, stock: null },
      ],
    });
  });
});

describe("confirmed Meta action", () => {
  const request = {
    adId: "135",
    accountId: "act_200",
    accessToken: "local-test-token",
  };
  const active = {
    id: "135",
    account_id: "200",
    status: "ACTIVE",
    effective_status: "ACTIVE",
  };
  it("keeps the Meta write out of another account or non-active ad", async () => {
    const mock = vi
      .fn()
      .mockResolvedValue(Response.json({ ...active, account_id: "201" }));
    vi.stubGlobal("fetch", mock);
    expect(await pauseManagerAd(request)).toBe("stale");
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it("posts PAUSED at ad level and confirms the remote state even if the write response is lost", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(active))
      .mockRejectedValueOnce(new Error("lost response"))
      .mockResolvedValueOnce(Response.json({ ...active, status: "PAUSED" }));
    vi.stubGlobal("fetch", mock);
    expect(await pauseManagerAd(request)).toBe("paused");
    expect(mock.mock.calls[1][0].pathname).toMatch(/\/135$/);
    expect(mock.mock.calls[1][1].method).toBe("POST");
    expect(mock.mock.calls[1][1].body.get("status")).toBe("PAUSED");
  });
});
