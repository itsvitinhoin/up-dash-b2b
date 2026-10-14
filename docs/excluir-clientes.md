# Excluir clientes (lixeira de 90 dias)

Combinado em 13/10/2026 (Victor + Marcelo). Para o time é **excluir**; por trás o cliente é **arquivado**: some do painel, sai das
atualizações diárias, perde o login, e os dados ficam **90 dias**. Dentro do prazo dá para **recuperar**. Passado o prazo, é
**apagado de vez** (banco do painel + BigQuery).

## Na tela (Clientes)
- Botão **Excluir** em cada cliente ativo. Aba **Excluídos** lista quem está na lixeira, com os dias que faltam.
- **Recuperar** devolve tudo. **Apagar agora** pula a espera (pede o nome digitado; antes dos 90 dias exige marcar "apagar antes do prazo").
- O diálogo de "Apagar agora" mostra o que sai do painel e **quais datasets saem do BigQuery**.

## O que "excluir" faz
1. `clients.archived_at = agora`. A API deixa de listar o cliente (padrão), o login e o refresh são barrados (`CLIENT_ARCHIVED`) e as sessões são revogadas.
2. Todas as atualizações do dash (UpZero, Meta, Nuvemshop, métricas, touchpoints, automações do WhatsApp) ignoram o cliente
   (`services/extraction-runner.ts` `clientsWith`, `services/scheduler.ts`, `routes/orchestrator.ts`, `services/portfolio-report.ts`).
3. Automações de WhatsApp ainda agendadas são **canceladas**; o webhook de e-commerce do cliente responde 410.
4. O dash **publica a lista de excluídos** no BigQuery: `up-vesti-report.up_global.excluded_clients`
   (`kind` = `dataset` | `meta_ad_account` | `ga4_property`, `value`, `client_id`, `client_name`, `state` = `excluded` | `deleted`, `excluded_at`).
   Os outros programas leem essa tabela e **pulam** quem está nela:
   - `script-vesti-nuvem` (Vesti, Nuvemshop, Shopify, Braavo, Miredata, Manse, GA4) — branch `feature/lista-de-excluidos`;
   - `backend-dash` / `up-dash-backend` (Facebook, Google Ads, relatório diário) — branch `feature/lista-de-excluidos`.
   Os dois falham **abertos**: se a lista não puder ser lida, atualizam como sempre. `EXCLUDED_CLIENTS_DISABLED=1` desliga o filtro neles.
5. A chave que liga os cadastros é o **ID do dataset do BigQuery** (o dash lê exatamente o que o script grava). Conta de anúncios (Facebook)
   e propriedade GA4 entram como chaves extras.
   Chave que pertence a um cliente **ativo** nunca entra na lista (dataset compartilhado não trava quem continua ativo).

## O que "apagar de vez" faz (botão ou limpeza automática)
Ordem pensada para não deixar lixo nem ressuscitar dataset (`services/client-lifecycle.ts` `purgeClientCompletely`):
1. **Lápide** (`state=deleted`) na lista de excluídos. Sem ela o script, que ainda tem o cliente cadastrado, **recriaria** o dataset.
2. Apaga as linhas do cliente nas tabelas consolidadas de `up_global` (as que têm coluna `tenant`: `clientes_vesti`, `estoques_vesti`, `pedidos_vesti`,
   `produtos_vesti`, `rfm_clientes_final`; descobertas na hora, com o filtro de partição que o BigQuery exige) e a linha dele em `up_global.dataset_tid_map`.
3. Apaga o **dataset** do cliente (Vesti e ERP) e as tabelas dele nos datasets compartilhados do GA4 (`analytics_ga4_traffic.<cliente>`,
   `analytics_ga4_view_item.<cliente>` e as sobras `<cliente>_staging_*`). Nunca apaga dataset protegido (`up_global`, `stape_*`, `vesti_dados`,
   `analytics_*`) nem dataset que **outro cliente** também usa.
4. Só então apaga do banco do painel (cascata em ~34 tabelas + logins que existiam só para esse cliente).
Se o BigQuery falhar, **nada do painel é apagado**: o cliente continua na lixeira e a próxima limpeza tenta de novo.

**Os passos 2 e 3 vêm LIGADOS** (decisão do time, 14/10/2026: o dash apaga o dataset; apagar de vez é um ato explícito, com nome digitado e prévia que lista os datasets, ou o job dos 90 dias).
`BQ_PURGE_ENABLED=false` (Vercel e/ou Cloud Run Job) é a chave de **emergência**: desliga só os passos 2 e 3. A lápide continua sendo publicada e a tela passa a avisar que os datasets NÃO serão apagados.

