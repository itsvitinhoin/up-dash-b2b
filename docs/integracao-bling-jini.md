# Bling no B2C — piloto Jini

Jini utiliza Nuvemshop. O piloto importa **todos os canais do Bling, identificados separadamente**, com cinco escopos de leitura. A configuração fica em **Clientes cadastrados → Jini → ERP → Bling**. O usuário confirmou concluir os 30 dias antes de ampliar o histórico, que deverá ficar limitado a 2026. A conta real foi autorizada pelo usuário em 23/11/2026; a empresa conectada é conferida no Dash e não pode ser vinculada a duas marcas.

## Comportamento entregue

- Bling adicional à Nuvemshop: não muda `commercePlatform` e não insere cópias dos pedidos ERP na tabela de vendas da loja.
- ERP no B2C com visão por canal, pedidos com itens, compradores do período, catálogo/SKUs e saldos físicos/disponíveis por depósito.
- Primeira carga de 30 dias de pedidos; catálogo e contatos completos. Histórico inicial configurável de 1 a 365 dias. Alterar o histórico inicia outra carga, preservando os registros existentes.
- Atualizações de pedidos por data de alteração, com sobreposição de um dia. Catálogo, canais e contatos são consultados novamente a cada ciclo.
- Cursor persistido e exclusividade por marca. Páginas de até 50 registros e grupos de até oito detalhes são gravados junto ao checkpoint, com deduplicação antes do upsert. Uma falha parcial preserva todos os detalhes bem-sucedidos, inclusive quando chegam fora de ordem.
- Até duas consultas de detalhes em andamento, com reserva compartilhada de uma chamada por segundo por conta. Outras integrações da mesma conta também consomem a cota Bling.
- Contadores de produtos, contatos, pedidos e canais para conferir a carga. O status é atualizado a cada 30 segundos durante a importação; falhas transitórias têm duas novas tentativas. Quando a consulta falha, a interface identifica explicitamente que os dados exibidos são da última consulta recebida.

## Layout de ERP compartilhado com o B2B

As **sete páginas** usam a mesma implementação do ERP B2B (`erp.tsx`), sem um renderer separado para o Bling: Visão Geral, Pedidos, Clientes, Produtos, Estoque, Vendedoras e Lojas e Geografia. Os submenus, indicadores, formatação compacta de valores, comparações, anéis, gráficos, filtros, tabelas e detalhes expansíveis vêm dos componentes B2B. O transporte traduz as consultas para o leitor Bling isolado, com o mesmo contrato de dados e sem consultar os datasets de outra fonte. A configuração da conexão continua em Clientes → ERP → Bling.

O cache não contém receita líquida/bruta financeira, descontos, devoluções, custos, endereços, vendedores, atribuição ou histórico completo de vida do comprador. Esses campos são `null` e aparecem como **—/indisponíveis**, mantendo seus espaços na página. Não se inferem cancelamentos pelos IDs personalizados de situação, nem primeira compra/recorrência histórica a partir de uma carga de 30 dias. As comparações permanecem visíveis com indisponibilidade explícita quando não há período anterior comparável. Datas de pedidos sem horário permanecem datas, sem inventar uma hora de criação.

O gráfico diário usa o valor registrado nos pedidos, incluindo todas as situações, com essa regra na descrição; valores de itens são quantidade × preço unitário. A tabela de compradores mostra pedidos e valor do período por cadastro do Bling. Contatos genéricos podem reunir pessoas diferentes. A página de Vendedoras e Lojas preserva a área de vendedores indisponível e apresenta as lojas/canais do campo `loja.id`, sem tratá-las como filiais físicas. Geografia existe com a estrutura B2B e identifica os dados não disponíveis na carga.

Produtos agrupam as variações por ID pai. O estoque consolidado não soma o saldo do pai novamente aos saldos filhos. Vendas diretamente atribuídas ao pai continuam presentes; estoque não informado é distinto de saldo zero. Catálogo/estoque são snapshots. Custos/margens e giro/cobertura não são inventados; os controles que dependem desses dados permanecem visíveis e desabilitados. Exportação usa o mesmo fluxo do B2B e recusa truncamento acima de 10.000 registros.

