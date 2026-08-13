-- ============================================================
-- STEP115: Performance Award Management — Phase 1 (schema) + Phase 2
-- (HR award creation: categories, eligibility rules, configurable
-- workflow steps, feedback/nomination questions, scoring config).
--
-- Later phases (self/manager/peer feedback submissions, computed scores,
-- recommendations, approvals, certificate templates/generation) add their
-- own tables in later STEP files rather than being crammed in here.
--
-- NOTE: the core table is named `performance_awards`, not `awards` —
-- this database already has an unrelated pre-existing `awards` table
-- (the public Landing Page's "Awards & Recognition" content section,
-- see src/pages/LandingPage.jsx / AdminContentPage.jsx). Naming this
-- one `awards` initially caused `CREATE TABLE IF NOT EXISTS awards` to
-- silently no-op against that table, and every later statement
-- referencing organization_id/category_id/status/code on "awards" then
-- failed with "column does not exist" since the real table has none of
-- those. Renamed to avoid the collision entirely.
--
-- Design notes:
--   * award_categories, performance_awards — standard org-scoped master
--     data, same shape as document_templates (STEP114).
--   * award_eligibility_rules / award_workflow_steps / award_questions —
--     one row per configured rule/step/question, JSONB payload for the
--     variable part (rule_value / config), matching the
--     ai_capability_settings / sales_config_flags convention of "narrow
--     typed columns + one JSONB column for the part that genuinely varies
--     by type" instead of a sparse wide table.
--   * award_scoring_config — one row per award (like
--     performance_score_weights being one row per org), holding the
--     scoring weights (DB CHECK enforces they sum to 100 — safe here
--     because, unlike goals.weight_percent, this is always saved as one
--     complete form submission, never built up incrementally), plus the
--     award's rating scale / recommendation thresholds / tie-break order
--     as JSONB so HR can fully reconfigure them without a migration.
--   * Workflow step sequencing is intentionally NOT a fixed enum order —
--     step_order is a plain editable integer per award, so "which steps
--     run and in what order" is entirely HR-configured data, never
--     hardcoded in application logic.
-- ============================================================

CREATE TABLE IF NOT EXISTS award_categories (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT current_org_id(),
  name            TEXT        NOT NULL,
  description     TEXT,
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  created_by      UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS performance_awards (
  id                      UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id         UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT current_org_id(),
  name                    TEXT        NOT NULL,
  code                    TEXT        NOT NULL,
  category_id             UUID        REFERENCES award_categories(id) ON DELETE SET NULL,
  description             TEXT,
  objective               TEXT,
  frequency               TEXT,
  start_date              DATE,
  end_date                DATE,
  nomination_start_date   DATE,
  nomination_end_date     DATE,
  evaluation_start_date   DATE,
  evaluation_end_date     DATE,
  announcement_date       DATE,
  status                  TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','evaluation','completed','cancelled')),
  created_by              UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, code)
);
CREATE INDEX IF NOT EXISTS performance_awards_org_status_idx ON performance_awards(organization_id, status);
CREATE INDEX IF NOT EXISTS performance_awards_category_idx ON performance_awards(category_id);

CREATE TABLE IF NOT EXISTS award_eligibility_rules (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT current_org_id(),
  award_id        UUID        NOT NULL REFERENCES performance_awards(id) ON DELETE CASCADE,
  rule_type       TEXT        NOT NULL CHECK (rule_type IN (
                    'department','designation','employment_type','location',
                    'min_tenure_months','min_performance_rating','employment_status','specific_employees'
                  )),
  rule_value      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS award_eligibility_rules_award_idx ON award_eligibility_rules(award_id);

CREATE TABLE IF NOT EXISTS award_workflow_steps (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT current_org_id(),
  award_id        UUID        NOT NULL REFERENCES performance_awards(id) ON DELETE CASCADE,
  step_key        TEXT        NOT NULL CHECK (step_key IN (
                    'self_feedback','manager_feedback','peer_nomination','additional_evaluation','final_approval'
                  )),
  is_enabled      BOOLEAN     NOT NULL DEFAULT true,
  step_order      INT         NOT NULL DEFAULT 0,
  config          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (award_id, step_key)
);

CREATE TABLE IF NOT EXISTS award_questions (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT current_org_id(),
  award_id        UUID        NOT NULL REFERENCES performance_awards(id) ON DELETE CASCADE,
  step_key        TEXT        NOT NULL CHECK (step_key IN ('self_feedback','manager_feedback','peer_nomination')),
  question_text   TEXT        NOT NULL,
  question_type   TEXT        NOT NULL DEFAULT 'text' CHECK (question_type IN ('text','long_text','rating','number','yes_no','attachment')),
  is_required     BOOLEAN     NOT NULL DEFAULT true,
  sort_order      INT         NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS award_questions_award_step_idx ON award_questions(award_id, step_key);

CREATE TABLE IF NOT EXISTS award_scoring_config (
  id                        UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id           UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT current_org_id(),
  award_id                  UUID        NOT NULL UNIQUE REFERENCES performance_awards(id) ON DELETE CASCADE,
  self_feedback_weight      NUMERIC(5,2) NOT NULL DEFAULT 0,
  manager_feedback_weight   NUMERIC(5,2) NOT NULL DEFAULT 0,
  peer_feedback_weight      NUMERIC(5,2) NOT NULL DEFAULT 0,
  performance_weight        NUMERIC(5,2) NOT NULL DEFAULT 0,
  rating_scale              JSONB       NOT NULL DEFAULT '[
                                {"value":1,"label":"Needs Improvement"},
                                {"value":2,"label":"Below Expectations"},
                                {"value":3,"label":"Meets Expectations"},
                                {"value":4,"label":"Exceeds Expectations"},
                                {"value":5,"label":"Outstanding"}
                              ]'::jsonb,
  recommendation_thresholds JSONB       NOT NULL DEFAULT '[
                                {"min_score":90,"label":"Strongly Recommended"},
                                {"min_score":80,"label":"Recommended"},
                                {"min_score":70,"label":"Consider"},
                                {"min_score":0,"label":"Not Recommended"}
                              ]'::jsonb,
  tie_break_order           JSONB       NOT NULL DEFAULT '["manager_score","peer_score","performance_score"]'::jsonb,
  created_at                TIMESTAMPTZ DEFAULT now(),
  updated_at                TIMESTAMPTZ DEFAULT now(),
  CHECK (self_feedback_weight + manager_feedback_weight + peer_feedback_weight + performance_weight = 100)
);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS award_categories_updated_at ON award_categories;
CREATE TRIGGER award_categories_updated_at BEFORE UPDATE ON award_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS performance_awards_updated_at ON performance_awards;
CREATE TRIGGER performance_awards_updated_at BEFORE UPDATE ON performance_awards
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS award_workflow_steps_updated_at ON award_workflow_steps;
CREATE TRIGGER award_workflow_steps_updated_at BEFORE UPDATE ON award_workflow_steps
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS award_scoring_config_updated_at ON award_scoring_config;
CREATE TRIGGER award_scoring_config_updated_at BEFORE UPDATE ON award_scoring_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE award_categories        ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_awards      ENABLE ROW LEVEL SECURITY;
ALTER TABLE award_eligibility_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE award_workflow_steps    ENABLE ROW LEVEL SECURITY;
ALTER TABLE award_questions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE award_scoring_config    ENABLE ROW LEVEL SECURITY;