### Pontos de atenção
- `up_global.pagamentos_vesti` não tem coluna de cliente, mas a consulta `pagamentos_vesti_global_att` faz `CREATE OR REPLACE` toda noite a partir dos
  datasets que existem: as linhas de um dataset apagado **somem sozinhas na noite seguinte**.
- Durante os 90 dias o dataset continua existindo e as consultas agendadas do BigQuery (`*_global_att`, `att_*`) continuam consolidando os dados
  parados dele (custo desprezível). Isso some quando o dataset é apagado.
- Painel antigo (`backend-dash`): `login` e `refresh` barram o cliente cujas marcas foram **todas** excluídas (quem tem várias marcas e perdeu só uma
  continua entrando nas outras). Um ADMIN que "entra como" o cliente continua podendo.
- Quem já estava logado no dash mantém o token de acesso por até 1 h (login e refresh novos são barrados na hora e as sessões são revogadas). Decisão: não
  consultar o banco a cada requisição só para encurtar essa janela.
- Os outros programas leem a lista com cache (5 min no `backend-dash`, 5 min no Python) e **falham abertos**: se a tabela não puder ser lida, um cliente excluído volta a
  ser atualizado (só um aviso no log). Para conferir: procurar `[excluded]` nos logs do `vesti-scheduler-job` e do `up-jobs`.

## Jobs (Cloud Run Job `upzero-sync-job`, imagem `up-dash-b2b-upzero-sync-job`)
- `TASK=purge_archived_clients` — apaga de vez quem passou de 90 dias e, no fim, republica a lista. `DRY_RUN=1` só lista quem seria apagado e quais datasets.
- `TASK=sync_excluded_clients` — só republica a lista (idempotente).
A lista também é republicada a cada exclusão/recuperação feita pela tela (se falhar, o job noturno corrige).

## Estado da publicação (feito em 14/10/2026)
- **Banco:** coluna `clients.archived_at` criada em produção (`up_dash_b2b`).
- **Dash** (Vercel): no ar. **Job do dash** (`upzero-sync-job*`): imagem rebuildada (build manual: `git pull` no Cloud Shell +
  `gcloud builds submit --config=artifacts/api-server/cloudbuild.job.yaml --substitutions=SHORT_SHA=$(git rev-parse --short HEAD) .`
  + `gcloud run jobs update upzero-sync-job-hourly|upzero-sync-job-nuvemshop --image=...:latest`). **Depois de qualquer mudança no servidor repetir o build.**
- **`script-vesti-nuvem`** e **`backend-dash`**: enviados para a `main` (os gatilhos do Cloud Build rebuildam sozinhos: job `vesti-scheduler-job`,
  serviço `api-vesti-report` — que rebuilda em push de QUALQUER branch —, serviço `up-dash-backend` e job `up-jobs`).
- **Limpeza automática:** Cloud Scheduler `upzero-sync-job-purge-schedule` (us-central1, `30 0 * * *` UTC) chama `upzero-sync-job:run` com
  `{"overrides":{"containerOverrides":[{"env":[{"name":"TASK","value":"purge_archived_clients"},{"name":"TRIGGER","value":"cron"}]}]}}`.
  Para ver sem apagar: `gcloud run jobs execute upzero-sync-job --project=up-vesti-report --region=us-central1 --update-env-vars=TASK=purge_archived_clients,DRY_RUN=1 --wait`.
- **Teste real (Idrissi, cliente Vesti):** excluído e apagado de vez; o sync da Vesti o pulou, o dataset `idrissi` foi apagado do BigQuery e a lápide ficou na lista.

## Como foi testado
Banco Postgres descartável local (não o de produção): 55 checagens da API (arquivar, listar, bloquear login, recuperar, prévia, apagar em cascata),
18 do job de limpeza, 12 das automações, 37 do fluxo com BigQuery simulado (ordem, falha que não apaga o painel, dataset compartilhado/protegido, lápides,
tabelas do GA4, apagar do BigQuery desligado por padrão).
Contra o BigQuery **real, só leitura**: lista das tabelas consolidadas e validação (dry run) do DDL e de todos os `DELETE`; os parâmetros do script de
substituição foram conferidos offline. Python: 19 testes novos (inclui os dois scripts do GA4 com a API simulada). backend-dash: 22 testes novos (inclui a rota `/refresh`).

**Ainda não validado de verdade:** o script `BEGIN … COMMIT` que reescreve `up_global.excluded_clients` e o `DROP` real de dataset (a primeira execução manual de
`sync_excluded_clients` valida o primeiro; o segundo roda no primeiro "Apagar agora" de um cliente com dataset: o teste real é o Idrissi).
