import { createHash } from "node:crypto";
import {
  BraavoError,
  braavoId,
  braavoRecord,
  type BraavoRecord,
} from "./braavo-api";

export const textValue = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
export function money(value: unknown, required = false): number {
  if (value === null || value === undefined || value === "") {
    if (required)
      throw new BraavoError("Valor financeiro obrigatório ausente na Braavo.");
    return 0;
  }
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value)
        ? Number(value)
        : NaN;
  if (!Number.isFinite(number) || number < 0)
    throw new BraavoError("Valor financeiro inválido na Braavo.");
  return Math.round((number + Number.EPSILON) * 100) / 100;
}
export function quantity(value: unknown): number {
  const number =
    value === null || value === "" || value === undefined ? NaN : Number(value);
  if (!Number.isSafeInteger(number) || number < 0)
    throw new BraavoError("Quantidade ausente ou inválida na Braavo.");
  return number;
}
export function braavoDate(value: unknown, required = true): Date | null {
  if (
    (value === null ||
      value === undefined ||
      value === "" ||
      value === "0000-00-00 00:00:00") &&
    !required
  )
    return null;
  const raw = textValue(value);
  if (!raw) throw new BraavoError("Data obrigatória ausente na Braavo.");
  const match = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/,
  );
  if (!match) throw new BraavoError("Formato de data Braavo inválido.");
  const [, y, m, d, h, min, sec, offset] = match;
  const calendar = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (
    calendar.getUTCFullYear() !== Number(y) ||
    calendar.getUTCMonth() !== Number(m) - 1 ||
    calendar.getUTCDate() !== Number(d) ||
    Number(h) > 23 ||
    Number(min) > 59 ||
    Number(sec) > 59
  )
    throw new BraavoError("Data Braavo fora do calendário.");
  const date = new Date(
    `${y}-${m}-${d}T${h}:${min}:${sec}${offset ?? "-03:00"}`,
  );
  if (!Number.isFinite(date.getTime()))
    throw new BraavoError("Data Braavo inválida.");
  return date;
}
export function braavoDay(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export function nextDay(day: string, offset = 1): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
export function braavoProductGroup(external: string): string {
  const parts = external.split(":");
  return parts[0] === "braavo" ? parts.slice(0, 2).join(":") : parts[0];
}

export function normalizeBraavoCustomer(
  row: BraavoRecord,
  fallbackCreatedAt?: Date,
) {
  const externalId = `braavo:${braavoId(row.id)}`;
  const document =
    (String(row.pessoa) === "2"
      ? textValue(row.cnpj)
      : textValue(row.cpf)
    )?.replace(/\D/g, "") || null;
  const addresses = Array.isArray(row.enderecos)
    ? row.enderecos.map(braavoRecord)
    : [];
  const address =
    addresses.find((item) => String(item.ativo) === "1") ?? addresses[0];
  const tel = textValue(row.tel_1) ?? textValue(row.tel_2);
  const country =
    textValue(row.tel_1 ? row.tel_1_pais : row.tel_2_pais) ?? "55";
  const digits = tel?.replace(/\D/g, "");
  return {
    externalId,
    name: textValue(row.nome),
    state: textValue(address?.estado)?.toUpperCase() ?? null,
    city: textValue(address?.cidade),
    email:
      textValue(row.email)?.toLowerCase() ??
      `braavo-${braavoId(row.id)}@unknown.local`,
    phone: digits
      ? `+${digits.startsWith(country) && digits.length > 11 ? digits : country + digits}`
      : null,
    documentType: document
      ? String(row.pessoa) === "2"
        ? ("CNPJ" as const)
        : ("CPF" as const)
      : null,
    documentHash: document
      ? createHash("sha256").update(document).digest("hex")
      : null,
    documentLast4: document?.slice(-4) ?? null,
    // B2C registration is not an approval of a wholesale account.
    registrationStatus: "PENDING" as const,
    createdAt: row.data_criado
      ? braavoDate(row.data_criado)!
      : (fallbackCreatedAt ?? braavoDate(null)!),
  };
}

export function normalizeBraavoOrder(row: BraavoRecord) {
  const id = braavoId(row.id);
  const payment = String(row.status_pagamento),
    delivery = String(row.status_entrega ?? "0");
  if (!["0", "1", "2", "3", "6"].includes(payment))
    throw new BraavoError(
      "Status de pagamento Braavo desconhecido; pedido não importado.",
    );
  const cancelled = payment === "6" || ["41", "42", "43"].includes(delivery);
  const paid = payment === "3" && !cancelled;
  const status = cancelled
    ? "REJECTED"
    : !paid
      ? "PENDING"
      : ["22", "23", "40"].includes(delivery)
        ? "DELIVERED"
        : ["20", "21", "24", "25", "26", "27", "28", "29"].includes(delivery)
          ? "SHIPPED"
          : "APPROVED";
  const shippingAmount = money(row.frete_valor);
  const discountAmount = money(row.desconto_valor);
  const total =
    row.pedido_geral !== undefined &&
    row.pedido_geral !== null &&
    row.pedido_geral !== ""
      ? money(row.pedido_geral, true)
      : money(row.pedido_total, true) + shippingAmount;
  const reportedCancellation = money(row.pedido_cancelado);
  if (reportedCancellation > total)
    throw new BraavoError(
      "Valor cancelado maior que o total do pedido Braavo.",
    );
  const cancelledAmount = cancelled ? total : reportedCancellation;
  const net = money(Math.max(0, total - cancelledAmount));
  if (!Array.isArray(row.produtos))
    throw new BraavoError("Pedido Braavo sem detalhamento dos itens.");
  const items = row.produtos.map((value) => {
    const item = braavoRecord(value);
    const productId = braavoId(item.produto_id),
      skuId = braavoId(item.sku_id);
    const q = quantity(item.quantidade);
    if (q <= 0) throw new BraavoError("Item Braavo com quantidade inválida.");
    const gross = money(item.preco_venda ?? item.preco, true);
    const itemTotal =
      item.calculado_preco_total !== undefined &&
      item.calculado_preco_total !== null &&
      item.calculado_preco_total !== ""
        ? money(item.calculado_preco_total, true)
        : money(item.total, true) - money(item.desconto_vale_total);
    if (itemTotal < 0)
      throw new BraavoError("Total líquido de item Braavo inválido.");
    return {
      externalId: `braavo:${productId}:${skuId}`,
      sku: textValue(item.sku) ?? `braavo-${skuId}`,
      name: textValue(item.nome) ?? `Produto ${productId}`,
      quantity: q,
      fulfilledQuantity: paid && String(item.cancelado ?? "0") !== "1" ? q : 0,
      priceAtSale: itemTotal / q,
      grossPriceAtSale: gross,
      discountAmount: money(Math.max(0, gross * q - itemTotal)),
      variation1: item.var1_id,
      variation2: item.var2_id,
    };
  });
  const createdAt = braavoDate(row.data_criado)!;
  const approvalDate = braavoDate(row.data_aprovado, false);
  if (paid && !approvalDate)
    throw new BraavoError("Pedido aprovado Braavo sem data de aprovação.");
  return {
    externalId: `braavo:${id}`,
    createdAt,
    approvalDate,
    status: status as
      | "PENDING"
      | "APPROVED"
      | "REJECTED"
      | "SHIPPED"
      | "DELIVERED",
    amount: net,
    fulfilledAmount: paid ? net : 0,
    grossAmount: money(
      items.reduce((sum, i) => sum + i.grossPriceAtSale * i.quantity, 0),
    ),
    shippingAmount,
    discountAmount,
    cancelledAmount,
    // The API does not establish the value actually refunded by delivery status.
    refundedAmount: 0,
    refundStatusUnverified: "A API Braavo não confirma o valor efetivamente estornado.",
    requestedQuantity: items.reduce((sum, i) => sum + i.quantity, 0),
    fulfilledQuantity: items.reduce((sum, i) => sum + i.fulfilledQuantity, 0),
    state: textValue(row.entrega_estado)?.toUpperCase() ?? null,
    city: textValue(row.entrega_cidade),
    utmSource: textValue(row.utm_source),
    utmMedium: textValue(row.utm_medium),
    utmCampaign: textValue(row.utm_campaign),
    utmContent: textValue(row.utm_content),
    utmTerm: textValue(row.utm_term),
    sourceMetadata: {
      source: "braavo",
      status_pagamento: payment,
      status_entrega: delivery,
      pedido_total: row.pedido_total,
      pedido_geral: row.pedido_geral,
      pedido_cancelado: row.pedido_cancelado,
      pagamento_valor: row.pagamento_valor,
      primeira_compra_status: row.primeira_compra_status,
      primeira_compra_data: row.primeira_compra_data,
      data_alterado: row.data_alterado,
    },
    items,
    paid,
  };
}
