type WhatsappWabaDiscoveryIntegration = {
  accessToken: string | null;
  businessId: string | null;
  wabaId: string | null;
  rawPayload: unknown;
};

type MetaGraphError = {
  message?: string;
};

type MetaGraphResponse<T> = T & {
  error?: MetaGraphError;
};

type MetaGraphList<T> = {
  data?: T[];
};

type MetaBusinessAccount = {
  id: string;
};

type MetaWhatsappBusinessAccount = {
  id: string;
};

type MetaWhatsappPhoneNumber = {
  id: string;
};

export type WhatsappWabaDiscoveryResult = {
  wabaId: string | null;
  checkedWabaIds: string[];
  matchedPhone: boolean;
  errors: string[];
};

type WhatsappWabaVerification = {
  wabaId: string;
  verifiedAt: string;
};

export function getVerifiedWhatsappWabaId(
  rawPayload: unknown,
  currentWabaId: string | null | undefined,
) {
  if (!rawPayload || typeof rawPayload !== "object" || !currentWabaId) {
    return null;
  }
  const verification = (rawPayload as Record<string, unknown>)
    .upDashWabaVerification;
  if (!verification || typeof verification !== "object") return null;
  const wabaId = (verification as Record<string, unknown>).wabaId;
  return typeof wabaId === "string" && wabaId === currentWabaId
    ? wabaId
    : null;
}

export function addWhatsappWabaVerification(
  rawPayload: unknown,
  verification: WhatsappWabaVerification,
) {
  const current =
    rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)
      ? (rawPayload as Record<string, unknown>)
      : {};
  return {
    ...current,
    upDashWabaVerification: verification,
  };
}

export function collectWhatsappWabaIds(rawPayload: unknown): string[] {
  if (!rawPayload || typeof rawPayload !== "object") return [];

  const ids = new Set<string>();
  const queue: unknown[] = [rawPayload];
  let scanned = 0;

  while (queue.length > 0 && scanned < 500) {
    const current = queue.shift();
    scanned += 1;
    if (!current || typeof current !== "object") continue;

    if (Array.isArray(current)) {
      queue.push(...current.slice(0, 100));
      continue;
    }

    for (const [key, value] of Object.entries(current as Record<string, unknown>)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (normalizedKey === "wabaid" && typeof value === "string" && value.trim()) {
        ids.add(value.trim());
      }
      if (key.toLowerCase() === "wabas" && Array.isArray(value)) {
        for (const item of value.slice(0, 100)) {
          if (!item || typeof item !== "object") continue;
          const id = (item as { id?: unknown }).id;
          if (typeof id === "string" && id.trim()) ids.add(id.trim());
        }
      }
      if (value && typeof value === "object") queue.push(value);
    }
  }

  return Array.from(ids);
}

