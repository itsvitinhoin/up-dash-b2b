# Gasto de anúncios do cliente Vesti: só do dado guardado

## O que mudou

O painel do cliente Vesti (Clientes por campanha, Relatório diário, Escala e Marketing) lia o gasto de anúncios **ao vivo** na API do Meta (Graph) e só olhava o dado guardado quando o ao vivo vinha zerado. Agora o **gasto, o resumo e o gráfico de gasto por dia** vêm **só do dado guardado**: BigQuery `data_ads_global.ads_insights_account`, uma linha por conta e por dia, gravada pela coleta diária do `backend-dash` (`ingestFacebookInsightsAccount`).

Princípio: a tela nunca depende de API de terceiro para mostrar dado; quem coleta é o sync (como o dash legado).

## O que NÃO mudou (ainda)

- **Lista de campanhas** (Relatório diário) e **anúncios, criativos e top criativos** (Marketing) ainda vêm do Meta ao vivo. São os próximos degraus (campanhas, depois anúncios).
- Quem usa o token do Meta ao vivo: só essas duas listas. O gasto não depende mais dele.

## Consequências para quem lê os números

- **O dia de hoje pode estar incompleto**: a coleta é periódica, então o gasto de "hoje" pode aparecer menor que no Meta até a próxima coleta (conferido em 19/10/2026: 18 das 37 contas já tinham linha do próprio dia 19).
- **Contas paradas**: em 19/10/2026 havia 37 contas coletadas; 17 delas com último dia antes de 18/10 (entre 06/10/2025 e 30/09/2026). Se for marca ativa, a coleta dela está falhando ou a conta saiu do cadastro do legado.
- **Conta que a coleta não conhece mostra R$ 0,00.** A coleta lê as contas cadastradas no dash legado (`User.adAccountId(s)`). Cliente Vesti novo, com `metaAdAccountId` no dash novo mas sem a conta no legado, não tem linha guardada. Antes o ao vivo escondia isso; agora aparece como zero. Isso é um aviso certo: falta a coleta da conta (fase 2 do plano move a coleta para o dash novo).
- Erro ao ler o BigQuery não derruba a tela: o gasto vira 0 e o servidor registra um aviso (`[vesti] gasto de anúncios guardado indisponível`).
- Leituras ficam em cache por 5 minutos.
- `upsertMetaCreatives` (grava criativos no Postgres) deixou de rodar em Clientes por campanha e na Escala; continua no Relatório diário e no Marketing, onde os anúncios ainda são lidos ao vivo.

## Onde está

- `artifacts/api-server/src/services/vesti-ads-stored.ts`: leitura do dado guardado (`fetchStoredAdsDaily`, `totalSpend`, `spendSeries`). O id da conta é padronizado para `act_...` (formato gravado pela coleta) e vai como parâmetro da consulta, nunca colado no texto SQL.
- `artifacts/api-server/src/controllers/vestiDashboardController.ts`: `loadStoredAds` e `resolveVestiInvestment` nos quatro pontos.
- Removida a função antiga `fetchVestiMetaSpendFromBigQuery` (`vestiAnalytics.ts`), que só servia de reserva.
- Testes: `artifacts/api-server/test/vesti-ads-stored.test.ts` (12).

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
