# Integração Braavo no UP Dash

Estudo técnico de 3 de novembro de 2026, atualizado após os testes locais, para adicionar `BRAAVO` como plataforma de comércio, usando a loja La Cleo como primeira conexão. A conexão autenticada foi validada; a carga completa e a conciliação das regras financeiras ainda precisam ser concluídas.

## Implementação disponível

A implementação foi transportada para a branch `codex/braavo-la-cleo`, baseada na `main` atual do repositório. A Braavo é B2C, conforme confirmado para esta integração. A cópia `up-dash-redesign/` não foi alterada.

O cadastro de clientes oferece **B2C → Braavo**, com nome La Cleo e domínio `https://www.lacleo.com.br` preenchidos inicialmente. Informe o e-mail do contato e salve; API Token, API Key, Meta e GA4 podem ser cadastrados depois. A chave interna do Dash é independente das duas credenciais Braavo.

Na linha do cliente, **Braavo → Salvar conexão → Testar conexão → Sincronizar** configura e inicia a importação. Os campos de chaves ficam vazios ao reabrir e preservam os valores salvos quando omitidos. As respostas da API não retornam Token ou Key. O botão de pausa conclui o lote atual e preserva a retomada.

A sincronização importa categorias, variações, produtos com fotos, SKUs e estoque, clientes com endereços e pedidos com itens. Usa IDs externos por loja, transações na gravação de pedidos e slots de chamada compartilhados no banco. Cada chamada processa uma página; o estado e o job continuam pendentes até concluir o ciclo. Consultas por alteração percorrem os dias faltantes com sobreposição, pedidos pendentes são reconferidos e uma carga completa é repetida após sete dias. O ponto de retomada usa o dia observado no início do ciclo, para cobrir importações que demorem vários dias.

As UTMs são persistidas por pedido e evento de compra; os filtros da visão principal e a origem exibida na lista de pedidos usam esse vínculo. O agrupamento de variantes distingue produtos Braavo sem juntá-los sob um único prefixo. Cadastros B2C não são tratados como leads comerciais aprovados.

Para ativar no ambiente publicado:

1. Aplicar `lib/db/migrations/0043_braavo.sql` pelo fluxo de migrações do projeto, antes de publicar a API. A migração está registrada no journal; revisar outras migrações pendentes antes de executar `pnpm --filter @workspace/db migrate` com o banco do ambiente escolhido.
2. Publicar API, frontend e a imagem do Cloud Run Job da raiz. A entrada `TASK=braavo_transactional` foi adicionada a `artifacts/api-server/src/jobs/upzero-sync-job.ts`, o executor já usado pelas demais plataformas. Configurar o recurso/agendamento Braavo pelo processo mantido pelo dev. O workflow GitHub de extrações está sem cron e serve apenas como alternativa manual; adicionar a plataforma nele não ativa atualização periódica em produção.
3. Cadastrar a La Cleo, informar as chaves, testar a conexão e importar o histórico. Comparar um período fechado com o painel Braavo para confirmar frete, desconto, cancelamento e valor aprovado.

A migração foi validada num PostgreSQL temporário. Os testes integrados usam respostas simuladas da Braavo e cobrem reprocessamento, pagamento tardio, cancelamento, atualização de e-mail, concorrência, isolamento de lojas, permissões e sigilo das chaves nas respostas. A interface e a conexão real foram testadas no ambiente local, com uma carga ainda em andamento. Não houve alteração no banco publicado nem implantação de infraestrutura nesta etapa.

Webhooks, recuperação de carrinhos e a fonte Braavo do monitor de produtos em campanha ficam como evolução. O monitor de anúncios por produto não faz parte desta entrega. As fórmulas iniciais usam `pedido_geral` como total com frete, os totais calculados dos itens sem descontar cupom novamente e `pedido_cancelado` como valor cancelado. Os campos originais de valores e status ficam no pedido para conferência; o valor efetivamente estornado não é inferido do status de entrega.

Verificação local:

```sh
pnpm run typecheck:libs
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/up-dash typecheck
pnpm --filter @workspace/api-server exec vitest run test/braavo-api.test.ts test/braavo-normalize.test.ts
pnpm --filter @workspace/api-server build
PORT=4100 BASE_PATH=/ pnpm --filter @workspace/up-dash build
```

