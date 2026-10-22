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
