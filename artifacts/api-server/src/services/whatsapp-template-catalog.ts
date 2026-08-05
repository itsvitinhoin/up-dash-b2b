export type WhatsappTemplateCatalogItem = {
  id: string | null;
  name: string;
  language: string;
  status: string;
  category: string | null;
  components: unknown;
  rawPayload: Record<string, unknown>;
};

type CatalogFetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

type CatalogFetch = (
  input: string,
  init: {
    headers: Record<string, string>;
    signal?: AbortSignal;
  },
) => Promise<CatalogFetchResponse>;

type MetaTemplatePayload = {
  data?: Array<{
    id?: unknown;
    name?: unknown;
    language?: unknown;
    status?: unknown;
    category?: unknown;
    components?: unknown;
    [key: string]: unknown;
  }>;
  paging?: {
    next?: unknown;
  };
  error?: {
    message?: unknown;
  };
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro inesperado ao sincronizar templates.";
}

function readMetaError(payload: MetaTemplatePayload, status: number) {
  return typeof payload.error?.message === "string"
    ? payload.error.message
    : `Erro Meta ${status} ao sincronizar templates.`;
}

function normalizeTemplate(row: MetaTemplatePayload["data"] extends Array<infer Item> | undefined ? Item : never) {
  if (
    !row ||
    typeof row.name !== "string" ||
    typeof row.language !== "string" ||
    typeof row.status !== "string"
  ) {
    return null;
  }

  return {
    id: typeof row.id === "string" ? row.id : null,
    name: row.name,
    language: row.language,
    status: row.status,
    category: typeof row.category === "string" ? row.category : null,
    components: row.components ?? null,
    rawPayload: row,
  } satisfies WhatsappTemplateCatalogItem;
}

export async function fetchWhatsappTemplateCatalog(params: {
  wabaId: string;
  accessToken: string;
  graphApiVersion?: string;
  request?: CatalogFetch;
  maxPages?: number;
}) {
  const request = params.request ?? (fetch as unknown as CatalogFetch);
  const graphApiVersion = params.graphApiVersion ?? "v23.0";
  const maxPages = params.maxPages ?? 50;
  const templates: WhatsappTemplateCatalogItem[] = [];
  let nextUrl: string | null = `https://graph.facebook.com/${graphApiVersion}/${params.wabaId}/message_templates`;
  let page = 0;

  while (nextUrl && page < maxPages) {
    const url = new URL(nextUrl);
    if (url.hostname !== "graph.facebook.com") {
      return {
        templates,
        error: "A Meta retornou uma URL de paginação inválida.",
      };
    }

    url.searchParams.delete("access_token");
    if (page === 0) {
      url.searchParams.set("fields", "id,name,language,status,category,components");
      url.searchParams.set("limit", "100");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);

    try {
      const response = await request(url.toString(), {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${params.accessToken}`,
        },
        signal: controller.signal,
      });
      const payload = await response.json() as MetaTemplatePayload;

      if (!response.ok) {
        return {
          templates,
          error: readMetaError(payload, response.status),
        };
      }

      for (const row of payload.data ?? []) {
        const template = normalizeTemplate(row);
        if (template) templates.push(template);
      }

      nextUrl = typeof payload.paging?.next === "string" ? payload.paging.next : null;
      page += 1;
    } catch (error) {
      return {
        templates,
        error: getErrorMessage(error),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    templates,
    error: null,
  };
}
