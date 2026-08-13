-- ============================================================
-- STEP118: Performance Award Management — Phase 6 (peer nomination).
--
-- One row per (award, nominator, nominee) — duplicate nominations of the
-- same person by the same colleague for the same award are blocked by a
-- hard UNIQUE constraint (not configurable, unlike self-nomination/
-- anonymity/max-count, which are award_workflow_steps.config and
-- enforced in app code the same way goals.weight_percent is — see
-- src/lib/awards.js submitNomination()).
--
-- Anonymity follows STEP66's get_peer_feedback() precedent exactly:
-- the base table's RLS never exposes another employee's nominations
-- directly to the nominee (only to the nominator themself and
-- HR/admin/ceo); the nominee/their manager read redacted rows through
-- get_award_peer_nominations(), which nulls the nominator's identity
-- when is_anonymous is true and the caller isn't HR/admin/ceo.
-- ============================================================

CREATE TABLE IF NOT EXISTS award_peer_nominations (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE DEFAULT current_org_id(),
  award_id        UUID        NOT NULL REFERENCES performance_awards(id) ON DELETE CASCADE,
  nominator_id    UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  nominee_id      UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason          TEXT        NOT NULL,
  comments        TEXT,
  evidence        TEXT,
  answers         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  is_anonymous    BOOLEAN     NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (award_id, nominator_id, nominee_id)
);
CREATE INDEX IF NOT EXISTS award_peer_nominations_nominee_idx ON award_peer_nominations(award_id, nominee_id);

ALTER TABLE award_peer_nominations ENABLE ROW LEVEL SECURITY;

-- Base-table read is deliberately narrow (nominator + HR/admin/ceo only)
-- — everyone else must go through the redacted RPC below.
DROP POLICY IF EXISTS award_peer_nominations_select ON award_peer_nominations;
DROP POLICY IF EXISTS award_peer_nominations_write  ON award_peer_nominations;
CREATE POLICY award_peer_nominations_select ON award_peer_nominations FOR SELECT USING (
  organization_id = current_org_id() AND (nominator_id = auth.uid() OR is_hr_admin_ceo())
);
CREATE POLICY award_peer_nominations_write ON award_peer_nominations FOR ALL USING (
  organization_id = current_org_id() AND (nominator_id = auth.uid() OR is_hr_admin_ceo())
) WITH CHECK (
  organization_id = current_org_id() AND (nominator_id = auth.uid() OR is_hr_admin_ceo())
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.award_peer_nominations TO authenticated;

CREATE OR REPLACE FUNCTION get_award_peer_nominations(p_award_id UUID, p_nominee_id UUID)
RETURNS TABLE (
  id UUID, reason TEXT, comments TEXT, evidence TEXT, is_anonymous BOOLEAN, created_at TIMESTAMPTZ,
  nominator_id UUID, nominator_name TEXT
) AS $$
BEGIN
  IF NOT (
    auth.uid() = p_nominee_id
    OR is_manager_of(p_nominee_id)
    OR is_hr_admin_ceo()
  ) THEN
    RAISE EXCEPTION 'Not authorized to view this employee''s nominations';
  END IF;

  RETURN QUERY
  SELECT
    n.id, n.reason, n.comments, n.evidence, n.is_anonymous, n.created_at,
    CASE WHEN n.is_anonymous AND NOT is_hr_admin_ceo() THEN NULL ELSE n.nominator_id END,
    CASE WHEN n.is_anonymous AND NOT is_hr_admin_ceo() THEN NULL ELSE nominator.full_name END
  FROM award_peer_nominations n
  LEFT JOIN profiles nominator ON nominator.id = n.nominator_id
  WHERE n.award_id = p_award_id AND n.nominee_id = p_nominee_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION get_award_peer_nominations(UUID, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
