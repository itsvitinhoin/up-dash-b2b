import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A autenticacao do GA4 guarda estado no modulo (token em cache, recusa recente); cada teste carrega o modulo do zero.
async function loadGa4() {
  vi.resetModules();
  return import("../src/services/ga4");
}

const tokenResponse = (token: string, expiresIn = 3600) =>
  new Response(JSON.stringify({ access_token: token, expires_in: expiresIn }), { status: 200 });

describe("chave da agência (OAuth) no GA4", () => {
  beforeEach(() => {
    vi.stubEnv("GA4_OAUTH_REFRESH_TOKEN", "refresh-de-teste");
    vi.stubEnv("GA4_OAUTH_CLIENT_ID", "client-id-de-teste");
    vi.stubEnv("GA4_OAUTH_CLIENT_SECRET", "client-secret-de-teste");
    vi.stubEnv("GA4_SERVICE_ACCOUNT_JSON", "");
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON", "");
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", "");
    vi.stubEnv("K_SERVICE", "");
    vi.stubEnv("CLOUD_RUN_JOB", "");
    vi.stubEnv("GA4_USE_ADC", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("troca a chave permanente por um token de acesso e o reaproveita enquanto vale (uma chamada só ao Google)", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => tokenResponse("acesso-1"));
    vi.stubGlobal("fetch", fetchMock);
    const { getGa4AccessToken } = await loadGa4();
    expect(await getGa4AccessToken()).toBe("acesso-1");
    expect(await getGa4AccessToken()).toBe("acesso-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: URLSearchParams }];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(init.body.get("grant_type")).toBe("refresh_token");
    expect(init.body.get("refresh_token")).toBe("refresh-de-teste");
    expect(init.body.get("client_id")).toBe("client-id-de-teste");
  });

  it("renova quando o token está perto de vencer", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => tokenResponse("acesso-curto", 30))
      .mockImplementationOnce(async () => tokenResponse("acesso-novo"));
    vi.stubGlobal("fetch", fetchMock);
    const { getGa4AccessToken } = await loadGa4();
    expect(await getGa4AccessToken()).toBe("acesso-curto");
    expect(await getGa4AccessToken()).toBe("acesso-novo");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("se o Google recusa a chave NÃO derruba: avisa e devolve null (cai na conta de serviço) e não martela o Google", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const { getGa4AccessToken } = await loadGa4();
    expect(await getGa4AccessToken()).toBeNull();
    expect(await getGa4AccessToken()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain("recusou a chave da agencia");
  });

  it("falha de rede ao renovar também cai na reserva, sem exceção", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("rede fora")));
    const { getGa4AccessToken } = await loadGa4();
    await expect(getGa4AccessToken()).resolves.toBeNull();
  });

  it("sem as 3 variáveis a chave da agência nem é tentada (comportamento de antes)", async () => {
    vi.stubEnv("GA4_OAUTH_CLIENT_SECRET", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { getGa4AccessToken } = await loadGa4();
    expect(await getGa4AccessToken()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("nunca escreve o valor da chave no log, nem ao falhar", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })));
    const { getGa4AccessToken } = await loadGa4();
    await getGa4AccessToken();
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain("refresh-de-teste");
    expect(logged).not.toContain("client-secret-de-teste");
  });
});
