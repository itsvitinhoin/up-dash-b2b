import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BlingApi,
  BlingError,
  blingConfig,
  exchangeBlingToken,
  openTokens,
  sealTokens,
} from "../src/services/bling-api";
import {
  normalizeBling,
  normalizeBlingStock,
} from "../src/services/bling-normalize";

beforeEach(() => {
  vi.stubEnv("BLING_TOKEN_ENCRYPTION_KEY", "ab".repeat(32));
  vi.stubEnv("BLING_CLIENT_ID", "test-app");
  vi.stubEnv("BLING_CLIENT_SECRET", "test-secret");
  vi.stubEnv("BLING_REDIRECT_URI", "https://dash.example/api/bling/callback");
});
afterEach(() => vi.unstubAllEnvs());

describe("Bling credentials and transport", () => {
  it("encrypts rotating tokens and rejects tampered ciphertext or wrong keys", () => {
    const tokens = {
      accessToken: "sensitive-access",
      refreshToken: "sensitive-refresh",
    };
    const encrypted = sealTokens(tokens);
    expect(encrypted).not.toContain("sensitive");
    expect(sealTokens(tokens)).not.toBe(encrypted);
    expect(openTokens(encrypted)).toEqual(tokens);
    const [iv, tag, body] = encrypted.split(".");
    const changed = Buffer.from(body, "base64url");
    changed[0] ^= 1;
    expect(() =>
      openTokens(`${iv}.${tag}.${changed.toString("base64url")}`),
    ).toThrow(BlingError);
    vi.stubEnv("BLING_TOKEN_ENCRYPTION_KEY", "cd".repeat(32));
    expect(() => openTokens(encrypted)).toThrow(BlingError);
  });
  it("requires deployment configuration and a fixed callback", () => {
    vi.stubEnv(
      "BLING_REDIRECT_URI",
      "http://external.example/api/bling/callback",
    );
    expect(() => blingConfig()).toThrow();
    vi.stubEnv(
      "BLING_REDIRECT_URI",
      "https://dash.example/api/bling/callback?next=evil",
    );
    expect(() => blingConfig()).toThrow();
  });
  it.each([{ code: "one-time" }, { refreshToken: "rotating" }])(
    "requests JWT for both OAuth grants: %j",
    async (grant) => {
      const fetcher = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              access_token: "jwt",
              refresh_token: "new-refresh",
              expires_in: 21600,
            }),
          ),
      );
      const tokens = await exchangeBlingToken(grant, fetcher);
      const options = fetcher.mock.calls[0][1] as RequestInit;
      expect(options.headers).toMatchObject({ "enable-jwt": "1" });
      expect(options.body).toBeInstanceOf(URLSearchParams);
      expect(tokens.refreshToken).toBe("new-refresh");
    },
  );
  it("allows only read endpoints and never follows provider redirects", async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ data: [] })),
    );
    const api = new BlingApi("secret", async () => 0, fetcher);
    await expect(api.get("https://untrusted.example")).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    await api.list("/pedidos/vendas", new URLSearchParams({ pagina: "1" }));
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      method: "GET",
      redirect: "error",
      headers: { "enable-jwt": "1" },
    });
  });
  it.each([401, 403, 429, 500])(
    "returns actionable errors without exposing provider payloads (%i)",
    async (status) => {
      const api = new BlingApi(
        "secret",
        async () => 0,
        async () => new Response("private token customer payload", { status }),
      );
      await expect(api.get("/produtos")).rejects.toThrow(BlingError);
      await expect(api.get("/produtos")).rejects.not.toThrow("private");
    },
  );
  it("does not accept malformed successful responses as empty catalogues", async () => {
    const api = new BlingApi(
      "secret",
      async () => 0,
      async () => new Response(JSON.stringify({ error: true })),
    );
    await expect(
      api.list("/produtos", new URLSearchParams()),
    ).rejects.toThrow();
  });
});

describe("Bling normalization", () => {
  const order = {
    id: 31,
    numero: 5,
    numeroLoja: "1001",
    data: "2026-11-18",
    total: 99.9,
    totalProdutos: 90,
    loja: { id: 10 },
    contato: { id: 2, nome: "Ana", numeroDocumento: "11122233344" },
    situacao: { id: 99, valor: 12 },
    itens: [
      {
        id: 44,
        codigo: "SKU-M",
        descricao: "Camiseta",
        quantidade: 2,
        valor: 45,
      },
    ],
  };
  it("preserves channel, store number, raw status and item quantities without inventing payment or attribution", () => {
    const data = normalizeBling("orders", order);
    expect(data).toMatchObject({
      channelId: "10",
      storeNumber: "1001",
      statusId: "99",
      statusValue: "12",
      total: 99.9,
      items: [{ quantity: 2, unitPrice: 45 }],
    });
    expect(data).not.toHaveProperty("paid");
    expect(JSON.stringify(data)).not.toContain("11122233344");
  });
  it("keeps unidentified channels explicit and rejects missing totals, dates and detailed items", () => {
    expect(normalizeBling("orders", { ...order, loja: {} }).channelId).toBe(
      "unassigned",
    );
    for (const invalid of [
      { total: null },
      { data: "2026-02-31" },
      { itens: null },
    ])
      expect(() =>
        normalizeBling("orders", { ...order, ...invalid }),
      ).toThrow();
  });
  it("preserves physical and reserved stock by warehouse, including negatives", () => {
    expect(
      normalizeBlingStock({
        saldoFisicoTotal: 10,
        saldoVirtualTotal: -2,
        depositos: [{ id: 5, saldoFisico: 10, saldoVirtual: -2 }],
      }),
    ).toEqual({
      physical: 10,
      available: -2,
      warehouses: [{ id: "5", physical: 10, available: -2 }],
    });
    expect(() =>
      normalizeBlingStock({
        saldoFisicoTotal: null,
        saldoVirtualTotal: 0,
        depositos: [],
      }),
    ).toThrow();
  });
});
