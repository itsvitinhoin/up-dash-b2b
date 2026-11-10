# GA4 guardado no banco (lista de clientes sem chamar o Google ao vivo) — 20/10/2026

**Em uma frase:** a lista de clientes (`GET /clients`) pedia as sessões do GA4 ao
Google, ao vivo, pra cada loja B2C a cada recarga. Agora um job (`TASK=ga4_daily`)
grava as métricas por dia em `ga4_daily_metrics` e a lista só lê o que está
guardado — o mesmo princípio do dash legado (GA4 → BigQuery, tela só lê).

## O que foi medido (produção, 20/10/2026)

| | tempo |
|---|---|
| `GET /clients` B2C sem datas (só banco) | ~0,5 s |
| `GET /clients` B2C com datas (como a tela faz) | 2,4 a 6,1 s (mediana ~3 s) |
| `GET /clients` B2B com datas (sem GA4, controle) | ~1,07 s |

A diferença B2C × B2B (~2 s) é o GA4 ao vivo. Das 7 lojas B2C com GA4, 4 voltavam
vazias (Giah Studio, Pêo, Sonmur, Sooé): o Google recusava a consulta e o erro era
engolido (`Promise.allSettled` + `console.warn`). Causa provável (não confirmada):
a service account do GA4 sem acesso a essas propriedades.

## O que mudou

- **Tabela** `ga4_daily_metrics` (migration `0043`, idempotente): uma linha por
  (cliente, dia) com sessões, pageviews e eventos do funil. Dias sem tráfego
  entram com zero — "tem linha" = "já sincronizou", e a lista distingue "sem dado
  ainda" (`null`) de "0 sessões".
- **Job** `TASK=ga4_daily` (`runGa4DailyExtraction`): sem histórico guardado faz
  backfill de `GA4_BACKFILL_DAYS` (400); depois só os últimos `GA4_LOOKBACK_DAYS`
  (3) dias, porque o GA4 ainda revisa ontem/anteontem. `LOOKBACK_DAYS=N` força a
  janela. Também roda dentro do `hourly_bundle` (o GA4 não derruba o pacote: erro
  geral é logado e o resto segue).
- **Falha visível:** cada loja gera uma linha em `sync_jobs` (`job_type =
  ga4_daily`); recusa do Google ou falta de credencial fica em `sync_jobs.error`.
- **Lista:** `sumGa4SessionsByClient` soma as sessões do período direto da tabela,
  dentro do mesmo `Promise.all` das outras consultas. Se a leitura falhar, a lista
  abre sem a coluna (não dá 500).
- Não reaproveita `daily_client_metrics.visits`: aquela coluna conta eventos VISIT
  da UpZero e é sobrescrita por `refreshDailyClientMetrics`.

## Telas de um cliente só (dashboard, funil, pedidos, escala)

As 6 chamadas ao vivo de funil/série diária em `routes/analytics.ts` agora usam
`getGa4Funnel`/`getGa4Daily`: leem de `ga4_daily_metrics` e **só caem no GA4 ao vivo**
se a loja não tem dado guardado utilizável — sem linhas ainda (loja sem acesso no GA4),
período que começa antes do que foi guardado, ou job parado há mais de 48 h. Assim a
troca não tira dado de quem funciona ao vivo hoje (Aiyu e Hot Pink, por exemplo, até
ganharem acesso). Quando as 7 lojas sincronizarem, o ramo ao vivo pode sair.

**Atenção na lista de clientes:** ela NÃO tem esse fallback (o ao vivo era justamente o
que a deixava lenta). Loja sem dado guardado aparece com a coluna vazia na lista. Por isso
só publicar depois de Aiyu e Hot Pink terem acesso.

## Visualizações por produto (tabela de produtos B2C)

Também guardadas: `ga4_product_views_daily` (migration 0046, antes 0044), uma linha por
(cliente, dia, item) do evento `view_item`, gravada pelo mesmo job `ga4_daily` — o equivalente
ao `analytics_ga4_view_item` que o legado mantém no BigQuery. O job busca tráfego e produtos
**antes** de gravar qualquer um (se um falhar, nada muda) e regrava a janela inteira de produtos
(o GA4 revisa contagens recentes). `getGa4ProductViews` lê daqui, com o mesmo fallback ao vivo.

