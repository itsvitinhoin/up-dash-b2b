// Descoberta de propriedades GA4: lista, pela Admin API, tudo que a identidade do job enxerga e cruza com os clientes conhecidos.
// SO LE (Admin API + clientes do dash + up_global.dataset_tid_map). Nao grava nada em lugar nenhum; o resultado vai para o log.
// Roda como TASK=ga4_discover, com a MESMA identidade do ga4_daily (conta de servico do job), entao responde exatamente
// "o que o job consegue ler hoje". Regras de cruzamento: ga4-discovery-rules.ts.
import { and, eq, isNull, or } from "drizzle-orm";
import { db, clientsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { BIGQUERY_PROJECT, runQuery, type BigQueryLike } from "./excluded-clients-bq";
import { getGa4AccessToken } from "./ga4";
import {
  buildDiscoveryReport,
  parseAccountSummaries,
  parseDataStreams,
  type DiscoveryEntry,
  type DiscoveryReport,
  selectRegistrations,
  type Ga4KnownClient,
  type Ga4VisibleProperty,
  type Registration,
  type SkippedRegistration,
} from "./ga4-discovery-rules";

const ADMIN_BASE = "https://analyticsadmin.googleapis.com/v1beta";
const STREAM_CONCURRENCY = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function adminGet(path: string, query: Record<string, string> = {}): Promise<unknown> {
  const token = await getGa4AccessToken();
  if (!token) throw new Error("GA4 sem credencial: rode no Cloud Run (identidade do job) ou defina GA4_SERVICE_ACCOUNT_JSON.");
  const url = `${ADMIN_BASE}${path}?${new URLSearchParams(query).toString()}`;
  // Logo depois de ativar a API o Google pode levar alguns minutos para propagar: tenta de novo antes de desistir.
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = (await response.json().catch(() => null)) as { error?: { message?: string; status?: string } } | null;
    if (response.ok && !body?.error) return body;
    const message = body?.error?.message ?? `Admin API falhou: ${response.status}`;
    const notReadyYet = /has not been used|is disabled|SERVICE_DISABLED/i.test(`${message} ${body?.error?.status ?? ""}`);
    if (notReadyYet && attempt < 4) {
      logger.warn({ attempt }, "[ga4-discover] Admin API ainda nao propagou; tentando de novo em 20s");
      await sleep(20_000);
      continue;
    }
    throw new Error(message);
  }
}

/** Todas as propriedades que a identidade enxerga, com os IDs de medicao de cada uma. */
export async function listVisibleProperties(): Promise<{ properties: Ga4VisibleProperty[]; errors: string[] }> {
  const base: Array<Omit<Ga4VisibleProperty, "streams">> = [];
  let pageToken: string | null = null;
  do {
    const page = (await adminGet("/accountSummaries", { pageSize: "200", ...(pageToken ? { pageToken } : {}) })) as Parameters<
      typeof parseAccountSummaries
    >[0];
    const parsed = parseAccountSummaries(page);
    base.push(...parsed.properties);
    pageToken = parsed.nextPageToken;
  } while (pageToken);

  const errors: string[] = [];
  const properties: Ga4VisibleProperty[] = new Array(base.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= base.length) return;
      const property = base[index];
      const streams: Ga4VisibleProperty["streams"] = [];
      try {
        let token: string | null = null;
        do {
          const page = (await adminGet(`/properties/${property.propertyId}/dataStreams`, {
            pageSize: "200",
            ...(token ? { pageToken: token } : {}),
          })) as Parameters<typeof parseDataStreams>[0];
          const parsed = parseDataStreams(page);
          streams.push(...parsed.streams);
          token = parsed.nextPageToken;
        } while (token);
      } catch (err) {
        errors.push(`${property.propertyId} (${property.propertyName}): ${err instanceof Error ? err.message : String(err)}`);
      }
      properties[index] = { ...property, streams };
    }
  }
  await Promise.all(Array.from({ length: Math.min(STREAM_CONCURRENCY, Math.max(base.length, 1)) }, worker));
  return { properties, errors };
}

