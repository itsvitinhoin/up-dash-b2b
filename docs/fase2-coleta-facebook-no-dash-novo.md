# Fase 2: o dash novo passa a mandar na lista de contas de anúncio

Status (21/10/2026): **implementado em branches locais, não publicado.** Este documento tem o problema, a decisão, o que foi feito e o passo a passo de implantação.

## Problema

As telas Vesti do dash novo leem o gasto, as campanhas e os anúncios **só do dado guardado** (`data_ads_global.*` no BigQuery). Quem grava esse dado é a coleta do **backend-dash** (dash legado), que decide **quais contas coletar** olhando o cadastro **do legado**:

```ts
// backend-dash/src/data/sources/adAccountsRepo.ts
prisma.user.findMany({ where: { status: 'active', adAccountId: { not: null } }, select: { adAccountId: true } })
```

Medido em 21/10/2026 (14 marcas Vesti do dash novo com conta cadastrada): **12 estão coletadas** (30 dos 30 dias, atualizadas hoje) e **2 não têm nenhum rastro** em nenhuma tabela de anúncios: **Estime** (`act_576902447698410`) e **Tuba Plus** (`act_626178051781932`). As duas têm dataset de vendas (`estime`, `tuba_plus`); só a conta de anúncio nunca entrou na coleta. Resultado: investimento 0 e listas vazias nas telas Vesti delas. Nenhuma das duas está na lista de excluídos.

Outros achados:

1. **Aurami e Cocci usam a mesma conta** (`act_1483477112868321`): mostram o mesmo gasto. É o cadastro, não bug; mas somas de portfólio contam esse gasto duas vezes.
2. O legado tem também `User.adAccountIds` (lista), que a coleta **não lê** (só `adAccountId`). Pode haver contas fora da coleta por isso.
3. 17 das 37 contas coletadas em 19/10 estavam sem dado novo; a tabela sozinha não diz se a marca parou de anunciar ou se a coleta falha.

## Decisão

O dash novo (`clients.metaAdAccountId`) é a **fonte da verdade** das contas. Ele **publica** a lista numa tabela do BigQuery, **`up_global.ads_accounts`**, e a coleta do backend-dash **lê** essa tabela, soma com o cadastro antigo (sem repetir) e continua gravando nas **mesmas tabelas** do BigQuery. Nada quebra se a tabela não existir ou o BigQuery falhar: a coleta volta a usar só o cadastro antigo.

**Por quê esse caminho:** é exatamente o canal que o sistema já usa para avisar os outros programas que um cliente foi excluído (`up_global.excluded_clients`): o dash reescreve a tabela e o backend-dash e o script-vesti-nuvem a leem. Conferido na produção em 21/10/2026: essa tabela existe, tem 15 linhas e foi atualizada pelo dash no mesmo dia. Então **não há credencial nova, nem segredo, nem rota exposta, nem dependência de o dash estar no ar na hora da coleta**.

Alternativas descartadas:

- *Rota HTTP no dash + token de leitura guardado no Secret Manager* (a primeira versão deste trabalho, chegou a ir para a `main` como `49cfdf1`): exigia criar uma credencial de longa duração, guardá-la, rotacioná-la, mudar o `cloudbuild.yaml` (o build inteiro falharia se o segredo não existisse) e deixava uma rota de API exposta. Foi retirada; a mudança que publica a tabela remove a rota.
- *Portar os coletores para o dash novo*: semanas de trabalho e risco de coletar a mesma conta duas vezes. Só faz sentido quando houver data para aposentar o legado (Fase 3).

## O que foi feito

### Dash novo (`feature/publicar-contas-anuncio`, `c6f259b`)

- `services/ads-accounts-list.ts` (regras puras): conta válida (`act_` + dígitos; aceita `act=` e só dígitos), cliente **não arquivado** e **ativo**; uma linha por (conta, cliente), então Aurami e Cocci geram duas linhas para a mesma conta.
- `services/ads-accounts-bq.ts` e `services/ads-accounts-publisher.ts`: cria `up_global.ads_accounts` (`ad_account_id`, `client_id`, `client_name`, `commerce_platform`, `updated_at`) e **troca o conteúdo inteiro numa transação** (ou entra tudo, ou nada). Lê o cadastro **antes** de mexer no BigQuery; se a leitura falhar, a tabela publicada fica como está. Sem credencial do BigQuery (só desenvolvimento local), não faz nada.
- Quando publica: ao **criar** cliente (com conta), ao **criar cliente Vesti**, ao **editar** (se mudou conta, nome, plataforma ou ativo), ao **excluir** e ao **recuperar**; **de hora em hora** dentro do `hourly_bundle`; e na tarefa manual `TASK=sync_ads_accounts`. Falha ao publicar nunca desfaz a ação do usuário nem derruba o bundle (a próxima hora corrige).
- Remove a rota `GET /api/ads-accounts` (que estava na `main` sem uso).
- 13 testes novos. Sem migration.

### backend-dash (`feature/contas-do-dash-novo`, `a9a7daa`, num worktree isolado a partir da `origin/main`)

- `src/lib/upDashAdAccounts.ts`: lê `up_global.ads_accounts` (consulta com parâmetro, cache de 5 min; 1 min depois de uma falha). **Falha aberta**: tabela inexistente, BigQuery fora do ar ou permissão negada => lista vazia e aviso no log; a coleta segue só com o cadastro antigo. **Só Vesti por padrão** (`UPDASH_ADS_ACCOUNTS_PLATFORM`, padrão `VESTI`; `ALL` inclui as outras plataformas; vazio volta para `VESTI`, nunca amplia por engano). Interruptor de emergência: `ADS_ACCOUNTS_FROM_UPDASH_DISABLED=1`.
- `src/data/sources/adAccountsRepo.ts`: `getActiveAdAccountsFromDB()` junta as duas fontes, e **a lista de clientes excluídos continua valendo** para as contas do dash novo.
- **`cloudbuild.yaml` não muda** (sem variável nova, sem segredo).
- 15 testes novos; `tests/excludedClients.test.ts` continua passando. A única falha da suíte (`login-success.test.ts`) precisa de Postgres local e já falhava antes.
- Validado em dry-run no BigQuery real: a consulta parametrizada e o comando de criação da tabela são válidos (nada foi criado).