## Também no BigQuery (`up_global.ga4_daily`) — 06/11/2026

O mesmo job passa a gravar, a partir da MESMA busca no GA4, em duas tabelas do projeto
`up-vesti-report` (dataset `up_global`, onde o `up_semantic` e a lista `ads_accounts` já moram). É o
caminho para os agentes do Victor, e substitui aos poucos o pipeline antigo do `script-vesti-nuvem`
(que grava em `up-nuvem-reports`, 4 propriedades fixas em `propriedades_ga4.json`).

| Tabela | Uma linha por | Colunas |
|---|---|---|
| `ga4_daily` | cliente × dia (inclusive dia com zero) | `client_id`, `client_name`, `property_id`, `date`, `sessions`, `total_users`, `page_views`, `view_item`, `add_to_cart`, `begin_checkout`, `purchases`, `purchase_revenue`, `synced_at` |
| `ga4_product_views_daily` | cliente × dia × item | `client_id`, `client_name`, `property_id`, `date`, `item_id`, `item_name`, `item_variant`, `items_viewed`, `synced_at` |

Ambas particionadas por `date` e agrupadas por `client_id`; criadas sozinhas na primeira rodada
(`CREATE TABLE IF NOT EXISTS`). Cliente novo com `ga4_property_id` cadastrado entra sem criar tabela.

- **Gravação sem duplicar:** `ga4_daily` usa `MERGE` por (cliente, dia). Os produtos, em janela curta (até 4000 linhas, o caso da
  rodada horária), também usam um `MERGE` só (atualiza, insere e apaga o que o GA4 deixou de devolver); em janela longa (backfill) vão
  para uma tabela temporária (expira em 1 h) e a janela do cliente é trocada numa transação só. Falha no meio não deixa a tabela pela metade.
- **Ordem:** produtos primeiro, diário por último. O diário é o marcador de cobertura: sem ele, o cliente não tem
  histórico no BigQuery e a rodada seguinte refaz o backfill dos dois.
- **Histórico próprio:** o BigQuery tem a sua cobertura (lida de `ga4_daily` no começo de cada rodada), independente do
  Postgres. Uma busca no GA4 cobre a mais larga das duas janelas. Se não for possível ler a cobertura (erro do BigQuery),
  aquela rodada grava só no Postgres.
- **Retomada depois de job parado:** a janela agora recomeça no último dia guardado (Postgres e BigQuery), com teto de
  `GA4_BACKFILL_DAYS`. Sem isso, o buraco de 21/10 a 03/11 de Giah e Jini (job parado) ficaria para sempre.
- **Falhas separadas:** Postgres e BigQuery são gravados em paralelo e um não derruba o outro; `sync_jobs.error` mostra
  `Postgres: …` e/ou `BigQuery: …`.
- **Dataset de teste:** `GA4_BQ_DATASET=ga4_teste` desvia as duas tabelas para outro dataset (criado sozinho se não existir),
  para a primeira rodada num job canário sem tocar em `up_global`. Nome inválido dá erro, nunca cai no padrão. Para virar
  produção basta tirar a variável. Apagar o dataset de teste depois é manual.
- **Desligar:** `GA4_BIGQUERY=0` no job (volta a gravar só no Postgres). Sem credencial do Google (dev/teste) fica desligado sozinho.
- **Correções incluídas:** `eventCount` → `itemsViewed` nas consultas por item (o Google recusava o pedido inteiro: foi o que
  derrubou Giah/Jini desde 20/10) e aspas em `->>'productFrom'` (sem elas o Postgres leria uma coluna).
  A conta do job (`…-compute@…`) precisa de escrita no dataset `up_global` — o publicador de `ads_accounts` já usa a mesma.

Validação feita só com BigQuery de mentira nos testes e *dry-run* do Google (sintaxe das tabelas aceita; `MERGE`/`INSERT`
só passaram da análise de sintaxe, a análise completa depende das tabelas existirem). A primeira rodada real precisa ser
conferida: ver "Como conferir".

## Ordem de publicação (importante)

