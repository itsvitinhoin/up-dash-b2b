// Criado 03/09/2026 -- captura evidência de clique de mídia paga por
// EVENTO, usando o endpoint bruto da UpZero (`/analytics/facts`, não o
// agregado por hora `/analytics/metrics`). Achado validando o PDF de
// atribuição da MX Fashion: pra alguns clientes com clique real
// comprovado, o endpoint agregado simplesmente não devolvia o evento
// (nem em 500 registros escaneados), mas o endpoint bruto com filtro por
// `user_id` sempre devolveu certo.
import { db, paidTouchpointsTable, paidTouchpointsSyncTable } from "@workspace/db";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { isPaidCampaignSignal } from "./campaign-attribution";

const UPZERO_BASE = "https://api.upzero.com.br";

// Sem teto real de lookback pra achar touchpoint -- 10 anos é "sem limite"
// na prática, e a API da UpZero exige um `from` concreto. Exportada porque
// recompra-analytics.ts também usa como "desde sempre" fora do contexto de
// touchpoint (fetchAllPositiveEventsForClient).
export const TOUCHPOINT_LOOKBACK_DAYS = 3650;

// Extraída de recompra-analytics.ts em 29/09/2026 (Fase 6) -- era usada só
// lá, mas erp-attribution.ts tinha o mesmo problema que motivou essa
// função em 23/09/2026: ancorar a janela em `dateFrom`/`dateTo` do
// relatório (que muda todo dia pra quem usa "últimos N dias") faz o
// `covered` de paidTouchpointsSyncTable nunca fechar, mesmo com o cache
// pré-aquecido em lote -- o lote ancora em "agora", o relatório ancorava
// em datas do filtro, as duas janelas nunca coincidem. Ancorar em "agora"
// (arredondado pra hora) faz TODO CONSUMIDOR pedir a mesma janela, o que é
// exatamente o que permite o cache convergir. Não piora a atribuição:
// janela mais larga nunca perde touchpoint (`latestTouchpointBefore` já
// filtra "anterior ao pedido" por evento).
// Achado 29/09/2026, mesmo dia, testando MX Fashion ao vivo: arredondar só
// pra hora cheia não bastava -- o lote de pré-aquecimento roda a cada 6h
// (Cloud Scheduler "0 */6 * * *", ver cloudbuild.job.yaml), então `covered`
// só ficava verdadeiro na 1a hora depois de cada rodada (~1 de 6h); no
// resto do ciclo o `to` arredondado pra hora ficava sempre à frente do
// `syncedTo` da última rodada, caindo no fallback ao vivo de novo (piorou
// de 31 pra 58 clientes falhando, testado longe de uma rodada do lote).
// Arredondar pro mesmo bloco de 6h do Scheduler (00h/06h/12h/18h UTC) faz
// o `to` ficar FIXO durante as 6h inteiras entre uma rodada e a próxima.
// Acoplado à cadência do Scheduler de propósito -- se o intervalo do
// trigger mudar, este "6" precisa mudar junto.
const SYNC_BLOCK_HOURS = 6;

export function standardTouchpointWindow(): { lookbackFrom: string; lookbackTo: string } {
  const now = new Date();
  const blockStartHour = Math.floor(now.getUTCHours() / SYNC_BLOCK_HOURS) * SYNC_BLOCK_HOURS;
  now.setUTCHours(blockStartHour, 0, 0, 0);
  const lookbackFrom = new Date(now.getTime() - TOUCHPOINT_LOOKBACK_DAYS * 86_400_000);
  return { lookbackFrom: lookbackFrom.toISOString(), lookbackTo: now.toISOString() };
}

export type UpzeroFact = {
  id: number;
  occurred_at: string;
  event_name: string;
  user_id: number | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  source: string | null;
  channel: string | null;
  fbclid: string | null;
  fbc: string | null;
  gclid: string | null;
};

type UpzeroFactsResponse = {
  data: UpzeroFact[];
  total: number;
  next_cursor: string | null;
};

// O cookie `fbc` da Meta carrega a hora REAL do clique embutida --
// formato `fb.<subdomain_index>.<timestamp_ms>.<fbclid>` -- mesmo quando
// o evento em que ele aparece foi registrado dias depois (o cookie
// persiste no navegador e é reenviado em toda visita seguinte).
// Decodificar isso é o único jeito confiável de saber QUANDO o clique de
// anúncio aconteceu; `occurred_at` do evento é só quando aquela visita
// específica foi registrada, não quando o clique original ocorreu.
export function decodeFbcClickTimestamp(fbc: string | null | undefined): Date | null {
  if (!fbc) return null;
  const parts = fbc.split(".");
  if (parts.length < 3 || parts[0] !== "fb") return null;
  const ts = Number.parseInt(parts[2], 10);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  return new Date(ts);
}

