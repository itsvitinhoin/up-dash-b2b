import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A busca da origem do trafego usa a autenticacao do GA4 (token em cache no modulo): cada teste carrega o modulo do zero.
async function loadGa4() {
  vi.resetModules();
  return import("../src/services/ga4");
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const token = () => json({ access_token: "acesso-de-teste", expires_in: 3600 });

type Row = { dimensionValues: Array<{ value: string }>; metricValues: Array<{ value: string }> };
const row = (date: string, channel: string, source: string, medium: string, campaign: string, metrics: number[]): Row => ({
  dimensionValues: [{ value: date }, { value: channel }, { value: source }, { value: medium }, { value: campaign }],
  metricValues: metrics.map((value) => ({ value: String(value) })),
});

describe("fetchGa4TrafficDaily (origem do tráfego por dia)", () => {
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

  it("pede dia x canal x origem x mídia x campanha com as métricas de visita e venda e devolve as linhas já tratadas", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => token())
      .mockImplementationOnce(async () =>
        json({
          rows: [
            // sessoes, usuarios, engajadas, carrinho, checkout, compras, receita
            row("20261108", " Paid Social ", "facebook", "cpm", " Remarketing ", [100, 90, 60, 12, 6, 3, 450.5]),
            row("20261108", "Direct", "(direct)", "(none)", "(direct)", [40, 35, 20, 4, 2, 1, 99]),
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { fetchGa4TrafficDaily } = await loadGa4();

    const rows = await fetchGa4TrafficDaily({ propertyId: "391336339", dateFrom: "2026-10-06", dateTo: "2026-11-09" });

    expect(rows).toEqual([
      {
        date: "2026-11-08",
        channelGroup: "Paid Social",
        source: "facebook",
        medium: "cpm",
        campaign: "Remarketing",
        sessions: 100,
        totalUsers: 90,
        engagedSessions: 60,
        addToCarts: 12,
        checkouts: 6,
        purchases: 3,
        purchaseRevenue: 450.5,
      },
      {
        date: "2026-11-08",
        channelGroup: "Direct",
        source: "(direct)",
        medium: "(none)",
        campaign: "(direct)",
        sessions: 40,
        totalUsers: 35,
        engagedSessions: 20,
        addToCarts: 4,
        checkouts: 2,
        purchases: 1,
        purchaseRevenue: 99,
      },
    ]);

    const [url, init] = fetchMock.mock.calls[1] as [string, { body: string }];
    expect(url).toBe("https://analyticsdata.googleapis.com/v1beta/properties/391336339:runReport");
    const body = JSON.parse(init.body);
    expect(body.dateRanges).toEqual([{ startDate: "2026-10-06", endDate: "2026-11-09" }]);
    expect(body.dimensions.map((d: { name: string }) => d.name)).toEqual([
      "date",
      "sessionDefaultChannelGroup",
      "sessionSource",
      "sessionMedium",
      "sessionCampaignName",
    ]);
    expect(body.metrics.map((m: { name: string }) => m.name)).toEqual([
      "sessions",
      "totalUsers",
      "engagedSessions",
      "addToCarts",
      "checkouts",
      "ecommercePurchases",
      "purchaseRevenue",
    ]);
    expect(body.limit).toBe(100_000);
    expect(body.offset).toBe(0);
  });

  it("descarta linha sem nada medido (o GA4 as devolve em combinações raras)", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementationOnce(async () => token())
        .mockImplementationOnce(async () =>
          json({
            rows: [
              row("20261108", "Direct", "(direct)", "(none)", "(direct)", [0, 0, 0, 0, 0, 0, 0]),
              row("20261108", "Organic Search", "google", "organic", "(organic)", [5, 5, 3, 0, 0, 0, 0]),
            ],
          }),
        ),
    );
    const { fetchGa4TrafficDaily } = await loadGa4();
    const rows = await fetchGa4TrafficDaily({ propertyId: "1", dateFrom: "2026-11-08", dateTo: "2026-11-08" });
    expect(rows).toHaveLength(1);
    expect(rows?.[0].source).toBe("google");
  });

  it("mantém a linha de ESTORNO (receita negativa) e a visita sem compra: só some a linha em que tudo é zero", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementationOnce(async () => token())
        .mockImplementationOnce(async () =>
          json({
            rows: [
              // 16 sessoes e R$ -3.048 (estorno atribuido a essa origem): a soma das metricas e negativa, mas e dado real
              row("20251008", "Direct", "(not set)", "(not set)", "(not set)", [16, 17, 9, 0, 0, 0, -3048]),
              // estorno num dia sem visita nenhuma dessa origem
              row("20251009", "Paid Social", "facebook", "cpm", "Remarketing", [0, 0, 0, 0, 0, 0, -330]),
              // compra com receita negativa: a compra conta
              row("20251010", "Direct", "(direct)", "(none)", "(direct)", [8, 10, 4, 0, 0, 2, -220]),
              row("20251011", "Direct", "(direct)", "(none)", "(direct)", [0, 0, 0, 0, 0, 0, 0]),
            ],
          }),
        ),
    );
    const { fetchGa4TrafficDaily } = await loadGa4();
    const rows = await fetchGa4TrafficDaily({ propertyId: "340915266", dateFrom: "2025-10-08", dateTo: "2025-10-11" });
    expect(rows?.map((r) => [r.date, r.sessions, r.purchases, r.purchaseRevenue])).toEqual([
      ["2025-10-08", 16, 0, -3048],
      ["2025-10-09", 0, 0, -330],
      ["2025-10-10", 8, 2, -220],
    ]);
  });

  it("pagina com offset quando a primeira página vem cheia (400 dias x origens passam de 100 mil linhas em lojas grandes)", async () => {
    const fullPage = Array.from({ length: 100_000 }, (_, i) => row("20261108", "Referral", `site${i}`, "referral", "(not set)", [1, 1, 1, 0, 0, 0, 0]));
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => token())
      .mockImplementationOnce(async () => json({ rows: fullPage }))
      .mockImplementationOnce(async () => json({ rows: [row("20261108", "Direct", "(direct)", "(none)", "(direct)", [7, 7, 5, 0, 0, 0, 0])] }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchGa4TrafficDaily } = await loadGa4();

    const rows = await fetchGa4TrafficDaily({ propertyId: "1", dateFrom: "2025-10-06", dateTo: "2026-11-09" });

    expect(rows).toHaveLength(100_001);
    expect(fetchMock).toHaveBeenCalledTimes(3); // token + 2 paginas
    expect(JSON.parse((fetchMock.mock.calls[2] as [string, { body: string }])[1].body).offset).toBe(100_000);
  });

  it("sem propriedade ou sem credencial devolve null (quem chama decide), sem chamar a API de dados", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { fetchGa4TrafficDaily } = await loadGa4();
    expect(await fetchGa4TrafficDaily({ propertyId: null, dateFrom: "2026-11-08", dateTo: "2026-11-08" })).toBeNull();
    vi.stubEnv("GA4_OAUTH_CLIENT_SECRET", "");
    const { fetchGa4TrafficDaily: semChave } = await loadGa4();
    expect(await semChave({ propertyId: "1", dateFrom: "2026-11-08", dateTo: "2026-11-08" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("recusa do Google (ex.: sem acesso à propriedade) sobe com a mensagem dele, para o job registrar o motivo", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementationOnce(async () => token())
        .mockImplementationOnce(async () => json({ error: { message: "User does not have sufficient permissions for this property." } }, 403)),
    );
    const { fetchGa4TrafficDaily } = await loadGa4();
    await expect(fetchGa4TrafficDaily({ propertyId: "1", dateFrom: "2026-11-08", dateTo: "2026-11-08" })).rejects.toThrow(
      "sufficient permissions",
    );
  });
});
