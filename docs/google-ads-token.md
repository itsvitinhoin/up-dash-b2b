# Google Ads parado: como gerar um novo token e recuperar o buraco

## Situação (medida em 21/10/2026)

- Os dados do Google Ads no BigQuery (`data_ads_global.google_ads_campaigns_insights` e `google_ads_insights`) param em **24/08/2026**. Faltam quase 2 meses.
- O job `ingest-google-ads` (backend-dash, Cloud Run Job `up-jobs`, 07:00 UTC) falha todo dia com `invalid_grant`, sem lançar exceção.
- `invalid_grant` significa que o **refresh token** do Google foi recusado: revogado, expirado ou a conta que o autorizou perdeu acesso.
- Causa mais provável: a tela de consentimento OAuth do app está em **"Em teste"**. Nesse modo o Google expira o refresh token em **7 dias**, o que combina com o último dia guardado (24/08). Confirme no passo 1.

## Quem faz

Alguém com acesso ao **Google Ads (MCC)** e ao **projeto do Google Cloud** onde está o cliente OAuth usado pelo backend-dash. O Marcelo roda os comandos do terminal e o build. Nenhum token, segredo ou senha deve ser colado em chat.

## Passo a passo

### 1. Parar de expirar (uma vez)

No Google Cloud Console, no projeto do cliente OAuth: **APIs e serviços → Tela de permissão OAuth** (ou "Google Auth Platform → Público-alvo").

- Se o status for **"Em teste"**: clicar em **Publicar app** (vira "Em produção"). Para o escopo do Google Ads o Google mostra o aviso "app não verificado" na hora de autorizar; para uso interno é aceitável e o token deixa de expirar em 7 dias.
- Se a conta é de um Google Workspace da agência, o tipo de usuário **Interno** também resolve (sem aviso).
- Se já estava "Em produção": o token foi revogado (alguém removeu o acesso do app em myaccount.google.com/permissions, ou trocou a senha da conta que autorizou). Siga para o passo 2 de qualquer forma.

### 2. Gerar o novo refresh token

Na pasta `backend-dash` do computador do Marcelo:

1. Garantir um `.env` local com `GOOGLE_ADS_CLIENT_ID` e `GOOGLE_ADS_CLIENT_SECRET` (os mesmos valores dos segredos de mesmo nome no Secret Manager do projeto `up-vesti-report`; copiar pelo console, sem passar por chat).
2. Rodar:

```bash
npx tsx scripts/generate-google-ads-token.ts
```

3. Abrir o link que aparece, **entrar com a conta Google que enxerga o MCC** (o `GOOGLE_ADS_LOGIN_CUSTOMER_ID`) e autorizar.
4. O terminal mostra `GOOGLE_ADS_REFRESH_TOKEN=...`. Copiar só o valor depois do `=`.

### 3. Guardar o novo token

Preferir o console: **Secret Manager → `GOOGLE_ADS_REFRESH_TOKEN` (projeto `up-vesti-report`) → Nova versão** e colar o valor. (Pela linha de comando seria `gcloud secrets versions add GOOGLE_ADS_REFRESH_TOKEN --project=up-vesti-report --data-file=-`, colando o valor na entrada padrão; evite passar o token como argumento, porque ele fica no histórico.)

### 4. Publicar (o build lê `versions/latest`)

O `cloudbuild.yaml` lê o segredo **no momento do build** e grava como variável de ambiente no serviço `up-dash-backend` e no job `up-jobs`. Então é preciso refazer o build:

```bash
cd backend-dash
gcloud builds submit --project=up-vesti-report --config=cloudbuild.yaml .
```

(Não troque a configuração padrão do gcloud; use sempre `--project=up-vesti-report`.)

### 5. Testar com a janela padrão

```bash
gcloud run jobs execute up-jobs --project=up-vesti-report --region=europe-west1 --update-env-vars=JOB_NAME=ingest-google-ads,WINDOW_DAYS=7 --wait
```

Sucesso = a execução termina sem `invalid_grant` nos logs. Conferir no BigQuery:

```sql
SELECT MAX(date) AS ultimo_dia, COUNT(DISTINCT customer_id) AS contas
FROM `up-vesti-report.data_ads_global.google_ads_campaigns_insights`;
```

`ultimo_dia` deve ser hoje ou ontem.

### 6. Recuperar o buraco (24/08 até hoje)

A ingestão grava numa tabela temporária e faz `MERGE`, então repetir períodos **não duplica**. Rodar uma vez com janela longa:

```bash
gcloud run jobs execute up-jobs --project=up-vesti-report --region=europe-west1 --update-env-vars=JOB_NAME=ingest-google-ads,WINDOW_DAYS=75 --wait
```

Repetir a consulta do passo 5 e conferir que há linhas de cada dia desde 25/08:

```sql
SELECT date, COUNT(*) AS linhas
FROM `up-vesti-report.data_ads_global.google_ads_campaigns_insights`
WHERE date >= '2026-08-20'
GROUP BY date ORDER BY date;
```

## Depois

- O agendamento diário volta a funcionar sozinho (usa o mesmo job).
- Pendência de desenho: o job engole o erro e termina "com sucesso". Vale alertar quando `google_ads_campaigns_insights` ficar mais de 2 dias sem dado novo (consulta do passo 5 numa verificação agendada), para o buraco nunca mais chegar a 2 meses.
