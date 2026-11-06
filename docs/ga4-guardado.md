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

- **Gravação sem duplicar:** `ga4_daily` usa `MERGE` por (cliente, dia); os produtos vão para uma tabela
  temporária (expira em 1 h) e a janela do cliente é trocada numa transação só. Falha no meio não deixa a tabela pela metade.
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
- **Excluir cliente de vez (lixeira de 90 dias):** a limpeza do BigQuery apaga linhas de tabelas `up_global` com coluna
  `tenant` e as tabelas por propriedade do pipeline antigo; as novas `ga4_daily` / `ga4_product_views_daily` usam
  `client_id` e ainda NÃO entram nessa limpeza. Falta um `DELETE ... WHERE client_id = @id` em `purge_archived_clients`.
- Tráfego por origem/mídia/campanha (tabela própria) e alerta de dado parado.
- Descoberta das propriedades que a conta enxerga (exige ativar a Analytics Admin API no projeto).