A referência visual das sete páginas e a conferência real ficam no registro privado local do piloto. A validação do novo contrato cobre campos ausentes, datas sem horários fabricados, paginação de 20 registros, filtros, isolamento de marca, agrupamento pai/filho e exclusão de estoque duplicado.

## Configuração e segurança

O aplicativo privado **UP Dash — Jini** usa somente Clientes e Fornecedores, Controle de Estoque, Pedidos de Venda, Produtos e Visualizar os dados básicos da empresa, todos de leitura. **Integrações e Lojas Virtuais permanece desativado**. Se `/canais-venda` retorna 403, o conector identifica canais por `loja.id` nos pedidos e os apresenta pelo ID; não amplia permissões para obter nomes.

O usuário autorizou a permissão Cadastro de aplicativos, preencheu o contato do desenvolvedor e autorizou o aplicativo. Client Secret e tokens não devem ser copiados para chat, documentação ou logs. Credenciais próprias por marca são cifradas em `clients.erp_credentials_encrypted`; segredo omitido mantém o valor salvo somente quando o Client ID permanece igual. Trocar aplicativo exige nova autorização e preserva o vínculo com a empresa anterior.

OAuth usa estado de uso único vinculado ao navegador. Tokens são renovados no servidor e cifrados com AES-256-GCM; cada novo refresh token é persistido imediatamente. O conector só consulta os recursos permitidos, sem enviar alterações à operação Bling.

Variáveis do servidor:

| Variável | Conteúdo |
| --- | --- |
| `BLING_CLIENT_ID` | Client ID do aplicativo padrão |
| `BLING_CLIENT_SECRET` | Segredo do aplicativo padrão |
| `BLING_REDIRECT_URI` | `https://www.grupoup-dash.com.br/api/bling/callback` |
| `BLING_TOKEN_ENCRYPTION_KEY` | Chave aleatória de 32 bytes em hexadecimal |

As variáveis estão configuradas como sensíveis no ambiente production. A URL cadastrada no aplicativo deve ser idêntica à do servidor. Preserve a chave entre deploys; sua troca exige recriptografia ou reconexão das contas. A chave ERP existente protege as credenciais próprias por marca.

A migração aditiva é `0050_bling.sql`, alinhada à main `b429194`. O primeiro salvamento cria somente as três tabelas Bling e seus índices, de modo transacional, idempotente e exclusivo. A leitura inicial funciona antes desse provisionamento. Não executar diários antigos de migrações da raiz do workspace.

## Execução e retomada

A primeira carga é acompanhada pelo workflow manual já registrado `.github/workflows/scheduled-extractions.yml`, executado com `mode=bling` e `bling_client_id`. Esse modo ignora todos os demais jobs e restringe a importação à marca ativa e autorizada selecionada. As credenciais Bling ficam exclusivamente no backend; o executor usa a autenticação GitHub já aceita pelo cron.

O job tem prazo interno de 350 minutos e limite de 360 minutos. Só encerra com sucesso após `complete: true`. Respeita `Retry-After` e aplica espera limitada para cotas por segundo. Cota diária, espera superior a 15 minutos, falhas permanentes de autenticação/escopo/empresa ou falhas persistentes interrompem o job, preservando o checkpoint. Falhas de transporte e HTTP 5xx, inclusive respostas não JSON, têm tentativas limitadas. HTTP 400/401/403/404 não é repetido como falha transitória. Logs públicos não contêm corpos de resposta, nomes de compradores, valores nem contagens comerciais.

O endpoint fixo `api/cron/extractions/bling.js` mantém a rota e a autenticação existentes, mas isola a execução em uma função Vercel com duração máxima de 290 segundos, distinta da função compartilhada de 300 segundos. A leitura ERP também tem entrada fixa em `api/analytics/erp/bling.js`, duração de 288 segundos e cabeçalho `X-Bling-Analytics: isolated`, mantendo a autenticação e a autorização por marca. Importação e leitura deixam de disputar a fila da função compartilhada. A resposta contém `X-Bling-Worker: isolated`, inclusive na rejeição de uma chamada sem autorização válida. Timeout de aquisição do pool tem recuperação limitada; não altera o tamanho do banco, permissões ou o parâmetro `max_connections` do PostgreSQL.

