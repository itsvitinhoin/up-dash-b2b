# Gasto de anúncios do cliente Vesti: só do dado guardado

## O que mudou

O painel do cliente Vesti (Clientes por campanha, Relatório diário, Escala e Marketing) lia o gasto de anúncios **ao vivo** na API do Meta (Graph) e só olhava o dado guardado quando o ao vivo vinha zerado. Agora o **gasto, o resumo e o gráfico de gasto por dia** vêm **só do dado guardado**: BigQuery `data_ads_global.ads_insights_account`, uma linha por conta e por dia, gravada pela coleta diária do `backend-dash` (`ingestFacebookInsightsAccount`).

Princípio: a tela nunca depende de API de terceiro para mostrar dado; quem coleta é o sync (como o dash legado).

## Campanhas, anúncios e criativos (degraus 2 e 3)

As telas Vesti **não chamam mais o Meta ao vivo para nada**. Além do gasto, também vêm do dado guardado:

- **Relatório diário:** lista de campanhas (gasto, compras, receita, ROAS, custo por compra), de `ads_insights` somado por campanha; status atual de `ads_campaigns`.
- **Marketing:** lista de anúncios, "Top criativos" (melhor CTR, menor custo por lead, mais leads) e imagem de cada anúncio, de `ads_insights` somado por anúncio; nome, status e miniatura de `ads_details`.

Conferido em 21/10/2026 contra o BigQuery real (01/10 a 18/10), nas 3 maiores contas: a soma por campanha e a soma por anúncio batem **exatamente** com o total da conta (R$ 174.128,85, R$ 27.642,97 e R$ 3.308,65), e 100% dos anúncios com gasto têm nome, status e imagem. A tabela por anúncio não tem linhas por região/idade/gênero (essas colunas vêm vazias), então não há contagem em dobro.

Diferenças para o ao vivo, que quem lê os números precisa saber:

- **Cliques:** o guardado conta todos os cliques; o ao vivo contava cliques no link. O CTR guardado fica um pouco maior (é a mesma base do dash legado).
- **Imagem:** vem a miniatura guardada. Não há vídeo nem link de prévia (campos vazios, tipo "imagem" ou "desconhecido").
- **Anúncio criado hoje:** o nome e a miniatura só chegam com a próxima coleta de detalhes (por volta das 05:00 UTC). Até lá aparece com o nome da campanha.
- **Atenção em `ads_details`:** o id da conta é gravado SEM o prefixo `act_` (nas outras tabelas vem com ele). A leitura compara sem o prefixo; foi isso que escondeu os detalhes na primeira conferência.
- **Tabela de criativos no Postgres** (`creatives`): continua sendo atualizada ao abrir Relatório diário e Marketing, agora a partir do dado guardado. Ela alimenta a lista de clientes e o relatório do portfólio. É escrita ao ler, uma dívida conhecida a resolver quando essas telas lerem do guardado.
- O token do Meta (`META_ADS_API_KEY` e o campo por cliente) deixou de ser usado pelas telas Vesti.

## Consequências para quem lê os números

- **O dia de hoje pode estar incompleto**: a coleta é periódica, então o gasto de "hoje" pode aparecer menor que no Meta até a próxima coleta (conferido em 19/10/2026: 18 das 37 contas já tinham linha do próprio dia 19).
- **Contas paradas**: em 19/10/2026 havia 37 contas coletadas; 17 delas com último dia antes de 18/10 (entre 06/10/2025 e 30/09/2026). Se for marca ativa, a coleta dela está falhando ou a conta saiu do cadastro do legado.
- **Conta que a coleta não conhece mostra R$ 0,00.** A coleta lê as contas cadastradas no dash legado (`User.adAccountId(s)`). Cliente Vesti novo, com `metaAdAccountId` no dash novo mas sem a conta no legado, não tem linha guardada. Antes o ao vivo escondia isso; agora aparece como zero. Isso é um aviso certo: falta a coleta da conta (fase 2 do plano move a coleta para o dash novo).
- Erro ao ler o BigQuery (ou linha guardada sem valor de gasto) vira HTTP 503 `MEDIA_UNAVAILABLE`, nunca R$ 0,00 (regra "indisponível não é zero", da conciliação de 21/10/2026). Conta não cadastrada no cliente = 0, porque não há o que ler. Detalhes em `docs/conciliacao-ajustes-sobre-03408ed.md`.
- Leituras ficam em cache por 5 minutos.
- `upsertMetaCreatives` (grava criativos no Postgres) deixou de rodar em Clientes por campanha e na Escala; continua no Relatório diário e no Marketing, onde os anúncios ainda são lidos ao vivo.

