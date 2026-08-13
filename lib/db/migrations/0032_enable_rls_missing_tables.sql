-- Supabase security advisor flagged these tables as publicly accessible via
-- the auto-generated PostgREST API (rls_disabled_in_public). App queries run
-- through a role that bypasses RLS, so enabling it with no policies only
-- blocks the public anon/authenticated API and does not affect the app.
ALTER TABLE "ai_agent_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_commercial_operations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_crm_cards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaign_attribution_stamps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "commercial_automation_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "commercial_automation_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "commercial_automation_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "daily_client_metrics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ecommerce_webhook_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ecommerce_webhook_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "upzero_integrations" ENABLE ROW LEVEL SECURITY;
