# Fase 3: histórico automático para conta nova, pedido pelo painel e todas as plataformas

Status (22/10/2026): **desenho aprovado pelo Marcelo; implementação por etapas.** Decisões do Marcelo: limpar as repetições na origem; histórico automático para conta nova; ir além da Vesti (todas as plataformas). "Meta é Meta; o que diferencia é o `act`."

## Onde estamos

- O dash publica `up_global.ads_accounts` (35 contas, todas as plataformas). A coleta do backend-dash lê essa tabela, **só da Vesti por padrão**.
- As telas Vesti leem tudo do BigQuery (`data_ads_global`). As telas dos outros clientes ainda usam o Facebook ao vivo.
- O histórico de uma conta nova **não é automático**: hoje é um comando manual (`backfill-new-client`) e o painel **não tem** botão para isso (só há botões de sincronizar pedidos UpZero/Nuvemshop; a página Extrações é só histórico).
- O BigQuery tem **linhas repetidas** no histórico antigo (previsão: 808 linhas no nível conta, ~14.100 no nível anúncio). Duas causas visíveis: uma coleta que rodou em dobro em 02 a 07/12/2025 (~25 contas) e o bug do `backfill-new-client` (Sessi/fev, conta `…704546`/mai, Tuba Plus/out).

## Etapa 1: limpar (dados) e proteger (leitura)

- **Leitura protegida** (`fix/leitura-guardada-sem-duplicatas`): as telas já ignoram repetições; verificado no BigQuery real.
- **Limpeza na origem**, dois scripts em `docs/operacao/` (um por tabela), validados em simulação:
  - `2026-10-22-limpeza-historico-duplicado-conta.sql`
  - `2026-10-22-limpeza-historico-duplicado-anuncio.sql`
  - Descobrem sozinhos as contas afetadas, uma transação por conta, seguros de repetir. Rodar **fora da janela da coleta diária** (de manhã cedo, horário de Brasília).
- Conferência depois: repetir a varredura (zero repetições) e comparar o gasto por conta com a prévia.

## Etapa 2: conserto do bug do histórico

`fix/backfill-novo-cliente-roda-duas-vezes` (`30afb24`, no backend-dash): o histórico rodava duas cópias ao mesmo tempo. **Precisa de push e build antes de qualquer outro histórico**, inclusive o automático.

## Etapa 3: histórico automático e pedido pelo painel (mesmo canal do BigQuery, sem chave nova)

**Tabelas em `up_global`:**

| Tabela | Quem escreve | Para quê |
|---|---|---|
| `ads_accounts` (já existe) | dash | quais contas coletar |
| `ads_backfill_requests` | dash (botão do painel) | pedido manual: "buscar histórico desta conta" (conta, desde quando, quem pediu) |
| `ads_backfill_status` | backend-dash | estado de cada conta: `pending`, `running`, `done`, `failed`; início, fim, linhas gravadas, erro, tentativas |

**Job novo do backend-dash (`ads-onboarding`):**

