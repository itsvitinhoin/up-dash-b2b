# Alerta de GA4 parado — 06/11/2026

## O problema que isto resolve

Em 03/11 o `ga4_daily` parou de rodar (uma imagem sem ele sobrescreveu `:latest`) e ninguém viu; o Google Ads ficou 74 dias
parado do mesmo jeito. Hoje **não existe nenhum canal de notificação nem política de alerta** no projeto `up-vesti-report`.

## Como funciona

`TASK=check_data_freshness` (job `upzero-sync-job-freshness`) **só lê**: confere `sync_jobs` no Postgres e `up_global.ga4_daily`
no BigQuery. Regras (testadas em `test/ga4-freshness-rules.test.ts`):

| Situação | Severidade | O que acontece |
|---|---|---|
| Nenhum cliente teve GA4 sincronizado nas últimas 6h (o caso de 03/11) | **problema** | UM aviso do job, não um por cliente |
| Cliente que **já sincronizou** e parou há mais de 6h (perdeu acesso, por exemplo) | **problema** | |
| Postgres em dia, mas BigQuery atrasado (mais de 1 dia) ou sem nenhuma linha | **problema** | |
| Não foi possível ler o BigQuery | **problema** | |
| Cliente cadastrado que **nunca** conseguiu ler (falta acesso no GA4) | aviso | só no log |
| Cliente **cadastrado há até 3 dias** e sem nenhuma visita nos últimos 7 dias (quase sempre o ID da propriedade está errado — caso Vn11/Obzee) | **problema** | `sem_trafego_novo` |
| Cliente que **tinha visitas e parou há 7 a 21 dias** (o site pode ter trocado de GA4 — caso Sooé, que gravou zeros por 3 semanas) | **problema** | `parou_trafego` |
| Sem visitas há mais tempo que isso (já é conhecido) | aviso | `sem_trafego`; os números guardados dele são zeros, não dados |

Com **problema** o job sai com código 1 → a execução do Cloud Run falha → o alerta dispara. **Aviso não dispara alerta**:
senão o alerta ficaria vermelho para sempre por causa das lojas sem acesso e ninguém mais olharia.
Limite de 6h ajustável com `GA4_FRESHNESS_MAX_AGE_HOURS`.

**Visitas (09/11/2026).** Sincronizar em dia não basta: a regra olha as sessões guardadas em `ga4_daily_metrics` (uma linha por cliente e
dia, com zeros nos dias sem visita). "Cadastrado há quanto tempo" é o `MIN(synced_at)` do cliente. Quem nunca tem histórico guardado
ainda (backfill pendente) não é julgado. Um cliente com visita nos últimos 7 dias nunca gera achado. Limites ajustáveis:
`GA4_NO_TRAFFIC_DAYS` (7), `GA4_STOPPED_ALERT_DAYS` (21), `GA4_NEW_CLIENT_DAYS` (3). A mensagem do problema diz o que fazer: conferir o
`G-…` da etiqueta do site e achar a propriedade que tem esse `G-…`.

Validado em 09/11 contra os dados reais (somente leitura): 26 clientes, 14 saudáveis, **2 problemas** (Vn11 e Obzee, `sem_trafego_novo`,
porque foram cadastrados há menos de 3 dias com uma propriedade sem visitas — viram aviso sozinhos depois da janela) e 10 avisos (os 7
recém-cadastrados que ainda não terminaram o backfill, mais Aiyu, Hot Pink e Sonmur sem acesso). Nenhum cliente saudável foi acusado.

Validado em 06/11 contra os dados reais (somente leitura): 7 clientes, 2 saudáveis, 0 problemas, 5 avisos (Aiyu, Hot Pink,
Pêo, Sonmur e Sooé, sem acesso) e código de saída 0. Com o relógio simulado 24h à frente: `job_parado`, código de saída 1.

## Roteiro (cria recursos no seu Google Cloud — rode na ordem)

**Pré-requisito:** este código precisa estar na `main` e ter passado pelo build oficial (`cloudbuild.job.yaml`), para a imagem
`:latest` conhecer o `check_data_freshness`.

