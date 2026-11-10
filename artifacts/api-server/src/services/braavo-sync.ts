import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { and, desc, eq, getTableColumns, gt, inArray, like, min, sql } from "drizzle-orm";
import {
  db,
  clientsTable,
  customersTable,
  productsTable,
  ordersTable,
  orderItemsTable,
  eventsTable,
  syncJobsTable,
  braavoSyncStatesTable as states,
  braavoCatalogTable as catalog,
  braavoRecordIssuesTable as issues,
  BRAAVO_PHASES,
  type BraavoCursor,
} from "@workspace/db";
import {
  BraavoApi,
  BraavoError,
  BraavoRecordError,
  braavoId,
  braavoRecord,
  normalizeBraavoDomain,
  type BraavoRecord,
  type BraavoCredentials,
} from "./braavo-api";
import {
  braavoDay,
  nextDay,
  normalizeBraavoCustomer,
  normalizeBraavoOrder,
  textValue,
  stockQuantity,
  money,
} from "./braavo-normalize";
import { refreshDailyClientMetrics } from "./daily-client-metrics";
import { logger } from "../lib/logger";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Client = typeof clientsTable.$inferSelect;
export type BraavoBatchResult = {
  status: "pending" | "done" | "busy" | "failed";
  phase?: string;
  page?: number;
  day?: string | null;
  processed?: number;
  complete: boolean;
  jobId?: string | null;
  message?: string;
  code?: string;
  /** Invalid records quarantined so far in the current cycle. */
  skipped?: number;
};
const PAGE_SIZE = 25;
// Orçamento para ler páginas de itens em lote num único ciclo (o lote inteiro tem 50 s).
const ITEMS_BATCH_BUDGET_MS = 30_000;

// Legacy shops carry a few inconsistent records (17 in 114 thousand orders on a
// real shop). Those are quarantined and the import continues. Past this ceiling
// per cycle the cause is more likely a changed API format than dirty data, so the
// batch fails loudly with its checkpoint preserved instead of ignoring everything.
export const MAX_SKIPPED_PER_CYCLE = 100;

type SkipCounter = { skipped: number };
async function recordIssue(
  clientId: string,
  phase: string,
  externalId: string,
  reason: string,
) {
  await db
    .insert(issues)
    .values({ clientId, phase, externalId, reason })
    .onConflictDoUpdate({
      target: [issues.clientId, issues.phase, issues.externalId],
      set: {
        reason,
        attempts: sql`${issues.attempts} + 1`,
        lastSeenAt: new Date(),
      },
    });
}
/**
 * Runs the validation/persistence of ONE record. Only BraavoRecordError (the
 * record itself is invalid) is quarantined; network, anti-bot, credential,
 * lease and database failures still propagate and stop the batch. A record that
 * imports successfully clears any earlier issue, so fixes on the shop heal on
 * their own.
 */
async function importRecord(
  clientId: string,
  phase: string,
  externalId: string,
  counter: SkipCounter,
  work: () => Promise<void>,
) {
  try {
    await work();
  } catch (error) {
    if (!(error instanceof BraavoRecordError)) throw error;
    counter.skipped++;
    await recordIssue(clientId, phase, externalId, error.message);
    logger.warn(
      { clientId, phase, externalId, reason: error.message },
      "[braavo] registro inválido ignorado; a sincronização continua",
    );
    if (counter.skipped > MAX_SKIPPED_PER_CYCLE)
      throw new BraavoError(
        `Mais de ${MAX_SKIPPED_PER_CYCLE} registros inválidos neste ciclo. Isso sugere mudança no formato da Braavo e não dados antigos; confira os registros ignorados antes de retomar.`,
        "BRAAVO_TOO_MANY_INVALID",
      );
    return;
  }
  await db
    .delete(issues)
    .where(
      and(
        eq(issues.clientId, clientId),
        eq(issues.phase, phase),
        eq(issues.externalId, externalId),
      ),
    );
}

export function braavoCredentials(client: Client): BraavoCredentials {
  if (
    client.commercePlatform !== "BRAAVO" ||
    client.dashboardType !== "B2C" ||
    !client.isActive || client.archivedAt
  )
    throw new BraavoError(
      "Selecione um cliente ativo B2C com plataforma Braavo.",
      "INVALID_CLIENT",
      400,
    );
  if (!client.braavoDomain || !client.braavoApiToken || !client.braavoApiKey)
    throw new BraavoError(
      "Cadastre domínio, API Token e API Key da Braavo.",
      "MISSING_CREDENTIALS",
      400,
    );
  return {
    domain: client.braavoDomain,
    apiToken: client.braavoApiToken,
    apiKey: client.braavoApiKey,
  };
}
export function braavoFingerprint(credentials: BraavoCredentials): string {
  return createHash("sha256").update(JSON.stringify(credentials)).digest("hex");
}
export async function getBraavoClient(clientId: string) {
  const [client] = await db
    .select()
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));
  if (!client)
    throw new BraavoError("Cliente não encontrado.", "NOT_FOUND", 404);
  return client;
}
export async function reserveBraavoSlot(domain: string): Promise<number> {
  const result = await db.execute<{ slot: string | number }>(sql`
    INSERT INTO braavo_request_slots (domain, next_at) VALUES (${domain}, clock_timestamp() + interval '1 second')
    ON CONFLICT (domain) DO UPDATE SET next_at = GREATEST(clock_timestamp(), braavo_request_slots.next_at) + interval '1 second'
    RETURNING extract(epoch FROM next_at - interval '1 second') * 1000 AS slot
  `);
  return Number(result.rows[0].slot);
}

export async function deferBraavoBatch(domain: string) {
  // Shared by manual/cron jobs and clients using the same shop. Preserve any
  // slots already queued beyond this cooldown rather than bringing them forward.
  await db.execute(sql`
    INSERT INTO braavo_request_slots (domain, next_at) VALUES (${normalizeBraavoDomain(domain)}, clock_timestamp() + interval '5 seconds')
    ON CONFLICT (domain) DO UPDATE SET next_at = GREATEST(braavo_request_slots.next_at, clock_timestamp() + interval '5 seconds')
  `);
}

const DEFAULT_FULL_REFRESH_DAYS = 90;

/**
 * Intervalo, em dias, entre recargas completas (a rotina entre elas só busca o que
 * mudou). Vem de BRAAVO_FULL_REFRESH_DAYS; sem a variável vale 90. O padrão precisa
 * ser alto também fora do job da nuvem: a API do painel (Vercel) não tem a variável, e
 * com 7 dias um clique em "Sincronizar" numa loja grande, uma semana depois da carga,
 * começaria sozinho uma recarga completa. Valor inválido falha alto.
 */
export function braavoFullRefreshDays(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_FULL_REFRESH_DAYS;
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > 3650)
    throw new Error(
      `BRAAVO_FULL_REFRESH_DAYS inválido ("${raw}"): use um número inteiro de dias entre 1 e 3650 (padrão ${DEFAULT_FULL_REFRESH_DAYS}).`,
    );
  return days;
}

