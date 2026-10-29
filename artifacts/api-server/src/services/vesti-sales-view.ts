import { vestiTable } from "../lib/bigquery";

// Vendas da Vesti com o valor do pedido já DESCONTADO: valor atendido (o que de fato saiu) menos o desconto do pedido (`summary.discount` em `pedidos_vesti`).
// Decisão do Marcelo (29/10/2026), depois da decisão do time de usar o valor com desconto ("pago" = status pago, como no ERP): não usar a coluna "Total" da
// Vesti porque ela segue o valor PEDIDO em pedido atendido em parte (conta peça que não saiu) e soma frete/outros valores/cupom. Sem frete e sem cupom.
//
// Devolve a MESMA forma de `dashboard_vendas_view` (uma linha por item, valor só na primeira linha do pedido), mas com `valor_reservado` = atendido - desconto.
// Assim todas as consultas de receita seguem iguais e trocam de valor num único ponto. O valor antigo (antes do desconto) continua em `valor_atendido`.
// - Pedido sem valor atendido (cancelado, sem reserva) continua com 0: o desconto só sai de onde já havia valor.
// - Pedido que não existe em `pedidos_vesti` mantém o valor atendido (não perde venda). O resultado nunca fica negativo.
// - Produtos, categorias, cor e tamanho calculam preço do item x quantidade e não usam essa coluna: ficam antes do desconto (o desconto é por pedido).
export function vestiSalesView(dataset: string): string {
  const view = vestiTable(dataset, "dashboard_vendas_view");
  const pedidos = vestiTable(dataset, "pedidos_vesti");
  return `(
    SELECT s.* REPLACE (IF(s.valor_reservado > 0, GREATEST(s.valor_reservado - COALESCE(p.desconto, 0), 0), 0) AS valor_reservado),
      s.valor_reservado AS valor_atendido
    FROM ${view} s
    LEFT JOIN (SELECT id, ANY_VALUE(summary.discount) AS desconto FROM ${pedidos} GROUP BY id) p ON p.id = s.pedido_id
  )`;
}
