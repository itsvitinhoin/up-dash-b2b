import { describe, expect, it } from "vitest";
import {
  buildDiscoveryReport,
  parseAccountSummaries,
  parseDataStreams,
  selectRegistrations,
  type Ga4KnownClient,
  type Ga4VisibleProperty,
} from "../src/services/ga4-discovery-rules";

const prop = (propertyId: string, name: string, measurementIds: string[], account = "Conta A"): Ga4VisibleProperty => ({
  propertyId,
  propertyName: name,
  accountId: account === "Conta A" ? "1" : "2",
  accountName: account,
  streams: measurementIds.map((measurementId) => ({ measurementId, uri: null })),
});

const client = (clientName: string, measurementId: string | null, registeredPropertyId: string | null = null): Ga4KnownClient => ({
  clientName,
  clientId: `id-${clientName}`,
  measurementId,
  registeredPropertyId,
  source: "teste",
});

describe("parseAccountSummaries", () => {
  it("achata contas e propriedades e tira o prefixo 'properties/'", () => {
    const parsed = parseAccountSummaries({
      accountSummaries: [
        {
          account: "accounts/100",
          displayName: "Loja A",
          propertySummaries: [
            { property: "properties/387817325", displayName: "Jini - GA4" },
            { property: "properties/422756040", displayName: "Giah" },
          ],
        },
        { account: "accounts/200", displayName: "Loja B", propertySummaries: [{ property: "properties/9", displayName: "  " }] },
      ],
      nextPageToken: "abc",
    });
    expect(parsed.properties.map((p) => [p.propertyId, p.propertyName, p.accountId, p.accountName])).toEqual([
      ["387817325", "Jini - GA4", "100", "Loja A"],
      ["422756040", "Giah", "100", "Loja A"],
      ["9", "9", "200", "Loja B"],
    ]);
    expect(parsed.nextPageToken).toBe("abc");
  });

  it("conta sem propriedades e resposta vazia não quebram", () => {
    expect(parseAccountSummaries({}).properties).toEqual([]);
    expect(parseAccountSummaries({ accountSummaries: [{ account: "accounts/1" }] }).properties).toEqual([]);
    expect(parseAccountSummaries({}).nextPageToken).toBeNull();
  });

  it("ignora item sem ID numérico de propriedade", () => {
    expect(parseAccountSummaries({ accountSummaries: [{ account: "accounts/1", propertySummaries: [{ property: "properties/abc" }] }] }).properties).toEqual([]);
  });
});

describe("parseDataStreams", () => {
  it("fica só com fluxos web que têm ID de medição", () => {
    const parsed = parseDataStreams({
      dataStreams: [
        { type: "WEB_DATA_STREAM", webStreamData: { measurementId: "G-ABC123", defaultUri: "https://loja.com.br" } },
        { type: "ANDROID_APP_DATA_STREAM" },
        { type: "WEB_DATA_STREAM", webStreamData: { measurementId: "  " } },
      ],
    });
    expect(parsed.streams).toEqual([{ measurementId: "G-ABC123", uri: "https://loja.com.br" }]);
  });
});