export function initialBraavoCursor(
  now: Date,
  completedAt?: Date | null,
  fullCompletedAt?: Date | null,
  fullRefreshDays = DEFAULT_FULL_REFRESH_DAYS,
): BraavoCursor {
  const full =
    !completedAt ||
    !fullCompletedAt ||
    now.getTime() - fullCompletedAt.getTime() >= fullRefreshDays * 86_400_000;
  const untilDay = braavoDay(now);
  const fromDay = full ? null : nextDay(braavoDay(completedAt!), -1);
  return {
    phase: "categories",
    page: 1,
    day: null,
    fromDay,
    untilDay,
    full,
    startedAt: now.toISOString(),
  };
}
// Fases que o ciclo incremental lê dia a dia (filtro data_alterado). Os SKUs entram
// aqui: sem isso a rotina relia o catálogo todo (27 mil SKUs, 1.100 páginas) a cada
// ciclo e gastava os 20 minutos só nessa etapa. A Braavo devolve só os SKUs que
// mudaram naquele dia (estoque e preço), umas dezenas por dia.
const dailyPhase = (phase: string) =>
  ["products", "skus", "customers", "orders"].includes(phase);
export function advanceBraavoCursor(
  cursor: BraavoCursor,
  complete: boolean,
): BraavoCursor {
  // Record checkpoints belong only to the current page/day/phase.
  const { processedIds: _processedIds, ...nextCursor } = cursor;
  cursor = nextCursor;
  if (!complete) return { ...cursor, page: cursor.page + 1 };
  if (cursor.day && cursor.day < cursor.untilDay)
    return { ...cursor, page: 1, day: nextDay(cursor.day) };
  let phase = BRAAVO_PHASES[BRAAVO_PHASES.indexOf(cursor.phase) + 1] ?? "done";
  // Os itens em lote só servem à carga completa; o ciclo incremental, pequeno,
  // continua lendo o detalhe de cada pedido alterado.
  if (phase === "order_items" && !cursor.full) phase = "orders";
  if (phase === "customer_addresses" && !cursor.full) phase = "customers";
  // Na carga completa todos os pedidos acabaram de ser lidos ao vivo, então a
  // conferência dos pendentes seria só repetir essas mesmas consultas.
  if (phase === "pending" && cursor.full) phase = "done";
  return {
    ...cursor,
    phase,
    page: 1,
    day: !cursor.full && dailyPhase(phase) ? cursor.fromDay : null,
    afterId: undefined,
  };
}

async function assertLease(tx: Tx, clientId: string, leaseId: string) {
  const [lease] = await tx
    .select({ id: states.leaseId })
    .from(states)
    .where(and(eq(states.clientId, clientId), eq(states.leaseId, leaseId)))
    .for("update");
  if (!lease)
    throw new BraavoError(
      "A sincronização foi assumida por outra execução.",
      "LEASE_LOST",
      409,
    );
  const [client] = await tx.select({ archivedAt: clientsTable.archivedAt, isActive: clientsTable.isActive }).from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!client || client.archivedAt || !client.isActive) throw new BraavoError("Cliente arquivado ou inativo; sincronização interrompida.", "INVALID_CLIENT", 400);
  await tx
    .update(states)
    .set({ leaseUntil: new Date(Date.now() + 90_000), updatedAt: new Date() })
    .where(eq(states.clientId, clientId));
}
async function cachedCatalog(clientId: string) {
  const rows = await db
    .select()
    .from(catalog)
    .where(
      and(
        eq(catalog.clientId, clientId),
        inArray(catalog.kind, ["categories", "variations"]),
      ),
    );
  return new Map(rows.map((r) => [`${r.kind}:${r.externalId}`, r.data]));
}
function variantLabels(
  cache: Map<string, BraavoRecord>,
  first: unknown,
  second: unknown,
) {
  let color: string | null = null,
    size: string | null = null;
  for (const id of [first, second]) {
    const value = cache.get(`variations:${id}`);
    const type = value ? cache.get(`variations:${value.pai_id}`) : undefined;
    const name = textValue(type?.nome)?.toLowerCase();
    if (name === "cor" || name === "cores") color = textValue(value?.nome);
    if (name === "tamanho" || name === "tamanhos")
      size = textValue(value?.nome);
  }
  return { color, size };
}
async function persistCustomer(
  tx: Tx,
  clientId: string,
  row: BraavoRecord,
  fallbackCreatedAt?: Date,
  /** Cliente reconstruído do resumo do pedido (não veio da lista de clientes). */
  fromOrderSnapshot = false,
) {
  const normalized = normalizeBraavoCustomer(row, fallbackCreatedAt);
  const [collision] = await tx
    .select({ externalId: customersTable.externalId })
    .from(customersTable)
    .where(
      and(
        eq(customersTable.clientId, clientId),
        eq(customersTable.email, normalized.email),
      ),
    );
  // Do not merge two people merely because their email is equal.
  if (collision && collision.externalId !== normalized.externalId) {
    if (fromOrderSnapshot) {
      // Pedido antigo de uma conta que já não está na lista de clientes e cujo e-mail
      // hoje é de outro cadastro (ex.: a pessoa se recadastrou). O pedido é histórico
      // real: fica com um cliente próprio, com o e-mail de reserva usado quando a loja
      // não informa e-mail, sem fundir duas contas só pelo e-mail.
      normalized.email = `braavo-${braavoId(row.id)}@unknown.local`;
    } else
      // Dado desta loja (duas contas com o mesmo e-mail), não falha de integração:
      // o cliente é registrado em braavo_record_issues, as contas continuam separadas
      // (nada é fundido) e o resto da sincronização segue.
      throw new BraavoRecordError(
        "Conflito de e-mail entre clientes distintos; revise o cadastro na Braavo.",
        "CUSTOMER_IDENTITY_CONFLICT",
      );
  }
  const { createdAt, registrationStatus, ...update } = normalized;
  const [customer] = await tx
    .insert(customersTable)
    .values({ clientId, ...normalized })
    .onConflictDoUpdate({
      target: [customersTable.clientId, customersTable.externalId],
      set: { ...update, ...(row.data_criado ? { createdAt } : {}) },
    })
    .returning({ id: customersTable.id });
  return customer.id;
}
export async function persistSku(
  tx: Tx,
  clientId: string,
  row: BraavoRecord,
  cache: Map<string, BraavoRecord>,
) {
  const skuId = braavoId(row.id),
    productId = braavoId(row.produto_id);
  const product = cache.get(`products:${productId}`);
  // Dado desta loja (SKU órfão, ou produto criado depois da fase de produtos), não
  // falha de integração: é registrado e a carga continua. O SKU volta sozinho no
  // ciclo seguinte, quando o produto já estiver no catálogo.
  if (!product)
    throw new BraavoRecordError(
      "SKU Braavo sem produto correspondente no catálogo.",
      "SKU_WITHOUT_PRODUCT",
    );
  const externalId = `braavo:${productId}:${skuId}`;
  const ref = textValue(row.ref) ?? `braavo-${skuId}`;
  const [existingRef] = await tx
    .select({ externalId: productsTable.externalId })
    .from(productsTable)
    .where(
      and(eq(productsTable.clientId, clientId), eq(productsTable.sku, ref)),
    );
  const sku =
    existingRef && existingRef.externalId !== externalId
      ? `${ref}#braavo-${skuId}`
      : ref;
  const { color, size } = variantLabels(cache, row.var1_id, row.var2_id);
  const name = textValue(product.nome) ?? `Produto ${productId}`;
  const category = cache.get(`categories:${product.categoria_id}`);
  const values = {
    externalId,
    sku,
    name:
      color && size
        ? `${name} (${color}, ${size})`
        : [name, color ?? size].filter(Boolean).join(" - "),
    description: textValue(product.descricao),
    category: textValue(category?.nome),
    price: money(row.preco_venda, true),
    cost: row.preco_custo == null ? null : money(row.preco_custo),
    stock: stockQuantity(row.estoque),
    imageUrl: textValue(product.imageUrl),
    status:
      String(row.ativo) === "1" && String(product.ativo) === "1"
        ? ("ACTIVE" as const)
        : ("INACTIVE" as const),
    sourceSyncedAt: new Date(),
  };
  await tx
    .insert(productsTable)
    .values({ clientId, ...values })
    .onConflictDoUpdate({
      target: [productsTable.clientId, productsTable.externalId],
      set: values,
    });
}
/**
 * Totais de TODOS os clientes e produtos da loja numa só passada (agregação em
 * conjunto). Usado ao fim da carga completa, que adia esses recálculos para não
 * refazê-los a cada um dos ~64 mil pedidos. Mesmo resultado dos totais por pedido.
 */
