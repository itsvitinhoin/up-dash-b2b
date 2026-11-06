-- Limpeza do historico duplicado, NIVEL ANUNCIO (data_ads_global.ads_insights). Gerado em 22/10/2026.
-- Previa (so leitura): ~14.100 linhas a remover em 27 contas (a maior: act_1044217252816711 = 7.706 linhas, R$ 3,28 mi -> R$ 2,82 mi).
-- Regra: para cada conta com repeticao, mantem UMA linha por (campanha, conjunto, anuncio, dia, quebras) (a de ingestion_timestamp mais recente).
-- As quebras (regiao, idade, genero, posicionamento, dispositivo) entram na chave para nunca juntar fatias diferentes do mesmo anuncio.
-- Seguro de repetir: sem duplicata, nao faz nada. Uma transacao por conta. Rodar fora da janela da coleta diaria.
FOR conta IN (
  SELECT ad_account_id, MIN(date_start) AS de, MAX(date_start) AS ate
  FROM (
    SELECT ad_account_id, date_start,
           COUNT(*) OVER (PARTITION BY ad_account_id, campaign_id, adset_id, ad_id, date_start, region, age, gender, placement, device_platform) AS copias
    FROM `up-vesti-report.data_ads_global.ads_insights`
    WHERE date_start >= '2024-01-01'
  )
  WHERE copias > 1
  GROUP BY ad_account_id
) DO
  BEGIN TRANSACTION;

  CREATE OR REPLACE TEMP TABLE linhas_unicas AS
  SELECT *
  FROM `up-vesti-report.data_ads_global.ads_insights`
  WHERE ad_account_id = conta.ad_account_id
    AND date_start BETWEEN conta.de AND conta.ate
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY campaign_id, adset_id, ad_id, date_start, region, age, gender, placement, device_platform
    ORDER BY ingestion_timestamp DESC, last_updated DESC
  ) = 1;

  DELETE FROM `up-vesti-report.data_ads_global.ads_insights`
  WHERE ad_account_id = conta.ad_account_id
    AND date_start BETWEEN conta.de AND conta.ate;

  INSERT INTO `up-vesti-report.data_ads_global.ads_insights`
  SELECT * FROM linhas_unicas;

  COMMIT TRANSACTION;
END FOR;
