// Criado 03/09/2026 -- reproduz o relatório do PDF de atribuição da MX
// Fashion ("Quanto a UP influenciou o faturamento"), mas com dado
// verificado ponta a ponta em vez de investigação manual:
//   1. Pedidos, de DUAS fontes: ERP (BigQuery, loja física + parte do
//      site) e online (Postgres `orders`, o pedido nativo da UpZero) --
//      o PDF separa em jornadas "-> ERP direto" e "-> site"; pra cobrir
//      as duas, olhamos as duas fontes.
//   2. Identidade: pedido do ERP só tem o CNPJ/CPF cru (`customer_id`);
//      liga com o cliente da UpZero comparando hash do documento
//      (`hashDocument`, já usado no sync da UpZero). Pedido online já
//      nasce ligado ao cliente certo (customerId direto), não precisa
//      de identidade nenhuma.
//   3. Touchpoints pagos: paid-touchpoints.ts, criado hoje mais cedo.
//   4. Decisão por pedido: `latestTouchpointBefore` -- se existe
//      touchpoint pago antes da data do pedido, o pedido é influenciado.
//      Busca o touchpoint uma vez por cliente, reaproveitada pros
//      pedidos das duas fontes desse mesmo cliente.
import { bigquery, vestiTable } from "../lib/bigquery";
import { db, customersTable, ordersTable } from "@workspace/db";
import { and, eq, gte, inArray, lt, ne } from "drizzle-orm";
import { hashDocument } from "./upzero/customers";
import { fetchPaidTouchpointsForUser, savePaidTouchpoints, latestTouchpointBefore, type TouchpointCandidate } from "./paid-touchpoints";

type OrderChannel = "erp" | "site";

type OrderCandidate = {
  orderId: string;
  channel: OrderChannel;
  valor: number; // faturamento gerado (solicitado/comercial)
  valorPago: number; // faturamento pago (concluído/atendido)
  dataCriado: string; // ISO
};

type ResolvedCustomer = {
  upzeroCustomerId: string;
  externalUserId: number;
  name: string | null;
};

export type ErpAttributedOrder = {
  orderId: string;
  channel: OrderChannel;
  customerName: string | null;
  upzeroCustomerId: string;
  externalUserId: number;
  valor: number;
  valorPago: number;
  dataCriado: string;
  touchpointAt: string;
  touchpointSource: string | null;
  touchpointMedium: string | null;
  touchpointCampaign: string | null;
};

// Cohort igual ao PDF (pág. 4): olha a última compra CONCLUÍDA do cliente
// antes da primeira compra influenciada dele no período -- sem compra
// anterior = novo; até 90 dias = recorrente; acima = reativado.
export type CohortLabel = "novo" | "recorrente" | "reativado";

export type CustomerCohort = {
  upzeroCustomerId: string;
  customerName: string | null;
  cohort: CohortLabel;
  firstInfluencedOrderAt: string;
  lastOrderBeforeAt: string | null; // null quando "novo" (sem compra anterior)
  daysSinceLastOrder: number | null;
};

export type CohortSummary = {
  cohort: CohortLabel;
  clientes: number;
  pedidos: number;
  faturamentoGerado: number;
  faturamentoPago: number;
  ticketMedio: number; // faturamentoGerado / pedidos
};

export type ErpAttributionResult = {
  totalErpRevenue: number;
  totalErpOrders: number;
  totalSiteRevenue: number;
  totalSiteOrders: number;
  distinctErpCustomers: number;
  matchedUpzeroCustomers: number;
  influencedOrders: ErpAttributedOrder[];
  influencedTotal: number;
  influencedCustomers: number;
  unmatchedCustomerCount: number;
  customerCohorts: CustomerCohort[];
  cohortSummary: CohortSummary[];
  // Achado 03/09/2026: um erro silencioso (`catch { continue }`) escondeu
  // um bug real (a UpZero rejeitava um `to` sem horário) e fez o relatório
  // inteiro voltar "ninguém influenciado" sem avisar nada de errado.
  // Agora todo erro por cliente fica visível aqui em vez de sumir.
  fetchErrors: Array<{ upzeroCustomerId: string; message: string }>;
};

