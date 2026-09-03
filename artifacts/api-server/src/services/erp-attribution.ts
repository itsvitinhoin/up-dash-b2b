// Criado 03/09/2026 -- reproduz o relatório do PDF de atribuição da MX
// Fashion ("Quanto a UP influenciou o faturamento"), mas com dado
// verificado ponta a ponta em vez de investigação manual:
//   1. Pedidos do ERP (BigQuery) -- já sabíamos ler isso.
//   2. Identidade: liga cliente do ERP (customer_id = CNPJ/CPF cru) com
//      cliente da UpZero (documentHash = sha256 do mesmo documento) --
//      reaproveita `hashDocument`, já usado no sync da UpZero, então o
//      hash bate sem precisar reimplementar nada.
//   3. Touchpoints pagos: paid-touchpoints.ts, criado hoje mais cedo.
//   4. Decisão por pedido: `latestTouchpointBefore` -- se existe
//      touchpoint pago antes da data do pedido, o pedido é influenciado.
import { bigquery, vestiTable } from "../lib/bigquery";
import { db, customersTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { hashDocument } from "./upzero/customers";
import { fetchPaidTouchpointsForUser, savePaidTouchpoints, latestTouchpointBefore, type TouchpointCandidate } from "./paid-touchpoints";

type ErpOrderRow = {
  pedido_id: string;
  customer_id: string;
  valor: number;
  data_criado: string;
};

export type ErpAttributedOrder = {
  pedidoId: string;
  customerId: string;
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
  distinctErpCustomers: number;
  matchedUpzeroCustomers: number;
  influencedOrders: ErpAttributedOrder[];
  influencedTotal: number;
  influencedCustomers: number;
  unmatchedCustomerCount: number;
};

export async function computeErpPaidAttribution(params: {
  clientId: string;
  dataset: string;
  upZeroApiKey: string;
  dateFrom: string; // YYYY-MM-DD
  dateTo: string; // YYYY-MM-DD, exclusivo
  touchpointLookbackFrom: string; // ISO -- janela ampla pra achar clique bem antes do pedido
}): Promise<ErpAttributionResult> {
  const pedidosTable = vestiTable(params.dataset, "pedidos_erp");
  const [rawRows] = await bigquery.query({
    query: `
      SELECT pedido_id, customer_id, ANY_VALUE(valor_total) AS valor, ANY_VALUE(data_criado) AS data_criado
      FROM ${pedidosTable}
      WHERE data_criado >= @dateFrom AND data_criado < @dateTo AND status = 'CONCLUIDO'
      GROUP BY pedido_id, customer_id
    `,
    params: { dateFrom: params.dateFrom, dateTo: params.dateTo },
  });
  const orders: ErpOrderRow[] = (rawRows as Array<Record<string, unknown>>).map((r) => ({
    pedido_id: String(r.pedido_id),
    customer_id: String(r.customer_id ?? ""),
    valor: Number(r.valor) || 0,
    data_criado: toIsoString(r.data_criado),
  }));

  const totalErpRevenue = orders.reduce((sum, o) => sum + o.valor, 0);
  const distinctCustomerIds = [...new Set(orders.map((o) => o.customer_id).filter(Boolean))];

  // Identidade: hash de cada CNPJ/CPF do ERP, pra bater contra
  // customers.documentHash da UpZero (mesma função de hash usada no sync).
  const cnpjToHash = new Map<string, string>();
  for (const cnpj of distinctCustomerIds) {
    const hash = hashDocument(cnpj);
    if (hash) cnpjToHash.set(cnpj, hash);
  }
  const hashes = [...new Set(cnpjToHash.values())];

  const matches = hashes.length
    ? await db
        .select({
          id: customersTable.id,
          externalId: customersTable.externalId,
          documentHash: customersTable.documentHash,
          name: customersTable.name,
        })
        .from(customersTable)
        .where(and(eq(customersTable.clientId, params.clientId), inArray(customersTable.documentHash, hashes)))
    : [];
  const hashToCustomer = new Map(matches.map((m) => [m.documentHash, m]));

  const ordersByCnpj = new Map<string, ErpOrderRow[]>();
  for (const order of orders) {
    const list = ordersByCnpj.get(order.customer_id) ?? [];
    list.push(order);
    ordersByCnpj.set(order.customer_id, list);
  }

  const influencedOrders: ErpAttributedOrder[] = [];
  let matchedUpzeroCustomers = 0;
  const influencedCustomerIds = new Set<string>();

  for (const [cnpj, cnpjOrders] of ordersByCnpj) {
    const hash = cnpjToHash.get(cnpj);
    const upzeroCustomer = hash ? hashToCustomer.get(hash) : undefined;
    if (!upzeroCustomer) continue;
    const externalUserId = Number.parseInt(upzeroCustomer.externalId ?? "", 10);
    if (!Number.isFinite(externalUserId) || externalUserId <= 0) continue;
    matchedUpzeroCustomers++;

    let touchpoints: TouchpointCandidate[];
    try {
      touchpoints = await fetchPaidTouchpointsForUser({
        apiKey: params.upZeroApiKey,
        userId: externalUserId,
        from: params.touchpointLookbackFrom,
        to: params.dateTo,
      });
    } catch {
      continue; // Cliente com erro de busca não trava o relatório inteiro.
    }
    if (touchpoints.length > 0) {
      await savePaidTouchpoints({
        clientId: params.clientId,
        customerId: upzeroCustomer.id,
        externalUserId,
        touchpoints,
      }).catch(() => {});
    }
    if (touchpoints.length === 0) continue;

    for (const order of cnpjOrders) {
      const evidence = latestTouchpointBefore(touchpoints, new Date(order.data_criado));
      if (!evidence) continue;
      const full = touchpoints.find((t) => t.occurredAt.getTime() === evidence.occurredAt.getTime());
      influencedOrders.push({
        pedidoId: order.pedido_id,
        customerId: order.customer_id,
        customerName: upzeroCustomer.name,
        upzeroCustomerId: upzeroCustomer.id,
        externalUserId,
        valor: order.valor,
        dataCriado: order.data_criado,
        touchpointAt: evidence.occurredAt.toISOString(),
        touchpointSource: full?.source ?? null,
        touchpointMedium: full?.medium ?? null,
        touchpointCampaign: full?.campaign ?? null,
      });
      influencedCustomerIds.add(order.customer_id);
    }
  }

  const influencedTotal = influencedOrders.reduce((sum, o) => sum + o.valor, 0);

  return {
    totalErpRevenue,
    totalErpOrders: orders.length,
    distinctErpCustomers: distinctCustomerIds.length,
    matchedUpzeroCustomers,
    influencedOrders,
    influencedTotal,
    influencedCustomers: influencedCustomerIds.size,
    unmatchedCustomerCount: distinctCustomerIds.length - matchedUpzeroCustomers,
  };
}

function toIsoString(value: unknown): string {
  if (value && typeof value === "object" && "value" in (value as Record<string, unknown>)) {
    return new Date(String((value as { value: unknown }).value)).toISOString();
  }
  return new Date(String(value)).toISOString();
}
