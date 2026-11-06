# Sline no dash novo: criar a versão Vesti, conferir os números e entender o R$ 0,00 da Spoorte

## Situação (medida em 21/10/2026)

- No dash novo existe só a **Sline Spoorte** (UpZero). A versão **Vesti** ainda não foi cadastrada.
- O dataset `sline` no BigQuery está **saudável**: tabelas completas (`pedidos_vesti`, `clientes_vesti`, `produtos_vesti`, `estoques_vesti`, `pagamentos_vesti`, `dashboard_vendas_view`, `rfm_clientes_final`, atribuição), **96.861 linhas** na view de vendas, de **13/02/2025 até 21/10/2026**, com 1 a 4 pedidos por dia nos últimos dias.
- Base de comparação (setembro/2026, view de vendas): **57 pedidos** e **R$ 78.300,33** de valor solicitado. Os números do dash novo e do legado para setembro devem ficar nessa ordem de grandeza (as definições de "aprovado" e de "valor" podem diferir um pouco; o importante é bater **entre os dois dashes**).
- Conta de anúncio candidata: **`act_807816200519158`**. Indícios: tem a campanha antiga "Sline Sports Teste 1" (2022), campanhas "UP.S" e "UP.LA [CADASTRO] [UP ZERO]" (a Sline usa Vesti e UpZero) e é coletada todo dia (último dia guardado: 21/10/2026). **Confirmar** com o Victor ou no cadastro do dash legado antes de usar.

## 1. Criar a "Sline (Vesti)" sem o botão (não depende de variável na Vercel)

Caminho manual, descrito em `docs/novo-cliente-vesti.md`:

1. **Clientes → Novo cliente**, nome "Sline (Vesti)".
2. E-mail do cliente: se o formulário recusar o mesmo e-mail da Spoorte, usar um alias (ex.: `nome+vesti@dominio`).
3. Abrir a janela **Plataforma** do cliente criado: escolher **Vesti** e preencher o dataset **`sline`**.
4. Preencher a **conta de anúncio Meta** (`act_807816200519158`, depois de confirmar). Sem conta, as telas de gasto mostram R$ 0,00 (a coleta guardada não tem de onde ler).
5. Data de atribuição (campo do cliente): usar a mesma do legado para a Sline, se houver.

O botão "Novo cliente Vesti" (cadastra a loja no serviço de sync e já faz tudo) só funciona depois que `SYNC_SERVICE_URL` e `SYNC_SERVICE_TOKEN` existirem na Vercel (acesso do chefe). Para a Sline isso **não é necessário**: a loja já está no sync (o dataset existe e está atualizado).

## 2. Conferir os números com o legado

Mesmo período fechado nos dois painéis (ex.: 01/09 a 30/09/2026), lado a lado:

| Indicador | Dash legado | Dash novo (Sline Vesti) |
|---|---|---|
| Faturamento aprovado | | |
| Pedidos | | |
| Ticket médio | | |
| Investimento em mídia | | |
| ROAS | | |

Leitura:

- **Vendas** vêm da mesma view (`sline.dashboard_vendas_view`): devem bater de forma exata. Se não baterem, olhar a data de atribuição e o filtro de status.
- **Investimento** vem do dado guardado (`ads_insights_account`). Se estiver R$ 0,00 no novo e houver valor no legado, a conta não está no cadastro do cliente ou a coleta não a conhece.
- **Campanhas e criativos** da tela Marketing também saem do guardado; a miniatura de anúncio criado hoje só chega na próxima coleta.

## 3. Por que a "Sline Spoorte" mostra R$ 0,00 (investigação somente leitura)

A Spoorte é UpZero: o faturamento vem dos pedidos sincronizados no Postgres. R$ 0,00 costuma ser (a) período sem pedidos **pagos** (a regra agora é só APPROVED, SHIPPED e DELIVERED), (b) sync parado, ou (c) conta Meta/GA4 ausente afetando só os cartões de mídia.

Rodar no Postgres do dash novo (`up_dash_b2b`), trocando `<ID>` pelo id do cliente:

```sql
-- 1) pedidos por status e mês: existe pedido? qual status?
SELECT date_trunc('month', created_at AT TIME ZONE 'America/Sao_Paulo')::date AS mes, status, COUNT(*) AS pedidos, SUM(amount) AS valor_solicitado, SUM(fulfilled_amount) AS valor_pago_b2c
FROM orders WHERE client_id = '<ID>'
GROUP BY 1, 2 ORDER BY 1 DESC, 2 LIMIT 40;

-- 2) o sync está andando? (última sincronização e erro, se houver)
SELECT job_type, status, started_at, finished_at, left(error, 200) AS erro
FROM sync_jobs WHERE client_id = '<ID>' ORDER BY started_at DESC LIMIT 10;

-- 3) último pedido do cliente
SELECT MAX(created_at) AS ultimo_pedido, COUNT(*) AS total FROM orders WHERE client_id = '<ID>';
```

Interpretação:

- **Só aparecem status pendentes ou recusados** no período: o R$ 0,00 está certo para a regra nova (receita paga).
- **Nenhum pedido recente** e o sync com erro: problema de sync (ver `docs` do sync UpZero e `sync_jobs.error`).
- **Há pedidos pagos** no período e a tela mostra 0: aí sim há bug; guardar o id do cliente e o período e investigar a rota `/analytics/dashboard`.
