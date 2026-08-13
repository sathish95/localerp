-- ============================================================
-- STEP117: Performance Award Management — Phase 5 (manager / lead
-- feedback). Mirrors award_self_feedback's shape (answers JSONB keyed
-- by award_questions.id) plus the fixed structured fields the manager
-- feedback form always needs regardless of configured questions: rating,
-- comments, evidence, recommendation (see AWARD_MANAGEMENT spec §6).
-- One row per (award, employee) — the employee's current
-- reporting_manager_id is who is expected to fill it in, enforced by
-- is_manager_of() in RLS rather than a separate reviewer-assignment
-- table (there's exactly one reviewer per employee: their manager).
-- ============================================================

CREATE TABLE IF NOT EXISTS award_manager_feedback (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT current_org_id(),
  award_id        UUID        NOT NULL REFERENCES performance_awards(id) ON DELETE CASCADE,
  employee_id     UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reviewer_id     UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  answers         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  rating          NUMERIC(5,2),
  comments        TEXT,
  evidence        TEXT,
  recommendation  TEXT,
  status          TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted')),
  submitted_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (award_id, employee_id)
);
CREATE INDEX IF NOT EXISTS award_manager_feedback_reviewer_idx ON award_manager_feedback(reviewer_id);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS award_manager_feedback_updated_at ON award_manager_feedback;
CREATE TRIGGER award_manager_feedback_updated_at BEFORE UPDATE ON award_manager_feedback
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE award_manager_feedback ENABLE ROW LEVEL SECURITY;

-- Read: the employee themself, their manager, HR/admin/ceo. Write: only
-- the employee's manager or HR/admin/ceo (an employee never writes their
-- own manager-feedback row).
DROP POLICY IF EXISTS award_manager_feedback_select ON award_manager_feedback;
DROP POLICY IF EXISTS award_manager_feedback_write  ON award_manager_feedback;
CREATE POLICY award_manager_feedback_select ON award_manager_feedback FOR SELECT USING (
  organization_id = current_org_id() AND (
    employee_id = auth.uid() OR is_manager_of(employee_id) OR is_hr_admin_ceo()
  )
);
CREATE POLICY award_manager_feedback_write ON award_manager_feedback FOR ALL USING (
  organization_id = current_org_id() AND (is_manager_of(employee_id) OR is_hr_admin_ceo())
) WITH CHECK (
  organization_id = current_org_id() AND (is_manager_of(employee_id) OR is_hr_admin_ceo())
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.award_manager_feedback TO authenticated;

NOTIFY pgrst, 'reload schema';
