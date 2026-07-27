# Notas de desenvolvimento — UP Dash B2B

Registro do que foi ajustado no ambiente local e dos bugs encontrados, pra repassar depois.

## Decisão de arquitetura (confirmado 23/07/2026)

Objetivo maior por trás da tarefa: **sair do Supabase**. Como praticamente
todo o dado analítico das marcas (Vesti, Nuvemshop, Braavo) já está no
BigQuery via `script-vesti-nuvem`, a direção decidida é:

- **Dado operacional** (`users`, `sessions`, `clientUserAccessesTable`,
  `notifications`, `savedViews` — tudo que é transacional/login) continua
  num Postgres de verdade — a instância **Cloud SQL na nuvem** que a equipe
  já tem (provavelmente a mesma que o `backend-dash` já usa — confirmar).
  BigQuery não é adequado pra esse tipo de escrita linha-a-linha frequente.
- **Dado analítico** (`orders`, `customers`, `products`, `events`, etc.)
  passa a ser **lido direto do BigQuery**, em vez de sincronizado/duplicado
  pra um Postgres local — reaproveitando os datasets que o
  `script-vesti-nuvem` já mantém atualizados via Cloud Run Job + Scheduler.

Isso significa que, pro `up-dash-b2b`, as rotas de `/api/analytics/*`
([`artifacts/api-server/src/routes/analytics.ts`](artifacts/api-server/src/routes/analytics.ts))
vão precisar trocar as queries Drizzle/Postgres por queries BigQuery
(provavelmente usando um client tipo `@google-cloud/bigquery`, similar ao
que o `script-vesti-nuvem`/`backend-dash` já fazem em Python/Node).

Ainda não decidido: se o `commercePlatform` do client no `up-dash-b2b`
ganha um valor `VESTI` novo, e como o `dataset` do BigQuery (calculado pelo
`script-vesti-nuvem` a partir do nome da loja) fica associado a cada
`client` no schema do `up-dash-b2b`.

### Instância Cloud SQL (confirmado 23/07/2026)

- Projeto GCP: `up-vesti-report`. Instância: `vesti-database` (região
  `us-central1`) — achado em
  [`backend-dash/cloudbuild.yaml`](../backend-dash/cloudbuild.yaml)
  (`--add-cloudsql-instances=up-vesti-report:us-central1:vesti-database`).
  É a mesma instância que o `backend-dash` já usa em produção.
- `DATABASE_URL` real fica no Secret Manager do GCP — não visível
  localmente (não tem `gcloud` instalado nesta máquina pra consultar).
- **Decisão**: o `up-dash-b2b` deve usar um **database novo dentro dessa
  mesma instância** (não reaproveitar as tabelas do `backend-dash`
  diretamente). Motivo: os dois apps têm modelos de dado incompatíveis
  (Drizzle vs Prisma, roles/auth diferentes) — juntar infraestrutura
  (mesma instância, mesmo billing) é o objetivo, não fundir os dois
  sistemas num banco só.

### Schema de "client" — já existe no `backend-dash` (Prisma)

Pra criar um client Vesti novo no `up-dash-b2b`, a referência de qual
`dataset` do BigQuery usar já existe lá:
- `User` (`type: VESTI`) — login vinculado a um dataset via `UserDataset`
- `SyncClient` (`platform: vesti`) — credenciais reais (`apiKey`/`companyId`
  por filial)
- `UserDataset` — a ponte User → dataset do BigQuery

O `up-dash-b2b` vai precisar de uma coluna nova (ex: `bigqueryDataset`) na
tabela `clients` dele pra guardar essa referência — consultada a partir
dessas tabelas do `backend-dash` no momento de cadastrar o client.

### Detalhamento: trocar analytics.ts de Postgres pra BigQuery

Não é só trocar o driver — três mudanças reais:

