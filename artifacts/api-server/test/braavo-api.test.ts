import { describe, expect, it, vi } from "vitest";
import { BraavoApi, normalizeBraavoDomain } from "../src/services/braavo-api";

const credentials = {
  domain: "https://www.lacleo.com.br",
  apiToken: "test-token",
  apiKey: "test-key",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
function api(responses: Response[]) {
  const fetcher = vi.fn();
  responses.forEach((r) => fetcher.mockResolvedValueOnce(r));
  const reserveSlot = vi.fn().mockResolvedValue(0),
    sleep = vi.fn().mockResolvedValue(undefined);
  const resolve = vi.fn().mockResolvedValue([{ address: "203.0.113.20" }]);
  return {
    client: new BraavoApi(credentials, {
      fetch: fetcher,
      reserveSlot,
      resolve,
      sleep,
    }),
    fetcher,
    reserveSlot,
    resolve,
    sleep,
  };
}
describe("Braavo HTTP contract", () => {
  it("normalizes La Cleo to HTTPS on its final host", () => {
    expect(normalizeBraavoDomain("http://lacleo.com.br/")).toBe(
      "https://www.lacleo.com.br",
    );
    expect(normalizeBraavoDomain("www.lacleo.com.br/api/")).toBe(
      "https://www.lacleo.com.br",
    );
  });
  it.each([
    "https://localhost",
    "https://127.0.0.1",
    "https://store.internal",
    "https://example.com:8443",
    "https://a:b@example.com/",
    "https://example.com/private",
    "https://example.com/?apiKey=secret",
    "file:///tmp/file",
  ])("rejects unsafe or ambiguous domain %s", (domain) => {
    expect(() => normalizeBraavoDomain(domain)).toThrow();
  });
  it("uses Basic auth, JSON POST and disables both order mutation flags", async () => {
    const { client, fetcher } = api([json({ ok: [{ id: 7 }] })]);
    await client.one("/pedidos/buscar/id", 7);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe("https://www.lacleo.com.br/api/pedidos/buscar/id");
    expect(options).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Basic ${Buffer.from("test-token:test-key").toString("base64")}`,
        "Content-Type": "application/json",
      },
    });
    expect(JSON.parse(options.body)).toEqual({
      id: 7,
      gravar_status_erp: 0,
      gravar_separando: 0,
    });
    const other = api([json({ ok: [] })]);
    await other.client.query("/pedidos/buscar/id", {
      id: 7,
      gravar_status_erp: 1,
      gravar_separando: 1,
    });
    expect(
      JSON.parse(other.fetcher.mock.calls[0][1].body).gravar_status_erp,
    ).toBe(0);
  });
  it("rejects business errors even with HTTP 200 without echoing their contents", async () => {
    const { client, fetcher } = api([
      json({ erro: "test-key exposed upstream" }),
    ]);
    await expect(client.query("/clientes/buscar/todos")).rejects.toMatchObject({
      code: "BRAAVO_BUSINESS_ERROR",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    json({ ok: "not-an-array" }),
    new Response("<html>login</html>"),
    json({}),
  ])("rejects malformed success responses", async (response) => {
    const { client } = api([response]);
    await expect(client.query("/clientes/buscar/todos")).rejects.toThrow();
  });
  it("does not retry unauthorized calls", async () => {
    const { client, fetcher } = api([json({ erro: "auth" }, 401)]);
    await expect(client.query("/clientes/buscar/todos")).rejects.toThrow(
      "HTTP 401",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([403, 405, 503])("identifies HTML human verification (HTTP %s) without retrying it", async (status) => {
    const { client, fetcher } = api([
      new Response("<html><title>Human Verification</title></html>", {
        status,
        headers: { "content-type": "text/html; charset=UTF-8" },
      }),
    ]);
    await expect(client.query("/produtos/buscar/todos")).rejects.toMatchObject({
      code: "BRAAVO_ACCESS_BLOCKED",
      message: expect.stringContaining("POST /api/produtos/buscar/todos"),
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not misclassify a JSON method refusal as invalid credentials or a challenge", async () => {
    const { client, fetcher } = api([json({ erro: "Method not allowed" }, 405)]);
    await expect(client.query("/produtos/buscar/todos")).rejects.toMatchObject({
      code: "BRAAVO_ERROR",
      message: "A Braavo recusou POST /api/produtos/buscar/todos (HTTP 405). Os lotes salvos foram preservados.",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("retries transient errors with a reserved shop slot for every attempt", async () => {
    const { client, reserveSlot, sleep } = api([
      json({}, 429),
      json({}, 503),
      json({ ok: [] }),
    ]);
    await client.query("/clientes/buscar/todos");
    expect(reserveSlot).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledWith(500);
    expect(sleep).toHaveBeenCalledWith(1000);
  });
  it("never executes endpoints provided by external payloads", async () => {
    const { client, fetcher } = api([]);
    await expect(client.query("/pedidos/adicionar", {})).rejects.toMatchObject({
      code: "INVALID_ENDPOINT",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("blocks domains resolving to a private address before sending credentials", async () => {
    const { client, fetcher, resolve } = api([]);
    resolve.mockResolvedValue([{ address: "10.0.0.10" }]);
    await expect(client.query("/clientes/buscar/todos")).rejects.toMatchObject({
      code: "INVALID_DOMAIN",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("stops before a reserved slot would exceed the request deadline", async () => {
    const fetcher = vi.fn();
    const client = new BraavoApi(credentials, {
      fetch: fetcher,
      resolve: async () => [{ address: "203.0.113.20" }],
      reserveSlot: async () => Date.now() + 5000,
      deadline: Date.now() + 1000,
    });
    await expect(client.query("/clientes/buscar/todos")).rejects.toMatchObject({
      code: "BATCH_DEADLINE",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("checks identity and page continuity", async () => {
    await expect(
      api([json({ ok: [{ id: 8 }] })]).client.one("/pedidos/buscar/id", 7),
    ).rejects.toThrow("diferente");
    await expect(
      api([json({ ok: [], pag: { atual: 1, paginas: 2 } })]).client.page(
        "/clientes/buscar/todos",
        1,
        25,
      ),
    ).rejects.toThrow("Paginação");
    await expect(
      api([
        json({ ok: [{ id: 1 }], pag: { atual: 1, paginas: 2 } }),
      ]).client.page("/clientes/buscar/todos", 2, 25),
    ).rejects.toThrow("Paginação");
    const page = await api([
      json({ ok: [{ id: 1 }], pag: { atual: 1, paginas: 1 } }),
    ]).client.page("/clientes/buscar/todos", 1, 25);
    expect(page.complete).toBe(true);
  });
});
