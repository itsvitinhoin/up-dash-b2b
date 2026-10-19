CREATE TABLE IF NOT EXISTS "upzero_analytics_availability" (
  "scope" text NOT NULL,
  "endpoint" text NOT NULL CHECK ("endpoint" IN ('facts', 'metrics')),
  "retry_after" timestamp with time zone NOT NULL,
  "reason" text NOT NULL CHECK ("reason" IN ('disabled', 'unavailable', 'rate_limited')),
  PRIMARY KEY ("scope", "endpoint")
);
