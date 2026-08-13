-- ============================================================
-- STEP119: Performance Award Management — Phase 7 (scoring engine).
--
-- award_scores is the auditable detail row per (award, employee): every
-- component that fed the final number, plus a snapshot of the weights
-- used to compute it (so a later change to award_scoring_config doesn't
-- rewrite the story of how a past score was actually calculated —
-- same reasoning as document_templates being immutable once a
-- certificate is generated from one). award_participants.final_score/
-- rank/recommendation_label (STEP116) stay as the denormalized copy
-- used for listing/sorting, mirroring performance_scores (detail) vs
-- final_ratings (decision) from STEP66.
--
-- Computation itself (computeScoresForAward() in src/lib/awards.js) runs
-- in application code, not a DB function — unlike
-- recompute_performance_score(), there's no need for SECURITY DEFINER
-- here since only HR/admin/ceo ever trigger it, and that role already
-- has full read access to every source table under existing RLS.
-- ============================================================

CREATE TABLE IF NOT EXISTS award_scores (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id   UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT current_org_id(),
  award_id          UUID        NOT NULL REFERENCES performance_awards(id) ON DELETE CASCADE,
  employee_id       UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  self_score        NUMERIC(6,2) NOT NULL DEFAULT 0,
  manager_score     NUMERIC(6,2) NOT NULL DEFAULT 0,
  peer_score        NUMERIC(6,2) NOT NULL DEFAULT 0,
  performance_score NUMERIC(6,2) NOT NULL DEFAULT 0,
  final_score       NUMERIC(6,2) NOT NULL DEFAULT 0,
  weights_snapshot  JSONB       NOT NULL DEFAULT '{}'::jsonb,
  computed_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (award_id, employee_id)
);

ALTER TABLE award_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS award_scores_select ON award_scores;
DROP POLICY IF EXISTS award_scores_write  ON award_scores;
CREATE POLICY award_scores_select ON award_scores FOR SELECT USING (
  organization_id = current_org_id() AND (
    employee_id = auth.uid() OR is_manager_of(employee_id) OR is_hr_admin_ceo()
  )
);
CREATE POLICY award_scores_write ON award_scores FOR ALL USING (
  organization_id = current_org_id() AND is_hr_admin_ceo()
) WITH CHECK (
  organization_id = current_org_id() AND is_hr_admin_ceo()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.award_scores TO authenticated;

NOTIFY pgrst, 'reload schema';
