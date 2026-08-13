-- ============================================================
-- STEP116: Performance Award Management — Phase 3 (eligibility
-- snapshot) + Phase 4 (employee self feedback).
--
-- award_participants is the snapshot taken at publish time (see
-- publishAward() in src/lib/awards.js) — eligibility rules are evaluated
-- ONCE when HR publishes the award, not re-evaluated live, so a
-- nomination window has a stable participant list even if someone's
-- department/tenure changes mid-cycle. `status` tracks this employee's
-- overall progress through the award's configured workflow; later
-- phases (scoring/recommendation/approval) add columns here rather than
-- new tables, matching STEP66's own final_ratings/performance_scores
-- precedent of "one row per employee per cycle, explicit status column"
-- over a generic workflow-engine table.
--
-- award_self_feedback is one row per (award, employee); `answers` is a
-- JSONB map of award_questions.id -> submitted value, so the schema
-- doesn't need to change when HR edits the question list. Reuses
-- is_hr_admin_ceo() / is_manager_of() from STEP66 rather than
-- redefining them.
-- ============================================================

CREATE TABLE IF NOT EXISTS award_participants (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT current_org_id(),
  award_id        UUID        NOT NULL REFERENCES performance_awards(id) ON DELETE CASCADE,
  employee_id     UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status          TEXT        NOT NULL DEFAULT 'nominated' CHECK (status IN (
                    'nominated','in_review','evaluated','recommended','granted','not_selected'
                  )),
  final_score     NUMERIC(6,2),
  rank            INT,
  recommendation_label TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (award_id, employee_id)
);
CREATE INDEX IF NOT EXISTS award_participants_employee_idx ON award_participants(employee_id);
CREATE INDEX IF NOT EXISTS award_participants_award_idx ON award_participants(award_id);

CREATE TABLE IF NOT EXISTS award_self_feedback (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT current_org_id(),
  award_id        UUID        NOT NULL REFERENCES performance_awards(id) ON DELETE CASCADE,
  employee_id     UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  answers         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted')),
  submitted_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (award_id, employee_id)
);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS award_participants_updated_at ON award_participants;
CREATE TRIGGER award_participants_updated_at BEFORE UPDATE ON award_participants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS award_self_feedback_updated_at ON award_self_feedback;
CREATE TRIGGER award_self_feedback_updated_at BEFORE UPDATE ON award_self_feedback
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE award_participants  ENABLE ROW LEVEL SECURITY;
ALTER TABLE award_self_feedback ENABLE ROW LEVEL SECURITY;

-- Participants: the employee can see their own row, their manager can see
-- their direct reports' rows, HR/admin/ceo see everything in the org.
-- Writes are HR/admin/ceo only for now (publishAward() snapshotting,
-- plus later scoring/recommendation writes) — manager write access for
-- the final-approval phase is added when that phase lands, not pre-opened
-- here.
DROP POLICY IF EXISTS award_participants_select ON award_participants;
DROP POLICY IF EXISTS award_participants_write  ON award_participants;
CREATE POLICY award_participants_select ON award_participants FOR SELECT USING (
  organization_id = current_org_id() AND (
    employee_id = auth.uid() OR is_manager_of(employee_id) OR is_hr_admin_ceo()
  )
);
CREATE POLICY award_participants_write ON award_participants FOR ALL USING (
  organization_id = current_org_id() AND is_hr_admin_ceo()
) WITH CHECK (
  organization_id = current_org_id() AND is_hr_admin_ceo()
);

-- Self feedback: only the employee themself can write their own answers;
-- their manager and HR/admin/ceo get read access (manager needs to see it
-- alongside their own feedback form in the next phase; HR needs oversight).
DROP POLICY IF EXISTS award_self_feedback_select ON award_self_feedback;
DROP POLICY IF EXISTS award_self_feedback_write  ON award_self_feedback;
CREATE POLICY award_self_feedback_select ON award_self_feedback FOR SELECT USING (
  organization_id = current_org_id() AND (
    employee_id = auth.uid() OR is_manager_of(employee_id) OR is_hr_admin_ceo()
  )
);
CREATE POLICY award_self_feedback_write ON award_self_feedback FOR ALL USING (
  organization_id = current_org_id() AND employee_id = auth.uid()
) WITH CHECK (
  organization_id = current_org_id() AND employee_id = auth.uid()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.award_participants  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.award_self_feedback TO authenticated;

NOTIFY pgrst, 'reload schema';