Para os testes com banco, usar uma base local descartável chamada `braavo_integration_test`, com o schema do projeto e a migração aplicados. O arquivo `test/braavo-integration.test.ts` só roda quando `BRAAVO_TEST_DATABASE_URL` estiver definido, exige host local e limpa os dados dessa base entre testes.

## Loja e fontes

O domínio informado foi `http://lacleo.com.br/`. A consulta pública por HTTPS redireciona para [www.lacleo.com.br](https://www.lacleo.com.br/). A base candidata da integração é `https://www.lacleo.com.br/api`; confirmar esse endereço com uma consulta autenticada antes de ativar a extração. Configurar diretamente o domínio final evita depender de redirecionamentos ao enviar credenciais.

Fontes oficiais: [manual Braavo](https://manual.braavo.com.br/#description/introduction) e [especificação OpenAPI que alimenta o manual](https://manual.braavo.com.br/openapi.yaml), versão declarada `1.0`, OpenAPI `3.1.0`. Os fatos da API abaixo vêm dessa especificação. As escolhas de implementação são propostas para este repositório.

## Contrato da API

| Aspecto | Comportamento documentado | Aplicação no conector |
| --- | --- | --- |
| Autenticação | HTTP Basic, API Token no usuário e API Key na senha | Construir `Authorization: Basic base64(Token:Key)` no servidor |
| Consultas | Os endpoints de busca usam POST e filtros JSON no corpo | Enviar `Content-Type: application/json`; não converter filtros em query string |
| Respostas | Dados em `ok`; falhas em `erro`, inclusive com HTTP 200 | Verificar HTTP, JSON e erro de negócio antes de persistir |
| Paginação comum | `atual`, `limite`, resposta `pag` com `paginas`, `encontrados`, `exibindo` | Começar na página 1 e concluir todas as páginas; vários endpoints permitem até 500 registros |
| Primeiras compras | Cursor `desde_id`, resposta `pag.proximo_id` | Começar em 0, avançar até `ok` vazio e detectar cursor sem avanço |
| Limite de chamadas | Aproximadamente quatro requisições por segundo | Uma chamada por segundo por loja, com fila compartilhada entre jobs e pausa mínima de cinco segundos entre lotes |
| Datas de alteração | `data_alterado` representa um dia `AAAA-MM-DD` | Percorrer os dias pendentes; não tratar como filtro de mínimo timestamp |
| Datas de aprovação | Pedidos e primeiras compras aceitam `data_aprovado_1` e `data_aprovado_2` | Usar a faixa para reconciliação por aprovação, preservando pedidos pendentes na carga geral |

Consultas de leitura com falha transitória usam espera progressiva e limite de tentativas. Recusas genéricas em HTTP 200 podem ser confirmadas com no máximo duas novas consultas, após cinco e dez segundos, pois a validação local observou consultas idênticas voltarem a funcionar sem alteração de dados ou credenciais. Falhas reconhecidas de autenticação, permissão, validação ou registro não encontrado não são repetidas, assim como desafios anti-bot. O manual não especifica o status HTTP exato usado para excesso de chamadas. Uma carga interrompida permanece incompleta no job, com ponto de retomada persistido.

As datas de registros vêm em exemplos como `2026-06-02 14:00:00`, sem offset. Confirmar o fuso da loja antes da conversão para UTC; `America/Sao_Paulo` é a hipótese inicial, compatível com as agregações atuais do Dash.

## Recursos para o Dash

Todos os caminhos da tabela são relativos à base `/api` e usam POST.

| Dado | Endpoint | Uso no Dash |
| --- | --- | --- |
| Clientes | `/clientes/buscar/todos` e `/clientes/buscar/id` | Cadastro, telefone, documento, recompra e RFM |
| Endereços | `/enderecos/buscar/todos` | Cidade e UF dos clientes; o pedido já traz seu endereço de entrega |
| Categorias | `/categorias/buscar/todos` | Resolver nomes e hierarquia do catálogo |
| Produtos | `/produtos/buscar/todos` e `/produtos/buscar/id` | Nome, referência, categoria e fotos; a busca por ID inclui SKUs e fotos |
| Variações | `/variacoes/buscar/todos` | Resolver o tipo de cada variação antes de classificá-la como cor ou tamanho |
| SKUs | `/skus/buscar/todos` | Referência, produto pai, preço, custo e estoque por variante |
| Estoque | `/estoques/buscar/sku` | Conferência pontual de quantidade |
| Pedidos | `/pedidos/buscar/todos` | Cabeçalho, valores, cliente, pagamento, entrega, UTMs e datas |
| Pedido completo | `/pedidos/buscar/id` | Itens e históricos de pagamento, entrega e rastreio |
| Itens em lote | `/pedidos_produtos/buscar/todos` | Alternativa à consulta individual de cada pedido na carga histórica |
| Primeira compra | `/pedidos_primeira_compra/buscar/todos` | Primeira aprovação por cliente e conferência de novos compradores |
| Carrinhos abandonados | `/abandonados/buscar/todos` e `/abandonados/buscar/id` | Evolução para recuperação, com link e produtos do carrinho |

A consulta de pedido por ID aceita opções que modificam o pedido. O conector analítico deve enviar explicitamente `gravar_status_erp: 0` e `gravar_separando: 0`.

Exemplo de corpo para confirmar um pedido sem avançar sua operação:

```json
{
  "id": 147929,
  "gravar_status_erp": 0,
  "gravar_separando": 0
}
```

## Mapeamento proposto

Reutilizar as tabelas locais `customers`, `products`, `orders`, `order_items`, `events` e `sync_jobs`. Usar `clientId` em toda consulta e chave de deduplicação. Prefixar IDs externos com `braavo:` permite distingui-los de dados de outras fontes, mas a troca da plataforma de um cliente também exige definir como conciliar o histórico existente.

| Origem Braavo | Destino proposto | Regra |
| --- | --- | --- |
| Cliente `id` ou pedido `usuario_id` | `customers.externalId` | Identidade estável da pessoa dentro da loja; e-mail é dado atualizável |
| Cliente `nome`, `email`, telefones | Campos de contato de `customers` | Normalizar telefone com país quando disponível; tratar ausência e mudança de e-mail sem fundir pessoas |
| Cliente `cpf`, `cnpj` | Tipo, hash e últimos quatro dígitos | Reaproveitar a estratégia de documento do Dash |
| SKU `id`, `ref`, `produto_id` | `products.externalId`, `sku` e vínculo ao produto pai | Uma linha por SKU; preservar o pai para agrupamento de variantes |
| SKU `preco_venda`, `preco_custo`, `estoque` | `products.price`, `cost`, `stock` | Preservar saldos inteiros, inclusive negativos; estoque ausente não comprova ruptura. A validação de estoque é separada das quantidades não negativas de itens de pedidos |
| Pedido `id`, `usuario_id` | `orders.externalId` e `customerId` | Atualizar o mesmo pedido em reprocessamentos |
| Pedido `data_criado`, `data_aprovado` | `orders.createdAt`, `approvalDate` | Preservar ambas as datas e converter no fuso confirmado |
| Item `sku_id`, `quantidade`, variações | `order_items` e vínculo com `products` | Substituir itens e atualizar o pedido numa transação |
| Pedido aprovado | Evento `PURCHASE` | ID determinístico, por exemplo `braavo:purchase:147929`; reprocessamento não cria nova compra |

O vínculo de SKU com produto pai precisa ser persistido explicitamente ou codificado em `externalId` com contrato definido. Não copiar o agrupamento Nuvemshop sem revisar os consumidores desse campo. Conferir também referências de SKU duplicadas contra o índice único atual por cliente.

`ativo` no cadastro Braavo não comprova aprovação comercial B2B. O esquema não documenta um equivalente direto a `registrationStatus` e `approvalDate` do cadastro no Dash. Definir essa regra caso a operação use métricas de aprovação de leads.

As UTMs documentadas pertencem ao pedido. Preservá-las por pedido/evento permite analisar compras de campanhas diferentes do mesmo cliente. Copiar a última UTM para o cadastro alteraria a atribuição de compras antigas; os filtros atuais que usam UTMs de `customers` precisam ser revisados.

## Pagamentos e valores

Os códigos documentados de pagamento são `0` registrado, `1` aguardando, `2` em análise, `3` aprovado e `6` cancelado. A proposta inicial é mapear 0/1/2 para `PENDING`, 3 para `APPROVED` e 6 para `REJECTED`. Somente um pedido com pagamento aprovado pode subir para `SHIPPED` ou `DELIVERED` pela entrega. Preservar os códigos originais para auditoria e tratar códigos desconhecidos sem assumir receita aprovada.

Entrega possui estados de devolução, chargeback e cancelamento. Esses casos exigem reconciliação financeira própria; o código de entrega sozinho não comprova o valor estornado.

Os campos `pedido_total`, `pedido_geral`, `pagamento_valor`, `pedido_cancelado`, `frete_valor` e `desconto_valor` precisam ser confrontados com pedidos reais antes de fixar as fórmulas de `amount`, `fulfilledAmount`, `grossAmount`, `refundedAmount` e `cancelledAmount`. O esquema lista os campos, mas não define completamente a composição de todos esses totais. Usar `desconto_valor`; `desconto_produtos` está obsoleto.

Os itens oferecem `calculado_preco_venda` e `calculado_preco_total` com desconto de cupom abatido. Conferir o fechamento do total dos itens com frete e demais ajustes, evitando descontar o cupom novamente. Para dinheiro, calcular em centavos ou decimal com arredondamento definido.

Há uma diferença atual a revisar: `daily-client-metrics.ts` agrega receita por `orders.amount` e data de criação, enquanto partes do B2C usam `fulfilledAmount`. Validar a mesma definição de receita e período em cards, séries e relatórios. Quando um pedido antigo mudar de status, recalcular também os dias históricos afetados e os totais de cliente/produto, inclusive quando voltarem a zero.

## Carga inicial e atualização

1. Validar as credenciais numa consulta pequena e conferir amostras de pedidos pendentes, aprovados e cancelados. O manual informa que não há sandbox padrão: usar apenas buscas para essa validação.
2. Importar categorias, variações, produtos, SKUs e clientes por páginas. Enriquecer fotos por produto, com cache; comparar a importação de itens em lote com o detalhamento individual para reduzir chamadas.
3. Importar todos os status de pedidos e seus itens, preservando o histórico necessário à recompra. Carga apenas de aprovados não cobre conversões e cancelamentos posteriores.
4. Persistir etapa, página, último dia concluído e IDs já gravados na página corrente. Confirmar cada ID somente depois de gravar o registro e suas atualizações relacionadas. Na retomada, reconsultar a lista da página, mas omitir os detalhes dos IDs já concluídos; limpar esses IDs ao trocar de página, dia ou etapa. Isso também permite continuar páginas interrompidas pelo limite de duração sem repetir os primeiros detalhes indefinidamente.
5. Nas execuções seguintes, consultar cada dia de alteração pendente e reprocessar uma sobreposição, inicialmente hoje e ontem no fuso da loja. Retomar dias perdidos se a execução ficar indisponível por mais tempo.
6. Reconsultar pendentes conhecidos e reconciliar periodicamente o histórico. Confirmar com a Braavo se alterações de pagamento, entrega e estoque sempre atualizam `data_alterado` do recurso correspondente.
7. Recalcular agregados afetados e registrar contagens, duração, falhas e completude em `sync_jobs`.

Com uma consulta de detalhe por pedido, 10 mil pedidos exigem aproximadamente 2 horas e 47 minutos apenas para essas chamadas no intervalo de um segundo, além das pausas entre lotes. A raiz do projeto configura funções com duração de 60 segundos. Executar a carga por lotes retomáveis ou worker durável; uma única requisição não comporta a importação inteira.

## Webhooks

O manual descreve notificações de criação de pedido e de carrinho abandonado, configuradas no painel da loja. Não garante notificações de pagamento aprovado ou de alterações posteriores, portanto os webhooks complementam a consulta periódica.

O receptor deve identificar a loja por configuração própria, gravar o evento em fila durável e responder 2xx após essa gravação. Confirmar os dados com as credenciais da loja, chamando um endpoint fixo permitido. Não executar livremente o `retorno.endpoint` nem repassar todo o `retorno.body` recebido.

Existe uma divergência no contrato: a consulta de pedido por ID exige `id`, mas o exemplo de webhook usa `retorno.body.pedido_id`. Normalizar para `{id: ...}` com validação e manter os dois sinalizadores de escrita em zero. O manual também não define assinatura, política de reenvio ou identificador único do evento; confirmar esses pontos com o suporte antes de ativar o receptor. Duplicatas devem convergir para o mesmo pedido e evento de compra.

## Alterações necessárias no repositório

| Área | Alteração proposta |
| --- | --- |
| `lib/db/src/schema/clients.ts` e migração | Adicionar `BRAAVO`, domínio e referências às credenciais da loja |
| `lib/api-spec/openapi.yaml` | Atualizar contratos de criação, edição, importação e resposta de clientes; regenerar cliente e Zod pelo codegen existente |
| `artifacts/up-dash/src/pages/clients.tsx` | Separar seleção de plataforma de B2B/B2C; cadastrar domínio, Token e Key; mostrar estado da conexão |
| `artifacts/api-server/src/routes/clients.ts` | Salvar configuração, testar conexão e disponibilizar sincronização administrativa; respostas públicas retornam somente presença das credenciais |
| Novo cliente HTTP e serviço Braavo | Autenticação, fila por loja, paginação, erros de negócio, normalização e persistência |
| `syncJobs.ts`, `extraction-runner.ts` e `routes/extractions.ts` | Registrar `braavo_transactional`, controlar concorrência e continuar lotes interrompidos |
| Agenda de extração | Incluir Braavo no mecanismo agendado e acompanhar falhas sem marcar carga parcial como concluída |
| Analytics e métricas diárias | Revisar valores financeiros, atribuição por pedido, agrupamento de SKUs e correções históricas |
| Monitor de produtos em campanha | Evolução separada: implementar a fonte Braavo e validar a correspondência de anúncios com produtos antes de habilitar essa função |

Plataforma e modelo de negócio são decisões separadas. A Braavo e a operação da La Cleo foram confirmadas como B2C para esta implementação. Selecionar Braavo não deve preencher credenciais Nuvemshop nem acionar jobs de outra plataforma por credenciais antigas.

O workspace também contém uma cópia `up-dash-redesign/`, sem repositório Git próprio, com diferenças como a plataforma Vesti. Os caminhos acima referem-se à raiz versionada. A implementação foi aplicada na raiz usada pelo build do workspace; uma publicação da cópia exigiria portar as alterações para ela.

## Validação para ativação

Os testes do conector precisam cobrir erro em HTTP 200, autenticação inválida, respostas malformadas, paginação completa e interrompida, cursor sem avanço, limite de chamadas, repetição de lote e isolamento entre lojas. Cobrir também mudança de e-mail, pagamento tardio, cancelamento, descontos, estoque zero, data sem offset e alteração de pedido antigo.

Na La Cleo, comparar um período fechado entre painel Braavo e Dash: pedidos por status, valor aprovado, frete, descontos, primeira compra e estoque de SKUs selecionados. Repetir a carga deve manter as contagens. Só liberar métricas financeiras e automações após fechar essas comparações.

O conector está implementado na raiz. A ativação depende da migração e publicação desse código, do cadastro do cliente correto do Dash e da configuração de API Token + API Key. A conexão autenticada da La Cleo foi validada localmente em 04/11/2026; a carga completa e a conciliação das métricas ainda estão pendentes.

## Bloqueio por verificação humana

Na validação local, uma chamada autenticada `POST /api/produtos/buscar/todos` recebeu HTTP 405, `Content-Type: text/html; charset=UTF-8`, `Server: awselb/2.0` e uma página com título `Human Verification`. Isso identifica a interceptação pela proteção da loja, antes da resposta JSON esperada da API; não é evidência de chave inválida nem motivo para trocar o POST documentado por GET.

O conector identifica essa página como `BRAAVO_ACCESS_BLOCKED`, interrompe o lote sem repetir o desafio e preserva o ponto de retomada. Solicitar à Braavo a revisão da regra de proteção que intercepta as rotas autenticadas `/api/*`, com uma configuração apropriada para integração entre servidores. Não enviar Token, Key ou cabeçalho Authorization no chamado. Depois da liberação, usar **Sincronizar** para retomar a carga preservada.

## Ritmo reduzido de importação

Para reduzir a frequência de acesso, as reservas compartilhadas no banco espaçam as chamadas em pelo menos um segundo e impõem cinco segundos sem novas chamadas após cada lote, inclusive em falhas. O navegador também aguarda cinco segundos antes de solicitar o próximo lote. A agenda usa a mesma fila e respeita a pausa, sem depender da interface. O limite do lote passa a 50 segundos para acomodar as consultas de detalhes mais lentas, mantendo as páginas e o ponto de retomada existentes. Essa redução não garante que a proteção anti-bot deixe de bloquear a integração.

## DNS e execução no Cloud Run do projeto

A falha local de 04/11 interrompeu a carga durante a validação do domínio, antes de enviar a consulta autenticada. Em 05/11 o domínio voltou a resolver normalmente. Não foi preservado o código DNS original, portanto a causa externa exata não está confirmada. O conector agora limita cada resolução a cinco segundos e tenta até três vezes, com esperas de um e dois segundos. Se não recuperar, retorna `BRAAVO_DNS_UNAVAILABLE` e preserva o cursor. A validação de endereços públicos continua obrigatória; nenhuma credencial é enviada antes dela. Referência: [documentação de dns.lookup do Node.js](https://nodejs.org/api/dns.html#dnslookuphostname-options-callback).

O entrypoint de produção aceita `TASK=braavo_transactional`, `TRIGGER=cron|manual`, `CLIENT_ID` opcional e `OFFSET` opcional. Ele chama `runBraavoTransactionalExtraction`/`runBraavoBatch`, compartilhando tabelas, leases, intervalo de chamadas e checkpoints com a API. Aguarda cinco segundos entre lotes. Falhas DNS esgotadas recebem no máximo três novas execuções do lote, após 30, 60 e 120 segundos; erros de validação e desafios anti-bot não são repetidos por esse executor.

Cada invocação tem orçamento de 20 minutos e reserva espaço para concluir o lote corrente. Se restar trabalho, retorna `pending: 1`, sem marcar a importação completa; a próxima execução agendada retoma do cursor persistido. A imagem e a migração precisam ser publicadas antes da ativação. O dev deve criar/configurar o recurso Braavo usando a mesma imagem e configuração de banco dos jobs atuais, com `TASK=braavo_transactional`, e ligá-lo ao Cloud Scheduler pelo fluxo existente. Não substituir o `TASK` de um job de outra plataforma. Esta branch não cria nem altera recursos de produção.

O script em `/private/tmp/updash-braavo-local-env` é apenas um executor do teste neste Mac e não faz parte do deploy. O banco e os dados locais também não são enviados ao banco de produção pelo push. As alterações permanecem na branch `codex/braavo-la-cleo` e no mesmo PR para revisão e incorporação pelo dev.

## Registros inválidos e validação com dados reais

Os campos financeiros foram conferidos contra o histórico completo de uma loja Braavo real já sincronizada para o BigQuery (114.556 pedidos, leitura apenas). O que isso mostrou:

- `pedido_geral` = `pedido_total` + `frete_valor` - `pedido_desconto` - `pedido_carteira`. A diferença entre `pedido_total + frete` e `pedido_geral` ficou totalmente explicada por desconto e carteira nos 2.872 pedidos pagos de um mês. O valor do pedido no Dash (`pedido_geral` menos cancelado) **inclui o frete e já desconta cupom e crédito de carteira**.
- `desconto_valor` veio zero em todos os pedidos e `pedido_desconto` estava preenchido em 68.097. O desconto gravado no pedido vem de `pedido_desconto`; `desconto_valor` só é usado quando a loja não informa o primeiro. O campo é informativo e não altera o valor do pedido.
- Pagamento aprovado com entrega cancelada: nenhum caso nos dois meses conferidos.
- Histórico antigo traz inconsistências pontuais: 17 pedidos de 2022 com cancelado maior que o total (em geral por arredondamento, 300,00 contra 299,90) e uma linha vazia.

Tratamento:

1. **Cancelado maior que o total** deixa de recusar o pedido. O valor é limitado ao total (o líquido, `max(0, total - cancelado)`, não muda), o original fica em `sourceMetadata.pedido_cancelado` e o pedido recebe `sourceMetadata.data_quality = ["cancelado_maior_que_total"]`.
2. **Dado inválido de um único registro** (status de pagamento desconhecido, valor negativo ou ausente, data impossível, quantidade inválida) usa `BraavoRecordError`. O lote registra o problema em `braavo_record_issues` (etapa, ID, motivo, tentativas, datas), escreve um aviso no log e **continua**. O registro é reavaliado a cada ciclo e a pendência some sozinha quando ele passa a ser importado.
3. **Erros de rede, bloqueio anti-bot, credencial, perda de lease ou banco continuam interrompendo o lote**, preservando o ponto de retomada. Só dado inválido de um registro é pulado.
4. **Teto por ciclo:** mais de 100 registros inválidos no mesmo ciclo (`MAX_SKIPPED_PER_CYCLE`) interrompe o lote com `BRAAVO_TOO_MANY_INVALID`. Esse volume sugere mudança no formato da API, não histórico sujo, e não deve ser ignorado em silêncio.

O estado `GET /clients/:clientId/braavo` devolve `skippedRecords` (total e os 20 mais recentes), a resposta do lote devolve `skipped` e a janela de conexão mostra o aviso. A tabela é criada pela migração `0044_braavo_record_issues.sql`.

## Conferência da La Cleo com o painel (setembro/2026)

Conferido em 06/11/2026 no painel da loja (Pedidos > Vendas > Filtrar por > Data Compra De/Até, aba Aprovados) contra a API, só com leituras, a 1 requisição por segundo e sem bloqueio anti-bot.

| Item | Painel | API |
| --- | --- | --- |
| Pedidos criados em setembro | 689 | 689 |
| Pedidos aprovados (`status_pagamento = 3`) | 576 | 576 |
| Produtos | 204.018,49 | 204.018,49 |
| Frete | 10.113,82 | 10.113,82 |
| Desconto | 16.300,63 | 16.300,63 |
| Carteira | 6.384,32 | 6.384,32 |
| Total (`pedido_geral`) | 191.447,36 | 191.447,36 |

Nas últimas 24 horas (05/11 09:43 a 06/11 09:43): 35 criados e 33 aprovados nos dois lados. Cancelados: 3 no painel e 2 na API, por critério de data possivelmente diferente (não verificado).

**Valor do pedido.** `pedido_geral` é exatamente o Total do painel (produtos + frete - desconto - carteira). A regra do conector (`pedido_geral` menos `pedido_cancelado`, sem pedidos de entrega 41/42/43) dá 574 pedidos e R$ 170.058,32 em setembro.

**Cancelamento (ponto em aberto).** O painel tem a coluna Estorno (54 pedidos, R$ 12.685,36) e a API tem `pedido_cancelado` (81 pedidos, R$ 20.337,31). 53 pedidos aparecem nos dois, e em 51 os valores são iguais ao centavo. Os outros 28 (R$ 7.665,81, todos com entrega 40 Concluído, 6 deles com o pedido inteiro cancelado) têm `pedido_cancelado` mas nenhum estorno no painel. A loja precisa dizer se esses cancelamentos são reais. Alternativas de valor para setembro: Total do painel R$ 191.447,36, Total menos Estorno R$ 178.762,00, regra do conector R$ 170.058,32.

**Status de entrega no painel:** 23 Entregue, 40 Concluído, 41 Chargeback, 42 Devolvido ao remetente, 43 Cancelado. **Status de pagamento:** 0 Registrado, 1 Aguardando pagamento, 2 Em análise, 3 Aprovado, 6 Cancelado.

**Escala.** A La Cleo tem cerca de 64 mil pedidos. A carga inicial busca o detalhe de cada pedido a 1 requisição por segundo, o que leva por volta de 18 horas só nos pedidos. O job agendado precisa rodar em lotes repetidos, retomando do ponto salvo.