### 1. Criar o job de verificação

Usa `:latest` de propósito: se um dia `:latest` perder a verificação, o job falha com "TASK desconhecida" (código 1) e o próprio
alerta avisa. Somente leitura, 5 minutos de limite, sem retentativa.

```bash
gcloud run jobs create upzero-sync-job-freshness --project=up-vesti-report --account=hique1276@gmail.com --region=us-central1 --image=gcr.io/up-vesti-report/up-dash-b2b-upzero-sync-job:latest --service-account=928204832932-compute@developer.gserviceaccount.com --set-cloudsql-instances=up-vesti-report:us-central1:vesti-database --set-env-vars='CLOUD_SQL_CONNECTION_NAME=up-vesti-report:us-central1:vesti-database,TASK=check_data_freshness,TRIGGER=cron' --set-secrets='DB_USER=updashb2b-db-user:latest,DB_PASSWORD=updashb2b-db-password:latest,DB_NAME=updashb2b-db-name:latest' --execution-environment=gen2 --memory=512Mi --cpu=1 --max-retries=0 --task-timeout=5m
```

### 2. Rodar uma vez à mão

Esperado hoje: termina **com sucesso** (as 5 lojas sem acesso são só aviso).

```bash
gcloud run jobs execute upzero-sync-job-freshness --project=up-vesti-report --account=hique1276@gmail.com --region=us-central1 --wait
```

### 3. Agendar (todo dia, de hora em hora, no minuto 30)

Mesmo formato do agendador do job horário (mesma conta, mesmo `attempt-deadline`).

```bash
gcloud scheduler jobs create http upzero-sync-job-freshness-schedule --project=up-vesti-report --account=hique1276@gmail.com --location=us-central1 --schedule='30 * * * *' --time-zone='Etc/UTC' --uri='https://us-central1-run.googleapis.com/v2/projects/up-vesti-report/locations/us-central1/jobs/upzero-sync-job-freshness:run' --http-method=POST --oauth-service-account-email=928204832932-compute@developer.gserviceaccount.com --attempt-deadline=180s
```

### 4. Canal de e-mail (quem recebe o alerta)

Troque o e-mail se quiser outro. Anote o `name` que aparece na saída (termina em `/notificationChannels/<ID>`).

```bash
gcloud alpha monitoring channels create --project=up-vesti-report --account=hique1276@gmail.com --display-name='GA4 - alerta por e-mail' --type=email --channel-labels=email_address=hique1276@gmail.com
```

### 5. Política de alerta

Dispara quando uma execução da verificação **falha**, ou quando ela **para de rodar** por 3 horas. Substitua `<ID>` pelo número do
passo 4. **Esta política NÃO foi testada** (não dá para criar recurso de monitoramento daqui); se o comando reclamar do arquivo,
cole a mensagem que eu ajusto.

```bash
cd C:\trabalho\up-dash-ga4; gcloud alpha monitoring policies create --project=up-vesti-report --account=hique1276@gmail.com --policy-from-file=docs/ga4-alerta-policy.json --notification-channels=projects/up-vesti-report/notificationChannels/<ID>
```

### 6. Provar que o alerta chega

Roda a verificação com uma TASK inexistente só nesta execução: ela sai com código 1 e o e-mail deve chegar (pode levar alguns
minutos). Não altera o job.

```bash
gcloud run jobs execute upzero-sync-job-freshness --project=up-vesti-report --account=hique1276@gmail.com --region=us-central1 --update-env-vars='TASK=teste_alerta' --wait
```

## Onde ver o motivo

Logs do job, buscando `[ga4-freshness] PROBLEMA` (erros) e `[ga4-freshness] aviso` (pendências).

## O que isto NÃO cobre

- **Google Ads e Meta.** Mesma ideia, mas as regras de cada fonte são outras; o Google Ads está bloqueado pelo token até ~12/11.
- **O dado estar certo**, só que está chegando. A comparação de valores é manual (ver `docs/ga4-canario.md`).
- **Se o próprio agendador do Cloud Scheduler ou o Cloud Run inteiro caírem**, a segunda condição da política (3h sem execução) é o que avisa.
