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
