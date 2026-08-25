import { Router, type IRouter, type Request } from "express";
import { and, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  aiAgentConfigsTable,
  aiCommercialOperationsTable,
  aiCrmCardsTable,
  clientsTable,
  commercialAutomationJobsTable,
  commercialAutomationLogsTable,
  commercialAutomationRulesTable,
  customersTable,
  db,
  ecommerceWebhookConfigsTable,
  ecommerceWebhookEventsTable,
  orderItemsTable,
  ordersTable,
  productsTable,
  upzeroIntegrationsTable,
  whatsappContactsTable,
  whatsappConversationsTable,
  whatsappIntegrationsTable,
  whatsappMessageTemplatesTable,
  whatsappMessagesTable,
  whatsappPhoneNumbersTable,
} from "@workspace/db";
import { authenticate, requireAdmin, resolveClientId } from "../middlewares/auth";
import { normalizeAutomationRuleSteps } from "../services/automation-rule-steps";
import {
  buildAutomationWabaCandidates,
  getAutomationAudience,
  hasAssignedSellerSenderMismatch,
  resolveAutomationDeliveryRouting,
  selectAutomationTemplateByWaba,
  selectAutomationSenderPhone,
} from "../services/automation-sender";
import {
  getCartAutomationDedupeKey,
  getCartAutomationIdentity,
  getWebhookCustomerIdentity,
  getWebhookOrderIdentity,
  getWebhookPayloadLayers,
  selectWebhookCustomerContact,
} from "../services/orchestrator-webhook";
import { UpzeroExternalAdapter, extractRows } from "../services/upzero/external-adapter";
import {
  maskWhatsappRecipient,
  normalizeWhatsappRecipient,
  validateWhatsappRecipient,
} from "../services/whatsapp-recipient";
import { describeWhatsappDeliveryError } from "../services/whatsapp-delivery-error";
import { fetchWhatsappTemplateCatalog } from "../services/whatsapp-template-catalog";
import {
  addWhatsappWabaVerification,
  discoverWhatsappWabaForPhone,
  getVerifiedWhatsappWabaId,
} from "../services/whatsapp-waba-discovery";

const router: IRouter = Router();

const CRM_STAGES = [
  { id: "new_contact", label: "Novo contato" },
  { id: "no_registration", label: "Sem cadastro" },
  { id: "qualification", label: "Qualificação" },
  { id: "registration_pending", label: "Cadastro pendente" },
  { id: "registration_approved", label: "Cadastro aprovado" },
  { id: "consultative_sale", label: "Venda consultiva" },
  { id: "waiting_stock", label: "Aguardando estoque" },
  { id: "waiting_payment", label: "Aguardando pagamento" },
  { id: "handoff", label: "Handoff" },
  { id: "closed", label: "Fechado" },
  { id: "lost", label: "Perdido" },
] as const;

const AUTOMATION_RULES = [
  { eventType: "order.created", name: "Pedido criado" },
  { eventType: "order.updated", name: "Pedido atualizado" },
  { eventType: "order.confirmed", name: "Pedido confirmado" },
  { eventType: "order.cancelled", name: "Pedido cancelado" },
  { eventType: "order.shipped", name: "Pedido enviado" },
  { eventType: "order.delivered", name: "Pedido entregue" },
  { eventType: "order.payment_confirmed", name: "Pagamento confirmado" },
  { eventType: "customer.created", name: "Cliente criado" },
  { eventType: "customer.updated", name: "Cliente atualizado" },
  { eventType: "customer.approved", name: "Cliente aprovado" },
  { eventType: "customer.rejected", name: "Cliente rejeitado" },
  {
    eventType: "cart_created",
    name: "Carrinho criado",
    description: "Agenda recuperação de carrinho. Padrão recomendado: enviar somente se não converter após 24 horas.",
    defaultDelayMinutes: 1440,
  },
  {
    eventType: "cart_abandoned",
    name: "Carrinho abandonado",
    description: "Dispara quando a plataforma já classificou o carrinho como abandonado.",
  },
  {
    eventType: "cart_converted",
    name: "Carrinho convertido",
    description: "Cancela automações pendentes de carrinho e registra que o cliente comprou após criar o carrinho.",
  },
] as const;

const AUTOMATION_EVENT_ALIASES = new Map<string, string>([
  ["payment.confirmed", "order.payment_confirmed"],
  ["payment_confirmed", "order.payment_confirmed"],
  ["order.payment.confirmed", "order.payment_confirmed"],
  ["order-payment-confirmed", "order.payment_confirmed"],
  ["cart.created", "cart_created"],
  ["cart-created", "cart_created"],
  ["created_cart", "cart_created"],
  ["cart.abandoned", "cart_abandoned"],
  ["cart-abandoned", "cart_abandoned"],
  ["abandoned_cart", "cart_abandoned"],
  ["checkout.abandoned", "cart_abandoned"],
  ["checkout_abandoned", "cart_abandoned"],
  ["checkout-abandoned", "cart_abandoned"],
  ["cart.converted", "cart_converted"],
  ["cart-converted", "cart_converted"],
  ["converted_cart", "cart_converted"],
  ["checkout.completed", "cart_converted"],
  ["checkout_completed", "cart_converted"],
]);

const AUTOMATION_EVENT_LABELS = new Map<string, string>(
  AUTOMATION_RULES.flatMap((rule) => [
    [rule.eventType, rule.name],
    [rule.eventType.replace(".", "_"), rule.name],
    [rule.eventType.replace(".", "-"), rule.name],
  ]),
);

type AutomationEventOption = {
  value: string;
  label: string;
  source: "upzero" | "received";
};

function normalizeAutomationEventType(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  return AUTOMATION_EVENT_ALIASES.get(normalized.toLowerCase()) ?? normalized;
}

function automationEventTypeCandidates(eventType: string): string[] {
  const canonical = normalizeAutomationEventType(eventType) ?? eventType;
  const aliases = Array.from(AUTOMATION_EVENT_ALIASES.entries())
    .filter(([, target]) => target === canonical)
    .map(([alias]) => alias);
  return Array.from(new Set([canonical, ...aliases]));
}

function automationEventLabel(eventType: string): string {
  return AUTOMATION_EVENT_LABELS.get(eventType) ?? AUTOMATION_EVENT_LABELS.get(eventType.toLowerCase()) ?? eventType;
}

const DEFAULT_AGENT_CONFIGS = [
  {
    agentType: "sales",
    name: "Agente de Vendas",
    systemPrompt: "Atue como vendedor B2B assistido. Ajude com produtos, cadastro, estoque e intenção de compra sem prometer preço antes do cadastro aprovado.",
    canAutoReply: false,
    canCreateRegistration: true,
    canCreatePreOrder: false,
  },
  {
    agentType: "registration",
    name: "Agente de Cadastros",
    systemPrompt: "Colete e valide dados de cadastro B2B. Quando faltar documento, telefone, email ou razão social, solicite de forma objetiva.",
    canAutoReply: false,
    canCreateRegistration: true,
    canCreatePreOrder: false,
  },
  {
    agentType: "support",
    name: "Agente de Atendimento",
    systemPrompt: "Organize dúvidas de frete, prazo, estoque, tamanho, cor e pagamento. Encaminhe para humano quando houver negociação sensível.",
    canAutoReply: false,
    canCreateRegistration: false,
    canCreatePreOrder: false,
  },
] as const;

const CANONICAL_APP_URL = "https://www.grupoup-dash.com.br";

function publicWebhookUrl(clientId: string) {
  return `${CANONICAL_APP_URL}/api/ecommerce/webhooks/${clientId}`;
}

function publicWebhookTemplateUrl(clientId: string, token: string | null) {
  const baseUrl = publicWebhookUrl(clientId);
  if (!token) return baseUrl;
  return `${baseUrl}?token=${encodeURIComponent(token)}&type={{type}}&phone={{phone}}`;
}

const CreateOrchestratorClientBody = z.object({
  name: z.string().min(2, "Nome da marca é obrigatório."),
  email: z.string().email("Email inválido.").optional().or(z.literal("")),
  upZeroApiKey: z.string().optional(),
  metaAdAccountId: z.string().optional(),
  createDefaultAgents: z.boolean().optional().default(true),
});

const CreateAgentBody = z.object({
  agentType: z.string().min(2, "Tipo do agente é obrigatório."),
  name: z.string().min(2, "Nome do agente é obrigatório."),
  systemPrompt: z.string().optional(),
  model: z.string().optional(),
  temperature: z.coerce.number().min(0).max(2).optional(),
  canAutoReply: z.boolean().optional().default(false),
  canCreateRegistration: z.boolean().optional().default(false),
  canCreatePreOrder: z.boolean().optional().default(false),
  canHandoff: z.boolean().optional().default(true),
});

const UpdateAutomationRuleBody = z.object({
  audience: z.enum(["customer", "internal_seller"]).optional(),
  eventType: z.string().trim().min(1).optional(),
  isEnabled: z.boolean().optional(),
  templateId: z.string().trim().nullable().optional(),
  templateName: z.string().trim().nullable().optional(),
  templateLanguage: z.string().trim().nullable().optional(),
  templateCategory: z.string().trim().nullable().optional(),
  delayMinutes: z.coerce.number().int().min(0).max(10080).optional(),
  cooldownHours: z.coerce.number().int().min(1).max(720).optional(),
  maxSendsPerCustomerMonth: z.coerce.number().int().min(1).max(100).optional(),
  sendOncePerCart: z.boolean().optional(),
});

const CreateAutomationRuleBody = z.object({
  clientId: z.string().trim().min(1),
  audience: z.enum(["customer", "internal_seller"]).optional().default("customer"),
  eventType: z.string().trim().min(1),
  isEnabled: z.boolean().optional().default(false),
  templateId: z.string().trim().nullable().optional(),
  templateName: z.string().trim().nullable().optional(),
  templateLanguage: z.string().trim().nullable().optional(),
  templateCategory: z.string().trim().nullable().optional(),
  delayMinutes: z.coerce.number().int().min(0).max(10080).default(0),
  cooldownHours: z.coerce.number().int().min(1).max(720).default(24),
  maxSendsPerCustomerMonth: z.coerce.number().int().min(1).max(100).default(4),
  sendOncePerCart: z.boolean().optional().default(true),
});

const UpdateCommercialOperationBody = z.object({
  status: z.enum(["active", "paused"]),
});

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "cliente";
}

function dateWindow(req: Request) {
  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setDate(now.getDate() - 7);
  const fromRaw = typeof req.query.from === "string" ? req.query.from : null;
  const toRaw = typeof req.query.to === "string" ? req.query.to : null;
  const from = fromRaw ? new Date(fromRaw) : defaultFrom;
  const to = toRaw ? new Date(toRaw) : now;
  return {
    from: Number.isNaN(from.getTime()) ? defaultFrom : from,
    to: Number.isNaN(to.getTime()) ? now : to,
  };
}

function serializeCurrency(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function isCronRequest(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;
  if (req.headers["x-vercel-cron"] === "1") return true;
  return false;
}

function queryParamsToRecord(req: Request): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(req.query).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );
}

function requestWebhookPayload(req: Request) {
  return {
    ...(asRecord(req.body) ?? {}),
    ...queryParamsToRecord(req),
  };
}

function isB2BClient(client: { dashboardType: string | null } | undefined) {
  return client?.dashboardType === "B2B";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function firstNumber(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function getNestedValue(source: unknown, path: string): unknown {
  const root = asRecord(source);
  if (!root) return null;
  return path.split(".").reduce<unknown>((current, part) => {
    const currentRecord = asRecord(current);
    return currentRecord ? currentRecord[part] : null;
  }, root);
}

function valueToTemplateParam(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => valueToTemplateParam(item))
      .filter(Boolean)
      .join(", ");
  }
  return "";
}

function formatMoneyBRL(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function extractTemplatePlaceholderCount(components: unknown): number {
  const rows = Array.isArray(components) ? components : [];
  const body = rows
    .map((component) => asRecord(component))
    .find((component) => firstText(component?.type)?.toUpperCase() === "BODY");
  const text = firstText(body?.text);
  if (!text) return 0;
  const placeholders = new Set<string>();
  for (const match of text.matchAll(/\{\{(\d+)\}\}/g)) {
    if (match[1]) placeholders.add(match[1]);
  }
  return placeholders.size;
}

function parseEventDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeWebhookPayload(payload: unknown) {
  const { envelope, data, root } = getWebhookPayloadLayers(payload);
  const customer = asRecord(root.customer) ?? asRecord(root.user) ?? asRecord(root.lead) ?? {};
  const order = asRecord(root.order) ?? {};
  const cart = asRecord(root.cart) ?? {};
  const checkout = asRecord(root.checkout) ?? {};
  const meta = asRecord(root.metadata) ?? asRecord(root.meta) ?? {};
  const seller = asRecord(root.seller) ?? {};

  const rawEventType = firstText(
    envelope.event_type,
    envelope.eventType,
    envelope.type,
    envelope.event,
    envelope.name,
    root.event_type,
    root.eventType,
    root.type,
    root.event,
    root.name,
  );
  const eventType = normalizeAutomationEventType(rawEventType) ?? "unknown";
  const eventId = firstText(
    envelope.event_id,
    envelope.eventId,
    meta.event_id,
    data.event_id,
    data.eventId,
  );
  const externalCustomerId = getWebhookCustomerIdentity(eventType, payload);
  const externalOrderId = getWebhookOrderIdentity(eventType, payload);
  const externalCartId = getCartAutomationIdentity(eventType, payload)
    ?? firstText(root.cart_id, root.cartId, cart.id, cart.external_id);
  const externalCheckoutId = firstText(root.checkout_id, root.checkoutId, checkout.id, checkout.external_id);
  const occurredAt = parseEventDate(envelope.timestamp)
    ?? parseEventDate(envelope.occurred_at)
    ?? parseEventDate(root.occurred_at)
    ?? parseEventDate(root.created_at)
    ?? parseEventDate(root.timestamp)
    ?? parseEventDate(root.period_start)
    ?? new Date();

  return {
    eventType,
    eventId,
    externalCustomerId,
    externalOrderId,
    externalCartId,
    externalCheckoutId,
    occurredAt,
    value: firstNumber(
      root.value,
      root.total_value,
      root.order_total,
      root.cart_total,
      root.amount,
      order.value,
      order.amount,
      order.total_value,
      order.total,
      cart.value,
      cart.amount,
      cart.total_value,
      cart.total,
    ),
    customerName: firstText(
      customer.name,
      customer.contact_name,
      customer.company_name,
      root.customer_name,
      root.contact_name,
      root.name,
    ),
    customerPhone: firstText(customer.phone, customer.whatsapp, root.phone, root.whatsapp),
    customerEmail: firstText(customer.email, root.email),
    documentType: firstText(customer.document_type, customer.type, root.document_type),
    documentLast4: firstText(customer.document_last4, root.document_last4),
    sellerName: firstText(
      root.seller_name,
      root.assigned_seller_name,
      seller.name,
      meta.seller_name,
      meta.assigned_seller_name,
    ),
    sellerPhone: firstText(
      root.seller_phone,
      root.assigned_seller_phone,
      seller.phone,
      meta.seller_phone,
      meta.assigned_seller_phone,
    ),
    sellerEmail: firstText(root.seller_email, seller.email, meta.seller_email),
    sellerSlug: firstText(root.seller_slug, seller.slug, seller.seller_slug, meta.seller_slug),
  };
}

type NormalizedWebhookPayload = ReturnType<typeof normalizeWebhookPayload>;

async function findCustomerForWebhook(clientId: string, normalized: NormalizedWebhookPayload) {
  const selectCustomer = async (identityCondition: ReturnType<typeof eq> | ReturnType<typeof sql>) => {
    const [customer] = await db
      .select({
        id: customersTable.id,
        externalId: customersTable.externalId,
        name: customersTable.name,
        email: customersTable.email,
        phone: customersTable.phone,
        documentType: customersTable.documentType,
        documentLast4: customersTable.documentLast4,
        registrationStatus: customersTable.registrationStatus,
        state: customersTable.state,
        city: customersTable.city,
      })
      .from(customersTable)
      .where(and(eq(customersTable.clientId, clientId), identityCondition))
      .limit(1);

    return customer ?? null;
  };

  if (normalized.externalCustomerId) {
    const customer = await selectCustomer(eq(customersTable.externalId, normalized.externalCustomerId));
    if (customer) return customer;
  }

  const customerPhone = normalizeWhatsappRecipient(normalized.customerPhone);
  if (customerPhone) {
    const customer = await selectCustomer(sql`(
      regexp_replace(coalesce(${customersTable.phone}, ''), '[^0-9]', '', 'g') = ${customerPhone}
      OR right(regexp_replace(coalesce(${customersTable.phone}, ''), '[^0-9]', '', 'g'), 11) = ${customerPhone.slice(-11)}
    )`);
    if (customer) return customer;
  }

  // E-mail pode ser reutilizado em testes ou recadastros. Só é seguro usá-lo
  // quando o webhook não trouxe um identificador ou telefone mais forte.
  if (!normalized.externalCustomerId && !customerPhone && normalized.customerEmail) {
    return selectCustomer(eq(customersTable.email, normalized.customerEmail));
  }

  return null;
}

async function findOrderForWebhook(
  clientId: string,
  normalized: NormalizedWebhookPayload,
  customer: Awaited<ReturnType<typeof findCustomerForWebhook>>,
) {
  const conditions = [];
  if (normalized.externalOrderId) {
    conditions.push(eq(ordersTable.externalId, normalized.externalOrderId));
  }
  if (customer?.id) {
    conditions.push(eq(ordersTable.customerId, customer.id));
  }
  if (conditions.length === 0) return null;

  const [order] = await db
    .select({
      id: ordersTable.id,
      externalId: ordersTable.externalId,
      amount: ordersTable.amount,
      fulfilledAmount: ordersTable.fulfilledAmount,
      requestedQuantity: ordersTable.requestedQuantity,
      fulfilledQuantity: ordersTable.fulfilledQuantity,
      status: ordersTable.status,
      createdAt: ordersTable.createdAt,
    })
    .from(ordersTable)
    .where(and(eq(ordersTable.clientId, clientId), or(...conditions)))
    .orderBy(desc(ordersTable.createdAt))
    .limit(1);
  if (!order) return null;

  const items = await db
    .select({
      quantity: orderItemsTable.quantity,
      fulfilledQuantity: orderItemsTable.fulfilledQuantity,
      size: orderItemsTable.size,
      color: orderItemsTable.color,
      productName: productsTable.name,
      productSku: productsTable.sku,
      imageUrl: productsTable.imageUrl,
    })
    .from(orderItemsTable)
    .innerJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
    .where(eq(orderItemsTable.orderId, order.id))
    .orderBy(productsTable.name)
    .limit(20);

  const itemText = items
    .map((item) => {
      const details = [item.color, item.size].filter(Boolean).join(" / ");
      return `${item.quantity}x ${item.productName}${details ? ` (${details})` : ""}`;
    })
    .join(", ");

  return {
    ...order,
    itemText,
    imageUrls: items.map((item) => item.imageUrl).filter((url): url is string => Boolean(url)),
  };
}

function crmStageForEvent(eventType: string): string {
  const value = eventType.toLowerCase();
  if (value.includes("lost") || value.includes("rejected") || value.includes("recus")) return "lost";
  if (value.includes("delivered") || value.includes("paid") || value.includes("payment_confirmed")) return "closed";
  if (value.includes("payment")) return "waiting_payment";
  if (value.includes("stock")) return "waiting_stock";
  if (value.includes("order") || value.includes("purchase") || value.includes("checkout")) return "consultative_sale";
  if (value.includes("approved")) return "registration_approved";
  if (value.includes("pending") || value.includes("submitted") || value.includes("cadastro")) return "registration_pending";
  if (value.includes("qualified") || value.includes("qualification")) return "qualification";
  if (value.includes("message") || value.includes("lead") || value.includes("contact")) return "new_contact";
  return "new_contact";
}

function priorityForEvent(eventType: string): string {
  const value = eventType.toLowerCase();
  if (value.includes("payment") || value.includes("handoff") || value.includes("checkout")) return "high";
  if (value.includes("cart") || value.includes("order") || value.includes("purchase")) return "medium";
  return "low";
}

function logStatusForEvent(eventType: string): "ok" | "review" | "blocked" | "info" {
  const value = eventType.toLowerCase();
  if (value.includes("error") || value.includes("failed")) return "blocked";
  if (value.includes("checkout") || value.includes("payment") || value.includes("order")) return "review";
  return "ok";
}

async function requireB2BClient(clientId: string | null) {
  if (!clientId) return null;
  const [client] = await db
    .select({
      id: clientsTable.id,
      name: clientsTable.name,
      dashboardType: clientsTable.dashboardType,
      upZeroApiKey: clientsTable.upZeroApiKey,
    })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));
  return isB2BClient(client) ? client : null;
}

