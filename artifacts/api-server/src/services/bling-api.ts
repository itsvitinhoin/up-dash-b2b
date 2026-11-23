import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";

export class BlingError extends Error {
  constructor(
    message: string,
    readonly code = "BLING_ERROR",
    readonly status = 502,
  ) {
    super(message);
  }
}
export class BlingRateLimitError extends BlingError {
  constructor(
    readonly retryAt: Date,
    readonly period: "second" | "day" | "unknown" = "unknown",
  ) {
    super(
      period === "day"
        ? "Limite diário do Bling atingido. A importação foi pausada; tente novamente amanhã."
        : "O Bling limitou temporariamente as consultas. A importação está pausada e o progresso foi preservado.",
      "BLING_RATE_LIMIT",
      429,
    );
  }
}

export async function blingRateLimitError(
  response: Response,
  now = Date.now(),
) {
  // Read only documented quota metadata. Never forward provider messages or payloads.
  let period: "second" | "day" | "unknown" = "unknown";
  try {
    const quota = object(object(await response.json()).error);
    if (quota.period === "second" || quota.period === "day")
      period = quota.period;
  } catch {
    /* Non-JSON throttling responses still require a cooldown. */
  }
  const header = response.headers.get("retry-after")?.trim();
  let delay = NaN;
  if (header)
    delay = /^\d+(?:\.\d+)?$/.test(header)
      ? Number(header) * 1000
      : Date.parse(header) - now;
  if (!Number.isFinite(delay) || delay <= 0 || delay > 365 * 86400000)
    delay = period === "day" ? 86400000 : period === "second" ? 5000 : 60000;
  return new BlingRateLimitError(new Date(now + Math.max(2000, delay)), period);
}

export type BlingRecord = Record<string, unknown>;
export const record = (value: unknown): BlingRecord => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new BlingError("Resposta do Bling inválida.");
  return value as BlingRecord;
};
export function blingId(value: unknown): string {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    !/^[1-9]\d*$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value))
  )
    throw new BlingError("Identificador do Bling inválido.");
  return String(value);
}
export const text = (value: unknown) =>
  typeof value === "string" || typeof value === "number"
    ? String(value).slice(0, 500)
    : "";
export const object = (value: unknown): BlingRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as BlingRecord)
    : {};
export const number = (value: unknown) => {
  const n = Number(value);
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    !Number.isFinite(n)
  )
    throw new BlingError("Valor numérico ausente ou inválido no Bling.");
  return n;
};
export const hashState = (value: string) =>
  createHash("sha256").update(value).digest("hex");

function encryptionKey() {
  const key = process.env.BLING_TOKEN_ENCRYPTION_KEY ?? "";
  if (!/^[a-f0-9]{64}$/i.test(key))
    throw new BlingError(
      "Configure a proteção das credenciais Bling no servidor.",
      "BLING_NOT_CONFIGURED",
      503,
    );
  return Buffer.from(key, "hex");
}
export type BlingAppCredentials = { clientId: string; clientSecret: string };

export function blingConfig(credentials?: BlingAppCredentials) {
  const clientId = credentials?.clientId ?? process.env.BLING_CLIENT_ID,
    clientSecret = credentials?.clientSecret ?? process.env.BLING_CLIENT_SECRET;
  const redirect = process.env.BLING_REDIRECT_URI;
  let url: URL;
  try {
    url = new URL(redirect ?? "");
  } catch {
    throw new BlingError(
      "Configure a URL de retorno Bling no servidor.",
      "BLING_NOT_CONFIGURED",
      503,
    );
  }
  if (
    !clientId ||
    !clientSecret ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/api/bling/callback" ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      ))
  )
    throw new BlingError(
      "Configure o aplicativo Bling no servidor.",
      "BLING_NOT_CONFIGURED",
      503,
    );
  encryptionKey();
  return { clientId, clientSecret, redirect: url.href };
}
export function sealTokens(value: {
  accessToken: string;
  refreshToken: string;
}) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), ciphertext]
    .map((v) => v.toString("base64url"))
    .join(".");
}
export function openTokens(value: string): {
  accessToken: string;
  refreshToken: string;
} {
  try {
    const [iv, tag, body] = value
      .split(".")
      .map((s) => Buffer.from(s, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    const data = JSON.parse(
      Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8"),
    );
    if (
      typeof data.accessToken !== "string" ||
      typeof data.refreshToken !== "string"
    )
      throw new Error();
    return data;
  } catch {
    throw new BlingError(
      "Não foi possível abrir as credenciais Bling. Verifique a configuração do servidor.",
      "BLING_CREDENTIALS_ERROR",
      503,
    );
  }
}
export async function exchangeBlingToken(
  grant: { code: string } | { refreshToken: string },
  fetcher = fetch,
  credentials?: BlingAppCredentials,
) {
  const config = blingConfig(credentials);
  const body = new URLSearchParams(
    "code" in grant
      ? { grant_type: "authorization_code", code: grant.code }
      : { grant_type: "refresh_token", refresh_token: grant.refreshToken },
  );
  const response = await fetcher(
    "https://api.bling.com.br/Api/v3/oauth/token",
    {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "enable-jwt": "1",
      },
      body,
    },
  );
  if (!response.ok)
    throw new BlingError(
      "A autorização do Bling falhou. Conecte a conta novamente.",
      "BLING_AUTH_FAILED",
      409,
    );
  const data = record(await response.json());
  if (
    typeof data.access_token !== "string" ||
    !data.access_token ||
    typeof data.refresh_token !== "string" ||
    !data.refresh_token ||
    number(data.expires_in) <= 0
  )
    throw new BlingError("Tokens Bling inválidos.");
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + number(data.expires_in) * 1000),
  };
}

export class BlingApi {
  constructor(
    private readonly token: string,
    private readonly reserveSlot: () => Promise<number>,
    private readonly fetcher = fetch,
  ) {}
  async get(path: string, params = new URLSearchParams()): Promise<unknown> {
    if (
      !/^\/(?:canais-venda|produtos|contatos|pedidos\/vendas(?:\/[1-9]\d*)?|estoques\/saldos|empresas\/me\/dados-basicos)$/.test(
        path,
      )
    )
      throw new BlingError(
        "Recurso Bling não permitido.",
        "INVALID_RESOURCE",
        400,
      );
    const wait = Math.max(0, (await this.reserveSlot()) - Date.now());
    if (wait > 2500) throw new BlingRateLimitError(new Date(Date.now() + wait));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    const response = await this.fetcher(
      `https://api.bling.com.br/Api/v3${path}?${params}`,
      {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
        headers: {
          Authorization: `Bearer ${this.token}`,
          "enable-jwt": "1",
          Accept: "application/json",
        },
      },
    );
    if (!response.ok) {
      if (response.status === 401)
        throw new BlingError(
          "Reconecte a conta Bling para renovar a autorização.",
          "BLING_AUTH_FAILED",
          409,
        );
      if (response.status === 403)
        throw new BlingError(
          "O aplicativo Bling precisa de permissão de leitura para este recurso.",
          "BLING_SCOPE_REQUIRED",
          403,
        );
      if (response.status === 429) throw await blingRateLimitError(response);
      throw new BlingError(
        "O Bling não respondeu à consulta. A sincronização pode ser retomada.",
      );
    }
    const data = record(await response.json());
    if (!("data" in data)) throw new BlingError("Resposta do Bling sem dados.");
    return data.data;
  }
  async list(path: string, params: URLSearchParams) {
    const data = await this.get(path, params);
    if (!Array.isArray(data)) throw new BlingError("Lista do Bling inválida.");
    return data.map(record);
  }
}