export async function computeErpPaidAttribution(params: {
  clientId: string;
  dataset: string;
  upZeroApiKey: string;
  dateFrom: string; // YYYY-MM-DD
  dateTo: string; // YYYY-MM-DD, exclusivo
  touchpointLookbackFrom: string; // ISO -- janela ampla pra achar clique bem antes do pedido
}): Promise<ErpAttributionResult> {
  // ── Fonte 1: pedidos do ERP (BigQuery), identidade por CNPJ/CPF ──────
  const pedidosTable = vestiTable(params.dataset, "pedidos_erp");
  const [rawErpRows] = await bigquery.query({
    query: `
      SELECT pedido_id, customer_id, ANY_VALUE(valor_total) AS valor, ANY_VALUE(data_criado) AS data_criado
      FROM ${pedidosTable}
      WHERE data_criado >= @dateFrom AND data_criado < @dateTo AND status = 'CONCLUIDO'
      GROUP BY pedido_id, customer_id
    `,
    params: { dateFrom: params.dateFrom, dateTo: params.dateTo },
  });
  const erpRows = rawErpRows as Array<Record<string, unknown>>;
  const totalErpRevenue = erpRows.reduce((sum, r) => sum + (Number(r.valor) || 0), 0);
  const erpCustomerIds = [...new Set(erpRows.map((r) => String(r.customer_id ?? "")).filter(Boolean))];

  const cnpjToHash = new Map<string, string>();
  for (const cnpj of erpCustomerIds) {
    const hash = hashDocument(cnpj);
    if (hash) cnpjToHash.set(cnpj, hash);
  }
  const hashes = [...new Set(cnpjToHash.values())];
  const hashMatches = hashes.length
    ? await db
        .select({ id: customersTable.id, externalId: customersTable.externalId, documentHash: customersTable.documentHash, name: customersTable.name })
        .from(customersTable)
        .where(and(eq(customersTable.clientId, params.clientId), inArray(customersTable.documentHash, hashes)))
    : [];
  const hashToCustomer = new Map(hashMatches.map((m) => [m.documentHash, m]));

  // ── Fonte 2: pedidos online (Postgres `orders`), já ligados ao cliente ──
  const dateFromDate = new Date(`${params.dateFrom}T00:00:00.000Z`);
  const dateToDate = new Date(`${params.dateTo}T00:00:00.000Z`);
  const siteOrderRows = await db
    .select({
      id: ordersTable.id,
      customerId: ordersTable.customerId,
      amount: ordersTable.amount,
      fulfilledAmount: ordersTable.fulfilledAmount,
      createdAt: ordersTable.createdAt,
    })
    .from(ordersTable)
    .where(and(eq(ordersTable.clientId, params.clientId), gte(ordersTable.createdAt, dateFromDate), lt(ordersTable.createdAt, dateToDate), ne(ordersTable.status, "REJECTED")));
  const totalSiteRevenue = siteOrderRows.reduce((sum, r) => sum + r.amount, 0);

  const siteCustomerIds = [...new Set(siteOrderRows.map((r) => r.customerId).filter((v): v is string => Boolean(v)))];
  const siteCustomers = siteCustomerIds.length
    ? await db
        .select({ id: customersTable.id, externalId: customersTable.externalId, name: customersTable.name })
        .from(customersTable)
        .where(and(eq(customersTable.clientId, params.clientId), inArray(customersTable.id, siteCustomerIds)))
    : [];
  const siteCustomerById = new Map(siteCustomers.map((c) => [c.id, c]));

  // ── Unifica pedido -> cliente resolvido, das duas fontes ─────────────
  const ordersByCustomer = new Map<string, { customer: ResolvedCustomer; orders: OrderCandidate[] }>();
  const registerOrder = (customer: ResolvedCustomer | null, order: OrderCandidate) => {
    if (!customer) return;
    const entry = ordersByCustomer.get(customer.upzeroCustomerId) ?? { customer, orders: [] };
    entry.orders.push(order);
    ordersByCustomer.set(customer.upzeroCustomerId, entry);
  };

  // CNPJ(s) cru por cliente resolvido -- precisa pra buscar o histórico de
  // pedidos ANTERIOR (sem filtro de data) na hora de classificar o cohort.
  const customerCnpjs = new Map<string, Set<string>>();

  for (const r of erpRows) {
    const cnpj = String(r.customer_id ?? "");
    const hash = cnpjToHash.get(cnpj);
    const match = hash ? hashToCustomer.get(hash) : undefined;
    const externalUserId = match ? Number.parseInt(match.externalId ?? "", 10) : NaN;
    if (!match || !Number.isFinite(externalUserId) || externalUserId <= 0) continue;
    registerOrder(
      { upzeroCustomerId: match.id, externalUserId, name: match.name },
      { orderId: String(r.pedido_id), channel: "erp", valor: Number(r.valor) || 0, valorPago: Number(r.valor) || 0, dataCriado: toIsoString(r.data_criado) },
    );
    const cnpjSet = customerCnpjs.get(match.id) ?? new Set<string>();
    cnpjSet.add(cnpj);
    customerCnpjs.set(match.id, cnpjSet);
  }
  for (const r of siteOrderRows) {
    const match = r.customerId ? siteCustomerById.get(r.customerId) : undefined;
    const externalUserId = match ? Number.parseInt(match.externalId ?? "", 10) : NaN;
    if (!match || !Number.isFinite(externalUserId) || externalUserId <= 0) continue;
    registerOrder(
      { upzeroCustomerId: match.id, externalUserId, name: match.name },
      { orderId: r.id, channel: "site", valor: r.amount, valorPago: r.fulfilledAmount || 0, dataCriado: r.createdAt.toISOString() },
    );
  }

  // A UpZero exige ISO 8601 completo (com horário) pros parâmetros
  // from/to de /analytics/facts -- rejeita "2026-09-01" puro com 400.
  const touchpointLookbackTo = new Date(`${params.dateTo}T23:59:59.999Z`).toISOString();

  const influencedOrders: ErpAttributedOrder[] = [];
  const fetchErrors: ErpAttributionResult["fetchErrors"] = [];
  const influencedCustomerIds = new Set<string>();

  for (const [upzeroCustomerId, { customer, orders }] of ordersByCustomer) {
    let touchpoints: TouchpointCandidate[];
    try {
      touchpoints = await fetchPaidTouchpointsForUser({
        apiKey: params.upZeroApiKey,
        userId: customer.externalUserId,
        from: params.touchpointLookbackFrom,
        to: touchpointLookbackTo,
      });
    } catch (err) {
      fetchErrors.push({ upzeroCustomerId, message: err instanceof Error ? err.message : String(err) });
      continue; // Cliente com erro de busca não trava o relatório inteiro.
    }
    if (touchpoints.length > 0) {
      await savePaidTouchpoints({ clientId: params.clientId, customerId: upzeroCustomerId, externalUserId: customer.externalUserId, touchpoints }).catch(() => {});
    }
    if (touchpoints.length === 0) continue;

    for (const order of orders) {
      const evidence = latestTouchpointBefore(touchpoints, new Date(order.dataCriado));
      if (!evidence) continue;
      const full = touchpoints.find((t) => t.occurredAt.getTime() === evidence.occurredAt.getTime());
      influencedOrders.push({
        orderId: order.orderId,
        channel: order.channel,
        customerName: customer.name,
        upzeroCustomerId,
        externalUserId: customer.externalUserId,
        valor: order.valor,
        valorPago: order.valorPago,
        dataCriado: order.dataCriado,
        touchpointAt: evidence.occurredAt.toISOString(),
        touchpointSource: full?.source ?? null,
        touchpointMedium: full?.medium ?? null,
        touchpointCampaign: full?.campaign ?? null,
      });
      influencedCustomerIds.add(upzeroCustomerId);
    }
  }

  const influencedTotal = influencedOrders.reduce((sum, o) => sum + o.valor, 0);

  const { customerCohorts, cohortSummary } = await classifyCohorts({
    dataset: params.dataset,
    clientId: params.clientId,
    influencedOrders,
    customerCnpjs,
  });

  return {
    totalErpRevenue,
    totalErpOrders: erpRows.length,
    totalSiteRevenue,
    totalSiteOrders: siteOrderRows.length,
    distinctErpCustomers: erpCustomerIds.length,
    matchedUpzeroCustomers: ordersByCustomer.size,
    influencedOrders,
    influencedTotal,
    influencedCustomers: influencedCustomerIds.size,
    unmatchedCustomerCount: erpCustomerIds.length - hashMatches.length,
    customerCohorts,
    cohortSummary,
    fetchErrors,
  };
}

