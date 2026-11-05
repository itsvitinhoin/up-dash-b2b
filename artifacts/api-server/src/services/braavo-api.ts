import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type BraavoRecord = Record<string, unknown>;
export type BraavoCredentials = {
  domain: string;
  apiToken: string;
  apiKey: string;
};
export class BraavoError extends Error {
  constructor(
    message: string,
    readonly code = "BRAAVO_ERROR",
    readonly status = 502,
  ) {
    super(message);
  }
}

export function normalizeBraavoDomain(value: string): string {
  let url: URL;
  try {
    url = new URL(
      value.includes("://") ? value.trim() : `https://${value.trim()}`,
    );
  } catch {
    throw new BraavoError(
      "Informe um domínio válido para a loja Braavo.",
      "INVALID_DOMAIN",
      400,
    );
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !["/", "/api", "/api/"].includes(url.pathname) ||
    isIP(url.hostname) ||
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(url.hostname) ||
    /\.(local|localhost|internal|test|invalid)$/i.test(url.hostname)
  ) {
    throw new BraavoError(
      "Use apenas o domínio público da loja, sem porta, credenciais ou caminhos adicionais.",
      "INVALID_DOMAIN",
      400,
    );
  }
  url.protocol = "https:";
  if (url.hostname === "lacleo.com.br") url.hostname = "www.lacleo.com.br";
  return url.origin;
}

function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  // Global unicast IPv6 only; excludes loopback, link-local, ULA and IPv4 maps.
  return isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address);
}

export function braavoRecord(value: unknown): BraavoRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new BraavoError("Resposta Braavo com estrutura inválida.");
  return value as BraavoRecord;
}
export function braavoId(value: unknown): string {
  const id = String(value ?? "");
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0)
    throw new BraavoError("Identificador Braavo inválido.");
  return id;
}
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function permanentBusinessError(error: unknown): boolean {
  const message = typeof error === "string"
    ? error
    : error && typeof error === "object"
      ? String((error as BraavoRecord).mensagem ?? (error as BraavoRecord).message ?? "")
      : "";
  return /credenc|credential|token|api.?key|autentic|autoriz|permiss|\bauth\b|obrigat|inv[aá]lid|n[aã]o encontrad|nenhum registro|not found/i.test(message);
}

export class BraavoApi {
  readonly domain: string;
  private validated = false;
  constructor(
    private readonly credentials: BraavoCredentials,
    private readonly options: {
      reserveSlot: (domain: string) => Promise<number>;
      fetch?: typeof fetch;
      resolve?: (hostname: string) => Promise<Array<{ address: string }>>;
      sleep?: (ms: number) => Promise<void>;
      deadline?: number;
    },
  ) {
    this.domain = normalizeBraavoDomain(credentials.domain);
    if (
      !credentials.apiToken.trim() ||
      !credentials.apiKey.trim() ||
      credentials.apiToken.includes(":")
    )
      throw new BraavoError(
        "Configure API Token e API Key da Braavo.",
        "MISSING_CREDENTIALS",
        400,
      );
  }

