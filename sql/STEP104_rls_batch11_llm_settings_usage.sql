-- ============================================================
-- STEP104: Multi-tenant RLS retrofit — Batch 11 (llm_settings,
-- llm_usage_logs). Exact current policy names/definitions confirmed by
-- reading STEP44/STEP46 directly.
--
-- llm_settings: org-wide API keys (per its own STEP44 header comment) —
-- each org should configure its own DeepSeek/Gemini keys, not share one
-- platform-wide set. Already uses a real UUID PK with app code
-- (src/lib/llmSettings.js) fetching the row's actual id dynamically
-- (`.limit(1).maybeSingle()` then `.eq('id', existing.id)`), not a fake
-- singleton id=1 pattern — no PK redesign needed, RLS alone now scopes
-- which row that first .limit(1) can see, and DEFAULT current_org_id()
-- handles the insert-when-none-exists path.
--
-- llm_usage_logs: per-request cost/token log — org-scoped for cost
-- attribution, consistent with every other $ table in this app.
--
-- kb_modules deliberately NOT touched here — it documents this
-- CODEBASE's own module architecture (its `key` column matches
-- src/config/modules.js literally), identical for every org running this
-- same app, same category as landing_page_templates staying global.
-- ============================================================

ALTER TABLE llm_settings ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE llm_settings SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE llm_settings ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE llm_settings ALTER COLUMN organization_id SET DEFAULT current_org_id();
DROP POLICY IF EXISTS llm_settings_select ON llm_settings;
DROP POLICY IF EXISTS llm_settings_write  ON llm_settings;
CREATE POLICY llm_settings_select ON llm_settings FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY llm_settings_write ON llm_settings FOR ALL USING (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin','ceo'))
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin','ceo'))
);

ALTER TABLE llm_usage_logs ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE llm_usage_logs SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE llm_usage_logs ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE llm_usage_logs ALTER COLUMN organization_id SET DEFAULT current_org_id();
DROP POLICY IF EXISTS llm_usage_logs_insert ON llm_usage_logs;
DROP POLICY IF EXISTS llm_usage_logs_select ON llm_usage_logs;
CREATE POLICY llm_usage_logs_insert ON llm_usage_logs FOR INSERT WITH CHECK (organization_id = current_org_id() AND auth.uid() IS NOT NULL);
CREATE POLICY llm_usage_logs_select ON llm_usage_logs FOR SELECT USING (
  organization_id = current_org_id() AND EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin','ceo'))
);

NOTIFY pgrst, 'reload schema';
