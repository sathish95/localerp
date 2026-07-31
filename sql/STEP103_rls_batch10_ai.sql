-- ============================================================
-- STEP103: Multi-tenant RLS retrofit — Batch 10 (Neo Task AI, 6 tables).
-- Exact current policy names/definitions confirmed by reading STEP24
-- directly (STEP24b only added a column, no policy changes).
--
-- ai_analysis_sessions has a custom ownership+role policy (not the simple
-- {table}_select/{table}_write pattern used elsewhere) — preserved
-- exactly, just ANDed with the org predicate. There is deliberately no
-- DELETE policy on ai_analysis_sessions today (RLS defaults to deny) —
-- left as-is, not added here.
--
-- Child tables (stories/backlog/tasks/test_cases/apis) only carry
-- session_id, not their own project_id in every case — same reasoning as
-- the proposal batch's children: a flat backfill to default-org is
-- correct since there's only ever been one org's data until now, and
-- DEFAULT current_org_id() handles every insert going forward.
-- ============================================================

-- ai_analysis_sessions — custom ownership+role policy, preserved
ALTER TABLE ai_analysis_sessions ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
UPDATE ai_analysis_sessions SET organization_id = (SELECT id FROM organizations WHERE slug = 'default-org') WHERE organization_id IS NULL;
ALTER TABLE ai_analysis_sessions ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE ai_analysis_sessions ALTER COLUMN organization_id SET DEFAULT current_org_id();
DROP POLICY IF EXISTS ai_session_select ON ai_analysis_sessions;
DROP POLICY IF EXISTS ai_session_insert ON ai_analysis_sessions;
DROP POLICY IF EXISTS ai_session_update ON ai_analysis_sessions;
CREATE POLICY ai_session_select ON ai_analysis_sessions FOR SELECT
  USING (organization_id = current_org_id() AND (created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()
               AND role IN ('admin','ceo','manager','department_head'))));
CREATE POLICY ai_session_insert ON ai_analysis_sessions FOR INSERT
  WITH CHECK (organization_id = current_org_id() AND auth.uid() IS NOT NULL);
CREATE POLICY ai_session_update ON ai_analysis_sessions FOR UPDATE
  USING (organization_id = current_org_id() AND (created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()
               AND role IN ('admin','ceo'))));

-- Child tables — permissive-to-any-authenticated-user (session ownership
-- enforced app-side), ANDed with org membership.
DO $$
DECLARE
  t TEXT;
  default_org UUID;
  prefix TEXT;
BEGIN
  SELECT id INTO default_org FROM organizations WHERE slug = 'default-org';

  FOREACH t IN ARRAY ARRAY[
    'ai_generated_stories','ai_generated_backlog','ai_generated_tasks',
    'ai_generated_test_cases','ai_generated_apis'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id)', t);
    EXECUTE format('UPDATE %I SET organization_id = $1 WHERE organization_id IS NULL', t) USING default_org;
    EXECUTE format('ALTER TABLE %I ALTER COLUMN organization_id SET NOT NULL', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN organization_id SET DEFAULT current_org_id()', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS ai_story_select ON ai_generated_stories;
DROP POLICY IF EXISTS ai_story_all    ON ai_generated_stories;
CREATE POLICY ai_story_select ON ai_generated_stories FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY ai_story_all    ON ai_generated_stories FOR ALL    USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

DROP POLICY IF EXISTS ai_bl_select ON ai_generated_backlog;
DROP POLICY IF EXISTS ai_bl_all    ON ai_generated_backlog;
CREATE POLICY ai_bl_select ON ai_generated_backlog FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY ai_bl_all    ON ai_generated_backlog FOR ALL    USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

DROP POLICY IF EXISTS ai_task_select ON ai_generated_tasks;
DROP POLICY IF EXISTS ai_task_all    ON ai_generated_tasks;
CREATE POLICY ai_task_select ON ai_generated_tasks FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY ai_task_all    ON ai_generated_tasks FOR ALL    USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

DROP POLICY IF EXISTS ai_tc_select ON ai_generated_test_cases;
DROP POLICY IF EXISTS ai_tc_all    ON ai_generated_test_cases;
CREATE POLICY ai_tc_select ON ai_generated_test_cases FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY ai_tc_all    ON ai_generated_test_cases FOR ALL    USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

DROP POLICY IF EXISTS ai_api_select ON ai_generated_apis;
DROP POLICY IF EXISTS ai_api_all    ON ai_generated_apis;
CREATE POLICY ai_api_select ON ai_generated_apis FOR SELECT USING (organization_id = current_org_id());
CREATE POLICY ai_api_all    ON ai_generated_apis FOR ALL    USING (organization_id = current_org_id()) WITH CHECK (organization_id = current_org_id());

NOTIFY pgrst, 'reload schema';