> **Cuidado com `:latest`:** o job horário (`upzero-sync-job-hourly`) usa a tag `:latest`. Em 03/11 e 04/11 builds da `main`
> sobrescreveram `:latest` sem o `ga4_daily` e o GA4 parou de rodar em silêncio. Faça este código entrar na `main` ANTES do
> próximo build da `main`, ou o build seguinte apaga o GA4 de novo.

1. **Banco de produção** (`up_dash_b2b`, Cloud SQL Studio): rodar, nesta ordem,
   `lib/db/migrations/0045_ga4_daily_metrics.sql` e `0046_ga4_product_views_daily.sql` (as duas idempotentes; renumeradas em 06/11 por
   causa das `0043`/`0044` do Braavo na main — o conteúdo é o mesmo das antigas `0043`/`0044`, que **já estão aplicadas em produção**: as duas tabelas existem lá). Antes do deploy
   da Vercel — se faltar, a lista abre sem o GA4 (aviso no log), mas não é o
   objetivo.
2. **Imagem do job** (build é manual, da raiz do repo):
   `gcloud builds submit --project=up-vesti-report --config=artifacts/api-server/cloudbuild.job.yaml --substitutions=SHORT_SHA=$(git rev-parse --short HEAD) .`
   > **Atualizado em 06/11/2026:** o job agora le com a chave da conta da agencia (`upagency.oficial@gmail.com`), e a conta de servico
   > abaixo ficou so de reserva. A conta que o cliente precisa pôr como **Leitor** da propriedade e a da agencia — ver
   > `docs/ga4-agencia.md`. O texto antigo a seguir fica como historico.

3. **Credencial do GA4: nao precisa de chave.** Dentro do Cloud Run o job usa a
   identidade da propria execucao (ADC), igual ao `script-vesti-nuvem` (que le o GA4
   todo dia sem arquivo de chave: `credentials.json` esta no `.dockerignore`). O job
   `upzero-sync-job` roda como `928204832932-compute@developer.gserviceaccount.com`,
   a mesma conta do job legado, que ja le Giah Studio, Jini e Malagueta. Falta so
   essa conta ser **Leitor** nas propriedades das lojas que ela ainda nao enxerga
   (o primeiro backfill mostra quais em `sync_jobs.error`). Fora do Cloud Run, sem
   `GA4_SERVICE_ACCOUNT_JSON`, o job falha por cliente com "GA4 sem credencial".
4. **Backfill** (uma vez, e o `hourly_bundle` mantém depois):
   `gcloud run jobs execute upzero-sync-job --project=up-vesti-report --region=us-central1 --update-env-vars=TASK=ga4_daily,TRIGGER=manual --wait`
   (ou `CLIENT_ID=<id>` pra uma loja). O job `hourly` aponta pra `:latest`, então
   pega o código novo sozinho depois do build.
5. **Push na `main`** (deploy da Vercel) — só depois de a tabela estar populada,
   senão a coluna de conversão da lista fica vazia até o primeiro sync.

## Como conferir

```sql
-- quais lojas sincronizaram e até quando
SELECT c.name, count(*) AS dias, max(g.metric_date) AS ate, sum(g.sessions) AS sessoes
FROM ga4_daily_metrics g JOIN clients c ON c.id = g.client_id
GROUP BY c.name ORDER BY c.name;

-- falhas do job (as 4 lojas sem acesso devem aparecer aqui)
SELECT c.name, j.error, j.created_at
FROM sync_jobs j JOIN clients c ON c.id = j.client_id
WHERE j.job_type = 'ga4_daily' AND j.status = 'failed'
ORDER BY j.created_at DESC LIMIT 20;
```

No BigQuery (`up-vesti-report`):

```sql
-- quem já está lá e até quando (deve bater com o Postgres)
SELECT client_name, MIN(date) AS de, MAX(date) AS ate, COUNT(*) AS dias, SUM(sessions) AS sessoes
FROM `up-vesti-report.up_global.ga4_daily`
WHERE date >= DATE '2000-01-01'
GROUP BY client_name ORDER BY client_name;

-- Giah/Jini: as sessões por dia devem ser IGUAIS às do pipeline antigo (mesmas propriedades)
SELECT a.date, a.sessions AS novo, b.sessions AS antigo
FROM `up-vesti-report.up_global.ga4_daily` a
JOIN `up-nuvem-reports.analytics_ga4_traffic.giah_studio` b ON b.date = a.date
WHERE a.client_name = 'Giah Studio' AND a.date >= DATE '2026-10-01' AND a.sessions != b.sessions;
```

