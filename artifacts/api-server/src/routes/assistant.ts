import { Router, type IRouter } from "express";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import {
  clientsTable,
  customersTable,
  db,
  orderItemsTable,
  ordersTable,
  productsTable,
} from "@workspace/db";
import { authenticate, resolveClientId } from "../middlewares/auth";
import { getOpenAIClient, isAIConfigured } from "../lib/openai";

const router: IRouter = Router();

router.use("/assistant", authenticate);

const AssistantChatBody = z.object({
  message: z.string().trim().min(1).max(2000),
});

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(dateOnly: string, days: number): string {
  const [year, month, day] = dateOnly.split("-").map((part) => Number.parseInt(part, 10));
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function saoPauloToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function startOfSaoPauloDay(dateOnly: string): Date {
  return new Date(`${dateOnly}T03:00:00.000Z`);
}

function endOfSaoPauloDay(dateOnly: string): Date {
  return new Date(`${addDays(dateOnly, 1)}T02:59:59.999Z`);
}

function monthRange(year: number, monthIndex: number): { from: Date; to: Date; label: string } {
  const first = `${year}-${String(monthIndex + 1).padStart(2, "0")}-01`;
  const next = monthIndex === 11
    ? `${year + 1}-01-01`
    : `${year}-${String(monthIndex + 2).padStart(2, "0")}-01`;
  return {
    from: startOfSaoPauloDay(first),
    to: new Date(startOfSaoPauloDay(next).getTime() - 1),
    label: `${first} a ${addDays(next, -1)}`,
  };
}

function parseDateToken(day: string, month: string, year?: string): string {
  const currentYear = Number.parseInt(saoPauloToday().slice(0, 4), 10);
  const parsedYear = year
    ? Number.parseInt(year.length === 2 ? `20${year}` : year, 10)
    : currentYear;
  return `${parsedYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function resolvePeriod(message: string): { from: Date; to: Date; label: string } {
  const text = message.toLowerCase();
  const today = saoPauloToday();

  if (text.includes("ontem")) {
    const yesterday = addDays(today, -1);
    return { from: startOfSaoPauloDay(yesterday), to: endOfSaoPauloDay(yesterday), label: yesterday };
  }

  if (text.includes("hoje")) {
    return { from: startOfSaoPauloDay(today), to: endOfSaoPauloDay(today), label: today };
  }

  const lastDays = text.match(/(?:últimos|ultimos|últimas|ultimas)\s+(\d{1,3})\s+dias?/);
  if (lastDays) {
    const days = Math.max(1, Number.parseInt(lastDays[1] ?? "30", 10));
    const fromDay = addDays(today, -(days - 1));
    return {
      from: startOfSaoPauloDay(fromDay),
      to: endOfSaoPauloDay(today),
      label: `últimos ${days} dias`,
    };
  }

  if (text.includes("mês passado") || text.includes("mes passado")) {
    const [year, month] = today.split("-").map((part) => Number.parseInt(part, 10));
    const monthIndex = month === 1 ? 11 : month - 2;
    const resolvedYear = month === 1 ? year - 1 : year;
    return monthRange(resolvedYear, monthIndex);
  }

  if (text.includes("este mês") || text.includes("esse mês") || text.includes("mes atual") || text.includes("mês atual")) {
    const [year, month] = today.split("-").map((part) => Number.parseInt(part, 10));
    return monthRange(year, month - 1);
  }

  const explicitDates = [...text.matchAll(/(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?/g)]
    .map((match) => parseDateToken(match[1] ?? "1", match[2] ?? "1", match[3]));
  if (explicitDates.length >= 2 && explicitDates.every((date) => DATE_ONLY_RE.test(date))) {
    const [a, b] = explicitDates;
    const fromDay = a <= b ? a : b;
    const toDay = a <= b ? b : a;
    return { from: startOfSaoPauloDay(fromDay), to: endOfSaoPauloDay(toDay), label: `${fromDay} a ${toDay}` };
  }
  if (explicitDates.length === 1 && DATE_ONLY_RE.test(explicitDates[0] ?? "")) {
    const day = explicitDates[0]!;
    return { from: startOfSaoPauloDay(day), to: endOfSaoPauloDay(day), label: day };
  }

  const fromDay = addDays(today, -29);
  return {
    from: startOfSaoPauloDay(fromDay),
    to: endOfSaoPauloDay(today),
    label: "últimos 30 dias",
  };
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function compactJson(value: unknown): string {
  return JSON.stringify(value, null, 2).slice(0, 12000);
}

function requireClient(req: import("express").Request, res: import("express").Response): string | null {
  const clientId = resolveClientId(req);
  if (!clientId) {
    res.status(400).json({
      error: true,
      code: "CLIENT_REQUIRED",
      message: "Selecione uma marca antes de perguntar ao assistente.",
      status: 400,
    });
    return null;
  }
  return clientId;
}

router.post("/assistant/chat", async (req, res): Promise<void> => {
  const parsed = AssistantChatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: parsed.error.message,
      status: 400,
    });
    return;
  }

  const clientId = requireClient(req, res);
  if (!clientId) return;

  const question = parsed.data.message;
  const normalized = question.toLowerCase();
  const period = resolvePeriod(question);

  const orderConditions = [
    eq(ordersTable.clientId, clientId),
    gte(ordersTable.createdAt, period.from),
    lte(ordersTable.createdAt, period.to),
    sql`${ordersTable.status} != 'REJECTED'`,
  ];

  const [client] = await db
    .select({ name: clientsTable.name })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId))
    .limit(1);

  const [summary] = await db
    .select({
      orders: sql<number>`COUNT(*)::int`,
      requestedRevenue: sql<number>`COALESCE(SUM(${ordersTable.amount}), 0)::float`,
      fulfilledRevenue: sql<number>`COALESCE(SUM(${ordersTable.fulfilledAmount}), 0)::float`,
      requestedQuantity: sql<number>`COALESCE(SUM(${ordersTable.requestedQuantity}), 0)::int`,
      fulfilledQuantity: sql<number>`COALESCE(SUM(${ordersTable.fulfilledQuantity}), 0)::int`,
      approvedOrders: sql<number>`COUNT(*) FILTER (WHERE ${ordersTable.status} IN ('APPROVED','SHIPPED','DELIVERED'))::int`,
    })
    .from(ordersTable)
    .where(and(...orderConditions));

  const [customerSummary] = await db
    .select({
      registrations: sql<number>`COUNT(*)::int`,
      approved: sql<number>`COUNT(*) FILTER (WHERE ${customersTable.registrationStatus} = 'APPROVED')::int`,
      pending: sql<number>`COUNT(*) FILTER (WHERE ${customersTable.registrationStatus} = 'PENDING')::int`,
      rejected: sql<number>`COUNT(*) FILTER (WHERE ${customersTable.registrationStatus} = 'REJECTED')::int`,
    })
    .from(customersTable)
    .where(and(
      eq(customersTable.clientId, clientId),
      gte(customersTable.createdAt, period.from),
      lte(customersTable.createdAt, period.to),
    ));

  const productRows = await db
    .select({
      name: productsTable.name,
      sku: productsTable.sku,
      quantity: sql<number>`COALESCE(SUM(${orderItemsTable.quantity}), 0)::int`,
      revenue: sql<number>`COALESCE(SUM(${orderItemsTable.priceAtSale} * ${orderItemsTable.quantity}), 0)::float`,
    })
    .from(orderItemsTable)
    .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
    .innerJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
    .where(and(...orderConditions))
    .groupBy(productsTable.id, productsTable.name, productsTable.sku)
    .orderBy(desc(sql`SUM(${orderItemsTable.quantity})`))
    .limit(5);

  const statusRows = await db
    .select({
      status: ordersTable.status,
      orders: sql<number>`COUNT(*)::int`,
      revenue: sql<number>`COALESCE(SUM(${ordersTable.amount}), 0)::float`,
    })
    .from(ordersTable)
    .where(and(...orderConditions))
    .groupBy(ordersTable.status);

  const topCustomerRows = await db
    .select({
      name: customersTable.name,
      email: customersTable.email,
      orders: sql<number>`COUNT(${ordersTable.id})::int`,
      revenue: sql<number>`COALESCE(SUM(${ordersTable.amount}), 0)::float`,
    })
    .from(ordersTable)
    .innerJoin(customersTable, eq(ordersTable.customerId, customersTable.id))
    .where(and(...orderConditions))
    .groupBy(customersTable.id, customersTable.name, customersTable.email)
    .orderBy(desc(sql`SUM(${ordersTable.amount})`))
    .limit(5);

  const utmRows = await db
    .select({
      source: sql<string>`COALESCE(NULLIF(lower(${customersTable.utmSource}), ''), 'direct')`,
      medium: sql<string>`COALESCE(NULLIF(lower(${customersTable.utmMedium}), ''), 'none')`,
      campaign: sql<string>`COALESCE(NULLIF(${customersTable.utmCampaign}, ''), 'sem campanha')`,
      registrations: sql<number>`COUNT(*)::int`,
      approved: sql<number>`COUNT(*) FILTER (WHERE ${customersTable.registrationStatus} = 'APPROVED')::int`,
    })
    .from(customersTable)
    .where(and(
      eq(customersTable.clientId, clientId),
      gte(customersTable.createdAt, period.from),
      lte(customersTable.createdAt, period.to),
    ))
    .groupBy(sql`1`, sql`2`, sql`3`)
    .orderBy(desc(sql`COUNT(*)`))
    .limit(8);

  const context = {
    brand: client?.name ?? "Loja selecionada",
    period: {
      label: period.label,
      from: period.from.toISOString(),
      to: period.to.toISOString(),
    },
    summary: {
      orders: Number(summary?.orders ?? 0),
      requestedRevenue: Number(summary?.requestedRevenue ?? 0),
      fulfilledRevenue: Number(summary?.fulfilledRevenue ?? 0),
      requestedQuantity: Number(summary?.requestedQuantity ?? 0),
      fulfilledQuantity: Number(summary?.fulfilledQuantity ?? 0),
      approvedOrders: Number(summary?.approvedOrders ?? 0),
    },
    customers: {
      registrations: Number(customerSummary?.registrations ?? 0),
      approved: Number(customerSummary?.approved ?? 0),
      pending: Number(customerSummary?.pending ?? 0),
      rejected: Number(customerSummary?.rejected ?? 0),
    },
    ordersByStatus: statusRows.map((row) => ({
      status: row.status,
      orders: Number(row.orders ?? 0),
      revenue: Number(row.revenue ?? 0),
    })),
    topProducts: productRows.map((row) => ({
      name: row.name,
      sku: row.sku,
      quantity: Number(row.quantity ?? 0),
      revenue: Number(row.revenue ?? 0),
    })),
    topCustomers: topCustomerRows.map((row) => ({
      name: row.name,
      email: row.email ? row.email.replace(/(^.).*(@.*$)/, "$1***$2") : null,
      orders: Number(row.orders ?? 0),
      revenue: Number(row.revenue ?? 0),
    })),
    utmRegistrations: utmRows.map((row) => ({
      source: row.source,
      medium: row.medium,
      campaign: row.campaign,
      registrations: Number(row.registrations ?? 0),
      approved: Number(row.approved ?? 0),
    })),
  };

  const ai = getOpenAIClient();
  if (ai && isAIConfigured()) {
    try {
      const completion = await ai.chat.completions.create({
        model: process.env.AI_INTEGRATIONS_OPENAI_MODEL ?? "gpt-4o-mini",
        temperature: 0.35,
        messages: [
          {
            role: "system",
            content:
              "Voce e o assistente estrategico do UP Dash. Responda sempre em portugues do Brasil, usando somente os dados fornecidos no contexto. Seja objetivo, consultivo e pratico. Se os dados nao forem suficientes para concluir algo, diga isso claramente e recomende o proximo dado necessario. Nunca invente numeros.",
          },
          {
            role: "user",
            content: [
              `Pergunta do usuario: ${question}`,
              "",
              "Contexto real do e-commerce em JSON:",
              compactJson(context),
              "",
              "Entregue uma resposta com leitura dos numeros, possiveis causas e proximas acoes prioritarias.",
            ].join("\n"),
          },
        ],
      });
      const answer = completion.choices[0]?.message?.content?.trim();
      if (answer) {
        res.json({
          answer,
          period: context.period,
          data: context,
        });
        return;
      }
    } catch (error) {
      console.warn("[assistant] OpenAI completion failed; using deterministic fallback:", error);
    }
  }

  const asksProducts = /produto|sku|item|mais vendido|vendidos/.test(normalized);
  const asksCustomers = /cadastro|lead|cliente|aprovad|pendente|recusad/.test(normalized);
  const asksRevenue = /faturamento|receita|venda|valor|pedido/.test(normalized);

  const lines: string[] = [];
  const brand = client?.name ? ` da ${client.name}` : "";
  lines.push(`Analisei os dados${brand} no período ${period.label}.`);

  if (asksRevenue || (!asksProducts && !asksCustomers)) {
    lines.push(
      `O valor solicitado foi ${formatCurrency(Number(summary?.requestedRevenue ?? 0))}, em ${formatNumber(Number(summary?.orders ?? 0))} pedido(s).`,
    );
    lines.push(
      `Quantidade solicitada: ${formatNumber(Number(summary?.requestedQuantity ?? 0))} item(ns). Pedidos aprovados/enviados/entregues: ${formatNumber(Number(summary?.approvedOrders ?? 0))}.`,
    );
  }

  if (asksCustomers || (!asksProducts && !asksRevenue)) {
    lines.push(
      `Cadastros: ${formatNumber(Number(customerSummary?.registrations ?? 0))} no total, ${formatNumber(Number(customerSummary?.approved ?? 0))} aprovados, ${formatNumber(Number(customerSummary?.pending ?? 0))} pendentes e ${formatNumber(Number(customerSummary?.rejected ?? 0))} recusados.`,
    );
  }

  if (asksProducts || (!asksCustomers && !asksRevenue)) {
    if (productRows.length === 0) {
      lines.push("Nao encontrei produtos vendidos nesse período.");
    } else {
      lines.push("Produtos mais vendidos por quantidade solicitada:");
      productRows.forEach((row, index) => {
        lines.push(
          `${index + 1}. ${row.name} (${row.sku}) - ${formatNumber(Number(row.quantity))} item(ns), ${formatCurrency(Number(row.revenue))}.`,
        );
      });
    }
  }

  res.json({
    answer: lines.join("\n"),
    period: {
      label: period.label,
      from: period.from.toISOString(),
      to: period.to.toISOString(),
    },
    data: {
      orders: Number(summary?.orders ?? 0),
      requestedRevenue: Number(summary?.requestedRevenue ?? 0),
      requestedQuantity: Number(summary?.requestedQuantity ?? 0),
      registrations: Number(customerSummary?.registrations ?? 0),
      approvedRegistrations: Number(customerSummary?.approved ?? 0),
      topProducts: productRows,
    },
  });
});

export default router;
