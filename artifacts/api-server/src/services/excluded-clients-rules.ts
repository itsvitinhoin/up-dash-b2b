// Lista central de clientes EXCLUÍDOS (regras puras, sem banco nem BigQuery).
//
// O dash é a fonte da verdade (clients.archived_at). Para que os OUTROS programas (script-vesti-nuvem, backend-dash, consultas do
// BigQuery) parem de atualizar quem foi excluído, o dash publica uma tabela no BigQuery (up_global.excluded_clients) e cada job
// pergunta "este dataset / conta de anúncio / propriedade GA4 está na lista?" antes de rodar.
//
// A chave que liga os cadastros é o ID do dataset do BigQuery (o dash lê exatamente o mesmo que o script grava). Para fontes que
// não têm dataset próprio entram também a conta de anúncios (Facebook) e a propriedade do GA4.
//
// Estados: "excluded" = na lixeira (volta se for recuperado); "deleted" = apagado de vez (lápide permanente: sem ela o script,
// que ainda tem o cliente cadastrado, recriaria o dataset que acabamos de apagar).

export const EXCLUDED_CLIENTS_DATASET = "up_global";
export const EXCLUDED_CLIENTS_TABLE = "excluded_clients";

export type ExcludedKind = "dataset" | "meta_ad_account" | "ga4_property";
export type ExcludedState = "excluded" | "deleted";

export type ExcludedRow = {
  kind: ExcludedKind;
  value: string;
  clientId: string;
  clientName: string;
  state: ExcludedState;
  /** ISO 8601 */
  excludedAt: string;
};

export type ClientKeySource = {
  id: string;
  name: string;
  archivedAt: Date | null;
  bigqueryDataset: string | null;
  erpDataset: string | null;
  metaAdAccountId: string | null;
  ga4PropertyId: string | null;
};

export type ClientKey = { kind: ExcludedKind; value: string };

const DATASET_RE = /^[A-Za-z_][A-Za-z0-9_]{0,1023}$/;

// Datasets que NUNCA são de um cliente e nunca podem ser apagados nem entrar na lista.
const PROTECTED_DATASETS = new Set([
  "up_global",
  "stape_dataset",
  "stape_logs",
  "vesti_dados",
  "e081e3cf_6261_4d17_8120_1ff040972c56",
]);

export function isValidDatasetId(value: string | null | undefined): value is string {
  return typeof value === "string" && DATASET_RE.test(value);
}

export function isProtectedDataset(dataset: string): boolean {
  const lower = dataset.toLowerCase();
  return PROTECTED_DATASETS.has(lower) || lower.startsWith("analytics_") || lower.includes("information_schema");
}

/** "act_123", "act=123" e "123" viram "123". Vazio/não numérico = null. */
export function normalizeAdAccountId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/^act[_=]/i, "");
  return /^\d+$/.test(cleaned) ? cleaned : null;
}

/** "properties/123" e "123" viram "123". */
export function normalizeGa4PropertyId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/^properties\//i, "");
  return /^\d+$/.test(cleaned) ? cleaned : null;
}

export function keyOf(key: ClientKey): string {
  return `${key.kind}:${key.value}`;
}

/** Todas as chaves (dataset, conta de anúncios, GA4) de um cliente, já validadas e sem repetição. Datasets protegidos ficam de fora. */
export function clientKeys(client: Pick<ClientKeySource, "bigqueryDataset" | "erpDataset" | "metaAdAccountId" | "ga4PropertyId">): ClientKey[] {
  const keys = new Map<string, ClientKey>();
  const add = (key: ClientKey | null) => {
    if (key) keys.set(keyOf(key), key);
  };
  for (const dataset of [client.bigqueryDataset?.trim(), client.erpDataset?.trim()]) {
    if (isValidDatasetId(dataset) && !isProtectedDataset(dataset)) add({ kind: "dataset", value: dataset });
  }
  const ad = normalizeAdAccountId(client.metaAdAccountId);
  if (ad) add({ kind: "meta_ad_account", value: ad });
  const ga4 = normalizeGa4PropertyId(client.ga4PropertyId);
  if (ga4) add({ kind: "ga4_property", value: ga4 });
  return [...keys.values()];
}

