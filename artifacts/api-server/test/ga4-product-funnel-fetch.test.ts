import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A busca do funil por produto usa a autenticacao do GA4 (token em cache no modulo): cada teste carrega o modulo do zero.
async function loadGa4() {
  vi.resetModules();
  return import("../src/services/ga4");
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const token = () => json({ access_token: "acesso-de-teste", expires_in: 3600 });

type Row = { dimensionValues: Array<{ value: string }>; metricValues: Array<{ value: string }> };
// metricas, na ordem pedida: vistos, carrinho, checkout, comprados, receita liquida, receita bruta, estornado
const row = (date: string, id: string, name: string, variant: string, metrics: number[]): Row => ({
  dimensionValues: [{ value: date }, { value: id }, { value: name }, { value: variant }],
  metricValues: metrics.map((value) => ({ value: String(value) })),
});

describe("fetchGa4ProductFunnelDaily (funil por produto, por dia)", () => {
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

  it("pede dia x item x nome x variante com as 7 métricas de item (sem filtro de evento) e devolve as linhas já tratadas", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => token())
      .mockImplementationOnce(async () =>
        json({
          rows: [
            // 16 vistas, 5 no carrinho, 2 no checkout, 1 comprada; o GA4 manda a receita com ruido de ponto flutuante
            row("20261108", " 1559476085 ", "CALÇA YASMIN BALLOON", "CINZA, M/40", [16, 5, 2, 1, 798.000005, 798.000005, 0]),
            // variante vazia vira null; receita liquida menor que a bruta por causa do estorno
            row("20261108", "1622087559", "CALÇA ALEXA", "", [9, 0, 0, 2, 200.5, 250.5, 50]),
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { fetchGa4ProductFunnelDaily } = await loadGa4();

    const rows = await fetchGa4ProductFunnelDaily({ propertyId: "422756040", dateFrom: "2026-11-01", dateTo: "2026-11-09" });

    expect(rows).toEqual([
      {
        date: "2026-11-08",
        itemId: "1559476085",
        itemName: "CALÇA YASMIN BALLOON",
        itemVariant: "CINZA, M/40",
        itemsViewed: 16,
        itemsAddedToCart: 5,
        itemsCheckedOut: 2,
        itemsPurchased: 1,
        itemRevenue: 798.000005,
        grossItemRevenue: 798.000005,
        itemRefundAmount: 0,
      },
      {
        date: "2026-11-08",
        itemId: "1622087559",
        itemName: "CALÇA ALEXA",
        itemVariant: null,
        itemsViewed: 9,
        itemsAddedToCart: 0,
        itemsCheckedOut: 0,
        itemsPurchased: 2,
        itemRevenue: 200.5,
        grossItemRevenue: 250.5,
        itemRefundAmount: 50,
      },
    ]);

    const [url, init] = fetchMock.mock.calls[1] as [string, { body: string }];
    expect(url).toBe("https://analyticsdata.googleapis.com/v1beta/properties/422756040:runReport");
    const body = JSON.parse(init.body);
    expect(body.dateRanges).toEqual([{ startDate: "2026-11-01", endDate: "2026-11-09" }]);
    expect(body.dimensions.map((d: { name: string }) => d.name)).toEqual(["date", "itemId", "itemName", "itemVariant"]);
    expect(body.metrics.map((m: { name: string }) => m.name)).toEqual([
      "itemsViewed",
      "itemsAddedToCart",
      "itemsCheckedOut",
      "itemsPurchased",
      "itemRevenue",
      "grossItemRevenue",
      "itemRefundAmount",
    ]);
    expect(body.dimensionFilter).toBeUndefined(); // itemsViewed sai igual com e sem o filtro view_item (conferido ao vivo)
    expect(body.limit).toBe(100_000);
    expect(body.offset).toBe(0);
  });

  it('"(not set)" continua como o GA4 mandou: assim a variante casa com a das visualizações de produto', async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementationOnce(async () => token())
        .mockImplementationOnce(async () => json({ rows: [row("20261108", "1612-24739", "Camisa Regata", "(not set)", [12, 0, 0, 0, 0, 0, 0])] })),
    );
    const { fetchGa4ProductFunnelDaily } = await loadGa4();
    const rows = await fetchGa4ProductFunnelDaily({ propertyId: "391336339", dateFrom: "2026-11-08", dateTo: "2026-11-08" });
    expect(rows?.[0].itemVariant).toBe("(not set)");
  });

  it("só some a linha em que TUDO é zero: estorno (receita negativa) e item visto sem compra são dado real", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementationOnce(async () => token())
        .mockImplementationOnce(async () =>
          json({
            rows: [
              row("20261108", "A", "Item A", "", [0, 0, 0, 0, 0, 0, 0]), // tudo zero: descartada
              row("20261108", "B", "Item B", "", [0, 0, 0, 0, -129.9, 0, 129.9]), // estorno de uma compra antiga, sem nada visto no dia
              row("20261108", "C", "Item C", "", [7, 0, 0, 0, 0, 0, 0]), // so visto
              row("20261108", "D", "Item D", "", [0, 1, 0, 0, 0, 0, 0]), // so foi ao carrinho (sem visita no dia)
            ],
          }),
        ),
    );
    const { fetchGa4ProductFunnelDaily } = await loadGa4();
    const rows = await fetchGa4ProductFunnelDaily({ propertyId: "1", dateFrom: "2026-11-08", dateTo: "2026-11-08" });
    expect(rows?.map((r) => [r.itemId, r.itemsViewed, r.itemsAddedToCart, r.itemRevenue])).toEqual([
      ["B", 0, 0, -129.9],
      ["C", 7, 0, 0],
      ["D", 0, 1, 0],
    ]);
  });

  it("pagina com offset quando a primeira página vem cheia (400 dias x catálogo passam de 100 mil linhas em lojas grandes)", async () => {
    const fullPage = Array.from({ length: 100_000 }, (_, i) => row("20261108", `sku${i}`, `Produto ${i}`, "", [1, 0, 0, 0, 0, 0, 0]));
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => token())
      .mockImplementationOnce(async () => json({ rows: fullPage }))
      .mockImplementationOnce(async () => json({ rows: [row("20261108", "ultimo", "Ultimo", "", [3, 1, 0, 0, 0, 0, 0])] }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchGa4ProductFunnelDaily } = await loadGa4();

    const rows = await fetchGa4ProductFunnelDaily({ propertyId: "1", dateFrom: "2025-10-06", dateTo: "2026-11-09" });

    expect(rows).toHaveLength(100_001);
    expect(fetchMock).toHaveBeenCalledTimes(3); // token + 2 paginas
    expect(JSON.parse((fetchMock.mock.calls[2] as [string, { body: string }])[1].body).offset).toBe(100_000);
  });

  it("sem propriedade ou sem credencial devolve null (quem chama decide), sem chamar a API de dados", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { fetchGa4ProductFunnelDaily } = await loadGa4();
    expect(await fetchGa4ProductFunnelDaily({ propertyId: null, dateFrom: "2026-11-08", dateTo: "2026-11-08" })).toBeNull();
    vi.stubEnv("GA4_OAUTH_CLIENT_SECRET", "");
    const { fetchGa4ProductFunnelDaily: semChave } = await loadGa4();
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
    const { fetchGa4ProductFunnelDaily } = await loadGa4();
    await expect(fetchGa4ProductFunnelDaily({ propertyId: "1", dateFrom: "2026-11-08", dateTo: "2026-11-08" })).rejects.toThrow(
      "sufficient permissions",
    );
  });
});