## Rollback

Reverter o commit (a lista volta a chamar o GA4 ao vivo). A tabela pode ficar; não
atrapalha nada. Só o BigQuery: `GA4_BIGQUERY=0` no job. As tabelas `up_global.ga4_*` podem ficar.

## Fora deste passo (de propósito)

- A decisão estrutural continua sendo levar o backend pro Cloud Run (us-central1,
  junto do banco) e o botão "Sincronizar" da Nuvemshop disparar o job existente.
- Acesso da service account às 4 propriedades que recusam é ação humana no GA4
  (Administrador → Gerenciamento de acesso → Leitor). Em 06/11 são 5: Aiyu, Hot Pink, Pêo, Sonmur e Sooé.
- **Feito em 06/11 (branch `feature/ga4-acabamento`):** a exclusão definitiva (lixeira de 90 dias) agora também apaga as linhas do
  cliente em `up_global.ga4_daily` / `ga4_product_views_daily` (chave `client_id`; respeita `BQ_PURGE_ENABLED`); o campo
  "Propriedade GA4" existe na edição de qualquer cliente (B2C e B2B), não só na criação; a verificação de dado parado
  (`TASK=check_data_freshness`) está em `docs/ga4-alerta.md`.
- Tráfego por origem/mídia/campanha (tabela própria): fase 2, depende do que os agentes do Victor precisam.
- Descoberta das propriedades que a conta enxerga (exige ativar a Analytics Admin API no projeto).
- Backoff para cliente sem acesso: hoje cada um registra uma linha `failed` em `sync_jobs` por hora até virar Leitor.

## Onde ficam os produtos (09/11/2026)

O GA4 vai para **dois lugares**: o Postgres do painel (alimenta as telas B2C) e o BigQuery `up_global` (análises e agentes). Para
**visualizações de produto** (`ga4_product_views_daily`) a regra agora é:

| Cliente | Postgres | BigQuery |
|---|---|---|
| **B2C** | grava (a tela de **Produtos** lê de lá) | grava |
| **B2B** | **não grava** (nenhuma tela B2B lê) | grava |

Por quê: em 09/11 a tabela do Postgres tinha 1,1 milhão de linhas e 323 MB num banco de 1,8 GB (servidor `db-f1-micro`), e **395 mil
linhas** (36%) eram de 14 clientes B2B que ninguém lia. A tabela **diária** (`ga4_daily_metrics`, 1,8 MB) continua para todos: o
alerta de "propriedade sem visitas" e a retomada do job dependem dela.

Como funciona (`shouldStoreGa4ProductViewsInPostgres`, `syncGa4DailyForClient`):

- Só deixa de gravar quando o **BigQuery está disponível naquela rodada**; sem BigQuery o Postgres segue como único destino.
- A **cópia antiga** do cliente B2B no Postgres é apagada na própria rodada horária, **depois** de o BigQuery gravar com sucesso
  (se o BigQuery falhar, nada é apagado). O número apagado aparece em `sync_jobs.result.prunedProductRows`. Rodadas seguintes só
  fazem uma contagem.
- O espaço em disco **não encolhe sozinho** (o Postgres reaproveita o espaço liberado; devolver ao sistema exige `VACUUM FULL`,
  que trava a tabela por alguns segundos — não é necessário). O ganho é parar de gravar e de manter 395 mil linhas inúteis.
- Telas B2B que passarem a mostrar GA4 devem **ler do BigQuery** (`up_global.ga4_daily` / `ga4_product_views_daily`).
- Fase 2 (não feita): levar os produtos do B2C também para o BigQuery e deixar só a tabela diária no Postgres.

## Origem do tráfego (09/11/2026)