async function fetchMetaGraph<T>(params: {
  endpoint: string;
  accessToken: string;
  graphApiVersion: string;
  searchParams?: Record<string, string>;
}) {
  const url = new URL(
    `https://graph.facebook.com/${params.graphApiVersion}${params.endpoint}`,
  );
  for (const [key, value] of Object.entries(params.searchParams ?? {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${params.accessToken}`,
    },
  });
  const payload = (await response.json()) as MetaGraphResponse<T>;

  return {
    ok: response.ok,
    status: response.status,
    payload,
  };
}

function graphErrorMessage(
  payload: { error?: MetaGraphError },
  fallback: string,
) {
  return payload.error?.message ?? fallback;
}

export async function discoverWhatsappWabaForPhone(params: {
  integration: WhatsappWabaDiscoveryIntegration;
  phoneNumberId: string;
  graphApiVersion: string;
  candidateWabaIds?: Array<string | null | undefined>;
}): Promise<WhatsappWabaDiscoveryResult> {
  const { integration, phoneNumberId, graphApiVersion } = params;
  if (!integration.accessToken) {
    return {
      wabaId: null,
      checkedWabaIds: [],
      matchedPhone: false,
      errors: ["Integração sem token para confirmar o WABA do número."],
    };
  }

  const candidateWabaIds = new Set<string>();
  for (const wabaId of [
    ...(params.candidateWabaIds ?? []),
    integration.wabaId,
    ...collectWhatsappWabaIds(integration.rawPayload),
  ]) {
    const normalized = wabaId?.trim();
    if (normalized) candidateWabaIds.add(normalized);
  }

  const checkedWabaIds: string[] = [];
  const attemptedWabaIds = new Set<string>();
  const discoveryErrors: string[] = [];
  const checkCandidates = async (wabaIds: Iterable<string>) => {
    for (const wabaId of wabaIds) {
      if (attemptedWabaIds.has(wabaId)) continue;
      attemptedWabaIds.add(wabaId);
      const phoneResponse = await fetchMetaGraph<
        MetaGraphList<MetaWhatsappPhoneNumber>
      >({
        endpoint: `/${wabaId}/phone_numbers`,
        accessToken: integration.accessToken as string,
        graphApiVersion,
        searchParams: { fields: "id", limit: "100" },
      });
      if (!phoneResponse.ok) {
        discoveryErrors.push(
          `${wabaId}: ${graphErrorMessage(
            phoneResponse.payload,
            `Erro Meta ${phoneResponse.status} ao confirmar telefones.`,
          )}`,
        );
        continue;
      }

      checkedWabaIds.push(wabaId);
      if (
        (phoneResponse.payload.data ?? []).some(
          (phone) => phone.id === phoneNumberId,
        )
      ) {
        return wabaId;
      }
    }
    return null;
  };

  const directMatch = await checkCandidates(candidateWabaIds);
  if (directMatch) {
    return {
      wabaId: directMatch,
      checkedWabaIds,
      matchedPhone: true,
      errors: discoveryErrors,
    };
  }

  const businessIds = new Set<string>();
  if (integration.businessId) businessIds.add(integration.businessId);

  if (businessIds.size === 0) {
    const businessesResponse = await fetchMetaGraph<
      MetaGraphList<MetaBusinessAccount>
    >({
      endpoint: "/me/businesses",
      accessToken: integration.accessToken,
      graphApiVersion,
      searchParams: { fields: "id", limit: "100" },
    });
    if (businessesResponse.ok) {
      for (const business of businessesResponse.payload.data ?? []) {
        if (business.id) businessIds.add(business.id);
      }
    } else {
      discoveryErrors.push(
        graphErrorMessage(
          businessesResponse.payload,
          `Erro Meta ${businessesResponse.status} ao listar empresas.`,
        ),
      );
    }
  }

  for (const businessId of businessIds) {
    for (const edge of [
      "owned_whatsapp_business_accounts",
      "client_whatsapp_business_accounts",
    ]) {
      const response = await fetchMetaGraph<
        MetaGraphList<MetaWhatsappBusinessAccount>
      >({
        endpoint: `/${businessId}/${edge}`,
        accessToken: integration.accessToken,
        graphApiVersion,
        searchParams: { fields: "id", limit: "100" },
      });
      if (!response.ok) {
        discoveryErrors.push(
          graphErrorMessage(
            response.payload,
            `Erro Meta ${response.status} ao listar WABAs.`,
          ),
        );
        continue;
      }
      for (const waba of response.payload.data ?? []) {
        if (waba.id) candidateWabaIds.add(waba.id);
      }
    }
  }

  const discoveredMatch = await checkCandidates(candidateWabaIds);
  if (discoveredMatch) {
    return {
      wabaId: discoveredMatch,
      checkedWabaIds,
      matchedPhone: true,
      errors: discoveryErrors,
    };
  }

  return {
    wabaId: null,
    checkedWabaIds,
    matchedPhone: false,
    errors: discoveryErrors,
  };
}
