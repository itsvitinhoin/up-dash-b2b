import { BigQuery } from "@google-cloud/bigquery";

const VESTI_PROJECT = "up-vesti-report";

// Em dev, GOOGLE_APPLICATION_CREDENTIALS aponta pro credentials.json do
// script-vesti-nuvem (ADC via arquivo). Na Vercel não existe filesystem
// persistente nem Workload Identity configurado, então lemos a mesma
// service account de uma env var com o JSON inteiro — mesmo padrão já
// usado por services/ga4.ts (GOOGLE_APPLICATION_CREDENTIALS_JSON).
function parseServiceAccountJson(text: string): { client_email?: string; private_key?: string } | null {
  try {
    return JSON.parse(text) as { client_email?: string; private_key?: string };
  } catch {
    return null;
  }
}

function loadServiceAccountCredentials(): { client_email: string; private_key: string } | null {
  const raw =
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ??
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ??
    null;
  if (!raw) {
    console.warn("[bigquery] GOOGLE_APPLICATION_CREDENTIALS_JSON não definida; usando Application Default Credentials.");
    return null;
  }

  // Aceita tanto o JSON colado direto quanto em base64 — evita problemas
  // de formatação ao colar um valor multi-linha num campo de formulário
  // (Vercel, etc).
  let parsed = parseServiceAccountJson(raw);
  if (!parsed) {
    try {
      parsed = parseServiceAccountJson(Buffer.from(raw, "base64").toString("utf-8"));
    } catch {
      parsed = null;
    }
  }

  if (!parsed) {
    console.error("[bigquery] GOOGLE_APPLICATION_CREDENTIALS_JSON está definida mas não é um JSON válido (nem direto, nem em base64).");
    return null;
  }
  if (!parsed.client_email || !parsed.private_key) {
    console.error("[bigquery] GOOGLE_APPLICATION_CREDENTIALS_JSON não tem client_email/private_key.");
    return null;
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key.replace(/\\n/g, "\n") };
}

const serviceAccountCredentials = loadServiceAccountCredentials();

export const bigquery = serviceAccountCredentials
  ? new BigQuery({ projectId: VESTI_PROJECT, credentials: serviceAccountCredentials })
  : new BigQuery({ projectId: VESTI_PROJECT });

/**
 * Monta uma referência de tabela totalmente qualificada, sanitizando o
 * nome do dataset (nunca interpolar direto — datasets vêm de dado
 * cadastrado por admin, mas isso entra numa string de SQL).
 */
export function vestiTable(dataset: string, table: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(dataset)) {
    throw new Error(`dataset inválido: "${dataset}"`);
  }
  if (!/^[A-Za-z0-9_]+$/.test(table)) {
    throw new Error(`tabela inválida: "${table}"`);
  }
  return `\`${VESTI_PROJECT}.${dataset}.${table}\``;
}
