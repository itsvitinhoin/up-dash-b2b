// Bloco "Aquisição" (UP Glass, 08/10/2026): todos os pedidos pagos do período feitos por clientes que ainda não
// tinham compra positiva anterior. Os blocos de recompra descartam esses clientes ("sem compra anterior: não é
// recompra"), então Aquisição + Recompra = todos os pedidos do mesmo universo e dos mesmos filtros.
// Módulo puro (sem banco) para poder ser testado sozinho.
// `faturamento` = valor pago/atendido (regra da tela de Recompra); `faturamentoBruto` = valor do pedido aprovado (é o que o
// Faturamento total do Dashboard soma). Os cartões do Dashboard usam o bruto para Aquisição + Retenção fecharem com o topo.
export type RecompraBlockTotals = { faturamento: number; faturamentoBruto: number; vendas: number; clientes: number; ticketMedio: number | null };

export function buildAcquisitionBlock(eventsByNewCustomer: Array<Array<{ paidValue: number; grossValue: number }>>): RecompraBlockTotals {
  let faturamento = 0;
  let faturamentoBruto = 0;
  let vendas = 0;
  for (const events of eventsByNewCustomer) {
    for (const e of events) {
      faturamento += e.paidValue;
      faturamentoBruto += e.grossValue;
      vendas += 1;
    }
  }
  return { faturamento, faturamentoBruto, vendas, clientes: eventsByNewCustomer.length, ticketMedio: vendas > 0 ? faturamento / vendas : null };
}
