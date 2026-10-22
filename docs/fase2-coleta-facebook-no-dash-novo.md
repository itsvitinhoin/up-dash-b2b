# Fase 2: o dash novo passa a mandar na lista de contas de anúncio

Desenho curto, antes de construir. Decisões de arquitetura marcadas como **Decisão**.

## Problema

As telas Vesti do dash novo agora leem o gasto, as campanhas e os anúncios **só do dado guardado** (`data_ads_global.*` no BigQuery). Quem grava esse dado é a coleta do **backend-dash** (dash legado), que decide **quais contas coletar** olhando o cadastro **do legado**:

```ts
// backend-dash/src/data/sources/adAccountsRepo.ts
prisma.user.findMany({ where: { status: 'active', adAccountId: { not: null } }, select: { adAccountId: true } })
```

Consequências:

1. Marca cadastrada **só no dash novo** (com `clients.metaAdAccountId`) não é coletada: as telas mostram investimento 0 e listas vazias. Hoje obriga a cadastrar a marca também no legado, duplicando o cadastro.
2. O campo `User.adAccountIds` (lista) existe no legado, mas a coleta lê só `adAccountId`. Contas que estiverem apenas na lista **não são coletadas** (verificar se há alguma).
3. 17 das 37 contas coletadas em 19/10 estão sem dado novo (último dia entre 06/10/2025 e 30/09/2026); não dá para saber, só pela tabela, se são marcas que pararam de anunciar ou coleta falhando.

## Objetivo

O dash novo (`clients`) vira a **fonte da verdade** das contas de anúncio. A coleta continua gravando nas **mesmas tabelas** do BigQuery, então nenhuma tela quebra, e **nunca coleta a mesma conta duas vezes**.

## Fatos do código atual (verificados)

- A lista de contas está **centralizada** em `getActiveAdAccountsFromDB()`, usada por `runAdsIngestion.ts` e `backfillAdsHistory.ts`. Os jobs individuais (`ingest-insights`, `ingest-level-account`, `ingest-campaigns`, `ingest-details`) devem ser conferidos um a um antes da mudança, para garantir que todos passam por essa função.
- Gravação: tabela de staging e `MERGE` nas tabelas finais (idempotente; repetir período não duplica).
- Token do Facebook: variável global `FB_ACCESS_TOKEN`.
- Existem `backfill-new-client` (histórico de 2 anos de uma conta) e `ingest-details` (nome e miniatura dos anúncios, que grava `ad_account_id` **sem** `act_`).

## Opções

### Opção 1 (recomendada): lista de contas única, publicada pelo dash novo

O dash novo mantém uma tabela pequena no BigQuery, `up_global.ads_accounts` (`ad_account_id` com `act_`, `client_id`, `source = 'up-dash'`, `active`, `updated_at`), regravada:

- quando um cliente é criado/editado/arquivado (mudou `metaAdAccountId`, `archivedAt` ou `isActive`), e
- por uma reconciliação diária (garante que nada se perde se um evento falhar).

O backend-dash passa a coletar a **união** (sem repetição, normalizando `act_`) de: contas do legado (`status = 'active'`, `adAccountId` e `adAccountIds`) **e** `up_global.ads_accounts WHERE active`. Mudança no legado: uma função de ~20 linhas + teste. Quando um cliente novo entra, dispara-se o `backfill-new-client` para a conta (histórico) uma vez.

- Prós: poucos dias de trabalho; não duplica código de coleta; sem risco de coleta dupla (a união deduplica); reversível (remover a leitura da tabela devolve o comportamento antigo).
- Contras: o legado continua rodando a coleta. Quando o legado for aposentado, a coleta precisa migrar (Opção 2).

### Opção 2: portar a coleta para o dash novo

Reescrever os coletores (insights por anúncio, por conta, campanhas, conjuntos, detalhes, backfill) como jobs do api-server do dash novo, gravando nas mesmas tabelas.

- Prós: tira a dependência do legado de vez.
- Contras: semanas; duplicação até o desligamento; exige "dono por conta" (cada conta é coletada por um só lado) para não coletar em dobro.

### Decisão

Fazer a **Opção 1 agora** e tratar a **Opção 2** só quando houver data para aposentar o legado. A Opção 1 já resolve o problema real (marca nova no dash novo passa a ser coletada) e não impede a 2.

## Plano da Opção 1

1. **Verificação (sem mudar nada):** listar contas do legado (`adAccountId` e `adAccountIds`, `status`) e comparar com as 37 do BigQuery e com os `clients.metaAdAccountId` do dash novo (as consultas estão em `docs/plano-de-publicacao-2026-10.md`). Resultado: contas só no novo, só no legado, na lista mas não coletadas.
2. **Dash novo:** `services/ads-accounts-registry.ts` com `publishAdsAccounts()` (grava a tabela inteira com `WRITE_TRUNCATE` a partir de `clients`), chamado ao salvar cliente e por job diário. Botão/linha do cliente mostra o **status da coleta** (ver "Painel de status").
3. **backend-dash:** `getActiveAdAccountsFromDB()` passa a unir as duas fontes; teste de unidade da união e da normalização `act_`; conferir os jobs individuais.
4. **Ensaio:** rodar a coleta e comparar contas coletadas antes/depois (a diferença tem que ser só as contas novas esperadas).
5. **Backfill** das contas novas (`backfill-new-client`), um cliente por vez.
6. **Alerta de frescor:** consulta agendada que avisa quando uma conta ativa fica mais de 2 dias sem linha nova (hoje o job falha em silêncio, como no Google Ads).

## Painel de status por cliente Vesti (pequeno, entrega junto)

Para o usuário entender "por que está zerado" sem abrir o BigQuery, uma leitura somente de leitura por cliente Vesti:

- dataset existe e tem as tabelas esperadas; último dia com venda na `dashboard_vendas_view`;
- conta de anúncio cadastrada? tem linhas em `ads_insights_account`? último dia coletado e quantos dias nos últimos 30;
- resultado em linguagem simples: "ok", "conta não cadastrada", "conta não é coletada ainda", "coleta parada desde dd/mm".

## Riscos e como mitigar

| Risco | Mitigação |
|---|---|
| Coleta dupla da mesma conta | União deduplicada por id normalizado; teste de unidade; ensaio comparando contas antes/depois |
| Mudança no legado quebra a coleta de todas as marcas | Mudança de ~20 linhas atrás de uma variável (`ADS_ACCOUNTS_FROM_UPDASH=true`); desligar volta ao comportamento atual |
| Token global do Facebook sem acesso a conta nova | O backfill mostra o erro por conta; documentar quem libera o acesso no Business Manager |
| Limite de chamadas do Facebook com mais contas | Conferir no código se há espaçamento entre contas (não verificado) e observar os logs na primeira semana |

## O que não entra aqui

- Mover vendas Vesti para Postgres (decidido que **não**: BigQuery continua como armazém).
- Aposentar o legado (Fase 3).
- Google Ads (guia à parte: `docs/google-ads-token.md`).