async function getB2BClients() {
  return db
    .select({
      id: clientsTable.id,
      name: clientsTable.name,
      isActive: clientsTable.isActive,
      upZeroConfigured: sql<boolean>`${clientsTable.upZeroApiKey} IS NOT NULL AND ${clientsTable.upZeroApiKey} <> ''`,
      createdAt: clientsTable.createdAt,
    })
    .from(clientsTable)
    .where(eq(clientsTable.dashboardType, "B2B"))
    .orderBy(clientsTable.name);
}

async function getCommercialOperationStatus(clientId: string): Promise<"active" | "paused"> {
  const [operation] = await db
    .select({ status: aiCommercialOperationsTable.status })
    .from(aiCommercialOperationsTable)
    .where(eq(aiCommercialOperationsTable.clientId, clientId))
    .limit(1);
  return operation?.status === "active" ? "active" : "paused";
}

async function clientMetrics(clientId: string, from: Date, to: Date) {
  const [orders] = await db
    .select({
      orders: sql<number>`COUNT(*)::int`,
      revenue: sql<number>`COALESCE(SUM(${ordersTable.amount}), 0)::float`,
      requestedQuantity: sql<number>`COALESCE(SUM(${ordersTable.requestedQuantity}), 0)::int`,
    })
    .from(ordersTable)
    .where(and(eq(ordersTable.clientId, clientId), gte(ordersTable.createdAt, from), lte(ordersTable.createdAt, to)));

  const [customers] = await db
    .select({
      registrations: sql<number>`COUNT(*)::int`,
      approved: sql<number>`COUNT(*) FILTER (WHERE ${customersTable.registrationStatus} = 'APPROVED')::int`,
    })
    .from(customersTable)
    .where(and(eq(customersTable.clientId, clientId), gte(customersTable.createdAt, from), lte(customersTable.createdAt, to)));

  const [whatsapp] = await db
    .select({
      conversations: sql<number>`COUNT(*)::int`,
      open: sql<number>`COUNT(*) FILTER (WHERE ${whatsappConversationsTable.status} <> 'closed')::int`,
    })
    .from(whatsappConversationsTable)
    .where(and(eq(whatsappConversationsTable.clientId, clientId), gte(whatsappConversationsTable.createdAt, from), lte(whatsappConversationsTable.createdAt, to)));

  return {
    orders: orders?.orders ?? 0,
    revenue: serializeCurrency(orders?.revenue ?? 0),
    requestedQuantity: orders?.requestedQuantity ?? 0,
    registrations: customers?.registrations ?? 0,
    approvedRegistrations: customers?.approved ?? 0,
    conversations: whatsapp?.conversations ?? 0,
    openConversations: whatsapp?.open ?? 0,
  };
}

// Achado 14/08/2026 (relato do Lucas: "IA Comercial" travando em loading
// infinito): GET /orchestrator/overview fazia ~7 queries POR cliente B2B
// (ensureCommercialSetup sozinho já são 5 sub-chamadas) via Promise.all --
// mas o pool de conexão tem max:1 por instância serverless, então isso
// vira uma fila enorme numa única conexão. Com ~50 clientes B2B, a fila
// estourava o connectionTimeoutMillis do pool e a rota inteira falhava com
// 500 depois de ~45s (confirmado em produção). Piora ainda mais com a
// região errada do Cloud SQL (docs/cloud-sql-regiao-errada-14-08-2026.md).
// Versões em lote abaixo: N queries totais (uma por fonte de dado, com
// GROUP BY clientId) em vez de N queries por cliente. Mantém as versões
// originais (getCommercialOperationStatus, clientMetrics) para os outros
// endpoints que operam em UM cliente só, onde não há esse problema.
async function getCommercialOperationStatusBulk(clientIds: string[]): Promise<Map<string, "active" | "paused">> {
  const statusByClient = new Map<string, "active" | "paused">();
  if (clientIds.length === 0) return statusByClient;
  const rows = await db
    .select({ clientId: aiCommercialOperationsTable.clientId, status: aiCommercialOperationsTable.status })
    .from(aiCommercialOperationsTable)
    .where(inArray(aiCommercialOperationsTable.clientId, clientIds));
  for (const row of rows) {
    statusByClient.set(row.clientId, row.status === "active" ? "active" : "paused");
  }
  return statusByClient;
}

async function webhookSecretsBulk(clientIds: string[]): Promise<Map<string, string | null>> {
  const secretByClient = new Map<string, string | null>();
  if (clientIds.length === 0) return secretByClient;
  const rows = await db
    .select({ clientId: ecommerceWebhookConfigsTable.clientId, secretHash: ecommerceWebhookConfigsTable.secretHash })
    .from(ecommerceWebhookConfigsTable)
    .where(inArray(ecommerceWebhookConfigsTable.clientId, clientIds));
  for (const row of rows) {
    secretByClient.set(row.clientId, row.secretHash);
  }
  return secretByClient;
}

async function clientMetricsBulk(
  clientIds: string[],
  from: Date,
  to: Date,
): Promise<Map<string, ReturnType<typeof clientMetricsDefault>>> {
  const metricsByClient = new Map<string, ReturnType<typeof clientMetricsDefault>>();
  for (const clientId of clientIds) metricsByClient.set(clientId, clientMetricsDefault());
  if (clientIds.length === 0) return metricsByClient;

  const [orderRows, customerRows, whatsappRows] = await Promise.all([
    db
      .select({
        clientId: ordersTable.clientId,
        orders: sql<number>`COUNT(*)::int`,
        revenue: sql<number>`COALESCE(SUM(${ordersTable.amount}), 0)::float`,
        requestedQuantity: sql<number>`COALESCE(SUM(${ordersTable.requestedQuantity}), 0)::int`,
      })
      .from(ordersTable)
      .where(and(inArray(ordersTable.clientId, clientIds), gte(ordersTable.createdAt, from), lte(ordersTable.createdAt, to)))
      .groupBy(ordersTable.clientId),
    db
      .select({
        clientId: customersTable.clientId,
        registrations: sql<number>`COUNT(*)::int`,
        approved: sql<number>`COUNT(*) FILTER (WHERE ${customersTable.registrationStatus} = 'APPROVED')::int`,
      })
      .from(customersTable)
      .where(and(inArray(customersTable.clientId, clientIds), gte(customersTable.createdAt, from), lte(customersTable.createdAt, to)))
      .groupBy(customersTable.clientId),
    db
      .select({
        clientId: whatsappConversationsTable.clientId,
        conversations: sql<number>`COUNT(*)::int`,
        open: sql<number>`COUNT(*) FILTER (WHERE ${whatsappConversationsTable.status} <> 'closed')::int`,
      })
      .from(whatsappConversationsTable)
      .where(and(inArray(whatsappConversationsTable.clientId, clientIds), gte(whatsappConversationsTable.createdAt, from), lte(whatsappConversationsTable.createdAt, to)))
      .groupBy(whatsappConversationsTable.clientId),
  ]);

  for (const row of orderRows) {
    const entry = metricsByClient.get(row.clientId) ?? clientMetricsDefault();
    entry.orders = row.orders ?? 0;
    entry.revenue = serializeCurrency(row.revenue ?? 0);
    entry.requestedQuantity = row.requestedQuantity ?? 0;
    metricsByClient.set(row.clientId, entry);
  }
  for (const row of customerRows) {
    const entry = metricsByClient.get(row.clientId) ?? clientMetricsDefault();
    entry.registrations = row.registrations ?? 0;
    entry.approvedRegistrations = row.approved ?? 0;
    metricsByClient.set(row.clientId, entry);
  }
  for (const row of whatsappRows) {
    const entry = metricsByClient.get(row.clientId) ?? clientMetricsDefault();
    entry.conversations = row.conversations ?? 0;
    entry.openConversations = row.open ?? 0;
    metricsByClient.set(row.clientId, entry);
  }
  return metricsByClient;
}

function clientMetricsDefault() {
  return {
    orders: 0,
    revenue: serializeCurrency(0),
    requestedQuantity: 0,
    registrations: 0,
    approvedRegistrations: 0,
    conversations: 0,
    openConversations: 0,
  };
}

async function buildCrmCards(clientId: string, from: Date, to: Date) {
  const aiRows = await db
    .select({
      id: aiCrmCardsTable.id,
      stage: aiCrmCardsTable.stage,
      intent: aiCrmCardsTable.intent,
      priority: aiCrmCardsTable.priority,
      estimatedValue: aiCrmCardsTable.estimatedValue,
      handoffRequired: aiCrmCardsTable.handoffRequired,
      handoffReason: aiCrmCardsTable.handoffReason,
      lastInteractionAt: aiCrmCardsTable.lastInteractionAt,
      updatedAt: aiCrmCardsTable.updatedAt,
      customerName: customersTable.name,
      customerPhone: customersTable.phone,
      documentType: customersTable.documentType,
      documentLast4: customersTable.documentLast4,
      externalId: customersTable.externalId,
    })
    .from(aiCrmCardsTable)
    .leftJoin(customersTable, eq(aiCrmCardsTable.customerId, customersTable.id))
    .where(
      and(
        eq(aiCrmCardsTable.clientId, clientId),
        or(
          and(gte(aiCrmCardsTable.lastInteractionAt, from), lte(aiCrmCardsTable.lastInteractionAt, to)),
          and(gte(aiCrmCardsTable.updatedAt, from), lte(aiCrmCardsTable.updatedAt, to)),
        ),
      ),
    )
    .orderBy(desc(aiCrmCardsTable.lastInteractionAt), desc(aiCrmCardsTable.updatedAt))
    .limit(120);

  if (aiRows.length > 0) {
    return aiRows.map((row) => ({
      id: row.id,
      stage: row.handoffRequired ? "handoff" : row.stage,
      title: row.customerName || row.customerPhone || row.externalId || "Lead sem identificação",
      phone: row.customerPhone,
      status: row.priority,
      funnelStage: row.intent,
      priority: row.priority,
      updatedAt: row.lastInteractionAt ?? row.updatedAt,
      phoneNumberId: null,
      blockedAutomation: row.handoffRequired
        ? row.handoffReason || "Revisão humana necessária antes de responder."
        : "Evento recebido. Automação real ainda em modo assistido.",
      document: row.documentType && row.documentLast4 ? `${row.documentType} ****${row.documentLast4}` : null,
      estimatedValue: row.estimatedValue,
    }));
  }

  const rows = await db
    .select({
      id: whatsappConversationsTable.id,
      status: whatsappConversationsTable.status,
      funnelStage: whatsappConversationsTable.funnelStage,
      phoneNumberId: whatsappConversationsTable.phoneNumberId,
      updatedAt: whatsappConversationsTable.updatedAt,
      contactName: whatsappContactsTable.name,
      contactPhone: whatsappContactsTable.phone,
    })
    .from(whatsappConversationsTable)
    .leftJoin(whatsappContactsTable, eq(whatsappConversationsTable.contactId, whatsappContactsTable.id))
    .where(and(eq(whatsappConversationsTable.clientId, clientId), gte(whatsappConversationsTable.updatedAt, from), lte(whatsappConversationsTable.updatedAt, to)))
    .orderBy(desc(whatsappConversationsTable.updatedAt))
    .limit(80);

  return rows.map((row) => {
    const stage =
      row.status === "awaiting_response"
        ? "handoff"
        : row.funnelStage === "qualified"
          ? "registration_approved"
          : row.funnelStage === "negotiation"
            ? "consultative_sale"
            : "new_contact";
    return {
      id: row.id,
      stage,
      title: row.contactName || row.contactPhone || "Contato sem nome",
      phone: row.contactPhone,
      status: row.status,
      funnelStage: row.funnelStage,
      priority: row.status === "awaiting_response" ? "high" : "medium",
      updatedAt: row.updatedAt,
      phoneNumberId: row.phoneNumberId,
      blockedAutomation: "Automação real desativada até revisão das regras da operação.",
    };
  });
}

async function buildOperationPayload(clientId: string, from: Date, to: Date) {
  await ensureCommercialSetup(clientId);
  const aiCommercialStatus = await getCommercialOperationStatus(clientId);
  const metrics = await clientMetrics(clientId, from, to);
  const rules = await buildAutomationRules(clientId);
  const agents = await buildAgentConfigs(clientId);
  const [phoneCount] = await db
    .select({ total: sql<number>`COUNT(*)::int` })
    .from(whatsappPhoneNumbersTable)
    .where(and(eq(whatsappPhoneNumbersTable.clientId, clientId), sql`${whatsappPhoneNumbersTable.status} <> 'archived'`));
  const [messageCount] = await db
    .select({
      inbound: sql<number>`COUNT(*) FILTER (WHERE ${whatsappMessagesTable.direction} = 'inbound')::int`,
      outbound: sql<number>`COUNT(*) FILTER (WHERE ${whatsappMessagesTable.direction} = 'outbound')::int`,
    })
    .from(whatsappMessagesTable)
    .where(and(eq(whatsappMessagesTable.clientId, clientId), gte(whatsappMessagesTable.sentAt, from), lte(whatsappMessagesTable.sentAt, to)));

  return {
    metrics: {
      ...metrics,
      connectedNumbers: phoneCount?.total ?? 0,
      inboundMessages: messageCount?.inbound ?? 0,
      outboundMessages: messageCount?.outbound ?? 0,
      aiStatus: aiCommercialStatus,
      automationStatus: "review_required",
    },
    aiCommercialStatus,
    agents,
    rules: rules.map((rule) => ({
      ...rule,
      mode: "draft",
      guardrail: "Requer aprovação humana antes de enviar mensagens automáticas.",
    })),
  };
}

