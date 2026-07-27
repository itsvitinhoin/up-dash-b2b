import { BigQuery } from "@google-cloud/bigquery";

const VESTI_PROJECT = "up-vesti-report";

// Reaproveita a mesma credencial de service account usada pelo
// script-vesti-nuvem (GOOGLE_APPLICATION_CREDENTIALS aponta pro
// credentials.json dele em dev — em produção deve ser Workload Identity,
// sem keyfile).
export const bigquery = new BigQuery({ projectId: VESTI_PROJECT });

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
