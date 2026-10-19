import { createHash } from "node:crypto";

export type AnalyticsEndpoint = "facts" | "metrics";
type Pause = { retryAfter: Date; reason: "disabled" | "unavailable" | "rate_limited" };
type AvailabilityStore = {
  read(scope: string, endpoint: AnalyticsEndpoint): Promise<Pause | null>;
  pause(scope: string, endpoint: AnalyticsEndpoint, pause: Pause): Promise<void>;
};

export class UpzeroAnalyticsUnavailableError extends Error {
  constructor(readonly endpoint: AnalyticsEndpoint, readonly reason: Pause["reason"], readonly retryAfter: Date) {
    const description = reason === "disabled"
      ? "Consulta de analytics temporariamente desativada pela UP Zero"
      : reason === "rate_limited" ? "Limite de consultas da UP Zero atingido" : "Analytics da UP Zero temporariamente indisponível";
    super(`${description}; nova tentativa a partir de ${retryAfter.toISOString()}`);
    this.name = "UpzeroAnalyticsUnavailableError";
  }
}

// A pausa é compartilhada entre instâncias da Vercel e o job. Guardamos
// somente um hash da chave, o motivo conhecido e a data da próxima tentativa.
const persistentStore: AvailabilityStore = {
  async read(scope, endpoint) {
    const { pool } = await import("@workspace/db");
    const { rows } = await pool.query(`SELECT retry_after AS "retryAfter", reason
      FROM upzero_analytics_availability WHERE scope=$1 AND endpoint=$2 AND retry_after > NOW()`, [scope, endpoint]);
    return (rows[0] as Pause | undefined) ?? null;
  },
  async pause(scope, endpoint, pause) {
    const { pool } = await import("@workspace/db");
    await pool.query(`INSERT INTO upzero_analytics_availability (scope,endpoint,retry_after,reason)
      VALUES ($1,$2,$3,$4) ON CONFLICT (scope,endpoint) DO UPDATE
      SET reason=CASE WHEN EXCLUDED.retry_after >= upzero_analytics_availability.retry_after THEN EXCLUDED.reason ELSE upzero_analytics_availability.reason END,
          retry_after=GREATEST(upzero_analytics_availability.retry_after,EXCLUDED.retry_after)`,
    [scope, endpoint, pause.retryAfter, pause.reason]);
  },
};

export function createAnalyticsFetcher(store: AvailabilityStore) {
  return async (endpoint: AnalyticsEndpoint, apiKey: string, url: string, init: RequestInit = {}): Promise<Response> => {
    const scope = createHash("sha256").update(apiKey).digest("hex");
    const pause = await store.read(scope, endpoint);
    if (pause && pause.retryAfter.getTime() > Date.now()) {
      throw new UpzeroAnalyticsUnavailableError(endpoint, pause.reason, pause.retryAfter);
    }
    const response = await fetch(url, init);
    if (response.status !== 503 && response.status !== 429) return response;

    const text = (await response.text()).slice(0, 2_000);
    const disabled = /temporariamente desativad[ao]|ANALYTICS_(?:DISABLED|READS_DISABLED)/i.test(text);
    const reason: Pause["reason"] = disabled ? "disabled" : response.status === 429 ? "rate_limited" : "unavailable";
    const retryHeader = response.headers?.get("retry-after");
    const retryMs = retryHeader ? (/^\d+$/.test(retryHeader) ? Number(retryHeader) * 1000 : Date.parse(retryHeader) - Date.now()) : 0;
    const delay = Math.max(disabled ? 30 * 60_000 : 5 * 60_000, Math.min(Number.isFinite(retryMs) ? retryMs : 0, 24 * 60 * 60_000));
    const retryAfter = new Date(Date.now() + delay);
    await store.pause(scope, endpoint, { reason, retryAfter });
    throw new UpzeroAnalyticsUnavailableError(endpoint, reason, retryAfter);
  };
}

export const fetchUpzeroAnalytics = createAnalyticsFetcher(persistentStore);