Tabela nova **só no BigQuery**: `up_global.ga4_traffic_daily` (particionada por `date`, agrupada por `client_id`). Uma linha por
cliente, dia, **canal, origem, mídia e campanha da sessão**, com o que cada uma trouxe:

| Coluna | O que é |
|---|---|
| `channel_group`, `source`, `medium`, `campaign` | `sessionDefaultChannelGroup`, `sessionSource`, `sessionMedium`, `sessionCampaignName` (vazio vira `(not set)`) |
| `sessions`, `total_users`, `engaged_sessions` | visitas, usuários e sessões engajadas |
| `add_to_cart`, `begin_checkout`, `purchases`, `purchase_revenue` | funil de venda e receita (atribuição do GA4) |

Exemplo — de onde vieram as vendas de um cliente nos últimos 30 dias:

```sql
SELECT channel_group, source, medium, SUM(sessions) sessoes, SUM(purchases) compras, ROUND(SUM(purchase_revenue)) receita
FROM `up-vesti-report.up_global.ga4_traffic_daily`
WHERE client_name = 'La Cleo' AND `date` >= DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 30 DAY)
GROUP BY 1, 2, 3 ORDER BY receita DESC
```

Como funciona e o que lembrar:

- **Mesmo job `ga4_daily`, mesmo acesso (Leitor da agência):** nenhuma permissão nova. Histórico de **400 dias** no primeiro ciclo
  e depois atualização de hora em hora (relê os últimos dias). Tamanho medido: 7 mil a 25 mil linhas por cliente em 400 dias.
- **Janela e marcador próprios.** O marcador é o último dia gravado com sucesso, em `sync_jobs.result.trafficTo`
  (`resolveGa4TrafficFrom`, `lastGa4TrafficToByClient`). Sem marcador → backfill largo; com marcador → recomeça dali. Falha só dessa
  tabela **não derruba** o diário nem os produtos: o erro vai em `sync_jobs.result.trafficError`, o marcador não anda e a rodada
  seguinte refaz o que faltou.
- **Troca de janela, sem duplicar:** janela curta (até 3000 linhas, o caso da rodada horária) é **um `MERGE` só**: atualiza o que
  continua, insere o que é novo e apaga, dentro da janela e do cliente, o que o GA4 deixou de devolver. Janela longa (backfill) vai
  para uma tabela temporária (lotes de 3000) e a janela do cliente é trocada numa transação só. Rodar duas vezes a mesma janela não
  duplica nos dois caminhos. Validado em 09/11 contra o BigQuery de verdade, num dataset temporário (7 mil linhas em 3 lotes, somas,
  repetição, troca de janela, janela vazia, backfill seguido de rodada curta, cliente de controle intacto e exclusão do cliente).
- **Por que dois caminhos (tempo da rodada horária):** a primeira versão trocava a janela sempre por tabela temporária (4 consultas,
  ~9,4 s por tabela e cliente, medido). Com a origem do tráfego a rodada horária foi de ~6,5 para ~10 min num limite de 15 (o job é
  sequencial: quanto mais clientes, mais tempo). O `MERGE` leva ~2,8 s. O mesmo vale para os produtos. Se um cliente passar do limite
  de linhas do lote numa rodada curta, ele cai sozinho no caminho longo.
- **Somas por origem não fecham 100% com a tabela diária:** compras e receita fecham **exatamente** (conferido ao vivo na Lila Rosa:
  17.634 compras e R$ 3.449.999 nos dois); sessões e carrinho podem diferir até ~1% (o Google soma por sessão, o diário por dia).
  `total_users` **não** é aditivo entre linhas. Receita pode ser **negativa** numa linha (estorno atribuído àquela origem): é dado
  real e entra na soma.
- **Exceção conhecida, a campanha:** o Google pode contar a mesma sessão em mais de uma campanha. Na Sline Vesti a soma de sessões por
  dia, campanha incluída, passa do total em 6,5% (dias de agosto: +15 a +20%); sem a campanha o desvio é de +0,4% (medido ao vivo em
  09/11). Para total de visitas use `ga4_daily`; por campanha, leia como "sessões em que a campanha apareceu". Compras e receita não sofrem.
