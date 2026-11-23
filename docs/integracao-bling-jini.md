# Bling no B2C — piloto Jini

Escopo confirmado em 18/11/2026: Jini utiliza Nuvemshop; importar **todos os canais do Bling**, identificados separadamente. Implementação integrada à versão de produção de 23/11/2026, em checkout isolado na branch `codex/bling-client-erp`. Nenhuma conta real foi autorizada nos testes.

## Primeira entrega implementada

- ERP disponível no B2C: visão geral por canal, pedidos com itens e conciliação, compradores do período, catálogo/SKUs e saldos físicos/disponíveis por depósito.
- Bling adicional à Nuvemshop, sem mudar `commercePlatform` e sem inserir cópias dos pedidos do ERP na tabela de vendas da loja.
- Conexão OAuth por marca; estado de uso único vinculado ao navegador; tokens JWT renovados no servidor e criptografados com AES-256-GCM. A renovação salva imediatamente o novo refresh token.
- Importação paginada com cursor persistido, exclusividade por marca, tratamento de falhas e retomada. Primeira carga de 30 dias de pedidos; catálogo e contatos completos. Histórico inicial configurável entre 1 e 365 dias.
- Atualizações de pedidos por data de alteração, com sobreposição de um dia. Catálogo, canais e contatos são consultados novamente a cada ciclo.
- Limite local de 1 chamada/s por conta conectada, abaixo do limite oficial de 3/s. Chamadas de outras integrações da mesma conta também consomem o limite do Bling; HTTP 429 interrompe o lote, preservando o cursor.
- Workflow horário em `.github/workflows/bling-extractions.yml`: até 100 lotes por execução, com continuação no próximo horário. O agendamento só começa após publicação do código/workflow e configuração do ambiente.

## Ativação

1. A migração aditiva é `0050_bling.sql`, alinhada à main `b429194`. O primeiro **Salvar configuração Bling** de um administrador cria somente as três tabelas Bling e seus índices, de forma idempotente, transacional e com exclusividade. A leitura inicial funciona antes de provisionar essas tabelas. Não executar diários antigos de migrações da raiz do workspace. O fluxo `migrate:bootstrap` existente reconhece os objetos já presentes quando o diário for conciliado no processo normal de migração.
2. Criar o aplicativo na **Central de Extensões → Área do Integrador** do Bling. Configurar somente estes cinco escopos de leitura: Clientes e Fornecedores, Controle de Estoque, Pedidos de Venda, Produtos e Visualizar os dados básicos da empresa. O escopo mais amplo Integrações e Lojas Virtuais não é necessário: se a consulta dos nomes dos canais retornar 403, o conector descobre os canais pelo `loja.id` dos pedidos, mantendo todos separados por ID. O conector consulta a API; não envia alterações à operação Bling.
3. Configurar no servidor:

   | Variável                     | Conteúdo                                                                     |
   | ---------------------------- | ---------------------------------------------------------------------------- |
   | `BLING_CLIENT_ID`            | Client ID do aplicativo                                                      |
   | `BLING_CLIENT_SECRET`        | Client Secret do aplicativo                                                  |
   | `BLING_REDIRECT_URI`         | `https://www.grupoup-dash.com.br/api/bling/callback` no ambiente de produção |
   | `BLING_TOKEN_ENCRYPTION_KEY` | Chave aleatória de 32 bytes em hexadecimal (64 caracteres)                   |

   A URL de retorno cadastrada no Bling deve ser idêntica à variável. Credenciais ficam no servidor; não devem ser enviadas pelo chat. Preserve a chave de criptografia entre deploys; trocar a chave exige um procedimento de recriptografia ou reconexão das contas.

4. Publicar a aplicação. Em **Clientes cadastrados → Jini → ERP → Bling**, preencher Client ID e Client Secret (ou selecionar o aplicativo já configurado no servidor), salvar e usar **Autorizar no Bling** e autorizar a empresa correta. A empresa conectada fica visível na tela; o mesmo ID de empresa não pode ser associado a duas marcas.
5. Manter 30 dias inicialmente e iniciar **Sincronizar**. O processo pode ser interrompido ao fim de um lote e retomado.
6. Selecionar explicitamente o canal correspondente à Nuvemshop na configuração Bling. Todos os demais canais continuam sendo importados.
7. Executar novamente a sincronização da Nuvemshop para registrar os números dos pedidos já existentes. O importador agora guarda `sourceMetadata.nuvemshop.orderNumber`, além do ID externo que já existia. O fluxo atual da Nuvemshop pode ter uma janela de importação menor que 30 dias: use a sincronização com o período completo do piloto, ou amplie o lookback conforme os parâmetros do importador.
8. Conferir o mesmo período nas telas Bling e Dash. Validar quantidade e valor dos pedidos por canal, itens, status, saldos por depósito e pendências de conciliação antes de usar os dados na operação.

