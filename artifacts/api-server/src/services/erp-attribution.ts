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
  valor: number;
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
  dataCriado: string;
  touchpointAt: string;
  touchpointSource: string | null;
  touchpointMedium: string | null;
  touchpointCampaign: string | null;
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

  for (const r of erpRows) {
    const cnpj = String(r.customer_id ?? "");
    const hash = cnpjToHash.get(cnpj);
    const match = hash ? hashToCustomer.get(hash) : undefined;
    const externalUserId = match ? Number.parseInt(match.externalId ?? "", 10) : NaN;
    if (!match || !Number.isFinite(externalUserId) || externalUserId <= 0) continue;
    registerOrder(
      { upzeroCustomerId: match.id, externalUserId, name: match.name },
      { orderId: String(r.pedido_id), channel: "erp", valor: Number(r.valor) || 0, dataCriado: toIsoString(r.data_criado) },
    );
  }
  for (const r of siteOrderRows) {
    const match = r.customerId ? siteCustomerById.get(r.customerId) : undefined;
    const externalUserId = match ? Number.parseInt(match.externalId ?? "", 10) : NaN;
    if (!match || !Number.isFinite(externalUserId) || externalUserId <= 0) continue;
    registerOrder(
      { upzeroCustomerId: match.id, externalUserId, name: match.name },
      { orderId: r.id, channel: "site", valor: r.amount, dataCriado: r.createdAt.toISOString() },
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
    fetchErrors,
  };
}

function toIsoString(value: unknown): string {
  if (value && typeof value === "object" && "value" in (value as Record<string, unknown>)) {
    return new Date(String((value as { value: unknown }).value)).toISOString();
  }
  return new Date(String(value)).toISOString();
}
