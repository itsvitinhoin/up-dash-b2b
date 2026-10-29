import { vestiTable } from "../lib/bigquery";

// Vendas da Vesti com o valor do pedido já DESCONTADO (coluna "Total" da tela de pedidos da Vesti = `summary.total_value` em `pedidos_vesti`).
// Decisão do time (29/10/2026): "pago" na Vesti é a coluna Total + status pago, não a coluna "Valor atendido", porque o ERP já traz o valor com desconto.
//
// Devolve a MESMA forma de `dashboard_vendas_view` (uma linha por item, valor só na primeira linha do pedido), mas com `valor_reservado` = Total.
// Assim todas as consultas de receita seguem iguais e trocam de valor num único ponto. O valor antigo (antes do desconto) continua em `valor_atendido`.
// - Pedido sem valor atendido (cancelado, sem reserva) continua com 0: o Total só entra onde já havia valor.
// - Pedido que não existe em `pedidos_vesti` mantém o valor atendido (não perde venda).
// - Produtos, categorias, cor e tamanho calculam preço do item x quantidade e não usam essa coluna: ficam antes do desconto (o desconto é por pedido).
export function vestiSalesView(dataset: string): string {
  const view = vestiTable(dataset, "dashboard_vendas_view");
  const pedidos = vestiTable(dataset, "pedidos_vesti");
  return `(
    SELECT s.* REPLACE (IF(s.valor_reservado > 0, COALESCE(p.total_value, s.valor_reservado), 0) AS valor_reservado),
      s.valor_reservado AS valor_atendido
    FROM ${view} s
    LEFT JOIN (SELECT id, ANY_VALUE(summary.total_value) AS total_value FROM ${pedidos} GROUP BY id) p ON p.id = s.pedido_id
  )`;
}