Todos os jobs de Facebook que dependem da lista passam por `getActiveAdAccountsFromDB()` (`runAdsIngestion.ts` e `backfillAdsHistory.ts`). Conferir antes da primeira execução se `ingest-insights`, `ingest-level-account`, `ingest-campaigns` e `ingest-details` obtêm as contas por essas funções (se algum tiver lista própria, ele não verá as contas novas).

## Implantação (nesta ordem)

1. **Publicar o dash novo** (`git -C C:/trabalho/up-glass-dev push origin feature/publicar-contas-anuncio:main`, com OK explícito). Só a rota e o publicador mudam; nenhuma tela muda.
2. **Fazer a tabela existir e encher** (sem esperar a hora cheia): na tela, abrir qualquer cliente Vesti (ex.: Estime), salvar a conta Meta **como está** e confirmar. Isso dispara a publicação. (Alternativa: depois do build da imagem do job, `TASK=sync_ads_accounts`.)
3. **Conferir a tabela no BigQuery.** Esperado: 14 linhas (13 contas, Aurami e Cocci dividem uma), incluindo `act_576902447698410` e `act_626178051781932`:

   ```sql
   SELECT ad_account_id, client_name, commerce_platform, updated_at
   FROM `up-vesti-report.up_global.ads_accounts`
   ORDER BY ad_account_id, client_name;
   ```

4. **Publicar o backend-dash.** Merge da `feature/contas-do-dash-novo` na `main` do backend-dash e build (não precisa de segredo):

   ```bash
   cd backend-dash
   gcloud builds submit --project=up-vesti-report --config=cloudbuild.yaml .
   ```

5. **Conferir a primeira coleta.** Nos logs do job aparece `[ads-accounts] 2 conta(s) a mais vindas do dash novo (total N)`. Se aparecer `não consegui ler as contas do dash novo`, a coleta seguiu só com o cadastro antigo: ver o erro (tabela, permissão de leitura do BigQuery).
6. **Histórico das duas contas novas** (a coleta diária só pega os últimos dias):

   ```bash
   gcloud run jobs execute up-jobs --project=up-vesti-report --region=europe-west1 --update-env-vars=JOB_NAME=backfill-new-client,BACKFILL_ACCOUNT=act_576902447698410 --wait
   gcloud run jobs execute up-jobs --project=up-vesti-report --region=europe-west1 --update-env-vars=JOB_NAME=backfill-new-client,BACKFILL_ACCOUNT=act_626178051781932 --wait
   ```

   (Por padrão busca 2 anos; `BACKFILL_START_DATE=AAAA-MM-DD` limita.) Se a execução der erro de permissão, o token global do Facebook não enxerga a conta: liberar o acesso no Business Manager.
7. **Conferir no BigQuery** (esperado: as duas contas com linhas até hoje):

   ```sql
   SELECT ad_account_id, MIN(date_start) AS de, MAX(date_start) AS ate, COUNT(*) AS dias
   FROM `up-vesti-report.data_ads_global.ads_insights_account`
   WHERE date_start >= DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL 400 DAY)
     AND ad_account_id IN ('act_576902447698410', 'act_626178051781932')
   GROUP BY 1;
   ```

8. **Só então** a troca das telas (linha A), ver `docs/plano-de-publicacao-2026-10.md`.

### Como voltar atrás

- Desligar só o novo comportamento da coleta: `ADS_ACCOUNTS_FROM_UPDASH_DISABLED=1` no job (volta a coletar só o cadastro antigo).
- Dash novo: `git revert` do commit do publicador e push. A tabela `up_global.ads_accounts` pode ficar (ninguém a lê sem o backend-dash novo).

## O que ainda falta (próximos passos)

- **Painel de status por cliente Vesti** (dataset existe, último dia de venda, conta cadastrada, última coleta, mensagem em linguagem simples), para explicar "por que está zerado" sem abrir o BigQuery.
- **Alerta de frescor**: aviso quando uma conta ativa passa de 2 dias sem linha nova (hoje o job falha em silêncio, como no Google Ads).
- **Verificar `User.adAccountIds`** no legado (contas na lista que a coleta não lê).
- **Fase 3** (aposentar o legado) e portar os coletores, só quando houver data.

## Riscos e como mitigar

| Risco | Mitigação |
|---|---|
| Coleta dupla da mesma conta | União deduplicada por id normalizado (com ou sem `act_`); teste de unidade |
| Mudança no backend-dash quebra a coleta de todas as marcas | Falha aberta + interruptor de emergência; sem a tabela, o comportamento é idêntico ao anterior |
| Publicação no BigQuery falha (Vercel) | Não desfaz a ação do usuário; o `hourly_bundle` republica de hora em hora; `TASK=sync_ads_accounts` manual |
| Token global do Facebook sem acesso a conta nova | O backfill mostra o erro por conta; liberar acesso no Business Manager |
| Limite de chamadas do Facebook com mais contas | Conferir no código se há espaçamento entre contas (não verificado) e observar os logs na primeira semana |

## O que não entra aqui

- Mover vendas Vesti para Postgres (decidido que **não**: BigQuery continua como armazém).
- Google Ads (guia à parte: `docs/google-ads-token.md`).
