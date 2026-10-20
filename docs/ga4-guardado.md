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

## Ordem de publicação (importante)

1. **Banco de produção** (`up_dash_b2b`, Cloud SQL Studio): rodar
   `lib/db/migrations/0043_ga4_daily_metrics.sql` (idempotente). Antes do deploy
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

## Rollback

Reverter o commit (a lista volta a chamar o GA4 ao vivo). A tabela pode ficar; não
atrapalha nada.

## Fora deste passo (de propósito)

- As outras telas que ainda chamam `fetchGa4*` ao vivo (`routes/analytics.ts`, 5
  pontos) continuam como estavam; migram uma a uma lendo desta tabela.
- A decisão estrutural continua sendo levar o backend pro Cloud Run (us-central1,
  junto do banco) e o botão "Sincronizar" da Nuvemshop disparar o job existente.
- Acesso da service account às 4 propriedades que recusam é ação humana no GA4
  (Administrador → Gerenciamento de acesso → Leitor).