async function ensureCommercialOperation(clientId: string) {
  const [existing] = await db
    .select({ id: aiCommercialOperationsTable.id })
    .from(aiCommercialOperationsTable)
    .where(eq(aiCommercialOperationsTable.clientId, clientId))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(aiCommercialOperationsTable)
    .values({
      clientId,
      status: "paused",
      autonomyMode: "assisted",
      orderFlowMode: "pre_order_stock_confirmation",
      priceRequiresApprovedRegistration: true,
      allowCatalogWithoutPrice: true,
      allowProductWithoutPrice: true,
      requireHumanApprovalBeforeRegistrationPost: true,
      stockConfirmationRequired: true,
      shippingAfterStockConfirmation: true,
      paymentAfterStockConfirmation: true,
      currency: "BRL",
      usdBrlRate: 5,
    })
    .returning({ id: aiCommercialOperationsTable.id });
  return created.id;
}

async function ensureWebhookConfig(clientId: string) {
  const [existing] = await db
    .select({ id: ecommerceWebhookConfigsTable.id, secretHash: ecommerceWebhookConfigsTable.secretHash })
    .from(ecommerceWebhookConfigsTable)
    .where(eq(ecommerceWebhookConfigsTable.clientId, clientId))
    .limit(1);

  if (existing) {
    const token = existing.secretHash || `upw_${nanoid(32)}`;
    await db
      .update(ecommerceWebhookConfigsTable)
      .set({
        isEnabled: true,
        sourceName: "upzero",
        secretHash: token,
        allowedEventTypes: AUTOMATION_RULES.map((rule) => rule.eventType),
        updatedAt: new Date(),
      })
      .where(eq(ecommerceWebhookConfigsTable.id, existing.id));
    return token;
  }

  const token = `upw_${nanoid(32)}`;
  await db.insert(ecommerceWebhookConfigsTable).values({
    clientId,
    isEnabled: true,
    sourceName: "upzero",
    secretHash: token,
    allowedEventTypes: AUTOMATION_RULES.map((rule) => rule.eventType),
  });
  return token;
}

async function webhookUrlForClient(clientId: string) {
  const token = await ensureWebhookConfig(clientId);
  return publicWebhookTemplateUrl(clientId, token);
}

async function ensureUpzeroIntegration(clientId: string, apiKey?: string | null) {
  const cleanApiKey = apiKey?.trim() || null;
  const updateSet = cleanApiKey
    ? {
        encryptedApiKey: cleanApiKey,
        status: "configured",
        updatedAt: new Date(),
      }
    : {
        updatedAt: new Date(),
      };

  await db
    .insert(upzeroIntegrationsTable)
    .values({
      clientId,
      baseUrl: "https://api.upzero.com.br",
      authType: "api_key",
      encryptedApiKey: cleanApiKey,
      environment: "production",
      status: cleanApiKey ? "configured" : "not_configured",
      rawConfig: { managedBy: "orchestrator" },
    })
    .onConflictDoUpdate({
      target: upzeroIntegrationsTable.clientId,
      set: updateSet,
    });
}

async function ensureAutomationRules(clientId: string, operationId?: string) {
  const resolvedOperationId = operationId ?? await ensureCommercialOperation(clientId);
  for (const rule of AUTOMATION_RULES) {
    const [existing] = await db
      .select({ id: commercialAutomationRulesTable.id })
      .from(commercialAutomationRulesTable)
      .where(
        and(
          eq(commercialAutomationRulesTable.clientId, clientId),
          inArray(commercialAutomationRulesTable.eventType, automationEventTypeCandidates(rule.eventType)),
        ),
      )
      .limit(1);
    if (existing) continue;

    await db
      .insert(commercialAutomationRulesTable)
      .values({
        clientId,
        operationId: resolvedOperationId,
        eventType: rule.eventType,
        name: rule.name,
        description:
          ("description" in rule ? rule.description : undefined) ??
          "Regra criada automaticamente para a Etapa 1 do IA Comercial. O envio real permanece desativado até revisão.",
        isEnabled: false,
        delayMinutes: ("defaultDelayMinutes" in rule ? rule.defaultDelayMinutes : undefined) ?? 0,
      })
      .onConflictDoNothing();
  }
}

async function nextAutomationRuleSequence(clientId: string, eventType: string) {
  const canonicalEventType = normalizeAutomationEventType(eventType) ?? eventType;
  const [row] = await db
    .select({
      ruleCount: sql<number>`COUNT(*)::int`,
    })
    .from(commercialAutomationRulesTable)
    .where(
      and(
        eq(commercialAutomationRulesTable.clientId, clientId),
        inArray(commercialAutomationRulesTable.eventType, automationEventTypeCandidates(canonicalEventType)),
      ),
    );
  return Number(row?.ruleCount ?? 0) + 1;
}

async function ensureAgentConfigs(clientId: string, operationId: string) {
  for (const agent of DEFAULT_AGENT_CONFIGS) {
    const [existing] = await db
      .select({ id: aiAgentConfigsTable.id })
      .from(aiAgentConfigsTable)
      .where(and(eq(aiAgentConfigsTable.clientId, clientId), eq(aiAgentConfigsTable.agentType, agent.agentType)))
      .limit(1);
    if (existing) continue;
    await db.insert(aiAgentConfigsTable).values({
      clientId,
      operationId,
      agentType: agent.agentType,
      name: agent.name,
      status: "active",
      model: process.env.AI_INTEGRATIONS_OPENAI_MODEL ?? "gpt-4.1-mini",
      temperature: 0.2,
      systemPrompt: agent.systemPrompt,
      autonomyMode: "assisted",
      canAutoReply: agent.canAutoReply,
      canCreateRegistration: agent.canCreateRegistration,
      canCreatePreOrder: agent.canCreatePreOrder,
      canHandoff: true,
    });
  }
}

async function ensureCommercialSetup(clientId: string, apiKey?: string | null) {
  const operationId = await ensureCommercialOperation(clientId);
  await ensureWebhookConfig(clientId);
  await ensureUpzeroIntegration(clientId, apiKey);
  await ensureAutomationRules(clientId, operationId);
  await ensureAgentConfigs(clientId, operationId);
  return operationId;
}

async function buildAutomationRules(clientId: string) {
  await ensureCommercialSetup(clientId);
  const rows = await db
    .select({
      id: commercialAutomationRulesTable.id,
      eventType: commercialAutomationRulesTable.eventType,
      name: commercialAutomationRulesTable.name,
      description: commercialAutomationRulesTable.description,
      enabled: commercialAutomationRulesTable.isEnabled,
      templateId: commercialAutomationRulesTable.templateId,
      templateName: commercialAutomationRulesTable.templateName,
      templateLanguage: commercialAutomationRulesTable.templateLanguage,
      delayMinutes: commercialAutomationRulesTable.delayMinutes,
      cooldownHours: commercialAutomationRulesTable.cooldownHours,
      maxSendsPerCustomerMonth: commercialAutomationRulesTable.maxSendsPerCustomerMonth,
      conditions: commercialAutomationRulesTable.conditions,
      createdAt: commercialAutomationRulesTable.createdAt,
      updatedAt: commercialAutomationRulesTable.updatedAt,
    })
    .from(commercialAutomationRulesTable)
    .where(eq(commercialAutomationRulesTable.clientId, clientId))
    .orderBy(
      commercialAutomationRulesTable.eventType,
      commercialAutomationRulesTable.delayMinutes,
      commercialAutomationRulesTable.createdAt,
    );
  return normalizeAutomationRuleSteps(rows, normalizeAutomationEventType).map((rule) => ({
    ...rule,
    audience: getAutomationAudience(rule.conditions),
    sendOncePerCart: !rule.conditions
      || typeof rule.conditions !== "object"
      || (rule.conditions as Record<string, unknown>).sendOncePerCart !== false,
  }));
}

async function buildAutomationEventOptions(clientId: string) {
  const rows = await db
    .select({ eventType: ecommerceWebhookEventsTable.eventType })
    .from(ecommerceWebhookEventsTable)
    .where(eq(ecommerceWebhookEventsTable.clientId, clientId))
    .groupBy(ecommerceWebhookEventsTable.eventType)
    .orderBy(ecommerceWebhookEventsTable.eventType);

  const options = new Map<string, AutomationEventOption>();
  for (const rule of AUTOMATION_RULES) {
    const value = normalizeAutomationEventType(rule.eventType);
    if (!value) continue;
    options.set(value.toLowerCase(), {
      value,
      label: rule.name,
      source: "upzero",
    });
  }

  for (const row of rows) {
    const value = normalizeAutomationEventType(row.eventType);
    if (!value) continue;
    const key = value.toLowerCase();
    if (options.has(key)) continue;
    options.set(key, {
      value,
      label: automationEventLabel(value),
      source: "received",
    });
  }

  return Array.from(options.values()).sort((a, b) => {
    const defaultA = AUTOMATION_RULES.findIndex((rule) => rule.eventType === a.value);
    const defaultB = AUTOMATION_RULES.findIndex((rule) => rule.eventType === b.value);
    if (defaultA !== -1 || defaultB !== -1) {
      return (defaultA === -1 ? Number.MAX_SAFE_INTEGER : defaultA) - (defaultB === -1 ? Number.MAX_SAFE_INTEGER : defaultB);
    }
    return a.label.localeCompare(b.label, "pt-BR");
  });
}

async function buildWhatsappTemplateOptions(clientId: string) {
  const rows = await db
    .select({
      id: whatsappMessageTemplatesTable.id,
      templateId: whatsappMessageTemplatesTable.templateId,
      name: whatsappMessageTemplatesTable.name,
      language: whatsappMessageTemplatesTable.language,
      status: whatsappMessageTemplatesTable.status,
      category: whatsappMessageTemplatesTable.category,
      wabaId: whatsappMessageTemplatesTable.wabaId,
    })
    .from(whatsappMessageTemplatesTable)
    .where(eq(whatsappMessageTemplatesTable.clientId, clientId))
    .orderBy(whatsappMessageTemplatesTable.name, whatsappMessageTemplatesTable.language);
  return rows;
}

async function buildAutomationTemplateBodyParams(params: {
  clientId: string;
  templateId: string | null;
  templateName: string | null;
  templateLanguage: string | null;
  wabaIds?: string[];
  payload: Record<string, unknown>;
}) {
  if (!params.templateId && !params.templateName) return [];

  const templateConditions = [
    eq(whatsappMessageTemplatesTable.clientId, params.clientId),
    eq(whatsappMessageTemplatesTable.status, "APPROVED"),
  ];
  // A template name/language is shared by every sender in the same WABA.
  // Rule template IDs are local records and may point to an older sync.
  if (params.templateName) {
    templateConditions.push(eq(whatsappMessageTemplatesTable.name, params.templateName));
  } else if (params.templateId) {
    templateConditions.push(eq(whatsappMessageTemplatesTable.templateId, params.templateId));
  }
  if (params.templateLanguage) {
    templateConditions.push(eq(whatsappMessageTemplatesTable.language, params.templateLanguage));
  }
  const templates = await db
    .select({
      wabaId: whatsappMessageTemplatesTable.wabaId,
      components: whatsappMessageTemplatesTable.components,
      rawPayload: whatsappMessageTemplatesTable.rawPayload,
    })
    .from(whatsappMessageTemplatesTable)
    .where(and(...templateConditions));
  const template = selectAutomationTemplateByWaba(
    templates,
    params.wabaIds ?? [],
  );

  const normalized = normalizeWebhookPayload(params.payload);
  const payloadOrder = asRecord(params.payload.order) ?? {};
  const payloadCart = asRecord(params.payload.cart) ?? {};
  const customerName = firstText(params.payload.contact_name, params.payload.customer_name, payloadOrder.customer_name, normalized.customerName);
  const customerPhone = firstText(params.payload.phone, params.payload.whatsapp, normalized.customerPhone);
  const orderNumber = firstText(
    params.payload.order_number,
    params.payload.order_id,
    params.payload.orderId,
    payloadOrder.number,
    payloadOrder.external_id,
    payloadOrder.id,
    normalized.externalOrderId,
  );
  const orderTotal = firstText(
    params.payload.order_total,
    params.payload.total_value,
    params.payload.amount,
    payloadOrder.total,
    payloadOrder.total_value,
    normalized.value || null,
  );
  const itemsText = firstText(params.payload.items, payloadOrder.items);
  const cartTotal = firstText(params.payload.cart_total, payloadCart.total, payloadCart.total_value, normalized.value || null);
  const cartUrl = firstText(params.payload.cart_url, params.payload.recovery_url, params.payload.checkout_url, payloadCart.url, payloadCart.recovery_url, payloadCart.checkout_url);
  const lookupPayload = {
    ...params.payload,
    contact_name: customerName,
    first_name: customerName?.split(/\s+/)[0] ?? null,
    phone: customerPhone,
    order_number: orderNumber,
    order_total: orderTotal,
    cart_id: normalized.externalCartId,
    checkout_id: normalized.externalCheckoutId,
    cart_total: cartTotal,
    cart_url: cartUrl,
    recovery_url: cartUrl,
    items: itemsText,
    normalized,
    customer: {
      ...(asRecord(params.payload.customer) ?? {}),
      name: customerName,
      phone: customerPhone,
      id: normalized.externalCustomerId,
    },
    order: {
      ...payloadOrder,
      id: orderNumber,
      number: orderNumber,
      total: orderTotal,
      items: itemsText,
    },
    cart: {
      ...payloadCart,
      id: normalized.externalCartId,
      external_id: normalized.externalCartId,
      checkout_id: normalized.externalCheckoutId,
      total: cartTotal,
      total_value: cartTotal,
      url: cartUrl,
      recovery_url: cartUrl,
      items: firstText(payloadCart.items, itemsText),
    },
  };
  const eventValue = normalized.eventType.toLowerCase();
  const isOrderLikeEvent =
    eventValue.includes("order") ||
    eventValue.includes("pedido") ||
    eventValue.includes("payment") ||
    eventValue.includes("pagamento") ||
    eventValue.includes("checkout") ||
    eventValue.includes("shipp") ||
    eventValue.includes("enviado") ||
    eventValue.includes("delivered") ||
    eventValue.includes("entregue");
  const fallbackValues = (isOrderLikeEvent
    ? [customerName, orderNumber, orderTotal, itemsText, customerPhone, normalized.eventType]
    : [customerName, customerPhone, orderNumber, orderTotal, normalized.eventType]
  ).filter((value): value is string => Boolean(value));

  const rawPayload = asRecord(template?.rawPayload);
  const mapping = rawPayload?.upDashVariableMapping;
  if (!Array.isArray(mapping) || mapping.length === 0) {
    const placeholderCount = extractTemplatePlaceholderCount(template?.components);
    return Array.from({ length: placeholderCount }, (_, index) => fallbackValues[index] ?? "-");
  }

  const mappedValues = new Map<string, string>();
  for (const item of mapping) {
      const row = asRecord(item);
      const placeholder = firstText(row?.placeholder);
      const variableKey = firstText(row?.variableKey);
      if (!placeholder) continue;
      const value = variableKey ? valueToTemplateParam(getNestedValue(lookupPayload, variableKey)) : "";
      mappedValues.set(placeholder, value || "-");
  }

  const placeholderCount = extractTemplatePlaceholderCount(template?.components);
  return Array.from({ length: placeholderCount }, (_, index) => mappedValues.get(String(index + 1)) ?? "-");
}