async function refreshAllEntityTotals(tx: Tx, clientId: string) {
  await tx.execute(sql`
    UPDATE customers c SET total_orders = COALESCE(s.n, 0), total_spent = COALESCE(s.spent, 0),
      first_purchase_at = s.first_at, last_purchase_at = s.last_at
    FROM (
      SELECT c2.id, a.n, a.spent, a.first_at, a.last_at
      FROM customers c2
      LEFT JOIN (
        SELECT customer_id, count(*)::int AS n, sum(fulfilled_amount) AS spent,
          min(created_at) AS first_at, max(created_at) AS last_at
        FROM orders
        WHERE client_id = ${clientId} AND status IN ('APPROVED','SHIPPED','DELIVERED')
        GROUP BY customer_id
      ) a ON a.customer_id = c2.id
      WHERE c2.client_id = ${clientId}
    ) s
    WHERE c.client_id = ${clientId} AND c.id = s.id
  `);
  await tx.execute(sql`
    UPDATE products p SET total_sold = COALESCE(s.total_sold, 0), total_revenue = COALESCE(s.total_revenue, 0)
    FROM (SELECT target.id,
        sum(oi.fulfilled_quantity) FILTER (WHERE o.status IN ('APPROVED','SHIPPED','DELIVERED'))::int AS total_sold,
        sum(oi.fulfilled_quantity * oi.price_at_sale) FILTER (WHERE o.status IN ('APPROVED','SHIPPED','DELIVERED')) AS total_revenue
      FROM products target
      LEFT JOIN order_items oi ON oi.product_id = target.id
      LEFT JOIN orders o ON o.id = oi.order_id AND o.client_id = ${clientId}
      WHERE target.client_id = ${clientId}
      GROUP BY target.id) s
    WHERE p.client_id = ${clientId} AND p.id = s.id
  `);
}
export async function consolidateBraavoAggregates(clientId: string, leaseId: string) {
  await db.transaction(async (tx) => {
    await assertLease(tx, clientId, leaseId);
    await refreshAllEntityTotals(tx, clientId);
  });
  const [{ first }] = await db
    .select({ first: min(ordersTable.createdAt) })
    .from(ordersTable)
    .where(and(eq(ordersTable.clientId, clientId), like(ordersTable.externalId, "braavo:%")));
  if (first)
    await refreshDailyClientMetrics({ clientId, from: first, to: new Date() });
}
async function refreshEntityTotals(
  tx: Tx,
  clientId: string,
  customerIds: string[],
  productIds: string[],
) {
  if (customerIds.length)
    await tx.execute(sql`
    UPDATE customers c SET total_orders = (SELECT count(*)::int FROM orders o WHERE o.customer_id=c.id AND o.client_id=${clientId} AND o.status IN ('APPROVED','SHIPPED','DELIVERED')),
      total_spent = (SELECT coalesce(sum(o.fulfilled_amount),0) FROM orders o WHERE o.customer_id=c.id AND o.client_id=${clientId} AND o.status IN ('APPROVED','SHIPPED','DELIVERED')),
      first_purchase_at = (SELECT min(o.created_at) FROM orders o WHERE o.customer_id=c.id AND o.client_id=${clientId} AND o.status IN ('APPROVED','SHIPPED','DELIVERED')),
      last_purchase_at = (SELECT max(o.created_at) FROM orders o WHERE o.customer_id=c.id AND o.client_id=${clientId} AND o.status IN ('APPROVED','SHIPPED','DELIVERED'))
    WHERE c.client_id=${clientId} AND c.id IN (${sql.join(
      customerIds.map((id) => sql`${id}`),
      sql`,`,
    )})
  `);
  if (productIds.length)
    await tx.execute(sql`
    UPDATE products p SET total_sold=coalesce(s.total_sold,0), total_revenue=coalesce(s.total_revenue,0)
    FROM (SELECT target.id, sum(oi.fulfilled_quantity) FILTER (WHERE o.status IN ('APPROVED','SHIPPED','DELIVERED'))::int AS total_sold,
      sum(oi.fulfilled_quantity*oi.price_at_sale) FILTER (WHERE o.status IN ('APPROVED','SHIPPED','DELIVERED')) AS total_revenue
      FROM products target LEFT JOIN order_items oi ON oi.product_id=target.id LEFT JOIN orders o ON o.id=oi.order_id AND o.client_id=${clientId}
      WHERE target.client_id=${clientId} AND target.id IN (${sql.join(
        productIds.map((id) => sql`${id}`),
        sql`,`,
      )}) GROUP BY target.id) s
    WHERE p.client_id=${clientId} AND p.id=s.id
  `);
}
export async function persistOrder(
  clientId: string,
  leaseId: string,
  row: BraavoRecord,
  cache: Map<string, BraavoRecord>,
  /** Carga completa: totais e métricas do dia são recalculados uma vez no fim. */
  deferAggregates = false,
) {
  const normalized = normalizeBraavoOrder(row);
  const { items, paid, ...values } = normalized;
  await db.transaction(async (tx) => {
    await assertLease(tx, clientId, leaseId);
    // Preserve the customer's real signup date when the orders API embeds only
    // its contact snapshot. Missing customers can still be imported safely.
    const [knownCustomer] = await tx
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(
        and(
          eq(customersTable.clientId, clientId),
          eq(customersTable.externalId, `braavo:${braavoId(row.usuario_id)}`),
        ),
      );
    const customerId =
      knownCustomer?.id ??
      (await persistCustomer(
        tx,
        clientId,
        {
          id: row.usuario_id,
          nome: row.usuario_nome,
          email: row.usuario_email,
          tel_1: row.usuario_tel_1,
          pessoa: row.usuario_pessoa,
          cpf: row.usuario_cpf,
          cnpj: row.usuario_cnpj,
        },
        values.createdAt,
        true,
      ));
    const [previous] = await tx
      .select({ id: ordersTable.id, customerId: ordersTable.customerId })
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.clientId, clientId),
          eq(ordersTable.externalId, values.externalId),
        ),
      );
    const previousItems = previous
      ? await tx
          .select({ productId: orderItemsTable.productId })
          .from(orderItemsTable)
          .where(eq(orderItemsTable.orderId, previous.id))
      : [];
    const [order] = await tx
      .insert(ordersTable)
      .values({ clientId, customerId, ...values })
      .onConflictDoUpdate({
        target: [ordersTable.clientId, ordersTable.externalId],
        set: { ...values, customerId },
      })
      .returning({ id: ordersTable.id });
    await tx
      .delete(orderItemsTable)
      .where(eq(orderItemsTable.orderId, order.id));
    const productIds = new Set(previousItems.map((i) => i.productId));
    for (const item of items) {
      const { externalId, sku, name, variation1, variation2, ...itemValues } =
        item;
      let [product] = await tx
        .select({ id: productsTable.id })
        .from(productsTable)
        .where(
          and(
            eq(productsTable.clientId, clientId),
            eq(productsTable.externalId, externalId),
          ),
        );
      if (!product) {
        // Deleted historical variants are archived, never presented as available stock.
        [product] = await tx
          .insert(productsTable)
          .values({
            clientId,
            externalId,
            sku: `braavo-archive-${externalId.split(":").at(-1)}`,
            name,
            price: item.grossPriceAtSale,
            status: "INACTIVE",
          })
          .returning({ id: productsTable.id });
      }
      productIds.add(product.id);
      await tx.insert(orderItemsTable).values({
        orderId: order.id,
        productId: product.id,
        ...itemValues,
        ...variantLabels(cache, variation1, variation2),
      });
    }
    const eventId = `braavo:purchase:${braavoId(row.id)}`;
    if (paid)
      await tx
        .insert(eventsTable)
        .values({
          clientId,
          customerId,
          orderId: order.id,
          eventType: "PURCHASE",
          externalSourceId: eventId,
          createdAt: values.approvalDate!,
          metadata: {
            source: "braavo",
            utm_source: values.utmSource,
            utm_medium: values.utmMedium,
            utm_campaign: values.utmCampaign,
            utm_content: values.utmContent,
            utm_term: values.utmTerm,
          },
        })
        .onConflictDoUpdate({
          target: [
            eventsTable.clientId,
            eventsTable.eventType,
            eventsTable.externalSourceId,
          ],
          targetWhere: sql`external_source_id IS NOT NULL`,
          set: {
            customerId,
            createdAt: values.approvalDate!,
            metadata: {
              source: "braavo",
              utm_source: values.utmSource,
              utm_medium: values.utmMedium,
              utm_campaign: values.utmCampaign,
              utm_content: values.utmContent,
              utm_term: values.utmTerm,
            },
          },
        });
    else
      await tx
        .delete(eventsTable)
        .where(
          and(
            eq(eventsTable.clientId, clientId),
            eq(eventsTable.eventType, "PURCHASE"),
            eq(eventsTable.externalSourceId, eventId),
          ),
        );
    if (!deferAggregates)
      await refreshEntityTotals(
        tx,
        clientId,
        [...new Set([customerId, ...(previous ? [previous.customerId] : [])])],
        [...productIds],
      );
  });
  if (deferAggregates) return;
  // Refresh the original creation day, even for a payment/cancellation years later.
  await refreshDailyClientMetrics({
    clientId,
    from: values.createdAt,
    to: values.createdAt,
  });
  if (
    values.approvalDate &&
    braavoDay(values.approvalDate) !== braavoDay(values.createdAt)
  )
    await refreshDailyClientMetrics({
      clientId,
      from: values.approvalDate,
      to: values.approvalDate,
    });
}

