import {
  BlingError,
  blingId,
  number,
  object,
  record,
  text,
  type BlingRecord,
} from "./bling-api";

export function normalizeBling(
  kind: "channels" | "products" | "customers" | "orders",
  value: BlingRecord,
): BlingRecord {
  const id = blingId(value.id);
  if (kind === "channels")
    return {
      id,
      name: text(value.descricao) || `Canal ${id}`,
      type: text(value.tipo),
      status: text(value.situacao),
    };
  if (kind === "customers")
    return { id, name: text(value.nome), status: text(value.situacao) };
  if (kind === "products")
    return {
      id,
      name: text(value.nome),
      sku: text(value.codigo),
      price: number(value.preco),
      parentId: value.idProdutoPai ? blingId(value.idProdutoPai) : null,
      format: text(value.formato),
      type: text(value.tipo),
      status: text(value.situacao),
    };
  const day = text(value.data);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(Date.parse(`${day}T00:00:00Z`)) ||
    new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day
  )
    throw new BlingError("Pedido Bling com data inválida.");
  if (!Array.isArray(value.itens))
    throw new BlingError("Pedido Bling sem itens detalhados.");
  const channel = object(value.loja),
    customer = object(value.contato),
    status = object(value.situacao);
  return {
    id,
    number: text(value.numero),
    storeNumber: text(value.numeroLoja),
    day,
    channelId: channel.id ? blingId(channel.id) : "unassigned",
    customerId: customer.id ? blingId(customer.id) : null,
    customerName: text(customer.nome),
    statusId: text(status.id),
    statusValue: text(status.valor),
    total: number(value.total),
    productsTotal: number(value.totalProdutos),
    invoiceId: text(object(value.notaFiscal).id),
    items: value.itens.map((item) => {
      const row = record(item);
      return {
        id: blingId(row.id),
        productId: text(object(row.produto).id),
        sku: text(row.codigo),
        name: text(row.descricao),
        quantity: number(row.quantidade),
        unitPrice: number(row.valor),
      };
    }),
  };
}

export function normalizeBlingStock(value: BlingRecord) {
  if (!Array.isArray(value.depositos))
    throw new BlingError("Saldo Bling sem depósitos.");
  return {
    physical: number(value.saldoFisicoTotal),
    available: number(value.saldoVirtualTotal),
    warehouses: value.depositos.map((row) => {
      const depot = record(row);
      return {
        id: blingId(depot.id),
        physical: number(depot.saldoFisico),
        available: number(depot.saldoVirtual),
      };
    }),
  };
}

export function blingDateTime(date: Date) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(date);
}