- **Correção de 09/11 (primeira versão perdia estornos):** o filtro de "linha sem nada medido" somava as métricas e descartava a linha
  quando dava zero ou menos; linha de estorno (ex.: 16 sessões e R$ -3.048) sumia. Na Lila Rosa: 395 linhas, 7,4 mil sessões e 184
  compras fora e receita 11% acima da real. Agora só some a linha em que TODAS as métricas são zero. As linhas gravadas antes da
  correção só se refazem com um reprocesso largo (execução manual de `ga4_daily` com `LOOKBACK_DAYS=400`); a rodada horária relê só os
  últimos dias.
- A exclusão definitiva de cliente (`deleteGa4Rows`) apaga as **três** tabelas.
- **Vigiado pelo alerta de dado parado** (10/11, regra `origem_trafego_parada` em `docs/ga4-alerta.md`): se a origem do tráfego deixar de
  ser gravada por mais de 6h num cliente que sincroniza em dia, o job de conferência sai com erro e o e-mail dispara. O motivo vem em
  `sync_jobs.result.trafficError` e no log (`[ga4-daily] origem do trafego nao gravada`).
- **Depois da publicação**, para não esperar 8 rodadas (limite de 3 backfills largos por hora): rodar uma vez
  `gcloud run jobs execute upzero-sync-job --project=up-vesti-report --region=us-central1 --update-env-vars=TASK=ga4_daily,TRIGGER=manual --wait`
  (os clientes sem acesso fazem a execução sair com erro e o Cloud Run repete uma vez; é esperado e a segunda passada não refaz nada).

## Funil por produto (10/11/2026)

Tabela nova **só no BigQuery**: `up_global.ga4_product_funnel_daily` (particionada por `date`, agrupada por `client_id`). Uma linha por
cliente, dia e produto (`item_id`, `item_name`, `item_variant`), com o funil do item:

| Coluna | O que é |
|---|---|
| `items_viewed` | unidades vistas (igual a `ga4_product_views_daily.items_viewed` em todos os clientes) |
| `items_added_to_cart`, `items_checked_out` | unidades que foram ao carrinho e ao checkout |
| `items_purchased` | unidades compradas |
| `item_revenue` | receita dos itens **líquida de estornos** (= `gross_item_revenue` − `item_refund_amount`) |
| `gross_item_revenue`, `item_refund_amount` | receita bruta e valor estornado |

Exemplo — o que mais vendeu nos últimos 30 dias e quanto das visualizações virou compra:

```sql
SELECT item_id, ANY_VALUE(item_name) AS produto, SUM(items_viewed) AS vistos, SUM(items_added_to_cart) AS carrinho,
       SUM(items_purchased) AS comprados, ROUND(SUM(item_revenue)) AS receita,
       ROUND(SAFE_DIVIDE(SUM(items_purchased), SUM(items_viewed)) * 100, 2) AS compra_por_visto_pct
FROM `up-vesti-report.up_global.ga4_product_funnel_daily`
WHERE client_name = 'Giah Studio' AND `date` >= DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 30 DAY)
GROUP BY item_id
ORDER BY receita DESC
LIMIT 10
```

Como funciona e o que lembrar:

- **Mesmo job `ga4_daily`, mesmo acesso (Leitor da agência):** nenhuma permissão nova. Histórico de **400 dias** no primeiro ciclo e depois
  de hora em hora (relê os últimos dias). Sondado ao vivo em 10/11 em 3 propriedades: as 7 métricas de item aceitam juntas as dimensões
  dia + item + nome + variante, e `itemsViewed` sai igual com e sem o filtro `view_item` (por isso a busca não usa filtro).
- **Janela e marcador próprios**, como a origem do tráfego: `sync_jobs.result.productFunnelTo` é o último dia gravado com sucesso
  (`resolveGa4ProductFunnelFrom`, `lastGa4ProductFunnelToByClient`). Falha só dessa tabela **não derruba** o diário, os produtos nem a
  origem do tráfego: o erro vai em `productFunnelError`, o marcador não anda e a rodada seguinte refaz a janela. Janela curta (até 3000
  linhas) é **um `MERGE` só**; o backfill passa por tabela temporária (mesmo desenho da origem do tráfego). Validado em 10/11 contra o BigQuery de
  verdade, num dataset temporário (repetição sem duplicar, item que sumiu sai, variante vazia como NULL, chave repetida soma, receita
  negativa de estorno fica, backfill de 7 mil linhas seguido de rodada curta, cliente de controle intacto e exclusão do cliente).