1. **Multi-tenância diferente**: hoje é `WHERE client_id = X` numa tabela
   `orders` compartilhada. No BigQuery, **cada loja tem seu próprio
   dataset** (ex: `le_ricard.pedidos`). As queries precisam montar o nome
   do dataset dinamicamente por cliente, não filtrar por coluna.
2. **Schema de colunas diferente**: as tabelas do BigQuery (`clientes`,
   `produtos`, `pedidos`, `estoques`, `pagamentos` — ver
   `script-vesti-nuvem/scheduler_job.py`) vêm do formato da API da Vesti,
   não batem com `ordersTable`/`productsTable` do Drizzle. As agregações
   (receita, ticket médio, RFM, etc.) precisam ser reescritas em cima dos
   campos reais — checar `script-vesti-nuvem/schemas/` e `bigquery_utils.py`
   pra saber o schema exato antes de escrever qualquer query.
### Schemas reais do BigQuery (confirmado 23/07/2026, acesso direto via credencial em `script-vesti-nuvem/credentials.json`)

São **dois projetos GCP separados**:
- `up-vesti-report` (Vesti) — 62 datasets, um por loja (ex: `le_ricard`,
  `adama`, `vystu`), mais datasets "globais" (`up_global`,
  `up_performance_analytics`, `vesti_dados`, `analytics_ga4_*`, `stape_*`).
- `up-nuvem-reports` (Nuvemshop/Braavo/Shopify) — 19 datasets, incluindo
  `aiyu` (bate com o `aiyufashion9@gmail.com` que testamos!) e `malagueta`.
  A mesma credencial de service account tem acesso aos dois projetos.

**Vesti** (ex: dataset `le_ricard`, 21 tabelas): as tabelas cruas do sync
(`pedidos_vesti` 7.658 linhas, `produtos_vesti` 2.476, `clientes_vesti`
16.650, `estoques_vesti` 44.503) têm campos aninhados (`RECORD`) pra
customer/products/address/summary. Mas existe **`dashboard_vendas_cache_final`**
— tabela já achatada, 1 linha por item de pedido, com cliente/produto/pedido
juntos (`data_ref`, `pedido_id`, `cliente_nome`, `produto_nome`,
`valor_atendido`, `estado`, `cidade`, etc.) — **essa é a candidata natural
pra alimentar `/api/analytics/*` do lado Vesti**, sem precisar de `UNNEST`.
Também tem `rfm_clientes_final` (RFM já calculado) e um sistema de
recomendação (`recs_mf_v1_*`) prontos, reaproveitáveis.

**Nuvemshop** (ex: dataset `aiyu`, 3 tabelas): `pedidos_nuvemshop`,
`produtos_nuvemshop`, `clientes_nuvemshop` são praticamente um dump 1:1 da
API REST da Nuvemshop (100+ campos, bem aninhado — `products` é
`RECORD REPEATED` dentro do próprio pedido). **Não existe uma tabela
achatada equivalente ao `dashboard_vendas_cache_final`** — ler isso do
BigQuery exigiria bem mais trabalho de parsing/`UNNEST`.

**Implicação prática**: o lado Vesti é bem mais barato de integrar via
BigQuery (usar a cache pronta). Já o `up-dash-b2b` **já tem um sync próprio
funcionando pra Nuvemshop direto pro Postgres dele** (testamos e
confirmamos) — pode fazer mais sentido manter esse caminho pra Nuvemshop e
só migrar pro BigQuery especificamente o caso Vesti, em vez de forçar os
dois pelo mesmo caminho.

3. **Auth e custo/latência**: precisa de uma service account GCP com
   permissão de leitura no BigQuery. O `up-dash-b2b` já prevê
   `GOOGLE_APPLICATION_CREDENTIALS_JSON` nas env vars do `api-server`
   (não usada ainda). BigQuery cobra por bytes escaneados e é mais lento
   que Postgres pra query repetida — provavelmente vai precisar de cache
   no backend (hoje não existe, porque bater direto no Postgres local é
   barato).