1. Lê as contas (cadastro antigo mais `ads_accounts`, plataformas configuradas).
2. Escolhe quem precisa de histórico: contas **sem nenhuma linha** em `ads_insights_account` (conta nova, automático) **ou** com pedido aberto em `ads_backfill_requests`.
3. Processa no máximo **N contas por execução** (padrão 2), uma de cada vez, com `runBackfillNewClient` (já corrigido). Marca `running`, depois `done` ou `failed` (com o erro). Trava contra execução simultânea (linha `running` recente bloqueia; vira "expirada" depois de 2 h).
4. **Protege o token do Facebook:** ao receber erro de limite de chamadas (código 17, 4, 32, 613), para a execução inteira e deixa o resto para a próxima. Conta sem permissão (#200) vira `failed` com mensagem clara, sem repetir toda hora (volta a tentar só com novo pedido).
5. Roda por agendamento (Cloud Scheduler, a cada hora de madrugada e manhã) ou manualmente: `JOB_NAME=ads-onboarding`.

**Painel (dash novo):**

- No botão **Meta** da linha do cliente: mostra o status de histórico ("sem histórico", "em andamento", "pronto desde dd/mm", "erro: ...") e o **último dia coletado**, lidos do BigQuery (`ads_backfill_status` e `ads_insights_account`).
- Botão **"Buscar histórico"**: grava o pedido em `ads_backfill_requests` (e já publica `ads_accounts`). Sem credencial nova: é o mesmo canal que o dash já usa para publicar listas.
- Isso entrega também o "painel de status por cliente" que estava pendente.

### Estado da implementação (22/10/2026)

- **Limpeza das repetições: feita e conferida.** Rodada em 22/10 às 15:03 a 15:09 (horário de Brasília). Depois: zero repetições nos dois níveis e totais idênticos à prévia (nível anúncio R$ 4.086.364,08 em 27 contas; nível conta R$ 69.777,60 em 3 contas). Nenhum gasto real se perdeu.
- **Leitura que ignora repetições e conserto do histórico: publicados** (dash novo `d9edcc2`; backend-dash `30afb24`). O conserto do backend-dash precisa do build para valer em produção.
- **`ads-onboarding` (backend-dash): implementado, commit `e948445` na branch `feature/ads-onboarding`, ainda não publicado.** 52 testes novos; SQL de gravação validado no BigQuery real (tabela temporária); a simulação com dados reais escolheu as 18 contas esperadas (17 sem coleta mais a Estime, que nunca gastou e vira "pronta" com 0 linhas). O histórico (`backfill-new-client`) agora devolve as linhas gravadas e os **meses que falharam** (antes o erro de cada mês virava só uma linha de log).
### Primeira execução real em produção (23/10/2026) e o que mudou por causa dela

- **Datas vazias no estado:** o cliente do BigQuery transforma texto simples em NULL quando o parâmetro é DATE/TIMESTAMP. Corrigido (`38255b3`, no ar) e coberto por teste com a conversão real do cliente.
- **Quatro contas do cadastro antigo deram `#200 sem permissão` em todos os meses** (`690877388119129`, `272854387631308`, `535757024259201`, `2348317895247346`). Ficam `failed` e não repetem sozinhas. É acesso, não código: o cliente precisa voltar a compartilhar a conta com a Meta da agência, ou a conta sai do cadastro. A `535757024259201` tem histórico de anúncio de 2023 a 2024-12 e depois nada (perdeu a permissão).
- **Falha na regra de "conta nova" (corrigida em `805e4ce`, ainda local):** a regra antiga tratava como coberta qualquer conta com pelo menos uma linha no nível conta. Só que a coleta diária (02:00) roda ANTES do onboarding (03:30 a 08:30) e já grava o dia de uma conta recém cadastrada; ela virava "coberta" e nunca recebia histórico (visto na `1418950000264215`: só 18 a 23/10). Agora: entra se não tem linha nenhuma OU se a primeira linha (nos dois níveis) tem até 60 dias. Nesse caso o histórico vai só até o dia anterior à primeira linha: o ad-level apaga o período antes de regravar, então assim as linhas da coleta diária nunca são tocadas. O limite fica na coluna nova `end_date` do estado, para a retentativa respeitar o mesmo limite. Cada conta é tratada uma vez (quem decide depois é o estado).
- **Na produção, hoje, essa regra pegaria 2 contas:** `1418950000264215` (primeira linha 2026-10-18) e `987747454966549` (2026-08-31). Elas só entram depois do build.
- **Implantação:** a coluna `end_date` é criada sozinha (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) na primeira execução real depois do build; a leitura do estado usa `SELECT *` para a simulação não quebrar antes disso.

### Painel: status e botão "Buscar histórico" (23/10/2026, feito localmente, ainda NÃO publicado)

- **Dash novo** (branch `feature/historico-anuncios-painel`, commit `e86a36b`): no diálogo **Meta** da linha do cliente aparece o bloco "Histórico de anúncios" com a fase (sem histórico / na fila / buscando agora / aguardando limite do Facebook / pronto / parcial / com erro), os dias já coletados (de, até, quantos), o resultado da última busca e o botão **Buscar histórico** (data de início opcional; sem data, vale 01/01/2025). Rotas só de admin: `GET /api/clients/:id/ads-history` e `POST /api/clients/:id/ads-history/request`.
- **Só pelo BigQuery, sem chave nova:** o dash grava o pedido em `up_global.ads_backfill_requests` (mesma definição da tabela do backend) e lê `ads_backfill_status` e a cobertura de `ads_insights_account`. O pedido entra na fila e o job `ads-onboarding` (agendado, 03:30 a 08:30 de Brasília) busca; a tela atualiza sozinha enquanto está na fila ou rodando.
- **Travas no servidor** (o botão pode estar velho na tela): recusa pedido se já há pedido na fila, histórico rodando ou "aguardando limite"; recusa cliente na lixeira, sem conta válida ou data inválida (antes de 2023-01-01 ou no futuro). Conta que falhou por falta de permissão PODE pedir de novo (para depois que o cliente liberar o acesso) e a tela explica o erro #200 em português.
- **Conferido no navegador** com uma API de mentira local (os quatro estados, o clique no botão e o pedido enviado). Testes: 40 novos em `artifacts/api-server/test/ads-history.test.ts`.
- **Proteção no backend-dash** (branch `fix/backfill-busca-antes-de-apagar`, commit `75917b8`): o histórico por anúncio apagava o período ANTES de buscar no Facebook; se a busca falhasse, o dado existente se perdia. Agora busca primeiro e só apaga se vieram linhas (`lib/refreshPeriod.ts`). Importante porque o botão torna fácil pedir de novo numa conta que perdeu o acesso. **Publicar o backend-dash ANTES do dash.**
- **Ordem de publicação:** (1) push do backend-dash (o gatilho builda e deploya sozinho; conferir `gcloud builds list`, sem build manual); (2) push do dash (main = Vercel).
- **Sugestão (decisão do Marcelo):** hoje o job só roda das 03:30 às 08:30; um pedido feito de tarde espera até a manhã seguinte. Se isso incomodar, dá para estender o agendamento (`schedule-ads-onboarding`) para o dia todo; o job já para sozinho ao bater no limite do Facebook e processa só 2 contas por vez.

- **Falta:** publicar o painel (ver acima) e a Etapa 4.

### Achado: cada coleta de anúncios é agendada duas vezes

No Cloud Scheduler (`us-central1`) existem **dois agendamentos ativos para o mesmo horário** em cada job de anúncio:

| Job | Caminho antigo (serviço) | Caminho novo (Cloud Run Job) |
|---|---|---|
| insights por anúncio | `ingest-facebook-insights` -> `/jobs/ingest-insights` | `schedule-ingest-insights` -> `up-jobs:run` |
| detalhes | `ingest-facebook-details` | `schedule-ingest-details` |
| campanhas | `ingest-facebook-campaigns` | `schedule-ingest-campaigns` |
| nível conta | `ingest-facebook-levelAccount` -> `/ingestion/ads/run-account` (**falha com 401**, inofensivo) | `schedule-ingest-level-account` |

Conferido nos logs de 22/10 (UTC): o caminho antigo **executa** (insights 206 s, detalhes 54 s, campanhas 87 s, todos com resposta 200) em paralelo ao do job. Consequências: o **dobro de chamadas ao Facebook** (pesa no limite de chamadas, que já estourou uma vez em 22/10) e **corridas de gravação** que explicam as repetições (por exemplo 02 a 07/12/2025). Os horários das execuções são **UTC** (a coleta roda às 05:00 a 05:10 UTC, que é 02:00 a 02:10 em Brasília).

**Recomendação (decisão do Marcelo, reversível):** pausar os quatro agendamentos do caminho antigo e manter os do Cloud Run Job (que já têm tempo limite de 1 h e tentativas):

```bash
gcloud scheduler jobs pause ingest-facebook-insights --project=up-vesti-report --location=us-central1
gcloud scheduler jobs pause ingest-facebook-details --project=up-vesti-report --location=us-central1
gcloud scheduler jobs pause ingest-facebook-campaigns --project=up-vesti-report --location=us-central1
gcloud scheduler jobs pause ingest-facebook-levelAccount --project=up-vesti-report --location=us-central1
```

Para desfazer: `gcloud scheduler jobs resume <nome> --project=up-vesti-report --location=us-central1`. Conferir no dia seguinte: execuções do `up-jobs` às 05:00 a 05:10 UTC com sucesso e dados do dia no BigQuery.

### Implantação do `ads-onboarding`

1. **Publicar e fazer o build** (backend-dash; o build sai do clone limpo):

   ```bash
   git -C C:/trabalho/wt-backend-contas push origin feature/ads-onboarding:main
   cd C:/trabalho/build-backend-dash
   git pull
   gcloud builds submit --project=up-vesti-report --config=cloudbuild.yaml .
   ```

2. **Simulação** (só lista quem seria processado; não cria tabela nem grava nada):

   ```bash
   gcloud run jobs execute up-jobs --project=up-vesti-report --region=europe-west1 --update-env-vars="JOB_NAME=ads-onboarding,ONBOARDING_DRY_RUN=1" --wait
   ```

3. **Execução real** (processa até 2 contas; as tabelas `ads_backfill_requests` e `ads_backfill_status` são criadas na primeira vez):

   ```bash
   gcloud run jobs execute up-jobs --project=up-vesti-report --region=europe-west1 --update-env-vars="JOB_NAME=ads-onboarding" --wait
   ```

4. **Agendar** (depois de uma execução real boa). Mesmo formato dos agendamentos existentes, de hora em hora das 03:30 às 08:30 em Brasília (depois da coleta noturna). No PowerShell, o corpo vai por arquivo para não brigar com as aspas:

   ```powershell
   '{"overrides":{"containerOverrides":[{"env":[{"name":"JOB_NAME","value":"ads-onboarding"}]}]}}' | Set-Content -NoNewline body-onboarding.json
   gcloud scheduler jobs create http schedule-ads-onboarding --project=up-vesti-report --location=us-central1 --schedule="30 3-8 * * *" --time-zone="America/Sao_Paulo" --uri="https://europe-west1-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/up-vesti-report/jobs/up-jobs:run" --http-method=POST --message-body-from-file=body-onboarding.json --oauth-service-account-email=928204832932-compute@developer.gserviceaccount.com --oauth-token-scope=https://www.googleapis.com/auth/cloud-platform --attempt-deadline=180s --max-retry-attempts=1
   ```

5. **Conferir o estado** no BigQuery:

   ```sql
   SELECT ad_account_id, state, attempts, rows_ad, rows_account, resume_from, error, updated_at
   FROM `up-vesti-report.up_global.ads_backfill_status` ORDER BY updated_at DESC;
   ```

   Interruptor de emergência: `ADS_ONBOARDING_DISABLED=1`. Por padrão traz o histórico desde 2025-01-01 (`ONBOARDING_START_DATE`) e 2 contas por execução (`ONBOARDING_MAX_PER_RUN`).

## Etapa 4: ir além da Vesti (todas as plataformas)

1. **Coleta:** padrão `UPDASH_ADS_ACCOUNTS_PLATFORM` passa a `ALL` **no código** (o `cloudbuild.yaml` usa `--set-env-vars`, que apaga variável colocada à mão). As 17 contas sem coleta (Nuvemshop 9, UpZero 6, Manual 2) entram no `ads-onboarding` em lotes de 2 por execução, respeitando o limite do Facebook.
2. **Telas:** um único ponto de troca, `fetchMetaMarketingDataIfConnected` (`services/meta-connected.ts`), usado por Diário, Marketing, Campanhas e contexto de insights. Passa a ler do dado guardado, montando o mesmo formato (`MetaMarketingData`) a partir das leituras que já existem para a Vesti. Controle por variável `ADS_SOURCE`:
   - `live`: como hoje (Facebook ao vivo);
   - `auto` (transição): usa o guardado quando a conta tem dado recente, e o ao vivo só para conta ainda sem histórico, para nenhum cliente zerar durante a migração;
   - `stored` (meta final): só guardado; sem ao vivo.
3. **Postgres `creatives`:** deixa de ser alimentada pelo Facebook (job `meta_ads` e gravação ao abrir tela) e passa a ser derivada do dado guardado, ou é substituída pela leitura direta. Elimina a duplicidade de chamadas ao Facebook.
4. **Regra para conta compartilhada** (Aurami/Cocci, Kalli/Kalli Fashion, Adama/UP Adama): a conta é a unidade; o gasto não é dividido por marca. Definir regra explícita (por prefixo do nome da campanha ou rateio) antes de somar portfólio.

## Ordem de execução

1. Publicar a leitura protegida e os scripts. **Rodar a limpeza** (conta e anúncio) e conferir.
2. Push e build do conserto do histórico (backend-dash).
3. Implementar `ads-onboarding` e as duas tabelas; ligar o painel (status e botão).
4. Trocar o padrão para `ALL` e deixar o histórico rodar em lotes; acompanhar o log e o status.
5. Migrar as telas dos outros clientes com `ADS_SOURCE=auto`; quando a cobertura estiver completa, `stored`.
6. Alerta de frescor: aviso quando uma conta ativa passa de 2 dias sem linha nova.

## Riscos

| Risco | Mitigação |
|---|---|
| Limite de chamadas do Facebook | N contas por execução; para no primeiro erro de limite; histórico em lotes |
| Conta sem permissão no token global | Status `failed` com mensagem; não repete sozinho; liberar acesso no Business Manager |
| Histórico duplicado de novo | Bug do runner corrigido + teste de regressão; limpeza e leitura que ignora repetição |
| Cliente zerado na migração das telas | `ADS_SOURCE=auto` com ao vivo só para conta sem histórico; `stored` só com cobertura completa |
| Limpeza apagar dado errado | Prévia só de leitura, script validado em simulação, transação por conta, copias idênticas |
