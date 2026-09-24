// Criado 21/09/2026 -- Fase 1 da integração de dado real de Performance >
// Recompra (ver "00 - Especificação técnica.pdf" v1.0). Fase 2 (21/09/2026)
// ligou Status/Estado/Vendedora de verdade + tabela de vendedora. Fase 3
// (22/09/2026) ligou Tipo (Anúncios/E-commerce/ERP) + Origem, reaproveitando
// a máquina de touchpoint pago de paid-touchpoints.ts (mesma usada por
// erp-attribution.ts). Ver plano em
// C:\Users\MarceloH\.claude\plans\delegated-cooking-pelican.md.
//
// Modelagem de dado (documentar aqui pq não é óbvio pra quem só olhar o PDF):
// - "Compra positiva anterior" (PDF seção 2.2) É SEMPRE paga/concluída,
//   independente do Status filtrado pro evento atual (PDF seção 6: "Status
//   não muda o histórico positivo"). ERP status=CONCLUIDO; site status IN
//   (APPROVED, SHIPPED, DELIVERED). Isso NUNCA muda com o filtro Status.
// - Semântica de Status pro evento ATUAL (PDF seção 6), aplicada só na
//   busca do recorte P1 (findRecompraCandidates), nunca no histórico:
//   Pago -> status pago/concluído, valor pago (valor_liquido/fulfilledAmount).
//   Solicitado -> QUALQUER status, valor solicitado (valor_total/amount).
//   Em espera -> status pendente, valor solicitado.
//   Cancelado -> status cancelado, valor solicitado.
//   O valor "Em espera"/"Cancelado" usa valor solicitado (grossValue) pq o
//   PDF diz "valor solicitado aplicável" pros três status não-Pago.
// - ERP: dois vocabulários de status confirmados, ambos suportados em
//   ERP_STATUS_BY_FILTER -- Manse (MX Fashion): só CONCLUIDO (100% dos
//   ~42 mil pedidos checados). Miredata (Obzee/Vogabox): FATURADO/
//   FINALIZADO pra "pago" (achado 22/09/2026: ERP_STATUS_BY_FILTER.pago
//   só com CONCLUIDO devolvia ZERO pedidos pro Vogabox, apesar de 35 mil
//   pedidos reais no período -- corrigido incluindo os dois nomes).
//   ESPERA/CANCELADO/EXCLUIDO já convergem nos dois vocabulários.
// - requested_at x paid_at: pedidos_erp NÃO tem campo de data de pagamento
//   separado -- só data_criado/data_alterado. Uso data_criado como proxy
//   dos dois lados no ERP (limitação real da fonte, documentada, não
//   fingida). No site, a distinção existe de verdade: createdAt =
//   requested_at, approvalDate (fallback createdAt se nulo) = paid_at (não
//   usado nessa fase ainda, sem gráficos/bucket).
// - PDF seção 3, passo 3: a data usada pra classificar Recorrente x
//   Reativado é SEMPRE requested_at, mesmo com Status=Pago selecionado.
// - Dedup ERP x Site: mesma heurística já em produção no
//   erp-attribution.ts (mesmo cliente + mesmo dia + mesmo valor = mesma
//   venda, mantém a primeira). Não existe chave real de conciliação entre
//   as duas fontes pra esse cliente hoje -- limitação conhecida.
// - Estado/Vendedora (PDF seção 5): filtram o EVENTO ATUAL, nunca a busca
//   de histórico (findRecompraCandidates recebe os filtros; fetchFullHistory
//   não recebe esses filtros -- histórico sempre da base completa do
//   cliente).
// - Tipo (PDF seção 5): "erp" (padrão, ERP+site reconciliados, sem checar
//   mídia) e "ecommerce" (só site) não custam nada extra. "anuncios-*"
//   busca touchpoint pago por cliente candidato (mesmo padrão de worker
//   pool de erp-attribution.ts, CONCURRENCY=8) e filtra por
//   latestTouchpointBefore em cada evento individualmente -- um cliente
//   pode ter um pedido atribuído e outro não, então o filtro roda por
//   EVENTO, não por cliente inteiro. EXCEÇÃO, cliente Vesti (decisão do
//   usuário, 23/09/2026): "anuncios-*" usa a regra onlyAttributed do
//   legado (ver fetchVestiAttributionSets), e ela filtra também o
//   histórico, contrariando de propósito a regra do PDF citada acima.
//   "anuncios-erp" (ERP direto) SÓ
//   funciona corretamente se o pedido não tiver espelho no E-commerce --
//   como o dedup ERP×site (mesmo dia+valor) já colapsa esse espelho antes
//   daqui, um pedido que originalmente tinha espelho e sobreviveu como
//   "erp" fica indistinguível de um pedido genuinamente só-ERP. Limitação
//   conhecida, sem evidência de acontecer de verdade pro MX Fashion (mesma
//   ressalva já feita em erp-attribution.ts sobre esse dedup).
// - "Origem" (PDF seção 4): SEM fonte de dado fora do universo Anúncios
//   (confirmado empiricamente -- marketplace sempre null, sem UTM em
//   pedidos_erp/clientes_erp pro MX Fashion). Só é computada/filtrável
//   quando Tipo começa com "anuncios-" -- fora disso, o filtro de Origem
//   não tem efeito (não existe dado pra filtrar).
// - Achado 22/09/2026 (validado com dado real MX Fashion, não é bug):
//   "Anúncios > Todos" NÃO é garantidamente superset de "Anúncios > ERP
//   direto" + "Anúncios > E-commerce" em contagem de CLIENTES. Como Tipo
//   decide quais eventos "qualificam" e o histórico é buscado sem filtro de
//   Tipo, alargar o universo pode trazer um evento mais ANTIGO pra dentro
//   do recorte -- se esse evento mais antigo virar o primeiro qualificável
//   e for a primeira compra do cliente (sem positiva anterior), o cliente
//   fica de fora da Recompra inteira sob "Todos", mesmo classificando como
//   Recorrente sob um sub-filtro mais estreito (onde um evento POSTERIOR
//   vira o primeiro qualificável e encontra aquela mesma compra antiga como
//   positiva anterior válida). Comportamento correto e esperado da regra
//   "primeiro evento qualificável" (seção 3) combinada com "Tipo filtra o
//   evento atual, nunca o histórico" (seção 5) -- não deve ser "corrigido"
//   pra forçar monotonicidade entre os sub-filtros. (Vale pro caminho
//   UpZero; pra cliente Vesti o Tipo=Anúncios filtra o histórico também,
//   ver a exceção no item "Tipo" acima.)
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { bigquery, vestiTable } from "../lib/bigquery";
import { db, ordersTable, sellersTable, customersTable } from "@workspace/db";
import { resolveErpCustomerIdentities, type ErpContactInfo } from "./erp-identity";
import { getTouchpointsForCustomerCached, latestTouchpointBefore, type TouchpointCandidate } from "./paid-touchpoints";
import { fetchVestiAttributionSets, isOnlyAttributed, type VestiAttributionSets } from "./vesti-attribution";

const RECORRENTE_THRESHOLD_DAYS = 90;
// Mesma decisão já tomada (e documentada) em erp-attribution.ts: sem teto
// real de lookback pra achar touchpoint -- 10 anos é "sem limite" na
// prática, e a API da UpZero exige um `from` concreto.
const TOUCHPOINT_LOOKBACK_DAYS = 3650;
const TOUCHPOINT_CONCURRENCY = 8;
// Teto conservador só pra classifyRecompraMonthly (Fase 5, carga nova) --
// ver comentário em fetchTouchpointsForCandidates.
const MONTHLY_TOUCHPOINT_CONCURRENCY = 2;

export type RecompraStatusFilter = "solicitado" | "pago" | "espera" | "cancelado";

// CONCLUIDO = vocabulário do Manse (MX Fashion); FATURADO/FINALIZADO =
// vocabulário Miredata (Obzee/Vogabox) pro mesmo conceito de "pago". Os
// dois sincronizadores já convergem em ESPERA/CANCELADO/EXCLUIDO pros
// outros status, só "Pago" divergia -- confirmado empiricamente contra o
// Vogabox (22/09/2026): CONCLUIDO sozinho devolvia zero pedidos.
const ERP_STATUS_BY_FILTER: Record<RecompraStatusFilter, string[] | null> = {
  solicitado: null,
  pago: ["CONCLUIDO", "FATURADO", "FINALIZADO"],
  espera: ["ESPERA"],
  cancelado: ["CANCELADO", "EXCLUIDO"],
};

type SiteStatus = "PENDING" | "APPROVED" | "REJECTED" | "SHIPPED" | "DELIVERED";
const SITE_STATUS_BY_FILTER: Record<RecompraStatusFilter, SiteStatus[]> = {
  solicitado: ["PENDING", "APPROVED", "REJECTED", "SHIPPED", "DELIVERED"],
  pago: ["APPROVED", "SHIPPED", "DELIVERED"],
  espera: ["PENDING"],
  cancelado: ["REJECTED"],
};

// Fase Vesti (22/09/2026) -- clientes commercePlatform=VESTI (~45 dos ~60
// ativos) não têm pedido nem em Postgres (orders/customers, sempre vazios
// pra eles -- confirmado por query direta) nem em pedidos_erp -- a venda
// real está em dashboard_vendas_view (BigQuery, vestiAnalytics.ts). `pago`
// (boolean) é o sinal canônico usado em todo vestiAnalytics.ts -- nunca
// combinado com status_pedido nas queries existentes, então é o padrão
// seguido aqui também. WAITING/ANALYSING contam juntos como "aguardando"
// (mesma decisão já documentada em vestiAnalytics.ts, 26/08/2026).
const VESTI_STATUS_CLAUSE_BY_FILTER: Record<RecompraStatusFilter, string | null> = {
  solicitado: null,
  pago: "v.pago",
  espera: "v.status_pedido IN ('WAITING', 'ANALYSING')",
  cancelado: "v.status_pedido = 'CANCELADO'",
};