// ── Cohort novo/recorrente/reativado (PDF pág. 4) ──────────────────────────
// Pra cada cliente influenciado: acha a compra CONCLUÍDA mais recente antes
// da primeira compra influenciada dele (sem limite de data pra trás -- pode
// ser de meses atrás). Sem nenhuma: novo. Até 90 dias: recorrente. Acima: reativado.
async function classifyCohorts(params: {
  dataset: string;
  clientId: string;
  influencedOrders: ErpAttributedOrder[];
  customerCnpjs: Map<string, Set<string>>;
}): Promise<{ customerCohorts: CustomerCohort[]; cohortSummary: CohortSummary[] }> {
  const { influencedOrders, customerCnpjs } = params;
  if (influencedOrders.length === 0) return { customerCohorts: [], cohortSummary: [] };

  // Primeira compra influenciada por cliente.
  const firstInfluencedAt = new Map<string, Date>();
  for (const o of influencedOrders) {
    const at = new Date(o.dataCriado);
    const current = firstInfluencedAt.get(o.upzeroCustomerId);
    if (!current || at.getTime() < current.getTime()) firstInfluencedAt.set(o.upzeroCustomerId, at);
  }
  const customerIds = [...firstInfluencedAt.keys()];

  // Histórico ERP (qualquer data, status concluído) só dos clientes influenciados.
  const allCnpjs = [...new Set(customerIds.flatMap((id) => [...(customerCnpjs.get(id) ?? [])]))];
  const erpHistoryByCustomer = new Map<string, Date[]>();
  if (allCnpjs.length > 0) {
    const pedidosTable = vestiTable(params.dataset, "pedidos_erp");
    const [rawHistoryRows] = await bigquery.query({
      query: `
        SELECT customer_id, data_criado
        FROM ${pedidosTable}
        WHERE customer_id IN UNNEST(@cnpjs) AND status = 'CONCLUIDO'
        GROUP BY pedido_id, customer_id, data_criado
      `,
      params: { cnpjs: allCnpjs },
    });
    const cnpjToUpzeroId = new Map<string, string>();
    for (const [upzeroId, cnpjs] of customerCnpjs) for (const cnpj of cnpjs) cnpjToUpzeroId.set(cnpj, upzeroId);
    for (const r of rawHistoryRows as Array<Record<string, unknown>>) {
      const upzeroId = cnpjToUpzeroId.get(String(r.customer_id ?? ""));
      if (!upzeroId) continue;
      const dates = erpHistoryByCustomer.get(upzeroId) ?? [];
      dates.push(new Date(toIsoString(r.data_criado)));
      erpHistoryByCustomer.set(upzeroId, dates);
    }
  }

  // Histórico site (qualquer data, não rejeitado) só dos clientes influenciados.
  const siteHistoryRows = await db
    .select({ customerId: ordersTable.customerId, createdAt: ordersTable.createdAt })
    .from(ordersTable)
    .where(and(eq(ordersTable.clientId, params.clientId), inArray(ordersTable.customerId, customerIds), ne(ordersTable.status, "REJECTED")));
  const siteHistoryByCustomer = new Map<string, Date[]>();
  for (const r of siteHistoryRows) {
    const dates = siteHistoryByCustomer.get(r.customerId) ?? [];
    dates.push(r.createdAt);
    siteHistoryByCustomer.set(r.customerId, dates);
  }

  const customerCohorts: CustomerCohort[] = [];
  for (const upzeroCustomerId of customerIds) {
    const cutoff = firstInfluencedAt.get(upzeroCustomerId)!;
    const priorDates = [...(erpHistoryByCustomer.get(upzeroCustomerId) ?? []), ...(siteHistoryByCustomer.get(upzeroCustomerId) ?? [])].filter(
      (d) => d.getTime() < cutoff.getTime(),
    );
    const lastOrderBefore = priorDates.length ? new Date(Math.max(...priorDates.map((d) => d.getTime()))) : null;
    const daysSinceLastOrder = lastOrderBefore ? Math.round((cutoff.getTime() - lastOrderBefore.getTime()) / 86_400_000) : null;
    const cohort: CohortLabel = daysSinceLastOrder === null ? "novo" : daysSinceLastOrder <= 90 ? "recorrente" : "reativado";
    const anyOrder = influencedOrders.find((o) => o.upzeroCustomerId === upzeroCustomerId)!;
    customerCohorts.push({
      upzeroCustomerId,
      customerName: anyOrder.customerName,
      cohort,
      firstInfluencedOrderAt: cutoff.toISOString(),
      lastOrderBeforeAt: lastOrderBefore ? lastOrderBefore.toISOString() : null,
      daysSinceLastOrder,
    });
  }

  const cohortByCustomer = new Map(customerCohorts.map((c) => [c.upzeroCustomerId, c.cohort]));
  const summaryMap = new Map<CohortLabel, { clientes: Set<string>; pedidos: number; faturamentoGerado: number; faturamentoPago: number }>();
  for (const o of influencedOrders) {
    const cohort = cohortByCustomer.get(o.upzeroCustomerId);
    if (!cohort) continue;
    const entry = summaryMap.get(cohort) ?? { clientes: new Set<string>(), pedidos: 0, faturamentoGerado: 0, faturamentoPago: 0 };
    entry.clientes.add(o.upzeroCustomerId);
    entry.pedidos += 1;
    entry.faturamentoGerado += o.valor;
    entry.faturamentoPago += o.valorPago;
    summaryMap.set(cohort, entry);
  }
  const cohortSummary: CohortSummary[] = (["novo", "recorrente", "reativado"] as const)
    .filter((c) => summaryMap.has(c))
    .map((cohort) => {
      const entry = summaryMap.get(cohort)!;
      return {
        cohort,
        clientes: entry.clientes.size,
        pedidos: entry.pedidos,
        faturamentoGerado: entry.faturamentoGerado,
        faturamentoPago: entry.faturamentoPago,
        ticketMedio: entry.pedidos > 0 ? entry.faturamentoGerado / entry.pedidos : 0,
      };
    });

  return { customerCohorts, cohortSummary };
}

function toIsoString(value: unknown): string {
  if (value && typeof value === "object" && "value" in (value as Record<string, unknown>)) {
    return new Date(String((value as { value: unknown }).value)).toISOString();
  }
  return new Date(String(value)).toISOString();
}