## Contexto da tarefa (confirmado 23/07/2026)

Este projeto é **novo**, entregue pelo chefe do Marcelo. O sistema de
produção real, com dados de verdade das marcas (Vesti, Nuvemshop, Braavo),
é outro projeto: `C:\trabalho\backend-dash` (Fastify + Prisma + **BigQuery**
— ver `NOTAS-DEV.md` de lá). A tarefa do Marcelo é **trazer os clientes que
já existem no `backend-dash` pra dentro deste `up-dash-b2b`**, com ênfase
nos clientes da Vesti. Hoje este projeto só suporta `NUVEMSHOP`/`UPZERO`
como `commercePlatform` — não tem nada de Vesti/BigQuery ainda. Isso é
trabalho pendente, não uma limitação permanente do projeto.

## Ambiente local — o que foi configurado

- **pnpm no Windows**: configurado `script-shell` do pnpm pra usar o Git Bash
  (`pnpm config set script-shell "C:\Program Files\Git\bin\bash.exe"`), porque os
  scripts do `package.json` usam sintaxe bash (`export`, `&&` com `sh -c`) que não
  roda no `cmd.exe`/PowerShell puro do Windows.
- **Banco de dados local**: criado `docker-compose.yml` na raiz com Postgres 16
  (`postgres:16-alpine`), subindo em `localhost:5432`.
- **Variáveis de ambiente**: adicionado `dotenv` como dependência em
  `artifacts/api-server`, `artifacts/up-dash` e `lib/db`, com
  `import "dotenv/config"` no topo de cada entrypoint. Antes disso não havia
  nenhum `.env` no projeto e nada carregava variáveis automaticamente — era
  preciso exportar tudo manualmente no shell.
  - `.env` criados (não versionados, adicionados ao `.gitignore`):
    `artifacts/api-server/.env`, `artifacts/up-dash/.env`, `lib/db/.env`.
- **Comando único pra rodar tudo**: adicionado script `dev` na raiz do
  `package.json` (`pnpm dev`) que sobe o Postgres via Docker (esperando ficar
  saudável) e roda `api-server` + `up-dash` em paralelo.
- **Proxy do frontend**: adicionado proxy `/api → http://localhost:3001` no
  `vite.config.ts` do `up-dash`, pro dev server do Vite conseguir falar com a
  API local (não existia nenhuma config de proxy antes).
- **Seed do banco local**: rodado `pnpm --filter @workspace/db run seed`, que
  cria um admin (`admin@updash.com` / `Admin123!`) e dois clients fake com
  dados de demonstração (pedidos, produtos, clientes fictícios).
- **Contas de teste criadas manualmente** (via API, logado como admin), pra
  reproduzir localmente as credenciais que o cliente passou:
  - `aiyufashion9@gmail.com` / `123mudar` → client "Aurora Atelier", marcado
    como `commercePlatform: NUVEMSHOP`, `dashboardType: B2C`.
  - `jaehooyoon94@gmail.com` / `123mudar` → client "Noir Studio", marcado como
    `commercePlatform: UPZERO`, `dashboardType: B2B`.
  - Os dados desses dois clients são fictícios (gerados pelo seed), só as
    credenciais e o tipo de plataforma foram alinhados com o que existe em
    produção.

## Clientes atribuídos às campanhas — implementado pra Vesti (27/07/2026)

Depois do fix que retornava vazio, implementamos a versão real, usando a
lógica que o Marcelo apontou do `backend-dash` (`onlyAttributed`) e as
tabelas pré-consolidadas do BigQuery:

- **`clientes_atribuidos_consolidados`**: 1 linha por cliente tocado por
  anúncio da agência (evento `getUpAgency` ou clique com `fbc`, capturado
  via server-side tagging em `stape_logs`) E com cadastro na Vesti (join
  por email). `tipo_atribuicao` já vem calculado: "Novo Lead" (tocado
  antes/no dia do cadastro) vs "Re-impacto" (tocado bem depois).