## Onde está

- `artifacts/api-server/src/services/vesti-ads-stored.ts`: leitura do dado guardado (`fetchStoredAdsDaily`, `totalSpend`, `spendSeries`). O id da conta é padronizado para `act_...` (formato gravado pela coleta) e vai como parâmetro da consulta, nunca colado no texto SQL.
- `artifacts/api-server/src/controllers/vestiDashboardController.ts`: `loadStoredAds` e `resolveVestiInvestment` nos quatro pontos.
- Removida a função antiga `fetchVestiMetaSpendFromBigQuery` (`vestiAnalytics.ts`), que só servia de reserva.
- Testes: `artifacts/api-server/test/vesti-ads-stored.test.ts` (27) e `test/vesti-stored-controller.test.ts` (12: telas Relatório diário e Marketing de ponta a ponta, com BigQuery simulado).

## Linhas repetidas no histórico guardado (achado de 22/10/2026)

O BigQuery guardado tem **linhas repetidas (cópias idênticas, sem quebra por região/idade)** no histórico antigo, vindas de coletas e histórias que rodaram em duplicidade (inclusive o bug do `backfill-new-client`, que rodava duas cópias ao mesmo tempo). Medido:

- **Nível conta** (`ads_insights_account`): Venoro (441 dias, 02/2025 a 25/05/2026), Milalai (359 dias, 10/2024 a 25/05/2026) e outra conta (8 dias, maio/2026).
- **Nível anúncio** (`ads_insights`): Venoro e Milalai (2x em todo o histórico até abril/maio de 2026), a conta `act_1044217252816711` (dez/2025), e dias de 02 a 07/12/2025 em várias contas (Vogabox, Vn11, Adama...). Os **últimos 60 dias estão limpos** em todas as contas.
- As *views* `ads_insights_latest` e `ads_insights_summary_daily` **não** removem repetição, e o dash legado lê `ads_insights_account` somando, então o legado também mostra esses períodos antigos inflados.

**Proteção na leitura (esta mudança):** as três consultas passam a usar **uma linha por dia (conta)** e **uma linha por (campanha, conjunto, anúncio, dia, quebras)** (a mais recente), antes de somar. Conferido no BigQuery real: Venoro jun/2025 R$ 1.063,13 e Milalai jun/2025 R$ 167,19 (antes saíam em dobro) batem exatamente em conta, campanhas e anúncios; Doce Deleite (sem repetição) não mudou; Vogabox e Adama (dez/2025) batem exato por conta e ficam a 0,6% e 0,03% por campanha/anúncio.

**Ainda pendente:** limpar as repetições na origem (benefício também para o dash legado). É uma escrita grande no BigQuery de produção; fazer por conta e por mês, com prévia, como na Tuba Plus (`docs/operacao/2026-10-22-limpeza-tuba-plus-marco.sql`).

## Como conferir antes de publicar

1. Lista de contas que a coleta conhece (só leitura, BigQuery):

```sql
SELECT ad_account_id, MIN(date_start) AS primeiro_dia, MAX(date_start) AS ultimo_dia, ROUND(SUM(spend), 2) AS gasto_total
FROM `up-vesti-report.data_ads_global.ads_insights_account`
GROUP BY ad_account_id
ORDER BY ultimo_dia DESC;
```

2. Clientes Vesti do dash novo com conta cadastrada (Postgres):

```sql
SELECT name, meta_ad_account_id FROM clients
WHERE commerce_platform = 'VESTI' AND meta_ad_account_id IS NOT NULL AND archived_at IS NULL
ORDER BY name;
```

3. Cruzar: toda conta do passo 2 precisa aparecer no passo 1 com `ultimo_dia` recente. Quem não aparecer vai mostrar R$ 0,00 depois da troca.
4. Comparar o gasto de 2 ou 3 marcas num período fechado (ex.: mês passado) entre o painel atual (ao vivo) e o novo (guardado). Diferenças pequenas são esperadas (atribuição do Meta ajusta valores dias depois; a coleta guarda o que o Meta devolveu no dia da coleta).
