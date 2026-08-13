-- ============================================================
-- STEP120: Performance Award Management — Phase 9 (manager final
-- decision: approve & grant, reject, or request review).
--
-- award_participants.status needs a new value ('review_requested') for
-- the "Request Review" action, so its CHECK constraint is replaced.
-- Postgres names an unnamed column CHECK as "<table>_<column>_check" —
-- award_participants_status_check — which is what STEP116 implicitly
-- created; dropped and recreated here with the wider set.
--
-- award_approvals is the decision record itself: one CURRENT row per
-- (award, employee), upserted — same "one row, re-decided in place"
-- convention as self_appraisals/manager_reviews rather than a full
-- history table, since nothing else in this codebase keeps decision
-- history beyond the latest state. final_score is copied in at decision
-- time so the decision stays legible even if scores are ever
-- recalculated afterward. There's no separate `employee_awards` table
-- (mentioned in the original spec's entity list) — award_participants
-- (status/score/rank) joined with award_approvals (who decided, when,
-- why) already covers everything an "employee_awards" table would, and
-- this codebase avoids duplicating tables where a join suffices.
-- ============================================================

ALTER TABLE award_participants DROP CONSTRAINT IF EXISTS award_participants_status_check;
ALTER TABLE award_participants ADD CONSTRAINT award_participants_status_check CHECK (status IN (
  'nominated','in_review','evaluated','recommended','review_requested','granted','not_selected'
));

-- STEP116 originally scoped award_participants writes to is_hr_admin_ceo()
-- only, with a comment flagging that manager write access would be added
-- once the final-approval phase landed — this is that phase: decideAward()
-- in src/lib/awards.js updates status directly as the employee's manager.
DROP POLICY IF EXISTS award_participants_write ON award_participants;
CREATE POLICY award_participants_write ON award_participants FOR ALL USING (
  organization_id = current_org_id() AND (is_manager_of(employee_id) OR is_hr_admin_ceo())
) WITH CHECK (
  organization_id = current_org_id() AND (is_manager_of(employee_id) OR is_hr_admin_ceo())
);

CREATE TABLE IF NOT EXISTS award_approvals (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT current_org_id(),
  award_id        UUID        NOT NULL REFERENCES performance_awards(id) ON DELETE CASCADE,
  employee_id     UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  decided_by      UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  decision        TEXT        NOT NULL CHECK (decision IN ('granted','rejected','review_requested')),
  final_score     NUMERIC(6,2),
  comments        TEXT,
  award_date      DATE,
  decided_at      TIMESTAMPTZ DEFAULT now(),
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (award_id, employee_id)
);

ALTER TABLE award_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS award_approvals_select ON award_approvals;
DROP POLICY IF EXISTS award_approvals_write  ON award_approvals;
CREATE POLICY award_approvals_select ON award_approvals FOR SELECT USING (
  organization_id = current_org_id() AND (
    employee_id = auth.uid() OR is_manager_of(employee_id) OR is_hr_admin_ceo()
  )
);
CREATE POLICY award_approvals_write ON award_approvals FOR ALL USING (
  organization_id = current_org_id() AND (is_manager_of(employee_id) OR is_hr_admin_ceo())
) WITH CHECK (
  organization_id = current_org_id() AND (is_manager_of(employee_id) OR is_hr_admin_ceo())
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.award_approvals TO authenticated;

NOTIFY pgrst, 'reload schema';
