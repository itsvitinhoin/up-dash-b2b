-- Limpeza pontual (22/10/2026): Tuba Plus (act_626178051781932), marco/2026, nivel anuncio (ads_insights).
-- Causa: o job backfill-new-client rodou DUAS copias ao mesmo tempo (main() solto no fim de backfillNewClient.ts) e as duas inseriram as mesmas
-- linhas. Previa (so leitura): 154 linhas = 77 combinacoes (ad_id, date_start) x 2 copias IDENTICAS; gasto 5655,28 -> 2827,64 depois da limpeza,
-- igual ao total de marco no nivel conta (ads_insights_account). Mantem a copia mais recente de cada combinacao e remove as demais.
BEGIN TRANSACTION;

CREATE TEMP TABLE linhas_unicas AS
SELECT *
FROM `up-vesti-report.data_ads_global.ads_insights`
WHERE ad_account_id = 'act_626178051781932'
  AND date_start BETWEEN '2026-03-01' AND '2026-03-31'
QUALIFY ROW_NUMBER() OVER (PARTITION BY ad_id, date_start ORDER BY ingestion_timestamp DESC) = 1;

DELETE FROM `up-vesti-report.data_ads_global.ads_insights`
WHERE ad_account_id = 'act_626178051781932'
  AND date_start BETWEEN '2026-03-01' AND '2026-03-31';

INSERT INTO `up-vesti-report.data_ads_global.ads_insights`
SELECT * FROM linhas_unicas;

COMMIT TRANSACTION;