// Valores idênticos aos já usados pelo <TipoFilter> do front (performance-
// recompra.tsx) -- sem camada de mapeamento entre os dois.
export type RecompraTipoFilter = "erp" | "ecommerce" | "anuncios-todos" | "anuncios-ecommerce" | "anuncios-erp";

export type RecompraFilters = {
  status: RecompraStatusFilter;
  tipo: RecompraTipoFilter;
  estado?: string;
  vendedora?: string;
  origem?: string; // só tem efeito quando tipo começa com "anuncios-"
};

// Mesmo vocabulário de utm_source já reconhecido como sinal pago em
// campaign-attribution.ts (isPaidCampaignSignal) -- reaproveita a mesma
// lista pra rotular a origem em vez de inventar outra.
function originLabel(source: string | null): string {
  const normalized = (source ?? "").toLowerCase().trim();
  if (["fb", "facebook", "ig", "instagram", "meta"].includes(normalized)) return "Meta Ads";
  if (["google", "google_ads", "googleads", "gads", "gc"].includes(normalized)) return "Google Ads";
  return "Outros";
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function toDate(value: unknown): Date {
  if (value && typeof value === "object" && "value" in (value as Record<string, unknown>)) {
    return new Date(String((value as { value: unknown }).value));
  }
  return new Date(String(value));
}

type PositiveEvent = {
  channel: "erp" | "site" | "vesti";
  orderId: string;
  requestedAt: Date;
  grossValue: number;
  paidValue: number;
  seller: string | null;
  origem: string | null; // só preenchido quando Tipo=Anúncios filtrou esse evento
  document: string | null; // CNPJ/CPF só dígitos (ERP/Vesti); usado pela regra onlyAttributed
};

// Mesma heurística de dedup já usada em erp-attribution.ts (ordersByCustomer):
// mesmo cliente + mesmo dia + mesmo valor bruto = mesma venda, mantém só a
// primeira ocorrência (ERP entra antes do site na lista, então "primeira"
// == ERP quando colidem).
function dedupeSameDaySameValue(events: PositiveEvent[]): PositiveEvent[] {
  const seen = new Set<string>();
  return events.filter((e) => {
    const key = `${e.requestedAt.toISOString().slice(0, 10)}:${e.grossValue.toFixed(2)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Fase 2 Vogabox, achado 22/09/2026 (investigação com dado real, rota de
// diagnóstico temporária): a dedup por PEDIDO individual acima não pega o
// padrão mais comum de duplicação entre ERP e Vesti -- um pedido chega
// picado em várias linhas no ERP no mesmo dia (um por item/parcela),
// enquanto a Vesti registra um único total agregado daquele dia. Medido:
// de 487 combinações cliente+dia com pedido Vesti (amostra de 300
// clientes em comum), 74 batem EXATO somando o ERP do dia inteiro contra
// o total Vesti, mais 28 batem dentro de 10% (arredondamento/desconto) --
// bem mais que a dedup por pedido isolado pega sozinha. Só compara
// canais "erp" x "vesti" (nunca "site", que não tem esse padrão) --
// no-op pra qualquer cliente que não seja do caso raro ERP+Vesti
// combinado (Vogabox), roda sempre, sem custo real nos outros casos.
// ERP fica (mais granular, e já é quem "ganha" empate na dedup por
// pedido acima); Vesti do dia inteiro é descartado quando a soma bate.
function dedupeSameDaySumAcrossErpVesti(events: PositiveEvent[]): PositiveEvent[] {
  const byDay = new Map<string, PositiveEvent[]>();
  for (const e of events) {
    const day = e.requestedAt.toISOString().slice(0, 10);
    const list = byDay.get(day) ?? [];
    list.push(e);
    byDay.set(day, list);
  }
  const toDrop = new Set<PositiveEvent>();
  for (const dayEvents of byDay.values()) {
    const erpEvents = dayEvents.filter((e) => e.channel === "erp");
    const vestiEvents = dayEvents.filter((e) => e.channel === "vesti");
    if (erpEvents.length === 0 || vestiEvents.length === 0) continue;
    const erpSum = erpEvents.reduce((s, e) => s + e.grossValue, 0);
    const vestiSum = vestiEvents.reduce((s, e) => s + e.grossValue, 0);
    if (erpSum <= 0) continue;
    const pctDiff = Math.abs(erpSum - vestiSum) / erpSum;
    if (pctDiff < 0.1) {
      for (const e of vestiEvents) toDrop.add(e);
    }
  }
  return events.filter((e) => !toDrop.has(e));
}

type CustomerIdentity = { upzeroCustomerId: string; name: string | null; cnpjs: Set<string>; externalId: string | null };

function normalizeDocument(value: string): string {
  return value.replace(/\D/g, "");
}

function documentOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return normalizeDocument(String(value)) || null;
}

// Fase 2 Vogabox (22/09/2026): ponte de identidade pro único client com
// pedidos_erp E dashboard_vendas_view ao mesmo tempo. Validado
// empiricamente antes de construir (rota de diagnóstico temporária,
// removida depois de usar): 77% dos documentos de clientes_erp também
// aparecem em clientes_vesti, e existem pedidos "gêmeos" reais (mesmo
// cliente+dia+valor) entre pedidos_erp e dashboard_vendas_view -- as duas
// fontes se sobrepõem de verdade, não são canais independentes. Usada só
// como FALLBACK quando resolveErpCustomerIdentities (via Postgres) não
// resolve -- o caso comum (cliente Vesti puro, sem erpDataset) nunca
// chama isso. ROW_NUMBER: clientes_vesti pode ter documento duplicado
// (cadastro repetido), fica com o mais recente em vez de não-determinismo.
async function resolveVestiDocumentBridge(params: {
  vestiDataset: string;
  documents: string[];
}): Promise<Map<string, { clienteId: string; name: string | null }>> {
  const result = new Map<string, { clienteId: string; name: string | null }>();
  const normalizedDocs = [...new Set(params.documents.map(normalizeDocument).filter(Boolean))];
  if (normalizedDocs.length === 0) return result;
  const clientesTable = vestiTable(params.vestiDataset, "clientes_vesti");
  const [rows] = await bigquery.query({
    query: `
      SELECT id, name, doc FROM (
        SELECT id, name, REGEXP_REPLACE(document, r'\\D', '') AS doc,
          ROW_NUMBER() OVER (PARTITION BY REGEXP_REPLACE(document, r'\\D', '') ORDER BY created_at DESC) AS rn
        FROM ${clientesTable}
        WHERE document IS NOT NULL AND document != ''
      )
      WHERE rn = 1 AND doc IN UNNEST(@docs)
    `,
    params: { docs: normalizedDocs },
  });
  for (const r of rows as Array<{ id: string; name: string | null; doc: string }>) {
    if (!r.doc) continue;
    result.set(r.doc, { clienteId: r.id, name: r.name ?? null });
  }
  return result;
}

// Busca pedidos que atendem o Status filtrado (ver semântica no topo do
// arquivo) no recorte [dateFrom, dateToExclusive) das duas fontes, aplica
// Estado/Vendedora como filtro do evento atual, resolve identidade do lado
// ERP, e devolve só os clientes que tiveram pelo menos um evento
// qualificável no recorte.
async function findRecompraCandidates(params: {
  clientId: string;
  dataset: string | null;
  vestiDataset: string | null;
  dateFrom: string; // YYYY-MM-DD
  dateToExclusive: string; // ISO, exclusivo
  filters: RecompraFilters;
}): Promise<{
  candidates: Map<string, CustomerIdentity>;
  eventsByCustomer: Map<string, PositiveEvent[]>;
  unmatchedErpCount: number;
}> {
  const eventsByCnpj = new Map<string, PositiveEvent[]>();
  const contactByDocument = new Map<string, ErpContactInfo>();
  const nameByCnpj = new Map<string, string | null>();
  const isPago = params.filters.status === "pago";
  const erpStatuses = ERP_STATUS_BY_FILTER[params.filters.status];

  if (params.dataset) {
    const pedidosTable = vestiTable(params.dataset, "pedidos_erp");
    const clientesTable = vestiTable(params.dataset, "clientes_erp");
    const statusClause = erpStatuses ? `AND o.status IN (${erpStatuses.map((s) => `'${s}'`).join(", ")})` : "";
    const [rows] = await bigquery.query({
      query: `
        WITH orders AS (
          SELECT
            pedido_id,
            customer_id,
            ANY_VALUE(status) AS status,
            ANY_VALUE(seller) AS seller,
            ANY_VALUE(valor_total) AS gross_value,
            ANY_VALUE(valor_liquido) AS paid_value,
            ANY_VALUE(data_criado) AS requested_at
          FROM ${pedidosTable}
          WHERE data_criado >= @dateFrom AND data_criado < @dateToExclusive
          GROUP BY pedido_id, customer_id
          HAVING gross_value > 0
        )
        SELECT o.*, c.nome AS customer_name, c.email AS erp_email, c.ddd AS erp_ddd,
          c.celular AS erp_celular, c.telefone AS erp_telefone, c.estado AS erp_state
        FROM orders o
        LEFT JOIN ${clientesTable} c ON c.documento = o.customer_id
        WHERE 1=1 ${statusClause}
          ${params.filters.estado ? "AND c.estado = @estado" : ""}
          ${params.filters.vendedora ? "AND o.seller = @vendedora" : ""}
      `,
      params: {
        dateFrom: params.dateFrom,
        dateToExclusive: params.dateToExclusive,
        ...(params.filters.estado ? { estado: params.filters.estado } : {}),
        ...(params.filters.vendedora ? { vendedora: params.filters.vendedora } : {}),
      },
    });
    for (const r of rows as Array<Record<string, unknown>>) {
      const cnpj = String(r.customer_id ?? "");
      if (!cnpj) continue;
      const grossValue = Number(r.gross_value) || 0;
      const paidValue = isPago ? Number(r.paid_value) || 0 : grossValue;
      const list = eventsByCnpj.get(cnpj) ?? [];
      list.push({
        channel: "erp",
        orderId: String(r.pedido_id),
        requestedAt: toDate(r.requested_at),
        grossValue,
        paidValue,
        seller: (r.seller as string | null) ?? null,
        origem: null,
        document: documentOrNull(cnpj),
      });
      eventsByCnpj.set(cnpj, list);
      if (!nameByCnpj.has(cnpj)) nameByCnpj.set(cnpj, (r.customer_name as string | null) ?? null);
      if (!contactByDocument.has(cnpj)) {
        contactByDocument.set(cnpj, {
          email: (r.erp_email as string | null) ?? null,
          ddd: (r.erp_ddd as string | null) ?? null,
          celular: (r.erp_celular as string | null) ?? null,
          telefone: (r.erp_telefone as string | null) ?? null,
        });
      }
    }
  }

  const erpCustomerIds = [...eventsByCnpj.keys()];
  const { cnpjToHash, hashToCustomer } = await resolveErpCustomerIdentities({
    clientId: params.clientId,
    erpCustomerIds,
    contactByDocument,
  });

  // Fase 2 Vogabox: pra quem NÃO resolve pela via normal (UpZero/Postgres),
  // tenta a ponte via documento contra clientes_vesti antes de desistir --
  // só roda quando o client tem os dois lados ativos (vestiDataset E
  // erpDataset), caso raro. Calcula em lote, uma vez, antes do loop.
  const stillUnresolvedCnpjs = erpCustomerIds.filter((cnpj) => {
    const hash = cnpjToHash.get(cnpj);
    return !hash || !hashToCustomer.get(hash);
  });
  const vestiDocumentBridge = params.vestiDataset && stillUnresolvedCnpjs.length > 0
    ? await resolveVestiDocumentBridge({ vestiDataset: params.vestiDataset, documents: stillUnresolvedCnpjs })
    : new Map<string, { clienteId: string; name: string | null }>();

  const candidates = new Map<string, CustomerIdentity>();
  const eventsByCustomer = new Map<string, PositiveEvent[]>();
  // Declarado aqui (antes do loop ERP) pra também cobrir candidatos que
  // chegam pela ponte Vogabox -- senão caem no backfill de externalId lá
  // embaixo à toa (Postgres nunca tem esses ids, nem os nativos nem os
  // bridged).
  const vestiCustomerIds = new Set<string>();
  let unmatchedErpCount = 0;

  for (const [cnpj, events] of eventsByCnpj) {
    const hash = cnpjToHash.get(cnpj);
    const resolved = hash ? hashToCustomer.get(hash) : undefined;
    if (!resolved) {
      const bridged = vestiDocumentBridge.get(normalizeDocument(cnpj));
      if (bridged) {
        const identity = candidates.get(bridged.clienteId) ?? { upzeroCustomerId: bridged.clienteId, name: bridged.name, cnpjs: new Set<string>(), externalId: null };
        identity.cnpjs.add(cnpj);
        candidates.set(bridged.clienteId, identity);
        vestiCustomerIds.add(bridged.clienteId);
        const list = eventsByCustomer.get(bridged.clienteId) ?? [];
        list.push(...events);
        eventsByCustomer.set(bridged.clienteId, list);
        continue;
      }
      // PDF seção 2.1: sem identidade confiável, não inferir -- não entra
      // em Recompra, só conta pra visibilidade de cobertura.
      unmatchedErpCount += 1;
      continue;
    }
    const identity = candidates.get(resolved.id) ?? { upzeroCustomerId: resolved.id, name: resolved.name ?? nameByCnpj.get(cnpj) ?? null, cnpjs: new Set<string>(), externalId: resolved.externalId };
    identity.cnpjs.add(cnpj);
    candidates.set(resolved.id, identity);
    const list = eventsByCustomer.get(resolved.id) ?? [];
    list.push(...events);
    eventsByCustomer.set(resolved.id, list);
  }

  // Lado site: customer_id já é o customer_id estável, sem resolução.
  const dateFromDate = new Date(`${params.dateFrom}T00:00:00.000Z`);
  const dateToExclusiveDate = new Date(params.dateToExclusive);
  const siteStatuses = SITE_STATUS_BY_FILTER[params.filters.status];
  const siteConditions = [
    eq(ordersTable.clientId, params.clientId),
    gte(ordersTable.createdAt, dateFromDate),
    lt(ordersTable.createdAt, dateToExclusiveDate),
    inArray(ordersTable.status, siteStatuses),
  ];
  if (params.filters.estado) siteConditions.push(eq(ordersTable.state, params.filters.estado));
  const siteQuery = db
    .select({
      id: ordersTable.id,
      customerId: ordersTable.customerId,
      amount: ordersTable.amount,
      fulfilledAmount: ordersTable.fulfilledAmount,
      createdAt: ordersTable.createdAt,
      sellerName: sellersTable.name,
    })
    .from(ordersTable)
    .leftJoin(sellersTable, eq(sellersTable.id, ordersTable.sellerId))
    .where(and(...siteConditions));
  const siteRows = await siteQuery;
  for (const r of siteRows) {
    if (r.amount <= 0) continue;
    if (params.filters.vendedora && r.sellerName !== params.filters.vendedora) continue;
    const identity = candidates.get(r.customerId) ?? { upzeroCustomerId: r.customerId, name: null, cnpjs: new Set<string>(), externalId: null };
    candidates.set(r.customerId, identity);
    const grossValue = r.amount;
    const paidValue = isPago ? r.fulfilledAmount : grossValue;
    const list = eventsByCustomer.get(r.customerId) ?? [];
    list.push({ channel: "site", orderId: r.id, requestedAt: r.createdAt, grossValue, paidValue, seller: r.sellerName ?? null, origem: null, document: null });
    eventsByCustomer.set(r.customerId, list);
  }

  // Lado Vesti: cliente_id da view já é a identidade final, sem resolução
  // (Postgres não tem ninguém pra ligar -- confirmado, customers fica
  // vazio pra client VESTI puro). valor_reservado/valor_solicitado vêm
  // ESPARSOS por pedido na view (só uma linha do pedido carrega o total,
  // as demais trazem 0) -- por isso SUM, nunca ANY_VALUE, nesses dois
  // campos (ver vestiAnalytics.ts:26-29 e fetchVestiOrdersPage).
  if (params.vestiDataset) {
    const vendasView = vestiTable(params.vestiDataset, "dashboard_vendas_view");
    const vestiStatusClause = VESTI_STATUS_CLAUSE_BY_FILTER[params.filters.status];
    // `data_ref` é DATE (não TIMESTAMP) em dashboard_vendas_view -- ao
    // contrário de data_criado do ERP, não aceita comparar com string ISO
    // completa (BigQuery devolve "Invalid date"). Usa só a parte de data
    // do limite exclusivo, mesmo padrão de `BETWEEN @dateFrom AND @dateTo`
    // já usado em vestiAnalytics.ts.
    const vestiDateToExclusive = params.dateToExclusive.slice(0, 10);
    const [vestiRows] = await bigquery.query({
      query: `
        SELECT
          pedido_id,
          ANY_VALUE(cliente_id) AS cliente_id,
          ANY_VALUE(vendedora) AS vendedora,
          ANY_VALUE(estado) AS estado,
          ANY_VALUE(data_ref) AS requested_at,
          ANY_VALUE(documento_cliente) AS documento_cliente,
          SUM(valor_solicitado) AS gross_value,
          SUM(valor_reservado) AS paid_value
        FROM ${vendasView} v
        WHERE v.data_ref >= @dateFrom AND v.data_ref < @dateToExclusive
          ${vestiStatusClause ? `AND ${vestiStatusClause}` : ""}
        GROUP BY pedido_id
        HAVING gross_value > 0
      `,
      params: { dateFrom: params.dateFrom, dateToExclusive: vestiDateToExclusive },
    });
    for (const r of vestiRows as Array<Record<string, unknown>>) {
      const clienteId = String(r.cliente_id ?? "");
      if (!clienteId) continue;
      const vendedora = (r.vendedora as string | null) ?? null;
      const estado = (r.estado as string | null) ?? null;
      if (params.filters.estado && estado !== params.filters.estado) continue;
      if (params.filters.vendedora && vendedora !== params.filters.vendedora) continue;
      const grossValue = Number(r.gross_value) || 0;
      const paidValue = isPago ? Number(r.paid_value) || 0 : grossValue;
      const identity = candidates.get(clienteId) ?? { upzeroCustomerId: clienteId, name: null, cnpjs: new Set<string>(), externalId: null };
      candidates.set(clienteId, identity);
      vestiCustomerIds.add(clienteId);
      const list = eventsByCustomer.get(clienteId) ?? [];
      list.push({ channel: "vesti", orderId: String(r.pedido_id), requestedAt: toDate(r.requested_at), grossValue, paidValue, seller: vendedora, origem: null, document: documentOrNull(r.documento_cliente) });
      eventsByCustomer.set(clienteId, list);
    }
  }

  for (const [customerId, events] of eventsByCustomer) {
    eventsByCustomer.set(
      customerId,
      dedupeSameDaySameValue(dedupeSameDaySumAcrossErpVesti(events)).sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime()),
    );
  }

  // Clientes resolvidos só pelo lado ERP já trazem externalId de
  // resolveErpCustomerIdentities; clientes que só têm pedido no site
  // (customer_id já é o customersTable.id direto) ainda não têm --
  // completa aqui numa única query em lote, só pra quem falta. Candidatos
  // Vesti ficam de fora de propósito -- customers (Postgres) nunca tem
  // esses ids, é busca desperdiçada.
  const missingExternalId = [...candidates.values()].filter((c) => !c.externalId && !vestiCustomerIds.has(c.upzeroCustomerId)).map((c) => c.upzeroCustomerId);
  if (missingExternalId.length > 0) {
    const rows = await db.select({ id: customersTable.id, externalId: customersTable.externalId }).from(customersTable).where(inArray(customersTable.id, missingExternalId));
    for (const r of rows) {
      const identity = candidates.get(r.id);
      if (identity) identity.externalId = r.externalId;
    }
  }

  return { candidates, eventsByCustomer, unmatchedErpCount };
}

// Histórico completo (sem teto de data, sem filtro de Estado/Vendedora --
// PDF seção 5: "Eles não devem apagar a compra histórica anterior") de
// compras positivas por cliente -- mesmo padrão de classifyCohorts em
// erp-attribution.ts, só rodando pros candidatos do recorte.
//
// Exceção deliberada (decisão do usuário, 23/09/2026): com Tipo=Anúncios
// num cliente Vesti, `vestiAttribution` vem preenchido e o histórico é
// filtrado pela mesma regra onlyAttributed do recorte, igual ao legado (lá
// o filtro entra em vendas_base, o histórico inteiro, antes do ROW_NUMBER
// -- backend-dash/src/services/dashboardPerformanceService.ts:4503-4545).
// Efeito: compra de um cliente "consolidado" anterior à data de início da
// marca some, e o primeiro pedido depois dela deixa de contar como
// recompra. Isso contraria a seção 5 do PDF de propósito. O filtro roda
// ANTES da dedup: filtrar primeiro nunca dá resultado menor.
async function fetchFullHistory(params: {
  clientId: string;
  dataset: string | null;
  vestiDataset: string | null;
  candidates: Map<string, CustomerIdentity>;
  vestiAttribution: VestiAttributionSets | null;
}): Promise<Map<string, PositiveEvent[]>> {
  const history = new Map<string, PositiveEvent[]>();
  const customerIds = [...params.candidates.keys()];
  if (customerIds.length === 0) return history;

  if (params.dataset) {
    const allCnpjs = [...new Set(customerIds.flatMap((id) => [...(params.candidates.get(id)?.cnpjs ?? [])]))];
    if (allCnpjs.length > 0) {
      const cnpjToCustomerId = new Map<string, string>();
      for (const [customerId, identity] of params.candidates) {
        for (const cnpj of identity.cnpjs) cnpjToCustomerId.set(cnpj, customerId);
      }
      const pedidosTable = vestiTable(params.dataset, "pedidos_erp");
      // Mesma lista de "pago" do recorte (ERP_STATUS_BY_FILTER): antes era
      // só 'CONCLUIDO' (vocabulário do Manse), o que zerava o histórico ERP
      // dos clientes Miredata (FATURADO/FINALIZADO). Mesmo bug corrigido
      // no recorte em 22/09/2026; esta ocorrência tinha ficado pra trás.
      // Efeito medido no Vogabox (23/09/2026, Tipo=ERP, jan-set/2026): 316
      // -> 270 clientes. Os 46 que saíram eram recompras falsas: sem o
      // gêmeo ERP no histórico, a cópia Vesti do MESMO pedido (data_ref sem
      // hora, meia-noite) sobrava na dedup e ficava "antes" do pedido ERP
      // do recorte (com hora), contando como compra anterior dele mesmo.
      // Com o gêmeo ERP presente, ele vence a dedup e isso não acontece.
      const [rows] = await bigquery.query({
        query: `
          SELECT pedido_id, customer_id, ANY_VALUE(valor_total) AS gross_value, ANY_VALUE(data_criado) AS requested_at
          FROM ${pedidosTable}
          WHERE customer_id IN UNNEST(@cnpjs) AND status IN UNNEST(@positiveStatuses)
          GROUP BY pedido_id, customer_id
          HAVING gross_value > 0
        `,
        params: { cnpjs: allCnpjs, positiveStatuses: ERP_STATUS_BY_FILTER.pago },
      });
      for (const r of rows as Array<Record<string, unknown>>) {
        const customerId = cnpjToCustomerId.get(String(r.customer_id ?? ""));
        if (!customerId) continue;
        const list = history.get(customerId) ?? [];
        list.push({ channel: "erp", orderId: String(r.pedido_id), requestedAt: toDate(r.requested_at), grossValue: Number(r.gross_value) || 0, paidValue: 0, seller: null, origem: null, document: documentOrNull(r.customer_id) });
        history.set(customerId, list);
      }
    }
  }

  const siteRows = await db
    .select({ id: ordersTable.id, customerId: ordersTable.customerId, amount: ordersTable.amount, createdAt: ordersTable.createdAt })
    .from(ordersTable)
    .where(and(eq(ordersTable.clientId, params.clientId), inArray(ordersTable.customerId, customerIds), inArray(ordersTable.status, ["APPROVED", "SHIPPED", "DELIVERED"])));
  for (const r of siteRows) {
    if (r.amount <= 0) continue;
    const list = history.get(r.customerId) ?? [];
    list.push({ channel: "site", orderId: r.id, requestedAt: r.createdAt, grossValue: r.amount, paidValue: 0, seller: null, origem: null, document: null });
    history.set(r.customerId, list);
  }

  // Lado Vesti: mesmo cliente_id dos candidatos, direto (sem cnpjs pra
  // mapear -- só ERP precisa dessa indireção). Sempre pago=true (PDF
  // seção 6: "Status não muda o histórico positivo"), sem teto de data.
  if (params.vestiDataset) {
    const vendasView = vestiTable(params.vestiDataset, "dashboard_vendas_view");
    const [vestiRows] = await bigquery.query({
      query: `
        SELECT pedido_id, ANY_VALUE(cliente_id) AS cliente_id, ANY_VALUE(data_ref) AS requested_at,
          ANY_VALUE(documento_cliente) AS documento_cliente, SUM(valor_solicitado) AS gross_value
        FROM ${vendasView}
        WHERE cliente_id IN UNNEST(@clienteIds) AND pago
        GROUP BY pedido_id
        HAVING gross_value > 0
      `,
      params: { clienteIds: customerIds },
    });
    for (const r of vestiRows as Array<Record<string, unknown>>) {
      const customerId = String(r.cliente_id ?? "");
      if (!customerId) continue;
      const list = history.get(customerId) ?? [];
      list.push({ channel: "vesti", orderId: String(r.pedido_id), requestedAt: toDate(r.requested_at), grossValue: Number(r.gross_value) || 0, paidValue: 0, seller: null, origem: null, document: documentOrNull(r.documento_cliente) });
      history.set(customerId, list);
    }
  }

  const attribution = params.vestiAttribution;
  for (const [customerId, events] of history) {
    const kept = attribution ? events.filter((e) => isOnlyAttributed(e.document, e.requestedAt, attribution)) : events;
    history.set(customerId, dedupeSameDaySameValue(kept));
  }
  return history;
}

// Achado 23/09/2026 (Fase 5): `/recompra/dashboard|detail|sellers` (já
// deduplicados entre si via `fetchClassificationsCached`) e
// `/recompra/monthly-trend` disparam no MESMO carregamento de página --
// concorrentes de verdade, então cada um começava sua PRÓPRIA busca de
// touchpoint pro MESMO cliente ao mesmo tempo (o cache em Postgres de
// `paid-touchpoints.ts` só ajuda quem chega DEPOIS que o primeiro já
// terminou de gravar, não quem começou antes disso). Guarda a PROMISE em
// si, síncrono, antes do await -- diferente de `cached()` (queryCache.ts,
// que só guarda o VALOR já resolvido), isso é o que faz concorrência de
// verdade compartilhar uma única chamada à UpZero em vez de duas.
const inFlightTouchpointFetches = new Map<string, Promise<TouchpointCandidate[]>>();

function getTouchpointsForCustomerDeduped(params: {
  apiKey: string;
  clientId: string;
  customerId: string;
  externalUserId: number;
  from: string;
  to: string;
}): Promise<TouchpointCandidate[]> {
  const key = `${params.clientId}:${params.customerId}:${params.from}:${params.to}`;
  const inFlight = inFlightTouchpointFetches.get(key);
  if (inFlight) return inFlight;
  const promise = getTouchpointsForCustomerCached(params).finally(() => {
    inFlightTouchpointFetches.delete(key);
  });
  inFlightTouchpointFetches.set(key, promise);
  return promise;
}

// Busca touchpoint pago por cliente candidato -- mesmo padrão de worker
// pool de erp-attribution.ts (CONCURRENCY=8: testado com 20 também em
// produção, throttling real do lado da UpZero, 8 nunca deu erro). Só
// chamada quando Tipo=Anúncios (ver classifyRecompra).
async function fetchTouchpointsForCandidates(params: {
  clientId: string;
  upZeroApiKey: string;
  candidates: Map<string, CustomerIdentity>;
  lookbackFrom: string; // ISO
  lookbackTo: string; // ISO
  // Achado 23/09/2026 (Fase 5): o banco de produção tem max_connections=25
  // no total (SHOW max_connections; medido -- 3 reservadas pra superuser,
  // ~21 já em uso na baseline por tráfego real), bem pequeno pra um worker
  // pool de 8 (cada worker faz query no Postgres por cliente dentro de
  // getTouchpointsForCustomerCached). classifyRecompra (dashboard/detail/
  // sellers) já usa 8 concurrency há mais tempo -- não mexo nisso.
  // classifyRecompraMonthly é carga NOVA, rodando no MESMO carregamento de
  // página, com um universo de candidatos tipicamente bem maior (12 meses
  // fixos) -- passa um teto bem mais conservador pra não somar pressão em
  // cima do que já existia. Default preserva o comportamento antigo.
  concurrency?: number;
}): Promise<Map<string, TouchpointCandidate[]>> {
  const touchpointsByCustomer = new Map<string, TouchpointCandidate[]>();
  const entries = [...params.candidates.entries()].filter(([, identity]) => {
    const externalUserId = Number.parseInt(identity.externalId ?? "", 10);
    return Number.isFinite(externalUserId) && externalUserId > 0;
  });
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < entries.length) {
      const i = nextIndex++;
      const [customerId, identity] = entries[i]!;
      const externalUserId = Number.parseInt(identity.externalId ?? "", 10);
      try {
        const touchpoints = await getTouchpointsForCustomerDeduped({
          apiKey: params.upZeroApiKey,
          clientId: params.clientId,
          customerId,
          externalUserId,
          from: params.lookbackFrom,
          to: params.lookbackTo,
        });
        touchpointsByCustomer.set(customerId, touchpoints);
      } catch {
        // Cliente com erro de busca fica sem touchpoint -- não trava o
        // resto do relatório (mesma postura de erp-attribution.ts).
        touchpointsByCustomer.set(customerId, []);
      }
    }
  }
  const concurrency = params.concurrency ?? TOUCHPOINT_CONCURRENCY;
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, () => worker()));
  return touchpointsByCustomer;
}

// Achado 23/09/2026 (Fase 5, validando ao vivo): `classifyRecompra` e
// `classifyRecompraMonthly` calculavam `lookbackFrom` RELATIVO ao próprio
// `dateFrom` de cada chamada -- como as duas têm `dateFrom` diferente (P1
// escolhido pelo usuário vs sempre 12 meses fixos), a janela de touchpoint
// nunca batia entre as duas, e o cache por cliente do Postgres
// (`paid-touchpoints.ts`, `paidTouchpointsSyncTable`) não conseguia
// reaproveitar nada entre elas -- medido: MX Fashion, Tipo=Anúncios,
// primeira carga da página batia a API da UpZero DUAS VEZES em paralelo
// (Blocos + gráfico mensal), ~90-180s cada, um sobre o outro. Como
// TOUCHPOINT_LOOKBACK_DAYS já é "sem teto real" (mesma decisão de
// erp-attribution.ts), não tem motivo pra ancorar em `dateFrom` -- ancorar
// em "agora" faz TODAS as chamadas desse arquivo pedirem exatamente a
// mesma janela, e uma janela mais larga nunca piora a atribuição
// (`latestTouchpointBefore` já filtra só o que é anterior a cada evento).
// Arredondado pra hora cheia (UTC) -- sem isso, duas chamadas concorrentes
// (ex: /dashboard e /monthly-trend, cada uma com seu próprio `new Date()`)
// gerariam strings de `to` diferentes por alguns milissegundos, quebrando
// tanto o `covered` de paidTouchpointsSyncTable quanto a chave de
// `getTouchpointsForCustomerDeduped` acima -- os dois dependem de bater a
// string exata. Arredondar não piora a atribuição (mesmo raciocínio da
// janela larga: só corta uma fatia de minutos no fim, irrelevante pra
// achar touchpoint anterior a um pedido histórico).
function standardTouchpointWindow(): { lookbackFrom: string; lookbackTo: string } {
  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  const lookbackFrom = new Date(now.getTime() - TOUCHPOINT_LOOKBACK_DAYS * 86_400_000);
  return { lookbackFrom: lookbackFrom.toISOString(), lookbackTo: now.toISOString() };
}

// ───────── Tipo=Anúncios pra cliente Vesti: regra `onlyAttributed` ─────────
//
// Decisão do usuário (23/09/2026): cliente Vesti segue a regra
// `onlyAttributed` do dashboard legado, replicada em ./vesti-attribution
// (extraída daqui em 23/09/2026, Fase 4, pra ser reusada também em
// fetchVestiAttributedCustomers/fetchVestiMarketingData/fetchVestiUtmData
// e matchErpDocumentsWithVestiAttribution -- ver esse arquivo pra
// documentação completa da regra e da lista de datas de início).
// Substituiu uma versão de 22/09 que lia cliques brutos do stape_logs por
// e-mail: ela prometia distinguir Meta de Google, mas no dado real quase
// todo clique chega como utm_source=up_agency, e a regra não batia com a
// definição de "atribuído" do legado nem da tela de Marketing daqui.

// Aplica o universo de Tipo (PDF seção 5) e o filtro de Origem sobre os
// eventos do recorte -- por EVENTO, não por cliente inteiro (um cliente
// pode ter um pedido atribuído à mídia e outro não). Devolve um Map novo,
// já sem clientes que ficaram sem nenhum evento depois do filtro.
//
// `vestiAttribution` não nulo = cliente Vesti: a atribuição vem da regra
// onlyAttributed (ver fetchVestiAttributionSets) em vez de touchpoint, pra
// todos os canais do cliente (Vesti puro só tem "vesti"; o Vogabox também
// tem "erp"). O legado não tem plataforma de mídia pro lado Vesti, então a
// origem é sempre "Outros". Aqui o filtro roda DEPOIS da dedup do recorte
// (findRecompraCandidates); no histórico roda antes. A ordem só faria
// diferença se o documento da view divergisse do documento da ponte ERP.
function applyTipoAndOrigemFilter(
  eventsByCustomer: Map<string, PositiveEvent[]>,
  filters: RecompraFilters,
  touchpointsByCustomer: Map<string, TouchpointCandidate[]> | null,
  vestiAttribution: VestiAttributionSets | null,
): Map<string, PositiveEvent[]> {
  if (filters.tipo === "erp") return eventsByCustomer; // universo default, sem filtro

  const filtered = new Map<string, PositiveEvent[]>();
  for (const [customerId, events] of eventsByCustomer) {
    const touchpoints = touchpointsByCustomer?.get(customerId) ?? [];
    const kept: PositiveEvent[] = [];
    for (const event of events) {
      if (filters.tipo === "ecommerce") {
        if (event.channel === "site") kept.push(event);
        continue;
      }
      // A partir daqui, algum "anuncios-*".
      let origem: string;
      if (vestiAttribution) {
        if (!isOnlyAttributed(event.document, event.requestedAt, vestiAttribution)) continue;
        origem = "Outros";
      } else {
        // PDF seção 5: "Uma vez identificado touchpoint pago válido
        // anterior ao pedido..." / "Touchpoint posterior ao pedido nunca
        // atribui retroativamente".
        const evidence = latestTouchpointBefore(touchpoints, event.requestedAt);
        if (!evidence) continue;
        const full = touchpoints.find((t) => t.occurredAt.getTime() === evidence.occurredAt.getTime());
        origem = originLabel(full?.source ?? null);
      }
      if (filters.tipo === "anuncios-ecommerce" && event.channel !== "site") continue;
      if (filters.tipo === "anuncios-erp" && event.channel !== "erp") continue;
      if (filters.origem && origem !== filters.origem) continue;
      kept.push({ ...event, origem });
    }
    if (kept.length > 0) filtered.set(customerId, kept);
  }
  return filtered;
}

export type RecompraSegment = "recorrente" | "reativado";

export type CustomerClassification = {
  upzeroCustomerId: string;
  name: string | null;
  segment: RecompraSegment;
  firstQualifyingEventAt: Date;
  lastPositiveOrderBeforeAt: Date;
  intervalDays: number;
  seller: string | null; // vendedora do evento classificador (primeiro evento do recorte)
  origem: string | null; // origem do evento classificador (só fora de null com Tipo=Anúncios)
  qualifyingEvents: PositiveEvent[]; // eventos do recorte já usados pra classificar esse cliente
};

// PDF seção 3, algoritmo por cliente: primeira recompra qualificável no
// recorte -> última compra positiva estritamente anterior (histórico
// completo, sempre paga/concluída) -> intervalo_dias -> Recorrente (<=90)
// ou Reativado (>90). Cliente sem compra positiva anterior não entra em
// Recompra (PDF seção 23: não classificar como Reativado por falta de
// histórico).
export async function classifyRecompra(params: {
  clientId: string;
  dataset: string | null;
  vestiDataset: string | null; // cliente commercePlatform=VESTI, com ou sem erpDataset (ver ponte Vogabox)
  upZeroApiKey: string | null; // usado só com Tipo=Anúncios em cliente que não é Vesti
  dateFrom: string;
  dateTo: string; // último dia incluído
  filters: RecompraFilters;
}): Promise<{ classifications: CustomerClassification[]; unmatchedErpCount: number; attributionUnavailable: boolean }> {
  const dateToExclusive = new Date(`${params.dateTo}T00:00:00.000Z`);
  dateToExclusive.setUTCDate(dateToExclusive.getUTCDate() + 1);
  const isAnuncios = params.filters.tipo.startsWith("anuncios");

  // Cliente Vesti com Tipo=Anúncios: a atribuição vem da regra
  // onlyAttributed do legado (ver fetchVestiAttributionSets), não de
  // touchpoint. Os conjuntos não dependem dos candidatos, então são
  // buscados em paralelo.
  const [{ candidates, eventsByCustomer: rawEventsByCustomer, unmatchedErpCount }, vestiAttribution] = await Promise.all([
    findRecompraCandidates({
      clientId: params.clientId,
      dataset: params.dataset,
      vestiDataset: params.vestiDataset,
      dateFrom: params.dateFrom,
      dateToExclusive: dateToExclusive.toISOString(),
      filters: params.filters,
    }),
    isAnuncios && params.vestiDataset ? fetchVestiAttributionSets(params.vestiDataset) : Promise.resolve(null),
  ]);

  // Cliente não-Vesti com Tipo=Anúncios precisa de touchpoint pago da
  // UpZero -- só busca (caro, chamada externa por cliente) quando o filtro
  // realmente pede. Sem chave UpZero configurada, o universo Anúncios fica
  // vazio (sinalizado em attributionUnavailable) em vez de quebrar o
  // relatório.
  let touchpointsByCustomer: Map<string, TouchpointCandidate[]> | null = null;
  let attributionUnavailable = false;
  if (isAnuncios && !vestiAttribution) {
    if (!params.upZeroApiKey) {
      attributionUnavailable = true;
    } else {
      const { lookbackFrom, lookbackTo } = standardTouchpointWindow();
      touchpointsByCustomer = await fetchTouchpointsForCandidates({
        clientId: params.clientId,
        upZeroApiKey: params.upZeroApiKey,
        candidates,
        lookbackFrom,
        lookbackTo,
      });
    }
  }
  const eventsByCustomer = attributionUnavailable
    ? new Map<string, PositiveEvent[]>()
    : applyTipoAndOrigemFilter(rawEventsByCustomer, params.filters, touchpointsByCustomer, vestiAttribution);

  const history = await fetchFullHistory({
    clientId: params.clientId,
    dataset: params.dataset,
    vestiDataset: params.vestiDataset,
    candidates,
    vestiAttribution,
  });

  const classifications: CustomerClassification[] = [];
  for (const [customerId, identity] of candidates) {
    const events = eventsByCustomer.get(customerId) ?? [];
    if (events.length === 0) continue;
    const firstEvent = events[0]!; // já ordenado por requestedAt asc
    const priorPositives = (history.get(customerId) ?? []).filter((e) => e.requestedAt.getTime() < firstEvent.requestedAt.getTime());
    if (priorPositives.length === 0) continue; // sem compra positiva anterior: não é recompra

    const lastBefore = priorPositives.reduce((latest, e) => (e.requestedAt.getTime() > latest.requestedAt.getTime() ? e : latest));
    const intervalDays = Math.round((firstEvent.requestedAt.getTime() - lastBefore.requestedAt.getTime()) / 86_400_000);
    const segment: RecompraSegment = intervalDays <= RECORRENTE_THRESHOLD_DAYS ? "recorrente" : "reativado";

    classifications.push({
      upzeroCustomerId: customerId,
      name: identity.name,
      segment,
      firstQualifyingEventAt: firstEvent.requestedAt,
      lastPositiveOrderBeforeAt: lastBefore.requestedAt,
      intervalDays,
      seller: firstEvent.seller,
      origem: firstEvent.origem,
      qualifyingEvents: events,
    });
  }

  return { classifications, unmatchedErpCount, attributionUnavailable };
}

export type RecompraIntervalBucket = { faixa: string; clientes: number; grupo: RecompraSegment };

// Faixas idênticas ao mock que este bloco substitui (Fase 5,
// performance-recompra.tsx). `grupo` é só rótulo visual (cor da barra no
// front) -- a fronteira real Recorrente/Reativado continua sendo
// RECORRENTE_THRESHOLD_DAYS (90), já refletida no cliente através do
// `segment` de cada CustomerClassification.
const INTERVAL_BUCKET_DEFS: Array<{ faixa: string; min: number; max: number | null; grupo: RecompraSegment }> = [
  { faixa: "Até 30", min: 0, max: 30, grupo: "recorrente" },
  { faixa: "31-60", min: 31, max: 60, grupo: "recorrente" },
  { faixa: "61-90", min: 61, max: 90, grupo: "recorrente" },
  { faixa: "91-180", min: 91, max: 180, grupo: "reativado" },
  { faixa: "181-365", min: 181, max: 365, grupo: "reativado" },
  { faixa: ">365", min: 366, max: null, grupo: "reativado" },
];

function buildIntervalBuckets(classifications: CustomerClassification[]): RecompraIntervalBucket[] {
  return INTERVAL_BUCKET_DEFS.map((def) => ({
    faixa: def.faixa,
    grupo: def.grupo,
    clientes: classifications.filter((c) => c.intervalDays >= def.min && (def.max === null || c.intervalDays <= def.max)).length,
  }));
}

export type RecompraBlocks = {
  recompra: { faturamento: number; vendas: number; clientes: number; ticketMedio: number | null };
  recorrentes: { faturamento: number; vendas: number; clientes: number; ticketMedio: number | null };
  reativados: { faturamento: number; vendas: number; clientes: number; ticketMedio: number | null };
  ciclo: { tempoMedioDias: number | null; medianaDias: number | null; pctRecorrente: number | null; pctReativado: number | null };
  intervalBuckets: RecompraIntervalBucket[]; // Fase 5 -- gráfico "Intervalo entre compras", segue P1/P2 igual aos blocos
  unmatchedErpCount: number;
  attributionUnavailable: boolean; // true quando Tipo=Anúncios foi pedido mas o cliente não tem chave UpZero
};

function blockFor(classifications: CustomerClassification[]): { faturamento: number; vendas: number; clientes: number; ticketMedio: number | null } {
  let faturamento = 0;
  let vendas = 0;
  for (const c of classifications) {
    for (const e of c.qualifyingEvents) {
      faturamento += e.paidValue;
      vendas += 1;
    }
  }
  return { faturamento, vendas, clientes: classifications.length, ticketMedio: vendas > 0 ? faturamento / vendas : null };
}

export function aggregateBlocks(classifications: CustomerClassification[], unmatchedErpCount: number, attributionUnavailable = false): RecompraBlocks {
  const recorrentes = classifications.filter((c) => c.segment === "recorrente");
  const reativados = classifications.filter((c) => c.segment === "reativado");
  const intervals = classifications.map((c) => c.intervalDays);
  const tempoMedioDias = intervals.length > 0 ? intervals.reduce((sum, d) => sum + d, 0) / intervals.length : null;

  return {
    recompra: blockFor(classifications),
    recorrentes: blockFor(recorrentes),
    reativados: blockFor(reativados),
    ciclo: {
      tempoMedioDias,
      medianaDias: median(intervals),
      pctRecorrente: classifications.length > 0 ? (recorrentes.length / classifications.length) * 100 : null,
      pctReativado: classifications.length > 0 ? (reativados.length / classifications.length) * 100 : null,
    },
    intervalBuckets: buildIntervalBuckets(classifications),
    unmatchedErpCount,
    attributionUnavailable,
  };
}

export type RecompraDetailRow = {
  customerId: string;
  cliente: string | null;
  dataEvento: string; // ISO
  diasDesde: number;
  tipo: RecompraSegment;
  vendedora: string | null;
  origem: string | null;
  faturamentoNoPeriodo: number;
  vendasNoPeriodo: number;
  codigoPedido: string; // do evento classificador (primeira recompra qualificável)
  ultimaCompraAnterior: string; // ISO
};

export function buildDetailRows(classifications: CustomerClassification[]): RecompraDetailRow[] {
  return classifications.map((c) => ({
    customerId: c.upzeroCustomerId,
    cliente: c.name,
    dataEvento: c.firstQualifyingEventAt.toISOString(),
    diasDesde: c.intervalDays,
    tipo: c.segment,
    vendedora: c.seller,
    origem: c.origem,
    faturamentoNoPeriodo: c.qualifyingEvents.reduce((sum, e) => sum + e.paidValue, 0),
    vendasNoPeriodo: c.qualifyingEvents.length,
    codigoPedido: c.qualifyingEvents[0]?.orderId ?? "",
    ultimaCompraAnterior: c.lastPositiveOrderBeforeAt.toISOString(),
  }));
}

// PDF seção 17 -- Desempenho por vendedora: uma linha por vendedora
// responsável pelo evento classificador do cliente (não fragmenta um
// cliente entre vendedoras diferentes, igual os Blocos não fragmentam um
// cliente entre Recorrente/Reativado). Ordenado por faturamento desc
// (padrão da seção). Não recebe P2 (seção 19, matriz da seção 20).
export type RecompraSellerRow = {
  vendedora: string;
  clientesRecompra: number;
  clientesRecorrentes: number;
  clientesReativados: number;
  vendas: number;
  faturamento: number;
  ticketMedio: number | null;
};

export function buildSellerRows(classifications: CustomerClassification[]): RecompraSellerRow[] {
  const bySeller = new Map<string, CustomerClassification[]>();
  for (const c of classifications) {
    const key = c.seller ?? "Sem vendedora";
    const list = bySeller.get(key) ?? [];
    list.push(c);
    bySeller.set(key, list);
  }
  const rows: RecompraSellerRow[] = [...bySeller.entries()].map(([vendedora, group]) => {
    const totals = blockFor(group);
    return {
      vendedora,
      clientesRecompra: totals.clientes,
      clientesRecorrentes: group.filter((c) => c.segment === "recorrente").length,
      clientesReativados: group.filter((c) => c.segment === "reativado").length,
      vendas: totals.vendas,
      faturamento: totals.faturamento,
      ticketMedio: totals.ticketMedio,
    };
  });
  return rows.sort((a, b) => b.faturamento - a.faturamento);
}

// ───────── Fase 5 -- Gráficos mensais, Coorte e Funil de retenção ─────────
//
// Decisão do usuário (23/09/2026): os 3 gráficos mensais (Resultado/Volume/
// Recorrentes×Reativados) sempre mostram os últimos 12 meses corridos até
// hoje, independente do período (P1) escolhido no topo -- não uma janela
// que encolhe/cresce com o filtro. Por isso não recebem P2 (não tem um "P2"
// natural pra sobrepor a uma janela já fixa). Coorte e Funil de retenção
// são "visão geral" -- sem os filtros Status/Tipo/Origem/Estado/Vendedora,
// usam a mesma definição de "compra positiva" (PDF seção 2.2/6) que
// `fetchFullHistory` já usa em todo o resto do arquivo.

export type RecompraMonthlyBucket = {
  month: string; // "YYYY-MM"
  faturamento: number;
  vendas: number;
  clientes: number;
  recorrentes: { clientes: number; vendas: number; faturamento: number };
  reativados: { clientes: number; vendas: number; faturamento: number };
};

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Roda a MESMA máquina de `classifyRecompra` (findRecompraCandidates,
// fetchVestiAttributionSets/fetchTouchpointsForCandidates,
// applyTipoAndOrigemFilter, fetchFullHistory) UMA VEZ sobre a janela de 12
// meses inteira -- nunca em loop por mês, que bateria 12× no BigQuery/
// Postgres e, pior, 12× na API (rate-limited) da UpZero pra Tipo=Anúncios
// de cliente não-Vesti. Com os eventos + histórico da janela toda em mãos,
// classifica cada cliente MÊS A MÊS em JS: pra cada mês, acha o primeiro
// evento qualificável do cliente NESSE mês e compara contra o "histórico
// efetivo até esse mês" = `history` completo (fetchFullHistory, sem teto de
// data) + qualquer evento qualificável de um MÊS ANTERIOR dentro da mesma
// janela de 12 meses -- assim um evento de fevereiro pode ser "compra
// anterior" válida de uma recompra em maio, mesmo não estando em `history`
// (que só tem o que já existia ANTES da janela de busca, mas fetchFullHistory
// não tem teto de data então na prática já inclui tudo -- a soma dos dois é
// redundante em parte, inofensiva: só afeta achar o MAIOR `lastBefore`).
export async function classifyRecompraMonthly(params: {
  clientId: string;
  dataset: string | null;
  vestiDataset: string | null;
  upZeroApiKey: string | null;
  filters: RecompraFilters;
  months?: number; // default 12
}): Promise<{ buckets: RecompraMonthlyBucket[]; attributionUnavailable: boolean }> {
  const monthsCount = params.months ?? 12;
  const now = new Date();
  const dateTo = now.toISOString().slice(0, 10);
  const dateFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (monthsCount - 1), 1)).toISOString().slice(0, 10);
  const dateToExclusive = new Date(`${dateTo}T00:00:00.000Z`);
  dateToExclusive.setUTCDate(dateToExclusive.getUTCDate() + 1);
  const isAnuncios = params.filters.tipo.startsWith("anuncios");

  const [{ candidates, eventsByCustomer: rawEventsByCustomer }, vestiAttribution] = await Promise.all([
    findRecompraCandidates({
      clientId: params.clientId,
      dataset: params.dataset,
      vestiDataset: params.vestiDataset,
      dateFrom,
      dateToExclusive: dateToExclusive.toISOString(),
      filters: params.filters,
    }),
    isAnuncios && params.vestiDataset ? fetchVestiAttributionSets(params.vestiDataset) : Promise.resolve(null),
  ]);

  let touchpointsByCustomer: Map<string, TouchpointCandidate[]> | null = null;
  let attributionUnavailable = false;
  if (isAnuncios && !vestiAttribution) {
    if (!params.upZeroApiKey) {
      attributionUnavailable = true;
    } else {
      const { lookbackFrom, lookbackTo } = standardTouchpointWindow();
      touchpointsByCustomer = await fetchTouchpointsForCandidates({
        clientId: params.clientId,
        upZeroApiKey: params.upZeroApiKey,
        candidates,
        lookbackFrom,
        lookbackTo,
        concurrency: MONTHLY_TOUCHPOINT_CONCURRENCY,
      });
    }
  }
  const eventsByCustomer = attributionUnavailable
    ? new Map<string, PositiveEvent[]>()
    : applyTipoAndOrigemFilter(rawEventsByCustomer, params.filters, touchpointsByCustomer, vestiAttribution);

  const history = attributionUnavailable
    ? new Map<string, PositiveEvent[]>()
    : await fetchFullHistory({ clientId: params.clientId, dataset: params.dataset, vestiDataset: params.vestiDataset, candidates, vestiAttribution });

  const monthBounds: Array<{ key: string; start: Date; endExclusive: Date }> = [];
  for (let i = monthsCount - 1; i >= 0; i--) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const endExclusive = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    monthBounds.push({ key: monthKey(start), start, endExclusive });
  }

  const buckets: RecompraMonthlyBucket[] = monthBounds.map((m) => ({
    month: m.key,
    faturamento: 0,
    vendas: 0,
    clientes: 0,
    recorrentes: { clientes: 0, vendas: 0, faturamento: 0 },
    reativados: { clientes: 0, vendas: 0, faturamento: 0 },
  }));

  if (!attributionUnavailable) {
    for (const [customerId] of candidates) {
      const events = eventsByCustomer.get(customerId) ?? [];
      if (events.length === 0) continue;
      const priorHistory = history.get(customerId) ?? [];

      for (let mi = 0; mi < monthBounds.length; mi++) {
        const { start, endExclusive } = monthBounds[mi]!;
        const monthEvents = events.filter((e) => e.requestedAt >= start && e.requestedAt < endExclusive);
        if (monthEvents.length === 0) continue;
        const firstEvent = monthEvents[0]!; // events já vem ordenado por requestedAt asc

        const earlierWindowEvents = events.filter((e) => e.requestedAt < start);
        const effectiveHistory = [...priorHistory, ...earlierWindowEvents];
        const priorPositives = effectiveHistory.filter((e) => e.requestedAt.getTime() < firstEvent.requestedAt.getTime());
        if (priorPositives.length === 0) continue; // sem compra positiva anterior: não é recompra nesse mês

        const lastBefore = priorPositives.reduce((latest, e) => (e.requestedAt.getTime() > latest.requestedAt.getTime() ? e : latest));
        const intervalDays = Math.round((firstEvent.requestedAt.getTime() - lastBefore.requestedAt.getTime()) / 86_400_000);
        const segment: RecompraSegment = intervalDays <= RECORRENTE_THRESHOLD_DAYS ? "recorrente" : "reativado";

        const faturamentoMes = monthEvents.reduce((s, e) => s + e.paidValue, 0);
        const vendasMes = monthEvents.length;
        const bucket = buckets[mi]!;
        bucket.faturamento += faturamentoMes;
        bucket.vendas += vendasMes;
        bucket.clientes += 1;
        const segBucket = segment === "recorrente" ? bucket.recorrentes : bucket.reativados;
        segBucket.clientes += 1;
        segBucket.vendas += vendasMes;
        segBucket.faturamento += faturamentoMes;
      }
    }
  }

  return { buckets, attributionUnavailable };
}

// Busca TODO pedido "positivo" (mesma definição de sempre: ERP status
// pago, site aprovado/enviado/entregue, Vesti pago -- PDF seção 2.2/6) de
// QUALQUER cliente com pelo menos um evento desde `sinceDate`, sem filtro
// de Status/Tipo/Origem/Estado/Vendedora -- diferente de
// findRecompraCandidates, que só acha quem tem evento numa janela ESTREITA
// (P1) já filtrada. Usada só por Coorte e Funil de retenção (Fase 5),
// sempre "visão geral" por decisão do usuário. Não monta CustomerIdentity
// completa (nome/externalId) de propósito -- Coorte/Funil só precisam da
// lista de eventos por cliente, nunca exibem nome.
async function fetchAllPositiveEventsForClient(params: {
  clientId: string;
  dataset: string | null;
  vestiDataset: string | null;
  sinceDate: string; // YYYY-MM-DD
}): Promise<Map<string, PositiveEvent[]>> {
  const eventsByCnpj = new Map<string, PositiveEvent[]>();
  const contactByDocument = new Map<string, ErpContactInfo>();

  if (params.dataset) {
    const pedidosTable = vestiTable(params.dataset, "pedidos_erp");
    const clientesTable = vestiTable(params.dataset, "clientes_erp");
    const [rows] = await bigquery.query({
      query: `
        WITH orders AS (
          SELECT pedido_id, customer_id, ANY_VALUE(valor_total) AS gross_value, ANY_VALUE(data_criado) AS requested_at
          FROM ${pedidosTable}
          WHERE data_criado >= @sinceDate AND status IN UNNEST(@positiveStatuses)
          GROUP BY pedido_id, customer_id
          HAVING gross_value > 0
        )
        SELECT o.*, c.email AS erp_email, c.ddd AS erp_ddd, c.celular AS erp_celular, c.telefone AS erp_telefone
        FROM orders o
        LEFT JOIN ${clientesTable} c ON c.documento = o.customer_id
      `,
      params: { sinceDate: params.sinceDate, positiveStatuses: ERP_STATUS_BY_FILTER.pago },
    });
    for (const r of rows as Array<Record<string, unknown>>) {
      const cnpj = String(r.customer_id ?? "");
      if (!cnpj) continue;
      const list = eventsByCnpj.get(cnpj) ?? [];
      list.push({ channel: "erp", orderId: String(r.pedido_id), requestedAt: toDate(r.requested_at), grossValue: Number(r.gross_value) || 0, paidValue: 0, seller: null, origem: null, document: documentOrNull(cnpj) });
      eventsByCnpj.set(cnpj, list);
      if (!contactByDocument.has(cnpj)) {
        contactByDocument.set(cnpj, {
          email: (r.erp_email as string | null) ?? null,
          ddd: (r.erp_ddd as string | null) ?? null,
          celular: (r.erp_celular as string | null) ?? null,
          telefone: (r.erp_telefone as string | null) ?? null,
        });
      }
    }
  }

  const erpCustomerIds = [...eventsByCnpj.keys()];
  const { cnpjToHash, hashToCustomer } = await resolveErpCustomerIdentities({ clientId: params.clientId, erpCustomerIds, contactByDocument });

  const stillUnresolvedCnpjs = erpCustomerIds.filter((cnpj) => {
    const hash = cnpjToHash.get(cnpj);
    return !hash || !hashToCustomer.get(hash);
  });
  const vestiDocumentBridge = params.vestiDataset && stillUnresolvedCnpjs.length > 0
    ? await resolveVestiDocumentBridge({ vestiDataset: params.vestiDataset, documents: stillUnresolvedCnpjs })
    : new Map<string, { clienteId: string; name: string | null }>();

  const eventsByCustomer = new Map<string, PositiveEvent[]>();
  for (const [cnpj, events] of eventsByCnpj) {
    const hash = cnpjToHash.get(cnpj);
    const resolved = hash ? hashToCustomer.get(hash) : undefined;
    const customerId = resolved?.id ?? vestiDocumentBridge.get(normalizeDocument(cnpj))?.clienteId ?? null;
    if (!customerId) continue; // PDF seção 2.1: sem identidade confiável, não entra
    const list = eventsByCustomer.get(customerId) ?? [];
    list.push(...events);
    eventsByCustomer.set(customerId, list);
  }

  const sinceDateDate = new Date(`${params.sinceDate}T00:00:00.000Z`);
  const siteRows = await db
    .select({ id: ordersTable.id, customerId: ordersTable.customerId, amount: ordersTable.amount, createdAt: ordersTable.createdAt })
    .from(ordersTable)
    .where(and(eq(ordersTable.clientId, params.clientId), gte(ordersTable.createdAt, sinceDateDate), inArray(ordersTable.status, ["APPROVED", "SHIPPED", "DELIVERED"])));
  for (const r of siteRows) {
    if (r.amount <= 0) continue;
    const list = eventsByCustomer.get(r.customerId) ?? [];
    list.push({ channel: "site", orderId: r.id, requestedAt: r.createdAt, grossValue: r.amount, paidValue: 0, seller: null, origem: null, document: null });
    eventsByCustomer.set(r.customerId, list);
  }

  if (params.vestiDataset) {
    const vendasView = vestiTable(params.vestiDataset, "dashboard_vendas_view");
    const [vestiRows] = await bigquery.query({
      query: `
        SELECT pedido_id, ANY_VALUE(cliente_id) AS cliente_id, ANY_VALUE(data_ref) AS requested_at,
          ANY_VALUE(documento_cliente) AS documento_cliente, SUM(valor_solicitado) AS gross_value
        FROM ${vendasView}
        WHERE data_ref >= @sinceDate AND pago
        GROUP BY pedido_id
        HAVING gross_value > 0
      `,
      params: { sinceDate: params.sinceDate },
    });
    for (const r of vestiRows as Array<Record<string, unknown>>) {
      const clienteId = String(r.cliente_id ?? "");
      if (!clienteId) continue;
      const list = eventsByCustomer.get(clienteId) ?? [];
      list.push({ channel: "vesti", orderId: String(r.pedido_id), requestedAt: toDate(r.requested_at), grossValue: Number(r.gross_value) || 0, paidValue: 0, seller: null, origem: null, document: documentOrNull(r.documento_cliente) });
      eventsByCustomer.set(clienteId, list);
    }
  }

  for (const [customerId, events] of eventsByCustomer) {
    eventsByCustomer.set(customerId, dedupeSameDaySameValue(dedupeSameDaySumAcrossErpVesti(events)).sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime()));
  }

  return eventsByCustomer;
}

export type RecompraFunnelStep = { compra: string; clientes: number; retencao: number };

const FUNNEL_ORDINALS = ["1ª", "2ª", "3ª", "4ª", "5ª", "6ª", "7ª", "8ª", "9ª", "10ª"];

// Funil "1ª compra -> Nª compra": por cliente, ordena eventos por data e
// atribui order_n (1, 2, 3...); conta clientes distintos com order_n >= k
// pra k=1..maxSteps; retenção% = contagem/contagem(order_n>=1)×100.
export function buildPurchaseFunnel(eventsByCustomer: Map<string, PositiveEvent[]>, maxSteps = 6): RecompraFunnelStep[] {
  const counts: number[] = new Array(maxSteps).fill(0);
  for (const events of eventsByCustomer.values()) {
    const n = Math.min(events.length, maxSteps);
    for (let i = 0; i < n; i++) counts[i]! += 1;
  }
  const base = counts[0] ?? 0;
  return counts.map((clientes, i) => ({
    compra: `${FUNNEL_ORDINALS[i] ?? `${i + 1}ª`} compra`,
    clientes,
    retencao: base > 0 ? Math.round((clientes / base) * 1000) / 10 : 0,
  }));
}

export type RecompraCohortRow = {
  mes: string; // "YYYY-MM"
  clientes: number;
  d30: number | null;
  d60: number | null;
  d90: number | null;
  d180: number | null;
  hoje: number | null;
};

// Agrupa cliente pelo mês (UTC) da PRIMEIRA compra positiva; pros últimos
// `months` meses com coorte, calcula % de cada coorte com uma 2ª+ compra
// dentro de 30/60/90/180 dias da primeira, mais "até hoje" (2ª+ compra a
// qualquer momento). Maturidade é por LINHA (mês da coorte inteiro), não
// por cliente individual -- usa o FIM do mês como referência (pior caso:
// cliente que entrou no último dia do mês), pra não misturar coortes
// parcialmente maduras na mesma célula. `null` (não 0) quando a janela
// ainda não fechou pra aquele mês -- mesmo padrão N/A do resto da tela
// (PDF seção 21/23).
export function buildCohortRows(eventsByCustomer: Map<string, PositiveEvent[]>, months = 6): RecompraCohortRow[] {
  const now = new Date();
  const byCohortMonth = new Map<string, Array<{ firstAt: Date; events: PositiveEvent[] }>>();
  for (const events of eventsByCustomer.values()) {
    if (events.length === 0) continue;
    const firstAt = events[0]!.requestedAt; // já vem ordenado asc
    const key = monthKey(firstAt);
    const list = byCohortMonth.get(key) ?? [];
    list.push({ firstAt, events });
    byCohortMonth.set(key, list);
  }

  const rows: RecompraCohortRow[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const monthEndExclusive = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
    const key = monthKey(monthStart);
    const cohort = byCohortMonth.get(key) ?? [];
    const clientes = cohort.length;

    const pctWithinDays = (days: number): number | null => {
      if (clientes === 0) return null;
      const matured = now.getTime() >= monthEndExclusive.getTime() + days * 86_400_000;
      if (!matured) return null;
      const returned = cohort.filter((c) =>
        c.events.some((e) => e.requestedAt.getTime() > c.firstAt.getTime() && e.requestedAt.getTime() <= c.firstAt.getTime() + days * 86_400_000),
      ).length;
      return Math.round((returned / clientes) * 1000) / 10;
    };
    const pctToday = (): number | null => {
      if (clientes === 0) return null;
      const returned = cohort.filter((c) => c.events.some((e) => e.requestedAt.getTime() > c.firstAt.getTime())).length;
      return Math.round((returned / clientes) * 1000) / 10;
    };

    rows.push({
      mes: key,
      clientes,
      d30: pctWithinDays(30),
      d60: pctWithinDays(60),
      d90: pctWithinDays(90),
      d180: pctWithinDays(180),
      hoje: pctToday(),
    });
  }
  return rows;
}

// Ponto de entrada único de Coorte + Funil (Fase 5) -- as duas vêm da
// MESMA busca cara (fetchAllPositiveEventsForClient), então rodam juntas
// numa chamada só em vez de duplicar a query.
export async function fetchRecompraHistoryInsights(params: {
  clientId: string;
  dataset: string | null;
  vestiDataset: string | null;
  cohortMonths?: number; // default 6
}): Promise<{ funnel: RecompraFunnelStep[]; cohort: RecompraCohortRow[] }> {
  const cohortMonths = params.cohortMonths ?? 6;
  // A busca de eventos NÃO pode ser limitada aos últimos `cohortMonths` --
  // Coorte/Funil precisam saber a 1ª compra DE VERDADE (e a sequência
  // completa de pedidos) de cada cliente, senão um cliente antigo com
  // compra recente vira falso "cliente novo" no mês errado, e o Funil conta
  // "1ª compra" pra quem na verdade já é recorrente há anos. Mesmo padrão
  // já usado pra touchpoint (TOUCHPOINT_LOOKBACK_DAYS, "sem teto real, só
  // uma janela bem generosa porque a query exige um `from` concreto").
  // `cohortMonths` só decide QUANTAS linhas de coorte `buildCohortRows`
  // devolve, não o que é buscado.
  const sinceDate = new Date(Date.now() - TOUCHPOINT_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const eventsByCustomer = await fetchAllPositiveEventsForClient({
    clientId: params.clientId,
    dataset: params.dataset,
    vestiDataset: params.vestiDataset,
    sinceDate,
  });
  return {
    funnel: buildPurchaseFunnel(eventsByCustomer),
    cohort: buildCohortRows(eventsByCustomer, cohortMonths),
  };
}