HTTP 429 é classificado somente por `error.period` e `Retry-After`. Sem cabeçalho, as pausas são de 5 segundos para cota por segundo, 60 segundos para período desconhecido e 24 horas para cota diária. `next_request_at` impede consultas antecipadas. Não reconectar a conta nem mudar o histórico para contornar cotas.

Depois de uma carga completa, o modo manual `bling_orders_only=true` permite uma atualização complementar dos pedidos alterados, sem repetir catálogo ou contatos. Exige marca explícita e carga anterior concluída; um cursor já ativo é retomado sem pular etapas. A consulta combina a janela de alteração com os dias configurados para os pedidos e verifica novamente o período antes de persistir os detalhes. A janela fica no cursor JSON existente, sem migração adicional.

A ação administrativa **Conferir pedido** consulta um número específico no Bling e recupera ou atualiza somente esse pedido. Exige carga anterior completa, recusa cursor ativo, confere número e período no detalhe e não move o watermark nem a data da carga em lote. Pedido ausente, ambíguo ou fora da janela não invalida a carga concluída; cotas da conta continuam sendo persistidas e respeitadas.

O workflow horário `.github/workflows/bling-extractions.yml` limita cada execução a 100 lotes e continua no próximo horário. **O agendamento só será ativado após incorporar a branch na main.** A execução manual atual funciona a partir da branch revisada sem essa incorporação.

## Recuperação de seleção do ERP

Quando a marca ficou sem provedor selecionado, uma conexão Bling já concluída pode ser restaurada pelo administrador. O endpoint exige vínculo anterior com empresa, tokens e data de carga concluída, recusa cursor ativo ou outro ERP selecionado e respeita cooldown. Renova o grant anterior para verificar o aplicativo, grava a rotação imediatamente, confere a mesma empresa e só então volta a selecionar o Bling. Não reinicia a carga nem altera histórico, canal, watermark, completedAt ou registros importados. Tanto aplicativo privado preservado quanto aplicativo do servidor são suportados. Não cria permissões OAuth ou amplia escopos.

## Conciliação com a Nuvemshop

O administrador seleciona o ID do canal Nuvemshop após conferi-lo na origem. Todos os canais continuam importados. O vínculo usa `numeroLoja` do pedido Bling e o número do pedido Nuvemshop, somente dentro da mesma marca e do canal selecionado.

Uma correspondência indica encontrado; nenhuma, pendente; mais de uma, ambíguo. A consulta agrupa os números da Nuvemshop uma vez por marca e usa junção sem multiplicar pedidos ou totais do ERP. Números vazios são excluídos. Canais e marcas diferentes não são associados mesmo quando os números coincidem.

**Encontrado confirma apenas o vínculo pelo número**, sem afirmar igualdade de valores, pagamento, itens ou status. CPF, e-mail ou semelhança de valor/data não deduzem vínculos. CPF e dados de contato não são persistidos no cache ERP; o cadastro guarda identificador, nome e situação.

Pedidos Nuvemshop antigos precisam ser atualizados pelo importador para preencher `sourceMetadata.nuvemshop.orderNumber`. O lookback da Nuvemshop pode ser menor que o período inicial do ERP; validar sua cobertura antes de concluir a conciliação. Os indicadores atuais do e-commerce continuam usando sua fonte atual, sem somar novamente as vendas do ERP.

## Validação e limites

A entrega mostra **valor registrado em pedidos, incluindo todas as situações**. Não representa receita paga, faturamento fiscal ou receita líquida. Situações são apresentadas com os códigos recebidos, sem inferir o significado de personalizações. Compradores são os que têm pedidos nos filtros; importar contatos não transforma fornecedores em compradores.