  async query(path: string, body: BraavoRecord = {}): Promise<BraavoRecord> {
    if (
      !/^\/(?:clientes|categorias|variacoes|produtos|skus|pedidos)\/buscar\/(?:todos|id)$/.test(
        path,
      )
    )
      throw new BraavoError(
        "Consulta Braavo não permitida.",
        "INVALID_ENDPOINT",
        400,
      );
    if (!this.validated) {
      let addresses: Array<{ address: string }> = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        const remaining = (this.options.deadline ?? Date.now() + 30_000) - Date.now();
        if (remaining < 1_000)
          throw new BraavoError("Lote pausado; a próxima execução continuará deste ponto.", "BATCH_DEADLINE", 202);
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          addresses = await Promise.race([
            (this.options.resolve ?? ((hostname) => lookup(hostname, { all: true })))(new URL(this.domain).hostname),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error("DNS timeout")), Math.min(5_000, remaining));
            }),
          ]);
          break;
        } catch {
          if (attempt === 2)
            throw new BraavoError(
              "Não foi possível localizar o domínio da loja Braavo após três tentativas. O ponto salvo foi preservado; aguarde a conexão se recuperar.",
              "BRAAVO_DNS_UNAVAILABLE",
              503,
            );
          await (this.options.sleep ?? pause)(1_000 * 2 ** attempt);
        } finally {
          clearTimeout(timer);
        }
      }
      if (
        !addresses.length ||
        addresses.some(({ address }) => !publicAddress(address))
      )
        throw new BraavoError(
          "O domínio Braavo deve apontar para um endereço público.",
          "INVALID_DOMAIN",
          400,
        );
      this.validated = true;
    }
    const safeBody =
      path === "/pedidos/buscar/id"
        ? {
            id: Number(braavoId(body.id)),
            gravar_status_erp: 0,
            gravar_separando: 0,
          }
        : body;
    for (let attempt = 0; attempt < 3; attempt++) {
      const slot = await this.options.reserveSlot(this.domain);
      const wait = Math.max(0, slot - Date.now());
      const remaining =
        (this.options.deadline ?? Date.now() + 30_000) - Date.now() - wait;
      if (remaining < 1_000)
        throw new BraavoError(
          "Lote pausado; a próxima execução continuará deste ponto.",
          "BATCH_DEADLINE",
          202,
        );
      await (this.options.sleep ?? pause)(wait);
      let response: Response;
      try {
        response = await (this.options.fetch ?? fetch)(
          `${this.domain}/api${path}`,
          {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(Math.min(7_000, remaining)),
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              Authorization: `Basic ${Buffer.from(`${this.credentials.apiToken}:${this.credentials.apiKey}`).toString("base64")}`,
            },
            body: JSON.stringify(safeBody),
          },
        );
      } catch {
        if (attempt < 2) {
          await (this.options.sleep ?? pause)(500 * 2 ** attempt);
          continue;
        }
        throw new BraavoError(
          "Não foi possível consultar a Braavo. Confira o domínio HTTPS e tente novamente.",
        );
      }
      // The shop's protection layer can intercept a valid API POST and return
      // an HTML verification page instead of the API's JSON contract.
      if (
        !response.ok &&
        response.headers.get("content-type")?.includes("text/html") &&
        /<title>\s*Human Verification\s*<\/title>|awswaf-captcha|awswaf-challenge/i.test(
          await response.clone().text(),
        )
      ) {
        await response.body?.cancel();
        throw new BraavoError(
          `A proteção anti-bot da loja bloqueou POST /api${path} (HTTP ${response.status}). Solicite à Braavo a liberação desta rota para acesso autenticado pela API. Os lotes salvos foram preservados; retome a sincronização após a liberação.`,
          "BRAAVO_ACCESS_BLOCKED",
        );
      }
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        await response.body?.cancel();
        await (this.options.sleep ?? pause)(500 * 2 ** attempt);
        continue;
      }
      if (!response.ok)
        throw new BraavoError(
          response.status === 401
            ? "A Braavo recusou a autenticação (HTTP 401). Confira API Token e API Key."
            : `A Braavo recusou POST /api${path} (HTTP ${response.status}). Os lotes salvos foram preservados.`,
        );
      let envelope: BraavoRecord;
      try {
        envelope = braavoRecord(await response.json());
      } catch {
        throw new BraavoError(
          "A Braavo não retornou JSON válido. Confira o domínio e as credenciais.",
        );
      }
      if (
        envelope.erro !== undefined &&
        envelope.erro !== null &&
        envelope.erro !== false &&
        envelope.erro !== "" &&
        envelope.erro !== 0
      ) {
        // Read-only queries sometimes receive a generic HTTP-200 refusal and
        // succeed unchanged later. Confirm those at most twice, with backoff;
        // never retry recognized credential, permission or validation failures.
        if (attempt < 2 && !permanentBusinessError(envelope.erro)) {
          await (this.options.sleep ?? pause)(5_000 * (attempt + 1));
          continue;
        }
        throw new BraavoError(
          `A Braavo recusou POST /api${path}${safeBody.id == null ? "" : ` (registro ${braavoId(safeBody.id)})`}. O ponto de retomada foi preservado; tente sincronizar novamente.`,
          "BRAAVO_BUSINESS_ERROR",
        );
      }
      if (!Array.isArray(envelope.ok))
        throw new BraavoError(
          "A resposta Braavo não contém uma lista válida em ok.",
        );
      return envelope;
    }
    throw new BraavoError("A Braavo excedeu o limite de tentativas.");
  }

  async page(
    path: string,
    page: number,
    limit: number,
    filters: BraavoRecord = {},
  ) {
    const envelope = await this.query(path, {
      ...filters,
      atual: page,
      limite: limit,
    });
    const rows = (envelope.ok as unknown[]).map(braavoRecord);
    const pag = braavoRecord(envelope.pag);
    const current = Number(pag.atual),
      pages = Number(pag.paginas);
    if (
      rows.length > limit ||
      (pages === 0 && rows.length > 0) ||
      !Number.isSafeInteger(current) ||
      current !== page ||
      !Number.isSafeInteger(pages) ||
      pages < 0 ||
      (pages > 0 && current > pages) ||
      (rows.length === 0 && page < pages)
    )
      throw new BraavoError(
        "Paginação Braavo inconsistente; lote não concluído.",
      );
    rows.forEach((row) => braavoId(row.id));
    return { rows, complete: pages === 0 || page >= pages };
  }

  async one(path: string, id: unknown) {
    const envelope = await this.query(path, { id: Number(braavoId(id)) });
    if ((envelope.ok as unknown[]).length !== 1)
      throw new BraavoError(
        "A consulta Braavo não retornou exatamente um registro.",
      );
    const record = braavoRecord((envelope.ok as unknown[])[0]);
    if (braavoId(record.id) !== braavoId(id))
      throw new BraavoError(
        "A Braavo retornou um registro diferente do solicitado.",
      );
    return record;
  }
}