function normalizeDataset(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/** Clientes do dash (nao arquivados) + IDs de medicao de up_global.dataset_tid_map (a lista dos "TID" do backend antigo). */
export async function loadKnownClients(bq: BigQueryLike | null): Promise<{ known: Ga4KnownClient[]; tidMapRows: number; tidMapError: string | null }> {
  const clients = await db
    .select({
      id: clientsTable.id,
      name: clientsTable.name,
      propertyId: clientsTable.ga4PropertyId,
      measurementId: clientsTable.ga4MeasurementId,
      dataset: clientsTable.bigqueryDataset,
    })
    .from(clientsTable)
    .where(isNull(clientsTable.archivedAt))
    .orderBy(clientsTable.name);

  const tidByDataset = new Map<string, string>();
  let tidMapError: string | null = null;
  if (bq) {
    try {
      const { rows } = await runQuery(bq, {
        query: `SELECT dataset, tid FROM \`${BIGQUERY_PROJECT}.up_global.dataset_tid_map\``,
      });
      for (const row of rows) {
        const dataset = normalizeDataset(String(row.dataset ?? ""));
        const tid = String(row.tid ?? "").trim();
        if (dataset && tid) tidByDataset.set(dataset, tid);
      }
    } catch (err) {
      tidMapError = err instanceof Error ? err.message : String(err);
    }
  }

  const known: Ga4KnownClient[] = [];
  const claimedDatasets = new Set<string>();
  for (const client of clients) {
    const dataset = normalizeDataset(client.dataset);
    const fromMap = dataset ? tidByDataset.get(dataset) : undefined;
    if (dataset && fromMap) claimedDatasets.add(dataset);
    const measurementId = client.measurementId?.trim() || fromMap || null;
    const registered = client.propertyId?.trim() || null;
    // Cliente sem nenhuma pista de GA4 nao entra: nao ha o que procurar.
    if (!measurementId && !registered) continue;
    known.push({
      clientName: client.name,
      clientId: client.id,
      measurementId,
      registeredPropertyId: registered,
      source: client.measurementId?.trim() ? "dash.ga4_measurement_id" : fromMap ? "up_global.dataset_tid_map" : "dash.ga4_property_id",
    });
  }
  // IDs de medicao de datasets que nenhum cliente do dash reivindica (clientes so do backend antigo, ou arquivados).
  for (const [dataset, tid] of tidByDataset) {
    if (claimedDatasets.has(dataset)) continue;
    known.push({ clientName: `${dataset} (fora do dash)`, clientId: null, measurementId: tid, registeredPropertyId: null, source: "up_global.dataset_tid_map" });
  }
  return { known, tidMapRows: tidByDataset.size, tidMapError };
}

const LABEL: Record<DiscoveryEntry["status"], string> = {
  diverge: "DIVERGE      ",
  cadastrar: "CADASTRAR    ",
  cadastrada_invisivel: "SEM-ACESSO   ",
  invisivel: "INVISIVEL    ",
  ja_cadastrada: "OK           ",
};

function describeEntry(entry: DiscoveryEntry): string {
  const parts = [entry.clientName, entry.measurementId ?? "sem G-…"];
  if (entry.registeredPropertyId) parts.push(`cadastrada ${entry.registeredPropertyId}`);
  if (entry.foundPropertyId) parts.push(`achei ${entry.foundPropertyId} "${entry.foundPropertyName ?? ""}"`);
  return `${LABEL[entry.status]}${parts.join(" | ")}`;
}

export type Ga4DiscoverySummary = DiscoveryReport & {
  jobType: "ga4_discover";
  streamErrors: string[];
  tidMapRows: number;
  tidMapError: string | null;
  /** apply=false (padrao): o que SERIA registrado. apply=true: o que foi registrado. */
  apply: boolean;
  registrations: Registration[];
  registrationsSkipped: SkippedRegistration[];
};

/**
 * Grava ga4_property_id so em cliente que ainda NAO tem propriedade (campo vazio). O WHERE repete essa condicao, entao uma
 * corrida com alguem que cadastrou na tela nao sobrescreve nada.
 */
async function applyRegistrations(registrations: Registration[]): Promise<Registration[]> {
  const written: Registration[] = [];
  for (const registration of registrations) {
    const updated = await db
      .update(clientsTable)
      .set({ ga4PropertyId: registration.propertyId })
      .where(and(eq(clientsTable.id, registration.clientId), or(isNull(clientsTable.ga4PropertyId), eq(clientsTable.ga4PropertyId, ""))))
      .returning({ id: clientsTable.id });
    if (updated.length > 0) written.push(registration);
  }
  return written;
}

export async function runGa4Discovery(options: { bq?: BigQueryLike | null; apply?: boolean } = {}): Promise<Ga4DiscoverySummary> {
  let bq: BigQueryLike | null = options.bq ?? null;
  if (options.bq === undefined) {
    try {
      bq = (await import("../lib/bigquery")).bigquery as unknown as BigQueryLike;
    } catch {
      bq = null;
    }
  }

  const { properties, errors } = await listVisibleProperties();
  const { known, tidMapRows, tidMapError } = await loadKnownClients(bq);
  const report = buildDiscoveryReport(properties, known);

  logger.info(
    { ...report.counts, tidMapRows, streamErrors: errors.length },
    `[ga4-discover] a identidade do job enxerga ${report.counts.visibleProperties} propriedade(s) em ${report.counts.visibleAccounts} conta(s); ${report.counts.knownClients} cliente(s) com alguma pista de GA4`,
  );
  if (tidMapError) logger.warn({ err: tidMapError }, "[ga4-discover] nao consegui ler up_global.dataset_tid_map (so os IDs de medicao do dash entram)");
  for (const entry of report.entries) logger.info(`[ga4-discover] ${describeEntry(entry)}`);
  for (const property of report.visibleWithoutClient) {
    const ids = property.streams.map((stream) => stream.measurementId).join(", ") || "sem fluxo web";
    logger.info(`[ga4-discover] SEM-CLIENTE  ${property.propertyId} "${property.propertyName}" (conta: ${property.accountName}) | ${ids}`);
  }
  for (const message of errors) logger.warn(`[ga4-discover] fluxos nao lidos: ${message}`);

  // Registro automatico pelo ID de medicao. Por padrao so MOSTRA o que faria (APPLY=1 grava).
  const apply = options.apply === true;
  const selection = selectRegistrations(report);
  let registrations = selection.apply;
  if (apply) registrations = await applyRegistrations(selection.apply);
  for (const registration of registrations) {
    logger.info(
      `[ga4-discover] ${apply ? "REGISTRADO   " : "REGISTRARIA  "}${registration.clientName} | ${registration.measurementId} -> propriedade ${registration.propertyId}`,
    );
  }
  for (const skipped of selection.skipped) logger.warn(`[ga4-discover] NAO REGISTRA  ${skipped.clientName}: ${skipped.reason}`);
  logger.info(
    { apply, registrations: registrations.length, skipped: selection.skipped.length },
    apply ? "[ga4-discover] registro concluido" : "[ga4-discover] simulacao: nada foi gravado (rode com APPLY=1 para registrar)",
  );

  return {
    jobType: "ga4_discover",
    ...report,
    streamErrors: errors,
    tidMapRows,
    tidMapError,
    apply,
    registrations,
    registrationsSkipped: selection.skipped,
  };
}