async function fetchUpzeroFactsPage(params: {
  apiKey: string;
  userId: number;
  from: string;
  to: string;
  cursor?: string;
}): Promise<UpzeroFactsResponse> {
  const url = new URL(`${UPZERO_BASE}/external/v1/analytics/facts`);
  url.searchParams.set("from", params.from);
  url.searchParams.set("to", params.to);
  url.searchParams.set("user_id", String(params.userId));
  url.searchParams.set("limit", "500");
  if (params.cursor) url.searchParams.set("cursor", params.cursor);
  // Achado 08/09/2026: sem timeout, um cliente com histórico grande de
  // eventos (até 20 páginas, MAX_PAGES) podia sozinho dominar o tempo do
  // relatório inteiro -- o resto dos clientes já rodava em paralelo, mas
  // esse aqui não tinha teto. 10s por página é generoso pro caso normal e
  // vira erro isolado (fetchErrors) em vez de travar o relatório.
  const res = await fetch(url.toString(), {
    headers: { "X-API-Key": params.apiKey },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`UpZero /analytics/facts falhou (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as UpzeroFactsResponse;
}

export type TouchpointCandidate = {
  occurredAt: Date;
  eventName: string;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  fbc: string | null;
  fbclid: string | null;
  gclid: string | null;
  evidenceKey: string;
  rawEvent: UpzeroFact;
};

// Chave de dedup por clique real (fbc/fbclid/gclid identificam o MESMO
// clique em várias linhas de evento -- só queremos 1 touchpoint por
// clique). Sem identificador, cai pra uma chave sintética por utm+minuto,
// que ainda evita duplicar o mesmo pageview repetido na mesma sessão sem
// perder ocorrências genuinamente separadas no tempo.
function evidenceKeyFor(fact: UpzeroFact): string {
  if (fact.fbc) return `fbc:${fact.fbc}`;
  if (fact.fbclid) return `fbclid:${fact.fbclid}`;
  if (fact.gclid) return `gclid:${fact.gclid}`;
  const minute = fact.occurred_at.slice(0, 16);
  return `utm:${fact.utm_source ?? ""}|${fact.utm_medium ?? ""}|${fact.utm_campaign ?? ""}|${minute}`;
}

export async function fetchPaidTouchpointsForUser(params: {
  apiKey: string;
  userId: number;
  from: string;
  to: string;
}): Promise<TouchpointCandidate[]> {
  const found = new Map<string, TouchpointCandidate>();
  let cursor: string | undefined;
  let pages = 0;
  // Teto defensivo -- 20 páginas * 500 eventos = 10 mil eventos por
  // cliente/janela antes de desistir, evita loop indefinido num cliente
  // com volume anormal de navegação.
  const MAX_PAGES = 20;
  do {
    const page = await fetchUpzeroFactsPage({
      apiKey: params.apiKey,
      userId: params.userId,
      from: params.from,
      to: params.to,
      cursor,
    });
    for (const fact of page.data) {
      if (!isPaidCampaignSignal(fact)) continue;
      const decoded = decodeFbcClickTimestamp(fact.fbc);
      const occurredAt = decoded ?? new Date(fact.occurred_at);
      const key = evidenceKeyFor(fact);
      const existing = found.get(key);
      if (existing && existing.occurredAt <= occurredAt) continue;
      found.set(key, {
        occurredAt,
        eventName: fact.event_name,
        source: fact.utm_source ?? fact.source,
        medium: fact.utm_medium,
        campaign: fact.utm_campaign,
        fbc: fact.fbc,
        fbclid: fact.fbclid,
        gclid: fact.gclid,
        evidenceKey: key,
        rawEvent: fact,
      });
    }
    cursor = page.next_cursor ?? undefined;
    pages++;
  } while (cursor && pages < MAX_PAGES);
  return [...found.values()];
}

export async function savePaidTouchpoints(params: {
  clientId: string;
  customerId: string;
  externalUserId: number;
  touchpoints: TouchpointCandidate[];
}): Promise<number> {
  if (params.touchpoints.length === 0) return 0;
  const values = params.touchpoints.map((t) => ({
    clientId: params.clientId,
    customerId: params.customerId,
    externalUserId: params.externalUserId,
    occurredAt: t.occurredAt,
    eventName: t.eventName,
    source: t.source,
    medium: t.medium,
    campaign: t.campaign,
    fbc: t.fbc,
    fbclid: t.fbclid,
    gclid: t.gclid,
    evidenceKey: t.evidenceKey,
    rawEvent: t.rawEvent,
  }));
  const result = await db
    .insert(paidTouchpointsTable)
    .values(values)
    .onConflictDoNothing({
      target: [paidTouchpointsTable.clientId, paidTouchpointsTable.customerId, paidTouchpointsTable.evidenceKey],
    })
    .returning({ id: paidTouchpointsTable.id });
  return result.length;
}

// Junta busca + gravação pra um cliente específico. `externalUserId` é o
// `user_id` numérico da UpZero (vem de `customersTable.externalId`).
export async function syncPaidTouchpointsForCustomer(params: {
  apiKey: string;
  clientId: string;
  customerId: string;
  externalUserId: number;
  from: string;
  to: string;
}): Promise<{ found: number; saved: number }> {
  const touchpoints = await fetchPaidTouchpointsForUser({
    apiKey: params.apiKey,
    userId: params.externalUserId,
    from: params.from,
    to: params.to,
  });
  const saved = await savePaidTouchpoints({
    clientId: params.clientId,
    customerId: params.customerId,
    externalUserId: params.externalUserId,
    touchpoints,
  });
  await markSynced({ clientId: params.clientId, customerId: params.customerId, from: new Date(params.from), to: new Date(params.to) });
  return { found: touchpoints.length, saved };
}

function rowToTouchpointCandidate(row: {
  occurredAt: Date;
  eventName: string | null;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  fbc: string | null;
  fbclid: string | null;
  gclid: string | null;
  evidenceKey: string;
  rawEvent: unknown;
}): TouchpointCandidate {
  return {
    occurredAt: row.occurredAt,
    eventName: row.eventName ?? "",
    source: row.source,
    medium: row.medium,
    campaign: row.campaign,
    fbc: row.fbc,
    fbclid: row.fbclid,
    gclid: row.gclid,
    evidenceKey: row.evidenceKey,
    rawEvent: row.rawEvent as UpzeroFact,
  };
}

// Registra a janela [from, to] como sincronizada com sucesso pra esse
// cliente -- guarda a UNIÃO com o que já estava sincronizado (nunca
// encolhe a cobertura conhecida).
async function markSynced(params: { clientId: string; customerId: string; from: Date; to: Date }): Promise<void> {
  await db
    .insert(paidTouchpointsSyncTable)
    .values({ clientId: params.clientId, customerId: params.customerId, syncedFrom: params.from, syncedTo: params.to })
    .onConflictDoUpdate({
      target: [paidTouchpointsSyncTable.clientId, paidTouchpointsSyncTable.customerId],
      set: {
        syncedFrom: sql`LEAST(${paidTouchpointsSyncTable.syncedFrom}, EXCLUDED.synced_from)`,
        syncedTo: sql`GREATEST(${paidTouchpointsSyncTable.syncedTo}, EXCLUDED.synced_to)`,
        syncedAt: new Date(),
      },
    });
}

// Achado 08/09/2026: relatório de atribuição pra ~70 clientes levava ~35s
// porque cada cliente custa ~2s numa ida-e-roda na UpZero -- o teto é do
// lado deles (paralelizar do nosso lado não mudou nada em teste real),
// então a saída é não bater lá de novo quando já sabemos a resposta.
// Se [from, to] já está inteiramente dentro do que foi sincronizado antes
// (e essa sincronização é confiável -- janela fechada há mais de 24h, ou
// sincronizada há menos de 6h), lê direto do Postgres. Senão, busca na
// UpZero, salva, e amplia a janela sincronizada.
//
// Achado 08/10/2026 (UP Glass, medido contra o banco real, MX Fashion): a
// Recompra levava 58-77s no touchpoint e devolvia contagens diferentes a
// cada chamada. Causa: a janela padrão termina no início do bloco de 6h
// (`standardTouchpointWindow`), então `windowClosedLongAgo` nunca era
// verdadeiro e o cache só valia por 6h depois do último sync. Cliente que o
// lote não pega (sem pedido nos últimos 90 dias) caía na busca ao vivo da
// janela INTEIRA (10 anos), que estoura o timeout da UpZero (~25s) -- e o
// chamador engolia o erro como "sem touchpoint", mudando o resultado.
// Duas correções, sem mudar o que conta como atribuído:
//  1. `needUntil` (data do último pedido que vai usar o touchpoint): só é
//     preciso cobertura até ali, porque `latestTouchpointBefore` ignora o que
//     vem depois do pedido. Janela que fechou há mais de 24h é confiável.
//  2. Quando precisa atualizar e já existe cobertura desde `from`, busca só o
//     trecho novo (com 24h de folga pra evento que chegou atrasado) em vez
//     dos 10 anos; o `onConflictDoNothing` torna a sobreposição inofensiva.
const TOUCHPOINT_SETTLED_MS = 24 * 60 * 60 * 1000;
const TOUCHPOINT_FRESH_MS = 6 * 60 * 60 * 1000;
const TOUCHPOINT_REFRESH_OVERLAP_MS = 24 * 60 * 60 * 1000;

async function readCachedTouchpoints(params: { clientId: string; customerId: string; from: Date; to: Date }): Promise<TouchpointCandidate[]> {
  const rows = await db
    .select()
    .from(paidTouchpointsTable)
    .where(
      and(
        eq(paidTouchpointsTable.clientId, params.clientId),
        eq(paidTouchpointsTable.customerId, params.customerId),
        gte(paidTouchpointsTable.occurredAt, params.from),
        lte(paidTouchpointsTable.occurredAt, params.to),
      ),
    );
  return rows.map(rowToTouchpointCandidate);
}

export async function getTouchpointsForCustomerCached(params: {
  apiKey: string;
  clientId: string;
  customerId: string;
  externalUserId: number;
  from: string; // ISO
  to: string; // ISO
  needUntil?: string; // ISO -- data do último pedido que usa esse touchpoint (limita a cobertura exigida)
}): Promise<TouchpointCandidate[]> {
  const fromDate = new Date(params.from);
  const toDate = new Date(params.to);
  const needMs = params.needUntil ? Math.min(toDate.getTime(), new Date(params.needUntil).getTime()) : toDate.getTime();

  const [syncState] = await db
    .select()
    .from(paidTouchpointsSyncTable)
    .where(and(eq(paidTouchpointsSyncTable.clientId, params.clientId), eq(paidTouchpointsSyncTable.customerId, params.customerId)));

  const coversStart = Boolean(syncState) && syncState!.syncedFrom.getTime() <= fromDate.getTime();
  const covered = coversStart && syncState!.syncedTo.getTime() >= needMs;
  const windowClosedLongAgo = needMs < Date.now() - TOUCHPOINT_SETTLED_MS;
  const syncedRecently = Boolean(syncState) && Date.now() - syncState!.syncedAt.getTime() < TOUCHPOINT_FRESH_MS;

  if (covered && (windowClosedLongAgo || syncedRecently)) {
    return readCachedTouchpoints({ clientId: params.clientId, customerId: params.customerId, from: fromDate, to: toDate });
  }

  // Já tem cobertura desde `from`: só falta o trecho recente.
  if (coversStart) {
    const refreshFrom = new Date(Math.max(fromDate.getTime(), syncState!.syncedTo.getTime() - TOUCHPOINT_REFRESH_OVERLAP_MS));
    const fresh = await fetchPaidTouchpointsForUser({
      apiKey: params.apiKey,
      userId: params.externalUserId,
      from: refreshFrom.toISOString(),
      to: params.to,
    });
    if (fresh.length > 0) {
      await savePaidTouchpoints({ clientId: params.clientId, customerId: params.customerId, externalUserId: params.externalUserId, touchpoints: fresh });
    }
    await markSynced({ clientId: params.clientId, customerId: params.customerId, from: refreshFrom, to: toDate });
    return readCachedTouchpoints({ clientId: params.clientId, customerId: params.customerId, from: fromDate, to: toDate });
  }

  const touchpoints = await fetchPaidTouchpointsForUser({
    apiKey: params.apiKey,
    userId: params.externalUserId,
    from: params.from,
    to: params.to,
  });
  if (touchpoints.length > 0) {
    await savePaidTouchpoints({ clientId: params.clientId, customerId: params.customerId, externalUserId: params.externalUserId, touchpoints });
  }
  await markSynced({ clientId: params.clientId, customerId: params.customerId, from: fromDate, to: toDate });
  return touchpoints;
}

// Achado 03/09/2026: `latestCampaignEvidenceBefore` (campaign-attribution.ts)
// já implementa exatamente essa seleção pra evidência agregada (o mesmo
// conceito que o PDF chama de "última evidência paga antes do pedido").
// Reaproveitado aqui pro shape de paid_touchpoints já persistido.
export function latestTouchpointBefore(
  touchpoints: { occurredAt: Date }[],
  date: Date,
): { occurredAt: Date } | null {
  const limit = date.getTime();
  let selected: { occurredAt: Date } | null = null;
  let selectedAt = -Infinity;
  for (const touch of touchpoints) {
    const occurredAt = touch.occurredAt.getTime();
    if (!Number.isFinite(occurredAt) || occurredAt > limit || occurredAt < selectedAt) continue;
    selected = touch;
    selectedAt = occurredAt;
  }
  return selected;
}
