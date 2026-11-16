import type { Ga4DailyMetrics, Ga4FunnelMetrics } from "./ga4";

// Regras puras do sync diario do GA4 (sem banco), testaveis isoladamente.

const GA4_BACKFILL_DAYS = Number.parseInt(process.env.GA4_BACKFILL_DAYS ?? "400", 10);
const GA4_LOOKBACK_DAYS = Number.parseInt(process.env.GA4_LOOKBACK_DAYS ?? "3", 10);

function positiveOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function shiftDate(value: string, days: number): string {
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function dayRange(from: string, to: string): string[] {
  const days: string[] = [];
  for (let cursor = from; cursor <= to; cursor = shiftDate(cursor, 1)) days.push(cursor);
  return days;
}

// Data de "hoje" em Sao Paulo (UTC-3): evita pedir "amanha" ao GA4 a noite.
export function saoPauloDate(value: Date): string {
  return new Date(value.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function diffDays(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map((part) => Number.parseInt(part, 10));
  const [ty, tm, td] = to.split("-").map((part) => Number.parseInt(part, 10));
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

export function earlierDate(a: string, b: string): string {
  return a <= b ? a : b;
}

// Sem historico guardado (cliente novo ou GA4 recem-ligado): backfill largo
// uma vez. Depois so os ultimos dias, porque o GA4 ainda revisa os numeros de
// ontem e anteontem. `lookbackDays` explicito (LOOKBACK_DAYS) sempre vence.
//
// `lastStoredDay` cobre o job que ficou parado: com so os ultimos 3 dias, quem
// voltasse depois de 2 semanas deixaria um buraco permanente no meio do historico
// (aconteceu em 21/10-03/11 com Giah e Jini). Com ele, a janela recomeca no ultimo
// dia guardado (menos o recuo), limitada ao tamanho do backfill.
export function resolveGa4SyncWindow(params: {
  hasHistory: boolean;
  now?: Date;
  lookbackDays?: number;
  lastStoredDay?: string | null;
}): { from: string; to: string } {
  const to = saoPauloDate(params.now ?? new Date());
  const lookback = positiveOr(GA4_LOOKBACK_DAYS, 3);
  const maxDays = positiveOr(GA4_BACKFILL_DAYS, 400);
  let days: number;
  if (params.lookbackDays && params.lookbackDays > 0) {
    days = params.lookbackDays;
  } else if (!params.hasHistory) {
    days = maxDays;
  } else {
    days = lookback;
    if (params.lastStoredDay) {
      const sinceLast = diffDays(shiftDate(params.lastStoredDay, -(lookback - 1)), to) + 1;
      days = Math.min(maxDays, Math.max(lookback, sinceLast));
    }
  }
  return { from: shiftDate(to, -(days - 1)), to };
}

// Origem do trafego (up_global.ga4_traffic_daily, so no BigQuery): janela PROPRIA. A tabela veio depois do diario e roda isolada (se
// falhar, o diario e os produtos seguem), entao nao pode pegar carona na janela do diario: um dia que ela perdeu nunca mais seria
// refeito. O marcador e o ultimo dia que o job gravou com SUCESSO (sync_jobs.result.trafficTo): sem ele, backfill largo; com ele,
// recomeca dali (menos o recuo), e uma falha so da origem do trafego se recupera sozinha na rodada seguinte.
// null = sem BigQuery neste turno: a origem do trafego nao roda (nao tem copia no Postgres) e o marcador nao anda.
export function resolveGa4TrafficFrom(params: {
  bigQueryAvailable: boolean;
  lastTrafficTo?: string | null;
  lookbackDays?: number;
  now?: Date;
}): string | null {
  if (!params.bigQueryAvailable) return null;
  return resolveGa4SyncWindow({
    hasHistory: Boolean(params.lastTrafficTo),
    lookbackDays: params.lookbackDays,
    lastStoredDay: params.lastTrafficTo,
    now: params.now,
  }).from;
}

// Funil por produto (up_global.ga4_product_funnel_daily, so no BigQuery): mesma ideia da origem do trafego, com marcador proprio
// (sync_jobs.result.productFunnelTo). Sem marcador, backfill largo; com ele, recomeca dali (menos o recuo); null = sem BigQuery neste turno.
export function resolveGa4ProductFunnelFrom(params: {
  bigQueryAvailable: boolean;
  lastProductFunnelTo?: string | null;
  lookbackDays?: number;
  now?: Date;
}): string | null {
  return resolveGa4TrafficFrom({
    bigQueryAvailable: params.bigQueryAvailable,
    lastTrafficTo: params.lastProductFunnelTo,
    lookbackDays: params.lookbackDays,
    now: params.now,
  });
}

// ── Backfill em lote com limite ─────────────────────────────────────────────
// Registrar muitos clientes de uma vez (a descoberta acha dezenas) faria a PRIMEIRA rodada tentar 400 dias de todos: cerca de
// 2 minutos cada, contra o limite de 15 minutos do job horario, que tambem roda UpZero e Meta no mesmo processo. Entao:
// quem esta em dia (janela curta) passa primeiro; backfill largo so comeca se ainda ha tempo e ate N por rodada. O resto
// fica para a rodada seguinte (a cobertura so e gravada quando o cliente termina, entao nada fica pela metade).
export const GA4_WIDE_WINDOW_DAYS = 31;

export function isWideGa4Window(from: string, to: string): boolean {
  return diffDays(from, to) + 1 > GA4_WIDE_WINDOW_DAYS;
}

export function shouldStartGa4Client(params: {
  wide: boolean;
  elapsedMs: number;
  budgetMs: number;
  wideStarted: number;
  maxWide: number;
}): { start: boolean; reason?: "tempo" | "limite" } {
  if (!params.wide) return { start: true };
  if (params.elapsedMs > params.budgetMs) return { start: false, reason: "tempo" };
  if (params.wideStarted >= params.maxWide) return { start: false, reason: "limite" };
  return { start: true };
}

// Cliente que falha LOGO (ex.: sem acesso ao GA4, ~2 s) quase nao gastou tempo da rodada. Se contasse como backfill, os sem acesso
// (que nunca ficam em dia e por isso sao sempre "largos") ocupariam as vagas toda hora e travariam quem vem depois na fila:
// em 06/11 Aiyu ja tomava 1 das 3 vagas, e com Hot Pink e Sonmur sobraria vaga nenhuma para Sooe, Vn11 e Vogabox.
export const GA4_QUICK_FAILURE_MS = 30_000;

export function shouldRefundBackfillSlot(params: { wide: boolean; failed: boolean; elapsedMs: number }): boolean {
  return params.wide && params.failed && params.elapsedMs < GA4_QUICK_FAILURE_MS;
}

// ── Backfill em pedacos (memoria) ───────────────────────────────────────────
// Em 13/11/2026 o backfill de 400 dias da Vivadress (catalogo grande: 700 mil linhas de produto e 800 mil de funil) estourou a memoria do job
// (heap de ~512 MB) porque a busca guardava o periodo INTEIRO antes de gravar. Janela larga passa a ser buscada e gravada em pedacos de
// ate GA4_CHUNK_DAYS dias (padrao 60), do mais antigo para o mais novo: cada pedaco e gravado e solto antes de buscar o proximo.
export const GA4_DEFAULT_CHUNK_DAYS = 60;

export function ga4ChunkDays(): number {
  return Math.floor(positiveOr(Number.parseInt(process.env.GA4_CHUNK_DAYS ?? "", 10), GA4_DEFAULT_CHUNK_DAYS));
}

export type Ga4Window = { from: string; to: string };

// Divide [from, to] em pedacos consecutivos, sem sobra nem sobreposicao, de no maximo `maxDays` dias cada (o ultimo pode ser menor).
// Janela de ate `maxDays` dias volta inteira num pedaco so: a rodada horaria (3 dias) nao muda.
export function splitGa4Window(from: string, to: string, maxDays: number): Ga4Window[] {
  if (from > to) return [];
  const size = Number.isFinite(maxDays) ? Math.max(1, Math.floor(maxDays)) : 1;
  const chunks: Ga4Window[] = [];
  for (let cursor = from; cursor <= to; ) {
    const limit = shiftDate(cursor, size - 1);
    const chunkTo = limit < to ? limit : to;
    chunks.push({ from: cursor, to: chunkTo });
    cursor = shiftDate(chunkTo, 1);
  }
  return chunks;
}

// Inicio efetivo de uma tabela dentro de um pedaco: null = a janela dela ainda nao chega neste pedaco; senao, o maior entre o inicio
// dela e o inicio do pedaco (cada tabela tem a propria janela: o diario costuma ser curto enquanto o funil precisa dos 400 dias).
export function clipGa4Start(start: string | null | undefined, chunk: Ga4Window): string | null {
  if (!start || start > chunk.to) return null;
  return start > chunk.from ? start : chunk.from;
}

// ── Disjuntor por cliente ───────────────────────────────────────────────────
// Em 13/11/2026 o Google devolveu 502 por ~11 horas para 9 propriedades. Cada tentativa gasta ~1 minuto ate o erro voltar, e o sistema
// tentava todas, toda hora: a rodada horaria foi de 6 para 15-22 minutos (limite 30), o backfill de cliente novo ficou sem tempo e o alerta
// de frescor falhou por horas. Depois de GA4_BREAKER_MIN_FAILURES falhas SEGUIDAS e do tipo "o Google nao respondeu" (nunca falta de
// acesso, que falha na hora e se resolve quando alguem libera), o cliente e pulado por N horas (N = falhas seguidas, ate 5) e depois
// tentado de novo; falhando outra vez a pausa cresce. Rodada manual de um cliente ignora o disjuntor. O cliente pausado continua
// aparecendo no check de frescor (sem dado novo ha mais de 6 h = problema), entao a pausa nao esconde nada.
export const GA4_BREAKER_MIN_FAILURES = 2;
export const GA4_BREAKER_MAX_PAUSE_HOURS = 5;
// Os clientes de uma rodada sao tentados em fila (cada falha leva ~1 min): a "hora cheia" da pausa tem folga para o proximo ciclo.
const GA4_BREAKER_SLACK_MS = 20 * 60_000;

// Erro do lado do Google (5xx, cota, rede). NAO inclui falta de permissao, propriedade errada nem erro nosso de gravacao.
export function isTransientGa4Error(message: string | null | undefined): boolean {
  if (!message) return false;
  return (
    /runReport failed: (5\d\d|429)\b/i.test(message) ||
    /resource has been exhausted|resource_exhausted|quota|too many requests|rate limit/i.test(message) ||
    /bad gateway|service unavailable|currently unavailable|gateway timeout|internal error encountered|backend error|deadline exceeded/i.test(message) ||
    /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed|UND_ERR/i.test(message)
  );
}

export type Ga4RecentJob = {
  status: string;
  error: string | null;
  /** Quando o job terminou (ou comecou, se nao ha fim). */
  at: Date;
};

export type Ga4BreakerDecision = { pause: boolean; failures: number; retryAt?: Date };

// `recent` = os ultimos jobs ga4_daily do cliente, do mais novo para o mais antigo (so os que terminaram: done/failed).
export function evaluateGa4Breaker(params: { recent: Ga4RecentJob[]; now: Date }): Ga4BreakerDecision {
  let failures = 0;
  let lastFailureAt: Date | null = null;
  for (const job of params.recent) {
    if (job.status === "done") break;
    if (job.status !== "failed") continue;
    if (!isTransientGa4Error(job.error)) break;
    failures += 1;
    if (!lastFailureAt) lastFailureAt = job.at;
  }
  if (failures < GA4_BREAKER_MIN_FAILURES || !lastFailureAt) return { pause: false, failures };
  const pauseMs = Math.min(failures, GA4_BREAKER_MAX_PAUSE_HOURS) * 3_600_000 - GA4_BREAKER_SLACK_MS;
  const retryAt = new Date(lastFailureAt.getTime() + pauseMs);
  return { pause: params.now.getTime() < retryAt.getTime(), failures, retryAt };
}

// ── Backfill em job proprio ─────────────────────────────────────────────────
// O job de backfill roda a cada poucos minutos. Cliente sem acesso ao GA4 (Aiyu, Hot Pink, Sonmur) nunca fica em dia, e por isso e sempre
// "largo": sem esta espera cada execucao criaria mais uma linha de falha para eles (hoje e uma por hora). Falha que NAO e do Google
// (permissao, propriedade errada) espera mais de 1 hora antes de ser tentada de novo; falha do Google segue o disjuntor.
export const GA4_BACKFILL_RETRY_WAIT_MS = 55 * 60_000;

export function shouldWaitBeforeBackfillRetry(recent: Ga4RecentJob[], now: Date): boolean {
  const last = recent.find((job) => job.status === "done" || job.status === "failed");
  if (!last || last.status !== "failed" || isTransientGa4Error(last.error)) return false;
  return now.getTime() - last.at.getTime() < GA4_BACKFILL_RETRY_WAIT_MS;
}

// O backfill largo (cliente novo, tabela nova, job parado por mais de um mes) nao compete mais com a rodada horaria: com
// GA4_BACKFILL_SEPARATE=1 a rodada horaria deixa os clientes "largos" de fora e o job TASK=ga4_backfill cuida deles, um por vez, com
// tempo proprio. Sem a variavel o comportamento antigo (limite de tempo dentro da rodada horaria) continua valendo.
export function isGa4BackfillSeparate(): boolean {
  const raw = process.env.GA4_BACKFILL_SEPARATE;
  return raw === "1" || raw === "true";
}

export const GA4_DEFAULT_BACKFILL_MAX_CLIENTS = 3;
// Um job "running" mais velho que isto e tratado como processo que caiu (ex.: falta de memoria), nao como outra execucao viva.
export const GA4_DEFAULT_BACKFILL_STALE_MINUTES = 120;

export function ga4BackfillMaxClients(): number {
  return Math.floor(positiveOr(Number.parseInt(process.env.GA4_BACKFILL_MAX_CLIENTS ?? "", 10), GA4_DEFAULT_BACKFILL_MAX_CLIENTS));
}

export function ga4BackfillStaleMinutes(): number {
  return positiveOr(Number.parseFloat(process.env.GA4_BACKFILL_STALE_MINUTES ?? ""), GA4_DEFAULT_BACKFILL_STALE_MINUTES);
}

// ── Produtos: onde guardar ──────────────────────────────────────────────────
// A tabela de visualizacoes de produto do Postgres (ga4_product_views_daily) so e lida pela tela de Produtos do B2C. Cliente B2B nao tem
// tela que a use, e o BigQuery (up_global.ga4_product_views_daily) ja guarda tudo: em 09/11/2026 eram 395 mil linhas de 14 clientes B2B
// (36% da tabela, que sozinha pesava 323 MB de um banco de 1,8 GB, num servidor pequeno) que ninguem lia.
// So deixa de gravar quando o BigQuery esta disponivel NESTE turno; sem ele o Postgres segue sendo o unico destino e nada se perde.
export function shouldStoreGa4ProductViewsInPostgres(params: {
  dashboardType: string | null | undefined;
  bigQueryAvailable: boolean;
}): boolean {
  if (!params.bigQueryAvailable) return true;
  return params.dashboardType !== "B2B";
}

// O GA4 so devolve os dias que tiveram trafego. Preenche os demais com zero
// pra que "existe linha" signifique "este dia ja foi sincronizado".
export function fillGa4Days(from: string, to: string, fetched: Ga4DailyMetrics[]): Ga4DailyMetrics[] {
  const byDate = new Map(fetched.map((row) => [row.date, row]));
  return dayRange(from, to).map(
    (date) =>
      byDate.get(date) ?? {
        date,
        sessions: 0,
        pageViews: 0,
        productViews: 0,
        addToCarts: 0,
        checkouts: 0,
        purchases: 0,
      },
  );
}

// ── Leitura do dado guardado pelas telas de um cliente só ───────────────────
// O funil de um periodo e a soma dos dias (sessoes, pageviews e contagens de
// evento sao aditivos). Mesmo formato que fetchGa4FunnelMetrics devolve.
export function aggregateGa4Rows(rows: Ga4DailyMetrics[]): Ga4FunnelMetrics {
  const total: Ga4FunnelMetrics = {
    sessions: 0,
    pageViews: 0,
    productViews: 0,
    addToCarts: 0,
    checkouts: 0,
    purchases: 0,
    source: "ga4",
  };
  for (const row of rows) {
    total.sessions += row.sessions;
    total.pageViews += row.pageViews;
    total.productViews += row.productViews;
    total.addToCarts += row.addToCarts;
    total.checkouts += row.checkouts;
    total.purchases += row.purchases;
  }
  return total;
}

export const GA4_STORE_MAX_AGE_HOURS = 48;

// O dado guardado so serve se (1) cobre o inicio do periodo pedido -- o
// backfill nao vai alem de GA4_BACKFILL_DAYS, e somar so parte do periodo daria
// um numero menor sem avisar -- e (2) foi atualizado recentemente; se o job
// parou de funcionar pra essa loja, e melhor cair no ao vivo do que mostrar
// numero velho como se fosse atual.
export function isGa4StoreUsable(params: {
  earliestDate: string | null;
  latestSyncedAt: Date | null;
  dateFrom: string;
  now?: Date;
}): boolean {
  if (!params.earliestDate || !params.latestSyncedAt) return false;
  if (params.dateFrom < params.earliestDate) return false;
  const ageMs = (params.now ?? new Date()).getTime() - params.latestSyncedAt.getTime();
  return ageMs <= GA4_STORE_MAX_AGE_HOURS * 60 * 60 * 1000;
}

// ── Visualizacoes de produto por dia ────────────────────────────────────────
export type ProductViewDay = {
  date: string;
  itemId: string | null;
  itemName: string | null;
  itemVariant: string | null;
  views: number;
};

export type StoredProductViewKey = {
  metricDate: string;
  itemId: string;
  itemName: string;
  itemVariant: string;
  views: number;
};

// A chave primaria nao aceita null (null vira ''), e dois itens que so diferem
// por espaco/null caem na mesma chave depois da normalizacao -- somar evita o
// erro "ON CONFLICT ... cannot affect row a second time" no upsert em lote.
export function toStoredProductViews(rows: ProductViewDay[]): StoredProductViewKey[] {
  const byKey = new Map<string, StoredProductViewKey>();
  for (const row of rows) {
    const itemId = (row.itemId ?? "").trim();
    const itemName = (row.itemName ?? "").trim();
    const itemVariant = (row.itemVariant ?? "").trim();
    const key = [row.date, itemId, itemName, itemVariant].join("\u0000");
    const current = byKey.get(key);
    if (current) current.views += row.views;
    else byKey.set(key, { metricDate: row.date, itemId, itemName, itemVariant, views: row.views });
  }
  return [...byKey.values()];
}