-- Permissive org-scoped SELECT (every employee needs to read award/category
-- names — e.g. "My Awards" in later phases — so read access is not
-- HR-restricted); writes are HR/admin/ceo only, matching CLAUDE.md's isHR
-- convention (['admin','ceo','hr']).
DROP POLICY IF EXISTS award_categories_select ON award_categories;
DROP POLICY IF EXISTS award_categories_write  ON award_categories;
CREATE POLICY award_categories_select ON award_categories FOR SELECT USING (
  organization_id = current_org_id()
);
CREATE POLICY award_categories_write ON award_categories FOR ALL USING (
  organization_id = current_org_id() AND EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','hr')
  )
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','hr')
  )
);

DROP POLICY IF EXISTS performance_awards_select ON performance_awards;
DROP POLICY IF EXISTS performance_awards_write  ON performance_awards;
CREATE POLICY performance_awards_select ON performance_awards FOR SELECT USING (
  organization_id = current_org_id()
);
CREATE POLICY performance_awards_write ON performance_awards FOR ALL USING (
  organization_id = current_org_id() AND EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','hr')
  )
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','hr')
  )
);

DROP POLICY IF EXISTS award_eligibility_rules_select ON award_eligibility_rules;
DROP POLICY IF EXISTS award_eligibility_rules_write  ON award_eligibility_rules;
CREATE POLICY award_eligibility_rules_select ON award_eligibility_rules FOR SELECT USING (
  organization_id = current_org_id()
);
CREATE POLICY award_eligibility_rules_write ON award_eligibility_rules FOR ALL USING (
  organization_id = current_org_id() AND EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','hr')
  )
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','hr')
  )
);

DROP POLICY IF EXISTS award_workflow_steps_select ON award_workflow_steps;
DROP POLICY IF EXISTS award_workflow_steps_write  ON award_workflow_steps;
CREATE POLICY award_workflow_steps_select ON award_workflow_steps FOR SELECT USING (
  organization_id = current_org_id()
);
CREATE POLICY award_workflow_steps_write ON award_workflow_steps FOR ALL USING (
  organization_id = current_org_id() AND EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','hr')
  )
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','hr')
  )
);

DROP POLICY IF EXISTS award_questions_select ON award_questions;
DROP POLICY IF EXISTS award_questions_write  ON award_questions;
CREATE POLICY award_questions_select ON award_questions FOR SELECT USING (
  organization_id = current_org_id()
);
CREATE POLICY award_questions_write ON award_questions FOR ALL USING (
  organization_id = current_org_id() AND EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','hr')
  )
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','hr')
  )
);

DROP POLICY IF EXISTS award_scoring_config_select ON award_scoring_config;
DROP POLICY IF EXISTS award_scoring_config_write  ON award_scoring_config;
CREATE POLICY award_scoring_config_select ON award_scoring_config FOR SELECT USING (
  organization_id = current_org_id()
);
CREATE POLICY award_scoring_config_write ON award_scoring_config FOR ALL USING (
  organization_id = current_org_id() AND EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','hr')
  )
) WITH CHECK (
  organization_id = current_org_id() AND EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','ceo','hr')
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.award_categories        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.performance_awards      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.award_eligibility_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.award_workflow_steps    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.award_questions         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.award_scoring_config    TO authenticated;

NOTIFY pgrst, 'reload schema';
