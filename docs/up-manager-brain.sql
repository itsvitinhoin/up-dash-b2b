-- Run in up-vesti-report, job location US, beside up_global.
CREATE SCHEMA IF NOT EXISTS `up-vesti-report.up_manager_brain`
OPTIONS (
  location = 'US',
  description = 'Up Manager B2C analysis history'
);

-- One immutable revision per run_id. date_to is the business date in São Paulo.
CREATE TABLE IF NOT EXISTS `up-vesti-report.up_manager_brain.analysis_runs` (
  run_id STRING NOT NULL,
  client_id STRING NOT NULL,
  analysis_day DATE NOT NULL,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  trigger STRING NOT NULL,
  skill_version STRING NOT NULL,
  created_at TIMESTAMP NOT NULL,
  archived_at TIMESTAMP NOT NULL,
  payload JSON NOT NULL
)
PARTITION BY date_to
CLUSTER BY client_id, trigger, skill_version
OPTIONS (require_partition_filter = TRUE);

-- Use a prunable date_to filter on reads of this view.
CREATE OR REPLACE VIEW `up-vesti-report.up_manager_brain.analysis_findings` AS
SELECT
  run.client_id, run.run_id, run.date_to, run.date_from, run.analysis_day,
  run.trigger, run.skill_version, run.created_at,
  JSON_VALUE(finding, '$.id') AS finding_id,
  JSON_VALUE(finding, '$.priority') AS priority,
  JSON_VALUE(finding, '$.title') AS title,
  JSON_VALUE(finding, '$.evidence') AS evidence,
  JSON_VALUE(finding, '$.hypothesis') AS hypothesis,
  JSON_VALUE(finding, '$.action') AS action,
  JSON_VALUE(finding, '$.owner') AS owner,
  JSON_VALUE(finding, '$.followUp') AS follow_up,
  'rules' AS analysis_source
FROM `up-vesti-report.up_manager_brain.analysis_runs` AS run
CROSS JOIN UNNEST(JSON_QUERY_ARRAY(run.payload, '$.findings')) AS finding
UNION ALL
SELECT
  run.client_id, run.run_id, run.date_to, run.date_from, run.analysis_day,
  run.trigger, run.skill_version, run.created_at,
  JSON_VALUE(insight, '$.id'),
  CASE WHEN JSON_VALUE(insight, '$.urgency') = 'now' THEN 'P1' ELSE 'P2' END,
  JSON_VALUE(insight, '$.title'),
  TO_JSON_STRING(JSON_QUERY(insight, '$.evidence')),
  JSON_VALUE(insight, '$.problem'),
  JSON_VALUE(insight, '$.action'),
  JSON_VALUE(insight, '$.owner'),
  JSON_VALUE(insight, '$.verification'),
  'openai'
FROM `up-vesti-report.up_manager_brain.analysis_runs` AS run
CROSS JOIN UNNEST(JSON_QUERY_ARRAY(run.payload, '$.agent.insights')) AS insight;