## Regras de conciliação

- O canal Nuvemshop precisa ser selecionado por um administrador; não é inferido pelo nome do canal.
- `numeroLoja` do pedido Bling deve corresponder exatamente ao número do pedido Nuvemshop, dentro da mesma marca e do canal selecionado.
- Uma correspondência: encontrado. Nenhuma: pendente. Mais de uma: ambíguo. Pedidos de outros canais não são associados à Nuvemshop, mesmo quando seus números coincidem.
- “Encontrado” confirma o vínculo pelo número; não afirma igualdade de valores, pagamento, itens ou status. Conferências financeiras e por item serão uma etapa adicional.
- CPF, e-mail ou semelhança de valor/data não são usados para deduzir vínculos. CPF e dados de contato não são persistidos no cache do ERP; o cadastro importado guarda identificador, nome e situação.
- A tela ERP mostra os pedidos Bling uma vez cada; não soma suas vendas novamente às vendas Nuvemshop. Os indicadores atuais do e-commerce continuam sendo calculados por sua fonte atual.

## Limites e próximas entregas

Esta primeira entrega apresenta **valor registrado em pedidos, incluindo todas as situações**, não receita paga, faturamento fiscal ou receita líquida. Os IDs e códigos de situação são exibidos como recebidos, sem adivinhar o significado de situações personalizadas.

Para completar o projeto: mapear situações reais da Jini; integrar notas fiscais, recebimentos, cancelamentos/devoluções e custos; adicionar conferência de valores/itens entre as fontes; definir métricas financeiras; expandir o histórico em janelas de até um ano; implementar webhooks assinados com fila durável e reconciliação periódica. Não há receptor de webhooks nesta entrega.

O catálogo mostra o último saldo importado. Registros removidos definitivamente da origem ainda não são expurgados automaticamente do cache; uma futura rotina de reconciliação de exclusões ou webhooks deve cobrir esse caso. Não tratar o saldo como inventário em tempo real. Compradores na tela Clientes são os que possuem pedidos nos filtros selecionados; a carga de contatos não transforma fornecedores em compradores.

## Verificação

Os testes usam somente respostas Bling sintéticas e uma base PostgreSQL local descartável. Cobrem OAuth/navegador/uso único, permissões, isolamento entre marcas, criptografia, renovação, retomada, concorrência, identificação de canais, estoque e importação idempotente. Validação com dados reais da Jini permanece pendente da autorização da conta.

```sh
BLING_TEST_DATABASE_URL=postgres://usuario@127.0.0.1:55438/bling_integration_test \
  pnpm --filter @workspace/api-server exec vitest run test/bling-api.test.ts test/bling-integration.test.ts
```

O teste de integração só aceita uma base local chamada `bling_integration_test`, cria as tabelas mínimas se necessário e trunca **apenas essa base**. Sem a variável, esses testes são pulados.