async function resolveAutomationSender(
  clientId: string,
  payload?: Record<string, unknown>,
  senderStrategy: "assigned_seller" | "default_phone" = "assigned_seller",
) {
  const sellerPhone = firstText(
    payload?.seller_phone,
    payload?.assigned_seller_phone,
    getNestedValue(payload, "seller.phone"),
    getNestedValue(payload, "seller_phone"),
  );
  const sellerName = firstText(
    payload?.seller_name,
    payload?.assigned_seller_name,
    getNestedValue(payload, "seller.name"),
    getNestedValue(payload, "seller_name"),
  );

  const phones = await db
    .select({
      phoneNumberId: whatsappPhoneNumbersTable.phoneNumberId,
      displayPhoneNumber: whatsappPhoneNumbersTable.displayPhoneNumber,
      verifiedName: whatsappPhoneNumbersTable.verifiedName,
      integrationId: whatsappPhoneNumbersTable.integrationId,
      wabaId: whatsappPhoneNumbersTable.wabaId,
      isDefault: whatsappPhoneNumbersTable.isDefault,
    })
    .from(whatsappPhoneNumbersTable)
    .where(and(eq(whatsappPhoneNumbersTable.clientId, clientId), eq(whatsappPhoneNumbersTable.status, "active")))
    .orderBy(desc(whatsappPhoneNumbersTable.updatedAt));
  const selection = selectAutomationSenderPhone(
    phones,
    senderStrategy === "assigned_seller" ? sellerPhone : null,
  );
  const phone = selection.phone;
  let integrationWabaId: string | null = phone?.wabaId ?? null;

  if (phone?.integrationId) {
    const [integration] = await db
      .select({ wabaId: whatsappIntegrationsTable.wabaId })
      .from(whatsappIntegrationsTable)
      .where(
        and(
          eq(whatsappIntegrationsTable.id, phone.integrationId),
          eq(whatsappIntegrationsTable.clientId, clientId),
        ),
      )
      .limit(1);
    integrationWabaId = integration?.wabaId ?? null;
  }

  if (!integrationWabaId && phone?.phoneNumberId) {
    const [integration] = await db
      .select({ wabaId: whatsappIntegrationsTable.wabaId })
      .from(whatsappIntegrationsTable)
      .where(
        and(
          eq(whatsappIntegrationsTable.clientId, clientId),
          eq(whatsappIntegrationsTable.phoneNumberId, phone.phoneNumberId),
        ),
      )
      .limit(1);
    integrationWabaId = integration?.wabaId ?? null;
  }

  // The selected phone is the WABA boundary. Never borrow an integration from
  // another WABA belonging to the same client.
  const wabaIds = buildAutomationWabaCandidates(phone?.wabaId, integrationWabaId);

  return {
    phoneNumberId: phone?.phoneNumberId ?? null,
    source: selection.source,
    strategy: senderStrategy,
    sellerPhone,
    sellerName,
    displayPhoneNumber: phone?.displayPhoneNumber ?? null,
    verifiedName: phone?.verifiedName ?? null,
    integrationId: phone?.integrationId ?? null,
    wabaId: wabaIds[0] ?? null,
    wabaIds,
    blockedReason: selection.blockedReason,
  };
}

async function findApprovedAutomationTemplate(params: {
  clientId: string;
  templateName: string;
  languageCode: string;
  wabaIds: string[];
}) {
  const conditions = [
    eq(whatsappMessageTemplatesTable.clientId, params.clientId),
    eq(whatsappMessageTemplatesTable.name, params.templateName),
    eq(whatsappMessageTemplatesTable.language, params.languageCode),
    eq(whatsappMessageTemplatesTable.status, "APPROVED"),
  ];
  if (params.wabaIds.length) {
    conditions.push(inArray(whatsappMessageTemplatesTable.wabaId, params.wabaIds));
  }

  const [template] = await db
    .select({ id: whatsappMessageTemplatesTable.id })
    .from(whatsappMessageTemplatesTable)
    .where(and(...conditions))
    .limit(1);

  return template ?? null;
}

async function refreshAutomationTemplateCatalog(params: {
  clientId: string;
  integrationId: string;
  accessToken: string;
  wabaIds: string[];
}) {
  const existingTemplates = await db
    .select({
      wabaId: whatsappMessageTemplatesTable.wabaId,
      name: whatsappMessageTemplatesTable.name,
      language: whatsappMessageTemplatesTable.language,
      rawPayload: whatsappMessageTemplatesTable.rawPayload,
    })
    .from(whatsappMessageTemplatesTable)
    .where(eq(whatsappMessageTemplatesTable.clientId, params.clientId));
  const exactPayloads = new Map<string, Record<string, unknown>>();
  const sharedPayloads = new Map<string, Record<string, unknown>>();

  for (const template of existingTemplates) {
    const rawPayload = asRecord(template.rawPayload) ?? {};
    const templateKey = `${template.name}\u0000${template.language}`;
    const exactKey = `${template.wabaId}\u0000${templateKey}`;
    exactPayloads.set(exactKey, rawPayload);
    const currentShared = sharedPayloads.get(templateKey);
    if (!currentShared || rawPayload.upDashVariableMapping) {
      sharedPayloads.set(templateKey, rawPayload);
    }
  }

  const syncedWabaIds: string[] = [];
  const errors: Array<{ wabaId: string; message: string }> = [];
  let syncedTemplates = 0;

  for (const wabaId of params.wabaIds) {
    const result = await fetchWhatsappTemplateCatalog({
      wabaId,
      accessToken: params.accessToken,
      graphApiVersion: process.env.META_GRAPH_API_VERSION ?? "v23.0",
    });

    if (result.error) {
      errors.push({ wabaId, message: result.error });
      continue;
    }

    syncedWabaIds.push(wabaId);
    const now = new Date();
    for (const template of result.templates) {
      const templateKey = `${template.name}\u0000${template.language}`;
      const existingRawPayload = exactPayloads.get(`${wabaId}\u0000${templateKey}`)
        ?? sharedPayloads.get(templateKey)
        ?? {};
      const rawPayload = {
        ...template.rawPayload,
        ...(existingRawPayload.upDashVariableMapping
          ? { upDashVariableMapping: existingRawPayload.upDashVariableMapping }
          : {}),
        ...(existingRawPayload.upDashButtons
          ? { upDashButtons: existingRawPayload.upDashButtons }
          : {}),
        ...(existingRawPayload.upDashTemplateScope
          ? { upDashTemplateScope: existingRawPayload.upDashTemplateScope }
          : {}),
      };

      await db
        .insert(whatsappMessageTemplatesTable)
        .values({
          clientId: params.clientId,
          integrationId: params.integrationId,
          wabaId,
          templateId: template.id,
          name: template.name,
          language: template.language,
          status: template.status,
          category: template.category,
          components: template.components,
          rawPayload,
          lastSyncedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            whatsappMessageTemplatesTable.clientId,
            whatsappMessageTemplatesTable.wabaId,
            whatsappMessageTemplatesTable.name,
            whatsappMessageTemplatesTable.language,
          ],
          set: {
            integrationId: params.integrationId,
            templateId: template.id,
            status: template.status,
            category: template.category,
            components: template.components,
            rawPayload,
            lastSyncedAt: now,
            updatedAt: now,
          },
        });
      syncedTemplates += 1;
    }
  }

  return {
    syncedTemplates,
    syncedWabaIds,
    errors,
  };
}

async function findAutomationPhoneNumberId(clientId: string) {
  const sender = await resolveAutomationSender(clientId);
  return sender.phoneNumberId;
}