// ---------------------------------------------------------------------------
// Carga completa em lote (clientes e pedidos)
//
// Cada pedido/cliente gravado um a um custava ~25 idas e vindas ao banco (~0,45 s), o
// que limitava a carga a ~130 pedidos/min e deixava uma loja de 115 mil pedidos em
// ~15 h. Aqui a página inteira (100 registros) é validada em memória e gravada em
// poucos comandos dentro de UMA transação. O resultado no banco é o mesmo da gravação
// registro a registro (há um teste que compara os dois). Um registro inválido é
// registrado e pulado, como antes; erro de banco/rede/lease derruba a página inteira,
// que é refeita inteira (tudo é idempotente).
// ---------------------------------------------------------------------------
const BULK_BATCH_BUDGET_MS = 25_000;
const UPSERT_CHUNK = 500;

function chunks<T>(list: T[], size = UPSERT_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
/** SET col = excluded.col para as colunas informadas (upsert em várias linhas). */
function excludedSet(table: Parameters<typeof getTableColumns>[0], keys: string[]) {
  const columns = getTableColumns(table) as Record<string, { name: string }>;
  return Object.fromEntries(
    keys.map((key) => [key, sql.raw(`excluded."${columns[key].name}"`)]),
  );
}

type Validated<T> = { row: BraavoRecord; id: string; value: T };
/**
 * Valida a página em memória. Inválidos (BraavoRecordError) são anotados em lote em
 * braavo_record_issues; qualquer outro erro sobe. Respeita o teto de inválidos do ciclo.
 */
async function validateBulk<T>(
  clientId: string,
  phase: string,
  rows: BraavoRecord[],
  counter: SkipCounter,
  check: (row: BraavoRecord) => T,
): Promise<Validated<T>[]> {
  const good: Validated<T>[] = [];
  const bad: { id: string; reason: string }[] = [];
  for (const row of rows) {
    const id = braavoId(row.id);
    try {
      good.push({ row, id, value: check(row) });
    } catch (error) {
      if (!(error instanceof BraavoRecordError)) throw error;
      bad.push({ id, reason: error.message });
    }
  }
  if (bad.length) {
    counter.skipped += bad.length;
    await recordIssuesBulk(clientId, phase, bad);
    for (const b of bad)
      logger.warn(
        { clientId, phase, externalId: b.id, reason: b.reason },
        "[braavo] registro inválido ignorado; a sincronização continua",
      );
    assertSkipCeiling(counter);
  }
  return good;
}
async function recordIssuesBulk(
  clientId: string,
  phase: string,
  bad: { id: string; reason: string }[],
) {
  await db
    .insert(issues)
    .values(bad.map((b) => ({ clientId, phase, externalId: b.id, reason: b.reason })))
    .onConflictDoUpdate({
      target: [issues.clientId, issues.phase, issues.externalId],
      set: {
        reason: sql`excluded.reason`,
        attempts: sql`${issues.attempts} + 1`,
        lastSeenAt: new Date(),
      },
    });
}
function assertSkipCeiling(counter: SkipCounter) {
  if (counter.skipped > MAX_SKIPPED_PER_CYCLE)
    throw new BraavoError(
      `Mais de ${MAX_SKIPPED_PER_CYCLE} registros inválidos neste ciclo. Isso sugere mudança no formato da Braavo e não dados antigos; confira os registros ignorados antes de retomar.`,
      "BRAAVO_TOO_MANY_INVALID",
    );
}
async function clearIssues(tx: Tx, clientId: string, phase: string, ids: string[]) {
  for (const part of chunks(ids))
    await tx
      .delete(issues)
      .where(
        and(
          eq(issues.clientId, clientId),
          eq(issues.phase, phase),
          inArray(issues.externalId, part),
        ),
      );
}

/** Itens de pedido / endereços copiados na fase anterior, agrupados por dono (ordem por id). */
async function loadStagedByOwner(
  clientId: string,
  kind: "order_items" | "customer_addresses",
  ownerField: "pedido_id" | "usuario_id",
  ownerIds: string[],
) {
  const out = new Map<string, BraavoRecord[]>();
  if (!ownerIds.length) return out;
  const staged = await db
    .select({ data: catalog.data })
    .from(catalog)
    .where(
      and(
        eq(catalog.clientId, clientId),
        eq(catalog.kind, kind),
        sql`${catalog.data}->>${ownerField} IN (${sql.join(
          ownerIds.map((id) => sql`${id}`),
          sql`,`,
        )})`,
      ),
    );
  for (const { data } of staged) {
    const key = braavoId(data[ownerField]);
    out.set(key, [...(out.get(key) ?? []), data]);
  }
  // Mesma ordem do detalhe (por id): o cadastro usa o primeiro endereço ativo.
  for (const list of out.values())
    list.sort((a, b) => Number(braavoId(a.id)) - Number(braavoId(b.id)));
  return out;
}

type OrderNorm = ReturnType<typeof normalizeBraavoOrder>;
type CustomerNorm = ReturnType<typeof normalizeBraavoCustomer>;
const snapshotOf = (row: BraavoRecord) => ({
  id: row.usuario_id,
  nome: row.usuario_nome,
  email: row.usuario_email,
  tel_1: row.usuario_tel_1,
  pessoa: row.usuario_pessoa,
  cpf: row.usuario_cpf,
  cnpj: row.usuario_cnpj,
});

/**
 * Grava uma página de pedidos (já com `produtos`) numa transação só. Totais de
 * cliente/produto e métricas por dia ficam para o fim da carga completa.
 */
export async function persistOrdersBulk(
  clientId: string,
  leaseId: string,
  rows: BraavoRecord[],
  cache: Map<string, BraavoRecord>,
  counter: SkipCounter,
) {
  if (!rows.length) return;
  // Clientes que já existem (leitura), para saber de quem precisa do resumo do pedido.
  const wantedCustomers = [
    ...new Set(rows.map((row) => `braavo:${braavoId(row.usuario_id)}`)),
  ];
  const known = new Map<string, string>();
  for (const part of chunks(wantedCustomers))
    for (const c of await db
      .select({ id: customersTable.id, externalId: customersTable.externalId })
      .from(customersTable)
      .where(
        and(eq(customersTable.clientId, clientId), inArray(customersTable.externalId, part)),
      ))
      known.set(c.externalId!, c.id);

  type Prepared = { order: OrderNorm; snapshot?: CustomerNorm };
  const valid = await validateBulk<Prepared>(clientId, "orders", rows, counter, (row) => {
    const order = normalizeBraavoOrder(row);
    const ext = `braavo:${braavoId(row.usuario_id)}`;
    return {
      order,
      snapshot: known.has(ext)
        ? undefined
        : normalizeBraavoCustomer(snapshotOf(row), order.createdAt),
    };
  });
  if (!valid.length) return;

  await db.transaction(async (tx) => {
    await assertLease(tx, clientId, leaseId);

    // 1) Clientes que só existem no resumo do pedido (conta antiga, etc.).
    const toCreate = new Map<string, CustomerNorm>();
    for (const { value } of valid)
      if (value.snapshot) {
        const ext = value.snapshot.externalId;
        const prev = toCreate.get(ext);
        if (!prev || value.snapshot.createdAt < prev.createdAt)
          toCreate.set(ext, value.snapshot);
      }
    const customerIdByExt = new Map(known);
    if (toCreate.size) {
      const list = [...toCreate.values()];
      const taken = new Map<string, string>();
      for (const part of chunks(list.map((c) => c.email)))
        for (const t of await tx
          .select({ email: customersTable.email, externalId: customersTable.externalId })
          .from(customersTable)
          .where(and(eq(customersTable.clientId, clientId), inArray(customersTable.email, part))))
          taken.set(t.email, t.externalId!);
      const usedNow = new Set<string>();
      for (const c of list) {
        // E-mail de outra conta (já gravada ou desta mesma página): cliente próprio,
        // com o e-mail de reserva, sem fundir duas contas só pelo e-mail.
        const owner = taken.get(c.email);
        if ((owner && owner !== c.externalId) || usedNow.has(c.email))
          c.email = `braavo-${c.externalId.slice(7)}@unknown.local`;
        usedNow.add(c.email);
      }
      for (const part of chunks(list)) {
        const created = await tx
          .insert(customersTable)
          .values(part.map((c) => ({ clientId, ...c })))
          .onConflictDoUpdate({
            target: [customersTable.clientId, customersTable.externalId],
            set: excludedSet(customersTable, [
              "name",
              "state",
              "city",
              "email",
              "phone",
              "documentType",
              "documentHash",
              "documentLast4",
            ]),
          })
          .returning({ id: customersTable.id, externalId: customersTable.externalId });
        for (const c of created) customerIdByExt.set(c.externalId!, c.id);
      }
    }

    // 2) Pedidos que já existiam: os itens antigos saem antes de reinserir.
    const externalIds = valid.map(({ value }) => value.order.externalId);
    const previous: string[] = [];
    for (const part of chunks(externalIds))
      for (const p of await tx
        .select({ id: ordersTable.id })
        .from(ordersTable)
        .where(and(eq(ordersTable.clientId, clientId), inArray(ordersTable.externalId, part))))
        previous.push(p.id);
    for (const part of chunks(previous))
      await tx.delete(orderItemsTable).where(inArray(orderItemsTable.orderId, part));

    // 3) Pedidos (upsert em várias linhas).
    const orderRows = valid.map(({ row, value }) => {
      const { items: _items, paid: _paid, ...values } = value.order;
      return {
        clientId,
        customerId: customerIdByExt.get(`braavo:${braavoId(row.usuario_id)}`)!,
        ...values,
      };
    });
    const orderKeys = Object.keys(orderRows[0]).filter(
      (key) => key !== "clientId" && key !== "externalId",
    );
    const orderIdByExt = new Map<string, string>();
    for (const part of chunks(orderRows)) {
      const saved = await tx
        .insert(ordersTable)
        .values(part)
        .onConflictDoUpdate({
          target: [ordersTable.clientId, ordersTable.externalId],
          set: excludedSet(ordersTable, orderKeys),
        })
        .returning({ id: ordersTable.id, externalId: ordersTable.externalId });
      for (const o of saved) orderIdByExt.set(o.externalId!, o.id);
    }

    // 4) Produtos dos itens (variantes antigas apagadas viram "arquivadas").
    const productInfo = new Map<string, { name: string; price: number }>();
    for (const { value } of valid)
      for (const item of value.order.items)
        if (!productInfo.has(item.externalId))
          productInfo.set(item.externalId, { name: item.name, price: item.grossPriceAtSale });
    const productIdByExt = new Map<string, string>();
    const productExts = [...productInfo.keys()];
    for (const part of chunks(productExts))
      for (const p of await tx
        .select({ id: productsTable.id, externalId: productsTable.externalId })
        .from(productsTable)
        .where(and(eq(productsTable.clientId, clientId), inArray(productsTable.externalId, part))))
        productIdByExt.set(p.externalId!, p.id);
    const missingProducts = productExts.filter((ext) => !productIdByExt.has(ext));
    for (const part of chunks(missingProducts)) {
      const inserted = await tx
        .insert(productsTable)
        .values(
          part.map((ext) => ({
            clientId,
            externalId: ext,
            sku: `braavo-archive-${ext.split(":").at(-1)}`,
            name: productInfo.get(ext)!.name,
            price: productInfo.get(ext)!.price,
            status: "INACTIVE" as const,
          })),
        )
        .onConflictDoNothing({ target: [productsTable.clientId, productsTable.externalId] })
        .returning({ id: productsTable.id, externalId: productsTable.externalId });
      for (const p of inserted) productIdByExt.set(p.externalId!, p.id);
    }

    // 5) Itens.
    const itemRows = valid.flatMap(({ value }) =>
      value.order.items.map((item) => {
        const {
          externalId,
          sku: _sku,
          name: _name,
          variation1,
          variation2,
          ...itemValues
        } = item;
        return {
          orderId: orderIdByExt.get(value.order.externalId)!,
          productId: productIdByExt.get(externalId)!,
          ...itemValues,
          ...variantLabels(cache, variation1, variation2),
        };
      }),
    );
    for (const part of chunks(itemRows)) await tx.insert(orderItemsTable).values(part);

    // 6) Eventos de compra: pagos entram/atualizam, os demais saem.
    const paid = valid.filter(({ value }) => value.order.paid);
    const unpaid = valid.filter(({ value }) => !value.order.paid);
    for (const part of chunks(paid))
      await tx
        .insert(eventsTable)
        .values(
          part.map(({ row, value }) => ({
            clientId,
            customerId: customerIdByExt.get(`braavo:${braavoId(row.usuario_id)}`)!,
            orderId: orderIdByExt.get(value.order.externalId)!,
            eventType: "PURCHASE" as const,
            externalSourceId: `braavo:purchase:${braavoId(row.id)}`,
            createdAt: value.order.approvalDate!,
            metadata: {
              source: "braavo",
              utm_source: value.order.utmSource,
              utm_medium: value.order.utmMedium,
              utm_campaign: value.order.utmCampaign,
              utm_content: value.order.utmContent,
              utm_term: value.order.utmTerm,
            },
          })),
        )
        .onConflictDoUpdate({
          target: [eventsTable.clientId, eventsTable.eventType, eventsTable.externalSourceId],
          targetWhere: sql`external_source_id IS NOT NULL`,
          set: excludedSet(eventsTable, ["customerId", "createdAt", "metadata"]),
        });
    for (const part of chunks(unpaid))
      await tx.delete(eventsTable).where(
        and(
          eq(eventsTable.clientId, clientId),
          eq(eventsTable.eventType, "PURCHASE"),
          inArray(
            eventsTable.externalSourceId,
            part.map(({ row }) => `braavo:purchase:${braavoId(row.id)}`),
          ),
        ),
      );

    await clearIssues(tx, clientId, "orders", valid.map((v) => v.id));
  });
}

/**
 * Grava uma página de clientes (listagem + endereços copiados) numa transação só.
 * Conta que repete o e-mail de outra é registrada (nada é fundido), como no modo
 * registro a registro.
 */
export async function persistCustomersBulk(
  clientId: string,
  leaseId: string,
  rows: BraavoRecord[],
  addresses: Map<string, BraavoRecord[]>,
  counter: SkipCounter,
) {
  if (!rows.length) return;
  const valid = await validateBulk<CustomerNorm>(clientId, "customers", rows, counter, (row) =>
    normalizeBraavoCustomer({ ...row, enderecos: addresses.get(braavoId(row.id)) ?? [] }),
  );
  if (!valid.length) return;

  // E-mails já usados por OUTRA conta (leitura) e repetidos dentro da própria página.
  const owners = new Map<string, string>();
  for (const part of chunks(valid.map((v) => v.value.email)))
    for (const t of await db
      .select({ email: customersTable.email, externalId: customersTable.externalId })
      .from(customersTable)
      .where(and(eq(customersTable.clientId, clientId), inArray(customersTable.email, part))))
      owners.set(t.email, t.externalId!);
  const accepted: Validated<CustomerNorm>[] = [];
  const conflicts: Validated<CustomerNorm>[] = [];
  const claimed = new Map<string, string>();
  for (const v of valid) {
    const holder = owners.get(v.value.email) ?? claimed.get(v.value.email);
    if (holder && holder !== v.value.externalId) conflicts.push(v);
    else {
      accepted.push(v);
      claimed.set(v.value.email, v.value.externalId);
    }
  }
  if (conflicts.length) {
    counter.skipped += conflicts.length;
    await recordIssuesBulk(
      clientId,
      "customers",
      conflicts.map((v) => ({
        id: v.id,
        reason: "Conflito de e-mail entre clientes distintos; revise o cadastro na Braavo.",
      })),
    );
    assertSkipCeiling(counter);
  }

  await db.transaction(async (tx) => {
    await assertLease(tx, clientId, leaseId);
    for (const part of chunks(accepted))
      await tx
        .insert(customersTable)
        .values(part.map((v) => ({ clientId, ...v.value })))
        .onConflictDoUpdate({
          target: [customersTable.clientId, customersTable.externalId],
          set: excludedSet(customersTable, [
            "name",
            "state",
            "city",
            "email",
            "phone",
            "documentType",
            "documentHash",
            "documentLast4",
            "createdAt",
          ]),
        });
    await clearIssues(tx, clientId, "customers", accepted.map((v) => v.id));
  });
}

async function runPage(
  clientId: string,
  leaseId: string,
  api: BraavoApi,
  cursor: BraavoCursor,
) {
  const cache = await cachedCatalog(clientId);
  if (cursor.phase === "pending") {
    const rows = await db
      .select({ externalId: ordersTable.externalId })
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.clientId, clientId),
          eq(ordersTable.status, "PENDING"),
          like(ordersTable.externalId, "braavo:%"),
          cursor.afterId
            ? gt(ordersTable.externalId, cursor.afterId)
            : undefined,
        ),
      )
      .orderBy(ordersTable.externalId)
      .limit(10);
    const pendingCounter: SkipCounter = { skipped: cursor.skipped ?? 0 };
    for (const row of rows) {
      const detail = await api.one(
        "/pedidos/buscar/id",
        row.externalId!.slice(7),
      );
      await importRecord(
        clientId,
        "pending",
        row.externalId!.slice(7),
        pendingCounter,
        () => persistOrder(clientId, leaseId, detail, cache),
      );
    }
    return {
      processed: rows.length,
      cursor:
        rows.length < 10
          ? {
              ...cursor,
              phase: "done" as const,
              skipped: pendingCounter.skipped,
            }
          : {
              ...cursor,
              afterId: rows.at(-1)!.externalId!,
              skipped: pendingCounter.skipped,
            },
    };
  }
  const paths = {
    categories: "categorias",
    variations: "variacoes",
    products: "produtos",
    skus: "skus",
    customers: "clientes",
    customer_addresses: "enderecos",
    order_items: "pedidos_produtos",
    orders: "pedidos",
  };
  if (cursor.phase === "done") return { processed: 0, cursor };
  // Carga completa: pedidos e itens em lote, 100 por chamada (a API aceita; o
  // detalhe individual era 1 chamada por pedido). Demais fases mantêm o tamanho antigo.
  const bulkOrders = cursor.phase === "orders" && cursor.full;
  // Idem clientes: a listagem traz o cadastro inteiro (confirmado igual ao detalhe) e
  // os endereços vêm da cópia em lote, então não há consulta por cliente.
  const bulkCustomers = cursor.phase === "customers" && cursor.full;
  const limit =
    cursor.phase === "order_items" ||
    cursor.phase === "customer_addresses" ||
    bulkOrders ||
    bulkCustomers
      ? 100
      : ["products", "orders"].includes(cursor.phase)
        ? 10
        : PAGE_SIZE;
  const page = await api.page(
    `/${paths[cursor.phase]}/buscar/todos`,
    cursor.page,
    limit,
    cursor.day ? { data_alterado: cursor.day } : {},
  );
  if (cursor.phase === "skus" && page.rows.length) {
    const productIds = [
      ...new Set(page.rows.map((row) => braavoId(row.produto_id))),
    ];
    const products = await db
      .select()
      .from(catalog)
      .where(
        and(
          eq(catalog.clientId, clientId),
          eq(catalog.kind, "products"),
          inArray(catalog.externalId, productIds),
        ),
      );
    for (const product of products)
      cache.set(`products:${product.externalId}`, product.data);
  }
  if (cursor.phase === "order_items" || cursor.phase === "customer_addresses") {
    const stageKind = cursor.phase;
    // Cada ciclo do job custa pausas fixas (~7 s). Gravar uma página por ciclo
    // deixava a cópia de 188 mil itens em ~4 h; aqui lemos várias páginas por ciclo,
    // dentro do orçamento do lote. A gravação é idempotente: se o ciclo cair no meio,
    // as páginas são refeitas sem duplicar.
    const batchStarted = Date.now();
    let current = cursor;
    let currentPage = page;
    let copied = 0;
    for (;;) {
      await db.transaction(async (tx) => {
        await assertLease(tx, clientId, leaseId);
        // Primeira página: descarta cópia de um ciclo anterior interrompido.
        if (current.page === 1)
          await tx
            .delete(catalog)
            .where(
              and(eq(catalog.clientId, clientId), eq(catalog.kind, stageKind)),
            );
        if (currentPage.rows.length)
          await tx
            .insert(catalog)
            .values(
              currentPage.rows.map((row) => ({
                clientId,
                kind: stageKind,
                externalId: braavoId(row.id),
                data: row,
              })),
            )
            .onConflictDoUpdate({
              target: [catalog.clientId, catalog.kind, catalog.externalId],
              set: { data: sql`excluded.data` },
            });
      });
      copied += currentPage.rows.length;
      current = advanceBraavoCursor(current, currentPage.complete);
      if (
        current.phase !== stageKind ||
        Date.now() - batchStarted > ITEMS_BATCH_BUDGET_MS
      )
        break;
      currentPage = await api.page(
        `/${paths[stageKind]}/buscar/todos`,
        current.page,
        limit,
      );
    }
    return {
      processed: copied,
      cursor: { ...current, skipped: cursor.skipped ?? 0 },
    };
  }
  if (bulkOrders || bulkCustomers) {
    // Carga completa: a página inteira vai para o banco em poucos comandos e várias
    // páginas são lidas por ciclo (cada ciclo do job custa pausas fixas de ~7 s).
    const batchStarted = Date.now();
    const counter: SkipCounter = { skipped: cursor.skipped ?? 0 };
    const phase = cursor.phase;
    let current = cursor;
    let currentPage = page;
    let done = 0;
    for (;;) {
      const ids = currentPage.rows.map((row) => braavoId(row.id));
      if (bulkOrders) {
        const items = await loadStagedByOwner(clientId, "order_items", "pedido_id", ids);
        const withItems = currentPage.rows.map((row) => ({
          ...row,
          produtos: items.get(braavoId(row.id)) ?? [],
        }));
        await persistOrdersBulk(clientId, leaseId, withItems, cache, counter);
      } else {
        const addresses = await loadStagedByOwner(clientId, "customer_addresses", "usuario_id", ids);
        await persistCustomersBulk(clientId, leaseId, currentPage.rows, addresses, counter);
      }
      done += currentPage.rows.length;
      if (currentPage.complete) {
        if (bulkOrders)
          // Última página da carga completa: agora sim os totais e as métricas por dia.
          await consolidateBraavoAggregates(clientId, leaseId);
        await db
          .delete(catalog)
          .where(
            and(
              eq(catalog.clientId, clientId),
              eq(catalog.kind, bulkOrders ? "order_items" : "customer_addresses"),
            ),
          );
      }
      current = advanceBraavoCursor(current, currentPage.complete);
      if (current.phase !== phase || Date.now() - batchStarted > BULK_BATCH_BUDGET_MS) break;
      currentPage = await api.page(`/${paths[phase]}/buscar/todos`, current.page, limit);
    }
    return { processed: done, cursor: { ...current, skipped: counter.skipped } };
  }
  const processedIds = new Set(cursor.processedIds ?? []);
  const counter: SkipCounter = { skipped: cursor.skipped ?? 0 };
  let processed = 0;
  async function checkpointRecord(id: string) {
    processedIds.add(id);
    await db.transaction(async (tx) => {
      await assertLease(tx, clientId, leaseId);
      await tx.update(states)
        .set({
          cursor: {
            ...cursor,
            processedIds: [...processedIds],
            skipped: counter.skipped,
          },
        })
        .where(eq(states.clientId, clientId));
    });
    processed++;
  }
  for (const row of page.rows) {
    const id = braavoId(row.id);
    if (processedIds.has(id)) continue;
    if (cursor.phase === "orders") {
      const detail = await api.one("/pedidos/buscar/id", row.id);
      await importRecord(clientId, "orders", id, counter, () =>
        persistOrder(clientId, leaseId, detail, cache),
      );
      await checkpointRecord(id);
      continue;
    }
    // Fetch (network) stays outside the guarded step: only the validation and
    // persistence of this record may be quarantined.
    const detail =
      cursor.phase === "customers"
        ? await api.one("/clientes/buscar/id", row.id)
        : cursor.phase === "products"
          ? await api.one("/produtos/buscar/id", row.id)
          : undefined;
    await importRecord(clientId, cursor.phase, id, counter, async () => {
      let data = row;
      if (cursor.phase === "customers") data = { ...row, ...detail };
      if (cursor.phase === "products") {
        const photos = Array.isArray(detail!.fotos)
          ? detail!.fotos.map(braavoRecord)
          : [];
        data = {
          id: detail!.id,
          nome: detail!.nome,
          ativo: detail!.ativo,
          descricao: detail!.descricao,
          categoria_id: detail!.categoria_id,
          imageUrl:
            photos.map((photo) => textValue(photo.foto_1)).find(Boolean) ??
            null,
        };
      }
      await db.transaction(async (tx) => {
        await assertLease(tx, clientId, leaseId);
        if (cursor.phase === "customers") {
          await persistCustomer(tx, clientId, data);
          return;
        }
        if (cursor.phase === "skus") {
          await persistSku(tx, clientId, row, cache);
          return;
        }
        const kind = cursor.phase as "categories" | "variations" | "products";
        await tx
          .insert(catalog)
          .values({ clientId, kind, externalId: braavoId(row.id), data })
          .onConflictDoUpdate({
            target: [catalog.clientId, catalog.kind, catalog.externalId],
            set: { data },
          });
      });
    });
    // Persist only after the record and its related updates are durable. A crash
    // before this checkpoint safely replays the idempotent write, never skips it.
    await checkpointRecord(id);
  }
  // Só a carga completa viu TODOS os SKUs; no incremental (só os que mudaram) isto
  // marcaria como inativo todo SKU que simplesmente não mudou.
  if (cursor.phase === "skus" && page.complete && cursor.full) {
    await db.transaction(async (tx) => {
      await assertLease(tx, clientId, leaseId);
      await tx
        .update(productsTable)
        .set({ status: "INACTIVE", stock: 0 })
        .where(
          and(
            eq(productsTable.clientId, clientId),
            like(productsTable.externalId, "braavo:%"),
            sql`${productsTable.sourceSyncedAt} < ${cursor.startedAt}::timestamptz`,
          ),
        );
    });
  }
  return {
    processed,
    cursor: {
      ...advanceBraavoCursor(cursor, page.complete),
      skipped: counter.skipped,
    },
  };
}