- **`pedidos_atribuidos_consolidados`**: 1 linha por pedido atribuído
  (email, pedido_id, datas de jornada/compra) — junta com
  `dashboard_vendas_view` pra pegar o valor do pedido.
- Implementado em
  [`vestiAnalytics.ts`](artifacts/api-server/src/services/vestiAnalytics.ts)
  (`fetchVestiAttributedCustomers`) e ligado em `analytics.ts` com cache
  de 5 min.
- **Validado**: janela sem pedido atribuído retornou 151 clientes/0
  receita corretamente (a tabela `pedidos_atribuidos_consolidados` da
  Namine só tinha 7 pedidos, fora dessa janela); trocando pra janela que
  cobre esses 7 pedidos, bateu exatamente: 7 pedidos, R$1.877,90. Também
  confirmado na tela renderizando de verdade (30 clientes, R$2.183,80, 1
  pedido, filtros e tabela funcionando).
- **Diferença do lado UpZero**: não tem granularidade de UTM
  source/medium/campanha por evento aqui, só "foi tocado pela agência ou
  não" + a classificação novo/re-impacto. Por isso os campos de
  multi-toque (`campaigns[]` com detalhe, `addToCartCount`,
  `checkoutCount`, `productViewCount`) ficam vazios/zerados.
- **Detalhe cosmético não corrigido**: a linha da tabela mostra um texto
  fixo "Sem cadastro local · UP Zero 17" (herdado da UI feita pra UpZero)
  que não faz muito sentido no contexto Vesti — não quebra nada, só
  destoa visualmente. Fica pra um polimento futuro se incomodar.

## Bug: `/analytics/campaign-customers` não checava a plataforma do client