async function scheduleAutomationJobsForEvent(params: {
  clientId: string;
  eventRecordId: string | null;
  eventType: string;
  customerId: string | null;
  customerPhone: string | null;
  payload: Record<string, unknown>;
}) {
  if (!params.eventRecordId) return [];
  const operationStatus = await getCommercialOperationStatus(params.clientId);
  if (operationStatus !== "active") {
    return [{
      ruleId: "commercial_ai",
      jobId: null,
      status: "blocked",
      reason: "commercial_ai_paused",
    }];
  }

  const rawRules = await db
    .select({
      id: commercialAutomationRulesTable.id,
      eventType: commercialAutomationRulesTable.eventType,
      name: commercialAutomationRulesTable.name,
      templateId: commercialAutomationRulesTable.templateId,
      templateName: commercialAutomationRulesTable.templateName,
      templateLanguage: commercialAutomationRulesTable.templateLanguage,
      templateCategory: commercialAutomationRulesTable.templateCategory,
      delayMinutes: commercialAutomationRulesTable.delayMinutes,
      cooldownHours: commercialAutomationRulesTable.cooldownHours,
      maxSendsPerCustomerMonth: commercialAutomationRulesTable.maxSendsPerCustomerMonth,
      conditions: commercialAutomationRulesTable.conditions,
      isEnabled: commercialAutomationRulesTable.isEnabled,
    })
    .from(commercialAutomationRulesTable)
    .where(
      and(
        eq(commercialAutomationRulesTable.clientId, params.clientId),
        inArray(commercialAutomationRulesTable.eventType, automationEventTypeCandidates(params.eventType)),
        eq(commercialAutomationRulesTable.isEnabled, true),
      ),
    )
    .orderBy(commercialAutomationRulesTable.delayMinutes, commercialAutomationRulesTable.createdAt);
  const rules = normalizeAutomationRuleSteps(rawRules, normalizeAutomationEventType);

  const scheduled: Array<{ ruleId: string; jobId: string | null; status: string; reason?: string }> = [];
  const customerRecipient = normalizeWhatsappRecipient(params.customerPhone);
  const sellerPhone = firstText(
    params.payload.seller_phone,
    params.payload.assigned_seller_phone,
    getNestedValue(params.payload, "seller.phone"),
    getNestedValue(params.payload, "assigned_seller.phone"),
  );
  const hasCustomerAutomation = rules.some(
    (rule) => getAutomationAudience(rule.conditions) === "customer",
  );
  const hasInternalSellerNotification = rules.some(
    (rule) => getAutomationAudience(rule.conditions) === "internal_seller",
  );
  const assignedSellerSender = hasCustomerAutomation
    ? await resolveAutomationSender(params.clientId, params.payload, "assigned_seller")
    : null;
  const defaultSender = hasInternalSellerNotification
    ? await resolveAutomationSender(params.clientId, params.payload, "default_phone")
    : null;
  const cartAutomationIdentity = getCartAutomationIdentity(params.eventType, params.payload);
  const isCartAutomationEvent = ["cart_created", "cart_abandoned"].includes(
    (normalizeAutomationEventType(params.eventType) ?? params.eventType).toLowerCase(),
  );
  const eventOrderIdentity = firstText(
    params.payload.order_number,
    getNestedValue(params.payload, "order.number"),
    getNestedValue(params.payload, "order.id"),
    getNestedValue(params.payload, "order.external_id"),
  );

  for (const rule of rules) {
    const routing = resolveAutomationDeliveryRouting({
      conditions: rule.conditions,
      customerPhone: customerRecipient,
      sellerPhone,
    });
    const to = normalizeWhatsappRecipient(routing.recipientPhone);
    const sender = routing.senderStrategy === "default_phone"
      ? defaultSender
      : assignedSellerSender;
    const phoneNumberId = sender?.phoneNumberId ?? null;
    const notificationSubjectId = routing.audience === "internal_seller"
      ? firstText(
          params.customerId,
          getWebhookCustomerIdentity(params.eventType, params.payload),
          getNestedValue(params.payload, "customer.document"),
          params.payload.document,
          getNestedValue(params.payload, "customer.email"),
          params.payload.email,
          params.customerPhone,
        )
      : null;
    const sendOncePerCart = !rule.conditions
      || typeof rule.conditions !== "object"
      || (rule.conditions as Record<string, unknown>).sendOncePerCart !== false;
    const dedupeKey = getCartAutomationDedupeKey({
      eventType: params.eventType,
      payload: params.payload,
      recipient: to,
    });
    const [existingJob] = await db
      .select({ id: commercialAutomationJobsTable.id })
      .from(commercialAutomationJobsTable)
      .where(and(eq(commercialAutomationJobsTable.ruleId, rule.id), eq(commercialAutomationJobsTable.eventId, params.eventRecordId)))
      .limit(1);

    if (existingJob) {
      scheduled.push({ ruleId: rule.id, jobId: existingJob.id, status: "duplicate" });
      continue;
    }

    if (to && rule.templateName) {
      const duplicateConditions = [
        eq(commercialAutomationJobsTable.clientId, params.clientId),
        eq(commercialAutomationJobsTable.ruleId, rule.id),
        sql`${commercialAutomationJobsTable.status} IN ('scheduled', 'processing', 'sent')`,
        sql`${commercialAutomationJobsTable.renderedPayload}->>'to' = ${to}`,
        sql`${commercialAutomationJobsTable.renderedPayload}->>'templateName' = ${rule.templateName}`,
      ];
      if (routing.audience === "internal_seller" && notificationSubjectId) {
        duplicateConditions.push(
          sql`${commercialAutomationJobsTable.renderedPayload}->>'notificationSubjectId' = ${notificationSubjectId}`,
        );
      } else if (cartAutomationIdentity && sendOncePerCart) {
        duplicateConditions.push(sql`(
          COALESCE(
            ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->>'cart_id',
            ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->>'cartId',
            ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->'cart'->>'id',
            ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->'cart'->>'external_id',
            ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->'data'->>'cart_id',
            ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->'data'->>'cartId',
            ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->'data'->>'id'
          ) = ${cartAutomationIdentity}
          OR ${commercialAutomationJobsTable.createdAt} >= ${new Date(Date.now() - Math.max(rule.cooldownHours ?? 24, 1) * 60 * 60 * 1000)}
        )`);
      } else {
        const duplicateWindowMinutes = isCartAutomationEvent
          ? Math.max(rule.cooldownHours ?? 24, 1) * 60
          : 10;
        duplicateConditions.push(gte(
          commercialAutomationJobsTable.createdAt,
          new Date(Date.now() - duplicateWindowMinutes * 60 * 1000),
        ));
      }
      if (!cartAutomationIdentity && eventOrderIdentity) {
        duplicateConditions.push(sql`COALESCE(
          ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->>'order_number',
          ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->'order'->>'number',
          ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->'order'->>'id',
          ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->'order'->>'external_id'
        ) = ${eventOrderIdentity}`);
      }
      const [recentDuplicate] = await db
        .select({ id: commercialAutomationJobsTable.id })
        .from(commercialAutomationJobsTable)
        .where(and(...duplicateConditions))
        .limit(1);

      if (recentDuplicate) {
        scheduled.push({ ruleId: rule.id, jobId: recentDuplicate.id, status: "duplicate", reason: "recent_same_template_recipient" });
        continue;
      }
    }

    if (!rule.templateName || !rule.templateLanguage) {
      await db.insert(commercialAutomationLogsTable).values({
        clientId: params.clientId,
        ruleId: rule.id,
        eventType: params.eventType,
        action: "automation_not_scheduled",
        status: "blocked",
        message: `Automação ${rule.name} está ativa, mas não tem template configurado.`,
        metadata: { eventRecordId: params.eventRecordId },
      });
      scheduled.push({ ruleId: rule.id, jobId: null, status: "blocked", reason: "template_missing" });
      continue;
    }

    if (!to) {
      const missingRecipientMessage = routing.audience === "internal_seller"
        ? `Automação ${rule.name} não foi agendada porque o evento não trouxe seller_phone da vendedora atribuída.`
        : `Automação ${rule.name} não foi agendada porque o evento não trouxe telefone.`;
      await db.insert(commercialAutomationLogsTable).values({
        clientId: params.clientId,
        ruleId: rule.id,
        eventType: params.eventType,
        action: "automation_not_scheduled",
        status: "blocked",
        message: missingRecipientMessage,
        metadata: { eventRecordId: params.eventRecordId, routing },
      });
      scheduled.push({
        ruleId: rule.id,
        jobId: null,
        status: "blocked",
        reason: routing.audience === "internal_seller" ? "seller_phone_missing" : "phone_missing",
      });
      continue;
    }

    if (!phoneNumberId) {
      const sellerIdentification = sender?.sellerName || sender?.sellerPhone;
      const message = routing.senderStrategy === "default_phone"
        ? `Automação ${rule.name} não foi agendada porque a marca não possui um número padrão ativo para notificações internas.`
        : sender?.blockedReason === "seller_phone_not_matched"
          ? `Automação ${rule.name} não foi agendada porque o WhatsApp da vendedora${sellerIdentification ? ` (${sellerIdentification})` : ""} não corresponde a nenhum número ativo conectado.`
          : `Automação ${rule.name} não foi agendada porque a marca não possui um número padrão ativo.`;
      await db.insert(commercialAutomationLogsTable).values({
        clientId: params.clientId,
        ruleId: rule.id,
        eventType: params.eventType,
        action: "automation_not_scheduled",
        status: "blocked",
        message,
        metadata: {
          eventRecordId: params.eventRecordId,
          sender,
        },
      });
      scheduled.push({
        ruleId: rule.id,
        jobId: null,
        status: "blocked",
        reason: sender?.blockedReason ?? "sender_phone_missing",
      });
      continue;
    }

    const scheduledAt = new Date(Date.now() + Math.max(rule.delayMinutes ?? 0, 0) * 60 * 1000);
    const bodyParams = await buildAutomationTemplateBodyParams({
      clientId: params.clientId,
      templateId: rule.templateId,
      templateName: rule.templateName,
      templateLanguage: rule.templateLanguage,
      wabaIds: sender?.wabaIds ?? [],
      payload: params.payload,
    });
    const jobValues = {
      clientId: params.clientId,
      ruleId: rule.id,
      eventId: params.eventRecordId,
      customerId: params.customerId,
      status: "scheduled",
      scheduledAt,
      renderedPayload: {
        to,
        phoneNumberId,
        templateName: rule.templateName,
        languageCode: rule.templateLanguage,
        bodyParams,
        sourceEvent: params.payload,
        sender,
        routing,
        audience: routing.audience,
        notificationSubjectId,
      },
    };

    const insertedJobs = routing.audience === "internal_seller" && notificationSubjectId
      ? await db.transaction(async (tx) => {
        const lockKey = `internal-notification:${params.clientId}:${rule.id}:${notificationSubjectId}`;
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
        const [duplicate] = await tx
          .select({ id: commercialAutomationJobsTable.id })
          .from(commercialAutomationJobsTable)
          .where(and(
            eq(commercialAutomationJobsTable.clientId, params.clientId),
            eq(commercialAutomationJobsTable.ruleId, rule.id),
            sql`${commercialAutomationJobsTable.status} IN ('scheduled', 'processing', 'sent')`,
            sql`${commercialAutomationJobsTable.renderedPayload}->>'notificationSubjectId' = ${notificationSubjectId}`,
          ))
          .limit(1);
        if (duplicate) {
          return { jobs: [], reason: "same_internal_notification_subject" };
        }
        const jobs = await tx
          .insert(commercialAutomationJobsTable)
          .values(jobValues)
          .returning({ id: commercialAutomationJobsTable.id });
        return { jobs, reason: null };
      })
      : isCartAutomationEvent && dedupeKey
      ? await db.transaction(async (tx) => {
        const lockKey = `cart-automation:${params.clientId}:${rule.id}:recipient:${to}`;
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

        const finalDuplicateConditions = [
          eq(commercialAutomationJobsTable.clientId, params.clientId),
          eq(commercialAutomationJobsTable.ruleId, rule.id),
          sql`${commercialAutomationJobsTable.status} IN ('scheduled', 'processing', 'sent')`,
          sql`${commercialAutomationJobsTable.renderedPayload}->>'to' = ${to}`,
          sql`${commercialAutomationJobsTable.renderedPayload}->>'templateName' = ${rule.templateName}`,
        ];
        if (cartAutomationIdentity && sendOncePerCart) {
          finalDuplicateConditions.push(sql`(
            COALESCE(
              ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->>'cart_id',
              ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->>'cartId',
              ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->'cart'->>'id',
              ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->'cart'->>'external_id',
              ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->'data'->>'cart_id',
              ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->'data'->>'cartId',
              ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->'data'->>'id'
            ) = ${cartAutomationIdentity}
            OR ${commercialAutomationJobsTable.createdAt} >= ${new Date(Date.now() - Math.max(rule.cooldownHours ?? 24, 1) * 60 * 60 * 1000)}
          )`);
        } else {
          finalDuplicateConditions.push(gte(
            commercialAutomationJobsTable.createdAt,
            new Date(Date.now() - Math.max(rule.cooldownHours ?? 24, 1) * 60 * 60 * 1000),
          ));
        }

        const [monthlyUsage] = await tx
          .select({ total: sql<number>`COUNT(*)::int` })
          .from(commercialAutomationJobsTable)
          .where(and(
            eq(commercialAutomationJobsTable.clientId, params.clientId),
            eq(commercialAutomationJobsTable.ruleId, rule.id),
            sql`${commercialAutomationJobsTable.status} IN ('scheduled', 'processing', 'sent')`,
            sql`${commercialAutomationJobsTable.renderedPayload}->>'to' = ${to}`,
            gte(commercialAutomationJobsTable.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
          ));
        if ((monthlyUsage?.total ?? 0) >= Math.max(rule.maxSendsPerCustomerMonth ?? 4, 1)) {
          return { jobs: [], reason: "customer_30_day_limit" };
        }

        const [concurrentDuplicate] = await tx
          .select({ id: commercialAutomationJobsTable.id })
          .from(commercialAutomationJobsTable)
          .where(and(...finalDuplicateConditions))
          .limit(1);
        if (concurrentDuplicate) {
          return {
            jobs: [],
            reason: cartAutomationIdentity && sendOncePerCart
              ? "same_cart_or_cooldown"
              : "cooldown_active",
          };
        }

        const jobs = await tx
          .insert(commercialAutomationJobsTable)
          .values(jobValues)
          .returning({ id: commercialAutomationJobsTable.id });
        return { jobs, reason: null };
      })
      : {
          jobs: await db
            .insert(commercialAutomationJobsTable)
            .values(jobValues)
            .returning({ id: commercialAutomationJobsTable.id }),
          reason: null,
        };
    const [job] = insertedJobs.jobs;

    if (!job) {
      await db.insert(commercialAutomationLogsTable).values({
        clientId: params.clientId,
        ruleId: rule.id,
        eventType: params.eventType,
        action: "automation_duplicate_skipped",
        status: "info",
        message: insertedJobs.reason === "same_internal_notification_subject"
          ? `Automação ${rule.name} ignorada: esta vendedora já recebeu a notificação deste cadastro.`
          : insertedJobs.reason === "customer_30_day_limit"
          ? `Automação ${rule.name} ignorada: o cliente atingiu o limite de ${rule.maxSendsPerCustomerMonth ?? 4} envio(s) desta etapa em 30 dias.`
          : `Automação ${rule.name} ignorada: este carrinho já recebeu a etapa ou o intervalo mínimo de ${rule.cooldownHours ?? 24} hora(s) ainda está ativo.`,
        metadata: {
          eventRecordId: params.eventRecordId,
          dedupeKey,
          recipient: maskWhatsappRecipient(to),
          reason: insertedJobs.reason,
          sendOncePerCart,
          cooldownHours: rule.cooldownHours,
          maxSendsPerCustomerMonth: rule.maxSendsPerCustomerMonth,
          routing,
          notificationSubjectId,
        },
      });
      scheduled.push({
        ruleId: rule.id,
        jobId: null,
        status: "duplicate",
        reason: insertedJobs.reason ?? "cart_automation_idempotency",
      });
      continue;
    }

    await db.insert(commercialAutomationLogsTable).values({
      clientId: params.clientId,
      ruleId: rule.id,
      jobId: job.id,
      eventType: params.eventType,
      action: "automation_scheduled",
      status: "info",
      message: `Automação ${rule.name} agendada para ${scheduledAt.toISOString()}.`,
      metadata: {
        eventRecordId: params.eventRecordId,
        delayMinutes: rule.delayMinutes,
        templateName: rule.templateName,
        phoneNumberId,
        sender,
        routing,
        notificationSubjectId,
      },
    });

    scheduled.push({ ruleId: rule.id, jobId: job.id, status: "scheduled" });
  }

  return scheduled;
}

function isCartConversionEvent(eventType: string) {
  const value = (normalizeAutomationEventType(eventType) ?? eventType).toLowerCase();
  return [
    "cart_converted",
    "order.created",
    "order.confirmed",
    "order.payment_confirmed",
  ].includes(value);
}

function cartRecoveryEventCandidates() {
  return [
    ...automationEventTypeCandidates("cart_created"),
    ...automationEventTypeCandidates("cart_abandoned"),
  ];
}

async function cancelPendingCartRecoveryJobs(params: {
  clientId: string;
  eventType: string;
  eventRecordId: string | null;
  normalized: NormalizedWebhookPayload;
  payload: Record<string, unknown>;
}) {
  if (!isCartConversionEvent(params.eventType)) return [];

  const cartId = params.normalized.externalCartId;
  const checkoutId = params.normalized.externalCheckoutId;
  const externalCustomerId = params.normalized.externalCustomerId;
  const phone = normalizeWhatsappRecipient(params.normalized.customerPhone ?? firstText(params.payload.phone));

  const identityConditions = [];
  if (cartId) {
    identityConditions.push(sql`COALESCE(
      ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->>'cart_id',
      ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->>'cartId',
      ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->'cart'->>'id',
      ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->'cart'->>'external_id',
      ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->'normalized'->>'externalCartId'
    ) = ${cartId}`);
  }
  if (checkoutId) {
    identityConditions.push(sql`COALESCE(
      ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->>'checkout_id',
      ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->>'checkoutId',
      ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->'checkout'->>'id',
      ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->'checkout'->>'external_id',
      ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->'normalized'->>'externalCheckoutId'
    ) = ${checkoutId}`);
  }
  if (externalCustomerId) {
    identityConditions.push(sql`COALESCE(
      ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->>'customer_id',
      ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->>'customerId',
      ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->'customer'->>'id',
      ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->'normalized'->>'externalCustomerId'
    ) = ${externalCustomerId}`);
  }
  if (phone) {
    identityConditions.push(sql`(
      regexp_replace(coalesce(${commercialAutomationJobsTable.renderedPayload}->>'to', ''), '[^0-9]', '', 'g') = ${phone}
      OR right(regexp_replace(coalesce(${commercialAutomationJobsTable.renderedPayload}->>'to', ''), '[^0-9]', '', 'g'), 11) = ${phone.slice(-11)}
    )`);
  }

  if (identityConditions.length === 0) return [];

  const pending = await db
    .select({
      id: commercialAutomationJobsTable.id,
      ruleId: commercialAutomationJobsTable.ruleId,
      ruleName: commercialAutomationRulesTable.name,
      scheduledAt: commercialAutomationJobsTable.scheduledAt,
    })
    .from(commercialAutomationJobsTable)
    .leftJoin(commercialAutomationRulesTable, eq(commercialAutomationJobsTable.ruleId, commercialAutomationRulesTable.id))
    .where(
      and(
        eq(commercialAutomationJobsTable.clientId, params.clientId),
        eq(commercialAutomationJobsTable.status, "scheduled"),
        inArray(commercialAutomationRulesTable.eventType, cartRecoveryEventCandidates()),
        or(...identityConditions),
      ),
    )
    .limit(25);

  if (pending.length === 0) return [];

  const now = new Date();
  const ids = pending.map((job) => job.id);
  await db
    .update(commercialAutomationJobsTable)
    .set({
      status: "cancelled",
      processedAt: now,
      skipReason: `cancelled_by_${params.eventType}`,
      updatedAt: now,
    })
    .where(inArray(commercialAutomationJobsTable.id, ids));

  await Promise.all(pending.map((job) =>
    db.insert(commercialAutomationLogsTable).values({
      clientId: params.clientId,
      ruleId: job.ruleId,
      jobId: job.id,
      eventType: params.eventType,
      action: "automation_cancelled",
      status: "info",
      message: `Automação de carrinho ${job.ruleName ?? job.ruleId} cancelada porque o carrinho converteu.`,
      metadata: {
        eventRecordId: params.eventRecordId,
        cartId,
        checkoutId,
        externalCustomerId,
        phone,
        scheduledAt: job.scheduledAt,
      },
    }),
  ));

  return pending.map((job) => ({
    jobId: job.id,
    ruleId: job.ruleId,
    status: "cancelled",
    reason: `cancelled_by_${params.eventType}`,
  }));
}

async function processDueAutomationJobs(limit = 25) {
  const now = new Date();
  const jobs = await db
    .select({
      id: commercialAutomationJobsTable.id,
      clientId: commercialAutomationJobsTable.clientId,
      ruleId: commercialAutomationJobsTable.ruleId,
      eventId: commercialAutomationJobsTable.eventId,
      createdAt: commercialAutomationJobsTable.createdAt,
      renderedPayload: commercialAutomationJobsTable.renderedPayload,
      eventType: commercialAutomationRulesTable.eventType,
      ruleName: commercialAutomationRulesTable.name,
      templateName: commercialAutomationRulesTable.templateName,
      templateLanguage: commercialAutomationRulesTable.templateLanguage,
    })
    .from(commercialAutomationJobsTable)
    .leftJoin(commercialAutomationRulesTable, eq(commercialAutomationJobsTable.ruleId, commercialAutomationRulesTable.id))
    .where(
      and(
        eq(commercialAutomationJobsTable.status, "scheduled"),
        lte(commercialAutomationJobsTable.scheduledAt, now),
      ),
    )
    .orderBy(commercialAutomationJobsTable.scheduledAt)
    .limit(limit);

  const results: Array<{ jobId: string; status: string; message: string }> = [];

  for (const job of jobs) {
    const [claimedJob] = await db
      .update(commercialAutomationJobsTable)
      .set({
        status: "processing",
        updatedAt: new Date(),
      })
      .where(and(eq(commercialAutomationJobsTable.id, job.id), eq(commercialAutomationJobsTable.status, "scheduled")))
      .returning({ id: commercialAutomationJobsTable.id });

    if (!claimedJob) {
      continue;
    }

    const rendered = asRecord(job.renderedPayload) ?? {};
    const sourceEvent = asRecord(rendered.sourceEvent) ?? {};
    const cartAutomationIdentity = getCartAutomationIdentity(job.eventType, sourceEvent);

    if (cartAutomationIdentity) {
      const sameRuleCondition = job.ruleId
        ? eq(commercialAutomationJobsTable.ruleId, job.ruleId)
        : sql`${commercialAutomationJobsTable.ruleId} IS NULL`;
      const [previousCartJob] = await db
        .select({ id: commercialAutomationJobsTable.id })
        .from(commercialAutomationJobsTable)
        .where(
          and(
            eq(commercialAutomationJobsTable.clientId, job.clientId),
            sameRuleCondition,
            sql`${commercialAutomationJobsTable.status} IN ('processing', 'sent')`,
            or(
              sql`${commercialAutomationJobsTable.createdAt} < ${job.createdAt}`,
              and(
                eq(commercialAutomationJobsTable.createdAt, job.createdAt),
                sql`${commercialAutomationJobsTable.id} < ${job.id}`,
              ),
            ),
            sql`COALESCE(
              ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->>'cart_id',
              ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->>'cartId',
              ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->'cart'->>'id',
              ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->'cart'->>'external_id',
              ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->'data'->>'cart_id',
              ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->'data'->>'cartId',
              ${commercialAutomationJobsTable.renderedPayload}->'sourceEvent'->'data'->>'id'
            ) = ${cartAutomationIdentity}`,
          ),
        )
        .limit(1);

      if (previousCartJob) {
        const message = `Job duplicado cancelado: a automação já foi processada para o carrinho ${cartAutomationIdentity}.`;
        await db
          .update(commercialAutomationJobsTable)
          .set({
            status: "cancelled",
            processedAt: new Date(),
            skipReason: "duplicate_cart_automation",
            updatedAt: new Date(),
          })
          .where(eq(commercialAutomationJobsTable.id, job.id));
        await db.insert(commercialAutomationLogsTable).values({
          clientId: job.clientId,
          ruleId: job.ruleId,
          jobId: job.id,
          eventType: job.eventType ?? "automation",
          action: "automation_duplicate_skipped",
          status: "info",
          message,
          metadata: {
            eventId: job.eventId,
            cartId: cartAutomationIdentity,
            previousJobId: previousCartJob.id,
          },
        });
        results.push({ jobId: job.id, status: "cancelled", message });
        continue;
      }
    }

    const recipient = validateWhatsappRecipient(firstText(rendered.to));
    const to = recipient.normalized;
    const sender = asRecord(rendered.sender);
    const routing = asRecord(rendered.routing);
    const audience = firstText(rendered.audience, routing?.audience) === "internal_seller"
      ? "internal_seller"
      : "customer";
    const sellerPhone = firstText(sender?.sellerPhone);
    const senderSource = firstText(sender?.source);
    const phoneNumberId = firstText(rendered.phoneNumberId) ?? await findAutomationPhoneNumberId(job.clientId);
    const templateName = firstText(rendered.templateName, job.templateName);
    const languageCode = firstText(rendered.languageCode, job.templateLanguage) ?? "pt_BR";
    const bodyParamsValue = Array.isArray(rendered.bodyParams) ? rendered.bodyParams : [];
    let bodyParams = bodyParamsValue
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((text) => ({ type: "text", text: text.trim() }));

    if (!recipient.isValid) {
      const maskedRecipient = maskWhatsappRecipient(to);
      const message = `Job bloqueado: telefone do destinatário ${maskedRecipient} inválido (${recipient.reason}).`;
      await db
        .update(commercialAutomationJobsTable)
        .set({
          status: "failed",
          processedAt: new Date(),
          errorMessage: message,
          updatedAt: new Date(),
        })
        .where(eq(commercialAutomationJobsTable.id, job.id));
      await db.insert(commercialAutomationLogsTable).values({
        clientId: job.clientId,
        ruleId: job.ruleId,
        jobId: job.id,
        eventType: job.eventType ?? "automation",
        action: "automation_recipient_invalid",
        status: "blocked",
        message,
        metadata: {
          ecommerceEventId: job.eventId,
          recipient: maskedRecipient,
          recipientValidationReason: recipient.reason,
          templateName,
        },
      });
      results.push({ jobId: job.id, status: "failed", message });
      continue;
    }

    if (hasAssignedSellerSenderMismatch({ audience, sellerPhone, senderSource })) {
      const message = `Job bloqueado: o WhatsApp da vendedora (${sellerPhone}) não corresponde a um número ativo conectado.`;
      await db
        .update(commercialAutomationJobsTable)
        .set({
          status: "failed",
          processedAt: new Date(),
          errorMessage: message,
          updatedAt: new Date(),
        })
        .where(eq(commercialAutomationJobsTable.id, job.id));
      await db.insert(commercialAutomationLogsTable).values({
        clientId: job.clientId,
        ruleId: job.ruleId,
        jobId: job.id,
        eventType: job.eventType ?? "automation",
        action: "automation_send_failed",
        status: "blocked",
        message,
        metadata: { eventId: job.eventId, sellerPhone, senderSource, sender },
      });
      results.push({ jobId: job.id, status: "failed", message });
      continue;
    }

    if (!to || !phoneNumberId || !templateName) {
      const missingFields = [
        !to ? "telefone do destinatário" : null,
        !phoneNumberId ? "número emissor conectado" : null,
        !templateName ? "template" : null,
      ].filter((value): value is string => Boolean(value));
      const message = `Job bloqueado por configuração incompleta: ${missingFields.join(", ")}.`;
      await db
        .update(commercialAutomationJobsTable)
        .set({
          status: "failed",
          processedAt: new Date(),
          errorMessage: message,
          updatedAt: new Date(),
        })
        .where(eq(commercialAutomationJobsTable.id, job.id));
      await db.insert(commercialAutomationLogsTable).values({
        clientId: job.clientId,
        ruleId: job.ruleId,
        jobId: job.id,
        eventType: job.eventType ?? "automation",
        action: "automation_send_failed",
        status: "blocked",
        message,
        metadata: { eventId: job.eventId, to, phoneNumberId, templateName, sender },
      });
      results.push({ jobId: job.id, status: "failed", message });
      continue;
    }

    const [senderPhone] = await db
      .select({
        integrationId: whatsappPhoneNumbersTable.integrationId,
        wabaId: whatsappPhoneNumbersTable.wabaId,
        rawPayload: whatsappPhoneNumbersTable.rawPayload,
      })
      .from(whatsappPhoneNumbersTable)
      .where(
        and(
          eq(whatsappPhoneNumbersTable.clientId, job.clientId),
          eq(whatsappPhoneNumbersTable.phoneNumberId, phoneNumberId),
          sql`${whatsappPhoneNumbersTable.status} <> 'archived'`,
        ),
      )
      .limit(1);

    const [exactIntegration] = await db
      .select()
      .from(whatsappIntegrationsTable)
      .where(
        and(
          eq(whatsappIntegrationsTable.clientId, job.clientId),
          eq(whatsappIntegrationsTable.phoneNumberId, phoneNumberId),
        ),
      )
      .limit(1);

    const isSenderWabaCompatible = (integration: typeof whatsappIntegrationsTable.$inferSelect | undefined) =>
      Boolean(integration && (!senderPhone?.wabaId || integration.wabaId === senderPhone.wabaId));
    let sendIntegration = isSenderWabaCompatible(exactIntegration) ? exactIntegration : undefined;
    if (!sendIntegration && senderPhone?.integrationId) {
      const [boundIntegration] = await db
        .select()
        .from(whatsappIntegrationsTable)
        .where(
          and(
            eq(whatsappIntegrationsTable.id, senderPhone.integrationId),
            eq(whatsappIntegrationsTable.clientId, job.clientId),
          ),
        )
        .limit(1);
      sendIntegration = isSenderWabaCompatible(boundIntegration) ? boundIntegration : undefined;
    }
    if (!sendIntegration && senderPhone?.wabaId) {
      [sendIntegration] = await db
        .select()
        .from(whatsappIntegrationsTable)
        .where(
          and(
            eq(whatsappIntegrationsTable.clientId, job.clientId),
            eq(whatsappIntegrationsTable.wabaId, senderPhone.wabaId),
          ),
        )
        .limit(1);
    }

    if (!sendIntegration?.accessToken) {
      const senderLabel = firstText(sender?.verifiedName, sender?.sellerName, sender?.displayPhoneNumber);
      const message = `O número emissor${senderLabel ? ` (${senderLabel})` : ""} não possui uma integração WhatsApp válida vinculada a este cliente.`;
      await db
        .update(commercialAutomationJobsTable)
        .set({
          status: "failed",
          processedAt: new Date(),
          errorMessage: message,
          updatedAt: new Date(),
        })
        .where(eq(commercialAutomationJobsTable.id, job.id));
      await db.insert(commercialAutomationLogsTable).values({
        clientId: job.clientId,
        ruleId: job.ruleId,
        jobId: job.id,
        eventType: job.eventType ?? "automation",
        action: "automation_send_failed",
        status: "blocked",
        message,
        metadata: { eventId: job.eventId, to, phoneNumberId, templateName, sender },
      });
      results.push({ jobId: job.id, status: "failed", message });
      continue;
    }

    const verifiedSenderWabaId = getVerifiedWhatsappWabaId(
      senderPhone?.rawPayload,
      senderPhone?.wabaId,
    );
    const senderWabaDiscovery = verifiedSenderWabaId
      ? {
          wabaId: verifiedSenderWabaId,
          checkedWabaIds: [verifiedSenderWabaId],
          matchedPhone: true,
          errors: [],
        }
      : await discoverWhatsappWabaForPhone({
          integration: sendIntegration,
          phoneNumberId,
          graphApiVersion: process.env.META_GRAPH_API_VERSION ?? "v23.0",
          candidateWabaIds: [
            senderPhone?.wabaId,
            sendIntegration.wabaId,
            ...(Array.isArray(sender?.wabaIds)
              ? sender.wabaIds.filter((value): value is string => typeof value === "string")
              : []),
          ],
        });
    const senderWabaId = senderWabaDiscovery.matchedPhone
      ? senderWabaDiscovery.wabaId
      : null;

    if (!senderWabaId) {
      const senderLabel = firstText(sender?.verifiedName, sender?.sellerName, sender?.displayPhoneNumber);
      const discoveryDetails = senderWabaDiscovery.errors.length
        ? ` A Meta retornou: ${senderWabaDiscovery.errors.join("; ")}`
        : "";
      const message = `Não foi possível confirmar a WABA do número emissor${senderLabel ? ` (${senderLabel})` : ""}.${discoveryDetails}`;
      await db
        .update(commercialAutomationJobsTable)
        .set({
          status: "failed",
          processedAt: new Date(),
          errorMessage: message,
          updatedAt: new Date(),
        })
        .where(eq(commercialAutomationJobsTable.id, job.id));
      await db.insert(commercialAutomationLogsTable).values({
        clientId: job.clientId,
        ruleId: job.ruleId,
        jobId: job.id,
        eventType: job.eventType ?? "automation",
        action: "automation_send_failed",
        status: "blocked",
        message,
        metadata: {
          eventId: job.eventId,
          to,
          phoneNumberId,
          templateName,
          sender,
          wabaDiscovery: senderWabaDiscovery,
        },
      });
      results.push({ jobId: job.id, status: "failed", message });
      continue;
    }

    if (!verifiedSenderWabaId) {
      const verifiedAt = new Date();
      await db
        .update(whatsappPhoneNumbersTable)
        .set({
          wabaId: senderWabaId,
          rawPayload: addWhatsappWabaVerification(senderPhone?.rawPayload, {
            wabaId: senderWabaId,
            verifiedAt: verifiedAt.toISOString(),
          }),
          lastSyncedAt: verifiedAt,
          updatedAt: verifiedAt,
        })
        .where(
          and(
            eq(whatsappPhoneNumbersTable.clientId, job.clientId),
            eq(whatsappPhoneNumbersTable.phoneNumberId, phoneNumberId),
          ),
        );

      if (senderPhone?.wabaId !== senderWabaId) {
        await db.insert(commercialAutomationLogsTable).values({
          clientId: job.clientId,
          ruleId: job.ruleId,
          jobId: job.id,
          eventType: job.eventType ?? "automation",
          action: "automation_sender_waba_reconciled",
          status: "info",
          message: `WABA do número emissor atualizada para ${senderWabaId} antes do envio.`,
          metadata: {
            eventId: job.eventId,
            phoneNumberId,
            previousWabaId: senderPhone?.wabaId ?? null,
            senderWabaId,
            wabaDiscovery: senderWabaDiscovery,
          },
        });
      }
    }

    const senderWabaIds = [senderWabaId];
    let approvedTemplate = await findApprovedAutomationTemplate({
      clientId: job.clientId,
      templateName,
      languageCode,
      wabaIds: senderWabaIds,
    });
    let templateRefresh: Awaited<ReturnType<typeof refreshAutomationTemplateCatalog>> | null = null;

    if (!approvedTemplate && senderWabaIds.length) {
      templateRefresh = await refreshAutomationTemplateCatalog({
        clientId: job.clientId,
        integrationId: sendIntegration.id,
        accessToken: sendIntegration.accessToken,
        wabaIds: senderWabaIds,
      });
      approvedTemplate = await findApprovedAutomationTemplate({
        clientId: job.clientId,
        templateName,
        languageCode,
        wabaIds: senderWabaIds,
      });

      if (templateRefresh.syncedTemplates > 0) {
        await db.insert(commercialAutomationLogsTable).values({
          clientId: job.clientId,
          ruleId: job.ruleId,
          jobId: job.id,
          eventType: job.eventType ?? "automation",
          action: "automation_templates_refreshed",
          status: "info",
          message: `${templateRefresh.syncedTemplates} template(s) sincronizado(s) automaticamente antes do envio.`,
          metadata: {
            eventId: job.eventId,
            phoneNumberId,
            senderWabaIds,
            syncedWabaIds: templateRefresh.syncedWabaIds,
            wabaDiscovery: senderWabaDiscovery,
          },
        });
      }
    }

    if (!approvedTemplate) {
      const refreshErrors = templateRefresh?.errors
        .map((error) => `${error.wabaId}: ${error.message}`)
        .join("; ");
      const senderLabel = firstText(sender?.verifiedName, sender?.sellerName, sender?.displayPhoneNumber);
      const message = [
        `O template ${templateName} (${languageCode}) não está aprovado no WABA do número emissor${senderLabel ? ` (${senderLabel})` : ""}.`,
        refreshErrors ? `A sincronização com a Meta retornou: ${refreshErrors}` : null,
      ].filter(Boolean).join(" ");
      await db
        .update(commercialAutomationJobsTable)
        .set({
          status: "failed",
          processedAt: new Date(),
          errorMessage: message,
          updatedAt: new Date(),
        })
        .where(eq(commercialAutomationJobsTable.id, job.id));
      await db.insert(commercialAutomationLogsTable).values({
        clientId: job.clientId,
        ruleId: job.ruleId,
        jobId: job.id,
        eventType: job.eventType ?? "automation",
        action: "automation_send_failed",
        status: "blocked",
        message,
        metadata: {
          eventId: job.eventId,
          to,
          phoneNumberId,
          templateName,
          languageCode,
          senderWabaIds,
          templateRefresh,
          sender,
          wabaDiscovery: senderWabaDiscovery,
        },
      });
      results.push({ jobId: job.id, status: "failed", message });
      continue;
    }

    if (bodyParams.length === 0) {
      const sourceEvent = asRecord(rendered.sourceEvent);
      if (sourceEvent) {
        const rebuiltBodyParams = await buildAutomationTemplateBodyParams({
          clientId: job.clientId,
          templateId: null,
          templateName,
          templateLanguage: languageCode,
          wabaIds: senderWabaIds,
          payload: sourceEvent,
        });
        bodyParams = rebuiltBodyParams
          .filter((value) => value.trim().length > 0)
          .map((text) => ({ type: "text", text: text.trim() }));
      }
    }

    const components = bodyParams.length
      ? [{ type: "body", parameters: bodyParams }]
      : undefined;
    const response = await fetch(`https://graph.facebook.com/${process.env.META_GRAPH_API_VERSION ?? "v23.0"}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sendIntegration.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: languageCode },
          ...(components ? { components } : {}),
        },
      }),
    });
    const metaPayload = await response.json() as {
      messages?: Array<{ id?: string }>;
      error?: {
        code?: number;
        message?: string;
        title?: string;
        error_data?: { details?: string };
      };
    };

    if (!response.ok) {
      const describedError = describeWhatsappDeliveryError(metaPayload.error);
      const message = metaPayload.error
        ? describedError
        : `Meta recusou o envio do template (HTTP ${response.status}).`;
      await db
        .update(commercialAutomationJobsTable)
        .set({
          status: "failed",
          processedAt: new Date(),
          errorMessage: message,
          updatedAt: new Date(),
        })
        .where(eq(commercialAutomationJobsTable.id, job.id));
      await db.insert(commercialAutomationLogsTable).values({
        clientId: job.clientId,
        ruleId: job.ruleId,
        jobId: job.id,
        eventType: job.eventType ?? "automation",
        action: "automation_send_failed",
        status: "blocked",
        message,
        metadata: {
          eventId: job.eventId,
          to,
          phoneNumberId,
          senderWabaId,
          templateName,
          languageCode,
          sender,
          wabaDiscovery: senderWabaDiscovery,
          meta: metaPayload,
        },
      });
      results.push({ jobId: job.id, status: "failed", message });
      continue;
    }

    const sentAt = new Date();
    const messageIds = metaPayload.messages?.map((message) => message.id).filter(Boolean) ?? [];
    await db
      .update(commercialAutomationJobsTable)
      .set({
        status: "sent",
        processedAt: sentAt,
        sentAt,
        whatsappMessageIds: messageIds,
        updatedAt: sentAt,
      })
      .where(eq(commercialAutomationJobsTable.id, job.id));
    await db.insert(whatsappMessagesTable).values({
      clientId: job.clientId,
      phoneNumberId,
      externalMessageId: messageIds[0] ?? null,
      direction: "outbound",
      messageType: "template",
      body: `Template: ${templateName}`,
      rawPayload: {
        source: "commercial_automation",
        jobId: job.id,
        ruleId: job.ruleId,
        sender,
        senderWabaId,
        templateName,
        languageCode,
        meta: metaPayload,
      },
      sentAt,
    });
    await db.insert(commercialAutomationLogsTable).values({
      clientId: job.clientId,
      ruleId: job.ruleId,
      jobId: job.id,
      eventType: job.eventType ?? "automation",
      action: "automation_template_sent",
      status: "ok",
      message: `Template ${templateName} aceito pela Meta; aguardando confirmação de entrega.`,
      metadata: {
        eventId: job.eventId,
        to,
        phoneNumberId,
        senderWabaId,
        templateName,
        languageCode,
        sender,
        messageIds,
      },
    });
    results.push({ jobId: job.id, status: "sent", message: `Template ${templateName} aceito pela Meta.` });
  }

  return {
    processed: results.length,
    results,
  };
}

async function buildAgentConfigs(clientId: string) {
  await ensureCommercialSetup(clientId);
  return db
    .select({
      id: aiAgentConfigsTable.id,
      agentType: aiAgentConfigsTable.agentType,
      name: aiAgentConfigsTable.name,
      status: aiAgentConfigsTable.status,
      model: aiAgentConfigsTable.model,
      temperature: aiAgentConfigsTable.temperature,
      systemPrompt: aiAgentConfigsTable.systemPrompt,
      autonomyMode: aiAgentConfigsTable.autonomyMode,
      canAutoReply: aiAgentConfigsTable.canAutoReply,
      canCreateRegistration: aiAgentConfigsTable.canCreateRegistration,
      canCreatePreOrder: aiAgentConfigsTable.canCreatePreOrder,
      canHandoff: aiAgentConfigsTable.canHandoff,
      updatedAt: aiAgentConfigsTable.updatedAt,
    })
    .from(aiAgentConfigsTable)
    .where(eq(aiAgentConfigsTable.clientId, clientId))
    .orderBy(aiAgentConfigsTable.agentType);
}

async function buildCommercialLogs(clientId: string, limit = 100) {
  const logs = await db
    .select({
      id: commercialAutomationLogsTable.id,
      jobId: commercialAutomationLogsTable.jobId,
      eventType: commercialAutomationLogsTable.eventType,
      action: commercialAutomationLogsTable.action,
      status: commercialAutomationLogsTable.status,
      message: commercialAutomationLogsTable.message,
      metadata: commercialAutomationLogsTable.metadata,
      createdAt: commercialAutomationLogsTable.createdAt,
    })
    .from(commercialAutomationLogsTable)
    .where(eq(commercialAutomationLogsTable.clientId, clientId))
    .orderBy(desc(commercialAutomationLogsTable.createdAt))
    .limit(limit);

  const jobIds = Array.from(new Set(logs
    .map((log) => log.jobId)
    .filter((jobId): jobId is string => Boolean(jobId))));
  const jobs = jobIds.length > 0
    ? await db
      .select({
        id: commercialAutomationJobsTable.id,
        eventId: commercialAutomationJobsTable.eventId,
      })
      .from(commercialAutomationJobsTable)
      .where(inArray(commercialAutomationJobsTable.id, jobIds))
    : [];
  const jobEventMap = new Map(jobs.map((job) => [job.id, job.eventId]));

  const eventIds = Array.from(new Set(logs
    .map((log) => firstText(asRecord(log.metadata)?.ecommerceEventId))
    .concat(logs.map((log) => log.jobId ? jobEventMap.get(log.jobId) ?? null : null))
    .filter((eventId): eventId is string => Boolean(eventId))));

  if (eventIds.length === 0) return logs;

  const events = await db
    .select({
      id: ecommerceWebhookEventsTable.id,
      payload: ecommerceWebhookEventsTable.payload,
      normalizedPayload: ecommerceWebhookEventsTable.normalizedPayload,
    })
    .from(ecommerceWebhookEventsTable)
    .where(and(eq(ecommerceWebhookEventsTable.clientId, clientId), inArray(ecommerceWebhookEventsTable.id, eventIds)));

  const eventMap = new Map(events.map((event) => [event.id, event]));
  return logs.map((log) => {
    const eventId =
      firstText(asRecord(log.metadata)?.ecommerceEventId) ??
      (log.jobId ? jobEventMap.get(log.jobId) ?? null : null);
    const event = eventId ? eventMap.get(eventId) : null;
    if (!event) return log;
    return {
      ...log,
      webhookPayload: event.payload,
      normalizedPayload: event.normalizedPayload,
    };
  });
}

router.all("/ecommerce/webhooks/:clientId", async (req, res): Promise<void> => {
  const client = await requireB2BClient(req.params.clientId);
  if (!client) {
    res.status(404).json({
      accepted: false,
      error: true,
      message: "Cliente B2B não encontrado para este webhook.",
    });
    return;
  }

  const configuredToken = await ensureWebhookConfig(client.id);
  const requestToken = firstText(req.query.token, asRecord(req.body)?.token);
  if (configuredToken && requestToken && requestToken !== configuredToken) {
    res.status(401).json({
      accepted: false,
      error: true,
      message: "Token inválido para este webhook.",
    });
    return;
  }

  const payload = requestWebhookPayload(req);
  const normalized = normalizeWebhookPayload(payload);
  let ecommerceEventId: string | null = null;
  let duplicate = false;

  if (normalized.eventId) {
    const [existing] = await db
      .select({ id: ecommerceWebhookEventsTable.id })
      .from(ecommerceWebhookEventsTable)
      .where(
        and(
          eq(ecommerceWebhookEventsTable.clientId, client.id),
          eq(ecommerceWebhookEventsTable.eventId, normalized.eventId),
        ),
      )
      .limit(1);
    ecommerceEventId = existing?.id ?? null;
    duplicate = Boolean(existing);
  }

  if (!ecommerceEventId) {
    const [created] = await db
      .insert(ecommerceWebhookEventsTable)
      .values({
        clientId: client.id,
        eventId: normalized.eventId,
        eventType: normalized.eventType,
        externalCustomerId: normalized.externalCustomerId,
        externalOrderId: normalized.externalOrderId,
        externalCartId: normalized.externalCartId,
        externalCheckoutId: normalized.externalCheckoutId,
        payload: req.body,
        normalizedPayload: normalized,
        status: "received",
        occurredAt: normalized.occurredAt,
      })
      .returning({ id: ecommerceWebhookEventsTable.id });
    ecommerceEventId = created?.id ?? null;
  }

  const customer = await findCustomerForWebhook(client.id, normalized);
  const order = await findOrderForWebhook(client.id, normalized, customer);
  const customerName = selectWebhookCustomerContact(normalized.customerName, customer?.name);
  const customerPhone = selectWebhookCustomerContact(normalized.customerPhone, customer?.phone);
  const customerEmail = selectWebhookCustomerContact(normalized.customerEmail, customer?.email);
  const sellerName = normalized.sellerName ?? firstText(payload.seller_name, payload.assigned_seller_name);
  const sellerPhone = normalized.sellerPhone ?? firstText(payload.seller_phone, payload.assigned_seller_phone);
  const sellerEmail = normalized.sellerEmail ?? firstText(payload.seller_email);
  const sellerSlug = normalized.sellerSlug ?? firstText(payload.seller_slug);
  const orderNumber = normalized.externalOrderId ?? order?.externalId ?? order?.id ?? null;
  const orderTotal = normalized.value || order?.amount || 0;
  const payloadCart = asRecord(payload.cart) ?? {};
  const cartTotal = normalized.value || firstNumber(payload.cart_total, payloadCart.total, payloadCart.total_value);
  const cartUrl = firstText(payload.cart_url, payload.recovery_url, payload.checkout_url, payloadCart.url, payloadCart.recovery_url, payloadCart.checkout_url);
  const cartItems = firstText(payload.items, payloadCart.items);
  const automationPayload = {
    ...payload,
    contact_name: customerName,
    first_name: customerName?.split(/\s+/)[0] ?? null,
    company_name: customerName,
    trade_name: customerName,
    cpf_cnpj: customer?.documentLast4 ? `${customer.documentType ?? "DOC"} ****${customer.documentLast4}` : null,
    email: customerEmail,
    phone: customerPhone,
    status: customer?.registrationStatus ?? null,
    address_city: customer?.city ?? null,
    address_state: customer?.state ?? null,
    order_number: orderNumber,
    order_total: formatMoneyBRL(orderTotal) ?? String(orderTotal || ""),
    cart_id: normalized.externalCartId,
    checkout_id: normalized.externalCheckoutId,
    cart_total: formatMoneyBRL(cartTotal) ?? String(cartTotal || ""),
    cart_url: cartUrl,
    recovery_url: cartUrl,
    seller_name: sellerName,
    seller_phone: sellerPhone,
    seller_email: sellerEmail,
    seller_slug: sellerSlug,
    assigned_seller_name: sellerName,
    assigned_seller_phone: sellerPhone,
    items: order?.itemText ?? cartItems ?? firstText((asRecord(payload.order) ?? {}).items, payload.items),
    product_media_urls: order?.imageUrls?.join("\n") ?? null,
    customer: {
      ...(asRecord(payload.customer) ?? {}),
      id: customer?.externalId ?? normalized.externalCustomerId,
      name: customerName,
      company_name: customerName,
      email: customerEmail,
      phone: customerPhone,
      document_type: customer?.documentType ?? normalized.documentType,
      document_last4: customer?.documentLast4 ?? normalized.documentLast4,
      status: customer?.registrationStatus ?? null,
      city: customer?.city ?? null,
      state: customer?.state ?? null,
    },
    order: {
      ...(asRecord(payload.order) ?? {}),
      id: orderNumber,
      number: orderNumber,
      external_id: orderNumber,
      total: orderTotal,
      total_value: orderTotal,
      items: order?.itemText ?? firstText((asRecord(payload.order) ?? {}).items, payload.items),
      product_media_urls: order?.imageUrls ?? [],
    },
    cart: {
      ...payloadCart,
      id: normalized.externalCartId,
      external_id: normalized.externalCartId,
      checkout_id: normalized.externalCheckoutId,
      total: cartTotal,
      total_value: cartTotal,
      url: cartUrl,
      recovery_url: cartUrl,
      items: cartItems,
    },
    seller: {
      ...(asRecord(payload.seller) ?? {}),
      name: sellerName,
      phone: sellerPhone,
      email: sellerEmail,
      slug: sellerSlug,
    },
  };

  const stage = crmStageForEvent(normalized.eventType);
  const priority = priorityForEvent(normalized.eventType);
  const handoffRequired = ["handoff", "waiting_payment", "consultative_sale"].includes(stage);
  const title = customerName || customerPhone || normalized.externalCustomerId || "Lead sem identificação";
  const message = duplicate
    ? `Evento duplicado ignorado: ${normalized.eventType}`
    : `Evento recebido: ${normalized.eventType} para ${title}`;

  if (!duplicate) {
    const [existingCard] = await db
      .select({ id: aiCrmCardsTable.id, stage: aiCrmCardsTable.stage, intent: aiCrmCardsTable.intent })
      .from(aiCrmCardsTable)
      .where(
        and(
          eq(aiCrmCardsTable.clientId, client.id),
          customer?.id
            ? eq(aiCrmCardsTable.customerId, customer.id)
            : eq(aiCrmCardsTable.intent, `webhook:${normalized.externalCustomerId ?? normalized.eventId ?? ecommerceEventId}`),
        ),
      )
      .limit(1);

    if (existingCard) {
      await db
        .update(aiCrmCardsTable)
        .set({
          previousStage: existingCard.stage,
          stage,
          intent: customer?.id ? normalized.eventType : existingCard.intent,
          priority,
          estimatedValue: normalized.value,
          handoffRequired,
          handoffReason: handoffRequired ? "Evento comercial requer validação humana nesta etapa." : null,
          lastInteractionAt: normalized.occurredAt,
          updatedAt: new Date(),
        })
        .where(eq(aiCrmCardsTable.id, existingCard.id));
    } else {
      await db.insert(aiCrmCardsTable).values({
        clientId: client.id,
        customerId: customer?.id ?? null,
        stage,
        intent: customer?.id ? normalized.eventType : `webhook:${normalized.externalCustomerId ?? normalized.eventId ?? ecommerceEventId}`,
        priority,
        estimatedValue: normalized.value,
        handoffRequired,
        handoffReason: handoffRequired ? "Evento comercial requer validação humana nesta etapa." : null,
        lastInteractionAt: normalized.occurredAt,
        nextActionAt: handoffRequired ? new Date() : null,
      });
    }
  }

  const cancelledCartAutomationJobs = !duplicate
    ? await cancelPendingCartRecoveryJobs({
        clientId: client.id,
        eventType: normalized.eventType,
        eventRecordId: ecommerceEventId,
        normalized,
        payload: automationPayload,
      })
    : [];

  const automationJobs = !duplicate
    ? await scheduleAutomationJobsForEvent({
        clientId: client.id,
        eventRecordId: ecommerceEventId,
        eventType: normalized.eventType,
        customerId: customer?.id ?? null,
        customerPhone,
        payload: automationPayload,
      })
    : [];
  const automationProcessing = !duplicate ? await processDueAutomationJobs(10) : { processed: 0, results: [] };

  await db.insert(commercialAutomationLogsTable).values({
    clientId: client.id,
    eventType: normalized.eventType,
    action: duplicate ? "webhook_duplicate" : "webhook_received",
    status: duplicate ? "info" : logStatusForEvent(normalized.eventType),
    message,
    metadata: {
      ecommerceEventId,
      eventId: normalized.eventId,
      externalCustomerId: normalized.externalCustomerId,
      externalOrderId: normalized.externalOrderId,
      stage,
      crmUpdated: !duplicate,
      customerMatched: Boolean(customer),
      tokenValidated: Boolean(configuredToken && requestToken === configuredToken),
      cancelledCartAutomationJobs,
      automationJobs,
      automationProcessing,
    },
  });

  res.status(202).json({
    accepted: true,
    clientId: client.id,
    event: {
      id: normalized.eventId,
      type: normalized.eventType,
      status: duplicate ? "duplicate" : "received",
    },
    persistence: {
      status: "stored",
      eventRecordId: ecommerceEventId,
      customerMatched: Boolean(customer),
      crmUpdated: !duplicate,
      cancelledCartAutomationJobs,
      automationJobs,
      automationProcessing,
    },
  });
});

router.get("/cron/orchestrator/automations", async (req, res): Promise<void> => {
  if (!isCronRequest(req)) {
    res.status(401).json({ error: true, message: "Unauthorized cron request." });
    return;
  }
  const result = await processDueAutomationJobs(50);
  res.json({ ok: true, ...result });
});

router.use(authenticate);

router.post("/orchestrator/clients", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateOrchestratorClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }

  const name = parsed.data.name.trim();
  const generatedEmail = `${slugify(name)}-${Date.now()}@orquestrador.local`;
  const [created] = await db
    .insert(clientsTable)
    .values({
      name,
      email: parsed.data.email?.trim() || generatedEmail,
      apiKey: `updash_${nanoid(32)}`,
      adminId: req.user?.sub ?? null,
      dashboardType: "B2B",
      commercePlatform: "UPZERO",
      upZeroApiKey: parsed.data.upZeroApiKey?.trim() || null,
      metaAdAccountId: parsed.data.metaAdAccountId?.trim() || null,
      isActive: true,
      currency: "BRL",
      locale: "pt-BR",
    })
    .returning({
      id: clientsTable.id,
      name: clientsTable.name,
      isActive: clientsTable.isActive,
      upZeroApiKey: clientsTable.upZeroApiKey,
      createdAt: clientsTable.createdAt,
    });

  await ensureCommercialSetup(created.id, created.upZeroApiKey);
  await db.insert(commercialAutomationLogsTable).values({
    clientId: created.id,
    eventType: "client_created",
    action: "orchestrator_client_created",
    status: "info",
    message: `Marca ${created.name} criada no Orquestrador Comercial.`,
    metadata: {
      webhookUrl: await webhookUrlForClient(created.id),
      defaultAgentsCreated: parsed.data.createDefaultAgents,
    },
  });

  res.status(201).json({
    client: {
      id: created.id,
      name: created.name,
      isActive: created.isActive,
      upZeroConfigured: Boolean(created.upZeroApiKey?.trim()),
      createdAt: created.createdAt,
      webhookUrl: await webhookUrlForClient(created.id),
    },
  });
});

router.get("/orchestrator/overview", requireAdmin, async (req, res): Promise<void> => {
  const { from, to } = dateWindow(req);
  const clients = await getB2BClients();
  const clientIds = clients.map((client) => client.id);

  // Achado 14/08/2026: essa rota fazia ~7 queries POR cliente (incluindo
  // ensureCommercialSetup, que cria linhas padrão se não existirem -- não
  // precisa rodar em toda visualização da lista, só quando o cliente
  // realmente configura algo, e os endpoints que fazem isso já chamam
  // ensureCommercialSetup sozinhos). Trocado por 5 queries em lote no
  // total, independente de quantos clientes existirem. Ver comentário
  // acima de getCommercialOperationStatusBulk.
  const [statusByClient, secretByClient, metricsByClient] = await Promise.all([
    getCommercialOperationStatusBulk(clientIds),
    webhookSecretsBulk(clientIds),
    clientMetricsBulk(clientIds, from, to),
  ]);

  const brands = clients.map((client) => ({
    ...client,
    aiCommercialStatus: statusByClient.get(client.id) ?? "paused",
    webhookUrl: publicWebhookTemplateUrl(client.id, secretByClient.get(client.id) ?? null),
    ...(metricsByClient.get(client.id) ?? clientMetricsDefault()),
  }));
  res.json({
    from,
    to,
    summary: {
      clients: brands.length,
      activeClients: brands.filter((client) => client.isActive).length,
      conversations: brands.reduce((sum, client) => sum + client.conversations, 0),
      openConversations: brands.reduce((sum, client) => sum + client.openConversations, 0),
      registrations: brands.reduce((sum, client) => sum + client.registrations, 0),
      orders: brands.reduce((sum, client) => sum + client.orders, 0),
      revenue: brands.reduce((sum, client) => sum + client.revenue, 0),
    },
    brands,
  });
});

router.get("/orchestrator/clients/:clientId/agents", requireAdmin, async (req, res): Promise<void> => {
  const client = await requireB2BClient(firstParam(req.params.clientId));
  if (!client) {
    res.status(404).json({ error: true, message: "Cliente B2B não encontrado." });
    return;
  }
  const agents = await buildAgentConfigs(client.id);
  res.json({ client: { ...client, aiCommercialStatus: await getCommercialOperationStatus(client.id) }, agents });
});

router.patch("/orchestrator/clients/:clientId/operation", requireAdmin, async (req, res): Promise<void> => {
  const client = await requireB2BClient(firstParam(req.params.clientId));
  if (!client) {
    res.status(404).json({ error: true, message: "Cliente B2B não encontrado." });
    return;
  }
  const parsed = UpdateCommercialOperationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }

  await ensureCommercialSetup(client.id, client.upZeroApiKey);
  const [operation] = await db
    .update(aiCommercialOperationsTable)
    .set({
      status: parsed.data.status,
      updatedAt: new Date(),
    })
    .where(eq(aiCommercialOperationsTable.clientId, client.id))
    .returning({
      id: aiCommercialOperationsTable.id,
      clientId: aiCommercialOperationsTable.clientId,
      status: aiCommercialOperationsTable.status,
    });

  await db.insert(commercialAutomationLogsTable).values({
    clientId: client.id,
    eventType: "commercial_ai.status_updated",
    action: "commercial_ai_status_updated",
    status: "info",
    message: `IA Comercial ${parsed.data.status === "active" ? "ativada" : "desativada"} para ${client.name}.`,
    metadata: { status: parsed.data.status },
  });

  res.json({ operation });
});

router.post("/orchestrator/clients/:clientId/agents", requireAdmin, async (req, res): Promise<void> => {
  const client = await requireB2BClient(firstParam(req.params.clientId));
  if (!client) {
    res.status(404).json({ error: true, message: "Cliente B2B não encontrado." });
    return;
  }
  const parsed = CreateAgentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }
  const operationId = await ensureCommercialSetup(client.id, client.upZeroApiKey);
  const [agent] = await db
    .insert(aiAgentConfigsTable)
    .values({
      clientId: client.id,
      operationId,
      agentType: parsed.data.agentType.trim(),
      name: parsed.data.name.trim(),
      status: "active",
      model: parsed.data.model?.trim() || process.env.AI_INTEGRATIONS_OPENAI_MODEL || "gpt-4.1-mini",
      temperature: parsed.data.temperature ?? 0.2,
      systemPrompt: parsed.data.systemPrompt?.trim() || null,
      autonomyMode: "assisted",
      canAutoReply: parsed.data.canAutoReply,
      canCreateRegistration: parsed.data.canCreateRegistration,
      canCreatePreOrder: parsed.data.canCreatePreOrder,
      canHandoff: parsed.data.canHandoff,
    })
    .returning();

  await db.insert(commercialAutomationLogsTable).values({
    clientId: client.id,
    eventType: "agent_created",
    action: "agent_created",
    status: "info",
    message: `Agente ${agent.name} criado para ${client.name}.`,
    metadata: {
      agentId: agent.id,
      agentType: agent.agentType,
    },
  });

  res.status(201).json({ agent });
});

router.get("/orchestrator/crm", requireAdmin, async (req, res): Promise<void> => {
  const { from, to } = dateWindow(req);
  const clientId = typeof req.query.clientId === "string" ? req.query.clientId : null;
  const client = await requireB2BClient(clientId);
  const cards = client
    ? await buildCrmCards(client.id, from, to)
    : (await Promise.all((await getB2BClients()).map((row) => buildCrmCards(row.id, from, to)))).flat();
  res.json({
    from,
    to,
    stages: CRM_STAGES,
    cards,
    requiresClient: false,
  });
});

router.get("/orchestrator/registrations", requireAdmin, async (req, res): Promise<void> => {
  const { from, to } = dateWindow(req);
  const clientId = typeof req.query.clientId === "string" ? req.query.clientId : null;
  const client = await requireB2BClient(clientId);
  if (!client) {
    res.json({ from, to, data: [], requiresClient: true });
    return;
  }
  const rows = await db
    .select({
      id: customersTable.id,
      externalId: customersTable.externalId,
      name: customersTable.name,
      email: customersTable.email,
      phone: customersTable.phone,
      documentType: customersTable.documentType,
      documentLast4: customersTable.documentLast4,
      registrationStatus: customersTable.registrationStatus,
      createdAt: customersTable.createdAt,
      approvalDate: customersTable.approvalDate,
      totalOrders: customersTable.totalOrders,
    })
    .from(customersTable)
    .where(and(eq(customersTable.clientId, client.id), gte(customersTable.createdAt, from), lte(customersTable.createdAt, to)))
    .orderBy(desc(customersTable.createdAt))
    .limit(100);
  res.json({ from, to, data: rows });
});

router.post("/orchestrator/automations", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateAutomationRuleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }

  const client = await requireB2BClient(parsed.data.clientId);
  if (!client) {
    res.status(404).json({ error: true, message: "Cliente B2B não encontrado." });
    return;
  }

  const operationId = await ensureCommercialSetup(client.id, client.upZeroApiKey);
  const eventType = normalizeAutomationEventType(parsed.data.eventType) ?? parsed.data.eventType;
  const sequence = await nextAutomationRuleSequence(client.id, eventType);
  const eventLabel = automationEventLabel(eventType);
  const [created] = await db
    .insert(commercialAutomationRulesTable)
    .values({
      clientId: client.id,
      operationId,
      eventType,
      name: `${eventLabel} · Etapa ${sequence}`,
      description: `Etapa ${sequence} da régua de ${eventLabel.toLowerCase()}.`,
      isEnabled: parsed.data.isEnabled,
      templateId: parsed.data.templateId || null,
      templateName: parsed.data.templateName || null,
      templateLanguage: parsed.data.templateLanguage || null,
      templateCategory: parsed.data.templateCategory || null,
      delayMinutes: parsed.data.delayMinutes,
      cooldownHours: parsed.data.cooldownHours,
      maxSendsPerCustomerMonth: parsed.data.maxSendsPerCustomerMonth,
      conditions: {
        audience: parsed.data.audience,
        senderStrategy: parsed.data.audience === "internal_seller" ? "default_phone" : "assigned_seller",
        recipientStrategy: parsed.data.audience === "internal_seller" ? "assigned_seller" : "event_customer",
        sendOncePerCart: parsed.data.sendOncePerCart,
      },
    })
    .returning();

  await db.insert(commercialAutomationLogsTable).values({
    clientId: client.id,
    ruleId: created.id,
    eventType,
    action: "automation_rule_created",
    status: "info",
    message: `Nova automação ${created.name} criada com delay de ${created.delayMinutes} minuto(s).`,
    metadata: {
      sequence,
      isEnabled: created.isEnabled,
      templateName: created.templateName,
      delayMinutes: created.delayMinutes,
      cooldownHours: created.cooldownHours,
      maxSendsPerCustomerMonth: created.maxSendsPerCustomerMonth,
      sendOncePerCart: parsed.data.sendOncePerCart,
      audience: parsed.data.audience,
    },
  });

  res.status(201).json({
    rule: {
      ...created,
      audience: getAutomationAudience(created.conditions),
      enabled: created.isEnabled,
      channel: "whatsapp_template",
      approval: "automatic_after_delay",
    },
  });
});

router.get("/orchestrator/automations", requireAdmin, async (req, res): Promise<void> => {
  const clientId = typeof req.query.clientId === "string" ? req.query.clientId : null;
  const client = await requireB2BClient(clientId);
  if (client) {
    await ensureCommercialSetup(client.id, client.upZeroApiKey);
    const rules = await buildAutomationRules(client.id);
    const templates = await buildWhatsappTemplateOptions(client.id);
    const eventOptions = await buildAutomationEventOptions(client.id);
    const defaultSender = await resolveAutomationSender(client.id, undefined, "default_phone");
    const [jobStats] = await db
      .select({
        scheduled: sql<number>`COUNT(*) FILTER (WHERE ${commercialAutomationJobsTable.status} = 'scheduled')::int`,
        sent: sql<number>`COUNT(*) FILTER (WHERE ${commercialAutomationJobsTable.status} = 'sent')::int`,
        failed: sql<number>`COUNT(*) FILTER (WHERE ${commercialAutomationJobsTable.status} = 'failed')::int`,
      })
      .from(commercialAutomationJobsTable)
      .where(eq(commercialAutomationJobsTable.clientId, client.id));
    res.json({
      status: "configured",
      client,
      eventOptions,
      templates,
      defaultSender: defaultSender.phoneNumberId
        ? {
            phoneNumberId: defaultSender.phoneNumberId,
            displayPhoneNumber: defaultSender.displayPhoneNumber,
            verifiedName: defaultSender.verifiedName,
            wabaId: defaultSender.wabaId,
          }
        : null,
      jobStats: jobStats ?? { scheduled: 0, sent: 0, failed: 0 },
      rules: rules.map((rule) => ({
        ...rule,
        channel: "whatsapp_template",
        approval: "automatic_after_delay",
      })),
    });
    return;
  }
  res.json({
    status: "draft",
    rules: AUTOMATION_RULES.map((rule) => ({
      ...rule,
      enabled: false,
      channel: "whatsapp_template",
      approval: "human_required",
    })),
  });
});

router.patch("/orchestrator/automations/:ruleId", requireAdmin, async (req, res): Promise<void> => {
  const parsed = UpdateAutomationRuleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: true, code: "VALIDATION_ERROR", message: parsed.error.message, status: 400 });
    return;
  }

  const ruleId = firstParam(req.params.ruleId);
  if (!ruleId) {
    res.status(400).json({ error: true, message: "ID da regra é obrigatório." });
    return;
  }

  const [rule] = await db
    .select({
      id: commercialAutomationRulesTable.id,
      clientId: commercialAutomationRulesTable.clientId,
      eventType: commercialAutomationRulesTable.eventType,
      conditions: commercialAutomationRulesTable.conditions,
    })
    .from(commercialAutomationRulesTable)
    .where(eq(commercialAutomationRulesTable.id, ruleId))
    .limit(1);

  if (!rule) {
    res.status(404).json({ error: true, message: "Regra de automação não encontrada." });
    return;
  }

  const client = await requireB2BClient(rule.clientId);
  if (!client) {
    res.status(404).json({ error: true, message: "Cliente B2B não encontrado." });
    return;
  }

  const patch = parsed.data;
  const nextEventType = patch.eventType !== undefined
    ? (normalizeAutomationEventType(patch.eventType) ?? patch.eventType)
    : rule.eventType;
  const eventChanged = nextEventType !== rule.eventType;
  const nextSequence = eventChanged
    ? await nextAutomationRuleSequence(client.id, nextEventType)
    : null;
  const [updated] = await db
    .update(commercialAutomationRulesTable)
    .set({
      ...(patch.eventType !== undefined
        ? {
            eventType: nextEventType,
            ...(eventChanged
              ? { name: `${automationEventLabel(nextEventType)} · Etapa ${nextSequence ?? 1}` }
              : {}),
          }
        : {}),
      ...(patch.isEnabled !== undefined ? { isEnabled: patch.isEnabled } : {}),
      ...(patch.templateId !== undefined ? { templateId: patch.templateId || null } : {}),
      ...(patch.templateName !== undefined ? { templateName: patch.templateName || null } : {}),
      ...(patch.templateLanguage !== undefined ? { templateLanguage: patch.templateLanguage || null } : {}),
      ...(patch.templateCategory !== undefined ? { templateCategory: patch.templateCategory || null } : {}),
      ...(patch.delayMinutes !== undefined ? { delayMinutes: patch.delayMinutes } : {}),
      ...(patch.cooldownHours !== undefined ? { cooldownHours: patch.cooldownHours } : {}),
      ...(patch.maxSendsPerCustomerMonth !== undefined
        ? { maxSendsPerCustomerMonth: patch.maxSendsPerCustomerMonth }
        : {}),
      ...(patch.sendOncePerCart !== undefined || patch.audience !== undefined
        ? {
            conditions: {
              ...(rule.conditions && typeof rule.conditions === "object"
                ? rule.conditions as Record<string, unknown>
                : {}),
              ...(patch.sendOncePerCart !== undefined
                ? { sendOncePerCart: patch.sendOncePerCart }
                : {}),
              ...(patch.audience !== undefined
                ? {
                    audience: patch.audience,
                    senderStrategy: patch.audience === "internal_seller" ? "default_phone" : "assigned_seller",
                    recipientStrategy: patch.audience === "internal_seller" ? "assigned_seller" : "event_customer",
                  }
                : {}),
            },
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(commercialAutomationRulesTable.id, rule.id))
    .returning();

  await db.insert(commercialAutomationLogsTable).values({
    clientId: client.id,
    ruleId: rule.id,
    eventType: updated.eventType,
    action: "automation_rule_updated",
    status: "info",
    message: `Regra ${updated.name} atualizada.`,
    metadata: {
      isEnabled: updated.isEnabled,
      templateName: updated.templateName,
      delayMinutes: updated.delayMinutes,
      cooldownHours: updated.cooldownHours,
      maxSendsPerCustomerMonth: updated.maxSendsPerCustomerMonth,
      sendOncePerCart: updated.conditions && typeof updated.conditions === "object"
        ? (updated.conditions as Record<string, unknown>).sendOncePerCart !== false
        : true,
      audience: getAutomationAudience(updated.conditions),
    },
  });

  res.json({
    rule: {
      ...updated,
      audience: getAutomationAudience(updated.conditions),
    },
  });
});

router.post("/orchestrator/automations/process-due", requireAdmin, async (_req, res): Promise<void> => {
  const result = await processDueAutomationJobs(25);
  res.json({ ok: true, ...result });
});

router.get("/orchestrator/clients/:clientId/:section", requireAdmin, async (req, res): Promise<void> => {
  const { from, to } = dateWindow(req);
  const client = await requireB2BClient(firstParam(req.params.clientId));
  if (!client) {
    res.status(404).json({ error: true, message: "Cliente B2B não encontrado." });
    return;
  }
  await ensureCommercialSetup(client.id, client.upZeroApiKey);
  const section = req.params.section;
  if (section === "logs") {
    const logs = await buildCommercialLogs(client.id);
    res.json({
      client: { ...client, aiCommercialStatus: await getCommercialOperationStatus(client.id) },
      webhookUrl: await webhookUrlForClient(client.id),
      logs,
    });
    return;
  }
  if (section === "resumo") {
    res.json({
      client: { ...client, aiCommercialStatus: await getCommercialOperationStatus(client.id) },
      webhookUrl: await webhookUrlForClient(client.id),
      ...(await buildOperationPayload(client.id, from, to)),
    });
    return;
  }
  if (section === "simulador") {
    res.json({
      client: { ...client, aiCommercialStatus: await getCommercialOperationStatus(client.id) },
      samplePrompts: [
        "Cliente pediu valor de um produto sem cadastro aprovado",
        "Cliente abandonou carrinho e pediu frete",
        "Cliente enviou CNPJ e quer comprar atacado",
      ],
    });
    return;
  }
  if (section === "insights" || section === "qualidade") {
    const operation = await buildOperationPayload(client.id, from, to);
    res.json({
      client: { ...client, aiCommercialStatus: await getCommercialOperationStatus(client.id) },
      section,
      insights: [
        {
          title: "Atendimento em modo seguro",
          description: "A IA ainda não responde automaticamente; as regras estão preparadas para validação humana.",
          impact: "Baixo risco operacional",
        },
      ],
      ...operation,
    });
    return;
  }
  if (section === "agentes" || section === "regras" || section === "operacao" || section === "automacoes") {
    res.json({
      client: { ...client, aiCommercialStatus: await getCommercialOperationStatus(client.id) },
      section,
      webhookUrl: await webhookUrlForClient(client.id),
      ...(await buildOperationPayload(client.id, from, to)),
    });
    return;
  }
  res.status(404).json({ error: true, message: "Seção não encontrada." });
});

router.post("/orchestrator/clients/:clientId/simulator", requireAdmin, async (req, res): Promise<void> => {
  const client = await requireB2BClient(firstParam(req.params.clientId));
  if (!client) {
    res.status(404).json({ error: true, message: "Cliente B2B não encontrado." });
    return;
  }
  const message = typeof req.body?.message === "string" ? req.body.message : "";
  res.json({
    clientId: client.id,
    mode: "simulation",
    input: message,
    decision: "human_review_required",
    draftResponse:
      "Posso te ajudar com produtos, cadastro e pedido. Para valores e fechamento, preciso confirmar seu cadastro e disponibilidade de estoque.",
    guardrails: [
      "Não revelar preço sem cadastro aprovado.",
      "Não criar pedido real em simulação.",
      "Não enviar mensagem automática sem aprovação humana.",
    ],
  });
});

router.get("/sales-agent/dashboard", async (req, res): Promise<void> => {
  const client = await requireB2BClient(resolveClientId(req));
  if (!client) {
    res.status(403).json({ error: true, message: "Agente de vendas disponível apenas para clientes B2B." });
    return;
  }
  const { from, to } = dateWindow(req);
  res.json({
    client,
    ...(await buildOperationPayload(client.id, from, to)),
  });
});

router.get("/sales-agent/context", async (req, res): Promise<void> => {
  const client = await requireB2BClient(resolveClientId(req));
  if (!client) {
    res.status(403).json({ error: true, message: "Cliente B2B não encontrado." });
    return;
  }
  if (!client.upZeroApiKey) {
    res.json({
      client,
      upzeroConfigured: false,
      products: [],
      categories: [],
      inventory: [],
      warning: "UP Zero API key não configurada para este cliente.",
    });
    return;
  }
  const adapter = new UpzeroExternalAdapter({ apiKey: client.upZeroApiKey });
  const [products, categories, inventory] = await Promise.allSettled([
    adapter.listProducts({ limit: 20 }),
    adapter.listCategories({ limit: 20 }),
    adapter.listInventoryAvailability({ limit: 20 }),
  ]);
  res.json({
    client,
    upzeroConfigured: true,
    products: products.status === "fulfilled" ? extractRows(products.value).slice(0, 20) : [],
    categories: categories.status === "fulfilled" ? extractRows(categories.value).slice(0, 20) : [],
    inventory: inventory.status === "fulfilled" ? extractRows(inventory.value).slice(0, 20) : [],
    errors: [products, categories, inventory]
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason)),
  });
});

router.post("/sales-agent/simulate", async (req, res): Promise<void> => {
  const client = await requireB2BClient(resolveClientId(req));
  if (!client) {
    res.status(403).json({ error: true, message: "Cliente B2B não encontrado." });
    return;
  }
  const message = typeof req.body?.message === "string" ? req.body.message : "";
  res.json({
    mode: "assisted_simulation",
    clientId: client.id,
    input: message,
    answer:
      "A IA comercial está pronta para rascunhar respostas, mas envio automático e criação de pedido real seguem bloqueados até a revisão das regras.",
  });
});

export default router;
