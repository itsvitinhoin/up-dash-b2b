-- Limpeza do historico duplicado, NIVEL CONTA (data_ads_global.ads_insights_account). Gerado em 22/10/2026.
-- Previa (so leitura): 808 linhas a remover em 3 contas (act_387354336390438 = 441; act_587857881834583 = 359; act_1326574462704546 = 8).
-- Regra: para cada conta com dia repetido, mantem UMA linha por dia (a de ingestion_timestamp mais recente) e remove as copias. Copias identicas.
-- Seguro de repetir: sem duplicata, nao encontra nenhuma conta e nao faz nada. Uma transacao por conta (ou entra tudo, ou nada).
-- Rodar fora da janela da coleta diaria (a coleta diaria roda de manha cedo, horario de Brasilia).
FOR conta IN (
  SELECT ad_account_id, MIN(date_start) AS de, MAX(date_start) AS ate
  FROM (
    SELECT ad_account_id, date_start,
           COUNT(*) OVER (PARTITION BY ad_account_id, date_start) AS copias
    FROM `up-vesti-report.data_ads_global.ads_insights_account`
    WHERE date_start >= '2024-01-01'
  )
  WHERE copias > 1
  GROUP BY ad_account_id
) DO
  BEGIN TRANSACTION;

  CREATE OR REPLACE TEMP TABLE linhas_unicas AS
  SELECT *
  FROM `up-vesti-report.data_ads_global.ads_insights_account`
  WHERE ad_account_id = conta.ad_account_id
    AND date_start BETWEEN conta.de AND conta.ate
  QUALIFY ROW_NUMBER() OVER (PARTITION BY date_start ORDER BY ingestion_timestamp DESC, last_updated DESC) = 1;

  DELETE FROM `up-vesti-report.data_ads_global.ads_insights_account`
  WHERE ad_account_id = conta.ad_account_id
    AND date_start BETWEEN conta.de AND conta.ate;

  INSERT INTO `up-vesti-report.data_ads_global.ads_insights_account`
  SELECT * FROM linhas_unicas;

  COMMIT TRANSACTION;
END FOR;