Fontes oficiais consultadas em 18/11/2026: [Aplicativos e OAuth](https://developer.bling.com.br/aplicativos), [JWT](https://developer.bling.com.br/migracao-jwt), [referência da API](https://developer.bling.com.br/referencia), [limites](https://developer.bling.com.br/limites), [webhooks](https://developer.bling.com.br/webhooks). O contrato OpenAPI oficial foi consultado na versão publicada no dia da implementação.

## Configuração assistida em 23/11/2026

A permissão Cadastro de aplicativos do usuário Jini Escritório foi habilitada com autorização do usuário. A Área do Integrador passou a aparecer. O usuário preencheu o celular de contato e autorizou a criação com cinco escopos de leitura. O aplicativo privado UP Dash — Jini foi criado no Bling, ID `414729`, categoria Dashboards e BI, com callback de produção. Link administrativo: https://www.bling.com.br/cadastro.aplicativos.php#/form/414729 . O escopo Integrações e Lojas Virtuais ficou desativado; o conector foi ajustado para descobrir os IDs dos canais nos pedidos quando não houver permissão para consultar seus nomes.

Na versão publicada do Dash conferida nesta data, o cadastro de ERP da Jini oferece apenas Miredata e Manse. A configuração por cliente foi incorporada ao modal ERP existente, preservando os fluxos Miredata e Manse. As quatro variáveis `BLING_CLIENT_ID`, `BLING_CLIENT_SECRET`, `BLING_REDIRECT_URI` e `BLING_TOKEN_ENCRYPTION_KEY` foram configuradas como sensíveis, somente no ambiente production do projeto Vercel `data-intelligence-system`, ID `prj_6lGvyKbSHVZWVZ6QFoqaAbe2IK6p`. O segredo foi copiado pelo controle da própria tela, mantendo-o oculto, transferido por arquivo temporário com acesso restrito, e esse arquivo foi removido após a gravação no servidor. Nenhum valor secreto foi registrado nesta documentação. A autorização OAuth da conta e a primeira importação aguardam a publicação do conector: o aplicativo ainda estava com zero usuários autorizados na verificação desta etapa. Não usar o link de convite antes de a rota de callback estar publicada.

Verificação de 23/11/2026: 20 testes passaram usando respostas simuladas e PostgreSQL local descartável, incluindo a descoberta dos canais nos pedidos quando `/canais-venda` retorna 403; typechecks de API e frontend passaram. A opção Integrações e Lojas Virtuais ficou fora do aplicativo.

## Formulário por marca

As credenciais próprias de cada marca são cifradas em `clients.erp_credentials_encrypted` com a chave ERP existente; o segredo nunca retorna em respostas da API. Ao reabrir, deixar o segredo vazio mantém o valor salvo somente quando o Client ID continua igual. Trocar aplicativo exige nova autorização e preserva o vínculo com a empresa anterior para impedir mistura de dados. **Testar conexão** consulta os dados básicos da empresa autorizada sem importar pedidos.

O envio do formulário não autoriza automaticamente a conta Bling. Depois da autorização explícita no Bling, executar teste e primeira importação.

Validação do formulário integrado em 23/11/2026: 23 testes passaram, incluindo PUT no endpoint de ERP existente, primeiro salvamento sem tabelas prévias, credenciais próprias por marca, manutenção de segredo omitido, troca de aplicativo e teste de conexão sem importação. Builds de API/frontend e typecheck do workspace concluídos.

## Publicação do formulário

Publicado em 23/11/2026 no domínio `https://www.grupoup-dash.com.br`, a partir do commit `3e561e217026e7acc3dca78c0a7b4cc520467026` da branch `codex/bling-client-erp`. Deployment Vercel `dpl_C1GKfRQAa6iPxSekocJ3sYaBT91a`, projeto `prj_6lGvyKbSHVZWVZ6QFoqaAbe2IK6p`. A versão foi preparada com `--prod --skip-domain`, passou nas verificações de saúde (API e banco 200) e rejeição de callback inválido (400), e então promovida.

Verificação no domínio real: **Clientes cadastrados → Jini Cosméticos → ERP → Bling** apresentou Client ID, Client Secret protegido, URL de retorno, salvar, autorizar e testar. O formulário ficou aberto com os campos editáveis para o usuário. Não foi salvo nenhum vínculo da Jini nem concedida autorização OAuth nesta verificação. A primeira criação das tabelas ocorre no salvamento explícito. O usuário pode usar o aplicativo já configurado ou preencher um aplicativo próprio.

A branch foi enviada ao GitHub. A main não foi alterada; o workflow horário só será ativado após a incorporação na main. Até lá, a sincronização manual está disponível após autorização. Um deploy futuro da main sem esta alteração pode substituí-la; incorporar esta branch antes do próximo release normal. Evidência visual local: `output/bling-verification/bling-formulario-publicado.jpg`.

## Limites e retomada — ajuste de 23/11/2026

Após a primeira autorização real, a importação da Jini foi pausada em produtos/estoque, página 17, com HTTP 429. O retorno antigo não distinguia limite por segundo e limite diário. O conector agora lê somente o metadado documentado `error.period` e o cabeçalho `Retry-After`, mantém o tempo de pausa em `next_request_at` (sem migração adicional), devolve o horário de retomada e bloqueia novas chamadas à conta durante a pausa. Sem cabeçalho, usa 5s para limite por segundo, 60s para resposta desconhecida e 24h para limite diário. Uma cota diária nunca dispara repetição automática. Nenhum texto bruto da resposta Bling é exposto ou registrado.

A interface tenta retomar automaticamente pausas de até 60s, até três pausas consecutivas sem progresso, e mostra a espera. O usuário pode parar o processo. O ritmo foi reduzido para uma chamada por segundo, pois outras integrações compartilham a mesma cota. Progresso e tokens são preservados; não reconectar ou reiniciar o histórico para tratar HTTP 429.

27 testes passaram, incluindo retomada exata da página 17, preservação de registros anteriores, bloqueio de chamadas durante a pausa, diferenciação de cota diária e tratamento de Retry-After em segundos/data. Referência: https://developer.bling.com.br/limites .
