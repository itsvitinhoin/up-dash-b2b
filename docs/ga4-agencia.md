# GA4 lido com a chave da agência — 06/11/2026

## Por que

A conta de serviço do job só enxerga 5 propriedades de GA4 (as que alguém liberou à mão). A conta da agência
(`upagency.oficial@gmail.com`) enxerga **100 contas / 132 propriedades** (medido em 06/11 com
`backend-dash/scripts/ga4-visibility-oauth.mjs`). Em vez de liberar a conta de serviço cliente por cliente, o job passa a ler com
a chave da agência. A conta de serviço fica de **reserva**.

## Como funciona

- `GA4_OAUTH_REFRESH_TOKEN`, `GA4_OAUTH_CLIENT_ID`, `GA4_OAUTH_CLIENT_SECRET` no job → `services/ga4.ts` renova um token de acesso e lê o
  GA4 como a agência. Sem as três variáveis, nada muda (comportamento de antes).
- Se o Google recusar a chave (senha trocada, acesso revogado) **o job não cai**: avisa no log (`[ga4] o Google recusou a chave da
  agencia…`) e volta para a conta de serviço. O alerta de dado parado (`docs/ga4-alerta.md`) avisa quando clientes pararem.
- A chave NUNCA passa por chat, arquivo ou log: `backend-dash/scripts/ga4-agency-token.mjs` a entrega direto ao Secret Manager
  (`GA4_AGENCY_REFRESH_TOKEN`, projeto `up-vesti-report`) pela entrada padrão do gcloud.

## Roteiro

1. **Gerar e guardar a chave** (uma vez, terminal FORA do app): `cd C:\trabalho\backend-dash; node scripts/ga4-agency-token.mjs`.
   Cole o link no Chrome logado na conta da agência e clique em Permitir. O script confere que a chave enxerga as propriedades e a
   guarda sozinho.
2. **Código na `main` + build oficial** (`cloudbuild.job.yaml`).
3. **Ligar a chave nos jobs que leem o GA4** (a conta de serviço do job já tem leitura de segredos no projeto):

   ```
   gcloud run jobs update upzero-sync-job-hourly --project=up-vesti-report --region=us-central1 --update-secrets='GA4_OAUTH_REFRESH_TOKEN=GA4_AGENCY_REFRESH_TOKEN:latest,GA4_OAUTH_CLIENT_ID=GOOGLE_ADS_CLIENT_ID:latest,GA4_OAUTH_CLIENT_SECRET=GOOGLE_ADS_CLIENT_SECRET:latest'
   ```

   O mesmo para `upzero-sync-job` (execuções avulsas do `ga4_daily`) e `upzero-sync-job-ga4-canary` (descoberta).
4. **Descoberta com a chave da agência** (`TASK=ga4_discover`): mostra, cliente por cliente, o que ela acharia e **o que registraria**
   (`REGISTRARIA …`). Sem `APPLY=1` NÃO grava nada.
5. **Registrar** (`TASK=ga4_discover` com `APPLY=1`): preenche `ga4_property_id` dos clientes do dash que casam pelo ID de medição.
   Só preenche campo vazio; ambíguo, duplicado e DIVERGE ficam de fora, com o motivo no log.

## Entrada gradual de clientes

Cliente recém-registrado faz backfill de 400 dias (~2 min cada). O job horário tem limite de 15 min e roda UpZero e Meta no mesmo
processo, então o `ga4_daily` roda **no máximo 3 backfills largos por rodada e só nos primeiros 8 minutos**
(`GA4_MAX_BACKFILLS_PER_RUN`, `GA4_RUN_BUDGET_MINUTES`). Quem está em dia sempre roda primeiro. O restante entra nas horas seguintes
(`skipped` no resumo; `[ga4-daily] backfill adiado` no log). Rodada manual de UM cliente (`CLIENT_ID`) não tem limite.

## Riscos

- O GA4 passa a depender de UMA conta. Troca de senha ou revogação em https://myaccount.google.com/permissions derruba a chave
  (cai na conta de serviço, que só enxerga 5). Ideal a longo prazo: conta própria da agência, não de uma pessoa.
- Esta chave só lê o Analytics. O Google Ads é outra autorização (escopo `adwords`), fora deste fluxo.