describe("buildDiscoveryReport", () => {
  const visible = [
    prop("111", "Vogabox GA4", ["G-VOGA"]),
    prop("222", "Giah", ["G-GIAH"]),
    prop("333", "Propriedade sem dono", ["G-ORFA"], "Conta B"),
  ];

  it("acha a propriedade pelo ID de medição quando ela ainda não está cadastrada (CADASTRAR)", () => {
    const report = buildDiscoveryReport(visible, [client("Vogabox", "G-VOGA")]);
    expect(report.entries[0]).toMatchObject({ status: "cadastrar", foundPropertyId: "111", foundPropertyName: "Vogabox GA4" });
  });

  it("propriedade já cadastrada e visível está OK", () => {
    const report = buildDiscoveryReport(visible, [client("Giah", "G-GIAH", "222")]);
    expect(report.entries[0].status).toBe("ja_cadastrada");
  });

  it("cadastrada mas a identidade não enxerga = falta acesso (o caso das 5 lojas)", () => {
    const report = buildDiscoveryReport(visible, [client("Aiyu", "G-AIYU", "523834127")]);
    expect(report.entries[0]).toMatchObject({ status: "cadastrada_invisivel", registeredPropertyId: "523834127", foundPropertyId: null });
  });

  it("só se sabe o ID de medição e a identidade não enxerga = INVISIVEL", () => {
    const report = buildDiscoveryReport(visible, [client("Hirus", "G-HIRU")]);
    expect(report.entries[0].status).toBe("invisivel");
  });

  it("propriedade cadastrada diferente da que o ID de medição indica = DIVERGE (erro de cadastro)", () => {
    const report = buildDiscoveryReport(visible, [client("Vogabox", "G-VOGA", "222")]);
    expect(report.entries[0]).toMatchObject({ status: "diverge", registeredPropertyId: "222", foundPropertyId: "111" });
  });

  it("compara o ID de medição sem diferenciar maiúscula/minúscula e ignora espaços", () => {
    const report = buildDiscoveryReport(visible, [client("Vogabox", "  g-voga  ")]);
    expect(report.entries[0].status).toBe("cadastrar");
  });

  it("propriedade visível que ninguém reivindica aparece como SEM CLIENTE (cliente novo ou não cadastrado)", () => {
    const report = buildDiscoveryReport(visible, [client("Vogabox", "G-VOGA"), client("Giah", "G-GIAH", "222")]);
    expect(report.visibleWithoutClient.map((p) => p.propertyId)).toEqual(["333"]);
  });

  it("propriedade cadastrada e visível não vira 'sem cliente' mesmo sem ID de medição", () => {
    const report = buildDiscoveryReport(visible, [client("Giah", null, "222")]);
    expect(report.entries[0].status).toBe("ja_cadastrada");
    expect(report.visibleWithoutClient.map((p) => p.propertyId)).not.toContain("222");
  });

  it("conta tudo e ordena o que pede ação primeiro (diverge, cadastrar, sem acesso, invisível, ok)", () => {
    const report = buildDiscoveryReport(visible, [
      client("Giah", "G-GIAH", "222"),
      client("Hirus", "G-HIRU"),
      client("Aiyu", "G-AIYU", "523834127"),
      client("Vogabox", "G-VOGA"),
      client("Errada", "G-VOGA", "222"),
    ]);
    expect(report.entries.map((e) => e.status)).toEqual(["diverge", "cadastrar", "cadastrada_invisivel", "invisivel", "ja_cadastrada"]);
    expect(report.counts).toMatchObject({
      visibleAccounts: 2,
      visibleProperties: 3,
      knownClients: 5,
      ja_cadastrada: 1,
      cadastrar: 1,
      diverge: 1,
      cadastrada_invisivel: 1,
      invisivel: 1,
    });
  });

  it("identidade que não enxerga nada: tudo vira sem acesso/invisível, nada quebra", () => {
    const report = buildDiscoveryReport([], [client("Aiyu", "G-AIYU", "5"), client("Hirus", "G-HIRU")]);
    expect(report.counts.visibleProperties).toBe(0);
    expect(report.entries.map((e) => e.status)).toEqual(["cadastrada_invisivel", "invisivel"]);
  });
});

describe("selectRegistrations (o que a descoberta pode registrar sozinha)", () => {
  const visible = [prop("111", "Vogabox GA4", ["G-VOGA"]), prop("222", "Giah", ["G-GIAH"]), prop("333", "Compartilhada", ["G-SHARED"])];

  it("registra o cliente do dash cujo ID de medição aponta para uma propriedade visível e que ainda não tem propriedade", () => {
    const { apply, skipped } = selectRegistrations(buildDiscoveryReport(visible, [client("Vogabox", "G-VOGA")]));
    expect(apply).toEqual([{ clientId: "id-Vogabox", clientName: "Vogabox", propertyId: "111", measurementId: "G-VOGA" }]);
    expect(skipped).toEqual([]);
  });

  it("não mexe em quem já está cadastrado, em DIVERGE, em sem acesso nem em invisível", () => {
    const report = buildDiscoveryReport(visible, [
      client("Giah", "G-GIAH", "222"),
      client("Errada", "G-VOGA", "222"),
      client("Aiyu", "G-AIYU", "523834127"),
      client("Hirus", "G-HIRU"),
    ]);
    expect(selectRegistrations(report).apply).toEqual([]);
  });

  it("propriedade reivindicada por dois clientes é AMBÍGUA: não registra nenhum dos dois, diz o motivo", () => {
    const report = buildDiscoveryReport(visible, [client("Loja A", "G-SHARED"), client("Loja B", "G-SHARED")]);
    const { apply, skipped } = selectRegistrations(report);
    expect(apply).toEqual([]);
    expect(skipped.map((s) => s.clientName).sort()).toEqual(["Loja A", "Loja B"]);
    expect(skipped[0].reason).toContain("mais de um cliente");
  });

  it("propriedade que já está cadastrada em OUTRO cliente não é duplicada", () => {
    const report = buildDiscoveryReport(visible, [client("Giah", "G-GIAH", "222"), client("Giah 2", "G-GIAH")]);
    const { apply, skipped } = selectRegistrations(report);
    expect(apply).toEqual([]);
    expect(skipped[0]).toMatchObject({ clientName: "Giah 2" });
    expect(skipped[0].reason).toContain("ja esta cadastrada em outro cliente");
  });

  it("cliente que só existe no cadastro antigo (sem clientId) não é registrado, fica como pendência", () => {
    const orphan: Ga4KnownClient = { clientName: "mazarin (fora do dash)", clientId: null, measurementId: "G-VOGA", registeredPropertyId: null, source: "teste" };
    const { apply, skipped } = selectRegistrations(buildDiscoveryReport(visible, [orphan]));
    expect(apply).toEqual([]);
    expect(skipped[0].reason).toContain("nao e cliente do dash");
  });
});
