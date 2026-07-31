import { BigQuery } from "@google-cloud/bigquery";

const VESTI_PROJECT = "up-vesti-report";

// Em dev, GOOGLE_APPLICATION_CREDENTIALS aponta pro credentials.json do
// script-vesti-nuvem (ADC via arquivo). Na Vercel não existe filesystem
// persistente nem Workload Identity configurado, então lemos a mesma
// service account de uma env var com o JSON inteiro — mesmo padrão já
// usado por services/ga4.ts (GOOGLE_APPLICATION_CREDENTIALS_JSON).
function loadServiceAccountCredentials(): { client_email: string; private_key: string } | null {
  const raw =
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ??
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ??
    null;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { client_email?: string; private_key?: string };
    if (!parsed.client_email || !parsed.private_key) return null;
    return { client_email: parsed.client_email, private_key: parsed.private_key.replace(/\\n/g, "\n") };
  } catch {
    return null;
  }
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
