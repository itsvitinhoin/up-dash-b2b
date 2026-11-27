ALTER TABLE "up_manager_ad_actions"
  DROP CONSTRAINT IF EXISTS "up_manager_ad_actions_status_check",
  ADD CONSTRAINT "up_manager_ad_actions_status_check"
    CHECK ("status" IN ('pending', 'paused', 'stale', 'uncertain', 'applied'));