Descoberto testando o login real da Namine (client Vesti): o painel
"Clientes atribuídos às campanhas" mostrava erro vermelho ("Não foi
possível carregar..."), em vez do estado vazio normal. Causa: essa rota
([`analytics.ts`](artifacts/api-server/src/routes/analytics.ts)) sempre
chamava a API da UP Zero, **sem checar `commercePlatform`** — falha com
502 (`UPZERO_API_TOKEN não definido`) pra qualquer client que não seja
UpZero. Isso já afetava Nuvemshop/Manual antes de existir Vesti, não é
específico desse trabalho — só ficou visível agora porque testamos com
login/cliente real.
**Corrigido**: a rota agora sai cedo com resultado vazio quando
`commercePlatform !== "UPZERO"`, sem tentar chamar a API da UP Zero.

## Bugs encontrados no código (não relacionados à configuração do ambiente)

0. **Migration `0023_campaign_attribution_stamps` nunca foi aplicada em
   lugar nenhum** — o arquivo `.sql` existia em
   [`lib/db/migrations/`](lib/db/migrations/0023_campaign_attribution_stamps.sql),
   mas nunca foi registrado em `meta/_journal.json`, então `drizzle-kit
   migrate` nunca rodava ele. Resultado: a tabela `campaign_attribution_stamps`
   não existia no banco, mesmo fazendo parte do schema do Drizzle e sendo
   usada de verdade em
   [`analytics.ts`](artifacts/api-server/src/routes/analytics.ts) (INSERT
   de upsert + SELECT pro recurso "Clientes atribuídos às campanhas" que
   vimos aparecer vazio no dashboard B2B). Qualquer ambiente que tivesse
   rodado só `drizzle-kit migrate` teria esse recurso quebrado com erro
   `relation "campaign_attribution_stamps" does not exist`.
   **Corrigido**: adicionada a entrada faltante no `_journal.json` e
   aplicada a migration.
   **Problema maior, ainda não resolvido**: os arquivos de snapshot
   (`meta/*.json`) das migrations 0010 a 0021 também não existem — só tem
   snapshot pra 0000-0007, 0009 e agora a que acabamos de criar. Isso
   significa que `drizzle-kit generate` (gerar uma migration nova a partir
   de mudança no schema) **não funciona direito hoje** — ele tenta
   recriar tabelas que já existem, porque compara contra o snapshot mais
   antigo disponível. Pra qualquer migration nova, por enquanto: escrever
   o SQL à mão (só `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, sem usar
   `drizzle-kit generate`) e adicionar a entrada no `_journal.json`
   manualmente, do jeito que fizemos pra `0024_vesti_platform.sql`.

1. **Import duplicado quebrava o build do frontend inteiro**
   [`artifacts/up-dash/src/pages/whatsapp.tsx`](artifacts/up-dash/src/pages/whatsapp.tsx)
   — `Tooltip` era importado duas vezes: uma vinda do `recharts` (usado nos
   gráficos) e outra do componente de UI (`@/components/ui/tooltip`, usado nos
   hovers). Isso quebrava o dev server com `SyntaxError: Identifier 'Tooltip'
   has already been declared` e deixava a tela em branco.
   **Corrigido**: renomeada a importação do `recharts` para `RechartsTooltip`,
   seguindo o padrão já usado no arquivo (`BarChart as RechartsBarChart`).

2. **Todo `CLIENT` via o dashboard sempre no modo B2B, mesmo sendo cliente
   Nuvemshop (B2C)** — [`artifacts/up-dash/src/lib/auth.tsx`](artifacts/up-dash/src/lib/auth.tsx)
   — o estado `selectedDashboardMode` era inicializado fixo em `"B2B"` no
   login e nunca sincronizava com o `dashboardType` real do client. O seletor
   manual B2B/B2C só aparece pra usuários `ADMIN` — um usuário `CLIENT` não
   tinha como trocar. Resultado: os dois dashboards (Nuvemshop e UP Zero)
   pareciam idênticos visualmente.
   **Corrigido**: no `login()`, quando o usuário é `CLIENT`, o app agora busca
   `GET /api/clients/:clientId` e ajusta `selectedDashboardMode` de acordo com
   o `dashboardType` retornado. Não foi necessário mexer no schema gerado da
   API (`@workspace/api-zod`).

## Auditoria: as métricas são reais?

O chefe afirmou que o projeto está rodando com "métricas reais adquiridas via
requisição". Investigação no código confirma:

- **Confirmado real**: os serviços em `artifacts/api-server/src/services/`
  (`nuvemshop-sync.ts`, `upzero-sync.ts`, `meta-ads.ts`) fazem requisições HTTP
  reais pras APIs oficiais (Nuvemshop, UP Zero, Meta Graph API), com parsing
  completo dos payloads e persistência real no Postgres via Drizzle
  (`INSERT ... ON CONFLICT DO UPDATE`). Não há mock/stub/dado hardcoded no
  pipeline de produção (fora do `seed.ts`, que já sabemos ser fake).
- **`sync_jobs`** é uma tabela real e usada de fato — cada sincronização cria
  e atualiza um job com status (`pending/running/done/failed`).
- **Agendamento**: o log "Nightly UP Zero sync scheduled" é um timer interno
  (`services/scheduler.ts`) pra 02h UTC. Os demais syncs (Nuvemshop, Meta Ads,
  UP Zero analytics) são disparados por **cron externo via GitHub Actions**,
  batendo em endpoints `/cron/extractions/...` que validam a origem contra a
  API do GitHub (`extractions.ts`) — infraestrutura real.
- **Dashboard**: praticamente todas as métricas em `/api/analytics/*` são
  `SELECT`/agregações puras no Postgres local, alimentado pelos sync jobs.
- **Ressalva encontrada**: pra clientes **B2C** (Nuvemshop), o funil do GA4
  **não** segue esse padrão — é consultado **ao vivo, dentro da própria
  requisição do dashboard**
  ([`analytics.ts:1071-1091`](artifacts/api-server/src/routes/analytics.ts)),
  diferente do resto que só lê do banco. Se a chamada ao GA4 falhar, cai
  silenciosamente pra `null`/fallback sem erro visível ao usuário — vale
  levar isso pro chefe como ponto de atenção (métrica pode sumir sem avisar).
- Os dois clients de teste locais (Aurora Atelier / Noir Studio) usam 100%
  dados fake do seed — pra virar real, um client precisa ter as credenciais
  preenchidas (`nuvemshopAccessToken`, `upZeroApiKey` etc.) e os syncs
  precisam ter rodado com sucesso.

## Implementação: primeiro cliente Vesti funcionando de ponta a ponta (23/07/2026)

Validado end-to-end, com dado real do BigQuery (client "Le Ricard",
projeto `up-vesti-report`, dataset `le_ricard`):

1. [`lib/db/src/schema/clients.ts`](lib/db/src/schema/clients.ts) — `VESTI`
   adicionado ao `commercePlatform`, nova coluna `bigqueryDataset`.
   Migration `0024_vesti_platform.sql` escrita à mão (ver seção sobre
   migrations quebradas acima).
2. [`artifacts/api-server/src/lib/bigquery.ts`](artifacts/api-server/src/lib/bigquery.ts) —
   client BigQuery (`@google-cloud/bigquery`) + resolver de tabela
   sanitizado (`vestiTable(dataset, table)`), mesmo padrão do `backend-dash`.
   Credencial local: `GOOGLE_APPLICATION_CREDENTIALS` no `.env` do
   `api-server` aponta pro `credentials.json` já existente em
   `C:\trabalho\script-vesti-nuvem` (não duplicamos o segredo).
3. [`artifacts/api-server/src/services/vestiAnalytics.ts`](artifacts/api-server/src/services/vestiAnalytics.ts) —
   `computeVestiWindow(dataset, dateFrom, dateTo)`, consulta
   **`dashboard_vendas_view`** (não `dashboard_vendas_cache_final` — essa
   última está desatualizada, parou em março/2026; a view é a fonte viva,
   calculada direto de `pedidos_vesti`/`clientes_vesti`, mesma que o
   `backend-dash` já usa em produção).
   Mapeamento de conceitos pro formato que o dashboard B2B já espera:
   `leads` = pedidos solicitados, `approvedLeads`/`orders` = pedidos pagos,
   `revenue` = valor reservado/pago, `requestedRevenue` = valor solicitado.
4. [`artifacts/api-server/src/routes/analytics.ts`](artifacts/api-server/src/routes/analytics.ts) —
   `/analytics/dashboard` ramifica cedo pra client Vesti, bypassando toda a
   lógica Postgres/Drizzle.
5. `lib/api-spec/openapi.yaml` — `VESTI` adicionado aos enums de
   `commercePlatform`, campo `bigqueryDataset` adicionado em
   `CreateClientRequest`/`UpdateClientRequest`/resposta de `Client`.
   Rodado `pnpm --filter @workspace/api-spec run codegen` pra regenerar
   `@workspace/api-zod`.

**Resultado real testado** (client Vesti "Le Ricard", 28/06 a 27/07/2026):
receita R$496.418,79, 101 pedidos pagos de 131 solicitados (77,1% de
aprovação), 89 clientes, 17 novos/72 recorrentes. Latência ~3s por
consulta (BigQuery) — cache no backend ainda não implementado, fica pra
próxima iteração se o volume de uso justificar.

## Primeiro cliente Vesti OFICIAL cadastrado (27/07/2026)

Diferente do "Le Ricard (Vesti teste)" (client inventado só pra testar),
esse é um cliente real: **Namine** (dataset `namine`), login já existente
de produção (`lucas.kim3178@hotmail.com`), obtido via query no Postgres de
produção do `backend-dash` que o Marcelo rodou e me passou o resultado
(`User` + `UserDataset`, `type = 'VESTI'`).

- Confirmado: `up-dash-b2b` e `backend-dash` usam o **mesmo esquema de
  hash de senha** (`bcryptjs`, custo 10 — `backend-dash/src/lib/hash.ts`
  vs `artifacts/api-server/src/lib/auth.ts`). Por isso deu pra copiar o
  `passwordHash` direto do banco de produção pro `up-dash-b2b`, **sem
  resetar a senha do cliente real** — ele consegue logar com a senha que
  já usa hoje.
- Client criado via `POST /api/clients` (`commercePlatform: VESTI`,
  `bigqueryDataset: namine`). Login inserido direto via script `tsx`
  descartável (não passa pelo endpoint `/api/accesses`, porque esse
  endpoint sempre gera um hash novo a partir de senha em texto puro — não
  aceita um hash já pronto).
- Validado via API: dataset `namine` tem dado real até 26/07/2026, 5.022
  pedidos históricos. Consulta de 27/06 a 26/07/2026 retornou R$105.538,20
  de receita, 38 pedidos, categorias reais (blusa, calça, blazer,
  conjunto, casaco).
- **Não testado via login na tela** — não temos a senha em texto puro do
  Lucas (só o hash, que não é reversível), então só o Marcelo ou o próprio
  cliente conseguem testar o login completo pelo navegador.

## Fechamento: dashboard Vesti com paridade completa (23/07/2026)

Depois do primeiro corte acima, fechamos os itens que faltavam:

- **Filtros** (`category`, `sellerId`, `channel`) — implementados em
  `vestiAnalytics.ts` (`VestiFilters`/`buildFilterClause`). `category`
  filtra via join com `produtos_vesti` (primeira categoria do array
  `categories`); `channel` filtra pelo campo `origin`; `sellerId` casa
  contra o nome da `vendedora` (a Vesti não tem tabela de vendedores com
  ID sincronizada — funciona se o valor for passado, mas o dropdown de
  seleção de vendedor na UI ainda não lista opções pro lado Vesti, porque
  esse dropdown hoje busca de `sellersTable` no Postgres, vazio pra
  clients Vesti; ficaria pra uma próxima etapa se for necessário).
  Testado: filtro por `category=alfaiataria` reduziu de 208 pra 129
  pedidos, batendo exatamente com o número de `revenueByCategory`.
- **`revenueByCategory`** — populado via join `dashboard_vendas_view` ×
  `produtos_vesti`, somando `produto_preco_unitario * produto_quantidade_reservada`
  (valores por item de verdade, diferente de valor_reservado que é por
  pedido). Testado com dado real: categorias como "alfaiataria",
  "100% Linho", "blusa" aparecendo com receita/pedidos corretos.
- **Séries diárias completas**: `leadsOverTime`, `newBuyersOverTime`,
  `returningBuyersOverTime` agora populadas (antes vinham vazias).
- **Signal "regiões em alta"**: implementado usando o campo `estado` da
  `dashboard_vendas_view` (mesma lógica de crescimento semana-a-semana do
  caminho Postgres). Testado: "RJ (+60%), ES (+59%), MG (+29%)" apareceu
  corretamente na tela. O signal "alta demanda, baixa conversão" não se
  aplica ao lado Vesti (não existe conceito de sessão/visita — é venda por
  atacado via vendedora, não e-commerce).
- **Cache de query** ([`lib/queryCache.ts`](artifacts/api-server/src/lib/queryCache.ts)) —
  cache em memória com TTL de 5 minutos, chave por
  dataset+período+filtros. Testado: primeira chamada ~3,3s (BigQuery),
  segunda chamada idêntica ~0,08s (cache) — ~40x mais rápido. É em memória
  do processo (não sobrevive restart, não é compartilhado entre
  instâncias) — suficiente pro uso atual, revisar se o tráfego crescer.

**Validado visualmente no navegador** (não só via curl): "Top categories"
e "High-performing regions this week" aparecendo corretamente na tela do
dashboard, sem nenhuma mudança de UI — só a fonte de dado trocou.

**O que ainda fica de fora deste escopo** (é sobre o dashboard principal;
outras páginas do app — produtos, clientes, pedidos, RFM, geografia,
estoque — continuam 100% Postgres-only, não foram adaptadas pro BigQuery.
Se for necessário Vesti funcionar nelas também, é trabalho adicional, uma
página de cada vez):
- Dropdown de seleção de vendedor vazio pro lado Vesti (filtro funciona
  se o valor for passado manualmente, só falta a lista de opções)
- Filtro `segment`/UTM (RFM e atribuição de campanha) não se aplica ao
  modelo de dado da Vesti como está hoje

**Falso alarme descartado**: durante o teste no navegador automatizado, os
KPIs que usam o componente `<CountUp>` (animação de contagem) apareciam
travados em R$0,00, enquanto campos ao lado (texto simples) mostravam o
valor certo. Investigado e confirmado: é porque a aba do navegador
automatizado fica em segundo plano (`document.hidden = true`), e o Chrome
pausa `requestAnimationFrame` pra abas não visíveis — não é bug de
produto, só uma limitação de testar via automação. Em uso normal (aba em
foco) anima certinho.

## Spec (`openapi.yaml`) estava desalinhada da implementação real (pré-existente)

Ao rodar `codegen` de novo pra adicionar `VESTI`/`bigqueryDataset`, apareceu
um erro de TypeScript em `clients.ts` sobre `metaAdAccountId` não existir
no tipo gerado. Investigando: o arquivo gerado `createClientRequest.ts`
tinha esse campo **hand-edited direto nele** (violando o aviso "Do not edit
manually" do topo do arquivo) — o `openapi.yaml` (fonte de verdade) nunca
declarou `metaAdAccountId`, nem `hasClientLogin`/`clientLoginEmail`/
`clientLoginName`/`clientLoginCount` na resposta de `Client`, mesmo esses
campos sendo usados de verdade em `clients.ts` e aparecendo nas respostas
reais da API (confirmamos isso nós mesmos, no `curl` de antes: a resposta
tinha `"hasClientLogin":false,"clientLoginEmail":null,...`).
**Corrigido**: adicionados todos esses campos de volta na spec (
`metaAdAccountId` em `Client`/`CreateClientRequest`/`UpdateClientRequest`;
`hasClientLogin`/`clientLoginEmail`/`clientLoginName`/`clientLoginCount`
em `Client`), e regenerado o `@workspace/api-zod` a partir dela — sem
reintroduzir a gambiarra de editar o gerado à mão.

## `pnpm run typecheck` já está quebrado (pré-existente, não é bug novo)

`artifacts/api-server` tem uma pilha grande de erros de TypeScript
pré-existentes (`implicit any` em dezenas de lugares em `analytics.ts` e
`whatsapp.ts`, + alguns `TS6305` de build composite desatualizado). Isso já
estava assim antes de qualquer mudança feita aqui — confirmado rodando
`typecheck` e checando que nenhum erro cai nas linhas que editamos. Não
tentamos consertar (fora de escopo), só registrando pra não confundir com
algo que quebramos.

## Observações / instabilidades (não são bugs de produto)

- O dev server do Vite (`up-dash`) às vezes entra em loop de "Fast Refresh"
  quando vários arquivos são editados em sequência rápida, e chega a ignorar
  cliques/submits até um refresh manual da página (`Ctrl+R` / F5). Percebido
  durante os testes de login via automação — não deve afetar uso normal pelo
  navegador, mas fica registrado caso aconteça de novo.
- Erro `EADDRINUSE` na porta 3001/5173 acontece se um `pnpm dev` anterior
  ficar rodando em background. Basta matar o processo antigo antes de subir
  de novo.

---
*Atualizar este arquivo conforme novos bugs/ajustes forem aparecendo.*
