ALTER TABLE "sync_jobs"
  ADD COLUMN IF NOT EXISTS "job_type" text DEFAULT 'upzero_transactional' NOT NULL,
  ADD COLUMN IF NOT EXISTS "trigger" text DEFAULT 'manual' NOT NULL,
  ADD COLUMN IF NOT EXISTS "scope" text DEFAULT 'client' NOT NULL,
  ADD COLUMN IF NOT EXISTS "started_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "finished_at" timestamp with time zone;

CREATE INDEX IF NOT EXISTS "sync_jobs_type_idx"
  ON "sync_jobs" ("job_type");

CREATE INDEX IF NOT EXISTS "sync_jobs_trigger_idx"
  ON "sync_jobs" ("trigger");

CREATE INDEX IF NOT EXISTS "sync_jobs_created_at_idx"
  ON "sync_jobs" ("created_at");
