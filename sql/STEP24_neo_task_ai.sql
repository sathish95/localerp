-- ============================================================
-- STEP24: Neo Task AI — AI-Powered Requirement Analysis
-- Run in Supabase SQL editor
-- Robust version: no hard foreign keys to user_stories/project_tasks
-- ============================================================

-- ── DROP existing tables (reverse dependency order) ──────────
DROP TABLE IF EXISTS ai_generated_apis        CASCADE;
DROP TABLE IF EXISTS ai_generated_test_cases  CASCADE;
DROP TABLE IF EXISTS ai_generated_tasks       CASCADE;
DROP TABLE IF EXISTS ai_generated_backlog     CASCADE;
DROP TABLE IF EXISTS ai_generated_stories     CASCADE;
DROP TABLE IF EXISTS ai_analysis_sessions     CASCADE;

-- ── 1. ANALYSIS SESSIONS ─────────────────────────────────────
CREATE TABLE ai_analysis_sessions (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id       UUID,                                   -- soft ref to projects
  created_by       UUID        NOT NULL,                   -- soft ref to profiles
  document_name    TEXT,
  document_text    TEXT,
  status           TEXT        DEFAULT 'pending'
                   CHECK (status IN ('pending','analyzing','completed','failed')),
  error_message    TEXT,
  total_stories    INT         DEFAULT 0,
  total_tasks      INT         DEFAULT 0,
  total_test_cases INT         DEFAULT 0,
  imported_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ai_session_project_idx ON ai_analysis_sessions(project_id);
CREATE INDEX ai_session_creator_idx ON ai_analysis_sessions(created_by);
CREATE INDEX ai_session_status_idx  ON ai_analysis_sessions(status);

-- ── 2. GENERATED STORIES ─────────────────────────────────────
CREATE TABLE ai_generated_stories (
  id                    UUID  DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id            UUID  NOT NULL REFERENCES ai_analysis_sessions(id) ON DELETE CASCADE,
  project_id            UUID,
  module_name           TEXT,
  feature_name          TEXT,
  role                  TEXT,
  capability            TEXT  NOT NULL,
  business_benefit      TEXT,
  ac_given              TEXT,
  ac_when               TEXT,
  ac_then               TEXT,
  extra_acs             JSONB DEFAULT '[]',
  priority              TEXT  DEFAULT 'medium'
                        CHECK (priority IN ('low','medium','high','critical')),
  story_points          INT   DEFAULT 3,
  sprint_recommendation INT,
  status                TEXT  DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','rejected','imported')),
  imported_story_id     UUID,                              -- soft ref
  sort_order            INT   DEFAULT 0,
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ai_story_session_idx ON ai_generated_stories(session_id);

-- ── 3. GENERATED BACKLOG ─────────────────────────────────────
CREATE TABLE ai_generated_backlog (
  id               UUID  DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id       UUID  NOT NULL REFERENCES ai_analysis_sessions(id) ON DELETE CASCADE,
  story_id         UUID  REFERENCES ai_generated_stories(id) ON DELETE SET NULL,
  title            TEXT  NOT NULL,
  description      TEXT,
  priority         TEXT  DEFAULT 'medium'
                   CHECK (priority IN ('low','medium','high','critical')),
  business_value   TEXT,
  story_points     INT   DEFAULT 2,
  status           TEXT  DEFAULT 'pending'
                   CHECK (status IN ('pending','approved','rejected','imported')),
  imported_task_id UUID,                                   -- soft ref
  sort_order       INT   DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ai_backlog_session_idx ON ai_generated_backlog(session_id);
CREATE INDEX ai_backlog_story_idx   ON ai_generated_backlog(story_id);

-- ── 4. GENERATED TASKS ───────────────────────────────────────
CREATE TABLE ai_generated_tasks (
  id                    UUID     DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id            UUID     NOT NULL REFERENCES ai_analysis_sessions(id) ON DELETE CASCADE,
  backlog_id            UUID     REFERENCES ai_generated_backlog(id) ON DELETE SET NULL,
  story_id              UUID     REFERENCES ai_generated_stories(id) ON DELETE SET NULL,
  task_type             TEXT     CHECK (task_type IN ('FE','BE','DB','API','INT','FW','QA','DEVOPS')),
  title                 TEXT     NOT NULL,
  description           TEXT,
  validation_notes      TEXT,
  error_handling_notes  TEXT,
  security_notes        TEXT,
  audit_notes           TEXT,
  performance_notes     TEXT,
  estimated_hours       NUMERIC(5,1),
  story_points          INT      DEFAULT 1,
  sprint_recommendation INT,
  dependencies          JSONB    DEFAULT '[]',
  status                TEXT     DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','rejected','imported')),
  imported_task_id      UUID,                              -- soft ref
  sort_order            INT      DEFAULT 0,
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ai_task_session_idx ON ai_generated_tasks(session_id);
CREATE INDEX ai_task_backlog_idx ON ai_generated_tasks(backlog_id);
CREATE INDEX ai_task_story_idx   ON ai_generated_tasks(story_id);

-- ── 5. GENERATED TEST CASES ──────────────────────────────────
CREATE TABLE ai_generated_test_cases (
  id          UUID  DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id  UUID  NOT NULL REFERENCES ai_analysis_sessions(id) ON DELETE CASCADE,
  story_id    UUID  REFERENCES ai_generated_stories(id) ON DELETE SET NULL,
  title       TEXT  NOT NULL,
  given_cond  TEXT,
  when_action TEXT,
  then_result TEXT,
  test_type   TEXT  DEFAULT 'positive'
              CHECK (test_type IN ('positive','negative','edge','security','performance')),
  priority    TEXT  DEFAULT 'medium'
              CHECK (priority IN ('low','medium','high','critical')),
  status      TEXT  DEFAULT 'pending'
              CHECK (status IN ('pending','approved','rejected')),
  sort_order  INT   DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ai_tc_session_idx ON ai_generated_test_cases(session_id);
CREATE INDEX ai_tc_story_idx   ON ai_generated_test_cases(story_id);

-- ── 6. GENERATED APIS ────────────────────────────────────────
CREATE TABLE ai_generated_apis (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id         UUID NOT NULL REFERENCES ai_analysis_sessions(id) ON DELETE CASCADE,
  api_name           TEXT,
  method             TEXT CHECK (method IN ('GET','POST','PUT','PATCH','DELETE')),
  endpoint           TEXT,
  request_structure  JSONB DEFAULT '{}',
  response_structure JSONB DEFAULT '{}',
  validation_rules   JSONB DEFAULT '[]',
  error_responses    JSONB DEFAULT '[]',
  created_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ai_api_session_idx ON ai_generated_apis(session_id);

-- ── 7. ROW LEVEL SECURITY ────────────────────────────────────
ALTER TABLE ai_analysis_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_generated_stories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_generated_backlog  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_generated_tasks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_generated_test_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_generated_apis     ENABLE ROW LEVEL SECURITY;

-- Sessions: creator or manager/admin/ceo can read
CREATE POLICY ai_session_select ON ai_analysis_sessions FOR SELECT
  USING (created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()
               AND role IN ('admin','ceo','manager','department_head')));

CREATE POLICY ai_session_insert ON ai_analysis_sessions FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY ai_session_update ON ai_analysis_sessions FOR UPDATE
  USING (created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()
               AND role IN ('admin','ceo')));

-- Child tables: any authenticated user (session ownership enforced at app level)
CREATE POLICY ai_story_select ON ai_generated_stories  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY ai_story_all    ON ai_generated_stories  FOR ALL    USING (auth.uid() IS NOT NULL);

CREATE POLICY ai_bl_select    ON ai_generated_backlog  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY ai_bl_all       ON ai_generated_backlog  FOR ALL    USING (auth.uid() IS NOT NULL);

CREATE POLICY ai_task_select  ON ai_generated_tasks    FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY ai_task_all     ON ai_generated_tasks    FOR ALL    USING (auth.uid() IS NOT NULL);

CREATE POLICY ai_tc_select    ON ai_generated_test_cases FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY ai_tc_all       ON ai_generated_test_cases FOR ALL    USING (auth.uid() IS NOT NULL);

CREATE POLICY ai_api_select   ON ai_generated_apis     FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY ai_api_all      ON ai_generated_apis     FOR ALL    USING (auth.uid() IS NOT NULL);

-- ── 8. RELOAD SCHEMA CACHE ───────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ── Verify ───────────────────────────────────────────────────
SELECT table_name, 'created ✓' AS status
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name LIKE 'ai_%'
ORDER BY table_name;