export async function getBraavoSyncStatus(clientId: string) {
  const client = await getBraavoClient(clientId);
  const [state] = await db
    .select()
    .from(states)
    .where(eq(states.clientId, clientId));
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(issues)
    .where(eq(issues.clientId, clientId));
  const recentIssues = await db
    .select({
      phase: issues.phase,
      externalId: issues.externalId,
      reason: issues.reason,
      attempts: issues.attempts,
      lastSeenAt: issues.lastSeenAt,
    })
    .from(issues)
    .where(eq(issues.clientId, clientId))
    .orderBy(desc(issues.lastSeenAt))
    .limit(20);
  return {
    skippedRecords: { total, recent: recentIssues },
    configured: Boolean(
      client.commercePlatform === "BRAAVO" &&
      client.braavoDomain &&
      client.braavoApiToken &&
      client.braavoApiKey,
    ),
    cursor: state?.cursor ?? null,
    completedAt: state?.completedAt ?? null,
    error: state?.error ?? null,
    busy: Boolean(state?.leaseUntil && state.leaseUntil > new Date()),
  };
}
export async function testBraavoConnection(clientId: string) {
  const credentials = braavoCredentials(await getBraavoClient(clientId));
  const api = new BraavoApi(credentials, {
    reserveSlot: reserveBraavoSlot,
    deadline: Date.now() + 25_000,
  });
  await api.page("/clientes/buscar/todos", 1, 1);
  return { ok: true, domain: api.domain };
}

