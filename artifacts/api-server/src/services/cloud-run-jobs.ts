import { GoogleAuth } from "google-auth-library";
import { logger } from "../lib/logger";

/**
 * Liga o Cloud Run Job da Braavo para UMA loja (backfill na nuvem), em vez de rodar a
 * carga no navegador. Usa a mesma service account que a API já usa para o BigQuery
 * (GOOGLE_APPLICATION_CREDENTIALS_JSON, JSON direto ou em base64); o papel de editor dela
 * já inclui run.jobs.run e run.jobs.runWithOverrides, então não há permissão nova.
 *
 * Só dois valores de ambiente são enviados, e só o id da loja vem de fora: não dá para
 * trocar a TASK nem outras variáveis do job por esta rota.
 */
const PROJECT = process.env.BRAAVO_CLOUD_RUN_PROJECT || "up-vesti-report";
const REGION = process.env.BRAAVO_CLOUD_RUN_REGION || "us-central1";
const JOB = process.env.BRAAVO_CLOUD_RUN_JOB || "upzero-sync-job-braavo";
/** 24 h: o limite do Cloud Run por execução. A agenda de backfill continua o que sobrar. */
export const BACKFILL_MAX_MINUTES = 1400;
export const BACKFILL_TIMEOUT_SECONDS = 24 * 3600;

export class CloudRunJobError extends Error {
  constructor(
    message: string,
    readonly code = "CLOUD_RUN_ERROR",
  ) {
    super(message);
  }
}

function serviceAccountFromEnv(): { client_email: string; private_key: string } | null {
  const raw =
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ??
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ??
    null;
  if (!raw) return null;
  const tryParse = (text: string) => {
    try {
      return JSON.parse(text) as { client_email?: string; private_key?: string };
    } catch {
      return null;
    }
  };
  const parsed = tryParse(raw) ?? tryParse(Buffer.from(raw, "base64").toString("utf-8"));
  if (!parsed?.client_email || !parsed.private_key) return null;
  return {
    client_email: parsed.client_email,
    private_key: parsed.private_key.replace(/\\n/g, "\n"),
  };
}

export function braavoBackfillRequest(clientId: string) {
  return {
    url: `https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/jobs/${JOB}:run`,
    body: {
      overrides: {
        timeout: `${BACKFILL_TIMEOUT_SECONDS}s`,
        containerOverrides: [
          {
            env: [
              { name: "CLIENT_ID", value: clientId },
              { name: "BRAAVO_JOB_MAX_MINUTES", value: String(BACKFILL_MAX_MINUTES) },
            ],
          },
        ],
      },
    },
  };
}

/** Inicia a execução e devolve o nome dela (sem esperar o fim: a carga leva horas). */
export async function runBraavoBackfillJob(clientId: string): Promise<{ execution: string }> {
  const credentials = serviceAccountFromEnv();
  const auth = new GoogleAuth({
    ...(credentials ? { credentials } : {}),
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const { url, body } = braavoBackfillRequest(clientId);
  try {
    const client = await auth.getClient();
    const response = await client.request<{ metadata?: { name?: string }; name?: string }>({
      url,
      method: "POST",
      data: body,
      timeout: 30_000,
    });
    const execution = response.data?.metadata?.name ?? response.data?.name ?? "";
    logger.info({ clientId, execution }, "[braavo] backfill na nuvem iniciado");
    return { execution };
  } catch (error) {
    // Não devolve o corpo do erro do Google ao navegador (pode trazer detalhes do projeto).
    logger.error(
      { clientId, status: (error as { response?: { status?: number } }).response?.status },
      "[braavo] falha ao iniciar o backfill na nuvem",
    );
    throw new CloudRunJobError(
      "Não foi possível iniciar a carga na nuvem agora. Tente de novo em instantes.",
      "CLOUD_RUN_UNAVAILABLE",
    );
  }
}
