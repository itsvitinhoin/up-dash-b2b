# Primeira rodada do GA4 → BigQuery num job canário — 06/11/2026

Objetivo: provar o código novo (`ga4_daily` gravando no BigQuery) **sem tocar nos jobs de produção** e **sem sujar
`up_global`**, que é o que os agentes do Victor leem. Nada aqui move `:latest` nem atualiza job existente.

## O que isto muda e o que não muda

| Mexe em | Canário |
|---|---|
| Jobs de produção (`upzero-sync-job`, `-hourly`, `-paid-touchpoints`, `-braavo`) | **Não.** Job novo e separado, sem agendamento. |
| Tag `:latest` da imagem | **Não.** Tag própria `ga4-canary-<sha>`; o arquivo de build recusa `latest`. |
| BigQuery | Só o dataset de teste `up-vesti-report.ga4_teste` (`GA4_BQ_DATASET`). `up_global` fica intacto. |
| Postgres de produção | **Sim, o mesmo banco.** Grava `ga4_daily_metrics`, `ga4_product_views_daily` e linhas em `sync_jobs` (400 dias de Giah/Jini, o que também fecha o buraco de 21/10–03/11). As telas em produção só passam a ler isso quando o código novo for para a Vercel (push na `main`); até lá ninguém vê. |
| Google Analytics | Só leitura. |

## Passo 1 — build da imagem de teste (da raiz do repo)

Usa `cloudbuild.job-canary.yaml`, **não** o `cloudbuild.job.yaml` (esse move `:latest` e atualiza os três jobs de produção).
A tag é o commit atual (`fa7c62e`).

```bash
cd C:\trabalho\up-dash-ga4; gcloud builds submit --project=up-vesti-report --account=hique1276@gmail.com --config=artifacts/api-server/cloudbuild.job-canary.yaml --substitutions=_TAG=ga4-canary-fa7c62e .
```

## Passo 2 — criar o job canário (uma vez)

Copia a configuração do `upzero-sync-job` (mesma conta de serviço, mesmo Cloud SQL, mesmos segredos), com três diferenças:
`TASK=ga4_daily`, `GA4_BQ_DATASET=ga4_teste` e `--max-retries=0` (falha aparece na hora, sem retentativa escondendo o erro).
Aspas simples nas listas por causa da vírgula no PowerShell.

```bash
gcloud run jobs create upzero-sync-job-ga4-canary --project=up-vesti-report --account=hique1276@gmail.com --region=us-central1 --image=gcr.io/up-vesti-report/up-dash-b2b-upzero-sync-job:ga4-canary-fa7c62e --service-account=928204832932-compute@developer.gserviceaccount.com --set-cloudsql-instances=up-vesti-report:us-central1:vesti-database --set-env-vars='CLOUD_SQL_CONNECTION_NAME=up-vesti-report:us-central1:vesti-database,TASK=ga4_daily,TRIGGER=manual,GA4_BQ_DATASET=ga4_teste' --set-secrets='DB_USER=updashb2b-db-user:latest,DB_PASSWORD=updashb2b-db-password:latest,DB_NAME=updashb2b-db-name:latest' --execution-environment=gen2 --memory=1Gi --cpu=1 --max-retries=0 --task-timeout=30m
```

Sem agendador: o job só roda quando alguém executa.

## Passo 3 — rodar para UM cliente: Giah Studio

Giah primeiro (menor, e o pipeline antigo tem 633 dias dela para comparar). O `--update-env-vars` do `execute` vale só para
esta execução. Espere o `--wait` terminar e me avise.

```bash
gcloud run jobs execute upzero-sync-job-ga4-canary --project=up-vesti-report --account=hique1276@gmail.com --region=us-central1 --update-env-vars='CLIENT_ID=WQd2X-a78ayZihrk_tVjj' --wait
```

Se falhar por **permissão para criar o dataset** (`bigquery.datasets.create`), crie à mão e rode de novo:

```bash
bq --project_id=up-vesti-report mk --location=US --dataset ga4_teste
```

## Passo 4 — conferir (eu faço, só leitura; pode fazer também)

1. `sync_jobs` do cliente: `status = done`, `result.bigQuery.dailyRows` ≈ 400, `error` vazio.
2. `ga4_teste.ga4_daily`: ~400 linhas de Giah, uma por dia, sem duplicata.
3. Sessões por dia **iguais** às do pipeline antigo (mesma propriedade, 422756040), até D-2 (os 2 últimos dias o GA4 ainda revisa):

```sql
SELECT n.date, n.sessions AS novo, a.sessions AS antigo, n.total_users AS usuarios_novo, a.total_users AS usuarios_antigo
FROM `up-vesti-report.ga4_teste.ga4_daily` n
JOIN `up-nuvem-reports.analytics_ga4_traffic.giah_studio` a ON a.date = n.date
WHERE n.client_name = 'Giah Studio' AND n.date <= DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 2 DAY)
  AND (n.sessions != a.sessions OR n.total_users != a.total_users)
ORDER BY n.date;
```

Resultado esperado: **nenhuma linha**.

4. Rodar o passo 3 uma segunda vez e ver que a contagem de linhas **não muda** (idempotência).
5. Produtos: `ga4_teste.ga4_product_views_daily` com `items_viewed` coerente com `analytics_ga4_view_item.giah_studio`
   (pode diferir um pouco: o pipeline antigo só guarda item que está no catálogo).

## Passo 5 — Jini Cosméticos

Mesmo comando com `CLIENT_ID=4e6a73dc-f062-427c-84cc-60a613d38cfe` e a tabela `jini_cosmeticos` na comparação.

## Depois de validado (não fazer antes)

1. Código na `main` (push) **antes** de qualquer build novo da `main`.
2. Build oficial com `cloudbuild.job.yaml` (esse sim atualiza `:latest` e os jobs), já com o código na `main`.
3. Tirar `GA4_BQ_DATASET` (o job oficial grava em `up_global`).
4. Limpeza do teste:

```bash
gcloud run jobs delete upzero-sync-job-ga4-canary --project=up-vesti-report --account=hique1276@gmail.com --region=us-central1
```

```bash
bq --project_id=up-vesti-report rm -r -d ga4_teste
```

## Reverter

Nada para reverter em produção: apagar o job canário e o dataset `ga4_teste`. As linhas gravadas no Postgres são dados
corretos do GA4 (a gravação é idempotente) e podem ficar.