export async function runBraavoBatch(
  clientId: string,
  trigger: "manual" | "cron",
): Promise<BraavoBatchResult> {
  const leaseId = nanoid();
  const acquired = await db.transaction(async (tx) => {
    // Same lock order as connection edits: client first, then sync state.
    const [client] = await tx
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.id, clientId))
      .for("no key update");
    if (!client)
      throw new BraavoError("Cliente não encontrado.", "NOT_FOUND", 404);
    const credentials = braavoCredentials(client),
      fingerprint = braavoFingerprint(credentials);
    await tx
      .insert(states)
      .values({ clientId, fingerprint })
      .onConflictDoNothing();
    const [state] = await tx
      .update(states)
      .set({
        leaseId,
        leaseUntil: new Date(Date.now() + 90_000),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(states.clientId, clientId),
          sql`(${states.leaseUntil} IS NULL OR ${states.leaseUntil} < now())`,
        ),
      )
      .returning();
    return { state, credentials, fingerprint };
  });
  const { state, credentials, fingerprint } = acquired;
  if (!state)
    return {
      status: "busy",
      complete: false,
      message: "A sincronização desta loja já está em andamento.",
    };
  let jobId = state.jobId;
  try {
    const newCycle =
      !state.cursor ||
      state.cursor.phase === "done" ||
      fingerprint !== state.fingerprint;
    let cursor = newCycle
      ? initialBraavoCursor(
          new Date(),
          fingerprint === state.fingerprint
            ? state.cursor?.phase === "done"
              ? new Date(`${state.cursor.untilDay}T12:00:00-03:00`)
              : state.completedAt
            : null,
          fingerprint === state.fingerprint ? state.fullCompletedAt : null,
          braavoFullRefreshDays(process.env.BRAAVO_FULL_REFRESH_DAYS),
        )
      : state.cursor!;
    if (newCycle || !jobId) {
      if (jobId)
        await db
          .update(syncJobsTable)
          .set({
            status: "failed",
            error: "Ciclo substituído após alteração da conexão.",
            finishedAt: new Date(),
          })
          .where(
            and(
              eq(syncJobsTable.id, jobId),
              inArray(syncJobsTable.status, ["pending", "running", "failed"]),
            ),
          );
      const [job] = await db
        .insert(syncJobsTable)
        .values({
          clientId,
          jobType: "braavo_transactional",
          trigger,
          scope: "client",
          status: "running",
          startedAt: new Date(),
        })
        .returning({ id: syncJobsTable.id });
      jobId = job.id;
    } else
      await db
        .update(syncJobsTable)
        .set({ status: "running", error: null, finishedAt: null })
        .where(eq(syncJobsTable.id, jobId));
    await db
      .update(states)
      .set({ fingerprint, cursor, jobId, error: null })
      .where(and(eq(states.clientId, clientId), eq(states.leaseId, leaseId)));
    const api = new BraavoApi(credentials, {
      reserveSlot: reserveBraavoSlot,
      deadline: Date.now() + 50_000,
    });
    const result = await runPage(clientId, leaseId, api, cursor);
    cursor = result.cursor;
    const complete = cursor.phase === "done";
    const response: BraavoBatchResult = {
      status: complete ? "done" : "pending",
      complete,
      phase: cursor.phase,
      page: cursor.page,
      day: cursor.day,
      processed: result.processed,
      jobId,
      skipped: cursor.skipped ?? 0,
    };
    await db.transaction(async (tx) => {
      await assertLease(tx, clientId, leaseId);
      await tx
        .update(states)
        .set({
          cursor,
          error: null,
          ...(complete
            ? {
                completedAt: new Date(),
                ...(cursor.full ? { fullCompletedAt: new Date() } : {}),
              }
            : {}),
        })
        .where(eq(states.clientId, clientId));
      await tx
        .update(syncJobsTable)
        .set({
          status: complete ? "done" : "pending",
          result: response,
          ...(complete ? { finishedAt: new Date() } : {}),
        })
        .where(eq(syncJobsTable.id, jobId!));
    });
    return response;
  } catch (error) {
    const waiting =
      error instanceof BraavoError && error.code === "BATCH_DEADLINE";
    const message =
      error instanceof BraavoError
        ? error.message
        : "Falha ao persistir o lote Braavo. O ponto de retomada foi preservado.";
    await db
      .update(states)
      .set({ error: waiting ? null : message })
      .where(and(eq(states.clientId, clientId), eq(states.leaseId, leaseId)));
    if (jobId)
      await db
        .update(syncJobsTable)
        .set({
          status: waiting ? "pending" : "failed",
          error: waiting ? null : message,
          ...(waiting ? {} : { finishedAt: new Date() }),
        })
        .where(eq(syncJobsTable.id, jobId));
    return {
      status: waiting ? "pending" : "failed",
      complete: false,
      jobId,
      message,
      code: error instanceof BraavoError ? error.code : "BRAAVO_PERSISTENCE_ERROR",
    };
  } finally {
    // Set the shop-wide cooldown before releasing this client's batch lease.
    await deferBraavoBatch(credentials.domain);
    await db
      .update(states)
      .set({ leaseId: null, leaseUntil: null, updatedAt: new Date() })
      .where(and(eq(states.clientId, clientId), eq(states.leaseId, leaseId)));
  }
}