- **Backfill de 10/11 (execução manual de `ga4_daily`):** 23 clientes, 400 dias (desde 07/10/2025), 1,62 milhão de linhas, 62 minutos, sem
  nenhum erro de tabela isolada. As visualizações do funil batem **exatamente** com `ga4_product_views_daily` nos 22 clientes que têm linhas,
  sem duplicata, e a receita líquida é igual a bruta − estornada em todos.
- **Tem linha que a tabela de visualizações não tem:** produto que foi ao carrinho ou foi comprado num dia **sem** visualização. A tabela
  é um superconjunto de `ga4_product_views_daily`; as duas se juntam por (cliente, dia, `item_id`, `item_name`, `item_variant`) com
  `IS NOT DISTINCT FROM`, porque variante vazia é NULL (e `(not set)` fica como o GA4 mandou). **A fração dessas linhas varia muito** (de 1% a
  75% no histórico de 400 dias, conforme o cliente): na janela recente de 3 propriedades sondadas era de 0,7% a 1,4%, mas na Giah foi de
  13% a 31% até ago/2026 e de 0,5% a 0,7% desde set/2026 (provável mudança no rastreamento da loja; não verificado), e na Adama pulou de ~25% para ~75% em
  jun/2026, quando carrinho e compra passaram a mandar a variante e a visualização continuou sem ela.
- **Nível do produto:** em algumas lojas `item_id` é o produto, em outras é cada variante (Giah: um id por tamanho, nome no formato
  `PRODUTO (COR, TAMANHO)`). Olhe os ids e nomes do cliente antes de agrupar.
- **Unidades não são eventos nem pedidos.** Conferido nos mesmos 15 dias em Giah, La Cleo e Lila Rosa: unidades no carrinho = eventos de
  carrinho (até 2% acima); unidades no checkout e unidades compradas são de 2 a 2,7 vezes os eventos de checkout e as compras (pedido com
  mais de um item). Nos B2B é bem mais: Adama teve 25 mil unidades em 937 pedidos. E `items_viewed` só é igual ao `view_item` de `ga4_daily` onde o
  evento manda os itens (Giah, Jini, Lila Rosa, Nbloom, Pêo, Sooé, Threesix); em B2B como Coqueta o diário tem 419 mil eventos e os itens, 85 mil.
- **Receita, comparada com a `purchase_revenue` de `ga4_daily` no período todo:** igual (até 0,1%) em Giah, Jini, Lila Rosa, Pêo, Sooé e
  Threesix; perto (−2% a +5%) em La Cleo, Le Ricard e Sline Vesti; **acima** (+6% a +20%) em Adama, Cocci, Coqueta, Estime, Fiore, Hirus,
  Incentive, Oxigenio e Vogabox (provável desconto no pedido; não verificado); **abaixo** na CELEB (−17%) e **quase inutilizável** em Lipcem (−65%) e Nbloom (−99,8%: 3 unidades compradas
  contra 322 pedidos), onde o evento de compra não manda todos os itens. Pode ser **negativa** numa linha só de estorno
  (é dado real; não filtre `> 0`).
- A exclusão definitiva de cliente (`deleteGa4Rows`) apaga as **quatro** tabelas.
- **Vigiado pelo alerta de dado parado** (regra `funil_produto_parado`, a mesma da origem do tráfego; ver `docs/ga4-alerta.md`).
- **Depois da publicação**, para não esperar 8 rodadas (limite de 3 backfills largos por hora): rodar uma vez
  `gcloud run jobs execute upzero-sync-job --project=up-vesti-report --region=us-central1 --update-env-vars=TASK=ga4_daily,TRIGGER=manual --wait`
  (sem marcador, o funil faz o backfill de 400 dias; o resto fica na janela curta). Foi o que se fez em 10/11. Enquanto a execução manual
  não termina, a rodada horária adia os clientes que ainda não tiveram o funil (só uma rodada de atraso para eles).