/**
 * Monta a lista completa que deve estar no BigQuery.
 * - cliente na lixeira -> suas chaves, "excluded";
 * - lápides já existentes + as novas (`newlyDeleted`) -> "deleted", permanentes;
 * - uma chave que pertence a algum cliente ATIVO nunca entra (dataset ou conta compartilhados não podem travar quem continua ativo);
 * - mesma chave em dois estados: "deleted" vence.
 */
export function computeExcludedRows(params: {
  clients: ClientKeySource[];
  tombstones: ExcludedRow[];
  newlyDeleted?: ExcludedRow[];
}): ExcludedRow[] {
  const activeKeys = new Set<string>();
  for (const client of params.clients) {
    if (client.archivedAt) continue;
    for (const key of clientKeys(client)) activeKeys.add(keyOf(key));
  }

  const rows = new Map<string, ExcludedRow>();
  for (const client of params.clients) {
    if (!client.archivedAt) continue;
    for (const key of clientKeys(client)) {
      if (activeKeys.has(keyOf(key))) continue;
      rows.set(keyOf(key), {
        kind: key.kind,
        value: key.value,
        clientId: client.id,
        clientName: client.name,
        state: "excluded",
        excludedAt: client.archivedAt.toISOString(),
      });
    }
  }
  for (const tombstone of [...params.tombstones, ...(params.newlyDeleted ?? [])]) {
    if (tombstone.state !== "deleted") continue;
    if (activeKeys.has(keyOf(tombstone))) continue;
    rows.set(keyOf(tombstone), tombstone);
  }
  return [...rows.values()].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
}

/** Lápides para os clientes que estão sendo apagados agora. */
export function tombstonesFor(client: ClientKeySource, now: Date = new Date()): ExcludedRow[] {
  return clientKeys(client).map((key) => ({
    kind: key.kind,
    value: key.value,
    clientId: client.id,
    clientName: client.name,
    state: "deleted" as const,
    excludedAt: now.toISOString(),
  }));
}

export type DatasetSkipReason = "shared" | "protected" | "invalid";

/**
 * Quais datasets do BigQuery podem ser apagados junto com o cliente.
 * Fica de fora: nome inválido, dataset protegido e dataset que outro cliente (ativo ou não) também usa.
 */
export function datasetsToDrop(
  client: Pick<ClientKeySource, "id" | "bigqueryDataset" | "erpDataset">,
  others: Array<Pick<ClientKeySource, "id" | "bigqueryDataset" | "erpDataset">>,
): { targets: string[]; skipped: Array<{ dataset: string; reason: DatasetSkipReason }> } {
  const usedByOthers = new Set<string>();
  for (const other of others) {
    if (other.id === client.id) continue;
    for (const dataset of [other.bigqueryDataset?.trim(), other.erpDataset?.trim()]) {
      if (dataset) usedByOthers.add(dataset);
    }
  }
  const targets: string[] = [];
  const skipped: Array<{ dataset: string; reason: DatasetSkipReason }> = [];
  const seen = new Set<string>();
  for (const raw of [client.bigqueryDataset, client.erpDataset]) {
    const dataset = raw?.trim();
    if (!dataset || seen.has(dataset)) continue;
    seen.add(dataset);
    if (!isValidDatasetId(dataset)) skipped.push({ dataset, reason: "invalid" });
    else if (isProtectedDataset(dataset)) skipped.push({ dataset, reason: "protected" });
    else if (usedByOthers.has(dataset)) skipped.push({ dataset, reason: "shared" });
    else targets.push(dataset);
  }
  return { targets, skipped };
}