O catálogo mostra o último saldo importado, sem promessa de estoque em tempo real. Exclusões definitivas na origem ainda não são expurgadas automaticamente. Notas fiscais, recebimentos, cancelamentos/devoluções, custos, conferência financeira e por item e webhooks assinados com fila durável são próximas entregas.

**49 testes Bling passaram** com respostas sintéticas e PostgreSQL local descartável, além de typechecks e builds da API/frontend. Cobertura: OAuth e estado de uso único, permissões e isolamento, criptografia, renovação, empresa, cotas e cooldown, retomada exata, sucesso parcial concorrente, reservas compartilhadas, importação idempotente, contagens e conciliação ambígua sem multiplicar totais. A atualização complementar foi testada com marca explícita, pré-requisito de carga completa, preservação do cursor ativo e rejeição de detalhes fora da janela, inclusive de outro ano. A conferência individual cobre permissões, recuperação idempotente, preservação da carga anterior, resultado ausente/ambíguo, cursor ativo e cooldown da conta. Um teste retém a única conexão local além do timeout de aquisição e verifica a recuperação limitada.

Uma comparação com tabelas temporárias sintéticas confirmou resultados iguais da conciliação e reduziu as varreduras de pedidos Nuvemshop de 1.500 para uma. Esse resultado não é uma medição de desempenho em produção. O executor também foi validado com falhas simuladas de transporte, HTTP 5xx, respostas malformadas e rejeições permanentes.

```sh
BLING_TEST_DATABASE_URL=postgres://usuario@127.0.0.1:55438/bling_integration_test \
  pnpm --filter @workspace/api-server exec vitest run test/bling-api.test.ts test/bling-integration.test.ts
```

O teste aceita somente uma base local chamada `bling_integration_test` e trunca apenas essa base. Sem a variável, os testes de integração são pulados. A conferência real usa a conta autorizada, o mesmo período e todos os canais; totais comerciais e evidências ficam no registro privado local do piloto.

## Publicação do piloto

Código em `codex/bling-client-erp`, [PR #8](https://github.com/itsvitinhoin/up-dash-b2b/pull/8). Versão da conexão publicada em 23/11/2026: commit `8ad18df`, deployment `dpl_7LBp5JBwn2CJr7a6FtpjBtXNv6Qz`, projeto `prj_6lGvyKbSHVZWVZ6QFoqaAbe2IK6p`. A versão foi preparada sem alterar o domínio, passou nas verificações de saúde da API/banco e de rejeição de acesso sem autenticação e então foi promovida a `www.grupoup-dash.com.br`.

O layout compartilhado do B2B foi publicado em **24/11/2026**, commit `1674a18`, deployment `dpl_DFq1zSvuHQyUratJFnBwPv3JTsuN`. A navegação real conferiu as cinco telas, itens expansíveis, paginação e busca de pedidos, CSV completo com total e identificadores conferidos, pedidos por comprador, catálogo, filtro de saldo zero, depósitos e acesso ao diálogo de conexão. O ERP B2B também continuou exibindo seus oito cartões e as seções de gráficos após a extração dos componentes compartilhados. A atualização não iniciou outra importação.

Execução manual acompanhada: [run 45250966787](https://github.com/itsvitinhoin/up-dash-b2b/actions/runs/45250966787). A carga inicial e a [atualização complementar](https://github.com/itsvitinhoin/up-dash-b2b/actions/runs/45300289578) terminaram com sucesso. A conferência real comparou contagens por período/dia e identificadores, recuperou registros faltantes pela ação individual e confirmou igualdade com a origem no período encerrado. O Dash ficou no período de 30 dias, com o canal Nuvemshop salvo e sem erro de carga. Totais e evidências permanecem no registro privado local; a conciliação com a Nuvemshop ainda tem pendências. A main permanece inalterada. Incorporar esta branch antes do próximo release normal, que poderia substituir a versão do piloto.

Fontes oficiais consultadas: [Aplicativos e OAuth](https://developer.bling.com.br/aplicativos), [JWT](https://developer.bling.com.br/migracao-jwt), [referência da API](https://developer.bling.com.br/referencia), [limites](https://developer.bling.com.br/limites), [webhooks](https://developer.bling.com.br/webhooks).
