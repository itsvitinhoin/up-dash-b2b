// Criado 03/09/2026 -- captura evidência de clique de mídia paga por
// EVENTO, usando o endpoint bruto da UpZero (`/analytics/facts`, não o
// agregado por hora `/analytics/metrics`). Achado validando o PDF de
// atribuição da MX Fashion: pra alguns clientes com clique real
// comprovado, o endpoint agregado simplesmente não devolvia o evento
// (nem em 500 registros escaneados), mas o endpoint bruto com filtro por
// `user_id` sempre devolveu certo.
import { db, paidTouchpointsTable } from "@workspace/db";
import { isPaidCampaignSignal } from "./campaign-attribution";

const UPZERO_BASE = "https://api.upzero.com.br";

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
  const res = await fetch(url.toString(), { headers: { "X-API-Key": params.apiKey } });
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
  return { found: touchpoints.length, saved };
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
