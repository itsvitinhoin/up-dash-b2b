// Bloco "Aquisição" (UP Glass, 08/10/2026): todos os pedidos pagos do período feitos por clientes que ainda não
// tinham compra positiva anterior. Os blocos de recompra descartam esses clientes ("sem compra anterior: não é
// recompra"), então Aquisição + Recompra = todos os pedidos do mesmo universo e dos mesmos filtros.
// Módulo puro (sem banco) para poder ser testado sozinho.
export type RecompraBlockTotals = { faturamento: number; vendas: number; clientes: number; ticketMedio: number | null };

export function buildAcquisitionBlock(eventsByNewCustomer: Array<Array<{ paidValue: number }>>): RecompraBlockTotals {
  let faturamento = 0;
  let vendas = 0;
  for (const events of eventsByNewCustomer) {
    for (const e of events) {
      faturamento += e.paidValue;
      vendas += 1;
    }
  }
  return { faturamento, vendas, clientes: eventsByNewCustomer.length, ticketMedio: vendas > 0 ? faturamento / vendas : null };
}
