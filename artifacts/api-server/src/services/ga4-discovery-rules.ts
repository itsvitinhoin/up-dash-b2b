// Regras puras da DESCOBERTA de propriedades GA4 (sem rede nem banco), testaveis isoladamente.
//
// Problema: o job le o GA4 pelo ID da PROPRIEDADE, mas o que se sabe da maioria dos clientes e o ID de MEDICAO (G-XXXX,
// o "TID" do backend antigo). A Admin API lista todas as propriedades que uma identidade enxerga e, de cada uma, os IDs de
// medicao -- dai sai o par medicao -> propriedade sem ninguem digitar. Quem a identidade nao enxerga nao aparece:
// esse e justamente o mapa de "quem ja e legivel e quem falta dar acesso".

export type Ga4VisibleProperty = {
  propertyId: string;
  propertyName: string;
  accountId: string;
  accountName: string;
  streams: Array<{ measurementId: string; uri: string | null }>;
};

/** O que se sabe de um cliente sobre o GA4, de qualquer fonte. */
export type Ga4KnownClient = {
  clientName: string;
  clientId: string | null;
  /** ID de medicao G-… (do dash ou de up_global.dataset_tid_map). */
  measurementId: string | null;
  /** ID de propriedade ja cadastrado no dash (o que o job le hoje). */
  registeredPropertyId: string | null;
  source: string;
};

export type DiscoveryStatus =
  | "ja_cadastrada" // a propriedade cadastrada e enxergada pela identidade
  | "cadastrar" // nao tem propriedade cadastrada, mas achei pelo ID de medicao
  | "diverge" // cadastrada uma, mas o ID de medicao pertence a outra
  | "cadastrada_invisivel" // tem propriedade cadastrada, a identidade nao enxerga (falta acesso)
  | "invisivel"; // so se sabe o ID de medicao e a identidade nao enxerga

export type DiscoveryEntry = {
  status: DiscoveryStatus;
  clientName: string;
  clientId: string | null;
  measurementId: string | null;
  registeredPropertyId: string | null;
  foundPropertyId: string | null;
  foundPropertyName: string | null;
  source: string;
};

export type DiscoveryReport = {
  entries: DiscoveryEntry[];
  /** Propriedades visiveis que nao batem com nenhum cliente conhecido (clientes novos ou nao cadastrados). */
  visibleWithoutClient: Ga4VisibleProperty[];
  counts: {
    visibleAccounts: number;
    visibleProperties: number;
    knownClients: number;
  } & Record<DiscoveryStatus, number>;
};

type AccountSummariesPage = {
  accountSummaries?: Array<{
    account?: string;
    displayName?: string;
    propertySummaries?: Array<{ property?: string; displayName?: string }>;
  }>;
  nextPageToken?: string;
};

type DataStreamsPage = {
  dataStreams?: Array<{
    type?: string;
    webStreamData?: { measurementId?: string; defaultUri?: string };
  }>;
  nextPageToken?: string;
};

function lastSegment(resource: string | undefined): string {
  return (resource ?? "").split("/").pop()?.trim() ?? "";
}

/** Resposta de accountSummaries.list -> propriedades visiveis (sem os streams, que vem de outra chamada). */
export function parseAccountSummaries(page: AccountSummariesPage): {
  properties: Array<Pick<Ga4VisibleProperty, "propertyId" | "propertyName" | "accountId" | "accountName">>;
  nextPageToken: string | null;
} {
  const properties: Array<Pick<Ga4VisibleProperty, "propertyId" | "propertyName" | "accountId" | "accountName">> = [];
  for (const account of page.accountSummaries ?? []) {
    for (const property of account.propertySummaries ?? []) {
      const propertyId = lastSegment(property.property);
      if (!/^\d+$/.test(propertyId)) continue;
      properties.push({
        propertyId,
        propertyName: property.displayName?.trim() || propertyId,
        accountId: lastSegment(account.account),
        accountName: account.displayName?.trim() || lastSegment(account.account),
      });
    }
  }
  return { properties, nextPageToken: page.nextPageToken || null };
}

/** Resposta de properties.dataStreams.list -> so os fluxos WEB com ID de medicao. */
export function parseDataStreams(page: DataStreamsPage): {
  streams: Array<{ measurementId: string; uri: string | null }>;
  nextPageToken: string | null;
} {
  const streams: Array<{ measurementId: string; uri: string | null }> = [];
  for (const stream of page.dataStreams ?? []) {
    const measurementId = stream.webStreamData?.measurementId?.trim();
    if (!measurementId) continue;
    streams.push({ measurementId, uri: stream.webStreamData?.defaultUri?.trim() || null });
  }
  return { streams, nextPageToken: page.nextPageToken || null };
}

function cleanId(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  return text ? text : null;
}

/**
 * Cruza o que a identidade enxerga com o que se sabe de cada cliente. A chave e o ID de MEDICAO (G-…), que identifica a
 * propriedade sem ambiguidade; o ID de propriedade cadastrado serve para conferir e para o caso de nao haver medicao.
 */
export function buildDiscoveryReport(visible: Ga4VisibleProperty[], known: Ga4KnownClient[]): DiscoveryReport {
  const byMeasurement = new Map<string, Ga4VisibleProperty>();
  const byPropertyId = new Map<string, Ga4VisibleProperty>();
  for (const property of visible) {
    byPropertyId.set(property.propertyId, property);
    for (const stream of property.streams) byMeasurement.set(stream.measurementId.toUpperCase(), property);
  }

  const matchedPropertyIds = new Set<string>();
  const entries: DiscoveryEntry[] = known.map((client) => {
    const measurementId = cleanId(client.measurementId);
    const registered = cleanId(client.registeredPropertyId);
    const byMid = measurementId ? byMeasurement.get(measurementId.toUpperCase()) : undefined;
    const byReg = registered ? byPropertyId.get(registered) : undefined;
    const found = byMid ?? byReg ?? null;
    if (found) matchedPropertyIds.add(found.propertyId);
    if (byReg) matchedPropertyIds.add(byReg.propertyId);

    let status: DiscoveryStatus;
    if (registered && byMid && byMid.propertyId !== registered) status = "diverge";
    else if (registered && byReg) status = "ja_cadastrada";
    else if (registered && !byReg) status = "cadastrada_invisivel";
    else if (byMid) status = "cadastrar";
    else status = "invisivel";

    return {
      status,
      clientName: client.clientName,
      clientId: client.clientId,
      measurementId,
      registeredPropertyId: registered,
      foundPropertyId: found?.propertyId ?? null,
      foundPropertyName: found?.propertyName ?? null,
      source: client.source,
    };
  });

  const visibleWithoutClient = visible.filter((property) => !matchedPropertyIds.has(property.propertyId));
  const counts = {
    visibleAccounts: new Set(visible.map((property) => property.accountId)).size,
    visibleProperties: visible.length,
    knownClients: known.length,
    ja_cadastrada: 0,
    cadastrar: 0,
    diverge: 0,
    cadastrada_invisivel: 0,
    invisivel: 0,
  };
  for (const entry of entries) counts[entry.status] += 1;

  const order: Record<DiscoveryStatus, number> = { diverge: 0, cadastrar: 1, cadastrada_invisivel: 2, invisivel: 3, ja_cadastrada: 4 };
  entries.sort((a, b) => order[a.status] - order[b.status] || a.clientName.localeCompare(b.clientName, "pt-BR"));
  return { entries, visibleWithoutClient, counts };
}
